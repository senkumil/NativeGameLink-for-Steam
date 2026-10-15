// Navigation/scroll interleavings use the real achievement service, request
// cache, local snapshots, read-only native progress reader and sidebar queue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
let now = 1_000, nextTimer = 0;
class Clock extends Date { static now() { return now; } }
const timers = new Map();
const drain = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); await drain();
  }
  now = end; await drain();
}
function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, console, Date: Clock, ...globals, require: name => {
    assert(name in dependencies, `Unexpected ${file} dependency: ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context, { filename: file });
  return context.exports;
}

const nativeMutations = [];
const nativeSubscriberSignals = [];
class NativeProgressMap extends Map {
  set(key, value) { nativeMutations.push(['cache.set', key]); nativeSubscriberSignals.push(key); return super.set(key, value); }
  delete(key) { nativeMutations.push(['cache.delete', key]); return super.delete(key); }
  clear() { nativeMutations.push(['cache.clear']); return super.clear(); }
}
const mapCache = new NativeProgressMap();
const nativeEntries = new Map([[570, { appid: 570, total: 52, unlocked: 41, percentage: 79, cache_time: 7 }],
  [123, { appid: 123, total: 4, unlocked: 1, percentage: 25, cache_time: 9 }]]);
for (const [id, value] of nativeEntries) Map.prototype.set.call(mapCache, id, value);
const cache = { m_achievementProgress: { mapCache }, QueueCacheUpdate(id) { nativeMutations.push(['QueueCacheUpdate', id]); } };
const shortcuts = new Map([[3_000_000_001, '123'], [3_000_000_002, '456'], [3_000_000_003, '123']]);
const overviews = new Map();
for (const id of [570, 123, ...shortcuts.keys()]) {
  const original = { appid: id, display_name: `Steam-owned ${id}`, icon: `native-${id}`,
    minutes_playtime_forever: 17, rt_last_time_played: 123456, rt_custom_image_mtime: 10 };
  overviews.set(id, new Proxy(original, {
    set(target, key, value) { nativeMutations.push(['overview.set', id, key]); return Reflect.set(target, key, value); },
    defineProperty(target, key, descriptor) { nativeMutations.push(['overview.defineProperty', id, key]); return Reflect.defineProperty(target, key, descriptor); },
    deleteProperty(target, key) { nativeMutations.push(['overview.delete', id, key]); return Reflect.deleteProperty(target, key); },
    setPrototypeOf(target, prototype) { nativeMutations.push(['overview.prototype', id]); return Reflect.setPrototypeOf(target, prototype); },
  }));
}
const overviewSnapshot = JSON.stringify([...overviews]);
const rows = Array.from(overviews, ([id, overview]) => ({ appid: id, title: overview.display_name, src: overview.icon, visible: true }));
const sidebarSnapshot = JSON.stringify(rows);
const listeners = new Map();
const sidebarNode = { nodeType: 1, children: [], parentElement: null,
  classList: { contains: value => value === '_3x1HklzyDs4TEjACrRO2tB' }, closest: () => null };
const doc = { body: {}, hidden: false, route: 570,
  addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
  removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  fire(type, target = sidebarNode) { for (const callback of listeners.get(type) || []) callback({ type, target }); },
};
doc.defaultView = { document: doc, closed: false, appAchievementProgressCache: cache,
  appStore: { GetAppOverviewByAppID: id => overviews.get(id) },
  setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
  clearTimeout(id) { timers.delete(id); },
};
doc.defaultView.parent = doc.defaultView; doc.defaultView.top = doc.defaultView;
const storage = new Map();
const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const globals = { window: doc.defaultView, document: doc, localStorage };
const classModuleCache = load('frontend/steam/class-module-cache.ts', {
  './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
});
const css = load('frontend/steam/css.ts', { './class-module-cache': classModuleCache });
const sidebar = load('frontend/steam/library-sidebar.ts', { './css': css });
const interaction = load('frontend/steam/sidebar-interaction.ts', { './library-sidebar': sidebar });
interaction.installLibrarySidebarInteraction(doc, true);
const progress = load('frontend/features/achievements/progress.ts', {
  '../../api/backend': { backendLog() {} }, '../../core/text': { escapeHtml: String },
  '../../steam/css': css, '../../steam/localization': { loc: (_token, fallback) => fallback },
  // A legacy writer import is resolved to the actual queue and observed stores,
  // so reintroducing the old service→progress edge fails rather than being stubbed.
  '../../steam/shortcuts': { toSignedShortcutAppId: value => value | 0 },
  '../../core/mappings': { isMappingSnapshotVerified: () => true,
    mappings: Object.fromEntries([...shortcuts].map(([id, steam]) => [`shortcut:${id}`, steam])),
    shortcutMappingKey: value => `shortcut:${value >>> 0}` },
  '../../steam/sidebar-interaction': interaction,
  '../library/native-route': { isPublicSteamLibraryRoute: value => value.route > 0 && value.route < 2_147_483_648 },
}, globals);
check(!('syncNativeAchievementProgressCache' in progress), 'The global native progress writer is removed instead of retained as a silent compatibility export');
const requests = [];
const service = load('frontend/features/achievements/service.ts', {
  './native-schema': { readNativeAchievementSchema: async () => null },
  '../../api/backend': { fetchLocalAchievementsBackend: request => new Promise(resolve => requests.push({ request, resolve })) },
  '../../core/preferences': { getPreferences: () => ({}), simulatedAchievementsEnabled: () => false },
  '../../steam/localization': { steamLanguageSync: () => 'english' },
  './progress': progress,
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => shortcuts.get(id) || null },
}, globals);
const localCache = load('frontend/features/achievements/cache.ts', {}, globals);
const received = [], pluginPaints = [];
const unsubscribe = service.subscribeLocalAchievementData(update => {
  received.push(update);
  if (!update.data) return;
  localCache.cacheLocalAchievements(update.data, update.stateAppId);
  const shortcut = Number(update.stateAppId), steam = update.steamAppId;
  // The same exact-target/idle boundary used by the UI: own cache is immediate,
  // own DOM may wait, and neither operation may ever publish to Steam's stores.
  void interaction.runWhenLibrarySidebarIdle(doc, 'plugin-achievements', () => {
    if (doc.route !== shortcut || shortcuts.get(shortcut) !== steam) return;
    const current = localCache.getCachedLocalAchievementsForShortcut(steam, shortcut);
    if (current) pluginPaints.push({ shortcut, unlocked: current.unlocked, total: current.total });
  });
});
const data = (shortcut, unlocked) => ({ found: true, appid: shortcuts.get(shortcut), metadata_appid: shortcuts.get(shortcut),
  state_appid: String(shortcut), total: 4, unlocked, achievements: [] });
const assertNativeUnchanged = label => {
  check(nativeMutations.length === 0 && nativeSubscriberSignals.length === 0, `${label}: zero global native writes and subscriber invalidations`);
  check(JSON.stringify([...overviews]) === overviewSnapshot && JSON.stringify(rows) === sidebarSnapshot,
    `${label}: every native overview, icon and title stays unchanged`);
  check(mapCache.size === nativeEntries.size && [...nativeEntries].every(([id, entry]) => mapCache.get(id) === entry),
    `${label}: native progress object identities remain intact with no shortcut aliases`);
};
const begin = shortcut => service.fetchLocalAchievementData(shortcuts.get(shortcut), { stateAppId: String(shortcut), maxAgeMs: 0 });
const resolve = async (request, value) => { request.resolve(JSON.stringify(value)); await drain(); };

// Include the microtask gap before the FIRST wheel. Deferring writes only once
// a wheel has already occurred cannot satisfy this regression contract.
for (let cycle = 0; cycle < 20; cycle++) {
  const shortcut = [...shortcuts.keys()][cycle % shortcuts.size];
  doc.route = 570; service.clearLocalAchievementRequestCache();
  assertNativeUnchanged(`Native before cycle ${cycle}`);
  doc.route = shortcut;
  const beforeWheel = begin(shortcut);
  await resolve(requests.at(-1), data(shortcut, 1)); await beforeWheel;
  assertNativeUnchanged(`External selection before first wheel ${cycle}`);
  check(pluginPaints.at(-1)?.shortcut === shortcut && pluginPaints.at(-1)?.unlocked === 1,
    'Cached/early external progress remains available immediately in the plugin-owned UI');
  doc.fire('wheel');
  await advance(1);
  const duringWheel = begin(shortcut);
  await resolve(requests.at(-1), data(shortcut, 2)); await duringWheel;
  assertNativeUnchanged(`IPC immediately after first wheel ${cycle}`);
  for (let step = 0; step < 10; step++) {
    await advance(30); doc.fire('wheel');
    service.publishAchievementUpdate({ steamAppId: shortcuts.get(shortcut), stateAppId: String(shortcut), data: data(shortcut, 3) });
  }
  assertNativeUnchanged(`Continuous rapid wheel ${cycle}`);
  check(localCache.getCachedLocalAchievementsForShortcut(shortcuts.get(shortcut), shortcut)?.unlocked === 3,
    'The exact local shortcut cache receives backend and live progress while scrolling');
  await advance(181);
  check(pluginPaints.at(-1)?.shortcut === shortcut && pluginPaints.at(-1)?.unlocked === 3,
    'One latest plugin-owned UI snapshot is delivered after the actual quiet period');
  assertNativeUnchanged(`After wheel idle ${cycle}`);
  const afterIdle = begin(shortcut);
  await resolve(requests.at(-1), data(shortcut, 4)); await afterIdle;
  check(pluginPaints.at(-1)?.unlocked === 4, 'A real changed count continues updating the own UI when idle');
  assertNativeUnchanged(`Changed progress after idle ${cycle}`);
  await advance(1);
  const externalToNative = begin(shortcut);
  doc.route = 570; await resolve(requests.at(-1), data(shortcut, 2)); await externalToNative;
  assertNativeUnchanged(`Late external IPC on native destination ${cycle}`);
  const previousPaints = pluginPaints.length;
  await advance(3_100);
  check(pluginPaints.length === previousPaints, 'A late response cannot create external UI on a native destination');
  assertNativeUnchanged(`Native destination after startup/watchdog interval ${cycle}`);
}
check((await progress.getAchievementProgress(570, 0)).unlocked === 41, 'The actual read-only progress reader still reads a hydrated native value');
check((await progress.getAchievementProgress(456, 4)).unlocked === 0, 'Missing native data uses a local fallback count without QueueCacheUpdate');
assertNativeUnchanged('After real native progress reads');
check(received.length === 20 * 14, 'All actual backend and live publisher updates reach plugin subscribers without native cache publication');
check(storage.size > 0, 'Plugin-owned persistent snapshots remain enabled');
unsubscribe(); interaction.installLibrarySidebarInteraction(doc)();
console.log(`Sidebar navigation isolation passed: ${checks} assertions; actual IPC/service/local-cache/progress reader, immediate selection+wheel, results before/during/after scroll and native route retirement; zero global native cache/model writes.`);
