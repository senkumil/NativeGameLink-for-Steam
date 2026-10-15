// Real Edge DOM plus production controller, sidebar and early-achievement code.
// Steam services, route authority and achievement data are isolated fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const sources = Object.fromEntries([
  ['controller', 'frontend/features/library/controller.ts'],
  ['sections', 'frontend/features/library/sidebar-sections.ts'],
  ['early', 'frontend/features/library/early-achievement-sidebar.ts'],
  ['layout', 'frontend/features/library/layout.ts'],
  ['controller-style', 'frontend/features/library/styles/controller.ts'],
  ['controller-svgs', 'frontend/features/library/controller-svgs.ts'],
  ['dom', 'frontend/core/dom.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['order', 'frontend/features/library/sidebar-order.ts'],
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><head><style>'
    + 'body{margin:0;background:#171d25;color:white;font:14px Arial}'
    + '#columns{display:flex;align-items:flex-start}#main{width:850px}#sidebar{width:420px}'
    + '.native-wrapper{margin:0 0 20px}.native-region h2{font-size:16px;margin:0 0 8px}'
    + '.native-body{background:rgba(30,40,50,.5)}.native-inner{min-height:48px}'
    + '</style></head><body><header id="native-header">Native hero</header><div id="columns">'
    + '<main id="main"><div id="notice">Non-Steam shortcut notice</div></main>'
    + '<aside id="sidebar"><div id="native-wrapper" class="native-wrapper">'
    + '<section id="native-notes" class="native-region" role="region"><h2><div><div>Notes</div></div></h2>'
    + '<div class="native-body"><div class="native-inner">Native notes</div></div></section>'
    + '</div></aside></div></body></html>');
  const report = await page.evaluate(async sources => {
    const results = [], modules = {}, callbacks = new Set(), opened = [], retired = [];
    const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
    const noop = () => {};
    const selections = [
      { steamAppId: '1790600', shortcutAppId: '3000000001' },
      { steamAppId: '49520', shortcutAppId: '3000000002' },
      { steamAppId: '1790600', shortcutAppId: '3000000003' },
    ];
    let selected = selections[0], generation = 1, storeReads = 0;
    const dualsense = { bConnected: true, eControllerType: 45, strName: 'DualSense Wireless Controller' };
    let controllers = [dualsense];
    const nativeHeader = document.getElementById('native-header');
    const anchor = document.getElementById('native-notes');
    const column = document.getElementById('sidebar');
    const notice = document.getElementById('notice');
    const layout = { anchorRegion: anchor, sidebarColumn: column,
      contentColumn: document.getElementById('main'), twoColumnRow: document.getElementById('columns'), noticeParent: notice };
    const originalFrame = window.requestAnimationFrame, originalCancelFrame = window.cancelAnimationFrame;
    const originalTimer = window.setTimeout, originalCancelTimer = window.clearTimeout;
    const originalInterval = window.setInterval, originalCancelInterval = window.clearInterval;
    const frames = new Map(), timers = new Map(), intervals = new Map();
    window.requestAnimationFrame = callback => {
      const id = originalFrame.call(window, timestamp => { frames.delete(id); callback(timestamp); });
      frames.set(id, callback); return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id); originalCancelFrame.call(window, id); };
    window.setTimeout = (callback, delay, ...args) => {
      const id = originalTimer.call(window, () => { timers.delete(id); callback(...args); }, delay);
      timers.set(id, callback); return id;
    };
    window.clearTimeout = id => { timers.delete(id); originalCancelTimer.call(window, id); };
    window.setInterval = (callback, delay, ...args) => {
      const id = originalInterval.call(window, callback, delay, ...args); intervals.set(id, callback); return id;
    };
    window.clearInterval = id => { intervals.delete(id); originalCancelInterval.call(window, id); };
    const frame = () => new Promise(resolve => originalFrame.call(window,
      () => originalTimer.call(window, resolve, 0)));
    window.ControllerStore = { GetControllers: () => { storeReads++; return controllers; } };
    const register = callback => { callbacks.add(callback); return () => callbacks.delete(callback); };
    window.SteamClient = {
      Input: { RegisterForControllerListChanges: register, RegisterForControllerStateChanges: register,
        RegisterForActiveControllerChanges: register },
      Apps: { ShowControllerConfigurator: id => opened.push(id) },
    };
    const data = shortcut => ({ found: true, appid: selected.steamAppId, state_appid: shortcut,
      total: 50, unlocked: 29, achievements: [{ name: 'ACH_FIXTURE', display_name: 'Fixture achievement', earned: true }] });
    const achievementOwners = new WeakMap();
    const navigation = {
      linkedAchievementTarget: doc => doc === document ? selected : null,
      registerEarlyAchievementSidebarOwner: (_doc, section, target, header, guard) => {
        achievementOwners.set(section, { target, header, guard });
      },
      adoptEarlyAchievementSidebarOwner: section => { const owner = achievementOwners.get(section); if (owner) owner.guard = () => true; },
      ownsAchievementSidebar: (doc, target) => {
        const section = doc.getElementById('gdl-achievements-section'), owner = achievementOwners.get(section);
        return Boolean(section && owner && owner.guard() && owner.target.steamAppId === target.steamAppId
          && owner.target.shortcutAppId === target.shortcutAppId);
      },
      makeLinkedAchievementsClickable: noop,
    };
    const localization = { loc: (_key, fallback) => fallback,
      gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'english' };
    const renderAchievements = (doc, snapshot) => {
      const content = doc.getElementById('gdl-achievements-content');
      if (content && content.dataset.fixtureState !== snapshot.state_appid) {
        content.dataset.fixtureState = snapshot.state_appid;
        content.innerHTML = '<div class="gdl-la-summary">29/50 Fixture achievements</div>';
      }
    };
    const achievementRuntime = { ...navigation,
      getCachedLocalAchievementsForShortcut: (_steam, shortcut) => data(shortcut),
      getCachedLocalAchievementsForGame: () => data(selected.shortcutAppId),
      renderLocalAchievementSidebar: renderAchievements,
      renderLocalAchievementSidebarHtml: () => '<div class="gdl-la-summary">29/50 Fixture achievements</div>',
      ensureLocalAchievementSidebarResponsiveGrid: noop, ensureAchievementSidebarStyles: noop,
      ensureAchievementModalStyles: noop, openLocalAchievementsModal: async () => {},
    };
    const dependencies = {
      '../../api/backend': { backendLog: noop }, '../../steam/localization': localization,
      '../../steam/css': { resolveClassModule: (_predicate, fallback) => ({ classes: fallback }) },
      '../../core/text': { escapeHtml: value => String(value).replace(/[&<>"']/g, character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) },
      '../../core/game-data': { getCachedGameData: () => null, getSynchronousGameData: () => ({ achievements: { total: 50 } }) },
      '../../steam/gamepad/stores/AppStoreAdapter': { AppStoreAdapter: { getAppOverview: appid =>
        ({ xbox_controller_support: 1, ps4_controller_support: 0, ps5_controller_support: appid === 49520 ? 0 : 1 }) } },
      '../../steam/modules/SteamModuleResolver': { getSteamStore: () => null },
      '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRequire: () => null, getAllModules: () => [] } },
      '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
      '../../steam/sidebar-interaction': { isLibrarySidebarInteractionActive: () => false },
      '../../steam/library-details': {
        committedHeaderAppId: element => element?.dataset.nativeAppid ? Number(element.dataset.nativeAppid) : null,
        isPaintedLibraryElement: (_doc, element) => element.isConnected,
        paintedNativePlaybar: () => null,
      },
      '../../steam/library-header': { findNativeLibraryHeader: () => nativeHeader,
        containsNativeLibraryHeader: element => element === nativeHeader || Boolean(element?.contains(nativeHeader)),
        isInsideNativeLibraryHeader: element => element === nativeHeader || Boolean(nativeHeader.contains(element)),
        getNativeLibraryArtworkSelectors: () => ({ header: '#native-header' }) },
      '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility: noop },
      './render-session': { isCurrentLinkedRenderDestination: (doc, shortcut, steam) => doc === document && shortcut === selected.shortcutAppId && steam === selected.steamAppId },
      '../achievements/navigation': navigation,
      '../achievements/cache': achievementRuntime,
      '../achievements/runtime': achievementRuntime,
      '../achievements/sidebar': { renderLocalAchievementSidebar: renderAchievements,
        renderPendingAchievementSidebarHtml: () => '<div class="gdl-la-summary">Loading</div>' },
      '../achievements/styles/sidebar': { ensureAchievementSidebarStyles: noop },
      './historical-sidebar': { buildHistoricalSidebarSections: () => [] },
      './social': { friendDataSignature: () => 'fixture', renderFriendsSection: () => '<div>Friends fixture</div>' },
      './inject': { injectLibraryStyle: (doc, id, css) => {
        if (doc.getElementById(id)) return;
        const style = doc.createElement('style'); style.id = id; style.textContent = css; doc.head.appendChild(style);
      } },
    };
    const aliases = { './controller': 'controller', './styles/controller': 'controller-style',
      './controller-svgs': 'controller-svgs', '../../core/dom': 'dom', '../../steam/native-dom': 'native-dom', './early-achievement-sidebar': 'early', './sidebar-order': 'order' };
    function load(name) {
      if (modules[name]) return modules[name];
      const exports = modules[name] = {};
      new Function('require', 'exports', sources[name])(dependency => {
        if (dependency in dependencies) return dependencies[dependency];
        if (dependency === './css') return dependencies['../../steam/css'];
        if (dependency === './localization') return localization;
        if (dependency === './layout') return { ...load('layout'), discoverNativeLibraryLayout: () => layout };
        if (dependency in aliases) return load(aliases[dependency]);
        throw Error(`Unexpected ${name} dependency: ${dependency}`);
      }, exports);
      return exports;
    }
    const controller = load('controller'), early = load('early'), sections = load('sections');
    const commit = target => {
      selected = target; generation++;
      for (const element of [nativeHeader, anchor, column]) element.dataset.nativeAppid = target.shortcutAppId;
    };
    const order = () => [...column.children].filter(element => element.id.startsWith('gdl-')).map(element => element.id);
    const rectangle = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    const sameRectangle = (before, after) => Boolean(before && after
      && Object.keys(before).every(key => Math.abs(before[key] - after[key]) < 0.1));
    const noOverlap = (control, achievement) => Boolean(control && achievement
      && control.height > 0 && achievement.height > 0 && control.bottom <= achievement.top + 0.1);
    const exactController = target => {
      const node = document.getElementById('gdl-controller-section');
      return node?.parentElement === column && node.dataset.gdlSteamAppId === target.steamAppId
        && node.dataset.gdlShortcutAppId === target.shortcutAppId ? node : null;
    };
    let cleanup = null, previousControl = null;
    let mountedBeforeFrame = 0, stableAdoptions = 0, protectedCleanups = 0;
    let geometryBeforeFrame = 0, stableGeometryAdoptions = 0, undetachedAdoptions = 0;
    const nativeMutations = [];
    const nativeObserver = new MutationObserver(records => nativeMutations.push(...records));
    for (const element of [nativeHeader, anchor, notice]) nativeObserver.observe(element,
      { attributes: true, childList: true, subtree: true, characterData: true });
    try {
      for (let index = 0; index < 100; index++) {
        const oldCallbacks = [...callbacks], oldCleanup = cleanup, oldControl = previousControl;
        commit(selections[index % selections.length]);
        nativeObserver.takeRecords();
        const capturedGeneration = generation, capturedTarget = selected;
        const current = () => generation === capturedGeneration;
        early.syncEarlyAchievementSidebar(document, notice, selected.steamAppId, selected.shortcutAppId,
          capturedGeneration, current);
        const control = exactController(selected), achievement = document.getElementById('gdl-achievements-section');
        if (control && achievement && control.nextElementSibling === achievement) mountedBeforeFrame++;
        const summary = achievement?.querySelector('.gdl-la-summary');
        const firstControlRect = rectangle(control), firstAchievementRect = rectangle(achievement);
        if (noOverlap(firstControlRect, firstAchievementRect)) geometryBeforeFrame++;
        const adoptionObserver = new MutationObserver(noop);
        adoptionObserver.observe(column, { childList: true, subtree: true });
        sections.renderLinkedSidebarCore(document, layout, { ...selected, data: { name: 'Fixture', achievements: { total: 50 } }, friendResult: null });
        cleanup = controller.setupControllerSidebarWatcher(document, layout, selected.steamAppId, selected.shortcutAppId, current);
        if (exactController(selected) === control && document.getElementById('gdl-achievements-section') === achievement
          && achievement?.querySelector('.gdl-la-summary') === summary
          && JSON.stringify(order()) === JSON.stringify(['gdl-controller-section', 'gdl-achievements-section'])) stableAdoptions++;
        if (sameRectangle(firstControlRect, rectangle(exactController(selected)))
          && sameRectangle(firstAchievementRect, rectangle(document.getElementById('gdl-achievements-section')))) stableGeometryAdoptions++;
        const adoptionRecords = adoptionObserver.takeRecords(); adoptionObserver.disconnect();
        if (!adoptionRecords.some(record => [...record.removedNodes].some(node =>
          [control, achievement, summary].some(owned => owned && (node === owned || node.contains(owned)))))) undetachedAdoptions++;
        oldCleanup?.();
        if (exactController(selected) === control) protectedCleanups++;
        const readsBeforeRetired = storeReads;
        for (const callback of oldCallbacks) callback();
        if (storeReads !== readsBeforeRetired) throw Error('Retired controller callbacks still query Steam services');
        retired.push(...oldCallbacks);
        if (oldControl) {
          const count = opened.length;
          oldControl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          if (opened.length !== count) throw Error('A detached previous-game controller opens a stale configurator');
        }
        if (document.querySelectorAll('#gdl-controller-section').length !== 1) throw Error('Navigation created duplicate controller sections');
        if (capturedTarget !== selected) throw Error('Fixture route changed unexpectedly');
        previousControl = control;
      }
      check(mountedBeforeFrame === 100, 'Every one of 100 route commits mounts DualSense above Achievements before any animation frame');
      check(stableAdoptions === 100, 'Full sidebar adoption preserves controller, achievement and summary identities with one stable order');
      check(protectedCleanups === 100, 'Disposing the previous game watcher never deletes the destination controller');
      check(geometryBeforeFrame === 100, 'Controller bottom stays above Achievement top without overlap on all 100 commits before a frame');
      check(stableGeometryAdoptions === 100, 'Metadata adoption preserves both measured panel rectangles without a transient layout jump');
      check(undetachedAdoptions === 100, 'Metadata adoption never detaches either visible panel or the achievement summary');
      check(retired.length > 0, 'Native callback lifecycle was exercised across the navigation sequence');
      const beforePaintControl = exactController(selected), beforePaintAchievement = document.getElementById('gdl-achievements-section');
      const beforePaintControlRect = rectangle(beforePaintControl), beforePaintAchievementRect = rectangle(beforePaintAchievement);
      await frame();
      check(JSON.stringify(order()) === JSON.stringify(['gdl-controller-section', 'gdl-achievements-section']),
        'Deferred scroll work does not change sidebar order or recreate the controller after paint');
      check(noOverlap(rectangle(exactController(selected)), rectangle(document.getElementById('gdl-achievements-section')))
        && sameRectangle(beforePaintControlRect, rectangle(exactController(selected)))
        && sameRectangle(beforePaintAchievementRect, rectangle(document.getElementById('gdl-achievements-section'))),
      'The first actual browser paint preserves panel geometry with no Control/Achievements overlap');
      await new Promise(resolve => originalTimer.call(window, resolve, 1050));
      await frame();
      check(exactController(selected) === beforePaintControl
        && document.getElementById('gdl-achievements-section') === beforePaintAchievement
        && noOverlap(rectangle(beforePaintControl), rectangle(beforePaintAchievement))
        && sameRectangle(beforePaintControlRect, rectangle(beforePaintControl))
        && sameRectangle(beforePaintAchievementRect, rectangle(beforePaintAchievement))
        && JSON.stringify(order()) === JSON.stringify(['gdl-controller-section', 'gdl-achievements-section']),
      'One second of native polling and delayed browser work leaves the same panels, positions and non-overlapping order');
      const active = exactController(selected), activeSummary = document.querySelector('#gdl-achievements-section .gdl-la-summary');
      for (let index = 0; index < 100; index++) {
        sections.renderLinkedSidebarCore(document, layout, { ...selected, data: { name: 'Fixture', achievements: { total: 50 } }, friendResult: null });
        controller.syncControllerSidebarSection(document, layout, selected.steamAppId, selected.shortcutAppId);
      }
      check(exactController(selected) === active && document.querySelector('#gdl-achievements-section .gdl-la-summary') === activeSummary,
        'One hundred repeated core/controller synchronizations preserve the mounted nodes');
      sections.renderLinkedSidebarCore(document, layout, { ...selected, data: { name: 'Fixture', achievements: { total: 50 } }, friendResult: { totalCount: 1 } });
      check(JSON.stringify(order()) === JSON.stringify(['gdl-controller-section', 'gdl-friends-section', 'gdl-achievements-section']),
        'Cached Friends keep the canonical Controller, Friends, Achievements order');
      active.querySelector('.gdl-controller-link').click();
      check(opened.length === 1 && opened[0] === Number(selected.shortcutAppId),
        'Only the current destination can open its own controller configurator');

      const beforeMismatch = column.innerHTML;
      column.dataset.nativeAppid = '3000000999';
      controller.syncControllerSidebarSection(document, layout, selected.steamAppId, selected.shortcutAppId);
      check(column.innerHTML === beforeMismatch, 'An uncommitted sidebar from another game cannot be updated by the selected route');
      column.dataset.nativeAppid = selected.shortcutAppId;
      const unauthorized = selections.find(target => target.shortcutAppId !== selected.shortcutAppId);
      controller.syncControllerSidebarSection(document, layout, unauthorized.steamAppId, unauthorized.shortcutAppId);
      check(exactController(selected) === active, 'A stale target callback cannot replace the current controller section');

      controllers = [];
      for (const callback of [...callbacks]) callback();
      await frame();
      check(!document.getElementById('gdl-controller-section'), 'A confirmed native disconnect removes the current controller promptly');
      controllers = [dualsense];
      for (const callback of [...callbacks]) callback();
      await frame();
      check(Boolean(exactController(selected)) && order()[0] === 'gdl-controller-section',
        'A native reconnect restores DualSense in the same canonical position');
      const disconnectedEvent = new Event('gamepaddisconnected');
      Object.defineProperty(disconnectedEvent, 'gamepad', { value: { id: 'DualSense Wireless Controller' } });
      window.dispatchEvent(disconnectedEvent);
      check(Boolean(exactController(selected)), 'A browser disconnect hint cannot hide a controller Steam still confirms connected');
      check(!document.querySelector('[role="tooltip"], .hoverposition_HoverPosition'),
        'Navigation and controller detection create no tooltip artifacts');
      check(nativeMutations.length === 0 && nativeObserver.takeRecords().length === 0,
        'Controller rendering never edits the native hero, Notes anchor or shortcut notice');
      const finalCallbacks = [...frames.values(), ...timers.values(), ...intervals.values(), ...callbacks];
      controller.disposeControllerSidebarWatcher(document);
      cleanup(); cleanup(); cleanup = null;
      check(frames.size === 0 && timers.size === 0 && intervals.size === 0 && callbacks.size === 0,
        `Final teardown releases all work (frames=${frames.size}, timers=${timers.size}, intervals=${intervals.size}, native callbacks=${callbacks.size})`);
      const readsAfterDispose = storeReads;
      for (const callback of [...retired, ...finalCallbacks]) callback(performance.now());
      await frame();
      check(!document.getElementById('gdl-controller-section') && storeReads === readsAfterDispose,
        'Retired callbacks after shutdown perform no Steam reads and cannot recreate or delete destination UI');
      return { checks: results.length, mountedBeforeFrame, stableAdoptions, protectedCleanups,
        geometryBeforeFrame, stableGeometryAdoptions, undetachedAdoptions };
    } finally {
      cleanup?.(); nativeObserver.disconnect();
      for (const id of frames.keys()) originalCancelFrame.call(window, id);
      for (const id of timers.keys()) originalCancelTimer.call(window, id);
      for (const id of intervals.keys()) originalCancelInterval.call(window, id);
      window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancelFrame;
      window.setTimeout = originalTimer; window.clearTimeout = originalCancelTimer;
      window.setInterval = originalInterval; window.clearInterval = originalCancelInterval;
    }
  }, sources);
  assert.equal(report.mountedBeforeFrame, 100);
  assert.equal(report.geometryBeforeFrame, 100);
  assert.equal(report.stableGeometryAdoptions, 100);
  assert.equal(report.undetachedAdoptions, 100);
  console.log(`Controller navigation browser passed: ${report.checks} checks; 100 before-paint mounts without overlap, unchanged metadata adoption geometry, stable first-paint/one-second positions and retired watcher cleanup. Steam services mocked.`);
} finally { await browser.close(); }
