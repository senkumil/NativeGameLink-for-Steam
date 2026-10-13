import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let now = 0, timerId = 0, refreshes = 0;
const timers = new Map(), mutations = [], reviews = [];
const firstId = 3300000001, secondId = firstId + 1;
const mappings = { [`shortcut:${firstId}`]: '111', [`shortcut:${secondId}`]: '222' };
const record = id => ({ id, title: `Game ${id}`, app: { appid: id, strShortcutExe: `D:/Games/${id}.exe`, strShortcutLaunchOptions: '' } });
const originals = [record(firstId), record(secondId)];
let records = [...originals];
const setTimer = (callback, delay, interval = 0) => {
  const id = ++timerId; timers.set(id, { callback, at: now + delay, interval }); return id;
};
async function advance(duration) {
  const end = now + duration;
  for (;;) {
    const pending = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!pending || pending[1].at > end) break;
    const [id, timer] = pending; now = timer.at;
    if (timer.interval) timer.at += timer.interval;
    else timers.delete(id);
    timer.callback();
    for (let index = 0; index < 6; index++) await Promise.resolve();
  }
  now = end;
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
const dependencies = {
  '../../api/backend': { backendLog() {} },
  '../../core/preferences': { getPreferences: () => ({ autoDetectShortcuts: true }) },
  '../../steam/shortcuts': {
    readShortcutOverviewField: (app, ...names) => names.map(name => app?.[name]).find(value => value != null) || '',
    shortcutExecutableIdentity: value => String(value).toLowerCase(),
    shortcutStableIdentity: app => app.strShortcutExe.toLowerCase(),
  },
  './native-add-guard': {
    candidateSteamDocuments: () => [], nativeAddNonSteamDialogOpen: () => false,
    nativeAddSelectedExecutableIdentities: () => [],
  },
  './registry': {
    getAllShortcutRecords: () => records,
    refreshShortcutRecordsFromBackend: async () => { refreshes++; },
    shortcutAlreadyLinked: id => Boolean(mappings[`shortcut:${id}`]),
    findMappingForShortcut: id => mappings[`shortcut:${id}`] || null,
  },
  './manual-link': { requestNativeAddShortcutReview: (id, title) => { reviews.push({ id, title }); return true; } },
  './linking': {
    hasNoLauncherOption: () => false, shouldAutoApplyNoLauncher: () => true,
    mergeNoLauncherOption: () => '--launcher-bypass', removeIncompatibleLauncherBypass: () => '',
  },
  '../../core/mappings': {
    mappings, updateMappingsChecked: async changes => mutations.push({ type: 'mapping', changes }),
  },
  './purge': { purgeShortcutCachesAndArtwork: async (...args) => mutations.push({ type: 'purge-artwork', args }) },
};
const context = vm.createContext({
  exports: {}, Date: { now: () => now },
  setTimeout: (callback, delay) => setTimer(callback, delay), clearTimeout: id => timers.delete(id),
  setInterval: (callback, delay) => setTimer(callback, delay, delay), clearInterval: id => timers.delete(id),
  window: { SteamClient: { Apps: new Proxy({}, { get: (_target, name) => (...args) => mutations.push({ type: name, args }) }) } },
  require: name => { assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/native-add-autodetect.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const before = originals.map(item => Object.getOwnPropertyDescriptors(item.app));
context.exports.startNativeAddAutoDetector();
await advance(12000);
assert(refreshes >= 3, 'Startup and recurring native-add scans actually executed');
assert.deepEqual(mutations, [], 'Startup and periodic scans never edit launch options, mappings, icons or artwork');
records = [originals[0]];
await advance(8000);
assert.deepEqual(mutations, [], 'A partially hydrated shortcut snapshot cannot delete a mapping or purge artwork');
assert.equal(mappings[`shortcut:${secondId}`], '222', 'The temporarily missing shortcut retains its exact mapping');
records = [];
await advance(8000);
assert.deepEqual(mutations, [], 'An empty shortcut snapshot cannot mutate library state');
records = [...originals];
await advance(8000);
assert.deepEqual(mutations, [], 'Returning mapped records do not trigger shortcut repair or writes');
assert.equal(reviews.length, 0, 'Existing mapped shortcuts never open a new link review');
records.push(record(firstId + 2));
await advance(12000);
assert.deepEqual(reviews.map(item => item.id), [firstId + 2], 'A genuinely new unmapped shortcut still opens exactly one review');
assert.deepEqual(mutations, [], 'Detecting a new shortcut stays read-only until the user links it');
assert.deepEqual(originals.map(item => Object.getOwnPropertyDescriptors(item.app)), before, 'Native shortcut overviews preserve all properties');
context.exports.stopNativeAddAutoDetector();
assert.equal(timers.size, 0, 'Disposing native-add scanning cancels its recurring work');
console.log('Shortcut scan isolation passed: startup, recurring scans, missing/empty/returning snapshots and new-add review perform no shortcut writes or artwork purges.');
