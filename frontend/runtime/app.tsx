import React from 'react';
import { Millennium, IconsModule, definePlugin } from '@steambrew/client';
import { backendLog } from '../api/backend';
import { mappings, loadMappings } from '../core/mappings';
import { clearGameDataCache } from '../core/game-data';
import { pruneCacheStorage, setProtectedCacheAppIds } from '../core/cache';
import { getSteamLanguage, subscribeSteamLanguageChange, startSteamLanguageWatcher, stopSteamLanguageWatcher, officialSteamText, setLocalizationDocumentProvider } from '../steam/localization';
import { steamUIModeService } from '../steam/ui/SteamUIModeService';
import { steamComponents } from '../steam/modules/SteamComponentResolver';
import { SettingsContent } from '../settings/SettingsContent';
import { clearShortcutRuntimeCaches, findActiveShortcutAppId, isSteamLibraryActive } from '../steam/shortcuts';
import { clearLibraryAssetCaches } from '../features/library/artwork';
import { clearCommunityItemCaches } from '../features/library/community-items';
import { clearSocialRuntimeCaches, configureSocialRuntimeHost } from '../features/library/social';
import { configureLibraryRuntimeHost, disposeLibraryRuntime, findNonSteamNotice, getCurrentInjectedAppId, getCurrentInjectedShortcutAppId, handleLibraryNavigation, refreshLibraryArtwork, resetLibraryInjection, tryInjectLibraryData } from '../features/library/runtime';
import { DisposableRegistry } from '../core/disposables';
import { configureShortcutRuntimeHost, disposeCustomizationArtwork, mutationMayContainProperties, scheduleReconciliation, startNativeAddAutoDetector, stopNativeAddAutoDetector, tryInjectCustomizationArtwork, tryInjectPropertiesField } from '../features/shortcuts/runtime';
import { GDL_INJECTED } from '../features/library/constants';
import { activateBigPicture, deactivateBigPicture, getBigPictureDocument, isBigPictureActive, refreshBigPicture } from '../features/big-picture/runtime';
import { captureNativeUiBlueprints, clearNativeUiBlueprints } from '../steam/native-dom';
import { resetResolvedCssClassModules } from '../steam/css';
import {
	clearLocalAchievementCache, configureAchievementRuntimeHost, disposeAchievementRuntime,
	disposeLocalAchievementUI, installLocalAchievementUI, registerNativeAchievementToastWindow,
	unregisterNativeAchievementToastWindow, showAchievementToast, startFirstLaunchAchievementWatcher,
	stopFirstLaunchAchievementWatcher,
} from '../features/achievements/runtime';
import { startPlaytimeTracker, stopPlaytimeTracker } from '../features/playtime/tracker';
import { patchDesktopLibraryHomePlaytime, syncDesktopLibraryHomePlaytimeDom } from '../features/playtime/library-home';
import { mutationMayContainDesktopPlaytime } from '../features/playtime/library-home-dom';
import { processPendingLinkJobs } from '../features/shortcuts/link-job-queue';
import { clearShortcutDetectionCache } from '../features/shortcuts/detection';
import { mutationMayContainNonSteamNotice } from '../features/library/notice';
import { isPublicSteamLibraryRoute, libraryRouteIdentity } from '../features/library/native-route';
import { disposeNativeInfoPreference, reconcileNativeInfoPreference } from '../features/library/native-info-preference';
import { finishLibraryRouteExit, hasOwnedLibraryChrome } from '../features/library/route-exit';
import { disposeLinkedGamePrefetch, restartLinkedGamePrefetch, startLinkedGamePrefetch } from '../features/library/prefetch';
import { installGhostSidebarCleanup } from '../features/library/sidebar-cleanup';
import { adoptExistingSteamWindows, getCanonicalDesktopPopup, isRealSteamUiWindow, resolveSteamWindowContext } from './existing-windows';
import { installMappingRefresh } from './mapping-refresh';
import { installArtworkBatchRefresh } from './artwork-batch-refresh';
import { syncMissingArtworkForMappedShortcuts } from '../features/library/artwork-sync';
import { installBrowserProtection, disposeAllBrowserProtection } from '../steam/browser-protection';
let mainWindowDoc: Document | null = null;
setLocalizationDocumentProvider(() => mainWindowDoc);
function normalizedDomText(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase(); }
function currentCopiedFeedbackLabels(): Set<string> {
	return new Set(['copied!', 'copied', '¡copiado!', 'copiado!', 'copiado', normalizedDomText(officialSteamText('Copied!')), normalizedDomText(officialSteamText('Copied'))].filter(Boolean));
}
function sweepCopiedFeedbackTooltips(doc: Document): void {
	if (!doc?.body) return;
	const labels = currentCopiedFeedbackLabels();
	if (labels.size === 0) return;
	try {
		const candidates = doc.querySelectorAll<HTMLElement>('div, span, p, [class*="tooltip" i], [class*="popup" i], [class*="toast" i], [class*="copied" i], [class*="badge" i], [class*="bubble" i]');
		for (const el of Array.from(candidates)) {
			const text = normalizedDomText(el.textContent);
			if (!labels.has(text) || el.closest('button, a, input, textarea, [role="button"]')) continue;
			let target: HTMLElement = el, parent = el.parentElement;
			while (parent && parent !== doc.body && normalizedDomText(parent.textContent) === text) { target = parent; parent = parent.parentElement; }
			for (const p of ['display', 'visibility', 'opacity', 'pointer-events']) target.style.setProperty(p, p === 'display' ? 'none' : p === 'visibility' ? 'hidden' : '0', 'important');
		}
	} catch {}
}
const scheduleCopiedFeedbackCleanup = (doc: Document, _roots?: Iterable<Node>): void => sweepCopiedFeedbackTooltips(doc);
const observedDocs = new WeakSet<Document>();
const activeSteamDocuments = new Set<Document>();
const documentLifecycles = new Set<DisposableRegistry>();
function disposeDocumentLifecycles(): void {
	for (const lifecycle of Array.from(documentLifecycles)) lifecycle.dispose();
	documentLifecycles.clear();
}
function resolveMainWindowDocument(): Document | null {
	try {
		const popup = getCanonicalDesktopPopup();
		const { popupDoc: doc } = resolveSteamWindowContext(popup);
		if (doc?.body && doc.defaultView && !doc.defaultView.closed && isRealSteamUiWindow(doc.defaultView) && !steamUIModeService.isGamepadUI(doc)) {
			if (!observedDocs.has(doc)) windowCreated(popup);
			mainWindowDoc = doc; activeSteamDocuments.add(doc); return doc;
		}
	} catch {}
	if (mainWindowDoc && !mainWindowDoc.defaultView?.closed && mainWindowDoc.body && isRealSteamUiWindow(mainWindowDoc.defaultView) && !steamUIModeService.isGamepadUI(mainWindowDoc)) return mainWindowDoc;
	for (const doc of activeSteamDocuments) {
		if (doc?.body && doc.defaultView && !doc.defaultView.closed && isRealSteamUiWindow(doc.defaultView) && !steamUIModeService.isGamepadUI(doc)) {
			mainWindowDoc = doc; return doc;
		}
	}
	return null;
}
let hasHadBigPictureSession = false;
function handleBigPictureExit(): void {
	const bpDoc = getBigPictureDocument();
	if (bpDoc && bpDoc.body?.isConnected && !bpDoc.defaultView?.closed && steamUIModeService.isGamepadUI(bpDoc)) return;
	if (isBigPictureActive()) deactivateBigPicture();
	hasHadBigPictureSession = false;
	const targetDoc = resolveMainWindowDocument();
	if (targetDoc) {
		finishLibraryRouteExit(targetDoc);
		resetLibraryInjection(true, targetDoc);
		syncDesktopLibraryHomePlaytimeDom(targetDoc);
		void patchDesktopLibraryHomePlaytime(targetDoc).catch(() => {});
	}
	[60, 150, 350, 750, 1400].forEach(delay => setTimeout(() => {
		const doc = resolveMainWindowDocument();
		if (!doc || isBigPictureActive() || (bpDoc && bpDoc.body?.isConnected && !bpDoc.defaultView?.closed)) return;
		finishLibraryRouteExit(doc);
		if (!doc.getElementById(GDL_INJECTED) && !doc.getElementById('gdl-main-content-stack') && findNonSteamNotice(doc)) {
			void tryInjectLibraryData(doc).catch(() => {});
		}
	}, delay));
}
function windowCreated(context: any): void {
	const { popupWin, popupDoc, popupName, popupTitle } = resolveSteamWindowContext(context);
	if (!popupWin || !popupDoc) return;
	if (!popupDoc.body) {
		popupWin.addEventListener('DOMContentLoaded', () => windowCreated(context), { once: true });
		setTimeout(() => { try { if (!popupWin.closed && popupWin.document?.body) windowCreated(context); } catch {} }, 100);
		setTimeout(() => { try { if (!popupWin.closed && popupWin.document?.body) windowCreated(context); } catch {} }, 400);
		return;
	}
	const isBigPictureWindow = /SP BPM|SP Big Picture|Big Picture|Gamepad/i.test(`${popupName} ${popupTitle}`);
	const isOverlayWindow = /desktopoverlay|SP Overlay|Game Overlay/i.test(`${popupName} ${popupTitle}`);
	const isMainWindow = popupName === 'SP Desktop'
		|| (popupName.includes('SP Desktop') && !popupName.includes('Popup') && !popupName.includes('Login'))
		|| (!popupName && isRealSteamUiWindow(popupWin) && !isBigPictureWindow && !isOverlayWindow);
	const isPropertiesCandidate = /properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|shortcut/i.test(popupTitle || popupDoc.title || '');
	if (!isMainWindow && !isBigPictureWindow && !isOverlayWindow && !popupName && !isPropertiesCandidate) return;
	if (observedDocs.has(popupDoc)) return;
	observedDocs.add(popupDoc); activeSteamDocuments.add(popupDoc);
	const isBigPictureSurface = (): boolean => {
		if (isBigPictureWindow) return true;
		if (steamUIModeService.isGamepadUI(popupDoc)) return true;
		if (popupDoc.body && (popupDoc.body.classList.contains('GamepadUI') || popupDoc.body.classList.contains('gamepadui'))) return true;
		if (/(?:gamepadui|bigpicture)/i.test(popupWin.location?.href || popupDoc.location?.href || '')) return true;
		return false;
	};
	let lifecycle!: DisposableRegistry;
	lifecycle = new DisposableRegistry(() => {
		documentLifecycles.delete(lifecycle);
		activeSteamDocuments.delete(popupDoc);
	});
	documentLifecycles.add(lifecycle);
	// SP Desktop performs internal navigations while Steam rebuilds a shortcut.
	// Its beforeunload/unload events are not proof that the visible CEF window is
	// gone; disposing here permanently loses the observer until Steam restarts.
	if (!isMainWindow) {
		const disposeWindow = () => lifecycle.dispose();
		lifecycle.listen(popupWin, 'beforeunload', disposeWindow, { once: true });
		lifecycle.listen(popupWin, 'unload', disposeWindow, { once: true });
	}
	lifecycle.add(() => { disposeLocalAchievementUI(popupDoc); disposeCustomizationArtwork(popupDoc); disposeNativeInfoPreference(popupDoc); });
	lifecycle.add(installBrowserProtection(popupWin, popupDoc));
	const winTitle = `${popupName} ${popupTitle}`.trim();
	if (isOverlayWindow) {
		registerNativeAchievementToastWindow(popupWin, 'overlay', winTitle);
		lifecycle.add(() => unregisterNativeAchievementToastWindow(popupWin));
	} else if (isBigPictureWindow) registerNativeAchievementToastWindow(popupWin, 'bigpicture', winTitle);
	else if (isMainWindow) registerNativeAchievementToastWindow(popupWin, 'desktop', winTitle);
	if (isBigPictureWindow) {
		hasHadBigPictureSession = true;
		const onBpmClose = () => handleBigPictureExit();
		lifecycle.listen(popupWin, 'beforeunload', onBpmClose, { once: true });
		lifecycle.listen(popupWin, 'unload', onBpmClose, { once: true });
		lifecycle.add(onBpmClose);
		activateBigPicture(popupDoc);
		// Keep achievement progress polling active when the game was launched
		// from Big Picture. Persistent baselines suppress duplicate toasts if the
		// desktop and Big Picture documents observe the same file change.
		installLocalAchievementUI(popupDoc);
	}
	if (isMainWindow) {
		mainWindowDoc = popupDoc;
		syncDesktopLibraryHomePlaytimeDom(popupDoc);
		void processPendingLinkJobs(mainWindowDoc);
		installLocalAchievementUI(popupDoc);
		scheduleCopiedFeedbackCleanup(popupDoc);
		// A full CEF document replacement does require a new observer. Wait until
		// the replacement document actually exists, then hand ownership over; do
		// not tear the active observer down on Steam's earlier unload signal.
		lifecycle.interval(() => {
			try {
				if (popupWin.closed) { lifecycle.dispose(); return; }
				const liveDoc = popupWin.document;
				if (liveDoc !== popupDoc && liveDoc?.body) {
					lifecycle.dispose();
					windowCreated({ window: popupWin, m_strName: popupName || 'SP Desktop', m_strTitle: popupTitle });
				}
			} catch {}
		}, 1000);
	}
	let mutationTimer: ReturnType<typeof setTimeout> | null = null;
	let playtimeTimer: ReturnType<typeof setTimeout> | null = null;
	let lastPlaytimeRefreshAt = 0;
	let lastBigPictureRefreshAt = 0;
	let lastMutationInjectionAt = 0;
	lifecycle.add(() => {
		if (mutationTimer) clearTimeout(mutationTimer); if (playtimeTimer) clearTimeout(playtimeTimer);
		mutationTimer = null; playtimeTimer = null;
	});
	let lastNavUrl = libraryRouteIdentity(popupDoc);
	const schedulePlaytimeRefresh = (immediate = false): void => {
		if (!isMainWindow || popupDoc.hidden || playtimeTimer) return;
		const elapsed = Date.now() - lastPlaytimeRefreshAt;
		const delay = immediate ? 0 : Math.max(0, 10000 - elapsed);
		playtimeTimer = setTimeout(() => {
			playtimeTimer = null;
			lastPlaytimeRefreshAt = Date.now();
			void patchDesktopLibraryHomePlaytime(popupDoc).catch(e => backendLog('Desktop Library playtime refresh error: ' + e));
		}, delay);
	};
	let wasBigPictureSurface = isBigPictureSurface();
	const runInjection = (reason: 'startup' | 'navigation' | 'mutation' | 'visibility' | 'watchdog' = 'mutation') => {
		if (reason === 'mutation') lastMutationInjectionAt = Date.now();
		const currentIsBigPicture = isBigPictureSurface();
		if (wasBigPictureSurface && !currentIsBigPicture) {
			wasBigPictureSurface = false;
			if (getBigPictureDocument() === popupDoc) handleBigPictureExit();
		}
		if (!wasBigPictureSurface && currentIsBigPicture) {
			wasBigPictureSurface = true;
			hasHadBigPictureSession = true;
		}
		// This precedes the static main-window branch because Steam reuses that document.
		if (currentIsBigPicture) {
			activateBigPicture(popupDoc);
			lastBigPictureRefreshAt = Date.now();
			void refreshBigPicture(popupDoc).catch(e => backendLog('Big Picture refresh error: ' + e));
			return;
		}
		if (isMainWindow) {
			// Properties/Personalización live in dedicated popup documents. Running
			// their full-text/DOM scanners against SP Desktop on every Library
			// mutation created needless startup work and retained large React trees.
			// Keep desktop injection restricted to actual Library surfaces.
			// Native metadata and layout remain Steam-owned. The only native action is
			// reconciling the user's information-toggle preference through Steam's button.
			if (isPublicSteamLibraryRoute(popupDoc)) {
				reconcileNativeInfoPreference(popupDoc);
				if (hasOwnedLibraryChrome(popupDoc)) {
					void tryInjectLibraryData(popupDoc).catch(e => backendLog('Library route retirement error: ' + e));
				}
				return;
			}
			syncDesktopLibraryHomePlaytimeDom(popupDoc);
			captureNativeUiBlueprints(popupDoc, { skip: () => Boolean(findNonSteamNotice(popupDoc) || popupDoc.getElementById(GDL_INJECTED)) });
			void tryInjectLibraryData(popupDoc).catch(e => backendLog('Library injection error: ' + e));
			schedulePlaytimeRefresh(reason !== 'mutation');
			return;
		}
		// Shortcut-only fields exist only in Properties popups. Never run the
		// full text walker against the desktop Library or Big Picture documents.
		tryInjectPropertiesField(popupDoc, popupTitle);
		tryInjectCustomizationArtwork(popupDoc, popupTitle);
	};
	const isGdlOwnedNode = (node: Node, fallback: Node): boolean => {
		const element = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)
			|| (fallback.nodeType === Node.ELEMENT_NODE ? fallback as Element : fallback.parentElement);
		return Boolean(element?.closest?.('[id^="gdl-"], [data-gdl-hidden], [data-gdl-shortcut-app-id]'));
	};
	const isGdlOnlyMutation = (records: MutationRecord[]): boolean => records.length > 0 && records.every(record => {
		if (isGdlOwnedNode(record.target, record.target)) return true;
		const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
		return changed.length > 0 && changed.every(node => isGdlOwnedNode(node, record.target));
	});
	// Do not invalidate the page merely because a library row was pressed: Steam
	// also emits pointerdown for the already-selected row. Actual URL/DOM route
	// signals below are authoritative and prevent native-page cleanup flicker.
	const observer = new MutationObserver((records) => {
		const currentUrl = libraryRouteIdentity(popupDoc);
		if (currentUrl && currentUrl !== lastNavUrl) {
			lastNavUrl = currentUrl;
			if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }
			if (isMainWindow) handleLibraryNavigation(popupDoc);
			runInjection('navigation');
			return;
		}
		if (isMainWindow && isPublicSteamLibraryRoute(popupDoc)) {
			// Steam may reveal its native links row before updating the route URL.
			// Retire only stale gdl-* nodes and ignore the rest of this mutation.
			runInjection('mutation');
			return;
		}
		// Library Home cards can mount after the document callback. Patch their
		// text from the persistent snapshot in this same mutation turn; this does
		// no I/O and is bypassed above for native game-detail routes.
		if (isMainWindow) {
			const playtimeRoots = records.flatMap(record => [record.target, ...Array.from(record.addedNodes)]);
			if (mutationMayContainDesktopPlaytime(playtimeRoots)) syncDesktopLibraryHomePlaytimeDom(popupDoc);
		}
		if (isMainWindow) {
			const roots = records.flatMap(record => Array.from(record.addedNodes));
			if (roots.length > 0) scheduleCopiedFeedbackCleanup(popupDoc, roots);
		}
		// Rendering a linked page creates several DOM mutations of its own. They
		// are already complete, so feeding them back into the navigation observer
		// used to schedule redundant injection/cleanup passes and visible flicker.
		if (isGdlOnlyMutation(records)) return;
		const addedRoots = records.flatMap(record => Array.from(record.addedNodes));
		if (mutationMayContainNonSteamNotice(addedRoots) || mutationMayContainProperties(addedRoots)) {
			if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }
			runInjection('mutation');
			return;
		}
		// Steam emits a burst of separate mutations while rebuilding its first
		// library route. Coalesce that burst into one pass instead of mounting,
		// cleaning and mounting our chrome several times in the first second.
		if (mutationTimer) return;
		const bigPictureSurface = isBigPictureSurface();
		const mutationCooldown = bigPictureSurface ? 500 : 350;
		const delay = Math.max(bigPictureSurface ? 250 : 140,
			mutationCooldown - (Date.now() - lastMutationInjectionAt));
		mutationTimer = setTimeout(() => {
			mutationTimer = null;
			runInjection('mutation');
		}, delay);
	});
	lifecycle.observe(observer, popupDoc.body, { childList: true, subtree: true });
	lifecycle.listen(popupDoc, 'visibilitychange', () => {
		if (popupDoc.hidden) return;
		try {
			const currentUrl = libraryRouteIdentity(popupDoc);
			if (currentUrl && currentUrl !== lastNavUrl) {
				lastNavUrl = currentUrl;
				if (isMainWindow) handleLibraryNavigation(popupDoc);
			}
			runInjection('visibility');
		} catch {}
	});
	// The mutation observer is the primary route signal. This slower fallback
	// only covers Steam URL changes that arrive before their corresponding DOM
	// mutation, avoiding a constant high-frequency CEF poll while idle.
	lifecycle.interval(() => {
		try {
			if (popupDoc.hidden) return;
			const currentUrl = libraryRouteIdentity(popupDoc);
			if (!currentUrl || currentUrl === lastNavUrl) return;
			lastNavUrl = currentUrl;
			if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }
			if (isMainWindow) handleLibraryNavigation(popupDoc);
			runInjection('navigation');
		} catch {}
	}, 2500);
	// Keep the shim alive while Big Picture replaces its app overview tree.
	let refreshInterval: ReturnType<typeof setInterval> | null = null;
	lifecycle.add(() => { if (refreshInterval) clearInterval(refreshInterval); refreshInterval = null; });
	if (isBigPictureWindow || isMainWindow) {
		refreshInterval = setInterval(() => {
			try {
				if (popupWin.closed || !popupDoc.body) {
					if (refreshInterval) clearInterval(refreshInterval);
					if (getBigPictureDocument() === popupDoc) deactivateBigPicture();
					return;
				}
				if (!isBigPictureSurface() || popupDoc.hidden || Date.now() - lastBigPictureRefreshAt < 14000) {
					if (!isBigPictureSurface() && (isBigPictureActive() || hasHadBigPictureSession) && getBigPictureDocument() === popupDoc) {
						handleBigPictureExit();
					}
					return;
				}
				runInjection('watchdog');
			} catch (e) {
				backendLog('Big Picture refresh error: ' + e);
			}
		}, 15000);
	}
	const isPropertiesWindow = !isMainWindow && /properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|shortcut/i.test(popupTitle || popupDoc.title || '');
	const linkedShortcutAlreadyVisible = (isMainWindow && Boolean(findNonSteamNotice(popupDoc))) || isPropertiesWindow;
	lifecycle.timeout(() => {
		runInjection('startup');
	}, linkedShortcutAlreadyVisible ? 0 : 350);
}
function safeStartup(label: string, action: () => void): void {
	try { action(); }
	catch (error) {
		console.error(`[GDL] Startup step failed (${label}):`, error);
		try { backendLog(`[NGL][Startup] ${label} failed: ${String(error)}`); } catch {}
	}
}
export default definePlugin(() => {
	const startupStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const deferredStartupTimers: ReturnType<typeof setTimeout>[] = [];
	const deferStartup = (label: string, action: () => void, delay = 0): void => { deferredStartupTimers.push(setTimeout(() => safeStartup(label, action), delay)); };
	console.log('[GDL] definePlugin callback executing - returning plugin UI before background hydration');
	installBrowserProtection(window, window.document);
	safeStartup('cache protection', () => setProtectedCacheAppIds(Object.values(mappings)));
	setTimeout(() => safeStartup('cache pruning', () => pruneCacheStorage()), 750);
	safeStartup('library runtime host', () => configureLibraryRuntimeHost({ getMainWindowDoc: () => resolveMainWindowDocument() }));
	safeStartup('achievement runtime host', () => configureAchievementRuntimeHost({
		getCurrentInjectedAppId, getCurrentInjectedShortcutAppId,
		findNonSteamNotice: (doc) => { const info = findNonSteamNotice(doc); return info ? { title: info.title } : null; },
		findActiveShortcutAppId,
	}));
	safeStartup('shortcut runtime host', () => configureShortcutRuntimeHost({
		getMainWindowDoc: () => resolveMainWindowDocument(),
		getSteamDocuments: () => Array.from(activeSteamDocuments).filter(doc => {
			try { return Boolean(doc?.body && doc.defaultView && !doc.defaultView.closed); } catch { return false; }
		}),
		refreshLibraryArtwork, resetLibraryInjection,
		findNonSteamNotice: (doc) => { const info = findNonSteamNotice(doc); return info ? { title: info.title } : null; },
		isLibraryActive: (doc) => { const target = doc || resolveMainWindowDocument(); return Boolean(target && (findNonSteamNotice(target) || isSteamLibraryActive(target))); },
		runPendingLinkJobs: () => { void processPendingLinkJobs(resolveMainWindowDocument()); },
	}));
	// DOM/registry scans start only after Millennium can render the plugin card.
	deferStartup('native add detector', () => startNativeAddAutoDetector(), 1200);
	safeStartup('social runtime host', () => configureSocialRuntimeHost({ getCurrentInjectedAppId, getCurrentInjectedShortcutAppId }));
	if (Object.keys(mappings).length > 0) backendLog('Instant startup mapping snapshot: ' + Object.keys(mappings).length + ' entrie(s)');
	let unsubscribeUIMode = (): void => {};
	deferStartup('Steam UI mode service', () => {
		steamUIModeService.initialize();
		unsubscribeUIMode = steamUIModeService.subscribe((state) => {
			if (state.isGamepadUI) {
				hasHadBigPictureSession = true;
				const doc = getBigPictureDocument() || resolveMainWindowDocument();
				if (doc) void refreshBigPicture(doc).catch(error => backendLog('Big Picture mode refresh error: ' + error));
				return;
			}
			if (state.isDesktop && (isBigPictureActive() || hasHadBigPictureSession)) handleBigPictureExit();
		});
	}, 0);
	deferStartup('legacy cache cleanup', () => { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && (k.startsWith('events8_') || k.startsWith('events7_') || k.startsWith('friends_') || k.startsWith('gdl_cache_friends_') || k === 'gdl_info_panel_expanded' || k === 'gdl_native_info_panel_expanded')) localStorage.removeItem(k); } } catch {} }, 300);
	const hydrateMappingsAfterMount = (): void => { void loadMappings().then(() => {
		backendLog('Loaded ' + Object.keys(mappings).length + ' mapping(s)');
		// Keep the first paint cheap. None of these background services is needed
		// to render the Millennium plugin card, so stagger them after hydration.
		deferStartup('playtime tracker', () => startPlaytimeTracker(), 700);
		deferStartup('achievement launch watcher', () => startFirstLaunchAchievementWatcher(), 1100);
		deferStartup('linked game prefetch', () => startLinkedGamePrefetch(getCurrentInjectedAppId), 1600);
		void processPendingLinkJobs(mainWindowDoc);
		const targetDoc = resolveMainWindowDocument();
		if (targetDoc) {
			installGhostSidebarCleanup(targetDoc);
			tryInjectLibraryData(targetDoc).catch(e => backendLog('Post-startup library refresh error: ' + e));
		}
		const bigPictureDoc = getBigPictureDocument();
		if (bigPictureDoc) void refreshBigPicture(bigPictureDoc).catch(e => backendLog('Big Picture refresh error: ' + e));
		deferStartup('startup artwork reconciliation', () => { void syncMissingArtworkForMappedShortcuts(); scheduleReconciliation(5000); }, 2200);
	}).catch((e) => {
		console.error('[GDL] Failed to load mappings from backend:', e);
		deferStartup('playtime tracker fallback', () => startPlaytimeTracker(), 700);
		deferStartup('achievement watcher fallback', () => startFirstLaunchAchievementWatcher(), 1100);
	}); };
	deferStartup('mapping hydration', hydrateMappingsAfterMount, 0);
	let disposeMappingRefresh = (): void => {};
	try { disposeMappingRefresh = installMappingRefresh({
		getCurrentAppId: getCurrentInjectedAppId,
		getCurrentShortcutAppId: getCurrentInjectedShortcutAppId,
		resetLibrary: () => resetLibraryInjection(true),
		refreshBigPicture: () => { const doc = getBigPictureDocument(); if (doc) void refreshBigPicture(doc).catch(() => {}); },
	}); } catch (error) { console.error('[GDL] Mapping refresh startup failed:', error); }
	const disposeArtworkBatchRefresh = installArtworkBatchRefresh(getCurrentInjectedAppId, () => resetLibraryInjection(true));
	const onPlaytimeChanged = (): void => {
		const doc = resolveMainWindowDocument();
		if (doc) {
			void patchDesktopLibraryHomePlaytime(doc).catch(() => {});
			void tryInjectLibraryData(doc).catch(() => {});
		}
		const bigPictureDoc = getBigPictureDocument();
		if (bigPictureDoc) void refreshBigPicture(bigPictureDoc).catch(() => {});
	};
	window.addEventListener('gdl:playtime-changed', onPlaytimeChanged);
	let unsubscribeLanguageRefresh = (): void => {};
	try { unsubscribeLanguageRefresh = subscribeSteamLanguageChange((language, previousLanguage) => {
		if (!previousLanguage || previousLanguage === language) return;
		clearGameDataCache(); clearCommunityItemCaches(); clearSocialRuntimeCaches();
		clearLibraryAssetCaches(); clearShortcutDetectionCache(); clearShortcutRuntimeCaches();
		clearLocalAchievementCache(false); clearNativeUiBlueprints(); restartLinkedGamePrefetch(); resetLibraryInjection(true);
		const bigPictureDoc = getBigPictureDocument();
		if (bigPictureDoc) void refreshBigPicture(bigPictureDoc).catch(() => {});
	}); } catch (error) { console.error('[GDL] Language subscription failed:', error); }
	deferStartup('language watcher', () => startSteamLanguageWatcher(), 500);
	deferStartup('Steam language hydration', () => { void getSteamLanguage(true).catch(() => {}); }, 50);
	try { Millennium.AddWindowCreateHook(windowCreated); } catch (e) { console.error('[GDL] Failed to register window hook:', e); }
	const existingWindowAdoptionTimers = [0, 150, 400, 1000, 2500, 5000, 8000].map(delay => setTimeout(() => {
		try { adoptExistingSteamWindows(windowCreated); } catch (e) { console.error('[GDL] Failed to adopt existing Steam windows:', e); }
	}, delay));
	const adoptionInterval = setInterval(() => { try { adoptExistingSteamWindows(windowCreated); } catch {} }, 3000);
	console.log(`[GDL][Startup] Plugin descriptor ready in ${Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startupStartedAt)}ms; background services deferred.`);
	return {
		title: 'NativeGameLink for Steam',
		icon: <IconsModule.Settings />,
		content: <SettingsContent clearAchievementCache={clearLocalAchievementCache} showAchievementToast={showAchievementToast} />,
		onDismount: () => {
			clearInterval(adoptionInterval);
			disposeArtworkBatchRefresh();
			window.removeEventListener('gdl:playtime-changed', onPlaytimeChanged);
			for (const timer of existingWindowAdoptionTimers) clearTimeout(timer);
			for (const timer of deferredStartupTimers) clearTimeout(timer);
			disposeDocumentLifecycles(); unsubscribeLanguageRefresh(); unsubscribeUIMode();
			steamUIModeService.dispose(); disposeMappingRefresh(); disposeLinkedGamePrefetch();
			stopSteamLanguageWatcher(); stopNativeAddAutoDetector(); stopPlaytimeTracker();
			stopFirstLaunchAchievementWatcher(); deactivateBigPicture(); disposeLibraryRuntime();
			disposeAchievementRuntime(); clearNativeUiBlueprints(); resetResolvedCssClassModules();
			steamComponents.clearCache(); disposeAllBrowserProtection();
		},
	};
});
