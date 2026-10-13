import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, ...globals, require: name => {
    assert(name in dependencies, `Unexpected ${file} dependency: ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
let now = 1_000;
const timers = new Map();
let timerId = 0;
class Clock extends Date { static now() { return now; } }
function makeDoc() {
  const listeners = new Map();
  const doc = { body: {}, hidden: false, route: null, home: true,
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    querySelectorAll() { return []; },
    wheel() { for (const listener of listeners.get('wheel') || []) listener({ target: { sidebar: true } }); },
  };
  doc.defaultView = { document: doc, closed: false,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return doc;
}
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
async function advance(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  await flush();
}
const sidebar = load('frontend/steam/sidebar-interaction.ts', {
  './library-sidebar': { isLibrarySidebarNode: target => Boolean(target?.sidebar) },
}, { Date: Clock });
const doc = makeDoc();
sidebar.installLibrarySidebarInteraction(doc, true);
const id = 3_000_000_001, secondId = id + 1;
let storeWrites = 0, descriptorWrites = 0, backendReads = 0, nativeReads = 0, cardPatches = 0;
let renderedSnapshots = [];
const app = (appId = id) => new Proxy({ appid: appId, minutes_playtime_forever: 0, minutes_playtime_last_two_weeks: 0,
  rt_last_time_played: 0, rt_recent_activity_time: 0 }, {
  set(target, key, value) { storeWrites++; target[key] = value; return true; },
  defineProperty(target, key, descriptor) { descriptorWrites++; return Reflect.defineProperty(target, key, descriptor); },
});
const apps = new Map([[id, app()], [secondId, app(secondId)]]);
let mapped = [{ id, title: 'A', steamAppId: '111' }, { id: secondId, title: 'B', steamAppId: '222' }];
let respondBatch, respondNative;
let nativeDeferred = false;
const stats = { minutesForever: 120, minutesLastTwoWeeks: 30, lastPlayedAt: 1_700_000_000 };
const home = load('frontend/features/playtime/library-home.ts', {
  '../../steam/shortcuts': { getMappedShortcuts: () => mapped,
    getShortcutAppById: value => apps.get(value),
    getShortcutPlaytimeMinutes: () => { nativeReads++; return nativeDeferred ? new Promise(resolve => { respondNative = resolve; }) : Promise.resolve(0); },
  },
  './service': { fetchPlaytimeStatsBatch: () => { backendReads++; return new Promise(resolve => { respondBatch = resolve; }); } },
  './format': { formatPlaytimeMinutes: String },
  './playtime-settings': { isShortcutPlaytimeTrackingEnabled: () => true },
  '../../steam/css': { APP_PORTRAIT_CLASS_MODULE: () => ({ classes: { LibraryItemBox: 'HomeCard', PlayedRecent: 'PlayedRecent' } }) },
  '../../steam/native-dom': { elementsWithCssModuleClass: target => target.home ? [{ closest: () => null }] : [], isRenderedElement: () => true },
  '../../steam/library-sidebar': { isLibrarySidebarNode: () => false },
  '../../steam/sidebar-interaction': sidebar,
  '../library/native-route': { routedSteamAppId: target => target.route, isPublicSteamLibraryRoute: target => target.route > 0 && target.route < 2_147_483_648 },
  './library-home-dom': { patchDesktopLibraryHomePlaytimeCards(_doc, snapshots) { cardPatches++; renderedSnapshots = snapshots; } },
}, { localStorage: { getItem: () => null, setItem() {} } });

doc.route = id;
for (let index = 0; index < 100; index++) { home.syncDesktopLibraryHomePlaytimeDom(doc); await home.patchDesktopLibraryHomePlaytime(doc); }
check(storeWrites === 0 && backendReads === 0 && cardPatches === 0, 'stationary external details never hydrate any native AppOverview or shelf');
doc.route = null; doc.home = false;
await home.patchDesktopLibraryHomePlaytime(doc);
check(backendReads === 0, 'an empty/non-shelf Library surface does not authorize hydration');
doc.home = true;
const obsoleteBatch = home.patchDesktopLibraryHomePlaytime(doc);
check(backendReads === 1, 'a visible native Home shelf starts one canonical batch');
doc.route = id; doc.wheel(); respondBatch(new Map([[id, stats], [secondId, stats]])); await obsoleteBatch;
check(storeWrites === 0 && nativeReads === 0, 'a Home batch resolving while external details are selected writes no AppOverview');
await advance(181);
check(storeWrites === 0, 'old Home work cannot commit after scrolling stops on external details');

doc.route = null;
const scrollingHome = home.patchDesktopLibraryHomePlaytime(doc);
doc.wheel(); respondBatch(new Map([[id, stats], [secondId, stats]])); await flush();
check(storeWrites === 0, 'fresh Home batch results wait while the sidebar is scrolling');
await advance(181); await scrollingHome;
check(renderedSnapshots.some(snapshot => snapshot.shortcutAppId === id && snapshot.minutesForever === 120)
  && renderedSnapshots.some(snapshot => snapshot.shortcutAppId === secondId && snapshot.minutesRecent === 30),
  'visible Home cards receive canonical plugin snapshots after the list is quiet');
check(storeWrites === 0 && descriptorWrites === 0 && [...apps.values()].every(overview => overview.minutes_playtime_forever === 0),
  'Home hydration reads native AppOverview fields without setters or property descriptor changes');
check(!('setDesktopPlaytimeField' in home) && !('isDesktopLibraryPlaytimeHydrated' in home),
  'native model-writing and hydration marker APIs are removed from the Home module');
const stableWrites = storeWrites;
for (let index = 0; index < 100; index++) home.syncDesktopLibraryHomePlaytimeDom(doc);
check(storeWrites === stableWrites, '100 identical persisted Home snapshots do not invalidate native observable fields');
doc.route = 570;
home.syncDesktopLibraryHomePlaytimeDom(doc); await home.patchDesktopLibraryHomePlaytime(doc);
check(storeWrites === stableWrites && backendReads === 2, 'public Steam game routes remain entirely outside Home hydration');

// The AppOverview itself can be replaced while Steam's asynchronous native read runs.
doc.route = null; apps.set(id, app()); mapped = [mapped[0]]; nativeDeferred = true;
const replacedOverview = home.patchDesktopLibraryHomePlaytime(doc);
apps.set(id, app());
respondBatch(new Map([[id, stats]])); await flush();
check(typeof respondNative === 'function', 'the replacement zero overview starts a real asynchronous native playtime read');
const beforeReplacement = storeWrites; apps.set(id, app()); respondNative(10); await replacedOverview;
check(storeWrites === beforeReplacement, 'a replaced overview is never mutated by an earlier asynchronous native read');

// A large shelf must retain exact card snapshots without global native writes.
nativeDeferred = false;
function bulkHome(firstId, count = 96) {
  mapped = Array.from({ length: count }, (_value, index) => ({ id: firstId + index, title: `Bulk ${index}`, steamAppId: String(1_000 + index) }));
  apps.clear();
  for (const shortcut of mapped) apps.set(shortcut.id, app(shortcut.id));
  return new Map(mapped.map((shortcut, index) => [shortcut.id, { ...stats, minutesForever: 120 + index, minutesLastTwoWeeks: 30 + index }]));
}
const bulkValues = bulkHome(3_100_000_000);
doc.route = null; doc.wheel();
const beforeBulk = storeWrites, bulkRequest = home.patchDesktopLibraryHomePlaytime(doc);
respondBatch(bulkValues); await flush();
check(storeWrites === beforeBulk, '96 native Home results perform zero store writes while the list is scrolling');
await advance(181); await bulkRequest;
check(storeWrites === 0 && descriptorWrites === 0 && mapped.every(shortcut => apps.get(shortcut.id).minutes_playtime_forever === 0
  && apps.get(shortcut.id).minutes_playtime_last_two_weeks === 0),
  'all 96 native Home overviews stay unchanged even after quiet');
check(mapped.every(shortcut => renderedSnapshots.some(snapshot => snapshot.shortcutAppId === shortcut.id
  && snapshot.minutesForever === bulkValues.get(shortcut.id).minutesForever)),
  'all 96 Home cards receive their exact canonical totals from plugin-owned snapshots');

const retiredValues = bulkHome(3_200_000_000);
doc.wheel();
const beforeRetiredBulk = storeWrites, beforeRetiredCards = cardPatches, retiredBulk = home.patchDesktopLibraryHomePlaytime(doc);
respondBatch(retiredValues); await flush();
doc.route = id; await advance(181); await retiredBulk;
check(storeWrites === beforeRetiredBulk && cardPatches === beforeRetiredCards,
  'switching to external details retires the queued Home-card update without any native-model mutation');

const cancelledValues = bulkHome(3_300_000_000);
doc.route = null; doc.wheel();
const beforeCancelledBulk = storeWrites, beforeCancelledCards = cardPatches, cancelledBulk = home.patchDesktopLibraryHomePlaytime(doc);
respondBatch(cancelledValues); await flush();
sidebar.cancelLibrarySidebarWork(doc); await flush(); await cancelledBulk;
await advance(181);
check(storeWrites === beforeCancelledBulk && cardPatches === beforeCancelledCards,
  'cancelling the Home card queue retires its callbacks without resurrection or native-model mutation');

const disposedValues = bulkHome(3_400_000_000);
doc.wheel();
const beforeDisposedBulk = storeWrites, beforeDisposedCards = cardPatches, disposedBulk = home.patchDesktopLibraryHomePlaytime(doc);
respondBatch(disposedValues); await flush();
sidebar.installLibrarySidebarInteraction(doc)(); await flush(); await disposedBulk;
await advance(181);
check(storeWrites === beforeDisposedBulk && cardPatches === beforeDisposedCards && !sidebar.isLibrarySidebarInteractionActive(doc),
  'disposing the sidebar retires the Home card batch without reviving its lifecycle or mutating native models');
sidebar.installLibrarySidebarInteraction(doc, true);

let achievementWrites = 0, nativeRefreshes = 0;
class ObservableMap extends Map {
  set(key, value) { achievementWrites++; return super.set(key, value); }
  delete(key) { achievementWrites++; return super.delete(key); }
  clear() { achievementWrites++; return super.clear(); }
}
const mapCache = new ObservableMap();
const nativeEntry = { appid: 570, unlocked: 2, total: 5, percentage: 40, cache_time: 7 };
const legacyShortcutEntry = { appid: id, unlocked: 1, total: 4, percentage: 25, cache_time: 2147483647 };
Map.prototype.set.call(mapCache, 570, nativeEntry);
Map.prototype.set.call(mapCache, id, legacyShortcutEntry);
const cache = { m_achievementProgress: { mapCache }, QueueCacheUpdate() { nativeRefreshes++; } };
doc.defaultView.appAchievementProgressCache = cache;
const progress = load('frontend/features/achievements/progress.ts', {
  '../../api/backend': { backendLog() {} }, '../../core/text': { escapeHtml: String },
  '../../steam/css': { ACH_CLASSES: () => ({}) }, '../../steam/localization': { loc: (_token, fallback) => fallback },
}, { window: doc.defaultView, document: doc });
check(!('syncNativeAchievementProgressCache' in progress), 'the native global progress writer is removed entirely');
for (const route of [id, 570, secondId, null]) {
  doc.route = route;
  for (let index = 0; index < 100; index++) {
    check((await progress.getAchievementProgress(570, 0)).unlocked === 2, 'native counts stay readable without cache publication');
    check((await progress.getAchievementProgress(111, 4)).total === 4, 'missing counts use local fallback without native refresh');
    if (index % 3 === 0) doc.wheel();
  }
  await advance(181);
  check(achievementWrites === 0 && nativeRefreshes === 0 && mapCache.size === 2
    && mapCache.get(570) === nativeEntry && mapCache.get(id) === legacyShortcutEntry,
    'selection, rapid wheel and quiet never write, delete or repair native progress entries');
}
check(storeWrites === 0 && descriptorWrites === 0, 'every Home/detail route leaves all native AppOverview models unchanged');
sidebar.installLibrarySidebarInteraction(doc)();
console.log(`Sidebar store isolation passed: ${checks} checks for stationary external details, late Home results, 96 exact card snapshots, read-only native models/progress and zero global cache writes before, during or after scrolling.`);
