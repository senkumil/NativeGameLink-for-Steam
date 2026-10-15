import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0, now = 1000;
const check = (condition, message) => { assert(condition, message); checks++; };
class Target {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0); }
}
function element(doc, id = '') {
  const attributes = new Map(), classes = new Set();
  return {
    id, ownerDocument: doc, isConnected: true, hidden: false, dataset: {}, style: { display: '' },
    parentElement: null, clicks: 0, removals: 0,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    contains(other) { for (let node = other; node; node = node.parentElement) if (node === this) return true; return false; },
    matches: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [],
    click() { this.clicks++; }, remove() { this.removals++; this.isConnected = false; },
    focus() { doc.activeElement = this; }, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }),
  };
}
const owner = new Target(), doc = new Target();
const elements = new Map(), timers = new Map(), frames = new Map();
let serial = 0, pads = [], mode = true, explicitRoute = true, modals = [], layoutReads = 0;
let context = { type: 'shortcut-linked', identity: { shortcutAppId: 3000000001, steamAppId: 1790600 } };
Object.assign(owner, { closed: false, document: doc, navigator: { getGamepads: () => pads },
  getComputedStyle: target => ({ display: target.style.display || 'block', visibility: target.style.visibility || 'visible' }) });
Object.assign(doc, { defaultView: owner, hidden: false,
  getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => modals });
doc.body = element(doc, 'body'); doc.documentElement = element(doc, 'html');
const root = element(doc, 'gdl-bp-detail-root'); root.parentElement = doc.body;
root.dataset.gdlShortcutAppId = '3000000001'; root.dataset.gdlSteamAppId = '1790600'; elements.set(root.id, root);
doc.activeElement = doc.body;
const clock = {
  setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
  clearTimeout: id => timers.delete(id),
  requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => frames.delete(id),
};
Object.assign(owner, clock);
const service = { isGamepadUI: () => mode };
const dependencies = {
  '../../steam/gamepad/components/AppDetailsNativeClasses': { resolveNativeAppDetailsClasses: () => ({}), FALLBACK_FOCUS_RING_CLASSES: {} },
  '../../steam/gamepad/GamepadContext': { isCurrentLinkedGamepadTarget: (targetDoc, shortcut, steam) => {
    const rawId = Number(shortcut);
    return targetDoc === doc && explicitRoute && context.type === 'shortcut-linked'
      && Number.isInteger(rawId) && rawId >= -2147483648 && rawId <= 4294967295 && (rawId >>> 0) >= 2147483648
      && (rawId >>> 0) === context.identity?.shortcutAppId && Number(steam) === context.identity?.steamAppId;
  } },
  '../../steam/ui/SteamUIModeService': { steamUIModeService: service },
  '../../steam/gamepad/virtual-keyboard': { hideSteamVirtualKeyboard: () => true },
  './editable-target': { EXIT_TEXT_EDITOR_EVENT: 'fixture-exit-editor', isEditableTextTarget: () => false },
  './spatial-navigation': { collectFocusableLayout: () => { layoutReads++; return []; }, chooseSpatialTarget: () => null, firstSpatialTarget: () => null,
    isGamepadFocusableElement: target => Boolean(target?.isConnected) },
};
const sandbox = vm.createContext({ exports: {}, window: owner, Date: { now: () => now }, ...clock,
  CustomEvent: class { constructor(type) { this.type = type; } },
  require: name => { assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; } });
const modules = new Map();
function loadProductionModule(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {}; modules.set(name, exports);
  const source = ts.transpileModule(fs.readFileSync(`frontend/features/big-picture/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInContext(`(function (exports, require) { ${source}\n})`, sandbox)(exports, dependency => {
    if (dependency === './navigation-session') return loadProductionModule('navigation-session');
    if (dependency === './native-focus') return loadProductionModule('native-focus');
    if (dependency === './modal-actions') return loadProductionModule('modal-actions');
    assert(dependency in dependencies, `Unexpected dependency: ${dependency}`); return dependencies[dependency];
  });
  return exports;
}
sandbox.exports = loadProductionModule('gamepad-nav');
const { isNonSteamActive: active, installBigPictureGamepadNavigation: install, disposeBigPictureGamepadNavigation: dispose } = sandbox.exports;
check(active(doc), 'An exact live linked GamepadUI pair authorizes navigation');
check(!active(null), 'A missing document cannot authorize navigation');
explicitRoute = false;
check(!active(doc), 'A linked heading, store or DOM marker without an explicit linked route cannot authorize input');
explicitRoute = true;
for (const state of [
  { type: 'steam', steamAppId: 1790600 }, { type: 'shortcut-unlinked', shortcutAppId: 3000000001 }, { type: 'none' },
  { type: 'shortcut-linked', identity: { shortcutAppId: 3000000002, steamAppId: 1790600 } },
  { type: 'shortcut-linked', identity: { shortcutAppId: 3000000001, steamAppId: 49520 } },
]) {
  const previous = context; context = state;
  check(!active(doc), 'A connected stale root cannot authorize a native, unlinked, unknown or mismatched destination'); context = previous;
}
mode = false; check(!active(doc), 'Desktop mode cannot use a leftover Big Picture root'); mode = true;
root.hidden = true; check(!active(doc), 'A layout-inert hidden root cannot authorize fallback navigation'); root.hidden = false;
root.isConnected = false; check(!active(doc), 'A detached root cannot authorize navigation'); root.isConnected = true;
owner.closed = true; check(!active(doc), 'A retired CEF window cannot authorize navigation'); owner.closed = false;
owner.document = {}; check(!active(doc), 'A replaced document cannot borrow the previous CEF authority'); owner.document = doc;
doc.body.isConnected = false; check(!active(doc), 'A retired document body cannot authorize navigation'); doc.body.isConnected = true;
root.dataset.gdlShortcutAppId = '1790600'; check(!active(doc), 'A public AppID cannot masquerade as a linked shortcut root');
root.dataset.gdlShortcutAppId = String(3000000001 | 0);
check(active(doc), 'A valid signed shortcut normalizes to its exact unsigned identity'); root.dataset.gdlShortcutAppId = '3000000001';
const modeAPI = service.isGamepadUI; delete service.isGamepadUI;
check(active(doc), 'Without the optional mode API, exact live shortcut authority is still required'); service.isGamepadUI = modeAPI;

function tabs() {
  const strip = element(doc), controls = new Map();
  for (const key of ['activity', 'stuff', 'community', 'info']) {
    const control = element(doc); control.parentElement = strip;
    control.setAttribute('aria-selected', key === 'activity' ? 'true' : 'false');
    control.click = () => { control.clicks++; for (const candidate of controls.values()) candidate.setAttribute('aria-selected', String(candidate === control)); };
    controls.set(key, control);
  }
  strip.contains = candidate => [...controls.values()].includes(candidate);
  strip.querySelector = () => [...controls.values()].find(control => control.getAttribute('aria-selected') === 'true') || null;
  return { strip, controls };
}
function key(value) {
  const event = { key: value, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } };
  doc.fire('keydown', event); return event;
}
function poll() {
  const next = [...timers][0]; assert(next, 'A polling callback must be pending');
  timers.delete(next[0]); next[1].callback();
}
const initial = tabs(); install(doc, root, initial.strip, initial.controls);
check(timers.size === 1 && doc.listenerCount === 4 && owner.listenerCount === 2, 'A valid session owns one poll and its scoped listeners');
const initialTimer = [...timers.values()][0].callback;
const sameControls = new Map(initial.controls); install(doc, root, initial.strip, sameControls);
check(timers.size === 1 && [...timers.values()][0].callback === initialTimer, 'An equivalent Map of the same live controls does not duplicate navigation');
key('e'); check(initial.controls.get('stuff').clicks === 1, 'The initial tab controls receive the keyboard tab action once');
now += 400;
const replaced = tabs(); install(doc, root, replaced.strip, replaced.controls);
check(timers.size === 1 && [...timers.values()][0].callback !== initialTimer, 'Replacing a tab strip under the same root retires the old closure');
initialTimer(); check(timers.size === 1, 'A retired poll callback cannot start another engine on the still-connected root');
key('e');
check(replaced.controls.get('stuff').clicks === 1 && initial.controls.get('stuff').clicks === 1,
  'After replacement, keyboard actions reach only the current strip');
now += 400;
const replacedChild = element(doc); replacedChild.parentElement = replaced.strip;
replacedChild.setAttribute('aria-selected', 'false');
const childControls = new Map(replaced.controls); childControls.set('community', replacedChild);
install(doc, root, replaced.strip, childControls); key('e');
check(replacedChild.clicks === 1 && replaced.controls.get('community').clicks === 0,
  'Replacing a control under the same strip also retires captured child references');

const foreign = element(doc, 'steam-native-dialog'); foreign.parentElement = doc.body; modals = [foreign];
const beforeForeignClicks = [...childControls.values()].reduce((count, control) => count + control.clicks, 0);
now += 400;
for (const value of ['Escape', 'Enter', 'ArrowDown', 'q', 'e', 'PageUp', 'PageDown']) {
  const event = key(value);
  check(event.prevented === 0 && event.stopped === 0, 'A visible Steam-owned modal retains keyboard events unchanged');
}
const beforeForeignReads = layoutReads;
pads = [{ connected: true, buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: [0, 1, 4, 5].includes(index) })), axes: [] }];
poll();
check(foreign.removals === 0 && foreign.clicks === 0 && layoutReads === beforeForeignReads,
  'A/B/bumpers do not click, remove or spatially navigate a Steam modal');
check([...childControls.values()].reduce((count, control) => count + control.clicks, 0) === beforeForeignClicks,
  'Foreign-modal input cannot change background linked tabs');
modals = []; now += 400; poll();
check([...childControls.values()].reduce((count, control) => count + control.clicks, 0) === beforeForeignClicks,
  'Held buttons observed in a Steam modal cannot replay as delayed actions when it closes');
pads = [];

const own = element(doc, 'gdl-bp-news-modal'); own.parentElement = doc.body;
const close = element(doc); own.querySelector = () => close;
elements.set(own.id, own); modals = [own]; now += 400;
const ownedBack = key('Escape');
check(close.clicks === 1 && ownedBack.prevented === 1 && own.removals === 0, 'Back still closes an explicitly plugin-owned modal through its own close action');
elements.delete(own.id); modals = [];
const linkedContext = context;
context = { type: 'steam', steamAppId: 1790600 }; poll();
check(timers.size === 0 && key('e').prevented === 0, 'Losing linked authority stops polling and leaves native input untouched');
context = linkedContext;
install(doc, root, replaced.strip, childControls);
check(timers.size === 1, 'Revalidating the same root restarts an engine whose poll stopped during a context gap');
const pending = [...timers.values()].map(task => task.callback);
dispose(doc); dispose(doc);
check(timers.size === 0 && doc.listenerCount === 0 && owner.listenerCount === 0, 'Teardown is idempotent and releases its poll and listeners');
for (const callback of pending) callback();
check(timers.size === 0, 'Callbacks delivered after teardown cannot restart navigation');
context = { type: 'steam', steamAppId: 1790600 };
install(doc, root, replaced.strip, childControls);
check(timers.size === 0 && doc.listenerCount === 0 && owner.listenerCount === 0, 'A native game with stale plugin DOM cannot install an input engine');
console.log(`Big Picture navigation ownership passed: ${checks} checks; exact linked authority, untouched native modals, live strip/control replacement and retired callback cleanup. No Steam calls.`);
