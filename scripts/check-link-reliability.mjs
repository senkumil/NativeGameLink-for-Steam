import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks, globals = {}) {
 const context = vm.createContext({ exports: {}, require: specifier => specifier === './steam-appid-file'
  ? load('frontend/features/shortcuts/steam-appid-file.ts', mocks, globals) : mocks, ...globals });
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
  linkShortcutToSteam: async options => {
   state.calls.push(options.shortcutAppId); state.inputs.push(options);
   const result = await state.result(options);
   if (result.ok) state.mapped = options.steamAppId;
   return result.ok && !Object.hasOwn(result, 'setup')
    ? { ...result, setup: { artworkComplete: true, iconApplied: true } } : result;
  },
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
 assert.equal(api.getLinkJobCompletion(b.id, b.createdAt), false, 'Cancellation never masquerades as completion');
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
{
 const interrupted = { ...input(3000000001), id: 'interrupted-running', status: 'running', phase: 'assets',
  attempts: 0, createdAt: 1, sessionId: 'terminated-cef-session' };
 const { api, state } = queueHarness(new Map([['gdl-pending-link-jobs-v1', JSON.stringify([interrupted])]]));
 assert.equal(api.getPendingLinkJob(interrupted.id).status, 'queued', 'A running job belongs only to the renderer that started it');
 state.result = async () => ({ ok: true });
 await api.processPendingLinkJobs();
 assert.equal(state.calls.length, 1, 'A renderer restart resumes interrupted running work');
 assert.equal(api.getPendingLinkJob(interrupted.id), null);
}
for (const error of ['invalid_appid', 'Error: refusing_to_modify_native_steam_app', 'shortcut_identity_ambiguous', 'shortcut_identity_changed', 'steam_appid_file_protection_failed']) {
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
 let finish;
 state.result = options => new Promise(resolve => { finish = resolve; options.onPhase('assets'); });
 const job = api.enqueueLinkJob(input(3000000001, { repairResources: true }));
 const work = api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id).status, 'running', 'The current renderer must expose the actual running state');
 assert.equal(api.getPendingLinkJob(job.id).phase, 'assets', 'Background setup publishes its active phase to an open dialog');
 state.mapped = '100';
 finish({ ok: true, setup: { artworkComplete: true, iconApplied: true } });
 await work;
 assert.equal(api.getPendingLinkJob(job.id), null);
 assert.equal(api.getLinkJobCompletion(job.id, job.createdAt), true, 'Only verified successful queue retirement records completion');
}
{
 const { api, state } = queueHarness();
 state.result = async () => ({ ok: true, shortcutAppId: 3000000002, setup: { artworkComplete: true, iconApplied: true } });
 const job = api.enqueueLinkJob(input(3000000001));
 await api.processPendingLinkJobs();
 assert.equal(api.getLinkJobCompletion(job.id, job.createdAt), true);
 assert.equal(api.getLinkJobCompletedShortcutAppId(job.id, job.createdAt), 3000000002,
  'Completion keeps the final regenerated shortcut ID even when retirement is its only event');
}
{
 const { api, state } = queueHarness();
 state.result = async () => ({ ok: true, setup: { artworkComplete: false, iconApplied: true } });
 const job = api.enqueueLinkJob(input(3000000001));
 await api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id).repairResources, true, 'Partial foreground recovery becomes a durable resource repair');
 assert.equal(api.getLinkJobCompletion(job.id, job.createdAt), undefined, 'A committed identity alone cannot show Ready');
 state.result = async () => ({ ok: true, setup: { artworkComplete: true, iconApplied: true } });
 api.enqueueLinkJob(input(3000000001, { repairResources: true }));
 await api.processPendingLinkJobs();
 assert.equal(api.getLinkJobCompletion(job.id, job.createdAt), true);
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
 const { api, state } = queueHarness();
 state.result = async () => ({ ok: true, setup: { artworkComplete: false, iconApplied: false } });
 const job = api.enqueueLinkJob(input(3000000001));
 for (let attempt = 0; attempt < 5; attempt++) {
  if (attempt) api.enqueueLinkJob(input(3000000001, { repairResources: true }));
  await api.processPendingLinkJobs();
  const pending = api.getPendingLinkJob(job.id);
  if (pending) assert.equal(pending.linkCommitted, true, 'Successful identity/protection transaction is recorded separately from optional resources');
 }
 assert.equal(api.getPendingLinkJob(job.id), null, 'Unavailable images cannot leave a permanent failed link job');
 assert.equal(api.getLinkJobCompletion(job.id, job.createdAt), true);
 assert.equal(api.getLinkJobResourcesPending(job.id, job.createdAt), true, 'Degraded completion remains honest about unavailable images');
}
{
 const { api, state } = queueHarness();
 state.mapped = '100';
 state.result = async () => ({ ok: false, error: 'steam_appid_file_protection_failed', setup: { artworkComplete: true, iconApplied: true } });
 const job = api.enqueueLinkJob(input(3000000001, { repairResources: true }));
 await api.processPendingLinkJobs();
 assert.equal(api.getPendingLinkJob(job.id).status, 'failed', 'An old mapping and images cannot hide failed launch-file protection');
 assert.notEqual(api.getLinkJobCompletion(job.id, job.createdAt), true);
}
{
 const timers = new Map(), requests = [], snapshots = [];
 let timerId = 0;
 const { refreshShortcutRecordsFromBackend: refresh, getAllShortcutRecords: records } = load('frontend/features/shortcuts/registry.ts', {
  backendLog() {}, getSteamAppStore: () => null, replaceFallbackShortcutApps: value => snapshots.push(value),
  readShortcutLaunchDetails: () => null, readShortcutOverviewField: (app, ...keys) => keys.map(key => app?.[key]).find(Boolean) || '',
  listShortcutsBackend: () => new Promise(resolve => requests.push(resolve)),
 }, { setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout: id => timers.delete(id) });
 const first = refresh();
 assert.equal(refresh(), first, 'Concurrent VDF readers share one bounded backend request');
 assert.equal(requests.length, 1);
 const deadline = Array.from(timers.values()).find(timer => timer.delay === 1800);
 assert.ok(deadline, 'A stalled VDF RPC has an internal deadline');
 deadline.callback();
 await first;
 const second = refresh();
 assert.equal(requests.length, 2, 'A stalled VDF RPC does not poison all future shortcut refreshes');
 requests[1]({ shortcuts: [{ shortcut_app_id: 3000000002, title: 'Current shortcut', exe_path: 'current.exe' }] });
 await second;
 requests[0]({ shortcuts: [{ shortcut_app_id: 3000000001, title: 'Obsolete shortcut', exe_path: 'old.exe' }] });
 await Promise.resolve(); await Promise.resolve();
 assert.deepEqual(Array.from(records(), item => item.id), [3000000002], 'An expired VDF response cannot resurrect a pre-rename shortcut');
 assert.equal(snapshots.length, 1, 'Only the current VDF snapshot reaches Steam fallback identity');
}
{
 const doc = { defaultView: {} }, app = { exe: 'C:/Games/Battlefield 3/bf3.exe' };
 let refreshes = 0, lookups = 0;
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', {
  refreshShortcutRecordsFromBackend: () => { refreshes++; return new Promise(() => {}); },
  getShortcutAppById: (id, owner) => { lookups++; assert.equal(owner, doc); return id === 3000000001 ? app : null; },
  getAllShortcutRecords: owner => { assert.equal(owner, doc); return []; },
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(), readShortcutOverviewField: value => value.exe,
 });
 const tx = { isCurrent: () => true };
 assert.equal(await LinkOrchestrator.resolveIdentity(tx,
  { doc, title: 'bf3', shortcutAppId: 3000000001, shortcutExecutable: app.exe }, 'Battlefield 3'), 3000000001);
 assert.equal(lookups, 1);
 assert.equal(refreshes, 0, 'A concrete live ID and matching executable never wait on the VDF/HTTP queue');
 await assert.rejects(LinkOrchestrator.resolveIdentity(tx,
  { doc, title: 'bf3', shortcutAppId: 3000000001, shortcutExecutable: 'different.exe' }, 'Battlefield 3'), /shortcut_identity_changed/);
 assert.equal(refreshes, 0, 'A known executable mismatch fails before any backend delay or mutation');
}
{
 const records = [];
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', {
  refreshShortcutRecordsFromBackend: async () => {}, getAllShortcutRecords: () => records,
  getShortcutAppById: id => records.find(record => record.id === id)?.app,
  readFreshShortcutLaunchDetails: async () => null,
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
function identityHarness({ overviewOnly = false, neutralizeAck, neutralizeResult = { ok: true } } = {}) {
 const originalId = 3000000001, renamedId = 3000000002;
 const selectedExe = 'C:/Games/SparkingZERO/SparkingZERO.exe';
 const selectedStartDir = 'C:/Games/SparkingZERO';
 const replacementExe = 'C:/Games/SparkingZERO/Binaries/Win64/SparkingZERO-Win64-Shipping.exe';
 const state = { writes: [], neutralized: [], restored: [], renames: 0, mapping: null, edition: null, mappingAccepted: true };
 let record = { id: originalId, title: 'Original shortcut', app: {
  display_name: 'Original shortcut', strShortcutExe: selectedExe, strShortcutStartDir: selectedStartDir,
 } };
 const overview = Object.seal({ appid: originalId, display_name: 'Original shortcut' });
 const readField = (app, ...keys) => keys.map(key => app?.[key]).find(value => value != null && value !== '') || '';
 const mocks = {
  backendLog() {},
  gdlText: (_key, fallback) => fallback,
  getShortcutAppById: id => id === record.id ? (overviewOnly ? overview : record.app) : null,
  getAllShortcutRecords: () => [record],
  findMappingForShortcut: () => null,
  refreshShortcutRecordsFromBackend: async () => {},
  readShortcutOverviewField: readField,
  readShortcutLaunchDetails: id => id === record.id ? record.app : null, readFreshShortcutLaunchDetails: async () => null,
  cleanShortcutPath: value => String(value || '').trim().replace(/^"|"$/g, ''),
  shortcutPathDirectory: value => String(value || '').replace(/[\\/][^\\/]*$/, ''),
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  getGameData: async () => ({ name: 'DRAGON BALL: Sparking! ZERO', steam_appid: 1790600 }),
  getCanonicalGameData: async () => ({ name: 'DRAGON BALL: Sparking! ZERO', steam_appid: 1790600 }),
  getShortcutEdition: () => state.edition,
  resolveShortcutIdAfterRename: async (_name, previousId, _ids, executable) => {
   assert.equal(previousId, originalId);
   assert.equal(executable, overviewOnly ? '' : selectedExe, 'Rename recovery reads only the fields actually published by its overview');
   return renamedId;
  },
  rememberOriginalShortcutTitle() {}, rememberShortcutSteamAppId() {},
  getOptimalLauncherSkipArg: () => null, hasNoLauncherOption: () => false, shouldAutoApplyNoLauncher: () => false,
  isShortcutDismissed: () => false, undismissShortcut() {},
  shortcutMappingKey: id => `shortcut:${id}`, titleMappingKey: title => `title:${title}`,
  normalizeTitle: value => value.toLowerCase(),
  updateMappingsChecked: async mapping => { state.mapping = mapping; return state.mappingAccepted; },
  neutralizeSteamAppIdFileBackend: async ({ request_json }) => {
   state.neutralized.push(JSON.parse(request_json));
   return neutralizeAck ? await neutralizeAck : JSON.stringify(neutralizeResult);
  },
  restoreSteamAppIdFileBackend: async ({ request_json }) => {
   state.restored.push(JSON.parse(request_json)); return JSON.stringify({ ok: true });
  },
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
  SetShortcutName: async (_id, title) => { state.renames += 1; overview.appid = renamedId; overview.display_name = title; record = { ...record, id: renamedId, title,
   app: { ...record.app, display_name: title } }; },
 } } }, CustomEvent: class {} };
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', mocks, globals);
 const linking = load('frontend/features/shortcuts/linking.ts', { ...mocks, LinkOrchestrator }, globals);
 const options = { shortcutAppId: originalId, title: 'Original shortcut', currentTitle: 'Original shortcut',
  steamAppId: '1790600', shortcutExecutable: selectedExe, trackingExecutable: replacementExe,
  trackingStartDir: 'C:/Games/SparkingZERO/Binaries/Win64', deferAssetSync: true, refreshLibrary: false };
 return { state, options, selectedExe, selectedStartDir, renamedId, linking, LinkOrchestrator, globals, overview };
}
{
 const { state, options, globals, linking } = identityHarness();
 const ownerApps = globals.window.SteamClient.Apps;
 options.doc = { defaultView: { SteamClient: { Apps: ownerApps } } };
 globals.window.SteamClient = { Apps: { SetShortcutName() { throw new Error('wrong_steam_renderer'); } } };
 const result = await linking.linkShortcutToSteam(options);
 assert.equal(result.ok, true, 'A manual popup uses the Steam bridge belonging to its document');
 assert.equal(state.renames, 1, 'The document bridge applies the official title instead of silently accepting a failed foreign bridge');
}
for (const acknowledgement of ['never', 'acknowledged']) {
 const originalId = 3000000001, freshId = 3000000002, exe = 'C:/Games/Battlefield 3/bf3.exe';
 const records = [{ id: originalId, app: { display_name: 'bf3', strShortcutExe: exe } }];
 let renameCalls = 0;
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', {
  getShortcutAppById: id => records.find(record => record.id === id)?.app,
  getAllShortcutRecords: () => records,
  refreshShortcutRecordsFromBackend: async () => {},
  readShortcutOverviewField: (app, ...keys) => keys.map(key => app?.[key]).find(Boolean) || '',
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  getOptimalLauncherSkipArg: () => null, backendLog() {}, rememberOriginalShortcutTitle() {}, getShortcutEdition: () => null,
 }, { window: { SteamClient: { Apps: { SetShortcutName() {
  renameCalls++; return acknowledgement === 'never' ? new Promise(() => {}) : Promise.resolve();
 } } } }, setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout() {} });
 const tx = { initialShortcutAppId: originalId, resolvedShortcutAppId: originalId, targetSteamAppId: '1238820', isCurrent: () => true };
 const options = { title: 'bf3', shortcutExecutable: exe }, data = { name: 'Battlefield 3' };
 await assert.rejects(LinkOrchestrator.mutateShortcutIdentity(tx, options, data, data.name), /shortcut_rename_pending/,
  `${acknowledgement}: the old row cannot falsely confirm the official title`);
 await assert.rejects(LinkOrchestrator.mutateShortcutIdentity(tx, options, data, data.name), /shortcut_rename_pending/);
 await assert.rejects(LinkOrchestrator.mutateShortcutIdentity(tx, options, data, 'Another Game'), /shortcut_rename_pending/,
  'A new target cannot race an unobserved previous Steam rename');
 assert.equal(renameCalls, 1, 'Retrying a stalled Steam bridge intent never issues a second overlapping rename');
 records.push({ id: freshId, app: { display_name: data.name, strShortcutExe: exe } });
 const recovered = await LinkOrchestrator.mutateShortcutIdentity(tx, options, data, data.name);
 assert.equal(recovered.nameReady, true);
 assert.equal(recovered.resolvedShortcutId, freshId, 'A late canonical row is recovered even while the stale old row remains visible');
 assert.equal(renameCalls, 1, 'Observing a late rename completes identity without another bridge mutation');
}
{
 const originalId = 3000000001, freshId = 3000000002, exe = 'E:/Juegos/Battlefield 3/bf3.exe';
 const records = [{ id: originalId, app: { display_name: 'bf3', strShortcutExe: exe } }];
 let refreshes = 0;
 const { LinkOrchestrator } = load('frontend/features/shortcuts/link-orchestrator.ts', {
  getShortcutAppById: id => records.find(record => record.id === id)?.app,
  getAllShortcutRecords: () => records,
  refreshShortcutRecordsFromBackend: async () => { refreshes++; records.push({ id: freshId, app: { display_name: 'Battlefield 3', strShortcutExe: exe } }); },
  readShortcutOverviewField: (app, ...keys) => keys.map(key => app?.[key]).find(Boolean) || '',
  shortcutExecutableIdentity: value => String(value || '').toLowerCase(),
  getOptimalLauncherSkipArg: () => null, backendLog() {}, rememberOriginalShortcutTitle() {}, getShortcutEdition: () => null,
 }, { window: { SteamClient: { Apps: { SetShortcutName: async () => {} } } },
  setTimeout: callback => { queueMicrotask(callback); return 1; }, clearTimeout() {} });
 const tx = { initialShortcutAppId: originalId, resolvedShortcutAppId: originalId, targetSteamAppId: '1238820', isCurrent: () => true };
 const result = await LinkOrchestrator.mutateShortcutIdentity(tx, { title: 'bf3', shortcutExecutable: exe }, { name: 'Battlefield 3' }, 'Battlefield 3');
 assert.equal(result.resolvedShortcutId, freshId, 'A backend-only startup registry can confirm the post-rename ID without getting stuck on its old snapshot');
 assert.equal(refreshes, 1, 'Only an unobserved live rename needs the bounded VDF fallback refresh');
}
for (const entry of ['synchronizeShortcutOfficialIdentity', 'linkShortcutToSteam']) {
 const { state, options, selectedExe, selectedStartDir, renamedId, linking } = identityHarness();
 const result = await linking[entry](options);
 assert.equal(result[entry === 'linkShortcutToSteam' ? 'ok' : 'complete'], true, `${entry} still completes linking: ${result.error || ''}`);
 assert.equal(result.shortcutAppId, renamedId, `${entry} resolves Steam's regenerated shortcut ID`);
 assert.equal(state.renames, 1, `${entry} still applies the official display name`);
 assert.deepEqual(state.writes, [], `${entry} must never replace the selected executable or start directory`);
 assert.equal(state.mapping.set[`shortcut:${renamedId}`], options.steamAppId, `${entry} commits the regenerated identity`);
 assert.deepEqual(state.neutralized.map(({ exe_path, start_dir }) => ({ exe_path, start_dir })), [{ exe_path: selectedExe, start_dir: selectedStartDir }],
  `${entry} filesystem maintenance uses the preserved selected executable`);
 assert.ok(state.neutralized[0].expires_at_ms > Date.now() && state.neutralized[0].expires_at_ms <= Date.now() + 4000,
  `${entry} bounds the backend filesystem operation with a future deadline`);
}
for (const entry of ['synchronizeShortcutOfficialIdentity', 'linkShortcutToSteam']) {
 let acknowledge;
 const neutralizeAck = new Promise(resolve => { acknowledge = resolve; });
 const { state, options, selectedExe, selectedStartDir, linking, overview } = identityHarness({ overviewOnly: true, neutralizeAck });
 let finished = false;
 const work = linking[entry](options).then(result => { finished = true; return result; });
 const deadline = Date.now() + 1000;
 while (!state.neutralized.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 0));
 assert.equal(state.neutralized.length, 1, `${entry} reaches protection when its overview lacks all launch fields`);
 assert.equal(state.neutralized[0].exe_path, selectedExe, `${entry} reads the executable from the matching native details`);
 assert.equal(state.neutralized[0].start_dir, selectedStartDir, `${entry} reads the complete start directory from the matching native details`);
 assert.equal(Object.hasOwn(overview, 'strShortcutExe'), false, `${entry} leaves the native overview untouched`);
 assert.equal(finished, false, `${entry} awaits the protection acknowledgement before completing`);
 assert.equal(state.mapping, null, `${entry} cannot publish a mapping while protection is pending`);
 acknowledge(JSON.stringify({ ok: true, modified: true }));
 const result = await work;
 assert.equal(result[entry === 'linkShortcutToSteam' ? 'ok' : 'complete'], true, `${entry} completes after protection is confirmed`);
}
for (const entry of ['synchronizeShortcutOfficialIdentity', 'linkShortcutToSteam']) {
 const { state, options, linking } = identityHarness({ overviewOnly: true, neutralizeResult: { ok: false, error: 'steam_appid_backup_conflict' } });
 if (entry === 'linkShortcutToSteam') {
  const result = await linking[entry](options);
  assert.equal(result.ok, false, 'Protection failure cannot produce a successful link result');
  assert.equal(result.error, 'steam_appid_file_protection_failed', 'Protection failure remains a terminal link error');
 } else await assert.rejects(linking[entry](options), /steam_appid_file_protection_failed/);
 assert.equal(state.mapping, null, `${entry} never publishes a mapping after rejected protection`);
 assert.equal(state.restored.length, 0, `${entry} does not restore a backup that protection refused to touch`);
}
{
 const { state, options, linking, renamedId, selectedExe, selectedStartDir } = identityHarness();
 state.mappingAccepted = false;
 const result = await linking.linkShortcutToSteam(options);
 assert.equal(result.ok, false);
 assert.equal(result.error, 'mapping_identity_update_failed');
 assert.equal(result.shortcutAppId, renamedId, 'A post-rename error preserves the confirmed new identity for the durable retry');
 assert.equal(state.restored.length, 1, 'Mapping publication failure restores the protection backup before returning');
 assert.equal(state.restored[0].exe_path, selectedExe, 'Mapping rollback restores only the selected executable directory');
 assert.equal(state.restored[0].start_dir, selectedStartDir, 'Mapping rollback preserves the selected start directory');
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
  readShortcutLaunchDetails: () => null, readFreshShortcutLaunchDetails: async () => null,
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
 }, { window: {}, setTimeout: () => 1, clearTimeout() {} });
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
console.log('Link reliability passed: duplicate identity, cancellation races, verified queue completion and final IDs, running phases, interrupted-session recovery, bounded recoverable VDF RPC, owner-document identity, stalled rename safety and late recovery, terminal errors, incomplete icons, candidate warnings, invalid IDs, selected executable preservation, legacy payload isolation, original-executable detection, bounded image decoding.');
