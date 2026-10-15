import { backendLog, fetchFriendPersonasBackend } from '../../api/backend';
import { getCachedGameData, getGameData } from '../../core/game-data';
import { steamLanguageSync } from '../../steam/localization';
import { toSignedShortcutAppId } from '../../steam/shortcuts';
import {
	APP_DETAILS_ROUTE_PATTERN,
	NON_DETAILS_ROUTE_PATTERN,
	collectActiveRouteValues,
	describeLinkedGamepadTarget,
	gamepadRuntime,
	isCurrentLinkedGamepadTarget,
	resolveActiveGameContext,
} from '../../steam/gamepad';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { cacheLocalAchievements, getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import { restoreBigPictureAchievementProjections } from './NativeBigPictureAchievements';
import { fetchLocalAchievementData, subscribeLocalAchievementData } from '../achievements/service';
import { ACHIEVEMENT_REFRESH_STORAGE_KEY } from '../achievements/lifecycle';
import { getCachedOfficialCommunityItems, getOfficialCommunityItems } from '../library/community-items';
import { getCachedCommunityContent, getCachedNews, getCommunityContent, getNews } from '../library/news';
import { getCachedFriendData, getFriendData } from '../library/social/friends';
import { cachePersona, hasCachedPersona } from '../library/social/personas';
import { detectConnectedController, detectGameControllerSupport, subscribeControllerChanges } from '../library/controller';
import {
	mountNativeBigPictureDetails,
	isNativeBigPictureDetailsRuntimeCurrent,
	unmountNativeBigPictureDetails,
} from './NativeBigPictureDetails';
import {
	commitNativePanelRoot,
	ensureNativePanelRoot,
	ensurePlaybarControllerStat,
	hideBigPictureNonSteamNotices,
	removeBigPictureFallbackPanel,
	removeCloudDivider,
	removePlaybarControllerStat,
	restoreBigPictureNonSteamNotices,
	restoreAllNativePanelChildren,
	restoreNativePanelChildren,
} from './panel-mount';
import { activeTabFromNative, findBigPictureTabStrip } from './tabs';
import { ensureBigPictureDetailStyles } from './details-styles';
import { activateNativeGameInfoBridge, deactivateNativeGameInfoBridge } from './native-info-bridge';
import type { BigPictureDetailData, BigPictureTab, MappedShortcut } from './types';
import { getBigPictureMappedShortcuts } from './mapped-shortcuts-cache';
import { disposeBigPictureModals } from './owned-modals';
import { syncBigPicturePlaybarMetadata, disposeBigPicturePlaybarMetadata } from './playbar-metadata';

interface BigPictureDetailState {
	shortcut: MappedShortcut;
	language: string;
	activeTab: BigPictureTab;
	root: HTMLElement;
	panel: HTMLElement;
	data: BigPictureDetailData;
	generation: number;
	hydrationStarted: boolean;
	pendingResources: number;
}

const detailStates = new WeakMap<Document, BigPictureDetailState>();
const detailGenerations = new WeakMap<Document, number>();
const detailTabObservers = new WeakMap<Document, { strip: HTMLElement; controls: Map<BigPictureTab, HTMLElement>; observer: MutationObserver; dispose: () => void }>();
const detailRetryTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const detailRetryCounts = new WeakMap<Document, number>();
const detailTabSyncTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const preferredDetailTabs = new WeakMap<Document, { tab: BigPictureTab; until: number }>();
const detailContextGapSince = new WeakMap<Document, number>();
const detailPatchTimers = new WeakMap<BigPictureDetailState, ReturnType<typeof setTimeout>>();
const detailPendingPatches = new WeakMap<BigPictureDetailState, Partial<BigPictureDetailData>>();
const achievementSyncCleanups = new WeakMap<Document, () => void>();
const detailMountReports = new WeakMap<Document, string>();
function reportDetailMount(doc: Document, stage: string): void {
	if (detailMountReports.get(doc) === stage) return;
	detailMountReports.set(doc, stage);
	backendLog(`[NGL][Gamepad][Mount] ${stage}`);
}
function ensureAchievementSync(doc: Document): void {
 if (achievementSyncCleanups.has(doc)) return;
 const unsubscribe = subscribeLocalAchievementData(update => {
  const state = detailStates.get(doc);
  if (!state || !isLiveDetailState(doc, state) || update.steamAppId !== state.shortcut.steamAppId
   || update.stateAppId !== String(state.shortcut.id)) return;
  if (update.data && String(update.data.metadata_appid || update.data.appid) !== state.shortcut.steamAppId) return;
  if (update.data) cacheLocalAchievements(update.data, state.shortcut.steamAppId, String(state.shortcut.id));
  applyDetailPatch(doc, state, 'achievements', update.data);
 });
 const storage = (event: StorageEvent) => {
  if (event.key !== ACHIEVEMENT_REFRESH_STORAGE_KEY) return;
  const state = detailStates.get(doc);
  if (!state || !isLiveDetailState(doc, state)) return;
  void fetchLocalAchievementData(state.shortcut.steamAppId, { stateAppId: String(state.shortcut.id), maxAgeMs: 0 })
   .then(data => applyDetailPatch(doc, state, 'achievements', data)).catch(() => {});
 };
 doc.defaultView?.addEventListener('storage', storage);
 achievementSyncCleanups.set(doc, () => {
  unsubscribe(); doc.defaultView?.removeEventListener('storage', storage);
  achievementSyncCleanups.delete(doc);
 });
}

const docControllerCleanups = new WeakMap<Document, () => void>();
const docControllerRetryTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const activeControllerDocs = new Set<Document>();

function ensureControllerSync(doc?: Document): void {
	if (!doc) return;
	const shortcut = detectCurrentMappedShortcut(doc);
	if (!shortcut) {
		activeControllerDocs.delete(doc);
		const timer = docControllerRetryTimers.get(doc);
		if (timer) clearTimeout(timer);
		docControllerRetryTimers.delete(doc);
		docControllerCleanups.get(doc)?.();
		docControllerCleanups.delete(doc);
		removePlaybarControllerStat(doc);
		return;
	}
	activeControllerDocs.add(doc);
	const connected = detectConnectedController(doc);
	if (!connected.connected) {
		removePlaybarControllerStat(doc);
	} else {
		const support = detectGameControllerSupport(shortcut.steamAppId, doc);
		const stat = ensurePlaybarControllerStat(doc, support);
		if (!stat && doc.body?.isConnected) {
			const prevTimer = docControllerRetryTimers.get(doc);
			if (prevTimer) clearTimeout(prevTimer);
			const retryTimer = setTimeout(() => {
				docControllerRetryTimers.delete(doc);
				if (!doc.body?.isConnected) return;
				const currentSc = detectCurrentMappedShortcut(doc);
				if (!currentSc) return;
				const currentConn = detectConnectedController(doc);
				if (currentConn.connected) {
					const sp = detectGameControllerSupport(currentSc.steamAppId, doc);
					ensurePlaybarControllerStat(doc, sp);
				}
			}, 75);
			docControllerRetryTimers.set(doc, retryTimer);
		}
	}

	if (!docControllerCleanups.has(doc)) {
		const cleanup = subscribeControllerChanges(doc, (connectedInfo) => {
			if (!doc.body || !doc.body.isConnected) return;
			const sc = detectCurrentMappedShortcut(doc);
			if (!sc) {
				activeControllerDocs.delete(doc);
				removePlaybarControllerStat(doc);
				return;
			}
			if (!connectedInfo.connected) {
				removePlaybarControllerStat(doc);
			} else {
				const sp = detectGameControllerSupport(sc.steamAppId, doc);
				ensurePlaybarControllerStat(doc, sp);
			}
		});
		docControllerCleanups.set(doc, cleanup);
	}
}

function detectCurrentMappedShortcut(doc: Document): MappedShortcut | null {
	if (!doc.body) return null;
	const context = resolveActiveGameContext(doc);
	if (context.type !== 'shortcut-linked' || !context.identity) return null;
	if (!isCurrentLinkedGamepadTarget(doc, context.identity.shortcutAppId, context.identity.steamAppId)) return null;
	const mapped = getBigPictureMappedShortcuts(doc).find(shortcut => {
		const raw = Number(shortcut.id);
		const unsigned = raw >>> 0;
		const signed = toSignedShortcutAppId(unsigned);
		return [raw, unsigned, signed].includes(context.identity!.shortcutAppId)
			&& Number(shortcut.steamAppId) === context.identity!.steamAppId;
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
		&& steamUIModeService.isGamepadUI(doc)
		&& isCurrentLinkedGamepadTarget(doc, state.shortcut.id, state.shortcut.steamAppId)
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
		achievements: getCachedLocalAchievementsForShortcut(shortcut.steamAppId, String(shortcut.id)),
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
	ensureBigPictureDetailStyles(doc);
	// Linked metadata does not create a Steam Cloud synchronization backend.
	// Preserve Steam's real row and retire the old unconditional "updated" row.
	removeCloudDivider(doc);
	ensurePlaybarControllerStat(doc, detectGameControllerSupport(state.shortcut.steamAppId, doc));
	ensureControllerSync(doc);
	syncBigPicturePlaybarMetadata(doc, state.shortcut);

 if (state.activeTab === 'info') activateNativeGameInfoBridge(doc, state.shortcut, state.data.game);
 else deactivateNativeGameInfoBridge(doc);
	state.root.hidden = false;
	state.root.style.removeProperty('display');
	const expectedTab = state.activeTab, expectedPanel = state.panel;
	const mounted = mountNativeBigPictureDetails(state.root, {
		tab: state.activeTab,
		shortcut: state.shortcut,
		data: state.data,
		hydrating: state.pendingResources > 0,
		document: doc,
		generation: state.generation,
		panel: state.panel,
		onRuntimeInvalidated: () => {
			if (!isLiveDetailState(doc, state)) return;
			disposeBigPictureModals(doc);
			restoreNativePanelChildren(state.panel, state.root);
			restoreBigPictureNonSteamNotices(doc);
			state.root.hidden = true;
			scheduleDetailRetry(doc);
		},
		onCommitted: () => {
			if (!isLiveDetailState(doc, state) || state.activeTab !== expectedTab || state.panel !== expectedPanel) return;
			commitNativePanelRoot(expectedPanel, state.root);
			hideBigPictureNonSteamNotices(doc);
			reportDetailMount(doc, `committed shortcut=${state.shortcut.id} metadata=${state.shortcut.steamAppId} tab=${expectedTab}`);
		},
	});
	if (!mounted) {
		state.root.hidden = true;
		restoreNativePanelChildren(state.panel);
		restoreBigPictureNonSteamNotices(doc);
		reportDetailMount(doc, 'React/renderer unavailable; preserving Steam panel and retrying');
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
	const pending = detailPendingPatches.get(state) || {};
	const pendingValue = Object.prototype.hasOwnProperty.call(pending, key) ? (pending as any)[key] : state.data[key];
	if (value == null && pendingValue != null) return;
	(pending as any)[key] = value;
	detailPendingPatches.set(state, pending);
	if (detailPatchTimers.has(state)) return;
	const timer = setTimeout(() => {
		detailPatchTimers.delete(state);
		const patch = detailPendingPatches.get(state);
		detailPendingPatches.delete(state);
		if (!patch || !isLiveDetailState(doc, state)) return;
		state.data = { ...state.data, ...patch };
		renderNativeRoot(doc, state);
	}, 16);
	detailPatchTimers.set(state, timer);
}

function startDetailHydration(doc: Document, state: BigPictureDetailState): void {
	if (state.hydrationStarted) return;
	state.hydrationStarted = true;
	state.pendingResources = 6;
	renderNativeRoot(doc, state);
	const applyResource = <K extends keyof BigPictureDetailData>(key: K, request: Promise<BigPictureDetailData[K]>): void => {
		void request.then(value => applyDetailPatch(doc, state, key, value)).catch(error => {
			backendLog(`[NGL][Gamepad] ${String(key)} hydration failed: ${String(error)}`);
		}).finally(() => {
			if (!isLiveDetailState(doc, state)) return;
			state.pendingResources = Math.max(0, state.pendingResources - 1);
			if (state.pendingResources === 0) renderNativeRoot(doc, state);
		});
	};

	applyResource('game', getGameData(state.shortcut.steamAppId, state.language).then(game => {
		backendLog(`Big Picture linked core populated for "${state.shortcut.title}" (${state.shortcut.steamAppId})`);
		return game || state.data.game || null;
	}));
	applyResource('achievements', fetchLocalAchievementData(state.shortcut.steamAppId, {
		stateAppId: String(state.shortcut.id),
		maxAgeMs: 1250,
	}).then(data => {
		if (!isLiveDetailState(doc, state) || !data || String(data.metadata_appid || data.appid) !== state.shortcut.steamAppId) return null;
		cacheLocalAchievements(data, state.shortcut.steamAppId, String(state.shortcut.id));
		return data;
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
	if (detectCurrentMappedShortcut(doc)) {
		ensureControllerSync(doc);
	}
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
	if (preferredTab) {
		preferredDetailTabs.set(doc, { tab: preferredTab, until: Date.now() + 700 });
		if (state) state.activeTab = preferredTab;
	}
	const pending = detailTabSyncTimers.get(doc);
	if (pending) clearTimeout(pending);
	const timer = setTimeout(() => {
		detailTabSyncTimers.delete(doc);
		if (doc.body?.isConnected) void refreshBigPictureShortcutDetails(doc);
	}, 40);
	detailTabSyncTimers.set(doc, timer);
}

function bindTabs(doc: Document, strip: HTMLElement, controls: Map<BigPictureTab, HTMLElement>): void {
	const current = detailTabObservers.get(doc);
	if (current?.strip === strip && current.controls.size === controls.size
		&& [...controls].every(([tab, control]) => current.controls.get(tab) === control)) return;
	current?.dispose();
	const prior = new Map<HTMLElement, string | undefined>();
	for (const [tab, control] of controls) { prior.set(control, control.dataset.gdlBpTab); control.dataset.gdlBpTab = tab; }
	const input = (event: Event) => {
		if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return;
		for (const [tab, control] of controls) if (event.target === control || control.contains(event.target as Node)) {
			scheduleTabSync(doc, tab); return;
		}
	};
	strip.addEventListener('click', input);
	strip.addEventListener('keydown', input);
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
		attributeFilter: ['aria-selected', 'aria-current'],
	});
	const dispose = () => {
		observer.disconnect(); strip.removeEventListener('click', input); strip.removeEventListener('keydown', input);
		for (const [tab, control] of controls) if (control.dataset.gdlBpTab === tab) {
			const original = prior.get(control);
			if (original === undefined) delete control.dataset.gdlBpTab; else control.dataset.gdlBpTab = original;
		}
		if (detailTabObservers.get(doc)?.dispose === dispose) detailTabObservers.delete(doc);
	};
	detailTabObservers.set(doc, { strip, controls: new Map(controls), observer, dispose });
}

function retireLegacyDetailShell(doc: Document): void {
	for (const stale of Array.from(doc.querySelectorAll('#gdl-bp-detail-shell, #gdl-bp-native-strip-placeholder'))) stale.remove();
}

function removeBigPictureDetailsNodes(doc: Document, keepControllerStat = false): void {
	disposeBigPicturePlaybarMetadata(doc);
	disposeBigPictureModals(doc);
	achievementSyncCleanups.get(doc)?.();
	detailTabObservers.get(doc)?.dispose();
	deactivateNativeGameInfoBridge(doc);
		const state = detailStates.get(doc);
	if (state) {
		detailStates.delete(doc);
		nextDetailGeneration(doc);
		restoreNativePanelChildren(state.panel);
		const patchTimer = detailPatchTimers.get(state);
		if (patchTimer) clearTimeout(patchTimer);
		detailPatchTimers.delete(state);
		detailPendingPatches.delete(state);
		unmountNativeBigPictureDetails(state.root);
		restoreBigPictureAchievementProjections(state.shortcut.id, doc);
		detailStates.delete(doc);
	}
	restoreAllNativePanelChildren(doc);
	nextDetailGeneration(doc);
	for (const element of Array.from(doc.querySelectorAll('#gdl-bp-detail-root, #gdl-bp-detail-shell, #gdl-bp-native-strip-placeholder, #gdl-bp-focus-ring-root, #gdl-bp-focus-ring, #gdl-playbar-achievements, [data-gdl-playbar-achievements="1"]'))) element.remove();
	removeBigPictureFallbackPanel(doc);
	removeCloudDivider(doc);
	if (!keepControllerStat) removePlaybarControllerStat(doc, true);
	restoreBigPictureNonSteamNotices(doc);
}

function isLibraryOrNonDetailsView(doc: Document): boolean {
	if (!steamUIModeService.isGamepadUI(doc) && (doc.title?.includes('SP Desktop') || doc.body.classList.contains('DesktopUI') || doc.querySelector('.DesktopUI'))) {
		return true;
	}
	if (findBigPictureTabStrip(doc)) {
		return false;
	}
	const routeValues = collectActiveRouteValues(doc);
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (hasAppRoute) {
		return false;
	}
	const hasPlayBar = Boolean(doc.querySelector('[class*="PlayBar"], [class*="PlayButton"], [class*="playButton"], [class*="AppDetailsHeader"], [class*="appDetailsHeader"]'));
	if (hasPlayBar) {
		return false;
	}
	if (doc.querySelector('[class*="AllGames"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return true;
	}
	const hasLibraryRoute = routeValues.some(v => NON_DETAILS_ROUTE_PATTERN.test(v));
	if (hasLibraryRoute && !hasAppRoute) {
		return true;
	}
	if (!hasPlayBar && !hasAppRoute) {
		return true;
	}
	return false;
}

export async function refreshBigPictureShortcutDetails(doc: Document): Promise<void> {
	if (!doc.body) return;
	if (isLibraryOrNonDetailsView(doc)) {
		detailMountReports.delete(doc);
		removeBigPictureDetailsNodes(doc);
		return;
	}
	const context = resolveActiveGameContext(doc);
	if (context.type === 'steam') {
		detailMountReports.delete(doc);
		detailContextGapSince.delete(doc);
		const retryTimer = detailRetryTimers.get(doc);
		if (retryTimer) { clearTimeout(retryTimer); detailRetryTimers.delete(doc); }
		removeBigPictureDetailsNodes(doc);
		return;
	}
	if (context.type !== 'shortcut-linked' || !context.identity
		|| !isCurrentLinkedGamepadTarget(doc, context.identity.shortcutAppId, context.identity.steamAppId)) {
		reportDetailMount(doc, `waiting for exact linked route; context=${context.type}; ${describeLinkedGamepadTarget(doc, context.identity?.shortcutAppId, context.identity?.steamAppId)}`);
		const liveState = detailStates.get(doc);
		const canBeTransientGap = Boolean(
			liveState?.root.isConnected
			&& liveState.panel.isConnected
			&& findBigPictureTabStrip(doc)
			&& !isLibraryOrNonDetailsView(doc)
		);
		if (canBeTransientGap) {
			const startedAt = detailContextGapSince.get(doc) || Date.now();
			detailContextGapSince.set(doc, startedAt);
			if (Date.now() - startedAt < 700) {
				scheduleDetailRetry(doc);
				return;
			}
		}
		detailContextGapSince.delete(doc);
		removeBigPictureDetailsNodes(doc);
		return;
	}
	detailContextGapSince.delete(doc);
	retireLegacyDetailShell(doc);
	const shortcut = detectCurrentMappedShortcut(doc);
	if (!shortcut) {
		backendLog('Big Picture details: no mapped shortcut detected for current view');
		removeBigPictureDetailsNodes(doc);
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
		reportDetailMount(doc, 'native tab strip not ready; retrying');
		if (isLibraryOrNonDetailsView(doc)) {
			removeBigPictureDetailsNodes(doc);
		} else {
			scheduleDetailRetry(doc);
		}
		return;
	}
	const preferred = preferredDetailTabs.get(doc);
	const detectedTab = activeTabFromNative(doc, tabs.controls);
	const preferredTab = preferred && preferred.until >= Date.now() ? preferred.tab : null;
	if (preferred && (preferred.until < Date.now() || detectedTab === preferred.tab)) preferredDetailTabs.delete(doc);
	const nativeTab = preferredTab || detectedTab || state?.activeTab || 'activity';
	const nodes = ensureNativePanelRoot(doc, tabs, nativeTab);
	if (!nodes) {
		reportDetailMount(doc, 'native content panel not ready; retrying');
		scheduleDetailRetry(doc);
		return;
	}
	detailRetryCounts.delete(doc);
	nodes.root.dataset.gdlSteamAppId = shortcut.steamAppId;
	nodes.root.dataset.gdlShortcutAppId = String(shortcut.id);

	ensureAchievementSync(doc);
	ensureControllerSync(doc);

	if (!state || changedShortcut || state.root !== nodes.root) {
		state = {
			shortcut,
			language,
			activeTab: nativeTab,
			root: nodes.root,
			panel: nodes.panel,
			data: cachedBigPictureDetailData(shortcut, language),
			generation: nextDetailGeneration(doc),
			hydrationStarted: false,
			pendingResources: 0,
		};
		detailStates.set(doc, state);
		state.root.dataset.gdlBpGeneration = String(state.generation);
		renderNativeRoot(doc, state);
		startDetailHydration(doc, state);
	} else {
		let needsRender = !isNativeBigPictureDetailsRuntimeCurrent(state.root);
		if (state.panel !== nodes.panel) {
			state.panel = nodes.panel;
			needsRender = true;
		}
		if (state.activeTab !== nativeTab) {
			state.activeTab = nativeTab;
			needsRender = true;
		}
		if (needsRender) {
			renderNativeRoot(doc, state);
		}
	}
	bindTabs(doc, tabs.strip, tabs.controls);
	syncBigPicturePlaybarMetadata(doc, shortcut);
}

export function disposeBigPictureShortcutDetails(doc: Document | null): void {
	if (!doc) return;
	const controllerRetry = docControllerRetryTimers.get(doc);
	if (controllerRetry) clearTimeout(controllerRetry);
	docControllerRetryTimers.delete(doc);
	docControllerCleanups.get(doc)?.();
	docControllerCleanups.delete(doc);

	activeControllerDocs.delete(doc);
	const retryTimer = detailRetryTimers.get(doc);
	if (retryTimer) clearTimeout(retryTimer);
	detailRetryTimers.delete(doc);
	const tabTimer = detailTabSyncTimers.get(doc);
	if (tabTimer) clearTimeout(tabTimer);
	detailTabSyncTimers.delete(doc);
	detailRetryCounts.delete(doc);
	preferredDetailTabs.delete(doc);
	detailContextGapSince.delete(doc);
	detailTabObservers.get(doc)?.dispose();
	removeBigPictureDetailsNodes(doc);
}
