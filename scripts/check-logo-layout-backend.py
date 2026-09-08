from pathlib import Path
from lupa import LuaRuntime
lua=LuaRuntime()
lua.globals().factory=lua.execute(Path('backend/lib/artwork.lua').read_text(encoding='utf-8'))
lua.execute('''
local reads = {}
local d = {
 logger={}, millennium={steam_path=function() return 'Steam' end},
 util={get_active_account_id=function() return '123' end},
 fs={join=function(...) return table.concat({...}, '/') end, exists=function(path) return path:match('3000000001_logo.png$') or path:match('3000000001_hero.jpg$') end},
 cjson={encode=function(x)return x end,decode=function(x)return x end},
 artwork_icon={}, artwork_image_io={read_local=function(req) table.insert(reads,req.path);return {ok=true,mime='image/png',data_base64='fixture'} end}
}
local module = factory(d)
assert(module.read_logo_layout_images({shortcut_app_id='100'}).ok==false)
assert(module.read_logo_layout_images({shortcut_app_id='../3000000001'}).ok==false)
assert(#reads==0)
local result=module.read_logo_layout_images({shortcut_app_id='3000000001'})
assert(result.ok and result.logo and result.hero and #reads==2)
assert(reads[1]=='Steam/userdata/123/config/grid/3000000001_logo.png')
assert(reads[2]=='Steam/userdata/123/config/grid/3000000001_hero.jpg')
d.util.get_active_account_id=function()return nil end
assert(module.read_logo_layout_images({shortcut_app_id='3000000001'}).ok==false)
''')
print('Logo image backend passed: active account, installed logo/hero, native-ID and path rejection, missing account.')
