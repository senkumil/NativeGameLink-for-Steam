import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const self = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync('C:/Program Files (x86)/Steam/steamui/sp.js', 'utf8'), { self });
const installed = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const signatures = {
  Media: ['E', ['AppDetails_SectionTitle_Screenshots', 'AppDetails_HowToScreenshotGamepad', 'rightColumnSection']],
  Notes: ['E', ['AppDetails_SectionTitle_GameNotes', 'AppDetails_NewNote', 'ShowGameNotesPopup']],
  Review: ['h', ['AppDetails_Review_YourReview', 'GetStoredReview', 'FetchRoamingStorageState']],
  Cards: ['on', ['AppDetails_SectionTitle_TradingCards', 'nOwned', 'strMarketHash', 'data-carousel']],
  DLC: ['Kf', ['AppDetails_SectionTitle_DLC', 'showRemainder', 'vecDLC', 'AppDetails_ManageDLC']],
  Workshop: ['y', ['AppDetails_SectionTitle_Workshop', 'BIsWorkshopVisible', 'AppDetails_ViewSubscribedItems', 'SubscribedItemsMessage']],
};
let checks = 0, scans = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
const factories = {}, exports = {}, expected = {};
for (const [name, [key, tokens]] of Object.entries(signatures)) {
  const match = Object.entries(installed).filter(([, f]) => tokens.every(token => String(f).includes(token)));
  check(match.length === 1, `${name} has one exact installed module contract`);
  const [id, source] = match[0];
  const mock = () => { throw Error('Installed factories must not execute'); };
  mock.toString = () => String(source); factories[id] = mock;
  expected[name] = function NativeSection() {};
  exports[id] = { [key]: expected[name] };
}
factories[999999] = () => { throw Error('Unrelated account module'); };
const reads = [], req = id => { reads.push(String(id)); return exports[id]; }; req.m = factories;
const identities = new WeakMap();
const runtime = { getRequire: () => req, getRuntimeIdentity: doc => identities.get(doc),
  getModuleFactoryCount: () => Object.keys(factories).length,
  getModuleFactories: () => { scans++; return Object.entries(factories).map(([id, factory]) => ({ id, factory })); } };
const dependencies = { '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime }, '../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime } };
function load(file) {
  const result = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(key => { assert(key in dependencies, key); return dependencies[key]; }, result);
  return result;
}
dependencies['../runtime-cache'] = load('frontend/steam/gamepad/runtime-cache.ts');
const { resolveNativeStuffComponents: resolve } = load('frontend/steam/gamepad/components/NativeStuffComponents.ts');
const doc = { body: { isConnected: true } }; doc.defaultView = { document: doc }; identities.set(doc, {});
for (const [name, component] of Object.entries(resolve(doc))) check(component === expected[name], `${name} selects its native export`);
for (let i = 0; i < 100; i++) resolve(doc);
check(scans === 1 && reads.length === 6 && !reads.includes('999999'), 'Warm rendering does not rescan or initialize unrelated modules');
identities.set(doc, {}); resolve(doc);
check(scans === 2, 'A replaced runtime resolves its own sections again');
factories[888888] = () => {}; resolve(doc);
check(scans === 3, 'Late chunks invalidate the section discovery cache');
doc.defaultView.closed = true;
check(Object.values(resolve(doc)).every(value => value === null), 'A retired window cannot reuse native components');
console.log(`Big Picture Tus cosas contracts passed: ${checks} checks; native signatures, owner cache and no live account calls.`);
