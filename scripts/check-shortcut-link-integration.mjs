import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const baselineHead = process.argv.includes('--baseline-head');
const baselineModules = new Set(['frontend/features/shortcuts/registry.ts', 'frontend/features/shortcuts/link-orchestrator.ts']);
const id = 3000000001;
const officialId = '1238820';
const title = 'Battlefield 3™';
const exe = 'E:\\Juegos\\Battlefield 3\\bf3.exe';
const startDir = 'E:\\Juegos\\Battlefield 3';
let assertions = 0;
function check(actual, expected, message) { assertions++; assert.equal(actual, expected, message); }
const realModules = new Set([
 'frontend/steam/shortcuts.ts', 'frontend/steam/shortcut-details.ts', 'frontend/core/text.ts',
 'frontend/features/shortcuts/registry.ts', 'frontend/features/shortcuts/link-orchestrator.ts',
 'frontend/features/shortcuts/transaction.ts', 'frontend/features/shortcuts/launcher-bypass.ts',
 'frontend/features/shortcuts/steam-appid-file.ts',
]);

function harness(options = {}) {
 const storage = new Map();
 const state = { logs: [], vdfReads: 0, renames: [], launches: [], mappingWrites: [], artworkWrites: [],
  phases: [], statuses: [], registrations: 0, releases: 0, neutralized: [], restored: [], reserved: 0,
  details: options.details === false ? null : { unAppID: id, strDisplayName: 'bf3', strShortcutExe: exe,
   strShortcutStartDir: startDir, strLaunchOptions: options.launchOptions ?? '-windowed', ...options.details },
  rows: options.rows ?? [{ shortcut_app_id: id, title: 'bf3', exe_path: exe, start_dir: startDir,
   launch_options: options.vdfLaunchOptions ?? '-windowed' }],
 };
 // Installed Steam publishes a library overview and its launch definition as
 // separate objects. Sealing this row makes accidental native mutation fail.
 const overview = Object.seal({ appid: id, display_name: 'bf3' });
 const owner = { appStore: { m_mapApps: new Map([[id, overview]]),
  GetAppOverviewByAppID: lookup => lookup === id ? overview : null },
  appDetailsStore: { GetAppDetails: lookup => lookup === id ? state.details : null },
  SteamClient: { Apps: {
   SetShortcutName: async (lookup, name) => {
    state.renames.push({ id: lookup, name });
    check(lookup, id, 'The native rename targets the selected unsigned shortcut AppID');
    overview.display_name = name;
    if (state.details) state.details.strDisplayName = name;
   },
   SetShortcutLaunchOptions: async (lookup, value) => { state.launches.push({ id: lookup, value }); },
   RegisterForAppDetails: (lookup, callback) => {
    state.registrations++;
    if (lookup === id && options.callbackDetails) callback(options.callbackDetails === true ? state.details : options.callbackDetails);
    return { unregister() { state.releases++; } };
   },
  } },
 };
 if (options.noDetailsStore) delete owner.appDetailsStore;
 const doc = { defaultView: owner };
 const mappings = {};
 const mappingApi = {
  mappings,
  shortcutMappingKey: value => `shortcut:${value}`,
  titleMappingKey: value => `title:${String(value || '').toLowerCase()}`,
  isMappingSnapshotVerified: () => true,
  findMappingByExe: () => null,
  findMappingForTitle: (name, shortcutId) => mappings[`shortcut:${shortcutId}`] || mappings[`title:${String(name).toLowerCase()}`] || null,
  updateMappingsChecked: async update => {
   state.mappingWrites.push(update);
   for (const key of update.remove || []) delete mappings[key];
   Object.assign(mappings, update.set);
   return true;
  },
 };
 const noop = () => {};
 const mockModules = {
  'frontend/api/backend.ts': {
   backendLog: message => state.logs.push(message),
   listShortcutsBackend: async () => { state.vdfReads++; return { shortcuts: state.rows }; },
   neutralizeSteamAppIdFileBackend: async request => {
    state.neutralized.push(JSON.parse(request.request_json));
    return options.neutralizeAck ? await options.neutralizeAck : JSON.stringify(options.neutralizeResult ?? { ok: true });
   },
   restoreSteamAppIdFileBackend: async request => {
    state.restored.push(JSON.parse(request.request_json)); return JSON.stringify({ ok: true });
   },
  },
  'frontend/core/mappings.ts': mappingApi,
  'frontend/core/game-data.ts': {
   getGameData: async () => ({ steam_appid: Number(officialId), name: title, header_image: 'header.jpg' }),
   getCanonicalGameData: async () => ({ steam_appid: Number(officialId), name: title, header_image: 'header.jpg' }),
  },
  'frontend/steam/localization.ts': { gdlText: (_key, fallback, values = {}) =>
   fallback.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? '') },
  'frontend/features/library/artwork.ts': {
   applyOfficialShortcutIcon: async lookup => { check(lookup, id, 'The icon targets the verified shortcut'); return true; },
   spoofArtwork: async lookup => { state.artworkWrites.push(lookup); return { complete: true, slots: [0, 1, 2, 3], missing: [], communitySlots: [] }; },
   getModernLibraryAssets: async () => ({}), refreshModernLibraryAssets: async () => ({}),
   invalidateLibraryAssetCaches: noop,
   reserveShortcutArtworkTarget: () => { state.reserved++; return () => { state.reserved--; }; },
  },
  'frontend/features/library/artwork-relink-cleanup.ts': {
   clearShortcutArtworkForAppIdChange: async () => {}, clearUnreplacedShortcutArtwork: async () => {},
   prepareShortcutArtworkForAppIdChange: async () => {},
  },
  'frontend/features/library/legacy-games.ts': { isLegacyGame: () => false },
  'frontend/features/library/news.ts': { getNews: async () => [] },
  'frontend/features/library/resource-cache.ts': { invalidateLinkedGameResourceCaches: noop },
  'frontend/features/shortcuts/linked-notes.ts': { clearLinkedGameNote: async () => {} },
  'frontend/features/shortcuts/dismissed.ts': { isShortcutDismissed: () => false, undismissShortcut: noop },
  'frontend/features/shortcuts/link-history.ts': { rememberOriginalShortcutTitle: noop, rememberShortcutSteamAppId: noop },
  'frontend/features/shortcuts/editions.ts': { getShortcutEdition: () => null, saveShortcutEdition: noop },
 };
 const cache = new Map();
 const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
 const context = vm.createContext({ console, setTimeout, clearTimeout, localStorage,
  window: { SteamClient: { Apps: { SetShortcutName() { throw Error('Wrong window'); } } } }, document: doc });
 function load(file) {
  const relative = file.replaceAll('\\', '/');
  if (mockModules[relative]) return mockModules[relative];
  if (cache.has(relative)) return cache.get(relative).exports;
  assert.ok(realModules.has(relative), `Unexpected production dependency ${relative}`);
  const module = { exports: {} };
  cache.set(relative, module);
  const source = baselineHead && baselineModules.has(relative)
   ? execFileSync('git', ['show', `HEAD:${relative}`], { encoding: 'utf8', cwd: root })
   : fs.readFileSync(path.join(root, relative), 'utf8');
  const compiled = ts.transpileModule(source, {
   compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const wrapper = vm.runInContext(`(function(exports, require, module) {${compiled}\n})`, context, { filename: relative });
  wrapper(module.exports, specifier => load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`))), module);
  return module.exports;
 }
 const registry = load('frontend/features/shortcuts/registry.ts');
 const shortcuts = load('frontend/steam/shortcuts.ts');
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts');
 const txApi = load('frontend/features/shortcuts/transaction.ts');
 const link = extra => LinkOrchestrator.execute({ doc, title: 'bf3', shortcutAppId: id,
  steamAppId: officialId, shortcutExecutable: exe, existingLaunchOptions: state.details?.strLaunchOptions ?? '-windowed',
  onStatus: value => state.statuses.push(value), onPhase: value => state.phases.push(value), ...extra });
 return { state, owner, doc, overview, registry, shortcuts, LinkOrchestrator, txApi, mappingApi, link };
}

{
 const h = harness();
 await h.registry.refreshShortcutRecordsFromBackend();
 const row = h.registry.getAllShortcutRecords(h.doc).find(record => record.id === id);
 check(row.app.strShortcutExe, exe, 'A real overview is enriched by its separate native launch details');
 check(row.app.strShortcutStartDir, startDir, 'The exact start directory is available without overview mutation');
 check(row.app.strShortcutLaunchOptions, '-windowed', 'The native strLaunchOptions field survives registry enrichment');
 check(h.shortcuts.getShortcutAppById(id, h.doc), h.overview, 'Native overview lookups retain the original object');
 const result = await h.link();
 check(result.ok, true, `The complete production pipeline links BF3: ${result.error || ''}`);
 check(result.setup.nameReady, true, 'The official name is actually confirmed');
 check(result.setup.artworkComplete, true, 'Artwork is complete before Ready');
 check(result.setup.iconApplied, true, 'The official icon is complete before Ready');
 check(h.mappingApi.mappings[`shortcut:${id}`], officialId, 'The mapping is committed to the verified shortcut');
 check(h.state.renames.length, 1, 'The native display name changes once');
 check(h.overview.display_name, title, 'The native row displays the official title');
 check(h.state.details.strDisplayName, title, 'Steam details agrees with its overview after the rename');
 check(h.state.vdfReads, 1, 'Complete native identity avoids extra VDF reads during resolve and rename confirmation');
 check(h.state.launches.length, 0, 'Linking BF3 preserves its selected launch options');
 check(h.state.reserved, 0, 'The artwork reservation is released after completion');
 check(h.txApi.getActiveTransaction(id), null, 'The actual transaction finishes instead of entering a retry loop');
 check(Object.hasOwn(h.overview, 'strShortcutExe'), false, 'No executable is injected into the native overview');
 check(h.state.neutralized[0].exe_path, exe, 'Post-commit work retains the selected executable');
 check(h.state.neutralized[0].start_dir, startDir, 'Protection uses the native details start directory rather than its empty overview');
 check(h.state.neutralized[0].expires_at_ms > Date.now() && h.state.neutralized[0].expires_at_ms <= Date.now() + 4000,
  true, 'Filesystem maintenance includes a bounded future backend deadline');
 check(h.state.statuses.at(-1).includes('Official name, icon and artwork updated'), true, 'Final status reports verified completion');
}
{
 let acknowledge;
 const neutralizeAck = new Promise(resolve => { acknowledge = resolve; });
 const h = harness({ rows: [], neutralizeAck });
 let finished = false;
 const work = h.link().then(result => { finished = true; return result; });
 const deadline = Date.now() + 1000;
 while (!h.state.neutralized.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 0));
 check(h.state.neutralized.length, 1, 'A details-only native shortcut reaches the real protection helper');
 check(h.state.neutralized[0].exe_path, exe, 'Details-only protection keeps the complete selected executable');
 check(h.state.neutralized[0].start_dir, startDir, 'Details-only protection keeps the complete selected start directory');
 check(finished, false, 'Link completion waits for the backend filesystem acknowledgement');
 check(h.state.mappingWrites.length, 0, 'A pending protection acknowledgement cannot publish a mapping');
 check(h.state.statuses.at(-1).includes('Official name, icon and artwork updated'), false,
  'The dialog cannot report completion while protection is still pending');
 acknowledge(JSON.stringify({ ok: true, modified: true }));
 const result = await work;
 check(result.ok, true, 'The real linking pipeline completes after protection is acknowledged');
 check(h.state.logs.some(message => message.includes('[steam_appid.txt] neutralize confirmed')), true,
  'Confirmed protection is observable instead of silently ignored');
}
{
 const h = harness({ rows: [], neutralizeResult: { ok: false, error: 'steam_appid_backup_conflict' } });
 const result = await h.link();
 check(result.ok, false, 'An explicit protection failure blocks successful linking');
 check(result.error, 'steam_appid_file_protection_failed', 'Protection failure reports its terminal linking cause');
 check(h.state.mappingWrites.length, 0, 'Protection failure never publishes the final mapping');
 check(h.mappingApi.mappings[`shortcut:${id}`], undefined, 'Protection failure leaves the shortcut unlinked');
 check(h.state.statuses.some(message => message.includes('Official name, icon and artwork updated')), false,
  'Protection failure cannot report Ready');
 check(h.state.restored.length, 0, 'A rejected protection call is not followed by an unrelated restoration');
}
{
 const h = harness({ details: false });
 await h.registry.refreshShortcutRecordsFromBackend();
 const row = h.registry.getAllShortcutRecords(h.doc).find(record => record.id === id);
 check(row.app.strShortcutExe, exe, 'A VDF row supplements the same live AppID when native details are absent');
 const result = await h.link();
 check(result.ok, true, `The VDF-backed full pipeline completes: ${result.error || ''}`);
 check(h.state.vdfReads, 1, 'The already loaded exact VDF identity remains usable during rename');
 check(Object.hasOwn(h.overview, 'strShortcutExe'), false, 'VDF fallback also leaves the native overview untouched');
 check(h.mappingApi.mappings[`shortcut:${id}`], officialId, 'VDF evidence commits only the exact selected AppID');
}
{
 const h = harness({ details: { strShortcutExe: 'E:\\Games\\Different\\game.exe' } });
 await h.registry.refreshShortcutRecordsFromBackend();
 const result = await h.link();
 check(result.ok, false, 'A changed live executable cannot be authorized by an old VDF row');
 check(result.error, 'shortcut_identity_changed', 'A path conflict reports the real terminal cause');
 check(h.state.renames.length, 0, 'A conflicting launch definition is never renamed');
 check(h.state.mappingWrites.length, 0, 'A conflicting launch definition never receives the mapping');
 check(h.state.artworkWrites.length, 0, 'No artwork is written to a conflicting shortcut');
}
{
 const h = harness({ launchOptions: '', vdfLaunchOptions: '-windowed' });
 await h.registry.refreshShortcutRecordsFromBackend();
 const row = h.registry.getAllShortcutRecords(h.doc).find(record => record.id === id);
 check(row.app.strShortcutLaunchOptions, '', 'An explicitly cleared native launch option never revives stale VDF arguments');
}
{
 const h = harness({ noDetailsStore: true, rows: [], callbackDetails: true });
 const result = await h.link();
 check(result.ok, true, `Native callbacks complete the link even before its public details store exists: ${result.error || ''}`);
 check(result.setup.nameReady, true, 'A fresh exact native callback verifies the post-rename executable');
 check(h.mappingApi.mappings[`shortcut:${id}`], officialId, 'Callback-only native identity commits the exact mapping');
 check(h.state.registrations >= 2, true, 'Native details are checked before mutation and after the rename');
 check(h.state.releases, h.state.registrations, 'Every callback-only subscription is released');
 check(Object.hasOwn(h.overview, 'strShortcutExe'), false, 'Native callback enrichment does not mutate its overview');
}
console.log(`PASS native-shape shortcut link integration: ${assertions} assertions across real registry, identity, rename, mapping and transaction modules`);
