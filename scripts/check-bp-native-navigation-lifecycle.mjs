// The production React component's hooks with a deterministic local renderer.
// No Steam, controller or account APIs are invoked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const file = fs.readFileSync('frontend/features/big-picture/NativeBigPictureDetails.tsx', 'utf8');
const start = file.indexOf('export function NativeBigPictureDetails(');
const end = file.indexOf('export interface ReactRootHandle', start);
assert(start >= 0 && end > start, 'The production component is present');
const code = ts.transpileModule(file.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;

const timers = new Map(), observers = new Set(), frames = new Map(), subscriptions = new Set(); let serial = 0, updates = 0;
const view = { closed: false,
  setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); },
  MutationObserver: class {
    active = true; targets = [];
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.active = false; observers.delete(this); }
  },
};
const root = { isConnected: true, dataset: { gdlShortcutAppId: '3000000001', gdlSteamAppId: '1790600', gdlBpGeneration: '1' } };
const parent = { isConnected: true }, panel = { isConnected: true, parentElement: parent };
root.parentElement = panel;
let strip = { isConnected: true, parentElement: parent }, controls = new Map([['activity', {}], ['stuff', {}], ['community', {}], ['info', {}]]);
const doc = { defaultView: view, getElementById: () => root, querySelector: () => strip };
view.document = doc;
root.ownerDocument = doc;
const registeredElement = { isConnected: true, ownerDocument: doc };
root.contains = element => element === registeredElement;
const subscribe = callback => { const entry = { callback }; subscriptions.add(entry); return () => subscriptions.delete(entry); };
function nativeParent() {
  return { Tree: { CreateNode() {}, Window: view, WindowContext: { RootWindow: view },
    Root: { Element: { isConnected: true, ownerDocument: doc } }, SubscribableIsMounted: { Value: true },
    OnActiveStateChangedCallbacks: { Register(callback) { return { Unregister: subscribe(callback) }; } },
    Controller: { NavigationSourceSupportsFocus: { Subscribe(callback) { return { Unsubscribe: subscribe(callback) }; } } } } };
}
function mountedHandle(parent) {
  const node = { Parent: parent, Tree: parent.Tree, Element: registeredElement, BTakeFocus: () => true };
  return { Node: () => node, NavTree: () => parent.Tree };
}
let runtimeIdentity = {}, navContext = { Provider: 'NativeNavProvider' }, configContext = { Provider: 'NativeConfigProvider' };
let localFocusable = 'Focusable';
let nav = { navContext, navNode: nativeParent(), providers: [] }, currentInstall = null, installations = 0, cleanups = 0;
let semanticHandled = true;
let committed = 0, back = 0, x = 0, y = 0, bumper = 0;
let cursor = 0, pending = [], slots = [];
const schedule = (callback, deps, kind) => {
  const index = cursor++, previous = slots[index];
  const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length
    || deps.some((value, offset) => value !== previous.deps[offset]);
  if (changed) pending.push({ index, callback, deps, kind });
};
const React = {
  useState(value) {
    const index = cursor++; slots[index] ||= { value };
    return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; updates++; }];
  },
  useLayoutEffect: (callback, deps) => schedule(callback, deps, 'layout'),
  useEffect: (callback, deps) => schedule(callback, deps, 'effect'),
  useCallback(callback, deps) {
    const index = cursor++, previous = slots[index];
    if (!previous || deps.some((value, offset) => value !== previous.deps[offset])) slots[index] = { value: callback, deps };
    return slots[index].value;
  },
  useMemo(compute, deps) {
    const index = cursor++, previous = slots[index];
    if (!previous || deps.some((value, offset) => value !== previous.deps[offset])) slots[index] = { value: compute(), deps };
    return slots[index].value;
  },
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
};
const sandbox = vm.createContext({ exports: {}, React,
  backendLog() {},
  getCachedLocalAchievementsForShortcut: () => null,
  NativeFocusable: 'Focusable', NativeDetailsBoundary: 'Boundary', SafeTabFallback: 'Fallback',
  BigPictureUIProvider: 'DocumentUIProvider',
  ActivityTab: 'Activity', StuffTab: 'Stuff', CommunityTab: 'Community', InformationTab: 'Info',
  nativeClasses: (...values) => values.filter(Boolean).join(' '),
  resolveNativeAppDetailsClasses: () => ({}),
  getDocumentReact: () => React, resolveNativeFocusable: () => localFocusable,
  steamWebpackRuntime: { getRuntimeIdentity: () => runtimeIdentity },
  resolveSteamNav: () => nav, getNavContext: () => navContext,
  resolveNativeConfigContext: () => configContext,
  findBigPictureTabStrip: () => ({ strip, controls }),
  isBigPictureActionCurrent: owner => root.isConnected
    && String(owner.shortcut.id) === root.dataset.gdlShortcutAppId
    && String(owner.shortcut.steamAppId) === root.dataset.gdlSteamAppId
    && String(owner.generation) === root.dataset.gdlBpGeneration,
  installBigPictureGamepadNavigation(_doc, _root, _strip, _controls, options) {
    check(currentInstall === null, 'React retires the previous engine before installing its replacement');
    const instance = { ...options }; currentInstall = instance; installations++;
    return () => { if (currentInstall === instance) { currentInstall = null; cleanups++; } };
  },
  returnBigPictureFocusToTabs: () => { back++; return true; },
  performBigPictureSemanticAction: (_doc, action) => { if (!semanticHandled) return false; if (action === 'x') x++; else y++; return true; },
  switchBigPictureNativeTab: () => { bumper++; return true; },
});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/big-picture/native-focus.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, sandbox);
sandbox.getMountedBigPictureNavNode = sandbox.exports.getMountedBigPictureNavNode;
vm.runInContext(code, sandbox);
const component = sandbox.exports.NativeBigPictureDetails;
let props = { tab: 'activity', shortcut: { id: 3000000001, steamAppId: 1790600 }, data: {}, hydrating: false,
  document: doc, panel, generation: 1, onCommitted: () => committed++ };
function render(value = props, commit = true) {
  cursor = 0; pending = []; const element = component(value);
  if (commit) flush(); return element;
}
function flush() {
  for (const kind of ['layout', 'effect']) for (const task of pending.filter(task => task.kind === kind)) {
    slots[task.index]?.cleanup?.();
    slots[task.index] = { deps: task.deps, cleanup: task.callback() };
  }
  pending = [];
}
function focusable(element) {
  if (element.type === 'Focusable' || element.type === 'div') return element;
  for (const child of element.children || []) if (child && typeof child === 'object') {
    const found = focusable(child); if (found) return found;
  }
  return null;
}
function event(button, repeat = false) {
  return { detail: { button, is_repeat: repeat }, defaultPrevented: false, stopped: 0,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped++; } };
}
try {
  let element = render(props, false);
  check(committed === 0 && currentInstall === null, 'A queued React render neither hides Steam content nor installs input');
  flush();
  check(committed === 1 && currentInstall.authority === 'none',
    'A parent navigation context cannot claim native authority before our own node registers');
  focusable(element).props.navRef(mountedHandle(nav.navNode)); element = render();
  check(currentInstall.authority === 'native' && currentInstall.nativeNavNode === nav.navNode,
    'Native authority requires our mounted handle in the exact parent tree and document');
  check(subscriptions.size === 2, 'The current tree and controller source have one readiness subscription each');
  check(timers.size === 3 && observers.size === 1, 'Readiness detection uses three bounded probes and one local observer');
  check([...observers][0].targets.every(item => item.options.childList && (!item.options.subtree || item.target === strip)),
    'Readiness limits subtree observation to native tab controls and observes the panel directly');
  const handlers = focusable(element).props;
  handlers.onCancelButton(event()); handlers.onSecondaryButton(event()); handlers.onOptionsButton(event());
  handlers.onButtonDown(event(5)); handlers.onButtonDown(event(6, true));
  check(back === 1 && x === 1 && y === 1 && bumper === 1, 'Native B/X/Y/bumpers invoke one semantic action and ignore repeats');
  semanticHandled = false;
  const unhandled = event();
  check(handlers.onSecondaryButton(unhandled) === false && !unhandled.defaultPrevented,
    'An unavailable X action returns false so Steam can continue bubbling the logical event');
  semanticHandled = true;
  for (const { callback } of subscriptions) callback();
  check(frames.size === 1, 'Native source and active-tree changes coalesce into one post-commit context refresh');
  for (const [id, callback] of frames) { frames.delete(id); callback(); }

  const unchangedContent = focusable(element).children[0];
  const before = installations; const unchangedRender = render();
  check(focusable(unchangedRender).children[0] === unchangedContent,
    'Navigation-only shell updates reuse the tab content instead of rebuilding every achievement and card');
  check(installations === before, 'A stable render does not recreate the navigation engine');
  strip = { isConnected: true, parentElement: parent }; render();
  check(installations === before + 1, 'Replacing the native tab strip reinstalls captured input controls in the same panel/tree');
  controls = new Map(controls); controls.set('stuff', {}); render();
  check(installations === before + 2, 'Replacing one child control also retires the previous input closure');
  runtimeIdentity = {}; nav = { navContext, navNode: nativeParent(), providers: [] }; element = render();
  check(installations === before + 3 && currentInstall.nativeNavNode === nav.navNode,
    'A replacement Webpack runtime/navigation node replaces the provider and input session');
  check(currentInstall.authority === 'none' && subscriptions.size === 2,
    'An old own-node handle cannot take authority in a replacement tree and retired subscriptions are removed');
  focusable(element).props.navRef(mountedHandle(nav.navNode)); render();
  localFocusable = null; render();
  check(currentInstall.authority === 'fallback', 'A native tree without a Focusable from this document selects fallback');
  localFocusable = 'Focusable'; render();
  nav = null; element = render();
  check(currentInstall.authority === 'fallback', 'Losing the native tree selects fallback on the next commit');
  const inactiveHandlers = focusable(element).props;
  check(!inactiveHandlers.onCancelButton && !inactiveHandlers.onButtonDown && back === 1 && bumper === 1,
    'Fallback mode installs no second set of native callbacks');
  panel.isConnected = false; render();
  check(currentInstall.authority === 'none', 'A retired panel owns no navigation engine');
  panel.isConnected = true; nav = { navContext, navNode: nativeParent(), providers: [] };

  const retired = [];
  for (let index = 0; index < 120; index++) {
    retired.push(...[...timers.values()].map(task => task.callback));
    props = { ...props, generation: props.generation + 1,
      shortcut: { id: 3000000001 + index % 2, steamAppId: index % 2 ? 49520 : 1790600 } };
    root.dataset.gdlShortcutAppId = String(props.shortcut.id); root.dataset.gdlSteamAppId = String(props.shortcut.steamAppId);
    root.dataset.gdlBpGeneration = String(props.generation);
    render();
    assert.equal(timers.size, 3); assert.equal(observers.size, 1);
  }
  check(true, 'One hundred twenty component route generations retain only bounded current probes/observer');
  const beforeStale = updates;
  for (const callback of retired) callback();
  check(updates === beforeStale, 'Disposed readiness callbacks cannot rerender a later route generation');
  handlers.onCancelButton(event()); handlers.onSecondaryButton(event()); handlers.onButtonDown(event(6));
  check(back === 1 && x === 1 && bumper === 1, 'Retired native component callbacks cannot act on another route/generation');
  for (const slot of slots) slot?.cleanup?.();
  check(currentInstall === null && timers.size === 0 && observers.size === 0 && subscriptions.size === 0 && frames.size === 0 && installations === cleanups,
    'Unmount retires every input session, readiness timer and local observer');
  console.log(`Big Picture native navigation lifecycle passed: ${checks} checks; production hooks, native/fallback/none transitions, post-commit visibility and 120 generations. No Steam calls.`);
} finally { for (const slot of slots) slot?.cleanup?.(); }
