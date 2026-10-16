return function(deps)
local logger = deps.logger
local millennium = deps.millennium
local http = deps.http
local cjson = deps.cjson
local fs = deps.fs
local util = deps.util
local settings = deps.achievement_settings
local policy = deps.achievement_policy
local sources = deps.achievement_sources
local state_reader = deps.achievement_state
local metadata_identity = deps.achievement_metadata
local lru = deps.lru_cache
local config = deps.config
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local M = {}
local html_unescape = util.html_unescape
local local_achievement_meta_cache = {}
local resolution_log_signatures = {}
local MAX_METADATA_CACHE_ENTRIES = 24
local MAX_RESOLUTION_SIGNATURES = 64

local function set_metadata_cache(key, value)
    lru.put(local_achievement_meta_cache, key, value, MAX_METADATA_CACHE_ENTRIES)
end

local function disk_cache_path(appid, lang)
    if not config or not config.persistent_path then return nil end
    local clean_lang = tostring(lang or "spanish"):gsub("[^%w_]", "")
    if clean_lang == "" then clean_lang = "spanish" end
    return config.persistent_path(fs.join("metadata_cache", tostring(appid) .. "_" .. clean_lang .. ".json"))
end

local function read_disk_metadata_cache(appid, lang, allow_stale)
    local p = disk_cache_path(appid, lang)
    if not p then return nil end
    return metadata_identity.read_cached(p, tostring(appid), lang, allow_stale)
end

local function write_disk_metadata_cache(appid, lang, data)
    local p = disk_cache_path(appid, lang)
    if not p or type(data) ~= "table" or not next(data) then return end
    pcall(config.write_json_atomic, p, metadata_identity.cache_record(appid, lang, data))
end

local function reset_local_caches()
    local_achievement_meta_cache = {}
    state_reader.clear()
    resolution_log_signatures = {}
    if sources and sources.clear_cache then sources.clear_cache() end
end

function M.get_achievement_base_path() return settings.get_base_path() end
function M.set_achievement_base_path(path) reset_local_caches(); return settings.set_base_path(path) end
function M.get_game_achievement_path(request_json) return settings.get_game_path(request_json) end
function M.set_game_achievement_path(request_json) reset_local_caches(); return settings.set_game_path(request_json) end
function M.get_game_achievement_options(request_json) return settings.get_game_options(request_json) end
function M.set_game_achievement_options(request_json) reset_local_caches(); return settings.set_game_options(request_json) end
function M.clear_all_settings() reset_local_caches(); return settings.clear_all_settings() end

local decode_json_file = state_reader.decode

local function clean_html_text(s)
    s = tostring(s or "")
    s = s:gsub("<br%s*/?>", " ")
    s = s:gsub("<.->", "")
    s = html_unescape(s)
    s = s:gsub("&nbsp;", " ")
    s = s:gsub("&#(%d+);", function(n)
        local v = tonumber(n)
        if v and v >= 32 and v <= 126 then return string.char(v) end
        return ""
    end)
    s = s:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
    return s
end

local function achievement_icon_url(appid, icon)
    return metadata_identity.icon_url(appid, icon)
end

local function fetch_global_achievement_percentages(appid)
    local url = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=" .. tostring(appid)
    local ok, res = pcall(http.get, url, {
        headers = { ["Accept"] = "application/json" },
        timeout = 8
    })
    if not ok or not res or res.status ~= 200 or not res.body then return {}, {} end
    local okj, body = pcall(cjson.decode, res.body)
    if not okj or type(body) ~= "table" then return {}, {} end
    local list = body.achievementpercentages and body.achievementpercentages.achievements
    if type(list) ~= "table" then return {}, {} end
    local by_name, ordered = {}, {}
    for _, a in ipairs(list) do
        if type(a) == "table" and a.name then
            local row = { name = tostring(a.name), percent = tonumber(a.percent) or 0 }
            by_name[row.name] = row.percent
            ordered[#ordered + 1] = row
        end
    end
    return by_name, ordered
end

local function map_to_steam_lang(lang)
    return util.safe_language(lang)
end

local function fetch_public_achievement_schema(appid, lang)
    local url = "https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?appid="
        .. tostring(appid) .. "&language=" .. map_to_steam_lang(lang)
    local ok, res = pcall(http.get, url, {
        headers = { ["Accept"] = "application/json", ["User-Agent"] = USER_AGENT },
        timeout = 8
    })
    if not ok or not res or res.status ~= 200 or type(res.body) ~= "string"
        or #res.body > 4 * 1024 * 1024 then return {} end
    local okj, body = pcall(cjson.decode, res.body)
    local response = okj and type(body) == "table" and body.response or nil
    if type(response) ~= "table" or type(response.achievements) ~= "table" then return {} end
    return metadata_identity.normalize_public_rows(appid, response.achievements, achievement_icon_url)
end

local LANGUAGE_KEY_ALIASES = util.LANGUAGE_KEY_ALIASES or {}

local function extract_localized_text(val, lang)
    if type(val) == "string" then
        return val
    elseif type(val) == "table" then
        local target = map_to_steam_lang(lang)
        if val[target] and tostring(val[target]) ~= "" then
            return tostring(val[target])
        end
        local aliases = LANGUAGE_KEY_ALIASES[target]
        if aliases then
            for _, alias in ipairs(aliases) do
                if val[alias] and tostring(val[alias]) ~= "" then
                    return tostring(val[alias])
                end
            end
        end
        if val["english"] and tostring(val["english"]) ~= "" then return tostring(val["english"]) end
        if val["en"] and tostring(val["en"]) ~= "" then return tostring(val["en"]) end
        for _, v in pairs(val) do
            if type(v) == "string" and v ~= "" then return v end
        end
    end
    return ""
end

local function fetch_community_achievement_rows(appid, lang)
    local steam_lang = map_to_steam_lang(lang)
    local url = "https://steamcommunity.com/stats/" .. tostring(appid) .. "/achievements?l=" .. steam_lang
    local cookie_header = "birthtime=0; mature_content=1; wants_mature_content=1; Steam_Language=" .. steam_lang .. ";"
    local ok, res = pcall(http.get, url, {
        headers = {
            ["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ["Cookie"] = cookie_header,
        },
        timeout = 8
    })
    if not ok or not res or res.status ~= 200 or not res.body then
        logger:info("Community achievement rows unavailable for appid " .. tostring(appid))
        return {}
    end
    local html = res.body
    local starts, pos = {}, 1
    while true do
        local s, _ = html:find('<div class="achieveRow[%s"]', pos)
        if not s then break end
        starts[#starts + 1] = s
        pos = s + 15
    end
    local rows = {}
    for i, s in ipairs(starts) do
        local e = (starts[i + 1] or (#html + 1)) - 1
        local chunk = html:sub(s, e)
        local icon = chunk:match('<img[^>]-src="([^"]+)"') or ""
        local pct = chunk:match('class="achievePercent"[^>]*>%s*([%d%.,]+)%%')
        local title = chunk:match('<h3[^>]*>(.-)</h3>') or ""
        local desc = chunk:match('<h5[^>]*>(.-)</h5>') or ""
        pct = pct and pct:gsub(",", ".") or "0"
        rows[#rows + 1] = {
            title = clean_html_text(title),
            description = clean_html_text(desc),
            icon = html_unescape(icon),
            percent = tonumber(pct) or 0,
        }
    end
    logger:info("Community achievement rows: " .. #rows .. " parsed for appid " .. tostring(appid) .. " (lang: " .. steam_lang .. ")")
    return rows
end

local function normalize_local_schema(appid, root_dir, lang)
    local appdata = os.getenv("APPDATA") or ""
    local localappdata = os.getenv("LOCALAPPDATA") or ""
    local userprofile = os.getenv("USERPROFILE") or ""
    if appdata == "" and userprofile ~= "" then
        appdata = fs.join(userprofile, "AppData", "Roaming")
    end
    if localappdata == "" and userprofile ~= "" then
        localappdata = fs.join(userprofile, "AppData", "Local")
    end

    local candidates = {
        fs.join(root_dir, "achievement_definitions.json"),
        fs.join(root_dir, "schema.json"),
        fs.join(root_dir, "steam_settings", "achievements.json"),
        fs.join(root_dir, "definitions", "achievements.json"),
    }

    local function add_schema_candidate(p)
        if p and p ~= "" then candidates[#candidates + 1] = p end
    end

    -- Local SteamAchievements:
    if appdata ~= "" then
        add_schema_candidate(fs.join(appdata, "SteamAchievements", tostring(appid), "achievement_definitions.json"))
        add_schema_candidate(fs.join(appdata, "SteamAchievements", tostring(appid), "schema.json"))
        add_schema_candidate(fs.join(appdata, "SteamAchievements", tostring(appid), "steam_settings", "achievements.json"))
        add_schema_candidate(fs.join(appdata, "SteamAchievements", "settings", tostring(appid), "achievements.json"))
        add_schema_candidate(fs.join(appdata, "SteamAchievements", "settings", tostring(appid), "schema.json"))
    end

    -- Local achievements:
    if appdata ~= "" then
        add_schema_candidate(fs.join(appdata, "LocalAchievements", tostring(appid), "schema.json"))
        add_schema_candidate(fs.join(appdata, "LocalAchievements", tostring(appid), "achievement_definitions.json"))
        add_schema_candidate(fs.join(appdata, "Steam", tostring(appid), "schema.json"))
        add_schema_candidate(fs.join(appdata, "Steam", tostring(appid), "achievement_definitions.json"))
        add_schema_candidate(fs.join(appdata, "Steam", tostring(appid), "stats", "achievements.json"))
        add_schema_candidate(fs.join(appdata, "Steam", tostring(appid), "steam_settings", "achievements.json"))
    end

    -- LocalAppData:
    if localappdata ~= "" then
        add_schema_candidate(fs.join(localappdata, "SteamAchievements", tostring(appid), "schema.json"))
        add_schema_candidate(fs.join(localappdata, "SteamAchievements", tostring(appid), "achievement_definitions.json"))
        add_schema_candidate(fs.join(localappdata, "LocalAchievements", tostring(appid), "schema.json"))
        add_schema_candidate(fs.join(localappdata, "LocalAchievements", tostring(appid), "achievement_definitions.json"))
    end

    -- Additional local schema candidates:
    if appdata ~= "" then
        add_schema_candidate(fs.join(appdata, "SteamAchievements", "schema", tostring(appid) .. ".json"))
        add_schema_candidate(fs.join(appdata, "LocalAchievements", "schema", tostring(appid) .. ".json"))
    end
    for _, path in ipairs(candidates) do
        local data = decode_json_file(path)
        if data then
            local result = {}
            if type(data) == "table" then
                local list = (data.achievement and data.achievement.list) or data.achievements or data
                if type(list) == "table" then
                    for k, v in pairs(list) do
                        local a = (type(v) == "table") and v or {}
                        local name = tostring(a.name or a.id or k)
                        if name and name ~= "" then
                            local display = extract_localized_text(a.displayName or a.display_name or a.name_localized or a.title, lang)
                            if display == "" then display = name end
                            local desc = extract_localized_text(a.description or a.desc or a.description_localized, lang)
                            result[name] = {
                                name = name,
                                title = display,
                                description = desc,
                                icon = achievement_icon_url(appid, a.icon or a.icon_normal or a.iconNormal or ""),
                                icongray = achievement_icon_url(appid, a.icongray or a.icon_gray or a.icon_locked or a.iconLocked or ""),
                                hidden = a.hidden == true or tonumber(a.hidden) == 1,
                            }
                        end
                    end
                end
            end
            if next(result) then
                logger:info("Local achievement schema loaded: " .. path)
                return result, path
            end
        end
    end
    return {}, ""
end

local function match_public_metadata(appid, lang, root_dir, native_hint)
    local key = tostring(appid) .. "|" .. tostring(lang or "spanish")
    local now = os.time()
    local hinted = type(native_hint) == "table" and tostring(native_hint.appid) == tostring(appid)
        and metadata_identity.normalize_rows(appid, native_hint.rows) or {}
    local cached = local_achievement_meta_cache[key]
    local cache_ttl = cached and cached.verified and 1800 or 15
    if cached and (not next(hinted) or cached.verified) and now >= cached.time and now - cached.time < cache_ttl then
        lru.touch(cached)
        return metadata_identity.apply_client_permissions(appid, cached.by_name or {}), cached.source or "cache"
    end
    local_achievement_meta_cache[key] = nil
    local disk_cached = read_disk_metadata_cache(appid, lang)
    if not next(hinted) and disk_cached and next(disk_cached) then
        set_metadata_cache(key, { time = now, by_name = disk_cached, source = "disk_cache", verified = true })
        return metadata_identity.apply_client_permissions(appid, disk_cached), "disk_cache"
    end

    local schema, source = hinted, "steam_client_schema"
    if not next(schema) then
        schema, source = normalize_local_schema(appid, root_dir, lang)
        if next(schema) then source = "local_schema:" .. source end
    end
    if not next(schema) then
        schema, source = metadata_identity.native_schema(appid,
            function(value) return extract_localized_text(value, lang) end, achievement_icon_url)
    end
    if not next(schema) then
        schema = fetch_public_achievement_schema(appid, lang)
        source = "steam_public_schema"
    end
    if next(schema) and source == "steam_public_schema" then
        -- This response already binds names, icons and rarity to exact API IDs;
        -- anonymous linked games do not need a personal Steam stats request.
        write_disk_metadata_cache(appid, lang, schema)
        set_metadata_cache(key, { time = now, by_name = schema, source = source, verified = true })
        return metadata_identity.apply_client_permissions(appid, schema), source
    end
    local global_by_name, global_ordered = fetch_global_achievement_percentages(appid)
    if next(schema) then
        local community = fetch_community_achievement_rows(appid, lang)
        if tostring(lang):lower() ~= "english" and #community == 0 then
            community = fetch_community_achievement_rows(appid, "english")
        end
        schema = metadata_identity.enrich_by_icon(schema, community, global_by_name)
        write_disk_metadata_cache(appid, lang, schema)
        set_metadata_cache(key, { time = now, by_name = schema, source = source, verified = true })
        return metadata_identity.apply_client_permissions(appid, schema), source
    end

    -- Neither percentage nor HTML order establishes an achievement's identity.
    -- Keep API IDs truthful until a read-only native schema can supply its text.
    -- Older unversioned caches may contain guessed pairings and are not reused.
    local fallback_disk = read_disk_metadata_cache(appid, lang, true)
    if fallback_disk and next(fallback_disk) then
        -- A temporary schema outage must not erase verified names and icons
        -- merely because the independent percentages endpoint is still online.
        metadata_identity.enrich_by_icon(fallback_disk, {}, global_by_name)
        set_metadata_cache(key, { time = now, by_name = fallback_disk, source = "disk_cache_stale", verified = false })
        return metadata_identity.apply_client_permissions(appid, fallback_disk), "disk_cache_stale"
    end
    local result = {}
    for _, item in ipairs(global_ordered) do
        result[item.name] = { name = item.name, title = item.name, description = "", icon = "",
            icongray = "", hidden = false, global_percent = item.percent }
    end
    set_metadata_cache(key, { time = now, by_name = result, source = "steam_public_unverified", verified = false })
    return metadata_identity.apply_client_permissions(appid, result), "steam_public_unverified"
end

function M.get_game_achievement_capabilities(request_json)
    local request = settings.parse_request(request_json)
    local appid = tostring(request.steam_app_id or request.appid or "")
    if not appid:match("^%d+$") then
        return cjson.encode({ ok = false, error = "missing_steam_app_id" })
    end
    local lang = util.safe_language(request.language)
    local metadata, metadata_source = match_public_metadata(appid, lang, fs.join(settings.local_root(), appid))
    local total, online_count = 0, 0
    for name, item in pairs(metadata) do
        total = total + 1
        if policy.is_online({
            name = name,
            title = item.title,
            description = item.description,
        }) then
            online_count = online_count + 1
        end
    end
    return cjson.encode({
        ok = true,
        appid = appid,
        total = total,
        online_count = online_count,
        has_online = online_count > 0,
        metadata_source = metadata_source,
    })
end

function M.fetch_local_achievement_data(request_json, language, state_app_id)
    if type(request_json) == "table" and type(request_json.request_json) == "string" then
        request_json = request_json.request_json
    end
    local steam_app_id = request_json
    local allow_simulated = false
    local simulate_unlock_all = false
    local unlock_online = false
    local native_schema_hint = nil

    -- The Millennium Lua host iterates JSON object values in key order before
    -- invoking a function.  A single JSON-string argument avoids positional
    -- corruption when a request contains language + two different AppIDs.
    if type(request_json) == "string" and not request_json:match("^%d+$") then
        local ok_request, request = pcall(cjson.decode, request_json)
        if ok_request and type(request) == "table" then
            steam_app_id = request.steam_app_id or request.appid or request[1]
            language = request.language or language
            native_schema_hint = request.native_schema
            allow_simulated = request.allow_simulated == true
            simulate_unlock_all = request.simulate_unlock_all == true
            unlock_online = request.unlock_online == true
            state_app_id = request.state_app_id
                or request.shortcut_app_id
                or request.local_app_id
                or state_app_id
        end
    elseif type(request_json) == "table" then
        language = request_json.language or language
        native_schema_hint = request_json.native_schema
        allow_simulated = request_json.allow_simulated == true
        simulate_unlock_all = request_json.simulate_unlock_all == true
        unlock_online = request_json.unlock_online == true
        -- A non-Steam shortcut has its own unsigned Steam shortcut ID. Some
        -- local save setups write their live achievement
        -- state under that ID, while the linked Steam AppID is still needed
        -- for the public schema, names and icon URLs.
        state_app_id = request_json.state_app_id
            or request_json.shortcut_app_id
            or request_json.local_app_id
            or state_app_id
        steam_app_id = request_json.steam_app_id or request_json.appid or request_json[1]
    end
    local metadata_appid = tostring(steam_app_id or "")
    if not metadata_appid:match("^%d+$") then
        return cjson.encode({ found = false, error = "invalid_appid" })
    end
    local state_appid = tostring(state_app_id or "")
    if not state_appid:match("^%d+$") then state_appid = metadata_appid end
    local lang = util.safe_language(language)

    local effective = settings.resolve_options({
        shortcut_app_id = state_appid,
        steam_app_id = metadata_appid,
    }, {
        simulate = allow_simulated,
        simulate_count = nil,
        simulate_online_count = nil,
        simulate_percent = 0,
        simulate_online_percent = 0,
        unlock_online = unlock_online,
    })
    allow_simulated = effective.simulate == true
    local simulate_count = tonumber(effective.simulate_count)
    local simulate_online_count = tonumber(effective.simulate_online_count)
    local simulate_percent = tonumber(effective.simulate_percent) or 0
    local simulate_online_percent = tonumber(effective.simulate_online_percent) or 0
    local unlocked_names = type(effective.unlocked_names) == "table" and effective.unlocked_names or nil
    unlock_online = effective.unlock_online == true

    local root = settings.local_root()
    local metadata_dir = fs.join(root, metadata_appid)

    -- Prefer the official linked Steam AppID because it is stable across
    -- shortcut renames/re-creations.  Retain the active shortcut AppID as a
    -- compatibility fallback for older emulator layouts.
    local candidate_states, seen_paths = {}, {}
    local function add_state_path(path, source_appid, schema_dir, source)
        if path and path ~= "" and not seen_paths[path] then
            seen_paths[path] = true
            candidate_states[#candidate_states + 1] = {
                path = path,
                appid = source_appid,
                schema_dir = schema_dir,
                source = source or "appid_folder",
            }
        end
    end

    -- A source configured in this shortcut's Properties is intentionally
    -- checked first when real progress is active. Simulation is a view policy:
    -- it must not read or mutate a progress file while producing its own state.
    if not allow_simulated then
        local explicit_path, explicit_key = settings.configured_path(state_appid, metadata_appid)
        if explicit_path and explicit_path ~= "" then
            if explicit_path:lower():match("%.json$") then
                add_state_path(explicit_path, state_appid, fs.parent_path(explicit_path), "per_game:" .. tostring(explicit_key))
            else
                add_state_path(fs.join(explicit_path, "achievements.json"), state_appid, explicit_path, "per_game:" .. tostring(explicit_key))
                add_state_path(fs.join(explicit_path, "stats", "achievements.json"), state_appid, explicit_path, "per_game:" .. tostring(explicit_key))
                add_state_path(fs.join(explicit_path, "steam_settings", "achievements.json"), state_appid, explicit_path, "per_game:" .. tostring(explicit_key))
            end
        end
    end

    local function add_state_paths_for(appid)
        local dir = fs.join(root, appid)
        add_state_path(fs.join(dir, "achievements.json"), appid, dir, "configured_root")
        add_state_path(fs.join(dir, "stats", "achievements.json"), appid, dir, "configured_root")
        add_state_path(fs.join(dir, "steam_settings", "achievements.json"), appid, dir, "configured_root")

        local appdata = os.getenv("APPDATA") or ""
        local localappdata = os.getenv("LOCALAPPDATA") or ""
        local userprofile = os.getenv("USERPROFILE") or ""
        if appdata == "" and userprofile ~= "" then
            appdata = fs.join(userprofile, "AppData", "Roaming")
        end
        if localappdata == "" and userprofile ~= "" then
            localappdata = fs.join(userprofile, "AppData", "Local")
        end

        local function add_common(base_dir, tag, with_ini)
            if base_dir and base_dir ~= "" then
                local p = fs.join(base_dir, "achievements.json")
                if fs.exists(p) then
                    add_state_path(p, appid, base_dir, tag)
                else
                    add_state_path(fs.join(base_dir, "achievements.json"), appid, base_dir, tag)
                    add_state_path(fs.join(base_dir, "stats", "achievements.json"), appid, base_dir, tag)
                    add_state_path(fs.join(base_dir, "steam_settings", "achievements.json"), appid, base_dir, tag)
                    if with_ini then add_state_path(fs.join(base_dir, "achievements.ini"), appid, base_dir, tag) end
                end
            end
        end
        if appdata ~= "" then
            add_common(fs.join(appdata, "SteamAchievements", tostring(appid)), "steam_achievements", true)
            add_common(fs.join(appdata, "SteamAchievements", "settings", tostring(appid)), "steam_achievements_settings")
            add_common(fs.join(appdata, "LocalAchievements", tostring(appid)), "local_achievements")
            add_common(fs.join(appdata, "Steam", tostring(appid)), "legacy_steam")
        end
        if localappdata ~= "" then
            add_common(fs.join(localappdata, "SteamAchievements", tostring(appid)), "steam_achievements_local")
            add_common(fs.join(localappdata, "LocalAchievements", tostring(appid)), "local_achievements_local")
        end
    end
    -- Automatic AppID progress is likewise ignored temporarily while
    -- simulation is enabled. The files remain untouched and become active again
    -- as soon as the user disables simulation.
    if not allow_simulated then
        -- Steam regenerates a non-Steam Shortcut AppID when its identity changes.
        -- Scan numeric siblings under the configured root and compare their
        -- complete achievement-name set with the official schema. Exact matches
        -- are ordered by file modification time, so the active or most recently
        -- used historical folder wins without moving or changing any file.
        local discovery_metadata = select(1, match_public_metadata(metadata_appid, lang, metadata_dir, native_schema_hint))
        local root_matches = sources.find_matching_root_candidates(
            root, discovery_metadata, metadata_appid, state_appid
        )
        for _, candidate in ipairs(root_matches) do
            add_state_path(candidate.path, candidate.appid, candidate.schema_dir, candidate.source)
        end
        add_state_paths_for(metadata_appid)
        if state_appid ~= metadata_appid then add_state_paths_for(state_appid) end
    end

    local state = nil
    local state_path = ""
    local state_source_appid = ""
    local state_source = ""
    for _, candidate in ipairs(candidate_states) do
        state = decode_json_file(candidate.path)
        if state then
            state_path = candidate.path
            state_source_appid = candidate.appid
            state_source = candidate.source or "appid_folder"
            if candidate.schema_dir and candidate.schema_dir ~= "" then
                metadata_dir = candidate.schema_dir
            end
            break
        end
    end

    if not state and allow_simulated then
        -- Simulation changes only the earned state. The list, names,
        -- descriptions and icon URLs still come from Steam's real metadata,
        -- and this path never writes to Steam or to a game's save files.
        local metadata, metadata_source = match_public_metadata(metadata_appid, lang, metadata_dir, native_schema_hint)
        local meta_list = {}
        for name, m in pairs(metadata) do
            meta_list[#meta_list + 1] = {
                name = name,
                display_name = tostring(m.title or name),
                description = tostring(m.description or ""),
                icon = tostring(m.icon or ""),
                icon_gray = tostring(m.icongray or m.icon or ""),
                hidden = m.hidden == true,
                global_percent = tonumber(m.global_percent) or 0,
                global_percent_known = m.global_percent ~= nil,
                client_writable = m.client_writable,
            }
        end
        if #meta_list == 0 then
            return cjson.encode({
                found = false,
                appid = metadata_appid,
                state_appid = state_appid,
                path = fs.join(root, state_appid, "achievements.json"),
                root = root,
            })
        end

        table.sort(meta_list, function(a, b)
            if (a.global_percent or 0) ~= (b.global_percent or 0) then
                return (a.global_percent or 0) > (b.global_percent or 0)
            end
            return tostring(a.name) < tostring(b.name)
        end)

        local offline_total = 0
        local online_total = 0
        for _, item in ipairs(meta_list) do
            if policy.is_online(item) then
                online_total = online_total + 1
            else
                offline_total = offline_total + 1
            end
        end

        local total = #meta_list
        local appid_num = tonumber(metadata_appid) or 0
        local pct_num = math.max(0, math.min(100, tonumber(simulate_percent) or 0))
        local pct_target = pct_num / 100.0
        local offline_unlocked_target = 0
        if simulate_count ~= nil and simulate_count >= 0 then
            offline_unlocked_target = math.max(0, math.min(offline_total, math.floor(simulate_count)))
        else
            offline_unlocked_target = math.floor(offline_total * pct_target + 0.5)
            if pct_num > 0 and offline_unlocked_target < 1 and offline_total > 0 then
                offline_unlocked_target = 1
            end
            if pct_num >= 100 then
                offline_unlocked_target = offline_total
            end
            if pct_num <= 0 then
                offline_unlocked_target = 0
            end
        end

        local online_pct_num = math.max(0, math.min(100, tonumber(simulate_online_percent) or (unlock_online and 100 or 0)))
        local online_pct_target = online_pct_num / 100.0
        local online_unlocked_target = 0
        if simulate_online_count ~= nil and simulate_online_count >= 0 then
            online_unlocked_target = math.max(0, math.min(online_total, math.floor(simulate_online_count)))
        else
            online_unlocked_target = math.floor(online_total * online_pct_target + 0.5)
            if online_pct_num > 0 and online_unlocked_target < 1 and online_total > 0 then
                online_unlocked_target = 1
            end
            if online_pct_num >= 100 then
                online_unlocked_target = online_total
            end
            if online_pct_num <= 0 then
                online_unlocked_target = 0
            end
        end

        local unlocked_names_set = nil
        if unlocked_names ~= nil then
            unlocked_names_set = {}
            for _, name in ipairs(unlocked_names) do
                unlocked_names_set[tostring(name)] = true
            end
            offline_unlocked_target = 0
            online_unlocked_target = 0
        end

        local base_now = 1771616040 -- Stable timestamp so the visual test set never reshuffles.
        local achievements = {}
        local simulated_unlocked = 0
        local offline_idx = 0
        local online_idx = 0
        for idx, item in ipairs(meta_list) do
            local is_online = policy.is_online(item)
            local is_earned = false
            if unlocked_names_set ~= nil then
                is_earned = (unlocked_names_set[item.name] == true)
                if is_earned then
                    if is_online then
                        online_unlocked_target = online_unlocked_target + 1
                    else
                        offline_unlocked_target = offline_unlocked_target + 1
                    end
                end
            else
                if is_online then
                    online_idx = online_idx + 1
                    is_earned = (online_idx <= online_unlocked_target)
                else
                    offline_idx = offline_idx + 1
                    is_earned = (offline_idx <= offline_unlocked_target)
                end
            end
            local earned_time = 0
            if is_earned then
                simulated_unlocked = simulated_unlocked + 1
                earned_time = base_now - (86400 * idx * 3) - ((appid_num + idx * 7919) % 43200)
            end
            achievements[#achievements + 1] = {
                name = item.name,
                display_name = item.display_name,
                description = item.description,
                icon = item.icon,
                icon_gray = item.icon_gray,
                hidden = item.hidden,
                global_percent = item.global_percent,
                global_percent_known = item.global_percent_known,
                client_writable = item.client_writable,
                earned = is_earned,
                earned_time = earned_time,
                progress = 0,
                max_progress = 0,
                is_online = is_online,
            }
        end

        return cjson.encode({
            found = true,
            appid = metadata_appid,
            metadata_appid = metadata_appid,
            state_appid = state_appid,
            simulation_enabled = true,
            simulate_count = offline_unlocked_target,
            simulate_online_count = online_unlocked_target,
            simulate_percent = offline_total > 0 and math.floor((offline_unlocked_target / offline_total) * 100 + 0.5) or 0,
            simulate_online_percent = online_total > 0 and math.floor((online_unlocked_target / online_total) * 100 + 0.5) or 0,
            unlock_online = online_unlocked_target > 0,
            unlocked_names = unlocked_names,
            unlocked = simulated_unlocked,
            total = total,
            metadata_source = tostring(metadata_source or "public") .. ":simulated-test",
            state_source = "simulated_test",
            achievements = achievements,
        })
    end

    if not state then
        -- Always return the real Steam schema when no progress file exists.
        -- This makes a live policy transition explicit: disabling online-only
        -- unlock changes 2/50 to 0/50 instead of returning `found = false` and
        -- leaving the previous forced result mounted in Steam's Library.
        state = {}
        state_source = "metadata_only"
        state_source_appid = state_appid
    end

    -- Never use the shortcut ID to look up Steam metadata: it is not a real
    -- Steam AppID and has no achievement schema on Steam's services.
    local metadata, metadata_source = match_public_metadata(metadata_appid, lang, metadata_dir, native_schema_hint)
    local all_names = {}
    local seen_names = {}
    local function add_name(name)
        name = tostring(name or "")
        if name ~= "" and not seen_names[name] then
            seen_names[name] = true
            all_names[#all_names + 1] = name
        end
    end

    local missing_online_names = {}
    if next(metadata) then
        for name, m in pairs(metadata) do
            add_name(name)
            if unlock_online and policy.is_online({ name = name, title = m.title, description = m.description }) then
                missing_online_names[#missing_online_names + 1] = tostring(name)
            end
        end
    end
    for name, st in pairs(state) do
        if type(st) == "table" then add_name(name) end
    end
    table.sort(all_names)

    local achievements = {}
    local unlocked, total = 0, 0
    for _, name in ipairs(all_names) do
        local st = type(state[name]) == "table" and state[name] or {}
        local m = type(metadata[name]) == "table" and metadata[name] or {}
        local is_online = policy.is_online({ name = name, title = m.title, description = m.description })
        local is_earned = st.earned == true or tonumber(st.earned) == 1 or (unlock_online and is_online)
        local earned_time = tonumber(st.earned_time) or 0
        if is_earned then
            unlocked = unlocked + 1
        end
        achievements[#achievements + 1] = {
            name = name,
            display_name = tostring(m.title or name),
            description = tostring(m.description or ""),
            icon = tostring(m.icon or ""),
            icon_gray = tostring(m.icongray or m.icon or ""),
            hidden = m.hidden == true,
            global_percent = tonumber(m.global_percent) or 0,
            global_percent_known = m.global_percent ~= nil,
            client_writable = m.client_writable,
            earned = is_earned,
            earned_time = earned_time,
            progress = tonumber(st.progress) or 0,
            max_progress = tonumber(st.max_progress) or 0,
            is_online = is_online,
        }
        total = total + 1
    end

    local resolution_key = metadata_appid .. "|" .. state_appid
    local resolution_signature = table.concat({
        tostring(unlocked), tostring(total), tostring(state_source_appid),
        tostring(state_source), tostring(state_path),
    }, "|")
    local previous_resolution = resolution_log_signatures[resolution_key]
    if not previous_resolution or previous_resolution.signature ~= resolution_signature then
        logger:info("Local achievement data resolved: " .. unlocked .. "/" .. total
            .. " for linked appid " .. metadata_appid .. " from state appid " .. state_source_appid
            .. " via " .. tostring(state_source) .. " (" .. tostring(state_path) .. ")")
    end
    lru.put(resolution_log_signatures, resolution_key, {
        signature = resolution_signature,
    }, MAX_RESOLUTION_SIGNATURES)

    return cjson.encode({
        found = true,
        appid = metadata_appid,
        metadata_appid = metadata_appid,
        state_appid = state_source_appid,
        root = root,
        path = state_path,
        metadata_source = metadata_source,
        state_source = state_source,
        simulation_enabled = false,
        simulate_unlock_all = false,
        unlock_online = unlock_online,
        zero_progress = zero_progress,
        unlocked = unlocked,
        total = total,
        achievements = achievements,
    })
end

return M
end
