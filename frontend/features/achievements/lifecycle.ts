import type { LocalAchievementData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { mutationIsWithinSelector } from '../../core/dom';
import { cacheLocalAchievements, clearLocalAchievementCache, getCachedLocalAchievementsForShortcut, localAchievementDataSignature } from './cache';
import { clearAchievementRuntimeHost } from './context';
import { disposeAllLocalAchievementsModals, disposeLocalAchievementsModal, openLocalAchievementsModal } from './modal';
import { detectLinkedSteamAppId, isCurrentAchievementTarget, linkedAchievementTarget, ownsAchievementSidebar, type LinkedAchievementTarget } from './navigation';
import { disposeAchievementNotifications } from './notifications';
import { ensureLocalPlaybarStat } from './playbar';
import {
	clearLocalAchievementRequestCache,
	fetchLocalAchievementData,
	publishAchievementUpdate,
	subscribeLocalAchievementData,
	type LocalAchievementUpdate,
} from './service';
import { renderLocalAchievementSidebar } from './sidebar';
import { ensureLocalAchievementStyles } from './styles';
import { clearLocalAchievementGameInfoCache } from './game-info';
import { withoutLibrarySidebarMutations } from '../../steam/library-sidebar';
import { cancelLibrarySidebarWork, runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';

interface LocalAchievementDocumentState {
	timer: number | null;
	initialTimer: number | null;
	syncTimer: number | null;
	observer: MutationObserver | null;
	inFlight: boolean;
	pendingRefresh: boolean;
	signature: string;
	data: LocalAchievementData | null;
	target: LinkedAchievementTarget | null;
	refreshNow: () => void;
	cleanup: () => void;
}

export interface LocalAchievementRefreshTarget {
	steamAppId: string | number;
	stateAppId?: string | number | null;
}

const localAchievementDocState = new WeakMap<Document, LocalAchievementDocumentState>();
const localAchievementDocuments = new Set<Document>();
export const ACHIEVEMENT_REFRESH_STORAGE_KEY = 'gdl_achievement_refresh_v1';
export const OPTIMISTIC_ACHIEVEMENT_STORAGE_KEY = 'gdl_optimistic_achievements_v1';
let achievementRefreshStorageListener: ((event: StorageEvent) => void) | null = null;

interface AchievementRefreshMessage {
	steamAppId?: string;
	stateAppId?: string;
	nonce?: string;
}

function parseAchievementRefreshMessage(value: string | null): LocalAchievementRefreshTarget | undefined {
	if (!value) return undefined;
	try {
		const message = JSON.parse(value) as AchievementRefreshMessage;
		return message && /^\d+$/.test(String(message.steamAppId || ''))
			? { steamAppId: String(message.steamAppId), stateAppId: String(message.stateAppId || '') }
			: undefined;
	} catch { return undefined; }
}

function currentDocShortcutAppId(doc: Document): string | null {
	return linkedAchievementTarget(doc)?.shortcutAppId || null;
}

function isShortcutRunning(shortcutAppId: string | number | null): boolean {
	const target = Number(shortcutAppId);
	if (!Number.isFinite(target) || target <= 0) return false;
	const runningApps = (window as any).SteamUIStore?.RunningApps as Set<any> | undefined;
	if (!runningApps || typeof runningApps[Symbol.iterator] !== 'function') return false;
	for (const app of runningApps) {
		const raw = Number(app?.appid ?? app?.m_unAppID);
		const normalized = raw < 0 ? (raw >>> 0) : raw;
		if (normalized === target) return true;
	}
	return false;
}

export function disposeLocalAchievementUI(doc: Document): void {
	disposeLocalAchievementsModal(doc);
	const state = localAchievementDocState.get(doc);
	if (!state) return;
	localAchievementDocState.delete(doc);
	localAchievementDocuments.delete(doc);
	state.cleanup();
}

export function installLocalAchievementUI(doc: Document): void {
	if (localAchievementDocState.has(doc)) return;
	installAchievementRefreshStorageListener();
	ensureLocalAchievementStyles(doc);

	let disposed = false;
	let requestTarget: LinkedAchievementTarget | null = null;
	let requestRoot: HTMLElement | null = null;
	let requestEpoch = 0;
	let ownershipEpoch = 0;
	let observedIdentity = '';
	let observedRoot = doc.getElementById('gdl-library-injected');
	const state: LocalAchievementDocumentState = {
		timer: null,
		initialTimer: null,
		syncTimer: null,
		observer: null,
		inFlight: false,
		pendingRefresh: false,
		signature: '',
		data: null,
		target: null,
		refreshNow: () => {},
		cleanup: () => {},
	};
	const syncOwnership = (records: readonly MutationRecord[] = []): number => {
		const target = linkedAchievementTarget(doc);
		const identity = target ? `${target.steamAppId}:${target.shortcutAppId}` : '';
		const root = doc.getElementById('gdl-library-injected');
		const retiredRoot = records.some(record => Array.from(record.removedNodes).some(node => {
			if (node === observedRoot || (observedRoot && node.contains(observedRoot))) return true;
			return node.nodeType === 1 && ((node as Element).id === 'gdl-library-injected'
				|| Boolean((node as Element).querySelector?.('#gdl-library-injected')));
		}));
		if (identity !== observedIdentity || retiredRoot || (observedRoot && observedRoot !== root)) {
			ownershipEpoch += 1;
			disposeLocalAchievementsModal(doc);
		}
		observedIdentity = identity;
		observedRoot = root;
		return ownershipEpoch;
	};

	const stopPolling = (): void => {
		if (state.timer !== null) window.clearInterval(state.timer);
		state.timer = null;
	};
	const applyData = (target: LinkedAchievementTarget, data: LocalAchievementData | null,
		root = doc.getElementById('gdl-library-injected'), epoch = syncOwnership()): void => {
		let ownedRoot = root;
		const current = (): boolean => {
			if (disposed || syncOwnership(state.observer?.takeRecords?.() || []) !== epoch || !isCurrentAchievementTarget(doc, target)) return false;
			const mounted = doc.getElementById('gdl-library-injected');
			if (ownedRoot) return mounted === ownedRoot && ownedRoot.isConnected;
			// The native header can precede our first metadata mount. Adopt that
			// first exact linked root without treating hydration as navigation;
			// later root retirement/replacement advances the epoch above.
			if (mounted) {
				if (!ownsAchievementSidebar(doc, target)) return false;
				ownedRoot = mounted;
			}
			// With no metadata root, ensureLocalPlaybarStat still independently
			// requires the exact shortcut's currently committed native header.
			return true;
		};
		if (!current()) return;
		const appid = target.steamAppId;
		if (!data?.found || String(data.metadata_appid || data.appid) !== appid || !Array.isArray(data.achievements) || data.total <= 0) {
			if (data && state.signature !== `unavailable:${appid}`) {
				backendLog(`Local achievements bridge returned no data for ${appid}`);
				state.signature = `unavailable:${appid}`;
			}
			return;
		}
		cacheLocalAchievements(data, appid, target.shortcutAppId);
		state.data = data;
		state.target = target;
		void runWhenLibrarySidebarIdle(doc, 'linked-achievements', () => {
			if (!current()) return;
			const latest = getCachedLocalAchievementsForShortcut(appid, target.shortcutAppId) || data;
			state.data = latest;
			const signature = localAchievementDataSignature(latest);
			const host = doc.querySelector('#gdl-achievements-content [data-gdl-local-ach="1"]');
			// The service bus and IPC share one latest commit. An identical cached
			// sidebar stays intact when backend validation completes during scroll.
			if (ownsAchievementSidebar(doc, target) && (!host || host.getAttribute('data-gdl-achievement-signature') !== signature)) {
				renderLocalAchievementSidebar(doc, latest);
			}
			state.signature = signature;
			ensureLocalPlaybarStat(doc, latest);
		}).catch(error => { if (!disposed) backendLog('Local achievements render error: ' + String(error)); });
	};

	const refresh = async (force = false): Promise<void> => {
		if (disposed || (!force && doc.hidden) || !doc.body || doc.defaultView?.closed) return;
		if (state.inFlight) { state.pendingRefresh = true; return; }
		const epoch = syncOwnership();
		const target = linkedAchievementTarget(doc);
		if (!target) {
			state.signature = '';
			state.data = null;
			state.target = null;
			stopPolling();
			return;
		}
		state.inFlight = true;
		requestTarget = target;
		requestEpoch = epoch;
		const root = requestRoot = doc.getElementById('gdl-library-injected');
		try {
			const data = await fetchLocalAchievementData(target.steamAppId, {
				stateAppId: target.shortcutAppId,
			});
			if (disposed || !isCurrentAchievementTarget(doc, target)) return;
			applyData(target, data, root, epoch);
		} catch (error) {
			if (!disposed) backendLog('Local achievements bridge error: ' + String(error));
		} finally {
			state.inFlight = false;
			requestTarget = null;
			requestRoot = null;
			if (state.pendingRefresh && !disposed) {
				state.pendingRefresh = false;
				void refresh(true);
			}
		}
	};

	state.refreshNow = () => {
		state.signature = '';
		void refresh(true);
	};

	const syncPolling = (): void => {
		if (disposed || doc.hidden || !doc.body || doc.defaultView?.closed || !detectLinkedSteamAppId(doc)) {
			stopPolling();
			return;
		}
		// The launch watcher owns the 2 s live-progress read while the shortcut is
		// running. This document receives the same result through the service bus.
		if (isShortcutRunning(currentDocShortcutAppId(doc))) {
			stopPolling();
			return;
		}
		if (state.timer === null) state.timer = window.setInterval(() => { void refresh(); }, 5000);
		void refresh();
	};
	const schedulePollingSync = (): void => {
		if (disposed || state.syncTimer !== null) return;
		state.syncTimer = window.setTimeout(() => {
			state.syncTimer = null;
			syncPolling();
		}, 180);
	};

	const intercept = (event: Event): void => {
		const target = event.target as Element | null;
		if (!target?.closest?.('#gdl-achievements-section') || !state.data || !state.target) return;
		if (!isCurrentAchievementTarget(doc, state.target) || !ownsAchievementSidebar(doc, state.target)) return;
		event.preventDefault();
		event.stopPropagation();
		(event as any).stopImmediatePropagation?.();
		void openLocalAchievementsModal(doc, state.data).catch(error => backendLog('Achievements modal error: ' + error));
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element | null)?.closest?.('#gdl-achievements-section')) intercept(event);
	};

	doc.addEventListener('click', intercept, true);
	doc.addEventListener('keydown', onKeyDown, true);
	doc.addEventListener('visibilitychange', syncPolling);
	state.observer = new MutationObserver(mutations => {
		const records = withoutLibrarySidebarMutations(mutations);
		if (!records.length) return;
		syncOwnership(records);
		const isExternalMutation = records.some(record => !mutationIsWithinSelector(record,
			'[id^="gdl-"], [data-gdl-playbar-achievements], [data-gdl-cloud-status], [data-gdl-playtime], [data-gdl-game-info-button]'));
		if (isExternalMutation) schedulePollingSync();
	});
	state.observer.observe(doc.body, { childList: true, subtree: true });
	const unsubscribeData = subscribeLocalAchievementData(update => {
		const target = linkedAchievementTarget(doc);
		if (!target || target.steamAppId !== update.steamAppId || target.shortcutAppId !== update.stateAppId) return;
		const sameRequest = state.inFlight && requestTarget?.steamAppId === target.steamAppId
			&& requestTarget.shortcutAppId === target.shortcutAppId;
		applyData(target, update.data, sameRequest ? requestRoot : doc.getElementById('gdl-library-injected'),
			sameRequest ? requestEpoch : syncOwnership());
	});
	syncPolling();
	state.cleanup = () => {
		if (disposed) return;
		disposed = true;
		cancelLibrarySidebarWork(doc, 'linked-achievements');
		stopPolling();
		if (state.syncTimer !== null) window.clearTimeout(state.syncTimer);
		state.syncTimer = null;
		state.observer?.disconnect();
		state.observer = null;
		unsubscribeData();
		doc.removeEventListener('click', intercept, true);
		doc.removeEventListener('keydown', onKeyDown, true);
		doc.removeEventListener('visibilitychange', syncPolling);
	};
	localAchievementDocState.set(doc, state);
	localAchievementDocuments.add(doc);
}

/** Refresh every active Steam surface after a global or per-game policy change.
 * A per-game caller can also provide the exact identities so the shared result
 * is published immediately, even when Steam's Properties window is a separate
 * document from the Library surface. */
function performLocalAchievementRefresh(target?: LocalAchievementRefreshTarget): void {
	if (!target?.steamAppId) {
		clearLocalAchievementCache();
	}
	clearLocalAchievementRequestCache();
	for (const doc of Array.from(localAchievementDocuments)) localAchievementDocState.get(doc)?.refreshNow();
	const steamAppId = String(target?.steamAppId ?? '');
	if (/^\d+$/.test(steamAppId)) {
		void fetchLocalAchievementData(steamAppId, {
			stateAppId: target?.stateAppId,
			maxAgeMs: 0,
		}).catch(error => backendLog('Targeted achievement refresh error: ' + String(error)));
	}
}

function installAchievementRefreshStorageListener(): void {
	if (achievementRefreshStorageListener) return;
	const listener = (event: StorageEvent): void => {
		if (achievementRefreshStorageListener !== listener) return;
		if (event.key === ACHIEVEMENT_REFRESH_STORAGE_KEY) {
			performLocalAchievementRefresh(parseAchievementRefreshMessage(event.newValue));
		} else if (event.key === OPTIMISTIC_ACHIEVEMENT_STORAGE_KEY) {
			try {
				const payload = JSON.parse(event.newValue || '') as LocalAchievementUpdate | null;
				if (payload?.steamAppId && payload?.data) {
					publishAchievementUpdate({
						steamAppId: String(payload.steamAppId),
						stateAppId: payload.stateAppId ? String(payload.stateAppId) : '',
						data: payload.data,
					});
				}
			} catch {}
		}
	};
	achievementRefreshStorageListener = listener;
	window.addEventListener('storage', listener);
}

function broadcastLocalAchievementRefresh(target?: LocalAchievementRefreshTarget): void {
	try {
		localStorage.setItem(ACHIEVEMENT_REFRESH_STORAGE_KEY, JSON.stringify({
			steamAppId: target?.steamAppId == null ? '' : String(target.steamAppId),
			stateAppId: target?.stateAppId == null ? '' : String(target.stateAppId),
			nonce: `${Date.now()}:${Math.random()}`,
		} satisfies AchievementRefreshMessage));
	} catch {}
}

export function broadcastOptimisticAchievementUpdate(update: LocalAchievementUpdate): void {
	publishAchievementUpdate(update);
	try {
		localStorage.setItem(OPTIMISTIC_ACHIEVEMENT_STORAGE_KEY, JSON.stringify({
			...update,
			nonce: `${Date.now()}:${Math.random()}`,
		}));
	} catch {}
}

/** Apply a policy change locally and notify other Steam web windows. Properties
 * and plugin Settings can live in a different CEF context from the Library, so
 * a module-local cache clear alone is not an observable hot update. */
export function refreshLocalAchievementUI(target?: LocalAchievementRefreshTarget): void {
	performLocalAchievementRefresh(target);
	broadcastLocalAchievementRefresh(target);
}

export function disposeAchievementRuntime(): void {
	if (achievementRefreshStorageListener) window.removeEventListener('storage', achievementRefreshStorageListener);
	achievementRefreshStorageListener = null;
	for (const doc of Array.from(localAchievementDocuments)) disposeLocalAchievementUI(doc);
	disposeAllLocalAchievementsModals();
	disposeAchievementNotifications();
	// A Steam restart should retain the last confirmed snapshot for immediate
	// stale-while-revalidate painting. Explicit policy/path/language changes use
	// the default persistent clear through performLocalAchievementRefresh().
	clearLocalAchievementCache(false);
	clearLocalAchievementRequestCache();
	clearLocalAchievementGameInfoCache();
	clearAchievementRuntimeHost();
}
