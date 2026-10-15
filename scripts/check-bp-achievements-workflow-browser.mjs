// Real Steam-shipped React/ReactDOM, production linked screen, modal leases,
// route guard and fallback navigation; no live Steam actions or account writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const reactLibraries = fs.readdirSync(path.join(steam, 'libraries')).filter(file => file.endsWith('.js'))
  .map(file => fs.readFileSync(path.join(steam, 'libraries', file), 'utf8')).find(source => source.includes('63696:') && source.includes('.createRoot=function'));
assert(reactLibraries, 'Installed Steam React/ReactDOM library is required');
const self = { webpackChunksteamui: [] };
vm.runInNewContext(reactLibraries, { self });
const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const reactDOMId = Object.entries(factories).find(([, factory]) => String(factory).includes('.createRoot=function'))?.[0];
assert(reactDOMId, 'Installed ReactDOM client export is required');
const sp = fs.readFileSync(path.join(steam, 'sp.js'), 'utf8');
function nativeFactory(id, nextId) {
  const start = sp.indexOf(`,${id}:(`), end = sp.indexOf(`,${nextId}:(`, start + 1);
  assert(start >= 0 && end > start, `Installed Steam module ${id} is inspectable`);
  return String(vm.runInNewContext(`({${sp.slice(start + 1, end)}})`)[Number(id)]);
}
const nativeFactories = {
  36000: nativeFactory('36e3', '83326'), 24124: nativeFactory('24124', '36e3'),
  3270: nativeFactory('3270', '14181'), 83097: nativeFactory('83097', '18980'),
  18980: nativeFactory('18980', '19579'), 62645: nativeFactory('62645', '92821'),
};
// The icon class module has no dependencies; obtain its exact object too.
const iconStart = sp.indexOf(',33175:('), iconEnd = sp.indexOf('}),', iconStart) + 2;
assert(iconStart >= 0 && iconEnd > iconStart, 'Installed icon styles are inspectable');
nativeFactories[33175] = String(vm.runInNewContext(`({${sp.slice(iconStart + 1, iconEnd)}})`)[33175]);
const sources = Object.fromEntries([
  ['context', 'frontend/steam/gamepad/GamepadContext.ts'], ['cache', 'frontend/features/achievements/cache.ts'],
  ['screen', 'frontend/features/big-picture/NativeBigPictureAchievementScreen.tsx'],
  ['summary', 'frontend/features/big-picture/NativeBigPictureAchievements.tsx'],
  ['owned', 'frontend/features/big-picture/owned-modals.tsx'],
  ['navigation', 'frontend/features/big-picture/gamepad-nav.ts'],
  ['navigation-session', 'frontend/features/big-picture/navigation-session.ts'],
  ['native-focus', 'frontend/features/big-picture/native-focus.ts'],
  ['modal-actions', 'frontend/features/big-picture/modal-actions.ts'],
  ['modal-actions', 'frontend/features/big-picture/modal-actions.ts'],
  ['spatial', 'frontend/features/big-picture/spatial-navigation.ts'],
  ['editable', 'frontend/features/big-picture/editable-target.ts'],
  ['document-ui-runtime', 'frontend/steam/gamepad/document-ui-runtime.ts'],
  ['document-primitives', 'frontend/features/big-picture/document-primitives.tsx'],
  ['runtime-cache', 'frontend/steam/gamepad/runtime-cache.ts'],
  ['native-window-store', 'frontend/steam/native-window-store.ts'],
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText]));
export async function runBPBrowserScenario(extraSources = {}, scenario = null) {
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.route('https://steamloopback.host/library', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head></head><body><div id="native-public">Native untouched</div><div id="tabs"><button aria-selected="true">Tus cosas</button></div><div id="gdl-bp-detail-root"></div></body></html>' }));
  await page.goto('https://steamloopback.host/library');
  await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
  const report = await page.evaluate(async ({ sources, factories, nativeFactories, reactDOMId, scenarioSource }) => {
    let checks = 0;
    const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const registry = Object.fromEntries(Object.entries(factories).map(([id, source]) => [id, new Function(`return (${source})`)()]));
    const modules = {};
    const req = id => {
      if (modules[id]) return modules[id].exports;
      if (!registry[id]) throw Error(`Missing library module ${id}`);
      const mod = modules[id] = { exports: {} }; registry[id](mod, mod.exports, req); return mod.exports;
    };
    req.d = (exports, definitions) => { for (const [key, get] of Object.entries(definitions)) Object.defineProperty(exports, key, { enumerable: true, get }); };
    req.r = exports => Object.defineProperty(exports, '__esModule', { value: true });
    req.n = value => { const getter = () => value?.__esModule ? value.default : value; getter.a = getter; return getter; };
    req.o = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const React = req(63696), ReactDOM = req(reactDOMId), dom = req(78325);
    const foreignModules = {};
    const foreignRequire = id => {
      if (foreignModules[id]) return foreignModules[id].exports;
      const mod = foreignModules[id] = { exports: {} }; registry[id](mod, mod.exports, foreignRequire); return mod.exports;
    };
    Object.assign(foreignRequire, { d: req.d, n: req.n, r: req.r, o: req.o });
    const foreignReact = foreignRequire(63696);
    check(foreignReact !== React && foreignReact.useState !== React.useState, 'Imported React and the owner renderer have genuinely distinct hook dispatchers');
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const listeners = new Set();
    let observerCount = 0;
    const RealObserver = window.MutationObserver;
    window.MutationObserver = class extends RealObserver {
      active = false;
      observe(...args) { if (!this.active) { observerCount++; this.active = true; } super.observe(...args); }
      disconnect() { if (this.active) { observerCount--; this.active = false; } super.disconnect(); }
    };
    const attributes = props => Object.fromEntries(Object.entries(props).filter(([name]) => !['focusable', 'onActivate', 'onCancel', 'onButtonDown', 'onOKActionDescription', 'onCancelActionDescription', 'autoFocus', 'noFocusRing'].includes(name)));
    const Focusable = React.forwardRef((props, ref) => {
      const element = React.useRef(null);
      React.useEffect(() => {
        if (!props.onButtonDown) return;
        const node = element.current;
        node.addEventListener('fixture-native-button', props.onButtonDown);
        return () => node.removeEventListener('fixture-native-button', props.onButtonDown);
      }, [props.onButtonDown]);
      return React.createElement('div', { ...attributes(props), ref: node => {
        element.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
      }, tabIndex: props.focusable === false ? undefined : props.tabIndex ?? 0,
        onKeyDown: event => {
          if (event.key === 'Enter' && props.onActivate) { event.preventDefault(); props.onActivate(event); }
          if (event.key === 'Escape' && props.onCancel) { event.preventDefault(); props.onCancel(event); }
        },
      }, props.children);
    });
    const DialogButton = props => React.createElement('button', attributes(props), props.children);
    const TextField = props => React.createElement('input', { ...attributes(props), type: 'search' });
    const ProgressBar = props => React.createElement('div', { role: 'progressbar', 'aria-valuenow': props.nProgress,
      style: { height: 8, background: '#1a9fff', width: `${props.nProgress}%` } });
    let modalMounts = 0;
    const externalModalClosers = new Set();
    const client = { Focusable, DialogButton, TextField, ProgressBar, GamepadButton: { BUMPER_LEFT: 5, BUMPER_RIGHT: 6 },
      IconsModule: {}, ModalRoot: props => React.createElement('div', { role: 'dialog', 'aria-modal': 'true' }, props.children),
      showModal(node) {
        modalMounts++;
        const host = document.createElement('div'); host.className = 'fixture-modal'; document.body.appendChild(host);
        const root = ReactDOM.createRoot(host); dom.flushSync(() => root.render(node));
        host.querySelector('[data-gdl-achievement-tab]')?.focus();
        let closed = false;
        const close = () => { if (closed) return; closed = true; externalModalClosers.delete(close);
          dom.flushSync(() => root.unmount()); host.remove(); };
        externalModalClosers.add(close);
        return { Close: close };
      },
    };
    window.MILLENNIUM_API = client;
    window.SP_REACT = React;
    const nativeRegistry = Object.fromEntries(Object.entries(nativeFactories).map(([id, source]) => [id, new Function(`return (${source})`)()]));
    const nativeModules = {};
    const text = (_key, fallback) => fallback ?? _key;
    const locale = { we: (key, ...values) => values.length ? `${key} ${values.join(' ')}` : key,
      Yp: (key, value) => `${key} ${value}`, pf: { GetPreferredLocales: () => ['en-US'] } };
    const nativeDeps = { 63696: React, 62540: req(62540), 38850: { Z: Focusable }, 50158: { z2: ProgressBar },
      50777: { pd: TextField }, 8658: { A: (...values) => values.filter(Boolean).join(' ') },
      7727: locale, 54661: { Ms: () => ({ year: 'numeric', month: 'short', day: 'numeric' }) } };
    const nativeRequire = id => {
      if (id in nativeDeps) return nativeDeps[id];
      if (nativeModules[id]) return nativeModules[id].exports;
      if (!nativeRegistry[id]) return {};
      const mod = nativeModules[id] = { exports: {} }; nativeRegistry[id](mod, mod.exports, nativeRequire); return mod.exports;
    };
    Object.assign(nativeRequire, { d: req.d, n: req.n, r: req.r, o: req.o });
    const A = 3000000001, B = 3000000002;
    const mapping = { [`shortcut:${A}`]: '550', [`shortcut:${B}`]: '550' };
    window.g_Router = { history: { location: { pathname: `/routes/library/app/${A}` } } };
    const root = document.getElementById('gdl-bp-detail-root');
    root.dataset.gdlShortcutAppId = String(A); root.dataset.gdlSteamAppId = '550'; root.dataset.gdlBpGeneration = '1';
    const publicBefore = document.getElementById('native-public').outerHTML;
    const loaded = {}, dependencies = {
      react: { ...foreignReact, default: foreignReact }, '@steambrew/client': client,
      '../../steam/localization': { loc: text, gdlText: text },
      '../../core/text': { normalizeTitle: value => String(value).toLowerCase() },
      '../../core/mappings': { mappings: mapping, isMappingSnapshotVerified: () => true,
        shortcutMappingKey: id => `shortcut:${id}`, findMappingForTitle: () => null },
      '../shortcuts': { getMappedShortcuts: () => [{ id: A, steamAppId: '550', title: 'Game A' }, { id: B, steamAppId: '550', title: 'Game B' }],
        getShortcutAppById: () => ({}), toSignedShortcutAppId: id => id | 0, looseMatchTitle: () => false },
      '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
      '../../steam/gamepad/virtual-keyboard': { hideSteamVirtualKeyboard() {} },
      '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { captureRuntime() {}, getRequire: () => nativeRequire,
        getAllModules: () => [], getRuntimeIdentity: () => nativeRequire, getModuleFactoryCount: () => 0, getModuleFactories: () => [] } },
      '../modules/SteamWebpackRuntime': { steamWebpackRuntime: { captureRuntime() {}, getRequire: () => nativeRequire,
        getAllModules: () => [], getRuntimeIdentity: () => nativeRequire, getModuleFactoryCount: () => 0, getModuleFactories: () => [] } },
      '../achievements/service': { subscribeLocalAchievementData(callback) { listeners.add(callback); return () => listeners.delete(callback); } },
      '../achievements/format': { formatLocalUnlockDate: value => String(value) },
      '../achievements/rarity': { isRareAchievement: item => item.global_percent_known !== false && item.global_percent < 10,
        compareEarnedAchievementsForDisplay: (a, b) => b.earned_time - a.earned_time,
        compareLockedAchievementsForDisplay: (a, b) => b.global_percent - a.global_percent, highlightedAchievementNames: () => new Set() },
      '../library/social/feed': { getCurrentSteamUser: () => ({ name: 'Player', avatar: '' }) },
      '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => mapping[`shortcut:${id}`] },
      '../../api/backend': { backendLog() {} },
      '../../steam/gamepad/components/AppDetailsNativeComponents': { ensureAppDetailsStoreGuarded() {},
        registerNativeAchievementStateRestore: () => () => {}, restoreNativeAchievementState() {} },
      '../../steam/gamepad/components/AppDetailsNativeClasses': { resolveNativeAppDetailsClasses: () => ({}), FALLBACK_FOCUS_RING_CLASSES: {} },
    };
    function load(name) {
      if (loaded[name]) return loaded[name];
      const exports = loaded[name] = {};
      new Function('exports', 'require', sources[name])(exports, dependency => {
        if (dependency in dependencies) return dependencies[dependency];
        if (dependency === './modules/SteamWebpackRuntime') return dependencies['../modules/SteamWebpackRuntime'];
        const aliases = { '../../steam/gamepad/GamepadContext': 'context', '../achievements/cache': 'cache',
          './editable-target': 'editable', './spatial-navigation': 'spatial', './gamepad-nav': 'navigation',
          './navigation-session': 'navigation-session',
          '../../steam/gamepad/document-ui-runtime': 'document-ui-runtime', './runtime-cache': 'runtime-cache',
          './document-primitives': 'document-primitives',
          './owned-modals': 'owned', './NativeBigPictureAchievementScreen': 'screen' };
        if (dependency in aliases) return load(aliases[dependency]);
        const key = dependency.split('/').pop();
        if (key in sources) return load(key);
        throw Error(`Unexpected ${name} dependency ${dependency}`);
      });
      return exports;
    }
    if (scenarioSource) return await new Function('fixture', `return (${scenarioSource})(fixture)`)({
      React, foreignReact, ReactDOM, foreignReactDOM: foreignRequire(reactDOMId), dom, load, loaded, req, registry, nativeRequire, nativeRegistry, nativeModules,
      dependencies, client, root, mapping, A, B, frame, check, listeners,
      observerCount: () => observerCount, checks: () => checks, modalMounts: () => modalMounts,
      externalCloseLatestModal: () => [...externalModalClosers].at(-1)?.(),
    });
    const cache = load('cache'), screen = load('screen'), summary = load('summary'), nav = load('navigation'), owned = load('owned');
    const item = (index, earned = index < 5) => ({ name: `ACH_${index}`, display_name: `Achievement ${index}`, description: `Description ${index}`,
      icon: '', icon_gray: '', hidden: index === 41, earned, earned_time: earned ? 1000 + index : 0,
      progress: earned ? 5 : 1, max_progress: 5, global_percent: index >= 39 && index <= 40 ? 0 : 95 - index,
      global_percent_known: index !== 40 });
    const dataA = { found: true, appid: '550', metadata_appid: '550', total: 42, unlocked: 5,
      path: 'C:/A/state.json', achievements: Array.from({ length: 42 }, (_, index) => item(index)) };
    const dataB = { ...dataA, path: 'D:/B/state.json', unlocked: 42, achievements: dataA.achievements.map(value => ({ ...value, earned: true })) };
    cache.cacheLocalAchievements(dataA, '550', String(A)); cache.cacheLocalAchievements(dataB, '550', String(B));
    const section = props => React.createElement('section', null, props.highlight, props.children);
    const summaryRoot = ReactDOM.createRoot(root);
    dom.flushSync(() => summaryRoot.render(React.createElement(summary.NativeBigPictureAchievements, {
      shortcut: { id: A, title: 'Game A', steamAppId: '550' }, document, data: { achievements: dataA }, classes: {}, hydrating: false,
      SectionComponent: section, LoadingComponent: () => null, NativeButton: DialogButton, NativeFocusable: Focusable,
      NativeProgress: ProgressBar, NativeIcons: {}, NativeStrip: section,
    })));
    const opener = root.querySelector('.gdl-bp-view-all-achievements');
    const strip = document.getElementById('tabs');
    nav.installBigPictureGamepadNavigation(document, root, strip, new Map([['stuff', strip.firstElementChild]]), { authority: 'fallback', generation: 1 });
    await frame();
    const baselineObservers = observerCount;
    opener.focus(); opener.click(); await frame();
    const modal = () => document.getElementById('gdl-bp-achievements-screen');
    const rows = () => [...modal().querySelectorAll('[data-gdl-achievement-name]')];
    const tab = name => modal().querySelector(`[data-gdl-achievement-tab="${name}"]`);
    const search = () => modal().querySelector('input');
    const type = value => {
      const input = search(); input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    check(modal() && modalMounts === 1, 'Tus cosas opens exactly one owned achievement screen');
    check(modal().textContent.includes('5 of 42') && modal().querySelector('[role=progressbar]').getAttribute('aria-valuenow') === '12', 'The personal header uses A local state, not B or official account progress');
    check(rows().length === 42 && rows()[0].dataset.gdlAchievementName === 'ACH_4', 'The complete personal list orders earned rows by local unlock time');
    check(rows()[0].classList.contains(nativeRequire(18980).AchievementListItemBase), 'Personal rows execute the installed Steam presentational component');
    rows()[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await frame();
    check(document.activeElement === rows()[1], 'Keyboard down follows actual production spatial navigation between achievement rows');
    check(!modal().textContent.includes('Achievement 41'), 'Hidden locked metadata remains concealed');
    type('Achievement 3'); await frame();
    check(rows().length === 11, 'Search filters actual production row data while preserving native input');
    tab('global').click(); await frame();
    check(rows().length === 42 && rows()[0].dataset.gdlAchievementName === 'ACH_0', 'Global achievements sort actual metadata rarity descending');
    check(rows().at(-1).textContent.includes('—') && !rows().at(-1).textContent.includes('0.0%'), 'Unknown rarity is visibly unavailable instead of invented zero');
    check(rows().find(row => row.dataset.gdlAchievementName === 'ACH_39').textContent.includes('0.0%'), 'Known zero rarity remains an actual zero distinct from unavailable data');
    check(rows()[0].querySelector(`.${nativeRequire(18980).ProgressFill}`).style.width === '95%', 'Global bars use metadata rarity rather than 12% local completion');
    const list = modal().querySelector('.gdl-bp-ach-scroll'); list.scrollTop = 350;
    tab('mine').click(); await frame();
    check(search().value === 'Achievement 3' && rows().length === 11, 'Each tab retains its own search');
    type(''); await frame();
    tab('global').click(); await frame();
    check(list.scrollTop === 350, 'Returning to global restores its scroll independently');
    rows().find(row => row.dataset.gdlAchievementName === 'ACH_41').click(); await frame();
    check(modal().textContent.includes('Achievement 41'), 'Selecting a hidden achievement reveals only that row');
    tab('mine').focus(); tab('mine').click(); await frame();
    check(nav.switchBigPictureOwnedModalTab(document, 1), 'Controller shoulder action targets modal tabs');
    await frame(); check(tab('global').getAttribute('aria-selected') === 'true' && strip.firstElementChild.getAttribute('aria-selected') === 'true', 'Modal shoulders leave Tus cosas underneath selected');
    type('no match'); await frame(); check(rows().length === 0 && modal().querySelector('[role=status]'), 'Empty search has an accessible honest result');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frame(); check(modal() && document.activeElement === tab('global'), 'The first Back exits search editing without closing the screen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));
    await frame(); check(tab('mine').getAttribute('aria-selected') === 'true', 'Keyboard shoulder shortcut switches only the modal achievement tab');
    for (const callback of [...listeners]) callback({ steamAppId: '550', stateAppId: String(B), data: dataB });
    await frame(); check(modal().textContent.includes('5 of 42'), 'Updates for sibling B never change A modal');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frame();
    check(!modal() && document.activeElement === opener, 'Back closes the owned screen and restores the exact opener focus');
    check(listeners.size === 0 && observerCount === baselineObservers, 'Close releases screen subscription and modal observer');
    nav.disposeBigPictureGamepadNavigation(document);
    const nativeTree = { CreateNode() {}, Window: window, WindowContext: { RootWindow: window }, Root: { Element: root },
      SubscribableIsMounted: { Value: true } };
    const nativeParent = { Tree: nativeTree }, nativeOwnNode = { Tree: nativeTree, Parent: nativeParent, Element: opener, BTakeFocus: () => true };
    nav.installBigPictureGamepadNavigation(document, root, strip, new Map([['stuff', strip.firstElementChild]]),
      { authority: 'native', generation: 1, nativeNavNode: nativeParent,
        nativeNavHandle: { Node: () => nativeOwnNode, NavTree: () => nativeTree } });
    opener.focus(); opener.click(); await frame();
    const nativeButton = new CustomEvent('fixture-native-button', { detail: { button: 6 }, bubbles: true, cancelable: true });
    modal().firstElementChild.dispatchEvent(nativeButton); await frame();
    check(tab('global').getAttribute('aria-selected') === 'true' && nativeButton.defaultPrevented, 'The native Focusable shoulder event selects one modal tab with native authority');
    search().focus();
    modal().firstElementChild.dispatchEvent(new CustomEvent('fixture-native-button', { detail: { button: 5 }, bubbles: true, cancelable: true }));
    await frame(); check(tab('global').getAttribute('aria-selected') === 'true', 'Native shoulders preserve text editor ownership while search is active');
    tab('global').focus();
    tab('global').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frame(); check(!modal() && document.activeElement === opener, 'Native Focusable cancel closes the screen and restores its opener');
    nav.disposeBigPictureGamepadNavigation(document);
    nav.installBigPictureGamepadNavigation(document, root, strip, new Map([['stuff', strip.firstElementChild]]), { authority: 'fallback', generation: 1 });
    for (let cycle = 0; cycle < 100; cycle++) {
      opener.focus(); opener.click();
      check(Boolean(modal()), 'Repeated opening retains owner authority');
      owned.disposeBigPictureModals(document);
    }
    await frame(); check(listeners.size === 0 && observerCount === baselineObservers && document.querySelectorAll('.fixture-modal').length === 0,
      'One hundred open/dispose cycles leave no subscriptions, modal roots or observers');
    opener.focus(); opener.click(); await frame();
    const oldCallbacks = [...listeners];
    window.g_Router.history.location.pathname = '/routes/library/app/550';
    root.dataset.gdlBpGeneration = '2'; root.appendChild(document.createElement('i'));
    await frame(); check(!modal() && listeners.size === 0 && observerCount === baselineObservers, 'Native route change retires the screen and all its observers');
    for (const callback of oldCallbacks) callback({ steamAppId: '550', stateAppId: String(A), data: dataB });
    check(cache.getCachedLocalAchievementsForShortcut('550', String(A)) === dataA, 'Callbacks captured before disposal cannot replace A cache');
    check(!screen.openBigPictureAchievementsScreen(document, { id: A, title: 'A', steamAppId: '550' }, dataA), 'A stale native destination cannot reopen the linked screen');
    window.g_Router.history.location.pathname = `/routes/library/app/${B}`;
    root.dataset.gdlShortcutAppId = String(B); root.dataset.gdlBpGeneration = '3';
    check(!screen.openBigPictureAchievementsScreen(document, { id: B, title: 'B', steamAppId: '550' }, dataA), 'Matching metadata cannot substitute A progress for B');
    check(screen.openBigPictureAchievementsScreen(document, { id: B, title: 'B', steamAppId: '550' }, dataB), 'B can open with its own exact cached snapshot');
    await frame(); check(modal().textContent.includes('42/42'), 'B independently renders full completion');
    owned.disposeBigPictureModals(document); nav.disposeBigPictureGamepadNavigation(document); dom.flushSync(() => summaryRoot.unmount());
    await frame(); check(listeners.size === 0 && observerCount === 0 && !modal(), 'Plugin teardown retires every owned modal resource');
    check(foreignReact !== loaded['document-ui-runtime'].getDocumentReact(document), 'Production hooks and components consistently use owner React despite a foreign JSX import');
    check(document.getElementById('native-public').outerHTML === publicBefore, 'Native public game markup remains byte-for-byte unchanged');
    check(React.version === '19.1.1', 'The workflow used the installed Steam React rather than a simulated hook renderer');
    return { checks, modalMounts, react: React.version };
  }, { sources: { ...sources, ...extraSources }, factories: Object.fromEntries(Object.entries(factories).map(([id, factory]) => [id, String(factory)])), nativeFactories, reactDOMId,
    scenarioSource: scenario ? String(scenario) : null });
  console.log(`${report.label || 'Big Picture achievement workflow'} passed: ${report.checks} checks, ${report.modalMounts} owned openings with Steam React ${report.react}; no account writes.`);
  return report;
} finally { await browser.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBPBrowserScenario();
