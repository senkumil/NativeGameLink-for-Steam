return function(deps)
local logger = deps.logger
local millennium = deps.millennium
local http = deps.http
local cjson = deps.cjson
local fs = deps.fs
local util = deps.util
local config = deps.config
local lru = deps.lru_cache
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local M = {}
local detection_url_encode = util.url_encode
local html_unescape = util.html_unescape
-- Detailed HTML parser output is useful while adapting to a Steam markup
-- change, but it is too noisy for the production backend hot path.
local DEBUG_LOGS = false
local function debug_log(message)
    if DEBUG_LOGS then logger:info(message) end
end
local function parse_hub_cards(html, fallback_type, items, safe_language)
    debug_log("parse_hub_cards: html length=" .. tostring(#html) .. " first200=" .. html:sub(1, 200))

    -- Try multiple delimiter patterns - the Millennium http module may return
    -- the HTML with different quoting or the id may use single quotes
    local DELIM = 'id="apphub_Card_'
    local first = html:find(DELIM, 1, true)
    if not first then
        -- Try single quotes
        DELIM = "id='apphub_Card_"
        first = html:find(DELIM, 1, true)
    end
    if not first then
        -- Try without quotes (some parsers strip them)
        DELIM = 'id=apphub_Card_'
        first = html:find(DELIM, 1, true)
    end
    if not first then
        -- Try to find apphub_Card_ anywhere to see if it exists at all
        local anyPos = html:find('apphub_Card_', 1, true)
        if anyPos then
            debug_log("parse_hub_cards: found apphub_Card_ at pos " .. tostring(anyPos) .. " context: " .. html:sub(math.max(1, anyPos - 30), anyPos + 60))
        else
            debug_log("parse_hub_cards: NO apphub_Card_ found at all in " .. tostring(#html) .. " bytes")
            -- Check for apphub_Card with a space (class name)
            local classPos = html:find('apphub_Card ', 1, true)
            if classPos then
                debug_log("parse_hub_cards: found class 'apphub_Card ' at pos " .. tostring(classPos) .. " context: " .. html:sub(math.max(1, classPos - 50), classPos + 100))
            end
        end
        return
    end
    debug_log("parse_hub_cards: using delimiter '" .. DELIM .. "' first match at pos " .. tostring(first))

    local search_pos = first
    local seen_items = {}
    while #items < 120 do
        local card_start = html:find(DELIM, search_pos, true)
        if not card_start then break end

        local next_card = html:find(DELIM, card_start + 20, true)
        local card_end = next_card and (next_card - 1) or #html
        local card = html:sub(card_start, card_end)

        local item = {}

        -- Detect type from apphub_CardContentType div or specific classes / video indicators
        local is_real_video = card:find("apphub_CardContentPlayVideo")
            or card:find("video_play_icon")
            or card:find("data%-youtube%-id")
            or card:find("apphub_CardContentVideoImage")
            or card:find("img%.youtube%.com")
            or card:find("i%.ytimg%.com")
            or card:find("youtube%.com/watch")
            or card:find("youtu%.be")

        local content_type = card:match('apphub_CardContentType[^"]*"[^>]*>%s*([%w%s]+)')
        if not content_type then
            content_type = card:match('appHubCardContentType[^"]*"[^>]*>%s*([%w%s]+)')
        end

        -- Extract youtube_id if present
        local yt = card:match('data%-youtube%-id="([^"]+)"')
            or card:match('youtubeid="([^"]+)"')
            or card:match('img%.youtube%.com/vi/([^/"%s]+)')
            or card:match('ytimg%.com/vi/([^/"%s]+)')
            or card:match('youtube%.com/watch%?[^"\'%s]*v=([%w_%-]+)')
            or card:match('youtu%.be/([%w_%-]+)')
            or card:match('youtube%.com/embed/([^/"\'%s%?]+)')

        if yt and yt ~= "" then
            item.youtube_id = yt
            item.type = "video"
            item.label = "Video"
        elseif is_real_video then
            item.type = "video"
            item.label = "Video"
        elseif content_type then
            local ct = content_type:lower()
            if ct:find("guide") or ct:find("guía") or ct:find("guia") then
                item.type = "guide"
                item.label = "Guide"
            elseif ct:find("video") or ct:find("vídeo") then
                item.type = "video"
                item.label = "Video"
            elseif ct:find("artwork") or ct:find("arte") or ct:find("gráfico") or ct:find("grafico") or ct:find("material") then
                item.type = "artwork"
                item.label = "Artwork"
            elseif ct:find("screenshot") or ct:find("captura") then
                item.type = "screenshot"
                item.label = "Screenshot"
            else
                item.type = fallback_type == "guide" and "guide" or "screenshot"
            end
        elseif fallback_type == "guide" and (card:find("apphub_CardContentGuide") or card:find("GuideImage")) then
            item.type = "guide"
            item.label = "Guide"
        else
            item.type = (fallback_type == "artwork") and "artwork" or "screenshot"
        end

        -- Main preview image (screenshots/artwork/videos)
        item.image = card:match('apphub_CardContentPreviewImage" src="([^"]+)"')
        if not item.image and item.youtube_id then
            item.image = "https://img.youtube.com/vi/" .. item.youtube_id .. "/hqdefault.jpg"
        end
        -- Guide image
        if not item.image then
            item.image = card:match('apphub_CardContentGuideImage" src="([^"]+)"')
        end
        -- Video preview image
        if not item.image then
            item.image = card:match('apphub_CardContentVideoImage" src="([^"]+)"')
        end
        -- Generic fallback
        if not item.image then
            item.image = card:match('<img[^>]+src="(https://images%.steamusercontent%.com/[^"]+)"')
        end
        if not item.image then
            item.image = card:match('<img[^>]+src="(https://img%.youtube%.com/[^"]+)"')
        end
        if not item.image then
            item.image = card:match('<img[^>]+src="(https://i%.ytimg%.com/[^"]+)"')
        end

        -- Fallback extraction of youtube_id from resolved image
        if not item.youtube_id and item.image then
            item.youtube_id = item.image:match('img%.youtube%.com/vi/([^/"%s]+)')
                or item.image:match('ytimg%.com/vi/([^/"%s]+)')
        end
        if item.youtube_id and item.youtube_id ~= "" then
            item.type = "video"
            item.label = "Video"
            if not item.image then
                item.image = "https://img.youtube.com/vi/" .. item.youtube_id .. "/hqdefault.jpg"
            end
        end

        -- Title: screenshots use apphub_CardContentTitle, guides use apphub_CardContentGuideTitle
        local raw_title = card:match('apphub_CardContentTitle[^"]*"[^>]*>%s*(.-)%s*</')
        if not raw_title then
            -- Guide title: text after the <img> inside apphub_CardContentGuideTitle
            raw_title = card:match('apphub_CardContentGuideTitle[^>]*>.-</img>%s*(.-)%s*</div')
            if not raw_title then
                -- Guide title: text content (may contain img tag, strip it)
                local gtblock = card:match('apphub_CardContentGuideTitle[^>]*>(.-)</div')
                if gtblock then
                    raw_title = gtblock:gsub('<[^>]+>', ''):match('^%s*(.-)%s*$')
                end
            end
        end
        if raw_title and raw_title ~= "" then
            item.title = raw_title:gsub("&amp;", "&"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&#39;", "'"):gsub("&quot;", '"'):gsub("&nbsp;", " "):gsub("%s+$", "")
        end

        -- Description (guides only)
        local raw_desc = card:match('apphub_CardContentGuideDesc[^>]*>(.-)</div')
        if raw_desc then
            item.description = raw_desc:gsub("<[^>]+>", ""):gsub("&amp;", "&"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&#39;", "'"):gsub("&quot;", '"'):gsub("&nbsp;", " "):match("^%s*(.-)%s*$")
        end

        -- Author avatar (inside appHubIconHolder div)
        item.author_avatar = card:match('appHubIconHolder[^>]*><img src="([^"]+)"')

        -- Author name
        item.author_name = card:match('apphub_CardContentAuthorName.-<a[^>]*>([^<]*)</a>')
        if item.author_name then
            item.author_name = item.author_name:gsub("&amp;", "&"):gsub("&#39;", "'"):gsub("%s+$", "")
        end

        -- Link from data-modal-content-url or publishedfileid
        item.link = card:match('data%-modal%-content%-url="([^"]*)"')
            or card:match('href="([^"]*sharedfiles/filedetails[^"]*)"')
        if not item.link then
            local window_start = (card_start > 3000) and (card_start - 3000) or 1
            local window = html:sub(window_start, card_start)
            for m in window:gmatch('data%-modal%-content%-url="([^"]*)"') do
                item.link = m
            end
        end
        if not item.link then
            local file_id = card:match('data%-publishedfileid="([^"]*)"') or card:match('id="apphub_Card_(%d+)"')
            if file_id and file_id ~= "" then
                item.link = "https://steamcommunity.com/sharedfiles/filedetails/?id=" .. file_id
            end
        end
        if item.link then
            item.link = item.link:gsub("&amp;", "&")
        end

        local is_cyrillic_user = (safe_language == "russian" or safe_language == "ukrainian" or safe_language == "bulgarian")
        local is_cjk_user = (safe_language == "schinese" or safe_language == "tchinese" or safe_language == "japanese" or safe_language == "koreana")
        local title_has_cyrillic = raw_title and (raw_title:find("[\208\209][\128-\191]") ~= nil)
        local desc_has_cyrillic = raw_desc and (raw_desc:find("[\208\209][\128-\191]") ~= nil)
        local title_has_cjk = raw_title and (raw_title:find("[\228-\233][\128-\191][\128-\191]") ~= nil)
        local skip_script = (not is_cyrillic_user and (title_has_cyrillic or desc_has_cyrillic)) or (not is_cjk_user and title_has_cjk)

        local dedup_key = item.link or item.image
        if not skip_script and item.image and item.image ~= "" and dedup_key and not seen_items[dedup_key] then
            seen_items[dedup_key] = true
            table.insert(items, item)
            if #items <= 3 then
                debug_log("Parsed item #" .. tostring(#items) .. ": type=" .. tostring(item.type)
                    .. " title=" .. tostring(item.title or ""):sub(1, 40)
                    .. " author=" .. tostring(item.author_name or "")
                    .. " link=..." .. tostring(item.link or ""):sub(-24))
            end
        end

        search_pos = card_start + 20
    end
end

function M.fetch_community_content(steam_app_id, language)
    local appid, safe_language = util.normalize_appid_and_language(steam_app_id, language)
    if not appid:match("^%d+$") then
        return cjson.encode({ items = {}, available = false, error = "invalid_appid" })
    end
    local items = {}
	local successful_pages = 0

    local function fetch_feed(lang, filter_lang, pages)
        local headers = {
            ["Accept"] = "text/html,*/*",
            ["User-Agent"] = USER_AGENT,
            ["Cookie"] = "Steam_Language=" .. lang .. "; steamLanguage=" .. lang .. "; timezoneOffset=-18000,0;",
            ["Accept-Language"] = lang,
        }
        for page = 1, pages do
            local url = "https://steamcommunity.com/app/" .. appid
                .. "/homecontent/?l=" .. detection_url_encode(lang)
                .. (filter_lang and ("&filterLanguage=" .. detection_url_encode(filter_lang)) or "")
                .. "&browsefilter=trend&numperpage=30&p=" .. page
                .. "&appid=" .. appid .. "&forceanon=1"
            local ok, response = pcall(http.get, url, {
                headers = headers,
                timeout = 10
            })
            if ok and response and response.status == 200 and response.body then
                successful_pages = successful_pages + 1
                parse_hub_cards(response.body, nil, items, safe_language)
                logger:info("Trending homecontent (" .. lang .. ") page " .. page .. " parsed; total: " .. tostring(#items))
            else
                logger:info("Trending homecontent (" .. lang .. ") page " .. page .. " fetch failed or empty")
            end
            if #items >= 50 then break end
        end
    end

    local function fetch_sub(lang, filter_lang, subsection, fallback_type, label)
        local headers = {
            ["Accept"] = "text/html,*/*",
            ["User-Agent"] = USER_AGENT,
            ["Cookie"] = "Steam_Language=" .. lang .. "; steamLanguage=" .. lang .. "; timezoneOffset=-18000,0;",
            ["Accept-Language"] = lang,
        }
        local url = "https://steamcommunity.com/app/" .. appid
            .. "/homecontent/?l=" .. detection_url_encode(lang)
            .. (filter_lang and ("&requiredtags[0]=" .. detection_url_encode(filter_lang)) or "")
            .. "&browsefilter=trend&numperpage=20&p=1"
            .. "&appid=" .. appid .. "&appHubSubSection=" .. subsection .. "&forceanon=1"
        local ok, response = pcall(http.get, url, {
            headers = headers,
            timeout = 10
        })
        if ok and response and response.status == 200 and response.body then
            successful_pages = successful_pages + 1
            parse_hub_cards(response.body, fallback_type, items, safe_language)
            logger:info(label .. " (" .. lang .. ") parsed; total: " .. tostring(#items))
        end
    end

    local function get_language_family(lang)
        lang = tostring(lang or "english"):lower()
        if lang == "spanish" or lang == "latam" then
            return { "spanish", "latam" }
        elseif lang == "portuguese" or lang == "brazilian" then
            return { "brazilian", "portuguese" }
        elseif lang == "schinese" or lang == "tchinese" then
            return { "schinese", "tchinese" }
        end
        return { lang }
    end

    local lang_family = get_language_family(safe_language)
    local is_english = lang_family[1] == "english"

    -- 1. Priority: Client language family (unifies Spanish variants, etc.)
    if not is_english then
        for _, lang in ipairs(lang_family) do
            fetch_feed(lang, lang, 2)
            fetch_sub(lang, lang, 9, "guide", "Guides")
            fetch_sub(lang, lang, 3, "video", "Videos")
            fetch_sub(lang, lang, 4, "artwork", "Artwork")
            if #items >= 50 then break end
        end
    end

    -- 2. Fallback: If client language has few items or is English, fetch English/global trending content
    if #items < 24 then
        fetch_feed("english", nil, 2)
        fetch_sub("english", nil, 3, "video", "Videos")
        fetch_sub("english", nil, 9, "guide", "Guides")
        fetch_sub("english", nil, 4, "artwork", "Artwork")
    end

    logger:info("Total community content items: " .. tostring(#items))
    return cjson.encode({
        items = items,
        available = #items > 0,
		transient_error = successful_pages == 0,
        source = "steam_community_app_hub",
    })
end

-- ── Official Steam community items (trading cards + badges) ───────────
-- Steam's public Store API does not expose trading-card or badge artwork.
-- The assets themselves are public Steam CDN resources, while the catalogue
-- page below provides the AppID -> CDN URL index.  Results are cached for the
-- lifetime of the backend so navigating between games does not repeat work.
local community_items_catalog_cache = {}
local COMMUNITY_ITEMS_CACHE_LIMIT = 32
local COMMUNITY_ITEMS_SUCCESS_CACHE_SECONDS = 60 * 60
local COMMUNITY_ITEMS_FAILURE_CACHE_SECONDS = 10

local function community_items_clean(value)
    local text = html_unescape(tostring(value or ""))
    text = text:gsub("<.->", " ")
    text = text:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    return text
end

local function community_items_is_steam_asset(url)
    local value = tostring(url or ""):lower()
    return value:match("^https://") ~= nil and (
        value:find("steamstatic.com/", 1, true) ~= nil
        or value:find("steamcdn%-a%.akamaihd%.net/") ~= nil
        or value:find("steamcommunity%-a%.akamaihd%.net/") ~= nil
    )
end

local function community_items_parse_catalog(html, appid)
    local cards, badges = {}, {}
    local seen_cards, seen_badges = {}, {}

    -- Only parse the normal set. The page repeats the same titles again for
    -- foil cards, which would otherwise make the library section look doubled.
    local normal_start = html:find('id="normal-cards-grid"', 1, true)
    if normal_start then
        local normal_end = html:find('id="foil-cards-grid"', normal_start, true) or (#html + 1)
        local normal_html = html:sub(normal_start, normal_end - 1)
        for title, image in normal_html:gmatch(
            'class="set%-card%-item"[^>]-title="([^"]+)"[^>]*>.-<img[^>]-src="([^"]+)"') do
            title = community_items_clean(title)
            image = html_unescape(image)
            local key = title:lower()
            if title ~= "" and community_items_is_steam_asset(image) and not seen_cards[key] then
                seen_cards[key] = true
                table.insert(cards, {
                    title = title,
                    image = image,
                    artwork = "",
                })
            end
        end
    end

    -- Badge images are the exact transparent 80x80 assets uploaded through
    -- Steamworks. Keep all six definitions and expose the foil badge directly.
    for class_name, image, alt in html:gmatch(
        '<div class="badge%-item([^"]*)"[^>]*>%s*<img[^>]-src="([^"]+)"[^>]-alt="([^"]+)"') do
        image = html_unescape(image)
        alt = community_items_clean(alt)
        if community_items_is_steam_asset(image) and not seen_badges[image] then
            seen_badges[image] = true
            local foil = class_name:lower():find("foil", 1, true) ~= nil
                or alt:lower():find("badge foil", 1, true) ~= nil
            local title = alt:match("[Ff]oil:%s*(.+)$")
                or alt:match("[Ll]evel%s+%d+:%s*(.+)$")
                or alt
            table.insert(badges, {
                title = community_items_clean(title),
                image = image,
                foil = foil,
                level = tonumber(alt:match("[Ll]evel%s+(%d+)")) or 0,
            })
        end
    end

    local foil_badge = nil
    for _, badge in ipairs(badges) do
        if badge.foil then
            foil_badge = badge
            break
        end
    end

    return {
        appid = tonumber(appid) or 0,
        cards = cards,
        badges = badges,
        foil_badge = foil_badge,
        source = "steam-community-assets",
    }
end

-- Steam's official Community Market exposes each released trading card as an
-- economy asset.  The icon_url value is the original composed card image; it
-- must not be suffixed with /100x100 because Steam only does that in low
-- bandwidth mode and the image becomes visibly pixelated when the card lifts.
local function community_items_parse_market_catalog(body, appid)
    local cards, seen_cards = {}, {}
    local ok, payload = pcall(cjson.decode, tostring(body or ""))
    if not ok or type(payload) ~= "table" or type(payload.results) ~= "table" then
        return cards
    end

    for _, result in ipairs(payload.results) do
        local description = type(result) == "table" and result.asset_description or nil
        if type(description) == "table" then
            local item_type = tostring(description.type or ""):lower()
            local market_hash = tostring(description.market_hash_name or result.hash_name or "")
            local title = community_items_clean(description.name or result.name or "")
            local icon = tostring(description.icon_url_large or description.icon_url or "")
            local is_card = item_type:find("card", 1, true) ~= nil
                or item_type:find("cromo", 1, true) ~= nil
                or item_type:find("karte", 1, true) ~= nil
                or item_type:find("carte", 1, true) ~= nil
                or item_type:find("cart", 1, true) ~= nil
                or item_type:find("коллекцион", 1, true) ~= nil
                or item_type ~= ""
            local is_foil = item_type:find("foil", 1, true) ~= nil
                or market_hash:lower():find("(foil)", 1, true) ~= nil
            if is_card and not is_foil and title ~= "" and icon ~= "" then
                local image = icon
                if not image:match("^https://") then
                    image = "https://community.cloudflare.steamstatic.com/economy/image/" .. image
                end
                local key = market_hash ~= "" and market_hash:lower() or title:lower()
                if community_items_is_steam_asset(image) and not seen_cards[key] then
                    seen_cards[key] = true
                    table.insert(cards, {
                        title = title,
                        image = image,
                        artwork = "",
                    })
                end
            end
        end
    end

    return cards
end

function M.fetch_community_items_catalog(steam_app_id, language)
    local appid, safe_language = util.normalize_appid_and_language(steam_app_id, language)
    if not appid:match("^%d+$") then
        return cjson.encode({ error = "invalid_appid", cards = {}, badges = {} })
    end

    local cache_key = appid .. "|" .. safe_language
    if community_items_catalog_cache[cache_key] then
		local cached = community_items_catalog_cache[cache_key]
		local ttl = cached.complete and COMMUNITY_ITEMS_SUCCESS_CACHE_SECONDS or COMMUNITY_ITEMS_FAILURE_CACHE_SECONDS
		if os.time() - tonumber(cached.time or 0) < ttl then
			lru.touch(cached)
			return cached.value
		end
		community_items_catalog_cache[cache_key] = nil
    end

    local market_url = "https://steamcommunity.com/market/search/render/"
        .. "?query=&start=0&count=100&search_descriptions=0"
        .. "&sort_column=name&sort_dir=asc&appid=753&l=" .. detection_url_encode(safe_language)
        .. "&category_753_Game%5B%5D=tag_app_" .. appid .. "&norender=1"
        .. "&category_753_item_class%5B%5D=tag_item_class_2"
        .. "&category_753_cardborder%5B%5D=tag_cardborder_0"
    local market_ok, market_response = pcall(http.get, market_url, {
        headers = {
            ["Accept"] = "application/json,text/plain,*/*",
            ["Accept-Language"] = "en-US,en;q=0.8",
            ["User-Agent"] = USER_AGENT,
        },
        timeout = 4,
    })

    local result = { appid = tonumber(appid) or 0, cards = {}, badges = {}, source = "unavailable" }
    local market_complete = market_ok and market_response and market_response.status == 200
        and type(market_response.body) == "string"
    if market_complete then
        result.cards = community_items_parse_market_catalog(market_response.body, appid)
        if #result.cards > 0 then
            result.source = "steam-community-market"
        end
    else
        logger:info("Official Steam card catalogue unavailable for " .. appid
            .. " (HTTP " .. tostring(market_response and market_response.status or "request_failed") .. ")")
    end

    -- Badge artwork is not tradable and therefore is absent from the Market
    -- response. Keep the existing public catalogue only as a badge index.
    -- Cards must always be confirmed by Steam's own Market response: using a
    -- third-party card fallback can create a section for games that never
    -- released Steam Trading Cards.
    local url = "https://steamlvlup.com/gameinfo/" .. appid
    local ok, response = pcall(http.get, url, {
        headers = {
            ["Accept"] = "text/html,*/*",
            ["Accept-Language"] = "en-US,en;q=0.8",
            ["User-Agent"] = USER_AGENT,
        },
        timeout = 4,
    })

    local badge_complete = ok and response and response.status == 200 and type(response.body) == "string"
    local badge_confirmed_empty = ok and response
        and (tonumber(response.status) == 404 or tonumber(response.status) == 410)
    if badge_complete then
        local indexed = community_items_parse_catalog(response.body, appid)
        result.badges = indexed.badges
        result.foil_badge = indexed.foil_badge
        logger:info("Community items for " .. appid .. ": "
            .. tostring(#result.cards) .. " cards, " .. tostring(#result.badges) .. " badges")
    else
        logger:info("Community item catalogue unavailable for " .. appid
            .. " (HTTP " .. tostring(response and response.status or "request_failed") .. ")")
    end

    result.transient_error = not market_complete or not (badge_complete or badge_confirmed_empty)

    local encoded = cjson.encode(result)
	local complete = result.transient_error ~= true
	lru.put(community_items_catalog_cache, cache_key, {
		value = encoded, time = os.time(), complete = complete,
	}, COMMUNITY_ITEMS_CACHE_LIMIT)
    return encoded
end

return M
end
