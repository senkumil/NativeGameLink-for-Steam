// Steam's installed Focusable, hook/context core, navigation node, handle and
// logical gamepad event modules with the production linked-page input gateway.
// The navigation controller/Steam account backend are inert fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const self = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self });
const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const ids = [38850, 47428, 93046, 54654, 92393, 74562, 96485, 20505];
const nativeSources = Object.fromEntries(ids.map(id => {
  assert.equal(typeof factories[id], 'function', `Installed native navigation module ${id} exists`);
  return [id, String(factories[id])];
}));
assert(nativeSources[47428].includes('navRef:') && nativeSources[47428].includes('RegisterNavigationItem(')
  && nativeSources[47428].includes('.CreateHandle()'), 'Installed Focusable publishes a registered native handle via navRef');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sources = {
  'native-focus': transpile('frontend/features/big-picture/native-focus.ts'),
  'native-focus-oracle': `exports.factories=${JSON.stringify(nativeSources)};`,
};

await runBPBrowserScenario(sources, async fixture => {
  const { React, ReactDOM, dom, req, load, dependencies, root, A, frame, check } = fixture;
  const source = load('native-focus-oracle').factories;
  const modules = {}, compiled = Object.fromEntries(Object.entries(source).map(([id, text]) => [id, new Function(`return (${text})`)()]));
  class Callbacks {
    callbacks = new Set();
    Register(callback) { this.callbacks.add(callback); return { Unregister: () => this.callbacks.delete(callback) }; }
    Dispatch(...args) { for (const callback of [...this.callbacks]) callback(...args); }
  }
  const scalar = initial => {
    let value = initial;
    const callbacks = new Set();
    return { get Value() { return value; }, Set(next) {
      if (next === value) return false;
      value = next; for (const callback of [...callbacks]) callback(value); return true;
    }, Subscribe(callback) { callbacks.add(callback); return { Unsubscribe: () => callbacks.delete(callback) }; } };
  };
  const assignRef = (ref, value) => { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value; };
  const mergedRefs = (...refs) => React.useCallback(value => { for (const ref of refs) assignRef(ref, value); }, refs);
  const bound = (_target, key, descriptor) => ({ configurable: true, get() {
    const value = descriptor.value.bind(this); Object.defineProperty(this, key, { configurable: true, value }); return value;
  } });
  const log = class { Debug() {} IsDebugEnabled() { return false; } };
  const deps = {
    63696: React, 62540: req(62540),
    43310: { l: Callbacks }, 3493: { wT: (condition, message) => { if (!condition) throw Error(message); }, z_: () => {} },
    81919: { o: bound }, 26756: { bZ: () => 0 }, 81133: { xr: { x: 'y', y: 'x' } },
    6460: { Jc: scalar }, 1574: { wd: log },
    85456: { e: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    48294: { e: () => null },
    84719: { QE: element => element.getBoundingClientRect(), Pl() {}, ZQ() {} },
    34699: { Ue: mergedRefs, cZ: assignRef },
    4452: (...values) => values.filter(Boolean).join(' '),
    50789: { gc(value) {
      return React.useSyncExternalStore(callback => value.Subscribe(callback).Unsubscribe, () => value.Value, () => value.Value);
    } },
    67758: { eZ: { PlayNavSound() {} }, PN: {} }, 57575: { kD: () => false }, 91974: {}, 33787: {},
    23569: { bJ: () => true },
    2469: { qR: () => ({ bActiveTree: true, bActiveTreeWithinContext: true, bDisableFocusClasses: false, bIsMounted: true }) },
  };
  const nativeReq = id => {
    if (id in deps) return deps[id];
    if (modules[id]) return modules[id].exports;
    if (!compiled[id]) throw Error(`Unexpected native Focusable dependency ${id}`);
    const module = modules[id] = { exports: {} }; compiled[id](module, module.exports, nativeReq); return module.exports;
  };
  Object.assign(nativeReq, { d: req.d, n: req.n, r: req.r, o: req.o });
  const NativeFocusable = nativeReq(38850).Z;
  const { TJ: NavContext, sQ: RingContext } = nativeReq(47428);
  const NativeNode = nativeReq(74562).Bp;
  const { CZ: focusRing } = nativeReq(92393);
  const registrations = new Set(), focusTransfers = [], actions = [];
  let focused = null;
  const tree = {
    Window: window, WindowContext: { RootWindow: window }, SubscribableIsMounted: { Value: true },
    Controller: { GetShowDebugFocusRing: () => ({ Value: false }) },
    BUseVirtualFocus: () => false, BIsActiveFocus: () => true, BIsActive: () => true,
    GetParentEmbeddedNavTree: () => null, GetLastFocusedNode: () => focused,
    OnChildActivated() {},
    DeferredFocus: { BIsQueuedFocusNode: () => false, BHasQueuedFocusNode: () => false, RequestFocus() {} },
    CreateNode(parent, ring) { return new NativeNode(this, parent, ring); },
    RegisterNavigationItem(node, element) {
      check(element?.ownerDocument === document, 'Installed navigation hook registers its node in the exact owner document');
      registrations.add(node); node.OnMount(element);
      return () => { registrations.delete(node); node.OnUnmount(); };
    },
    TransferFocus(source, node, button) {
      if (focused === node) return true;
      if (focused) { focused.SetHasFocus(false); for (let item = focused; item; item = item.Parent) item.SetFocusWithin(false); }
      focused = node;
      if (node) {
        node.SetHasFocus(true); for (let item = node; item; item = item.Parent) item.SetFocusWithin(true);
        node.UpdateParentActiveChild(); node.Element.focus({ preventScroll: true }); focusTransfers.push([source, node, button]);
      }
      return true;
    },
  };
  tree.Root = new NativeNode(tree, null, focusRing);
  tree.Root.SetProperties({ layout: 1 }); tree.Root.OnMount(document.body);
  const panel = document.createElement('section'); panel.style.minHeight = '320px';
  root.parentElement.insertBefore(panel, root); panel.appendChild(root);
  const parent = new NativeNode(tree, tree.Root, focusRing); parent.SetProperties({ layout: 1 }); parent.OnMount(panel);
  const strip = document.getElementById('tabs');
  const stripRoot = ReactDOM.createRoot(strip);
  let tabHandle = null, ownHandle = null, nativeParentEscapes = 0;
  const realRuntime = load('document-ui-runtime');
  dependencies['../../steam/gamepad/document-ui-runtime'] = { ...realRuntime, getDocumentUIComponents: () => ({ Focusable: NativeFocusable }) };
  const { NativeFocusable: OwnerFocusable, BigPictureUIProvider } = load('document-primitives');
  let measurements = 0;
  const nativeRing = { OnFocus() {}, OnBlur() {}, OnFocusChange() {}, OnForceMeasureFocusRing() { measurements++; } };
  dom.flushSync(() => stripRoot.render(React.createElement(NavContext.Provider, { value: tree.Root },
    React.createElement(NativeFocusable, { role: 'tab', id: 'native-focus-tab', focusable: true,
      'aria-selected': true, navRef: handle => { tabHandle = handle; } }, 'Actividad'))));
  const tab = document.getElementById('native-focus-tab'), controls = new Map([['activity', tab]]);
  const nav = load('navigation');
  const nativeFocus = load('native-focus');
  const emit = (target, type, button) => {
    const event = new CustomEvent(type, { bubbles: true, cancelable: true, detail: { button, source: 1, is_repeat: false } });
    target.dispatchEvent(event); return event;
  };
  const options = () => ({ authority: 'native', generation: 1, panel, nativeNavNode: parent, nativeNavHandle: ownHandle });
  let release = nav.installBigPictureGamepadNavigation(document, root, strip, controls, options());
  check(nav.getBigPictureNavigationAuthority(document) !== 'native', 'A parent native node alone cannot claim native authority before the added root registers');
  release();
  const contentRoot = ReactDOM.createRoot(root);
  dom.flushSync(() => contentRoot.render(React.createElement(BigPictureUIProvider, { document },
    React.createElement(RingContext.Provider, { value: nativeRing }, React.createElement(NavContext.Provider, { value: parent },
    React.createElement(NativeFocusable, { 'flow-children': 'column', focusable: false, navRef: handle => { ownHandle = handle; },
      onCancelButton: () => nav.returnBigPictureFocusToTabs(document) },
    React.createElement(OwnerFocusable, { id: 'owned-native-card-1', focusable: true,
      onClick: () => { if (!load('context').isCurrentLinkedGamepadTarget(document, A, '550')) return false; actions.push('first'); return true; } }, 'First linked card'),
    React.createElement(NativeFocusable, { id: 'owned-native-card-2', focusable: true,
      onActivate: () => { if (!load('context').isCurrentLinkedGamepadTarget(document, A, '550')) return false; actions.push('second'); return true; } }, 'Second linked card')))))));
  await frame();
  const ownNode = nativeFocus.getMountedBigPictureNavNode(document, root, parent, ownHandle);
  check(ownNode && ownNode.Parent === parent && ownNode.Tree === tree && root.contains(ownNode.Element),
    'Installed Focusable navRef contains its actually mounted child node in the native parent tree');
  ownNode.ForceMeasureFocusRing();
  check(measurements === 1, 'The separately mounted native node preserves Steam focus-ring callbacks instead of the default no-op ring');
  release = nav.installBigPictureGamepadNavigation(document, root, strip, controls, options());
  check(nav.getBigPictureNavigationAuthority(document) === 'native', 'Native authority starts only after the installed hook publishes its registered handle');
  const onNativeEscape = event => {
    nativeParentEscapes++;
    // Model the original Steam page accepting its own input after a route
    // change. Its replacement tree is outside this inert account fixture.
    if (!load('context').isCurrentLinkedGamepadTarget(document, A, '550')) event.stopPropagation();
  }; strip.addEventListener('vgp_ondirection', onNativeEscape);
  tabHandle.TakeFocus(10); await frame();
  const firstDown = emit(tab, 'vgp_ondirection', 10); await frame();
  check(firstDown.defaultPrevented && root.contains(document.activeElement) && document.activeElement.id === 'owned-native-card-1'
    && nativeParentEscapes === 0, 'Controller Down enters the added content through the installed native handle exactly once');
  const select = emit(document.activeElement, 'vgp_onok', 1);
  check(select.defaultPrevented && actions.join(',') === 'first', 'Installed native logical OK activates the focused linked card once');
  const secondDown = emit(document.activeElement, 'vgp_ondirection', 10); await frame();
  check(secondDown.defaultPrevented && document.activeElement.id === 'owned-native-card-2',
    'Steam native node navigation continues from the first added card to the second card');
  check(emit(document.activeElement, 'vgp_oncancel', 2).defaultPrevented, 'The added native root handles Back only when return to the native tabs succeeds');
  await frame();
  check(document.activeElement === tab && tree.GetLastFocusedNode() === tabHandle.Node(),
    'Back restores both browser focus and the real native navigation tree focus to the original tab');
  check(emit(tab, 'vgp_onok', 1).defaultPrevented, 'Controller OK on the native tab can enter the ready added content');
  await frame();
  const retainedHandle = ownHandle;
  const outside = document.createElement('div'); panel.appendChild(outside);
  const sibling = new NativeNode(tree, parent, focusRing); sibling.SetProperties({ focusable: true }); sibling.OnMount(outside);
  check(!nativeFocus.getMountedBigPictureNavNode(document, root, parent, sibling.CreateHandle()),
    'A real native sibling node outside the added root cannot replace its registered handle');
  window.g_Router.history.location.pathname = '/routes/library/app/550';
  tabHandle.TakeFocus(10); await frame();
  const nativeDown = emit(tab, 'vgp_ondirection', 10); await frame();
  check(!nativeDown.defaultPrevented && document.activeElement === tab && actions.length === 1,
    'A native game route leaves the original tab input untouched and cannot enter stale linked content');
  check(nav.getBigPictureNavigationAuthority(document) === 'none' && nativeParentEscapes === 1,
    'A mounted handle confers no linked input authority on a public native game route');
  release(); strip.removeEventListener('vgp_ondirection', onNativeEscape);
  dom.flushSync(() => contentRoot.unmount());
  check(ownHandle === null && !retainedHandle.Node().BTakeFocus(0, 10), 'Native Focusable unmount clears navRef and its retired node cannot take focus');
  sibling.OnUnmount(); outside.remove(); parent.OnUnmount();
  dom.flushSync(() => stripRoot.unmount()); tree.Root.OnUnmount();
  await frame();
  check(registrations.size === 0 && !root.querySelector('.Panel') && fixture.observerCount() === 0,
    'All installed native child nodes, observers and input gateway resources release on teardown');
  check(!focusTransfers.some(([, node]) => node.Element?.ownerDocument !== document),
    'Every actual native focus transition remains in the owning document');
  return { label: 'Big Picture installed native focus registration', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: React.version };
});
