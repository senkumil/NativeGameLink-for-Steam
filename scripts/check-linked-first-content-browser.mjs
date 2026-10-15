import './helpers/installed-steam-check.mjs';
// Real runtime/loading/layout/renderer/activity/feed integration. Remote Store,
// social and optional sidebar services are fixtures; Steam React is not run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.ARTWORK_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(fs.existsSync(edge), 'Installed Edge is required');
const sources = Object.fromEntries([
  ['app', 'frontend/runtime/app.tsx'],
  ['runtime', 'frontend/features/library/runtime.ts'], ['renderer', 'frontend/features/library/renderer.ts'],
  ['layout', 'frontend/features/library/layout.ts'], ['loading-stage', 'frontend/features/library/loading-stage.ts'],
  ['first-content', 'frontend/features/library/first-content.ts'],
  ['activity-view', 'frontend/features/library/activity-view.ts'], ['feed', 'frontend/features/library/social/feed.ts'],
  ['status', 'frontend/features/library/social/status.ts'], ['disposables', 'frontend/core/disposables.ts'],
  ['after-native-paint', 'frontend/core/after-native-paint.ts'], ['navigation-controller', 'frontend/features/library/navigation-controller.ts'],
  ['render-session', 'frontend/features/library/render-session.ts'], ['sidebar-interaction', 'frontend/steam/sidebar-interaction.ts'],
  ['library-sidebar', 'frontend/steam/library-sidebar.ts'], ['library-header', 'frontend/steam/library-header.ts'],
  ['library-details', 'frontend/steam/library-details.ts'], ['native-dom', 'frontend/steam/native-dom.ts'],
  ['native-artwork-ready', 'frontend/features/library/native-artwork-ready.ts'],
  ['activity-styles', 'frontend/features/library/styles/activity.ts'],
  ['status-styles', 'frontend/features/library/styles/status.ts'],
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'], ['text', 'frontend/core/text.ts'],
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText + (name === 'app' ? '\nexports.installPrepaintWindow = context => { appRuntimeLifecycle = new disposables_1.DisposableRegistry(); windowCreated(context); return () => { disposeDocumentLifecycles(); appRuntimeLifecycle.dispose(); appRuntimeLifecycle = null; }; };' : '')]));

async function browserChecks(sources, prepaintOnly = false) {
  const results = [], modules = {}, nativeWrites = [], requests = [], renderLogs = [], remotePosts = [], openedUrls = [], controllerStops = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const noop = () => {}, asyncNoop = async () => {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const paint = async () => { await frame(); await frame(); await wait(35); };
  const until = async (predicate, label) => {
    for (let attempt = 0; attempt < 60 && !predicate(); attempt++) await wait(15);
    check(predicate(), label);
  };
  const capturePhase = async label => {
    window.__linkedContentCapture = label;
    const deadline = Date.now() + 10000;
    while (window.__linkedContentCaptureAck !== label && Date.now() < deadline) await wait(10);
    if (window.__linkedContentCaptureAck !== label) throw new Error(`Visual capture was not acknowledged: ${label}`);
  };
  const ids = { a: 3000000001, b: 3000000002 }, steamIds = { a: '111', b: '222' };
  const names = new Map([[ids.a, 'Game A'], [ids.b, 'Game B']]);
  const mappingOverrides = new Map();
  const mapped = value => mappingOverrides.get(Number(value))
    ?? (Number(value) === ids.a ? steamIds.a : Number(value) === ids.b ? steamIds.b : null);
  const model = id => ({ name: `Game ${id === steamIds.a ? 'A' : 'B'}`, header_image: '', achievements: { total: 0 }, dlc: [], categories: [] });
  const metadata = new Map(), pendingMetadata = new Map(), news = new Map();
  const pendingNews = new Map();
  const deferMetadata = id => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pendingMetadata.set(id, promise);
    return value => resolve(value || model(id));
  };
  const oneNews = { gid: 'news-a', title: 'Actual cached developer announcement', date: 1700000000,
    event_type: 1, contents: 'Actual cached news content', url: 'https://example.invalid/news-a', image: '' };
  news.set(steamIds.a, [oneNews]);
  const localization = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback,
    steamLanguageSync: () => 'english', steamIntlLocale: () => 'en-US' };
  const newsApi = {
    getCachedNews: id => news.has(id) ? { data: news.get(id), fresh: true } : null,
    getCachedCommunityContent: () => ({ data: [], fresh: true }),
    getNews: (id, _language, _data, progress) => {
      requests.push({ type: 'news', id });
      if (typeof _data === 'function') progress = _data;
      if (typeof progress === 'function') pendingNews.set(id, progress);
      return new Promise(() => {});
    },
    newsItemsSignature: items => JSON.stringify((items || []).map(item => [item.gid, item.title])),
    eventTypeLabel: () => 'News', formatNewsDate: () => 'November 2023',
    isPatchNoteItem: () => false, newsExcerpt: value => String(value || '').slice(0, 320),
  };
  const social = {
    getCachedFriendData: () => ({ data: null }),
    renderUnifiedActivityFeedSnapshot: (...args) => load('feed').renderUnifiedActivityFeedSnapshot(...args),
    applyUnifiedActivityFeed: (...args) => load('feed').applyUnifiedActivityFeed(...args),
    setupPostDeleteHandlers: (...args) => load('feed').setupPostDeleteHandlers(...args),
    setupStatusPostBox: (...args) => load('status').setupStatusPostBox(...args),
  };
  // Steam's live CSS exports compose hashed and semantic class tokens. Use the
  // same Enabled value reported by CEF instead of testing only single fallbacks.
  const nativePostClasses = {
    PostTextEntry: '_3x31AgESSlUqX3D4MTHv2m', PostTextEntryArea: '_1JlC29Ic6L-QvL-39X_d-X',
    Controls: '_37e7DrDNmf1FmsMGA5y0A0', Active: '_1_KMhJX-BZ-bohjsJ7i3w3 Active',
    FormattingSpacer: '_33rj8CoAI3J6C0dO_aOwIS', EmoticonButton: 'bACIuqv-b_9TztCczFK19',
    PostButton: '_2JSyABqFEh-v_dwaTnBydR', Label: '_3jvEkfXhmZjvEbkpEv5EsH',
    Enabled: 'bGfjajFo4DI-ULSQxw1KY Enabled',
  };
  const deps = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null,
      getAllModules: () => [{ exports: nativePostClasses }] } },
    '../../api/backend': { backendLog: message => renderLogs.push(message) }, '../../../api/backend': { backendLog: noop },
    '../../core/game-data': { getSynchronousGameData: id => metadata.get(id) || null,
      getCachedGameData: id => metadata.has(id) ? { data: metadata.get(id), fresh: true } : null,
      getGameData: id => { requests.push({ type: 'metadata', id }); return pendingMetadata.get(id) || Promise.resolve(model(id)); },
      gameDataCache: {}, gameDataLanguageKey: (id, lang) => `${lang}:${id}` },
    '../../core/mappings': { mappings: { [`shortcut:${ids.a}`]: steamIds.a, [`shortcut:${ids.b}`]: steamIds.b },
      isMappingSnapshotVerified: () => true, loadMappings: asyncNoop, saveMappingChecked: asyncNoop, shortcutMappingKey: id => `shortcut:${id}` },
    '../../core/perf': { perfMark: noop, perfMeasure: noop },
    '../../steam/localization': localization, '../../../steam/localization': localization, './localization': localization,
    '../../steam/navigation': { installSteamNavigation: noop, disposeSteamNavigation: noop },
    '../../steam/shortcuts': { findActiveShortcutAppId: doc => String(doc.routeId),
      findShortcutAppIdByName: title => [...names].find(([, name]) => name === title)?.[0],
      findShortcutAppIdsByName: title => [...names].filter(([, name]) => name === title).map(([id]) => id),
      getShortcutAppById: id => ({ display_name: names.get(id) }),
      getSteamAppStore: () => ({ m_mapApps: names }), looseMatchTitle: (a, b) => a === b },
    './constants': { GDL_INJECTED: 'gdl-library-injected' }, './news': newsApi, '../news': newsApi,
    './social': social,
    './social/feed': new Proxy({}, { get: (_target, key) => load('feed')[key] }),
    './social/status': new Proxy({}, { get: (_target, key) => load('status')[key] }),
    './feed': new Proxy({}, { get: (_target, key) => key === 'getCurrentSteamUser'
      ? () => ({ name: 'Fixture user', avatar: '' }) : load('feed')[key] }),
    '../../../steam/social': { extractSteamIdFromValue: () => null,
      postStatusUpdate: async (appId, text) => { remotePosts.push({ appId, text }); } },
    '../../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    '../../../steam/gamepad/virtual-keyboard': { showSteamVirtualKeyboard: noop, hideSteamVirtualKeyboard: noop },
    './personas': { getCachedPersona: () => null },
    './host': { socialRuntimeHost: () => ({ getCurrentInjectedAppId: () => null, getCurrentInjectedShortcutAppId: () => null }) },
    './native-chrome': { ensureNativeGameChrome: noop, getCurrentNativeGameInfo: () => null,
      removeNativeGameChrome: noop, steamNativeGameInfo: () => ({}) },
    './community-view': { disposeCommunitySection: noop, insertCommunitySection: () => null,
      communityItemsSignature: () => '', renderCommunityContentHtml: () => '' },
    './trading-cards': { disposeTradingCardUI: noop },
    './achievement-chrome': { finalizeLinkedAchievements: asyncNoop, warmLocalAchievements: asyncNoop },
    './early-achievement-sidebar': { syncEarlyAchievementSidebar: noop, getOwnedAchievementSidebar: () => null, adoptEarlyAchievementSidebar: noop },
    './sidebar-order': { disposeLinkedSidebarOrder: noop, ensureLinkedSidebarOrder: noop },
    '../achievements/runtime': { hasCachedLocalAchievements: () => true, cacheLocalAchievements: noop },
    '../achievements/service': { fetchLocalAchievementData: async () => null },
    '../shortcuts/runtime': { findMappingForShortcut: mapped, isShortcutDismissed: () => false,
      normalizedShortcutAppId: value => Number(value) >= 2147483648 ? Number(value) : null, syncLinkedGameNote: asyncNoop },
    '../shortcuts/registry': { findMappingForShortcut: mapped, getCommittedShortcutSteamAppId: mapped },
    '../../shortcuts/registry': { getCommittedShortcutSteamAppId: mapped },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../playtime/tracker': { injectPlaytimeFallbackStats: asyncNoop, removePlaytimeFallbackStats: noop },
    './notice': { findNonSteamNotice: doc => doc.getElementById('native-notice')
      ? { element: doc.getElementById('native-notice'), title: names.get(doc.routeId) || '' } : null, hideNoticeQuick: noop },
    '../native-route': { routedSteamAppId: doc => doc.routeId },
    './native-route': { isPublicSteamLibraryRoute: doc => doc.routeId > 0 && doc.routeId < 2147483648,
      routedSteamAppId: doc => doc.routeId, libraryRouteIdentity: doc => `app:${doc.routeId}`,
      reconcileLibraryNavigation: (doc, state) => { if (state.currentInjectedShortcutAppId !== String(doc.routeId)) state.clearCurrentInjection(doc); } },
    './manual-link-button': { ensureManualLinkNoticeButton: noop, removeManualLinkNoticeButton: noop },
    './route-exit': { beginLibraryRouteExit: noop, finishLibraryRouteExit: noop, isLibraryRouteExitPending: () => false,
      hasOwnedLibraryChrome: doc => Boolean(doc.querySelector('#gdl-skeleton,#gdl-library-injected')),
      removeOwnedLibraryChrome: doc => doc.querySelectorAll('#gdl-skeleton,#gdl-main-content-stack,#gdl-library-injected,#gdl-link-bar').forEach(node => node.remove()) },
    './hydration': { hydrateLinkedRouteResources: noop }, './prefetch': { reprioritizeLinkedGame: noop },
    './sidebar-cleanup': { tryRedirectUnownedMappedGame: () => false },
    './info-panel': { removeNativeInfoButton: noop, resetMainScrollToTop: noop },
    './cloud-status': { ensureCloudStatus: noop },
    './styles': { ensureNativeGameInfoStyles: doc => {
      load('activity-styles').ensureActivityStyles(doc); load('status-styles').ensureStatusComposerStyles(doc);
    } },
    './inject': { injectLibraryStyle: (doc, id, css) => {
      if (doc.getElementById(id)) return;
      const style = doc.createElement('style'); style.id = id; style.textContent = css; doc.head.appendChild(style);
    } },
    '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility: noop },
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    './artwork': { getModernLibraryAssets: async () => null, getResolvedLibraryAssets: () => null, linkedShortcutPortrait: () => '' },
    './legacy-info-portrait': { legacyInfoPortraitSync: () => '', resolveLegacyInfoPortrait: async () => '' },
    './legacy-games': { isLegacyGame: () => false },
    './sidebar-sections': { renderLinkedSidebarCore: noop, refreshHistoricalSidebarSections: noop },
    './controller': { setupControllerSidebarWatcher: () => noop, getOwnedControllerSidebar: () => null,
		disposeControllerSidebarWatcher: (doc, preserve) => controllerStops.push({ doc, preserve }) },
    './optional-sections': { renderOptionalStoreSections: () => ({ hasWorkshop: false, dlcIds: [] }) },
    './primary-links': {
      createPrimaryLinksBar: doc => { let node = doc.getElementById('gdl-link-bar'); if (!node) { node = doc.createElement('div'); node.id = 'gdl-link-bar'; } return node; },
      insertPrimaryLinksBar: node => document.getElementById('tabs').appendChild(node),
    },
  };
  function load(name) {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in deps) return deps[dependency];
      const key = dependency.split('/').pop();
      if (key in sources) return load(key);
      throw new Error(`Unexpected actual-source dependency ${name}: ${dependency}`);
    }, exports);
    return exports;
  }
  let runtime, audit, disposeApp;
  try {
    const header = document.getElementById('native-header'), hero = document.getElementById('native-hero'), logo = document.getElementById('native-logo');
    const playbar = document.getElementById('native-playbar');
    const root = { tag: 3, stateNode: {}, return: null, child: null, alternate: null }; root.stateNode.current = root;
    const host = { tag: 5, memoizedProps: { get overview() { return { appid: document.routeId }; } },
      return: root, child: null, sibling: null, alternate: null }; root.child = host;
    header.__reactFiber$fixture = host; playbar.__reactFiber$fixture = host;
    const css = load('css').PLAYBAR_CLASSES(); playbar.className = `${css.Container} ${css.InPage}`;
    let artworkReady = false;
    for (const image of [hero, logo]) Object.defineProperties(image, {
      complete: { configurable: true, get: () => artworkReady }, naturalWidth: { configurable: true, get: () => artworkReady ? 800 : 0 },
    });
    const nativeSnapshot = () => JSON.stringify([header.outerHTML, playbar.outerHTML,
      ...[header, hero, logo, playbar].map(node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })]);
    const originalNative = nativeSnapshot();
    const nativeMain = document.querySelector('.main'), nativeSidebar = document.getElementById('native-sidebar');
    document.getElementById('shell').classList.add('_27RcNu8aXKBpYkHcNNrt-X');
    nativeMain.parentElement.classList.add('OhSdLYuggDtBcWjYP0j_9');
    nativeMain.classList.add('_1sZgBDTw5NH-yuVDZK1SUU'); nativeSidebar.classList.add('_2aor4XVOYzN1PBSREk0UbO');
    for (const node of [nativeMain, nativeSidebar, nativeSidebar.querySelector('[role="region"]')]) node.__reactFiber$fixture = host;
    audit = new MutationObserver(records => nativeWrites.push(...records));
    audit.observe(header, { attributes: true, characterData: true, childList: true, subtree: true });
    audit.observe(playbar, { attributes: true, characterData: true, childList: true, subtree: true });
    localStorage.setItem(`gdl_posts_${ids.a}`, JSON.stringify([{ id: 'local-a', text: 'Actual cached local status', timestamp: 1700000002,
      user_name: 'Local user', user_avatar: '' }]));
    const remembered = load('feed').renderUnifiedActivityFeedSnapshot(steamIds.a, String(ids.a), [oneNews], '',
      [{ id: 'friend-a', date: 1700000001, html: '<div data-fixture-friend="1">Actual cached friend activity</div>' }]);
    check(remembered.html.includes('Actual cached friend activity') && remembered.html.includes('Actual cached developer announcement'),
      'The first-content fixture seeds the actual activity snapshot owner with real news, friend activity and local status');
    runtime = load('runtime');
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('.gdl-latest-news-button') : null;
      if (button && !event.defaultPrevented && button.getAttribute('data-gdl-open-url')) openedUrls.push(button.getAttribute('data-gdl-open-url'));
    });
    runtime.configureLibraryRuntimeHost({ getMainWindowDoc: () => document,
      waitForNativeArtwork: load('native-artwork-ready').waitForNativeArtwork });
    document.routeId = ids.a;
    const resolveA = deferMetadata(steamIds.a);
    if (prepaintOnly) {
      const notice = document.getElementById('native-notice'), main = notice.parentElement;
      const sidebar = document.getElementById('native-sidebar');
      const sidebarNative = sidebar.innerHTML;
      const nativeRegion = sidebar.querySelector('[role="region"]');
      main.__reactFiber$fixture = host; sidebar.__reactFiber$fixture = host; nativeRegion.__reactFiber$fixture = host;
      notice.remove();
      const appGeneric = new Proxy({}, { get: (_value, key) => key === '__esModule' ? true : () => noop });
      const appDeps = {
        react: { default: { createElement: () => null } }, '@steambrew/client': { definePlugin: () => null },
        '../features/library/constants': { GDL_INJECTED: 'gdl-library-injected' },
        '../features/library/runtime': runtime, '../core/disposables': load('disposables'), '../core/dom': { mutationIsWithinSelector: record => {
          const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          return Boolean(node?.closest('[id^="gdl-"]')) || [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType !== 1 || node.id?.startsWith('gdl-')); } },
        '../steam/localization': { setLocalizationDocumentProvider: noop },
        '../features/library/native-route': deps['./native-route'],
        '../features/library/route-exit': deps['./route-exit'],
        '../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
        '../features/library/early-playbar': { installEarlyLinkedPlaybar: () => ({ sync: noop, dispose: noop }) },
        '../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
        '../steam/shortcuts': { isSteamLibraryActive: () => true },
        '../features/playtime/library-home': { isDesktopLibraryHomePlaytimeVisible: () => false,
          patchDesktopLibraryHomePlaytime: asyncNoop, syncDesktopLibraryHomePlaytimeDom: noop },
        '../features/library/notice': { mutationMayContainNonSteamNotice: () => false },
        '../features/shortcuts/runtime': { mutationMayContainProperties: () => false, disposeCustomizationArtwork: noop },
        './existing-windows': { resolveSteamWindowContext: () => ({ popupWin: window, popupDoc: document, popupName: 'SP Desktop', popupTitle: 'Steam' }),
          isDesktopSteamWindow: () => true },
      };
      const app = {};
      new Function('require', 'exports', sources.app)(dependency => appDeps[dependency] || appGeneric, app);
      let firstFrameContent = '';
      const firstVisibleFrame = new Promise(resolve => requestAnimationFrame(() => {
        firstFrameContent = document.getElementById('gdl-skeleton')?.textContent || ''; resolve();
      }));
      disposeApp = app.installPrepaintWindow({});
      await firstVisibleFrame; await paint();
      const preview = document.getElementById('gdl-skeleton');
      await capturePhase('prepaint-cached');
      check(firstFrameContent.includes('Actual cached developer announcement')
        && Boolean(preview?.querySelector('#gdl-activity-feed')) && preview.textContent.includes('Actual cached developer announcement'),
        'Committed native columns show cached Activity on the first visible frame even while artwork is pending and the notice has not mounted');
      check(!artworkReady && !document.getElementById('gdl-library-injected') && sidebar.innerHTML === sidebarNative,
        'Light first content leaves pending native artwork and visible Notes/Media unchanged while full metadata construction waits');
      const pending = runtime.tryInjectLibraryData(document);
      check(document.getElementById('gdl-skeleton') === preview,
        'The direct runtime entry retains the same light content while scheduling the artwork-gated heavy commit');
      resolveA(); artworkReady = true; hero.dispatchEvent(new Event('load')); logo.dispatchEvent(new Event('load'));
      await pending; await paint();
      check(document.getElementById('gdl-library-injected') === preview && preview.dataset.gdlLayoutComplete === '1'
        && preview.dataset.gdlSteamAppId === steamIds.a && preview.dataset.gdlShortcutAppId === String(ids.a)
        && !document.getElementById('native-notice'),
        `The heavy production renderer adopts the same cached activity after artwork resolves even if Steam never mounted its shortcut notice (${JSON.stringify({
          previewConnected: preview.isConnected, previewId: preview.id, root: document.getElementById('gdl-library-injected')?.dataset,
          logs: renderLogs, requests, layout: load('layout').discoverNativeLibraryLayoutForShortcut(document, ids.a).contentColumn?.id,
        })})`);
      artworkReady = false;
      const oldSidebar = document.createElement('section'); oldSidebar.id = 'gdl-achievements-section';
      oldSidebar.dataset.gdlSteamAppId = steamIds.a; oldSidebar.dataset.gdlShortcutAppId = String(ids.a);
      oldSidebar.textContent = 'Old A achievement sidebar'; sidebar.prepend(oldSidebar);
      document.routeId = ids.b; runtime.handleLibraryNavigation(document);
      main.appendChild(notice);
      const foreignOwner = { tag: 5, memoizedProps: { overview: { appid: ids.a } }, return: root,
        child: null, sibling: null, alternate: null }; root.child = foreignOwner;
      main.__reactFiber$fixture = foreignOwner; sidebar.__reactFiber$fixture = foreignOwner; nativeRegion.__reactFiber$fixture = foreignOwner;
      news.set(steamIds.b, [{ ...oneNews, gid: 'news-b', title: 'Real B cached announcement' }]);
      const resolveB = deferMetadata(steamIds.b);
      const next = runtime.tryInjectLibraryData(document); await paint();
      check(!document.querySelector(`[data-gdl-shortcut-app-id="${ids.b}"]`),
        'A destination route cannot paint into columns still committed to the previous shortcut');
      root.child = host; main.__reactFiber$fixture = host; sidebar.__reactFiber$fixture = host; nativeRegion.__reactFiber$fixture = host;
      let destinationFrameContent = '';
      const firstDestinationFrame = new Promise(resolve => requestAnimationFrame(() => {
        destinationFrameContent = document.getElementById('gdl-skeleton')?.textContent || ''; resolve();
      }));
      const nativeCommit = document.createElement('div'); nativeCommit.textContent = 'Native destination columns committed'; sidebar.appendChild(nativeCommit);
      await firstDestinationFrame; await paint();
      check(destinationFrameContent.includes('Real B cached announcement')
        && document.getElementById('gdl-skeleton')?.textContent.includes('Real B cached announcement') && !artworkReady,
        'The next native column commit immediately publishes that shortcut cache without waiting for hero image readiness');
      check(!preview.isConnected && !oldSidebar.isConnected && !document.getElementById('gdl-library-injected'),
        'The immediate destination commit retires an old complete root and sidebar pair instead of treating their IDs as current content');
      await capturePhase('prepaint-late-columns');
      document.routeId = 570; runtime.handleLibraryNavigation(document);
      resolveB(); artworkReady = true; hero.dispatchEvent(new Event('load')); logo.dispatchEvent(new Event('load'));
      await pending; await next; await paint();
      check(!document.querySelector('#gdl-skeleton,#gdl-library-injected'),
        'Retired artwork and metadata callbacks never restore linked content on a native destination');
      check(nativeWrites.length === 0 && nativeSnapshot() === originalNative,
        'Immediate first content does not rewrite native header, hero, logo or playbar');
      disposeApp(); disposeApp = null; runtime.disposeLibraryRuntime(); audit.disconnect();
      document.getElementById('result').textContent = JSON.stringify({ ok: true, checks: results.length, results });
      return;
    }
    const previewRoots = new Set();
    let concurrentA;
    const concurrentObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.id === 'gdl-skeleton') previewRoots.add(node);
      }
      // The insertion signal is delivered before the stage's first RAF. This
      // retries the real exported entry while the first stage awaits its paint.
      if (!concurrentA && document.getElementById('gdl-skeleton')) concurrentA = runtime.tryInjectLibraryData(document);
    });
    concurrentObserver.observe(document.querySelector('.main'), { childList: true, subtree: true });
    const pendingA = runtime.tryInjectLibraryData(document);
    await paint();
    check(document.getElementById('gdl-skeleton')?.textContent.includes('Actual cached developer announcement')
      && !document.getElementById('gdl-library-injected'),
      'Cached Activity can paint before native artwork readiness while heavy full-page construction waits');
    artworkReady = true; hero.dispatchEvent(new Event('load')); logo.dispatchEvent(new Event('load'));
    await until(() => Boolean(document.getElementById('gdl-skeleton')), 'The first linked content mounts after native artwork is ready while Store metadata remains unresolved');
    const preview = document.getElementById('gdl-skeleton'), previewFeed = document.getElementById('gdl-activity-feed');
    check(preview && previewFeed && !document.getElementById('gdl-library-injected'), 'The staged activity and its feed have separate incomplete ownership IDs');
    check(preview.textContent.includes('Actual cached developer announcement') && preview.textContent.includes('Actual cached friend activity')
      && preview.textContent.includes('Actual cached local status'), 'The pending Store request immediately shows the actual cached news, friend and local post snapshot');
    check(!preview.querySelector('.gdl-news-pending'), 'A real cached activity snapshot is never replaced with a neutral news loading state');
    await paint();
    concurrentObserver.disconnect();
    check(Boolean(concurrentA) && previewRoots.size === 1 && document.getElementById('gdl-skeleton') === preview,
      'Two same-generation injection signals overlapping the first stage paint retain one staged activity root');
    const textArea = preview.querySelector('textarea'), newsNode = preview.querySelector('#gdl-first-news-item');
    const heading = preview.querySelector('.gdl-ui-activity-heading'), composer = preview.querySelector('.gdl-status-box-container');
    const latestRow = preview.querySelector('.gdl-latest-news-row'), latestButton = preview.querySelector('.gdl-latest-news-button');
    const postButton = preview.querySelector('#gdl-status-post');
    check(heading && composer && latestRow && latestButton && postButton, 'The real staged activity exposes the persistent heading, status composer and latest-news controls');
    const postClasses = load('css').POST_CLASSES();
    check(postClasses.Enabled === nativePostClasses.Enabled && postClasses.Active === nativePostClasses.Active,
      'The real CSS resolver selects composed native Enabled and Active class exports');
    const enabledTokens = nativePostClasses.Enabled.split(/\s+/), activeTokens = nativePostClasses.Active.split(/\s+/);
    const controls = preview.querySelector('#gdl-status-controls');
    check(enabledTokens.every(token => !postButton.classList.contains(token)),
      'Mounting an empty status composer removes every native Enabled token without throwing');
    textArea.focus();
    check(activeTokens.every(token => controls.classList.contains(token)),
      'Focusing the status composer applies every native Active token without a DOMTokenList error');
    textArea.blur(); await wait(80);
    check(activeTokens.every(token => !controls.classList.contains(token)),
      'Blurring an empty status composer removes every native Active token');
    textArea.value = 'Draft survives metadata hydration';
    textArea.dispatchEvent(new Event('input', { bubbles: true }));
    check(enabledTokens.every(token => postButton.classList.contains(token)),
      'Entering a draft enables both native class tokens on the retained post button');
    await wait(260); // Let the focus/blur controls transition finish before comparing geometry.
    const previewRect = preview.getBoundingClientRect(), feedRect = previewFeed.getBoundingClientRect();
    const sidebarRect = document.getElementById('native-sidebar').getBoundingClientRect();
    check(getComputedStyle(document.getElementById('native-sidebar')).float === 'right'
      && Math.abs(previewRect.top - sidebarRect.top) < 0.1 && previewRect.right <= sidebarRect.left,
      'The real first-content stylesheet places the preview beside the native 33% right float instead of below its tall sidebar');
    await capturePhase('first-preview');
    resolveA(); await Promise.all([pendingA, concurrentA]);
    const activity = document.getElementById('gdl-library-injected'), feed = document.getElementById('gdl-activity-feed');
    check(activity === preview && feed === previewFeed, 'The final real renderer adopts the same staged activity and feed nodes');
    check(activity.querySelector('textarea') === textArea && textArea.value === 'Draft survives metadata hydration'
      && activity.querySelector('#gdl-first-news-item') === newsNode, 'Adoption preserves the status draft and cached news element identity');
    const activityRect = activity.getBoundingClientRect(), adoptedFeedRect = feed.getBoundingClientRect();
    check(Math.abs(activityRect.top - previewRect.top) < 0.1 && Math.abs(adoptedFeedRect.top - feedRect.top) < 0.1,
      'Preview adoption preserves activity and feed vertical positions beside the native right float');
    check(Math.abs(activityRect.left - previewRect.left) < 0.1 && Math.abs(activityRect.width - previewRect.width) < 0.1
      && Math.abs(adoptedFeedRect.left - feedRect.left) < 0.1 && Math.abs(adoptedFeedRect.width - feedRect.width) < 0.1,
      `Preview adoption preserves activity and feed widths and horizontal positions with the actual production column stylesheet (activity ${previewRect.width} -> ${activityRect.width}, feed ${feedRect.width} -> ${adoptedFeedRect.width})`);
    check(!document.getElementById('gdl-skeleton') && document.querySelectorAll('#gdl-activity-feed').length === 1, 'Adoption leaves one feed and no duplicate preview IDs');
    check(renderLogs.filter(message => message.startsWith('Injected layout for:')).length === 1,
      'Overlapping first-paint injections finalize one layout without a second root or content rebuild');
    check(activity.dataset.gdlLayoutComplete === '1',
      'Composed native status classes allow the real renderer to finish the layout commit');
    await runtime.tryInjectLibraryData(document); await runtime.tryInjectLibraryData(document);
    check(document.getElementById('gdl-library-injected') === activity && document.getElementById('gdl-activity-feed') === feed
      && renderLogs.filter(message => message.startsWith('Injected layout for:')).length === 1,
      'Repeated stationary refreshes keep the completed activity and feed mounted without rebuilding the game section');
    await capturePhase('first-final');

    document.routeId = ids.b;
    const postsBeforeNav = localStorage.getItem(`gdl_posts_${ids.a}`);
    postButton.click();
    latestButton.click();
    check(remotePosts.length === 0 && localStorage.getItem(`gdl_posts_${ids.a}`) === postsBeforeNav,
      'The old A status listener cannot publish its retained draft after the route becomes B before navigation reconciliation');
    check(openedUrls.length === 0, 'The retained latest-news control cannot open the old A destination after the live route becomes B');
    const stopsBeforeNavigation = controllerStops.length;
    runtime.handleLibraryNavigation(document);
    check(controllerStops.slice(stopsBeforeNavigation).some(stop => stop.doc === document && stop.preserve === true),
      'Navigation immediately stops the old controller subscriptions while leaving DOM retirement to the route owner');
    const resolveB = deferMetadata(steamIds.b);
    const pendingB = runtime.tryInjectLibraryData(document);
    await until(() => Boolean(document.getElementById('gdl-skeleton')), 'A cold linked destination mounts a first-content activity without waiting for Store data');
    const coldPreview = document.getElementById('gdl-skeleton');
    check(coldPreview.querySelector('.gdl-ui-activity-heading') === heading
      && coldPreview.querySelector('.gdl-status-box-container') === composer
      && coldPreview.querySelector('#gdl-status-text') === textArea,
      'A-to-B navigation preserves the actual heading, status box and textarea DOM nodes');
    check(coldPreview.querySelector('.gdl-latest-news-row') === latestRow
      && coldPreview.querySelector('.gdl-latest-news-button') === latestButton,
      'The latest-news row and button preserve DOM identity even while B news is still unknown');
    check(textArea.value === '' && !latestButton.getAttribute('data-gdl-open-url'),
      'Retaining the composer and news controls clears A draft and destination before B content is known');
    check(latestRow.isConnected && getComputedStyle(latestRow).display === 'none',
      'Cold news keeps the same latest-news row mounted and hidden without removing its control');
    check(coldPreview.querySelector('#gdl-activity-feed') !== feed,
      'The game-specific activity feed is replaced independently of the persistent composer shell');
    const neutral = coldPreview.querySelector('.gdl-news-pending');
    check(neutral?.getAttribute('role') === 'status' && Boolean(neutral.closest('[aria-busy="true"]')), 'Unknown cold news has a neutral accessible pending state');
    check(!/0\s*%|0\s*\/\s*\d|Actual cached/.test(coldPreview.textContent), 'Cold initial content invents no zero progress or activity from the previous game');
    check(!document.querySelector('#gdl-achievements-section .gdl-la-summary'), 'The isolated cold path adds no fabricated achievement summary');
    await capturePhase('cold-neutral');
    const progressB = pendingNews.get(steamIds.b);
    check(typeof progressB === 'function', 'The first-content activity subscribes to progressive news independently of Store metadata');
    const newsB = { ...oneNews, gid: 'news-b', title: 'Current Game B first news result', url: 'https://example.invalid/news-b' };
    progressB([newsB]);
    await until(() => coldPreview.textContent.includes(newsB.title), 'The first real news result replaces the neutral cold state before Store data resolves');
    check(document.getElementById('gdl-skeleton') === coldPreview && !coldPreview.querySelector('.gdl-news-pending'),
      'Progressive news updates preserve the staged activity identity and retire only its busy indicator');
    check(coldPreview.querySelector('.gdl-latest-news-button') === latestButton
      && latestButton.getAttribute('data-gdl-open-url') === newsB.url,
      'Progressive B news updates the retained latest-news button to the current B destination');
    latestButton.click();
    check(openedUrls.length === 1 && openedUrls[0] === newsB.url,
      'The retained latest-news button opens only the current Game B destination through delegated navigation');
    textArea.value = 'A new status written for Game B';
    textArea.dispatchEvent(new Event('input', { bubbles: true }));
    const newerNewsB = { ...newsB, gid: 'news-b-newer', date: newsB.date + 100,
      title: 'Newer Game B developer announcement', url: 'https://example.invalid/news-b-newer' };
    progressB([newsB, newerNewsB]);
    await until(() => coldPreview.textContent.includes(newerNewsB.title), 'Later progressive news redraws the current game feed');
    check(coldPreview.querySelector('.gdl-latest-news-row') === latestRow
      && coldPreview.querySelector('.gdl-latest-news-button') === latestButton
      && latestButton.getAttribute('data-gdl-open-url') === newerNewsB.url
      && getComputedStyle(latestRow).display !== 'none'
      && textArea.value === 'A new status written for Game B',
      'News redraw updates the same visible latest-news control to the newest B URL while preserving the current B draft');
    latestButton.click();
    check(openedUrls.length === 2 && openedUrls[1] === newerNewsB.url,
      'The retained latest-news widget follows its newer destination after progressive content redraw');
    postButton.click();
    check(remotePosts.length === 1 && remotePosts[0].appId === Number(steamIds.b)
      && remotePosts[0].text === 'A new status written for Game B',
      'The retained post button invokes only the current B status handler once');
    const storedB = JSON.parse(localStorage.getItem(`gdl_posts_${ids.b}`) || '[]');
    check(storedB.length === 1 && storedB[0].text === 'A new status written for Game B'
      && localStorage.getItem(`gdl_posts_${ids.a}`) === postsBeforeNav,
      'Game B stores only its new status and never receives or modifies the retained Game A draft');
    mappingOverrides.set(ids.b, '333');
    textArea.value = 'Do not publish after relinking the same shortcut';
    postButton.click(); latestButton.click();
    check(remotePosts.length === 1 && openedUrls.length === 2,
      'Relinking the same shortcut invalidates both retained controls before their old metadata context is reconciled');
    mappingOverrides.delete(ids.b);
    textArea.value = 'Do not publish after leaving Game B';
    document.routeId = 570;
    postButton.click();
    latestButton.click();
    check(remotePosts.length === 1, 'The B status listener rejects publishing immediately after the live route changes to a native game');
    check(openedUrls.length === 2, 'The retained latest-news button rejects its old B destination as soon as the live route becomes native');
    runtime.handleLibraryNavigation(document); await runtime.tryInjectLibraryData(document);
    progressB([{ ...newsB, title: 'Late Game B news must stay retired' }]);
    resolveB(); await pendingB; await paint();
    check(!document.querySelector('#gdl-skeleton,#gdl-library-injected,#gdl-loading-news-feed'),
      'Native navigation retires staged linked content and an old Store response cannot mount it again');
    check([heading, composer, latestRow].every(node => node.parentNode === null)
      && textArea.parentElement === composer
      && !textArea.closest('#gdl-main-content-stack,#gdl-skeleton,#gdl-library-injected,#gdl-activity-feed'),
      'Native cleanup parks only the three shared control nodes without retaining old feed, preview or main-stack ancestors');

    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const resolveOldA = deferMetadata(steamIds.a), oldA = runtime.tryInjectLibraryData(document);
    await until(() => Boolean(document.getElementById('gdl-skeleton')), 'The first A generation gets its own staged content');
    const stalePreview = document.getElementById('gdl-skeleton');
    document.routeId = ids.b; runtime.handleLibraryNavigation(document);
    const resolveRoundtripB = deferMetadata(steamIds.b), roundtripB = runtime.tryInjectLibraryData(document);
    await paint();
    document.routeId = ids.a; runtime.handleLibraryNavigation(document);
    const resolveCurrentA = deferMetadata(steamIds.a), currentA = runtime.tryInjectLibraryData(document);
    await until(() => document.getElementById('gdl-skeleton')?.dataset.gdlShortcutAppId === String(ids.a)
      && document.getElementById('gdl-skeleton') !== stalePreview, 'Returning A starts a new first-content generation');
    const returningPreview = document.getElementById('gdl-skeleton');
    check(returningPreview !== stalePreview && !stalePreview.isConnected, 'A-to-B-to-A cannot reuse the old preview ownership session');
    check(returningPreview.querySelector('#gdl-status-text') === textArea
      && textArea.value === 'Draft survives metadata hydration'
      && returningPreview.querySelector('.gdl-latest-news-button') === latestButton
      && latestButton.getAttribute('data-gdl-open-url') === oneNews.url,
      'Returning A restores only its own draft and news destination while retaining the shared controls');
    resolveOldA(); resolveRoundtripB(); await Promise.all([oldA, roundtripB]); await paint();
    check(document.getElementById('gdl-skeleton') === returningPreview && !document.getElementById('gdl-library-injected'),
      'Old A and B metadata responses cannot adopt, replace or finalize the returning A preview');
    resolveCurrentA(); await currentA;
    check(document.getElementById('gdl-library-injected') === returningPreview, 'Only the current A response adopts its current preview');
    await Promise.resolve();
    check(nativeWrites.length === 0 && nativeSnapshot() === originalNative,
      'Preview, cached adoption, cold and ABA/native navigation perform zero native hero/logo/playbar writes or geometry changes');
    const stopsBeforeDispose = controllerStops.length;
    runtime.disposeLibraryRuntime(); audit.disconnect();
    check(controllerStops.length > stopsBeforeDispose && controllerStops.at(-1).doc === document,
      'Plugin runtime disposal closes controller subscriptions even without another linked page render');
    check([heading, composer, latestRow].every(node => node.parentNode === null),
      'Disposing the runtime also detaches retained controls from all former game-content ancestors');
    document.getElementById('result').textContent = JSON.stringify({ ok: true, checks: results.length, results });
  } catch (error) {
    disposeApp?.(); runtime?.disposeLibraryRuntime(); audit?.disconnect();
    document.getElementById('result').textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'linked-first-content-'));
const htmlPath = path.join(scratch, 'fixture.html');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:20px;background:#20252c;color:#dcdedf;font:14px Arial}#shell{width:1100px}#native-header{height:220px;position:relative}#native-hero{width:1100px;height:220px;display:block}#native-logo{position:absolute;left:30px;bottom:25px;width:160px;height:40px}#native-playbar{height:56px;display:block}#tabs{height:36px}.row{display:flow-root}.main{width:100%}.sidebar{float:right;width:33%;height:650px}textarea{box-sizing:border-box;width:100%;height:35px}#result{white-space:pre-wrap;font-size:10px}
</style></head><body><div id="shell"><header id="native-header" class="_2gZXhRmKUk68pA28-5ZmGQ tXlLvuTxOVL1w3aVPX4bm"><div class="_1IX7FPSY9Jb82KhBVBSkZa"><div class="QlR9EFwTdUNm_J5vx54_Z"><img id="native-hero" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1100' height='220'%3E%3Crect width='1100' height='220' fill='%231b5a86'/%3E%3C/svg%3E"></div></div><img id="native-logo" class="_3NBxSLAZLbbbnul8KfDFjw" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='40'%3E%3Crect width='160' height='40' fill='%234b6a86'/%3E%3C/svg%3E"></header><div id="native-playbar">Native playbar remains Steam owned</div><div id="tabs"></div><div class="row"><aside id="native-sidebar" class="sidebar"><div role="region"><h2>Notes</h2><div><div>Native notes remain available</div></div></div></aside><main class="main"><div id="native-notice">Non-Steam shortcut</div></main></div></div><pre id="result"></pre><script>(${browserChecks.toString()})(${serialize(sources)},${process.env.LINKED_PREPAINT_ONLY === '1'});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1280,1000', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError, socket, report;
child.on('error', error => { browserError = error; });
try {
  const endpoint = path.join(profile, 'DevToolsActivePort'), deadline = Date.now() + 10000;
  while (!fs.existsSync(endpoint) && Date.now() < deadline) { if (browserError) throw browserError; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(fs.existsSync(endpoint), 'Headless Edge did not publish an endpoint');
  const port = fs.readFileSync(endpoint, 'utf8').trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000); pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params })); });
  const captured = new Set(), completionDeadline = Date.now() + 20000;
  while (Date.now() < completionDeadline) {
    const value = await call('Runtime.evaluate', { expression: `({phase:window.__linkedContentCapture,finished:document.getElementById('result')?.textContent})`, returnByValue: true });
    assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
    const state = value.result.value;
    if (state.phase && !captured.has(state.phase)) {
      const layout = await call('Page.getLayoutMetrics');
      const size = layout.cssContentSize || layout.contentSize;
      const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
      fs.writeFileSync(path.join(scratch, `${state.phase}.png`), Buffer.from(capture.data, 'base64'));
      captured.add(state.phase);
      await call('Runtime.evaluate', { expression: `window.__linkedContentCaptureAck=${JSON.stringify(state.phase)}` });
    }
    if (state.finished) { report = JSON.parse(state.finished); break; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(report, `First-content fixture did not finish: ${htmlPath}`);
  if (report.ok) assert.deepEqual([...captured], process.env.LINKED_PREPAINT_ONLY === '1'
    ? ['prepaint-cached', 'prepaint-late-columns'] : ['first-preview', 'first-final', 'cold-neutral'], 'Every active first-content state was captured before disposal');
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nPassed: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Linked first-content browser passed: ${report.checks} assertions; actual runtime, loading, renderer, layout and activity snapshots; preview adoption, cold neutral state, native/ABA ownership and zero native artwork writes.`);
for (const name of process.env.LINKED_PREPAINT_ONLY === '1' ? ['prepaint-cached', 'prepaint-late-columns'] : ['first-preview', 'first-final', 'cold-neutral']) console.log(`Screenshot: ${path.join(scratch, `${name}.png`)}`);
