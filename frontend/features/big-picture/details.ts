import { backendLog, fetchFriendPersonasBackend } from '../../api/backend';
import { getCachedGameData, getGameData } from '../../core/game-data';
import { steamLanguageSync } from '../../steam/localization';
import { getMappedShortcuts, toSignedShortcutAppId } from '../../steam/shortcuts';
import {
	APP_DETAILS_ROUTE_PATTERN,
	NON_DETAILS_ROUTE_PATTERN,
	collectActiveRouteValues,
	gamepadRuntime,
	resolveActiveGameContext,
} from '../../steam/gamepad';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { getCachedLocalAchievementsForGame } from '../achievements/cache';
import { fetchLocalAchievementData, subscribeLocalAchievementData } from '../achievements/service';
import { ACHIEVEMENT_REFRESH_STORAGE_KEY } from '../achievements/lifecycle';
import { getCachedOfficialCommunityItems, getOfficialCommunityItems } from '../library/community-items';
import { getCachedCommunityContent, getCachedNews, getCommunityContent, getNews } from '../library/news';
import { getCachedFriendData, getFriendData } from '../library/social/friends';
import { cachePersona, hasCachedPersona } from '../library/social/personas';
import { prioritizeShortcutLinkingAndArtwork } from '../library/artwork-sync';
import { subscribeControllerChanges } from '../library/controller';
import { defaultBigPictureModeEnabled } from '../../core/preferences';
import {
	mountNativeBigPictureDetails,
	unmountNativeBigPictureDetails,
} from './NativeBigPictureDetails';
import {
	ensureCloudDivider,
	ensureNativePanelRoot,
	ensurePlaybarControllerStat,
	hideBigPictureNonSteamNotices,
	removeBigPictureFallbackPanel,
	removeCloudDivider,
	removePlaybarControllerStat,
	restoreBigPictureNonSteamNotices,
} from './panel-mount';
import { activeTabFromNative, findBigPictureTabStrip } from './tabs';
import type { BigPictureDetailData, BigPictureTab, MappedShortcut } from './types';

interface BigPictureDetailState {
	shortcut: MappedShortcut;
	language: string;
	activeTab: BigPictureTab;
	root: HTMLElement;
	panel: HTMLElement;
	data: BigPictureDetailData;
	generation: number;
	hydrationStarted: boolean;
}

const detailStates = new WeakMap<Document, BigPictureDetailState>();
const detailGenerations = new WeakMap<Document, number>();
const detailTabObservers = new WeakMap<Document, { strip: HTMLElement; observer: MutationObserver }>();
const detailRetryTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const detailRetryCounts = new WeakMap<Document, number>();
const detailTabSyncTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const activeDetailDocs = new Set<Document>();
let achievementSyncInstalled = false;

function ensureAchievementSync(): void {
	if (achievementSyncInstalled) return;
	achievementSyncInstalled = true;

	subscribeLocalAchievementData(update => {
		for (const doc of Array.from(activeDetailDocs)) {
			const state = detailStates.get(doc);
			if (!state || !isLiveDetailState(doc, state)) continue;
			if (update.steamAppId !== state.shortcut.steamAppId) continue;
			const shortcutIdStr = String(state.shortcut.id);
			if (update.stateAppId && update.stateAppId !== shortcutIdStr) continue;
			applyDetailPatch(doc, state, 'achievements', update.data);
		}
	});

	if (typeof window !== 'undefined') {
		window.addEventListener('storage', event => {
			if (event.key !== ACHIEVEMENT_REFRESH_STORAGE_KEY) return;
			for (const doc of Array.from(activeDetailDocs)) {
				const state = detailStates.get(doc);
				if (!state || !isLiveDetailState(doc, state)) continue;
				void fetchLocalAchievementData(state.shortcut.steamAppId, {
					stateAppId: String(state.shortcut.id),
					maxAgeMs: 0,
				}).then(data => {
					applyDetailPatch(doc, state, 'achievements', data);
				});
			}
		});
	}
}

let controllerSyncInstalled = false;
const activeControllerDocs = new Set<Document>();

function ensureControllerSync(doc?: Document): void {
	if (doc) activeControllerDocs.add(doc);
	if (controllerSyncInstalled) return;
	controllerSyncInstalled = true;
	const targetDoc = doc || (typeof window !== 'undefined' ? window.document : null);
	if (!targetDoc) return;
	subscribeControllerChanges(targetDoc, () => {
		const allDocs = new Set([...Array.from(activeDetailDocs), ...Array.from(activeControllerDocs)]);
		for (const d of Array.from(allDocs)) {
			if (d.body && d.body.isConnected) {
				ensurePlaybarControllerStat(d);
			} else {
				activeControllerDocs.delete(d);
			}
		}
	});
}

function detectCurrentMappedShortcut(doc: Document): MappedShortcut | null {
	if (!doc.body) return null;
	const context = resolveActiveGameContext(doc);
	if (context.type !== 'shortcut-linked' || !context.identity) return null;
	const mapped = getMappedShortcuts().find(shortcut => {
		const raw = Number(shortcut.id);
		const unsigned = raw >>> 0;
		const signed = toSignedShortcutAppId(unsigned);
		return [raw, unsigned, signed].includes(context.identity!.shortcutAppId);
	});
	return mapped || {
		id: context.identity.shortcutAppId,
		title: context.identity.title,
		steamAppId: String(context.identity.steamAppId),
	};
}

function nextDetailGeneration(doc: Document): number {
	const next = (detailGenerations.get(doc) || 0) + 1;
	detailGenerations.set(doc, next);
	return next;
}

function isLiveDetailState(doc: Document, state: BigPictureDetailState): boolean {
	const live = detailStates.get(doc);
	if (!live || live !== state || !state.root.isConnected || !state.panel.isConnected) return false;
	return live === state
		&& live.generation === state.generation
		&& live.shortcut.id === state.shortcut.id
		&& live.shortcut.steamAppId === state.shortcut.steamAppId
		&& live.language === state.language
		&& live.root.dataset.gdlSteamAppId === state.shortcut.steamAppId
		&& live.root.dataset.gdlShortcutAppId === String(state.shortcut.id);
}

function cachedBigPictureDetailData(shortcut: MappedShortcut, language: string): BigPictureDetailData {
	return {
		game: getCachedGameData(shortcut.steamAppId, language)?.data || null,
		achievements: getCachedLocalAchievementsForGame(shortcut.steamAppId, String(shortcut.id)),
		news: getCachedNews(shortcut.steamAppId, language)?.data || [],
		community: getCachedCommunityContent(shortcut.steamAppId, language)?.data || [],
		cards: getCachedOfficialCommunityItems(shortcut.steamAppId, language)?.data || null,
		friends: getCachedFriendData(shortcut.steamAppId)?.data || null,
	};
}

function renderNativeRoot(doc: Document, state: BigPictureDetailState): void {
	if (!isLiveDetailState(doc, state)) return;
	try {
		steamWebpackRuntime.captureRuntime(doc);
		gamepadRuntime.initialize(doc);
	} catch {}
	hideBigPictureNonSteamNotices(doc);
	const tabs = findBigPictureTabStrip(doc);
	ensureCloudDivider(doc, tabs?.strip || state.panel);
	ensurePlaybarControllerStat(doc);
	const mounted = mountNativeBigPictureDetails(state.root, {
		tab: state.activeTab,
		shortcut: state.shortcut,
		data: state.data,
		hydrating: state.hydrationStarted,
		document: doc,
	});
	if (!mounted) {
		backendLog('[NGL][Gamepad] ReactDOM is not ready for the native Big Picture panel; retrying');
		scheduleDetailRetry(doc);
	}
}

function applyDetailPatch<K extends keyof BigPictureDetailData>(
	doc: Document,
	state: BigPictureDetailState,
	key: K,
	value: BigPictureDetailData[K],
): void {
	if (!isLiveDetailState(doc, state)) return;
	if (value == null && state.data[key] != null) return;
	state.data = { ...state.data, [key]: value };
	renderNativeRoot(doc, state);
}

function startDetailHydration(doc: Document, state: BigPictureDetailState): void {
	if (state.hydrationStarted) return;
	state.hydrationStarted = true;
	renderNativeRoot(doc, state);
	const applyResource = <K extends keyof BigPictureDetailData>(key: K, request: Promise<BigPictureDetailData[K]>): void => {
		void request.then(value => applyDetailPatch(doc, state, key, value)).catch(error => {
			backendLog(`[NGL][Gamepad] ${String(key)} hydration failed: ${String(error)}`);
		});
	};

	applyResource('game', getGameData(state.shortcut.steamAppId, state.language).then(game => {
		backendLog(`Big Picture linked core populated for "${state.shortcut.title}" (${state.shortcut.steamAppId})`);
		return game || state.data.game || null;
	}));
	applyResource('achievements', fetchLocalAchievementData(state.shortcut.steamAppId, {
		stateAppId: String(state.shortcut.id),
		maxAgeMs: 1250,
	}));
	applyResource('news', getNews(state.shortcut.steamAppId, state.language));
	applyResource('community', getCommunityContent(state.shortcut.steamAppId, state.language));
	applyResource('cards', getOfficialCommunityItems(doc, state.shortcut.steamAppId, state.language));
	applyResource('friends', getFriendData(state.shortcut.steamAppId).then(async result => {
		const friendData = result.data;
		if (friendData && friendData.totalCount > 0) {
			const visibleIds = [
				...friendData.recentlyPlayed.map(friend => friend.steamid),
				...friendData.previouslyPlayed.map(friend => friend.steamid),
				...(friendData.wishlisted || []).map(friend => friend.steamid),
			];
			const missing = [...new Set(visibleIds)].filter(id => !hasCachedPersona(id)).slice(0, 24);
			if (missing.length > 0) {
				try {
					const personas = JSON.parse(await fetchFriendPersonasBackend({ steam_ids_csv: missing.join(',') }));
					if (Array.isArray(personas)) personas.forEach(cachePersona);
				} catch {}
			}
		}
		return friendData;
	}));
}

function scheduleDetailRetry(doc: Document): void {
	if (detailRetryTimers.has(doc)) return;
	const attempt = (detailRetryCounts.get(doc) || 0) + 1;
	if (attempt > 40) return;
	detailRetryCounts.set(doc, attempt);
	const timer = setTimeout(() => {
		detailRetryTimers.delete(doc);
		if (doc.body?.isConnected) void refreshBigPictureShortcutDetails(doc);
	}, Math.min(80 * attempt, 500));
	detailRetryTimers.set(doc, timer);
}

function scheduleTabSync(doc: Document, preferredTab?: BigPictureTab): void {
	const state = detailStates.get(doc);
	if (state && preferredTab) state.activeTab = preferredTab;
	const pending = detailTabSyncTimers.get(doc);
	if (pending) clearTimeout(pending);
	const timer = setTimeout(() => {
		detailTabSyncTimers.delete(doc);
		if (doc.body?.isConnected) void refreshBigPictureShortcutDetails(doc);
	}, 40);
	detailTabSyncTimers.set(doc, timer);
}

function bindTabs(doc: Document, strip: HTMLElement, controls: Map<BigPictureTab, HTMLElement>): void {
	for (const [tab, control] of controls) {
		control.dataset.gdlBpTab = tab;
		if (control.dataset.gdlBpBound === '1') continue;
		control.dataset.gdlBpBound = '1';
		control.addEventListener('click', () => scheduleTabSync(doc, tab));
		control.addEventListener('keydown', event => {
			if (event.key === 'Enter' || event.key === ' ') scheduleTabSync(doc, tab);
		});
	}
	const current = detailTabObservers.get(doc);
	if (current?.strip === strip) return;
	current?.observer.disconnect();
	const observer = new MutationObserver(mutations => {
		for (const m of mutations) {
			if (m.attributeName === 'aria-selected') {
				const target = m.target as HTMLElement;
				if (target.getAttribute('aria-selected') === 'true') {
					const tab = target.dataset.gdlBpTab as BigPictureTab | undefined;
					scheduleTabSync(doc, tab);
					return;
				}
			}
		}
		scheduleTabSync(doc);
	});
	observer.observe(strip, {
		attributes: true,
		childList: true,
		subtree: true,
		attributeFilter: ['aria-selected', 'aria-current', 'tabindex', 'class'],
	});
	detailTabObservers.set(doc, { strip, observer });
}

function retireLegacyDetailShell(doc: Document): void {
	for (const stale of Array.from(doc.querySelectorAll('#gdl-bp-detail-shell, #gdl-bp-native-strip-placeholder'))) stale.remove();
}

function removeBigPictureDetailsNodes(doc: Document, keepControllerStat = false): void {
	if (!keepControllerStat) activeDetailDocs.delete(doc);
	const state = detailStates.get(doc);
	if (state) {
		unmountNativeBigPictureDetails(state.root);
		detailStates.delete(doc);
	}
	nextDetailGeneration(doc);
	for (const element of Array.from(doc.querySelectorAll('#gdl-bp-detail-root, #gdl-bp-detail-shell, #gdl-bp-native-strip-placeholder, #gdl-bp-focus-ring-root, #gdl-bp-focus-ring'))) element.remove();
	removeBigPictureFallbackPanel(doc);
	removeCloudDivider(doc);
	if (!keepControllerStat) removePlaybarControllerStat(doc);
	restoreBigPictureNonSteamNotices(doc);
}

function isLibraryOrNonDetailsView(doc: Document): boolean {
	if (doc.querySelector('[class*="AllGames"], [class*="CollectionsHeader"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return true;
	}
	const routeValues = collectActiveRouteValues(doc);
	const hasLibraryRoute = routeValues.some(v => NON_DETAILS_ROUTE_PATTERN.test(v));
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (hasLibraryRoute && !hasAppRoute) {
		return true;
	}
	const hasPlayBar = Boolean(doc.querySelector('[class*="PlayBar"], [class*="PlayButton"], [class*="playButton"], [class*="AppDetailsHeader"], [class*="appDetailsHeader"]'));
	if (!hasPlayBar && !hasAppRoute) {
		return true;
	}
	return false;
}

export async function refreshBigPictureShortcutDetails(doc: Document): Promise<void> {
	if (!doc.body) return;
	if (doc.title?.includes('SP Desktop') || doc.body.classList.contains('DesktopUI') || doc.querySelector('.DesktopUI')) {
		removeBigPictureDetailsNodes(doc);
		return;
	}
	if (isLibraryOrNonDetailsView(doc)) {
		removeBigPictureDetailsNodes(doc);
		return;
	}
	retireLegacyDetailShell(doc);
	const shortcut = detectCurrentMappedShortcut(doc);
	if (!shortcut) {
		backendLog('Big Picture details: no mapped shortcut detected for current view');
		removeBigPictureDetailsNodes(doc);
		return;
	}
	backendLog(`Big Picture details: mapped shortcut detected "${shortcut.title}" (id=${shortcut.id}, steamAppId=${shortcut.steamAppId})`);
	prioritizeShortcutLinkingAndArtwork(shortcut.id, shortcut.steamAppId, shortcut.title);
	if (defaultBigPictureModeEnabled()) {
		activeDetailDocs.add(doc);
		detailTabObservers.get(doc)?.observer.disconnect();
		detailTabObservers.delete(doc);
		removeBigPictureDetailsNodes(doc, true);
		ensureControllerSync(doc);
		ensurePlaybarControllerStat(doc);
		return;
	}
	const language = String(steamLanguageSync() || 'english').toLowerCase();
	let state = detailStates.get(doc);
	const changedShortcut = !state
		|| state.shortcut.id !== shortcut.id
		|| state.shortcut.steamAppId !== shortcut.steamAppId
		|| state.language !== language;
	if (changedShortcut && state) {
		removeBigPictureDetailsNodes(doc);
		state = undefined;
	}
	const tabs = findBigPictureTabStrip(doc);
	if (!tabs) {
		backendLog('Big Picture details: native tab strip not ready, scheduling retry');
		removeBigPictureDetailsNodes(doc);
		if (!isLibraryOrNonDetailsView(doc)) {
			scheduleDetailRetry(doc);
		}
		return;
	}
	const nativeTab = activeTabFromNative(doc, tabs.controls) || state?.activeTab || 'activity';
	const nodes = ensureNativePanelRoot(doc, tabs, nativeTab);
	if (!nodes) {
		backendLog('Big Picture details: native content panel not ready, scheduling retry');
		scheduleDetailRetry(doc);
		return;
	}
	detailRetryCounts.delete(doc);
	nodes.root.dataset.gdlSteamAppId = shortcut.steamAppId;
	nodes.root.dataset.gdlShortcutAppId = String(shortcut.id);
	activeDetailDocs.add(doc);
	ensureAchievementSync();
	ensureControllerSync(doc);

	if (!state || changedShortcut || state.root !== nodes.root || state.panel !== nodes.panel) {
		state = {
			shortcut,
			language,
			activeTab: nativeTab,
			root: nodes.root,
			panel: nodes.panel,
			data: cachedBigPictureDetailData(shortcut, language),
			generation: nextDetailGeneration(doc),
			hydrationStarted: false,
		};
		detailStates.set(doc, state);
		renderNativeRoot(doc, state);
		startDetailHydration(doc, state);
	} else if (state.activeTab !== nativeTab) {
		state.activeTab = nativeTab;
		renderNativeRoot(doc, state);
	}
	bindTabs(doc, tabs.strip, tabs.controls);
}

export function disposeBigPictureShortcutDetails(doc: Document | null): void {
	if (!doc) return;
	activeDetailDocs.delete(doc);
	activeControllerDocs.delete(doc);
	const retryTimer = detailRetryTimers.get(doc);
	if (retryTimer) clearTimeout(retryTimer);
	detailRetryTimers.delete(doc);
	const tabTimer = detailTabSyncTimers.get(doc);
	if (tabTimer) clearTimeout(tabTimer);
	detailTabSyncTimers.delete(doc);
	detailRetryCounts.delete(doc);
	detailTabObservers.get(doc)?.observer.disconnect();
	detailTabObservers.delete(doc);
	removeBigPictureDetailsNodes(doc);
}
