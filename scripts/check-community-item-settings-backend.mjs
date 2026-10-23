import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runLuaCheck } from './helpers/lua-runtime.mjs';
runLuaCheck({settings:'backend/lib/community_item_settings.lua'},String.raw`
local data, failed, writes = {}, false, 0
local links={['shortcut:3000000001']='1',['shortcut:3000000002']='1',['shortcut:3000000003']='2',
 ['shortcut:-1294967292']='3',['3000000005']='4',['title:3000000006']='5'}
local function copy(value)
 if type(value)~='table' then return value end
 local result={} for k,v in pairs(value) do result[k]=copy(v) end return result
end
local deps={
 cjson={encode=function(value)return value end,decode=function()error('bad json')end,null={}},
 config={state_path=function(name)assert(name=='community_item_options.json');return '/user/'..name end,
 read_json=function()return copy(data)end,
 write_json_atomic=function(path,value)
  assert(path=='/user/community_item_options.json')
  if failed then return false end
  writes=writes+1;data=copy(value);return true
 end},
 mappings={read_mappings=function()return copy(links)end},
}
local api=factories.settings(deps)
local function request(shortcut,steam,more)
 local result={shortcut_app_id=shortcut or '3000000001',steam_app_id=steam or '1'}
 for k,v in pairs(more or {})do result[k]=v end return result
end
local function assert_auto(value)
 assert(value.ok and value.enabled and value.card_border=='foil' and value.auto_foil==true)
 assert(#value.card_ids==0 and value.badge_id==nil,'Automatic foil is a declarative preset without catalogue-dependent IDs')
end
assert_auto(api.get_options(request()))
assert(next(data)==nil and writes==0,'A missing preference uses the preset without writing a settings record')
for i=1,10 do assert_auto(api.get_options(request())) end
assert(writes==0,'Repeated default reads never perform persistence or need a catalogue request')
assert(api.get_options(request()).ok,'Production shortcut: mapping namespace authorizes settings')
assert(api.get_options(request('3000000004','3')).ok,'Historical signed shortcut keys resolve to unsigned client IDs')
assert(api.get_options(request('3000000005','4')).error=='not_linked','Bare numeric title keys do not authorize an installation')
assert(api.get_options(request('3000000006','5')).error=='not_linked','Title-only mappings do not authorize an installation')
links['shortcut:3000000004']='9'
assert(api.get_options(request('3000000004','3')).error=='not_linked','Canonical unsigned mapping supersedes its historical signed alias')
assert(api.set_options(request(nil,nil,{enabled=true,card_border='foil',card_ids={'card:foil:A','card:foil:A','card:normal:B'},badge_id='badge:foil'})).ok)
local read=api.get_options(request())
assert(read.enabled and read.card_border=='foil' and #read.card_ids==2 and read.badge_id=='badge:foil' and read.auto_foil==nil,
 'Existing custom foil selections do not acquire automatic behavior')
assert_auto(api.get_options(request('3000000002')))
data['3000000002:1']={enabled=false,card_border='foil',card_ids={'legacy-card'},badge_id='legacy-badge'}
data['3000000003:2']={enabled=true,card_border='normal',card_ids={'normal-card'},badge_id='normal-badge',auto_foil=false}
local disabled=api.get_options(request('3000000002'))
assert(not disabled.enabled and disabled.card_border=='foil' and disabled.card_ids[1]=='legacy-card'
 and disabled.badge_id=='legacy-badge' and disabled.auto_foil==nil,'Explicit legacy disabled preferences remain intact')
local normal=api.get_options(request('3000000003','2'))
assert(normal.enabled and normal.card_border=='normal' and normal.card_ids[1]=='normal-card'
 and normal.badge_id=='normal-badge' and normal.auto_foil==nil,'Custom normal records and optional false preserve the old response shape')
assert(api.get_options(request('3000000001','2')).error=='not_linked','Relink scope cannot inherit settings')
assert(api.set_options(request('1','1',{enabled=true})).error=='not_linked','Native games receive no settings')
assert(api.set_options(request(nil,nil,{card_border='invalid'})).error=='invalid_card_border')
for _,flag in ipairs({'true',1,{}}) do
 assert(api.set_options(request(nil,nil,{enabled=true,card_border='foil',auto_foil=flag})).error=='invalid_auto_foil')
end
assert(api.set_options(request(nil,nil,{enabled=true,card_border='normal',auto_foil=true})).error=='invalid_auto_foil')
assert(api.set_options(request(nil,nil,{enabled=false,card_border='foil',auto_foil=true})).error=='invalid_auto_foil')
assert(api.set_options(request(nil,nil,{card_ids={bad='x'}})).error=='invalid_cards')
assert(api.set_options(request(nil,nil,{card_ids={[2]='x'}})).error=='invalid_cards')
assert(api.set_options(request(nil,nil,{card_ids={'a',extra='b'}})).error=='invalid_cards')
assert(api.set_options(request(nil,nil,{card_ids={'bad'..string.char(0)..'id'}})).error=='invalid_card_id')
assert(api.set_options('invalid json').error=='invalid_request')
local many={}for i=1,513 do many[i]='card:'..i end
assert(api.set_options(request(nil,nil,{card_ids=many})).error=='too_many_cards')
failed=true
assert(api.set_options(request(nil,nil,{enabled=true,card_ids={'new'}})).error=='write_failed')
assert(api.get_options(request()).badge_id=='badge:foil','Failed persistence does not acknowledge or replace selection')
failed=false
api=factories.settings(deps)
assert(api.get_options(request()).badge_id=='badge:foil','Selections survive fresh backend instance')
assert_auto(api.set_options(request(nil,nil,{enabled=true,card_border='foil',card_ids={},auto_foil=true})))
api=factories.settings(deps)
assert_auto(api.get_options(request()))
local off=api.set_options(request(nil,nil,{enabled=false,card_border='normal',card_ids={},auto_foil=false}))
assert(not off.enabled and off.auto_foil==nil and data['3000000001:1'].auto_foil==nil,
 'Using Steam data persists an explicit disabled record without an obsolete false flag')
api=factories.settings(deps)
assert(not api.get_options(request()).enabled,'An explicit disabled choice survives backend restart')
assert_auto(api.set_options(request(nil,nil,{reset=true})))
assert_auto(api.get_options(request()))
assert(data['3000000001:1']==nil and data['3000000002:1']~=nil,'Reset removes only the exact link and returns to the virtual preset')
api.set_options(request(nil,nil,{enabled=true,card_ids={'a'}}))
assert(api.clear_all())
assert(next(data)==nil,'Factory reset clears local selections')
assert_auto(api.get_options(request()))
assert(writes==6)
`);
assert.match(fs.readFileSync('backend/main.lua','utf8'),/community_item_settings"\)\.clear_all\(\)/);
console.log('Community item settings backend passed: virtual automatic foil defaults, preserved custom/disabled records, exact link scope, restart, validation, reset, deduplication and failed writes; no catalogue requests or account operations.');
