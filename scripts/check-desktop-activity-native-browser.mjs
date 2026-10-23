import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

// The oracle is the installed renderer itself in an isolated React root.
// It receives inert event data and has no plugin ID/classes or account APIs.
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const self = { webpackChunksteamui: [] };
const library = fs.readdirSync(path.join(steam, 'libraries')).filter(name => name.endsWith('.js'))
  .map(name => fs.readFileSync(path.join(steam, 'libraries', name), 'utf8'))
  .find(source => source.includes('63696:') && source.includes('.createRoot=function'));
assert(library, 'Installed Steam React library required');
vm.runInNewContext(library, { self });
const libraries = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self });
const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const eventModule = { exports: {} }; factories[17076](eventModule);
const feedClassFactory = Object.values(factories).find(factory => {
  const source = factory.toString();
  return source.includes('ActivityFeedContainer:') && source.includes('FetchMoreContainer:') && source.includes('ViewLastNews:');
});
assert(feedClassFactory, 'Installed activity-feed class module is discoverable by its semantic exports');
const feedClassModule = { exports: {} }; feedClassFactory(feedClassModule);
const buttonAst = ts.createSourceFile('installed-buttons.js', `const factory=${factories[76982]};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let footerButtonSource = '';
const visitButton = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(buttonAst) === 'R' && node.initializer?.getText(buttonAst).includes('"Secondary"')) {
    footerButtonSource = node.initializer.getText(buttonAst);
  }
  ts.forEachChild(node, visitButton);
};
visitButton(buttonAst);
assert(footerButtonSource.includes('"DialogButton"'), 'Native activity footer uses the actual secondary DialogButton factory');
const resetModule = { exports: {} }; factories[74173](resetModule);
const headingSource = factories[47174].toString();
const renderer = factories[53128].toString();
const start = renderer.indexOf('function Lt('), end = renderer.indexOf('var W=', start);
assert(start > 0 && end > start && renderer.slice(start, end).includes('UpdateLineCount()'),
  'Installed medium/major renderer and dynamic excerpt component are inspectable');
const nativeSource = renderer.slice(start, end);
const dispatchStart = renderer.indexOf('let Ct=class '), dispatchEnd = renderer.indexOf('Ct=Ee(', dispatchStart);
assert(dispatchStart > 0 && dispatchEnd > dispatchStart, 'Actual desktop loaded-event dispatch is inspectable');
const dispatchSource = renderer.slice(dispatchStart, dispatchEnd);
const mainLibrary = fs.readFileSync(path.join(steam, 'library.js'), 'utf8');
const enumStart = mainLibrary.indexOf('94601:(');
const enumAst = ts.createSourceFile('installed-enums.js', `const modules={${mainLibrary.slice(enumStart, enumStart + 200000)}}`,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const enumSource = enumAst.statements[0].declarationList.declarations[0].initializer.properties[0].initializer.getText(enumAst);
const enumModule = { exports: {} }, enumRequire = () => { throw Error('Unexpected enum dependency'); };
enumRequire.d = (object, definitions) => { for (const [key, get] of Object.entries(definitions)) Object.defineProperty(object, key, { get }); };
vm.runInNewContext(enumSource)(enumModule, enumModule.exports, enumRequire);
const eventEnums = { zeJ: enumModule.exports.zeJ, Fwr: enumModule.exports.Fwr, u0: enumModule.exports.u0 };
assert.deepEqual(eventEnums, { zeJ: 14, Fwr: 12, u0: 13 }, 'Real installed event enum values remain 14 major/12 text/13 medium');
const iconModule = { exports: {} }, iconRequire = () => { throw Error('Unneeded icon factory dependency'); };
iconRequire.d = enumRequire.d;
try { factories[42095](iconModule, iconModule.exports, iconRequire); } catch {}
const patchSource = iconModule.exports.vjL.toString();
assert(patchSource.includes('SVGIcon_Patch'), 'Installed text-only Patch icon is inspectable');
if (process.argv.includes('--icon')) {
  const jsx = (type, props) => ({ type, props });
  console.log(JSON.stringify(new Function('e', `return (${patchSource})()` )({ jsx, jsxs: jsx }), null, 2));
  process.exit(0);
}
const nativeLocales = Object.fromEntries(['english', 'latam'].map(language => {
  const localeSelf = { webpackChunksteamui: [] };
  for (const prefix of ['shared', 'steamui']) vm.runInNewContext(fs.readFileSync(path.join(steam,
    `localization/${prefix}_${language}-json.js`), 'utf8'), { self: localeSelf });
  const values = {};
  for (const factory of Object.values(Object.assign({}, ...localeSelf.webpackChunksteamui.map(chunk => chunk[1])))) {
    const module = { exports: {} }; factory(module); Object.assign(values, module.exports);
  }
  return [language, values];
}));
const sources = Object.fromEntries([
  ['feed', 'frontend/features/library/social/feed.ts'], ['news', 'frontend/features/library/news.ts'],
  ['activity', 'frontend/features/library/styles/activity.ts'], ['inject', 'frontend/features/library/styles/inject.ts'],
  ['activity-footer', 'frontend/features/library/activity-footer.ts'],
  ['activity-summary', process.env.NGL_ACTIVITY_SUMMARY_BASELINE || 'frontend/features/library/activity-summary.ts'],
  ['community-order', 'frontend/features/library/community-order.ts'], ['text', 'frontend/core/text.ts'],
].map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const browser = await chromium.launch({ headless: true, executablePath: process.env.CLOUD_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const reports = [];
try {
  for (const dpr of [1, 2]) {
    const nativeTokens = nativeLocales[dpr === 1 ? 'english' : 'latam'];
    const page = await browser.newPage({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: dpr });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head></head><body class="DesktopUI" style="margin:0;font-family:Arial;font-size:14px"></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
    reports.push(await page.evaluate(async ({ sources, nativeSource, dispatchSource, eventEnums, patchSource, classes, headingSource, headingReset, nativeTokens, libraries, feedClasses, footerButtonSource, libraryCss }) => {
      const failures = [], geometry = [], modules = {};
      let checks = 0;
      const check = (condition, text) => { checks++; if (!condition) failures.push(text); };
      const near = (a, b, text) => check(Math.abs(a - b) < 1.1, `${text}: ${a} / ${b}`);
      const settle = async () => { for (let n = 0; n < 4; n++) await new Promise(requestAnimationFrame); };
      let activeObservers = 0;
      const RealObserver = window.ResizeObserver;
      window.ResizeObserver = class extends RealObserver {
        active = false;
        observe(...args) { if (!this.active) { activeObservers++; this.active = true; } super.observe(...args); }
        disconnect() { if (this.active) { activeObservers--; this.active = false; } super.disconnect(); }
      };
      const registry = Object.fromEntries(Object.entries(libraries).map(([id, text]) => [id, new Function(`return (${text})`)()]));
      const installed = {};
      const req = id => {
        if (installed[id]) return installed[id].exports;
        const module = installed[id] = { exports: {} }; registry[id](module, module.exports, req); return module.exports;
      };
      req.d = (object, values) => { for (const [key, get] of Object.entries(values)) Object.defineProperty(object, key, { get }); };
      req.n = value => { const getter = () => value?.__esModule ? value.default : value; getter.a = getter; return getter; };
      req.r = object => Object.defineProperty(object, '__esModule', { value: true });
      req.o = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
      const React = req(63696), dom = req(78325);
      const ReactDOM = req(Object.keys(registry).find(id => String(registry[id]).includes('.createRoot=function')));
      const jsx = (type, { children, ...props }, key) => React.createElement(type, { ...props, key }, children);
      const identity = props => props.children;
      const headingDeps = { 62540: { jsx }, 63696: React, 8658: { A: (...values) => values.filter(Boolean).join(' ') }, 74173: headingReset };
      const headingRequire = id => headingDeps[id]; headingRequire.d = req.d;
      const headingModule = { exports: {} };
      new Function(`return (${headingSource})`)()({}, headingModule.exports, headingRequire);
      // Actual Fr caller: native day border + Heading(level4), followed by an
      // AppDayContents div. The class is currently undefined but the div exists.
      const nativeDay = (event, date = 'NOV 14, 2023') => React.createElement('div', { className: classes.AppActivityDay },
        React.createElement(headingModule.exports.D, { level: '4', className: classes.AppActivityDate }, date,
          React.createElement('div', { className: classes.Rule })), React.createElement('div', { className: classes.AppDayContents }, event));
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="274" height="154"><rect width="274" height="154" fill="#52768d"/></svg>');
      const native = new Function('e', 'a', 'r', 'J', 'K', 'Ke', 'mt', 'xe', 'f', 'Y', 'Ge', 'O', 'Et', 'Z', 'Mt', 'He', 'H', 'Ue',
        `${nativeSource};${dispatchSource};return {Medium:ot,Major:it,TextOnly:ht,Dispatch:Ct};`)(
        { jsx, jsxs: jsx }, React, { sfN: () => 0, ...eventEnums },
        { we: token => nativeTokens[token.replace(/^#/, '')] || token }, { TS: { LANGUAGE: 'english' } },
        { WC: event => [event.image] }, { wI: { capsule_main: '' } }, { dm: { FilterImageURLsForKnownFailures: value => value } },
        { br: () => ({}) }, { A: (...values) => values.filter(Boolean).join(' ') },
        { c: props => React.createElement('img', { className: props.className, src: props.rgSources[0] }) },
        { Z: props => React.createElement('div', { className: props.className }, props.children) }, identity, () => classes, () => {}, {},
        { vjL: new Function('e', `return (${patchSource})`)({ jsx, jsxs: jsx }) }, { Sx: value => ({ state: 'fulfilled', value }) });
      const localization = { loc: (key, fallback) => nativeTokens[key.replace(/^#/, '')] || fallback, gdlText: (_key, fallback) => fallback,
        steamIntlLocale: () => 'en-US', steamLanguageSync: () => 'english' };
      const cssModule = { EVENT_CLASSES: () => classes, FEED_CLASSES: () => feedClasses, HEADING_RESET_CLASSES: () => headingReset };
      const deps = {
        '../../../api/backend': {}, '../../api/backend': {}, '../../../steam/social': {}, './personas': {}, './host': {},
        '../../../steam/localization': localization, '../../steam/localization': localization,
        '../../../steam/css': cssModule,
        '../../steam/css': cssModule,
        '../../core/cache': { CACHE_TTL: {}, CACHE_RETENTION: {}, cacheRead: () => null, cacheGet: () => null, cacheSet() {} },
        '../../core/request-cache': { RetryingRequestCache: class { peek() { return null; } } },
        '../../core/game-data': { getSynchronousGameData: () => null },
      };
      const aliases = { '../../core/text': 'text', '../../../core/text': 'text', '../news': 'news',
        './community-order': 'community-order', './inject': 'inject', '../activity-footer': 'activity-footer', '../activity-summary': 'activity-summary' };
      const load = key => {
        if (modules[key]) return modules[key];
        const exports = modules[key] = {};
        new Function('require', 'exports', sources[key])(id => {
          if (id === '../../../steam/css') return cssModule;
          if (id in deps) return deps[id];
          if (id in aliases) return load(aliases[id]);
          throw Error(`Unexpected ${key} dependency ${id}`);
        }, exports); return exports;
      };
      const feed = load('feed');
      load('activity').ensureActivityStyles(document);
      const title = 'A substantial update brings a new chapter, new adventures and improvements for every player';
      const summary = Array(14).fill('Discover new areas and improvements for all players in this substantial update.').join(' ');
      const oracleHost = document.createElement('div'), linkedHost = document.createElement('div');
      document.body.append(oracleHost, linkedHost);
      const oracleRoot = ReactDOM.createRoot(oracleHost);
      let cleanup = () => {};
      for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const [width, mode] of [[950, ''], [700, ''], [540, 'NarrowRightPanel'], [340, 'NarrowRightPanel UltraNarrowRightPanel']]) {
        oracleHost.className = linkedHost.className = mode;
        oracleHost.style.cssText = linkedHost.style.cssText = `width:${width}px;zoom:${zoom}`;
        for (const [variant, type] of [['Medium', 28], ['Medium', 13], ['Major', 14]]) {
          const event = { type, image, GetNameWithFallback: () => title, GetSummaryWithFallback: () => modules.news.newsExcerpt(summary) };
          event.GetEvent = () => event;
          dom.flushSync(() => oracleRoot.render(nativeDay(React.createElement(native.Dispatch, { event, key: `${zoom}-${width}-${type}` }))));
          const app = `${zoom}-${width}-${type}`;
          cleanup();
          linkedHost.innerHTML = `<div id="gdl-activity-feed" class="${feedClasses.ActivityFeedContainer}">${feed.renderUnifiedActivityFeed(app, '3000000001', [{
            gid: app, title, date: 1700000000, contents: summary, feedname: 'steam_community_announcements',
            event_type: type, image, url: 'https://store.steampowered.com/news/app/100/view/1',
          }], image)}</div>`;
          cleanup = load('activity-summary').installNativeActivitySummaryClamps(linkedHost.querySelector('#gdl-activity-feed'));
          await settle();
          const prefix = variant === 'Medium' ? 'PartnerEventMediumImage_' : 'PartnerEventLargeImage_';
          const description = `${variant} type${type} ${width}px ${zoom * 100}%`;
          const oracle = suffix => oracleHost.querySelector(`.${classes[prefix + suffix]}`);
          const linked = suffix => linkedHost.querySelector(`.${classes[prefix + suffix]}`);
          check(Boolean(linked('Title')), `${description}: actual installed desktop event dispatch`);
          if (!linked('Title')) continue;
          check(getComputedStyle(oracleHost.querySelector(`.${classes.Event}`)).marginTop
            === getComputedStyle(linkedHost.querySelector(`.${classes.Event}`)).marginTop, `${description}: first event uses native day-content spacing`);
          for (const [suffix, properties] of [
            ['Title', ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'marginBottom', 'webkitLineClamp']],
            ['Summary', ['fontSize', 'fontWeight', 'lineHeight', 'color', 'paddingTop', 'maxWidth', 'webkitLineClamp']],
            ['TextColumn', ['maxHeight', 'paddingTop', 'paddingBottom', 'paddingRight']],
          ]) for (const property of properties) {
            const a = getComputedStyle(oracle(suffix))[property], b = getComputedStyle(linked(suffix))[property];
            check(a === b, `${description}: native ${suffix}.${property} ${a} / linked ${b}`);
          }
          const nativeType = oracleHost.querySelector(`.${classes.PartnerEventType}`), linkedType = linkedHost.querySelector(`.${classes.PartnerEventType}`);
          for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'marginTop', 'marginBottom']) {
            const a = getComputedStyle(nativeType)[property], b = getComputedStyle(linkedType)[property];
            check(a === b, `${description}: native type.${property} ${a} / linked ${b}`);
          }
          near(oracle('Title').getBoundingClientRect().height / zoom, linked('Title').getBoundingClientRect().height / zoom, `${description}: title wrapping height`);
          near(oracle('TextColumn').getBoundingClientRect().height / zoom, linked('TextColumn').getBoundingClientRect().height / zoom, `${description}: copy height`);
          const a = oracle('Summary').getBoundingClientRect(), b = linked('Summary').getBoundingClientRect();
          near(a.height / zoom, b.height / zoom, `${description}: dynamic excerpt height`);
          near((a.top - oracle('Title').getBoundingClientRect().bottom) / zoom,
            (b.top - linked('Title').getBoundingClientRect().bottom) / zoom, `${description}: title/excerpt spacing`);
          geometry.push({ description, native: { title: oracle('Title').getBoundingClientRect().height / zoom,
            copy: oracle('TextColumn').getBoundingClientRect().height / zoom, excerpt: a.height / zoom,
            clamp: getComputedStyle(oracle('Summary')).webkitLineClamp }, linked: { title: linked('Title').getBoundingClientRect().height / zoom,
            copy: linked('TextColumn').getBoundingClientRect().height / zoom, excerpt: b.height / zoom,
            clamp: getComputedStyle(linked('Summary')).webkitLineClamp } });
        }
      }
      for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const [width, mode] of [[950, ''], [700, ''], [540, 'NarrowRightPanel'], [340, 'NarrowRightPanel UltraNarrowRightPanel']]) {
        oracleHost.className = linkedHost.className = mode;
        oracleHost.style.cssText = linkedHost.style.cssText = `width:${width}px;zoom:${zoom}`;
        // Current NewsItem has no verified native subtitle field. Match the
        // native empty-metadata case rather than inventing one from body text.
        const subtitle = '';
        const event = { type: eventEnums.Fwr, image, GetNameWithFallback: () => title,
          GetSubTitleWithLanguageFallback: () => subtitle, GetCategoryAsString: () => nativeTokens[`PartnerEvent_${eventEnums.Fwr}`] };
        event.GetEvent = () => event;
        dom.flushSync(() => oracleRoot.render(nativeDay(React.createElement(native.Dispatch, { event, key: `text-${zoom}-${width}` }))));
        cleanup();
        const app = `text-${zoom}-${width}`;
        linkedHost.innerHTML = `<div id="gdl-activity-feed" class="${feedClasses.ActivityFeedContainer}">${feed.renderUnifiedActivityFeed(app, '3000000001', [{
          gid: app, title, date: 1700000000, contents: subtitle, feedname: 'steam_community_announcements',
          event_type: eventEnums.Fwr, image, url: 'https://store.steampowered.com/news/app/100/view/1',
        }], image)}</div>`;
        cleanup = load('activity-summary').installNativeActivitySummaryClamps(linkedHost.querySelector('#gdl-activity-feed'));
        await settle();
        const description = `TextOnly type12 ${width}px ${zoom * 100}%`;
        for (const [key, properties] of [
          ['PartnerEventTextOnly_Container', ['display', 'padding', 'minWidth']],
          ['PartnerEventTextOnly_Icon', ['width', 'height', 'marginTop', 'marginLeft', 'marginRight', 'marginBottom']],
          ['PartnerEventTextOnly_TextColumn', ['display', 'paddingRight']],
          ['PartnerEventTextOnly_Title', ['fontSize', 'fontWeight', 'lineHeight', 'color']],
          ['PartnerEventTextOnly_LimitedSummary', ['paddingTop', 'paddingBottom', 'color']],
        ]) {
          const a = oracleHost.querySelector(`.${classes[key]}`), b = linkedHost.querySelector(`.${classes[key]}`);
          if (key === 'PartnerEventTextOnly_LimitedSummary' && !a && !b) {
            check(true, `${description}: absent native subtitle stays absent`); continue;
          }
          check(Boolean(a && b), `${description}: actual native ${key} markup`);
          if (!a || !b) continue;
          for (const property of properties) check(getComputedStyle(a)[property] === getComputedStyle(b)[property],
            `${description}: ${key}.${property} ${getComputedStyle(a)[property]} / ${getComputedStyle(b)[property]}`);
          near(a.getBoundingClientRect().height / zoom, b.getBoundingClientRect().height / zoom, `${description}: ${key} height`);
        }
        const nativePaths = Array.from(oracleHost.querySelectorAll(`.${classes.PartnerEventTextOnly_Icon} svg path`), node => node.getAttribute('d'));
        const linkedPaths = Array.from(linkedHost.querySelectorAll(`.${classes.PartnerEventTextOnly_Icon} svg path`), node => node.getAttribute('d'));
        check(JSON.stringify(nativePaths) === JSON.stringify(linkedPaths), `${description}: actual installed Patch SVG vectors`);
      }
      cleanup();
      check(activeObservers === 0, 'Replacing medium feeds and visiting major-only feeds releases all summary observers');
      const app = 'live-medium', event = { type: 28, image, GetNameWithFallback: () => title,
        GetSummaryWithFallback: () => modules.news.newsExcerpt(summary) };
      linkedHost.innerHTML = `<div id="gdl-activity-feed" class="${feedClasses.ActivityFeedContainer}">${feed.renderUnifiedActivityFeed(app, '3000000001', [{
        gid: app, title, date: 1700000000, contents: summary, feedname: 'steam_community_announcements',
        event_type: 28, image, url: 'https://store.steampowered.com/news/app/100/view/1',
      }], image)}</div>`;
      const liveFeed = linkedHost.querySelector('#gdl-activity-feed'), liveSummary = liveFeed.querySelector(`.${classes.PartnerEventMediumImage_Summary}`);
      cleanup = load('activity-summary').installNativeActivitySummaryClamps(liveFeed);
      for (const [width, mode] of [[950, ''], [700, ''], [540, 'NarrowRightPanel'], [340, 'NarrowRightPanel UltraNarrowRightPanel'], [950, '']]) {
        oracleHost.className = linkedHost.className = mode;
        oracleHost.style.cssText = linkedHost.style.cssText = `width:${width}px;zoom:1`;
        dom.flushSync(() => oracleRoot.render(nativeDay(React.createElement(native.Medium, { event, key: `live-${width}-${mode}` }))));
        await settle();
        const nativeSummary = oracleHost.querySelector(`.${classes.PartnerEventMediumImage_Summary}`);
        check(liveFeed.querySelector(`.${classes.PartnerEventMediumImage_Summary}`) === liveSummary, `${width}px: resize preserves the same summary node`);
        check(getComputedStyle(liveSummary).webkitLineClamp === getComputedStyle(nativeSummary).webkitLineClamp, `${width}px: resize recomputes actual native excerpt line budget`);
        near(liveSummary.getBoundingClientRect().height, nativeSummary.getBoundingClientRect().height, `${width}px: resize keeps native excerpt height`);
      }
      let mutations = 0;
      const mutationObserver = new MutationObserver(records => { mutations += records.length; });
      mutationObserver.observe(liveFeed, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
      for (let n = 0; n < 100; n++) {
        window.dispatchEvent(new Event('resize'));
        await new Promise(requestAnimationFrame);
      }
      await settle(); mutationObserver.disconnect();
      check(mutations === 0, '100 stable summary resize signals make zero DOM/style mutations');
      const drag = { steps: 30, geometryReads: 0, probeNodes: 0, styleWrites: 0, updateFrames: 0 };
      const restoredGetters = [];
      for (const property of ['clientHeight', 'clientWidth', 'scrollHeight']) {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, property);
        if (!descriptor?.get) continue;
        Object.defineProperty(Element.prototype, property, { ...descriptor, get() {
          if (liveFeed.contains(this)) drag.geometryReads++;
          return descriptor.get.call(this);
        } });
        restoredGetters.push(() => Object.defineProperty(Element.prototype, property, descriptor));
      }
      const realBounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        if (liveFeed.contains(this)) drag.geometryReads++;
        return realBounds.call(this);
      };
      restoredGetters.push(() => { Element.prototype.getBoundingClientRect = realBounds; });
      const realFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = function(callback) {
        if (callback.name === 'update') drag.updateFrames++;
        return realFrame.call(this, callback);
      };
      const dragObserver = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') drag.styleWrites++;
          else drag.probeNodes += record.addedNodes.length;
        }
      });
      dragObserver.observe(liveFeed, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      try {
        for (let step = 0; step < drag.steps; step++) {
          const width = 950 - step * 20;
          linkedHost.className = width <= 540 ? 'NarrowRightPanel' : '';
          linkedHost.style.width = `${width}px`;
          await new Promise(resolve => realFrame.call(window, resolve));
          await new Promise(resolve => realFrame.call(window, resolve));
        }
        await settle();
      } finally {
        dragObserver.disconnect();
        window.requestAnimationFrame = realFrame;
        for (const restore of restoredGetters) restore();
      }
      check(drag.probeNodes === 0, '30 real width changes create no DOM probes or BR nodes');
      check(drag.styleWrites <= drag.steps, '30 real width changes write only changed native line clamps');
      check(drag.geometryReads <= drag.steps * 12, 'Drag geometry reads stay bounded without per-line forced-layout loops');
      check(drag.updateFrames <= drag.steps + 2, 'Drag work is coalesced to one summary update per width frame');
      cleanup();
      check(activeObservers === 0, 'Summary cleanup releases its owner ResizeObserver');
      const stylesAfterCleanup = liveSummary.getAttribute('style');
      window.dispatchEvent(new Event('resize')); await settle();
      check(liveSummary.getAttribute('style') === stylesAfterCleanup, 'Disposed summary cannot schedule later style work');
      const linkedDate = linkedHost.querySelector(`.${classes.AppActivityDate}`);
      dom.flushSync(() => oracleRoot.render(nativeDay(null, linkedDate.firstChild.textContent)));
      const nativeDate = oracleHost.querySelector(`.${classes.AppActivityDate}`);
      for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'marginTop', 'marginBottom', 'color']) {
        check(getComputedStyle(nativeDate)[property] === getComputedStyle(linkedDate)[property],
          `Activity date uses native heading reset ${property}: ${getComputedStyle(nativeDate)[property]} / ${getComputedStyle(linkedDate)[property]}`);
      }
      const nativeNodes = [oracleHost, ...oracleHost.querySelectorAll('*')];
      const styleRules = Array.from(document.getElementById('gdl-activity-styles').sheet.cssRules);
      const matchedNativeRules = styleRules.filter(rule => rule.selectorText
        && nativeNodes.some(node => node.matches(rule.selectorText)));
      check(matchedNativeRules.length === 0, 'Plugin activity CSS never styles any native oracle node');
      // Include the real desktop dialog base sheet for the native secondary
      // button; sp.css alone leaves user-agent button defaults in the oracle.
      const dialogStyle = document.createElement('style'); dialogStyle.textContent = libraryCss; document.head.prepend(dialogStyle);
      const NativeFooterButton = new Function('a', 'e', 'U', 'l', `return (${footerButtonSource})`)(React, { jsx },
        React.forwardRef(({ children, className, ...props }, ref) => React.createElement('button',
          { ...props, ref, className: `${className} Focusable` }, children)),
        { A: (...values) => values.filter(Boolean).join(' ') });
      dom.flushSync(() => oracleRoot.render(React.createElement('div', { className: feedClasses.ActivityFeedContainer },
        React.createElement(NativeFooterButton, { className: feedClasses.FetchMoreContainer }, nativeTokens.AppActivity_FetchMore))));
      const nativeFooter = oracleHost.querySelector('button'), linkedFooter = linkedHost.querySelector('.gdl-load-more-activity');
      for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
        oracleHost.style.cssText = linkedHost.style.cssText = `width:700px;zoom:${zoom}`;
        await settle();
        for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'fontWeight',
          'lineHeight', 'backgroundColor', 'color', 'borderTopWidth', 'borderRadius']) {
          check(getComputedStyle(nativeFooter)[property] === getComputedStyle(linkedFooter)[property],
            `Footer ${zoom * 100}% native ${property}: ${getComputedStyle(nativeFooter)[property]} / ${getComputedStyle(linkedFooter)[property]}`);
        }
        near(nativeFooter.getBoundingClientRect().width / zoom, linkedFooter.getBoundingClientRect().width / zoom,
          `Footer ${zoom * 100}% intrinsic width`);
        near(nativeFooter.getBoundingClientRect().height / zoom, linkedFooter.getBoundingClientRect().height / zoom,
          `Footer ${zoom * 100}% intrinsic height`);
      }
      oracleRoot.unmount();
      return { checks, failures, geometry, drag };
    }, { sources, nativeSource, dispatchSource, eventEnums, patchSource, headingSource, headingReset: resetModule.exports, nativeTokens, classes: eventModule.exports,
      feedClasses: feedClassModule.exports, footerButtonSource, libraryCss: fs.readFileSync(path.join(steam, 'css/library.css'), 'utf8'),
      libraries: Object.fromEntries(Object.entries(libraries).map(([id, factory]) => [id, factory.toString()])) }));
    await page.close();
  }
} finally { await browser.close(); }
const failures = reports.flatMap(report => report.failures);
if (process.argv.includes('--report')) {
  console.log(JSON.stringify({ checks: reports.reduce((sum, report) => sum + report.checks, 0),
    failureCount: failures.length, failures: failures.slice(0, 50), lastFailures: failures.slice(-8), drag: reports.map(report => report.drag),
    geometry: reports[0].geometry.filter(item => /100%$/.test(item.description)) }, null, 2));
} else {
  assert.equal(failures.length, 0, failures.slice(0, 40).join('\n'));
  console.log(`Desktop activity installed native oracle: ${reports.reduce((sum, report) => sum + report.checks, 0)} typography, wrapping, copy geometry and dynamic excerpt checks passed.`);
  console.log(`30-step divider drag counters: ${JSON.stringify(reports.map(report => report.drag))}`);
}
