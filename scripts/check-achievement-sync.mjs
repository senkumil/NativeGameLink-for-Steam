import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { runLuaCheck } from './helpers/lua-runtime.mjs';

let checks = 0;
const errorContext = vm.createContext({ exports: {}, require: key => {
  assert.equal(key, '../../steam/localization'); return { gdlText: (_key, fallback) => fallback };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/achievement-sync-errors.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, errorContext);
const source = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/native-properties.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
async function fixture(status, syncResult = { ok: true }, items = [{ name: 'FIRST', earned: false }, { name: 'SECOND', earned: true }]) {
  const nodes = new Map(); let picker, statusReads = 0; const writes = [];
  const page = { isConnected: true, getAttribute: () => null, contains: () => true };
  const shell = { querySelector: () => ({}), querySelectorAll: () => [page] };
  const doc = { createElement: () => element(), querySelectorAll: () => [shell], defaultView: {
    location: { href: 'https://steamloopback.host/properties/550' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  } };
  function element() { return { style: {}, ownerDocument: doc, isConnected: true, listeners: new Map(),
    addEventListener(k, v) { this.listeners.set(k, v); }, querySelector(k) { if (!nodes.has(k)) nodes.set(k, element()); return nodes.get(k); },
  }; }
  const imports = {
    '../../api/backend': {
      fetchLocalAchievementsBackend: async () => JSON.stringify({ found: true, appid: '550', total: 2, unlocked: 1,
        achievements: items }),
      fetchSteamAccountAchievementsBackend: async () => { statusReads++; return JSON.stringify(status); },
      getSteamCardFarmingStatusBackend: async () => JSON.stringify({ active: false }),
      syncSteamAccountAchievementsBackend: async r => { writes.push(JSON.parse(r.request_json)); return JSON.stringify(syncResult); },
    },
    '../../core/text': { escapeHtml: String }, '../../steam/localization': { gdlText: (_k, t) => t },
    '../../steam/shortcuts': { SHORTCUT_THRESHOLD: 2147483648, findNativeSteamAppIdByName: () => '550' },
    './achievement-picker-modal': { openAchievementPickerModal: p => { picker = p; } },
    './achievement-sync-errors': errorContext.exports,
  };
  const context = vm.createContext({ exports: {}, require: key => { if (!imports[key]) throw Error(key); return imports[key]; },
    window: { clearInterval() {}, setInterval() { throw Error('Unexpected timer'); } }, document: doc, console, Date });
  vm.runInContext(source, context);
  context.exports.tryInjectNativePropertiesField(doc, 'Left 4 Dead 2', { ownerDocument: doc, querySelector: () => null, appendChild() {} });
  await nodes.get('.gdl-native-open-picker-btn').listeners.get('click')();
  return { picker, writes, get statusReads() { return statusReads; }, get statusText() { return nodes.get('.gdl-native-status').textContent; } };
}
for (const state of [{ ok: false }, { ok: true }, { ok: true, achievements: { FIRST: { achieved: true } } },
  { ok: true, appid: '550', achievements: { FIRST: { achieved: 'false' }, SECOND: { achieved: false } } },
  { ok: true, appid: '730', achievements: { FIRST: { achieved: true }, SECOND: { achieved: false } } },
  { ok: true, achievements: { FIRST: { achieved: true }, SECOND: { achieved: false } } },
  { ok: 'true', appid: '550', achievements: { FIRST: { achieved: true }, SECOND: { achieved: false } } }]) {
  const f = await fixture(state); assert.equal(f.picker, undefined); assert.equal(f.writes.length, 0); checks += 2;
}
const state = { ok: true, appid: '550', achievements: { FIRST: { achieved: true }, SECOND: { achieved: false } } };
const f = await fixture(state); assert.deepEqual(Array.from(f.picker.initialSelectedNames), ['FIRST']); checks++;
await f.picker.onSyncSteam(['FIRST']); assert.deepEqual(f.writes[0], { steam_app_id: '550', unlock: ['FIRST'], lock: ['SECOND'] }); checks++;
const failed = await fixture(state, { ok: false, error: 'store_stats_not_confirmed' });
await assert.rejects(failed.picker.onSyncSteam(['FIRST'])); checks++;
assert.match(failed.statusText, /Steam did not confirm/); checks++;
const unchanged = await fixture(state, { ok: true, noop: true, unlocked_count: 0, locked_count: 0 });
await unchanged.picker.onSyncSteam(['FIRST']);
assert.match(unchanged.statusText, /already matches/); checks++;
const protectedGame = await fixture({ ok: false }, undefined,
  Array.from({ length: 49 }, (_, index) => ({ name: 'PROTECTED_' + index, earned: false, client_writable: false })));
assert.equal(protectedGame.statusReads, 0, 'all-protected metadata never starts a fake game session to read stats'); checks++;
assert.equal(protectedGame.picker, undefined, 'a game with no editable achievements does not offer an impossible synchronization'); checks++;
assert.equal(protectedGame.writes.length, 0); checks++;
assert.match(protectedGame.statusText, /Steam protects these achievements/); checks++;
assert.doesNotMatch(protectedGame.statusText, /owned|running/); checks++;
const mixedProtection = await fixture(state, undefined,
  [{ name: 'FIRST', earned: false, client_writable: false }, { name: 'SECOND', earned: true }]);
assert.equal(mixedProtection.statusReads, 1); checks++;
assert.equal(mixedProtection.picker.items[0].client_writable, false); checks++;

runLuaCheck({ sync: 'backend/lib/steamworks_sync.lua' }, String.raw`
local checks, files, registry, sequence = 0, {}, {}, 0
local source = 'source-v1'
local status_ok, selected_app, sync_calls, compile_calls, status_calls = true, '550', 0, 0, 0
local status_achievements={FIRST={achieved=true},SECOND={achieved=false}}
local schema_permissions, all_schema_protected = {}, false
local cache_sets=0
local helper_paths, budgets, sync_commands = {}, {}, {}
local function encode(v) sequence=sequence+1;local key='json'..sequence;registry[key]=v;return key end
local function decode(key) assert(registry[key]);return registry[key] end
local function check(v, text) assert(v,text);checks=checks+1 end
os.getenv=function(k) if k=='TEMP' then return 'temp' end end
os.time=function()return 10000 end
os.remove=function(p)files[p]=nil end
io.open=function(p,mode)
 if p=='backend/src/steam_achievement_sync.cs' then return {read=function()return source end,close=function()end} end
 if files[p] then return {read=function()return files[p]end,close=function()end} end
 return nil
end
local deps={cjson={encode=encode,decode=decode},logger={warn=function()end},config={backend_dir=function()return 'backend'end},
 achievement_metadata={client_permissions=function()return schema_permissions,all_schema_protected end},
 ttl_cache={new=function()return {entries={}}end,get=function(c,k)return c.entries[k]end,
  set=function(c,k,v)c.entries[k]=v;cache_sets=cache_sets+1 end},
 fs={join=function(...)return table.concat({...},'/')end,exists=function(p)
   return p=='backend/src/steam_achievement_sync.cs' or p:match('/csc.exe$') or p=='temp/ngl_steam_achievement_sync.exe' or files[p]~=nil
 end},process={run_silent=function(cmd,budget)
  if cmd:find('/target:winexe',1,true) then local p=cmd:match('/out:"([^"]+)"');files[p]='MZ';compile_calls=compile_calls+1;helper_paths[#helper_paths+1]=p;return end
  local out=cmd:match('%-%-result%-file "([^"]+)"');assert(out,'mocked helper needs private result file')
  if cmd:find('status ',1,true) then
   status_calls=status_calls+1
   files[out]=encode({ok=status_ok,appid=selected_app,achievements=status_achievements})
  else
   sync_calls=sync_calls+1;budgets[#budgets+1]=budget;sync_commands[#sync_commands+1]=cmd
   files[out]=encode({ok=true,appid='550',stored=true,callback_confirmed=true})
  end
 end}}
local module=factories.sync(deps)
local function sync(req)return decode(module.sync_steam_account_achievements(encode(req)))end
local function read()return decode(module.fetch_steam_account_achievements({steam_app_id='550'}))end
selected_app='730';check(read().ok==false and cache_sets==0,'another AppID status is rejected before publication or caching')
selected_app=nil;check(read().ok==false and cache_sets==0,'missing AppID cannot seed the official status cache')
selected_app='550';status_ok='true';check(read().ok==false and cache_sets==0,'only boolean true confirms official status')
status_ok=true;status_achievements=nil;check(read().ok==false and cache_sets==0,'missing achievement map cannot be cached as successful status')
status_achievements={FIRST={achieved=true},SECOND={achieved=false}}
check(read().ok==true and cache_sets==1,'matching official status may populate the bounded account cache')
status_ok=false;local r=sync({steam_app_id='550',unlock={'FIRST'}});check(not r.ok and sync_calls==0,'failed fresh official status prevents writes')
status_ok=true;selected_app='999';r=sync({steam_app_id='550',unlock={'FIRST'}});check(not r.ok and sync_calls==0,'wrong official app prevents writes')
selected_app='550';r=sync({steam_app_id='550',unlock={'UNKNOWN'}});check(not r.ok and sync_calls==0,'unknown achievement prevents writes')
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'FIRST'}});check(not r.ok and sync_calls==0,'conflicting selection prevents writes')
r=sync({steam_app_id='550',unlock={'FIRST&bad'}});check(not r.ok and sync_calls==0,'shell metacharacters never reach helper')
for _, id in ipairs({'0','3000000001','550&bad'}) do r=sync({steam_app_id=id,unlock={'FIRST'}});check(not r.ok and sync_calls==0,'invalid/public scope checked') end
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'SECOND'}})
check(r.ok and r.noop==true and sync_calls==0,'an already matching selection never launches the write helper')
check(r.unlocked_count==0 and r.locked_count==0 and r.stored==false and r.callback_confirmed==false,'no-op reports no writes or claimed store confirmation')
local prior_status_calls=status_calls
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'SECOND'}})
check(r.ok and status_calls==prior_status_calls+1 and sync_calls==0,'repeated no-op still verifies fresh official state instead of the picker/cache snapshot')
status_achievements={FIRST={achieved=true},SECOND={achieved=false},THIRD={achieved=true},FOURTH={achieved=false}}
r=sync({steam_app_id='550',unlock={'FIRST','SECOND'},lock={'THIRD','FOURTH'}})
check(r.ok and sync_calls==1,'explicit changed selection allowed after fresh status')
check(sync_commands[1]:find('"+SECOND"',1,true) and sync_commands[1]:find('"-THIRD"',1,true),'only changed unlocks and locks are sent to the helper')
check(not sync_commands[1]:find('"+FIRST"',1,true) and not sync_commands[1]:find('"-FOURTH"',1,true),'matching earned and locked achievements are excluded from the command')
check(budgets[1]==15000,'sync timeout includes stats/store callbacks')
check(compile_calls==1 and helper_paths[1]:find('_v2_',1,true),'old fixed helper filename is never reused')
status_achievements.SECOND.achieved=true;status_achievements.THIRD.achieved=false
r=sync({steam_app_id='550',unlock={'FIRST','SECOND'},lock={'THIRD','FOURTH'}})
check(r.ok and r.noop and sync_calls==1,'after a saved selection a repeat cannot enqueue a duplicate batch')
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'FIRST'}})
check(not r.ok and sync_calls==1,'invalid conflicting selections are rejected even when a no-op could otherwise be found')
r=sync({steam_app_id='550'})
check(not r.ok and r.error=='empty_achievement_selection' and sync_calls==1,'an empty selection is not silently authorized as a no-op')
source='source-v2';sync({steam_app_id='550',lock={'FIRST'}})
check(compile_calls==2 and helper_paths[1]~=helper_paths[2],'source updates compile a different helper cache identity')
sync({steam_app_id='550',lock={'FIRST'}});check(compile_calls==2,'unchanged helper source is reused')
local before_status,before_sync=status_calls,sync_calls
schema_permissions={FIRST={client_writable=false},SECOND={client_writable=false}};all_schema_protected=true
r=read()
check(not r.ok and r.error=='achievement_protected' and #r.protected_names==2,'an all-protected local schema reports the actual restriction instead of opening an SDK account session')
check(status_calls==before_status and sync_calls==before_sync,'all-protected account reads never launch a status or write helper, even with a previously valid status cache')
status_achievements={FIRST={achieved=true},SECOND={achieved=false}}
r=sync({steam_app_id='550',unlock={'UNKNOWN'}})
check(not r.ok and r.error=='invalid_achievement_selection' and sync_calls==before_sync and status_calls==before_status,'unknown names cannot be hidden by an all-protected error or launch a status session')
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'SECOND'}})
check(not r.ok and r.error=='achievement_protected' and sync_calls==before_sync and status_calls==before_status,'all-protected direct requests are rejected without asserting a fresh-account no-op or opening an SDK session')
local all_names={};schema_permissions={}
for i=1,49 do local name=string.format('PROTECTED_%02d',i);all_names[#all_names+1]=name;schema_permissions[name]={client_writable=false} end
r=sync({steam_app_id='550',unlock=all_names})
check(not r.ok and r.error=='achievement_protected' and #r.protected_names==49 and sync_calls==before_sync and status_calls==before_status,'all 49 protected achievements are rejected before either status or write helpers, including direct old-client IPC')
r=sync({steam_app_id='550',unlock={'UNKNOWN'}})
check(not r.ok and r.error=='invalid_achievement_selection' and sync_calls==before_sync and status_calls==before_status,'the complete 49-achievement schema still validates exact achievement identities before reporting protection')
schema_permissions={FIRST={client_writable=false},SECOND={client_writable=false},THIRD={}};all_schema_protected=false
r=sync({steam_app_id='550',unlock={'FIRST'},lock={'SECOND'}})
check(r.ok and r.noop and sync_calls==before_sync,'unchanged protected rows in a mixed-permission game do not reject a valid fresh-account no-op selection')
r=sync({steam_app_id='550',unlock={'SECOND'}})
check(not r.ok and r.error=='achievement_protected' and r.protected_names[1]=='SECOND' and sync_calls==before_sync,'a protected unlock delta is rejected before the write helper')
r=sync({steam_app_id='550',lock={'FIRST'}})
check(not r.ok and r.error=='achievement_protected' and r.protected_names[1]=='FIRST' and sync_calls==before_sync,'a protected lock delta is rejected before the write helper')
schema_permissions={FIRST={client_writable=false},SECOND={},THIRD={client_writable=false},FOURTH={}};all_schema_protected=false
status_achievements={FIRST={achieved=true},SECOND={achieved=false},THIRD={achieved=true},FOURTH={achieved=false}}
r=sync({steam_app_id='550',unlock={'FIRST','SECOND'},lock={'THIRD','FOURTH'}})
check(not r.ok and r.error=='achievement_protected' and #r.protected_names==1 and r.protected_names[1]=='THIRD' and sync_calls==before_sync,'one protected delta blocks the whole batch, so writable changes cannot be partly committed')
r=sync({steam_app_id='550',unlock={'FIRST','SECOND'},lock={'FOURTH'}})
check(r.ok and sync_calls==before_sync+1,'writable deltas remain valid alongside unchanged protected rows')
check(sync_commands[#sync_commands]:find('"+SECOND"',1,true) and not sync_commands[#sync_commands]:find('"+FIRST"',1,true),'the permitted command excludes the protected row that already matches')
before_status=status_calls;r=read()
check(r.ok and status_calls==before_status+1,'unknown or mixed schema permissions do not falsely block a status read')
print('Achievement backend sync passed: '..checks..' checks; fresh official state, delta/no-op writes and source-versioned helper.')
`);
// Compile the production helper together with an isolated test entry point.
// The entry point calls only SyncAchievements with fake delegates; it never
// calls Program.Main, loads steamclient, or connects to an account.
if (process.platform === 'win32') {
  const compiler = ['Framework64', 'Framework'].map(dir =>
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe')
  ).find(file => fs.existsSync(file));
  assert.ok(compiler, 'The C# delta checks require the Windows .NET compiler');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ngl-sync-delta-check-'));
  const harnessFile = path.join(temp, 'AchievementSyncDeltaChecks.cs');
  const executable = path.join(temp, 'checks.exe');
  try {
    fs.writeFileSync(harnessFile, String.raw`
using System;
using System.Collections.Generic;
using System.Reflection;

class AchievementSyncDeltaChecks
{
    static readonly MethodInfo Sync = typeof(SteamAchievementSync.Program).GetMethod("SyncAchievements", BindingFlags.NonPublic | BindingFlags.Static);
    static readonly List<string> Releases = new List<string>();
    static bool FailReleaseUser;

    static void FakeReleaseUser(IntPtr client, int pipe, int user)
    {
        Releases.Add("user");
        if (FailReleaseUser) throw new InvalidOperationException("fake release failure");
    }
    static bool FakeReleasePipe(IntPtr client, int pipe) { Releases.Add("pipe"); return true; }

    static void RunSession(string scenario, int pipe, int user, bool throwUser, bool repeat)
    {
        Releases.Clear(); FailReleaseUser = throwUser;
        MethodInfo release = typeof(SteamAchievementSync.Program).GetMethod("ReleaseSteamSession", BindingFlags.NonPublic | BindingFlags.Static);
        var parameters = release.GetParameters();
        Delegate releaseUser = Delegate.CreateDelegate(parameters[3].ParameterType, typeof(AchievementSyncDeltaChecks).GetMethod("FakeReleaseUser", BindingFlags.NonPublic | BindingFlags.Static));
        Delegate releasePipe = Delegate.CreateDelegate(parameters[4].ParameterType, typeof(AchievementSyncDeltaChecks).GetMethod("FakeReleasePipe", BindingFlags.NonPublic | BindingFlags.Static));
        object[] args = { new IntPtr(1), pipe, user, releaseUser, releasePipe };
        bool threw = false;
        try { release.Invoke(null, args); if (repeat) release.Invoke(null, args); }
        catch (TargetInvocationException) { threw = true; }
        Console.WriteLine("{\"scenario\":\"" + scenario + "\",\"releases\":\"" + String.Join(",", Releases.ToArray()) + "\",\"pipe\":" + args[1] + ",\"user\":" + args[2] + ",\"threw\":" + (threw ? "true" : "false") + "}");
    }

    static void Run(string scenario, string[] unlock, string[] locked, string missing, string failing, bool storeResult, bool callbackResult)
    {
        var states = new Dictionary<string, bool> { {"FIRST", true}, {"SECOND", false}, {"THIRD", true}, {"FOURTH", false} };
        var sets = new List<string>();
        var clears = new List<string>();
        int reads = 0, stores = 0, callbacks = 0;
        Func<string, bool?> read = delegate(string name) { reads++; return name == missing || !states.ContainsKey(name) ? (bool?)null : states[name]; };
        Func<string, bool> set = delegate(string name) { sets.Add(name); if (name == failing) return false; states[name] = true; return true; };
        Func<string, bool> clear = delegate(string name) { clears.Add(name); if (name == failing) return false; states[name] = false; return true; };
        Func<bool> store = delegate() { stores++; return storeResult; };
        Func<bool> callback = delegate() { callbacks++; return callbackResult; };
        string result = (string)Sync.Invoke(null, new object[] { (ulong)550, new List<string>(unlock), new List<string>(locked), read, set, clear, store, callback });
        Console.WriteLine("{\"scenario\":\"" + scenario + "\",\"result\":" + result + ",\"reads\":" + reads + ",\"sets\":\"" + String.Join(",", sets.ToArray()) + "\",\"clears\":\"" + String.Join(",", clears.ToArray()) + "\",\"stores\":" + stores + ",\"callbacks\":" + callbacks + "}");
    }

    public static void Main()
    {
        Run("noop", new[] { "FIRST" }, new[] { "SECOND" }, null, null, true, true);
        Run("mixed", new[] { "FIRST", "SECOND" }, new[] { "THIRD", "FOURTH" }, null, null, true, true);
        Run("changed-before-helper", new[] { "FIRST", "THIRD" }, new[] { "SECOND", "FOURTH" }, null, null, true, true);
        Run("failed-read", new[] { "SECOND", "FOURTH" }, new string[0], "FOURTH", null, true, true);
        Run("conflicting", new[] { "SECOND" }, new[] { "SECOND" }, null, null, true, true);
        Run("duplicate", new[] { "SECOND", "SECOND" }, new string[0], null, null, true, true);
        Run("empty", new string[0], new string[0], null, null, true, true);
        Run("failed-set", new[] { "SECOND" }, new string[0], null, "SECOND", true, true);
        Run("partial-failure", new[] { "SECOND", "FOURTH" }, new string[0], null, "FOURTH", true, true);
        Run("failed-store", new[] { "SECOND" }, new string[0], null, null, false, true);
        Run("failed-callback", new[] { "SECOND" }, new string[0], null, null, true, false);
        Run("lock-only", new string[0], new[] { "FIRST", "SECOND" }, null, null, true, true);
        RunSession("session-empty", 0, 0, false, true);
        RunSession("session-pipe-only", 7, 0, false, true);
        RunSession("session-user-pipe", 7, 8, false, true);
        RunSession("session-release-failure", 7, 8, true, false);
    }
}
`, 'utf8');
    const compile = spawnSync(compiler, ['/nologo', '/target:exe', '/main:AchievementSyncDeltaChecks', `/out:${executable}`,
      path.resolve('backend/src/steam_achievement_sync.cs'), harnessFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, `Production helper compilation failed: ${compile.stdout}${compile.stderr}`);
    const run = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, `Fake delegate checks failed: ${run.stdout}${run.stderr}`);
    const scenarios = new Map(run.stdout.trim().split(/\r?\n/).map(line => { const row = JSON.parse(line); return [row.scenario, row]; }));
    assert.equal(scenarios.size, 16);
    let helperChecks = 3;
    for (const name of ['noop', 'changed-before-helper']) {
      const row = scenarios.get(name);
      assert.equal(row.result.ok, true); assert.equal(row.result.noop, true);
      assert.equal(row.result.stored, false); assert.equal(row.result.callback_confirmed, false);
      assert.equal(row.sets, ''); assert.equal(row.clears, ''); assert.equal(row.stores, 0); assert.equal(row.callbacks, 0);
      helperChecks += 8;
    }
    const mixed = scenarios.get('mixed');
    assert.equal(mixed.result.ok, true); assert.equal(mixed.reads, 4);
    assert.equal(mixed.sets, 'SECOND'); assert.equal(mixed.clears, 'THIRD');
    assert.equal(mixed.stores, 1); assert.equal(mixed.callbacks, 1);
    assert.equal(mixed.result.unlocked_count, 1); assert.equal(mixed.result.locked_count, 1); helperChecks += 8;
    for (const name of ['failed-read', 'conflicting', 'duplicate', 'empty']) {
      const row = scenarios.get(name);
      assert.equal(row.result.ok, false); assert.equal(row.sets, ''); assert.equal(row.clears, '');
      assert.equal(row.stores, 0); assert.equal(row.callbacks, 0); helperChecks += 5;
    }
    const failedSet = scenarios.get('failed-set');
    assert.equal(failedSet.result.ok, false); assert.equal(failedSet.result.error, 'achievement_update_failed');
    assert.equal(failedSet.stores, 0); assert.equal(failedSet.callbacks, 0); helperChecks += 4;
    const partial = scenarios.get('partial-failure');
    assert.equal(partial.result.ok, false); assert.equal(partial.result.error, 'achievement_update_failed');
    assert.equal(partial.result.unlocked_count, 1); assert.equal(partial.stores, 1); assert.equal(partial.callbacks, 1); helperChecks += 5;
    for (const name of ['failed-store', 'failed-callback']) {
      const row = scenarios.get(name);
      assert.equal(row.result.ok, false); assert.equal(row.result.error, 'store_stats_not_confirmed');
      assert.equal(row.stores, 1); assert.equal(row.callbacks, name === 'failed-store' ? 0 : 1); helperChecks += 4;
    }
    const lockOnly = scenarios.get('lock-only');
    assert.equal(lockOnly.result.ok, true); assert.equal(lockOnly.sets, ''); assert.equal(lockOnly.clears, 'FIRST');
    assert.equal(lockOnly.result.locked_count, 1); assert.equal(lockOnly.stores, 1); helperChecks += 5;
    for (const [name, expected] of [['session-empty', ''], ['session-pipe-only', 'pipe'], ['session-user-pipe', 'user,pipe']]) {
      const row = scenarios.get(name);
      assert.equal(row.releases, expected); assert.equal(row.pipe, 0); assert.equal(row.user, 0);
      assert.equal(row.threw, false); helperChecks += 4;
    }
    const releaseFailure = scenarios.get('session-release-failure');
    assert.equal(releaseFailure.releases, 'user,pipe'); assert.equal(releaseFailure.threw, true); helperChecks += 2;
    console.log(`Achievement C# helper passed: ${helperChecks} checks; fake delegates only, delta writes, no-op, races, confirmation failures and session cleanup.`);
  } finally {
    for (const file of [harnessFile, executable]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(temp);
  }
} else {
  console.log('Achievement C# executable checks require Windows; Lua delta coverage completed.');
}
console.log(`Achievement native account picker passed: ${checks} checks; failed/partial reads abort, official selection and failed sync remains open.`);
