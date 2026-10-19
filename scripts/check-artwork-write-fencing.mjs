import { runLuaCheck } from './helpers/lua-runtime.mjs';

// All files and HTTP callbacks below are fixtures: this check never opens the
// user's Steam grid, and can deterministically finish an old RPC after a retry.
runLuaCheck({ artwork: 'backend/lib/artwork.lua', icon: 'backend/lib/artwork_icon.lua' }, String.raw`
local checks, now, http_calls, opens, closes = 0, 100000, 0, 0, 0
local function check(value, message) checks=checks+1;assert(value,message) end
local files, directories = {}, {['steam/userdata/account/config/grid']=true}
local grid='steam/userdata/account/config/grid/'
local http_hook, close_hook, rename_hook, fail_commit, fail_backup, fail_write, fail_close, allow_legacy
local fs={join=function(...)return table.concat({...},'/')end,
 exists=function(path)return files[path]~=nil or directories[path]==true end,
 create_directories=function(path)directories[path]=true end,
 create_dir_all=function(path)directories[path]=true end}
local cjson={encode=function(value)return value end,decode=function(value)return value end}
local logger={info=function()end,warn=function()end}
local png=string.char(137)..'PNG'..string.char(13,10,26,10)..string.rep('o',200)
local newer=string.char(137)..'PNG'..string.char(13,10,26,10)..string.rep('n',200)
io.open=function(path,mode)
 check(mode=='wb','writes use fixture-only binary files')
 opens=opens+1
 return {write=function(_,body)if fail_write then return nil,'fixture_write_failed' end;files[path]=body;return true end,
 close=function()closes=closes+1;if close_hook then local hook=close_hook;close_hook=nil;hook()end
  if fail_close then return nil,'fixture_close_failed' end;return true end}
end
os.remove=function(path)files[path]=nil;return true end
os.rename=function(from,to)
 if fail_backup and to:match('%.bak$') then return nil,'fixture_backup_failed' end
 if fail_commit and from:match('%.tmp$') then return nil,'fixture_commit_failed' end
 if files[from]==nil then return nil,'missing_source' end
 if files[to]~=nil then return nil,'target_exists' end
 files[to]=files[from];files[from]=nil
 if rename_hook then local hook=rename_hook;rename_hook=nil;hook(from,to)end
 return true
end
local icon=factories.icon({fs=fs})
local artwork=factories.artwork({fs=fs,cjson=cjson,logger=logger,artwork_icon=icon,
 millennium={steam_path=function()return 'steam' end},now_ms=function()return now end,
 util={decode_json=function(_,value)return value end,get_active_account_id=function()return 'account' end,
  safe_language=function(value)return value or 'english' end},http={get=function()return {status=404}end},
 binary_http={get=function(_,options)
  http_calls=http_calls+1;check(options.timeout<=(allow_legacy and 20 or 10),'native HTTP timeout fits remaining request budget')
  if http_hook then local hook=http_hook;http_hook=nil;hook()end
  return {status=200,body=png}
 end}})
local function request(generation,slot)
 return {shortcut_app_id='3000000001',steam_app_id='550',image_type=slot or 1,
  extension='png',url='https://fixture.invalid/art.png',expires_at_ms=now+10000,resource_generation=generation}
end
local function clean_temps()
 for path in pairs(files)do check(not path:match('%.tmp$')and not path:match('%.bak$'),'transactions leave no temporary or backup files')end
 check(opens==closes,'every fixture file is closed')
end
local target=grid..'3000000001_hero.png'
files[target]='original'
local expired=request(1);expired.expires_at_ms=now
local before=http_calls
check(artwork.save_shortcut_artwork(expired).error=='resource_deadline_exceeded','already expired artwork does no work')
check(http_calls==before and files[target]=='original','expired RPC preserves existing artwork')
http_hook=function()now=now+11000 end
check(artwork.save_shortcut_artwork(request(2)).error=='resource_deadline_exceeded','download finishing after deadline cannot commit')
check(files[target]=='original','late HTTP never changes original artwork')
local outer=request(3)
http_hook=function()
 local value=request(4);value.url='';value.data_base64=icon.encode_base64(newer)
 check(artwork.save_shortcut_artwork(value).saved,'newer retry commits while old download is suspended')
end
check(artwork.save_shortcut_artwork(outer).error=='superseded','old download cannot replace newer retry')
check(files[target]==newer,'newer artwork wins')
before=http_calls
check(artwork.save_shortcut_artwork(request(3)).error=='superseded','an older RPC arriving late cannot reclaim a newer slot')
check(http_calls==before,'stale incoming RPC is rejected before download')
close_hook=function()now=now+11000 end
check(artwork.save_shortcut_artwork(request(5)).error=='resource_deadline_exceeded','deadline is rechecked after writing temporary file')
check(files[target]==newer,'expiry during disk write preserves previous resource')
rename_hook=function(_,to)if to:match('%.bak$')then now=now+11000 end end
check(artwork.save_shortcut_artwork(request(6)).error=='resource_deadline_exceeded','deadline is rechecked immediately before commit')
check(files[target]==newer,'expiry during backup restores previous resource')
rename_hook=function()rename_hook=function()now=now+11000 end end
local during_commit=request(7);during_commit.image_type=3
local wide_target=grid..'3000000001.png';files[wide_target]='original wide'
check(artwork.save_shortcut_artwork(during_commit).error=='resource_deadline_exceeded','expiry during native rename cannot remain committed')
check(files[wide_target]=='original wide','expiry during native rename rolls back original')
fail_commit=true
check(artwork.save_shortcut_artwork(request(7)).error=='commit_failed','failed commit is not reported as saved')
fail_commit=false
check(files[target]==newer,'failed commit rolls back original artwork')
fail_backup=true
check(artwork.save_shortcut_artwork(request(8)).error=='backup_failed','failed backup is not reported as saved')
fail_backup=false
check(files[target]==newer,'failed backup preserves original artwork')
fail_write=true
check(artwork.save_shortcut_artwork(request(9)).error=='fixture_write_failed','failed temporary write is not reported as saved')
fail_write=false
fail_close=true
check(artwork.save_shortcut_artwork(request(10)).error=='fixture_close_failed','failed close is not reported as saved')
fail_close=false
clean_temps()

local icon_target=grid..'3000000001_icon.png'
files[icon_target]='original icon'
http_hook=function()now=now+11000 end
check(artwork.save_shortcut_icon(request(11)).error=='resource_deadline_exceeded','late icon URL download cannot commit')
check(files[icon_target]=='original icon','late icon download preserves original')
outer=request(12)
http_hook=function()
 local value=request(13);value.url='';value.icon_base64=icon.encode_base64(newer)
 check(artwork.save_shortcut_icon(value).saved,'newer icon retry commits during old download')
end
check(artwork.save_shortcut_icon(outer).error=='superseded','old icon cannot replace retry')
check(files[icon_target]==newer,'newer icon wins')
close_hook=function()now=now+11000 end
local result=artwork.save_shortcut_icon(request(14))
check(not result.saved,'icon expiry during temporary file write is not saved')
check(files[icon_target]==newer,'icon expiry during temporary write preserves original')
rename_hook=function(_,to)if to:match('%.bak$')then now=now+11000 end end
result=artwork.save_shortcut_icon(request(15))
check(not result.saved,'icon expiry during backup is not saved')
check(files[icon_target]==newer,'icon expiry during backup restores original')
fail_commit=true
result=artwork.save_shortcut_icon(request(16))
fail_commit=false
check(not result.saved and files[icon_target]==newer,'icon failed rename restores original and cannot report success')
clean_temps()

local logo_target=grid..'3000000001.json'
files[logo_target]='original position'
local position=request(17);position.logo_position={nWidthPct=50}
close_hook=function()now=now+11000 end
check(artwork.save_custom_logo_position(position).error=='resource_deadline_exceeded','logo position checks deadline after disk write')
check(files[logo_target]=='original position','expired position preserves existing customization')
position=request(18);position.logo_position={nWidthPct=55}
check(artwork.save_custom_logo_position(position).ok,'current logo position commits')
check(files[logo_target].logoPosition.nWidthPct==55,'logo position payload is preserved')
local stale=request(17);stale.logo_position={nWidthPct=99}
check(artwork.save_custom_logo_position(stale).error=='superseded','delayed older logo RPC cannot replace newer position')
clean_temps()

outer=request(19)
http_hook=function()artwork.clear_artwork('3000000001')end
check(artwork.save_shortcut_artwork(outer).error=='superseded','unlink cancels in-flight artwork')
check(files[target]==nil,'unlink is not undone by late artwork')
check(artwork.save_shortcut_artwork(request(19)).error=='superseded','same old generation arriving after unlink remains cancelled')
check(artwork.save_shortcut_artwork(request(20)).saved,'a newer explicit retry can write after unlink')
outer=request(21)
http_hook=function()
 local clear=request(22);clear.slots={1}
 check(artwork.clear_artwork_slots(clear).ok,'slot clear accepts bounded generation')
end
check(artwork.save_shortcut_artwork(outer).error=='superseded','bounded slot clear fences in-flight request')
check(files[target]==nil,'slot clear is not undone by late request')
before=http_calls
check(artwork.save_shortcut_artwork(request(21)).error=='superseded','late RPC cannot reclaim cleared high-water generation')
check(http_calls==before,'cleared stale RPC does not download')
local old_clear=request(20);old_clear.slots={1}
check(artwork.clear_artwork_slots(old_clear).error=='superseded','old clear cannot remove a newer slot')
local current=request(23)
check(artwork.save_shortcut_artwork(current).saved,'current generation succeeds after cancellation')
local expired_clear=request(24);expired_clear.expires_at_ms=now;expired_clear.slots={1}
check(artwork.clear_artwork_slots(expired_clear).error=='resource_deadline_exceeded','expired clear cannot remove current artwork')
check(files[target]==png,'expired clear preserves current artwork')
local clear_logo=request(25);clear_logo.slots={2}
check(artwork.clear_artwork_slots(clear_logo).ok,'logo clear also cancels its position')
local old_position=request(24);old_position.logo_position={nWidthPct=99}
check(artwork.save_custom_logo_position(old_position).error=='superseded','old logo-position RPC cannot recreate cleared customization')
clean_temps()

for _,field in ipairs({'expires_at_ms','resource_generation'})do
 local invalid=request(30);invalid[field]=nil
 check(artwork.save_shortcut_artwork(invalid).error=='invalid_resource_deadline','partial fence payload is rejected')
end
for _,value in ipairs({-1,1.5,'bad',math.huge})do
 local invalid=request(30);invalid.resource_generation=value
 check(artwork.save_shortcut_artwork(invalid).error=='invalid_resource_deadline','invalid generation is rejected')
end
local separate=request(1,0)
check(artwork.save_shortcut_artwork(separate).saved,'independent artwork slots retain independent generations')
separate=request(1);separate.shortcut_app_id='3000000002'
check(artwork.save_shortcut_artwork(separate).saved,'independent shortcuts retain independent generations')
local legacy=request(1);legacy.shortcut_app_id='3000000003';legacy.expires_at_ms=nil;legacy.resource_generation=nil;allow_legacy=true
check(artwork.save_shortcut_artwork(legacy).saved,'unfenced legacy API remains usable on untouched slots')
local big=request(1780000000000000);big.shortcut_app_id='3000000004'
check(artwork.save_shortcut_artwork(big).saved,'real epoch-sized generation is accepted exactly')
big.resource_generation=big.resource_generation-1
check(artwork.save_shortcut_artwork(big).error=='superseded','epoch-sized generation ordering remains precise')
local full=request(40);full.shortcut_app_id='3000000005'
check(artwork.save_shortcut_artwork(full).saved,'full-cleanup fixture has current artwork')
local full_target=grid..'3000000005_hero.png'
check(artwork.clear_artwork('3000000005',now,41).error=='resource_deadline_exceeded','expired flat cleanup is rejected')
check(files[full_target]==png,'expired full cleanup preserves current resources')
check(artwork.clear_artwork('3000000005',now+10000,39).error=='superseded','late full cleanup cannot delete newer resources')
check(files[full_target]==png,'older full cleanup leaves newer artwork mounted')
check(artwork.clear_artwork('3000000005',now+10000,41).ok,'current flat cleanup confirms deletion')
check(files[full_target]==nil,'confirmed full cleanup removes only its shortcut resources')
check(artwork.save_shortcut_artwork(full).error=='superseded','full cleanup keeps old writes fenced')
clean_temps()
print('Artwork backend write fencing checks passed ('..checks..' assertions).')
`);
