return function(deps)
local http = deps.http
local cjson = deps.cjson
local util = deps.util
local lru = deps.lru_cache
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local M = {}
-- A delisted/retired AppID still has a Steam library entry, but its News Hub
-- often responds with the generic Store shell instead of an events payload.
-- Remember that terminal capability result for this plugin session so Spanish
-- + English fallback requests do not repeat a known-useless fetch or warning.
local partner_events_unavailable = {}
local PARTNER_UNAVAILABLE_CACHE_LIMIT = 64

local function fetch_news_json(appid, lang)
    local url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid="
        .. appid .. "&count=50&maxlength=900&format=json&feeds=steam_community_announcements"
    if lang ~= "" then url = url .. "&l=" .. lang end
    local ok_http, res = pcall(http.get, url, {
        headers = { ["Accept"] = "application/json", ["User-Agent"] = USER_AGENT },
        timeout = 6,
    })
    if not ok_http or not res then return {}, true end
    if res.status ~= 200 or not res.body then
        return {}, tonumber(res.status or 0) >= 500 or tonumber(res.status or 0) == 0
    end
    local ok, body = pcall(cjson.decode, res.body)
    local items = ok and body and body.appnews and body.appnews.newsitems or nil
    if type(items) ~= "table" then return {}, true end
    local filtered = {}
    for _, it in ipairs(items) do
        -- Steam's own announcements are also flagged is_external_url=true.
        -- Identify the publisher by feed and destination instead.
        local host = tostring(it.url or ""):lower():match("^https?://([^/%?#]+)") or ""
        if host == "steamstore-a.akamaihd.net" and tostring(it.url):match("/news/externalpost/steam_community_announcements/%d+") then
            it.url = tostring(it.url):gsub("^https?://[^/]+", "https://store.steampowered.com")
            host = "store.steampowered.com"
        end
        local official_url = host == "steampowered.com" or host:match("^[a-z0-9.-]+%.steampowered%.com$")
            or host == "steamcommunity.com" or host:match("^[a-z0-9.-]+%.steamcommunity%.com$")
        local feedname = tostring(it.feedname or "")
        local is_steam = feedname == "steam_community_announcements"
            or feedname == "steam_store_release_metadata"
            or feedname == ""
        if official_url and is_steam then
            table.insert(filtered, it)
        end
    end
    return filtered, false
end

local function event_to_news_item(ev)
    if type(ev) ~= "table" then return nil end
    local ann = type(ev.announcement_body) == "table" and ev.announcement_body or {}
    local title = tostring(ann.headline or ev.event_name or "")
    if title == "" then return nil end
    local item = {
        gid = tostring(ev.gid or ann.event_gid or ann.gid or ""),
        title = title,
        contents = tostring(ann.body or ev.event_notes or ""),
        date = tonumber(ann.posttime or ev.rtime32_start_time or 0) or 0,
        event_type = tonumber(ev.event_type or 0) or 0,
        image = "",
        feedlabel = "Steam News",
        appid = tonumber(ev.appid or 0) or 0,
    }
    local clanid = tostring(ann.clanid or "")
    if type(ev.jsondata) == "string" and #ev.jsondata > 2 and clanid ~= "" then
        local okj, jd = pcall(cjson.decode, ev.jsondata)
        if okj and type(jd) == "table" then
            local img = nil
            for _, field in ipairs({ "localized_capsule_image", "localized_title_image" }) do
                local arr = jd[field]
                if not img and type(arr) == "table" then
                    for i = 1, 32 do
                        local value = arr[i]
                        if type(value) == "string" and value ~= "" then img = value; break end
                    end
                end
            end
            if img then item.image = "https://clan.akamai.steamstatic.com/images/" .. clanid .. "/" .. img end
        end
    end
    return item
end

-- Use one unfiltered official request for current, removed and legacy titles.
-- The old announcements-first path made an empty/delisted AppID wait for a full
-- timeout and then started a second identical-sized request. The all-feeds API
-- already contains announcements plus Product Release posts (including the
-- historical PES entries), so one call is both faster and more complete.
function M.fetch_news(steam_app_id, language)
    local appid, safe_language = util.normalize_appid_and_language(steam_app_id, language)
    if not appid:match("^%d+$") then
        return cjson.encode({ error = "invalid_appid", appnews = { newsitems = {} } })
    end
    local lang = safe_language:gsub("[^%w_]", "")
    local news, transient_error = fetch_news_json(appid, lang)
    local source = "steam_news_web_api"

    local is_available = #news > 0
    return cjson.encode({
        items = news,
        available = is_available,
        unavailable = not is_available and not transient_error,
        transient_error = transient_error and not is_available,
        source = source,
        historical_enrichment = false,
    })
end

-- ── Partner events (the native news source: cover images, event types,
-- localized to the user's language) ─────────────────────────────────────

local function html_unescape(s)
    return (s:gsub("&quot;", '"'):gsub("&#39;", "'"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&amp;", "&"))
end

-- Scrape the Steam news-hub page for an appid and return a Lua array of native
-- event items (title/contents/date/event_type/cover image). Shared by the
-- Steam-linked path and native Steam news lookup.
local function scrape_partner_events(appid, lang, max)
    appid = tostring(appid)
    lang = tostring(lang or "english")
    max = max or 10

    if partner_events_unavailable[appid] then
        lru.touch(partner_events_unavailable[appid])
        return {}, true, false
    end

    local function mark_unavailable()
        lru.put(partner_events_unavailable, appid, {}, PARTNER_UNAVAILABLE_CACHE_LIMIT)
    end

    -- The old ajaxgetpartnereventspage endpoint is gone; the news hub page
    -- embeds the same event data in its data-initialEvents attribute
    local url = "https://store.steampowered.com/news/app/" .. appid .. "?l=" .. lang
    local ok, res = pcall(http.get, url, {
        headers = { ["Accept"] = "text/html,*/*", ["User-Agent"] = USER_AGENT },
        timeout = 8
    })
    if not ok or not res or res.status ~= 200 or not res.body then
        -- A missing/deleted Store application is an expected no-content case.
        -- Do not turn it into a warning that looks like a plugin failure.
        if res and (res.status == 404 or res.status == 410) then
            mark_unavailable()
            return {}, true, false
        end
        return {}, false, true
    end

    local marker = 'data-initialEvents="'
    local a = res.body:find(marker, 1, true) or res.body:find('data-initialevents="', 1, true)
    if not a then
        return {}, false, true
    end
    local vstart = a + #marker
    local vend = res.body:find('"', vstart, true)
    if not vend then
        return {}, false, true
    end

    local ok2, body = pcall(cjson.decode, html_unescape(res.body:sub(vstart, vend - 1)))
    if not ok2 or type(body) ~= "table" or type(body.events) ~= "table" then
        return {}, false, true
    end

    local items = {}
    for _, ev in ipairs(body.events) do
        local item = event_to_news_item(ev)
        if item then table.insert(items, item) end
        if #items >= max then break end
    end

    return items, false, false
end

function M.fetch_partner_events(steam_app_id, language)
    local appid, safe_language = util.normalize_appid_and_language(steam_app_id, language)
    if not appid:match("^%d+$") then
        return cjson.encode({ items = {}, available = false, error = "invalid_appid" })
    end
    local lang = safe_language:gsub("[^%w_]", "")
    if lang == "" then lang = "english" end
    local items, unavailable, transient_error = scrape_partner_events(appid, lang, 50)
    return cjson.encode({
        items = items,
        available = #items > 0,
        unavailable = unavailable == true,
        transient_error = transient_error == true,
        source = "steam_store_partner_events",
    })
end
return M
end
