import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
class Target {
  listeners = new Map();
  closed = false;
  addEventListener(type, callback) {
    let callbacks = this.listeners.get(type);
    if (!callbacks) this.listeners.set(type, callbacks = new Set());
    callbacks.add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
const ps5 = { eControllerType: 45, strName: 'DualSense', bConnected: true };
const xbox = { eControllerType: 32, strName: 'Xbox', bConnected: true };
function fixture({ background, controllers, pads = [], input, overview = null, metadata = null, scopedOverview } = {}) {
  const root = new Target(), owner = new Target();
  const timers = new Map(), intervals = new Map();
  let serial = 0, reads = 0, globalOverviewReads = 0, removals = 0;
  const clock = {
    setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { const id = ++serial; intervals.set(id, { callback, delay }); return id; },
    clearInterval: id => intervals.delete(id),
  };
  root.navigator = { getGamepads: () => [] };
  owner.navigator = { getGamepads: () => pads };
  Object.assign(root, clock); Object.assign(owner, clock);
  if (background !== undefined) root.ControllerStore = { GetControllers: () => background };
  if (controllers !== undefined) owner.ControllerStore = { GetControllers: () => { reads++; return controllers; } };
  if (input) owner.SteamClient = { Input: input };
  if (scopedOverview !== undefined) owner.appStore = { GetAppOverviewByAppID: () => scopedOverview };
  const doc = { defaultView: owner, querySelectorAll: () => [{ remove: () => { removals++; } }] };
  const deps = {
    '../../api/backend': { backendLog() {} }, '../../core/text': { escapeHtml: String },
    '../../core/game-data': { getCachedGameData: () => metadata ? { data: metadata } : null },
    '../../steam/gamepad/stores/AppStoreAdapter': { AppStoreAdapter: {
      getAppOverview: () => { globalOverviewReads++; return overview; },
    } },
    '../../steam/localization': { gdlText: (_key, text) => text, loc: (_key, text) => text, steamLanguageSync: () => 'english' },
    './styles/controller': {}, './layout': {},
    '../../steam/modules/SteamModuleResolver': { getSteamStore: () => null },
    '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRequire: () => root, getAllModules: () => [] } },
    '../../steam/library-sidebar': {}, '../../core/dom': {},
    '../../steam/sidebar-interaction': { isLibrarySidebarInteractionActive: () => false }, './controller-svgs': {},
    '../achievements/navigation': { linkedAchievementTarget: () => ({ steamAppId: '10', shortcutAppId: '3000000000' }) },
    '../../steam/library-details': { committedHeaderAppId: () => null },
    './sidebar-order': { getLinkedSidebarOrder: () => null, hasLinkedSidebarOrder: () => false, publishLinkedSidebarSection: () => false },
  };
  const context = vm.createContext({ exports: {}, require: name => {
    assert(name in deps, `Unexpected controller dependency: ${name}`); return deps[name];
  }, window: root, navigator: root.navigator, ...clock });
  vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/controller.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return { controller: context.exports, doc, root, owner, timers, intervals,
    reads: () => reads, globalOverviewReads: () => globalOverviewReads, removals: () => removals };
}

let f = fixture({ background: [], controllers: [ps5] });
equal(f.controller.detectConnectedController(f.doc).connected, true, 'The visible Steam document wins over a disconnected background store');
equal(f.controller.detectConnectedController(f.doc).type, 'dualsense', 'Native DualSense type 45 is retained');
f = fixture({ background: [ps5], controllers: [] });
equal(f.controller.detectConnectedController(f.doc).connected, false, 'An authoritative disconnected owner store wins over another realm');
f = fixture({ controllers: [], pads: [{ connected: true, id: 'DualSense', timestamp: 1 }] });
equal(f.controller.detectConnectedController(f.doc).connected, false, 'Steam disconnected state does not resurrect a stale Chromium gamepad');
f = fixture({ input: { GetControllers: () => Promise.resolve([]) }, pads: [{ connected: true, id: 'Sony DualSense', timestamp: 1 }] });
equal(f.controller.detectConnectedController(f.doc).type, 'dualsense', 'A promise-returning Input API permits the available synchronous browser fallback');
f = fixture({ input: { GetControllers: () => Promise.reject(Error('unavailable')) }, pads: [{ connected: true, id: 'Unknown HID', timestamp: 1 }] });
equal(f.controller.detectConnectedController(f.doc).type, 'generic', 'Unknown HID models are not silently classified as Xbox');
await Promise.resolve(); await Promise.resolve();
f = fixture({ pads: [{ connected: true, id: 'Wireless Controller (Vendor: 054c Product: 09cc)', timestamp: 1 }] });
equal(f.controller.detectConnectedController(f.doc).type, 'dualshock', 'The known DualShock product ID remains distinct from DualSense');
f = fixture({ controllers: [{ ...ps5, eControllerType: 48 }] });
equal(f.controller.detectConnectedController(f.doc).type, 'dualsense', 'Native DualSense Edge type 48 is recognized');
equal(f.controller.isSteamControllerConnected({ ...ps5, bConnected: false }), false, 'Explicitly disconnected native records are ignored');

const firstList = [ps5, xbox];
f = fixture({ controllers: firstList });
equal(f.controller.detectConnectedController(f.doc).type, 'dualsense', 'The first document selects its first connected device');
const second = new Target(); second.ControllerStore = { GetControllers: () => [xbox, ps5] };
equal(f.controller.detectConnectedController({ defaultView: second }).type, 'xbox', 'A second Steam document has its own primary controller');
firstList.splice(0, firstList.length, xbox, ps5);
equal(f.controller.detectConnectedController(f.doc).type, 'dualsense', 'Another document and a list reorder do not steal the first document primary');

for (const [device, field] of [['xbox', 'xbox_controller_support'], ['dualshock', 'ps4_controller_support'], ['dualsense', 'ps5_controller_support']]) {
  for (const [level, expected] of [[1, 'partial'], [2, 'supported']]) {
    f = fixture({ overview: { xbox_controller_support: 0, ps4_controller_support: 0, ps5_controller_support: 0, [field]: level } });
    equal(f.controller.detectGameControllerSupportState('10', device, f.doc), expected, `Native ${device} support level ${level} retains its actual state`);
  }
}
f = fixture({ overview: { xbox_controller_support: 0, ps4_controller_support: 0, ps5_controller_support: 0 } });
equal(f.controller.detectGameControllerSupportState('10', 'xbox', f.doc), 'unsupported', 'An explicit absence of native controller support is unsupported');
equal(f.controller.detectGameControllerSupport('10', f.doc).xbox, false, 'No-support metadata never fabricates Xbox compatibility');
f = fixture({ overview: { xbox_controller_support: 2, ps4_controller_support: 0, ps5_controller_support: 0 } });
equal(f.controller.detectGameControllerSupportState('10', 'dualsense', f.doc), 'unknown', 'Xbox support alone does not declare DualSense unsupported or supported');
for (const [device, category] of [['xbox', 18], ['dualshock', 56], ['dualsense', 58]]) {
  f = fixture({ metadata: { categories: [{ id: category }] } });
  equal(f.controller.detectGameControllerSupportState('10', device, f.doc), 'partial', `Store partial category ${category} remains partial`);
}
f = fixture({ metadata: { controller_support: 'none', categories: [] } });
equal(f.controller.detectGameControllerSupportState('10', 'dualsense', f.doc), 'unsupported', 'Explicit no-controller Store metadata is respected');
f = fixture({ metadata: { controller_support: 'partial', categories: [] } });
equal(f.controller.detectGameControllerSupportState('10', 'xbox', f.doc), 'partial', 'The Store partial-support field remains partial');
f = fixture();
for (const appid of ['10', '49520', '1030300']) {
  equal(f.controller.detectGameControllerSupportState(appid, 'xbox', f.doc), 'unknown', 'Missing metadata stays unknown even for formerly hardcoded games');
}
f = fixture({ overview: { ps5_controller_support: 2 }, scopedOverview: { ps5_controller_support: 1 } });
equal(f.controller.detectGameControllerSupportState('10', 'dualsense', f.doc), 'partial', 'Support reads the target document AppOverview');
equal(f.globalOverviewReads(), 0, 'A target document store avoids a foreign global AppOverview');
f = fixture({ overview: { ps5_controller_support: 2 }, scopedOverview: null });
equal(f.controller.detectGameControllerSupportState('10', 'dualsense', f.doc), 'unknown', 'A missing owner record does not borrow an unrelated realm record');
f = fixture({ overview: { xbox_controller_support: 0, ps4_controller_support: 0, ps5_controller_support: 0 }, metadata: { controller_support: 'full', categories: [{ id: 57 }] } });
equal(f.controller.detectGameControllerSupportState('10', 'dualsense', f.doc), 'unsupported', 'Explicit native levels take precedence over cached Store support');

const connected = [ps5], nativeCallbacks = [], changed = [];
let unregisters = 0;
f = fixture({ controllers: connected, input: { RegisterForControllerListChanges(callback) {
  nativeCallbacks.push(callback); return { unregister: () => unregisters++ };
} } });
const stop = f.controller.subscribeControllerChanges(f.doc, info => changed.push(info));
equal(f.intervals.size, 1, 'One watchdog checks power-down state without duplicate polling');
equal([...f.intervals.values()][0].delay, 250, 'The watchdog uses a bounded quarter-second cadence');
f.owner.fire('gamepadconnected'); f.owner.fire('gamepadconnected');
equal(f.timers.size, 3, 'Repeated device events share one bounded settling batch');
equal(changed.length, 0, 'Repeated unchanged device events do not rerender the card');
connected.length = 0; f.owner.fire('gamepaddisconnected', { gamepad: { id: 'DualSense' } });
equal(changed.length, 1, 'A real disconnect publishes exactly one state change');
equal(changed[0].connected, false, 'The disconnect publishes the actual native state');
equal(f.removals(), 0, 'Device observation never removes a route-owned DOM card itself');
const oldHandlers = [...f.owner.listeners.values()].flatMap(callbacks => [...callbacks]);
const oldRetries = [...f.timers.values()].map(timer => timer.callback);
stop(); stop();
equal(f.timers.size + f.intervals.size, 0, 'Disposal cancels every settling callback and poll timer');
equal(f.owner.listenerCount + f.root.listenerCount, 0, 'Disposal removes event listeners from every observed realm');
equal(unregisters, 1, 'Native subscriptions unregister once under repeated disposal');
const readsBefore = f.reads(); connected.push(ps5);
for (const callback of [...oldHandlers, ...oldRetries, ...nativeCallbacks]) callback({ gamepad: { id: 'DualSense' } });
equal(f.reads(), readsBefore, 'Already queued old event, retry and native callbacks cannot read after disposal');
equal(changed.length, 1, 'An old document subscription cannot repaint a later game');
equal(f.timers.size + f.removals(), 0, 'Late callbacks cannot schedule retries or delete the next game card');
let functionCleanup = 0;
f = fixture({ controllers: [ps5], input: { RegisterForControllerListChanges() { return () => functionCleanup++; } } });
const stopFunction = f.controller.subscribeControllerChanges(f.doc, () => {});
stopFunction(); stopFunction();
equal(functionCleanup, 1, 'Function-shaped native unsubscribe handles are also retired exactly once');
console.log(`Controller runtime passed: ${checks} assertions; document isolation, device identification, native/Store support levels and disposed event/poll callbacks.`);
