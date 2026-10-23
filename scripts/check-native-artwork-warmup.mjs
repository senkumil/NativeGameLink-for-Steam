import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { nativeArtworkStoresRuntime } from './helpers/native-artwork-stores-runtime.mjs';

const SID = 3300000001;
let verified = true, mappings = {}, now = 0, nextTimer = 1;
const timers = new Map(), subscriptions = new Set(), createdImages = [], runtimeRequires = [];
const inventoryReadinessCalls = [], inventoryRetryResults = [], sourceInstallCalls = [], sourceDisposals = [];
const sourceOwners = new WeakMap();
let imageUrlReads = 0;
let runtimeProbes = 0;
const moduleStores = new WeakMap();
const setTimer = (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; };
const runTimers = (maximum = 1000) => {
  for (let step = 0; timers.size && step < maximum; step++) {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    timers.delete(id); now = timer.at; timer.callback();
  }
  assert.equal(timers.size, 0, 'Warmup timers terminate');
};
const advanceTimers = duration => {
  const end = now + duration;
  for (;;) {
    const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (!first || first[1].at > end) break;
    const [id, timer] = first; timers.delete(id); now = timer.at; timer.callback();
  }
  now = end;
};
class FakeImage {
  constructor() { createdImages.push(this); throw new Error('Artwork image loading belongs to Steam'); }
}
class FakeNode {
  nodeType = 1;
  constructor(attrs = {}, parent = null, sidebar = true) { this.attrs = attrs; this.parentElement = parent; this.sidebar = sidebar; }
  getAttribute(name) { return this.attrs[name] ?? null; }
}
function fixture(ids = [SID]) {
  const calls = [], apps = new Map(), listeners = new Map();
  const classified = () => true;
  for (const id of ids) apps.set(id, { appid: id, rt_custom_image_mtime: 10, BHasCustomImages: () => true, BIsModOrShortcut: classified, icon_data: 'original-icon' });
  const details = { GetAppData: () => ({}), SaveCustomLogoPosition() {}, GetAchievements() {}, GetCustomLogoPosition(overview) { calls.push(overview); return null; } };
  const appStore = {
    GetAppOverviewByAppID: id => apps.get(id < 0 ? id >>> 0 : id),
    GetCustomLogoImageURLs: overview => { imageUrlReads++; return ['jpg', 'png'].map(ext => `/customimages/${overview.appid}_logo.${ext}?v=${overview.rt_custom_image_mtime}`); },
  };
  const doc = {
    defaultView: { appDetailsStore: details, appStore, Image: FakeImage, location: { href: 'https://steamloopback.host/library' }, setTimeout: setTimer, clearTimeout: id => timers.delete(id) },
    routeId: null,
    addEventListener(name, callback) { assert(!listeners.has(name)); listeners.set(name, callback); },
    removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
  };
  doc.defaultView.document = doc;
  moduleStores.set(doc, { details, apps: appStore });
  return { doc, calls, apps, details, appStore, listeners, classified };
}
const dependencies = {
  '../../core/mappings': {
    isMappingSnapshotVerified: () => verified,
    get mappings() { return mappings; },
    shortcutMappingKey: id => `shortcut:${id}`,
    subscribeMappings(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); },
  },
  '../../steam/library-sidebar': { isLibrarySidebarNode(target) { for (let node = target; node; node = node.parentElement) if (node.sidebar) return true; return false; } },
  '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: {
    captureRuntime() { runtimeProbes++; },
    getRuntimeIdentity: doc => doc,
    getModuleFactoryCount: () => 0,
    getModuleFactories: () => [],
    getAllModules(doc) { runtimeRequires.push('loaded'); const stores = moduleStores.get(doc);
      return stores ? [{ id: 'updated-details', exports: { renamed: stores.details } }, { id: 'updated-apps', exports: { another: stores.apps } }] : []; },
    getRequire(doc) { return id => { runtimeRequires.push(id); const stores = moduleStores.get(doc); return id === 78057 ? { H: stores?.details } : id === 1776 ? { tw: stores?.apps } : null; }; },
  } },
  './native-route': { routedSteamAppId: doc => doc.routeId },
  './native-logo-sources': {
    installNativeLogoSources: (doc, suppliedApps) => {
      sourceInstallCalls.push({ doc, apps: suppliedApps });
      const apps = suppliedApps || doc.defaultView.appStore, previous = sourceOwners.get(doc);
      if (previous && previous.apps === apps) return previous.dispose;
      previous?.dispose();
      if (!apps) return () => {};
      const owner = { apps, dispose() { if (sourceOwners.get(doc) !== owner) return; sourceOwners.delete(doc); sourceDisposals.push(doc); } };
      sourceOwners.set(doc, owner); return owner.dispose;
    },
    refreshNativeLogoInventoryReadiness: async doc => { inventoryReadinessCalls.push(doc); return inventoryRetryResults.shift() || false; },
  },
};
dependencies['./native-artwork-stores'] = nativeArtworkStoresRuntime(dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime, { Date: { now: () => now } });
const idleContext = vm.createContext({ exports: {}, Date: { now: () => now }, require: name => {
  assert.equal(name, './library-sidebar'); return dependencies['../../steam/library-sidebar'];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/sidebar-interaction.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, idleContext);
dependencies['../../steam/sidebar-interaction'] = idleContext.exports;
const context = vm.createContext({ exports: {}, URL, Map, WeakMap, Number, Date: { now: () => now }, setTimeout: setTimer, clearTimeout: id => timers.delete(id), require: name => {
  assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/native-artwork-warmup.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { warmNativeShortcutArtwork: warm } = context.exports;
const selectRoute = (doc, id) => { doc.routeId = id; return warm(doc, id); };
const install = doc => {
  const dispose = context.exports.installNativeArtworkWarmup(doc);
  if (doc.testWarmupDispose) return doc.testWarmupDispose;
  doc.testWarmupDispose = () => { dispose(); idleContext.exports.installLibrarySidebarInteraction(doc)(); };
  return doc.testWarmupDispose;
};
const reset = ids => { mappings = Object.fromEntries(ids.map(id => [`shortcut:${id}`, '1030300'])); verified = true; };

{
  reset([SID]); const { doc, calls, apps, classified } = fixture();
  const overview = apps.get(SID), initial = Object.getOwnPropertyDescriptors(overview);
  verified = false; assert.equal(warm(doc, SID), false); assert.equal(calls.length, 0, 'Unverified persisted mappings cannot trigger native reads');
  verified = true; mappings = { 'title:Test': '1030300' }; assert.equal(warm(doc, SID), false, 'Title-only mappings are excluded');
  reset([SID]); assert.equal(warm(doc, SID), true);
  for (let index = 0; index < 200; index++) warm(doc, SID);
  assert.equal(calls.length, 1, 'Pending native position reads are deduplicated');
  assert.equal(createdImages.length, 0, 'Position warming never decodes an image');
  assert.deepEqual(Object.getOwnPropertyDescriptors(overview), initial, 'Native overview properties remain untouched');
  assert.equal(overview.BIsModOrShortcut, classified); assert.equal(overview.icon_data, 'original-icon');
  overview.rt_custom_image_mtime = 11; warm(doc, SID); assert.equal(calls.length, 2, 'A native mtime change refreshes position data');
  assert.equal(warm(doc, SID - 4294967296), true, 'Signed shortcut IDs resolve to the original native overview');
  mappings = { [`shortcut:${SID - 4294967296}`]: '1030300' };
  assert.equal(warm(doc, SID), true, 'Legacy exact signed-ID mapping keys are accepted without title matching');
  assert.equal(warm(doc, SID - 8589934592), false, 'Out-of-range wrapped IDs are rejected');
}
{
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc, calls, listeners, appStore } = fixture(ids), beforeSources = sourceInstallCalls.length, beforeDisposals = sourceDisposals.length;
  const dispose = install(doc);
  assert.equal(install(doc), dispose, 'Installation is idempotent');
  assert(calls.length <= 4, 'Startup position reads begin in a small batch');
  assert.equal(createdImages.length, 0, 'Startup creates no image preload');
  runTimers(); assert.equal(calls.length, 12, 'All mapped custom positions are warmed');
  assert.equal(imageUrlReads, 0, 'Startup metadata warming does not request artwork candidates');
  assert(sourceInstallCalls.slice(beforeSources).some(call => call.doc === doc && call.apps === appStore), 'Resolved stores retain the native logo source-order adapter');
  assert.equal(listeners.size, 3, 'Only the independently shared scroll interaction listeners remain');
  assert(!listeners.has('pointerdown') && !listeners.has('pointerover') && !listeners.has('focusin'), 'Artwork metadata warming installs no native selection, hover or focus listeners');
  const row = new FakeNode({ 'data-appid': String(SID) });
  for (let index = 0; index < 100; index++) {
    listeners.get('pointerover')?.({ target: row });
    listeners.get('focusin')?.({ target: row });
    listeners.get('pointerdown')?.({ target: row });
  }
  assert.equal(calls.length, 12, 'One hundred native row events start no additional metadata reads');
  assert.equal(createdImages.length, 0, 'One hundred native row events start no image loads');
  dispose(); assert.equal(listeners.size, 0); assert.equal(subscriptions.size, 0); assert.equal(timers.size, 0);
  assert.equal(sourceDisposals.length, beforeDisposals + 1, 'Disposal releases native source-adapter ownership exactly once');
}
{
  reset([SID]); const { doc, calls, apps, details } = fixture();
  const originalAchievements = details.GetAchievements;
  delete doc.defaultView.appDetailsStore; delete doc.defaultView.appStore;
  warm(doc, SID);
  assert.equal(calls.length, 1); assert.equal(runtimeRequires.at(-1), 'loaded', 'Fallback resolves current same-realm exports without private module IDs');
  const initialRequires = runtimeRequires.length;
  for (let index = 0; index < 100; index++) warm(doc, SID);
  assert.equal(runtimeRequires.length, initialRequires, 'Resolved native stores are cached between early sync callbacks');
  assert.equal(details.GetAchievements, originalAchievements, 'Fallback installs no Big Picture/component guards');
  const overview = apps.get(SID);
  for (let mtime = 12; mtime < 142; mtime++) { overview.rt_custom_image_mtime = mtime; warm(doc, SID); }
  const count = calls.length; overview.rt_custom_image_mtime = 10; warm(doc, SID);
  assert.equal(calls.length, count + 1, 'The position deduplication cache is bounded');
}
{
  const ids = Array.from({ length: 100 }, (_, index) => SID + index); reset(ids);
  const { doc, calls, apps, listeners } = fixture(ids), dispose = install(doc);
  const child = new FakeNode({}, new FakeNode({}, null));
  Object.defineProperty(child.parentElement, '__reactFiber$test', { enumerable: true, get() { throw new Error('The native row fiber must remain unread'); } });
  listeners.get('pointerdown')?.({ target: child });
  for (const id of ids) selectRoute(doc, id);
  assert.equal(calls.length, 100, 'Actual route synchronization primes only native position metadata');
  assert.equal(createdImages.length, 0, 'One hundred committed routes create no images');
  assert.equal(imageUrlReads, 0, 'Route synchronization leaves artwork URL selection to native Steam');
  const replacement = SID + 120; apps.set(replacement, { ...apps.get(SID), appid: replacement }); reset([SID, replacement]);
  for (const callback of subscriptions) callback();
  runTimers();
  assert(calls.some(overview => overview.appid === replacement), 'Mapping changes warm new verified native positions');
  assert.equal(createdImages.length, 0, 'Mapping changes create no images');
  dispose(); assert.equal(timers.size, 0, 'Disposal cancels native metadata work');
}
{
  reset([SID]); const { doc, calls } = fixture();
  const savedStores = moduleStores.get(doc); moduleStores.delete(doc);
  delete doc.defaultView.appDetailsStore; delete doc.defaultView.appStore;
  const beforeProbes = runtimeProbes;
  for (let index = 0; index < 100; index++) assert.equal(warm(doc, SID), false);
  assert.equal(runtimeProbes, beforeProbes + 1, 'One hundred early callbacks probe a missing native runtime only once');
  now += 1_001; warm(doc, SID); assert.equal(runtimeProbes, beforeProbes + 2, 'Missing native stores retry after a bounded cooldown');
  doc.defaultView.appDetailsStore = savedStores.details; doc.defaultView.appStore = savedStores.apps;
  assert.equal(warm(doc, SID), true, 'Fresh native globals bypass a missing-runtime cooldown'); assert.equal(calls.length, 1);
  const replacementCalls = [];
  doc.defaultView.appDetailsStore = { GetAppData: () => ({}), SaveCustomLogoPosition() {}, GetCustomLogoPosition: overview => replacementCalls.push(overview) };
  warm(doc, SID); assert.equal(replacementCalls.length, 1, 'A native store replacement refreshes the per-document cache');
}
{
  reset([SID]); const { doc, calls } = fixture(), savedStores = moduleStores.get(doc);
  moduleStores.delete(doc); delete doc.defaultView.appDetailsStore; delete doc.defaultView.appStore;
  const dispose = install(doc);
  setTimer(() => { doc.defaultView.appDetailsStore = savedStores.details; doc.defaultView.appStore = savedStores.apps; }, 1_500);
  runTimers();
  assert.equal(calls.length, 1, 'Bounded background retries warm positions after delayed native-window adoption');
  dispose();
}
{
  reset([SID]); const { doc, apps, calls } = fixture(), overview = apps.get(SID);
  apps.delete(SID); const dispose = install(doc);
  setTimer(() => apps.set(SID, overview), 500); runTimers();
  assert.equal(calls.length, 1, 'A delayed real native overview receives a bounded background retry');
  dispose();
}
{
  reset([SID]); const { doc } = fixture();
  moduleStores.delete(doc); delete doc.defaultView.appDetailsStore; delete doc.defaultView.appStore;
  const beforeProbes = runtimeProbes, dispose = install(doc);
  runTimers();
  assert.equal(runtimeProbes, beforeProbes + 4, 'Unavailable native stores receive only the initial attempt and three retries');
  assert.equal(timers.size, 0, 'Missing native windows never create perpetual polling');
  dispose();
}
{
  reset([SID]); const { doc } = fixture(), beforeReadiness = inventoryReadinessCalls.length;
  inventoryRetryResults.push(true, true, true, true);
  const dispose = install(doc);
  for (let step = 0; step < 4; step++) {
    for (let index = 0; index < 4; index++) await Promise.resolve();
    runTimers();
  }
  for (let index = 0; index < 4; index++) await Promise.resolve();
  assert.equal(inventoryReadinessCalls.length, beforeReadiness + 4, 'Inventory-only readiness uses the initial batch and at most three startup retries');
  assert.equal(timers.size, 0, 'Incomplete or failed logo inventories never create perpetual readiness polling');
  dispose();
}
{
  const ids = Array.from({ length: 101 }, (_, index) => SID + index);
  reset([SID]); const { doc, calls, appStore, listeners } = fixture(ids);
  doc.routeId = SID;
  const dispose = install(doc); runTimers();
  const overviewReads = [], originalOverview = appStore.GetAppOverviewByAppID;
  appStore.GetAppOverviewByAppID = id => { overviewReads.push(id); return originalOverview(id); };
  reset(ids);
  const beforePositions = calls.length, beforeImages = createdImages.length;
  for (const id of ids.slice(1)) {
    const row = new FakeNode({ 'data-appid': String(id) });
    listeners.get('wheel')({ target: row });
    listeners.get('pointerover')?.({ target: row });
    listeners.get('focusin')?.({ target: row });
    advanceTimers(5);
  }
  assert.equal(overviewReads.length, 0, 'One hundred new rows passing under the pointer read no native overview while stationary on a linked game');
  assert.equal(calls.length, beforePositions, 'Rapid row hover/focus starts no native grid.json reads');
  assert.equal(createdImages.length, beforeImages, 'Rapid row hover/focus starts no artwork requests or decodes');
  for (const callback of subscriptions) callback();
  assert(overviewReads.every(id => id === SID), 'Mapping refresh during wheel may prime only the already selected shortcut');
  assert.equal(calls.length, beforePositions, 'Nonselected background positions wait for sidebar idle');
  assert.equal(createdImages.length, beforeImages, 'Mapping refresh during wheel creates no image preload');
  const selected = SID + 100;
  selectRoute(doc, selected);
  assert.equal(calls.at(-1).appid, selected, 'Actual route synchronization primes its native position immediately during wheel');
  assert.equal(calls.length, beforePositions + 1);
  assert.equal(createdImages.length, beforeImages, 'Actual route synchronization starts no logo preload while background metadata work is deferred');
  listeners.get('scroll')({ target: new FakeNode() });
  advanceTimers(100);
  assert.equal(calls.length, beforePositions + 1, 'Background position work stays paused throughout continuing scroll');
  runTimers();
  assert(calls.some(overview => overview.appid === SID + 1), 'Background caches resume after actual scroll becomes idle');
  dispose(); assert.equal(timers.size, 0);
}
{
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc, calls, listeners } = fixture(ids), dispose = install(doc), beforePositions = calls.length;
  listeners.get('wheel')({ target: new FakeNode() });
  advanceTimers(50);
  assert.equal(calls.length, beforePositions, 'A position-batch timer firing during wheel waits for idle');
  context.exports.installNativeArtworkWarmup(doc)();
  runTimers();
  assert.equal(calls.length, beforePositions, 'Disposal cancels pending background position batches');
  assert.equal(listeners.size, 3, 'Warmup disposal leaves the independently owned scroll controller intact');
  dispose();
}
{
  const ids = Array.from({ length: 160 }, (_, index) => SID + index); reset(ids);
  const { doc, calls } = fixture(ids), dispose = install(doc);
  runTimers();
  assert.equal(calls.length, 128, 'The background metadata batch remains bounded even with a large mapped library');
  assert.equal(createdImages.length, 0, 'A large mapped library starts no artwork image preloads');
  dispose();
}
{
  reset([SID]); const { doc } = fixture(), beforeReadiness = inventoryReadinessCalls.length;
  inventoryRetryResults.length = 0;
  inventoryRetryResults.push(true);
  const dispose = install(doc);
  dispose();
  for (let index = 0; index < 4; index++) await Promise.resolve();
  assert.equal(inventoryReadinessCalls.length, beforeReadiness + 1, 'Startup preserves the native logo inventory readiness check');
  assert.equal(timers.size, 0, 'A pending inventory response cannot schedule retries after disposal');
}
assert.equal(createdImages.length, 0, 'Startup, navigation, mapping changes, retries and row events never instantiate Image');
assert.equal(imageUrlReads, 0, 'Metadata warmup never invokes native artwork URL selection');
console.log('Native artwork metadata warmup: zero image preloads, exact verified identity, bounded native positions, retained inventory/source adapter and lifecycle checks passed.');
