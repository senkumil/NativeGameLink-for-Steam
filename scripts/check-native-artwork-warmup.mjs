import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const SID = 3300000001;
let verified = true, mappings = {}, now = 0, nextTimer = 1;
const timers = new Map(), subscriptions = new Set(), createdImages = [], runtimeRequires = [];
const inventoryReadinessCalls = [], inventoryRetryResults = [];
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
  constructor() { createdImages.push(this); }
  set src(value) { this.currentSrc = value; this.requestedSrc = value; }
  get src() { return this.currentSrc; }
  removeAttribute(name) { assert.equal(name, 'src'); this.currentSrc = undefined; }
  finish() { this.onload?.(); }
}
function finishImagesFrom(start) {
  for (let index = start; index < createdImages.length; index++) {
    assert(createdImages.filter(image => image.currentSrc).length <= 2, 'At most two logo image requests are active');
    createdImages[index].finish();
  }
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
  const details = { GetAppData: () => ({}), GetAchievements() {}, GetCustomLogoPosition(overview) { calls.push(overview); return null; } };
  const appStore = {
    GetAppOverviewByAppID: id => apps.get(id < 0 ? id >>> 0 : id),
    GetCustomLogoImageURLs: overview => ['jpg', 'png'].map(ext => `/customimages/${overview.appid}_logo.${ext}?v=${overview.rt_custom_image_mtime}`),
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
    getRequire(doc) { return id => { runtimeRequires.push(id); const stores = moduleStores.get(doc); return id === 78057 ? { H: stores?.details } : id === 1776 ? { tw: stores?.apps } : null; }; },
    getAllModules() { return []; },
  } },
  './native-route': { routedSteamAppId: doc => doc.routeId },
  './native-logo-sources': {
    installNativeLogoSources: () => () => {},
    refreshNativeLogoInventoryReadiness: async doc => { inventoryReadinessCalls.push(doc); return inventoryRetryResults.shift() || false; },
  },
};
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
const { warmNativeShortcutArtwork: warm, warmMappedNativeArtwork: warmMapped } = context.exports;
const selectRoute = (doc, id) => { doc.routeId = id; return warm(doc, id, true); };
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
  const { doc, calls, listeners } = fixture(ids);
  const beforeImages = createdImages.length, dispose = install(doc);
  assert.equal(install(doc), dispose, 'Installation is idempotent');
  assert(calls.length <= 6, 'Startup position reads begin in a small batch');
  assert.equal(createdImages.length, beforeImages + 2, 'Startup logo warming starts only two small local images');
  finishImagesFrom(beforeImages);
  runTimers(); assert.equal(calls.length, 12, 'All mapped custom positions are warmed');
  assert.equal(createdImages.length, beforeImages + 12, 'All mapped logos warm progressively without requiring hover');
  assert(createdImages.slice(beforeImages).every(image => /_logo\.png\?/.test(image.requestedSrc)), 'Existing PNG logos avoid unnecessary JPG misses');
  assert.equal(listeners.size, 3, 'Only the independently shared scroll interaction listeners remain');
  assert(!listeners.has('pointerdown') && !listeners.has('pointerover') && !listeners.has('focusin'), 'Artwork warming installs no native game-list selection, hover or focus listener');
  const row = new FakeNode({ 'data-appid': String(SID) });
  listeners.get('pointerover')?.({ target: row });
  assert.equal(createdImages.length, beforeImages + 12, 'Hover reuses logos already warmed in the background');
  for (let index = 0; index < 200; index++) listeners.get('pointerover')?.({ target: row });
  assert.equal(createdImages.length, beforeImages + 12, 'Repeated virtual-row hover events do not reload logos');
  assert.equal(calls.length, 12, 'Hover reuses the pending/cached position read');
  assert(createdImages.slice(beforeImages).every(image => !image.currentSrc && !image.onload && !image.onerror), 'Decoded images and event closures are released after warming');
  const ignored = new FakeNode({ 'data-appid': String(SID + 1) }, null, false);
  listeners.get('pointerdown')?.({ target: ignored }); assert.equal(createdImages.length, beforeImages + 12, 'Native game-list pointer events initiate no artwork work');
  dispose(); assert.equal(listeners.size, 0); assert.equal(subscriptions.size, 0); assert.equal(timers.size, 0);
}
{
  reset([SID]); const { doc, calls, apps, details } = fixture();
  const originalAchievements = details.GetAchievements;
  delete doc.defaultView.appDetailsStore; delete doc.defaultView.appStore;
  warm(doc, SID);
  assert.equal(calls.length, 1); assert.deepEqual(runtimeRequires.slice(-2), [78057, 1776], 'Fallback resolves only same-realm native stores');
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
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc } = fixture(ids), start = createdImages.length;
  for (const id of ids) warm(doc, id, true);
  assert.equal(createdImages.length, start + 2, 'Rapid navigation keeps at most two images in flight');
  finishImagesFrom(start); runTimers();
  assert.equal(createdImages.length, start + 6, 'Rapid navigation retains at most four pending logo URLs');
  assert(createdImages.slice(start).every(image => !image.currentSrc), 'Completed image requests release their resources');
}
{
  reset([SID]); const { doc, appStore, listeners } = fixture();
  const dispose = install(doc), start = createdImages.length;
  appStore.GetCustomLogoImageURLs = () => ['https://cdn.example.com/huge.png', '/customimages/3300000001_hero.jpg'];
  selectRoute(doc, SID);
  assert.equal(createdImages.length, start, 'Remote images and large hero images are never warmed');
  dispose();
}
{
  reset([SID]); const { doc, listeners, apps, calls } = fixture([SID, SID + 1]);
  const dispose = install(doc), start = createdImages.length;
  reset([SID, SID + 1]);
  const child = new FakeNode({}, new FakeNode({}, null));
  Object.defineProperty(child.parentElement, '__reactFiber$test', { enumerable: true, get() { throw new Error('The native row fiber must remain unread'); } });
  listeners.get('pointerdown')?.({ target: child });
  assert.equal(createdImages.length, start, 'Clicking a native row neither reads its React fiber nor warms artwork');
  selectRoute(doc, SID + 1);
  assert.equal(createdImages.length, start + 1, 'The committed route primes its logo immediately without inspecting a native row');
  const replacement = SID + 20; apps.set(replacement, { ...apps.get(SID), appid: replacement }); reset([SID, replacement]);
  for (const callback of subscriptions) callback();
  assert(calls.some(overview => overview.appid === replacement), 'Mapping changes warm new verified native positions');
  dispose(); assert.equal(timers.size, 0, 'Disposal cancels native warmup work');
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
  doc.defaultView.appDetailsStore = { GetCustomLogoPosition: overview => replacementCalls.push(overview) };
  warm(doc, SID); assert.equal(replacementCalls.length, 1, 'A native store replacement refreshes the per-document cache');
}
{
  reset([SID]); const { doc } = fixture(); const start = createdImages.length;
  warm(doc, SID, true);
  assert.match(createdImages[start].requestedSrc, /_logo\.png\?/);
  createdImages[start].onerror();
  assert.match(createdImages[start + 1].requestedSrc, /_logo\.jpg\?/, 'A missing PNG falls back to the original native JPG candidate');
  runTimers();
  assert(!createdImages[start + 1].currentSrc && !createdImages[start + 1].onload, 'Timeout releases native JPG fallback resources');
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
  reset([SID]); const { doc } = fixture(), beforeReadiness = inventoryReadinessCalls.length, beforeImages = createdImages.length;
  inventoryRetryResults.push(true, true, true, true);
  const dispose = install(doc); finishImagesFrom(beforeImages);
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
  const dispose = install(doc), initialImages = createdImages.length;
  finishImagesFrom(initialImages - 1); runTimers();
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
  assert.equal(createdImages.length, beforeImages, 'Nonselected background images wait for sidebar idle');
  const selected = SID + 100;
  selectRoute(doc, selected);
  assert.equal(calls.at(-1).appid, selected, 'Actual route synchronization primes its native position immediately during wheel');
  assert.equal(calls.length, beforePositions + 1);
  assert.equal(createdImages.length, beforeImages + 1, 'Actual route synchronization starts its logo immediately while background work is deferred');
  listeners.get('scroll')({ target: new FakeNode() });
  advanceTimers(100);
  assert.equal(calls.length, beforePositions + 1, 'Background position work stays paused throughout continuing scroll');
  finishImagesFrom(beforeImages);
  assert.equal(createdImages.length, beforeImages + 1, 'Completing selected artwork does not drain background requests during wheel');
  runTimers();
  assert(calls.some(overview => overview.appid === SID + 1), 'Background caches resume after actual scroll becomes idle');
  dispose(); assert.equal(timers.size, 0);
}
{
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc, calls, listeners } = fixture(ids), beforeImages = createdImages.length;
  const dispose = install(doc), beforePositions = calls.length;
  listeners.get('wheel')({ target: new FakeNode() });
  createdImages[beforeImages].finish();
  assert.equal(createdImages.length, beforeImages + 2, 'A completed background image cannot start its queued successor during wheel');
  advanceTimers(50);
  assert.equal(calls.length, beforePositions, 'A position-batch timer firing during wheel waits for idle');
  context.exports.installNativeArtworkWarmup(doc)();
  runTimers();
  assert.equal(calls.length, beforePositions, 'Disposal cancels pending background position batches');
  assert.equal(createdImages.length, beforeImages + 2, 'Disposal cancels pending background image and logo drains');
  assert.equal(listeners.size, 3, 'Warmup disposal leaves the independently owned scroll controller intact');
  dispose();
}
{
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc, calls, listeners } = fixture(ids), beforeImages = createdImages.length;
  const dispose = install(doc);
  listeners.get('wheel')({ target: new FakeNode() });
  selectRoute(doc, SID + 11);
  assert.equal(calls.at(-1).appid, SID + 11, 'Selected position priming does not wait for existing background logo downloads');
  assert.equal(createdImages.length, beforeImages + 3, 'Selection replaces one background preload immediately when both image slots are occupied');
  assert(createdImages.filter(image => image.currentSrc).length <= 2, 'Foreground priority preserves the global two-image concurrency bound');
  dispose();
}
{
  const ids = Array.from({ length: 12 }, (_, index) => SID + index); reset(ids);
  const { doc, listeners } = fixture(ids), beforeImages = createdImages.length;
  const dispose = install(doc);
  listeners.get('wheel')({ target: new FakeNode() });
  selectRoute(doc, SID);
  createdImages[beforeImages].onerror();
  assert.equal(createdImages.length, beforeImages + 3, 'A promoted selected preload retains immediate fallback priority during wheel');
  assert.match(createdImages.at(-1).requestedSrc, /_logo\.jpg\?/);
  dispose();
}
console.log('Native artwork warmup: exact verified identity, native position cache, same-realm resolver, bounded local-logo warming and lifecycle checks passed.');
