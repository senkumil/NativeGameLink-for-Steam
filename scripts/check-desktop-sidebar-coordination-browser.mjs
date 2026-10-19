import './helpers/installed-steam-check.mjs';
// Production desktop column/section coordination against installed Steam CSS.
// Routes, controller SDK and content payloads are fixtures; no account writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const literalExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/pure-class-factory.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: literalExports });
const native = Object.fromEntries([69359, 19819, 15334, 21154, 74173].map(id => {
  const classes = literalExports.readPureClassFactory(factories[id]);
  assert(classes, `Installed native CSS module ${id} has a pure literal contract`);
  return [id, classes];
}));
const files = {
  'sidebar-order': 'frontend/features/library/sidebar-order.ts',
  'sidebar-sections': 'frontend/features/library/sidebar-sections.ts',
  controller: 'frontend/features/library/controller.ts',
  'controller-svgs': 'frontend/features/library/controller-svgs.ts',
  'controller-style': 'frontend/features/library/styles/controller.ts',
  'early-achievement-sidebar': 'frontend/features/library/early-achievement-sidebar.ts',
  layout: 'frontend/features/library/layout.ts',
  'primary-links': 'frontend/features/library/primary-links.ts',
  'primary-links-layout': 'frontend/features/library/primary-links-layout.ts',
  'primary-links-style': 'frontend/features/library/styles/primary-links.ts',
  'activity-style': 'frontend/features/library/styles/activity.ts',
  'native-dom': 'frontend/steam/native-dom.ts',
  'library-header': 'frontend/steam/library-header.ts',
  'library-details': 'frontend/steam/library-details.ts',
  'native-route': 'frontend/features/library/native-route.ts',
  'render-session': 'frontend/features/library/render-session.ts',
  'achievement-navigation': 'frontend/features/achievements/navigation.ts',
  'class-module-cache': 'frontend/steam/class-module-cache.ts',
  css: 'frontend/steam/css.ts', text: 'frontend/core/text.ts', dom: 'frontend/core/dom.ts',
  'steam-links': 'frontend/core/steam-links.ts',
  renderer: 'frontend/features/library/renderer.ts',
  'first-content': 'frontend/features/library/first-content.ts',
  'after-native-paint': 'frontend/core/after-native-paint.ts',
  'optional-sections': 'frontend/features/library/optional-sections.ts',
  friends: 'frontend/features/library/social/friends.ts',
};
const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><head></head><body style="margin:0;background:#19212a;color:#dcdedf;font-family:Arial"></body></html>');
  await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
  const report = await page.evaluate(async ({ sources, native }) => {
    const checks = [], modules = {}, callbacks = new Set(), actions = [], assetRequests = [], chromeCalls = [], personaRequests = [];
    let tradingCardDisposals = 0;
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const noop = () => {};
    const col = native[69359], section = native[19819], heading = native[15334], linksCss = native[21154];
    const ids = { a: 3000000001, b: 3000000002, sibling: 3000000003, native: 570, unlinked: 3000000004 };
    const mappings = new Map([[ids.a, '1790600'], [ids.b, '49520'], [ids.sibling, '1790600']]);
    let selected = ids.a, generation = 0, connected = true, achievementTotal = 50;
    const route = { LocationPathName: `/library/app/${selected}` };
    window.uiStore = { GetActiveWindowInstance: () => route };
    const register = callback => { callbacks.add(callback); return () => callbacks.delete(callback); };
    window.ControllerStore = { GetControllers: () => connected ? [{ bConnected: true, eControllerType: 45, strName: 'DualSense Wireless Controller' }] : [] };
    window.SteamClient = { Input: { RegisterForControllerListChanges: register, RegisterForControllerStateChanges: register,
      RegisterForActiveControllerChanges: register }, Apps: { ShowControllerConfigurator: id => actions.push(id) } };
    const text = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'english' };
    const cache = (steam, shortcut) => achievementTotal ? { found: true, appid: steam, metadata_appid: steam,
      state_appid: String(shortcut), total: achievementTotal, unlocked: Number(shortcut) === ids.sibling ? 7 : 29,
      achievements: [{ name: 'FIRST', display_name: `Local ${shortcut}`, earned: true }] } : null;
    const renderAchievement = (doc, data) => {
      const target = doc.getElementById('gdl-achievements-content');
      const key = `${data.state_appid}:${data.unlocked}:${data.total}`;
      if (target && target.dataset.fixtureSnapshot !== key) {
        target.dataset.fixtureSnapshot = key;
        const text = `${data.unlocked}/${data.total} Local ${data.state_appid}`;
        if (target.querySelector('.gdl-la-summary')?.textContent !== text) target.innerHTML = `<div class="gdl-la-summary">${text}</div>`;
      }
    };
    const injected = (doc, id, value) => { if (doc.getElementById(id)) return; const style = doc.createElement('style'); style.id = id; style.textContent = value; doc.head.appendChild(style); };
    const dependencies = {
      '@steambrew/client': { findClassModule: () => null },
      './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
      '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRequire: () => null, getAllModules: () => [] } },
      '../../steam/modules/SteamModuleResolver': { getSteamStore: () => null },
      '../../api/backend': { backendLog: noop }, '../../steam/localization': text, './localization': text,
      '../../../api/backend': { backendLog: noop, fetchFriendPersonasBackend: () => new Promise(resolve => personaRequests.push(resolve)) },
      '../../../steam/localization': text,
      '../../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: async (_doc, _key, task) => task() },
      '../../../steam/social': { extractSteamIdFromValue: String, fetchFriendsGameplayInfo: async () => null },
      '../../../core/cache': { CACHE_TTL: {}, CACHE_RETENTION: {}, cacheGet: () => null, cacheRead: () => null, cacheSet: noop },
      './personas': { cachePersona: noop, getCachedPersona: () => null, hasCachedPersona: () => false },
      '../../core/game-data': { getCachedGameData: () => null, getSynchronousGameData: () => ({ achievements: { total: achievementTotal } }),
        getGameData: async id => ({ name: `DLC ${id}`, type: 'dlc', steam_appid: Number(id), header_image: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }) },
      '../../steam/gamepad/stores/AppStoreAdapter': { AppStoreAdapter: { getAppOverview: () => ({ controller_support: 2, ps5_controller_support: 1 }) } },
      '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
      '../../steam/sidebar-interaction': { isLibrarySidebarInteractionActive: () => false,
        runWhenLibrarySidebarIdle: async (_doc, _key, task) => task() },
      '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility: noop },
      '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => mappings.get(Number(id)) || null,
        findMappingForShortcut: id => mappings.get(Number(id)) || null },
      '../shortcuts/dismissed': { isShortcutDismissed: () => false },
      './constants': { GDL_INJECTED: 'gdl-library-injected' }, './notice': { findNonSteamNotice: () => document.getElementById('notice') },
      './historical-sidebar': { buildHistoricalSidebarSections: () => [] },
      './social': { friendDataSignature: data => JSON.stringify(data), renderFriendsSection: data => `<div>Local friends ${data.totalCount}</div>`, setupPostDeleteHandlers: noop,
        applyUnifiedActivityFeed: (feed, _steam, _shortcut, news) => { feed.textContent = news.map(item => item.title).join(' '); } },
      './social/feed': { getRetainedActivityNews: () => [], disposeActivityFeedInteractions: noop },
      './social/status': { disposeStatusPostBox: noop },
      './news': { getCachedNews: () => ({ fresh: true, data: [{ gid: 'fixture', title: 'Cached real activity' }] }),
        getNews: async () => [{ gid: 'fixture', title: 'Cached real activity' }] },
      './artwork': { getResolvedLibraryAssets: () => null, linkedShortcutPortrait: () => '',
        getModernLibraryAssets: () => new Promise(resolve => assetRequests.push(resolve)) },
      './legacy-info-portrait': { legacyInfoPortraitSync: () => '', resolveLegacyInfoPortrait: async () => '' },
      './native-chrome': { ensureNativeGameChrome: () => chromeCalls.push(selected), removeNativeGameChrome: noop, steamNativeGameInfo: () => ({}) },
      './legacy-games': { isLegacyGame: () => false },
      './trading-cards': { renderOfficialTradingCards: async () => {}, disposeTradingCardUI: () => { tradingCardDisposals++; } },
      './community-view': { disposeCommunitySection: noop, insertCommunitySection: () => null,
        communityItemsSignature: () => '', renderCommunityContentHtml: () => '' },
      './activity-view': { parkSharedActivityComposer: noop, wireActivityView: noop, refreshActivityNewsLink: noop,
        createActivityView: (doc, _layout, options) => { const node = doc.createElement('div'); node.id = 'gdl-library-injected';
          node.dataset.gdlSteamAppId = options.steamAppId; node.dataset.gdlShortcutAppId = options.shortcutAppId;
          node.innerHTML = region('ACTIVITY', false); node.querySelector('.' + section.Body).innerHTML = '<div id="gdl-activity-feed">Cached real activity</div>'; return node; } },
      './styles': { ensureNativeGameInfoStyles: doc => load('activity-style').ensureActivityStyles(doc) },
      './inject': { injectLibraryStyle: injected },
      '../../steam/navigation': { openSteamNavigationUrl: (_doc, url) => actions.push(url) },
    };
    const aliases = { './styles/controller': 'controller-style', './styles/primary-links': 'primary-links-style',
      '../achievements/navigation': 'achievement-navigation' };
    const achievement = { getCachedLocalAchievementsForShortcut: cache, getCachedLocalAchievementsForGame: steam => cache(steam, selected),
      renderLocalAchievementSidebar: renderAchievement, renderLocalAchievementSidebarHtml: data => `<div class="gdl-la-summary">${data.unlocked}/${data.total} Local ${data.state_appid}</div>`,
      renderPendingAchievementSidebarHtml: () => '<div class="gdl-la-summary">Loading</div>',
      ensureLocalAchievementSidebarResponsiveGrid: noop, ensureAchievementSidebarStyles: noop, ensureAchievementModalStyles: noop,
      openLocalAchievementsModal: async () => {} };
    function load(name) {
      if (modules[name]) return modules[name];
      const exports = modules[name] = {};
      new Function('require', 'exports', sources[name])(dependency => {
        if (dependency in dependencies) return dependencies[dependency];
        if (dependency === '../achievements/cache' || dependency === '../achievements/sidebar') return achievement;
        if (dependency === '../achievements/styles/sidebar') return { ensureAchievementSidebarStyles: noop };
        if (dependency === '../achievements/runtime') return { ...achievement, ...load('achievement-navigation') };
        const key = aliases[dependency] || dependency.split('/').pop();
        if (key in sources) return load(key);
        throw Error(`Unexpected ${name} dependency ${dependency}`);
      }, exports);
      return exports;
    }
    const css = load('css'), pb = css.PLAYBAR_CLASSES();
    const nativeHeading = title => `<h2 class="${native[74173].Reset} ${heading.SectionHeader} ${heading.PadLeft}"><div class="${heading.Label}"><div class="${heading.LabelText}">${title}</div></div></h2>`;
    const region = (title, right = true) => `<div role="region" class="${section.AppDetailsSection}">${nativeHeading(title)}<div class="${section.AppDetailsSectionContainer} ${section.AppDetailsSectionHasLabel} ${right ? section.RightColumnSection : ''}"><div class="${section.Body}" style="min-height:48px">${title} native content</div></div></div>`;
    document.body.innerHTML = `<main id="host" class="${col.Container}" style="width:1300px;margin:30px auto"><section id="native-header" class="_2gZXhRmKUk68pA28-5ZmGQ"><div id="playbar" class="${pb.Container} ${pb.InPage}" style="position:relative!important;height:65px!important;min-height:65px!important"><button>JUGAR</button><div class="${pb.GameStatsSection}">Native stats</div></div></section><div id="columns" class="${col.ColumnContainer}"><aside id="sidebar" class="${col.RightColumn}"></aside><div id="main" class="${col.LeftColumn}"><div id="notice">Non-Steam game</div></div></div></main><main id="oracle" class="${col.Container}" style="width:1300px;margin:30px auto"><div id="oracle-links" class="${section.AppDetailsSection} ${linksCss.LinksSection}"><div id="oracle-links-body" class="${section.AppDetailsSectionContainer} ${section.RightColumnSection}"><div class="${section.Body} ${linksCss.LinksSectionBody}"><div class="${linksCss.Links}" style="height:44px"></div></div></div></div><div class="${col.ColumnContainer}"><aside id="oracle-right" class="${col.RightColumn}">${region('Notes')}</aside><div id="oracle-left" class="${col.LeftColumn}">${region('ACTIVITY', false)}</div></div></main>`;
    document.getElementById('native-header').classList.add('tXlLvuTxOVL1w3aVPX4bm');
    const host = document.getElementById('host'), column = document.getElementById('sidebar'), main = document.getElementById('main');
    const header = document.getElementById('native-header'), playbar = document.getElementById('playbar');
    function commitFiber(node, appid, name) {
      const state = {}, previousRoot = { tag: 3, stateNode: state, return: null }, root = { tag: 3, stateNode: state, return: null, alternate: previousRoot };
      previousRoot.alternate = root; state.current = root;
      const owner = { tag: 0, memoizedProps: { overview: { appid }, ...(name ? { name } : {}) }, return: root };
      root.child = owner; const fiber = { tag: 5, flags: 0, memoizedProps: { className: node.className }, return: owner };
      owner.child = fiber; node.__reactFiber$fixture = fiber;
    }
    const labels = { controller: 'Controller', mastersubincluded: 'Included with', friends: 'Friends who play', additionalcontent: 'Additional Content', achievements: 'Achievements', notes: 'Notes', cards: 'Trading Cards', dlc: 'DLC', workshop: 'Steam Workshop', screenshots: 'Recordings & Screenshots', review: 'My Review' };
    const nativeNode = kind => { const node = document.createElement('div'); node.id = `native-${kind}`; node.className = col.SeekTarget;
      node.innerHTML = region(labels[kind] || 'Unknown native section'); commitFiber(node, selected, kind === 'unknown' ? null : kind); return node; };
    let anchor;
    const setNative = kinds => { for (const node of [...column.children]) if (!node.id.startsWith('gdl-')) node.remove();
      for (const kind of kinds) column.appendChild(nativeNode(kind));
      anchor = column.querySelector('[role=region]'); };
    const layoutModule = load('layout'), ordering = load('sidebar-order'), sections = load('sidebar-sections'), controller = load('controller'), early = load('early-achievement-sidebar'), primary = load('primary-links');
    load('activity-style').ensureActivityStyles(document);
    const layout = () => ({ anchorRegion: anchor, sidebarColumn: column, twoColumnRow: document.getElementById('columns'), contentColumn: main, noticeParent: document.getElementById('notice') });
    let lease, cleanup;
    const target = () => ({ steamAppId: mappings.get(selected), shortcutAppId: String(selected) });
    const commit = id => { selected = id; generation++; route.LocationPathName = `/library/app/${id}`;
      for (const node of [header, playbar, column, document.getElementById('notice'), ...column.querySelectorAll('[role=region]')]) commitFiber(node, id); };
    const currentOwner = () => { const captured = generation; return () => generation === captured && mappings.has(selected); };
    const install = (friendCount = 0) => {
      const owner = { ...target(), generation, isCurrent: currentOwner() };
      lease = ordering.ensureLinkedSidebarOrder(document, layout(), owner);
      sections.renderLinkedSidebarCore(document, layout(), { ...owner, data: { name: 'Fixture', achievements: { total: achievementTotal } }, friendResult: friendCount ? { totalCount: friendCount } : null });
      cleanup?.(); cleanup = controller.setupControllerSidebarWatcher(document, layout(), owner.steamAppId, owner.shortcutAppId, owner.isCurrent);
      return owner;
    };
    const ownedNode = (kind, id) => { const node = document.createElement('div'); node.id = id; node.className = col.SeekTarget; node.innerHTML = region(labels[kind]); return node; };
    const publish = (kind, id) => { const node = ownedNode(kind, id); check(lease.publish(node, kind), `Current ${kind} producer publishes into its owned column`); return node; };
    const ordered = () => [...column.children].map(node => node.id.startsWith('gdl-') ? ({ 'gdl-controller-section': 'controller', 'gdl-friends-section': 'friends', 'gdl-achievements-section': 'achievements', 'gdl-trading-cards-section': 'cards', 'gdl-dlc-section': 'dlc', 'gdl-workshop-section': 'workshop' })[node.id] : node.id.slice(7)).filter(kind => kind && kind !== 'unknown');
    const assertOrder = message => { const ranks = ordered().map(kind => ordering.LINKED_SIDEBAR_ORDER.indexOf(kind)); check(ranks.every((rank, index) => !index || ranks[index - 1] <= rank), `${message}: all present sections follow Steam's canonical order`); };
    const nativeStable = originals => originals.every(([node, html]) => node.isConnected && node.outerHTML === html)
      && [...column.children].filter(node => !node.id.startsWith('gdl-')).every((node, index) => node === originals[index]?.[0]);
    const retired = [];
    let mutations = 0;
    const moveObserver = new MutationObserver(records => { mutations += records.filter(record => record.type === 'childList').length; });
    try {
      for (const subset of [['controller'], ['friends'], ['cards', 'dlc', 'workshop'], ['screenshots'], ['notes'], ['additionalcontent', 'review']]) {
        setNative(subset); commit(ids.a);
        const found = layoutModule.discoverNativeLibraryLayout(document, document.getElementById('notice'));
        check(found.sidebarColumn === column && found.contentColumn === main && found.anchorRegion === anchor,
          `Discovery uses the actual column topology with only ${subset.join('/')} present`);
      }
      commitFiber(column, ids.b);
      check(!layoutModule.discoverNativeLibraryLayout(document, document.getElementById('notice')).anchorRegion,
        'A new shortcut notice cannot adopt the still-committed previous-game sidebar');
      setNative(['notes', 'screenshots']); commit(ids.a);
      const pendingNotice = document.getElementById('notice'); pendingNotice.remove();
      const pendingHero = document.createElement('img'); pendingHero.className = '_3NBxSLAZLbbbnul8KfDFjw';
      Object.defineProperties(pendingHero, { complete: { get: () => false }, naturalWidth: { get: () => 0 } });
      header.prepend(pendingHero); header.classList.remove('tXlLvuTxOVL1w3aVPX4bm'); header.after(playbar);
      const firstContent = load('first-content');
      firstContent.syncEarlyLinkedFirstContent(document, generation, currentOwner());
      const cachedActivity = document.getElementById('gdl-skeleton'), prepaintControl = document.getElementById('gdl-controller-section');
      const prepaintAchievement = document.getElementById('gdl-achievements-section');
      check(Boolean(cachedActivity?.textContent.includes('Cached real activity') && prepaintControl && prepaintAchievement),
        'The light production entry synchronously publishes Activity, Controller and cached Achievements with an unloaded header, pending hero and no notice');
      check(getComputedStyle(header).opacity === '0' && !pendingHero.complete && pendingHero.naturalWidth === 0
        && load('library-details').paintedNativePlaybar(document, selected) === playbar,
        'Installed Steam CSS keeps the artwork header unloaded while its exact committed sibling playbar is already painted');
      const firstPaint = await new Promise(resolve => requestAnimationFrame(() => resolve({
        activity: document.getElementById('gdl-skeleton'), control: document.getElementById('gdl-controller-section'),
        achievement: document.getElementById('gdl-achievements-section'), order: ordered().join(','),
        notesTop: document.getElementById('native-notes').getBoundingClientRect().top,
        achievementsTop: prepaintAchievement.getBoundingClientRect().top,
      })));
      check(firstPaint.activity === cachedActivity && firstPaint.control === prepaintControl && firstPaint.achievement === prepaintAchievement,
        'The first visible frame retains all three upper content blocks without waiting for any image');
      check(firstPaint.order === 'controller,achievements,notes,screenshots' && firstPaint.notesTop > firstPaint.achievementsTop,
        'Notes and Media never paint above the already-known Controller and Achievements during the artwork barrier');
      firstContent.clearLinkedFirstContent(document); ordering.disposeLinkedSidebarOrder(document); controller.disposeControllerSidebarWatcher(document);
      for (const node of [...column.children]) if (node.id.startsWith('gdl-')) node.remove();
      document.getElementById('gdl-main-content-stack')?.remove(); layoutModule.restoreNativeLibraryStyles(document);
      pendingHero.remove(); header.appendChild(playbar); header.classList.add('tXlLvuTxOVL1w3aVPX4bm'); main.appendChild(pendingNotice);
      setNative(['friends', 'notes', 'screenshots', 'review']); commit(ids.a);
      install(); publish('cards', 'gdl-trading-cards-section'); publish('dlc', 'gdl-dlc-section'); publish('workshop', 'gdl-workshop-section');
      assertOrder('Initial mixed native/plugin column');
      const root = document.createElement('div'); root.id = 'gdl-library-injected'; root.dataset.gdlSteamAppId = target().steamAppId; root.dataset.gdlShortcutAppId = String(selected); root.innerHTML = region('ACTIVITY', false);
      const stack = document.createElement('div'); stack.id = 'gdl-main-content-stack'; stack.appendChild(root);
      layoutModule.prepareNativeLibraryLayout(layout()); layoutModule.insertMainContent(stack, layout(), new Set(['gdl-main-content-stack']));
      const bar = primary.createPrimaryLinksBar(document, layout(), { ...target(), hasWorkshop: true, hasDlc: true }); primary.insertPrimaryLinksBar(bar, layout(), root);
      check(bar.isConnected && load('library-details').committedHeaderAppId(playbar) === selected, 'Real primary-link ownership accepts a committed shortcut header');
      const existing = [...column.children], originals = existing.filter(node => !node.id.startsWith('gdl-')).map(node => [node, node.outerHTML]);
      moveObserver.observe(column, { childList: true, subtree: true });
      for (let tick = 0; tick < 100; tick++) { sections.renderLinkedSidebarCore(document, layout(), { ...target(), generation, isCurrent: currentOwner(), data: { name: 'Fixture', achievements: { total: 50 } }, friendResult: null }); lease.reconcile(); controller.syncControllerSidebarSection(document, layout(), target().steamAppId, String(selected)); }
      mutations += moveObserver.takeRecords().filter(record => record.type === 'childList').length;
      check(mutations === 0 && existing.every((node, index) => column.children[index] === node), '100 warm producer/coordinator updates preserve every section without DOM moves or detachments');
      check(nativeStable(originals), 'Warm synchronization leaves native friend/media/notes/review markup and relative positions byte-identical');
      moveObserver.disconnect();
      const lateNotes = nativeNode('additionalcontent'); column.insertBefore(lateNotes, column.querySelector('#native-notes')); await frame(); assertOrder('Late native additional-content insertion');
      const unknown = nativeNode('unknown'); column.insertBefore(unknown, lateNotes); const unknownBefore = unknown.outerHTML;
      column.querySelector('#native-notes').remove(); await frame(); assertOrder('Native notes removal');
      check(unknown.isConnected && unknown.outerHTML === unknownBefore, 'An unknown native region remains intact through repairs');
      const newNotes = nativeNode('notes'); column.insertBefore(newNotes, column.querySelector('#native-screenshots')); await frame(); assertOrder('Native notes return');
      newNotes.querySelector('.' + section.Body).textContent = 'Native live update'; await frame();
      check(newNotes.textContent.includes('Native live update'), 'Native subtree updates remain Steam-owned during reconciliation');
      connected = false; for (const cb of [...callbacks]) cb(); await frame(); check(!document.getElementById('gdl-controller-section'), 'Confirmed hot-unplug removes the controller without disturbing other sections');
      connected = true; for (const cb of [...callbacks]) cb(); await frame(); assertOrder('Controller reconnect');
      for (const width of [1300, 940, 650]) for (const zoom of [0.8, 1, 1.25, 1.5]) {
        const narrow = width === 940, ultra = width === 650;
        host.style.width = `${width}px`; document.getElementById('oracle').style.width = `${width}px`;
        for (const node of [host, document.getElementById('oracle')]) { node.style.zoom = String(zoom); node.classList.toggle('NarrowWindow', narrow); node.classList.toggle('UltraNarrowRightPanel', ultra); }
        primary.insertPrimaryLinksBar(bar, layout(), root); window.dispatchEvent(new Event('resize')); await frame();
        const oracleGap = document.querySelector('#oracle-right h2').getBoundingClientRect().top - document.getElementById('oracle-links-body').getBoundingClientRect().bottom;
        const ownTop = column.querySelector('h2').getBoundingClientRect().top, ownGap = ownTop - bar.firstElementChild.getBoundingClientRect().bottom;
        check(Math.abs((ownGap - oracleGap) / zoom) <= 1.1, `width${width}/zoom${zoom}: sidebar top gap equals the same native visible-links-body boundary`);
        if (!ultra) check(Math.abs((root.querySelector('h2').getBoundingClientRect().top - ownTop) / zoom) <= 1.1,
          `width${width}/zoom${zoom}: both column headings start at the same native baseline`);
        assertOrder(`width${width}/zoom${zoom}`);
      }
      host.style.width = '1300px'; host.style.zoom = '1'; host.classList.remove('NarrowWindow', 'UltraNarrowRightPanel');
      stack.remove(); layoutModule.restoreNativeLibraryStyles(document);
      const renderer = load('renderer'), notice = document.getElementById('notice');
      const context = { ...target(), generation, isCurrent: currentOwner() };
      firstContent.stageLinkedFirstContent(document, notice, generation, context);
      const earlyControl = document.getElementById('gdl-controller-section'), earlyAchievements = document.getElementById('gdl-achievements-section');
      const earlySummary = earlyAchievements.querySelector('.gdl-la-summary');
      const beforeAdoption = earlyAchievements.getBoundingClientRect().toJSON();
      const adoption = new MutationObserver(noop); adoption.observe(column, { childList: true, subtree: true });
      const metadata = { name: 'Full metadata fixture', achievements: { total: 50 }, categories: [{ id: 30 }], dlc: [700] };
      check(renderer.renderLinkedGamePage(document, notice, metadata, target().steamAppId, [], null, [], context),
        'The complete production renderer adopts the early content through real layout discovery');
      check(document.getElementById('gdl-controller-section') === earlyControl && document.getElementById('gdl-achievements-section') === earlyAchievements
        && earlyAchievements.querySelector('.gdl-la-summary') === earlySummary
        && Math.abs(earlyAchievements.getBoundingClientRect().top - beforeAdoption.top) < 1.1,
        'Early-to-full metadata adoption preserves sidebar nodes, summary and measured top position');
      check(!adoption.takeRecords().some(record => [...record.removedNodes].some(node => node === earlyControl || node === earlyAchievements || node.contains(earlySummary))),
        'The real renderer never detaches the early controller or achievement during metadata adoption');
      firstContent.clearLinkedFirstContent(document);
      check(ordering.getLinkedSidebarOrder(document, layout(), target().steamAppId, String(selected))?.isCurrent(),
        'The full renderer renews the coordinator guard before the early loading session is retired');
      await frame();
      const stableSidebar = [...column.children], card = document.getElementById('gdl-trading-cards-section');
      const retainedImage = document.createElement('img'); retainedImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; card.appendChild(retainedImage);
      const focused = document.createElement('button'); focused.textContent = 'Focused card action'; card.appendChild(focused); focused.focus();
      const disposalCount = tradingCardDisposals;
      check(renderer.renderLinkedGamePage(document, notice, metadata, target().steamAppId, [], null, [], context), 'A same-pair full metadata update remains renderable');
      check(stableSidebar.every((node, index) => column.children[index] === node) && card.contains(retainedImage)
        && document.activeElement === focused && tradingCardDisposals === disposalCount,
        'Same-pair full rendering preserves every sidebar node, live card image, focus and card lifecycle');
      check(!adoption.takeRecords().some(record => [...record.removedNodes].some(node => stableSidebar.some(owned => node === owned || node.contains(owned)))),
        'A repeated full render performs no sidebar section detachments'); adoption.disconnect();
      const friends = load('friends');
      const friendData = { totalCount: 1, recentlyPlayed: [{ steamid: '76561198000000001', minutes_played_recently: 42, minutes_played: 42 }], previouslyPlayed: [], wishlisted: [] };
      const friendCommit = friends.hydrateFriendPersonas(document, friendData, target().steamAppId, metadata.name, context);
      check(!document.getElementById('gdl-friends-section') && personaRequests.length === 1, 'Late friend data awaits personas without changing the mounted column');
      personaRequests.shift()('[]'); await friendCommit; await frame();
      const lateFriend = document.getElementById('gdl-friends-section');
      check(lateFriend?.parentElement === column && lateFriend.dataset.gdlShortcutAppId === String(selected),
        'Production friend hydration discovers the native column after the explanation is hidden and publishes an owned section');
      assertOrder('Late production friend hydration');
      await friends.hydrateFriendPersonas(document, null, target().steamAppId, metadata.name, context);
      check(document.getElementById('gdl-friends-section') === lateFriend, 'Unavailable friend updates preserve the known current-owner section');
      const staleFriends = friends.hydrateFriendPersonas(document, friendData, target().steamAppId, metadata.name, context);
      for (let cycle = 0; cycle < 40; cycle++) {
        retired.push({ lease, callback: currentOwner(), node: document.getElementById('gdl-controller-section'), snapshot: [...callbacks] });
        cleanup?.(); ordering.disposeLinkedSidebarOrder(document);
        for (const node of [...column.children]) if (node.id.startsWith('gdl-')) node.remove();
        commit([ids.b, ids.sibling, ids.a][cycle % 3]);
        const hasFriends = cycle % 2 === 0, hasCards = cycle % 3 === 0;
        setNative([...(hasFriends ? ['friends'] : []), 'notes', ...(hasCards ? ['cards'] : []), 'screenshots']); commit(selected);
        install(hasFriends ? 0 : 2); assertOrder(`Route${cycle}`);
        check(document.querySelector('#gdl-achievements-content').textContent.includes(`Local ${selected}`), 'Sibling shortcuts sharing one Steam AppID always receive their own local achievement snapshot');
        for (const previous of retired.slice(-3)) {
          const stale = ownedNode('dlc', 'gdl-dlc-section'); const before = column.innerHTML;
          check(!previous.lease.publish(stale, 'dlc') && column.innerHTML === before, 'Retired async producers cannot publish through a replacement shortcut lease');
          for (const callback of previous.snapshot) callback();
        }
      }
      for (const destination of [ids.native, ids.unlinked]) {
        commit(destination); const before = column.innerHTML;
        check(!lease.publish(ownedNode('dlc', 'gdl-dlc-section'), 'dlc') && column.innerHTML === before,
          'Native and unlinked destinations reject linked sidebar writes before cleanup');
        lease.reconcile(); check(!lease.isCurrent(), 'Concrete foreign routes retire the coordinator immediately');
      }
      const staleFriendBefore = column.innerHTML;
      personaRequests.shift()('[]'); await staleFriends;
      check(column.innerHTML === staleFriendBefore, 'A retired production persona result cannot mount friends onto a different or native game');
      const pendingBefore = column.innerHTML, chromeBefore = chromeCalls.length;
      for (const resolve of assetRequests) resolve({ portrait: 'fixture-late-portrait' }); await frame();
      check(column.innerHTML === pendingBefore && chromeCalls.length === chromeBefore,
        'Late production-renderer asset completions cannot update sidebar or chrome on a native/unlinked destination');
      cleanup?.(); cleanup = null; controller.disposeControllerSidebarWatcher(document); ordering.disposeLinkedSidebarOrder(document); primary.disposePrimaryLinksBar(document); layoutModule.restoreNativeLibraryStyles(document);
      check(callbacks.size === 0, 'Final teardown releases every controller SDK callback');
      return { checks: checks.length, routeCycles: 40, geometryCases: 12, stableCalls: 100 };
    } finally { moveObserver.disconnect(); cleanup?.(); controller.disposeControllerSidebarWatcher(document); ordering.disposeLinkedSidebarOrder(document); primary.disposePrimaryLinksBar(document); }
  }, { sources, native });
  console.log(`Desktop sidebar coordination passed: ${report.checks} checks; ${report.routeCycles} route cycles, ${report.geometryCases} native CSS geometry cases, ${report.stableCalls} stable updates; no account writes.`);
} finally { await browser.close(); }
