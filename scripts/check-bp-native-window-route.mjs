// Native GamepadUI owns its route through WindowStore or its local tempNavStore,
// even when the CEF URL remains /gamepadui and no g_Router/uiStore is published.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { nativeWindowOracle } from './helpers/native-window-oracle.mjs';

let checks = 0, mappingReads = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const shortcut = 3000000001, sibling = 3000000002, appid = 3357650;
const oracle = nativeWindowOracle(), installedTabs = oracle.tabIds;
check(installedTabs.includes('WhatsNew') && installedTabs.includes('Community') && installedTabs.includes('YourStuff') && installedTabs.includes('GameInfo'),
  'Native tab IDs come from the installed Steam definitions, including WhatsNew for Activity');
const instances = [], windowStore = { SteamUIWindows: instances, GetWindowInstanceFromWindow: oracle.lookup };
const nativeReads = [];
let verified = true, clock = Date.now();
const registry = new Map(), loaded = new Map();
const dependencies = {
  '../../core/text': { normalizeTitle: value => String(value).toLowerCase() },
  '../shortcuts': {
    getMappedShortcuts: () => { mappingReads++; return [
      { id: shortcut, steamAppId: String(appid), title: 'PRAGMATA' },
      { id: sibling, steamAppId: String(appid), title: 'PRAGMATA second installation' },
    ]; },
    getShortcutAppById: id => ({ appid: id, display_name: 'PRAGMATA' }),
    looseMatchTitle: (a, b) => a === b, toSignedShortcutAppId: id => id | 0,
  },
  '../../core/mappings': {
    mappings: { [`shortcut:${shortcut}`]: String(appid), [`shortcut:${sibling}`]: String(appid) },
    shortcutMappingKey: id => `shortcut:${id}`, isMappingSnapshotVerified: () => verified, findMappingForTitle: () => String(appid),
  },
};
const context = vm.createContext({ console, Date: class extends Date { static now() { return clock; } } });
function load(file) {
  const absolute = path.resolve(file);
  if (loaded.has(absolute)) return loaded.get(absolute);
  const module = { exports: {} }; loaded.set(absolute, module.exports);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(name => {
    if (name in dependencies) return dependencies[name];
    if (name === '@steambrew/client') return { modules: registry };
    if (name.endsWith('/api/backend')) return { backendLog() {} };
    const dependency = path.resolve(path.dirname(absolute), name + '.ts');
    assert(fs.existsSync(dependency), `Unexpected ${file} dependency ${name}`);
    return load(dependency);
  }, module, module.exports);
  loaded.set(absolute, module.exports); return module.exports;
}
const runtime = load('frontend/steam/modules/SteamWebpackRuntime.ts').steamWebpackRuntime;
const nativeGetRequire = runtime.getRequire.bind(runtime);
runtime.getRequire = doc => { nativeReads.push(doc); return nativeGetRequire(doc); };
const { resolveActiveGameContext: resolve, isCurrentLinkedGamepadTarget: owns, collectActiveRouteValues: routes } = load('frontend/steam/gamepad/GamepadContext.ts');
function fixture(path) {
  const doc = { body: { isConnected: true }, URL: 'https://steamloopback.host/gamepadui',
    querySelector: () => null, querySelectorAll: () => [] };
  const view = { closed: false, document: doc, location: { pathname: '/gamepadui', href: doc.URL, hash: '' },
    addEventListener() {}, removeEventListener() {} };
  doc.defaultView = view;
  const instance = { BrowserWindow: view, LocationPathName: path };
  instances.push(instance);
  const exports = { oy: { WindowStore: windowStore } }, executed = [];
  const factory = module => { module.exports = exports; };
  factory.toString = () => oracle.factorySource;
  const req = id => { assert.equal(String(id), oracle.id, 'Only the installed semantic WindowStore factory can initialize'); executed.push(String(id)); return exports; };
  req.m = { [oracle.id]: factory };
  const chunk = { push: payload => payload[2](req) }; view.webpackChunksteamui = chunk;
  return { doc, view, instance, req, chunk, executed };
}
const other = fixture(`/library/app/${sibling}`), current = fixture(`/library/app/${shortcut}/tab/activity`);
check(!current.view.g_Router && !current.view.uiStore && current.view.location.pathname === '/gamepadui',
  'The fixture has the real shell URL and no invented router/store globals');
check(routes(current.doc)[0] === current.instance.LocationPathName, 'The owning native WindowInstance supplies the first authoritative route');
check(resolve(current.doc).identity?.canonicalId === `${shortcut}:${appid}` && owns(current.doc, shortcut, appid),
  'WindowStore-only PRAGMATA details resolves and authorizes the exact committed shortcut/metadata pair');
for (const tab of [...new Set([...installedTabs, 'Activity'])]) {
  for (const prefix of ['/library/app/', '/routes/library/app/', 'https://steamloopback.host/library/app/']) {
    current.instance.LocationPathName = `${prefix}${shortcut}/tab/${tab}`;
    check(resolve(current.doc).identity?.canonicalId === `${shortcut}:${appid}` && owns(current.doc, shortcut, appid),
      'Native tab suffixes stay inside their exact root AppDetails owner');
  }
}
for (const destination of [`/store/library/app/${shortcut}/tab/Community`, `/routes/store/library/app/${shortcut}/Activity`,
  `https://steamloopback.host/store/library/app/${shortcut}/tab/Community`, `/library/home?appid=${shortcut}`,
  `/store?redirect=/library/app/${shortcut}/Community`, `/store?appid=${shortcut}`]) {
  current.instance.LocationPathName = destination;
  check(resolve(current.doc).type === 'none' && !owns(current.doc, shortcut, appid),
    'Store/Home paths cannot disguise a nested shortcut path or AppID query as root AppDetails');
}
current.instance.LocationPathName = `/library/app/${shortcut}/tab/Activity`;
check(!owns(current.doc, sibling, appid), 'Another installation sharing metadata cannot borrow this window route');
const readsBefore = mappingReads;
for (let index = 0; index < 100; index++) check(owns(current.doc, shortcut, appid), 'Repeated ownership stays exact');
check(mappingReads === readsBefore, 'Native route checks do not enumerate the mapped library on input ticks');
check(nativeReads.every(doc => doc === current.doc), 'Every runtime lookup uses the requested Document');

let activeReads = 0;
current.view.uiStore = { GetActiveWindowInstance() { activeReads++; return other.instance; } };
current.view.g_Router = { history: { location: { pathname: `/library/app/${sibling}` } } };
check(owns(current.doc, shortcut, appid) && activeReads === 0,
  'A different active Steam window and stale global router cannot override this native WindowInstance');
for (const destination of ['/library/home', '/library/all', '/library/collections/1', '/store', '/settings']) {
  current.instance.LocationPathName = `${destination}?appid=${shortcut}`;
  check(resolve(current.doc).type === 'none' && !owns(current.doc, shortcut, appid),
    'A native non-details destination revokes old router/shortcut/query evidence');
}
for (const nativeId of [550, 105600, appid]) {
  current.instance.LocationPathName = `/library/app/${nativeId}/tab/Community`;
  check(resolve(current.doc).type === 'steam' && resolve(current.doc).steamAppId === nativeId
    && !owns(current.doc, shortcut, appid), 'Public native games keep exclusive ownership even beside a linked shortcut route');
}
current.instance.LocationPathName = `/library/app/${shortcut | 0}/tab/activity`;
check(owns(current.doc, shortcut | 0, appid), 'The native signed shortcut representation normalizes to the same committed owner');
current.instance.LocationPathName = '/library/app/4294967296';
check(resolve(current.doc).type === 'none' && !owns(current.doc, shortcut, appid), 'An out-of-range native route cannot wrap into a linked shortcut');

delete current.view.g_Router; delete current.view.uiStore;
delete current.view.webpackChunksteamui; runtime.invalidate(current.doc);
check(!owns(current.doc, shortcut, appid), 'An unavailable native route plus shell-only URL never borrows another Window route');
current.view.webpackChunksteamui = current.chunk; clock += 600;
current.instance.LocationPathName = `/library/app/${shortcut}`;
check(owns(current.doc, shortcut, appid), 'A native bootstrap arriving after a shell-only first probe restores the exact owner route without manual capture');
delete current.view.webpackChunksteamui; runtime.invalidate(current.doc);
current.view.SteamUIStore = { WindowStore: windowStore };
check(owns(current.doc, shortcut, appid), 'The native owner-global SteamUIStore supplies its exact WindowInstance without a webpack hint');
current.instance.LocationPathName = `/library/app/${sibling}/tab/Community`;
check(!owns(current.doc, shortcut, appid) && owns(current.doc, sibling, appid), 'A to sibling route switches authority even when both installations share metadata');
current.instance.LocationPathName = `/library/app/${shortcut}/tab/WhatsNew`;
check(owns(current.doc, shortcut, appid) && !owns(current.doc, sibling, appid), 'Returning A restores only its current exact owner and rejects the sibling pair');
verified = false;
check(!owns(current.doc, shortcut, appid), 'A native route cannot authorize an unverified mapping snapshot');
verified = true;
for (const mutate of [() => { current.view.closed = true; }, () => { current.view.document = {}; }, () => { current.doc.body.isConnected = false; }]) {
  mutate(); check(!owns(current.doc, shortcut, appid) && resolve(current.doc).type === 'none', 'A retired native Window/Document/body loses all route authority');
  current.view.closed = false; current.view.document = current.doc; current.doc.body.isConnected = true;
}
windowStore.GetWindowInstanceFromWindow = () => other.instance;
check(!owns(current.doc, shortcut, appid), 'A broken native lookup returning a different BrowserWindow cannot authorize this Document');
windowStore.GetWindowInstanceFromWindow = () => ({ LocationPathName: `/library/app/${shortcut}` });
check(!owns(current.doc, shortcut, appid), 'An unbound native instance without this exact BrowserWindow cannot authorize input');

function navFixture(route) {
  const doc = { body: { isConnected: true }, URL: 'https://steamloopback.host/gamepadui',
    querySelector: () => null, querySelectorAll: () => [] };
  const view = { closed: false, document: doc, location: { pathname: '/gamepadui', href: doc.URL, hash: '' },
    addEventListener() {}, removeEventListener() {}, tempNavStore: {} };
  doc.defaultView = view;
  const navigate = pathname => {
    const location = { pathname, search: '', hash: '' };
    // Execute only Steam's installed pure UpdateRoutingInfo method. There is
    // no WindowStore, Webpack factory export, app heading or invented router.
    oracle.updateRoutingInfo.call(view.tempNavStore, { location }, location);
  };
  navigate(route);
  return { doc, view, navigate };
}
check(oracle.navFactorySource.includes('window.tempNavStore=')
  && oracle.navFactorySource.includes('UpdateRoutingInfo('),
  'NavStore regression uses the actual installed local singleton contract');
const nav = navFixture(`/library/app/${shortcut}/tab/WhatsNew`);
check(!nav.view.SteamUIStore && !nav.view.uiStore && !nav.view.g_Router && !nav.view.webpackChunksteamui,
  'NavStore-only fixture has no WindowInstance or alternative route source');
check(routes(nav.doc)[0] === `/library/app/${shortcut}/tab/WhatsNew`,
  'Steam local tempNavStore publishes the current exact route before the shell URL');
check(resolve(nav.doc).identity?.canonicalId === `${shortcut}:${appid}` && owns(nav.doc, shortcut, appid),
  'Local NavStore-only details resolves and authorizes the exact linked pair');
for (const tab of installedTabs) {
  nav.navigate(`/library/app/${shortcut}/tab/${tab}`);
  check(owns(nav.doc, shortcut, appid), 'Actual native NavStore tab navigation retains exact details ownership');
}
for (const nativeId of [550, 105600, appid]) {
  nav.navigate(`/library/app/${nativeId}/tab/Community`);
  check(resolve(nav.doc).type === 'steam' && resolve(nav.doc).steamAppId === nativeId
    && !owns(nav.doc, shortcut, appid), 'Local NavStore preserves exclusive public native game ownership');
}
nav.view.g_Router = { history: { location: { pathname: `/library/app/${shortcut}` } } };
for (const destination of ['/library/home', '/library/all', '/library/collections/1', '/store', '/settings']) {
  nav.navigate(`${destination}?appid=${shortcut}`);
  check(resolve(nav.doc).type === 'none' && !owns(nav.doc, shortcut, appid),
    'Local native Home/Store navigation revokes a stale shortcut in guessed globals');
}
delete nav.view.g_Router;
nav.navigate(`/library/app/${sibling}/tab/YourStuff`);
check(!owns(nav.doc, shortcut, appid) && owns(nav.doc, sibling, appid),
  'Local NavStore A-to-sibling navigation switches exact authority despite shared metadata');
nav.navigate(`/library/app/${shortcut}/tab/WhatsNew`);
check(owns(nav.doc, shortcut, appid) && !owns(nav.doc, sibling, appid),
  'Local NavStore return to A rejects the stale sibling pair');
const noRoute = navFixture('/gamepadui');
delete noRoute.view.tempNavStore;
noRoute.view.parent = nav.view; noRoute.view.opener = nav.view;
check(!owns(noRoute.doc, shortcut, appid) && resolve(noRoute.doc).type === 'none',
  'A sibling CEF document cannot borrow parent/opener tempNavStore routes');
nav.view.tempNavStore.m_history.location.pathname = '/library/home';
check(!owns(nav.doc, shortcut, appid) && resolve(nav.doc).type === 'none',
  'Live native history outranks the cached pathname while the React routing effect is pending');
nav.navigate(`/library/app/${shortcut}`);
verified = false;
check(!owns(nav.doc, shortcut, appid), 'Local NavStore cannot authorize an unverified mapping snapshot');
verified = true;
for (const mutate of [() => { nav.view.closed = true; }, () => { nav.view.document = {}; }, () => { nav.doc.body.isConnected = false; }]) {
  mutate(); check(!owns(nav.doc, shortcut, appid) && resolve(nav.doc).type === 'none',
    'A closed/replaced/disconnected NavStore document loses route authority');
  nav.view.closed = false; nav.view.document = nav.doc; nav.doc.body.isConnected = true;
}
console.log(`Big Picture native window routes passed: ${checks} checks; installed semantic WindowStore ${oracle.id} and NavStore ${oracle.navStoreId}, actual private-cache bootstrap, local routing contract, exact ownership and native/other-window isolation. No Steam APIs invoked.`);
