import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source = ts.transpileModule(fs.readFileSync('frontend/features/big-picture/achievement-screen-parts.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
let enumerations = 0, identity = {}, reads = [];
const registry = { 3270: function imageFactory() { return 'imgURL hidden glow'; },
  36000: function rowsFactory() { return 'percentGlobalUnlocked primaryAchiever unlockDate imgUrl fm:'; },
  24124: function searchFactory() { return 'strFilter onChangeFilter leftContent zp:'; } };
for (let id = 100000; id < 120000; id++) registry[id] = function unrelated() {};
function Image() { return 'imgURL hidden glow'; }
function Row() { return 'unlockDate percentGlobalUnlocked imgUrl'; }
function Search() { return 'strFilter onChangeFilter leftContent'; }
const req = Object.assign(id => { reads.push(id); return id === 3270 ? { _: Image } : id === 36000 ? { fm: Row } : id === 24124 ? { zp: Search } : {}; }, { m: registry });
const runtime = { captureRuntime() {}, getRequire: () => req, getRuntimeIdentity: () => identity,
  getModuleFactoryCount: () => Object.keys(registry).length,
  getModuleFactories: () => { enumerations++; return Object.entries(registry).map(([id, factory]) => ({ id, factory })); } };
const module = { exports: {} };
vm.runInNewContext(source, { exports: module.exports, require: key => key.includes('SteamWebpackRuntime')
  ? { steamWebpackRuntime: runtime } : { readPureClassFactory: () => null } });
const doc = { defaultView: { closed: false } }; doc.defaultView.document = doc;
const resolve = module.exports.resolveBigPictureAchievementScreenParts;
assert.equal(resolve(doc, true).Image, Image);
assert.deepEqual(reads, [3270], 'The summary must not initialize full-screen rows or search');
assert.equal(enumerations, 1);
for (let i = 0; i < 100; i++) assert.equal(resolve(doc, true).Image, Image);
assert.equal(enumerations, 1, 'Warm summary renders must not enumerate 20,000 factories again');
assert.deepEqual(reads, [3270]);
assert.equal(resolve(doc).PersonalRow, Row);
assert.ok(reads.includes(36000) && reads.includes(24124), 'Full-screen parts remain lazy until the full screen requests them');
const before = enumerations; resolve(doc); resolve(doc, true);
assert.equal(enumerations, before, 'Both presentation caches have constant warm discovery work');
identity = {}; resolve(doc, true);
assert.equal(enumerations, before + 1, 'Runtime replacement retires the image cache');
registry[999999] = function addedChunk() {}; resolve(doc, true);
assert.equal(enumerations, before + 2, 'New chunks retry presentation discovery');
console.log('BP achievement presentation cost passed: image-only bootstrap, zero warm factory enumeration, lazy full-screen exports and runtime/chunk invalidation (20,003 factories).');
