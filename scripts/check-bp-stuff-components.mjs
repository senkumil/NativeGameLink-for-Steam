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
const { bigPictureAchievementPreview, BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT } = load('frontend/features/big-picture/achievement-preview.ts');
const achievement = (name, earned, time, percent, hidden = false) => ({ name, earned, earned_time: time,
  global_percent: percent, global_percent_known: Number.isFinite(percent), hidden });
const earnedItems = Array.from({ length: 32 }, (_, index) => achievement(`earned-${index}`, true, index < 3 ? 999 : index, 100 - index));
const lockedItems = Array.from({ length: 18 }, (_, index) => achievement(`locked-${index}`, false, 0, index));
const items = [...earnedItems, ...lockedItems, achievement('secret', false, 0, 99, true), achievement('unknown', false, 0, undefined)];
const preview = bigPictureAchievementPreview(items);
check(BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT === 12 && preview.earned.length === 12 && preview.locked.length === 12,
  'Native summary vectors bound both 32-earned and 18-locked previews to twelve');
check(preview.earned.slice(0, 3).map(item => item.name).join(',') === 'earned-0,earned-1,earned-2',
  'Newest earned achievements retain schema order when their unlock timestamps tie');
check(preview.locked[0].name === 'locked-17' && preview.locked.at(-1).name === 'locked-6',
  'Locked preview follows descending global percentage rather than rarest-first order');
check(!preview.locked.some(item => item.name === 'secret') && items.length === 52,
  'Hidden locked achievements remain secret and preview selection never mutates or truncates the full snapshot');
const tied = bigPictureAchievementPreview([achievement('b', false, 0, 10), achievement('a', false, 0, 10), achievement('unknown', false, 0, undefined)]);
check(tied.locked.map(item => item.name).join(',') === 'b,a,unknown',
  'Equal global percentages retain schema order and unavailable rarity sorts after known values');
const explicitOrder = bigPictureAchievementPreview([
  { ...achievement('later-earned', true, 99, 50, true), schema_order: 2 },
  { ...achievement('first-earned', true, 99, 50, true), schema_order: 1 },
  { ...achievement('later-locked', false, 0, 25), schema_order: 4 },
  { ...achievement('first-locked', false, 0, 25), schema_order: 3 },
]);
check(explicitOrder.earned[0].name === 'first-earned' && explicitOrder.earnedHidden[0].name === 'first-earned'
  && explicitOrder.locked[0].name === 'first-locked', 'Explicit native schema order breaks equal-time and equal-percentage ties in every vector');
const hiddenEarned = bigPictureAchievementPreview(Array.from({ length: 30 }, (_, index) => achievement(String(index), true, index, 50, true)));
check(hiddenEarned.earnedHidden.length === 12, 'The native hidden-earned vector also uses twelve entries while the full local map stays complete');

// Steam constructs these bounded vectors before the gamepad component maps
// them. Read native public-game snapshots when this installation has them;
// the summary component's visible-count oracle below remains account-free.
const steamRoot = process.env.STEAM_UI_PATH ? process.env.STEAM_UI_PATH.replace(/[\\/]steamui[\\/]?$/, '') : 'C:/Program Files (x86)/Steam';
const userdata = `${steamRoot}/userdata`;
const snapshotVectors = [];
if (fs.existsSync(userdata)) for (const account of fs.readdirSync(userdata)) {
  const directory = `${userdata}/${account}/config/librarycache`;
  if (!/^\d+$/.test(account) || !fs.existsSync(directory)) continue;
  for (const filename of fs.readdirSync(directory)) {
    if (!/^\d+\.json$/.test(filename) || Number(filename.slice(0, -5)) >= 2147483648) continue;
    try {
      const data = JSON.parse(fs.readFileSync(`${directory}/${filename}`, 'utf8')).find(row => row[0] === 'achievements')?.[1]?.data;
      for (const key of ['vecHighlight', 'vecUnachieved', 'vecAchievedHidden']) if (Array.isArray(data?.[key])) snapshotVectors.push(data[key].length);
    } catch {}
  }
}
if (snapshotVectors.some(length => length >= 12)) check(Math.max(...snapshotVectors) === BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT,
  'The production preview ceiling equals the largest actual Steam public-game achievement response vector');
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
