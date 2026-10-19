import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Use the installed client's BoxRow factory and CSS as the oracle. No copied
// count formula, account fixture or network request can mask a geometry drift.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steamui = process.env.STEAM_UI_ROOT || 'C:/Program Files (x86)/Steam/steamui';
const self = { webpackChunksteamui: [] };
for (const name of ['library', 'sp', 'chunk~2dcc5aaf7']) {
  vm.runInNewContext(fs.readFileSync(path.join(steamui, `${name}.js`), 'utf8'), { self });
}
const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const classes = Object.fromEntries([10335, 3299, 18980, 83097].map(id => {
  const module = { exports: {} }; factories[id](module); return [id, module.exports];
}));
assert(factories[50178]?.toString().includes('totalItemOverride'), 'Installed Steam BoxRow factory required');
const sources = Object.fromEntries([
  ['sidebar', 'frontend/features/achievements/sidebar.ts'],
  ['sidebar-style', 'frontend/features/achievements/styles/sidebar.ts'],
  ['modal', 'frontend/features/achievements/modal.ts'],
  ['modal-style', 'frontend/features/achievements/styles/modal.ts'],
  ['inject', 'frontend/features/achievements/styles/inject.ts'],
  ['rare', 'frontend/features/achievements/styles/rare.ts'],
  ['mask', 'frontend/features/achievements/styles/mask.ts'],
  ['rarity', 'frontend/features/achievements/rarity.ts'],
  ['format', 'frontend/features/achievements/format.ts'],
  ['text', 'frontend/core/text.ts'],
].map(([key, filename]) => [key, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const browser = await chromium.launch({ executablePath: process.env.ACHIEVEMENT_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const nativeCss = fs.readFileSync(path.join(steamui, 'css/sp.css'), 'utf8');
const reports = [];
try {
  // CEF zoom changes the CSS viewport and DPR together; CSS zoom additionally
  // exercises fractional layout coordinates without changing physical pixels.
  for (const [scale, zoom] of [[1, .75], [1.25, 1], [1.5, 1.25], [1.5, 1.5], [2, 2]]) {
    const context = await browser.newContext({ viewport: { width: 1536, height: 900 }, deviceScaleFactor: scale });
    const page = await context.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<html class="DesktopUI"><head></head><body style="margin:0;font-family:Arial;font-size:14px"></body></html>');
    await page.addStyleTag({ content: nativeCss });
    const report = await page.evaluate(async ({ sources, classes, boxFactory, scale, zoom }) => {
      const checks = [], loaded = {};
      const check = (condition, text) => { if (!condition) throw new Error(text); checks.push(text); };
      const near = (a, b, text) => check(Math.abs(a - b) <= .15, `${text}: ${a} / ${b}`);
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const settle = async () => { for (let i = 0; i < 4; i++) await frame(); };
      const icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="gray"/></svg>';
      const target = { steamAppId: '100', shortcutAppId: '3000000001' };
      const deps = {
        '../../api/backend': { backendLog() {} },
        '../../steam/localization': { loc: (_key, fallback) => fallback,
          gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m) },
        './cache': { cacheLocalAchievements() {}, localAchievementDataSignature: data => JSON.stringify(data), pickCachedLocalAchievementSnapshot: data => data },
        './playbar': { ensureLocalPlaybarStat() {} },
        './steam-rare': { getSteamRareAchievementClasses: () => ({ wrapper: '', icon: '', iconGlow: '' }), renderSteamRareGlowHtml: () => '' },
        './game-info': { getLocalAchievementGameInfo: async () => ({ name: 'Achievement geometry', iconImage: icon, heroImage: icon }) },
        './comparison': { getAchievementComparisonFriends: async () => [], getFriendAchievementState: async () => new Map() },
        './navigation': { linkedAchievementTarget: () => target, isCurrentAchievementTarget: () => true },
        '../library/social/feed': { getCurrentSteamUser: () => ({ name: 'Geometry', avatar: icon }) },
      };
      const aliases = { '../../core/text': 'text', './format': 'format', './rarity': 'rarity',
        './inject': 'inject', './rare': 'rare', './mask': 'mask', './modal': 'modal', './styles/modal': 'modal-style' };
      const load = name => {
        if (loaded[name]) return loaded[name];
        const exports = {}; loaded[name] = exports;
        new Function('require', 'exports', sources[name])(id => {
          if (id in deps) return deps[id];
          if (id in aliases) return load(aliases[id]);
          throw new Error(`Unexpected ${name} dependency ${id}`);
        }, exports);
        return exports;
      };
      const css = classes[10335], rowCss = classes[3299], itemCss = classes[18980], headCss = classes[83097];
      const native = document.createElement('div');
      native.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
      native.innerHTML = `<div class="${rowCss.InnerContainer}"><div class="${rowCss.ItemWrapper}" id="native-item"><div class="${css.AdditionalItem}"><img class="${css.Icon}" src='${icon}'></div></div></div>
        <div class="${css.Featured} ${css.RightAchievementSection}" id="native-feature"><div><img class="${css.Icon}" src='${icon}'></div><div class="${css.TextSection}"><div class="${css.Name}">Achievement</div><div class="${css.Desc}">Description</div></div></div>
        <div class="${itemCss.AchievementListItemBase}"><div class="${itemCss.Container}"><div class="${itemCss.Content}"><div class="${itemCss.AchievementTitle}">Title</div><div class="${itemCss.AchievementDescription}">Description</div></div></div></div>
        <div class="${headCss.Container}"><div class="${headCss.Title}">Game <img class="${headCss.GameIcon}" src='${icon}'></div></div>`;
      document.body.append(native);
      // Execute the real factory's render method with its measured DOM inputs.
      const nativeDeps = { 62540: { jsx: (type, props) => ({ type, props }) },
        63696: { Component: class { constructor(props) { this.props = props; } } },
        41230: { PA: value => value }, 71262: { oI() {} }, 34560: { s: () => () => {} }, 3299: rowCss };
      const req = id => nativeDeps[id];
      req.d = (object, values) => Object.defineProperties(object, Object.fromEntries(Object.entries(values).map(([k, get]) => [k, { get }])));
      req.n = value => () => value;
      const exports = {}; new Function(`return (${boxFactory})`)()({}, exports, req);
      const expectedRow = (width, total) => {
        let icons = 0, more = 0;
        const component = new exports.S({ items: Array.from({ length: total }, (_, i) => i), keyExtractor: String,
          itemRenderer: () => { icons++; }, remainderRenderer: count => { more = count; } });
        component.m_elContainer = { clientWidth: width };
        component.m_elItem = document.getElementById('native-item');
        component.render(); return { icons, more };
      };
      const fixture = document.createElement('section'); fixture.id = 'gdl-achievements-section';
      fixture.style.cssText = `position:relative;zoom:${zoom}`;
      fixture.innerHTML = '<div id="gdl-achievements-content"></div>'; document.body.append(fixture);
      load('sidebar-style').ensureAchievementSidebarStyles(document);
      const sidebar = load('sidebar');
      const data = { found: true, appid: '100', state_appid: '3000000001', total: 50, unlocked: 12,
        achievements: Array.from({ length: 50 }, (_, i) => ({ name: `A${i}`, display_name: 'Achievement', description: 'Description',
          earned: i < 12, earned_time: i + 1, icon, icon_gray: icon, global_percent: 70 - i, progress: 2, max_progress: 10 })) };
      for (const width of [126, 240, 300, 356, 357.5, 520, 700, 300]) {
        fixture.style.width = `${width}px`; sidebar.renderLocalAchievementSidebar(document, data); await settle();
        for (const [selector, total] of [['.gdl-la-earned-row-wrap', 11], ['.gdl-la-locked-row-wrap', 38]]) {
          const wrap = fixture.querySelector(selector), expected = expectedRow(wrap.clientWidth, total);
          check(wrap.querySelectorAll('.gdl-la-icon-frame').length === expected.icons,
            `${scale}/${zoom}/${width}: ${selector} actual native BoxRow count`);
          check((wrap.querySelector('.gdl-la-more')?.textContent || '') === (expected.more ? `+${expected.more}` : ''),
            `${scale}/${zoom}/${width}: ${selector} actual native remainder`);
        }
      }
      for (const [mine, theirs, properties] of [
        ['.gdl-la-feature-title', `.${css.Name}`, ['fontSize', 'fontWeight', 'lineHeight', 'color']],
        ['.gdl-la-feature-desc', `.${css.Desc}`, ['fontSize', 'fontWeight', 'lineHeight', 'color']],
      ]) for (const property of properties) check(getComputedStyle(fixture.querySelector(mine))[property]
        === getComputedStyle(native.querySelector(theirs))[property], `${scale}/${zoom}: native sidebar ${property} ${mine}`);
      const feature = fixture.querySelector('.gdl-la-feature'), nativeFeature = native.querySelector('#native-feature');
      near(parseFloat(getComputedStyle(feature).marginBottom), parseFloat(getComputedStyle(nativeFeature).marginBottom), 'Native feature spacing');

      fixture.remove();
      (zoom === 1.25 || zoom === 2 ? document.documentElement : document.body).style.zoom = String(zoom);
      const pane = document.createElement('div'); pane.style.cssText = 'position:fixed;left:446px;top:78px;width:1090px;height:740px';
      pane.innerHTML = '<div id="gdl-library-injected" style="height:100%"></div>'; document.body.append(pane);
      pane.style.cssText = `position:fixed;left:${446 / zoom}px;top:${78 / zoom}px;width:${1090 / zoom}px;height:${740 / zoom}px`;
      window.responsiveAchievementTest = { data, pane, zoom, modal: load('modal'), native, itemCss, headCss, checks, near, check, settle };
      await window.responsiveAchievementTest.modal.openLocalAchievementsModal(document, data); await settle();
      return { checks: checks.length };
    }, { sources, classes, boxFactory: factories[50178].toString(), scale, zoom });
    let checks = report.checks;
    // Resize the open production modal in the same document, keeping row state.
    for (const [viewport, paneBounds] of [
      [[1536, 900], [446, 78, 1090, 740]], [[1536, 900], [700, 78, 600, 700]],
      [[1000, 700], [300, 60, 700, 600]], [[800, 600], [220, 40, 580, 520]],
      [[640, 520], [180, 30, 460, 460]], [[1536, 900], [446, 78, 1090, 740]],
    ]) {
      await page.setViewportSize({ width: viewport[0], height: viewport[1] });
      checks = await page.evaluate(async bounds => {
        const t = window.responsiveAchievementTest, [left, top, width, height] = bounds;
        t.pane.style.cssText = `position:fixed;left:${left / t.zoom}px;top:${top / t.zoom}px;width:${width / t.zoom}px;height:${height / t.zoom}px`;
        window.dispatchEvent(new Event('resize')); await t.settle();
        const overlay = document.getElementById('gdl-local-achievement-modal'), dialog = overlay.querySelector('.gdl-lam-window');
        const box = overlay.getBoundingClientRect(), dialogBox = dialog.getBoundingClientRect();
        t.near(box.left, left, 'Modal tracks pane left'); t.near(box.width, width, 'Modal tracks pane width');
        t.check(box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, 'Modal overlay stays in CSS viewport');
        t.check(dialogBox.right <= box.right + 1 && dialogBox.left >= box.left - 1, 'Dialog stays in pane');
        t.check(overlay.classList.contains('gdl-lam-compact-pane') === (width / t.zoom <= 900), 'Compact breakpoint uses logical overlay width');
        for (const tab of ['mine', 'global']) {
          overlay.querySelector(`[data-tab="${tab}"]`).click(); await t.settle();
          for (const selector of ['.gdl-lam-toolbar', '.gdl-lam-tabs', '.gdl-lam-row']) {
            const element = overlay.querySelector(selector);
            t.check(element.scrollWidth <= element.clientWidth + 1
              || (selector === '.gdl-lam-tabs' && getComputedStyle(element).overflowX === 'auto'),
              `${width}/${tab}: ${selector} fits or scrolls within available dialog width`);
          }
          const icon = overlay.querySelector('.gdl-lam-row-icon-frame');
          t.near(icon.getBoundingClientRect().width / t.zoom, 48, 'Modal icon retains native CSS size');
        }
        if (width > 900) {
          const nativeCss = getComputedStyle(t.native.querySelector(`.${t.itemCss.AchievementTitle}`));
          const mineCss = getComputedStyle(overlay.querySelector('.gdl-lam-row-title'));
          t.check(mineCss.fontSize === nativeCss.fontSize && mineCss.fontWeight === nativeCss.fontWeight, 'Modal title matches installed native typography');
        }
        return t.checks.length;
      }, paneBounds);
    }
    checks = await page.evaluate(async () => {
      const t = window.responsiveAchievementTest, overlay = document.getElementById('gdl-local-achievement-modal');
      await t.settle();
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
      for (let i = 0; i < 100; i++) {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
        window.dispatchEvent(new Event('resize'));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      await t.settle(); observer.disconnect();
      t.check(mutations === 0, '100 stable pointer moves and resize signals perform zero geometry mutations');
      return t.checks.length;
    });
    // The absence of a mounted library pane must not reintroduce minimum sizes
    // larger than the actual CEF viewport at high client zoom.
    for (const width of [800, 640, 480]) {
      await page.setViewportSize({ width, height: 420 });
      checks = await page.evaluate(async () => {
        const t = window.responsiveAchievementTest; t.pane.remove();
        window.dispatchEvent(new Event('resize')); await t.settle();
        const box = document.getElementById('gdl-local-achievement-modal').getBoundingClientRect();
        t.check(box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Fallback viewport never overflows');
        return t.checks.length;
      });
    }
    await page.evaluate(() => window.responsiveAchievementTest.modal.disposeAllLocalAchievementsModals());
    reports.push({ scale, zoom, checks }); await context.close();
  }
} finally { await browser.close(); }
console.log(`Achievement responsive native oracle: ${reports.reduce((sum, report) => sum + report.checks, 0)} checks passed.`);
console.log(JSON.stringify(reports));
