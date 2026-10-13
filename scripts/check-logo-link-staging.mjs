import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const shortcutId = 3000000001, steamId = '1091500';
const official = { pinned_position: 'BottomCenter', width_pct: 31.63, height_pct: 99.68 };
const base = 'https://shared.steamstatic.com/store_item_assets/steam/apps/1091500';
const modern = { hero: `${base}/library_hero.jpg`, logo: `${base}/logo.png`, portrait: `${base}/library_600x900.jpg`,
 wide: `${base}/capsule_616x353.jpg`, logo_position: official, logo_position_source: 'library_assets_full' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flushUntil = async predicate => {
 for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
 assert.ok(predicate(), 'Expected asynchronous phase was reached');
};
function load(file, mocks, globals = {}) {
 const context = vm.createContext({ exports: {}, require: () => mocks, ...globals });
 vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
 }).outputText, context);
 return context.exports;
}
function harness(options = {}) {
 const storage = new Map(), events = [], positionCalls = [], normalized = [];
 const state = { metadataCalls: 0, verified: false, metadata: null, positionWait: null, wideWait: null,
  accepted: true, selection: null, failLogo: false, bridgeAccepted: undefined, ...options };
 const mocks = {
  backendLog() {}, getSavedCommunityArtworkSelection: () => state.selection,
  isTrustedSteamGridDbImageUrl: url => String(url).startsWith('https://cdn.steamgriddb.com/'),
  getModernLibraryAssets: async () => { state.metadataCalls++; return state.metadata ? await state.metadata : modern; },
  isLogoPositionVerified: () => state.verified, clearLogoPositionSaved() {}, clearShortcutIconMarker() {},
  clearSavedCommunityArtworkSelection() {}, invalidateLogoPosition() { state.verified = false; events.push('position-invalidated'); },
  isTrustedArtworkChoiceUrl: url => String(url).startsWith('https://cdn.steamgriddb.com/'),
  saveCommunityArtworkSelection: (_id, _steam, selection) => { state.selection = selection; },
  applyLogoPosition: async (...args) => {
   positionCalls.push(args); events.push('position-start');
   if (state.positionWait) await state.positionWait;
   if (!args[6]()) return false;
   state.verified = state.accepted; events.push(state.accepted ? 'position-accepted' : 'position-rejected');
   return state.accepted;
  },
  getShortcutEdition: () => null, isLegacyGame: () => false,
  retiredCommunityArtworkPreferred: async () => false, getCommunityArtwork: async () => null,
  buildHeroCandidateUrls: input => [input.userHero || input.modern.hero],
  automaticArtworkMeetsSlotQuality: async () => true, imageUrlKnownMissing: () => false,
  imageUrlToBase64: async url => {
   if (url === modern.wide && state.wideWait) { events.push('wide-request'); await state.wideWait; }
   const slot = Object.keys(modern).find(key => modern[key] === url);
   if (slot) return `data:image/png;base64,ORIGINAL_${slot.toUpperCase()}`;
   if (String(url).startsWith('https://cdn.steamgriddb.com/')) return 'data:image/png;base64,USER_LOGO';
   return null;
  },
  normalizeCommunityArtworkDataUrl: async (value, imageType) => {
   normalized.push(imageType); return value + '_NORMALIZED';
  },
  saveShortcutArtworkBackend: async ({ request_json }) => {
   const request = JSON.parse(request_json); events.push(`write-${request.image_type}`);
   events.push(`bytes-${request.image_type}:${request.data_base64}`); return { ok: !(state.failLogo && request.image_type === 2) };
  },
  classifyHeroVariant: () => 'standard', determineHeroSelectionReason: () => 'official',
  logHeroResolutionDiagnostics() {}, isHero2xUrl: () => false,
  layoutFingerprint: (logo, hero) => `${logo}|${hero}`,
  waitForSteamBridge: async result => { try { await result; return true; } catch { return false; } },
 };
 const globals = {
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  window: { SteamClient: { Apps: {} }, dispatchEvent() {} }, CustomEvent: class {}, URL,
  setTimeout: callback => 1, clearTimeout() {},
 };
 const api = load('frontend/features/library/artwork.ts', mocks, globals);
 if (state.bridgeAccepted !== undefined) globals.window.SteamClient.Apps.SetCustomArtworkForApp = async () => state.bridgeAccepted;
 const user = load('frontend/features/library/artwork-user-selection.ts', { ...mocks, ...api }, globals);
 return { api, user, state, storage, events, positionCalls, normalized };
}

{
 const h = harness();
 assert.equal(await h.api.applyOfficialLogoPosition(shortcutId, steamId, null, false, 'BottomLeft', 'sync'), true);
 assert.equal(h.state.metadataCalls, 1, 'Navigation resolves the same official metadata as linking');
 assert.deepEqual(h.positionCalls[0][2], official);
 assert.equal(h.positionCalls[0][4], 'BottomCenter');
 assert.equal(h.positionCalls[0][5], 'library_assets_full');
 await h.api.applyOfficialLogoPosition(shortcutId, steamId, null);
 assert.equal(h.state.metadataCalls, 1, 'A verified logo never refetches or recalibrates during navigation');
 assert.equal(h.positionCalls.length, 1);
}
{
 const h = harness();
 assert.equal(await h.api.applyOfficialLogoPosition(100, steamId, null), false);
 assert.equal(h.state.metadataCalls, 0, 'Native Steam games never enter logo preparation');
 const release = h.api.reserveShortcutArtworkTarget(shortcutId, '200');
 assert.equal(await h.api.applyOfficialLogoPosition(shortcutId, steamId, null), false);
 assert.equal(h.positionCalls.length, 0, 'An older mapping cannot update a reserved new target');
 release();
 h.storage.set(`gdl_native_artwork_override1_${shortcutId}`, JSON.stringify({ steamAppId: steamId, userManaged: true }));
 assert.equal(await h.api.applyOfficialLogoPosition(shortcutId, steamId, null), true);
 assert.equal(h.state.metadataCalls, 0, 'Native user artwork is preserved without metadata work');
 assert.equal(h.positionCalls.length, 0);
}
{
 const metadata = deferred(), h = harness({ metadata: metadata.promise });
 const pending = h.api.applyOfficialLogoPosition(shortcutId, steamId, null);
 h.api.clearArtworkSaved(shortcutId);
 metadata.resolve(modern);
 assert.equal(await pending, false);
 assert.equal(h.positionCalls.length, 0, 'Unlink during metadata resolution cannot publish a stale position');
}
{
 const position = deferred(), wide = deferred(), h = harness({ positionWait: position.promise, wideWait: wide.promise });
 const work = h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077');
 await flushUntil(() => h.events.includes('position-start'));
 assert.ok(!h.events.some(event => event.startsWith('write-')), 'The logo cannot publish before its final position');
 position.resolve();
 await flushUntil(() => h.events.includes('wide-request'));
 assert.ok(h.events.indexOf('position-accepted') < h.events.indexOf('write-2'));
 assert.ok(h.events.includes('write-1') && h.events.includes('write-0'), 'Hero and portrait publish without waiting for secondary artwork');
 assert.equal(h.positionCalls.length, 1, 'Secondary artwork must not cause another logo resize');
 assert.equal(h.positionCalls[0][7].logo, 'data:image/png;base64,ORIGINAL_LOGO');
 assert.ok(h.events.includes('bytes-2:ORIGINAL_LOGO'), 'Official logo bytes and transparent padding remain untouched');
 assert.equal(h.normalized.length, 0);
 wide.resolve();
 assert.equal((await work).complete, true);
 assert.equal(h.positionCalls.length, 1);
}
{
 const h = harness({ accepted: false });
 const result = await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077');
 assert.equal(result.complete, false);
 assert.ok(!Array.from(result.slots).includes(2), 'A rejected position cannot report a ready logo');
 assert.ok(Array.from(result.missing).includes('logo'));
 assert.ok(!h.events.includes('write-2'), 'A provisional logo is never published');
 assert.ok(h.events.includes('write-1') && h.events.includes('write-0'));
 assert.ok(JSON.parse(h.storage.get(`gdl_artwork18_${shortcutId}`)).retrySlots.includes(2));
}
{
 const h = harness({ selection: { logo: { url: 'https://cdn.steamgriddb.com/logo/fixture.png' } } });
 assert.equal((await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077')).complete, true);
 assert.equal(h.positionCalls[0][2], null, 'A community logo does not inherit geometry calibrated for the official image');
 assert.equal(h.positionCalls[0][5], 'community');
 assert.equal(h.normalized.filter(slot => slot === 2).length, 1, 'Community logo is prepared once before positioning');
 assert.ok(h.events.includes('bytes-2:USER_LOGO_NORMALIZED'));
}
{
 const h = harness();
 const communityUrl = 'https://cdn.steamgriddb.com/logo/retained.png';
 h.storage.set(`gdl_artwork18_${shortcutId}`, JSON.stringify({ steamAppId: steamId, slots: [0, 1, 2], retrySlots: [3],
  sourceUrls: { portrait: modern.portrait, hero: modern.hero, logo: communityUrl },
  provenance: { logo: { provider: 'steamgriddb', url: communityUrl } } }));
 assert.equal((await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077')).complete, true);
 assert.equal(h.positionCalls[0][2], null, 'A retained community logo never receives official-image geometry during another slot repair');
 assert.equal(h.positionCalls[0][5], 'community');
 assert.ok(!h.events.includes('write-2'), 'Retained artwork is never republished merely to fix another slot');
}
{
 const h = harness({ failLogo: true });
 assert.equal((await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077')).complete, false);
 assert.equal(h.state.verified, false, 'Accepted positioning is invalidated if publishing the corresponding logo fails');
 assert.ok(JSON.parse(h.storage.get(`gdl_artwork18_${shortcutId}`)).retrySlots.includes(2));
 h.state.failLogo = false;
 h.state.selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/retry.png' } };
 h.state.verified = true;
 assert.equal((await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077')).complete, true);
 assert.equal(h.positionCalls.length, 2, 'A new downloaded candidate cannot reuse another image policy through a verified fast path');
 assert.equal(h.positionCalls.at(-1)[2], null);
 assert.equal(h.positionCalls.at(-1)[5], 'community');
 assert.equal(h.positionCalls.at(-1)[7].hero, '', 'A partial replacement supplies its prospective logo without pretending the old pair is current');
 assert.equal(h.positionCalls.at(-1)[7].key, '');
 assert.equal(h.events.filter(event => event === 'write-1').length, 1, 'A failed logo retry retains the already saved hero');
}
{
 const h = harness({ verified: true });
 const selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/chosen.png' }, hero: { url: 'https://cdn.steamgriddb.com/hero/chosen.png' } };
 assert.equal((await h.user.applyCommunityArtworkSelection(shortcutId, steamId, selection)).complete, true);
 assert.equal(h.positionCalls.length, 1);
 assert.equal(h.positionCalls[0][2], null, 'An explicit community logo uses the native default instead of official-image percentages');
 assert.equal(h.positionCalls[0][5], 'community');
 assert.ok(h.events.indexOf('position-accepted') < h.events.indexOf('write-2'), 'User-selected logo positioning settles before its file is published');
 assert.ok(h.positionCalls[0][7].logo.endsWith('_NORMALIZED'));
 assert.equal(h.state.verified, true, 'Recording the successfully selected artwork preserves its already settled position');
 assert.equal(h.events.filter(event => event === 'position-invalidated').length, 1);
}
for (const community of [false, true]) {
 const h = harness({ selection: community ? { logo: { url: 'https://cdn.steamgriddb.com/logo/previous.png' } } : null });
 const selection = { hero: { url: 'https://cdn.steamgriddb.com/hero/changed.png' } };
 assert.equal((await h.user.applyCommunityArtworkSelection(shortcutId, steamId, selection)).complete, true);
 assert.deepEqual(h.positionCalls[0][2], community ? null : official, 'Changing only the hero respects the existing logo source');
 assert.equal(h.positionCalls[0][7].logo, '');
 assert.equal(h.positionCalls[0][7].key, '', 'A hero-only selection passes prospective partial artwork for pair validation');
}
{
 const h = harness({ accepted: false });
 const selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/chosen.png' }, hero: { url: 'https://cdn.steamgriddb.com/hero/chosen.png' } };
 const result = await h.user.applyCommunityArtworkSelection(shortcutId, steamId, selection);
 assert.equal(result.complete, false);
 assert.ok(!h.events.includes('write-2'), 'An unaccepted user-logo position never publishes a provisional logo');
 assert.ok(h.events.includes('write-1'), 'Other selected artwork remains independent of logo failure');
 assert.equal(h.state.verified, false);
}
{
 const h = harness({ failLogo: true });
 const selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/chosen.png' } };
 assert.equal((await h.user.applyCommunityArtworkSelection(shortcutId, steamId, selection)).complete, false);
 assert.equal(h.state.verified, false, 'A failed user-logo file write cannot leave positioning verified');
}
{
 const h = harness({ failLogo: true, bridgeAccepted: false });
 assert.equal((await h.api.spoofArtwork(shortcutId, steamId, 'Cyberpunk 2077')).complete, false);
 assert.equal(h.state.verified, false, 'A rejected native artwork fallback cannot verify an unwritten automatic logo');
 const selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/rejected.png' } };
 assert.equal((await h.user.applyCommunityArtworkSelection(shortcutId, steamId, selection)).complete, false);
 assert.equal(h.state.verified, false, 'A rejected native artwork fallback cannot verify an unwritten user logo');
}
{
 const h = harness();
 const selection = { logo: { url: 'https://cdn.steamgriddb.com/logo/chosen.png' } };
 assert.equal((await h.user.applyCommunityArtworkSelection(100, steamId, selection)).complete, false);
 assert.equal(h.positionCalls.length, 0);
 assert.equal(h.events.length, 0, 'Native Steam games never enter explicit artwork writes or logo staging');
}
{
 let repairForce;
 const slots = ['portrait', 'hero', 'logo', 'wide', 'icon'];
 const manifest = Object.fromEntries(slots.map(slot => [slot, { status: 'READY' }]));
 const { reconcileShortcut } = load('frontend/features/shortcuts/reconciler.ts', {
  backendLog() {}, findMappingForShortcut: () => steamId, getFactoryResetEpoch: () => 1,
  isFactoryResetInProgress: () => false, isFactoryEpochCurrent: () => true,
  artworkAlreadySaved: () => true, shortcutIconMarkerMatches: () => true, isLogoPositionVerified: () => false,
  readShortcutManifest: () => manifest, getPreferences: () => ({ autoCommunityArtwork: false }),
  getGameData: async () => ({ name: 'Cyberpunk 2077' }), isLegacyGame: () => false,
  spoofArtwork: async (_id, _steam, _name, force) => { repairForce = force; return { slots: [0, 1, 2, 3] }; },
  applyOfficialShortcutIcon: async () => true, saveShortcutManifest() {},
 });
 assert.equal(await reconcileShortcut(shortcutId, steamId), 'repaired');
 assert.equal(repairForce, false, 'Position repair must retain existing valid artwork instead of forcing all slots');
}
console.log('Logo link staging passed: official metadata parity, native/manual guards, stale work, final position before logo, secondary independence, failed position retry, preserved official bytes and non-destructive repair.');
