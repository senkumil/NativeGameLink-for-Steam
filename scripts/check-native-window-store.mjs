// Execute the production resolver with the installed factory's source contract;
// only fixture stores initialize. No account, SDK or native store calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { nativeWindowOracle } from './helpers/native-window-oracle.mjs';

const oracle = nativeWindowOracle();
let checks = 0, reads = 0;
const check = (value, message) => { assert(value, message); checks++; };
const runtimes = new WeakMap();
const runtime = {
  getRuntimeIdentity: doc => { reads++; return runtimes.get(doc)?.identity || null; },
  getAllModules: doc => runtimes.get(doc)?.modules || [],
  getRequire: doc => runtimes.get(doc)?.req || null,
  getModuleFactoryCount: doc => Object.keys(runtimes.get(doc)?.req?.m || {}).length,
  getModuleFactories: doc => Object.entries(runtimes.get(doc)?.req?.m || {}).map(([id, factory]) => ({ id, factory })),
};
const context = vm.createContext({ exports: {}, require: () => ({ steamWebpackRuntime: runtime }) });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/native-window-store.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { getNativeWindowInstance: instance, getNativeWindowStore: storeFor } = context.exports;
function fixture() {
  const doc = { body: { isConnected: true } }, view = { document: doc, closed: false };
  doc.defaultView = view;
  const owners = new WeakMap(), store = { GetWindowInstanceFromWindow: view => owners.get(view),
    MainWindowInstance: { BrowserWindow: {} }, GamepadUIMainWindowInstance: { BrowserWindow: {} } };
  const own = { BrowserWindow: view, LocationPathName: '/library/app/3000000001', IsMainGamepadUIWindow: () => true };
  owners.set(view, own);
  const state = { identity: {}, modules: [], calls: [], dependenciesReady: true };
  const factory = module => { module.exports = { oy: { WindowStore: store } }; };
  factory.toString = () => oracle.factorySource;
  const req = id => {
    state.calls.push(String(id));
    assert.equal(String(id), oracle.id, 'Only the semantically selected owner factory can execute');
    if (!state.dependenciesReady) throw Error('Native dependency chunk pending');
    return { oy: { WindowStore: store } };
  };
  req.m = { [oracle.id]: factory, unrelated() { throw Error('Unrelated account store must never initialize'); } };
  state.req = req; runtimes.set(doc, state);
  return { doc, view, owners, store, own, state };
}
const a = fixture(), b = fixture();
check(instance(a.doc) === a.own && a.state.calls.length === 1, 'Installed semantic factory resolves its exact owning Window instance');
for (let i = 0; i < 100; i++) check(instance(a.doc) === a.own, 'Warm owner lookups remain exact');
check(a.state.calls.length === 1, 'One hundred warm calls never initialize more native factories');
check(instance(b.doc) === b.own && instance(a.doc) === a.own, 'Separate CEF Documents retain separate owner stores');
a.owners.set(a.view, b.own);
check(instance(a.doc) === null && storeFor(a.doc) === null, 'A cached store returning another Window never authorizes this Document');
a.owners.set(a.view, a.own);
check(instance(a.doc) === a.own, 'A corrected native instance becomes visible without reinstalling its factory');
a.view.document = b.doc;
check(instance(a.doc) === null, 'A same-Window Document replacement revokes the old owner immediately');
a.view.document = a.doc; a.view.closed = true;
check(instance(a.doc) === null, 'Closed CEF Windows cannot resolve an owner');
a.view.closed = false;
const global = fixture(); global.view.SteamUIStore = { WindowStore: global.store };
const before = reads;
check(instance(global.doc) === global.own && storeFor(global.doc) === global.store && reads === before,
  'A local owner-global can resolve before any Webpack bootstrap or scan');
const cached = fixture(); cached.state.req = null;
cached.state.modules = [{ id: 'arbitrary-client-module', exports: { WindowStore: cached.store } }];
check(instance(cached.doc) === cached.own, 'Already-loaded exports resolve by their API rather than their module ID');
const late = fixture(); late.state.dependenciesReady = false;
check(instance(late.doc) === null, 'A missing native dependency remains unavailable');
for (let i = 0; i < 100; i++) check(instance(late.doc) === null, 'Repeated missing-dependency checks stay bounded');
check(late.state.calls.length === 1, 'A missing factory is not executed repeatedly on input ticks');
late.state.dependenciesReady = true; late.state.req.m.lateChunk = () => {};
check(instance(late.doc) === late.own && late.state.calls.length === 2, 'A newly loaded dependency chunk retries only the matching native factory');
const keyboardEvents = [];
for (const owner of [a, b]) owner.own.VirtualKeyboardManager = {
  ShowVirtualKeyboard(target) { keyboardEvents.push([owner.doc, target, 'show']); },
  SetVirtualKeyboardHidden() { keyboardEvents.push([owner.doc, null, 'hide']); },
};
const keyboardContext = vm.createContext({ exports: {}, require: name => {
  if (name === '../native-window-store') return context.exports;
  if (name === '../modules/SteamWebpackRuntime') return { steamWebpackRuntime: { ...runtime, captureRuntime() {} } };
  if (name === '../localization') return { loc: (_key, fallback) => fallback };
  return { backendLog() {} };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/virtual-keyboard.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, keyboardContext);
const keyboard = keyboardContext.exports, inputA = {}, inputB = {};
check(keyboard.showSteamVirtualKeyboard(a.doc, inputA) && keyboard.showSteamVirtualKeyboard(a.doc, inputA)
  && keyboardEvents.length === 1 && keyboardEvents[0][0] === a.doc, 'The semantic owner keyboard opens once for repeated activation in its own CEF');
check(keyboard.showSteamVirtualKeyboard(b.doc, inputB) && keyboardEvents[1][0] === b.doc, 'Another CEF opens only its own native keyboard manager');
check(keyboard.hideSteamVirtualKeyboard(a.doc) && keyboardEvents.at(-1)[0] === a.doc && keyboardEvents.at(-1)[2] === 'hide', 'Keyboard dismissal stays in the originating CEF');
check(keyboard.showSteamVirtualKeyboard(a.doc, inputA) && keyboardEvents.at(-1)[2] === 'show' && keyboardEvents.length === 4,
  'Closing and reopening the same editor immediately starts a fresh keyboard request');
const previousManager = a.own.VirtualKeyboardManager;
a.own.VirtualKeyboardManager = {
  ShowVirtualKeyboard(target) { keyboardEvents.push([a.doc, target, 'replacement-show']); },
};
check(keyboard.showSteamVirtualKeyboard(a.doc, inputA) && keyboardEvents.at(-1)[2] === 'replacement-show',
  'A replacement manager in the same runtime bypasses old handle and debounce caches');
const parentMessages = [];
a.view.postMessage = payload => parentMessages.push(payload);
check(keyboard.hideSteamVirtualKeyboard(a.doc) && parentMessages.at(-1)?.message === 'HideVirtualKeyboard',
  'A manager without a hide method uses the native parent-message dismissal fallback');
a.owners.delete(a.view);
const beforeRevocation = keyboardEvents.length;
check(keyboard.showSteamVirtualKeyboard(a.doc, inputA) && keyboardEvents.length === beforeRevocation
  && parentMessages.at(-1)?.message === 'ShowVirtualKeyboard', 'A revoked WindowStore owner cannot invoke its cached manager');
a.owners.set(a.view, a.own); a.own.VirtualKeyboardManager = previousManager;

const failing = fixture();
let failedRequests = 0;
failing.own.VirtualKeyboardManager = { ShowVirtualKeyboard() { failedRequests++; throw Error('Keyboard not ready'); } };
failing.view.postMessage = () => { throw Error('Parent not ready'); };
check(!keyboard.showSteamVirtualKeyboard(failing.doc, inputA) && !keyboard.showSteamVirtualKeyboard(failing.doc, inputA) && failedRequests === 2,
  'An unsuccessful keyboard request is retried immediately instead of being reported as a debounced success');
const reentrant = fixture();
let nestedShows = 0;
reentrant.own.VirtualKeyboardManager = { ShowVirtualKeyboard(target) {
  nestedShows++;
  check(nestedShows < 2 && keyboard.showSteamVirtualKeyboard(reentrant.doc, target), 'Synchronous native focus notification coalesces keyboard reentry');
} };
check(keyboard.showSteamVirtualKeyboard(reentrant.doc, inputB) && nestedShows === 1,
  'The native manager is invoked once even when it synchronously asks to reopen the same target');
a.view.document = b.doc;
const keyboardBefore = keyboardEvents.length;
check(!keyboard.showSteamVirtualKeyboard(a.doc, {}) && keyboardEvents.length === keyboardBefore, 'A retired keyboard Document cannot send an action to its successor Window');
check(!keyboard.hideSteamVirtualKeyboard(a.doc) && keyboardEvents.length === keyboardBefore, 'A retired keyboard Document cannot dismiss its successor keyboard');
console.log(`Native WindowStore passed: ${checks} checks; installed semantic module ${oracle.id}, exact Documents, bounded warm/missing lookups, local globals and late chunks; no SDK calls.`);
