import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.ARTWORK_BROWSER_EXECUTABLE || process.env.CLOUD_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(fs.existsSync(edge), `Edge executable missing: ${edge}`);
const sources = Object.fromEntries([
  ['runtime', 'frontend/features/library/runtime.ts'],
  ['after-native-paint', 'frontend/core/after-native-paint.ts'],
  ['navigation-controller', 'frontend/features/library/navigation-controller.ts'],
  ['render-session', 'frontend/features/library/render-session.ts'],
  ['sidebar-interaction', 'frontend/steam/sidebar-interaction.ts'],
  ['library-sidebar', 'frontend/steam/library-sidebar.ts'],
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['library-header', 'frontend/steam/library-header.ts'],
  ['native-artwork-ready', 'frontend/features/library/native-artwork-ready.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

async function browserChecks(sources) {
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const modules = {};
  const noop = () => undefined;
  const ids = { a: 3000000001, b: 3000000002, sibling: 3000000003 };
  const steamIds = { a: '111', b: '222' };
  const apps = new Map([[ids.a, { display_name: 'Game A' }], [ids.b, { display_name: 'Game B' }], [ids.sibling, { display_name: 'Game A sibling' }]]);
  const data = id => ({ name: `Game ${id === steamIds.a ? 'A' : 'B'}`, achievements: { total: 0 },
    detailed_description: 'Already cached metadata and community description. '.repeat(12000) });
  const cached = new Map(Object.values(steamIds).map(id => [id, data(id)]));
  const deferred = new Map();
  const renders = [];
  const renderGuards = [];
  let scans = 0;
  let prepares = 0;
  let stages = 0;
  let cacheReads = 0;
  const shortcutMutationAttempts = [];
  let frameTurn = 0;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const frame = () => new Promise(resolve => nativeRaf(() => { frameTurn++; resolve(); }));
  const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
  const afterQueuedPaint = async () => { await frame(); await frame(); await wait(25); };
  const mappingOverrides = new Map();
  const mapped = id => mappingOverrides.get(Number(id)) ?? (Number(id) === ids.a || Number(id) === ids.sibling ? steamIds.a : steamIds.b);
  const titleId = title => Array.from(apps).find(([, app]) => app.display_name === title)?.[0] || null;
  const pendingExit = new WeakSet();
  const nativeHero = document.getElementById('native-hero');
  const nativeLogo = document.getElementById('native-logo');
  const nativeHeader = document.getElementById('native-header');
  const committedRoot = { tag: 3, stateNode: {}, return: null, child: null, alternate: null };
  committedRoot.stateNode.current = committedRoot;
  const committedHost = { tag: 5, memoizedProps: {
    get overview() { return { appid: document.headerId ?? document.routeId }; },
  }, return: committedRoot, child: null, sibling: null, alternate: null };
  committedRoot.child = committedHost;
  nativeHeader.__reactFiber$artworkFixture = committedHost;
  const nativeImageStates = new Map();
  const setNativeImageReady = (image, ready) => {
    if (!nativeImageStates.has(image)) {
      const state = { ready };
      nativeImageStates.set(image, state);
      Object.defineProperties(image, {
        complete: { configurable: true, get: () => state.ready },
        naturalWidth: { configurable: true, get: () => state.ready ? image === nativeHero ? 800 : 160 : 0 },
      });
    } else nativeImageStates.get(image).ready = ready;
  };
  const heroSrc = nativeHero.getAttribute('src');
  const heroPainted = () => {
    const rect = nativeHero.getBoundingClientRect();
    const style = getComputedStyle(nativeHero);
    return nativeHero.isConnected && rect.width > 0 && rect.height > 0 && nativeHero.naturalWidth > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  };
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    '../../api/backend': { backendLog: noop, neutralizeSteamAppIdFileBackend: async () => '' },
    '../../core/game-data': {
      getCachedGameData: id => { cacheReads++; return cached.has(id) ? { data: cached.get(id), fresh: true } : null; },
      getGameData: id => deferred.get(id)?.promise || Promise.resolve(data(id)),
      gameDataCache: {}, gameDataLanguageKey: (id, language) => `${language}:${id}`,
    },
    '../../core/mappings': {
      isMappingSnapshotVerified: () => true,
      mappings: { [`shortcut:${ids.a}`]: steamIds.a, [`shortcut:${ids.b}`]: steamIds.b },
      loadMappings: async () => undefined, saveMappingChecked: async () => undefined,
      shortcutMappingKey: id => `shortcut:${id}`,
    },
    '../../core/perf': { perfMark: noop, perfMeasure: noop },
    '../../steam/localization': { steamLanguageSync: () => 'english' },
    './localization': { steamLanguageSync: () => 'english', loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback },
    '../../steam/navigation': { installSteamNavigation: noop, disposeSteamNavigation: noop },
    '../../steam/library-details': {
      paintedNativePlaybar: (doc, id) => (doc.headerId ?? doc.routeId) === id ? nativeHero : null,
      committedHeaderAppId: element => load('library-details').committedHeaderAppId(element),
    },
    '../../steam/shortcuts': {
      // Match the production resolver's title fallback: an old notice can still
      // resolve its previous shortcut even after the concrete route changes.
      findActiveShortcutAppId: (_doc, title) => String(titleId(title)),
      findShortcutAppIdByName: titleId, findShortcutAppIdsByName: title => [titleId(title)],
      getShortcutAppById: id => apps.get(id), getSteamAppStore: () => ({ m_mapApps: apps }),
      looseMatchTitle: (left, right) => left === right,
    },
    '../../core/text': { normalizeTitle: value => String(value).toLowerCase() },
    './constants': { GDL_INJECTED: 'gdl-library-injected' },
    './news': { getCachedCommunityContent: () => ({ data: [] }), getCachedNews: () => ({ data: [] }) },
    './native-chrome': { ensureNativeGameChrome: noop, getCurrentNativeGameInfo: () => null, removeNativeGameChrome: noop },
    './social': { getCachedFriendData: () => ({ data: null }) },
    './social/feed': { disposeActivityFeedInteractions: noop },
    './social/status': { disposeStatusPostBox: noop },
    './community-view': { disposeCommunitySection: noop },
    './trading-cards': { disposeTradingCardUI: noop },
	'./controller': { disposeControllerSidebarWatcher: noop },
    './sidebar-order': { disposeLinkedSidebarOrder: noop },
    './shortcut-launch-options': { reconcileShortcutLaunchOptions: (...args) => shortcutMutationAttempts.push({ type: 'launch-options', args }) },
    './renderer': { renderLinkedGamePage: (doc, notice, model, id, news, friends, community, context) => {
      if (!context.isCurrent()) return false;
      renders.push({ id, frame: frameTurn });
      renderGuards.push(context.isCurrent);
      doc.getElementById('gdl-library-injected')?.remove();
      doc.getElementById('gdl-link-bar')?.remove();
      const content = doc.createElement('section'); content.id = 'gdl-library-injected';
      content.dataset.gdlLayoutComplete = '1'; content.dataset.gdlSteamAppId = id;
      content.dataset.gdlShortcutAppId = context.shortcutAppId;
      content.textContent = model.name; doc.getElementById('metadata').appendChild(content);
      const links = doc.createElement('div'); links.id = 'gdl-link-bar';
      links.dataset.gdlSteamAppId = id; links.dataset.gdlShortcutAppId = context.shortcutAppId;
      content.appendChild(links);
      return true;
    } },
    './achievement-chrome': { finalizeLinkedAchievements: async () => undefined, warmLocalAchievements: async () => undefined },
    './activity-view': { disposeSharedActivityComposer: noop, parkSharedActivityComposer: noop },
    '../achievements/runtime': { hasCachedLocalAchievements: () => true, cacheLocalAchievements: noop },
    '../achievements/service': { fetchLocalAchievementData: async () => null },
    '../shortcuts/runtime': {
      findMappingForShortcut: mapped, isShortcutDismissed: () => false,
      normalizedShortcutAppId: id => Number(id) >= 2147483648 ? Number(id) : null,
      hasNoLauncherOption: () => false, shouldAutoApplyNoLauncher: () => false,
      mergeNoLauncherOption: value => value, removeIncompatibleLauncherBypass: value => value,
      syncLinkedGameNote: async () => undefined,
    },
    '../shortcuts/registry': { findMappingForShortcut: mapped },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../playtime/tracker': { injectPlaytimeFallbackStats: async () => undefined, removePlaytimeFallbackStats: noop },
    './notice': { findNonSteamNotice: doc => {
      scans++; return { element: doc.getElementById('native-notice'), title: doc.noticeTitle ?? apps.get(doc.routeId)?.display_name ?? '' };
    }, hideNoticeQuick: noop },
    './layout': { restoreNativeLibraryStyles: noop },
    './native-route': {
      isPublicSteamLibraryRoute: doc => doc.routeId > 0 && doc.routeId < 2147483648,
      routedSteamAppId: doc => doc.routeId, libraryRouteIdentity: doc => `app:${doc.routeId}`,
      reconcileLibraryNavigation: (doc, state) => {
        if (state.currentInjectedShortcutAppId !== String(doc.routeId)) state.clearCurrentInjection(doc);
      },
    },
    './manual-link-button': { ensureManualLinkNoticeButton: noop, removeManualLinkNoticeButton: noop },
    './route-exit': {
      beginLibraryRouteExit: doc => pendingExit.add(doc), finishLibraryRouteExit: doc => pendingExit.delete(doc),
      hasOwnedLibraryChrome: doc => Boolean(doc.getElementById('gdl-library-injected')),
      isLibraryRouteExitPending: doc => pendingExit.has(doc), removeOwnedLibraryChrome: noop,
    },
    './loading-stage': {
      warmVisibleLinkedResources: noop,
      syncEarlyLinkedFirstContent: () => null,
      cancelLinkedShortcutLoading: noop, completeLinkedShortcutLoading: noop, cancelLinkedFirstContentPaint: noop,
      stageLinkedShortcutLoading: () => { stages++; }, LINKED_LOADING_SIDEBAR_ID: 'gdl-sidebar-skeleton',
    },
    './hydration': { hydrateLinkedRouteResources: noop },
    './prefetch': { reprioritizeLinkedGame: noop },
    './artwork-sync': { prioritizeShortcutLinkingAndArtwork: (...args) => shortcutMutationAttempts.push({ type: 'linking-artwork-icon', args }) },
    './sidebar-cleanup': { tryRedirectUnownedMappedGame: () => false },
    './info-panel': { removeNativeInfoButton: noop, resetMainScrollToTop: noop },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  let runtime;
  let disposeSidebar;
  try {
    if (!nativeHero.complete) await new Promise(resolve => nativeHero.addEventListener('load', resolve, { once: true }));
    if (!nativeLogo.complete) await new Promise(resolve => nativeLogo.addEventListener('load', resolve, { once: true }));
    setNativeImageReady(nativeHero, true); setNativeImageReady(nativeLogo, true);
    document.routeId = ids.a;
    const artwork = load('native-artwork-ready');
    const nativeHeaderHtml = nativeHeader.outerHTML;
    const nativeArtworkWrites = [];
    const nativeArtworkAudit = new MutationObserver(records => nativeArtworkWrites.push(...records));
    nativeArtworkAudit.observe(nativeHeader, { attributes: true, characterData: true, childList: true, subtree: true });
    const originalImage = window.Image, originalFetch = window.fetch, originalDecode = HTMLImageElement.prototype.decode;
    let helperImageRequests = 0, helperFetchRequests = 0, helperDecodeCalls = 0;
    window.Image = new Proxy(originalImage, { construct() { helperImageRequests++; throw new Error('Artwork readiness must not allocate another Image'); } });
    window.fetch = () => { helperFetchRequests++; throw new Error('Artwork readiness must not fetch native assets'); };
    HTMLImageElement.prototype.decode = () => { helperDecodeCalls++; throw new Error('Artwork readiness must not decode assets again'); };
    try {
      let warmReady = 0;
      const disposeWarm = artwork.waitForNativeArtwork(document, () => warmReady++);
      check(warmReady === 1, 'Already-loaded native hero and logo report readiness synchronously without a fixed loading delay');
      disposeWarm();
      setNativeImageReady(nativeHero, false); setNativeImageReady(nativeLogo, false);
      let pendingReady = 0;
      const disposePending = artwork.waitForNativeArtwork(document, () => pendingReady++);
      await afterQueuedPaint();
      check(pendingReady === 0, 'Two native RAFs alone never mark an unresolved hero/logo request ready');
      setNativeImageReady(nativeHero, true); nativeHero.dispatchEvent(new Event('load'));
      check(pendingReady === 0, 'A loaded hero still waits for the native logo while its image is pending');
      setNativeImageReady(nativeLogo, true); nativeLogo.dispatchEvent(new Event('load'));
      check(pendingReady === 1, 'Native logo load completes the readiness gate exactly once');
      disposePending(); nativeHero.dispatchEvent(new Event('load')); nativeLogo.dispatchEvent(new Event('load'));
      check(pendingReady === 1, 'Settled helper listeners cannot invoke readiness twice');
      await Promise.resolve();
      check(helperImageRequests === 0 && helperFetchRequests === 0 && helperDecodeCalls === 0,
        'The actual readiness helper creates no Image, fetch or decode work');
      check(nativeArtworkWrites.length === 0 && nativeHeader.outerHTML === nativeHeaderHtml,
        'The readiness helper performs zero writes to native hero/logo markup, styles, sources or classes');
    } finally {
      window.Image = originalImage; window.fetch = originalFetch; HTMLImageElement.prototype.decode = originalDecode;
      nativeArtworkAudit.disconnect();
    }
    runtime = load('runtime');
    const sidebar = document.createElement('div');
    sidebar.className = load('css').LIBRARY_SIDEBAR_CLASSES().Container;
    sidebar.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:100px;overflow:auto';
    sidebar.innerHTML = '<div style="height:3000px">Native virtual list</div>';
    document.body.append(sidebar);
    disposeSidebar = load('sidebar-interaction').installLibrarySidebarInteraction(document);
    const immediateWheel = () => sidebar.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 90 }));
    const configure = () => runtime.configureLibraryRuntimeHost({ getMainWindowDoc: () => document,
      prepareLinkedPage: () => { prepares++; }, waitForNativeArtwork: artwork.waitForNativeArtwork });
    configure(); document.routeId = ids.a;
    const pending = Array.from({ length: 100 }, () => runtime.tryInjectLibraryData(document));
    check(scans === 0 && renders.length === 0 && prepares === 0,
      '100 exported injection signals do no metadata scan, preparation or render in the current turn');
    await frame();
    check(scans === 0 && renders.length === 0 && prepares === 0,
      'The first real native RAF contains no metadata work');
    await frame();
    check(scans === 0 && renders.length === 0,
      'The second RAF also leaves work to a later macro task');
    await wait(25); await Promise.all(pending);
    check(renders.length === 1 && renders[0].frame >= 2 && prepares === 1,
      '100 same-route signals coalesce into one cached render after a native paint opportunity');
    check(shortcutMutationAttempts.length === 0,
      'Opening a mapped external game never launches shortcut identity, artwork, icon or launch-options writes');
    check(document.getElementById('native-hero') === nativeHero && nativeHero.getAttribute('src') === heroSrc && heroPainted(),
      'Cached navigation preserves the visible native hero node and source');

    // Deliberately hold the existing native images unresolved for longer than
    // the queue's RAFs. The cached payload is large, but not read or rendered.
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    setNativeImageReady(nativeHero, false); setNativeImageReady(nativeLogo, false);
    const beforeArtwork = { renders: renders.length, scans, prepares, cacheReads, stages };
    let artworkQueueSettled = false;
    const pendingArtwork = Array.from({ length: 100 }, () => runtime.tryInjectLibraryData(document));
    Promise.all(pendingArtwork).then(() => { artworkQueueSettled = true; });
    await afterQueuedPaint(); await wait(180);
    check(!artworkQueueSettled && renders.length === beforeArtwork.renders && scans === beforeArtwork.scans
      && prepares === beforeArtwork.prepares && cacheReads === beforeArtwork.cacheReads && stages === beforeArtwork.stages,
    'An unresolved native hero/logo blocks all 100 heavy cached metadata signals beyond the native paint queue');
    check(cached.get(steamIds.b).detailed_description.length > 500000,
      'The pending-native-artwork regression uses an already-cached substantial metadata payload');
    setNativeImageReady(nativeHero, true); nativeHero.dispatchEvent(new Event('load'));
    await afterQueuedPaint();
    check(renders.length === beforeArtwork.renders && cacheReads === beforeArtwork.cacheReads,
      'The actual runtime keeps heavy cache reads and rendering deferred until the native logo also loads');
    setNativeImageReady(nativeLogo, true); nativeLogo.dispatchEvent(new Event('load'));
    await Promise.all(pendingArtwork);
    check(renders.length === beforeArtwork.renders + 1 && renders.at(-1).id === steamIds.b,
      'The native artwork load releases one coalesced cached render for the exact current route');

    // Returning to the same AppID is a new navigation generation. A previous
    // loaded image and a canceled wait must never authorize its next header.
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    setNativeImageReady(nativeHero, false);
    const beforeArtworkRoundtrip = { renders: renders.length, scans, prepares, cacheReads };
    let canceledArtworkSettled = false;
    const canceledArtwork = runtime.tryInjectLibraryData(document).then(() => { canceledArtworkSettled = true; });
    await afterQueuedPaint();
    check(!canceledArtworkSettled && renders.length === beforeArtworkRoundtrip.renders,
      'A fresh A navigation waits for its pending native hero despite a warm metadata cache');
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    await canceledArtwork;
    check(canceledArtworkSettled && renders.length === beforeArtworkRoundtrip.renders,
      'Navigating away settles and cancels the old pending-artwork metadata queue');
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    let returningArtworkSettled = false;
    const returningArtwork = runtime.tryInjectLibraryData(document).then(() => { returningArtworkSettled = true; });
    await afterQueuedPaint(); await wait(80);
    check(!returningArtworkSettled && renders.length === beforeArtworkRoundtrip.renders
      && scans === beforeArtworkRoundtrip.scans && prepares === beforeArtworkRoundtrip.prepares
      && cacheReads === beforeArtworkRoundtrip.cacheReads,
    'A-to-B-to-A starts a fresh generation-scoped artwork wait rather than reusing readiness for the same AppID');
    setNativeImageReady(nativeHero, true); nativeHero.dispatchEvent(new Event('load'));
    await returningArtwork;
    check(renders.length === beforeArtworkRoundtrip.renders + 1 && renders.at(-1).id === steamIds.a,
      'Only the returning current A generation renders after its hero load; the canceled A wait stays retired');

    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    const beforeImmediateScroll = { renders: renders.length, scans, prepares };
    const scrollingB = runtime.tryInjectLibraryData(document);
    immediateWheel();
    await afterQueuedPaint();
    check(renders.length === beforeImmediateScroll.renders && scans === beforeImmediateScroll.scans && prepares === beforeImmediateScroll.prepares,
      'Selecting an external game then scrolling immediately leaves native list frames free of metadata work');
    for (let index = 0; index < 5; index++) { immediateWheel(); sidebar.scrollTop += 60; await wait(20); }
    check(renders.length === beforeImmediateScroll.renders && heroPainted() && sidebar.isConnected,
      'Rapid continued sidebar scrolling preserves native artwork and does not construct or rescan the details page');
    await wait(210); await scrollingB;
    check(renders.length === beforeImmediateScroll.renders + 1 && renders.at(-1).id === steamIds.b,
      'Only the latest selected game content resumes after scrolling stops');

    const beforeSupersede = renders.length;
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const supersededA = runtime.tryInjectLibraryData(document);
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    const currentB = runtime.tryInjectLibraryData(document);
    await afterQueuedPaint(); await Promise.all([supersededA, currentB]);
    check(renders.length === beforeSupersede && document.getElementById('gdl-library-injected').textContent === 'Game B',
      'A destination superseded by the already-mounted Game B leaves B intact without rebuilding it');
    check(heroPainted() && nativeHero.getAttribute('src') === heroSrc,
      'Superseding queued navigation keeps native artwork painted');

    const beforeDispose = renders.length;
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const disposed = runtime.tryInjectLibraryData(document); runtime.disposeLibraryRuntime();
    await afterQueuedPaint(); await disposed;
    check(renders.length === beforeDispose,
      'Disposing the actual Library runtime cancels pending metadata work');

    configure(); cached.delete(steamIds.a);
    let resolveCold;
    deferred.set(steamIds.a, { promise: new Promise(resolve => { resolveCold = resolve; }) });
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const beforeCold = renders.length;
    const coldA = runtime.tryInjectLibraryData(document);
    await afterQueuedPaint();
    check(stages > 0 && renders.length === beforeCold && heroPainted()
      && document.getElementById('native-hero') === nativeHero && nativeHero.getAttribute('src') === heroSrc,
    'A cold metadata request leaves native artwork visible while its network promise is unresolved');
    immediateWheel();
    resolveCold(data(steamIds.a));
    await wait(30);
    check(renders.length === beforeCold && heroPainted(),
      'A metadata response arriving during immediate sidebar scroll also waits without hiding artwork');
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    const warmB = runtime.tryInjectLibraryData(document);
    await afterQueuedPaint(); await warmB;
    check(renders.at(-1).id === steamIds.b, 'Warm Game B renders while the older cold Game A request is still pending');
    const afterB = renders.length;
    await coldA; await wait(25);
    check(renders.length === afterB && document.getElementById('gdl-library-injected').textContent === 'Game B',
      'Resolving an old cold request cannot replace the current game metadata');
    check(document.getElementById('native-hero') === nativeHero && nativeHero.getAttribute('src') === heroSrc && heroPainted(),
      'Cold-request completion never replaces, reloads or conceals the native artwork');

    // A concrete destination must outrank an old notice and an old React host.
    cached.set(steamIds.a, data(steamIds.a)); deferred.delete(steamIds.a);
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    await runtime.tryInjectLibraryData(document);
    const beforeSplitCommit = renders.length;
    document.routeId = ids.b; document.noticeTitle = 'Game A'; document.headerId = ids.b;
    runtime.handleLibraryNavigation(document);
    await runtime.tryInjectLibraryData(document); await wait(370);
    check(renders.length === beforeSplitCommit && runtime.getCurrentInjectedShortcutAppId() !== String(ids.a),
      'A stale notice never authorizes the previous game after three retries or elapsed time');
    document.noticeTitle = 'Game B'; document.headerId = ids.a;
    await runtime.tryInjectLibraryData(document);
    check(renders.length === beforeSplitCommit,
      'The new route and notice cannot authorize columns under the previous committed native header');
    document.headerId = ids.b;
    await runtime.tryInjectLibraryData(document);
    check(renders.length === beforeSplitCommit + 1 && renders.at(-1).id === steamIds.b,
      'The exact destination renders once as soon as its notice and committed header agree');
    delete document.noticeTitle; delete document.headerId;

    mappingOverrides.set(ids.b, '999');
    check(renderGuards.at(-1)() === false,
      'Relinking the same shortcut immediately rejects the previous public-game payload');
    mappingOverrides.delete(ids.b);

    const beforeNativeGuard = renders.length;
    const externalGuard = renderGuards.at(-1);
    document.routeId = 440;
    check(externalGuard() === false,
      'A live native destination invalidates asynchronous external callbacks before the navigation observer runs');
    await runtime.tryInjectLibraryData(document);
    check(renders.length === beforeNativeGuard && heroPainted() && nativeHero.getAttribute('src') === heroSrc,
      'External to native retirement never renders metadata or changes native artwork');

    // The URL can advance before our observer gets its mutation turn.
    cached.delete(steamIds.a);
    let resolveBeforeObserver;
    deferred.set(steamIds.a, { promise: new Promise(resolve => { resolveBeforeObserver = resolve; }) });
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const beforeObserverRace = renders.length;
    const oldRequest = runtime.tryInjectLibraryData(document);
    await afterQueuedPaint();
    document.routeId = ids.b;
    resolveBeforeObserver(data(steamIds.a)); await oldRequest;
    check(renders.length === beforeObserverRace,
      'A late metadata promise cannot render its previous external destination before observer cancellation');
    deferred.delete(steamIds.a); cached.set(steamIds.a, data(steamIds.a));

    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    await runtime.tryInjectLibraryData(document);
    const oldAGuard = renderGuards.at(-1);
    document.routeId = ids.sibling; runtime.handleLibraryNavigation(document);
    check(oldAGuard() === false,
      'Sibling shortcuts sharing one public AppID invalidate the old shortcut render guard');
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    check(oldAGuard() === false,
      'An A to sibling to A roundtrip never restores authority to the first session callbacks');
    const beforeReturningA = renders.length;
    await runtime.tryInjectLibraryData(document);
    check(renders.length === beforeReturningA && runtime.getCurrentInjectedShortcutAppId() === String(ids.a),
      'Returning to an intact exact cached mount renews its session without rebuilding visible content');
    const beforeUnmapped = { renders: renders.length, scans };
    mappingOverrides.set(ids.b, '');
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    await runtime.tryInjectLibraryData(document);
    check(scans > beforeUnmapped.scans && renders.length === beforeUnmapped.renders && shortcutMutationAttempts.length === 0,
      'Opening an unmapped external game discovers its notice without reprioritizing linking jobs or mutating shortcuts');
    mappingOverrides.delete(ids.b);

    cached.delete(steamIds.b);
    let resolveLateMetadata;
    deferred.set(steamIds.b, { promise: new Promise(resolve => { resolveLateMetadata = resolve; }) });
    const beforeLateMetadata = { renders: renders.length, stages };
    const lateMetadata = runtime.tryInjectLibraryData(document);
    await afterQueuedPaint();
    check(stages > beforeLateMetadata.stages && renders.length === beforeLateMetadata.renders,
      'A cold request begins after the native images are initially ready');
    setNativeImageReady(nativeHero, false);
    resolveLateMetadata(data(steamIds.b));
    await afterQueuedPaint(); await wait(60);
    check(renders.length === beforeLateMetadata.renders,
      'A later metadata response rechecks native artwork readiness before its heavy render');
    setNativeImageReady(nativeHero, true); nativeHero.dispatchEvent(new Event('load'));
    await lateMetadata;
    check(renders.length === beforeLateMetadata.renders + 1 && renders.at(-1).id === steamIds.b,
      'The deferred metadata response renders once after the current native hero finishes loading');
    deferred.delete(steamIds.b); cached.set(steamIds.b, data(steamIds.b));
    check(shortcutMutationAttempts.length === 0,
      'Cached, cold, repeated, sibling and native navigation stay read-only over Steam shortcut identity and artwork');
    runtime.disposeLibraryRuntime();
    disposeSidebar?.();
    const output = document.createElement('pre'); output.id = 'artwork-navigation-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, renders, scans, prepares });
    document.body.appendChild(output);
  } catch (error) {
    runtime?.disposeLibraryRuntime();
    disposeSidebar?.();
    const output = document.createElement('pre'); output.id = 'artwork-navigation-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
    document.body.appendChild(output);
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'artwork-navigation-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'artwork-navigation.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:24px;background:#171d25;color:#dcdedf;font-family:Arial}#native-hero{display:block;width:800px;height:220px;object-fit:cover}#metadata{min-height:32px}pre{font-size:12px;white-space:pre-wrap;max-width:1150px}
</style></head><body><h2>Native artwork before metadata · actual Library runtime</h2>
<header id="native-header" class="_2gZXhRmKUk68pA28-5ZmGQ tXlLvuTxOVL1w3aVPX4bm"><div class="_1IX7FPSY9Jb82KhBVBSkZa"><div class="QlR9EFwTdUNm_J5vx54_Z"><img id="native-hero" alt="Native artwork remains visible" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='220'%3E%3Crect width='800' height='220' fill='%231b5a86'/%3E%3Ctext x='28' y='120' font-size='38' fill='white'%3ENative Steam artwork%3C/text%3E%3C/svg%3E"></div></div><img id="native-logo" class="_3NBxSLAZLbbbnul8KfDFjw" width="160" height="40" alt="Native logo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='40'%3E%3Crect width='160' height='40' fill='%231b5a86'/%3E%3Ctext x='8' y='28' font-size='22' fill='white'%3ENative logo%3C/text%3E%3C/svg%3E"></header>
<div id="native-notice">Native shortcut notice</div><div id="metadata"></div>
<script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1280,900',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError;
child.on('error', error => { browserError = error; });
let socket;
let report;
try {
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  const endpointDeadline = Date.now() + 10_000;
  while (!fs.existsSync(endpointFile) && Date.now() < endpointDeadline) {
    if (browserError) throw browserError;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(fs.existsSync(endpointFile), 'Headless Edge did not publish its local debugging endpoint');
  const port = fs.readFileSync(endpointFile, 'utf8').trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href)
    || targets.find(item => item.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl, 'The spawned Edge fixture has no debug target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const output = document.getElementById('artwork-navigation-result'); if (output) return JSON.parse(output.textContent); await new Promise(resolve => setTimeout(resolve, 20)); } return {ok:false,results:[],error:'Fixture did not finish its real RAF checks'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, `Browser evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
  report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally {
  socket?.close(); child.kill();
}
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Artwork navigation browser passed: ${report.checks} assertions; actual native artwork readiness, zero helper Image/fetch/decode or DOM writes, cached and late-result render gates, generation-scoped cancellation and native hero preservation.`);
console.log(`Screenshot: ${screenshot}`);
