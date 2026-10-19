import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { nativeScrollTopOracle } from './helpers/native-scrolltop-oracle.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const { classes, arrowHtml, infoHtml, scrollTopLabelToken } = nativeScrollTopOracle(steam);
const sources = Object.fromEntries(Object.entries({
  'info-panel': process.env.INFO_PANEL_SOURCE || 'frontend/features/library/info-panel.ts',
  'feature-icons': process.env.INFO_SCROLL_ICON_SOURCE || 'frontend/features/library/feature-icons.ts',
  info: 'frontend/features/library/styles/info.ts', inject: 'frontend/features/library/styles/inject.ts',
  'native-dom': 'frontend/steam/native-dom.ts', text: 'frontend/core/text.ts', dom: 'frontend/core/dom.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const reports = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: dpr });
    await page.setContent('<!doctype html><html><head></head><body style="margin:0;background:#24282f"></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
    const report = await page.evaluate(async ({ sources, classes, arrowHtml, infoHtml, scrollTopLabelToken, dpr }) => {
      let checks = 0, route = 3000000001;
      const check = (value, label) => { if (!value) throw Error(label); checks++; };
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const noop = () => {}, modules = {}, model = { key:'1790600', title:'Linked game', features:[] };
      const localization = { loc: (key, fallback) => key === scrollTopLabelToken ? 'Desplazarse al principio' : fallback,
        gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'spanish' };
      const css = { PLAYBAR_CLASS_MODULE: () => ({ native:true, classes }), PLAYBAR_CLASSES: () => classes,
        GAME_INFO_OUTER_CLASS_MODULE: () => ({ native:false, classes:{} }),
        LIBRARY_SIDEBAR_CLASSES: () => ({ Container:'library-list' }) };
      const dependencies = {
        '../../steam/css':css, './css':css, '../../steam/localization':localization, './localization':localization,
        './native-route': { routedSteamAppId: () => route, isPublicSteamLibraryRoute: () => route < 2147483648 },
        './info-button-target': { isCurrentInfoShortcut: (_doc, id) => route === id,
          nativeInfoButtonContainers: () => [...document.querySelectorAll(`.${classes.AppButtonsContainer}`)]
            .filter(node => Number(node.closest(`.${classes.Container}`)?.dataset.owner) === route) },
        '../../steam/achievement-playbar-space': { syncAchievementPlaybarSpace:noop },
        '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records,
          isLibrarySidebarNode: node => node instanceof Element && Boolean(node.closest('.library-list')) },
      };
      const load = name => {
        if (modules[name]) return modules[name];
        const exports = modules[name] = {};
        new Function('require', 'exports', sources[name])(dependency => {
          if (dependency in dependencies) return dependencies[dependency];
          const key = dependency.split('/').pop();
          if (key in sources) return load(key);
          throw Error(`Unexpected ${name} dependency ${dependency}`);
        }, exports);
        return exports;
      };
      load('info').ensureInfoPanelStyles(document);
      const info = load('info-panel');
      const pane = document.createElement('main');
      pane.style.cssText = 'position:fixed;left:250px;right:0;top:150px;height:600px;overflow:auto';
      pane.innerHTML = '<div class="TopCapsule" style="height:300px">Hero</div><div id="gdl-link-bar" style="height:200px">Links</div><div id="gdl-library-injected" style="height:2400px">Activity</div>';
      const list = document.createElement('aside'); list.className = 'library-list';
      list.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:400px;overflow:auto';
      list.innerHTML = '<div style="height:1800px">Library</div>';
      document.body.append(list, pane);
      const bars = [];
      const addBar = (inPage, sticky, owner = route) => {
        const bar = document.createElement('div'); bar.dataset.owner = String(owner);
        bar.className = [classes.Container, inPage && classes.InPage, sticky && classes.StickyHeader].filter(Boolean).join(' ');
        bar.style.cssText = `position:fixed;left:260px;top:${20 + bars.length * 40}px;width:150px;height:32px`;
        bar.innerHTML = `<div class="${classes.AppButtonsContainer}"><div class="${classes.MenuButton} ${classes.FavoriteButton}"></div></div>`;
        document.body.append(bar); if (owner === route) bars.push(bar); return bar;
      };
      const original = addBar(true, false), fixed = addBar(false, false), foreign = addBar(false, true, 570);
      const native = document.createElement('div');
      native.style.cssText = 'position:fixed;top:20px;left:600px;display:flex';
      native.innerHTML = `<div class="${classes.MenuButton}" data-arrow><div class="${classes.DotDotDot}">${arrowHtml}</div></div><div class="${classes.MenuButton}" data-info><div class="${classes.DotDotDot}">${infoHtml}</div></div>`;
      document.body.append(native);
      const foreignMarkup = foreign.outerHTML;
      const shape = node => JSON.stringify([node.tagName,
        [...node.attributes].filter(attribute => !['id','class','aria-hidden'].includes(attribute.name))
          .map(attribute => [attribute.name, attribute.value.replace(/;$/, '')]).sort(([a],[b]) => a.localeCompare(b)),
        [...node.children].map(shape)]);
      const assertModes = label => {
        for (const bar of bars) {
          const active = bar.classList.contains(classes.StickyHeader), button = bar.querySelector('[data-gdl-game-info-button]');
          check(Boolean(button), `${label}: every current bar has a control before paint`);
          check((button.dataset.gdlScrollTopActive === '1') === active, `${label}: mode follows that native StickyHeader commit`);
          const svg = button.querySelector('svg'), expected = native.querySelector(active ? '[data-arrow] svg' : '[data-info] svg');
          if (active) check(shape(svg) === shape(expected), `${label}: Arrow is the installed native SVG, including both polylines`);
          else check(svg.classList.contains('SVGIcon_Information'), `${label}: the unscrolled native state keeps Information`);
          const actualBox = svg.getBoundingClientRect(), expectedBox = expected.getBoundingClientRect();
          check(Math.abs(actualBox.width - expectedBox.width) < .1 && Math.abs(actualBox.height - expectedBox.height) < .1,
            `${label}: glyph dimensions inherit the same native wrapper at zoom ${document.body.style.zoom || 1}`);
          const buttonBox = button.getBoundingClientRect(), nativeButtonBox = expected.closest(`.${classes.MenuButton}`).getBoundingClientRect();
          check(Math.abs(buttonBox.width - nativeButtonBox.width) < .1 && Math.abs(buttonBox.height - nativeButtonBox.height) < .1,
            `${label}: the button retains the native dimensions`);
          check(Math.abs((actualBox.left - buttonBox.left) - (expectedBox.left - nativeButtonBox.left)) < .1
            && Math.abs((actualBox.top - buttonBox.top) - (expectedBox.top - nativeButtonBox.top)) < .1,
            `${label}: the glyph has the same native inset and vertical offset`);
          if (active) {
            check(getComputedStyle(svg.querySelector('polyline')).strokeWidth === getComputedStyle(expected.querySelector('polyline')).strokeWidth,
              `${label}: Arrow inherits the native stroke thickness`);
            check(button.title === 'Desplazarse al principio', `${label}: tooltip uses Steam's native localization token`);
          }
        }
      };
      info.ensureNativeInfoButton(document, model);
      assertModes('initial synchronous mount');
      const identities = bars.map(bar => bar.querySelector('[data-gdl-game-info-button]'));
      for (const zoom of [.8, 1, 1.25, 1.5, 2]) {
        document.body.style.zoom = String(zoom);
        for (const state of [
          { sticky:true, top:0 }, { sticky:false, top:900 },
          { sticky:true, top:1 }, { sticky:false, top:0 },
          { sticky:true, top:450 }, { sticky:false, top:450 },
        ]) {
          pane.scrollTop = state.top;
          for (const bar of bars) bar.classList.toggle(classes.StickyHeader, state.sticky);
          // A queued microtask and the first paint must already agree with the
          // native commit; do not wait for plugin timeouts or settle budgets.
          await Promise.resolve(); await Promise.resolve();
          assertModes(`commit/zoom${zoom}/scroll${state.top}/sticky${state.sticky}`);
          await new Promise((resolve, reject) => requestAnimationFrame(() => {
            try { assertModes('first native paint'); resolve(); } catch (error) { reject(error); }
          }));
          check(bars.every((bar, index) => bar.querySelector('[data-gdl-game-info-button]') === identities[index]),
            'Mode commits preserve the same button nodes');
        }
      }
      // Each copy owns its own committed prop, including during staggered commits.
      original.classList.add(classes.StickyHeader); fixed.classList.remove(classes.StickyHeader);
      await Promise.resolve(); await Promise.resolve(); assertModes('staggered copies');
      const remounted = addBar(false, true); await Promise.resolve(); await Promise.resolve();
      assertModes('new sticky copy before first paint');
      const replaced = remounted.querySelector(`.${classes.AppButtonsContainer}`);
      replaced.innerHTML = `<div class="${classes.MenuButton} ${classes.FavoriteButton}"></div>`;
      await Promise.resolve(); await Promise.resolve(); assertModes('rebuilt native button cluster');
      for (let cycle = 0; cycle < 100; cycle++) {
        original.classList.toggle(classes.StickyHeader, cycle % 2 === 0);
        await Promise.resolve(); await Promise.resolve();
        assertModes(`commit cycle ${cycle}`);
      }
      list.scrollTop = 500; await frames(); assertModes('left library scroll');
      const stableGlyphs = bars.map(bar => bar.querySelector('[data-gdl-game-info-button] svg'));
      const stableWrites = [];
      const stableObserver = new MutationObserver(records => stableWrites.push(...records));
      for (const bar of bars) stableObserver.observe(bar.querySelector('[data-gdl-game-info-button]'),
        { subtree:true, attributes:true, childList:true });
      for (let repeat = 0; repeat < 100; repeat++) {
        info.ensureNativeInfoButton(document, model); window.dispatchEvent(new Event('resize'));
      }
      await frames(); stableWrites.push(...stableObserver.takeRecords()); stableObserver.disconnect();
      check(stableWrites.length === 0, '100 settled native-state synchronizations produce zero button or glyph writes');
      check(bars.every((bar, index) => bar.querySelector('[data-gdl-game-info-button] svg') === stableGlyphs[index]),
        'Settled scrolling and resize signals never replace an unchanged SVG');
      check(foreign.outerHTML === foreignMarkup, 'Every native game control remains byte-for-byte unchanged');
      const retired = original.querySelector('[data-gdl-game-info-button]');
      route = 3000000002; const previous = pane.scrollTop;
      retired.click(); await frames(); check(pane.scrollTop === previous, 'A retired control cannot scroll the next shortcut');
      route = 3000000001; info.removeNativeInfoButton(document);
      check(!document.querySelector('[data-gdl-game-info-button]'), 'Disposal removes every owned copy');
      return { checks, dpr };
    }, { sources, classes, arrowHtml, infoHtml, scrollTopLabelToken, dpr });
    reports.push(report); await page.close();
  }
} finally { await browser.close(); }
assert.equal(reports.length, 2);
console.log(`Native scroll-top parity passed: ${reports.reduce((sum, report) => sum + report.checks, 0)} checks; installed SVG/CSS and sticky commit, first paint, zoom 80–200%, DPR1/2, both copies, rebuilt controls, 100 commits, sidebar and route isolation.`);
