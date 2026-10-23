import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assetDeadlineRuntime } from './helpers/asset-deadline-runtime.mjs';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
function clock() {
 let now = 1_791_000_000_000, sequence = 0;
 const timers = new Map();
 const globals = { Date: class extends Date { static now() { return now; } },
  setTimeout(callback, delay = 0) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
  clearTimeout(id) { timers.delete(id); } };
 return { globals, timers, async advance(ms) {
  const end = now + ms; await flush();
  for (let count = 0; count < 1000; count++) {
   const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
   if (!next) { now = end; await flush(); return; }
   now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
  }
  throw Error('Unbounded work');
 } };
}
function load(file, dependencies, globals = {}) {
 const source = file.endsWith('/native-asset-write.ts') && process.env.NGL_NATIVE_WRITE_BASELINE
  ? fs.readFileSync(process.env.NGL_NATIVE_WRITE_BASELINE, 'utf8') : fs.readFileSync(file, 'utf8');
 const context = vm.createContext({ exports: {}, URL, ...globals, require: name => typeof dependencies === 'function' ? dependencies(name) : dependencies[name] });
 vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context, { filename: file });
 return context.exports;
}

// The real link resource batch, real artwork planner, real icon applier and
// real native write guards. Only network/disk/image decoding are fixtures.
{
 const time = clock(), deadline = assetDeadlineRuntime(time.globals), writes = [], storage = new Map();
 const native = load('frontend/features/library/native-asset-write.ts', { './asset-deadline': deadline }, time.globals);
 const apps = { SetCustomArtworkForApp: (_id, _bytes, _ext, slot) => { const pending = deferred(); writes.push({ slot, ...pending }); return pending.promise; },
  SetShortcutIcon: () => { const pending = deferred(); writes.push({ slot: 'icon', ...pending }); return pending.promise; } };
 const assets = { hero: 'https://cdn.akamai.steamstatic.com/steam/apps/100/library_hero.jpg',
  logo: 'https://cdn.akamai.steamstatic.com/steam/apps/100/logo.png', portrait: 'https://cdn.akamai.steamstatic.com/steam/apps/100/library_600x900.jpg',
  wide: 'https://cdn.akamai.steamstatic.com/steam/apps/100/header.jpg', logo_position: { pinned_position: 'BottomLeft' } };
 const globals = { ...time.globals, window: { SteamClient: { Apps: apps }, dispatchEvent() {} }, CustomEvent: class {},
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
 const common = { backendLog(value) { if(process.env.NGL_DEBUG) console.log(value); }, getPreferences: () => ({}), steamLanguageSync: () => 'english',
  getModernLibraryAssets: async () => assets, getResolvedLibraryAssets: () => assets,
  getCommunityArtwork: async () => null, retiredCommunityArtworkPreferred: async () => false,
  getSavedCommunityArtworkSelection: () => null, getShortcutEdition: () => null, isLegacyGame: () => false,
  imageUrlToBase64: async () => 'data:image/png;base64,AAAA', imageUrlKnownMissing: () => false,
  automaticArtworkMeetsSlotQuality: async () => true, isTrustedSteamGridDbImageUrl: () => false,
  applyLogoPosition: async () => true, invalidateLogoPosition() {}, isLogoPositionVerified: () => false,
  layoutFingerprint: () => 'layout', buildHeroCandidateUrls: () => [assets.hero], isHero2xUrl: () => false,
  logHeroResolutionDiagnostics() {}, classifyHeroVariant: () => 'standard', determineHeroSelectionReason: () => 'official',
  saveShortcutArtworkBackend: async () => JSON.stringify({ ok: false }),
  saveShortcutIconBackend: async () => JSON.stringify({ saved: true, path: 'fixture-icon.png' }),
  waitForSteamBridge: async () => true, nativeAssetWriteBlocked: native.nativeAssetWriteBlocked || native.hasPendingNativeAssetWrites, ...deadline, ...native };
 const icon = load('frontend/features/library/shortcut-icon.ts', () => common, globals);
 const artwork = load('frontend/features/library/artwork.ts', () => ({ ...common, ...icon }), globals);
 const batch = Promise.all([artwork.spoofArtwork(3000000001, '100', 'Any game').catch(error=>{ console.error(error); throw error; }), icon.applyOfficialShortcutIconOnce(3000000001, '100')]);
 await flush();
 if(process.env.NGL_DEBUG) console.log('Started slots', writes.map(value=>value.slot));
 check(writes.some(write => write.slot === 'icon') && [0, 1, 2].every(slot => writes.some(write => write.slot === slot)),
  'The actual parallel batch starts icon, hero, logo and portrait without rejecting independent slots');
 for (let pass = 0; pass < 6; pass++) { for (const write of writes) write.resolve(true); await flush(); }
 const [result, iconReady] = await batch;
 check(result.complete && iconReady && [0, 1, 2, 3].every(slot => result.slots.includes(slot)),
  'All actual artwork slots and the icon complete through the asynchronous native fallback');
 check(!native.hasPendingNativeAssetWrites(3000000001), 'The successful batch releases all real native locks');
 await time.advance(10000);
 check(time.timers.size === 0, 'The resource batch releases its watchdog and notification timers');

 const late = deferred(); let current = true;
 const pending = native.writeNativeAsset(3000000001, 'icon', () => late.promise, () => current, 100);
 check(await native.writeNativeAsset(3000000001, 'icon', () => true, () => true) === false, 'An active write blocks its own slot');
 check(await native.writeNativeAsset(3000000001, 'unlink-clear', () => true, () => true) === false, 'Unlink clear is exclusive against active writes');
 check(await native.writeNativeAsset(3000000001, 'artwork-1', () => true, () => true), 'An active icon permits independent hero work');
 await time.advance(100); check(await pending === false, 'An unanswered native IPC releases the foreground at its deadline');
 check(await native.writeNativeAsset(3000000001, 'artwork-2', () => true, () => true) === false, 'An unresolved timed-out IPC blocks later writes until actual settlement');
 late.resolve(true); await flush();
 check(await native.writeNativeAsset(3000000001, 'artwork-2', () => true, () => true), 'Actual late settlement permits a fresh repair');
 const stale = deferred(); native.writeNativeAsset(3000000001, 'icon', () => stale.promise, () => current);
 current = false;
 check(await native.writeNativeAsset(3000000001, 'artwork-1', () => true, () => true) === false, 'An obsolete owner remains a whole-shortcut barrier');
 stale.resolve(true); await flush();
}

// Unlink uses the owner document, records cancellation before the lock wait,
// bounds a stalled rename, and fences its deferred cleanup against relinking.
for (const mode of ['normal', 'late-cleanup', 'rename-hang', 'rename-reject', 'restore-conflict', 'newer-relink', 'pending-link-rename']) {
 const time = clock(), deadline = assetDeadlineRuntime(time.globals);
 const native = load('frontend/features/library/native-asset-write.ts', { './asset-deadline': deadline }, time.globals);
 const lock = load('frontend/features/shortcuts/operation-lock.ts', {}, time.globals);
 const id = 3000000001, events = [], supersede = deferred(), rename = deferred(), previousRename = deferred();
 let dismissed = false, mapped = true, forgotten = false;
 const apps = { ClearCustomArtworkForApp: async (_id, slot) => { events.push(`native-clear:${slot}`); },
  SetShortcutName: () => mode === 'rename-hang' ? rename.promise : mode === 'rename-reject' ? Promise.reject(Error('rejected')) : Promise.resolve(true) };
 const doc = { defaultView: { SteamClient: { Apps: apps } } };
 const globals = { ...time.globals, window: { SteamClient: { Apps: { ClearCustomArtworkForApp() { throw Error('Wrong realm'); } } } } };
 const common = { ...lock, ...deadline, ...native, backendLog() {}, normalizedShortcutAppId: value => Number(value) >= 2147483648 ? Number(value) : null,
  cancelPendingLinkJobs: () => events.push('cancel'), dismissShortcut: () => { dismissed = true; events.push('dismiss'); },
  isShortcutDismissed: () => dismissed, undismissShortcut: () => { dismissed = false; },
  shortcutAppIdFileTarget: () => ({ exe_path: 'Q:/Other computer/Game.exe', start_dir: 'Q:/Other computer' }),
  updateShortcutAppIdFile: async () => mode !== 'restore-conflict', findMappingForShortcut: () => mapped ? '100' : null,
  removeShortcutMappingsChecked: async () => { mapped = false; events.push('mapping-removed'); return true; },
  clearShortcutManifest() {}, clearActiveTransaction() {}, clearShortcutEdition() {}, purgeShortcutStorage() {}, forgetShortcutSteamAppId() {},
  getPendingShortcutIdentityWrites: () => mode === 'pending-link-rename' ? [previousRename.promise] : [],
  getOriginalShortcutTitle: () => 'Original title', forgetOriginalShortcutTitle: () => { forgotten = true; },
  getAllShortcutRecords: owner => { assert.equal(owner, doc); return []; }, shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  readShortcutOverviewField: () => '', supersedeArtworkApplications: () => mode === 'late-cleanup' ? supersede.promise : Promise.resolve(),
  clearArtworkSlotsBackend: async request => { const guard = JSON.parse(request.request_json); check(guard.expires_at_ms > 0 && guard.resource_generation > 0, 'Unlink disk cleanup carries its actual expiry and generation guard'); events.push('disk-clear'); return '{}'; },
  shortcutRuntimeHost: () => ({ getMainWindowDoc: () => doc, resetLibraryInjection() {} }) };
 const api = load('frontend/features/shortcuts/unlinking.ts', () => common, globals);
 const hold = deferred();
 const prior = lock.runShortcutMutations(lock.shortcutMutationKeys({ shortcutAppId: id }), () => hold.promise); await flush();
 const operation = api.unlinkShortcutFromSteam({ doc, shortcutAppId: id, title: 'Official title' });
 check(dismissed && events[0] === 'cancel' && !events.includes('mapping-removed'), 'Unlink cancels and dismisses synchronously before waiting for a running link lock');
 if (mode === 'newer-relink') dismissed = false; // A newer explicit Link request waits behind unlink.
 hold.resolve(); await prior; await time.advance(6000);
 const result = await operation;
 check(!mapped, `${mode}: unlink removes the logical mapping`);
 check(result.ok === (mode !== 'restore-conflict'), `${mode}: unlink reports file restoration honestly`);
 check(forgotten === !['rename-hang', 'rename-reject', 'newer-relink', 'late-cleanup', 'pending-link-rename'].includes(mode), `${mode}: failed or unacknowledged name restoration retains original-title recovery history`);
 if (mode === 'newer-relink') check(!dismissed && !events.includes('disk-clear'), 'A newer explicit relink is not dismissed again or erased by the preceding unlink');
 if (mode === 'late-cleanup') {
  const cleared = events.filter(event => event === 'disk-clear').length;
  dismissed = false; mapped = true; supersede.resolve(); await flush();
  check(events.filter(event => event === 'disk-clear').length === cleared && mapped,
   'A late previous-unlink completion cannot clear artwork after an explicit relink');
 }
 if (mode === 'pending-link-rename') {
  check(!forgotten, 'Unlink retains original-title history while the previous link rename is still unresolved');
  previousRename.resolve(true); await time.advance(500);
  check(forgotten, 'After the real previous rename settles, deferred unlink restores the original title');
 }
 if (mode === 'rename-hang') { rename.resolve(true); await flush(); }
 await time.advance(20000);
 check(time.timers.size === 0, `${mode}: unlink has no remaining watchdog timers`);
}
console.log(`Link cycle recovery passed: ${checks} checks; real parallel artwork/icon writes, slot/exclusive/late barriers, unlink ownership, synchronous cancellation, relink safety and honest restoration.`);
