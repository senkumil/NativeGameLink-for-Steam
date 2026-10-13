import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
function load(file, dependencies) {
  const context = vm.createContext({ exports: {}, require: name => {
    assert(name in dependencies, `Unexpected dependency ${file}: ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context.exports;
}
// Use the installed Steam method when available, and the identical portable
// contract elsewhere. In particular, vecHighlight=undefined starts Steam's load.
const steamFile = process.env.STEAM_APPDETAILS_JS || 'C:/Program Files (x86)/Steam/steamui/chunk~2dcc5aaf7.js';
const method = fs.existsSync(steamFile)
  ? fs.readFileSync(steamFile, 'utf8').match(/GetAchievements\(e\)\{let t=this\.GetAppData\(e\);return[^}]+\}/)?.[0]
  : 'GetAchievements(e){let t=this.GetAppData(e);return void 0===t.details?.achievements.vecHighlight&&this.RequestAchievements(e),t.details?.achievements}';
assert(method, 'The native achievement method must remain inspectable');
const nativeGet = vm.runInNewContext(`({${method}}).GetAchievements`);
const id = 3000000001;
let verified = true;
const mappings = { [`shortcut:${id}`]: '111' };
const native = load('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts', {
  '../../../api/backend': { backendLog() {} }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: {} },
  '../../../core/mappings': { mappings, isMappingSnapshotVerified: () => verified, shortcutMappingKey: value => `shortcut:${value >>> 0}` },
});
let writes = 0;
const protect = object => new Proxy(object, { set(target, key, value) { writes++; return Reflect.set(target, key, value); } });
function fixture() {
  const data = new Map(), calls = [], requests = [], args = [];
  const store = { GetAppData(appId) { calls.push(appId); return data.get(appId); },
    RequestAchievements(appId) { requests.push(appId); },
    GetAchievements(...input) { args.push([this, ...input]); return nativeGet.apply(this, input); },
  };
  const original = store.GetAchievements;
  return { data, calls, requests, args, store, original };
}
const f = fixture();
native.ensureAppDetailsStoreGuarded(f.store);
const guarded = f.store.GetAchievements;
native.ensureAppDetailsStoreGuarded(f.store);
check(f.store.GetAchievements === guarded, 'The exact store is guarded once');
for (const publicId of [1, 111, 367520, 1030300, 2147483647]) {
  const progress = protect({ nTotal: 52, nAchieved: 41, vecHighlight: undefined });
  const details = protect({ achievements: progress });
  const record = protect({ details });
  f.data.set(publicId, record);
  for (let index = 0; index < 100; index++) {
    const before = f.calls.length;
    const result = f.store.GetAchievements(publicId, 'unchanged-argument');
    check(result === progress && f.calls.length === before + 1 && writes === 0,
      'A native progress read returns the exact original object with one native read and zero plugin writes');
  }
  check(f.requests.at(-1) === publicId && progress.vecHighlight === undefined,
    'A public game retains Steam lazy achievement loading instead of receiving an empty highlight array');
  check(f.args.at(-1)[0] === f.store && f.args.at(-1)[2] === 'unchanged-argument',
    'The native method retains its receiver and arguments');
  f.data.set(publicId, protect({ details: protect({}) }));
  let error;
  try { f.store.GetAchievements(publicId); } catch (value) { error = value; }
  check(error?.name === 'TypeError' && writes === 0,
    'Missing native initialization preserves the original behavior without inserting zero progress');
}

f.data.set(id, { details: {} });
const linked = f.store.GetAchievements(id);
check(linked.nTotal === 0 && linked.vecHighlight.length === 0,
  'Only an exact verified external shortcut receives its compatibility fallback');
for (const [value, authorized] of [[id + 1, true], [id, false]]) {
  verified = authorized; f.data.set(value, { details: {} });
  let error; try { f.store.GetAchievements(value); } catch (caught) { error = caught; }
  check(error?.name === 'TypeError' && !f.data.get(value).details.achievements,
    'An unmapped or unverified shortcut is also passed through without synthetic progress');
}
verified = true;
native.clearNativeComponentsCache();
check(f.store.GetAchievements === f.original && !Object.hasOwn(f.store, '__ngl_achievements_guarded'),
  'Disposal restores the original native method and removes the compatibility marker');

let resolved = 0, synced = [];
const NativeSection = () => null;
const bp = load('frontend/features/big-picture/NativeBigPictureAchievements.tsx', {
  react: { default: { createElement: (type, props, ...children) => ({ type, props, children }) } },
  '../../api/backend': { backendLog() {} }, '../../steam/localization': { gdlText: (_key, text) => text, loc: (_key, text) => text },
  '../../steam/gamepad/components/AppDetailsNativeComponents': {
    ensureAppDetailsStoreGuarded: native.ensureAppDetailsStoreGuarded,
    resolveNativeAchievementsSectionComponent: () => { resolved++; return NativeSection; },
    resolveNativeAppDetailsStore: () => f.store, resolveNativeAchievementStore: () => achievementStore,
    openNativeAchievementsScreen() {},
  },
  '../achievements/rarity': { compareEarnedAchievementsForDisplay() {}, compareLockedAchievementsForDisplay() {}, highlightedAchievementNames: () => new Set() },
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: value => verified ? mappings[`shortcut:${value >>> 0}`] || null : null },
});
const achievementStore = { m_mapMyAchievements: { set: (key, value) => synced.push([key, value]) } };
const local = { found: true, appid: '111', metadata_appid: '111', state_appid: String(id), total: 2, unlocked: 1,
  achievements: [{ name: 'A', earned: true }, { name: 'B', earned: false }] };
const before = f.calls.length;
for (const publicId of [111, 367520, 1030300]) bp.syncAchievementsToNativeStore(f.store, publicId, local, achievementStore);
check(f.calls.length === before && synced.length === 0,
  'Big Picture never reads or writes a public game store when publishing local achievements');
f.data.set(id, { details: {} });
bp.syncAchievementsToNativeStore(f.store, id, local, achievementStore);
check(f.data.get(id).details.achievements.nAchieved === 1 && synced.every(([key]) => key === id),
  'Local Big Picture progress is published only under the exact shortcut identity');
const totalCalls = f.calls.length;
bp.syncAchievementsToNativeStore(f.store, id, { ...local, metadata_appid: '222' }, achievementStore);
check(f.calls.length === totalCalls, 'A relinked payload cannot overwrite the current shortcut store');
const props = { shortcut: { id, steamAppId: '111' }, data: { achievements: local }, NativeDetailsBoundary: () => null,
  classes: {}, SectionComponent: () => null, LoadingComponent: () => null, NativeButton: () => null, NativeIcons: {} };
const tree = bp.NativeBigPictureAchievements(props);
check(tree.children[0].type === NativeSection && tree.children[0].props.details.unAppID === id,
  'The native Big Picture component receives the shortcut AppID rather than the public Store AppID');
const beforeNative = resolved;
for (const target of [111, 0, id + .5, 4294967296, NaN]) {
  const output = bp.NativeBigPictureAchievements({ ...props, shortcut: { id: target, steamAppId: '111' } });
  check(output === null && resolved === beforeNative,
    'A public or invalid destination never resolves or mounts the linked native achievement adapter');
}
native.clearNativeComponentsCache();
console.log(`Native achievement isolation passed: ${checks} assertions; native lazy loading, exact objects, no public writes, shortcut-only Big Picture, and original method restoration.`);
