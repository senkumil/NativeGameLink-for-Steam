import type { CommunityContentItem, FriendCategories, NewsItem, SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getCachedGameData, getGameData, gameDataCache, gameDataLanguageKey } from '../../core/game-data';
import { isMappingSnapshotVerified, mappings, loadMappings, saveMappingChecked, shortcutMappingKey } from '../../core/mappings';
import { perfMark, perfMeasure } from '../../core/perf';
import { NativePaintQueue, type NativePaintReadiness } from '../../core/after-native-paint';
import { cancelLibrarySidebarWork, runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { paintedNativePlaybar } from '../../steam/library-details';
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
import { disposeTradingCardUI } from './trading-cards';
import { renderLinkedGamePage } from './renderer';
import { disposeControllerSidebarWatcher } from './controller';
import { disposeLinkedSidebarOrder } from './sidebar-order';
import { finalizeLinkedAchievements, warmLocalAchievements } from './achievement-chrome';
import { disposeSharedActivityComposer, parkSharedActivityComposer } from './activity-view';
import { findMappingForShortcut, isShortcutDismissed, normalizedShortcutAppId, syncLinkedGameNote } from '../shortcuts/runtime';
import { injectPlaytimeFallbackStats, removePlaytimeFallbackStats } from '../playtime/tracker';
import { findNonSteamNotice } from './notice';
import { discoverNativeLibraryLayoutForShortcut, restoreNativeLibraryStyles } from './layout';
import { LibraryNavigationController } from './navigation-controller';
import { isPublicSteamLibraryRoute, libraryRouteIdentity, reconcileLibraryNavigation, routedSteamAppId } from './native-route';
import { ensureManualLinkNoticeButton, removeManualLinkNoticeButton } from './manual-link-button';
import { beginLibraryRouteExit, finishLibraryRouteExit, hasOwnedLibraryChrome, isLibraryRouteExitPending, removeOwnedLibraryChrome } from './route-exit';
import { cancelLinkedShortcutLoading, completeLinkedShortcutLoading, LINKED_LOADING_SIDEBAR_ID, stageLinkedShortcutLoading, warmVisibleLinkedResources, cancelLinkedFirstContentPaint, syncEarlyLinkedFirstContent } from './loading-stage';
import { hydrateLinkedRouteResources } from './hydration';
import { reprioritizeLinkedGame } from './prefetch';
import { tryRedirectUnownedMappedGame } from './sidebar-cleanup';
import { removeNativeInfoButton, resetMainScrollToTop } from './info-panel';
import { isCurrentLinkedRenderDestination, ownsCurrentLinkedPrimaryLinks } from './render-session';
export { findNonSteamNotice, hideNoticeQuick } from './notice';
export interface LibraryRuntimeHost {
	getMainWindowDoc: () => Document | null;
	prepareLinkedPage?: (doc: Document) => void;
	waitForNativeArtwork?: NativePaintReadiness;
}
let configuredLibraryRuntimeHost: LibraryRuntimeHost | null = null, currentInjectedDocument: Document | null = null;
let currentInjectedAppId: string | null = null, currentInjectedShortcutAppId: string | null = null, injectionGeneration = 0;
let injectionInFlight: { doc: Document; steamAppId: string; generation: number } | null = null;
const navigationController = new LibraryNavigationController();
const nativePaintQueue = new NativePaintQueue();
export function cancelPendingLibraryPaint(doc: Document): void { cancelLibrarySidebarWork(doc); nativePaintQueue.cancel(doc); cancelLinkedFirstContentPaint(doc); }
export function syncLinkedFirstContent(doc: Document): void { const generation = navigationController.current(doc); const preview = syncEarlyLinkedFirstContent(doc, generation, () => isCurrentNavigation(doc, generation)); if (preview?.dataset.gdlSteamAppId && preview.dataset.gdlShortcutAppId) setCurrentInjection(doc, preview.dataset.gdlSteamAppId, preview.dataset.gdlShortcutAppId); }
const linkedRenderRetryState = new WeakMap<Document, { generation: number; attempts: number }>(), routeMismatchRetryState = new WeakMap<Document, { generation: number; attempts: number }>();
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
	if (currentInjectedDocument !== doc || currentInjectedAppId !== appId || injectionGeneration !== generation
		|| !isUsableLibraryDocument(doc)) return false;
	return isCurrentLinkedRenderDestination(doc, currentInjectedShortcutAppId, appId);
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
		generation,
		isCurrent: () => isCurrentRender(doc, steamAppId, generation),
	});
	if (rendered) {
		completeLinkedShortcutLoading(doc);
		linkedRenderRetryState.delete(doc);
	}
	return rendered;
}
/** Remove GDL desktop-Library UI and restore Steam's original shortcut notice. */
export function cleanupInjection(doc: Document, preserveLinkBar = false, preserveCloudStatus = false): void {
	disposeLinkedSidebarOrder(doc); disposeControllerSidebarWatcher(doc);
	preserveLinkBar = ownsCurrentLinkedPrimaryLinks(doc) && (preserveLinkBar || !isPublicSteamLibraryRoute(doc));
	cancelLinkedShortcutLoading(doc);
	linkedRenderRetryState.delete(doc); routeMismatchRetryState.delete(doc);
	navigationController.cancelCleanup(doc); finishLibraryRouteExit(doc);
	removeNativeGameChrome(doc, true, preserveCloudStatus, preserveCloudStatus, preserveCloudStatus); removePlaytimeFallbackStats(doc, preserveCloudStatus);
	disposeStatusPostBox(doc); disposeActivityFeedInteractions(doc); parkSharedActivityComposer(doc);
	disposeTradingCardUI(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	for (const id of ['gdl-main-content-stack', GDL_INJECTED, 'gdl-skeleton', 'gdl-controller-section', 'gdl-friends-section', 'gdl-achievements-section', 'gdl-trading-cards-section', 'gdl-dlc-section', 'gdl-workshop-section', 'gdl-link-bar', 'gdl-community-content', 'gdl-activity-feed', 'gdl-historical-info-section', 'gdl-external-achievements-section', 'gdl-manual-link-notice-button-row', LINKED_LOADING_SIDEBAR_ID]) {
		if (preserveLinkBar && id === 'gdl-link-bar') continue;
		doc.getElementById(id)?.remove();
	}
	removeManualLinkNoticeButton(doc); restoreNativeLibraryStyles(doc);
	doc.querySelectorAll('[data-gdl-hidden]').forEach(element => element.removeAttribute('data-gdl-hidden'));
}
function cleanupOwnedLibraryChromeAfterRouteExit(doc: Document): void {
	disposeLinkedSidebarOrder(doc); disposeControllerSidebarWatcher(doc);
	cancelLinkedShortcutLoading(doc); finishLibraryRouteExit(doc);
	disposeStatusPostBox(doc); disposeActivityFeedInteractions(doc); parkSharedActivityComposer(doc);
	disposeTradingCardUI(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	const currentId = routedSteamAppId(doc);
	const isCurrentLinked = Boolean(currentId && currentId >= 2147483648 && !isShortcutDismissed(currentId) && findMappingForShortcut(String(currentId), ''));
	removeNativeGameChrome(doc, true, isCurrentLinked); removeOwnedLibraryChrome(doc);
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
	disposeLinkedSidebarOrder(doc); disposeControllerSidebarWatcher(doc, true);
	cancelPendingLibraryPaint(doc);
	removeNativeInfoButton(doc); if (!isPublicSteamLibraryRoute(doc)) resetMainScrollToTop(doc);
	const generation = navigationController.advance(doc);
	// A → sibling → A never restores authority to the first session's promises.
	if (currentInjectedDocument === doc) injectionGeneration += 1;
	linkedRenderRetryState.delete(doc);
	const hadCurrentInjection = currentInjectedDocument === doc, hadOwnedChrome = hasOwnedLibraryChrome(doc);
	doc.getElementById('gdl-game-info-panel')?.remove();
	if (isPublicSteamLibraryRoute(doc)) {
		doc.getElementById('gdl-link-bar')?.remove(); doc.getElementById('gdl-game-info-panel')?.remove(); removeNativeGameChrome(doc, true, false);
		if (hadCurrentInjection) clearCurrentInjection(doc);
		if (hadCurrentInjection || hadOwnedChrome) {
			restoreNativeLibraryStyles(doc);
			scheduleNavigationCleanup(doc, generation, false);
		}
		return;
	}
	const nextAppId = routedSteamAppId(doc);
	const isNextLinked = Boolean(nextAppId && nextAppId >= 2147483648 && !isShortcutDismissed(nextAppId) && findMappingForShortcut(String(nextAppId), ''));
	reconcileLibraryNavigation(doc, {
		currentInjectedAppId, currentInjectedShortcutAppId, clearCurrentInjection,
		scheduleCleanup: () => isNextLinked ? undefined : scheduleNavigationCleanup(doc, generation, false),
	});
	const sameLinkedSession = hadCurrentInjection && currentInjectedDocument === doc;
	if (isUsableLibraryDocument(doc) && (hadCurrentInjection || hadOwnedChrome) && !sameLinkedSession) {
		clearCurrentInjection(doc);
		if (!isNextLinked) { restoreNativeLibraryStyles(doc); scheduleNavigationCleanup(doc, generation, false); }
	}
}
function scheduleNavigationRetry(doc: Document, generation: number, delayMs: number): void {
	navigationController.scheduleRetry(doc, generation, delayMs, () => {
		if (isUsableLibraryDocument(doc)) void tryInjectLibraryData(doc).catch(() => {});
	});
}
/** Retry incomplete columns within this route, with a bounded attempt count. */
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

function scheduleNavigationCleanup(doc: Document, generation = navigationController.current(doc), preserveCloudStatus = false): void {
	if (!hasOwnedLibraryChrome(doc) && !isLibraryRouteExitPending(doc)) return;
	if (isLibraryRouteExitPending(doc, generation)) return;
	beginLibraryRouteExit(doc, generation);
	// Stop playbar/info observers immediately; otherwise their closure can
	// recreate chrome from the previous game during Steam's route commit.
	removeNativeGameChrome(doc, true, preserveCloudStatus);
	navigationController.scheduleCleanup(doc, generation, 350, () => {
		if (!isCurrentNavigation(doc, generation) || !isLibraryRouteExitPending(doc, generation)) return;
		cleanupOwnedLibraryChromeAfterRouteExit(doc);
		if (findNonSteamNotice(doc)) {
			void tryInjectLibraryData(doc).catch(error => backendLog('Library recovery failed: ' + String(error)));
		}
	});
}

function finalizeAchievements(doc: Document, steamAppId: string, fallbackTotal: number, generation = injectionGeneration): void {
	void finalizeLinkedAchievements(doc, {
		steamAppId, fallbackTotal, stateAppId: currentInjectedShortcutAppId || undefined,
		isCurrent: () => isCurrentRender(doc, steamAppId, generation),
	}).catch(error => backendLog('Achievements error: ' + String(error)));
}

/** Share heavy metadata work after Steam's native hero/logo paint. */
export async function tryInjectLibraryData(doc: Document): Promise<void> {
	if (!isUsableLibraryDocument(doc)) return;
	if (isPublicSteamLibraryRoute(doc)) {
		cancelPendingLibraryPaint(doc);
		return injectLibraryDataAfterNativePaint(doc);
	}
	const generation = navigationController.current(doc);
	const route = libraryRouteIdentity(doc);
	syncLinkedFirstContent(doc); warmVisibleLinkedResources(doc);
	return runWhenLibrarySidebarIdle(doc, 'library-schedule', () => nativePaintQueue.run(doc, `${generation}:${route}`, () => runWhenLibrarySidebarIdle(doc, 'library-commit', () => {
		if (!isCurrentNavigation(doc, generation) || libraryRouteIdentity(doc) !== route) return undefined;
		if (!isPublicSteamLibraryRoute(doc)) configuredLibraryRuntimeHost?.prepareLinkedPage?.(doc);
		return injectLibraryDataAfterNativePaint(doc);
	}), configuredLibraryRuntimeHost?.waitForNativeArtwork));
}

async function injectLibraryDataAfterNativePaint(doc: Document): Promise<void> {
	if (!isUsableLibraryDocument(doc)) return;
	const navigationGeneration = navigationController.current(doc);
	const navigationRoute = libraryRouteIdentity(doc);
	const activeLibraryDoc = configuredLibraryRuntimeHost?.getMainWindowDoc() || null;
	if (isUsableLibraryDocument(activeLibraryDoc) && activeLibraryDoc !== doc) return;
	if (currentInjectedDocument && currentInjectedDocument !== doc
		&& (!isUsableLibraryDocument(currentInjectedDocument) || configuredLibraryRuntimeHost?.getMainWindowDoc() === doc)) {
		const previousDoc = currentInjectedDocument;
		clearCurrentInjection();
		if (isUsableLibraryDocument(previousDoc)) cleanupInjection(previousDoc);
	}
	// Native destinations only retire remnants owned by NativeGameLink.
	if (isPublicSteamLibraryRoute(doc)) {
		if (tryRedirectUnownedMappedGame(doc)) return;
		retireLinkedRouteFromNativePage(doc, navigationGeneration);
		return;
	}
	let noticeInfo = findNonSteamNotice(doc);
	if (!noticeInfo) {
		const nextAppId = routedSteamAppId(doc);
		if (nextAppId && nextAppId >= 2147483648 && !isShortcutDismissed(nextAppId)) {
			const app = getShortcutAppById(Number(nextAppId));
			const title = String(app?.display_name || app?.m_strDisplayName || '').trim();
			const mapped = findMappingForShortcut(String(nextAppId), title);
			const nativeContent = mapped && discoverNativeLibraryLayoutForShortcut(doc, nextAppId).contentColumn;
			if (nativeContent?.isConnected) noticeInfo = { element: nativeContent, title: title || '' };
		}
	}
	if (!noticeInfo) {
		// Transient notice absence never creates a synthetic navigation.
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
	if (!isCurrentNavigation(doc, navigationGeneration) || libraryRouteIdentity(doc) !== navigationRoute) {
		cancelLinkedShortcutLoading(doc, navigationGeneration);
		return;
	}
	if (!notice.isConnected || !doc.body.contains(notice)) {
		cancelLinkedShortcutLoading(doc, navigationGeneration);
		scheduleNavigationRetry(doc, navigationGeneration, 80);
		return;
	}
	// The concrete destination outranks stale notices and selected rows.
	const concreteRouteId = routedSteamAppId(doc);
	const routedShortcutAppId = concreteRouteId !== null && concreteRouteId >= 2147483648
		? String(concreteRouteId) : findActiveShortcutAppId(doc, gameTitle);
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

	// Split commits require agreement; elapsed time cannot authorize stale DOM.
	const mismatchState = routeMismatchRetryState.get(doc);
	const mismatchAttempts = mismatchState?.generation === navigationGeneration ? mismatchState.attempts + 1 : 1;
	if (routedShortcutAppId && titleMatchedShortcutAppId
		&& routedShortcutAppId !== titleMatchedShortcutAppId
		&& !routeBelongsToGame) {
		if (mismatchAttempts <= MAX_LINKED_RENDER_RETRIES) {
			routeMismatchRetryState.set(doc, { generation: navigationGeneration, attempts: mismatchAttempts });
			scheduleNavigationRetry(doc, navigationGeneration, 80);
		}
		return;
	} else {
		routeMismatchRetryState.delete(doc);
	}
	const activeShortcutAppId = (routeBelongsToGame && routedShortcutAppId) || titleMatchedShortcutAppId || routedShortcutAppId || (shortcutByName ? String(shortcutByName) : null);
	if (concreteRouteId !== null && (String(concreteRouteId) !== activeShortcutAppId
		|| !paintedNativePlaybar(doc, concreteRouteId))) {
		scheduleLinkedRenderRetry(doc, navigationGeneration);
		return;
	}
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
		void injectPlaytimeFallbackStats(doc, visibleShortcutId, gameTitle, undefined,
			() => isUsableLibraryDocument(doc) && !doc.getElementById(GDL_INJECTED) && (isShortcutDismissed(visibleShortcutId) || !findMappingForShortcut(String(visibleShortcutId), gameTitle)));
		if (currentInjectedDocument === doc) clearCurrentInjection(doc);
		cleanupInjection(doc);
		ensureManualLinkNoticeButton(doc, notice, String(visibleShortcutId), gameTitle, () => findNonSteamNotice(doc));
		return;
	}
	reprioritizeLinkedGame(steamAppId);

	const stage = () => stageLinkedShortcutLoading(doc, notice, navigationGeneration, { steamAppId, shortcutAppId: resolvedShortcutAppId, isCurrent: () => isCurrentNavigation(doc, navigationGeneration) && libraryRouteIdentity(doc) === navigationRoute });

	if (activeShortcutAppId && !mappings[shortcutMappingKey(activeShortcutAppId)]) {
		const activeKey = shortcutMappingKey(activeShortcutAppId);
		mappings[activeKey] = steamAppId;
		void saveMappingChecked(activeKey, steamAppId);
		backendLog(`Recovered mapping for active shortcut ${activeShortcutAppId}`);
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

	if (existing || (currentInjectedDocument === doc && ((currentInjectedAppId && currentInjectedAppId !== steamAppId) || shortcutIdentityChanged))) {
		clearCurrentInjection(doc); cleanupInjection(doc, false, Boolean(steamAppId));
	} else if (currentInjectedDocument && currentInjectedDocument !== doc) {
		const previousDoc = currentInjectedDocument; clearCurrentInjection(previousDoc);
		if (isUsableLibraryDocument(previousDoc)) cleanupInjection(previousDoc);
	}
	const generation = setCurrentInjection(doc, steamAppId, resolvedShortcutAppId);
	await stage();
	if (!isCurrentNavigation(doc, navigationGeneration) || !isCurrentRender(doc, steamAppId, generation)) return;
	const mountedDuringPaint = doc.getElementById(GDL_INJECTED);
	if (mountedDuringPaint?.dataset.gdlLayoutComplete === '1' && mountedDuringPaint.dataset.gdlSteamAppId === steamAppId
		&& mountedDuringPaint.dataset.gdlShortcutAppId === resolvedShortcutAppId) return;
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
			hydrateLinkedRouteResources(doc, steamAppId, resolvedShortcutAppId, language, () => isCurrentRender(doc, steamAppId, generation), cachedData);
		} else {
			scheduleLinkedRenderRetry(doc, navigationGeneration);
		}
	}

	if (injectionInFlight?.doc === doc && injectionInFlight.steamAppId === steamAppId && injectionInFlight.generation === generation) return;
	const flight = { doc, steamAppId, generation };
	injectionInFlight = flight;

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
	const refreshedData = data;
	await nativePaintQueue.run(doc, `${navigationGeneration}:${navigationRoute}:result:${generation}`, () => runWhenLibrarySidebarIdle(doc, 'library-core-result', () => {
		if (!isCurrentNavigation(doc, navigationGeneration) || !isCurrentRender(doc, steamAppId, generation)) return;
		cachedNews = getCachedNews(steamAppId, language, refreshedData)?.data || cachedNews;
		void syncLinkedGameNote(gameTitle || refreshedData.name, refreshedData, steamAppId);
		if (!renderedFromCache) {
			const latestNotice = findNonSteamNotice(doc)?.element || discoverNativeLibraryLayoutForShortcut(doc, resolvedShortcutAppId || '').contentColumn;
			if (!latestNotice || !renderLinkedPage(doc, latestNotice, refreshedData, steamAppId,
				cachedNews, cachedFriends, cachedCommunity, generation)) {
				if (isCurrentNavigation(doc, navigationGeneration)
					&& isCurrentRender(doc, steamAppId, generation)) {
					stage();
					scheduleLinkedRenderRetry(doc, navigationGeneration);
				}
				return;
			}
			perfMeasure('game-selection -> first-render', 'game-select-' + steamAppId);
		}
		finalizeAchievements(doc, steamAppId, refreshedData.achievements?.total || 0, generation);
		hydrateLinkedRouteResources(doc, steamAppId, resolvedShortcutAppId, language,
			() => isCurrentRender(doc, steamAppId, generation), refreshedData);
		perfMeasure('background-revalidation', 'game-select-' + steamAppId);
	}), configuredLibraryRuntimeHost?.waitForNativeArtwork);
}

export function getCurrentInjectedAppId(): string | null { return currentInjectedAppId; }
export function getCurrentInjectedShortcutAppId(): string | null { return currentInjectedShortcutAppId; }
export function resetLibraryInjection(reinject = false, targetDoc?: Document | null): void {
	const liveDoc = libraryRuntimeHost().getMainWindowDoc();
	const doc = isUsableLibraryDocument(liveDoc) ? liveDoc : targetDoc;
	if (!doc) { nativePaintQueue.cancel(); navigationController.dispose(); clearCurrentInjection(); return; }
	cancelPendingLibraryPaint(doc);
	const generation = navigationController.advance(doc);
	if (isPublicSteamLibraryRoute(doc)) { retireLinkedRouteFromNativePage(doc, generation); return; }
	clearCurrentInjection(doc);
	cleanupInjection(doc);
	if (reinject) void tryInjectLibraryData(doc).catch(error => backendLog('Library reinjection failed: ' + error));
}
export function disposeLibraryRuntime(): void {
	nativePaintQueue.cancel();
	const doc = currentInjectedDocument || configuredLibraryRuntimeHost?.getMainWindowDoc() || null;
	if (doc) { disposeLinkedSidebarOrder(doc); disposeControllerSidebarWatcher(doc); cancelLibrarySidebarWork(doc);
		if (isPublicSteamLibraryRoute(doc)) {
			if (hasOwnedLibraryChrome(doc) || isLibraryRouteExitPending(doc)) { restoreNativeLibraryStyles(doc); cleanupOwnedLibraryChromeAfterRouteExit(doc); }
		} else cleanupInjection(doc);
		disposeSteamNavigation(doc); disposeSharedActivityComposer(doc);
	}
	navigationController.dispose();
	clearCurrentInjection();
	configuredLibraryRuntimeHost = null;
}
