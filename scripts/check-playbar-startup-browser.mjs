import './helpers/installed-steam-check.mjs';
// Real Chromium/Steam-CSS coverage for synchronous playbar startup and observers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || [
  'C:/Program Files (x86)/Steam/steamui/css/sp.css',
  'C:/Program Files (x86)/Steam/steamui/css/chunk~2dcc5aaf7.css',
].find(filename => fs.existsSync(filename));
assert.ok(fs.existsSync(edge), `Edge executable missing: ${edge}`);
assert.ok((steamCss && fs.existsSync(steamCss)), `Installed Steam play-bar CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['playbar-visibility', 'frontend/steam/playbar-visibility.ts'],
  ['achievement-playbar-space', 'frontend/steam/achievement-playbar-space.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['disposables', 'frontend/core/disposables.ts'],
  ['dom', 'frontend/core/dom.ts'],
  ['cloud-status', 'frontend/features/library/cloud-status.ts'],
  ['tracker', 'frontend/features/playtime/tracker.ts'],
  ['format', 'frontend/features/playtime/format.ts'],
  ['early-playbar', 'frontend/features/library/early-playbar.ts'],
  ['native-route', 'frontend/features/library/native-route.ts'],
  ['early-notice', 'frontend/features/library/early-notice.ts'],
  ['native-chrome', 'frontend/features/library/native-chrome.ts'],
  ['playbar', 'frontend/features/achievements/playbar.ts'],
  ['navigation', 'frontend/features/achievements/navigation.ts'],
  ['playbar-achievement-cleanup', 'frontend/features/library/playbar-achievement-cleanup.ts'],
  ['notice', 'frontend/features/library/notice.ts'],
  ['text', 'frontend/core/text.ts'],
].map(([name, filename]) => [name, ts.transpileModule(
  fs.readFileSync(path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText]));

async function browserChecks(sources) {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const flush = () => new Promise(resolve => setTimeout(resolve, 20));
  const modules = {};
  const instant = new Map();
  const requests = new Map();
  let backendRequests = 0;
  let syncCalls = 0;
  let infoPanelCalls = 0;
  let infoButtonCalls = 0;
  const ids = { a: 3000000001, b: 3000000002, c: 3000000003 };
  const apps = new Map(Object.values(ids).map(appid => [appid, {
    appid, display_name: `Shortcut ${appid}`, minutes_playtime_forever: 99999,
    minutes_playtime_last_two_weeks: 999, rt_last_time_played: 1234567890,
  }]));
  const cachedAchievements = { found: true, appid: '1790600', metadata_appid: '1790600',
    state_appid: String(ids.a), total: 50, unlocked: 35, achievements: [] };
  const achievementCache = {
    getCachedLocalAchievementsForGame: id => String(id) === '1790600' ? cachedAchievements : null,
    getCachedLocalAchievementsForShortcut: (id, shortcut) => String(id) === '1790600' && Number(shortcut) === ids.a ? cachedAchievements : null,
    pickCachedLocalAchievementSnapshot: data => data,
  };
  const localization = {
    steamLanguageSync: () => 'english', steamIntlLocale: () => 'en-US',
    loc: (key, fallback) => ({
      AppDetails_SectionTitle_LastPlayed: 'Last played',
      AppDetails_SectionTitle_LastLaunched: 'Last launched',
      AppDetails_SectionTitle_PlayTime: 'Playtime',
    })[key] || fallback,
    gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g,
      (match, name) => String(values[name] ?? match)),
  };
  const service = {
    getInstantPlaytimeStats: id => instant.get(id) || null,
    clearPlaytimeStatsCache() {},
    fetchPlaytimeStats: id => {
      if (!requests.has(id)) {
        backendRequests++;
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        requests.set(id, { promise, resolve });
      }
      return requests.get(id).promise;
    },
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g,
    token => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[token]);
  const mapped = id => Number(id) >= 2147483648 ? Number(id) === ids.b ? '1593500' : '1790600' : null;
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    './localization': localization, '../../steam/localization': localization,
    '../../api/backend': {
      backendLog() {}, startPlaytimeSessionBackend: async () => '',
      pingPlaytimeSessionBackend: async () => '', stopPlaytimeSessionBackend: async () => '',
    },
    './layout': { hideNativeLibraryElement() { throw new Error('Early notice concealment must not alter native inline styles'); } },
    './constants': { GDL_INJECTED: 'gdl-library-injected' },
    './native-artwork-warmup': { warmNativeShortcutArtwork() {} },
    '../shortcuts/runtime': {
      findMappingForShortcut: mapped,
      isShortcutDismissed: () => false,
    },
    '../shortcuts/registry': { findMappingForShortcut: mapped, getCommittedShortcutSteamAppId: mapped },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../../steam/navigation': { openSteamNavigationUrl() {} },
    '../../steam/shortcuts': { getMappedShortcuts: () => [], getShortcutAppById: id => apps.get(id) },
    '../../core/mappings': { findMappingForTitle: (_title, id) => mapped(id), findShortcutIdForMappedSteamAppId: () => null, subscribeMappings: () => () => {} },
    '../achievements/cache': achievementCache, './cache': achievementCache,
    './modal': { openLocalAchievementsModal: async () => {} },
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    './service': service,
    './playtime-settings': { isShortcutPlaytimeTrackingEnabled: () => true },
    './library-home': {
      isDesktopLibraryPlaytimeHydrated: () => false,
      setDesktopPlaytimeField: (app, key, value) => {
        if (app[key] === value) return false;
        app[key] = value;
        return true;
      },
    },
    './styles': { ensureNativeGameInfoStyles() {} },
    './native-game-model': { steamNativeGameInfo() { throw new Error('This test supplies its exact semantic model'); } },
    './info-panel': {
      ensureNativeInfoPanel() { infoPanelCalls++; },
      ensureNativeInfoButton() { infoButtonCalls++; },
      removeNativeInfoButton() {}, removeNativeInfoPanel() {}, clearNativeInfoSessionState() {},
    },
    './primary-links': { findNativePlaybar: doc => doc.getElementById('fixture-playbar') },
    './early-primary-links': { syncEarlyLinkedPrimaryLinks() {}, disposeLinkedPrimaryLinks() {} },
    './early-game-info': { syncEarlyLinkedGameInfo() {}, disposeEarlyLinkedGameInfo() {} },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
    '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: (_doc, _key, task) => Promise.resolve(task()) },
    './sidebar-cleanup': { isLibrarySidebarMutation: () => false },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (name === 'playbar' && dependency === './format') return { localAchievementPercent: data => Math.round(100 * data.unlocked / data.total) };
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  let startup;
  let audit;
  const hostNodes = [];
  const commitHost = (node, id) => {
    const state = {};
    const previousRoot = { tag: 3, stateNode: state, return: null };
    const currentRoot = { tag: 3, stateNode: state, return: null, alternate: previousRoot };
    previousRoot.alternate = currentRoot; state.current = currentRoot;
    const previousOwner = { tag: 0, memoizedProps: { overview: { appid: id } }, return: previousRoot };
    const currentOwner = { tag: 0, memoizedProps: { overview: { appid: id } }, return: currentRoot, alternate: previousOwner };
    previousOwner.alternate = currentOwner;
    const host = { tag: 5, flags: 0, alternate: null, memoizedProps: { className: node.className }, return: previousOwner };
    previousRoot.child = previousOwner; currentRoot.child = currentOwner;
    previousOwner.child = currentOwner.child = host;
    node.__reactFiber$fixture = host;
  };
  try {
    const nativeWindow = { LocationPathName: `/library/app/${ids.a}` };
    window.uiStore = { GetActiveWindowInstance: () => nativeWindow, currentGameListSelection: { nAppId: ids.a } };
    Object.defineProperty(document, 'routeId', { get: () => window.uiStore.currentGameListSelection.nAppId,
      set: id => { window.uiStore.currentGameListSelection = { nAppId: id }; nativeWindow.LocationPathName = `/library/app/${id}`;
        for (const node of hostNodes) commitHost(node, id); } });
    document.routeId = ids.a;
    const css = load('css');
    const native = load('native-dom');
    const tracker = load('tracker');
    const originalSync = tracker.syncEarlyLinkedPlaytime;
    tracker.syncEarlyLinkedPlaytime = doc => { syncCalls++; return originalSync(doc); };
    const early = load('early-playbar');
    const formatter = load('format');
    const ps = css.PLAYBAR_CLASSES();
    const classes = (...keys) => keys.map(key => ps[key]).filter(Boolean).join(' ');
    const playbar = document.createElement('div');
    playbar.id = 'fixture-playbar';
    playbar.className = classes('Container', 'InPage');
    const row = document.createElement('div');
    row.className = '_1YbtIWcfkQJOysLXQbwzRf _3CYvy-LZ_Y81QV0QU3lj1c';
    const section = document.createElement('div');
    section.className = ps.GameStatsSection;
    const stat = (kind, label, detail) => {
      const element = document.createElement('div');
      element.className = classes('GameStat', kind, 'Visible');
      element.innerHTML = `<div class="${classes('HideWhenNarrow', 'GameStatRight')}">`
        + `<div class="${ps.PlayBarLabel}">${label}</div><div class="${ps.PlayBarDetailLabel}">${detail}</div></div>`;
      return element;
    };
    const nativeLastPlayed = stat('LastPlayed', 'Last played', 'Steam stale last date');
    const nativePlaytime = stat('Playtime', 'Playtime', 'Steam stale 99999 hours');
    const reserve = document.createElement('div');
    reserve.className = ps.PlayBarCloudStatusContainer;
    for (let index = 0; index < 4; index++) {
      const hidden = stat('LastPlayed', 'Cloud status', 'Native reserve synchronized');
      hidden.classList.remove(ps.Visible);
      hidden.classList.add(ps.SuperimposedGridItems);
      reserve.appendChild(hidden);
    }
    section.append(nativeLastPlayed, nativePlaytime, reserve);
    const fixedOuter = document.createElement('div');
    fixedOuter.className = '_2L3s2nzh7yCnNESfI5_dN1';
    const fixedPlaybar = document.createElement('div');
    fixedPlaybar.className = `${ps.Container} _39RheXihcN6H2k2muQTjkI`;
    const fixedRow = document.createElement('div');
    fixedRow.className = row.className;
    const fixedStats = document.createElement('div');
    fixedStats.className = ps.GameStatsSection;
    hostNodes.push(playbar, section, fixedPlaybar, fixedStats);
    for (const node of hostNodes) commitHost(node, ids.a);
    fixedStats.appendChild(reserve.cloneNode(true));
    fixedRow.appendChild(fixedStats);
    fixedPlaybar.appendChild(fixedRow);
    fixedOuter.appendChild(fixedPlaybar);
    document.getElementById('fixture').appendChild(fixedOuter);
    const playButton = document.createElement('button');
    playButton.textContent = 'Play';
    row.appendChild(playButton);
    playbar.appendChild(row);
    document.getElementById('fixture').appendChild(playbar);
    const noticeHost = document.createElement('div');
    noticeHost.className = '_2jPMy2QZr8bWi6yrk5ZzHA';
    const notice = document.createElement('div');
    notice.className = '_2K2bYzcKrhqLqDp0Jy6Ksz';
    notice.textContent = `Some detailed information on Shortcut ${ids.a} is unavailable because it is a non-Steam game or mod. `
      + 'Steam will still manage launching the game for you and in most cases the in-game overlay will be available.';
    noticeHost.appendChild(notice);
    document.getElementById('fixture').appendChild(noticeHost);
    const detailOf = element => native.elementsWithCssModuleClass(element, ps.PlayBarDetailLabel)[0];
    const playtimeDetail = detailOf(nativePlaytime);
    const lastDetail = detailOf(nativeLastPlayed);
    const reserveText = reserve.textContent;
    startup = early.installEarlyLinkedPlaybar(document);
    const nativeChrome = load('native-chrome');
    nativeChrome.ensureNativeGameChrome(document, { key: '1790600' });
    check(infoPanelCalls === 1 && infoButtonCalls === 1 && nativeChrome.getCurrentNativeGameInfo()?.key === '1790600',
      'The actual native-chrome coordinator reaches its info button and panel for a shared bailout host');
    check(load('native-route').routedSteamAppId(document) === ids.a && !/appid=|\/app\/|\/details\//.test(location.href),
      'Real Steam uiStore resolves the first destination while the desktop document URL contains no AppID');
    check(getComputedStyle(notice).display === 'none' && notice.textContent.includes('non-Steam'),
      'The native shortcut explanation is hidden synchronously without deleting its discovery text');
    check(load('notice').findNonSteamNotice(document)?.title === `Shortcut ${ids.a}`,
      'Real localized notice discovery still resolves the concealed explanation for the later metadata renderer');
    const replacementNotice = notice.cloneNode(true);
    notice.replaceWith(replacementNotice);
    check(getComputedStyle(replacementNotice).display === 'none',
      'A native React replacement of the explanation is concealed by CSS before any asynchronous observer');
    const mainNotice = document.createElement('div');
    mainNotice.className = '_1TGl52GwsFQg3CXUYvThP-';
    mainNotice.textContent = replacementNotice.textContent;
    noticeHost.after(mainNotice);
    check(getComputedStyle(mainNotice).display === 'none',
      'The actual nonsteam Body variant is also hidden at insertion, before an observer callback');
    const initialCloud = document.querySelector('[data-gdl-cloud-status="1"]');
    const initialCloudStat = initialCloud?.firstElementChild;
    const ownedStats = initialCloud?.parentElement;
    check(Boolean(initialCloud) && Boolean(ownedStats)
      && ownedStats.dataset.gdlCloudStats === '1' && playbar.contains(initialCloud)
      && !fixedStats.contains(initialCloud),
    'With only a visible Play button and a hidden fixed stats host, cold Cloud mounts in its own visible in-page row');
    check(native.isRenderedElement(document, initialCloud)
      && getComputedStyle(fixedOuter).opacity === '0',
    'The partial first mount remains visible while the earlier fixed header retains zero opacity');
    row.replaceChildren(section);
    startup.sync();
    check(document.querySelector('[data-gdl-cloud-status="1"]') === initialCloud
      && initialCloud.firstElementChild === initialCloudStat
      && initialCloud.parentElement === section && !ownedStats.isConnected,
    'Native stats hydration migrates the same Cloud wrapper and removes its temporary row without reloading');
    check(playtimeDetail.textContent === '—' && lastDetail.textContent === '—',
      'Cold startup masks provisional Steam playtime and date synchronously before pending backend work');
    const cloud = document.querySelector('[data-gdl-cloud-status="1"]');
    const cloudStat = cloud && native.findVisibleCloudStatusStat(cloud);
    check(Boolean(cloudStat) && native.isRenderedElement(document, cloudStat),
      'Cold startup mounts visible synchronized Cloud in the same synchronous pass');
    check(reserve.textContent === reserveText,
      'Playtime synchronization preserves hidden Cloud labels and reserve details');
    const initialAchievements = section.querySelector('[data-gdl-playbar-achievements="1"]');
    check(Boolean(initialAchievements) && initialAchievements.textContent.includes('35/50'),
      'Cached achievements join Cloud and canonical time in the first synchronous pass without metadata IPC');
    check(backendRequests === 1 && requests.has(ids.a), 'Cold startup launches one deferred canonical lookup');
    check(early.installEarlyLinkedPlaybar(document) === startup,
      'Repeated installation returns the same document-scoped observer');
    await flush();
    native.saveNativeUiBlueprint(native.NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime, nativePlaytime);
    startup.sync();
    await flush();
    let achievementWrites = [];
    audit = new MutationObserver(records => { achievementWrites.push(...records); });
    audit.observe(section, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 100; index++) startup.sync();
    await flush();
    achievementWrites.push(...audit.takeRecords());
    check(achievementWrites.length === 0 && section.contains(initialAchievements),
      '100 cached-achievement syncs preserve the same stat, medal, text and learned typography without DOM writes');
    audit.disconnect();

    const preserved = load('playbar-achievement-cleanup').removeObsoletePlaybarAchievements(document, true);
    check(preserved && section.querySelector('[data-gdl-playbar-achievements="1"]') === initialAchievements,
      'Metadata cleanup preserves the exact first-paint achievement node in its committed shortcut host');

    const warm = { minutesForever: 120, minutesLastTwoWeeks: 15, lastPlayedAt: 1791849600, totalSeconds: 7200 };
    instant.set(ids.b, warm);
    const beforeBCommit = [playtimeDetail.textContent, lastDetail.textContent];
    nativeWindow.LocationPathName = `/library/app/${ids.b}`;
    window.uiStore.currentGameListSelection = { nAppId: ids.b };
    startup.sync();
    check(playtimeDetail.textContent === beforeBCommit[0] && lastDetail.textContent === beforeBCommit[1],
      'Advancing the shortcut route never rewrites the previous committed host');
    // React may reuse these nodes and update only its committed props: no DOM
    // mutation then wakes discovery. The bounded settle must still run.
    for (const node of hostNodes) commitHost(node, ids.b);
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(playtimeDetail.textContent === formatter.formatPlaytimeMinutes(warm.minutesForever)
      && lastDetail.textContent === formatter.formatLastPlayedDate(warm.lastPlayedAt),
      'Cloud from the previous game cannot cancel the frame that handles a props-only React commit');
    document.routeId = ids.b;
    startup.sync();
    check(!section.contains(initialAchievements), 'The previous game achievement count is removed before painting a destination with no snapshot');
    const expectedPlaytime = formatter.formatPlaytimeMinutes(warm.minutesForever);
    const expectedDate = formatter.formatLastPlayedDate(warm.lastPlayedAt);
    check(playtimeDetail.textContent === expectedPlaytime && lastDetail.textContent === expectedDate,
      'Warm confirmed cache paints correct playtime/date immediately, even below stale Steam counters');
    check(backendRequests === 2 && requests.has(ids.b), 'Changing shortcut starts only its own canonical lookup');
    requests.get(ids.a).resolve({ minutesForever: 77777, minutesLastTwoWeeks: 777, lastPlayedAt: 1234567890 });
    await flush();
    check(playtimeDetail.textContent === expectedPlaytime && lastDetail.textContent === expectedDate,
      'A delayed response for shortcut A cannot overwrite the currently selected shortcut B');
    requests.get(ids.b).resolve(warm);
    await flush();
    await flush();

    let recorded = [];
    audit = new MutationObserver(records => { recorded.push(...records); });
    audit.observe(section, { attributes: true, childList: true, characterData: true, subtree: true });
    const stableRequestCount = backendRequests;
    const stableCloud = cloud;
    const stablePlaytimeNode = playtimeDetail.firstChild;
    for (let index = 0; index < 100; index++) startup.sync();
    await flush();
    recorded.push(...audit.takeRecords());
    check(recorded.length === 0 && backendRequests === stableRequestCount
      && document.querySelector('[data-gdl-cloud-status="1"]') === stableCloud
      && playtimeDetail.firstChild === stablePlaytimeNode,
    '100 stable sync calls preserve native text nodes and Cloud with zero DOM writes or new backend requests');

    const beforeCharacterSync = syncCalls;
    playtimeDetail.firstChild.data = 'Steam rewrote provisional history';
    await flush();
    check(syncCalls > beforeCharacterSync && playtimeDetail.textContent === expectedPlaytime,
      'Native characterData changes trigger scoped synchronization and restore the canonical value');
    const beforeStyleSync = syncCalls;
    playbar.style.paddingLeft = '1px';
    await flush();
    check(syncCalls > beforeStyleSync, 'A playbar ancestor style change triggers scoped synchronization');
    const beforeSplitterDrag = syncCalls;
    for (let step = 0; step < 60; step++) {
      const beforeFrame = syncCalls;
      for (let signal = 0; signal < 8; signal++) {
        playbar.style.paddingLeft = `${2 + (step * 8 + signal) % 7}px`;
        // Separate MutationObserver deliveries within the same paint frame,
        // as a splitter can receive several pointer events before painting.
        await Promise.resolve();
      }
      check(syncCalls === beforeFrame, 'A burst of splitter style callbacks does not synchronously rescan the playbar');
      await new Promise(requestAnimationFrame);
      check(syncCalls === beforeFrame + 1, 'One rendered drag frame performs one playbar synchronization');
    }
    check(syncCalls - beforeSplitterDrag === 60, '480 real style observer deliveries perform only 60 playbar refreshes');
    playbar.style.paddingLeft = '1px';
    await flush();
    const beforeClassSync = syncCalls;
    playbar.classList.add('FixtureClassTransition');
    await flush();
    check(syncCalls > beforeClassSync, 'A playbar ancestor class change triggers scoped synchronization');

    recorded = [];
    audit.takeRecords();
    const beforeObservedSyncs = syncCalls;
    for (let index = 0; index < 100; index++) {
      playbar.classList.toggle('FixtureObserverTick');
      await flush();
    }
    recorded.push(...audit.takeRecords());
    check(syncCalls >= beforeObservedSyncs + 100 && recorded.length === 0
      && backendRequests === stableRequestCount && playtimeDetail.firstChild !== null
      && document.querySelector('[data-gdl-cloud-status="1"]') === stableCloud,
    '100 real observer callbacks cause no recursive DOM writes or new backend requests');
    audit.disconnect();

    document.routeId = ids.a;
    startup.sync();
    check(section.querySelector('[data-gdl-playbar-achievements="1"]')?.textContent.includes('35/50'),
      'Returning to a shortcut restores its exact cached progress synchronously');
    document.routeId = ids.c;
    startup.sync();
    check(!section.querySelector('[data-gdl-playbar-achievements="1"]'),
      'A second shortcut linked to the same Steam game never inherits the first shortcut progress');
    requests.get(ids.c).resolve({ minutesForever: 0, minutesLastTwoWeeks: 0, lastPlayedAt: null });
    document.routeId = ids.b;
    startup.sync();
    await flush();

    const zero = { minutesForever: 0, minutesLastTwoWeeks: 0, lastPlayedAt: null, totalSeconds: 0 };
    instant.set(ids.b, zero);
    requests.set(ids.b, { promise: Promise.resolve(zero), resolve() {} });
    startup.sync();
    check(playtimeDetail.textContent === formatter.formatPlaytimeMinutes(0) && lastDetail.textContent === '—',
      'A confirmed zero cache remains authoritative over older Steam history on the first pass');
    await flush();
    instant.set(ids.b, warm);
    requests.set(ids.b, { promise: Promise.resolve(warm), resolve() {} });
    startup.sync();
    await flush();
    document.routeId = 123;
    startup.sync();
    check(getComputedStyle(replacementNotice).display !== 'none' && !document.documentElement.hasAttribute('data-gdl-linked-route'),
      'Navigating to a native Steam destination immediately retires the linked-only notice concealment');
    check(getComputedStyle(mainNotice).display !== 'none', 'The main notice selector is inactive outside a verified shortcut route');
    const beforeNative = section.outerHTML;
    const publicBlueprint = nativePlaytime.outerHTML;
    const infoCallsBeforeNative = infoButtonCalls + infoPanelCalls;
    nativeChrome.ensureNativeGameChrome(document, { key: '1790600' });
    check(infoButtonCalls + infoPanelCalls === infoCallsBeforeNative,
      'A public Steam route does not reach any info button or panel creation');
    instant.set(ids.a, { minutesForever: 8888, lastPlayedAt: 1234567890 });
    nativeWindow.LocationPathName = `/library/app/${ids.a}`;
    window.uiStore.currentGameListSelection = { nAppId: ids.a };
    startup.sync();
    nativeChrome.ensureNativeGameChrome(document, { key: '1790600' });
    check(section.outerHTML === beforeNative && nativePlaytime.outerHTML === publicBlueprint,
      'A shortcut URI ahead of React cannot insert any stats or rewrite the still-native game host');
    check(infoButtonCalls + infoPanelCalls === infoCallsBeforeNative,
      'A shortcut URI ahead of a native React commit cannot authorize either info control');
    for (const node of hostNodes) commitHost(node, ids.a);
    startup.sync();
    check(section.querySelector('[data-gdl-playbar-achievements="1"]')?.textContent.includes('35/50'),
      'The same pending shortcut can add its exact cached achievements as soon as React commits its own host');
    nativeChrome.ensureNativeGameChrome(document, { key: '1790600' });
    check(infoButtonCalls + infoPanelCalls === infoCallsBeforeNative + 2,
      'The same committed shortcut restores its info controls after the native host has changed ownership');
    document.routeId = ids.b;
    startup.sync();
    startup.dispose();
    const disposedSyncCalls = syncCalls;
    playbar.classList.toggle('FixtureAfterDispose');
    await flush();
    check(syncCalls === disposedSyncCalls, 'Disposal removes scoped playbar observation');
    window.scrollTo(0, 0);
    const painted = element => {
      const rect = element.getBoundingClientRect();
      let opacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        opacity *= Number(style.opacity);
      }
      return rect.width > 0 && rect.height > 0 && opacity > 0.95;
    };
    check([playtimeDetail, lastDetail, cloudStat].every(painted),
      'Final playtime, date and Cloud are painted through every ancestor with real Steam CSS');
    native.clearNativeUiBlueprints(); nativeLastPlayed.remove(); nativePlaytime.remove();
    load('tracker').syncEarlyLinkedPlaytime(document);
    const fallbackTime = section.querySelector('[data-gdl-stat="playtime"]');
    const fallbackLast = section.querySelector('[data-gdl-stat="last-played"]');
    const fallbackClock = fallbackTime?.querySelector(`.${ps.GameStatIcon}`);
    check(fallbackTime && fallbackLast && fallbackClock && !fallbackTime.querySelector(`.${ps.GameStatIconForced}`),
      'The actual cold fallback uses Steam ordinary playtime icon classes instead of its always-visible Cloud icon');
    const originalTime = fallbackTime.cloneNode(true), originalLast = fallbackLast.cloneNode(true), originalCloud = cloud.cloneNode(true);
    for (const element of [originalTime, originalLast, originalCloud]) {
      for (const node of [element, ...element.querySelectorAll('*')]) for (const attribute of [...node.attributes]) {
        if (attribute.name.startsWith('data-gdl') || attribute.name === 'id') node.removeAttribute(attribute.name);
      }
    }
    section.append(originalTime, originalLast, originalCloud);
    native.saveNativeUiBlueprint(native.NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime, originalTime);
    check(native.buildNativePlaybarStatBlueprint(document, 'playtime', 'Playtime', '2 hours')?.querySelector(`.${ps.GameStatIcon}`),
      'A genuine ordinary-icon native Playtime blueprint is accepted without requiring a forced icon');
    const outer = document.getElementById('fixture'), visibility = load('playbar-visibility');
    for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const width of [600, 800, 885, 1500]) {
      outer.style.width = `${width}px`; outer.style.zoom = String(zoom);
      outer.classList.toggle('NarrowRightPanel', width <= 884); outer.classList.toggle('UltraNarrowRightPanel', width <= 600);
      visibility.preserveLinkedPlaybarVisibility(document);
      const cloudCopy = cloud.querySelector(`.${ps.HideWhenNarrow}`), oracleCopy = originalCloud.querySelector(`.${ps.HideWhenNarrow}`);
      check(getComputedStyle(cloudCopy).display === getComputedStyle(oracleCopy).display
        && getComputedStyle(fallbackClock).display === getComputedStyle(originalTime.querySelector(`.${ps.GameStatIcon}`)).display
        && getComputedStyle(fallbackLast).display === getComputedStyle(originalLast).display,
        `Production fallback Cloud, Playtime and LastPlayed follow native visibility at ${width}px and zoom ${zoom}`);
      check((getComputedStyle(cloudCopy).display === 'none') === (width <= 884)
        && (getComputedStyle(fallbackClock).display === 'none') === (width <= 884)
        && (getComputedStyle(fallbackLast).display === 'none') === (width <= 600),
        `The actual native 884/600 logical breakpoints control icon, text and complete-stat visibility at zoom ${zoom}`);
    }
    originalTime.remove(); originalLast.remove(); originalCloud.remove(); outer.style.zoom = ''; outer.style.width = '';
    outer.classList.remove('NarrowRightPanel', 'UltraNarrowRightPanel');
    const output = document.createElement('pre');
    output.id = 'playbar-startup-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results,
      backendRequests, observerSyncCalls: syncCalls, playtime: playtimeDetail.textContent,
      lastPlayed: lastDetail.textContent, cloud: cloud.textContent.trim() });
    document.body.appendChild(output);
  } catch (error) {
    audit?.disconnect();
    startup?.dispose();
    const output = document.createElement('pre');
    output.id = 'playbar-startup-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
    document.body.appendChild(output);
  }
}

const scratchRoot = path.join(root, 'scratch');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'playbar-startup-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'playbar-startup.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:24px;background:#24282f;color:#dcdedf;font-family:Arial,sans-serif}#fixture{width:100%;min-height:120px}#playbar-startup-result{font-size:12px;white-space:pre-wrap;max-width:1100px}</style>
</head><body class="DesktopUI"><h2>First-frame playbar · installed Steam CSS</h2><div id="fixture"></div>
<script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1280,720',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError, socket, report;
child.on('error', error => { browserError = error; });
try {
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  const endpointDeadline = Date.now() + 10_000;
  let endpoint = '';
  while (Date.now() < endpointDeadline) {
    if (browserError) throw browserError;
    try {
      endpoint = fs.readFileSync(endpointFile, 'utf8');
      if (/^\d+\r?\n.+/.test(endpoint)) break;
    } catch (error) {
      if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(endpoint, /^\d+\r?\n.+/, 'Headless Edge did not publish a readable local debugging endpoint');
  const port = endpoint.trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
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
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const output = document.getElementById('playbar-startup-result'); if (output) return JSON.parse(output.textContent); await new Promise(resolve => setTimeout(resolve, 20)); } return {ok:false,results:[],error:'Fixture did not finish real RAF checks'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, `Browser evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
  report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Playbar startup browser passed: ${report.checks} assertions; cold/warm first pass, route guards, native text/class/style observers, 100 stable syncs and 100 callbacks without writes or new backend requests.`);
console.log(`Screenshot: ${screenshot}`);
