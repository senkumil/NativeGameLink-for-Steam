"""Exercise the real Lua news filter with Steam's external-flag convention. Requires lupa."""
from pathlib import Path
from lupa import LuaRuntime
lua=LuaRuntime()
factory=lua.execute((Path(__file__).resolve().parents[1]/'backend/lib/news.lua').read_text(encoding='utf-8'))
lua.globals().factory=factory
lua.execute('''
local payload = { appnews = { newsitems = {
 {gid='1', title='Official', feedname='steam_community_announcements', is_external_url=true, url='https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/6250522009517172772'},
 {gid='2', title='Press', feedname='press', is_external_url=true, url='https://example.com/news'},
 {gid='3', title='Spoof', feedname='steam_community_announcements', url='https://steampowered.com.example.com/news'}
}}}
local news = factory({http={get=function() return {status=200,body='json'} end},
 cjson={decode=function() return payload end,encode=function(v) return v end},
 util={normalize_appid_and_language=function(a,l) return a,l end}})
local result = news.fetch_news('1593500','english')
assert(#result.items==1 and result.items[1].gid=='1')
assert(result.items[1].url=='https://store.steampowered.com/news/externalpost/steam_community_announcements/6250522009517172772')
payload={error='bad response'}
assert(news.fetch_news('1593500','english').transient_error)
''')
print('Lua news: official external-flag announcements retained, other publishers rejected, malformed response retryable')
