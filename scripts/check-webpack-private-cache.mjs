import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, ...globals, require: name => {
    assert(name in dependencies, `Unexpected ${file} dependency ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
const logs = [], registry = new Map([['host-store', { nativeHostStore: true }]]);
const host = { closed: false }; host.document = { defaultView: host, body: { isConnected: true } };
const runtime = load('frontend/steam/modules/SteamWebpackRuntime.ts', {
  '../../api/backend': { backendLog: value => logs.push(value) }, '@steambrew/client': { modules: registry },
}, { window: host }).steamWebpackRuntime;
const cache = load('frontend/steam/gamepad/runtime-cache.ts', { '../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime } });
const ui = load('frontend/steam/gamepad/document-ui-runtime.ts', {
  '../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime }, './runtime-cache': cache,
});
const pure = load('frontend/steam/gamepad/components/pure-class-factory.ts', {});
const classes = load('frontend/steam/gamepad/components/AppDetailsNativeClasses.ts', {
  '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime }, '../../../api/backend': { backendLog() {} },
  './pure-class-factory': pure,
});
function realm(label, reused) {
  const listeners = new Map(), view = reused || { closed: false };
  view.addEventListener = (type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); };
  view.removeEventListener = (type, callback) => listeners.get(type)?.delete(callback);
  const doc = { defaultView: view, body: { isConnected: true } }; view.document = doc;
  const executed = [], privateCache = new Map();
  const react = { owner: label, createElement() {}, useState() {}, useEffect() {}, useRef() {} };
  const factories = {
    63696(module) { module.exports = react; },
    98131(module) { const primary = 'react-dom-client.production.js'; module.exports = {}; module.exports.createRoot = function () { return label; }; },
    101(module) { module.exports = { Focusable: function Focusable(e) { const {"flow-children":a,onActivate:b,onCancel:c,focusClassName:d,focusWithinClassName:f}=e; return label; } }; },
    102(module) { module.exports = { Button: { render() { return '"DialogButton","_DialogLayout","Secondary"'; } } }; },
    103(module) { module.exports = { Field: class { m_elInput = null; static validateUrl() {} static validateEmail() {} } }; },
    104(module) { module.exports = { Progress: function (e) { return {role:"progressbar","aria-valuenow":e.nProgress,nTransitionSec:e.nTransitionSec}; } }; },
    105(module) { module.exports={Achievement:()=>null,Checkmark:()=>null,Spinner:()=>({className:"X.Spinner",d:"M18 10C17.4696"})}; },
    106(module) { module.exports = { Root: function () { return 'Either closeModal or onCancel should be passed to GenericDialog. Classes: '; } }; },
    107(module) { module.exports = { Show: function (node, parent, title, props) { const primary = 'props.bDisableBackgroundDismiss ShowLegacyPopupModal'; return { Close() {} }; } }; },
    999999(module) { throw Error('Unrelated stores must never initialize'); },
  };
  const section = { AppDetailsSection: label + '-section', AppDetailsSectionContainer: label + '-container', RightColumnSection: label + '-right', Body: label + '-body', Highlight: label + '-highlight' };
  const quick = { GameInfoQuickLinks: label + '-links', GameInfoCollections: label + '-collections', AppDetailsContent: label + '-content', GameInfoContainer: label + '-info' };
  factories[201] = new Function('module', 'module.exports=' + JSON.stringify(section) + ';');
  factories[202] = new Function('module', 'module.exports=' + JSON.stringify(quick) + ';');
  factories[203] = function (module) { throw Error('AppDetailsSection AppDetailsSectionContainer RightColumnSection Body Highlight: store-shaped source must not execute'); };
  const req = function(id) {
    id = String(id);
    if (privateCache.has(id)) return privateCache.get(id).exports;
    if (!req.m[id]) throw Error('Missing factory ' + id);
    executed.push(id); const module = { exports: {} }; privateCache.set(id, module);
    req.m[id](module, module.exports, req); return module.exports;
  };
  req.m = factories; req.e = async () => {};
  view.webpackChunksteamui = { push: chunk => chunk[2](req) };
  return { doc, view, req, executed, react, privateCache, listeners };
}
const a = realm('A'), b = realm('B');
check(a.req.c === undefined && runtime.captureRuntime(a.doc), 'The actual bootstrap shape exposes factories through .m and keeps .c private');
check(runtime.getAllModules(a.doc).length === 0 && a.executed.length === 0, 'Capturing and inspecting the runtime executes no factory');
check(runtime.getModuleFactories(a.doc).length === Object.keys(a.req.m).length && a.executed.length === 0, 'Factory inspection remains read-only');
const identity = runtime.getRuntimeIdentity(a.doc), ownedRequire = runtime.getRequire(a.doc);
check(ownedRequire !== a.req && ownedRequire.m === a.req.m && ownedRequire.c === undefined, 'An owner-bound callable preserves the native factory table without fabricating an exposed cache');
check(ui.getDocumentReact(a.doc) === a.react, 'Owner React resolves from the private-cache runtime');
const rendererA = ui.getDocumentRenderer(a.doc), nativeUI = ui.getDocumentUIComponents(a.doc);
check(typeof rendererA?.createRoot === 'function' && nativeUI.Focusable && nativeUI.DialogButton && nativeUI.TextField && nativeUI.ProgressBar
  && nativeUI.IconsModule?.Achievement && nativeUI.ModalRoot && nativeUI.showModal, 'Bounded lazy factory bootstrap resolves renderer and native UI presentation exports');
check(runtime.getRuntimeIdentity(a.doc) === identity, 'Lazy presentation acquisition preserves the runtime lease used by its first commit');
check(!a.executed.includes('999999') && a.executed.length === 9, 'Bootstrap executes exactly React, renderer and seven identified UI factories, with zero unrelated stores');
const styleA = classes.resolveNativeAppDetailsClasses(a.doc);
check(styleA.Section?.AppDetailsSection === 'A-section' && styleA.QuickLinks?.GameInfoQuickLinks === 'A-links', 'Private-cache class resolution loads only exact pure CSS object exports');
check(a.executed.length === 11 && !a.executed.includes('203') && runtime.getRuntimeIdentity(a.doc) === identity,
  'Pure CSS loading is bounded and does not initialize a semantic store decoy or invalidate the render lease');
check(ui.getDocumentReact(b.doc) === b.react && ui.getDocumentRenderer(b.doc) !== rendererA, 'Another CEF resolves independent React and renderer exports');
const styleB = classes.resolveNativeAppDetailsClasses(b.doc);
check(styleB.Section?.AppDetailsSection === 'B-section' && classes.resolveNativeAppDetailsClasses(a.doc).Section === styleA.Section,
  'Inspecting another private-cache CEF preserves the first Document style cache');
check(a.executed.every(id => id !== 'host-store') && b.executed.every(id => id !== '999999'), 'No private-cache realm borrows the host registry or eagerly initializes stores');
const previous = runtime.getRuntimeIdentity(a.doc);
a.req.m[201] = new Function('module', 'module.exports={AppDetailsSection:"A-new",AppDetailsSectionContainer:"container",RightColumnSection:"right",Body:"body",Highlight:"highlight"};');
a.privateCache.delete('201');
check(runtime.getRuntimeIdentity(a.doc) !== previous && classes.resolveNativeAppDetailsClasses(a.doc).Section?.AppDetailsSection === 'A-new', 'Replacing a loaded factory revokes the old lease and presentation cache');
const replacement = realm('A-next', a.view);
check(runtime.captureRuntime(replacement.doc) && ui.getDocumentReact(replacement.doc) === replacement.react, 'A same-Window new Document captures its own private bootstrap');
assert.throws(() => ownedRequire(63696), /Document was retired/); checks++;
check(runtime.getRequire(a.doc) === null && runtime.getModuleFactories(a.doc).length === 0, 'A retired Document cannot inspect or invoke the successor factories');
runtime.invalidate(a.doc);
check(ui.getDocumentReact(replacement.doc) === replacement.react, 'Stale invalidation cannot retire a successor CEF runtime');
const withoutLocalRuntime = { defaultView: { closed: false }, body: { isConnected: true } }; withoutLocalRuntime.defaultView.document = withoutLocalRuntime;
check(!runtime.captureRuntime(withoutLocalRuntime) && ui.getDocumentReact(withoutLocalRuntime) === null,
  'An explicit CEF without a bootstrap cannot borrow the host Millennium registry');
const lateStyles = realm('late-styles'), pendingSection = lateStyles.req.m[201]; delete lateStyles.req.m[201];
ui.getDocumentReact(lateStyles.doc);
const lateIdentity = runtime.getRuntimeIdentity(lateStyles.doc);
check(classes.resolveNativeAppDetailsClasses(lateStyles.doc).Section === null, 'A CSS factory not loaded by Steam yet remains a missing capability');
lateStyles.req.m[201] = pendingSection;
check(classes.resolveNativeAppDetailsClasses(lateStyles.doc).Section?.AppDetailsSection === 'late-styles-section'
  && runtime.getRuntimeIdentity(lateStyles.doc) === lateIdentity, 'An appended pure CSS factory retries presentation discovery without revoking the renderer lease');

// Desktop keeps its already initialized registry, but only in its original
// Window/Document and only for IDs present in that runtime's native factories.
const nativeHostStore = registry.get('host-store'); registry.set('not-in-factories', { mustNotBorrow: true });
let hostExecutions = 0;
const hostRequire = id => { hostExecutions++; throw Error('Capture must not initialize existing Desktop modules'); };
hostRequire.m = { 'host-store': () => { throw Error('Existing Desktop factory must not execute'); } };
host.webpackChunksteamui = { push: chunk => chunk[2](hostRequire) };
const originalHostDocument = host.document;
check(runtime.captureRuntime(originalHostDocument) && runtime.getAllModules(originalHostDocument).length === 1
  && runtime.getAllModules(originalHostDocument)[0].exports === nativeHostStore && hostExecutions === 0,
  'Capturing the plugin Desktop runtime retains only already loaded matching registry exports with zero execution');
const foreign = realm('foreign-popup'); foreign.req.m['host-store'] = module => { module.exports = { owner: 'foreign-popup' }; };
check(runtime.captureRuntime(foreign.doc) && runtime.getAllModules(foreign.doc).length === 0 && foreign.executed.length === 0,
  'A popup with matching factory IDs cannot borrow Desktop registry exports during capture');
check(runtime.getRequire(foreign.doc)('host-store').owner === 'foreign-popup'
  && runtime.getAllModules(originalHostDocument)[0].exports === nativeHostStore,
  'A popup loads its own export and preserves the original Desktop registry cache');
const nextHost = realm('host-next-document', host); nextHost.req.m['host-store'] = module => { module.exports = { owner: 'new-document' }; };
check(runtime.captureRuntime(nextHost.doc) && runtime.getAllModules(nextHost.doc).length === 0 && nextHost.executed.length === 0,
  'A new Document in the plugin Window never inherits the old Document registry');

for (const factory of [
  module => { module.exports = { AppDetailsSection: callClient() }; },
  module => { initializeStore(); module.exports = { AppDetailsSection: 'fake' }; },
  module => { module.exports = { get AppDetailsSection() { return 'fake'; } }; },
  module => { module.exports = { ['AppDetailsSection']: 'fake' }; },
  module => { module.exports = { ...foreignStyles }; },
]) check(pure.readPureClassFactory(factory) === null, 'CSS verification rejects calls, extra statements, accessors, computed keys and spreads');
const installed = 'C:/Program Files (x86)/Steam/steamui/sp.js';
if (fs.existsSync(installed)) {
  const self = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(installed, 'utf8'), { self }, { timeout: 2000 });
  const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
  const literal = pure.readPureClassFactory(factories[20297]);
  check(typeof literal?.AppDetailsRoot === 'string' && typeof literal?.GameInfoQuickLinks === 'string',
    'The strict CSS verifier accepts the actual installed Steam pure literal factory without executing it');
}
console.log(`Webpack private-cache bootstrap passed: ${checks} checks; real .m/private-.c shape, owner-scoped lazy React/renderer/UI/CSS and zero eager stores.`);
