import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const registry = new Map([['shared', { name: 'shared' }]]);
let clock = 1000;
const context = vm.createContext({ exports: {}, Date: class extends Date { static now() { return clock; } }, require: name => name === '@steambrew/client' ? { modules: registry } : { backendLog: () => {} } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/modules/SteamWebpackRuntime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const runtime = context.exports.steamWebpackRuntime;
function realm(name) {
  const req = { c: { 1: { exports: { name } } } };
  const doc = { defaultView: { closed: false, addEventListener() {}, removeEventListener() {}, webpackChunksteamui: { push: chunk => chunk[2](req) } } };
  doc.defaultView.document = doc;
  return { req, doc };
}
const desktop = realm('desktop'), bp = realm('bigpicture');
runtime.captureRuntime(desktop.doc);
const firstIdentity = runtime.getRuntimeIdentity(desktop.doc);
desktop.req.c[2] = { exports: { name: 'late chunk' } };
assert.equal(runtime.getAllModules(desktop.doc).length, 2);
assert.notEqual(runtime.getRuntimeIdentity(desktop.doc), firstIdentity);
assert.equal(runtime.getAllModules(bp.doc)[0].exports.name, 'bigpicture');
assert.equal(runtime.getAllModules(desktop.doc)[0].exports.name, 'desktop');
delete desktop.req.c[1];
assert.equal(runtime.getAllModules(desktop.doc).length, 1);
desktop.req.c[2].exports = undefined;
assert.equal(runtime.getAllModules(desktop.doc).length, 0, 'cleared exports must not remain cached');
const fallback = { defaultView: { closed: false, addEventListener() {}, removeEventListener() {} } };
fallback.defaultView.document = fallback;
assert.equal(runtime.captureRuntime(fallback), false, 'An explicit foreign document cannot borrow the plugin-host module registry');
context.window = fallback.defaultView;
runtime.invalidate(fallback);
runtime.captureRuntime(fallback);
const sharedIdentity = runtime.getRuntimeIdentity(fallback);
registry.set('later', { name: 'new shared module' });
assert.equal(runtime.getAllModules(fallback).length, 2);
assert.notEqual(runtime.getRuntimeIdentity(fallback), sharedIdentity);
registry.delete('shared');
assert.equal(runtime.getAllModules(fallback).length, 1);
const localRequire = id => ({ id, owner: 'late native bootstrap' }); localRequire.m = { 5757() {} };
fallback.defaultView.webpackChunksteamui = { push: chunk => chunk[2](localRequire) };
clock += 600;
const recovered = runtime.getRequire(fallback);
assert.equal(typeof recovered, 'function', 'A Millennium-only first probe must retry when the local native bootstrap arrives');
assert.equal(recovered.m, localRequire.m, 'Recovery captures only the owner Window factory table');
assert.equal(recovered(5757).owner, 'late native bootstrap');
console.log('Webpack runtime passed: late chunks, removed exports, generation updates, distinct runtimes and refreshed Millennium fallback.');
const liveWindow = { appStore: { version: 1 } };
const stores = vm.createContext({ exports: {}, window: liveWindow, require: () => ({}) });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/modules/SteamModuleResolver.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, stores);
assert.equal(stores.exports.getAppStore().version, 1);
liveWindow.appStore = { version: 2 };
assert.equal(stores.exports.getAppStore().version, 2, 'replaced store must not remain cached');
delete liveWindow.appStore;
assert.equal(stores.exports.getAppStore(), null, 'removed store must not survive its owner');
console.log('Store replacement and removal checks passed.');
