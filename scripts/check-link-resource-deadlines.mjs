import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assetDeadlineRuntime } from './helpers/asset-deadline-runtime.mjs';

let checks = 0;
function equal(actual, expected, message) { assert.equal(actual, expected, message); checks++; }
function deferred() {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
function clock() {
 let now = 1_791_000_000_000, sequence = 0;
 const timers = new Map();
 const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
 const globals = {
  Date: class extends Date { static now() { return now; } },
  setTimeout(callback, ms = 0) { const id = ++sequence; timers.set(id, { at: now + ms, callback }); return id; },
  clearTimeout(id) { timers.delete(id); },
 };
 return { globals, timers, flush, now: () => now, async advance(ms) {
  const end = now + ms;
  await flush();
  for (let i = 0; i < 5000; i++) {
   const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
   if (!next) { now = end; await flush(); return; }
   const [id, timer] = next; now = timer.at; timers.delete(id); timer.callback(); await flush();
  }
  throw new Error('Resource retry never yielded');
 } };
}
function load(file, mocks, globals) {
 const context = vm.createContext({ exports: {}, URL, AbortController, ...globals, require(name) {
  if (!(name in mocks)) throw new Error(`Unexpected dependency ${name} in ${file}`);
  return mocks[name];
 } });
 vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
 }).outputText, context, { filename: file });
 return context.exports;
}
function imageHarness(options = {}) {
 const time = clock(), images = [], canvases = [];
 const deadline = assetDeadlineRuntime(time.globals);
 let requests = 0;
 const state = { backend: async () => JSON.stringify({ ok: false, status: 503 }), ...options };
 class Image {
  naturalWidth = 1920; naturalHeight = 620;
  constructor() { images.push(this); }
  set src(value) { this.value = value; }
  get src() { return this.value; }
 }
 const api = load('frontend/features/library/artwork-image.ts', {
  './asset-deadline': deadline,
  '../../api/backend': { fetchArtworkImageBackend: args => { requests++; return state.backend(args); } },
 }, { ...time.globals, Image, fetch: state.fetch || (() => new Promise(() => {})),
  FileReader: state.FileReader,
  document: { createElement() {
   const canvas = { getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(1920 * 620 * 4) }) }),
    toDataURL: () => 'data:image/png;base64,NORMALIZED' };
   canvases.push(canvas); return canvas;
  } },
 });
 return { time, api, state, images, canvases, requests: () => requests };
}

// A disconnected Millennium reply must release the URL transfer and let the
// next durable repair fetch again. Its late 404 must not poison the new result.
{
 const first = deferred(), h = imageHarness({ backend: () => first.promise });
 const url = 'https://shared.steamstatic.com/test/hung.png';
 const request = h.api.imageUrlToBase64(url);
 equal(h.api.imageUrlToBase64(url), request, 'Concurrent readers share one transfer');
 await h.time.advance(8_000);
 equal(await request, null, 'Hung IPC image transfer terminates');
 equal(h.requests(), 1, 'Deadline does not create an implicit runaway retry');
 h.state.backend = async () => JSON.stringify({ ok: true, mime: 'image/png', data_base64: 'NEW' });
 const value = await h.api.imageUrlToBase64(url);
 equal(value, 'data:image/png;base64,NEW', 'A later repair gets a fresh transfer');
 first.resolve(JSON.stringify({ ok: false, status: 404 })); await h.time.flush();
 equal(h.api.imageUrlKnownMissing(url), false, 'Late failed reply cannot add a negative-cache entry');
 equal(await h.api.imageUrlToBase64(url), value, 'Late reply cannot replace the recovered cache value');
 equal(h.requests(), 2, 'Recovered cache is reusable');
 equal(h.time.timers.size, 0, 'Transfer deadlines are released');
}
// Abort is advisory. Even headers/body promises that ignore AbortSignal must
// finish the frontend request instead of retaining imageTransfers forever.
for (const phase of ['headers', 'body']) {
 const h = imageHarness({ fetch: phase === 'headers' ? () => new Promise(() => {})
  : async () => ({ ok: true, status: 200, blob: () => new Promise(() => {}) }) });
 const request = h.api.imageUrlToBase64(`https://cdn.steamgriddb.com/hung-${phase}.png`);
 await h.time.advance(22_000);
 equal(await request, null, `Ignored abort during ${phase} is bounded`);
 equal(h.requests(), 1, `Backend fallback still runs after ${phase} deadline`);
 equal(h.time.timers.size, 0, `${phase} deadline leaves no timers`);
}
{
 let aborted = 0;
 class FileReader { readAsDataURL() {} abort() { aborted++; } }
 const h = imageHarness({ FileReader, fetch: async () => ({ ok: true, status: 200, blob: async () => ({ size: 500 }) }) });
 const request = h.api.imageUrlToBase64('https://cdn.steamgriddb.com/stalled-reader.png');
 await h.time.advance(10_000);
 equal(await request, null, 'A stalled FileReader cannot retain a transfer');
 equal(aborted, 2, 'Both exhausted provider readers are aborted');
 equal(h.time.timers.size, 0, 'FileReader deadlines are released');
}
for (const slot of [0, 1, 2, 3]) {
 const h = imageHarness(), original = 'data:image/png;base64,ORIGINAL';
 const request = h.api.normalizeCommunityArtworkDataUrl(original, slot);
 const image = h.images[0], lateLoad = image.onload;
 await h.time.advance(4_000);
 equal(await request, original, `Undelivered Image event releases normalization slot ${slot}`);
 equal(image.onload, null, `Load handler detached for slot ${slot}`);
 equal(image.onerror, null, `Error handler detached for slot ${slot}`);
 equal(image.src, '', `Obsolete decode cancelled for slot ${slot}`);
 lateLoad(); await h.time.flush();
 equal(h.canvases.length, 0, `Late image callback cannot resume canvas work for slot ${slot}`);
 equal(h.time.timers.size, 0, `Decode timer released for slot ${slot}`);
}
{
 const h = imageHarness(), original = 'data:image/png;base64,ORIGINAL';
 const first = h.api.decodeArtworkImage(original); await h.time.advance(4_000);
 equal(await first, null, 'A hung decode returns null');
 const retry = h.api.normalizeCommunityArtworkDataUrl(original, 1);
 h.images[1].onload(); await h.time.flush();
 equal(await retry, 'data:image/png;base64,NORMALIZED', 'Next decode and canvas conversion recover');
 equal(h.canvases.length, 1, 'Only the current decode creates a canvas');
 equal(h.time.timers.size, 0, 'Successful decode clears its timeout');
}

function metadataHarness() {
 const time = clock(), deadline = assetDeadlineRuntime(time.globals), storage = new Map();
 const requestCache = load('frontend/core/request-cache.ts', {}, time.globals);
 const state = { libraryCalls: 0, communityCalls: 0, eligibilityCalls: 0,
  library: () => new Promise(() => {}), community: () => new Promise(() => {}), eligibility: () => new Promise(() => {}) };
 const backend = { backendLog() {},
  fetchLibraryAssetsBackend(args) { state.libraryCalls++; return state.library(args); },
  fetchCommunityArtworkBackend(args) { state.communityCalls++; return state.community(args); },
  fetchCommunityArtworkCandidatesBackend(args) { state.eligibilityCalls++; return state.eligibility(args); },
 };
 const mocks = { '../../api/backend': backend, './asset-deadline': deadline,
  '../../core/request-cache': requestCache, '../../core/preferences': {
   getPreferences: () => ({ autoCommunityArtwork: true, steamGridDbApiKey: 'test-key' }),
   steamGridDbApiKeyCandidates: value => [value],
  }, './legacy-games': { isLegacyGame: () => false },
  '../../steam/localization': { steamLanguageSync: () => 'english' },
  '../../core/cache': { CACHE_TTL: {}, CACHE_RETENTION: {}, cacheRead: () => null,
   cacheSet: (key, data) => storage.set(key, data), cacheDelete() {}, cacheDeleteMatching() {} },
 };
 const community = load('frontend/features/library/artwork-community.ts', mocks, time.globals);
 const library = load('frontend/features/library/library-assets.ts', { ...mocks, './artwork-community': community }, time.globals);
 return { time, state, library, community, storage };
}
{
 const h = metadataHarness(), late = deferred(); h.state.library = () => late.promise;
 const request = h.library.getModernLibraryAssets('1238820');
 await h.time.advance(25_000);
 equal(await request, null, 'All library metadata retries terminate');
 equal(h.state.libraryCalls, 3, 'Library metadata retries remain bounded');
 h.state.library = async () => JSON.stringify({ found: true, hero: 'RECOVERED', source: 'appinfo' });
 equal((await h.library.getModernLibraryAssets('1238820')).hero, 'RECOVERED', 'Metadata cache can retry after a hung bridge');
 late.resolve(JSON.stringify({ found: true, hero: 'OBSOLETE', source: 'appinfo' })); await h.time.flush();
 equal(h.library.getResolvedLibraryAssets('1238820').hero, 'RECOVERED', 'Late metadata reply cannot replace current memory cache');
 equal([...h.storage.values()][0].hero, 'RECOVERED', 'Late metadata reply cannot replace persisted metadata');
 equal(h.time.timers.size, 0, 'Metadata retry and deadline timers are released');
}
for (const type of ['community', 'eligibility']) {
 const h = metadataHarness(), late = deferred(); h.state[type] = () => late.promise;
 const invoke = type === 'community' ? () => h.community.getCommunityArtwork('1238820')
  : () => h.community.retiredCommunityArtworkPreferred('1238820');
 const request = invoke(); await h.time.advance(17_000);
 equal(await request, type === 'community' ? null : false, `${type} request terminates`);
 equal(h.state[`${type}Calls`], 2, `${type} retries remain bounded`);
 h.state[type] = async () => JSON.stringify(type === 'community' ? { found: true, hero: 'NEW' } : { eligible: true });
 equal(type === 'community' ? (await invoke()).hero : await invoke(), type === 'community' ? 'NEW' : true, `${type} cache retries successfully`);
 late.resolve(JSON.stringify(type === 'community' ? { found: true, hero: 'OLD' } : { eligible: false })); await h.time.flush();
 equal(type === 'community' ? (await invoke()).hero : await invoke(), type === 'community' ? 'NEW' : true, `Late ${type} response cannot overwrite recovery`);
 equal(h.time.timers.size, 0, `${type} deadlines are released`);
}
{
 const time = clock(), api = assetDeadlineRuntime(time.globals), late = deferred();
 let guard, current = true;
 const request = api.writeAssetWithDeadline(value => { guard = value; return late.promise; }, () => current);
 equal(guard.expires_at_ms, time.now() + 10_000, 'Write includes a backend-enforced deadline');
 const firstGeneration = guard.resource_generation;
 await time.advance(11_000);
 equal(await request, null, 'Unanswered guarded write releases its caller');
 let nextGuard;
 equal(await api.writeAssetWithDeadline(value => { nextGuard = value; return Promise.resolve('NEW'); }, () => current), 'NEW', 'Guarded write retries successfully');
 equal(nextGuard.resource_generation > firstGeneration, true, 'Retry has a strictly newer backend generation');
 late.resolve('OLD'); await time.flush();
 equal(time.timers.size, 0, 'Late write response cannot keep a timeout alive');
 current = false; let invoked = false;
 equal(await api.writeAssetWithDeadline(() => { invoked = true; return Promise.resolve('STALE'); }, () => current), null, 'Superseded intent is rejected');
 equal(invoked, false, 'Superseded intent never enters backend mutation');
 current = true; const stale = deferred();
 const pending = api.writeAssetWithDeadline(() => stale.promise, () => current);
 current = false; stale.resolve('STALE');
 equal(await pending, null, 'Late currentness change suppresses write acknowledgement');
}

{
 const time = clock(), deadline = assetDeadlineRuntime(time.globals), pending = deferred();
 const api = load('frontend/features/library/native-asset-write.ts', { './asset-deadline': deadline }, time.globals);
 const id = 3000000001; let calls = 0;
 const first = api.writeNativeAsset(id, 'icon', () => { calls++; return pending.promise; }, () => true);
 await time.advance(5000);
 equal(await first, false, 'Unanswered native mutation releases the foreground caller');
 equal(api.hasPendingNativeAssetWrites(id), true, 'Native mutation retains its real lock until Steam settles');
 equal(await api.writeNativeAsset(id, 'clear', () => { calls++; return true; }, () => true), false, 'A timed-out native write cannot race a clear or replacement');
 equal(calls, 1, 'Retry does not issue another native mutation while the old one is unconfirmed');
 equal(await api.writeNativeAsset(id + 1, 'icon', () => true, () => true), true, 'A stalled game does not block other shortcut resources');
 pending.resolve(true); await time.flush();
 equal(api.hasPendingNativeAssetWrites(id), false, 'Late native settlement releases the actual mutation lock');
 equal(await api.writeNativeAsset(id, 'icon', () => true, () => true), true, 'A subsequent repair can confirm the resource normally');
 equal(time.timers.size, 0, 'Native write deadlines are released');
}

{
 const time = clock(), deadline = assetDeadlineRuntime(time.globals), backend = deferred(), native = deferred();
 const id = 3000000001; let nativeCalls = 0, payload;
 const state = { backend: () => backend.promise, native: () => native.promise };
 const api = load('frontend/features/library/artwork-relink-cleanup.ts', {
  './asset-write': deadline, './native-asset-write': deadline,
  './artwork': { supersedeArtworkApplications: async () => {} },
  '../../api/backend': { backendLog() {}, clearArtworkBackend: args => { payload = args; return state.backend(); } },
 }, { ...time.globals, window: { SteamClient: { Apps: { ClearCustomArtworkForApp() { nativeCalls++; return state.native(); } } } } });
 const first = api.clearShortcutArtworkForAppIdChange(id); first.catch(() => {});
 await time.advance(11_000);
 await assert.rejects(first, /shortcut_artwork_cleanup_pending/); checks++;
 equal(payload.expires_at_ms < time.now(), true, 'Timed-out full cleanup carries an expired backend guard');
 equal(nativeCalls, 0, 'A timed-out backend cleanup never launches an unguarded native clear');
 backend.resolve(JSON.stringify({ ok: true })); await time.flush();
 equal(nativeCalls, 0, 'Late cleanup acknowledgement cannot resume the abandoned native stage');
 state.backend = async () => JSON.stringify({ ok: true });
 const second = api.clearShortcutArtworkForAppIdChange(id); second.catch(() => {});
 await time.advance(4000);
 await assert.rejects(second, /shortcut_artwork_cleanup_pending/); checks++;
 equal(deadline.hasPendingNativeAssetWrites(id), true, 'Native cleanup retains its lock after its foreground deadline');
 equal(await deadline.writeNativeAsset(id, 'icon', () => true, () => true), false, 'A pending native clear cannot race a replacement icon');
 native.resolve(true); await time.flush();
 equal(deadline.hasPendingNativeAssetWrites(id), false, 'Confirmed native clear releases its lock for recovery');
 equal(time.timers.size, 0, 'Cleanup failure paths release all deadline timers');
}

{
 const time = clock(), hung = deferred(), persisted = new Map();
 const state = { calls: 0, fetch: () => hung.promise, language: async () => 'english' };
 const requestCache = load('frontend/core/request-cache.ts', {}, time.globals);
 const api = load('frontend/core/game-data.ts', {
  '../api/backend': { fetchGameData: () => { state.calls++; return state.fetch(); }, backendLog() {} },
  './cache': { CACHE_RETENTION: {}, CACHE_TTL: {}, cacheRead: () => null,
   cacheSet: (key, value) => persisted.set(key, value), cacheDeleteMatching() {} },
  './request-cache': requestCache,
  '../steam/localization': { getSteamLanguage: () => state.language(), steamLanguageSync: () => 'english' },
  './mappings': { mappings: {} }, './steam-game-data': { normalizeSteamGameData: value => value },
 }, time.globals);
 const pending = api.getGameData('1238820');
 const canonical = api.getCanonicalGameData('1238820');
 await time.advance(13_000);
 equal(await pending, null, 'Hung game metadata releases localized request deduplication');
 equal(await canonical, null, 'Hung canonical metadata also releases its in-flight request');
 equal(state.calls, 3, 'Canonical and localized metadata share only three bounded source attempts');
 state.fetch = async () => JSON.stringify({ steam_appid: 1238820, name: 'Battlefield 3' });
 equal((await api.getGameData('1238820')).name, 'Battlefield 3', 'A fresh metadata request recovers after transport failure');
 hung.resolve(JSON.stringify({ steam_appid: 1238820, name: 'STALE' })); await time.flush();
 equal((await api.getCanonicalGameData('1238820')).name, 'Battlefield 3', 'Late metadata cannot overwrite the recovered canonical identity');
 equal([...persisted.values()][0].name, 'Battlefield 3', 'Late metadata cannot overwrite persisted localized content');
 state.language = () => new Promise(() => {});
 const cached = api.getGameData('1238820'); await time.advance(400);
 equal((await cached).name, 'Battlefield 3', 'Unresponsive language IPC cannot block already cached metadata');
 equal(time.timers.size, 0, 'Metadata and language deadline timers are released');
}

console.log(`Link resource deadlines passed: ${checks} checks covering hung IPC, ignored aborts, stalled readers/decodes, late replies, bounded retries and guarded writes.`);
