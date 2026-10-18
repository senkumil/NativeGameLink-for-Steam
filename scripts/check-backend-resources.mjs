import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fengari from 'fengari';
import { runLuaCheck } from './helpers/lua-runtime.mjs';

runLuaCheck({
  ttl: 'backend/lib/ttl_cache.lua', lru: 'backend/lib/lru_cache.lua',
  candidates: 'backend/lib/artwork_candidates.lua', farmer: 'backend/lib/steam_card_farmer.lua',
}, String.raw`
local checks = 0
local function check(value, message) checks = checks + 1; assert(value, message) end
local now = 10000
os.time = function() return now end
local ttl = factories.ttl({})
local cache = ttl.new(3)
ttl.set(cache, 'hot', {value=1})
for i=1,1000 do
  ttl.set(cache, 'changing', {value=i})
  ttl.remove(cache, 'changing')
  ttl.remove(cache, 'changing')
  check(cache.count == 1 and ttl.get(cache, 'hot').value == 1, 'repeated invalidation preserves the live count and hot rows')
end
ttl.set(cache, 'short', {ttl=2})
now = now + 3
ttl.set(cache, 'new', {})
check(cache.count == 2 and cache.entries.short == nil, 'expiry decrements count')
ttl.set(cache, 'third', {}); ttl.get(cache, 'hot'); ttl.set(cache, 'fourth', {})
check(cache.count == 3 and cache.entries.hot and not cache.entries.new, 'LRU evicts the oldest live row after invalidations')

local lru, requests, transient = factories.lru({}), {}, false
local candidate_deps = {lru_cache=lru, logger={}, http={get=function(url)
  local id = url:match('appids=(%d+)')
  requests[id] = (requests[id] or 0) + 1
  return {status=transient and 503 or 200, body='response:'..id}
end}, cjson={encode=function(value)return value end, decode=function(value)
  local id=value:match('^response:(%d+)$')
  if id then return {[id]={success=true,data={is_free=true}}} end
  return {steam_app_id=value}
end}}
local candidates = factories.candidates(candidate_deps)
for id=1000,1095 do candidates.fetch(tostring(id)) end
candidates.fetch('1000')
for id=1096,1190 do candidates.fetch(tostring(id));candidates.fetch('1000') end
check(requests['1000']==1, 'repeatedly used retired metadata remains hot')
candidates.fetch('1001')
check(requests['1001']==2, 'negative retired profiles obey the bounded LRU ceiling')
candidates.fetch('1190')
check(requests['1190']==1, 'recent negative profiles are reused')
now=now+1801;candidates.fetch('1190')
check(requests['1190']==2, 'retired metadata expires')
transient=true;candidates.fetch('1999');candidates.fetch('1999')
check(requests['1999']==2, 'transient provider errors remain retryable')

local source='version one'
local files, commands, opens, closes = {}, {}, 0, 0
local original_open,original_remove,original_tmpname=io.open,os.remove,os.tmpname
local session_sequence=0
os.tmpname=function()session_sequence=session_sequence+1;return 'temporary_'..session_sequence end
os.remove=function(name)files[name]=nil;return true end
io.open=function(name,mode)
  opens=opens+1
  return {read=function()return source end,write=function(_,value)files[name]=value;return true end,
   close=function()closes=closes+1;return true end}
end
local fail_start, fail_stop = false, false
local farmer=factories.farmer({logger={},config={backend_dir=function()return 'D:/Steam/backend' end},
 fs={join=function(...)return table.concat({...},'/')end,exists=function(name)
  return files[name] or name:match('%.cs$')~=nil or name:match('csc%.exe$')~=nil
 end},cjson={encode=function(value)return value end,decode=function()error('not json')end},
 process={run_silent=function(command,timeout)
  commands[#commands+1]={command=command,timeout=timeout}
  local target=command:match('/out:"([^"]+)"')
  if target then files[target]=true;return true,0 end
  if command:find(' stop 0 ',1,true) then
    local control=command:match('"([^"]+)"$')
    check(files[control]=='stop','stop persists cancellation before launching a signal helper')
    if fail_stop then return false,'process_timeout' end
  end
  if command:match(' run %d+ "') and fail_start then return false,'process_launch_failed' end
  return true,0
 end}})
check(farmer.stop_card_farming().ok and #commands==0 and opens==0, 'idle cleanup does not compile or launch helpers')
for _,id in ipairs({'0','2147483648','550 & bad','bad550','550\nstop'}) do
  check(farmer.start_card_farming({steam_app_id=id}).error=='invalid_appid', 'invalid card farming IDs are rejected before launching')
end
check(#commands==0, 'invalid IDs do not compile helpers')
for index=1,200 do
  check(farmer.start_card_farming({steam_app_id='550',game_title='Fixture'}).ok, 'valid start')
  check(farmer.get_card_farming_status().active, 'started helper is active')
  check(farmer.stop_card_farming().ok, 'valid stop')
  check(not farmer.get_card_farming_status().active, 'stopped helper clears session')
end
check(opens==closes, 'helper source fingerprints close every file')
local compiled=0
for _,cmd in ipairs(commands) do if cmd.command:find('/out:',1,true) then compiled=compiled+1 end end
check(compiled==1, 'unchanged helper source compiles once across repeated sessions')
source='version two';farmer.start_card_farming('550')
local previous=#commands
fail_stop=true
check(not farmer.stop_card_farming().ok and farmer.get_card_farming_status().active, 'failed stop retains its owned active session')
check(not farmer.start_card_farming('570').ok and #commands==previous+2, 'failed stop prevents a second concurrent launch')
fail_stop=false;farmer.stop_card_farming();fail_start=true
check(not farmer.start_card_farming('550').ok and not farmer.get_card_farming_status().active, 'failed launch never advertises an active session')
io.open=original_open
os.remove=original_remove;os.tmpname=original_tmpname
print('Backend cache/helper ownership passed: '..checks..' checks; bounded metadata, 1,000 invalidations and 200 helper lifecycles.')
`);

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
function runProcessFallback(command, timeout, result = { code: 0 }) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const executions = [];
  lua.lua_pushcfunction(state, inner => {
    executions.push(to_jsstring(lua.lua_tostring(inner, 1)));
    if (result.throw) { lua.lua_pushstring(inner, to_luastring('failed spawn')); return lua.lua_error(inner); }
    if (result.legacy) { lua.lua_pushinteger(inner, result.code); return 1; }
    lua.lua_pushboolean(inner, result.code === 0);
    lua.lua_pushstring(inner, to_luastring('exit'));
    lua.lua_pushinteger(inner, result.code);
    return 3;
  });
  lua.lua_setglobal(state, to_luastring('host_execute'));
  lua.lua_pushstring(state, to_luastring(command));
  lua.lua_setglobal(state, to_luastring('test_command'));
  const source = `package.preload.ffi=function()error('no FFI')end
    os.execute=host_execute
    local factory=(function()\n${fs.readFileSync('backend/lib/process.lua', 'utf8')}\nend)()
    local p=factory({})
    local ok,result=p.run_silent(test_command,${timeout ?? 'nil'})
    return ok,result`;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  const ok = lua.lua_toboolean(state, -2);
  const output = lua.lua_type(state, -1) === lua.LUA_TNUMBER ? lua.lua_tonumber(state, -1) : to_jsstring(lua.lua_tostring(state, -1));
  lua.lua_close(state);
  return { ok, output, executions };
}
assert.deepEqual(runProcessFallback('', 1), { ok: false, output: 'invalid_command', executions: [] });
assert.equal(runProcessFallback('"C:\\Fixture\\helper.exe" status', 50, { code: 1460 }).output, 'process_timeout');
assert.equal(runProcessFallback('helper.exe', 50, { code: 127 }).output, 'process_launch_failed');
assert.equal(runProcessFallback('helper.exe', 50, { throw: true }).output, 'process_launch_failed');
assert.equal(runProcessFallback('helper.exe', 50, { code: 42 }).output, 42);
assert.equal(runProcessFallback('helper.exe', 50, { legacy: true, code: 3 }).output, 3);
const background = runProcessFallback('"D:\\Juegos & más\\helper.exe" run 550');
assert.equal(background.ok, true);
const script = Buffer.from(background.executions[0].split(' ').at(-1), 'base64').toString('utf16le');
assert(!script.includes('WaitForExit'), 'FFI-free background launches return without waiting for the game session');
assert(script.includes('$info.UseShellExecute=$false;$info.CreateNoWindow=$true'));
assert(script.includes(Buffer.from('D:\\Juegos & más\\helper.exe').toString('base64')), 'Unicode executable paths survive encoded launch transport');

runLuaCheck({process:'backend/lib/process.lua'}, String.raw`
local waited, closed, terminated = {}, {}, 0
local wait_result, create_result = 0, 1
local kernel={CreateProcessA=function(_,_,_,_,_,_,_,_,_,pi)pi.hProcess='process';pi.hThread='thread';return create_result end,
 WaitForSingleObject=function(handle,timeout)waited[#waited+1]=timeout;return wait_result end,
 GetExitCodeProcess=function(_,ptr)ptr[0]=42;return 1 end,
 TerminateProcess=function()terminated=terminated+1;return 1 end,
 CloseHandle=function(handle)closed[#closed+1]=handle;return 1 end}
package.preload.ffi=function()return {cdef=function()end,load=function()return kernel end,
 new=function()return {}end,sizeof=function()return 1 end,copy=function()end}end
local process=factories.process({})
local ok,result=process.run_silent('helper.exe',100)
assert(ok and result==42 and #closed==2 and terminated==0,'completed processes close both native handles')
wait_result=258;ok,result=process.run_silent('helper.exe',100)
assert(not ok and result=='process_timeout' and #closed==4 and terminated==1,'timeouts terminate the owned child and close both handles')
assert(waited[#waited]==5000,'termination is awaited before releasing native handles')
create_result=0;ok,result=process.run_silent('helper.exe')
assert(not ok and #closed==4,'failed creation closes no unowned handles')
`);

runLuaCheck({}, `local main_source=${JSON.stringify(fs.readFileSync('backend/main.lua','utf8'))}\n` + String.raw`
local loaded,stops,ready,warnings=0,0,0,0
local fail_stop=false
local host_modules={logger={info=function()end,warn=function()warnings=warnings+1 end},
 millennium={ready=function()ready=ready+1 end},http={},
 json={encode=function(value)return value end,decode=function(value)return value end},
 fs={join=function(...)return table.concat({...},'/')end,exists=function()return true end}}
local original_require=require
require=function(name)return host_modules[name] or original_require(name)end
loadfile=function(name)
 loaded=loaded+1
 assert(name:find('steam_card_farmer.lua',1,true),'unload must never instantiate unrelated backend modules')
 return function()return function()return {get_card_farming_status=function()return 'status'end,
  stop_card_farming=function()stops=stops+1;return {ok=not fail_stop,error=fail_stop and 'stop_failed' or nil}end}end end
end
MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE='D:/Steam/backend'
local plugin=assert(load(main_source))()
plugin.on_load();plugin.on_unload()
assert(ready==1 and loaded==0 and stops==0,'unload preserves constant-time lazy startup when the farmer was unused')
get_steam_card_farming_status();plugin.on_unload()
assert(loaded==1 and stops==1,'unload stops only the farmer already owned by this backend')
fail_stop=true;plugin.on_unload()
assert(warnings==1,'failed helper cleanup is reported instead of silently marked stopped')
`);

if (process.platform === 'win32') {
  const compiler = ['Framework64', 'Framework'].map(dir =>
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', dir, 'v4.0.30319', 'csc.exe')
  ).find(file => fs.existsSync(file));
  assert(compiler, 'C# resource checks require the Windows .NET compiler');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ngl-backend-resource-check-'));
  try {
    const fixture = path.join(temporary, 'Process Fixture.cs');
    const executable = path.join(temporary, 'Process Fixture.exe');
    const output = path.join(temporary, 'argument output.txt');
    fs.writeFileSync(fixture, `using System; using System.IO; using System.Threading;
      class Fixture { static void Main(string[] args) {
        if(args[0]=="write") File.WriteAllText(args[1],args[2]);
        else if(args[0]=="sleep") Thread.Sleep(3000);
        else Environment.Exit(Int32.Parse(args[0]));
      } }`);
    const compile = spawnSync(compiler, ['/nologo', `/out:${executable}`, fixture], { encoding: 'utf8', windowsHide: true });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const literal = "Juego á ' & ^ ! $(NoExecute)";
    for (const [command, timeout, expected] of [
      [`"${executable}" write "${output}" "${literal}"`, 3000, 0],
      [`"${executable}" write "${output}" "${literal}"`, undefined, 0],
      [`"${executable}" 42`, 3000, 42],
      [`"${executable}" sleep`, 20, 1460],
    ]) {
      const captured = runProcessFallback(command, timeout).executions[0];
      const payload = captured.split(' ').at(-1);
      const actual = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', payload],
        { windowsHide: true, encoding: 'utf8', timeout: 15000 });
      assert.equal(actual.status, expected, actual.error?.message || actual.stderr);
    }
    assert.equal(fs.readFileSync(output, 'utf8'), literal, 'fallback preserves literal Unicode and metacharacters in arguments');

    const harness = path.join(temporary, 'Farmer Cleanup.cs');
    const cleanup = path.join(temporary, 'Farmer Cleanup.exe');
    fs.writeFileSync(harness, `using System; using System.Reflection; using System.Collections.Generic;
      class Cleanup {
        static List<string> calls=new List<string>(); static bool fail;
        static void User(IntPtr c,int p,int u){calls.Add("user");if(fail)throw new Exception();}
        static bool Pipe(IntPtr c,int p){calls.Add("pipe");return true;}
        static void Main(){
          var method=typeof(SteamCardFarmer.Program).GetMethod("ReleaseSteamSession",BindingFlags.Static|BindingFlags.NonPublic);
          var parameters=method.GetParameters();
          var user=Delegate.CreateDelegate(parameters[3].ParameterType,typeof(Cleanup).GetMethod("User",BindingFlags.Static|BindingFlags.NonPublic));
          var pipe=Delegate.CreateDelegate(parameters[4].ParameterType,typeof(Cleanup).GetMethod("Pipe",BindingFlags.Static|BindingFlags.NonPublic));
          foreach(bool error in new[]{false,true}){
            calls.Clear();fail=error;object[] args={new IntPtr(1),2,3,user,pipe};
            try{method.Invoke(null,args);}catch(TargetInvocationException){}
            if(!error)method.Invoke(null,args);
            if(String.Join(",",calls.ToArray())!="user,pipe"||(!error&&((int)args[1]!=0||(int)args[2]!=0)))throw new Exception("leaked native session");
          }
          string control=System.IO.Path.GetTempFileName();
          string eventName="NGL_Farmer_Race_Check_"+Guid.NewGuid().ToString("N");
          string previousAppId=Environment.GetEnvironmentVariable("SteamAppId");
          try{
            System.IO.File.WriteAllText(control,"run");
            SteamCardFarmer.Program.Main(new[]{"stop","0",eventName,control});
            if(System.IO.File.ReadAllText(control)!="stop")throw new Exception("stop did not persist cancellation");
            SteamCardFarmer.Program.Main(new[]{"run","550",eventName,control});
            if(Environment.GetEnvironmentVariable("SteamAppId")!=previousAppId)throw new Exception("canceled late start touched Steam");
            System.IO.File.Delete(control);
            SteamCardFarmer.Program.Main(new[]{"run","550",eventName,control});
            if(Environment.GetEnvironmentVariable("SteamAppId")!=previousAppId)throw new Exception("deleted cancellation allowed late start");
          }finally{System.IO.File.Delete(control);}
        }
      }`);
    const build = spawnSync(compiler, ['/nologo', '/main:Cleanup', `/out:${cleanup}`, path.resolve('backend/src/steam_card_farmer.cs'), harness],
      { encoding: 'utf8', windowsHide: true });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(spawnSync(cleanup, [], { encoding: 'utf8', windowsHide: true }).status, 0, 'farmer cleanup releases pipes when user release throws, and is idempotent');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
console.log('Backend process resources passed: native handle cleanup, FFI-free launch, actual Windows timeout/exit codes and literal arguments; no Steam account connection.');
