import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assetDeadlineRuntime } from './helpers/asset-deadline-runtime.mjs';

const shortcutId = 3000000001, steamId = '1091500';
const markerKey = `gdl_logo_position4_${shortcutId}`;
const defaultPosition = { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 50 };
const official = { pinned_position: 'BottomCenter', width_pct: 31.6311339548, height_pct: 99.6852378114 };
const officialPosition = { pinnedPosition: 'BottomCenter', nWidthPct: official.width_pct, nHeightPct: official.height_pct };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const plain = value => JSON.parse(JSON.stringify(value));
const flushUntil = async predicate => {
 for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
 assert.ok(predicate(), 'Expected asynchronous phase was reached');
};

function harness(options = {}) {
 const storage = new Map(), diskWrites = [], nativeWrites = [];
 const state = { actual: null, nativeActual: null, reads: 0, layouts: 0, readWait: null, diskWait: null,
  bridgeWait: null, bridgeAccepted: true, afterDisk: null, ...options };
 const mocks = {
  ...assetDeadlineRuntime(),
  backendLog() {}, STEAM_DEFAULT_LOGO_POSITION: defaultPosition,
  layoutFingerprint: (logo, hero) => `${logo}|${hero}`,
  readCustomLogoPositionBackend: async () => {
   state.reads++;
   if (state.readWait) await state.readWait;
   return JSON.stringify({ ok: true, exists: Boolean(state.actual), logo_position: state.actual });
  },
  saveCustomLogoPositionBackend: async ({ request_json }) => {
   const request = JSON.parse(request_json); diskWrites.push(request);
   if (state.diskWait) await state.diskWait;
   state.actual = request.logo_position;
   state.afterDisk?.();
   return JSON.stringify({ ok: true });
  },
  saveNativeShortcutLogoPosition: async (id, position, isCurrent) => {
   assert.equal(id, shortcutId);
   assert.equal(isCurrent(), true, 'Only current work may enter the native bridge');
   nativeWrites.push(plain(position));
   if (state.bridgeWait) await state.bridgeWait;
   if (state.bridgeAccepted) state.nativeActual = plain(position);
   return state.bridgeAccepted;
  },
  readLogoLayout: async () => { state.layouts++; return { logo: 'fixture-logo', hero: 'fixture-hero', key: 'pairA' }; },
  prepareAutomaticLogo() { throw new Error('Automatic sizing must never decode the logo'); },
  detectHeroEmptySpace() { throw new Error('Automatic positioning must never analyze the hero'); },
 };
 const context = vm.createContext({ exports: {}, require: () => mocks,
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  setTimeout: callback => { callback(); return 1; }, clearTimeout() {},
 });
 vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/artwork-logo-position.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
 }).outputText, context);
 const api = context.exports;
 const apply = (raw = official, extras = {}) => api.applyLogoPosition(shortcutId, extras.steamId || steamId,
  raw, Boolean(extras.force), extras.pin || 'BottomLeft', extras.source || 'library_assets_full',
  extras.isCurrent || (() => true), extras.layout);
 const marker = () => JSON.parse(storage.get(markerKey) || 'null');
 return { api, apply, marker, storage, state, diskWrites, nativeWrites };
}

{
 const h = harness();
 assert.equal(await h.apply(), true);
 assert.deepEqual(h.nativeWrites, [officialPosition], 'Official percentages retain their full native precision');
 assert.deepEqual(h.diskWrites[0].logo_position, officialPosition);
 assert.equal(h.marker().source, 'native_official');
 assert.equal(h.api.isLogoPositionVerified(shortcutId, steamId), true);
 assert.equal(h.state.layouts, 0, 'Automatic official geometry never reads or decodes layout images');
 const reads = h.state.reads;
 await h.apply();
 assert.equal(h.state.reads, reads);
 assert.equal(h.nativeWrites.length, 1, 'Revisiting a verified game never writes or resizes its logo again');
}
for (const id of ['221430', '237110', '999999']) {
 const h = harness();
 assert.equal(await h.apply(null, { steamId: id, pin: 'UpperCenter', source: 'sync' }), true);
 assert.deepEqual(h.nativeWrites[0], defaultPosition, 'Missing metadata uses Steam defaults without per-title exceptions');
 assert.equal(h.marker().source, 'native_default');
 assert.equal(h.state.layouts, 0);
}
{
 const h = harness({ actual: { pinnedPosition: 'BottomLeft', nWidthPct: 100, nHeightPct: 65 } });
 h.storage.set(markerKey, JSON.stringify({ steamAppId: steamId, profileRevision: 5, verified: true,
  source: 'none', expectedPosition: h.state.actual }));
 assert.equal(h.api.isLogoPositionVerified(shortcutId, steamId), false);
 assert.equal(await h.apply(), true);
 assert.deepEqual(h.nativeWrites[0], officialPosition, 'An older automatic profile migrates to official geometry once');
}
{
 const h = harness();
 const a = h.apply(official), b = h.apply(null, { source: 'sync' });
 assert.equal(a, b, 'A concurrent Sync request joins the authoritative official operation');
 assert.deepEqual(await Promise.all([a, b]), [true, true]);
 assert.deepEqual(h.nativeWrites, [officialPosition]);
}
{
 const reading = deferred(), h = harness({ readWait: reading.promise });
 const fallback = h.apply(null, { source: 'sync' });
 await flushUntil(() => h.state.reads === 1);
 const authoritative = h.apply(official);
 reading.resolve();
 assert.deepEqual(await Promise.all([fallback, authoritative]), [false, true]);
 assert.deepEqual(h.nativeWrites, [officialPosition], 'Official data arriving before commit supersedes a provisional default');
 assert.equal(h.diskWrites.length, 1);
}
{
 const h = harness();
 const requests = Array.from({ length: 100 }, () => h.apply());
 assert.ok(requests.every(request => request === requests[0]));
 assert.ok((await Promise.all(requests)).every(Boolean));
 assert.equal(h.state.reads, 1);
 assert.equal(h.diskWrites.length, 1);
 assert.equal(h.nativeWrites.length, 1, 'One hundred identical jobs share one disk/native operation');
}
for (const action of ['invalidateLogoPosition', 'clearLogoPositionSaved']) {
 const bridge = deferred(), h = harness({ bridgeWait: bridge.promise });
 const old = h.apply();
 await flushUntil(() => h.nativeWrites.length === 1);
 h.api[action](shortcutId);
 const selected = { pinnedPosition: 'UpperLeft', nWidthPct: 82, nHeightPct: 64 };
 const manual = h.apply(selected, { force: true, source: 'manual' });
 await Promise.resolve();
 assert.equal(h.nativeWrites.length, 1, 'New work waits until the already-sent old native write settles');
 assert.equal(h.diskWrites.length, 1);
 bridge.resolve();
 assert.deepEqual(await Promise.all([old, manual]), [false, true]);
 assert.deepEqual(h.nativeWrites.at(-1), selected);
 assert.deepEqual(h.state.nativeActual, selected, 'The latest manual intent owns the final native geometry');
 assert.deepEqual(h.state.actual, selected, 'The latest manual intent owns the final disk geometry');
 assert.equal(h.marker().source, 'manual');
 assert.equal(h.marker().verified, true);
}
{
 const custom = { pinnedPosition: 'BottomLeft', nWidthPct: 100, nHeightPct: 65 };
 const h = harness({ actual: custom });
 h.storage.set(markerKey, JSON.stringify({ steamAppId: steamId, profileRevision: 5, verified: true,
  source: 'manual', pairKey: 'pairA', expectedPosition: custom }));
 h.api.rememberLogoAdjustment(shortcutId, steamId, 'pairA', custom);
 assert.equal(await h.apply(), true);
 assert.deepEqual(h.nativeWrites[0], custom, 'An accredited manual size survives automatic-profile migration, including 100x65');
 assert.equal(h.diskWrites.length, 0);
 assert.equal(h.marker().source, 'preserved_native_adjustment');
}
{
 const custom = { pinnedPosition: 'BottomLeft', nWidthPct: 100, nHeightPct: 65 };
 const h = harness({ actual: custom });
 h.storage.set(markerKey, JSON.stringify({ steamAppId: steamId, profileRevision: 5, verified: true,
  source: 'native_official', pairKey: 'pairA', expectedPosition: officialPosition }));
 assert.equal(await h.apply(), true);
 assert.deepEqual(h.nativeWrites[0], custom, 'A user adjustment in Steam is preserved even when its dimensions resemble an old automatic box');
 assert.equal(h.marker().source, 'preserved_native_adjustment');
 assert.deepEqual(plain(h.api.getLogoAdjustment(shortcutId, steamId, 'pairA')), custom);
}
{
 const h = harness();
 assert.equal(await h.apply(official, { isCurrent: () => false }), false);
 assert.equal(h.state.reads, 0);
 assert.equal(h.diskWrites.length, 0);
 assert.equal(h.nativeWrites.length, 0);
}
{
 let current = true;
 const reading = deferred(), h = harness({ readWait: reading.promise });
 const work = h.apply(official, { isCurrent: () => current });
 await flushUntil(() => h.state.reads === 1);
 current = false; reading.resolve();
 assert.equal(await work, false);
 assert.equal(h.diskWrites.length, 0, 'Stale work after a backend read cannot persist geometry');
 assert.equal(h.nativeWrites.length, 0);
}
{
 let current = true;
 const saving = deferred(), h = harness({ diskWait: saving.promise });
 const work = h.apply(official, { isCurrent: () => current });
 await flushUntil(() => h.diskWrites.length === 1);
 current = false; saving.resolve();
 assert.equal(await work, false);
 assert.equal(h.nativeWrites.length, 0, 'Stale work after a sent backend write cannot update the native cache or verify');
 assert.equal(h.api.isLogoPositionVerified(shortcutId, steamId), false);
}
{
 const h = harness({ bridgeAccepted: false });
 assert.equal(await h.apply(), false);
 assert.equal(h.nativeWrites.length, 3, 'A native rejection has bounded retries');
 assert.equal(h.api.isLogoPositionVerified(shortcutId, steamId), false, 'Rejected native geometry is never marked verified');
 assert.equal(h.marker(), null);
}
{
 const h = harness();
 for (const id of [100, -1, 4294967296]) {
  assert.equal(await h.api.applyLogoPosition(id, steamId, official, false, 'BottomLeft', 'sync', () => true), false);
 }
 assert.equal(h.state.reads, 0, 'Native or invalid app identities never reach persistence');
}
for (const partial of [{ logo: 'new-logo', hero: '', key: '' }, { logo: '', hero: 'new-hero', key: '' }]) {
 const manual = { pinnedPosition: 'UpperCenter', nWidthPct: 82, nHeightPct: 64 };
 const h = harness({ actual: manual });
 h.storage.set(markerKey, JSON.stringify({ steamAppId: steamId, profileRevision: 5, verified: false,
  source: 'manual', pairKey: 'pairA', expectedPosition: manual }));
 h.api.rememberLogoAdjustment(shortcutId, steamId, 'pairA', manual);
 assert.equal(await h.apply(null, { force: true, source: 'community', layout: partial }), true);
 assert.equal(h.state.layouts, 1, 'Only an explicit adjustment needs the retained half of a prospective image pair');
 assert.deepEqual(h.nativeWrites[0], defaultPosition, 'Replacing one image must not inherit a manual adjustment belonging to the previous pair');
 assert.notEqual(h.marker().pairKey, 'pairA');
}
{
 const manual = { pinnedPosition: 'UpperCenter', nWidthPct: 82, nHeightPct: 64 };
 const h = harness({ actual: manual });
 h.storage.set(markerKey, JSON.stringify({ steamAppId: steamId, profileRevision: 5, verified: false,
  source: 'manual', pairKey: 'pairA', expectedPosition: manual }));
 h.api.rememberLogoAdjustment(shortcutId, steamId, 'pairA', manual);
 assert.equal(await h.apply(null, { force: true, source: 'community' }), true);
 assert.deepEqual(h.nativeWrites[0], defaultPosition, 'A backend-only replacement cannot borrow the previous image’s manual adjustment');
 assert.equal(h.state.layouts, 0);
 assert.equal(h.marker().pairKey, '');
}
console.log('Logo sizing passed: exact Steam geometry, native defaults, single migration, official/Sync races, 100-job deduplication, serialized latest intent, manual/native adjustments, prospective pair isolation, stale guards and rejected-native retries.');
