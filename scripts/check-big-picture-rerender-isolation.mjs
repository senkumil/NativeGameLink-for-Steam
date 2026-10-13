import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let now = 10000, timerId = 0, checks = 0, globalRenders = 0, appStoreReads = 0, detailRefreshes = 0, completePlaytime;
const timers = new Map(), mapped = new Map([[3300000001, '1593500'], [3300000002, '1593500']]);
const check = (condition, message) => { assert(condition, message); checks++; };
const schedule = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; };
function advance(duration) {
  const end = now + duration;
  for (;;) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > end) break;
    const [id, timer] = next; timers.delete(id); now = timer.at; timer.callback();
  }
  now = end;
}
class Overview {
  constructor(appid) {
    this.appid = appid; this.display_name = 'Fixture game';
    this.canonicalAppType = appid >= 2147483648 ? 1073741824 : 1;
    this.local_per_client_data = { installed: false };
    this.minutes_playtime_forever = 5; this.minutes_playtime_last_two_weeks = 2;
  }
  get controller_support() { return 0; }
  BIsShortcut() { return this.appid >= 2147483648; }
  BIsSteamDeckVerified() { return false; }
}
function fixture(appId = 3300000001, gamepad = true) {
  let mode = gamepad;
  const originals = new Map(), renders = [];
  const store = { GetAppData(id) { if (!originals.has(id)) originals.set(id, { details: { unAppID: id } }); return originals.get(id); } };
  const originalGetter = store.GetAppData;
  const doc = {
    hidden: false, routeId: appId, body: { isConnected: true, classList: { contains: value => mode && value === 'GamepadUI' } },
    documentElement: { classList: { contains: () => false } },
    querySelector: selector => selector === '.GamepadUI, .gamepadui' ? mode ? doc.body : null : selector.includes('[role="tab"]') ? { textContent: 'Información' } : doc.detail && selector.includes('PlayBar') ? doc.body : null,
    querySelectorAll: () => [], getElementById: () => null,
  };
  const overview = new Overview(3300000001), native = new Overview(440);
  const view = {
    document: doc, closed: false, appDetailsStore: store, location: {},
    appStore: { m_mapApps: new Map([[overview.appid, overview], [native.appid, native]]) },
    uiStore: { GetActiveWindowInstance: () => ({ LocationPathName: doc.routeId === null ? '/library/home' : `/library/app/${doc.routeId}` }) },
    MILLENNIUM_STEAM_FORCE_RERENDER() { check(this === view, 'A forced refresh keeps the target window receiver'); renders.push({ at: now, appId: doc.routeId }); },
  };
  doc.defaultView = view;
  const setMode = enabled => { mode = enabled; doc.title = enabled ? 'Big Picture' : 'SP Desktop'; view.location.href = enabled ? 'https://steamloopback.host/gamepadui' : 'https://steamloopback.host/library'; };
  setMode(gamepad);
  return { doc, view, store, originalGetter, renders, setMode, overview, native };
}
const desktop = fixture(440, false);
desktop.view.MILLENNIUM_STEAM_FORCE_RERENDER = () => { globalRenders++; };
const sources = {
  ui: 'frontend/steam/ui/SteamUIModeService.ts', route: 'frontend/features/library/native-route.ts',
  patches: 'frontend/core/property-patches.ts', runtime: 'frontend/features/big-picture/runtime.ts',
  scheduler: 'frontend/features/big-picture/rerender-scheduler.ts',
  info: 'frontend/features/big-picture/native-info-bridge.ts',
};
const modules = {};
const mocks = {
  backendLog() {}, subscribePreferences() {}, defaultBigPictureModeEnabled: () => false,
  installBrowserProtection: () => () => {}, disposeBigPictureShortcutDetails() {}, invalidateBigPictureMappedShortcuts() {},
  refreshBigPictureShortcutDetails: async () => { detailRefreshes++; },
  findMappingForTitle: () => null,
  getBigPictureMappedShortcuts: doc => [{ id: doc.defaultView.appStore.m_mapApps.get(3300000001).appid, title: 'Fixture game', steamAppId: '1593500' }],
  collectMappedShortcutApps: store => [...store.m_mapApps.values()],
  getSteamAppStore: doc => { appStoreReads++; return doc.defaultView.appStore; },
  getShortcutAppById: (id, doc) => doc.defaultView.appStore.m_mapApps.get(id), toSignedShortcutAppId: id => id | 0,
  fetchPlaytimeStatsBatch: () => new Promise(resolve => { completePlaytime = resolve; }),
  resolveNativeAppDetailsStore: doc => doc.defaultView.appDetailsStore,
  getCommittedShortcutSteamAppId: id => mapped.get(id) || null, findMappingForShortcut: id => mapped.get(Number(id)) || null,
  isShortcutDismissed: () => false, findNonSteamNotice: () => null,
  PLAYBAR_CLASSES: () => ({}), LINKS_BAR_CLASSES: () => ({}), elementsWithCssModuleClass: () => [],
  isRenderedElement: () => false, committedHeaderAppId: () => null, isPaintedLibraryElement: () => false,
};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = {}; modules[name] = exports;
  const source = fs.readFileSync(sources[name], 'utf8') + (name === 'runtime' ? '\nexport { requestBigPictureRerender };' : '');
  const context = vm.createContext({ exports, URL, window: desktop.view,
    Date: { now: () => now }, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    require: dependency => {
      if (dependency.endsWith('/SteamUIModeService')) return load('ui');
      if (dependency.endsWith('/native-route')) return load('route');
      if (dependency.endsWith('/property-patches')) return load('patches');
      if (dependency.endsWith('/rerender-scheduler')) return load('scheduler');
      return mocks;
    },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return exports;
}
const mode = load('ui').steamUIModeService, route = load('route'), info = load('info'), runtime = load('runtime');
const shortcut = { id: 3300000001, steamAppId: '1593500', title: 'God of War' };
const game = description => ({ name: 'God of War', short_description: description, developers: ['Studio'], publishers: ['Publisher'], categories: [] });
const initial = game('Initial'), updated = game('Updated');
check(!mode.isGamepadUI(desktop.doc), 'The actual UI mode service identifies SP Desktop separately from GamepadUI');
check(route.isPublicSteamLibraryRoute(desktop.doc), 'The actual route resolver identifies the native public destination');
const local = fixture();
check(mode.isGamepadUI(local.doc) && route.routedSteamAppId(local.doc) === shortcut.id, 'The real mode and route helpers identify the target GamepadUI shortcut');
info.activateNativeGameInfoBridge(local.doc, shortcut, initial);
info.activateNativeGameInfoBridge(local.doc, shortcut, updated);
check(timers.size === 1, 'Changed game information schedules one targeted refresh');
advance(40);
check(local.renders.length === 1 && globalRenders === 0, 'Gamepad metadata refreshes only its own window while Desktop remains native');
for (let index = 0; index < 100; index++) info.activateNativeGameInfoBridge(local.doc, shortcut, { ...updated });
advance(40);
check(local.renders.length === 1, 'One hundred identical metadata signals do not refresh either window');
info.deactivateNativeGameInfoBridge(local.doc);

for (const [label, change] of [
  ['native navigation', target => { target.doc.routeId = 440; }],
  ['Desktop transition', target => target.setMode(false)],
  ['document replacement', target => { target.view.document = {}; }],
  ['closed window', target => { target.view.closed = true; }],
  ['hidden document', target => { target.doc.hidden = true; }],
  ['relinked shortcut', () => mapped.set(shortcut.id, '999')],
]) {
  const target = fixture();
  info.activateNativeGameInfoBridge(target.doc, shortcut, initial);
  info.activateNativeGameInfoBridge(target.doc, shortcut, updated);
  change(target); advance(40);
  check(target.renders.length === 0 && globalRenders === 0, `A pending information refresh is rejected after ${label}`);
  info.deactivateNativeGameInfoBridge(target.doc);
  mapped.set(shortcut.id, shortcut.steamAppId);
}
const aba = fixture();
info.activateNativeGameInfoBridge(aba.doc, shortcut, initial);
info.activateNativeGameInfoBridge(aba.doc, shortcut, updated);
const oldCallback = [...timers.values()][0].callback;
info.deactivateNativeGameInfoBridge(aba.doc);
info.activateNativeGameInfoBridge(aba.doc, shortcut, updated);
oldCallback(); advance(40);
check(aba.renders.length === 0, 'An old information callback never regains authority after leaving and returning to the same game');
info.deactivateNativeGameInfoBridge(aba.doc);
for (const target of [fixture(shortcut.id, false), fixture(440, true)]) {
  info.activateNativeGameInfoBridge(target.doc, shortcut, initial);
  check(target.store.GetAppData === target.originalGetter && timers.size === 0, 'Desktop and public-native destinations never install the information store bridge');
}

const earlyDesktop = fixture(440, false), shortcutMethod = Overview.prototype.BIsShortcut;
const controllerGetter = Object.getOwnPropertyDescriptor(Overview.prototype, 'controller_support').get;
mode.handleModeNumberChange(4);
check(mode.getState().isGamepadUI && !mode.isGamepadUI(earlyDesktop.doc), 'A global GamepadUI signal can precede the actual Desktop surface transition');
runtime.activateBigPicture(earlyDesktop.doc);
await runtime.refreshBigPicture(earlyDesktop.doc);
runtime.mergeShortcutsIntoBigPictureLibrary(earlyDesktop.doc);
await runtime.patchBigPictureHomePlaytime(earlyDesktop.doc);
check(!runtime.isBigPictureActive() && runtime.getBigPictureDocument() === null, 'A premature global mode signal cannot adopt the Desktop document');
check(appStoreReads === 0 && detailRefreshes === 0, 'Rejected Desktop adoption never reads model candidates or refreshes Big Picture details');
check(Overview.prototype.BIsShortcut === shortcutMethod && Object.getOwnPropertyDescriptor(Overview.prototype, 'controller_support').get === controllerGetter,
  'Rejected Desktop entry leaves shared overview prototypes and controller getters intact');
check(earlyDesktop.overview.BIsShortcut() && earlyDesktop.overview.canonicalAppType === 1073741824 && earlyDesktop.overview.controller_support === 0,
  'A linked shortcut in the Desktop store retains its native classification and metadata');

const adopted = fixture(shortcut.id);
adopted.doc.detail = true;
runtime.activateBigPicture(adopted.doc);
await runtime.refreshBigPicture(adopted.doc);
check(runtime.isBigPictureActive() && runtime.getBigPictureDocument() === adopted.doc && detailRefreshes === 1 && appStoreReads === 1,
  'A subsequent real GamepadUI document is adopted and refreshed normally');
check(!adopted.overview.BIsShortcut() && adopted.overview.controller_support === 2 && adopted.native.controller_support === 0,
  'Validated GamepadUI entry still applies linked shortcut shims while native models retain their original behavior');
const readsBeforeWrongDocument = appStoreReads, detailsBeforeWrongDocument = detailRefreshes;
runtime.activateBigPicture(earlyDesktop.doc);
await runtime.refreshBigPicture(earlyDesktop.doc);
check(runtime.getBigPictureDocument() === adopted.doc && appStoreReads === readsBeforeWrongDocument && detailRefreshes === detailsBeforeWrongDocument,
  'A later Desktop callback cannot replace the adopted GamepadUI session or refresh either model store');
runtime.deactivateBigPicture();
check(Overview.prototype.BIsShortcut === shortcutMethod && Object.getOwnPropertyDescriptor(Overview.prototype, 'controller_support').get === controllerGetter,
  'Leaving the valid GamepadUI session restores its shared prototype descriptors exactly');

const lateDesktop = fixture(null);
runtime.activateBigPicture(lateDesktop.doc);
const latePlaytime = runtime.patchBigPictureHomePlaytime(lateDesktop.doc);
lateDesktop.setMode(false);
completePlaytime(new Map([[shortcut.id, { minutesForever: 999 }]]));
await latePlaytime;
check(lateDesktop.overview.minutes_playtime_forever === 5 && lateDesktop.renders.length === 0,
  'A pending GamepadUI playtime response cannot mutate or redraw a document whose surface already returned to Desktop');
runtime.deactivateBigPicture();

const home = fixture(null);
runtime.activateBigPicture(home.doc); runtime.requestBigPictureRerender(home.doc);
check(home.renders.length === 1 && globalRenders === 0, 'An active GamepadUI Home refresh stays in its own document');
runtime.requestBigPictureRerender(home.doc);
home.doc.routeId = 440; advance(1500);
check(home.renders.length === 1, 'A throttled Home refresh cannot redraw a subsequently selected native game');
runtime.requestBigPictureRerender(home.doc); advance(1500);
check(home.renders.length === 1 && timers.size === 0, 'A public native game cannot schedule a Big Picture refresh');
home.doc.routeId = null; home.setMode(false);
runtime.requestBigPictureRerender(home.doc); advance(1500);
check(home.renders.length === 1, 'Returning the active window to Desktop blocks forced refreshes');
home.setMode(true);
runtime.requestBigPictureRerender(home.doc);
const beforeOtherWindow = home.renders.length;
runtime.requestBigPictureRerender(home.doc);
const other = fixture(null);
runtime.activateBigPicture(other.doc); advance(1500);
check(home.renders.length === beforeOtherWindow && other.renders.length === 0, 'Changing the active GamepadUI document invalidates the previous window callback');
runtime.requestBigPictureRerender(other.doc);
runtime.requestBigPictureRerender(other.doc);
const beforeExit = other.renders.length;
runtime.deactivateBigPicture(); advance(2000);
runtime.restoreBigPictureShortcutState(); advance(2000);
check(other.renders.length === beforeExit && globalRenders === 0 && timers.size === 0, 'Exit, restoration and cleared timers never force a Desktop or cross-window redraw');
check(globalRenders === 0, 'The global Desktop refresh callback was never invoked in any scenario');
console.log(`Big Picture rerender isolation passed: ${checks} assertions using real UI mode/route helpers, native/Desktop boundaries and both actual rerender paths.`);
