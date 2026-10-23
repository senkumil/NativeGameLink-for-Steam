import './helpers/installed-steam-check.mjs';
// Render Steam's installed Info component with inert data adapters, then compare
// production GDL geometry against that independent renderer and the real CSS.
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
const classes = {};
for (const [name, id] of Object.entries({ info: 76052, outer: 70989, asset: 79614, feature: 92107, columns: 69359 })) {
  classes[name] = literalExports.readPureClassFactory(factories[id]);
  assert(classes[name], `Installed ${name} CSS factory retains its literal contract`);
}
const picture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#466580"/></svg>');
const model = { key: '1790600', title: 'External game', isLegacy: false, portrait: picture,
  description: 'Explore a detailed world, discover its secrets, and challenge powerful enemies. Every choice changes your adventure through a beautifully crafted landscape.',
  developer: 'A fairly long developer name', publisher: 'Publishing studio', franchise: 'The franchise', release: '18 Oct, 2026',
  features: [{ kind: 'singleplayer', label: 'Single-player' }, { kind: 'achievements', label: 'Steam Achievements' },
    { kind: 'cloud', label: 'Steam Cloud' }, { kind: 'controller', label: 'Full controller support' }] };
const jsx = (type, props = {}) => ({ type, props });
const Fragment = Symbol('Fragment');
class Component { constructor(props) { this.props = props; } }
const combine = (...values) => values.flat().filter(value => typeof value === 'string' && value).join(' ');
const labels = { '#AppDetails_Developer': 'Developer:', '#AppDetails_Publisher': 'Publisher:', '#AppDetails_Franchise': 'Franchise:', '#AppDetails_ReleaseDate': 'Release date:' };
const featureIds = { $: 'singleplayer', II: 'achievements', TQ: 'cloud', _j: 'controller' };
const nativeDependencies = {
  62540: { jsx, jsxs: jsx, Fragment }, 63696: { Component, createRef: () => ({ current: null }) },
  41230: { PA: value => value }, 89193: { Gn() {}, sH() {} }, 71262: { oI: (_target, _key, descriptor) => descriptor },
  8658: { A: combine }, 76052: classes.info, 70989: classes.outer,
  7727: { we: token => labels[token] || token, $z: () => model.release },
  32558: { H: { GetAssociations: () => ({ rgDevelopers: [{ strName: model.developer }], rgPublishers: [{ strName: model.publisher }], rgFranchises: [{ strName: model.franchise }] }),
    GetDescriptions: () => ({ strSnippet: model.description }) } },
  87722: { B7: { ResolveURL: () => 'https://store.steampowered.com/search' } },
  94601: { b_A: 'portrait' }, 42095: { eSy: () => null },
  22189: featureIds,
  83420: { n$: props => {
    const feature = model.features.find(item => item.kind === props.feature);
    return feature ? jsx('div', { className: classes.feature.Container, children: [
      jsx('svg', { className: classes.feature.Icon, viewBox: '0 0 24 24' }),
      jsx('div', { className: classes.feature.Label, children: feature.label }),
    ] }) : null;
  } },
  // Steam's library-asset component creates this proportional image wrapper.
  // Keep its actual CSS contract; no fixed portrait dimensions in the oracle.
  83036: { z: props => jsx('div', { className: combine(classes.asset.Container, classes.asset.PortraitImage, props.className), children:
    jsx('img', { src: picture, className: combine(classes.asset.Image, classes.asset.Visibility, classes.asset.Visible), alt: model.title }) }) },
  41558: { FD: () => [false] }, 90095: { q3: callback => callback() },
};
const nativeRequire = id => nativeDependencies[id] || {};
nativeRequire.d = (target, values) => { for (const [name, getter] of Object.entries(values)) Object.defineProperty(target, name, { get: getter }); };
nativeRequire.n = value => () => value;
const nativeExports = {};
factories[85358]({}, nativeExports, nativeRequire);
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function html(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(html).join('');
  if (typeof node !== 'object') return escape(node);
  const { type, props } = node;
  if (type === Fragment) return html(props.children);
  if (typeof type === 'function') {
    if (type.prototype?.render) {
      const instance = new type(props);
      if ('m_bDelayedLoad' in instance) instance.m_bDelayedLoad = false;
      return html(instance.render());
    }
    return html(type(props));
  }
  assert.equal(typeof type, 'string', 'The installed renderer retains the expected native Info tree');
  const attributes = Object.entries(props).filter(([name, value]) => !['children', 'ref', 'style'].includes(name) && !name.startsWith('on') && value !== undefined)
    .map(([name, value]) => ` ${name === 'className' ? 'class' : name}="${escape(value)}"`).join('');
  return `<${type}${attributes}>${html(props.children)}${['img', 'input'].includes(type) ? '' : `</${type}>`}`;
}
const oracle = html(jsx(nativeExports.b, { overview: { appid: 1790600, display_name: model.title, BIsModOrShortcut: () => false, GetCanonicalReleaseDate: () => 1 },
  details: {}, expand: true, collapsible: false, suppressTransition: true }));
assert(oracle.includes(classes.info.AssociationList) && oracle.includes(classes.asset.PortraitImage), 'Oracle uses the installed native association and portrait renderers');
const sources = Object.fromEntries(Object.entries({
  'info-panel': process.env.INFO_PANEL_SOURCE || 'frontend/features/library/info-panel.ts', info: 'frontend/features/library/styles/info.ts',
  inject: 'frontend/features/library/styles/inject.ts', layout: 'frontend/features/library/layout.ts',
  'native-dom': 'frontend/steam/native-dom.ts', text: 'frontend/core/text.ts', dom: 'frontend/core/dom.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const reports = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.exposeFunction('__resizeLibraryWindow', width => page.setViewportSize({ width, height: 1000 }));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head></head><body style="margin:0;font-family:Arial;background:#24282f"></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
    const result = await page.evaluate(async ({ sources, classes, model, oracle, dpr }) => {
      const results = [], modules = {}, noop = () => {};
      const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
      const near = (left, right, description, tolerance = 1) => check(Math.abs(left - right) <= tolerance,
        `${description}: native=${right}, GDL=${left}`);
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      let publicRoute = false, observerWrites = 0, nativeLayout = true;
      const css = {
        GAME_INFO_CLASS_MODULE: doc => { check(doc === document, 'Info classes resolve in the owner document'); return { native: nativeLayout, classes: classes.info }; },
        GAME_INFO_OUTER_CLASS_MODULE: doc => { check(doc === document, 'Outer Info classes resolve in the owner document'); return { native: nativeLayout, classes: classes.outer }; },
        PLAYBAR_CLASS_MODULE: () => ({ native: false, classes: {} }), PLAYBAR_CLASSES: () => ({}), LIBRARY_SIDEBAR_CLASSES: () => ({}),
        resolveClassModule: () => classes.columns,
      };
      const dependencies = {
        '../../steam/css': css, './css': css,
        '../../steam/localization': { loc: (_token, fallback) => fallback, gdlText: (_token, fallback) => fallback },
        './localization': { loc: (_token, fallback) => fallback, steamLanguageSync: () => 'english' },
        './native-route': { isPublicSteamLibraryRoute: () => publicRoute, routedSteamAppId: () => publicRoute ? 570 : 3000000001 },
        './info-button-target': { isCurrentInfoShortcut: () => true, nativeInfoButtonContainers: () => [] },
        '../../steam/achievement-playbar-space': { syncAchievementPlaybarSpace: noop },
        './feature-icons': { nativeArrowSvg: () => '', nativeFeatureVisual: () => '<svg viewBox="0 0 24 24"></svg>' },
        '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
        '../../steam/library-details': { committedHeaderAppId: () => null, isPaintedLibraryElement: () => true },
        '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility: noop },
        '../../steam/library-header': { containsNativeLibraryHeader: () => false, isInsideNativeLibraryHeader: () => false, findNativeLibraryHeader: () => null },
      };
      const load = name => {
        if (modules[name]) return modules[name];
        const exports = modules[name] = {};
        new Function('require', 'exports', sources[name] + (name === 'info-panel' ? '\nexports.setExpanded = setNativeInfoExpanded;' : ''))(dependency => {
          if (dependency in dependencies) return dependencies[dependency];
          const key = dependency.split('/').pop();
          if (key in sources) return load(key);
          throw Error(`Unexpected ${name} dependency ${dependency}`);
        }, exports);
        return exports;
      };
      load('info').ensureInfoPanelStyles(document);
      const info = load('info-panel'), layout = load('layout');
      const host = document.createElement('div'); host.style.cssText = 'width:1600px';
      document.body.append(host);
      const fixture = (native, id) => {
        const root = document.createElement('div'); root.id = id;
        const panel = document.createElement('div'); panel.style.width = '100%'; root.append(panel);
        if (native) panel.innerHTML = oracle;
        else panel.innerHTML = '<div id="gdl-link-bar"></div>';
        const body = document.createElement('div'); body.className = classes.columns.Container;
        body.innerHTML = `<div class="${classes.columns.ColumnContainer}"><div class="${classes.columns.RightColumn}"><div style="height:130px">Sidebar</div></div><div class="${classes.columns.LeftColumn}"><div style="height:210px">Activity</div></div></div>`;
        root.append(body); host.append(root);
        return root;
      };
      const reference = fixture(true, 'native-oracle'), linked = fixture(false, 'linked-fixture');
      const panel = info.ensureNativeInfoPanel(document, model);
      check(panel?.dataset.gdlNativeLayout === '1', 'Production Info resolves the installed native layout');
      panel.style.setProperty('transition', 'none', 'important');
      info.setExpanded(document, model.key, true, false, false);
      const row = linked.querySelector(`.${classes.columns.ColumnContainer}`);
      const content = linked.querySelector(`.${classes.columns.LeftColumn}`);
      const sidebar = linked.querySelector(`.${classes.columns.RightColumn}`);
      const originalWidths = [row, content, sidebar].map(node => node.style.width);
      layout.prepareNativeLibraryLayout({ anchorRegion: null, sidebarColumn: sidebar, twoColumnRow: row, contentColumn: content, noticeParent: null });
      check([row, content, sidebar].every((node, index) => node.style.width === originalWidths[index]), 'Preparing linked columns preserves Steam width ownership');
      const geometry = (root, name) => root.querySelector(`.${name}`).getBoundingClientRect();
      const compare = (label, names) => {
        for (const name of names) {
          const expected = geometry(reference, name), actual = geometry(linked, name);
          near(actual.width, expected.width, `${label} ${name} width`);
          near(actual.height, expected.height, `${label} ${name} height`);
          near(actual.left - linked.getBoundingClientRect().left, expected.left - reference.getBoundingClientRect().left, `${label} ${name} offset`);
          near(actual.top - linked.getBoundingClientRect().top, expected.top - reference.getBoundingClientRect().top, `${label} ${name} vertical offset`);
        }
      };
      const states = [
        { width: 1920, sidebar: 280 }, { width: 1600, sidebar: 260 }, { width: 1150, sidebar: 220 },
        { width: 1100, sidebar: 260 }, { width: 900, sidebar: 280 }, { width: 1280, sidebar: 400 },
        { width: 1600, sidebar: 800 }, { width: 1600, sidebar: 1050 },
      ];
      for (const zoom of [.8, 1, 1.25]) {
        document.body.style.zoom = String(zoom);
        for (const state of states) {
          await window.__resizeLibraryWindow(state.width);
          // Steam publishes these CSS-module breakpoints from its measured
          // logical window/right-panel widths. Resize the list independently.
          const paneWidth = state.width / zoom - state.sidebar;
          host.style.width = `${paneWidth}px`;
          host.style.marginLeft = `${state.sidebar}px`;
          host.classList.toggle('NarrowWindow', state.width / zoom < parseInt(classes.columns.BreakNarrow));
          host.classList.toggle('NarrowRightPanel', paneWidth < parseInt(classes.info.RightBreakNarrow));
          host.classList.toggle('UltraNarrowRightPanel', paneWidth < parseInt(classes.columns.RightBreakUltraNarrow));
          await frames(); await frames();
          const label = `${state.width}px/list${state.sidebar}/zoom${zoom}/DPR${dpr}`;
          compare(label, [classes.info.InnerContainer, classes.info.Portrait, classes.info.Description, classes.info.Stats, classes.info.FeaturesList,
            classes.columns.ColumnContainer, classes.columns.LeftColumn, classes.columns.RightColumn]);
          const labelStyle = getComputedStyle(panel.querySelector('.gdl-info-label'));
          const nativeLabelStyle = getComputedStyle(reference.querySelector(`.${classes.info.Label}`));
          check(labelStyle.fontSize === nativeLabelStyle.fontSize && labelStyle.textTransform === nativeLabelStyle.textTransform,
            `${label} association labels inherit native typography`);
          near(panel.offsetHeight, panel.firstElementChild.scrollHeight, `${label} expanded height uses logical CSS pixels`);
        }
      }
      const observer = new MutationObserver(records => { observerWrites += records.filter(record => record.attributeName === 'style').length; });
      await delay(340); await frames();
      observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
      for (let index = 0; index < 80; index++) info.setExpanded(document, model.key, true, false, false);
      await frames(); observerWrites += observer.takeRecords().length;
      check(observerWrites === 0, 'Eighty settled height synchronizations produce zero style writes');
      observer.disconnect();
      panel.style.removeProperty('transition');
      // Capture every explicit height in a collapse/reopen interrupt cycle.
      // getBoundingClientRect would make a >1 zoom start taller than its content.
      const heights = [], style = panel.style;
      Object.defineProperty(style, 'height', { configurable: true, get() { return style.getPropertyValue('height'); },
        set(value) { heights.push(parseFloat(value)); style.setProperty('height', value); } });
      const expandedHeight = panel.offsetHeight;
      info.setExpanded(document, model.key, false, false, true);
      check(heights[0] === 0 || heights[0] === expandedHeight, 'Collapse starts at unscaled layout height under CSS zoom');
      info.setExpanded(document, model.key, true, false, true);
      await delay(360); delete style.height;
      near(panel.offsetHeight, panel.firstElementChild.scrollHeight, 'Interrupted expansion settles at logical content height');
      const before = reference.outerHTML;
      publicRoute = true;
      check(info.ensureNativeInfoPanel(document, model) === null && !panel.isConnected, 'Public route retires only the owned Info panel');
      check(reference.outerHTML === before, 'Native Info, sidebar, columns and inline styles remain byte-for-byte unchanged');
      layout.restoreNativeLibraryStyles(document);
      check([row, content, sidebar].every(node => !node.getAttribute('style')), 'Linked column restoration removes every temporary geometry override');
      publicRoute = false; nativeLayout = false;
      const fallback = info.ensureNativeInfoPanel(document, model);
      fallback.style.setProperty('transition', 'none', 'important');
      info.setExpanded(document, model.key, true, false, false);
      await window.__resizeLibraryWindow(1600);
      for (const [paneWidth, columns] of [[1400, 4], [1000, 3], [800, 2], [300, 2]]) {
        host.style.width = `${paneWidth}px`;
        await frames(); await frames();
        const grid = fallback.querySelector('.gdl-game-info-grid');
        check(getComputedStyle(grid).gridTemplateColumns.split(' ').length === columns,
          `Unresolved-class fallback follows its ${paneWidth}px pane at an unchanged window size`);
        check(grid.scrollWidth <= grid.clientWidth + 1, `Fallback columns do not overflow the ${paneWidth}px pane`);
      }
      const coldGrid = fallback.querySelector('.gdl-game-info-grid'), coldImage = fallback.querySelector('img');
      nativeLayout = true; host.style.width = '1400px';
      host.classList.remove('NarrowWindow', 'NarrowRightPanel', 'UltraNarrowRightPanel');
      check(info.ensureNativeInfoPanel(document, model) === fallback,
        'Late native classes upgrade the cold panel without replacing its section');
      await frames(); await frames();
      check(fallback.dataset.gdlNativeLayout === '1' && fallback.dataset.expanded === '1',
        'Unchanged metadata still adopts newly ready native classes and preserves the open state');
      check(fallback.querySelector('.gdl-game-info-grid') === coldGrid && fallback.querySelector('img') === coldImage,
        'Class promotion preserves the live grid and decoded portrait');
      compare('late native Info module recovery', [classes.info.InnerContainer, classes.info.Portrait,
        classes.info.Description, classes.info.Stats, classes.info.FeaturesList]);
      near(fallback.offsetHeight, fallback.firstElementChild.scrollHeight,
        'Late class promotion recomputes the expanded height in logical pixels');
      info.removeNativeInfoPanel(document);
      return { assertions: results.length, cases: states.length * 3, dpr };
    }, { sources, classes, model, oracle, dpr });
    reports.push(result);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Desktop responsive layout passed: ${reports.reduce((sum, report) => sum + report.assertions, 0)} assertions across ${reports.reduce((sum, report) => sum + report.cases, 0)} native-renderer/CSS geometry cases (window, resizable list, zoom .8/1/1.25, DPR 1/2); logical expansion, settled writes, and public-game isolation.`);
