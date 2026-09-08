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
 const state = { calls: [], mapped: null, epoch: 1, result: async () => ({ ok: false, error: 'network_timeout' }) };
 const storage = { getItem: key => shared.get(key), setItem: (key, value) => shared.set(key, value) };
 const api = load('frontend/features/shortcuts/link-job-queue.ts', {
  backendLog() {}, shortcutRuntimeHost: () => ({ getMainWindowDoc: () => ({ defaultView: { localStorage: storage } }) }),
  findMappingForShortcut: () => state.mapped, getFactoryResetEpoch: () => state.epoch,
  isFactoryEpochCurrent: epoch => epoch === state.epoch, isFactoryResetInProgress: () => false,
  linkShortcutToSteam: async options => { state.calls.push(options.shortcutAppId); return state.result(options); },
 }, { window: { dispatchEvent() {} }, CustomEvent: class {}, setTimeout: () => 1, clearTimeout() {} });
 return { api, state, shared };
}
const input = (id, extra = {}) => ({ shortcutAppId: id, title: 'Same Game', steamAppId: '100',
 skipLauncher: false, existingLaunchOptions: '', trackingExecutable: '', trackingStartDir: '',
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
for (const error of ['invalid_appid', 'Error: refusing_to_modify_native_steam_app', 'shortcut_identity_ambiguous']) {
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
console.log('Link reliability passed: duplicate identity, cancellation races, interrupted-session recovery, terminal errors, incomplete icons, candidate warnings, invalid IDs, bounded image decoding.');
