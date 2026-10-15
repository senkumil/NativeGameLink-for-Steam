// Real Chromium + installed Steam CSS: primary links must join the first committed
// shortcut frame without metadata, and must never authorize a native Steam host.
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
assert.ok((steamCss && fs.existsSync(steamCss)), `Installed Steam CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-header', 'frontend/steam/library-header.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['native-route', 'frontend/features/library/native-route.ts'],
  ['primary-links', 'frontend/features/library/primary-links.ts'],
  ['early-primary-links', 'frontend/features/library/early-primary-links.ts'],
  ['early-playbar', 'frontend/features/library/early-playbar.ts'],
  ['disposables', 'frontend/core/disposables.ts'],
  ['dom', 'frontend/core/dom.ts'],
  ['text', 'frontend/core/text.ts'],
  ['primary-links-style', 'frontend/features/library/styles/primary-links.ts'],
  ['inject', 'frontend/features/library/styles/inject.ts'],
  ['steam-links', 'frontend/core/steam-links.ts'],
].map(([name, filename]) => [name, ts.transpileModule(
  fs.readFileSync(name === 'primary-links' && process.env.PRIMARY_LINKS_SOURCE
    ? process.env.PRIMARY_LINKS_SOURCE : path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText]));

async function browserChecks(sources) {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const modules = {};
  const ids = { native: 123, a: 3000000001, b: 3000000002, sibling: 3000000003, unmapped: 3000000004 };
  const mapping = new Map([[ids.a, '1790600'], [ids.b, '1593500'], [ids.sibling, '1790600']]);
  const data = new Map();
  const dismissed = new Set();
  const nativeRoute = { LocationPathName: `/library/app/${ids.native}` };
  const localization = {
    gdlText: (key, fallback) => ({ store_page: 'Página de la tienda', community_hub: 'Punto de encuentro',
      points_shop: 'Tienda de puntos', discussions: 'Discusiones', guides: 'Guías', support: 'Soporte',
      more_links: 'Más enlaces' })[key] || fallback,
    loc: (_key, fallback) => fallback,
  };
  let synchronousReads = 0;
  let backendCalls = 0;
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    '../../steam/localization': localization,
    './localization': localization,
    '../../core/game-data': { getSynchronousGameData: id => { synchronousReads++; return data.get(String(id)) || null; } },
    '../../core/mappings': { findMappingForTitle: (_title, id) => mapping.get(Number(id)) || null, subscribeMappings: () => () => {} },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
    '../playtime/tracker': { removePlaytimeFallbackStats() {}, syncEarlyLinkedPlaytime() {} },
    '../achievements/cache': { getCachedLocalAchievementsForShortcut: () => null },
    '../achievements/playbar': { ensureLocalPlaybarStat() {} },
    './cloud-status': { removeCloudStatus() {}, syncEarlyLinkedCloudStatus() {} },
    './early-notice': { disposeEarlyLinkedNotice() {}, installEarlyShortcutNoticeStyle() {}, syncEarlyLinkedNotice() {} },
    './native-artwork-warmup': { warmNativeShortcutArtwork() {} },
    './playbar-achievement-cleanup': { removeObsoletePlaybarAchievements() {} },
    './early-game-info': { syncEarlyLinkedGameInfo() {}, disposeEarlyLinkedGameInfo() {} },
    '../shortcuts/registry': {
      getCommittedShortcutSteamAppId: id => mapping.get(Number(id)) || null,
      findMappingForShortcut: id => mapping.get(Number(id)) || null,
    },
    '../shortcuts/dismissed': { isShortcutDismissed: id => dismissed.has(Number(id)) },
    '../desktop/flags': { desktopFeatureFlags: { desktopNativeLinks: false, desktopNativeUIEnabled: false } },
    '../desktop/links/NativeDesktopLinksBar': { mountNativeDesktopLinksBar() { throw new Error('The normal primary links path must remain synchronous'); } },
    './constants': { GDL_INJECTED: 'gdl-library-injected' },
    './notice': { findNonSteamNotice: () => null },
    '../../api/backend': new Proxy({}, { get: () => () => { backendCalls++; throw new Error('Primary links must not request backend data'); } }),
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency === './styles/primary-links') return load('primary-links-style');
      if (dependency in dependencies) return dependencies[dependency];
      const basename = dependency.split('/').pop();
      if (basename in sources) return load(basename);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  const painted = element => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || (style.opacity !== '' && Number(style.opacity) === 0)) return false;
    }
    return true;
  };
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
  let early;
  let links;
  let header;
  let playbar;
  let stats;
  let nativeLinks;
  let originalRaf;
  let rafRequests = 0;
  let stableAudit;
  let startup;
  try {
    window.uiStore = { GetActiveWindowInstance: () => nativeRoute,
      currentGameListSelection: { nAppId: ids.native } };
    const css = load('css');
    const pb = css.PLAYBAR_CLASSES();
    const nativeCss = css.LINKS_BAR_CLASSES();
    const fixture = document.getElementById('fixture-details');
    const sidebar = document.getElementById('fixture-sidebar');
    const sidebarInitial = sidebar.outerHTML;
    const makeHeader = () => {
      const next = document.createElement('section');
      next.id = 'fixture-header'; next.className = 'AppDetailsHeader';
      next.innerHTML = `<div id="fixture-hero">Native hero · never rewritten</div><div id="fixture-playbar" class="${pb.Container} ${pb.InPage}"><button class="FixturePlayButton">JUGAR</button><div id="fixture-stats" class="${pb.GameStatsSection}">Native playbar content</div></div>`;
      return next;
    };
    const setHeader = next => {
      if (header) header.replaceWith(next); else fixture.prepend(next);
      header = next;
      playbar = header.querySelector('#fixture-playbar'); stats = header.querySelector('#fixture-stats');
    };
    setHeader(makeHeader());
    nativeLinks = document.createElement('div');
    nativeLinks.id = 'fixture-native-links'; nativeLinks.className = nativeCss.LinksSection;
    nativeLinks.innerHTML = '<a href="https://store.steampowered.com/app/123/">Native Store</a><a href="https://steamcommunity.com/app/123">Native community</a><a href="https://steamcommunity.com/app/123/guides/">Native guides</a>';
    fixture.insertBefore(nativeLinks, document.getElementById('fixture-content'));
    const route = id => {
      nativeRoute.LocationPathName = id === null ? '/library/home' : `/library/app/${id}`;
      if (id !== null) window.uiStore.currentGameListSelection = { nAppId: id };
    };
    const commit = id => { commitHost(playbar, id); commitHost(stats, id); commitHost(header, id); };
    const target = id => { route(id); commit(id); };
    target(ids.native);
    early = load('early-primary-links'); links = load('primary-links');
    originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { rafRequests++; return originalRaf(callback); };
    const sync = () => early.syncEarlyLinkedPrimaryLinks(document);
    const bar = () => document.getElementById('gdl-link-bar');
    const assertNativeUnchanged = (before, message) => check(header.outerHTML === before
      && sidebar.outerHTML === sidebarInitial, message);
    const assertLinks = (node, appId, message) => {
      const anchors = Array.from(node.querySelectorAll('.gdl-primary-link'));
      check(anchors.length >= 6 && anchors.every(anchor => String(anchor.href).includes(String(appId)))
        && node.dataset.gdlSteamAppId === String(appId), message);
    };
    const assertResponsive = (node, message) => {
      const bounds = node.getBoundingClientRect();
      const visible = Array.from(node.querySelectorAll('.gdl-primary-link')).filter(painted);
      const more = node.querySelector('.gdl-primary-more');
      const overflow = Array.from(node.querySelectorAll('.gdl-primary-overflow-link'))
        .filter(anchor => getComputedStyle(anchor).display !== 'none');
      check(visible.length > 0 && painted(more) && overflow.length > 0
        && visible.every(anchor => { const rect = anchor.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right + 1; })
        && more.getBoundingClientRect().right <= bounds.right + 1
        && visible.length + overflow.length === node.querySelectorAll('.gdl-primary-link').length, message);
    };
    const scrollMeasurements = [];
    const auditScrollLayout = async () => {
      // Steam mounts its compact header first, outside the perspective scroller.
      // Both playbars retain the same committed shortcut identity while scrolling.
      const audit = document.createElement('main'); audit.id = 'scroll-audit';
      audit.innerHTML = `<section id="audit-sticky-header" class="_2gZXhRmKUk68pA28-5ZmGQ"><div id="audit-sticky" class="${pb.Container}"><button>JUGAR</button></div></section><div id="audit-scroll"><div id="audit-inner"><section id="audit-hero"><div id="audit-background"><div id="audit-art"></div><div id="audit-blur"></div></div></section><section id="audit-overview"><div id="audit-inpage" class="${pb.Container} ${pb.InPage}"><button>JUGAR</button></div><div id="audit-content"><div id="audit-news">Native activity</div></div></section></div></div>`;
      const style = document.createElement('style');
      style.textContent = `
        #scroll-audit{position:fixed;left:80px;top:80px;width:1100px;height:600px;display:flex;flex-direction:column;zoom:1.25;z-index:5;background:#20252c}
        #audit-sticky-header{position:absolute;top:0;left:0;width:100%;height:55px;z-index:2;opacity:0}
        #audit-sticky,#audit-inpage{display:flex!important;position:relative!important;align-items:center!important;width:100%!important;height:63px!important;min-height:63px!important;padding:0 20px!important;margin:0!important;box-sizing:border-box!important;transform:none!important;background:#333!important}
        #audit-sticky{height:55px!important;min-height:55px!important}
        #audit-scroll{position:relative;height:100%;flex:1;min-height:0;overflow-y:scroll;overflow-x:hidden;transform:translate3d(0,0,0);backface-visibility:hidden;perspective:1px;perspective-origin:0 0}
        #audit-inner,#audit-overview{transform-style:preserve-3d}
        #audit-inner{position:relative;min-height:100%;overflow:visible}
        #audit-hero{height:320px;max-height:320px;display:flex;justify-content:center;transform-style:preserve-3d;z-index:-1000;position:relative}
        #audit-background{flex:1;max-height:320px;position:relative;transform-origin:0 0;transform:translateZ(-1px) scale(2)}
        #audit-art{height:120%;width:100%;background:repeating-linear-gradient(0deg,#123 0px,#678 48px,#a37 48px,#a37 96px)}
        #audit-blur{height:640px;position:relative;transform:scaleY(-1);background:repeating-linear-gradient(0deg,#436 0px,#986 48px,#263 48px,#263 96px)}
        #audit-content{height:2500px;background:rgba(0,0,0,.1)}
        #audit-news{height:400px;position:relative;top:400px;background:rgba(255,255,255,.1)}
      `;
      document.head.appendChild(style); fixture.replaceWith(audit);
      const stickyHeader = audit.querySelector('#audit-sticky-header');
      const sticky = audit.querySelector('#audit-sticky');
      const inpage = audit.querySelector('#audit-inpage');
      const overview = audit.querySelector('#audit-overview');
      const scroll = audit.querySelector('#audit-scroll');
      const background = audit.querySelector('#audit-background');
      const news = audit.querySelector('#audit-news');
      const commitAudit = id => { commitHost(sticky, id); commitHost(inpage, id); };
      const settled = async () => { await frame(); await frame(); };
      const sample = label => {
        const viewport = scroll.getBoundingClientRect();
        const node = bar();
        const measurement = { label, scrollTop: scroll.scrollTop, viewportTop: viewport.top,
          viewportHeight: viewport.height, background: background.getBoundingClientRect().top,
          news: news.getBoundingClientRect().top, linksParent: node?.parentElement?.id || null };
        scrollMeasurements.push(measurement); return measurement;
      };
      const close = (a, b) => Math.abs(a - b) < .1;
      const stableViewport = (a, b) => close(a.viewportTop, b.viewportTop) && close(a.viewportHeight, b.viewportHeight);
      try {
        route(ids.a); commitAudit(ids.a); const scrollBar = sync();
        check(scrollBar?.parentElement === overview && inpage.nextElementSibling === scrollBar,
          'The primary links initially join the committed in-page overview below its own playbar');
        scroll.scrollTop = 700; await settled();
        const beforeSticky = sample('in-page');
        stickyHeader.style.opacity = '1'; sync(); await settled();
        const stickyVisible = sample('compact visible');
        check(bar() === scrollBar && scrollBar.parentElement === overview && stableViewport(beforeSticky, stickyVisible)
          && close(beforeSticky.background, stickyVisible.background) && close(beforeSticky.news, stickyVisible.news),
          `Showing the first-in-DOM compact header never moves links, changes the scroll viewport or jumps the background: ${JSON.stringify({ beforeSticky, stickyVisible })}`);
        for (let index = 0; index < 24; index++) {
          const before = sample(`slow ${index} before`);
          scroll.scrollTop += index % 4 + 1;
          stickyHeader.style.opacity = index % 2 ? '1' : '0';
          const synced = sync(); await settled();
          const after = sample(`slow ${index} after`);
          check(synced === scrollBar && scrollBar.parentElement === overview && stableViewport(before, after)
            && close(after.background - before.background, (after.news - before.news) / 2)
            && close(after.news - before.news, -(after.scrollTop - before.scrollTop) * 1.25),
            `Slow scroll ${index + 1} preserves the links parent, viewport and native one-half parallax while compact opacity alternates`);
        }
        const beforeSibling = sample('before same-public-AppID sibling');
        route(ids.sibling);
        check(sync() === null && bar() === scrollBar && scrollBar.dataset.gdlShortcutAppId === String(ids.a)
          && scrollBar.parentElement === overview && stableViewport(beforeSibling, sample('pending sibling')),
          'A same-public-AppID sibling cannot retarget or move the scrolled links before its own native commit');
        commitAudit(ids.sibling);
        check(sync() === scrollBar && scrollBar.dataset.gdlShortcutAppId === String(ids.sibling)
          && scrollBar.parentElement === overview && stableViewport(beforeSibling, sample('committed sibling')),
          'A committed sibling retains the same in-page links host and scroll viewport');
        early.disposeLinkedPrimaryLinks(document); inpage.remove(); stickyHeader.style.opacity = '1';
        const stickyOnlyViewport = sample('compact only');
        check(sync() === null && !bar() && stableViewport(stickyOnlyViewport, sample('compact only after sync')),
          'A painted compact header without its in-page playbar cannot insert links outside the scroller');
        commitHost(inpage, ids.a); overview.prepend(inpage);
        check(sync() === null && !bar(),
          'A compact sibling header cannot authorize insertion beside another shortcut in-page playbar');
        commitAudit(ids.sibling);
        check(sync()?.parentElement === overview,
          'The links mount in their own overview as soon as the matching in-page playbar commits');
        const nativeHeader = stickyHeader.outerHTML;
        const nativeInpage = inpage.outerHTML;
        route(ids.native); commitAudit(ids.native);
        check(sync() === null && !bar() && stickyHeader.outerHTML === nativeHeader && inpage.outerHTML === nativeInpage,
          'Native-route cleanup from a compact scrolled header removes only owned links and preserves both native playbars');
      } finally {
        early.disposeLinkedPrimaryLinks(document);
        audit.replaceWith(fixture); style.remove(); route(ids.a);
      }
    };

    const nativeHeader = header.outerHTML;
    const nativeLinksInitial = nativeLinks.outerHTML;
    check(sync() === null && !bar(), 'Native initial route has no plugin links');
    assertNativeUnchanged(nativeHeader, 'Native initial route leaves header and virtual sidebar byte-identical');
    check(nativeLinks.outerHTML === nativeLinksInitial, 'Native links content, classes and attributes remain unchanged');

    route(ids.a);
    check(sync() === null && !bar(), 'A shortcut URI ahead of the native React commit cannot add a links bar');
    assertNativeUnchanged(nativeHeader, 'Pending native-to-shortcut navigation never changes the still-native host');
    nativeLinks.remove();
    fixture.style.width = '460px';
    const info = document.createElement('div');
    info.id = 'gdl-game-info-panel'; info.dataset.gameKey = '1790600';
    info.dataset.gdlShortcutAppId = String(ids.a);
    info.style.cssText = 'height:0;overflow:hidden;margin:0;padding:0';
    info.textContent = 'Owned info panel';
    fixture.insertBefore(info, document.getElementById('fixture-content'));
    commit(ids.a);
    const coldFrames = rafRequests;
    const cold = sync();
    check(cold === bar() && painted(cold), 'Native-to-external cold navigation paints primary links in the exact synchronous commit');
    check(rafRequests === coldFrames, 'The primary links initial paint waits for zero animation frames');
    check(backendCalls === 0 && data.size === 0, 'Cold first paint does not need backend metadata or a game-data cache');
    check(links.isBarProperlyPositionedBelowPlaybar(document, cold), 'The cold links host is below the actual native playbar on its first pass');
    assertLinks(cold, mapping.get(ids.a), 'Every cold link belongs to the selected shortcut mapping');
    assertResponsive(cold, 'A narrow first paint includes its final overflow menu before any animation frame');
    check(info.nextElementSibling === cold,
      'The initial collapsed info panel is immediately before links, with its exact game and shortcut identity');
    assertNativeUnchanged(nativeHeader, 'External cold links do not modify any native header or sidebar nodes');

    await frame(); await frame(); await wait(0);
    const stableHtml = cold.outerHTML;
    const initialAnchors = Array.from(cold.querySelectorAll('.gdl-primary-link'));
    stableAudit = new MutationObserver(() => {});
    stableAudit.observe(fixture, { subtree: true, childList: true, attributes: true, characterData: true });
    for (let index = 0; index < 100; index++) check(sync() === cold, `Stable sync ${index + 1} retains the exact links host`);
    const stableRecords = stableAudit.takeRecords(); stableAudit.disconnect();
    check(stableRecords.length === 0 && cold.outerHTML === stableHtml,
      '100 same-route synchronization signals cause zero DOM mutations');
    check(initialAnchors.every((anchor, index) => cold.querySelectorAll('.gdl-primary-link')[index] === anchor),
      'Stable synchronization retains each existing link element');
    const collapsedTop = cold.getBoundingClientRect().top;
    info.style.height = '70px';
    stableAudit.observe(fixture, { subtree: true, childList: true });
    for (let index = 0; index < 100; index++) sync();
    const expandedRecords = stableAudit.takeRecords(); stableAudit.disconnect();
    check(info.nextElementSibling === cold && cold.getBoundingClientRect().top === collapsedTop + 70
      && expandedRecords.length === 0 && painted(cold),
      'Expanding the info panel moves the existing links by normal flow with zero link reorders in 100 syncs');
    info.style.height = '0px';

    fixture.style.width = '1360px';
    await frame(); await frame(); await wait(20);
    check(painted(cold) && !painted(cold.querySelector('.gdl-primary-more')),
      'Real ResizeObserver expansion removes overflow without hiding or replacing the host');
    data.set('1790600', { steam_appid: 1790600, name: 'Fixture A', dlc: [111], categories: [{ id: 30 }] });
    const enriched = sync();
    check(enriched === cold && painted(enriched), 'Cached metadata enriches the original visible links host synchronously');
    const richText = enriched.textContent;
    check(richText.includes('DLC') && richText.includes('Workshop'), 'Optional links are derived from a synchronous snapshot');
    check(enriched.querySelectorAll('.gdl-primary-link').length === 8 && document.querySelectorAll('#gdl-link-bar').length === 1,
      'Enrichment has the complete link set with a single host');

    route(ids.sibling);
    const pendingSibling = sync();
    check(!pendingSibling && (!bar() || (bar() === enriched && bar().dataset.gdlShortcutAppId === String(ids.a))),
      'Same-public-AppID sibling navigation cannot relabel the previous committed shortcut links');
    const staleSibling = links.createPrimaryLinksBar(document, null, { steamAppId: '1790600', shortcutAppId: String(ids.a), hasWorkshop: true });
    links.insertPrimaryLinksBar(staleSibling);
    check(!staleSibling.isConnected || staleSibling === enriched,
      'A stale renderer options object cannot create links for another sibling shortcut');
    commit(ids.sibling);
    const sibling = sync();
    check(painted(sibling) && sibling.dataset.gdlShortcutAppId === String(ids.sibling),
      'A sibling shortcut gets its own exact identity immediately after commit');
    assertLinks(sibling, '1790600', 'A sibling with the same Store mapping receives only that mapping links');
    check(sibling.nextElementSibling === info,
      'A sibling shortcut never anchors its links after another shortcut info panel');
    info.remove();

    route(ids.b);
    const pendingSecond = sync();
    check(!pendingSecond && (!bar() || (bar() === sibling && bar().dataset.gdlShortcutAppId === String(ids.sibling))),
      'External-to-external pending navigation never retargets links before the new host commits');
    commit(ids.b);
    const second = sync();
    check(painted(second), 'External-to-external cold links are visible on the first synchronous pass');
    assertLinks(second, '1593500', 'External-to-external navigation has no links from the previous mapped game');
    check(!second.textContent.includes('DLC') && !second.textContent.includes('Workshop'),
      'An uncached external destination does not inherit optional links from the previous game');

    route(ids.native);
    const nativePendingHeader = header.outerHTML;
    check(sync() === null && !bar(), 'External-to-native route removes all owned links immediately');
    assertNativeUnchanged(nativePendingHeader, 'External-to-native cleanup does not touch the reused native header');
    commit(ids.native);
    fixture.insertBefore(nativeLinks, document.getElementById('fixture-content'));
    const publicFrames = rafRequests;
    const publicHeader = header.outerHTML;
    for (let index = 0; index < 100; index++) sync();
    check(!bar() && rafRequests === publicFrames && nativeLinks.outerHTML === nativeLinksInitial,
      '100 native-route signals add no links, schedule no settlement frames and leave native links unchanged');
    assertNativeUnchanged(publicHeader, '100 native-route signals preserve every native header and sidebar attribute');
    const beforeStaleNative = { header: header.outerHTML, head: document.head.innerHTML, links: nativeLinks.outerHTML };
    const staleNative = links.createPrimaryLinksBar(document, null,
      { steamAppId: '1790600', shortcutAppId: String(ids.a), hasWorkshop: true, hasDlc: true });
    links.insertPrimaryLinksBar(staleNative);
    check(!staleNative.isConnected && !bar() && document.head.innerHTML === beforeStaleNative.head
      && nativeLinks.outerHTML === beforeStaleNative.links,
      'Stale renderer creation and insertion cannot inject, style or replace a native destination');
    assertNativeUnchanged(beforeStaleNative.header, 'Stale renderer callbacks leave the public game header byte-identical');

    nativeLinks.remove(); target(ids.a); sync();
    route(null);
    check(sync() === null && !bar(), 'Library Home ignores stale shortcut selection and retires links synchronously');
    target(ids.unmapped);
    check(sync() === null && !bar(), 'An unlinked shortcut never receives another shortcut links');
    mapping.set(ids.unmapped, '1790600');
    check(painted(sync()) && bar().dataset.gdlShortcutAppId === String(ids.unmapped),
      'A newly verified mapping gains its links immediately on the existing committed shortcut host');
    mapping.delete(ids.unmapped);
    check(sync() === null && !bar(), 'Removing a mapping retires its primary links in the same synchronous turn');
    dismissed.add(ids.a); target(ids.a);
    check(sync() === null && !bar(), 'A dismissed linked shortcut has no owned links');
    const dismissedCandidate = links.createPrimaryLinksBar(document, null,
      { steamAppId: '1790600', shortcutAppId: String(ids.a), hasWorkshop: true, hasDlc: true });
    links.insertPrimaryLinksBar(dismissedCandidate);
    check(!dismissedCandidate.isConnected && !bar(),
      'A stale renderer callback cannot recreate links after the selected shortcut is dismissed');
    dismissed.delete(ids.a);

    target(ids.a); const abaFirst = sync();
    route(ids.b); sync(); route(ids.a);
    const aba = sync();
    check(aba === abaFirst && painted(aba) && aba.dataset.gdlShortcutAppId === String(ids.a),
      'A-to-B-to-A before React commits preserves the already correct visible shortcut host');
    await frame(); await frame(); await wait(20);
    check(bar() === aba && painted(aba) && !document.querySelector('[data-gdl-steam-app-id="1593500"]'),
      'Earlier navigation callbacks cannot resurrect the intermediate game after A-to-B-to-A');

    setHeader(makeHeader()); commit(ids.a);
    const replaced = sync();
    check(painted(replaced) && links.isBarProperlyPositionedBelowPlaybar(document, replaced),
      'Replacing Steam header and playbar nodes synchronously reanchors the links below the new committed host');
    const replacementHeader = header.outerHTML;
    fixture.style.width = '460px';
    early.disposeLinkedPrimaryLinks(document);
    check(!bar(), 'Disposal removes only the owned links host');
    const narrow = sync();
    assertResponsive(narrow, 'A fresh narrow route has final overflow geometry before the first frame');
    assertNativeUnchanged(replacementHeader, 'Reanchor, disposal and remount preserve the replacement native header');

    route(ids.native); early.disposeLinkedPrimaryLinks(document);
    await frame(); await frame(); await wait(20);
    check(!bar(), 'Disposed navigation work cannot resurrect plugin links on the native destination');
    target(ids.native);
    startup = load('early-playbar').installEarlyLinkedPlaybar(document);
    check(!bar(), 'The real early-playbar installer keeps native routes free of owned links');
    route(ids.a); startup.sync();
    check(!bar(), 'The real installer rejects pending shortcut selection while React still displays a native host');
    commit(ids.a); startup.sync();
    check(painted(bar()), 'The real early-playbar sync paints external links with the first committed native host');
    route(ids.native); startup.sync();
    check(!bar(), 'The real early-playbar sync retires external links immediately on a native destination');
    target(ids.a); startup.sync();
    setHeader(makeHeader()); commit(ids.a);
    await Promise.resolve(); await Promise.resolve();
    check(painted(bar()) && links.isBarProperlyPositionedBelowPlaybar(document, bar()),
      'Real native-host discovery restores the links at the mutation microtask before the next animation frame');
    startup.dispose(); startup = null;
    target(ids.a); const final = sync();
    check(painted(final) && backendCalls === 0 && synchronousReads > 0,
      'Final external route remains fully painted using synchronous reads and zero backend calls');
    assertResponsive(final, 'The final screenshot retains the narrow overflow layout');
    await auditScrollLayout();
    const output = document.createElement('pre'); output.id = 'primary-links-navigation-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, backendCalls, synchronousReads, scrollMeasurements });
    document.body.appendChild(output);
  } catch (error) {
    stableAudit?.disconnect();
    startup?.dispose();
    const output = document.createElement('pre'); output.id = 'primary-links-navigation-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
    document.body.appendChild(output);
  } finally {
    if (originalRaf) window.requestAnimationFrame = originalRaf;
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'primary-links-navigation-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'primary-links-navigation.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>
body{margin:0;background:#20252c;color:#dcdedf;font-family:Arial,sans-serif;min-height:800px}
#fixture-sidebar{position:absolute;left:0;top:100px;width:70px;height:580px;overflow:auto;background:#161a21}
#fixture-details{position:relative;margin:100px 0 0 80px;width:1360px;min-height:500px;background:#292731}
#fixture-header{display:block!important;position:relative!important;height:auto!important;padding:0!important;margin:0!important}
#fixture-hero{height:190px;background:linear-gradient(115deg,#6a3963,#233a5d);box-sizing:border-box;padding:35px;color:#c6cbd5}
#fixture-playbar{display:flex!important;position:relative!important;align-items:center!important;min-height:70px!important;height:70px!important;padding:0 20px!important;box-sizing:border-box!important;transform:none!important}
#fixture-playbar .FixturePlayButton{display:block!important;width:160px!important;height:50px!important;background:#29b636;color:#fff;border:0;font-size:22px;flex:0 0 160px!important}
#fixture-stats{height:44px!important;font-size:13px;padding:8px 16px;box-sizing:border-box}
#fixture-content{display:flex;padding:14px 20px;min-height:140px;gap:20px}
#fixture-content>div{flex:1;min-width:0;background:rgba(255,255,255,.04);padding:12px}
#fixture-native-links{height:39px;padding:8px;box-sizing:border-box;display:flex;gap:20px}
#primary-links-navigation-result{font-size:10px;white-space:pre-wrap;max-width:1000px;margin:24px 80px}
</style></head><body class="DesktopUI">
<aside id="fixture-sidebar"><div style="height:2000px">Native virtual sidebar</div></aside>
<main id="fixture-details" class="appdetails_AppDetails"><section id="fixture-content"><div>Actividad</div><div>Notas · Capturas</div></section></main>
<script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1600,900',
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
    expression: `(async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const output = document.getElementById('primary-links-navigation-result'); if (output) return JSON.parse(output.textContent); await new Promise(resolve => setTimeout(resolve, 20)); } return {ok:false,results:[],error:'Primary links navigation fixture did not finish'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, `Browser evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
  report = evaluated.result.value;
  fs.writeFileSync(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Primary links navigation browser passed: ${report.checks} assertions; native/external/Home/unlinked/dismissed/ABA, cold/warm first paint, responsive overflow, stable scrolled host, native parallax and zero native changes.`);
console.log(`Screenshot: ${screenshot}`);
