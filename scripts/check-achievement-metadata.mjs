import { runLuaCheck } from './helpers/lua-runtime.mjs';
import fs from 'node:fs';

const publicFixture = JSON.parse(fs.readFileSync('tests/fixtures/achievement-public-schema-1790600-latam.json', 'utf8'));
const luaValue = value => value == null ? 'nil' : Array.isArray(value) ? `{${value.map(luaValue).join(',')}}`
  : typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]=${luaValue(item)}`).join(',')}}`
  : JSON.stringify(value);

runLuaCheck({ util: 'backend/lib/util.lua', metadata: 'backend/lib/achievement_metadata.lua',
  achievements: 'backend/lib/achievements.lua' }, String.raw`
local checks, clock = 0, 10000
local function check(value, text) assert(value, text); checks = checks + 1 end
local files, json, calls, schema_enabled, percent, online, public_rows = {}, {}, 0, true, 100, true, nil
local function encode(value) local key = 'json'..tostring(#json + 1); json[#json+1] = value; json[key] = value; return key end
local function decode(key) assert(json[key], 'invalid mocked JSON'); return json[key] end
os.getenv = function() return nil end
os.time = function() return clock end
local fs = { join = function(...) return table.concat({...}, '/') end,
 parent_path = function(p) return p:match('^(.*)/') or '' end,
 exists = function(p) return (schema_enabled and p:match('UserGameStatsSchema_123.bin$')) or files[p] ~= nil end,
 list = function() return {} end, create_directories = function() end }
local function str(k,v) return string.char(1)..k..'\0'..v..'\0' end
local function obj(k,v) return string.char(0)..k..'\0'..v..string.char(8) end
local function int(k,v)
 if v<0 then v=v+4294967296 end
 return string.char(2)..k..'\0'..string.char(v%256,math.floor(v/256)%256,math.floor(v/65536)%256,math.floor(v/16777216)%256)
end
local function achievement(id, title, icon, permission)
 local permission_field=permission~=nil and (type(permission)=='string' and str('permission',permission) or int('permission',permission)) or ''
 return str('name',id)..permission_field..obj('display',obj('name',str('english',title))..obj('desc',str('english',title..' description'))..str('icon',icon)..str('icon_gray',icon))
end
local function schema(alpha,beta,appid)
 return obj(appid or '123',obj('stats',obj('0',obj('bits',obj('0',achievement('ACH_ALPHA','Alpha title','alpha.jpg',alpha))..obj('1',achievement('ACH_BETA','Beta title','beta.jpg',beta))))))..string.char(8)
end
local blob = schema()
io.open = function(p, mode)
 if schema_enabled and p:match('UserGameStatsSchema_123.bin$') then return {read=function() return blob end,close=function() end} end
 return nil
end
local deps = { fs=fs, logger={info=function() end,warn=function() end}, millennium={steam_path=function() return 'steam' end},
 cjson={encode=encode,decode=decode}, lru_cache={put=function(t,k,v)t[k]=v end,touch=function()end},
 config={persistent_path=function(p)return p end,write_json_atomic=function(p,v)files[p]=v;return true end},
 achievement_state={decode=function(p)return files[p]end,clear=function()end},
 achievement_settings={local_root=function()return 'sandbox'end,parse_request=function(v)return decode(v)end,
  resolve_options=function(_,defaults)return defaults end,configured_path=function()return nil end},
 achievement_policy={is_online=function()return false end},achievement_sources={find_matching_root_candidates=function()return {}end},
 http={get=function(url)
  calls=calls+1
  if not online then return {status=503} end
  if url:find('IPlayerService/GetGameAchievements/v1/',1,true) then
   return {status=200,body=encode({response={achievements=public_rows or {}}})}
  end
  if url:find('api.steampowered.com',1,true) then return {status=200,body=encode({achievementpercentages={achievements={
   {name='ACH_ALPHA',percent=percent},{name='ACH_BETA',percent=percent}}}})} end
  return {status=200,body='<div class="achieveRow"><img src="beta.jpg"><div class="achievePercent">'..percent..'%</div><h3>Beta title</h3><h5>Beta description</h5></div><div class="achieveRow"><img src="alpha.jpg"><div class="achievePercent">'..percent..'%</div><h3>Alpha title</h3><h5>Alpha description</h5></div>'}
 end} }
deps.util=factories.util(deps);deps.util.get_active_account_id=function()return nil end
deps.achievement_metadata=factories.metadata(deps)
local icons=deps.achievement_metadata
local current='https://shared.fastly.steamstatic.com/community_assets/images/apps/4080220/example.jpg'
check(icons.icon_url('4080220','example.jpg')==current,'bare Steam icon uses current community assets path')
check(icons.icon_url('4080220','')=='','missing icon remains missing')
check(icons.icon_url('4080220',current)==current,'current full URL is preserved')
check(icons.icon_url('4080220','https://example.com/image.png')=='https://example.com/image.png','unrelated full URL is preserved')
files['icon-migration.json']=icons.cache_record('4080220','english',{A={name='A',icon='https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/4080220/example.jpg',icongray='gray.jpg'}})
local migrated=icons.read_cached('icon-migration.json','4080220','english',false)
check(migrated.A.icon==current and migrated.A.icongray:match('/4080220/gray.jpg$'),'fresh cache repairs both icon variants without deleting achievement metadata')
local req=encode({steam_app_id='123',state_app_id='3000000001',language='english'})
local function fetch(module) return decode(module.fetch_local_achievement_data(req)) end
files['metadata_cache/123_english.json']={ACH_ALPHA={name='ACH_ALPHA',title='Wrong legacy title'}}
local module=factories.achievements(deps)
local result=fetch(module)
check(result.achievements[1].name=='ACH_ALPHA' and result.achievements[1].display_name=='Alpha title','ties never swap API identities')
check(result.achievements[1].icon:match('alpha.jpg$'),'identity keeps matching icon')
check(result.achievements[2].display_name=='Beta title','second identity preserved')
check(files['metadata_cache/123_english.json'].version==4,'legacy cache replaced by schema-order-aware versioned record')
local n=calls;fetch(factories.achievements(deps));check(calls==n,'fresh disk cache avoids repeated HTTP')
clock=clock+1801;percent=12
result=fetch(factories.achievements(deps));check(calls>n and result.achievements[1].global_percent==12,'expired disk cache revalidates on module restart')
clock=clock+90*86400;percent=8;n=calls
result=fetch(factories.achievements(deps));check(calls>n and result.achievements[1].global_percent==8,'90-day cache no longer freezes data')
files={};schema_enabled=false;percent=100
result=fetch(factories.achievements(deps))
check(result.metadata_source=='steam_public_unverified','missing schema explicitly requests a verified native read')
check(result.achievements[1].display_name=='ACH_ALPHA' and result.achievements[1].icon=='','no invented names/images from percentage/order')
check(files['metadata_cache/123_english.json']==nil,'unverified metadata is never persisted')
local hinted=encode({steam_app_id='123',state_app_id='3000000001',language='english',native_schema={appid='123',rows={
 {strID='ACH_ALPHA',strName='Alpha title',strImage='alpha.jpg'},{strID='ACH_BETA',strName='Beta title',strImage='beta.jpg'}}}})
module=factories.achievements(deps);result=decode(module.fetch_local_achievement_data(hinted))
check(result.achievements[1].display_name=='Alpha title','native hint establishes exact identity')
check(result.metadata_source=='steam_client_schema','verified hint source retained')
local bad_hint=encode({steam_app_id='123',language='english',native_schema={appid='999',rows={{strID='EVIL',strName='Wrong'}}}})
files={};result=decode(factories.achievements(deps).fetch_local_achievement_data(bad_hint))
check(result.total==2 and result.achievements[1].name=='ACH_ALPHA','another AppID cannot seed this schema')
files={};public_rows={
 {internal_name='ACH_BETA',localized_name='Beta public title',localized_desc='Beta description',icon='beta.jpg',icon_gray='beta-gray.jpg',hidden=true,player_percent_unlocked='100'},
 {internal_name='ACH_ALPHA',localized_name='Alpha public title',localized_desc='Alpha description',icon='alpha.jpg',icon_gray='alpha-gray.jpg',hidden=false,player_percent_unlocked='100'}}
n=calls;module=factories.achievements(deps);result=fetch(module)
check(result.metadata_source=='steam_public_schema','official public schema works without an owned/native schema or a client hint')
check(calls==n+1,'complete public metadata needs one official request, not extra HTML/percentage requests')
check(result.achievements[1].name=='ACH_ALPHA' and result.achievements[1].display_name=='Alpha public title','public internal_name establishes exact identity even when rarity ties and row order differ')
check(result.achievements[1].icon:match('/123/alpha.jpg$') and result.achievements[1].icon_gray:match('alpha%-gray.jpg$'),'public icons and locked icons use the linked official AppID')
check(result.achievements[2].hidden and result.achievements[2].global_percent==100,'public hidden flags and numeric-string rarity are normalized')
check(files['metadata_cache/123_english.json'].version==4,'verified public metadata is persisted with identity/language/version')
n=calls;fetch(factories.achievements(deps));check(calls==n,'public metadata survives backend restart without additional requests')
public_rows=nil
clock=10000;local valid=deps.achievement_metadata.cache_record('123','english',{ACH_ALPHA={name='ACH_ALPHA',title='Alpha title',global_percent=8}})
files['metadata_cache/123_english.json']=valid;clock=clock+1801;online=false
result=fetch(factories.achievements(deps))
check(result.metadata_source=='disk_cache_stale' and result.achievements[1].display_name=='Alpha title','temporary offline state may use verified bounded stale schema')
online=true;percent=7;result=fetch(factories.achievements(deps))
check(result.metadata_source=='disk_cache_stale' and result.achievements[1].display_name=='Alpha title' and result.achievements[1].global_percent==7,'a schema outage keeps verified names/icons while refreshing independent rarity by exact API ID')
online=false
clock=clock+31*86400;result=fetch(factories.achievements(deps));check(result.total==0,'over-age stale metadata is not perpetuated')
check(deps.achievement_metadata.read_cached('metadata_cache/123_english.json','999','english',true)==nil,'disk AppID must match')
check(deps.achievement_metadata.read_cached('metadata_cache/123_english.json','123','spanish',true)==nil,'disk language must match')
local t={A={icon='alpha.jpg',title='Correct',description='Correct'}}
deps.achievement_metadata.enrich_by_icon(t,{{icon='else.jpg',title='Wrong',description='Wrong'}},{})
check(t.A.title=='Correct','no local-schema fallback by row index')
schema_enabled=true;online=true
local real_state={ACH_ALPHA={earned=true,earned_time=0},ACH_BETA={earned=true,earned_time=1600000000}}
files['sandbox/real-progress.json']=real_state
deps.achievement_settings.configured_path=function()return 'sandbox/real-progress.json','shortcut' end
result=fetch(factories.achievements(deps))
check(result.found and result.unlocked==2 and result.state_source=='per_game:shortcut','timestamp regression reads real configured progress, not simulation')
check(result.achievements[1].earned_time==0,'an earned achievement with an unknown date remains unknown')
check(result.achievements[2].earned_time==1600000000,'a recorded unlock timestamp remains exact')
check(result.achievements[1].schema_order==0 and result.achievements[2].schema_order==1,'real snapshots preserve native stat/bit order independently of alphabetized state names')
clock=clock+3*86400;result=fetch(factories.achievements(deps))
check(result.achievements[1].earned_time==0 and real_state.ACH_ALPHA.earned_time==0,'unknown dates never advance with the clock or modify the progress file')
blob=schema(2,0)
local permissions,all_protected=deps.achievement_metadata.client_permissions('123')
check(permissions.ACH_ALPHA.client_writable==false and permissions.ACH_BETA.client_writable==nil and not all_protected,'only exact Steam schema restriction bits mark a row as protected')
check(permissions.ACH_ALPHA.schema_order==0 and permissions.ACH_BETA.schema_order==1,'native order is derived from numeric stat and bit identities')
local permissions_module=factories.achievements(deps)
result=fetch(permissions_module)
check(result.achievements[1].client_writable==false and result.achievements[2].client_writable==nil,'real progress metadata exports verified per-achievement protection')
blob=schema(0,2);result=fetch(permissions_module)
check(result.achievements[1].client_writable==nil and result.achievements[2].client_writable==false,'fresh Steam schema permissions override cached metadata immediately')
for _,permission in ipairs({1,2,3,6}) do
 blob=schema(permission,permission)
 permissions,all_protected=deps.achievement_metadata.client_permissions('123')
 check(all_protected and permissions.ACH_ALPHA.client_writable==false,'protected low permission bits are honored without guessing a single game')
end
for _,permission in ipairs({0,4,-1,'2'}) do
 blob=schema(permission,permission)
 permissions,all_protected=deps.achievement_metadata.client_permissions('123')
 check(not all_protected and permissions.ACH_ALPHA.client_writable==nil,'unrestricted or invalid permissions never become false protection')
end
blob=schema(2,nil);permissions,all_protected=deps.achievement_metadata.client_permissions('123')
check(not all_protected and permissions.ACH_BETA.client_writable==nil,'one unknown permission prevents an all-protected application claim')
blob=schema(2,2,'999');permissions,all_protected=deps.achievement_metadata.client_permissions('123')
check(next(permissions)==nil and not all_protected,'another AppID schema cannot restrict this game')
blob=schema(2,2):sub(1,-3);permissions,all_protected=deps.achievement_metadata.client_permissions('123')
check(next(permissions)==nil and not all_protected,'a truncated binary schema provides no restriction evidence')
blob=obj('123',obj('stats',obj('0',obj('bits',obj('0',achievement('ACH_ALPHA','Alpha','alpha.jpg',2))..obj('1',achievement('ACH_ALPHA','Duplicate','alpha.jpg',2))))))..string.char(8)
permissions,all_protected=deps.achievement_metadata.client_permissions('123')
check(next(permissions)==nil and not all_protected,'duplicate API identities make a permission schema incomplete and untrusted')
schema_enabled=false;result=fetch(permissions_module)
check(result.achievements[1].client_writable==nil and result.achievements[2].client_writable==nil,'cached protection is omitted when its current native schema cannot be verified')
local hinted_permissions=deps.achievement_metadata.normalize_rows('123',{{strID='ACH_ALPHA',client_writable=false,permission=2}})
local public_permissions=deps.achievement_metadata.normalize_public_rows('123',{{internal_name='ACH_ALPHA',client_writable=false,permission=2}},function()return ''end)
check(hinted_permissions.ACH_ALPHA.client_writable==nil and public_permissions.ACH_ALPHA.client_writable==nil,'client hints and public/local metadata cannot invent protection flags')
local ordered_rows=deps.achievement_metadata.normalize_rows('123',{{strID='ZETA'},{strID='ALPHA'}})
check(ordered_rows.ZETA.schema_order==0 and ordered_rows.ALPHA.schema_order==1,'schema arrays keep source order rather than alphabetical API names')
local unordered_rows=deps.achievement_metadata.normalize_rows('123',{ZETA={strID='ZETA'},ALPHA={strID='ALPHA'}})
check(unordered_rows.ZETA.schema_order==nil and unordered_rows.ALPHA.schema_order==nil,'unordered metadata maps do not fabricate a schema position')
local invalid_order=deps.achievement_metadata.normalize_rows('123',{ZETA={strID='ZETA',schema_order=-1},ALPHA={strID='ALPHA',schema_order=1.5}})
check(invalid_order.ZETA.schema_order==nil and invalid_order.ALPHA.schema_order==nil,'negative and fractional schema positions are rejected')
local old=deps.achievement_metadata.cache_record('123','english',{})
old.version=2;files['old-permission-cache.json']=old
check(deps.achievement_metadata.read_cached('old-permission-cache.json','123','english',true)==nil,'version 2 metadata is invalidated for permission-aware migration')
old.version=3;files['old-order-cache.json']=old
check(deps.achievement_metadata.read_cached('old-order-cache.json','123','english',false)==nil,'version 3 metadata is refreshed to recover the missing schema ordering')
check(deps.achievement_metadata.read_cached('old-order-cache.json','123','english',true)~=nil,'verified version 3 metadata remains available during a schema outage instead of erasing icons and names')
print('Achievement metadata passed: '..checks..' checks; actual Lua, schema identity, migration, TTL, restart, offline and provenance.')
` + `
local fixture=${luaValue(publicFixture)}
local normalized=deps.achievement_metadata.normalize_public_rows('1790600',fixture.response.achievements,function(appid,icon)return 'https://shared.steamstatic.com/community_assets/images/apps/'..appid..'/'..tostring(icon or '')end)
check(normalized.ACH_0001.title=='Un sorbo de la victoria' and normalized.ACH_0001.description=='Ganaste 10 batallas.','real public Steam latam fixture retains exact localized achievement text')
check(normalized.ACH_0039.title=='Guerrero novato' and normalized.ACH_0039.global_percent==80.1,'real public Steam fixture maps numeric-string percentage to its API ID')
check(normalized.ACH_0039.icon:match('2595e93b52233c9497aed077dbfa29d29892df61.jpg$') and normalized.ACH_0039.icongray:match('18614f449741f7e544fba68a28c0fb4481b084c6.jpg$'),'real public fixture retains both official icons')
check(normalized.ACH_0001.schema_order==0 and normalized.ACH_0039.schema_order==1,'real public fixture retains response order alongside exact API identities')
print('Real public Steam schema fixture passed: 4 checks.')
`);
