import fs from 'node:fs';
import { runLuaCheck } from './helpers/lua-runtime.mjs';

// Captured from the public Steam API; routine checks never need the network.
const official = JSON.parse(fs.readFileSync('tests/fixtures/shortcut-detection-remote-official.json', 'utf8').replace(/^\uFEFF/, ''));
function lua(value) {
  if (value == null) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  return `{${Object.entries(value).map(([key, item]) => `[${Array.isArray(value) ? Number(key) + 1 : JSON.stringify(key)}]=${lua(item)}`).join(',')}}`;
}
function binaryObject(entries) {
  return Buffer.concat([...entries.map(([key, value]) => {
    const prefix = Buffer.concat([Buffer.from([typeof value === 'number' ? 2 : Array.isArray(value) ? 0 : 1]), Buffer.from(`${key}\0`)]);
    if (Array.isArray(value)) return Buffer.concat([prefix, binaryObject(value)]);
    if (typeof value === 'number') { const number = Buffer.alloc(4); number.writeUInt32LE(value); return Buffer.concat([prefix, number]); }
    return Buffer.concat([prefix, Buffer.from(`${value}\0`)]);
  }), Buffer.from([8])]);
}
const shortcutBytes = binaryObject([['shortcuts', [
  ['0', [['appid', 2147483651], ['AppName', 'bf3'], ['Exe', '"E:\\Wrong\\bf3.exe"'], ['StartDir', '"E:\\Wrong"']]],
  ['1', [['appid', 2147483652], ['AppName', 'bf3'], ['Exe', '"E:\\Juegos\\Battlefield 3\\bf3.exe"'], ['StartDir', '"E:\\Juegos\\Battlefield 3"']]],
  ['2', [['appid', 2147483653], ['AppName', 'Unique game'], ['Exe', '"E:\\Unique\\unique.exe"']]],
]]]);
const shortcutLua = Array.from({ length: Math.ceil(shortcutBytes.length / 100) }, (_, index) =>
  `string.char(${[...shortcutBytes.subarray(index * 100, (index + 1) * 100)].join(',')})`).join('..');
runLuaCheck({ text: 'backend/lib/shortcut_detection_text.lua', aliases: 'backend/lib/shortcut_detection_aliases.lua',
  ttl: 'backend/lib/ttl_cache.lua', util: 'backend/lib/util.lua', catalog: 'backend/lib/shortcut_detection_catalog.lua',
  detector: 'backend/lib/shortcut_detection.lua' }, `local official=${lua(official)}\nlocal shortcut_bytes=${shortcutLua}\n` + String.raw`
local checks=0
local function check(value,message)checks=checks+1;assert(value,message)end
local function has(items,value)for _,item in ipairs(items or{})do if item==value then return true end end;return false end
local text=factories.text({})
local aliases=factories.aliases({})
local native_open=io.open
os.execute=function()error('remote detection must not execute processes')end
io.popen=function()error('remote detection must not execute shells')end
local function make(options)
 options=options or{}
 local calls, encoded, serial, opened, closed={},{},0,0,0
 local function encode(value)serial=serial+1;local id='json:'..serial;encoded[id]=value;return id end
 local cjson={encode=encode,decode=function(value)if not encoded[value]then error('unregistered fixture JSON '..tostring(value))end;return encoded[value]end}
 local files=options.files or{}
 local fs={exists=function(path)return files[path]~=nil end,
  join=function(...)return table.concat({...},'\\')end,
  parent_path=function(path)return path:match('^(.*)\\[^\\]+$')or''end,
  last_write_time=function(path)return path:find('222',1,true)and 200 or 100 end,
  list=function(path)return options.entries or{} end}
 io.open=function(path,mode)
  local data=files[path];if not data then return nil end
  opened=opened+1
  return{read=function(_,length)return length=='*a'and data or data:sub(1,length)end,close=function()closed=closed+1 end}
 end
 local util=factories.util({})
 local function respond(value)return{status=200,body=encode(value)}end
 local function decode_term(url)return(url:match('[?&]term=([^&]+)')or url:match('[?&]search=([^&]+)')or''):gsub('%%(%x%x)',function(hex)return string.char(tonumber(hex,16))end)end
 local http={get=function(url)
  calls[#calls+1]=url
  if options.http then local value=options.http(url,decode_term(url),#calls);if value~=nil then return value.status and value or respond(value)end end
  if url:find('/api/storesearch/',1,true)then
   local term=decode_term(url)
   local items=options.search and options.search(term)or{}
   return respond({items=items,total=#items})
  end
  local id=url:match('appids=(%d+)')
  if id then local data=(options.details or official.details)[id];return respond({[id]=data or{success=false}})end
  id=url:match('/v1/info/(%d+)')
  if id then return respond({data={[id]=options.appinfo and options.appinfo[id]}})end
  if url:find('wbsearchentities',1,true)then
   local matches=options.graph and options.graph(decode_term(url))or{}
   return respond({search=matches})
  end
  if url:find('wbgetentities',1,true)then return respond({entities=options.entities or{}})end
  return{status=503,body=''}
 end}
 local ttl=factories.ttl({})
 local catalog=factories.catalog({http=http,cjson=cjson,util=util,ttl_cache=ttl,shortcut_detection_text=text})
 local detector=factories.detector({logger={info=function()end,warn=function()end},millennium={steam_path=function()return'C:\\Steam'end},
  fs=fs,http=http,cjson=cjson,util=util,config={},ttl_cache=ttl,shortcut_detection_text=text,
  shortcut_detection_aliases=options.aliases or aliases,shortcut_detection_catalog=catalog,
  shortcut_registry={preferred_account_id=function()return options.account end},
  shortcut_detection_pe={read_pe_metadata=function()return options.product,options.description end,is_generic_product_name=function()return false end},
  shortcut_detection_local=options.localer})
 return{detector=detector,catalog=catalog,calls=calls,
  detect=function(request)return cjson.decode(detector.detect_game_candidates(encode(request)))end,
  shortcut=function(id,title)return cjson.decode(detector.get_shortcut_details(id,title))end,
  balanced=function()return opened==closed end}
end
local function request(extra)
 local value={title='bf3',exe_path='E:\\Juegos\\Battlefield 3\\bf3.exe',start_dir='E:\\Juegos\\Battlefield 3',launch_options=''}
 for k,v in pairs(extra or{})do value[k]=v end
 return value
end
local function storeCalls(host)local result={};for _,url in ipairs(host.calls)do if url:find('/api/storesearch/',1,true)then result[#result+1]=url end end;return result end
local current=make({search=function(term)return term=='Battlefield 3'and official['Battlefield 3'].items or{}end})
local result=current.detect(request())
check(result.candidates[1]and result.candidates[1].appid=='1238820','captured real Store search ranks BF3 from its descriptive folder')
check(result.candidates[1].score>=70,'descriptive exact folder is supporting evidence even with abbreviated shortcut')
check(storeCalls(current)[1]:find('Battlefield%%203'),'folder query precedes bf3')
for _,candidate in ipairs(result.candidates)do
 check(candidate.appid~='41070','BF3 never suggests Serious Sam')
 check(candidate.appid~='1238831'and candidate.appid~='1278134','known official DLC metadata cannot become a game suggestion')
end
local withPE=make({product='Battlefield 3™',description='Battlefield 3™',search=function(term)return term=='Battlefield 3™'and official['Battlefield 3'].items or{}end})
result=withPE.detect(request())
check(result.candidates[1]and result.candidates[1].appid=='1238820'and result.candidates[1].score>=94,'PE product gives strong exact BF3 identity')
check(storeCalls(withPE)[1]:find('Battlefield%%203'),'PE query precedes abbreviated exe')
local queries=withPE.catalog.discovery_queries({title='bf3',exe_stem='bf3',pe_product='Battlefield 3™',folders={'Battlefield 3','Juegos'}},aliases)
check(text.normalize(queries[1])=='battlefield 3','product is first query')
for _,query in ipairs(queries)do check(text.normalize(query)~='juegos','generic installation roots never consume network query budget')end
local claimed={Q100={claims={P1733={{mainsnak={datavalue={value='1238820'}}}}}}}
local noise={id=41070,name='Serious Sam 3 BFE',type='app',tiny_image='noise.jpg'}
local fallback=make({search=function()return{noise}end,graph=function(term)return term=='Battlefield 3'and{{id='Q100',label='Battlefield 3',description='2011 video game'}}or{}end,entities=claimed})
result=fallback.detect(request({local_candidates={{appid='41070',name=noise.name,score=7,evidence_tier='hint'}}}))
check(result.candidates[1]and result.candidates[1].appid=='1238820','rank-only synthetic noise is dropped so open catalog fallback can run')
check(result.candidates[1].score==72 and result.candidates[1].evidence_tier=='supporting','folder catalog match is never invented as proof or 90 percent')
check(#storeCalls(fallback)>=2,'weak local hints do not truncate remote query budget to one')
check(has(result.candidates[1].reasons,'folder_exact'),'fallback preserves actual source of identity')
local empty=make({search=function()return{noise}end})
check(#empty.detect(request()).candidates==0,'no independent identity evidence yields an empty result instead of 7 percent unrelated suggestion')
for _,replacement in ipairs({{name='Battlefield 4',type='game'},{name='Battlefield 3',type='dlc'}})do
 local renamed=make({search=function()return{{id='1238820',name='Battlefield 3',type='app',header_image='header.jpg'}}end,
  appinfo={['1238820']={common={name='Battlefield 3',type='game'}}},details={['1238820']={success=true,data=replacement}}})
 check(#renamed.detect(request()).candidates==0,'later authoritative name/type enrichment is rechecked before presenting a candidate')
end
local noContext=make({search=function()return{noise}end})
check(#noContext.detect(request({start_dir='E:\\Juegos',exe_path='E:\\Juegos\\bf3.exe'})).candidates==0,'abbreviated exe and common sequel alone identify no franchise')
local function catalogCase(match,details,context,direct)
 local host=make();host.catalog.resolve_catalog_appids=function()return{match}end
 local direct_calls=0
 local candidates=host.catalog.resolve_catalog_candidates({},context or{title='bf3',folders={'Battlefield 3'}},
 {fetch_appdetails=function()return details end,fetch_appinfo=function()return nil end,
 direct_result=function(...)direct_calls=direct_calls+1;return direct and direct(...)end})
 return candidates,direct_calls
end
local valid={appid='1238820',name='Battlefield 3',is_game=true}
local bad,called=catalogCase({appid='41070',name='Serious Sam 3 BFE',is_game=true},{name='Serious Sam 3 BFE',type='game'})
check(#bad==0 and called==0,'unrelated graph claims never reach direct proof helper')
bad,called=catalogCase(valid,{name='Battlefield 3',type='dlc'})
check(#bad==0 and called==0,'catalog rejects known official non-game even when label matches exactly')
bad,called=catalogCase(valid,{name='Battlefield 4',type='game'})
check(#bad==0 and called==0,'catalog rejects contradictory official sequel identity')
bad,called=catalogCase(valid,nil,{title='Battlefield 3'},function()return{candidates={{score=100,direct=true}}}end)
check(#bad==1 and bad[1].score==55 and bad[1].validation_state=='partial','unavailable official metadata leaves provisional identity')
check(called==0 and not has(bad[1].reasons,'official_title_exact')and not has(bad[1].reasons,'pe_product_exact'),'knowledge graph labels never manufacture official proof')
local partial=make({details={},graph=function()return{{id='Q100',label='Battlefield 3',description='video game'}}end,entities=claimed})
result=partial.detect(request({title='Battlefield 3'}))
check(result.validation_state=='partial'and result.candidates[1].validation_state=='partial','graph-only result never becomes confirmed through successful empty Store search')
local before=#partial.calls
partial.detect(request({title='Battlefield 3'}))
check(#partial.calls>before,'partial graph result is not frozen into ten-minute candidate cache')
bad=catalogCase(valid,{name='Battlefield 3',type='game'},{title='bf3',pe_product='Battlefield 3'},function()return{candidates={{score=68,evidence_tier='supporting',reasons={'actual_proof'}}}}end)
check(bad[1].score==68 and bad[1].evidence_tier=='supporting','catalog preserves proof helper score instead of forcing 95')
local attempts=0
local retry=make({http=function(url)
 if url:find('wbsearchentities',1,true)then attempts=attempts+1;if attempts==1 then return{status=503,body=''}end;return{search={{id='Q100',label='Battlefield 3',description='video game'}}}end
end,entities=claimed})
check(#retry.catalog.resolve_catalog_appids('Battlefield 3')==0,'transient catalog HTTP error returns empty safely')
check(#retry.catalog.resolve_catalog_appids('Battlefield 3')==1 and attempts==2,'transient HTTP error never poisons negative cache for ten minutes')
local claimsAttempts=0
local retryClaims=make({graph=function()return{{id='Q100',label='Battlefield 3',description='video game'}}end,
 http=function(url)if url:find('wbgetentities',1,true)then claimsAttempts=claimsAttempts+1;if claimsAttempts==1 then return{status=503,body=''}end;return{entities=claimed}end end})
check(#retryClaims.catalog.resolve_catalog_appids('Battlefield 3')==0,'transient claims error returns empty safely')
check(#retryClaims.catalog.resolve_catalog_appids('Battlefield 3')==1 and claimsAttempts==2,'transient claims failures remain retryable')
local aliasHost=make({aliases={tiny={name='Battlefield 3',auto_appid='1238820',appids={'1238820'}}},
 appinfo={['1238820']={common={name='Battlefield 3',type='game'},config={launch={{executable='bf3.exe'}}}}}})
result=aliasHost.detect(request({title='tiny'}))
check(result.candidates[1]and result.candidates[1].direct and result.candidates[1].appid=='1238820','nil PE fields do not terminate maintained-alias lookup before title')
check(#storeCalls(aliasHost)==0,'validated maintained alias keeps fast path')
local datedFolder=make({product='Battlefield 3™',description='Battlefield 3™',
 search=function()return official['Battlefield 3'].items end})
result=datedFolder.detect(request({start_dir='E:\\Juegos\\Battlefield 3 (2011)',exe_path='E:\\Juegos\\Battlefield 3 (2011)\\bf3.exe'}))
check(result.candidates[1]and result.candidates[1].appid=='1238820'and result.candidates[1].score>=94,'exact PE/official game identity overrides omitted Store year from a weak folder hint')
check(not has(result.rejected_appids,'1238820'),'omitted official year is not a positive official rejection')
local gtaName='Grand Theft Auto IV: The Complete Edition'
local localGta={appid='12210',name=gtaName,score=99,direct=true,evidence_tier='proof'}
local rejectedGta=make({details={},appinfo={['12210']={common={name=gtaName,type='dlc'}}},
 localer={discover_local_candidates=function()return{candidates={localGta}}end}})
result=rejectedGta.detect({title='GTAIV',exe_path='E:\\Juegos\\GTAIV\\GTAIV.exe',start_dir='E:\\Juegos\\GTAIV',
 local_candidates={localGta}})
check(#result.candidates==0,'official AppInfo DLC cannot revive through maintained-alias name or local 99 fallback')
check(#result.rejected_appids==1 and result.rejected_appids[1]=='12210','positive official type rejection is propagated once as a deterministic string ID')
local missingGta=make({details={}})
result=missingGta.detect({title='GTAIV',exe_path='E:\\Juegos\\GTAIV\\GTAIV.exe',start_dir='E:\\Juegos\\GTAIV'})
check(not has(result.rejected_appids,'12210'),'unavailable official metadata never declares a positive rejection')
local wrongAlias=make({aliases={battlefield3={name='Battlefield 3',auto_appid='1238820',appids={'1238820'}}},
 product='Battlefield 4',description='Battlefield 4',details={['1238820']={success=true,data={name='Battlefield 3',type='game'}}}})
result=wrongAlias.detect({title='Battlefield 3',exe_path='E:\\Juegos\\Battlefield 4\\bf4.exe',start_dir='E:\\Juegos\\Battlefield 4'})
check(#result.candidates==0 and has(result.rejected_appids,'1238820'),'alias title never overrides contradictory PE/executable-folder sequel identity')
local rdrMismatch=make({product='Red Dead Redemption 1',description='Red Dead Redemption 1',
 details={['1174180']={success=true,data={name='Red Dead Redemption 2',type='game'}}}})
result=rdrMismatch.detect({title='RDR2',exe_path='E:\\Juegos\\Red Dead Redemption 1\\rdr.exe',start_dir='E:\\Juegos\\Red Dead Redemption 1'})
check(not has((function()local ids={}for _,c in ipairs(result.candidates)do ids[#ids+1]=c.appid end;return ids end)(),'1174180')
 and has(result.rejected_appids,'1174180'),'real RDR2 alias cannot ignore another installment in PE/folder')
local rdrOriginal=make({product='Red Dead Redemption',description='Red Dead Redemption',
 details={['1174180']={success=true,data={name='Red Dead Redemption 2',type='game'}}}})
result=rdrOriginal.detect({title='RDR2',exe_path='E:\\Juegos\\Red Dead Redemption\\rdr.exe',start_dir='E:\\Juegos\\Red Dead Redemption'})
check(has(result.rejected_appids,'1174180'),'first installment full PE and folder identity does not need an invented numeral 1 to reject its sequel')
local reOriginal=make({product='Resident Evil 4',details={
 ['254700']={success=true,data={name='Resident Evil 4 (2005)',type='game'}},
 ['2050650']={success=true,data={name='Resident Evil 4',type='game'}}},
 search=function()return{{id='2050650',name='Resident Evil 4',type='app'},{id='254700',name='Resident Evil 4 (2005)',type='app'}}end})
result=reOriginal.detect({title='Resident Evil 4 (2005)',exe_path='E:\\Juegos\\Resident Evil 4\\bio4.exe',start_dir='E:\\Juegos\\Resident Evil 4'})
check(result.candidates[1]and result.candidates[1].appid=='254700','explicit original RE4 year still selects original instead of remake')
check(not has(result.rejected_appids,'2050650'),'official omitted year remains ambiguity rather than permanent rejection')
local files={['C:\\Steam\\userdata']=true,['C:\\Steam\\userdata\\111\\config\\shortcuts.vdf']=shortcut_bytes}
local vdf=make({files=files,entries={{name='111'}},account='111'})
local shortcut=vdf.shortcut('2147483652','bf3')
check(shortcut.exe_path=='E:\\Juegos\\Battlefield 3\\bf3.exe','exact ID outranks an earlier homonymous shortcut with different executable')
check(vdf.shortcut('-2147483644','bf3').exe_path==shortcut.exe_path,'signed CEF shortcut ID resolves exact unsigned VDF ID')
check(vdf.shortcut(nil,'bf3').error=='shortcut_not_found','ambiguous title never swaps executables')
check(vdf.shortcut('2147483999','bf3').error=='shortcut_not_found','missing explicit ID never falls back to homonym')
check(vdf.shortcut(nil,'Unique game').exe_path=='E:\\Unique\\unique.exe','title-only fallback remains available when unique')
check(vdf.balanced(),'shortcut files always close')
local absent=make({files=files,entries={{name='111'}},account='222'})
check(absent.shortcut('2147483652','bf3').error=='shortcut_not_found','known active account never borrows another account shortcut')
local numeric=make({files=files,entries={{name='111'}},account=111})
check(numeric.shortcut('2147483652','bf3').exe_path==shortcut.exe_path,'numeric preferred account normalizes safely')
io.open=native_open
print('Remote detection runtime: '..checks..' production Lua assertions passed (captured Steam BF3 results, evidence ranking, catalog safety, transient retry, exact VDF identity).')
`);
