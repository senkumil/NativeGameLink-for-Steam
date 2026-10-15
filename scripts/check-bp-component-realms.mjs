import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const registry = new Map([['foreign', { name: 'plugin-host-only' }]]);
function load(file, imports, globals = {}) {
  const context = vm.createContext({ exports: {}, console, ...globals, require: key => {
    assert(key in imports, `Unexpected ${file} dependency: ${key}`); return imports[key];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
class View {
  closed = false; listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
}
const host = new View(); host.document = { defaultView: host, body: { isConnected: true } };
const webpack = load('frontend/steam/modules/SteamWebpackRuntime.ts', {
  '../../api/backend': { backendLog() {} }, '@steambrew/client': { modules: registry },
}, { window: host }).steamWebpackRuntime;
const id = 3000000001;
const nativeWindows = load('frontend/steam/native-window-store.ts', { './modules/SteamWebpackRuntime': { steamWebpackRuntime: webpack } });
const nativeOwnership = load('frontend/steam/gamepad/components/NativeAchievementOwnership.ts', {
  '../../../api/backend': { backendLog() {} }, '../../../core/mappings': { isMappingSnapshotVerified: () => true, mappings: { [`shortcut:${id}`]: '111' }, shortcutMappingKey: value => `shortcut:${value >>> 0}` },
});
const components = load('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts', {
  '../../native-window-store': nativeWindows,
  './NativeAchievementOwnership': nativeOwnership,
  '../GamepadContext': { normalizeGamepadAppId: value => Number.isInteger(Number(value)) && Number(value) >= -2147483648 && Number(value) <= 4294967295 ? Number(value) >>> 0 : null, isCurrentLinkedGamepadTarget: (doc, id) => doc?.routeId === id },
  '../../ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => doc?.gamepad === true } },
  '../../../api/backend': { backendLog() {} }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: webpack },
  '../../../core/mappings': { isMappingSnapshotVerified: () => true, mappings: { [`shortcut:${id}`]: '111' }, shortcutMappingKey: value => `shortcut:${value >>> 0}` },
});
function realm(name, view = new View()) {
  const doc = { defaultView: view, body: { isConnected: true } }; view.document = doc;
  const native = Object.freeze({ nTotal: 50, nAchieved: 20, vecHighlight: [] });
  const records = new Map([[id, { details: null }], [111, Object.freeze({ details: Object.freeze({ achievements: native }) })]]);
  const store = { GetAppData: key => records.get(key), GetAchievements(key) { return this.GetAppData(key).details.achievements; } };
  const original = store.GetAchievements;
  function Friends() {} function GameInfo() {}
  Object.assign(GameInfo.prototype, { render() {}, OnImageLoad() {}, onCollapseStarted() {}, onCollapseComplete() {} });
  const modules = new Map([[78057, { H: store }], [2326, { w4: Friends, gr() {}, oG() {} }], [15448, { b: GameInfo }]]);
  const req = key => { if (!modules.has(Number(key))) throw Error('missing module'); return modules.get(Number(key)); };
  req.c = Object.fromEntries([...modules].map(([key, exports]) => [key, { exports }]));
  view.webpackChunksteamui = { push: chunk => chunk[2](req) };
  return { name, view, doc, req, modules, store, original, records, native, Friends, GameInfo };
}
const a = realm('a'), b = realm('b'), desktop = realm('desktop');
check(components.resolveNativeAppDetailsStore(a.doc) === a.store, 'First BP store resolves from its own real Webpack runtime');
const guardedA = a.store.GetAchievements;
check(components.resolveNativeFriendsComponent(a.doc) === a.Friends && components.resolveNativeGameInfoComponent(a.doc) === a.GameInfo,
  'Component and native Game Information identities belong to the requested realm');
components.resolveNativeAppDetailsStore(b.doc); components.resolveNativeAppDetailsStore(desktop.doc);
check(a.store.GetAchievements === guardedA && components.resolveNativeFriendsComponent(a.doc) === a.Friends,
  'Inspecting another BP or Desktop realm preserves the first BP guard and cached component');
check(components.resolveNativeFriendsComponent(b.doc) === b.Friends && b.Friends !== a.Friends, 'Two BP Documents never exchange component exports');
check(a.store.GetAchievements(111) === a.native && b.store.GetAchievements(111) === b.native,
  'Public Steam progress retains exact frozen objects and receives no synthetic writes');
a.store.GetAchievements(id); b.store.GetAchievements(id);
check(a.records.get(id).details.achievements.nTotal === 0 && b.records.get(id).details.achievements.nTotal === 0,
  'Compatibility fallback is tracked separately for both shortcut stores');
components.clearNativeComponentsCache(a.doc);
check(a.store.GetAchievements === a.original && a.records.get(id).details === null, 'Scoped cleanup restores only its own method and fallback');
check(b.store.GetAchievements !== b.original && b.records.get(id).details.achievements.nTotal === 0,
  'Another live BP projection and guard survive the scoped cleanup');
let restoredA = 0, restoredB = 0;
components.registerNativeAchievementStateRestore(id, () => restoredA++, a.doc);
components.registerNativeAchievementStateRestore(id, () => restoredB++, b.doc);
components.restoreNativeAchievementState(id, a.doc);
check(restoredA === 1 && restoredB === 0, 'Same-AppID restoration callbacks remain Document-owned');
const owners = new Set([a.doc, b.doc]); let sharedRestores = 0;
components.registerNativeAchievementStateRestore(id, () => sharedRestores++, owners);
components.restoreNativeAchievementState(id, a.doc);
check(sharedRestores === 0 && owners.has(b.doc), 'A shared native projection survives while another Document owns it');
components.restoreNativeAchievementState(id, b.doc);
check(sharedRestores === 1 && restoredB === 1, 'The final owner releases a shared projection exactly once');

const replacement = realm('same-window-replacement', b.view);
check(components.resolveNativeAppDetailsStore(replacement.doc) === replacement.store, 'A new Document in the same Window captures new native exports');
check(b.store.GetAchievements === b.original && b.records.get(id).details === null,
  'Document replacement retires only its previous Window generation');
check(components.resolveNativeAppDetailsStore(b.doc) === null, 'A retired Document cannot borrow its successor runtime');
const guardedReplacement = replacement.store.GetAchievements;
components.clearNativeComponentsCache(b.doc);
check(replacement.store.GetAchievements === guardedReplacement, 'An old Document teardown cannot unhook its successor');
const freshNativeMethod = () => 'newer-native-method'; replacement.store.GetAchievements = freshNativeMethod;
components.clearNativeComponentsCache(replacement.doc);
check(replacement.store.GetAchievements === freshNativeMethod, 'Restoration preserves a newer native method replacement');

const empty = new View(); const emptyDoc = { defaultView: empty }; empty.document = emptyDoc;
check(!webpack.captureRuntime(emptyDoc) && webpack.getAllModules(emptyDoc).length === 0,
  'An explicit foreign CEF without a local runtime cannot borrow the Millennium registry');
const oldIdentity = webpack.getRuntimeIdentity(desktop.doc);
const desktopNext = realm('desktop-next', desktop.view);
check(webpack.getRuntimeIdentity(desktopNext.doc) !== oldIdentity && webpack.getRequire(desktopNext.doc) === desktopNext.req,
  'Same-Window replacement changes the Webpack generation and require function');
webpack.invalidate(desktop.doc);
check(webpack.getRequire(desktopNext.doc) === desktopNext.req, 'Stale scoped Webpack invalidation cannot retire a new Document');
let finishChunk;
desktopNext.req.e = () => new Promise(resolve => { finishChunk = resolve; });
const pending = webpack.ensureChunk(10, desktopNext.doc);
const newest = realm('desktop-newest', desktopNext.view); webpack.captureRuntime(newest.doc);
finishChunk();
check(await pending === false && webpack.getRequire(newest.doc) === newest.req, 'Late chunk completion cannot publish through a replaced Document runtime');
// Exercise production signature matching and cache isolation with equal module
// IDs but distinct native exports in two independent Documents.
const runtimeCache = load('frontend/steam/gamepad/runtime-cache.ts', { '../modules/SteamWebpackRuntime': { steamWebpackRuntime: webpack } });
const capabilities = load('frontend/steam/gamepad/GamepadCapabilities.ts', {
  './runtime-cache': runtimeCache, '../../api/backend': { backendLog() {} },
}).gamepadCapabilities;
const ra = realm('resolver-a'), rb = realm('resolver-b');
function addComponents(realm) {
  delete realm.req.c[15448];
  const names = { Achievements: 'AchievementItem', Activity: 'ActivitySection', Friends: 'FriendsSection',
    GameDetails: 'AppDetailsSection', GameInfo: 'GameInfo', Hero: 'AppHero', News: 'AppNews', Playbar: 'AppDetailsPlayBar' };
  realm.exports = {};
  for (const [key, displayName] of Object.entries(names)) {
    const component = () => null; component.displayName = displayName;
    realm.exports[key] = component;
    realm.req.c[`test-${key}`] = { exports: { component } };
  }
}
addComponents(ra); addComponents(rb);
const resolvers = [];
for (const key of Object.keys(ra.exports)) {
  const signature = key === 'Achievements' ? 'achievements' : key === 'GameInfo' ? 'gameInfo' : key.toLowerCase();
  const imports = { '../runtime-cache': runtimeCache, '../../../api/backend': { backendLog() {} },
    '../GamepadCapabilities': { gamepadCapabilities: capabilities }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: webpack } };
  if (!['Friends', 'GameDetails'].includes(key)) imports[`../../modules/signatures/${signature}`] = load(`frontend/steam/modules/signatures/${signature}.ts`, {
    '../../../api/backend': { backendLog() {} }, '../SteamWebpackRuntime': { steamWebpackRuntime: webpack },
  });
  const resolver = load(`frontend/steam/gamepad/components/${key}Resolver.ts`, imports)[`${key[0].toLowerCase()}${key.slice(1)}Resolver`];
  resolvers.push([key, resolver]);
  check(resolver.resolve(ra.doc) === ra.exports[key] && resolver.resolve(rb.doc) === rb.exports[key], `${key} resolves from the requested Document's production Webpack modules`);
  resolver.invalidate(ra.doc);
  const displayName = rb.exports[key].displayName; rb.exports[key].displayName = "NoMatchingComponent";
  check(resolver.resolve(rb.doc) === rb.exports[key], `${key} scoped invalidation preserves another Document's cached native component`);
  rb.exports[key].displayName = displayName;
}
capabilities.setAvailable('hero', true, ra.doc); capabilities.setAvailable('hero', true, rb.doc);
for (let i = 0; i < 3; i++) capabilities.recordFailure('hero', 'realm-a-only', ra.doc);
check(!capabilities.isAvailable('hero', ra.doc) && capabilities.isAvailable('hero', rb.doc), 'One Document circuit breaker never disables another realm');
capabilities.resetCircuitBreakers(ra.doc);
check(!capabilities.isAvailable('hero', ra.doc) && capabilities.isAvailable('hero', rb.doc), 'Scoped capability reset preserves another realm availability');
const rc = realm('resolver-a-next', ra.view); addComponents(rc);
for (const [key, resolver] of resolvers) check(resolver.resolve(rc.doc) === rc.exports[key] && resolver.resolve(ra.doc) === null,
  `${key} rejects an old Document and recaptures the successor runtime`);
check(!capabilities.isAvailable('friends', ra.doc) && capabilities.isAvailable('friends', rc.doc), 'Stale Document capability writes cannot contaminate its successor');

const uiRuntime = load('frontend/steam/gamepad/document-ui-runtime.ts', {
  '../modules/SteamWebpackRuntime': { steamWebpackRuntime: webpack }, './runtime-cache': runtimeCache,
});
function reactFor(label) { return { createElement() {}, useState: () => label, useEffect() {}, useRef() {} }; }
const reactA = reactFor('A'), reactB = reactFor('B');
rc.req.c[63696] = { exports: reactA }; rc.modules.set(63696, reactA);
rb.req.c[63696] = { exports: reactB }; rb.modules.set(63696, reactB);
rc.view.SP_REACT = reactA; rb.view.SP_REACT = reactB;
host.SP_REACT = reactFor('foreign-host');
check(uiRuntime.getDocumentReact(rc.doc) === reactA && uiRuntime.getDocumentReact(rb.doc) === reactB,
  'Independent CEF Documents obtain their exact native React instances');
check(uiRuntime.getDocumentReact(ra.doc) === null && uiRuntime.getDocumentReact(emptyDoc) === null,
  'Stale or missing native React never borrows another Document instance');
const focusA = () => null, focusB = () => null;
rc.view.MILLENNIUM_API = { Focusable: focusA }; rb.view.MILLENNIUM_API = { Focusable: focusB };
check(uiRuntime.resolveNativeFocusable(rc.doc) === focusA && uiRuntime.resolveNativeFocusable(rb.doc) === focusB,
  'Native focus components use the owning CEF client registry');
check(uiRuntime.resolveNativeFocusable(emptyDoc) === null && uiRuntime.resolveNativeFocusable(ra.doc) === null,
  'Missing and stale Documents never inherit host focus components');
function NativeFocus(e) { const {"flow-children":a,onActivate:b,onCancel:c,focusClassName:d,focusWithinClassName:f}=e; return null; }
function NativeModal() { return 'Either closeModal or onCancel should be passed to GenericDialog. Classes: '; }
const modalCalls = [];
function nativeShow(node, parent, title, props, unknown, actions) { const signature = 'props.bDisableBackgroundDismiss'; modalCalls.push({ node, parent, title, props, unknown, actions }); return { Close() {} }; }
rc.req.c['native-ui'] = { exports: { NativeFocus, NativeModal, nativeShow } };
check(uiRuntime.resolveNativeFocusable(rc.doc) === NativeFocus, 'Local native exports take precedence over the client API component');
const modalRuntime = uiRuntime.getDocumentModalRuntime(rc.doc);
check(modalRuntime?.ModalRoot === NativeModal, 'The generic dialog root comes from the owner native modules');
modalRuntime.showModal('owned-node', host, { strTitle: 'Owned', bHideActionIcons: true });
check(modalCalls.length === 1 && modalCalls[0].parent === rc.view && modalCalls[0].title === 'Owned'
  && modalCalls[0].unknown === undefined && modalCalls[0].actions.bHideActions === true,
  'The local showModal wrapper pins the parent Document Window and preserves the native argument contract');
check(uiRuntime.getDocumentModalRuntime(emptyDoc) === null, 'A foreign Document without a modal runtime cannot borrow the plugin host dialog');

const asyncOld = realm('async-post-old'); let finishPost, oldModuleReads = 0;
const originalGetModule = asyncOld.modules.get.bind(asyncOld.modules);
asyncOld.modules.get = key => { if (key === 12975) oldModuleReads++; return originalGetModule(key); };
asyncOld.req.e = () => new Promise(resolve => { finishPost = resolve; });
components.resolveNativePostTextEntryComponent(asyncOld.doc);
const readsBeforeRetirement = oldModuleReads;
const asyncNext = realm('async-post-next', asyncOld.view);
components.resolveNativeFriendsComponent(asyncNext.doc); finishPost();
await Promise.resolve(); await Promise.resolve();
check(oldModuleReads === readsBeforeRetirement, 'A late native component chunk never invokes the retired Document require');

rc.doc.routeId = id; rc.doc.gamepad = true;
let nativeNavigations = 0, foreignNavigations = 0;
rc.modules.set(98765, { oy: { WindowStore: { GetWindowInstanceFromWindow: view => view === rc.view ? { BrowserWindow: view, Navigator: { MyAchievements: target => {
  check(target === id, 'Native navigation receives only the shortcut AppID'); nativeNavigations++;
} } } : null, MainWindowInstance: { Navigator: { MyAchievements: () => foreignNavigations++ } } } } });
rc.req.c[98765] = { exports: rc.modules.get(98765) };
check(!components.openNativeAchievementsScreen(rc.doc, 111) && !components.openNativeAchievementsScreen(ra.doc, id), 'Public and retired achievement destinations are rejected before navigation');
check(components.openNativeAchievementsScreen(rc.doc, id) && nativeNavigations === 1 && foreignNavigations === 0, 'Exact shortcut navigation uses only the owner Window instance');
function navElement(doc, value, modal = false) { return { ownerDocument: doc, isConnected: true,
  contains(target) { return target === this; }, closest: () => modal ? {} : null }; }
function mountNavigation(realm) {
  const { doc, modules, req } = realm;
  const context = { $$typeof: Symbol.for('react.context'), Provider: {} };
  // The navigation owner regression separately uses installed 47428/React.
  // This realm fixture supplies the same complete export/commit contract.
  modules.set(47428, { TJ: context, qp: function qp({ navRef }) { navRef.Tree.RegisterNavigationItem(); },
    sl: function sl() { return { navOptions: {}, gamepadEvents: {} }; } });
  req.c[47428] = { exports: modules.get(47428) };
  const panel = navElement(doc), root = { parentElement: panel, dataset: { gdlShortcutAppId: String(id), gdlSteamAppId: '111' } };
  const node = { Element: panel, Tree: { CreateNode() {}, RegisterNavigationItem() {}, Window: doc.defaultView,
    WindowContext: { RootWindow: doc.defaultView }, SubscribableIsMounted: { Value: true }, Root: { Element: panel } } };
  const host = { tag: 3, stateNode: {}, return: null }; host.stateNode.current = host;
  const provider = { type: context, memoizedProps: { value: node }, return: host };
  panel.__reactFiber$test = { tag: 5, return: provider };
  doc.routeId = String(id); doc.getElementById = () => root;
  return { panel, node };
}
const { panel: panelA, node: navA } = mountNavigation(rc), { panel: panelB, node: navB } = mountNavigation(rb);
rc.doc.querySelector = rb.doc.querySelector = () => null;
check(components.resolveSteamNav(rc.doc)?.navNode === navA && components.resolveSteamNav(rb.doc)?.navNode === navB,
  'Native navigation context is resolved from each Document panel');
rc.doc.getElementById = () => null;
rc.doc.querySelector = selector => selector.includes('.gpfocus') || selector.includes('Focusable') ? panelA : navElement(rc.doc, navB, true);
check(components.resolveSteamNav(rc.doc) === null, 'A foreign modal or globally focused node cannot supply the linked panel navigation context');
const uiNext = realm('ui-next', rc.view);
check(components.resolveSteamNav(rc.doc) === null, 'A retired Document cannot resolve its old navigation context');
assert.throws(() => modalRuntime.showModal('late-node'), /owner Document was replaced/); checks++;
check(modalCalls.length === 1, 'A modal handle retained across Document replacement never invokes the retired native runtime');
components.clearNativeComponentsCache();
console.log(`BP component realms passed: ${checks} checks; production Webpack, resolvers, capabilities, React/UI ownership and scoped restoration.`);
