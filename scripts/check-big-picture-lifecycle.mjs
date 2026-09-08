import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const patchContext = vm.createContext({ exports: {} });
vm.runInContext(compile('frontend/core/property-patches.ts'), patchContext);
class App {
  constructor(id) {
    this.appid = id; this.display_name = 'Test shortcut'; this.canonicalAppType = 1073741824;
    this.minutes_playtime_forever = 5; this.minutes_playtime_last_two_weeks = 2;
    this.local_per_client_data = { installed: false };
  }
  get controller_support() { return 0; }
  BIsShortcut() { return this.appid >= 2147483648; }
  BIsSteamDeckVerified() { return false; }
}
const app = new App(3000000000), native = new App(570);
const method = App.prototype.BIsShortcut;
const getter = Object.getOwnPropertyDescriptor(App.prototype, 'controller_support').get;
const doc = { body: { isConnected: true }, defaultView: {}, querySelector: () => null, getElementById: () => null };
let completeBatch;
const mocks = {
  PropertyPatches: patchContext.exports.PropertyPatches, backendLog: () => {},
  defaultBigPictureModeEnabled: () => false, subscribePreferences: () => {},
  installBrowserProtection: () => () => {}, syncMissingArtworkForMappedShortcuts: async () => {},
  invalidateBigPictureMappedShortcuts: () => {}, disposeBigPictureShortcutDetails: () => {},
  getSteamAppStore: () => ({ m_mapApps: new Map([[app.appid, app], [native.appid, native]]) }),
  getBigPictureMappedShortcuts: () => [{ id: app.appid, title: app.display_name, steamAppId: '10' }],
  collectMappedShortcutApps: () => [app], toSignedShortcutAppId: id => id | 0,
  findMappingForTitle: () => null, getShortcutAppById: () => app,
  fetchPlaytimeStatsBatch: () => new Promise(resolve => { completeBatch = resolve; }),
};
const context = vm.createContext({ exports: {}, require: () => mocks, window: {}, setTimeout, clearTimeout });
vm.runInContext(compile('frontend/features/big-picture/runtime.ts'), context);
const runtime = context.exports;
for (let cycle = 0; cycle < 2; cycle++) {
  runtime.activateBigPicture(doc);
  runtime.mergeShortcutsIntoBigPictureLibrary(doc);
  assert.equal(app.BIsShortcut(), false);
  assert.equal(app.controller_support, 2);
  assert.equal(native.controller_support, 0);
  assert.equal(native.BIsSteamDeckVerified(), false);
  const pending = runtime.patchBigPictureHomePlaytime(doc);
  runtime.deactivateBigPicture();
  if (completeBatch) completeBatch(new Map([[app.appid, { minutesForever: 999 }]]));
  await pending;
  assert.equal(app.minutes_playtime_forever, 5, 'late playtime response must not mutate Desktop');
  assert.equal(app.canonicalAppType, 1073741824);
  assert.equal(app.local_per_client_data.installed, false);
  assert.equal(app.controller_support, 0);
  assert.equal(App.prototype.BIsShortcut, method, 'prototype restored exactly');
  assert.equal(Object.getOwnPropertyDescriptor(App.prototype, 'controller_support').get, getter);
  assert.equal(Object.hasOwn(app, 'BIsShortcut'), false, 'no own method left over');
}
const patches = new patchContext.exports.PropertyPatches();
const target = { method() {} };
patches.set(target, 'method', { configurable: true, writable: true, value() {} });
const steamReplacement = () => {};
target.method = steamReplacement;
patches.restore();
assert.equal(target.method, steamReplacement, 'preserve newer Steam changes');
console.log('Big Picture lifecycle passed: two entry/exit cycles, prototype/getter restoration, native app isolation, late response cancellation.');
