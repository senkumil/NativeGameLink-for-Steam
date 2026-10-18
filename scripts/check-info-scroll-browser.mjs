// Real-source regression coverage for rebuilt Steam Info/Back-to-top controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledPackages = process.env.CODEX_NODE_MODULES
  || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(bundledPackages, 'playwright'))); }
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'], ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-details', 'frontend/steam/library-details.ts'], ['dom', 'frontend/core/dom.ts'],
  ['achievement-playbar-space', 'frontend/steam/achievement-playbar-space.ts'],
  ['info-button-target', 'frontend/features/library/info-button-target.ts'],
  ['info-panel', 'frontend/features/library/info-panel.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(name === 'info-panel' && process.env.INFO_PANEL_SOURCE
  ? process.env.INFO_PANEL_SOURCE : path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText]));

async function browserChecks({ sources, foreignOnly = false }) {
  const results = [], check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const flush = (delay = 90) => new Promise(resolve => setTimeout(resolve, delay));
  const shortcutId = 3000000001, gameKey = '1790600';
  let route = shortcutId;
  const classes = { Container: 'SteamPlaybarContainer', InPage: 'SteamInPage', MenuButton: 'SteamMenuButton',
    PlayBarDetailLabel: 'SteamPlayBarDetailLabel', GameStatsSection: 'SteamGameStatsSection',
    PlayBarCloudStatusContainer: 'SteamPlayBarCloudStatusContainer', AppButtonsContainer: 'SteamAppButtonsContainer',
    FavoriteButton: 'SteamFavoriteButton', DotDotDot: 'SteamDotDotDot' };
  const localization = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback,
    steamLanguageSync: () => 'english' };
  const modules = {};
  const dependencies = {
    '@steambrew/client': { findClassModule: predicate => predicate(classes) ? classes : null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => classes, getAllModules: () => classes ? [{ id: 'fixture-classes', exports: classes }] : [] } },
    '../../core/text': { escapeHtml: value => String(value || '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) },
    '../../steam/localization': localization,
    './localization': localization,
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => id === shortcutId ? gameKey : null },
    './native-route': { routedSteamAppId: () => route, isPublicSteamLibraryRoute: () => route < 2147483648 },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records,
      isLibrarySidebarNode: node => node instanceof Element && Boolean(node.closest('#library-sidebar')) },
    './feature-icons': { nativeArrowSvg: () => '<svg class="SVGIcon_Arrow"></svg>', nativeFeatureVisual: () => '' },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = modules[name] = {};
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  const commit = node => {
    const state = {}, rootFiber = { tag: 3, return: null, stateNode: state };
    state.current = rootFiber;
    const owner = { tag: 0, memoizedProps: { overview: { appid: shortcutId } }, return: rootFiber };
    const host = { tag: 5, flags: 0, return: owner, memoizedProps: { className: node.className } };
    rootFiber.child = owner; owner.child = host; node.__reactFiber$fixture = host;
  };
  try {
    const info = load('info-panel');
    const model = { key: gameKey, title: 'Shortcut', isLegacy: false, portrait: '', description: 'Details',
      developer: '', publisher: '', franchise: '', release: '', features: [], hasCloud: false };
    if (foreignOnly) {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:1200px;height:650px;border:0'; document.body.appendChild(iframe);
      const foreignDoc = iframe.contentDocument;
      foreignDoc.body.style.margin = '0';
      const foreignPane = foreignDoc.createElement('main');
      foreignPane.style.cssText = 'position:fixed;left:240px;right:20px;top:20px;height:340px;overflow-y:auto';
      const foreignSidebar = foreignDoc.createElement('aside');
      foreignSidebar.id = 'library-sidebar'; foreignSidebar.className = load('css').LIBRARY_SIDEBAR_CLASSES().Container;
      foreignSidebar.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:300px;overflow-y:auto';
      foreignSidebar.innerHTML = '<div style="height:1600px">Library list</div>';
      const foreignPlaybar = foreignDoc.createElement('div'); foreignPlaybar.className = `${classes.Container} ${classes.InPage}`;
      foreignPlaybar.style.cssText = 'height:60px;display:flex;justify-content:flex-end';
      const foreignButtons = foreignDoc.createElement('div'); foreignButtons.className = classes.AppButtonsContainer;
      foreignButtons.style.cssText = 'display:flex;min-width:120px;height:40px';
      foreignPlaybar.appendChild(foreignButtons);
      const foreignLinks = foreignDoc.createElement('div'); foreignLinks.id = 'gdl-link-bar'; foreignLinks.textContent = 'Store page';
      const foreignContent = foreignDoc.createElement('div'); foreignContent.id = 'gdl-library-injected';
      foreignContent.style.height = '1600px'; foreignContent.textContent = 'Community content';
      foreignPane.append(foreignPlaybar, foreignLinks, foreignContent);
      foreignDoc.body.append(foreignSidebar, foreignPane); commit(foreignPlaybar); commit(foreignButtons);
      check(foreignPane instanceof foreignDoc.defaultView.HTMLElement && !(foreignPane instanceof HTMLElement),
        'The secondary Steam document has a distinct HTMLElement constructor');
      foreignPane.scrollTop = 650; foreignSidebar.scrollTop = 340;
      info.resetMainScrollToTop(foreignDoc);
      check(foreignPane.scrollTop === 0 && foreignSidebar.scrollTop === 340,
        'Reset discovers real scroll anchors from a secondary document without moving its library list');
      info.ensureNativeInfoPanel(foreignDoc, model); info.ensureNativeInfoButton(foreignDoc, model);
      const foreignButton = foreignButtons.querySelector('[data-gdl-game-info-button="1"]');
      foreignPane.scrollTop = 650;
      foreignPane.dispatchEvent(new foreignDoc.defaultView.WheelEvent('wheel', { bubbles: true, clientX: 500 }));
      await flush(); await flush();
      check(foreignButton?.dataset.gdlScrollTopActive === '1',
        'Scroll and wheel events in a secondary document update its arrow control');
      foreignButton.click(); await flush(600);
      check(foreignPane.scrollTop === 0 && foreignSidebar.scrollTop === 340,
        'The secondary-document arrow scrolls its own details pane and preserves its library list');
      const mainPane = foreignPane.cloneNode(true);
      mainPane.querySelectorAll('[data-gdl-game-info-button], #gdl-game-info-panel').forEach(node => node.remove());
      document.body.appendChild(mainPane);
      const mainPlaybar = mainPane.querySelector(`.${classes.Container}`);
      const mainButtons = mainPane.querySelector(`.${classes.AppButtonsContainer}`);
      commit(mainPlaybar); commit(mainButtons);
      info.ensureNativeInfoPanel(document, model); info.ensureNativeInfoButton(document, model);
      const mainButton = mainButtons.querySelector('[data-gdl-game-info-button="1"]');
      const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
      const animationTimers = new Set();
      window.setTimeout = (callback, delay, ...args) => {
        const timer = nativeSetTimeout(() => { animationTimers.delete(timer); callback(...args); }, delay);
        if (delay === 320) animationTimers.add(timer);
        return timer;
      };
      window.clearTimeout = timer => { animationTimers.delete(timer); nativeClearTimeout(timer); };
      try {
        mainButton.click(); foreignButton.click();
        check(animationTimers.size === 2,
          'Simultaneous Info animations in two Steam documents own separate timers');
        info.removeNativeInfoButton(document); info.removeNativeInfoPanel(document);
        check(animationTimers.size === 1,
          'Removing one document panel preserves the other document animation');
        info.removeNativeInfoPanel(foreignDoc);
        check(animationTimers.size === 0, 'Removing both panels cancels every animation timer');
      } finally { window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout; }
      mainPane.remove();
      info.removeNativeInfoButton(foreignDoc); info.removeNativeInfoPanel(foreignDoc); iframe.remove();
      return { ok: true, checks: results.length, results };
    }
    const sidebar = document.createElement('aside');
    sidebar.id = 'library-sidebar'; sidebar.className = load('css').LIBRARY_SIDEBAR_CLASSES().Container;
    sidebar.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:300px;overflow-y:auto';
    sidebar.innerHTML = '<div style="height:1600px">Library list</div>';
    const pane = document.createElement('main');
    pane.id = 'details-pane'; pane.style.cssText = 'position:fixed;left:240px;right:20px;top:20px;height:340px;overflow-y:auto';
    const playbar = document.createElement('div'); playbar.className = `${classes.Container} ${classes.InPage}`;
    playbar.style.cssText = 'height:60px;display:flex;justify-content:flex-end';
    const buttons = document.createElement('div'); buttons.className = classes.AppButtonsContainer;
    buttons.style.cssText = 'display:flex;min-width:120px;height:40px';
    const favorite = document.createElement('button'); favorite.className = classes.FavoriteButton;
    favorite.textContent = 'Favorite'; buttons.appendChild(favorite); playbar.appendChild(buttons);
    const links = document.createElement('div'); links.id = 'gdl-link-bar'; links.textContent = 'Store page';
    const content = document.createElement('div'); content.id = 'gdl-library-injected';
    content.style.height = '1600px'; content.textContent = 'Community content';
    pane.append(playbar, links, content); document.body.append(sidebar, pane);
    commit(playbar); commit(buttons);
    info.ensureNativeInfoPanel(document, model); info.ensureNativeInfoButton(document, model);
    const panel = document.getElementById('gdl-game-info-panel');
    const original = buttons.querySelector('[data-gdl-game-info-button="1"]');
    check(Boolean(original), 'The committed linked header receives its Info control');
    sidebar.scrollTop = 340; pane.scrollTop = 650; await flush(); await flush();
    check(original.dataset.gdlScrollTopActive === '1', 'The original button becomes Back to top after details scrolling');
    original.click(); await flush(600);
    check(pane.scrollTop === 0 && sidebar.scrollTop === 340,
      'The original Back-to-top button resets only the details pane');

    pane.scrollTop = 650; await flush(); await flush();
    const sticky = playbar.cloneNode(true); sticky.classList.remove(classes.InPage);
    sticky.style.cssText = 'position:fixed;left:240px;right:20px;top:0;height:60px;display:flex;justify-content:flex-end';
    const stickyButtons = sticky.querySelector(`.${classes.AppButtonsContainer}`);
    commit(sticky); commit(stickyButtons); document.body.appendChild(sticky);
    const clonedArrow = stickyButtons.querySelector('[data-gdl-game-info-button="1"]');
    check(clonedArrow !== original && clonedArrow.dataset.gdlScrollTopActive === '1',
      'Steam-style cloneNode(true) retains the visible Back-to-top attributes');
    info.ensureNativeInfoButton(document, model); await flush(); await flush();
    clonedArrow.click(); await flush(600);
    check(pane.scrollTop === 0 && sidebar.scrollTop === 340,
      'A cloned sticky Back-to-top control receives a live callback and preserves the library list');

    const replacement = document.createElement('main'); replacement.id = 'replacement-details-pane';
    replacement.style.cssText = pane.style.cssText;
    while (pane.firstChild) replacement.appendChild(pane.firstChild);
    pane.replaceWith(replacement); replacement.scrollTop = 700; await flush(); await flush();
    clonedArrow.click(); await flush(600);
    check(replacement.scrollTop === 0 && sidebar.scrollTop === 340,
      'The surviving sticky control discovers the replacement details scroller from live anchors');

    sticky.remove(); info.ensureNativeInfoButton(document, model); await flush(); await flush();
    const freshButton = original.cloneNode(true); original.replaceWith(freshButton);
    let callbacks = 0;
    const originalScrollTo = replacement.scrollTo;
    replacement.scrollTo = function (...args) { callbacks++; return originalScrollTo.apply(this, args); };
    for (let i = 0; i < 100; i++) info.ensureNativeInfoButton(document, model);
    replacement.scrollTop = 650; await flush(); await flush();
    freshButton.click(); await flush(600);
    check(replacement.scrollTop === 0 && callbacks === 1,
      '100 repeated synchronizations attach one working handler to an already marked rebuilt control');
    const topButton = freshButton.cloneNode(true); freshButton.replaceWith(topButton);
    info.ensureNativeInfoButton(document, model); await flush(); await flush();
    check(topButton.dataset.gdlScrollTopActive === '0', 'A rebuilt top-of-page control stays in Information mode');
    topButton.click();
    check(panel.dataset.expanded === '1', 'A rebuilt Information button toggles its panel exactly once');
    topButton.click();
    check(panel.dataset.expanded === '0', 'The same rebuilt Information button closes its panel exactly once');

    replacement.scrollTop = 650; await flush(); await flush();
    route = 3000000002;
    const callsBeforeRouteChange = callbacks;
    topButton.click(); await flush(600);
    check(replacement.scrollTop === 650 && callbacks === callsBeforeRouteChange,
      'A retained control cannot scroll a different shortcut after a route change');
    route = shortcutId; info.removeNativeInfoButton(document); info.removeNativeInfoPanel(document);
    check(!document.querySelector('[data-gdl-game-info-button="1"]'), 'Disposal removes all rebuilt controls');
    return { ok: true, checks: results.length, results };
  } catch (error) { return { ok: false, results, error: String(error.stack || error) }; }
}

const browser = await chromium.launch({ executablePath: edge, headless: true,
  args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check'] });
const reports = [];
try {
  for (const foreignOnly of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent('<!doctype html><html><body style="margin:0;background:#24282f;color:#dcdedf"></body></html>');
    reports.push(await page.evaluate(browserChecks, { sources, foreignOnly }));
    await page.close();
  }
} finally { await browser.close(); }
assert.ok(reports.every(report => report.ok), reports.filter(report => !report.ok)
  .map(report => `${report.error}\nPassed before failure: ${report.results.join('; ')}`).join('\n'));
console.log(`Info/Back-to-top browser passed: ${reports.reduce((sum, report) => sum + report.checks, 0)} assertions; cloned controls, live scrollers, sidebar isolation, idempotence, secondary documents and route retirement.`);
