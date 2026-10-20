import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const id = 3000000001, otherId = id + 1;
const executable = 'Z:\\Library\\ゲーム\\Bin\\Start.exe', directory = 'Z:\\Library\\ゲーム';
let checks = 0;
function check(value, message) { checks++; assert.ok(value, message); }
const compiled = file => ts.transpileModule(fs.readFileSync(`frontend/features/shortcuts/${file}.ts`, 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function harness() {
 const doc = { defaultView: {} };
 const state = { requests: [], logs: [], removed: 0, details: { strShortcutExe: executable, strShortcutStartDir: directory },
  records: [], reply: { ok: true, modified: true }, restore: { ok: true, restored: true } };
 const clean = value => String(value || '').trim().replace(/^"|"$/g, '');
 const mocks = {
  backendLog: value => state.logs.push(value), cleanShortcutPath: clean,
  shortcutExecutableIdentity: value => clean(value).replaceAll('/', '\\').toLowerCase(),
  shortcutPathDirectory: value => clean(value).slice(0, Math.max(clean(value).lastIndexOf('\\'), clean(value).lastIndexOf('/'))),
  readShortcutOverviewField: (app, ...keys) => keys.map(key => app?.[key]).find(value => typeof value === 'string' && value.trim()) || '',
  readShortcutLaunchDetails: (lookup, owner) => { assert.equal(owner, doc); return lookup === id ? state.details : null; },
  getAllShortcutRecords: owner => { assert.equal(owner, doc); return state.records; },
  getShortcutAppById: () => ({ appid: id, display_name: 'Synthetic game' }),
  neutralizeSteamAppIdFileBackend: async request => { state.requests.push({ operation: 'neutralize', ...JSON.parse(request.request_json) }); return typeof state.reply === 'function' ? state.reply() : state.reply; },
  restoreSteamAppIdFileBackend: async request => { state.requests.push({ operation: 'restore', ...JSON.parse(request.request_json) }); return typeof state.restore === 'function' ? state.restore() : state.restore; },
  normalizedShortcutAppId: value => Number(value) >= 2147483648 ? Number(value) : null,
  findMappingForShortcut: () => '12345', cancelPendingLinkJobs() {}, dismissShortcut() {}, undismissShortcut() {},
  removeShortcutMappingsChecked: async () => { state.removed++; return true; },
  clearShortcutManifest() {}, clearShortcutEdition() {}, supersedeArtworkApplications: async () => {},
  purgeShortcutStorage() {}, getOriginalShortcutTitle: () => '', forgetOriginalShortcutTitle() {}, forgetShortcutSteamAppId() {},
  clearArtworkExceptIconBackend: async () => {}, clearArtworkBackend: async () => {}, shortcutRuntimeHost: () => ({}),
  runShortcutMutations: (_keys, work) => work(), shortcutMutationKeys: value => value,
 };
 const context = vm.createContext({ exports: {}, require: () => mocks, setTimeout, clearTimeout, window: {} });
 vm.runInContext(`(function(exports,require){${compiled('steam-appid-file')}\n})`, context)(context.exports, context.require);
 const fileApi = context.exports;
 context.exports = {};
 context.require = specifier => specifier === './steam-appid-file' ? fileApi : mocks;
 vm.runInContext(`(function(exports,require){${compiled('unlinking')}\n})`, context)(context.exports, context.require);
 return { state, doc, fileApi, unlink: context.exports.unlinkShortcutFromSteam };
}
{
 const h = harness(), target = h.fileApi.shortcutAppIdFileTarget(id, h.doc);
 check(target.exe_path === executable && target.start_dir === directory, 'Details-only launch data supplies both protection paths despite a pathless overview');
 const before = Date.now();
 check(await h.fileApi.updateShortcutAppIdFile('neutralize', target), 'A confirmed successful backend result protects the selected launch definition');
 const request = h.state.requests[0];
 check(request.exe_path === executable && request.start_dir === directory, 'The selected Unicode executable and working directory reach the backend unchanged');
 check(request.expires_at_ms > before && request.expires_at_ms <= Date.now() + 3500, 'Filesystem requests expire before their frontend watchdog');
 check(h.fileApi.shortcutAppIdFileTarget(12345, h.doc).exe_path === '', 'Native Steam AppIDs cannot become file-mutation targets');
 check(h.fileApi.shortcutAppIdFileTarget(id, h.doc, 'Y:\\Other\\game.exe').exe_path === '', 'A changed launch executable cannot redirect protection away from the confirmed target');
 h.state.details = null;
 h.state.records = [{ id: otherId, app: { strShortcutExe: 'Y:\\Other\\game.exe' } }, { id, app: { strShortcutExe: executable, strShortcutStartDir: directory } }];
 check(h.fileApi.shortcutAppIdFileTarget(id, h.doc).exe_path === executable, 'Registry fallback is scoped to the exact shortcut ID');
 h.state.records = [];
 check(h.fileApi.shortcutAppIdFileTarget(id, h.doc, executable).start_dir === executable.slice(0, executable.lastIndexOf('\\')), 'A verified selected executable remains usable before details hydration');
 for (const reply of [undefined, {}, { ok: false, error: 'steam_appid_rename_failed' }, { ok: true, skipped: 'missing_target' }, '{invalid']) {
  h.state.reply = reply;
  check(!await h.fileApi.updateShortcutAppIdFile('neutralize', target), 'An unconfirmed, skipped or failed rename never counts as protection');
 }
 check(h.state.logs.some(value => value.includes('steam_appid_rename_failed')), 'Real filesystem errors remain visible in diagnostics');
}
{
 const h = harness();
 h.state.details = { strShortcutExe: 'launcher-service://apps/arbitrary-title' };
 const target = h.fileApi.shortcutAppIdFileTarget(id, h.doc);
 check(target.notApplicable && await h.fileApi.updateShortcutAppIdFile('neutralize', target), 'Protocol shortcuts without a local filesystem target remain supported');
 check(h.state.requests.length === 0, 'Protocol targets never trigger a filesystem mutation');
 h.state.details = { strShortcutExe: executable, strShortcutStartDir: '.' };
 check(h.fileApi.shortcutAppIdFileTarget(id, h.doc).start_dir === executable.slice(0, executable.lastIndexOf('\\')), 'A relative working directory cannot redirect filesystem changes into the plugin directory');
}
{
 const h = harness(); let acknowledge;
 h.state.reply = () => new Promise(resolve => { acknowledge = resolve; });
 let finished = false;
 const work = h.fileApi.updateShortcutAppIdFile('neutralize', h.fileApi.shortcutAppIdFileTarget(id, h.doc)).then(result => { finished = true; return result; });
 await Promise.resolve(); await Promise.resolve();
 check(!finished, 'Protection waits for the actual backend acknowledgement');
 acknowledge(JSON.stringify({ ok: true, modified: true }));
 check(await work, 'JSON backend acknowledgement completes the protection operation');
}
{
 const h = harness(); let restoreAck;
 h.state.restore = () => new Promise(resolve => { restoreAck = resolve; });
 let finished = false;
 const operation = h.unlink({ doc: h.doc, shortcutAppId: id, title: 'Synthetic game' }).then(result => { finished = true; return result; });
 for (let count = 0; !restoreAck && count < 10; count++) await Promise.resolve();
 check(h.state.removed === 1 && restoreAck && !finished, 'Unlink waits for file restoration after removing the logical mapping');
 check(h.state.requests[0].operation === 'restore' && h.state.requests[0].exe_path === executable && h.state.requests[0].start_dir === directory,
  'Unlink restores using the same owner-document details even when the overview has no launch fields');
 restoreAck({ ok: true, restored: true });
 check((await operation).ok, 'Unlink reports completion only after confirmed restoration');
 h.state.restore = { ok: false, error: 'steam_appid_restore_conflict' };
 const failed = await h.unlink({ doc: h.doc, shortcutAppId: id, title: 'Synthetic game' });
 check(!failed.ok && failed.error === 'steam_appid_file_restore_failed', 'A restore conflict cannot be reported as a fully successful unlink');
}
console.log(`Steam AppID file frontend runtime passed: ${checks} checks; exact owner paths, acknowledgement, honest failure and unlink restoration.`);
