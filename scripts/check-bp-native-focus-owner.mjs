// Native navigation ownership uses installed presentation contracts. No Steam
// stores, controllers, account APIs or live client windows are executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const matches = Object.entries(factories).filter(([, factory]) => {
  const code = String(factory);
  return /\bTJ\s*:\s*\(\)\s*=>/.test(code) && code.includes('createContext(null)')
    && code.includes('.Tree.CreateNode(') && code.includes('.RegisterNavigationItem(') && code.includes('navRef');
});
check(matches.length === 1, 'One installed native presentation factory owns the navigation context and registration hook');
const [nativeId, nativeFactory] = matches[0], nativeSource = String(nativeFactory);
const ast = ts.createSourceFile('native-nav.js', `const factory=${nativeSource};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(exportName) {
  const name = nativeSource.match(new RegExp(`\\b${exportName}:\\(\\)=>\\s*([\\w$]+)`))?.[1];
  assert(name, `Installed ${exportName} export has an identifiable implementation`);
  let found;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast); ts.forEachChild(node, visit); };
  visit(ast); assert(found, `Installed ${exportName} function is inspectable`); return found;
}
const hookSource = declaration('qp'), propsSource = declaration('sl');
const pureProps = vm.runInNewContext(`(${propsSource})`, {
  D: props => ({ props, gamepadEvents: {}, actionDescriptions: {} }),
});
const navRef = {}, onMoveDown = () => true;
const split = pureProps({ navRef, onMoveDown, focusable: false, className: 'owned', 'data-owner': 'A' });
check(split.navOptions.navRef === navRef && split.navOptions.onMoveDown === onMoveDown && split.navOptions.focusable === false
  && split.elemProps.className === 'owned' && split.elemProps['data-owner'] === 'A',
  'Installed pure nav-prop expansion preserves native handles and directional callbacks without leaking them to DOM props');

// React itself is the installed production library, rather than a made-up
// {Provider: ...} object that could let a wrong context pass the resolver.
const libraries = fs.readdirSync(path.join(steam, 'libraries')).filter(file => file.endsWith('.js'));
const reactSource = libraries.map(file => fs.readFileSync(path.join(steam, 'libraries', file), 'utf8')).find(code => code.includes('63696:'));
assert(reactSource, 'Installed React library is available');
const vendor = { webpackChunksteamui: [] }; vm.runInNewContext(reactSource, { self: vendor });
const vendorFactories = Object.assign({}, ...vendor.webpackChunksteamui.map(chunk => chunk[1])), vendorCache = {};
const requireVendor = id => {
  if (vendorCache[id]) return vendorCache[id].exports;
  assert(vendorFactories[id], `React dependency ${id} exists`);
  const module = vendorCache[id] = { exports: {} }; vendorFactories[id](module, module.exports, requireVendor); return module.exports;
};
requireVendor.d = (exports, definitions) => { for (const [key, get] of Object.entries(definitions)) Object.defineProperty(exports, key, { enumerable: true, get }); };
requireVendor.r = exports => Object.defineProperty(exports, '__esModule', { value: true });
requireVendor.n = value => { const get = () => value?.__esModule ? value.default : value; get.a = get; return get; };
requireVendor.o = (value, key) => Object.hasOwn(value, key);
const React = requireVendor(63696);
const navContext = React.createContext(null);
const ringContext = React.createContext(null);
const nativeExports = { TJ: navContext, sQ: ringContext, qp: vm.runInNewContext(`(${hookSource})`), sl: pureProps };
const realms = new WeakMap(), identities = new WeakMap();
let required = [], sourceScans = 0;
const runtime = { captureRuntime() {}, getRuntimeIdentity: doc => identities.get(doc),
  getAllModules: doc => realms.get(doc)?.loaded || [], getRequire: doc => realms.get(doc)?.req,
  getModuleFactoryCount: doc => Object.keys(realms.get(doc)?.req.m || {}).length,
  getModuleFactories: doc => Object.entries(realms.get(doc)?.req.m || {}).map(([id, factory]) => ({ id, factory })) };
const dependencies = {
  '../../../api/backend': { backendLog() {} }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
  '../../native-window-store': { getNativeWindowInstance: doc => realms.get(doc)?.instance || null },
  '../../../core/mappings': { mappings: {}, shortcutMappingKey: id => `shortcut:${id}` },
  '../GamepadContext': { normalizeGamepadAppId: value => Number(value) >>> 0,
    isCurrentLinkedGamepadTarget: (doc, shortcut, appid) => doc.routeId === Number(shortcut) && String(appid) === '550' },
  '../../ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
  './NativeAchievementOwnership': { clearAppDetailsGuards() {}, ensureAppDetailsStoreGuarded() {}, releaseAppDetailsGuards() {},
    restoreNativeAchievementState() {}, registerNativeAchievementStateRestore() {} },
};
const context = vm.createContext({ exports: {}, require: key => { assert(key in dependencies, key); return dependencies[key]; } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { getNavContext, resolveSteamNav } = context.exports;
function element(doc, id, parent = null) {
  return { ownerDocument: doc, id, isConnected: true, parentElement: parent,
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; },
    closest(selector) {
      for (let node = this; node; node = node.parentElement)
        if ((selector.includes('[id^="gdl-"]') && node.id.startsWith('gdl-')) || node.foreign) return node;
      return null;
    } };
}
function realm(id = nativeId) {
  const view = { closed: false, addEventListener() {}, removeEventListener() {} };
  const doc = { defaultView: view, body: { isConnected: true }, routeId: 3000000001 }; view.document = doc;
  const host = element(doc, 'native-host'), panel = element(doc, 'native-panel', host), strip = element(doc, 'native-tabs', host);
  const root = element(doc, 'gdl-bp-detail-root', panel); root.dataset = { gdlShortcutAppId: String(doc.routeId), gdlSteamAppId: '550' };
  doc.getElementById = key => key === root.id ? root : null;
  doc.querySelector = () => strip;
  const loaded = [], factory = module => { module.exports = nativeExports; };
  factory.toString = () => { sourceScans++; return nativeSource; };
  const req = key => { required.push(String(key)); assert.equal(String(key), String(id));
    if (!loaded.length) loaded.push({ id, exports: nativeExports }); return nativeExports; };
  req.m = { [id]: factory, 999999: function unrelatedStore() { throw Error('An unrelated store must never execute'); } };
  const controller = { NewGamepadNavigationTree() {}, CreateContext() {}, RegisterGamepadNavigationTree() {}, FindContextForRootWindow() {} };
  const tree = { CreateNode() {}, RegisterNavigationItem() {}, Window: view, WindowContext: { RootWindow: view },
    Root: { Element: host }, Controller: controller, SubscribableIsMounted: { Value: true } };
  const navNode = { Tree: tree, Element: panel }, outerNode = { Tree: tree, Element: host };
  const instance = { BrowserWindow: view };
  const active = { bActiveTree: true, bActiveTreeWithinContext: true, bDisableFocusClasses: false, bIsMounted: true };
  const focus = { focusNavWindow: tree.WindowContext, bSupportsFocus: true };
  const ring = { OnFocus() {}, OnBlur() {}, OnFocusChange() {}, OnForceMeasureFocusRing() {} };
  const contexts = { active: React.createContext(null), manager: React.createContext(null), focus: React.createContext(null), instance: React.createContext(null) };
  const state = { doc, view, host, panel, strip, root, req, loaded, factory, tree, navNode, outerNode, instance, active, focus, ring, contexts };
  realms.set(doc, state); identities.set(doc, {}); return state;
}
function attach(state, target = state.panel, values = null, alternate = false) {
  const records = values || [[state.contexts.instance, state.instance], [state.contexts.manager, state.tree.Controller],
    [state.contexts.focus, state.focus], [ringContext, state.ring], [state.contexts.active, state.active], [navContext, state.navNode]];
  const hostRoot = { tag: 3, stateNode: {}, return: null, alternate: null, flags: 0 }; hostRoot.stateNode.current = hostRoot;
  const fibers = [hostRoot]; let parent = hostRoot;
  for (const [type, value] of records) {
    const provider = { tag: 10, type, memoizedProps: { value }, return: parent, alternate: null, flags: 0 };
    parent.child = provider; fibers.push(provider); parent = provider;
  }
  const host = { tag: 5, stateNode: target, memoizedProps: {}, return: parent, alternate: null, flags: 0 };
  parent.child = host; fibers.push(host);
  if (alternate) {
    const other = fibers.map(fiber => ({ ...fiber, memoizedProps: { ...fiber.memoizedProps }, alternate: fiber }));
    for (let index = 0; index < fibers.length; index++) { fibers[index].alternate = other[index];
      other[index].return = other[index - 1] || null; other[index].child = other[index + 1]; }
    Object.defineProperty(target, '__reactFiber$test', { configurable: true, value: other.at(-1) });
    return { fibers, host, hostRoot, other };
  }
  Object.defineProperty(target, '__reactFiber$test', { configurable: true, value: host });
  return { fibers, host, hostRoot };
}
const a = realm(); attach(a);
check(getNavContext(a.doc) === navContext && required.join(',') === nativeId,
  'The production resolver loads only the installed semantic navigation module, without a historical numeric hint');
const warmScans = sourceScans;
for (let index = 0; index < 100; index++) assert.equal(getNavContext(a.doc), navContext);
check(sourceScans === warmScans && required.length === 1, 'One hundred warm context lookups neither rescan nor execute factories');
const resolved = resolveSteamNav(a.doc);
check(resolved?.navNode === a.navNode && resolved.navContext === navContext,
  'A native panel selects its exact committed parent node from the installed Focusable context');
check(resolved.providers.map(item => item.kind).join(',') === 'active-tree,focus-ring,focus-window,manager,window-instance',
  'The bridge captures the native active tree, focus window, manager and window instance in ancestral provider order');
check(resolved.providers[0].value === a.active && resolved.providers[1].value === a.ring && resolved.providers[2].value === a.focus
  && resolved.providers[3].value === a.tree.Controller && resolved.providers[4].value === a.instance,
  'Raw provider values retain exact native identities instead of constructing another tree or manager');
const deep = attach(a), nativeProvider = deep.host.return;
let deepParent = nativeProvider.return;
for (let index = 0; index < 180; index++) {
  const wrapper = { tag: 0, type: function NativeLayout() {}, memoizedProps: {}, return: deepParent, flags: 0 };
  deepParent.child = wrapper; deepParent = wrapper;
}
nativeProvider.return = deepParent; deepParent.child = nativeProvider;
check(resolveSteamNav(a.doc)?.providers.length === 5,
  'A deep Steam layout preserves outer focus-ring/window/manager providers beyond the old 128-fiber cutoff');
a.active = { ...a.active, bActiveTree: false }; attach(a);
check(resolveSteamNav(a.doc).providers[0].value === a.active, 'A later native provider commit replaces the active-tree snapshot');
const moved = realm(`${nativeId}-moved`); attach(moved);
check(getNavContext(moved.doc) === navContext && resolveSteamNav(moved.doc)?.navNode === moved.navNode,
  'Moving the same installed factory to a different module ID preserves semantic discovery');
const late = realm(); const lateFactory = late.req.m[nativeId]; delete late.req.m[nativeId];
check(getNavContext(late.doc) === null, 'An absent native navigation chunk has no fabricated provider');
late.req.m[nativeId] = lateFactory; attach(late);
check(getNavContext(late.doc) === navContext && resolveSteamNav(late.doc)?.navNode === late.navNode,
  'Appending the real navigation factory to the same runtime lease recovers a missing context');
const fork = attach(a, a.panel, null, true);
fork.other.at(-2).memoizedProps.value = moved.navNode;
fork.fibers.at(-2).pendingProps = { value: moved.navNode };
check(resolveSteamNav(a.doc)?.navNode === a.navNode, 'A host pointer into the pending alternate resolves only the HostRoot current provider value');
fork.hostRoot.stateNode.current = fork.other[0];
check(resolveSteamNav(a.doc) === null, 'Committing a foreign-window alternate cannot preserve the old native authority');
attach(a); a.panel.__reactFiber$test.flags = 2;
check(resolveSteamNav(a.doc) === null, 'A placement-only host fiber cannot claim native navigation before mounting');
attach(a, a.panel, [[React.createContext(null), a.navNode]]);
check(resolveSteamNav(a.doc) === null, 'A different React context carrying a Tree-shaped value cannot impersonate the native Focusable provider');
delete a.panel.__reactFiber$test;
const stripNode = { Tree: a.tree, Element: a.strip };
attach(a, a.strip, [[navContext, a.outerNode], [navContext, stripNode]]);
check(resolveSteamNav(a.doc)?.navNode === a.outerNode,
  'A tab-strip-only node is skipped for the committed ancestor whose DOM actually contains the added panel');
delete a.strip.__reactFiber$test; attach(a);
for (const [name, mutate, restore] of [
  ['foreign tree window', () => { a.tree.Window = moved.view; }, () => { a.tree.Window = a.view; }],
  ['foreign tree window context', () => { a.tree.WindowContext.RootWindow = moved.view; }, () => { a.tree.WindowContext.RootWindow = a.view; }],
  ['unmounted native tree', () => { a.tree.SubscribableIsMounted.Value = false; }, () => { a.tree.SubscribableIsMounted.Value = true; }],
  ['detached node element', () => { a.panel.isConnected = false; }, () => { a.panel.isConnected = true; }],
  ['detached tree root', () => { a.host.isConnected = false; }, () => { a.host.isConnected = true; }],
  ['foreign modal panel', () => { a.panel.foreign = true; }, () => { a.panel.foreign = false; }],
  ['native destination', () => { a.doc.routeId = 550; }, () => { a.doc.routeId = 3000000001; }],
  ['sibling shortcut', () => { a.doc.routeId++; }, () => { a.doc.routeId = 3000000001; }],
]) { mutate(); check(resolveSteamNav(a.doc) === null, `${name} loses native owner authority immediately`); restore(); }
a.view.document = {};
check(resolveSteamNav(a.doc) === null && getNavContext(a.doc) === null, 'A retired popup document cannot reuse its previous native providers');
a.view.document = a.doc;
check(resolveSteamNav(a.doc)?.navNode === a.navNode, 'A current unchanged owner remains usable after rejected foreign probes');
check(!required.includes('999999'), 'No unrelated native store factory was executed');
console.log(`BP native focus ownership passed: ${checks} checks; installed module ${nativeId}, React ${React.version}, semantic contexts, committed alternates, inherited raw providers and exact popup/tree ownership.`);
