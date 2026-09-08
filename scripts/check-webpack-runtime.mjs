import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const registry = new Map([['shared', { name: 'shared' }]]);
const context = vm.createContext({ exports: {}, require: name => name === '@steambrew/client' ? { modules: registry } : { backendLog: () => {} } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/modules/SteamWebpackRuntime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const runtime = context.exports.steamWebpackRuntime;
function realm(name) {
  const req = { c: { 1: { exports: { name } } } };
  return { req, doc: { defaultView: { closed: false, addEventListener() {}, webpackChunksteamui: { push: chunk => chunk[2](req) } } } };
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
const fallback = { defaultView: { closed: false, addEventListener() {} } };
runtime.captureRuntime(fallback);
const sharedIdentity = runtime.getRuntimeIdentity(fallback);
registry.set('later', { name: 'new shared module' });
assert.equal(runtime.getAllModules(fallback).length, 2);
assert.notEqual(runtime.getRuntimeIdentity(fallback), sharedIdentity);
registry.delete('shared');
assert.equal(runtime.getAllModules(fallback).length, 1);
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
