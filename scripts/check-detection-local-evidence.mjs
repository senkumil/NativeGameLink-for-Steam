import assert from 'node:assert/strict';
import fs from 'node:fs';
import fengari from 'fengari';

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const align = size => Math.ceil(size / 4) * 4;
function block(key, value = Buffer.alloc(0), kind = 1, children = []) {
  const name = Buffer.from(`${key}\0`, 'utf16le');
  const start = align(6 + name.length);
  const childStart = align(start + value.length);
  const result = Buffer.alloc(childStart + children.reduce((size, child) => size + align(child.length), 0));
  result.writeUInt16LE(result.length, 0);
  result.writeUInt16LE(kind === 1 ? value.length / 2 : value.length, 2);
  result.writeUInt16LE(kind, 4);
  name.copy(result, 6); value.copy(result, start);
  let offset = childStart;
  for (const child of children) { child.copy(result, offset); offset += align(child.length); }
  return result;
}
function executable(product, description, plus = false, extra = {}) {
  const version = block('VS_VERSION_INFO', Buffer.alloc(52), 0, [
    block('StringFileInfo', undefined, 1, [block('040904b0', undefined, 1, [
      block('ProductName', Buffer.from(`${product}\0`, 'utf16le')),
      block('FileDescription', Buffer.from(`${description}\0`, 'utf16le')),
      ...Object.entries(extra).map(([name, value]) => block(name, Buffer.from(`${value}\0`, 'utf16le'))),
    ])]),
  ]);
  const resource = Buffer.alloc(88 + version.length);
  for (const [offset, id, target] of [[0, 16, 0x80000018], [24, 1, 0x80000030], [48, 1033, 72]]) {
    resource.writeUInt16LE(1, offset + 14);
    resource.writeUInt32LE(id, offset + 16);
    resource.writeUInt32LE(target, offset + 20);
  }
  resource.writeUInt32LE(0x1000 + 88, 72); resource.writeUInt32LE(version.length, 76);
  version.copy(resource, 88);
  const optionalSize = plus ? 240 : 224;
  const result = Buffer.alloc(512 + align(resource.length));
  result.write('MZ'); result.writeUInt32LE(128, 60); result.write('PE\0\0', 128);
  result.writeUInt16LE(1, 134); result.writeUInt16LE(optionalSize, 148);
  const optional = 152;
  result.writeUInt16LE(plus ? 523 : 267, optional);
  result.writeUInt32LE(16, optional + (plus ? 108 : 92));
  result.writeUInt32LE(0x1000, optional + (plus ? 128 : 112));
  result.writeUInt32LE(resource.length, optional + (plus ? 132 : 116));
  const section = optional + optionalSize;
  result.write('.rsrc', section); result.writeUInt32LE(resource.length, section + 8);
  result.writeUInt32LE(0x1000, section + 12); result.writeUInt32LE(result.length - 512, section + 16);
  result.writeUInt32LE(512, section + 20); resource.copy(result, 512);
  return result;
}

const fixtures = {
  bf3: executable('Battlefield 3™', 'Battlefield 3™'),
  unicode: executable('Acción Épica 🐉', 'Descripción del juego', true),
  generic: executable('Unreal Engine', 'Game Launcher'),
  original: executable('Unlisted Space Adventure ™', 'Unlisted Space Adventure ™', false, {
    CompanyName: 'Example Publisher', FileVersion: '1, 0, 0, 222',
    LegalCopyright: 'Copyright © 2008', OriginalFilename: 'Unlisted Space Adventure.exe',
  }),
  remake: executable('Unlisted Space Adventure ™', 'Unlisted Space Adventure ™', true, {
    CompanyName: 'Example Publisher', FileVersion: '2.0.0.0',
    LegalCopyright: 'Copyright © 2023', OriginalFilename: 'UnlistedSpaceAdventure.exe',
  }),
};
fixtures.truncated = fixtures.bf3.subarray(0, 540);
fixtures.invalidOffset = Buffer.from(fixtures.bf3); fixtures.invalidOffset.writeUInt32LE(0xfffffff0, 60);
fixtures.excessiveSections = Buffer.from(fixtures.bf3); fixtures.excessiveSections.writeUInt16LE(65535, 134);
fixtures.resourceCycle = Buffer.from(fixtures.bf3); fixtures.resourceCycle.writeUInt32LE(0x80000000, 532);
fixtures.oversizedVersion = Buffer.from(fixtures.bf3); fixtures.oversizedVersion.writeUInt32LE(0x7fffffff, 588);
const realPath = 'E:/Juegos/Battlefield 3/bf3.exe';
if (fs.existsSync(realPath)) fixtures.actualBf3 = fs.readFileSync(realPath);
else console.log(`SKIP actual bf3.exe PE fixture: ${realPath} is not installed (synthetic PE assertions still run).`);
// Optional read-only diagnostic for any installation; CI never needs a game,
// Windows version.dll, a shell subprocess, or a machine-specific fixture path.
const inspectionPath = process.env.NGL_DETECTION_PE_EXE;
if (inspectionPath) fixtures.inspected = fs.readFileSync(inspectionPath);

const state = lauxlib.luaL_newstate();
lualib.luaL_openlibs(state);
try {
  for (const [name, bytes] of Object.entries(fixtures)) {
    lua.lua_pushlstring(state, bytes, bytes.length);
    lua.lua_setglobal(state, to_luastring(`fixture_${name}`));
  }
  for (const [name, value] of Object.entries({
    inspected_product: process.env.NGL_DETECTION_PE_PRODUCT,
    inspected_description: process.env.NGL_DETECTION_PE_DESCRIPTION,
  })) {
    if (value !== undefined) {
      lua.lua_pushstring(state, to_luastring(value)); lua.lua_setglobal(state, to_luastring(name));
    }
  }
  const modules = Object.fromEntries(['text', 'pe', 'aliases', 'local', 'catalog'].map(name => [name,
    fs.readFileSync(`backend/lib/shortcut_detection_${name}.lua`, 'utf8')]));
  const source = `local factories={}\n${Object.entries(modules).map(([name, value]) =>
    `factories[${JSON.stringify(name)}]=(function()\n${value}\nend)()`).join('\n')}\n` + String.raw`
local checks, bytes, reads, opened, closed, last_path = 0, 0, 0, 0, 0, nil
local function check(value,message)checks=checks+1;assert(value,message)end
local current, missing, broken = fixture_bf3, false, false
local fs={exists=function()return not missing end,join=function(...)return table.concat({...},'\\')end,
 parent_path=function(p)return p:match('^(.*)\\[^\\]*$')or''end,list=function()return{}end}
local native_open=io.open
os.execute=function()error('PE inspection must never launch a process')end
io.popen=function()error('PE inspection must never launch a shell')end
io.open=function(path,mode)
 if mode~='rb' then return nil end
 last_path=path
 opened=opened+1;local cursor=0
 return {seek=function(_,whence,offset)if whence=='end'then cursor=#current else cursor=offset end;return cursor end,
 read=function(_,length)if broken then error('fixture read failed')end
  check(length<=1024*1024,'no unbounded/full executable read')
  local result=current:sub(cursor+1,cursor+length);cursor=cursor+#result;bytes=bytes+#result;reads=reads+1;return result end,
 close=function()closed=closed+1 end}
end
local text=factories.text({})
local pe=factories.pe({fs=fs,shortcut_detection_text=text})
local function metadata(fixture,product,description)
 current=fixture;bytes=0;reads=0
 local p,d=pe.read_pe_metadata('C:\\Juegos\\fixture.exe')
 check(p==product and d==description,'PE metadata must preserve UTF-16/UTF-8 identities: '..tostring(p)..' / '..tostring(d))
 check(bytes<=2*1024*1024 and reads<100,'PE inspection is bounded')
 check(opened==closed,'every PE read closes its file')
end
metadata(fixture_bf3,'Battlefield 3™','Battlefield 3™')
metadata(fixture_unicode,'Acción Épica 🐉','Descripción del juego')
metadata(fixture_generic,'Unreal Engine','Game Launcher')
metadata(fixture_original,'Unlisted Space Adventure ™','Unlisted Space Adventure ™')
metadata(fixture_remake,'Unlisted Space Adventure ™','Unlisted Space Adventure ™')
check(pe.is_generic_product_name('Unreal Engine')and pe.is_generic_product_name('Game Launcher'),'engine/launcher products remain nonidentity')
check(not pe.is_generic_product_name('Battlefield 3™'),'real product is usable identity')
for _,fixture in ipairs({fixture_truncated,fixture_invalidOffset,fixture_excessiveSections,fixture_resourceCycle,fixture_oversizedVersion})do
 metadata(fixture,nil,nil)
end
broken=true;metadata(fixture_bf3,nil,nil);broken=false
local previous=opened;missing=true;metadata(fixture_bf3,nil,nil);missing=false
check(opened==previous,'absent files do not open')
if fixture_actualBf3 then
 metadata(fixture_actualBf3,'Battlefield 3™','Battlefield 3™')
 print('Actual bf3.exe read-only PE, no FFI/process: '..bytes..' bytes / '..reads..' reads (33 MB file)')
end
if fixture_inspected then
 current=fixture_inspected;bytes=0;reads=0
 local p,d=pe.read_pe_metadata('C:\\Juegos\\Inspected Game\\Selected.exe')
 check((p and p~='')or(d and d~=''),'selected read-only PE inspection finds a title')
 if inspected_product then check(p==inspected_product,'selected PE product matches expected metadata')end
 if inspected_description then check(d==inspected_description,'selected PE description matches expected metadata')end
 check(bytes<=2*1024*1024 and reads<100,'selected executable is inspected with bounded reads')
 check(opened==closed,'selected PE inspection releases its file')
 print('Selected executable read-only PE: '..bytes..' bytes / '..reads..' reads; product='..tostring(p)..'; description='..tostring(d))
end
for _,pair in ipairs({{'Battlefield 3','battlefield',3},{'Battlefield II','battlefield',2},
 {'Battlefield 1','battlefield',1},{'Cyberpunk 2077','cyberpunk 2077'},
 {'Grand Theft Auto III','grand theft auto',3},{'Resident Evil 4 (2005)','resident evil',4},
 {'Final Fantasy XIV','final fantasy',14},{'The Last of Us Part I','the last of us',1}})do
 local identity=text.parse_title_identity(pair[1])
 check(identity.base_title==pair[2],pair[1]..' has discriminative base identity: '..identity.base_title)
 check(identity.sequel==pair[3],pair[1]..' has stable sequel identity')
end
check(text.compare_title_identities('Battlefield 3','Battlefield II').is_collision,'terminal Roman/Arabic sequel collision is detected')
check(text.compare_title_identities('Battlefield 1','Battlefield 3').is_collision,'first installment differs from third')
check(text.compare_title_identities('Battlefield 3','Battlefield III').sequel_match,'same franchise Roman/Arabic sequel corroborates')
check(not text.compare_title_identities('Battlefield 3','Serious Sam 3 BFE').sequel_match,'cross-franchise 3 is not positive identity')
check(not text.compare_title_identities('FIFA 2005','Resident Evil 4 (2005)').year_match,'cross-franchise year is not positive identity')
check(text.compare_title_identities('Resident Evil 4 (2005)','Resident Evil 4').year_mismatch,'original year caution is retained')
for _,pair in ipairs({{'NebulaChronicles2','Nebula Chronicles 2'},
 {'NebulaChroniclesII','Nebula Chronicles II'},{'NebulaChronicles2Remake','Nebula Chronicles 2 Remake'},
 {'NebulaChronicles2023','Nebula Chronicles (2023)'},{'XMLChronicles2','XML Chronicles 2'},
 {'Cyberpunk2077','Cyberpunk 2077'}})do
 local compact,spaced=text.parse_title_identity(pair[1]),text.parse_title_identity(pair[2])
 check(compact.base_title==spaced.base_title and compact.sequel==spaced.sequel and compact.year==spaced.year
  and compact.is_remake==spaced.is_remake,'identifier boundaries preserve the spaced title identity: '..pair[1])
 check(compact.raw==pair[1],'identity inspection preserves the original executable/title value')
end
check(text.parse_title_identity('Cyberpunk2077').sequel==nil and text.parse_title_identity('Cyberpunk2077').year==nil,
 'long non-year numbers remain part of the title and never become an installment')
check(text.compare_title_identities('NebulaChronicles2','Nebula Chronicles 3').is_collision,
 'CamelCase executable cannot corroborate a different Arabic installment')
check(text.compare_title_identities('NebulaChroniclesII','Nebula Chronicles III').is_collision,
 'CamelCase executable cannot corroborate a different Roman installment')
check(text.compare_title_identities('NebulaChronicles2Remake','Nebula Chronicles 2 (2008)').is_collision,
 'concatenated remake qualifier cannot corroborate the dated original')
check(text.compare_title_identities('NebulaChronicles2023','Nebula Chronicles (2008)').is_collision,
 'concatenated release year cannot corroborate a different original release')
local catalog=factories.catalog({shortcut_detection_text=text})
for _,context in ipairs({
 {title='Unlisted Space Adventure',title_hint='Unlisted Space Adventure',exe_stem='Unlisted Space Adventure',
  pe_product='Unlisted Space Adventure ™',pe_desc='Unlisted Space Adventure ™',folders={'Unlisted Space Adventure','Games'}},
 {title='Unlisted Space Adventure',title_hint='Unlisted Space Adventure',exe_stem='UnlistedSpaceAdventure',
  pe_product='Unlisted Space Adventure ®',folders={'Unlisted Space Adventure'}},
})do
 local queries=catalog.discovery_queries(context,{})
 local equivalent=0
 for _,query in ipairs(queries)do
  if text.normalize(query)=='unlisted space adventure'then equivalent=equivalent+1 end
  check(not query:find('™',1,true)and not query:find('®',1,true),'all discovery queries exclude nonsearchable trademarks')
 end
 check(equivalent==1 and queries[1]=='Unlisted Space Adventure',
  'equivalent PE/folder/title hints produce one canonical query, never a trademark-only network miss')
end
local queries=catalog.discovery_queries({title='NebulaChronicles2Remake',exe_stem='NebulaChronicles2Remake'}, {})
check(queries[1]=='Nebula Chronicles 2 Remake','search preserves discriminative installment and remake tokens')
check(catalog.search_query('Acción Épica ™')=='Acción Épica','network cleanup preserves Unicode display words')
check(catalog.search_query('Nebula Chronicles (2008) ™'):find('2008',1,true)~=nil,'network cleanup preserves original year')
-- No maintained BF3 alias and no invented AppID: local phase cannot resolve a
-- catalogue by itself. Strong metadata must remain available to remote lookup.
current=fixture_bf3
local localer=factories['local']({fs=fs,shortcut_detection_text=text,shortcut_detection_pe=pe,shortcut_detection_aliases=factories.aliases({})})
local result=localer.discover_local_candidates({title='bf3',exe_path='E:\\Juegos\\Battlefield 3\\bf3.exe',start_dir='E:\\Juegos\\Battlefield 3',launch_options=''})
check(#result.candidates==0,'unknown local aliases never invent Steam IDs')
check(not result.generic_launcher and result.executable=='bf3.exe','actual selected executable identity is preserved')
for _,fixture in ipairs({fixture_original,fixture_remake})do
 current=fixture
 for _,path in ipairs({'C:\\Games\\Unlisted Space Adventure\\Unlisted Space Adventure.exe',
  '"C:\\Games\\Unlisted Space Adventure\\Unlisted Space Adventure.exe"',
  'C:\\Games\\UnlistedSpaceAdventure\\UnlistedSpaceAdventure.exe'})do
  local selected=text.clean_path(path)
  local record=localer.discover_local_candidates({title='Unlisted Space Adventure',exe_path=path,
   start_dir='"C:\\Games\\Unlisted Space Adventure"',launch_options=''})
  check(last_path==selected,'space/quote handling inspects the exact selected executable without splitting it')
  check(record.executable==text.basename(selected)and not record.generic_launcher,'local metadata retains the selected executable name')
  check(#record.candidates==0 and record.validation_state=='pending'and record.phase=='local',
   'same-name original/remake PE, publisher, version, copyright and folder are discovery hints, never invented AppID proof')
 end
end
check(opened==closed,'local inspection releases every file')
io.open=native_open
print('Local detection evidence: '..checks..' production Lua assertions passed (PE32/PE32+, bounded reads, quoted paths, Unicode queries, original/remake and identifier safety).')
`;
  const result = lauxlib.luaL_dostring(state, to_luastring(source));
  assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? undefined : to_jsstring(lua.lua_tostring(state, -1)));
} finally { lua.lua_close(state); }
