return function(deps)
local http = deps.http
local cjson = deps.cjson
local logger = deps.logger
local lru = deps.lru_cache
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local M = {}

local CURATED = {
    ["221430"] = {
        title = "Pro Evolution Soccer 2013",
        portrait_rank = 2, portrait_id = 152317, hero_id = 38076, logo_id = 119351, wide_rank = 1,
    },
    ["237110"] = {
        title = "Mortal Kombat Komplete Edition",
        portrait_id = 46421, hero_id = 12459, logo_id = 9592, wide_id = 177942,
    },
}
local retired_cache = {}
local RETIRED_PROFILE_CACHE_SECONDS = 30 * 60
local RETIRED_PROFILE_CACHE_LIMIT = 96

local function trusted_image_url(value)
    local url = tostring(value or "")
    local host = url:match("^https://([^/%?#]+)")
    if not host then return "" end
    host = host:lower():gsub(":%d+$", "")
    if host == "steamgriddb.com" or host:match("^[a-z0-9-]+%.steamgriddb%.com$") then return url end
    return ""
end

local function request(path, api_key)
    local ok, response = pcall(http.get, "https://www.steamgriddb.com/api/v2/" .. path, {
        headers = {
            ["Accept"] = "application/json",
            ["Authorization"] = "Bearer " .. api_key,
            ["User-Agent"] = USER_AGENT,
        },
        timeout = 6,
    })
    if not ok or not response or response.status ~= 200 or not response.body then return nil end
    local parsed, body = pcall(cjson.decode, response.body)
    return parsed and type(body) == "table" and body or nil
end

local function safe(item)
    if type(item) ~= "table" or item.animated == true or item.nsfw == true
        or item.humor == true or item.epilepsy == true then return false end
    if tostring(item.type or ""):lower() == "animated" then return false end
    local fields = { item.style, item.tags, item.name }
    for _, value in ipairs(fields) do
        local text
        if type(value) == "table" then
            local parts = {}
            for _, tag in pairs(value) do
                local tag_val = type(tag) == "table" and (tag.name or tag.tag or tag.slug or "") or tag
                parts[#parts + 1] = tostring(tag_val or "")
            end
            text = table.concat(parts, " ")
        else
            text = tostring(value or "")
        end
        text = text:lower()
        if text:find("nsfw", 1, true) or text:find("meme", 1, true)
            or text:find("humor", 1, true) or text:find("joke", 1, true)
            or text:find("epilepsy", 1, true)
            or text:find("nintendo switch", 1, true) or text:find("switch banner", 1, true)
            or text:find("switch grid", 1, true) or text:find("switch cover", 1, true)
            or text:find("playstation banner", 1, true) or text:find("ps5 banner", 1, true)
            or text:find("ps4 banner", 1, true) or text:find("xbox banner", 1, true)
            or text:find("console banner", 1, true) then
            return false
        end
    end
    return true
end

local QUALITY = {
    portrait = { min_width = 300, min_height = 400, min_ratio = 0.50, max_ratio = 0.85 },
    hero = { min_width = 1280, min_height = 400, min_ratio = 2.35, max_ratio = 3.65 },
    wide = { min_width = 800, min_height = 350, min_ratio = 1.8, max_ratio = 2.65 },
    icon = { min_width = 32, min_height = 32 },
}

local function candidates(body, slot)
    local items = type(body) == "table" and body.data or nil
    if type(items) ~= "table" then return {} end
    if items.url then items = { items } end
    local result = {}
    for _, item in ipairs(items) do
        if #result >= 10 then break end
        local url = type(item) == "table" and trusted_image_url(item.url) or ""
        local width = tonumber(item.width)
        local height = tonumber(item.height)
        local ratio = width and height and height > 0 and (width / height) or nil
        local orientation_ok = slot ~= "portrait" or not width or not height or height > width
        local spec = QUALITY[slot]
        local quality_ok = not spec or (width and height
            and (not spec.min_width or width >= spec.min_width)
            and (not spec.min_height or height >= spec.min_height)
            and (not spec.min_ratio or (ratio and ratio >= spec.min_ratio))
            and (not spec.max_ratio or (ratio and ratio <= spec.max_ratio)))
        if url ~= "" and safe(item) and orientation_ok and quality_ok then
            local thumb = trusted_image_url(item.thumb or item.thumbnail)
            table.insert(result, {
                id = item.id, url = url, thumb = thumb ~= "" and thumb or url,
                width = width, height = height, language = item.language,
                style = item.style, transparent = item.transparent == true,
            })
        end
    end
    return result
end

local function retired_profile(appid)
    if CURATED[appid] then return CURATED[appid] end
    local now = os.time()
    local cached = retired_cache[appid]
    if cached and now - cached.time < RETIRED_PROFILE_CACHE_SECONDS then
        lru.touch(cached)
        return cached.profile or nil
    end
    local ok, response = pcall(http.get,
        "https://store.steampowered.com/api/appdetails?appids=" .. appid .. "&l=english", {
            headers = { ["Accept"] = "application/json", ["User-Agent"] = USER_AGENT }, timeout = 6,
        })
    if not ok or not response or response.status ~= 200 or not response.body then return nil end
    local parsed, payload = pcall(cjson.decode, response.body)
    local app_data = parsed and type(payload) == "table" and payload[appid] or nil
    local data = type(app_data) == "table" and app_data.data or nil
    local no_packages = type(data) == "table"
        and (type(data.packages) ~= "table" or #data.packages == 0)
        and (type(data.package_groups) ~= "table" or #data.package_groups == 0)
    local is_coming_soon = type(data) == "table" and type(data.release_date) == "table" and data.release_date.coming_soon == true
    local unavailable = type(app_data) == "table" and (app_data.success == false
        or (type(data) == "table" and data.is_free ~= true and data.price_overview == nil and no_packages and not is_coming_soon))
    if type(app_data) ~= "table" then return nil end
    local profile = unavailable and { title = type(data) == "table" and tostring(data.name or "") or "Steam AppID " .. appid } or false
    lru.put(retired_cache, appid, { time = now, profile = profile }, RETIRED_PROFILE_CACHE_LIMIT)
    return profile or nil
end

local function default_id(list, wanted_id, wanted_rank)
    if wanted_id then
        for _, item in ipairs(list) do if tonumber(item.id) == tonumber(wanted_id) then return item.id end end
    end
    local rank = math.max(1, tonumber(wanted_rank) or 1)
    return list[rank] and list[rank].id or (list[1] and list[1].id or nil)
end

local function find_candidate_by_id(list, target_id)
    if type(list) ~= "table" or not target_id then return nil end
    for _, item in ipairs(list) do
        if tonumber(item.id) == tonumber(target_id) then return item end
    end
    return list[1]
end

local function extract_api_keys(input)
    local api_keys, seen = {}, {}
    local function add(v)
        local k = tostring(v or ""):match("^%s*(.-)%s*$") or ""
        if #k >= 16 and #k <= 160 and not seen[k] then
            seen[k] = true
            api_keys[#api_keys + 1] = k
        end
    end
    if type(input) == "table" then
        add(input.api_key)
        if type(input.api_keys) == "table" then
            for _, k in ipairs(input.api_keys) do add(k) end
        end
    end
    return api_keys
end

local function resolve_steamgriddb_assets(appid, api_keys, profile, include_icon)
    local api_key, game_id = nil, nil
    for _, candidate_key in ipairs(api_keys) do
        local game = request("games/steam/" .. appid, candidate_key)
        game_id = type(game) == "table" and type(game.data) == "table" and tonumber(game.data.id) or nil
        if game_id then api_key = candidate_key; break end
    end
    if not game_id then
        return nil, "game_not_found"
    end
    local id = tostring(game_id)
    local portrait = candidates(request("grids/game/" .. id .. "?dimensions=600x900,342x482,660x930", api_key), "portrait")
    if #portrait == 0 then portrait = candidates(request("grids/game/" .. id, api_key), "portrait") end
    local hero = candidates(request("heroes/game/" .. id, api_key), "hero")
    local logo = candidates(request("logos/game/" .. id, api_key), "logo")
    local wide = candidates(request("grids/game/" .. id .. "?dimensions=920x430", api_key), "wide")
    local icons = include_icon and candidates(request("icons/game/" .. id, api_key), "icon") or {}

    local defaults = {
        portrait = default_id(portrait, profile and profile.portrait_id, profile and profile.portrait_rank),
        hero = default_id(hero, profile and profile.hero_id, profile and profile.hero_rank),
        logo = default_id(logo, profile and profile.logo_id, profile and profile.logo_rank),
        wide = default_id(wide, profile and profile.wide_id, profile and profile.wide_rank),
        icon = default_id(icons, profile and profile.icon_id, profile and profile.icon_rank),
    }
    return {
        game_id = game_id,
        defaults = defaults,
        slots = { portrait = portrait, hero = hero, logo = logo, wide = wide, icon = icons },
    }, nil
end

function M.fetch(request_json)
    local ok_fetch, res = pcall(function()
        local parsed, input = pcall(cjson.decode, tostring(request_json or ""))
        if not parsed or type(input) ~= "table" then return cjson.encode({ error = "invalid_request" }) end
        local appid = tostring(input.steam_app_id or input.appid or "")
        if not appid:match("^%d+$") then return cjson.encode({ error = "invalid_appid" }) end
        local profile = input.include_all == true
            and (CURATED[appid] or { title = "Steam AppID " .. appid })
            or retired_profile(appid)
        if not profile then return cjson.encode({ eligible = false }) end
        if input.eligibility_only == true then return cjson.encode({ eligible = true, title = profile.title }) end
        local api_keys = extract_api_keys(input)
        if #api_keys == 0 then
            return cjson.encode({ eligible = true, title = profile.title, error = "api_key_missing" })
        end
        local resolution, err = resolve_steamgriddb_assets(appid, api_keys, profile, true)
        if not resolution then
            return cjson.encode({ eligible = true, title = profile.title, error = err or "game_not_found" })
        end
        return cjson.encode({
            eligible = true,
            title = profile.title,
            source = "steamgriddb",
            defaults = resolution.defaults,
            slots = resolution.slots,
        })
    end)
    if not ok_fetch then
        return cjson.encode({ eligible = false, error = "fetch_failed" })
    end
    return res
end

function M.fetch_community_artwork(request_json)
    local ok_fetch, res = pcall(function()
        local parsed, input = pcall(cjson.decode, tostring(request_json or ""))
        if not parsed or type(input) ~= "table" then return cjson.encode({ error = "invalid_request" }) end
        local appid = tostring(input.steam_app_id or input.appid or "")
        if not appid:match("^%d+$") then return cjson.encode({ error = "invalid_appid" }) end
        local profile = CURATED[appid] or { title = "Steam AppID " .. appid }
        local api_keys = extract_api_keys(input)
        if #api_keys == 0 then
            return cjson.encode({ error = "api_key_missing" })
        end
        -- Automatic library artwork has a separate official shortcut-icon path.
        -- Do not make every link wait for a fifth SteamGridDB asset request that
        -- cannot affect portrait/hero/logo/wide completion.
        local resolution, err = resolve_steamgriddb_assets(appid, api_keys, profile, false)
        if not resolution then
            return cjson.encode({ found = false, source = "steamgriddb", error = err or "game_not_found" })
        end

        local p_item = find_candidate_by_id(resolution.slots.portrait, resolution.defaults.portrait)
        local h_item = find_candidate_by_id(resolution.slots.hero, resolution.defaults.hero)
        local l_item = find_candidate_by_id(resolution.slots.logo, resolution.defaults.logo)
        local w_item = find_candidate_by_id(resolution.slots.wide, resolution.defaults.wide)
        local i_item = find_candidate_by_id(resolution.slots.icon, resolution.defaults.icon)

        local found = (p_item ~= nil or h_item ~= nil or l_item ~= nil or w_item ~= nil or i_item ~= nil)
        if logger and logger.info then
            logger:info(string.format("[NGL][SteamGridDB] Resolved appid=%s found=%s (p=%s h=%s l=%s w=%s i=%s)",
                appid, tostring(found),
                p_item and tostring(p_item.id) or "none",
                h_item and tostring(h_item.id) or "none",
                l_item and tostring(l_item.id) or "none",
                w_item and tostring(w_item.id) or "none",
                i_item and tostring(i_item.id) or "none"))
        end

        return cjson.encode({
            found = found,
            source = "steamgriddb",
            curated = CURATED[appid] ~= nil,
            portrait = p_item and p_item.url or "",
            hero = h_item and h_item.url or "",
            logo = l_item and l_item.url or "",
            wide = w_item and w_item.url or "",
            icon = i_item and i_item.url or "",
            defaults = resolution.defaults,
            slots = resolution.slots,
            provenance = {
                portrait = p_item,
                hero = h_item,
                logo = l_item,
                wide = w_item,
                icon = i_item,
            },
        })
    end)
    if not ok_fetch then
        return cjson.encode({ found = false, error = "fetch_failed" })
    end
    return res
end

return M
end
