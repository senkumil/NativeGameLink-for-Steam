import { runLuaCheck } from './helpers/lua-runtime.mjs';

// Execute the production Lua with an in-memory filesystem. No user's game,
// Steam configuration or steam_appid.txt is read or changed by this check.
runLuaCheck({ util: 'backend/lib/util.lua' }, String.raw`
local checks, clock = 0, 10000
local files, json, renames, opens, removes, joins, probes = {}, {}, {}, 0, 0, 0, {}
local deny, throw_rename, rename_hook, open_hook
local function check(value, message) checks = checks + 1; assert(value, message) end
local function windows(path) return path:sub(2, 2) == ':' or path:sub(1, 2) == '\\\\' or path:sub(1, 2) == '//' end
local function key(path) return windows(path) and path:gsub('/', '\\'):lower() or path end
local function join(directory, name)
 local separator = windows(directory) and '\\' or '/'
 return directory:gsub(windows(directory) and '[\\/]+$' or '/+$', '')..separator..name
end
local function put(path, bytes) files[key(path)] = bytes end
local function get(path) return files[key(path)] end
local function encode(value)
 local token = 'json'..tostring(#json + 1); json[#json + 1] = value; json[token] = value; return token
end
local function decode(token) assert(json[token], 'invalid fixture JSON'); return json[token] end
os.time = function() return clock end
io.open = function(path, mode)
 check(mode == 'r', 'protection only probes readable fixture files')
 opens = opens + 1
 probes[#probes + 1] = path
 if open_hook then local hook = open_hook; open_hook = nil; hook(path) end
 if get(path) == nil then return nil end
 return { close = function() end }
end
os.remove = function() removes = removes + 1; error('protection must never delete the original backup') end
os.rename = function(from, to)
 renames[#renames + 1] = { from, to }
 if throw_rename then error('fixture rename exception') end
 if deny then return nil, 'permission denied' end
 if get(from) == nil then return nil, 'missing source' end
 if get(to) ~= nil then return nil, 'destination exists' end
 put(to, get(from)); files[key(from)] = nil
 if rename_hook then local hook = rename_hook; rename_hook = nil; hook(from, to) end
 return true
end
local util = factories.util({ cjson = {encode=encode, decode=decode}, fs = {
 parent_path = function(path) return path:match(windows(path) and '^(.*)\\[^\\]*$' or '^(.*)/[^/]*$') or '' end,
 join = function(directory, name) joins = joins + 1; return join(directory, name) end,
 list = function() error('must never scan Steam userdata or unrelated game directories') end },
 millennium = { steam_path = function() error('must never scan Steam users') end } })
local function call(restore, request)
 return decode((restore and util.restore_steam_appid_file or util.neutralize_steam_appid_file)(encode(request or {})))
end
local function reset()
 files, renames, opens, removes, joins, probes = {}, {}, 0, 0, 0, {}
 deny, throw_rename, rename_hook, open_hook = nil, nil, nil, nil
end
local function appid(directory) return join(directory, 'steam_appid.txt') end
local function backup(directory) return appid(directory)..'.gdl_bak' end

for _, restore in ipairs({false, true}) do
 reset(); put(appid('Q:\\Unrelated'), 'unrelated')
 local result = call(restore)
 check(result.ok and result.skipped == 'missing_target', 'empty requests are explicitly skipped')
 check(opens == 0 and #renames == 0, 'empty requests do not probe or change any directory')
 check(get(appid('Q:\\Unrelated')) == 'unrelated', 'empty requests preserve unrelated game data')
end

for _, directory in ipairs({'R:\\Games\\Arbitrary Title', 'V:\\Bibliothèque\\Juego ñ 日本語', '\\\\host\\share\\Test Game'}) do
 reset(); local original = appid(directory); local saved = backup(directory)
 put(original, '123\r\nfixture bytes\0')
 local result = call(false, {exe_path='  "'..directory:gsub('\\', '/')..'/game.exe"  ', start_dir=" '"..directory.."\\' "})
 check(result.ok and result.modified, 'quoted local, unicode and UNC targets are neutralized')
 check(get(original) == nil and get(saved) == '123\r\nfixture bytes\0', 'neutralization preserves exact original bytes')
 check(#renames == 1, 'duplicate executable and start-directory targets are renamed once')
 result = call(false, {exe_path=directory..'\\game.exe', start_dir=directory})
 check(result.ok and not result.modified and #renames == 1, 'repeated neutralization is an idempotent no-op')
 result = call(true, {exe_path='"'..directory..'\\game.exe"', start_dir=directory..'\\'})
 check(result.ok and result.restored, 'matching target restores its backup')
 check(get(original) == '123\r\nfixture bytes\0' and get(saved) == nil, 'restoration preserves exact bytes and consumes only the matching backup')
 result = call(true, {exe_path=directory..'\\game.exe'})
 check(result.ok and not result.restored, 'repeated restoration is an idempotent no-op')
 check(removes == 0, 'neither operation deletes a backup')
 check(joins > 0, 'protection constructs targets through the host filesystem join API')
end

reset()
local linux_dir = '/mnt/storage/Collection/Arbitrary Game ñ'
put(appid(linux_dir), 'linux original'); put(appid('/mnt/storage/collection/Arbitrary Game ñ'), 'case-distinct sibling')
local result = call(false, {exe_path=' "'..linux_dir..'/game" ', start_dir=linux_dir..'/'})
check(result.ok and result.modified and #renames == 1, 'Unix absolute paths remain native slash-separated targets')
check(get(backup(linux_dir)) == 'linux original' and get(appid(linux_dir)) == nil, 'Unix protection preserves the original bytes in its adjacent backup')
check(get(appid('/mnt/storage/collection/Arbitrary Game ñ')) == 'case-distinct sibling', 'Unix case-distinct sibling directories are not conflated or scanned')
check(not renames[1][1]:find('\\', 1, true), 'Unix target is never rewritten into a Windows path')
result = call(true, {exe_path=linux_dir..'/game', start_dir=linux_dir})
check(result.ok and result.restored and get(appid(linux_dir)) == 'linux original', 'Unix restoration uses the same native directory and bytes')

reset()
local upper_dir, lower_dir = '/mnt/games/Title', '/mnt/games/title'
put(appid(upper_dir), 'upper target'); put(appid(lower_dir), 'lower target')
result = call(false, {start_dir=upper_dir, exe_path=lower_dir..'/game'})
check(result.ok and result.modified and #renames == 2, 'explicitly targeted Unix paths remain case-sensitive during de-duplication')
check(get(backup(upper_dir)) == 'upper target' and get(backup(lower_dir)) == 'lower target', 'both explicitly selected Unix case variants retain their independent bytes')
result = call(true, {start_dir=upper_dir, exe_path=lower_dir..'/game'})
check(result.ok and result.restored and get(appid(upper_dir)) == 'upper target' and get(appid(lower_dir)) == 'lower target', 'restoration preserves both distinct Unix targets')

reset()
put(appid('Y:\\Games\\Title'), 'Windows target')
result = call(false, {start_dir='y:/games/title/', exe_path='Y:\\Games\\Title\\game.exe'})
local target_probes = 0
for _, path in ipairs(probes) do if key(path) == key(appid('Y:\\Games\\Title')) then target_probes = target_probes + 1 end end
check(result.ok and result.modified and #renames == 1 and target_probes == 1, 'Windows case variants are de-duplicated before probing the filesystem')

reset()
local directory = 'W:\\Library\\Fixture'
put(appid(directory), 'recreated current bytes'); put(backup(directory), 'first original backup')
for _, restore in ipairs({false, true}) do
 local result = call(restore, {exe_path=directory..'\\game.exe'})
 check(not result.ok and result.error == (restore and 'steam_appid_restore_conflict' or 'steam_appid_backup_conflict'), 'coexisting files produce an explicit direction-specific conflict')
 check(#result.errors == 1 and result.errors[1].path ~= nil, 'conflict identifies the affected file')
 check(get(appid(directory)) == 'recreated current bytes' and get(backup(directory)) == 'first original backup', 'conflict never overwrites either version')
 check(#renames == 0 and removes == 0, 'conflict performs no destructive filesystem operation')
end

for _, restore in ipairs({false, true}) do
 for _, thrown in ipairs({false, true}) do
  reset(); put(restore and backup(directory) or appid(directory), 'permission fixture')
  deny = not thrown; throw_rename = thrown
  local result = call(restore, {exe_path=directory..'\\game.exe'})
  check(not result.ok and result.error == 'steam_appid_rename_failed', 'permission failures and thrown renames never report success')
  check(result.errors[1].detail:find(thrown and 'exception' or 'permission', 1, true), 'rename failure retains the actionable host reason')
  check(not result[restore and 'restored' or 'modified'], 'failed rename is not counted as a change')
  check(get(restore and backup(directory) or appid(directory)) == 'permission fixture', 'rename failure preserves its source bytes')
 end
end

for _, restore in ipairs({false, true}) do
 reset(); put(restore and backup(directory) or appid(directory), 'expired fixture')
 local result = call(restore, {exe_path=directory..'\\game.exe', expires_at_ms=clock * 1000 - 1})
 check(not result.ok and result.error == 'steam_appid_deadline_exceeded', 'queued expired requests are rejected before mutation')
 check(#renames == 0 and get(restore and backup(directory) or appid(directory)) == 'expired fixture', 'expired calls preserve the target without issuing a rename')
 reset(); put(restore and backup(directory) or appid(directory), 'deadline margin')
 result = call(restore, {exe_path=directory..'\\game.exe', expires_at_ms=clock * 1000 + 999})
 check(not result.ok and #renames == 0, 'second-resolution clock reserves a full second before caller expiry')
end

reset(); put(appid(directory), 'first target'); put(appid(directory..'\\Bin'), 'second target')
rename_hook = function() clock = clock + 1 end
local result = call(false, {start_dir=directory, exe_path=directory..'\\Bin\\game.exe', expires_at_ms=clock * 1000 + 1800})
check(not result.ok and result.modified and result.error == 'steam_appid_deadline_exceeded', 'expiry between target directories reports the partial outcome honestly')
check(#renames == 1 and get(backup(directory)) == 'first target' and get(appid(directory..'\\Bin')) == 'second target', 'deadline is checked again before every rename')

reset(); put(appid('X:\\Owned'), 'owned'); put(appid('X:\\Unrelated'), 'unrelated')
result = call(false, {start_dir='X:\\Owned'})
check(result.ok and result.modified and get(appid('X:\\Unrelated')) == 'unrelated', 'a target-scoped start directory never expands into a global sweep')
check(removes == 0, 'all protection paths preserve backups without removals')
print('steam_appid.txt filesystem protection: '..checks..' checks passed')
`);
