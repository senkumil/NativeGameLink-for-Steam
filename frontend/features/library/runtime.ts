import type { CommunityContentItem, FriendCategories, NewsItem, SteamGameData } from '../../domain/types';
import { backendLog, neutralizeSteamAppIdFileBackend } from '../../api/backend';
import { getCachedGameData, getGameData, gameDataCache, gameDataLanguageKey } from '../../core/game-data';
import { isMappingSnapshotVerified, mappings, loadMappings, saveMappingChecked, shortcutMappingKey } from '../../core/mappings';
import { perfMark, perfMeasure } from '../../core/perf';
import { steamLanguageSync } from '../../steam/localization';
import { installSteamNavigation, disposeSteamNavigation } from '../../steam/navigation';
import { findActiveShortcutAppId, findShortcutAppIdByName, findShortcutAppIdsByName, getShortcutAppById, getSteamAppStore, looseMatchTitle } from '../../steam/shortcuts';
import { normalizeTitle } from '../../core/text';
import { GDL_INJECTED } from './constants';
import { getCachedCommunityContent, getCachedNews } from './news';
import { ensureNativeGameChrome, getCurrentNativeGameInfo, removeNativeGameChrome } from './native-chrome';
import { getCachedFriendData } from './social';
import { disposeActivityFeedInteractions } from './social/feed';
import { disposeStatusPostBox } from './social/status';
import { disposeCommunitySection } from './community-view';
import { disposeResponsiveTradingCardGrids, disposeTradingCardPreview } from './trading-cards';
import { renderLinkedGamePage } from './renderer';
import { finalizeLinkedAchievements } from './achievement-chrome';
import { cacheLocalAchievements, hasCachedLocalAchievements } from '../achievements/runtime';
import { fetchLocalAchievementData } from '../achievements/service';
import { findMappingForShortcut, hasNoLauncherOption, isShortcutDismissed, mergeNoLauncherOption, normalizedShortcutAppId, removeIncompatibleLauncherBypass, shouldAutoApplyNoLauncher, syncLinkedGameNote } from '../shortcuts/runtime';
import { injectPlaytimeFallbackStats, removePlaytimeFallbackStats } from '../playtime/tracker';
import { findNonSteamNotice } from './notice';
import { restoreNativeLibraryStyles } from './layout';
import { LibraryNavigationController } from './navigation-controller';
import { isPublicSteamLibraryRoute, reconcileLibraryNavigation } from './native-route';
import { ensureManualLinkNoticeButton, removeManualLinkNoticeButton } from './manual-link-button';
import { beginLibraryRouteExit, finishLibraryRouteExit, hasOwnedLibraryChrome, isLibraryRouteExitPending, removeOwnedLibraryChrome } from './route-exit';
import { cancelLinkedShortcutLoading, completeLinkedShortcutLoading, LINKED_LOADING_SIDEBAR_ID, stageLinkedShortcutLoading } from './loading-stage';
import { hydrateLinkedRouteResources } from './hydration';
import { reprioritizeLinkedGame } from './prefetch';
import { prioritizeShortcutLinkingAndArtwork } from './artwork-sync';
import { tryRedirectUnownedMappedGame } from './sidebar-cleanup';
export { findNonSteamNotice, hideNoticeQuick } from './notice';
export interface LibraryRuntimeHost {
	getMainWindowDoc: () => Document | null;
}
let configuredLibraryRuntimeHost: LibraryRuntimeHost | null = null, currentInjectedDocument: Document | null = null;
let currentInjectedAppId: string | null = null, currentInjectedShortcutAppId: string | null = null, injectionGeneration = 0;
let injectionInFlight: { doc: Document; steamAppId: string; generation: number } | null = null;
const navigationController = new LibraryNavigationController();
const linkedRenderRetryState = new WeakMap<Document, { generation: number; attempts: number }>(), routeMismatchRetryState = new WeakMap<Document, { generation: number; attempts: number }>();
const reconciledLaunchOptions = new Set<number>();
const MAX_LINKED_RENDER_RETRIES = 12;
function isCurrentNavigation(doc: Document, generation: number): boolean {
	return isUsableLibraryDocument(doc) && navigationController.isCurrent(doc, generation);
}
function isUsableLibraryDocument(doc: Document | null | undefined): doc is Document {
	try { return Boolean(doc?.body && doc.documentElement?.isConnected && doc.defaultView && !doc.defaultView.closed); } catch { return false; }
}
export function configureLibraryRuntimeHost(host: LibraryRuntimeHost): void { configuredLibraryRuntimeHost = host; }
function libraryRuntimeHost(): LibraryRuntimeHost {
	if (!configuredLibraryRuntimeHost) throw new Error('library_runtime_host_not_configured');
	return configuredLibraryRuntimeHost;
}
function setCurrentInjection(doc: Document, steamAppId: string, shortcutAppId: string | null): number {
	if (currentInjectedDocument !== doc || currentInjectedAppId !== steamAppId || currentInjectedShortcutAppId !== shortcutAppId) injectionGeneration += 1;
	currentInjectedDocument = doc; currentInjectedAppId = steamAppId; currentInjectedShortcutAppId = shortcutAppId;
	return injectionGeneration;
}
function clearCurrentInjection(doc?: Document | null): void {
	if (doc && currentInjectedDocument !== doc) return;
	injectionGeneration += 1;
	if (!doc || injectionInFlight?.doc === doc) injectionInFlight = null;
	currentInjectedDocument = null; currentInjectedAppId = null; currentInjectedShortcutAppId = null;
}
function isCurrentRender(doc: Document, appId: string, generation: number): boolean {
	return currentInjectedDocument === doc && currentInjectedAppId === appId && injectionGeneration === generation;
}
export function refreshLibraryArtwork(_appId?: number): void {
	const doc = libraryRuntimeHost().getMainWindowDoc();
	if (isUsableLibraryDocument(doc)) void tryInjectLibraryData(doc).catch(() => {});
}

function renderLinkedPage(
	doc: Document, notice: Element, data: SteamGameData, steamAppId: string,
	newsItems: NewsItem[], friendResult: FriendCategories | null | undefined,
	communityItems: CommunityContentItem[] | undefined, generation: number,
): boolean {
	const rendered = renderLinkedGamePage(doc, notice, data, steamAppId, newsItems, friendResult, communityItems, {
		shortcutAppId: currentInjectedShortcutAppId,
		isCurrent: () => isCurrentRender(doc, steamAppId, generation),
	});
	if (rendered) {
		completeLinkedShortcutLoading(doc);
		linkedRenderRetryState.delete(doc);
	}
	return rendered;
}

/** Remove GDL desktop-Library UI and restore Steam's original shortcut notice. */
export function cleanupInjection(doc: Document, preserveLinkBar = false): void {
	cancelLinkedShortcutLoading(doc);
	linkedRenderRetryState.delete(doc); routeMismatchRetryState.delete(doc);
	navigationController.cancelCleanup(doc); finishLibraryRouteExit(doc);
	removeNativeGameChrome(doc, true); removePlaytimeFallbackStats(doc);
	disposeStatusPostBox(doc); disposeActivityFeedInteractions(doc);
	disposeTradingCardPreview(doc); disposeResponsiveTradingCardGrids(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	for (const id of ['gdl-main-content-stack', GDL_INJECTED, 'gdl-skeleton', 'gdl-controller-section', 'gdl-friends-section', 'gdl-achievements-section', 'gdl-trading-cards-section', 'gdl-dlc-section', 'gdl-workshop-section', 'gdl-playbar-achievements', 'gdl-link-bar', 'gdl-community-content', 'gdl-activity-feed', 'gdl-historical-info-section', 'gdl-external-achievements-section', 'gdl-manual-link-notice-button-row', LINKED_LOADING_SIDEBAR_ID]) {
		if (preserveLinkBar && id === 'gdl-link-bar') continue;
		doc.getElementById(id)?.remove();
	}
	removeManualLinkNoticeButton(doc); restoreNativeLibraryStyles(doc);
	doc.querySelectorAll('[data-gdl-hidden]').forEach(element => element.removeAttribute('data-gdl-hidden'));
}

function cleanupOwnedLibraryChromeAfterRouteExit(doc: Document): void {
	cancelLinkedShortcutLoading(doc); finishLibraryRouteExit(doc);
	disposeStatusPostBox(doc); disposeActivityFeedInteractions(doc);
	disposeTradingCardPreview(doc); disposeResponsiveTradingCardGrids(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	removeNativeGameChrome(doc, true); removeOwnedLibraryChrome(doc);
}

function retireLinkedRouteFromNativePage(doc: Document, generation: number): void {
	if (currentInjectedDocument === doc) clearCurrentInjection(doc);
	cancelLinkedShortcutLoading(doc, generation);
	restoreNativeLibraryStyles(doc);
	doc.getElementById('gdl-game-info-panel')?.remove(); doc.getElementById('gdl-link-bar')?.remove(); removeNativeGameChrome(doc, true);
	if (!hasOwnedLibraryChrome(doc) && !isLibraryRouteExitPending(doc)) return;
	beginLibraryRouteExit(doc, generation);
	cleanupOwnedLibraryChromeAfterRouteExit(doc);
}
export function handleLibraryNavigation(doc: Document): void {
	const generation = navigationController.advance(doc);
	linkedRenderRetryState.delete(doc);
	const hadCurrentInjection = currentInjectedDocument === doc, hadOwnedChrome = hasOwnedLibraryChrome(doc);
	doc.getElementById('gdl-game-info-panel')?.remove();
	if (isPublicSteamLibraryRoute(doc)) {
		doc.getElementById('gdl-link-bar')?.remove(); doc.getElementById('gdl-game-info-panel')?.remove(); removeNativeGameChrome(doc, true);
		if (hadCurrentInjection) clearCurrentInjection(doc);
		if (hadCurrentInjection || hadOwnedChrome) {
			restoreNativeLibraryStyles(doc);
			scheduleNavigationCleanup(doc, generation);
		}
		return;
	}
	// Reconcile against the previous session before clearing it. This preserves
	// an already-rendered game across harmless query/hash mutations.
	reconcileLibraryNavigation(doc, {
		currentInjectedAppId,
		currentInjectedShortcutAppId,
		clearCurrentInjection,
		scheduleCleanup: () => scheduleNavigationCleanup(doc, generation),
	});
	const sameLinkedSession = hadCurrentInjection && currentInjectedDocument === doc;
	if (isUsableLibraryDocument(doc) && (hadCurrentInjection || hadOwnedChrome) && !sameLinkedSession) {
		clearCurrentInjection(doc);
		restoreNativeLibraryStyles(doc);
		scheduleNavigationCleanup(doc, generation);
	}
}
function scheduleNavigationRetry(doc: Document, generation: number, delayMs: number): void {
	navigationController.scheduleRetry(doc, generation, delayMs, () => {
		if (isUsableLibraryDocument(doc)) void tryInjectLibraryData(doc).catch(() => {});
	});
}

/** Recover when Steam publishes the shortcut notice before its two-column
 * details layout. Retries are route-scoped and bounded to avoid idle polling. */
function scheduleLinkedRenderRetry(doc: Document, generation: number): void {
	const previous = linkedRenderRetryState.get(doc);
	const attempts = previous?.generation === generation ? previous.attempts + 1 : 1;
	linkedRenderRetryState.set(doc, { generation, attempts });
	if (attempts > MAX_LINKED_RENDER_RETRIES) {
		backendLog(`Library layout did not settle after ${MAX_LINKED_RENDER_RETRIES} retries`);
		return;
	}
	const delayMs = Math.min(90 + ((attempts - 1) * 70), 650);
	scheduleNavigationRetry(doc, generation, delayMs);
}

function scheduleNavigationCleanup(doc: Document, generation = navigationController.current(doc)): void {
	if (!hasOwnedLibraryChrome(doc) && !isLibraryRouteExitPending(doc)) return;
	if (isLibraryRouteExitPending(doc, generation)) return;
	beginLibraryRouteExit(doc, generation);
	// Stop playbar/info observers immediately; otherwise their closure can
	// recreate chrome from the previous game during Steam's route commit.
	removeNativeGameChrome(doc, true);
	navigationController.scheduleCleanup(doc, generation, 350, () => {
		if (!isCurrentNavigation(doc, generation) || !isLibraryRouteExitPending(doc, generation)) return;
		cleanupOwnedLibraryChromeAfterRouteExit(doc);
		if (findNonSteamNotice(doc)) {
			void tryInjectLibraryData(doc).catch(error => backendLog('Library recovery failed: ' + String(error)));
		}
	});
}

async function warmLocalAchievements(steamAppId: string, shortcutAppId: string | null): Promise<void> {
	if (hasCachedLocalAchievements(steamAppId)) return;
	const data = await fetchLocalAchievementData(steamAppId, { stateAppId: shortcutAppId });
	if (data?.found && Array.isArray(data.achievements) && data.total > 0) cacheLocalAchievements(data, steamAppId, shortcutAppId);
}

function finalizeAchievements(doc: Document, steamAppId: string, fallbackTotal: number, generation = injectionGeneration): void {
	void finalizeLinkedAchievements(doc, {
		steamAppId, fallbackTotal, stateAppId: currentInjectedShortcutAppId || undefined,
		isCurrent: () => isCurrentRender(doc, steamAppId, generation),
	}).catch(error => backendLog('Achievements error: ' + String(error)));
}

export async function tryInjectLibraryData(doc: Document): Promise<void> {
	if (!isUsableLibraryDocument(doc)) return;
	const navigationGeneration = navigationController.current(doc);
	const activeLibraryDoc = configuredLibraryRuntimeHost?.getMainWindowDoc() || null;
	if (isUsableLibraryDocument(activeLibraryDoc) && activeLibraryDoc !== doc) return;
	if (currentInjectedDocument && currentInjectedDocument !== doc
		&& (!isUsableLibraryDocument(currentInjectedDocument) || configuredLibraryRuntimeHost?.getMainWindowDoc() === doc)) {
		const previousDoc = currentInjectedDocument;
		clearCurrentInjection();
		if (isUsableLibraryDocument(previousDoc)) cleanupInjection(previousDoc);
	}
	// Strict ownership boundary: on a native game route NativeGameLink performs no
	// page synchronization or injection. If a linked shortcut was visible just
	// before it, only retire NativeGameLink-owned remnants from that previous route.
	if (isPublicSteamLibraryRoute(doc)) {
		if (tryRedirectUnownedMappedGame(doc)) return;
		retireLinkedRouteFromNativePage(doc, navigationGeneration);
		return;
	}
	const noticeInfo = findNonSteamNotice(doc);
	if (!noticeInfo) {
		// Absence of the notice is transient while Steam hydrates a native feed.
		// Only an already-confirmed route exit may renew the quiet-period timer;
		// ordinary native mutations must not become synthetic navigations.
		if (isLibraryRouteExitPending(doc)) scheduleNavigationCleanup(doc, navigationGeneration);
		return;
	}
	if (isLibraryRouteExitPending(doc)) {
		if (findActiveShortcutAppId(doc, noticeInfo.title)) cleanupOwnedLibraryChromeAfterRouteExit(doc);
		else { scheduleNavigationCleanup(doc, navigationGeneration); return; }
	}
	installSteamNavigation(doc);
	navigationController.cancelCleanup(doc);
	const notice = noticeInfo.element;
	const gameTitle = noticeInfo.title;
	if (!isMappingSnapshotVerified()) {
		await loadMappings().catch(() => {});
	}
	if (!isCurrentNavigation(doc, navigationGeneration)) {
		cancelLinkedShortcutLoading(doc, navigationGeneration);
		return;
	}
	if (!notice.isConnected || !doc.body.contains(notice)) {
		cancelLinkedShortcutLoading(doc, navigationGeneration);
		scheduleNavigationRetry(doc, navigationGeneration, 80);
		return;
	}
	const routedShortcutAppId = findActiveShortcutAppId(doc, gameTitle);
	const routedApp = routedShortcutAppId ? getShortcutAppById(Number(routedShortcutAppId)) : null;
	const routedTitle = String(routedApp?.display_name || routedApp?.m_strDisplayName || '').trim();
	const routeMatchesGameTitle = Boolean(routedTitle && (looseMatchTitle(routedTitle, gameTitle) || normalizeTitle(routedTitle) === normalizeTitle(gameTitle)));
	const shortcutByName = findShortcutAppIdByName(gameTitle);
	const titleMatchedShortcutAppId = shortcutByName ? String(shortcutByName) : null;
	const allTitleIds = findShortcutAppIdsByName(gameTitle);
	const routeBelongsToGame = Boolean(
		routeMatchesGameTitle
		|| (routedShortcutAppId && allTitleIds.includes(Number(routedShortcutAppId)))
		|| (!routedTitle && routedShortcutAppId)
	);

	// Steam commits the visible notice and route URL in separate React turns.
	// Only cancel and retry if the route definitely belongs to a different game.
	const mismatchState = routeMismatchRetryState.get(doc);
	const mismatchAttempts = mismatchState?.generation === navigationGeneration ? mismatchState.attempts + 1 : 1;
	if (routedShortcutAppId && titleMatchedShortcutAppId
		&& routedShortcutAppId !== titleMatchedShortcutAppId
		&& !routeBelongsToGame) {
		if (mismatchAttempts <= 3) {
			routeMismatchRetryState.set(doc, { generation: navigationGeneration, attempts: mismatchAttempts });
			if (currentInjectedDocument === doc) clearCurrentInjection(doc);
			restoreNativeLibraryStyles(doc);
			if (hasOwnedLibraryChrome(doc)) scheduleNavigationCleanup(doc, navigationGeneration);
			cancelLinkedShortcutLoading(doc, navigationGeneration);
			scheduleNavigationRetry(doc, navigationGeneration, 80);
			return;
		}
		// Route URL remained stale after 3 retries (common when returning from Big Picture);
		// trust the visible DOM notice and proceed with the title-matched shortcut!
		routeMismatchRetryState.delete(doc);
	} else {
		routeMismatchRetryState.delete(doc);
	}
	const activeShortcutAppId = (routeBelongsToGame && routedShortcutAppId) || titleMatchedShortcutAppId || routedShortcutAppId || (shortcutByName ? String(shortcutByName) : null);
	const normalizedActiveShortcutId = normalizedShortcutAppId(activeShortcutAppId);
	const activeShortcutDismissed = Boolean(normalizedActiveShortcutId && isShortcutDismissed(normalizedActiveShortcutId));
	const activeMapping = activeShortcutDismissed ? null : findMappingForShortcut(activeShortcutAppId, gameTitle);
	const steamAppId = activeMapping;
	const resolvedShortcutAppId = activeShortcutAppId;
	if (!steamAppId || !/^\d+$/.test(steamAppId)) {
		cancelLinkedShortcutLoading(doc, navigationGeneration);
		const appStore = getSteamAppStore();
		const appStoreReady = Boolean(appStore?.m_mapApps && appStore.m_mapApps.size > 0);
		if (!appStoreReady) {
			scheduleNavigationRetry(doc, navigationGeneration, 280);
		}
		let visibleShortcutId = normalizedShortcutAppId(activeShortcutAppId) || findShortcutAppIdByName(gameTitle);
		if (!visibleShortcutId) {
			let hash = 0;
			for (let i = 0; i < gameTitle.length; i++) hash = (hash * 31 + gameTitle.charCodeAt(i)) >>> 0;
			visibleShortcutId = 2147483648 + (hash % 1000000000);
		}
		prioritizeShortcutLinkingAndArtwork(Number(visibleShortcutId), '', gameTitle);
		void injectPlaytimeFallbackStats(doc, visibleShortcutId, gameTitle, undefined,
			() => isUsableLibraryDocument(doc) && !doc.getElementById(GDL_INJECTED) && (isShortcutDismissed(visibleShortcutId) || !findMappingForShortcut(String(visibleShortcutId), gameTitle)));
		if (currentInjectedDocument === doc) clearCurrentInjection(doc);
		cleanupInjection(doc);
		ensureManualLinkNoticeButton(doc, notice, String(visibleShortcutId), gameTitle, () => findNonSteamNotice(doc));
		return;
	}
	reprioritizeLinkedGame(steamAppId);
	if (activeShortcutAppId) prioritizeShortcutLinkingAndArtwork(Number(activeShortcutAppId), steamAppId, gameTitle);

	stageLinkedShortcutLoading(doc, notice, navigationGeneration);

	if (activeShortcutAppId && !mappings[shortcutMappingKey(activeShortcutAppId)]) {
		const activeKey = shortcutMappingKey(activeShortcutAppId);
		mappings[activeKey] = steamAppId;
		void saveMappingChecked(activeKey, steamAppId);
		backendLog(`Recovered mapping for active shortcut ${activeShortcutAppId}`);
	}

	if (activeShortcutAppId && steamAppId) {
		const app = getShortcutAppById(Number(activeShortcutAppId));
		const shortcutExe = String(app?.strShortcutExe || app?.m_strShortcutExe || app?.shortcut_exe || app?.strExePath || '').trim();
		const shortcutStartDir = String(app?.strShortcutStartDir || app?.m_strShortcutStartDir || app?.shortcut_start_dir || app?.strStartDir || '').trim();
		if (shortcutExe || shortcutStartDir) {
			void neutralizeSteamAppIdFileBackend({
				request_json: JSON.stringify({ exe_path: shortcutExe, start_dir: shortcutStartDir }),
			}).catch(() => {});
		}
		const activeIdNum = Number(activeShortcutAppId), apps = (window as any).SteamClient?.Apps;
		if (typeof apps?.SetShortcutLaunchOptions === 'function' && !reconciledLaunchOptions.has(activeIdNum)) {
			reconciledLaunchOptions.add(activeIdNum);
			const currentOptions = String(app?.strShortcutLaunchOptions || app?.m_strShortcutLaunchOptions || app?.shortcut_launch_options || app?.strArguments || '').trim();
			if (shouldAutoApplyNoLauncher(steamAppId)) {
				if (!hasNoLauncherOption(currentOptions)) {
					const updated = mergeNoLauncherOption(currentOptions, steamAppId);
					void apps.SetShortcutLaunchOptions(activeIdNum, updated);
					backendLog(`Auto-reconciled launcher bypass on view for "${gameTitle}" (${activeShortcutAppId}): "${updated}"`);
				}
			} else if (hasNoLauncherOption(currentOptions)) {
				const cleaned = removeIncompatibleLauncherBypass(currentOptions, steamAppId);
				void apps.SetShortcutLaunchOptions(activeIdNum, cleaned);
				backendLog(`Cleaned incompatible launcher bypass on view for "${gameTitle}" (${activeShortcutAppId}): "${cleaned}"`);
			}
		}
	}

	const existing = doc.getElementById(GDL_INJECTED) as HTMLElement | null;
	const mountedShortcutAppId = existing?.dataset.gdlShortcutAppId
		|| (currentInjectedDocument === doc && currentInjectedAppId === steamAppId ? currentInjectedShortcutAppId : null);
	const shortcutIdentityChanged = Boolean(mountedShortcutAppId && resolvedShortcutAppId && mountedShortcutAppId !== resolvedShortcutAppId);
	if (existing && existing.dataset.gdlLayoutComplete === '1' && doc.getElementById('gdl-link-bar')
		&& !shortcutIdentityChanged && existing.dataset.gdlSteamAppId === steamAppId) {
		const generation = setCurrentInjection(doc, steamAppId, resolvedShortcutAppId);
		existing.dataset.gdlSteamAppId = steamAppId;
		if (resolvedShortcutAppId) existing.dataset.gdlShortcutAppId = resolvedShortcutAppId;
		const nativeInfo = getCurrentNativeGameInfo();
		if (nativeInfo?.key === steamAppId) ensureNativeGameChrome(doc, nativeInfo);
		if (!doc.getElementById('gdl-playbar-achievements')) {
			const language = steamLanguageSync() || 'english';
			finalizeAchievements(doc, steamAppId, gameDataCache[gameDataLanguageKey(steamAppId, language)]?.achievements?.total || 0, generation);
		}
		const numId = Number(resolvedShortcutAppId || 0);
		if (numId >= 2147483648) void injectPlaytimeFallbackStats(doc, numId, gameTitle, steamAppId, () => isCurrentRender(doc, steamAppId, generation));
		const language = String(steamLanguageSync() || 'english').toLowerCase();
		const cachedData = getCachedGameData(steamAppId, language)?.data || null;
		if (cachedData) hydrateLinkedRouteResources(doc, steamAppId, resolvedShortcutAppId, language, () => isCurrentRender(doc, steamAppId, generation), cachedData);
		return;
	}

	if (existing) {
		clearCurrentInjection(doc);
		cleanupInjection(doc);
	}
	if (currentInjectedDocument && currentInjectedDocument !== doc) {
		const previousDoc = currentInjectedDocument;
		clearCurrentInjection(previousDoc);
		if (isUsableLibraryDocument(previousDoc)) cleanupInjection(previousDoc);
	} else if (currentInjectedDocument === doc && ((currentInjectedAppId && currentInjectedAppId !== steamAppId) || shortcutIdentityChanged)) {
		clearCurrentInjection(doc);
		cleanupInjection(doc);
	}
	const generation = setCurrentInjection(doc, steamAppId, resolvedShortcutAppId);
	removeManualLinkNoticeButton(doc);
	perfMark('game-select-' + steamAppId);
	backendLog(`Library page: "${gameTitle}" -> injecting data for ${steamAppId}`);

	const numShortcutId = Number(resolvedShortcutAppId || 0);
	if (numShortcutId >= 2147483648) {
		void injectPlaytimeFallbackStats(doc, numShortcutId, gameTitle, steamAppId,
			() => isCurrentRender(doc, steamAppId, generation));
	}

	const language = String(steamLanguageSync() || 'english').toLowerCase();
	const cachedData = getCachedGameData(steamAppId, language)?.data || null;
	let cachedNews = getCachedNews(steamAppId, language, cachedData)?.data || [];
	const cachedFriends = getCachedFriendData(steamAppId)?.data || null;
	const cachedCommunity = getCachedCommunityContent(steamAppId, language)?.data || [];
	let renderedFromCache = false;
	if (cachedData) {
		renderedFromCache = renderLinkedPage(doc, notice, cachedData, steamAppId, cachedNews, cachedFriends, cachedCommunity, generation);
		if (renderedFromCache) {
			perfMeasure('game-selection -> first-render', 'game-select-' + steamAppId);
			finalizeAchievements(doc, steamAppId, cachedData.achievements?.total || 0, generation);
		} else {
			scheduleLinkedRenderRetry(doc, navigationGeneration);
		}
	} else {
		stageLinkedShortcutLoading(doc, notice, navigationGeneration);
	}

	if (injectionInFlight?.doc === doc && injectionInFlight.steamAppId === steamAppId && injectionInFlight.generation === generation) return;
	const flight = { doc, steamAppId, generation };
	injectionInFlight = flight;

	// Warm local achievements and finalize achievement UI in parallel with game data fetch
	void warmLocalAchievements(steamAppId, resolvedShortcutAppId)
		.then(() => {
			if (isCurrentRender(doc, steamAppId, generation)) {
				const total = gameDataCache[gameDataLanguageKey(steamAppId, language)]?.achievements?.total
					|| cachedData?.achievements?.total || 0;
				finalizeAchievements(doc, steamAppId, total, generation);
			}
		})
		.catch(() => {});

	let data: SteamGameData | null = null;
	try {
		data = await getGameData(steamAppId, language);
	} finally {
		if (injectionInFlight === flight) injectionInFlight = null;
	}

	const routeStillCurrent = isCurrentNavigation(doc, navigationGeneration) && isCurrentRender(doc, steamAppId, generation);
	if (!data || !routeStillCurrent) {
		if (!data) {
			backendLog('No refreshed game data for: ' + steamAppId);
			if (cachedData && routeStillCurrent) {
				hydrateLinkedRouteResources(doc, steamAppId, resolvedShortcutAppId, language, () => isCurrentRender(doc, steamAppId, generation), cachedData);
			}
		}
		return;
	}
	cachedNews = getCachedNews(steamAppId, language, data)?.data || cachedNews;
	void syncLinkedGameNote(gameTitle || data.name, data, steamAppId);

	if (!renderedFromCache) {
		const latestNotice = findNonSteamNotice(doc);
		if (!latestNotice || !renderLinkedPage(doc, latestNotice.element, data, steamAppId,
			cachedNews, cachedFriends, cachedCommunity, generation)) {
			if (isCurrentNavigation(doc, navigationGeneration)
				&& isCurrentRender(doc, steamAppId, generation)) {
				stageLinkedShortcutLoading(doc, notice, navigationGeneration);
				scheduleLinkedRenderRetry(doc, navigationGeneration);
			}
			return;
		}
		perfMeasure('game-selection -> first-render', 'game-select-' + steamAppId);
	}
	finalizeAchievements(doc, steamAppId, data.achievements?.total || 0, generation);
	hydrateLinkedRouteResources(doc, steamAppId, resolvedShortcutAppId, language,
		() => isCurrentRender(doc, steamAppId, generation), data);
	perfMeasure('background-revalidation', 'game-select-' + steamAppId);
}

export function getCurrentInjectedAppId(): string | null { return currentInjectedAppId; }
export function getCurrentInjectedShortcutAppId(): string | null { return currentInjectedShortcutAppId; }
export function resetLibraryInjection(reinject = false, targetDoc?: Document | null): void {
	const liveDoc = libraryRuntimeHost().getMainWindowDoc();
	const doc = isUsableLibraryDocument(liveDoc) ? liveDoc : targetDoc;
	if (!doc) { navigationController.dispose(); clearCurrentInjection(); return; }
	const generation = navigationController.advance(doc);
	if (isPublicSteamLibraryRoute(doc)) { retireLinkedRouteFromNativePage(doc, generation); return; }
	clearCurrentInjection(doc);
	cleanupInjection(doc);
	if (reinject) void tryInjectLibraryData(doc).catch(error => backendLog('Library reinjection failed: ' + error));
}
export function disposeLibraryRuntime(): void {
	const doc = currentInjectedDocument || configuredLibraryRuntimeHost?.getMainWindowDoc() || null;
	if (doc) {
		if (isPublicSteamLibraryRoute(doc)) {
			if (hasOwnedLibraryChrome(doc) || isLibraryRouteExitPending(doc)) { restoreNativeLibraryStyles(doc); cleanupOwnedLibraryChromeAfterRouteExit(doc); }
		} else cleanupInjection(doc);
		disposeSteamNavigation(doc);
	}
	navigationController.dispose();
	clearCurrentInjection();
	configuredLibraryRuntimeHost = null;
}
