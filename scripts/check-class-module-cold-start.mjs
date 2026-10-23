import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const pure = {}; vm.runInNewContext(compile('frontend/steam/gamepad/components/pure-class-factory.ts'), { exports: pure });
let now = 1000, scans = 0, executions = 0;
const owner = { defaultView: { webpackChunksteamui: [] } }, foreign = { defaultView: { webpackChunksteamui: [] } };
const states = new Map([[owner, { identity: {}, factories: [] }], [foreign, { identity: {}, factories: [] }]]);
const runtime = { getRuntimeIdentity: doc => states.get(doc).identity, getAllModules: () => [],
 getModuleFactoryCount: doc => states.get(doc).factories.length,
 getModuleFactories: doc => { scans++; return states.get(doc).factories.map((factory, id) => ({ id, factory })); } };
const cache = {};
vm.runInNewContext(compile('frontend/steam/class-module-cache.ts'), { exports: cache,
 Date: class extends Date { static now() { return now; } }, require: name => name.includes('pure-class') ? pure : { steamWebpackRuntime: runtime } });
const fallback = { Portrait: 'fallback', InnerContainer: 'fallback-inner' };
const predicate = classes => classes.Portrait && classes.InnerContainer;
const resolve = doc => cache.resolveSteamClassModule(predicate, fallback, doc);
assert.equal(resolve(owner).native, false);
states.get(owner).factories = [function(module) { executions++; module.exports = { Portrait: 'unsafe', InnerContainer: 'unsafe' }; },
 function(module) { module.exports = { Portrait: "native-portrait", InnerContainer: "native-inner" }; }];
now += 1000;
assert.equal(resolve(owner).classes.Portrait, 'native-portrait', 'A cold shortcut resolves pure CSS before the native component is ever instantiated');
assert.equal(executions, 0, 'Discovery never executes a private module or side effect');
assert.equal(resolve(foreign).native, false, 'A second CEF window never borrows the first window CSS');
const before = scans;
for (let index = 0; index < 1000; index++) assert.equal(resolve(owner).native, true);
assert.equal(scans, before, 'A thousand icon/layout reads never rescan factories');
states.get(owner).identity = {}; states.get(owner).factories = [];
now += 1000;
assert.equal(resolve(owner).native, false, 'Runtime replacement retires the previous native CSS');

const sp = 'C:/Program Files (x86)/Steam/steamui/sp.js';
if (fs.existsSync(sp)) {
 const sandbox = { webpackChunksteamui: [] };
 vm.runInNewContext(fs.readFileSync(sp, 'utf8'), { self: sandbox });
 states.get(owner).identity = {};
 states.get(owner).factories = Object.values(Object.assign({}, ...sandbox.webpackChunksteamui.map(chunk => chunk[1])));
 now += 1000;
 const css = {};
 vm.runInNewContext(compile('frontend/steam/css.ts'), { exports: css, require: () => cache });
 assert(css.GAME_INFO_CLASS_MODULE(owner).native && css.GAME_INFO_OUTER_CLASS_MODULE(owner).native && css.PLAYBAR_CLASS_MODULE(owner).native,
  'The installed Steam Info, expansion and button class factories all resolve with an empty loaded-module cache');
}
console.log('Cold CSS discovery passed: literal-only factories, empty native cache, late chunks, window isolation, runtime replacement and bounded scans.');
