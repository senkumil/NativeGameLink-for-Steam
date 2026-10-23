import './helpers/installed-steam-check.mjs';
// Render production Information features against Steam's installed renderer.
// Change density within the same document, including fallback and remounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { nativeFeatureIconOracle } from './helpers/native-feature-icon-oracle.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const oracle = nativeFeatureIconOracle(steam);
const sources = Object.fromEntries(Object.entries({
  'info-panel': 'frontend/features/library/info-panel.ts',
  info: process.env.INFO_ICON_STYLE_SOURCE || 'frontend/features/library/styles/info.ts',
  inject: 'frontend/features/library/styles/inject.ts', 'feature-icons': 'frontend/features/library/feature-icons.ts',
  text: 'frontend/core/text.ts', dom: 'frontend/core/dom.ts', 'native-dom': 'frontend/steam/native-dom.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const metrics = await context.newCDPSession(page);
  await page.exposeFunction('__changeMonitor', state => metrics.send('Emulation.setDeviceMetricsOverride', {
    width: state.width, height: state.height, deviceScaleFactor: state.dpr, mobile: false,
  }));
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><head></head><body style="margin:0;font-family:Arial;background:#24282f"></body></html>');
  await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
  const report = await page.evaluate(async ({ sources, oracle }) => {
    let assertions = 0, nativeLayout = true, shortcut = 3000000001;
    const check = (value, label) => { if (!value) throw Error(label); assertions++; };
    const near = (actual, expected, label, tolerance = .04) => check(Math.abs(actual - expected) <= tolerance,
      `${label}: actual=${actual}, native=${expected}`);
    const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const modules = {}, noop = () => {};
    const css = {
      GAME_INFO_CLASS_MODULE: () => ({ native: nativeLayout, classes: oracle.classes.info }),
      GAME_INFO_OUTER_CLASS_MODULE: () => ({ native: nativeLayout, classes: oracle.classes.outer }),
      PLAYBAR_CLASS_MODULE: () => ({ native: false, classes: {} }), PLAYBAR_CLASSES: () => ({}), LIBRARY_SIDEBAR_CLASSES: () => ({}),
    };
    const dependencies = {
      '../../steam/css': css, './css': css,
      '../../steam/localization': { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback },
      './localization': { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'english' },
      './native-route': { isPublicSteamLibraryRoute: () => false, routedSteamAppId: () => shortcut },
      './info-button-target': { isCurrentInfoShortcut: () => true, nativeInfoButtonContainers: () => [] },
      '../../steam/achievement-playbar-space': { syncAchievementPlaybarSpace: noop },
      '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
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
    const info = load('info-panel');
    const host = document.createElement('main'); host.style.width = '1500px';
    const reference = document.createElement('aside'); reference.id = 'native-icon-oracle';
    reference.style.width = '300px'; reference.innerHTML = oracle.rows.map(row => `<div data-native-feature="${row.kind}">${row.html}</div>`).join('');
    const links = document.createElement('div'); links.id = 'gdl-link-bar';
    host.append(links, reference); document.body.append(host);
    const model = { key: '1790600', title: 'Information scaling', isLegacy: false, portrait: '',
      description: 'A game description', developer: 'Developer', publisher: 'Publisher', franchise: '', release: '2026',
      features: oracle.rows.map(({ kind, label }) => ({ kind, label })), hasCloud: true };
    const mount = () => {
      const panel = info.ensureNativeInfoPanel(document, model);
      panel.style.setProperty('transition', 'none', 'important');
      info.setExpanded(document, model.key, true, false, false);
      return panel;
    };
    const measure = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      const zoom = Number(document.body.style.zoom || 1);
      const content = { width: rect.width / zoom - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: rect.height / zoom - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
      const svg = element.matches('svg') ? element : element.querySelector('svg');
      let drawing = null;
      if (svg) {
        const ink = svg.getBBox(), matrix = svg.getScreenCTM();
        drawing = { width: ink.width * Math.hypot(matrix.a, matrix.b) / zoom,
          height: ink.height * Math.hypot(matrix.c, matrix.d) / zoom };
      }
      return { width: rect.width / zoom, height: rect.height / zoom, content, drawing };
    };
    const svgShape = node => JSON.stringify([node.tagName,
      [...node.attributes].filter(attribute => !['class', 'aria-hidden', 'id'].includes(attribute.name))
        .map(attribute => [attribute.name, attribute.value.replace(/url\(#[^)]+\)/g, 'url(#clip)')])
        .sort(([left], [right]) => left.localeCompare(right)),
      [...node.children].map(child => svgShape(child))]);
    const compareIcons = (panel, label) => {
      for (const row of oracle.rows) {
        const actualRow = panel.querySelector(`[data-gdl-feature="${row.kind}"]`);
        const actual = actualRow.firstElementChild;
        const nativeRow = reference.querySelector(`[data-native-feature="${row.kind}"]`);
        const expected = nativeRow.querySelector(`.${oracle.classes.feature.Icon}`);
        check(Boolean(actual && expected), `${label}/${row.kind} renders both icons`);
        if (actual.matches('img')) {
          check(actual.complete && actual.naturalWidth > 0, `${label}/${row.kind} image decoded`);
          check(actual.getAttribute('src') === expected.getAttribute('src'), `${label}/${row.kind} uses the native image bytes`);
          check(getComputedStyle(actual).objectFit === getComputedStyle(expected).objectFit,
            `${label}/${row.kind} fits the image inside the viewport exactly as native`);
        }
        const a = measure(actual), b = measure(expected);
        for (const dimension of ['width', 'height']) {
          near(a[dimension], b[dimension], `${label}/${row.kind} box ${dimension}`);
          near(a.content[dimension], b.content[dimension], `${label}/${row.kind} content ${dimension}`);
        }
        if (a.drawing && b.drawing) {
          check(svgShape(actual) === svgShape(expected), `${label}/${row.kind} uses the native SVG shape`);
          near(a.drawing.width, b.drawing.width, `${label}/${row.kind} visible SVG width`, .12);
          near(a.drawing.height, b.drawing.height, `${label}/${row.kind} visible SVG height`, .12);
        }
        check(!actual.getAttribute('style'), `${label}/${row.kind} has no cached pixel overrides`);
      }
    };
    let panel = mount(), steps = 0;
    const states = [
      { width: 1920, height: 1080, dpr: 1, zoom: 1, pane: 1500 },
      { width: 1280, height: 720, dpr: 1.5, zoom: .8, pane: 850 },
      { width: 2560, height: 1440, dpr: 2, zoom: 1.25, pane: 1400 },
      { width: 1366, height: 768, dpr: 1.25, zoom: 1.5, pane: 550 },
      { width: 3840, height: 2160, dpr: 1.75, zoom: 2, pane: 1180 },
      { width: 900, height: 650, dpr: 2, zoom: 1, pane: 300 },
      { width: 1920, height: 1080, dpr: 1, zoom: 1, pane: 1500 },
    ];
    // A panel created while private CSS modules are unavailable must keep the
    // same feature metrics as a resolved panel, also after returning to native.
    for (const native of [true, false, true, false, true]) {
      nativeLayout = native;
      info.removeNativeInfoPanel(document); panel = mount();
      check(panel.dataset.gdlNativeLayout === String(Number(native)), `Mount uses ${native ? 'native' : 'fallback'} layout`);
      const icons = [...panel.querySelectorAll('.gdl-info-feature')].map(row => row.firstElementChild);
      for (const state of states) {
        await window.__changeMonitor(state);
        document.body.style.zoom = String(state.zoom); host.style.width = `${state.pane}px`;
        host.classList.toggle('NarrowRightPanel', state.pane < parseInt(oracle.classes.info.RightBreakNarrow));
        host.classList.toggle('UltraNarrowRightPanel', state.pane < 500);
        await Promise.all([...panel.querySelectorAll('.gdl-info-feature img')].map(img => img.decode().catch(() => {
          throw Error(`Production ${img.parentElement.dataset.gdlFeature} image failed to decode`);
        })));
        await frames(); await frames();
        near(window.devicePixelRatio, state.dpr, 'The density changes in the existing document');
        compareIcons(panel, `step${steps}/${native ? 'native' : 'fallback'}/${state.zoom}/${state.dpr}`);
        check(icons.every((icon, index) => icon === panel.querySelectorAll('.gdl-info-feature')[index].firstElementChild),
          'Resize and density changes preserve mounted feature nodes');
        check(info.ensureNativeInfoPanel(document, model) === panel, 'Settled synchronization preserves the panel');
        steps++;
      }
      // Exercise the same model update path that receives delayed metadata.
      const refreshed = { ...model, developer: 'Refreshed developer' };
      check(info.ensureNativeInfoPanel(document, refreshed) === panel, 'Metadata hydration preserves the panel');
      await frames(); compareIcons(panel, 'metadata refresh');
      if (!native) {
        nativeLayout = true;
        check(info.ensureNativeInfoPanel(document, refreshed) === panel, 'Restored modules preserve the existing panel');
        check(panel.dataset.gdlNativeLayout === '1' && panel.querySelector('.gdl-game-info-grid').classList.contains(oracle.classes.info.InnerContainer),
          'A fallback panel actually adopts native layout classes when modules arrive without changing game or metadata');
        await frames(); compareIcons(panel, 'modules available after fallback creation');
      }
      shortcut++;
    }
    const nativeMarkup = reference.outerHTML;
    info.removeNativeInfoPanel(document);
    check(reference.outerHTML === nativeMarkup, 'Cleanup leaves all native reference features unchanged');
    return { assertions, steps, features: oracle.rows.length };
  }, { sources, oracle });
  assert(report.assertions > 1000);
  console.log(`Information icon scaling passed: ${report.assertions} assertions; ${report.features} native features, ${report.steps} consecutive monitor/zoom/layout changes in one document, metadata refresh and cleanup.`);
} finally { await browser.close(); }
