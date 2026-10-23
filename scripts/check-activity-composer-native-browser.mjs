import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const self = { webpackChunksteamui: [] };
const library = fs.readdirSync(path.join(steam, 'libraries')).filter(name => name.endsWith('.js'))
  .map(name => fs.readFileSync(path.join(steam, 'libraries', name), 'utf8'))
  .find(source => source.includes('63696:') && source.includes('.createRoot=function'));
assert(library, 'Installed React oracle is available');
vm.runInNewContext(library, { self });
const libraries = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self });
const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const maps = Object.fromEntries([19819, 15334, 55523, 30884, 74173, 17076, 94230].map(id => {
  const module = { exports: {} }; factories[id](module); return [id, module.exports];
}));
const textareaModule = factories[50777].toString();
const textareaSource = textareaModule.slice(textareaModule.indexOf('class Xe extends'), textareaModule.indexOf('Ee([d.oI],Xe.prototype'));
assert(textareaSource.includes('CalculatePadding()'), 'The oracle uses Steam\'s actual auto-sizing textarea class');
const sources = Object.fromEntries([
  ['view', process.env.NGL_ACTIVITY_VIEW_BASELINE || 'frontend/features/library/activity-view.ts'], ['status', 'frontend/features/library/social/status.ts'],
  ['styles', 'frontend/features/library/styles/status.ts'], ['activityStyles', 'frontend/features/library/styles/activity.ts'],
  ['inject', 'frontend/features/library/styles/inject.ts'], ['text', 'frontend/core/text.ts'], ['disposables', 'frontend/core/disposables.ts'],
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
  for (const dpr of (process.argv.includes('--fast') ? [1] : [1, 2])) {
    const page = await browser.newPage({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: dpr });
    page.on('pageerror', error => console.error(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head></head><body class="DesktopUI" style="margin:0;font-family:Arial;font-size:14px"></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/library.css'), 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
    reports.push(await page.evaluate(async ({ maps, sources, factorySources, libraries, textareaSource, fast }) => {
      let checks = 0; const failures = [], modules = {};
      const check = (value, message) => { checks++; if (!value) failures.push(message); };
      const near = (a, b, message) => check(Math.abs(a - b) < 1, `${message}: ${a} / ${b}`);
      const settle = (delay = 280) => new Promise(resolve => setTimeout(resolve, delay));
      const registry = Object.fromEntries(Object.entries(libraries).map(([id, source]) => [id, new Function(`return (${source})`)()]));
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
      const section = maps[19819], headings = maps[15334], post = maps[55523], feed = maps[30884], reset = maps[74173], events = maps[17076];
      const identity = ({ children }) => children;
      const div = React.forwardRef(({ children, focusable, onActivate, navRef, ...props }, ref) => React.createElement('div', { ...props, ref }, children));
      const classNames = { A: (...values) => values.filter(Boolean).join(' ') };
      const nativeDeps = {
        62540: { jsx, jsxs: jsx, Fragment: React.Fragment }, 63696: React,
        41230: { PA: value => value }, 8658: classNames, 74173: reset,
        6739: { Qn: () => false, QO: React.createContext(null) }, 15334: headings,
        42095: {}, 377: {}, 75315: {}, 47438: {},
        38850: { Z: div }, 19819: section, 28532: {}, 54069: { jR: { BIsFeatureBlocked: () => false } },
        78999: {}, 23501: { hL: identity }, 96017: { q: identity }, 92819: { qw: () => ({ BIsOfflineMode: () => false }) },
      };
      const nativeLoad = id => {
        if (nativeDeps[id]) return nativeDeps[id];
        const module = { exports: {} }, localRequire = key => nativeLoad(key);
        localRequire.d = req.d; localRequire.n = req.n;
        new Function(`return (${factorySources[id]})`)()(module, module.exports, localRequire);
        return nativeDeps[id] = module.exports;
      };
      nativeDeps[15023] = { DZ: nativeLoad(47174).D };
      const Section = nativeLoad(45026), Header = nativeLoad(10909);
      class BoundComponent extends React.Component {
        constructor(props) { super(props); for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
          if (name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), name)?.value === 'function') this[name] = this[name].bind(this);
        } }
      }
      const Textarea = new Function('i', 'a', 's', `${textareaSource};return Xe;`)(
        { Component: BoundComponent, createRef: React.createRef }, { jsx },
        { dO: React.forwardRef((props, ref) => React.createElement('textarea', { ...props, ref })) });
      const postNativeDeps = {
        ...nativeDeps, 50777: { Cl: Textarea }, 55523: post,
        71262: { oI: () => undefined }, 43471: { Nb: { EmoticonStore: { GetTimeReceivedNewestEmoticon: () => 0, GetTimeReceivedForStickerOrEffect: () => 0 } } }, 57575: { id: (a, b) => a?.contains(b) },
        94230: maps[94230], 44727: { fu: ({ children, onOKActionDescription, ...props }) => React.createElement('button', props, children) },
        83422: { iD: () => null }, 47438: { he: identity }, 68940: { nl: () => React.createElement('svg', { width: 26, height: 26 }) },
        7727: { we: () => 'Publicar' }, 89193: { sH: () => undefined,
          Gn: instance => { for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
            if (name !== 'constructor' && typeof instance[name] === 'function') instance[name] = instance[name].bind(instance);
          } } }, 12711: {},
      };
      const postModule = { exports: {} }, postRequire = id => postNativeDeps[id]; postRequire.d = req.d; postRequire.n = req.n;
      const emoticonModule = { exports: {} };
      new Function(`return (${factorySources[28767]})`)()(emoticonModule, emoticonModule.exports, postRequire);
      postNativeDeps[28767] = emoticonModule.exports;
      new Function(`return (${factorySources[47098]})`)()(postModule, postModule.exports, postRequire);
      const statusPlaceholder = 'Diles algo sobre este juego a tus amigos...';
      const latest = 'Ver las últimas novedades';
      const dateHtml = `<div class="${events.AppActivityDay}"><h4 class="${reset.Reset} ${events.AppActivityDate}">14 DE OCTUBRE<div class="${events.Rule}"></div></h4></div>`;
      const nativeContent = () => React.createElement(Section.nZ, { className: feed.ActivityFeedContainer, label: 'Actividad', showRule: true },
        React.createElement(Section.l_, { className: feed.InnerContainer },
          React.createElement(postModule.exports.K, { className: `${feed.AddToFeed} ${feed.PostTextEntry}`, placeholder: statusPlaceholder, OnPostClicked() {} }),
          React.createElement('div', { className: feed.ViewLastNews }, latest),
          React.createElement('div', { dangerouslySetInnerHTML: { __html: dateHtml } })));
      const css = { FEED_CLASSES: () => feed, POST_CLASSES: () => post, EVENT_CLASSES: () => events, HEADING_RESET_CLASSES: () => reset,
        resolveClassModule: (predicate, fallback) => ({ classes: Object.values(maps).find(predicate) || fallback }) };
      const locale = { loc: (_key, fallback) => fallback, gdlText: (key, fallback) => ({ activity: 'Actividad', post_placeholder: statusPlaceholder, latest_news: latest, publish: 'Publicar' })[key] || fallback };
      const deps = {
        '../../steam/css': css, '../../../steam/css': css,
        '../../steam/localization': locale, '../../../steam/localization': locale,
        '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
        '../../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
        './constants': { GDL_INJECTED: 'gdl-library-injected' }, './news': { newsItemsSignature: () => '' },
        './layout': { nativeSectionClass: () => section.AppDetailsSection },
        './social': { renderUnifiedActivityFeedSnapshot: () => ({ signature: '', html: dateHtml }), setupStatusPostBox: (...args) => load('status').setupStatusPostBox(...args) },
        '../../../steam/native-dom': { cssModuleTokens: value => String(value || '').split(/\s+/).filter(Boolean) },
        '../../../steam/social': {}, '../../../steam/gamepad/virtual-keyboard': {},
        '../native-route': { routedSteamAppId: () => 3000000001 }, '../../shortcuts/registry': { getCommittedShortcutSteamAppId: () => '100' },
        './feed': { setupPostDeleteHandlers() {} },
      };
      const aliases = { './inject': 'inject', '../../core/text': 'text', '../../../core/text': 'text', '../../../core/disposables': 'disposables' };
      function load(key) {
        if (modules[key]) return modules[key]; const exports = modules[key] = {};
        new Function('require', 'exports', sources[key])(id => {
          if (id in deps) return deps[id]; if (id in aliases) return load(aliases[id]); throw Error(`Unexpected ${key}: ${id}`);
        }, exports); return exports;
      }
      load('styles').ensureStatusComposerStyles(document); load('activityStyles').ensureActivityStyles(document);
      const oracleHost = document.createElement('div'), linkedHost = document.createElement('div'), anchor = document.createElement('div');
      document.body.append(oracleHost, linkedHost, anchor);
      const root = ReactDOM.createRoot(oracleHost), anchorRoot = ReactDOM.createRoot(anchor);
      dom.flushSync(() => anchorRoot.render(React.createElement(Header.w, { label: 'Notas' })));
      const options = { steamAppId: '100', shortcutAppId: '3000000001', newsItems: [{ title: 'News', url: 'https://store.steampowered.com/news/app/100/view/1', date: 1 }], headerImage: '' };
      const view = load('view'); let oldTextarea = null;
      for (const kind of ['fallback', 'clone', 'reused', 'first-paint']) for (const zoom of (fast ? [1.25] : [.75, 1, 1.25, 1.5, 2])) for (const width of (fast ? [340, 700] : [340, 700, 950])) {
        const test = `${kind} ${width}px ${zoom * 100}%`;
        if (kind === 'fallback' || kind === 'clone') view.disposeSharedActivityComposer(document);
        else view.parkSharedActivityComposer(document);
        oracleHost.className = linkedHost.className = 'NarrowRightPanel';
        oracleHost.style.cssText = linkedHost.style.cssText = `width:${width}px;zoom:${zoom}`;
        
        const wrapper = view.createActivityView(document, { anchorRegion: kind === 'fallback' ? null : anchor }, options);
        if (kind === 'first-paint') wrapper.id = 'gdl-skeleton';
        linkedHost.replaceChildren(wrapper);
        if (kind === 'first-paint') oracleHost.style.width = `${wrapper.getBoundingClientRect().width / zoom}px`;
        dom.flushSync(() => root.render(React.cloneElement(nativeContent(), { key: test })));
        view.wireActivityView(document, wrapper, options);
        const nativeTextarea = oracleHost.querySelector('textarea'), linkedTextarea = linkedHost.querySelector('textarea');
        if ((kind === 'reused' || kind === 'first-paint') && oldTextarea) check(linkedTextarea === oldTextarea, `${test}: keeps shared textarea`);
        oldTextarea = linkedTextarea;
        await settle();
        const selectors = [['heading', 'h2'], ['composer', `.${post.PostTextEntry}`], ['textarea', 'textarea'],
          ['latest', `.${feed.ViewLastNews}`], ['date', `.${events.AppActivityDate}`]];
        const linkedElementFor = selector => linkedHost.querySelector(selector === 'h2' ? '.gdl-ui-activity-heading'
          : selector === `.${feed.ViewLastNews}` ? '.gdl-latest-news-button' : selector);
        const compare = (state, expectedTextareaStyle = getComputedStyle(nativeTextarea)) => {
          const nativeBase = oracleHost.getBoundingClientRect(), linkedBase = linkedHost.getBoundingClientRect();
          for (const [name, selector] of selectors) {
            const a = oracleHost.querySelector(selector), b = linkedElementFor(selector);
            if (!a || !b) throw Error(`Missing ${selector}: native ${oracleHost.innerHTML} / linked ${linkedHost.innerHTML}`);
            const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
            for (const property of ['width', 'height']) near(ar[property] / zoom, br[property] / zoom, `${test} ${state}: ${name}.${property}`);
            for (const property of ['left', 'top']) near((ar[property] - nativeBase[property]) / zoom,
              (br[property] - linkedBase[property]) / zoom, `${test} ${state}: ${name}.${property}`);
          }
          for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'padding', 'borderRadius', 'backgroundColor', 'color', 'boxSizing']) {
            check(expectedTextareaStyle[property] === getComputedStyle(linkedTextarea)[property], `${test} ${state}: textarea ${property}`);
          }
          for (const [name, selector] of [['latest', `.${feed.ViewLastNews}`], ['controls', `.${post.Controls}`], ['post-button', `.${post.PostButton}`], ['emoticon-button', `.${post.EmoticonButton}`]]) {
            const nativeElement = oracleHost.querySelector(selector), linkedElement = linkedElementFor(selector);
            for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'borderRadius', 'backgroundColor', 'backgroundImage', 'color', 'boxSizing']) {
              const a = getComputedStyle(nativeElement)[property], b = getComputedStyle(linkedElement)[property];
              check(a === b, `${test} ${state}: ${name} ${property}: ${a} / ${b}`);
            }
            if (state === 'focused') {
              const a = nativeElement.getBoundingClientRect(), b = linkedElement.getBoundingClientRect();
              near(a.width / zoom, b.width / zoom, `${test} ${state}: ${name} width`);
              near(a.height / zoom, b.height / zoom, `${test} ${state}: ${name} height`);
            }
          }
          for (const property of ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']) {
            const a = getComputedStyle(oracleHost.querySelector('h2')), b = getComputedStyle(linkedElementFor('h2'));
            check(a[property] === b[property], `${test} ${state}: heading ${property}`);
          }
        };
        compare('collapsed');
        nativeTextarea.focus(); await settle();
        const nativeFocusedStyle = Object.fromEntries(['fontSize', 'fontWeight', 'lineHeight', 'padding', 'borderRadius', 'backgroundColor', 'color', 'boxSizing'].map(key => [key, getComputedStyle(nativeTextarea)[key]]));
        linkedTextarea.focus();
        // Native focus collapses when focus leaves for the linked fixture;
        // hold the actual native control's state while comparing both surfaces.
        nativeTextarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        await settle(); compare('focused', nativeFocusedStyle);
        document.body.focus(); linkedTextarea.blur(); nativeTextarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await settle(20);
        load('status').disposeStatusPostBox(document);
      }
      view.disposeSharedActivityComposer(document); root.unmount(); anchorRoot.unmount();
      return { checks, failures };
    }, { maps, sources, textareaSource, fast: process.argv.includes('--fast'), factorySources: Object.fromEntries([45026, 10909, 47174, 47098, 28767].map(id => [id, factories[id].toString()])),
      libraries: Object.fromEntries(Object.entries(libraries).map(([id, factory]) => [id, factory.toString()])) }));
    await page.close();
  }
} finally { await browser.close(); }
const failures = reports.flatMap(report => report.failures);
if (process.argv.includes('--report')) console.log(JSON.stringify({ checks: reports.reduce((n, report) => n + report.checks, 0), failures: failures.slice(0, 60), failureCount: failures.length }, null, 2));
else { assert.equal(failures.length, 0, failures.slice(0, 40).join('\n')); console.log(`Native Activity composer oracle: ${reports.reduce((n, report) => n + report.checks, 0)} checks passed.`); }
