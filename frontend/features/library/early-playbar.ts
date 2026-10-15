import { DisposableRegistry } from '../../core/disposables';
import { mutationIsWithinSelector } from '../../core/dom';
import { findMappingForTitle, subscribeMappings } from '../../core/mappings';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { withoutLibrarySidebarMutations } from '../../steam/library-sidebar';
import { elementsWithCssModuleClass } from '../../steam/native-dom';
import { paintedNativeStats } from '../../steam/library-details';
import { removePlaytimeFallbackStats, syncEarlyLinkedPlaytime } from '../playtime/tracker';
import { getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import { ensureLocalPlaybarStat } from '../achievements/playbar';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { removeCloudStatus, syncEarlyLinkedCloudStatus } from './cloud-status';
import { disposeEarlyLinkedNotice, installEarlyShortcutNoticeStyle, syncEarlyLinkedNotice } from './early-notice';
import { routedSteamAppId } from './native-route';
import { warmNativeShortcutArtwork } from './native-artwork-warmup';
import { findNativePlaybar } from './primary-links';
import { removeObsoletePlaybarAchievements } from './playbar-achievement-cleanup';
import { disposeLinkedPrimaryLinks, syncEarlyLinkedPrimaryLinks } from './early-primary-links';
import { disposeEarlyLinkedGameInfo, syncEarlyLinkedGameInfo } from './early-game-info';

export interface EarlyLinkedPlaybar {
	sync: () => void;
	dispose: () => void;
}

const installedPlaybars = new WeakMap<Document, EarlyLinkedPlaybar>();
const OWNED_PLAYBAR_SELECTOR = '[id^="gdl-"], [data-gdl-cloud-status], [data-gdl-playtime], [data-gdl-playbar-achievements], [data-gdl-game-info-button]';
const MAX_SETTLE_FRAMES = 12;
const MAX_SETTLE_MS = 600;

function isOwnedMutation(record: MutationRecord): boolean {
	return mutationIsWithinSelector(record, OWNED_PLAYBAR_SELECTOR);
}

function sameTargets(previous: Set<HTMLElement>, next: Set<HTMLElement>): boolean {
	return previous.size === next.size && Array.from(previous).every(element => next.has(element));
}

/** Keep shortcut playbars ready independently of metadata requests. The body
 * observer only discovers native hosts; text and visibility signals are scoped
 * to the playbar and its ancestors, leaving the virtual sidebar untouched. */
export function installEarlyLinkedPlaybar(doc: Document): EarlyLinkedPlaybar {
	const existing = installedPlaybars.get(doc);
	if (existing) return existing;
	const lifecycle = new DisposableRegistry(() => installedPlaybars.delete(doc));
	installEarlyShortcutNoticeStyle(doc);
	const view = doc.defaultView;
	const Observer = view?.MutationObserver;
	let statsTargets = new Set<HTMLElement>();
	let attributeTargets = new Set<HTMLElement>();
	let frame: number | null = null;
	let framesRemaining = 0;
	let settleDeadline = 0;
	let syncing = false;
	let discoveryInstalled = false;
	const isShortcutRoute = (): boolean => {
		const appId = routedSteamAppId(doc);
		return Boolean(appId && appId >= 2147483648 && !view?.closed);
	};
	const contentsObserver = Observer ? new Observer(records => {
		if (withoutLibrarySidebarMutations(records).some(record => !isOwnedMutation(record))) sync();
	}) : null;
	const attributesObserver = Observer ? new Observer(records => {
		if (records.some(record => !isOwnedMutation(record))) sync();
	}) : null;
	if (contentsObserver) lifecycle.add(() => contentsObserver.disconnect());
	if (attributesObserver) lifecycle.add(() => attributesObserver.disconnect());

	function bindTargets(): void {
		const nextStats = new Set(isShortcutRoute()
			? elementsWithCssModuleClass(doc, PLAYBAR_CLASSES().GameStatsSection).filter(element => element.isConnected)
			: []);
		const nextAttributes = new Set<HTMLElement>();
		const playbar = isShortcutRoute() ? findNativePlaybar(doc) : null;
		for (const root of [...nextStats, ...(playbar ? [playbar] : [])]) {
			for (let current: HTMLElement | null = root; current && current !== doc.body && current !== doc.documentElement; current = current.parentElement) {
				if (!current.closest(OWNED_PLAYBAR_SELECTOR)) nextAttributes.add(current);
			}
		}
		if (!sameTargets(statsTargets, nextStats)) {
			contentsObserver?.disconnect();
			statsTargets = nextStats;
			for (const target of statsTargets) contentsObserver?.observe(target, { childList: true, characterData: true, subtree: true });
		}
		if (!sameTargets(attributeTargets, nextAttributes)) {
			attributesObserver?.disconnect();
			attributeTargets = nextAttributes;
			// Observe these native nodes directly. Subtree attribute observation
			// would react to our own text-visibility styles and create feedback.
			for (const target of attributeTargets) attributesObserver?.observe(target, { attributes: true, attributeFilter: ['class', 'style'] });
		}
	}

	function synchronize(): void {
		if (syncing || lifecycle.isDisposed) return;
		syncing = true;
		try {
			syncEarlyLinkedNotice(doc);
			removeObsoletePlaybarAchievements(doc, true);
			bindTargets();
			syncEarlyLinkedPrimaryLinks(doc);
			syncEarlyLinkedGameInfo(doc);
			if (!isShortcutRoute()) { removeCloudStatus(doc); removePlaytimeFallbackStats(doc); return; }
			const shortcutId = routedSteamAppId(doc)!;
			warmNativeShortcutArtwork(doc, shortcutId);
			syncEarlyLinkedCloudStatus(doc);
			syncEarlyLinkedPlaytime(doc);
			const steamAppId = !isShortcutDismissed(shortcutId) && findMappingForTitle('', String(shortcutId));
			const achievements = steamAppId ? getCachedLocalAchievementsForShortcut(steamAppId, shortcutId) : null;
			if (achievements?.found && achievements.total > 0) ensureLocalPlaybarStat(doc, achievements);
			// Cloud can create a fallback statistics row before Steam has one.
			bindTargets();
		} finally { syncing = false; }
	}

	function hasPaintedCloud(): boolean {
		const cloud = doc.querySelector<HTMLElement>('[data-gdl-cloud-status="1"]');
		if (!cloud?.isConnected || !view) return false;
		const shortcutId = routedSteamAppId(doc);
		if (!shortcutId || shortcutId < 2147483648 || isShortcutDismissed(shortcutId)
			|| !findMappingForTitle('', String(shortcutId)) || !cloud.parentElement
			|| !paintedNativeStats(doc, shortcutId).includes(cloud.parentElement)) return false;
		const rect = cloud.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return false;
		for (let current: HTMLElement | null = cloud; current; current = current.parentElement) {
			const style = view.getComputedStyle(current);
			if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
		}
		return true;
	}

	function cancelSettle(): void {
		if (frame !== null) view?.cancelAnimationFrame(frame);
		frame = null;
		framesRemaining = 0;
	}
	lifecycle.add(cancelSettle);
	function settleBeforePaint(): void {
		frame = null;
		if (lifecycle.isDisposed || !isShortcutRoute()) return;
		synchronize();
		if (hasPaintedCloud() || --framesRemaining <= 0 || Date.now() >= settleDeadline) return;
		frame = view?.requestAnimationFrame(settleBeforePaint) ?? null;
	}
	function sync(): void {
		if (lifecycle.isDisposed) return;
		synchronize();
		if (!isShortcutRoute() || hasPaintedCloud()) { cancelSettle(); return; }
		if (frame !== null || !view?.requestAnimationFrame) return;
		framesRemaining = MAX_SETTLE_FRAMES;
		settleDeadline = Date.now() + MAX_SETTLE_MS;
		frame = view.requestAnimationFrame(settleBeforePaint);
	}

	function installDiscovery(): void {
		if (discoveryInstalled || !doc.body || lifecycle.isDisposed) return;
		discoveryInstalled = true;
		if (Observer) {
			const discovery = new Observer(mutations => {
				const records = withoutLibrarySidebarMutations(mutations).filter(record => !isOwnedMutation(record));
				if (records.length === 0) return;
				// Changes inside a known statistics row already have a synchronous
				// scoped observer. Discovery handles only new/replaced native hosts.
				// Loading hero/logo images or replacing unrelated page content must
				// not repeat every playbar scanner before Steam's image can paint.
				const classes = PLAYBAR_CLASSES();
				const changesHost = records.some(record => {
					if (Array.from(statsTargets).some(target => target.contains(record.target))) return false;
					return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => {
						if (node.nodeType !== 1) return false;
						const root = node as HTMLElement;
						if (root.closest(OWNED_PLAYBAR_SELECTOR)) return false;
						return [classes.Container, classes.GameStatsSection].some(css =>
							elementsWithCssModuleClass(root, css).some(element => !element.closest(OWNED_PLAYBAR_SELECTOR)));
					});
				});
				if (!changesHost) return;
				sync();
			});
			discovery.observe(doc.body, { childList: true, subtree: true });
			lifecycle.add(() => discovery.disconnect());
		}
		sync();
	}
	const handle: EarlyLinkedPlaybar = { sync, dispose: () => lifecycle.dispose() };
	installedPlaybars.set(doc, handle);
	lifecycle.add(subscribeMappings(sync));
	lifecycle.add(() => disposeEarlyLinkedNotice(doc));
	lifecycle.add(() => disposeLinkedPrimaryLinks(doc));
	lifecycle.add(() => disposeEarlyLinkedGameInfo(doc));
	if (doc.body) installDiscovery();
	else lifecycle.listen(doc, 'DOMContentLoaded', installDiscovery, { once: true });
	lifecycle.listen(doc, 'transitionend', event => {
		if (attributeTargets.has(event.target as HTMLElement)) sync();
	}, true);
	return handle;
}
