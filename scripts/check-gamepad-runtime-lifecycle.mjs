import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
class WindowFixture {
  listeners = new Map();
  appStore = {};
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  fire(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener(); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
const view = new WindowFixture();
const first = { defaultView: view, body: { isConnected: true } };
view.document = first;
let captures = 0, nativeClears = 0;
const dependencies = {
  '../../api/backend': { backendLog() {} },
  '../modules/SteamWebpackRuntime': { steamWebpackRuntime: {
    captureRuntime() { captures++; return true; }, getAllModules: doc => [doc], getRequire: doc => doc,
  } },
  './GamepadCapabilities': { gamepadCapabilities: { resetCircuitBreakers() {}, setAvailable() {} } },
  './components/AppDetailsNativeClasses': { clearNativeAppDetailsClassCache() {} },
  './components/AppDetailsNativeComponents': { clearNativeComponentsCache() { nativeClears++; } },
};
for (const name of ['Achievements', 'Activity', 'Friends', 'GameDetails', 'GameInfo', 'Hero', 'News', 'Playbar']) {
  dependencies[`./components/${name}Resolver`] = { [`${name[0].toLowerCase()}${name.slice(1)}Resolver`]: { invalidate() {} } };
}
const context = vm.createContext({ exports: {}, window: view, require: name => {
  assert(name in dependencies, `Unexpected GamepadRuntime dependency: ${name}`); return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/GamepadRuntime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const runtime = context.exports.gamepadRuntime;

check(runtime.initialize(first) && runtime.isReady(), 'The first document captures its runtime');
check(view.count('beforeunload') === 1, 'Exactly one unload handler belongs to the captured document');
const oldCallback = [...view.listeners.get('beforeunload')][0];
runtime.initialize(first);
check(captures === 1 && view.count('beforeunload') === 1, 'Repeated initialization retains one handler and the ready runtime');

const replacement = { defaultView: view, body: { isConnected: true } };
view.document = replacement;
check(runtime.initialize(replacement), 'A replacement document can reuse its CEF Window');
check(captures === 2 && nativeClears === 1 && view.count('beforeunload') === 1,
  'Document replacement clears realm caches and replaces, rather than accumulates, the Window listener');
oldCallback();
runtime.invalidate(first);
check(runtime.isReady() && nativeClears === 1, 'A queued old-document callback and old scoped teardown cannot invalidate the replacement');
check(runtime.getRequire() === replacement && runtime.getModules()[0] === replacement,
  'Runtime reads remain attached to the replacement Document');
const replacementCallback = [...view.listeners.get('beforeunload')][0];
view.fire('beforeunload');
check(!runtime.isReady() && nativeClears === 2 && view.count('beforeunload') === 0,
  'The replacement document unload invalidates caches and removes its handler');
replacementCallback();
runtime.invalidate(first);
check(nativeClears === 2, 'Callbacks retained across teardown cannot reacquire authority after invalidation');

check(runtime.initialize(replacement) && view.count('beforeunload') === 1, 'Reentry in the same Window installs a fresh handler');
const beforeExplicitExit = nativeClears;
runtime.invalidate();
check(!runtime.isReady() && view.count('beforeunload') === 0 && nativeClears === beforeExplicitExit + 1,
  'Explicit mode or plugin teardown removes the active handler and restores runtime-bound state');
replacementCallback();
check(nativeClears === beforeExplicitExit + 1, 'An unload callback from before mode teardown cannot run a second cleanup');

runtime.initialize(replacement);
const otherView = new WindowFixture();
const otherDoc = { defaultView: otherView, body: { isConnected: true } };
otherView.document = otherDoc;
runtime.initialize(otherDoc);
const beforeForeignUnload = nativeClears;
check(runtime.isReady(replacement) && runtime.isReady(otherDoc) && view.count('beforeunload') === 1,
  'Adopting another live CEF document preserves the first document runtime and unload cleanup');
view.fire('beforeunload');
runtime.invalidate(replacement);
check(runtime.isReady() && !runtime.isReady(replacement) && nativeClears === beforeForeignUnload + 1 && view.count('beforeunload') === 0 && otherView.count('beforeunload') === 1,
  'Unloading the first Window cleans only its realm and cannot invalidate the new active Window runtime');
otherView.fire('beforeunload');
check(!runtime.isReady() && otherView.count('beforeunload') === 0 && nativeClears === beforeForeignUnload + 2,
  'The current Window retains its own working unload cleanup');
console.log(`Gamepad runtime lifecycle passed: ${checks} checks; same-Window Document replacement, listener ownership, reentry, scoped teardown and stale callbacks.`);
