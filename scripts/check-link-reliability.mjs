import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks, globals = {}) {
 const context = vm.createContext({ exports: {}, require: () => mocks, ...globals });
 vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
 }).outputText, context);
 return context.exports;
}
function queueHarness(shared = new Map()) {
 const state = { calls: [], inputs: [], mapped: null, epoch: 1, result: async () => ({ ok: false, error: 'network_timeout' }) };
 const storage = { getItem: key => shared.get(key), setItem: (key, value) => shared.set(key, value) };
 const api = load('frontend/features/shortcuts/link-job-queue.ts', {
  backendLog() {}, shortcutRuntimeHost: () => ({ getMainWindowDoc: () => ({ defaultView: { localStorage: storage } }) }),
  findMappingForShortcut: () => state.mapped, getFactoryResetEpoch: () => state.epoch,
  isFactoryEpochCurrent: epoch => epoch === state.epoch, isFactoryResetInProgress: () => false,
  linkShortcutToSteam: async options => { state.calls.push(options.shortcutAppId); state.inputs.push(options); return state.result(options); },
 }, { window: { dispatchEvent() {} }, CustomEvent: class {}, setTimeout: () => 1, clearTimeout() {} });
 return { api, state, shared };
}
const input = (id, extra = {}) => ({ shortcutAppId: id, title: 'Same Game', steamAppId: '100',
 skipLauncher: false, existingLaunchOptions: '',
 shortcutExecutable: `C:/Games/${id}/game.exe`, ...extra });
{
 const { api } = queueHarness();
 const a = api.enqueueLinkJob(input(3000000001, { shortcutExecutable: 'same.exe' }));
 const b = api.enqueueLinkJob(input(3000000002, { shortcutExecutable: 'same.exe', steamAppId: '200' }));
 assert.ok(api.getPendingLinkJob(a.id), 'Distinct known IDs may share an executable');
 assert.ok(api.getPendingLinkJob(b.id));
}
{
 const { api } = queueHarness();
 const a = api.enqueueLinkJob(input(3000000001));
 const b = api.enqueueLinkJob(input(3000000002));
 assert.equal(api.hasPendingLinkJob(3000000003, 'Same Game'), false);
 assert.equal(api.cancelPendingLinkJobs(3000000002, 'Same Game'), 1);
 assert.ok(api.getPendingLinkJob(a.id));
 assert.equal(api.getPendingLinkJob(b.id), null);
}
{
 const { api, state } = queueHarness();
 let release;
 state.result = () => new Promise(resolve => { release = resolve; });
 api.enqueueLinkJob(input(3000000001));
 api.enqueueLinkJob(input(3000000002));
 const work = api.processPendingLinkJobs();
 api.cancelPendingLinkJobs(3000000002);
 release({ ok: true });
 await work;
 assert.deepEqual(state.calls, [3000000001], 'Cancelled later job must never be executed or resurrected');
}
{
 const { api, state } = queueHarness();
 let release;
 state.result = () => new Promise(resolve => { release = resolve; });
 const job = api.enqueueLinkJob(input(3000000001));
 const work = api.processPendingLinkJobs();
 api.stageLinkJobForRecovery(input(3000000001));
 release({ ok: true });
 await work;
 assert.equal(api.getPendingLinkJob(job.id).status, 'staged', 'Old completion must not erase a newer foreground intent');
}
{
 const { api, state, shared } = queueHarness();
 const job = api.stageLinkJobForRecovery(input(3000000001));
 await api.processPendingLinkJobs();
 assert.equal(state.calls.length, 0);
 const restarted = queueHarness(shared);
 await restarted.api.processPendingLinkJobs();
 assert.equal(restarted.state.calls.length, 1, 'A new session resumes interrupted foreground work');
 assert.equal(restarted.api.getPendingLinkJob(job.id).attempts, 1);
}
{
 const legacyJob = { ...input(3000000001), id: 'legacy-repair', status: 'queued', attempts: 0, createdAt: 1,
  trackingExecutable: 'C:/Games/Real/Shipping.exe', trackingStartDir: 'C:/Games/Real' };
 const shared = new Map([['gdl-pending-link-jobs-v1', JSON.stringify([legacyJob])]]);
 const { api, state } = queueHarness(shared);
 state.result = async () => ({ ok: true });
 await api.processPendingLinkJobs();
 assert.equal(state.inputs.length, 1, 'A legacy queued link must still resume');
 assert.equal(state.inputs[0].shortcutExecutable, legacyJob.shortcutExecutable, 'Recovery preserves the selected executable identity');
 for (const key of ['trackingExecutable', 'trackingStartDir']) {
  assert.equal(Object.hasOwn(state.inputs[0], key), false, `Legacy queue payload must not forward ${key}`);
 }
}
for (const error of ['invalid_appid', 'Error: refusing_to_modify_native_steam_app', 'shortcut_identity_ambiguous', 'shortcut_identity_changed']) {
 const { api, state } = queueHarness();
 state.result = async () => ({ ok: false, error });
 const job = api.enqueueLinkJob(input(3000000001));
 await api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id).status, 'failed');
 await api.processPendingLinkJobs();
 assert.equal(state.calls.length, 1);
}
{
 const { api, state } = queueHarness();
 state.mapped = '100';
 state.result = async () => ({ ok: true, setup: { artworkComplete: true, iconApplied: false } });
 const job = api.enqueueLinkJob(input(3000000001, { repairResources: true }));
 await api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id).lastError, 'resource_sync_incomplete');
 state.result = async () => ({ ok: true, setup: { artworkComplete: true, iconApplied: true } });
 api.enqueueLinkJob(input(3000000001, { repairResources: true }));
 await api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id), null);
}
{
 const records = [];
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', {
  refreshShortcutRecordsFromBackend: async () => {}, getAllShortcutRecords: () => records,
  getShortcutAppById: id => records.find(record => record.id === id)?.app,
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  readShortcutOverviewField: app => app.exe,
 }, { setTimeout: callback => { callback(); return 1; }, clearTimeout() {} });
 const tx = () => ({ isCurrent: () => true });
 const options = { title: 'Same Game', steamAppId: '100' };
 records.push({ id: 3000000001, title: 'Same Game', app: { exe: 'a.exe' } });
 assert.equal(await LinkOrchestrator.resolveIdentity(tx(), options, 'Same Game'), 3000000001);
 records.push({ id: 3000000002, title: 'Same Game', app: { exe: 'b.exe' } });
 await assert.rejects(LinkOrchestrator.resolveIdentity(tx(), options, 'Same Game'), /shortcut_identity_ambiguous/);
 assert.equal(await LinkOrchestrator.resolveIdentity(tx(), { ...options, shortcutAppId: 3000000002 }, 'Same Game'), 3000000002);
 await assert.rejects(LinkOrchestrator.resolveIdentity(tx(), { ...options, shortcutAppId: 3000000002, shortcutExecutable: 'a.exe' }, 'Same Game'),
  /shortcut_identity_changed/, 'A shortcut whose executable changed after review cannot receive another game mapping');
 assert.equal(await LinkOrchestrator.resolveIdentity(tx(), { ...options, shortcutExecutable: 'A.EXE' }, 'Renamed'), 3000000001);
 await assert.rejects(LinkOrchestrator.resolveIdentity(tx(), { ...options, shortcutExecutable: 'missing.exe' }, 'Same Game'), /shortcut_not_ready/);
 records.length = 0;
 await assert.rejects(LinkOrchestrator.resolveIdentity(tx(), { ...options, shortcutAppId: 3000000001 }, 'Same Game'), /shortcut_not_ready/);
 for (const steamAppId of ['0', '-1', '2147483648', '123abc']) {
  assert.equal((await LinkOrchestrator.execute({ ...options, steamAppId })).error, 'invalid_appid');
 }
 assert.equal((await LinkOrchestrator.execute({ ...options, shortcutAppId: 100 })).error, 'refusing_to_modify_native_steam_app');
}
{
 const { mergeCandidateLists } = load('frontend/features/shortcuts/candidate-merger.ts', {});
 const [merged] = mergeCandidateLists([{ appid: '100', warnings: ['identity_conflict', 'remote_validation_unavailable'], identity_collision: true }],
  [{ appid: '100', warnings: [], identity_collision: false }]);
 assert.equal(merged.identity_collision, true);
 assert.ok(merged.warnings.includes('identity_conflict'));
 assert.ok(!merged.warnings.includes('remote_validation_unavailable'));
}

// Steam may regenerate a shortcut ID when its display name changes. Both link
// entry points must keep the original launcher as the executable identity,
// including when an old persisted/UI payload still supplies replacement paths.
function identityHarness() {
 const originalId = 3000000001, renamedId = 3000000002;
 const selectedExe = 'C:/Games/SparkingZERO/SparkingZERO.exe';
 const selectedStartDir = 'C:/Games/SparkingZERO';
 const replacementExe = 'C:/Games/SparkingZERO/Binaries/Win64/SparkingZERO-Win64-Shipping.exe';
 const state = { writes: [], neutralized: [], renames: 0, mapping: null, edition: null };
 let record = { id: originalId, title: 'Original shortcut', app: {
  display_name: 'Original shortcut', strShortcutExe: selectedExe, strShortcutStartDir: selectedStartDir,
 } };
 const readField = (app, ...keys) => keys.map(key => app?.[key]).find(value => value != null && value !== '') || '';
 const mocks = {
  backendLog() {},
  gdlText: (_key, fallback) => fallback,
  getShortcutAppById: id => id === record.id ? record.app : null,
  getAllShortcutRecords: () => [record],
  findMappingForShortcut: () => null,
  refreshShortcutRecordsFromBackend: async () => {},
  readShortcutOverviewField: readField,
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  getGameData: async () => ({ name: 'DRAGON BALL: Sparking! ZERO', steam_appid: 1790600 }),
  getCanonicalGameData: async () => ({ name: 'DRAGON BALL: Sparking! ZERO', steam_appid: 1790600 }),
  getShortcutEdition: () => state.edition,
  resolveShortcutIdAfterRename: async (_name, previousId, _ids, executable) => {
   assert.equal(previousId, originalId);
   assert.equal(executable, selectedExe, 'Rename recovery must use the selected launcher executable');
   return renamedId;
  },
  rememberOriginalShortcutTitle() {}, rememberShortcutSteamAppId() {},
  getOptimalLauncherSkipArg: () => null, hasNoLauncherOption: () => false, shouldAutoApplyNoLauncher: () => false,
  isShortcutDismissed: () => false, undismissShortcut() {},
  shortcutMappingKey: id => `shortcut:${id}`, titleMappingKey: title => `title:${title}`,
  normalizeTitle: value => value.toLowerCase(),
  updateMappingsChecked: async mapping => { state.mapping = mapping; return true; },
  neutralizeSteamAppIdFileBackend: async ({ request_json }) => { state.neutralized.push(JSON.parse(request_json)); },
  fetchPlaytimeStatsBatch: async () => new Map(),
  shortcutRuntimeHost: () => ({}),
  getModernLibraryAssets: async () => null,
  getNews: async () => null,
  clearLinkedGameNote: async () => {},
  reserveShortcutArtworkTarget: () => () => {},
  createLinkTransaction: (id, steamAppId) => ({ initialShortcutAppId: id, resolvedShortcutAppId: id,
   targetSteamAppId: steamAppId, isCurrent: () => true, manifest: {} }),
  runShortcutMutations: (_keys, work) => work(), shortcutMutationKeys: options => options,
 };
 const globals = { setTimeout, clearTimeout, window: { dispatchEvent() {}, SteamClient: { Apps: {
  SetShortcutExe: async (id, value) => { state.writes.push(['exe', id, value]); record.app.strShortcutExe = value; },
  SetShortcutStartDir: async (id, value) => { state.writes.push(['startDir', id, value]); record.app.strShortcutStartDir = value; },
  SetShortcutName: async (_id, title) => { state.renames += 1; record = { ...record, id: renamedId, title,
   app: { ...record.app, display_name: title } }; },
 } } }, CustomEvent: class {} };
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', mocks, globals);
 const linking = load('frontend/features/shortcuts/linking.ts', { ...mocks, LinkOrchestrator }, globals);
 const options = { shortcutAppId: originalId, title: 'Original shortcut', currentTitle: 'Original shortcut',
  steamAppId: '1790600', shortcutExecutable: selectedExe, trackingExecutable: replacementExe,
  trackingStartDir: 'C:/Games/SparkingZERO/Binaries/Win64', deferAssetSync: true, refreshLibrary: false };
 return { state, options, selectedExe, selectedStartDir, renamedId, linking, LinkOrchestrator };
}
for (const entry of ['synchronizeShortcutOfficialIdentity', 'linkShortcutToSteam']) {
 const { state, options, selectedExe, selectedStartDir, renamedId, linking } = identityHarness();
 const result = await linking[entry](options);
 assert.equal(result[entry === 'linkShortcutToSteam' ? 'ok' : 'complete'], true, `${entry} still completes linking: ${result.error || ''}`);
 assert.equal(result.shortcutAppId, renamedId, `${entry} resolves Steam's regenerated shortcut ID`);
 assert.equal(state.renames, 1, `${entry} still applies the official display name`);
 assert.deepEqual(state.writes, [], `${entry} must never replace the selected executable or start directory`);
 assert.equal(state.mapping.set[`shortcut:${renamedId}`], options.steamAppId, `${entry} commits the regenerated identity`);
 assert.deepEqual(state.neutralized, [{ exe_path: selectedExe, start_dir: selectedStartDir }],
  `${entry} filesystem maintenance uses the preserved selected executable`);
}
{
 const { state, LinkOrchestrator, options } = identityHarness();
 const tx = { targetSteamAppId: options.steamAppId };
 state.edition = { appId: '1091500', name: 'Cyberpunk 2077: Ultimate Edition' };
 assert.equal((await LinkOrchestrator.validateCandidate(tx, options)).canonicalName, 'DRAGON BALL: Sparking! ZERO',
  'A stored edition for a different Steam AppID cannot rename a newly linked game');
 state.edition = { appId: options.steamAppId, name: 'Explicit matching edition' };
 assert.equal((await LinkOrchestrator.validateCandidate(tx, options)).canonicalName, state.edition.name,
  'The explicitly selected edition still applies to the matching Steam AppID');
}
{
 const { LinkOrchestrator } = identityHarness();
 const tx = { isCurrent: () => true };
 const options = { title: 'Original shortcut', steamAppId: '1790600',
  trackingExecutable: 'C:/Games/RemovedFeature/Shipping.exe' };
 assert.equal(await LinkOrchestrator.resolveIdentity(tx, options, options.title), 3000000001,
  'A legacy replacement path cannot displace the selected shortcut during identity resolution');
}
{
 const selectedExe = 'C:/Games/SparkingZERO/SparkingZERO.exe';
 const selectedStartDir = 'C:/Games/SparkingZERO';
 const requests = [];
 const readField = (app, ...keys) => keys.map(key => app?.[key]).find(Boolean) || '';
 const candidates = { candidates: [{ appid: '1790600', name: 'DRAGON BALL: Sparking! ZERO', score: 99, confidence: 'exact' }] };
 const detection = load('frontend/features/shortcuts/detection.ts', {
  RetryingRequestCache: class { get(_key, loader) { return loader(); } },
  getShortcutAppById: () => ({ strShortcutExe: selectedExe, strShortcutStartDir: selectedStartDir, strShortcutLaunchOptions: '-windowed' }),
  readShortcutOverviewField: readField,
  cleanShortcutPath: value => String(value || '').trim().replace(/^"|"$/g, ''),
  shortcutPathBasename: value => value.split(/[\\/]/).pop(),
  getShortcutDetailsBackend: async () => ({ exe_path: selectedExe, start_dir: selectedStartDir,
   bootstrap_detected: true, recommended_exe_path: 'C:/Games/SparkingZERO/Binaries/Win64/Shipping.exe',
   recommended_start_dir: 'C:/Games/SparkingZERO/Binaries/Win64', tracking_executable_auto_apply: true }),
  getSteamLanguage: async () => 'english', expandCandidatesWithEditions: values => values,
  detectGameCandidatesLocalBackend: async ({ request_json }) => { requests.push(JSON.parse(request_json)); return candidates; },
  detectGameCandidatesBackend: async ({ request_json }) => { requests.push(JSON.parse(request_json)); return candidates; },
  backendLog() {},
 }, { window: {}, setTimeout: () => 1 });
 const context = await detection.buildShortcutDetectionContext(null, 'SparkingZERO', 3000000001);
 assert.equal(context.exePath, selectedExe, 'Detection preserves the selected launcher executable');
 assert.equal(context.startDir, selectedStartDir);
 assert.equal(context.launchOptions, '-windowed');
 for (const key of ['recommendedExePath', 'recommendedStartDir', 'bootstrapDetected', 'trackingExecutableAutoApply']) {
  assert.equal(Object.hasOwn(context, key), false, `Detection context must not expose removed field ${key}`);
 }
 // Old callers may still pass these fields; detection must ignore them as well.
 const legacyContext = { ...context, recommendedExePath: 'C:/Games/Wrong/Shipping.exe', recommendedStartDir: 'C:/Games/Wrong' };
 for (const detect of [detection.detectShortcutCandidatesLocal, detection.enrichShortcutCandidatesRemote]) {
  const result = await detect(legacyContext);
  assert.equal(result.candidates[0].appid, '1790600', 'AppID detection continues with the original launcher');
 }
 assert.equal(requests.length, 2);
 for (const request of requests) {
  assert.equal(request.exe_path, selectedExe);
  assert.equal(request.start_dir, selectedStartDir);
  assert.equal(request.launch_options, '-windowed');
  assert.equal(Object.hasOwn(request, 'game_exe_path'), false, 'Detection must not send a replacement game executable');
  assert.equal(Object.hasOwn(request, 'game_start_dir'), false, 'Detection must not send a replacement start directory');
 }
}
{
 let image, timeout;
 class Image { constructor() { image = this; } }
 const { automaticArtworkMeetsSlotQuality: quality } = load('frontend/features/library/artwork-quality.ts', {}, {
  Image, setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {},
 });
 let pending = quality('data:image/png;base64,fixture', 1);
 Object.assign(image, { naturalWidth: 1920, naturalHeight: 620 });
 image.onload(); assert.equal(await pending, true);
 pending = quality('data:image/png;base64,fixture', 1);
 Object.assign(image, { naturalWidth: 200, naturalHeight: 200 });
 image.onload(); assert.equal(await pending, false);
 pending = quality('data:image/png;base64,broken', 2);
 image.onerror(); assert.equal(await pending, false);
 pending = quality('data:image/png;base64,stalled', 2);
 timeout(); assert.equal(await pending, false);
 assert.equal(image.onload, null);
}
console.log('Link reliability passed: duplicate identity, cancellation races, interrupted-session recovery, terminal errors, incomplete icons, candidate warnings, invalid IDs, selected executable preservation, legacy payload isolation, original-executable detection, bounded image decoding.');
