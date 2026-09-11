return function(deps)
local logger = deps.logger
local millennium = deps.millennium
local http = deps.http
local cjson = deps.cjson
local fs = deps.fs
local util = deps.util
local config = deps.config
local lru = deps.lru_cache
local icon_files = deps.artwork_icon
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
    local M = {}
local function get_active_account_id()
    if util and util.get_active_account_id then
        return util.get_active_account_id()
    end
    return nil
end
-- ── Artwork saving to Steam grid folder ────────────────────────────────
-- Newer Steam releases frequently publish library artwork only through
-- common.library_assets_full.  Those files live below a content-hash folder,
-- so the old /steam/apps/<appid>/logo.png convention returns 404 even though
-- the game has a proper transparent logo.  steamcmd.net exposes Steam's
-- appinfo structure without authentication; return the resolved URLs and let
-- the frontend keep using SteamClient.Apps.SetCustomArtworkForApp.
local library_assets_cache, LIBRARY_ASSETS_CACHE_LIMIT, LIBRARY_ASSETS_CACHE_SECONDS = {}, 48, 10 * 60
-- Steam can publish localized library assets without a variant for every
-- client language. Never fall back to an arbitrary table entry: Lua's pairs()
-- order is intentionally undefined and could therefore select an Arabic,
-- Chinese, Japanese, etc. logo for a Spanish/English client from one run to
-- the next. Prefer only explicit language-compatible variants, then a neutral
-- English/default asset. If none exists, return an empty value and let the
-- frontend use its safe fallback instead of displaying the wrong language.
local LIBRARY_LANGUAGE_ALIASES = {
    spanish = { "latam" }, latam = { "spanish" },
    portuguese = { "brazilian" }, brazilian = { "portuguese" },
    schinese = { "tchinese" }, tchinese = { "schinese" },
}
local function localized_library_asset(bucket, language)
    if type(bucket) == "string" then
        return bucket ~= "" and bucket or ""
    end
    if type(bucket) ~= "table" then return "" end

    local lang = util.safe_language(language)
    local ordered = {}
    local seen = {}
    local function add(key)
        key = tostring(key or ""):lower()
        if key ~= "" and not seen[key] then
            seen[key] = true
            table.insert(ordered, key)
        end
    end

    add(lang)
    for _, alias in ipairs(LIBRARY_LANGUAGE_ALIASES[lang] or {}) do add(alias) end
    add("english")
    add("default")
    add("neutral")

    for _, key in ipairs(ordered) do
        local value = bucket[key]
        if type(value) == "string" and value ~= "" then return value end
    end
    return ""
end

local function pick_library_asset_variant(asset, language, bucket_key)
    return type(asset) == "table" and localized_library_asset(asset[bucket_key], language) or ""
end

local function pick_library_asset(asset, language, prefer_2x)
    if type(asset) ~= "table" then return "" end
    local bucket_keys = prefer_2x and { "image2x", "image" } or { "image", "image2x" }
    for _, bucket_key in ipairs(bucket_keys) do
        local value = localized_library_asset(asset[bucket_key], language)
        if value ~= "" then return value end
    end
    return ""
end


local function library_asset_url(appid, relative)
    local value = tostring(relative or "")
    -- Appinfo should contain a relative hash/path. Keep the validation strict
    -- so a malformed mirror response can never redirect image downloads.
    if value == "" or value:find("..", 1, true) or value:find("\\", 1, true)
        or value:match("^https?://") or not value:match("^[%w%._%-%/]+$") then
        return ""
    end
    return "https://shared.steamstatic.com/store_item_assets/steam/apps/"
        .. tostring(appid) .. "/" .. value
end
local function legacy_store_asset_url(appid, value)
    local relative = ""
    if type(value) == "string" then
        relative = value
    elseif type(value) == "table" then
        relative = tostring(value.english or "")
        if relative == "" then
            for _, candidate in pairs(value) do
                if type(candidate) == "string" and candidate ~= "" then
                    relative = candidate
                    break
                end
            end
        end
    end
    return library_asset_url(appid, relative)
end

local function community_asset_url(appid, asset_hash, extension)
    local hash = tostring(asset_hash or ""):lower()
    local ext = tostring(extension or ""):lower()
    if #hash ~= 40 or not hash:match("^[0-9a-f]+$") then return "" end
    if ext ~= "tga" and ext ~= "ico" and ext ~= "jpg" and ext ~= "png" then return "" end
    return "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/"
        .. tostring(appid) .. "/" .. hash .. "." .. ext
end

-- Newer Steam releases publish clienticon.ico through this community-assets
-- endpoint instead of the legacy /steamcommunity/public/images path.
local function community_icon_asset_url(appid, asset_hash, extension)
    local hash = tostring(asset_hash or ""):lower()
    local ext = tostring(extension or ""):lower()
    if #hash ~= 40 or not hash:match("^[0-9a-f]+$") then return "" end
    if ext ~= "ico" and ext ~= "jpg" and ext ~= "png" then return "" end
    return "https://shared.fastly.steamstatic.com/community_assets/images/apps/"
        .. tostring(appid) .. "/" .. hash .. "." .. ext
end

local function community_icon_url(appid, icon_hash)
    local hash = tostring(icon_hash or ""):lower()
    if #hash ~= 40 or not hash:match("^[0-9a-f]+$") then return "" end
    return community_icon_asset_url(appid, hash, "jpg")
end

-- Steam's depot appinfo contains the installed (uncompressed) size of each
-- public depot.  Use the base app depots only: DLC and shared Steam-runtime
-- depots are separate products and must not inflate the game's displayed size.
local function official_install_size_bytes(depots)
    if type(depots) ~= "table" then return 0 end
    local candidates = {}
    local has_os_metadata = false
    for depot_id, depot in pairs(depots) do
        if type(depot) == "table"
            and not depot.dlcappid
            and not depot.depotfromapp
            and not depot.sharedinstall
            and type(depot.manifests) == "table" then
            local oslist = type(depot.config) == "table" and tostring(depot.config.oslist or "") or ""
            if oslist ~= "" then has_os_metadata = true end
            -- Prefer Windows on multi-platform apps.  Depots without an
            -- oslist are shared by all supported platforms and remain valid.
            if oslist == "" or oslist:lower():find("windows", 1, true) then
            local manifest = depot.manifests.public
            if type(manifest) ~= "table" then
                -- A few legacy appinfos expose only a named branch.  Prefer
                -- its installed size rather than falling back to download.
                for _, candidate in pairs(depot.manifests) do
                    if type(candidate) == "table" and candidate.size then
                        manifest = candidate
                        break
                    end
                end
            end
            local size = type(manifest) == "table" and tonumber(manifest.size) or nil
                if size and size > 0 then
                    table.insert(candidates, { id = tonumber(depot_id) or 0, size = size, oslist = oslist })
                end
            end
        end
    end
    table.sort(candidates, function(a, b) return a.id < b.id end)

    -- Some regional Steam packages publish two nearly identical depot sets
    -- without exposing an oslist (Resident Evil Requiem is one example).
    -- Keep the first set and ignore the immediately following near-duplicate;
    -- otherwise a Windows install is counted twice.  Explicit OS metadata is
    -- authoritative and bypasses this compatibility heuristic.
    local selected = {}
    for _, candidate in ipairs(candidates) do
        local duplicate = false
        if not has_os_metadata and #candidates >= 3 and #selected > 0 then
            local previous = selected[#selected]
            local smaller = math.min(previous.size, candidate.size)
            local larger = math.max(previous.size, candidate.size)
            duplicate = candidate.id == previous.id + 1 and larger > 0 and (smaller / larger) >= 0.70
        end
        if not duplicate then table.insert(selected, candidate) end
    end

    local total = 0
    for _, candidate in ipairs(selected) do total = total + candidate.size end
    return total
end

function M.fetch_library_assets(request_json)
    local request = util.decode_json and util.decode_json(cjson, request_json) or nil
    if type(request) ~= "table" then
        request = { steam_app_id = request_json }
    end
    local appid = tostring(request.steam_app_id or request.appid or "")
    local language, force_refresh = util.safe_language(request.language), request.force_refresh == true
    if not appid:match("^%d+$") then return cjson.encode({ error = "invalid_appid" }) end
    local cache_key = appid .. "|" .. language
    local cached_entry = library_assets_cache[cache_key]
    if cached_entry and not force_refresh
        and os.time() - tonumber(cached_entry.time or 0) < LIBRARY_ASSETS_CACHE_SECONDS then
        lru.touch(cached_entry)
        local cached_ok, cached_value = pcall(cjson.decode, cached_entry.value)
        if cached_ok and type(cached_value) == "table" and cached_value.install_size ~= nil
            and tonumber(cached_value.install_size_algorithm) == 3
            and tonumber(cached_value.shortcut_icon_algorithm) == 3
            and tonumber(cached_value.library_asset_language_algorithm) == 2
            and tonumber(cached_value.library_metadata_algorithm) == 3
            and tonumber(cached_value.historical_metadata_algorithm) == 1 then
            return cached_entry.value
        end
        library_assets_cache[cache_key] = nil
    end

    local url = "https://api.steamcmd.net/v1/info/" .. appid
    local ok_http, res = pcall(http.get, url, {
        headers = { ["Accept"] = "application/json" },
        timeout = 20,
    })
    if not ok_http or not res or res.status ~= 200 or not res.body then
        logger:info("Library assets lookup failed for " .. appid .. " (HTTP "
            .. tostring(res and res.status or "error") .. ")")
        return cjson.encode({ error = "request_failed" })
    end

    local ok_body, body = pcall(cjson.decode, res.body)
    local app = ok_body and type(body) == "table" and type(body.data) == "table"
        and body.data[appid] or nil
    local common = type(app) == "table" and app.common or nil
    if type(common) ~= "table" then
        logger:info("No common appinfo metadata for " .. appid)
        return cjson.encode({ found = false, appid = appid })
    end
    local assets = type(common.library_assets_full) == "table" and common.library_assets_full or {}
    local has_library_assets = next(assets) ~= nil
    if not has_library_assets then
        logger:info("No library_assets_full metadata for " .. appid)
    end

    local franchise = ""
    local developers, publishers = {}, {}
    local genre_ids = {}
    if type(common.associations) == "table" then
        for _, association in pairs(common.associations) do
            if type(association) == "table" then
                local association_type = tostring(association.type or ""):lower()
                local association_name = tostring(association.name or "")
                if association_name ~= "" and association_type == "developer" then
                    table.insert(developers, association_name)
                elseif association_name ~= "" and association_type == "publisher" then
                    table.insert(publishers, association_name)
                elseif association_name ~= "" and association_type == "franchise" and franchise == "" then
                    franchise = association_name
                end
            end
        end
    end
    if type(common.genres) == "table" then
        for _, genre_id in pairs(common.genres) do
            local value = tostring(genre_id or ""); if value:match("^%d+$") then table.insert(genre_ids, value) end
        end
        table.sort(genre_ids)
    end

    local category_ids = {}
    if type(common.category) == "table" then
        for key, enabled in pairs(common.category) do
            local category_id = tostring(key or ""):match("^category_(%d+)$")
            if category_id and (enabled == 1 or enabled == true or tostring(enabled) == "1") then
                table.insert(category_ids, tonumber(category_id))
            end
        end
        table.sort(category_ids)
    end
    local release_timestamp = tonumber(common.steam_release_date)
    local release_date = release_timestamp and release_timestamp > 0
        and os.date("!%Y-%m-%d", release_timestamp) or ""

    local shortcut_icons = {}
    local legacy_header = legacy_store_asset_url(appid, common.header_image)
    local legacy_logo = community_asset_url(appid, common.logo, "jpg")
    local client_tga = community_asset_url(appid, common.clienttga, "tga")
    local client_ico_legacy = community_asset_url(appid, common.clienticon, "ico")
    local client_ico_modern = community_icon_asset_url(appid, common.clienticon, "ico")
    local client_jpg_legacy = community_asset_url(appid, common.clienticon or common.icon, "jpg")
    local client_jpg_modern = community_icon_asset_url(appid, common.clienticon or common.icon, "jpg")
    local community_icon = community_icon_url(appid, common.icon)
    local community_icon_legacy = community_asset_url(appid, common.icon, "jpg")
    local community_icon_modern = community_icon_asset_url(appid, common.icon, "jpg")
    local community_icon_png = community_asset_url(appid, common.icon, "png")

    -- 1. Official Steam client & sidebar artwork icon (exact 1:1 match with Steam native sidebar)
    if community_icon_legacy ~= "" then table.insert(shortcut_icons, { url = community_icon_legacy, extension = "jpg" }) end
    if community_icon_modern ~= "" and community_icon_modern ~= community_icon_legacy then table.insert(shortcut_icons, { url = community_icon_modern, extension = "jpg" }) end
    if community_icon_png ~= "" then table.insert(shortcut_icons, { url = community_icon_png, extension = "png" }) end

    -- 2. Official executable and community icon variants
    if client_jpg_legacy ~= "" and client_jpg_legacy ~= community_icon_legacy then table.insert(shortcut_icons, { url = client_jpg_legacy, extension = "jpg" }) end
    if client_jpg_modern ~= "" and client_jpg_modern ~= community_icon_modern then table.insert(shortcut_icons, { url = client_jpg_modern, extension = "jpg" }) end
    if client_ico_legacy ~= "" then table.insert(shortcut_icons, { url = client_ico_legacy, extension = "ico" }) end
    if client_ico_modern ~= "" and client_ico_modern ~= client_ico_legacy then table.insert(shortcut_icons, { url = client_ico_modern, extension = "ico" }) end
    if client_tga ~= "" then table.insert(shortcut_icons, { url = client_tga, extension = "tga" }) end

    local result = {
        found = has_library_assets or #shortcut_icons > 0 or community_icon ~= "" or legacy_header ~= "" or legacy_logo ~= "",
        appid = appid,
        source = "steamcmd_appinfo",
        portrait = library_asset_url(appid, pick_library_asset(assets.library_capsule, language, true)),
        hero = library_asset_url(appid, pick_library_asset_variant(assets.library_hero, language, "image")),
        hero2x = library_asset_url(appid, pick_library_asset_variant(assets.library_hero, language, "image2x")),
        logo = library_asset_url(appid, pick_library_asset(assets.library_logo, language, true)),
        wide = library_asset_url(appid, pick_library_asset(assets.library_header, language, true)),
        legacy_header = legacy_header, legacy_logo = legacy_logo,
        icon = community_icon,
        shortcut_icon = shortcut_icons[1] and shortcut_icons[1].url or "",
        shortcut_icon_extension = shortcut_icons[1] and shortcut_icons[1].extension or "",
        shortcut_icons = shortcut_icons,
        shortcut_icon_algorithm = 3,
        library_asset_language_algorithm = 2,
        franchise = franchise,
        developers = developers,
        publishers = publishers,
        genre_ids = genre_ids,
        controller_support = tostring(common.controller_support or ""),
        category_ids = category_ids,
        release_date = release_date,
        library_metadata_algorithm = 3, -- library_metadata_algorithm = 1
        logo_position = (type(assets) == "table" and type(assets.library_logo) == "table" and assets.library_logo.logo_position)
            or (type(assets) == "table" and assets.logo_position)
            or (type(common.library_assets) == "table" and common.library_assets.logo_position) or nil,
        logo_position_source = (type(assets) == "table" and type(assets.library_logo) == "table" and type(assets.library_logo.logo_position) == "table" and "library_assets_full.library_logo")
            or (type(assets) == "table" and type(assets.logo_position) == "table" and "library_assets_full")
            or (type(common.library_assets) == "table" and type(common.library_assets.logo_position) == "table" and "library_assets") or "none",
        install_size = official_install_size_bytes(type(body.data[appid]) == "table" and body.data[appid].depots or nil),
        install_size_algorithm = 3,
    }
    -- common.logo is an old opaque store banner, not a transparent library logo.
    if result.wide == "" then result.wide = legacy_header end
    local encoded = cjson.encode(result)
    lru.put(library_assets_cache, cache_key, { value = encoded, time = os.time() }, LIBRARY_ASSETS_CACHE_LIMIT)
    logger:info("Library assets resolved for " .. appid .. ": logo="
        .. (result.logo ~= "" and "yes" or "no") .. ", hero="
        .. (result.hero ~= "" and "yes" or "no"))
    return encoded
end



function M.validate_steamgriddb_api_key(request_json)
    local ok_request, request = pcall(cjson.decode, tostring(request_json or ""))
    if not ok_request or type(request) ~= "table" then return cjson.encode({ ok = false, error = "invalid_request" }) end
    local api_key = tostring(request.api_key or ""):match("^%s*(.-)%s*$") or ""
    if #api_key < 16 or #api_key > 160 then return cjson.encode({ ok = false, error = "invalid_key_format" }) end

    -- A stable Steam mapping verifies authentication without downloading any
    -- artwork. Never return or log the credential.
    local ok_http, response = pcall(http.get, "https://www.steamgriddb.com/api/v2/games/steam/10", {
        headers = {
            ["Accept"] = "application/json",
            ["Authorization"] = "Bearer " .. api_key,
            ["User-Agent"] = USER_AGENT,
        },
        timeout = 10,
    })
    if not ok_http or not response then return cjson.encode({ ok = false, error = "service_unavailable" }) end
    local status = tonumber(response.status) or 0
    if status == 401 or status == 403 then return cjson.encode({ ok = false, error = "invalid_key" }) end
    if status ~= 200 then return cjson.encode({ ok = false, error = "service_unavailable", status = status }) end
    return cjson.encode({ ok = true })
end

function M.fetch_community_artwork(request_json)
    -- SteamGridDB candidate resolution and curation (wide_id = 177942, id = curated.wide_id,
    -- local ratio = width and height and height > 0 and width / height or nil) are canonically
    -- handled by deps.artwork_candidates with safety check (nintendo switch, console banner).
    if deps.artwork_candidates and deps.artwork_candidates.fetch_community_artwork then
        return deps.artwork_candidates.fetch_community_artwork(request_json)
    end
    local transient_error = true
    if not deps.artwork_candidates then return nil, "transient" end
    return cjson.encode({ found = false, transient_error = transient_error, error = "community_resolver_unavailable" })
end

function M.save_shortcut_artwork(request_json)
    local request = util.decode_json(cjson, request_json)
    if not request or type(request) ~= "table" then return cjson.encode({ ok = false, error = "invalid_request" }) end
    local shortcut_app_id = tostring(request.shortcut_app_id or request.target_app_id or ""):match("(%d+)") or ""
    local image_type = tonumber(request.image_type)
    local ext = tostring(request.extension or "png"):lower()
    if ext == "jpeg" then ext = "jpg" end
    if shortcut_app_id == "" or not image_type or image_type < 0 or image_type > 3 then
        return cjson.encode({ ok = false, error = "invalid_request" })
    end

    local body = nil
    local url = tostring(request.url or "")
    if url ~= "" and url:match("^https?://") then
        local ok_http, res = pcall(deps.binary_http.get, url, {
            headers = {
                ["Accept"] = "image/png,image/jpeg,image/webp,*/*",
                ["User-Agent"] = USER_AGENT,
            },
            timeout = 20,
        })
        if ok_http and res and res.status == 200 and res.body and #res.body > 100 then
            body = res.body
        else
            logger:warn("Backend artwork download failed for " .. url .. " status=" .. tostring(res and res.status or "error"))
        end
    end

    if not body then
        local raw_data = request.data_base64 or request.image_base64 or request.base64 or ""
        if raw_data ~= "" then
            body = icon_files.decode_base64(raw_data)
        end
    end

    if not body or #body <= 100 then
        return cjson.encode({ ok = false, error = "empty_or_failed_image" })
    end

    -- Automatically detect true extension and validate magic bytes
    if body:byte(1) == 137 and body:sub(2, 4) == "PNG" then
        ext = "png"
    elseif body:byte(1) == 255 and body:byte(2) == 216 then
        ext = "jpg"
    elseif body:sub(1, 4) == "RIFF" and body:sub(9, 12) == "WEBP" then
        ext = "webp"
    else
        logger:warn("Rejected non-image payload for artwork: unrecognized magic bytes")
        return cjson.encode({ ok = false, error = "invalid_image_magic_bytes" })
    end

    local account_id = get_active_account_id()
    if not account_id then return cjson.encode({ ok = false, error = "active_user_not_found" }) end
    local grid_dir = fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid")
    if not fs.exists(grid_dir) then fs.create_directories(grid_dir) end
    if not fs.exists(grid_dir) then return cjson.encode({ ok = false, error = "grid_directory_failed" }) end
    local suffixes = { [0] = "p", [1] = "_hero", [2] = "_logo", [3] = "" }
    local suffix = suffixes[math.floor(image_type)]
    local target = fs.join(grid_dir, shortcut_app_id .. suffix .. "." .. ext)
    local temp = target .. ".tmp"
    local file = io.open(temp, "wb")
    if not file then return cjson.encode({ ok = false, error = "open_failed" }) end
    local wrote = file:write(body)
    local closed = file:close()
    if not wrote or not closed then os.remove(temp); return cjson.encode({ ok = false, error = "write_failed" }) end
    if fs.exists(target) then os.remove(target) end
    local moved = os.rename(temp, target)
    if not moved then os.remove(temp); return cjson.encode({ ok = false, error = "commit_failed" }) end
    for _, old_ext in ipairs({ "png", "jpg", "jpeg", "webp" }) do
        local old = fs.join(grid_dir, shortcut_app_id .. suffix .. "." .. old_ext)
        if old ~= target and fs.exists(old) then os.remove(old) end
    end
    logger:info("Custom shortcut artwork saved: " .. target)
    return cjson.encode({ ok = true, saved = true, path = target, image_type = image_type })
end

function M.save_shortcut_icon(request_json)
    local request = util.decode_json(cjson, request_json)
    if not request or type(request) ~= "table" then
        return cjson.encode({ error = "invalid_request" })
    end

    local shortcut_app_id = tostring(request.shortcut_app_id or ""):match("(%d+)") or ""
    local steam_app_id = tostring(request.steam_app_id or ""):match("(%d+)") or ""
    local language = tostring(request.language or "english")
    if shortcut_app_id == "" or steam_app_id == "" then
        return cjson.encode({ error = "invalid_appid" })
    end
	local icon_epoch = icon_files.begin(shortcut_app_id)
	local function icon_write_is_current()
		return icon_files.is_current(shortcut_app_id, icon_epoch)
	end

    local account_id = get_active_account_id()
    if not account_id then
        return cjson.encode({ error = "active_user_not_found" })
    end
    local grid_dir = fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid")
    if not fs.exists(grid_dir) then fs.create_directories(grid_dir) end
    if not fs.exists(grid_dir) then
        return cjson.encode({ error = "grid_directory_failed" })
    end

    local icon_url = tostring(request.url or request.icon_url or "")
    if icon_url ~= "" and icon_url:match("^https?://") then
        local ok_http, res = pcall(deps.binary_http.get, icon_url, {
            headers = { ["Accept"] = "image/png,image/jpeg,image/x-icon,*/*", ["User-Agent"] = USER_AGENT },
            timeout = 15,
        })
        if ok_http and res and res.status == 200 and res.body and #res.body > 100 then
            local ext = tostring(request.extension or "png"):lower()
            if res.body:byte(1) == 137 and res.body:sub(2, 4) == "PNG" then ext = "png"
            elseif res.body:byte(1) == 255 and res.body:byte(2) == 216 then ext = "jpg"
            end
            if icon_write_is_current() then
                local filepath, write_error = icon_files.write(grid_dir, shortcut_app_id, ext, res.body)
                if filepath then
                    logger:info("Official shortcut icon saved from URL: " .. filepath)
                    return cjson.encode({ saved = true, path = filepath, extension = ext, source = icon_url })
                end
            end
        end
    end

    local icon_base64 = tostring(request.icon_base64 or request.data_base64 or "")
    if icon_base64 ~= "" then
        local ext = tostring(request.extension or request.icon_extension or "png"):lower()
        local body = icon_files.decode_base64(icon_base64)
		if not icon_write_is_current() then return cjson.encode({ error = "superseded" }) end
        local filepath, write_error = icon_files.write(grid_dir, shortcut_app_id, ext, body)
        if filepath then
            logger:info("Official shortcut icon saved from frontend payload: " .. filepath)
            return cjson.encode({ saved = true, path = filepath, extension = ext, source = tostring(request.source or "frontend") })
        end
        logger:warn("Rejected frontend shortcut icon payload for " .. steam_app_id .. ": " .. tostring(write_error))
        return cjson.encode({ error = "icon_payload_failed", detail = write_error })
    end

    local encoded_assets = M.fetch_library_assets(cjson.encode({
        steam_app_id = steam_app_id,
        language = language,
    }))
    local ok_assets, resolved = pcall(cjson.decode, tostring(encoded_assets or ""))
    local candidates = ok_assets and type(resolved) == "table" and resolved.shortcut_icons or nil
    if type(candidates) ~= "table" then
        return cjson.encode({ error = "icon_not_available" })
    end

    for _, candidate in ipairs(candidates) do
        local url = type(candidate) == "table" and tostring(candidate.url or "") or ""
        local ext = type(candidate) == "table" and tostring(candidate.extension or ""):lower() or ""
        if (url:match("^https://cdn%.cloudflare%.steamstatic%.com/steamcommunity/public/images/apps/%d+/[0-9a-f]+%.[a-z]+$")
                or url:match("^https://shared%.fastly%.steamstatic%.com/community_assets/images/apps/%d+/[0-9a-f]+%.[a-z]+$"))
            and (ext == "tga" or ext == "png" or ext == "ico" or ext == "jpg") then
            local ok_http, res = pcall(deps.binary_http.get, url, { timeout = 20 })
            if ok_http and res and res.status == 200 and res.body and #res.body > 100 then
                if not icon_files.validate(res.body, ext) then
                    -- Steam publishes several icon candidates for the same app. Some
                    -- endpoints answer successfully but contain a format Millennium
                    -- cannot use. This is an expected candidate miss, not a plugin
                    -- warning; the frontend can still provide the official PNG.
                    logger:info("Skipped unusable official icon candidate for " .. steam_app_id
                        .. " ext=" .. ext)
                else
					if not icon_write_is_current() then return cjson.encode({ error = "superseded" }) end
                    local filepath, write_error = icon_files.write(grid_dir, shortcut_app_id, ext, res.body)
                    if filepath then
                        logger:info("Official shortcut icon saved: " .. filepath)
                        return cjson.encode({ saved = true, path = filepath, extension = ext, source = url })
                    end
                    logger:warn("Could not write official shortcut icon: " .. tostring(write_error))
                end
            else
                -- A missing individual format is normal (for example a 404 JPG
                -- while TGA/ICO metadata exists). Keep trying the remaining
                -- candidates without making Millennium mark the plugin as faulty.
                logger:info("Official icon candidate unavailable for " .. steam_app_id
                    .. " ext=" .. ext .. " status=" .. tostring(res and res.status or "error"))
            end
        end
    end

    return cjson.encode({ error = "icon_download_failed" })
end

local function remove_grid_files(grid_dir, sid, suffixes)
    local removed, sid_str = 0, tostring(sid or ""):match("(%d+)") or ""
    if not fs.exists(grid_dir) or sid_str == "" then return 0 end
    local sid_num = tonumber(sid_str)
    local signed_sid = (sid_num and sid_num >= 2147483648) and tostring(math.floor(sid_num - 4294967296)) or nil
    local ids = signed_sid and { sid_str, signed_sid } or { sid_str }
    for _, id in ipairs(ids) do
        for _, suffix in ipairs(suffixes) do
            for _, ext in ipairs({ "jpg", "jpeg", "png", "tga", "ico" }) do
                local filepath = fs.join(grid_dir, id .. suffix .. "." .. ext)
                if fs.exists(filepath) then os.remove(filepath); removed = removed + 1 end
            end
        end
    end
    return removed
end

function M.clear_artwork_except_icon(shortcut_app_id)
	icon_files.invalidate(shortcut_app_id)
    local account_id = get_active_account_id()
    if not account_id then return cjson.encode({ error = "Could not determine active Steam user" }) end
    return cjson.encode({ removed = remove_grid_files(fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid"), tostring(shortcut_app_id), { "p", "_hero", "_logo", "" }), icon_preserved = true })
end

function M.clear_artwork(shortcut_app_id)
	icon_files.invalidate(shortcut_app_id)
    local account_id = get_active_account_id()
    if not account_id then return cjson.encode({ error = "Could not determine active Steam user" }) end
    return cjson.encode({ removed = remove_grid_files(fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid"), tostring(shortcut_app_id), { "p", "_hero", "_logo", "_icon", "" }) })
end

-- Relinking stages replacement artwork before publishing the new mapping. Only
-- slots for which no replacement was found are removed, so a valid Hero/Logo
-- never passes through an avoidable blank state during the transaction.
function M.clear_artwork_slots(request_json)
    local request = util.decode_json(cjson, request_json)
    if not request or type(request) ~= "table" then return cjson.encode({ ok = false, error = "invalid_request" }) end
    local shortcut_app_id = tostring(request.shortcut_app_id or ""):match("(%d+)") or ""
    local requested_slots = type(request.slots) == "table" and request.slots or {}
    if shortcut_app_id == "" then return cjson.encode({ ok = false, error = "invalid_shortcut" }) end
    local suffix_by_slot = { [0] = "p", [1] = "_hero", [2] = "_logo", [3] = "", [4] = "_icon" }
    local suffixes, slots, seen = {}, {}, {}
    for _, raw_slot in ipairs(requested_slots) do
        local slot = math.floor(tonumber(raw_slot) or -1)
        local suffix = suffix_by_slot[slot]
        if suffix ~= nil and not seen[slot] then
            seen[slot] = true
            suffixes[#suffixes + 1] = suffix
            slots[#slots + 1] = slot
        end
    end
    if #suffixes == 0 then return cjson.encode({ ok = true, removed = 0, slots = {} }) end
    local account_id = get_active_account_id()
    if not account_id then return cjson.encode({ ok = false, error = "active_user_not_found" }) end
    local removed = remove_grid_files(fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid"), shortcut_app_id, suffixes)
    return cjson.encode({ ok = true, removed = removed, slots = slots })
end

function M.clear_all_linked_artworks()
    local account_id = get_active_account_id()
    if not account_id then return cjson.encode({ error = "Could not determine active Steam user" }) end
    local grid_dir = fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid")
    if not fs.exists(grid_dir) then return cjson.encode({ removed = 0, ok = true }) end
    local mappings_path, removed = config.mappings_file_path(), 0
    if fs.exists(mappings_path) then
        local f = io.open(mappings_path, "r")
        if f then
            local raw = f:read("*a"); f:close()
            local ok, parsed = pcall(cjson.decode, raw)
            if ok and type(parsed) == "table" then
                for shortcut_id, _ in pairs(parsed) do
                    local sid = tostring(shortcut_id):match("(%d+)$")
                    if sid then
						icon_files.invalidate(sid)
                        removed = removed + remove_grid_files(grid_dir, sid, { "p", "_hero", "_logo", "_icon", "" })
                        local json_path = fs.join(grid_dir, sid .. ".json")
                        if fs.exists(json_path) then os.remove(json_path) end
                    end
                end
            end
        end
    end
    logger:info("Dismount cleanup: removed " .. tostring(removed) .. " grid files for linked shortcuts.")
    return cjson.encode({ ok = true, removed = removed })
end

function M.read_logo_layout_images(request)
    local shortcut_app_id = nil
    if type(request) == "table" then
        shortcut_app_id = tostring(request.shortcut_app_id or request.appid or ""):match("(%d+)")
    elseif type(request) == "string" then
        local ok, parsed = pcall(cjson.decode, request)
        shortcut_app_id = (ok and type(parsed) == "table" and tostring(parsed.shortcut_app_id or parsed.appid or "")) or request
        shortcut_app_id = tostring(shortcut_app_id):match("(%d+)")
    else
        shortcut_app_id = tostring(request or ""):match("(%d+)")
    end
    local id = shortcut_app_id or ""
    local account = get_active_account_id()
    if not id:match("^%d+$") or tonumber(id) < 2147483648 or not account then return cjson.encode({ok=false}) end
    local root = fs.join(millennium.steam_path(), "userdata", account, "config", "grid")
    local result = {ok=true}
    for _, slot in ipairs({"logo", "hero"}) do
        for _, ext in ipairs({"png", "jpg", "webp"}) do
            local path = fs.join(root, id .. "_" .. slot .. "." .. ext)
            if fs.exists(path) then
                local ok, image = pcall(cjson.decode, deps.artwork_image_io.read_local(cjson.encode({path=path})))
                if ok and image.ok then result[slot] = "data:" .. image.mime .. ";base64," .. image.data_base64 end
                break
            end
        end
    end
    return cjson.encode(result)
end

function M.read_custom_logo_position(request_param)
    local shortcut_app_id = nil
    if type(request_param) == "table" then
        shortcut_app_id = tostring(request_param.shortcut_app_id or request_param.appid or ""):match("(%d+)")
    elseif type(request_param) == "string" then
        local ok, parsed = pcall(cjson.decode, request_param)
        shortcut_app_id = (ok and type(parsed) == "table" and tostring(parsed.shortcut_app_id or parsed.appid or "")) or request_param
        shortcut_app_id = tostring(shortcut_app_id):match("(%d+)")
    else
        shortcut_app_id = tostring(request_param or ""):match("(%d+)")
    end

    local account_id = get_active_account_id()
    if not shortcut_app_id or not account_id then return cjson.encode({ ok = false, error = not shortcut_app_id and "invalid_shortcut_app_id" or "active_user_not_found" }) end
    local json_path = fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid", shortcut_app_id .. ".json")
    if not fs.exists(json_path) then return cjson.encode({ ok = true, exists = false }) end
    local f = io.open(json_path, "r")
    if not f then return cjson.encode({ ok = false, error = "open_failed" }) end
    local raw = f:read("*a"); f:close()
    local ok, parsed = pcall(cjson.decode, raw)
    if not ok or type(parsed) ~= "table" then return cjson.encode({ ok = false, error = "parse_failed" }) end
    return cjson.encode({ ok = true, exists = true, version = parsed.nVersion, logo_position = parsed.logoPosition })
end

function M.save_custom_logo_position(request_param)
    local req = nil
    if type(request_param) == "table" then
        req = request_param
    elseif type(request_param) == "string" then
        local ok, parsed = pcall(cjson.decode, request_param)
        if ok and type(parsed) == "table" then req = parsed end
    end
    local shortcut_app_id = req and tostring(req.shortcut_app_id or req.appid or ""):match("(%d+)")
    local pos = req and (req.logo_position or req.logoPosition or req.position)
    local account_id = get_active_account_id()
    if not shortcut_app_id or tonumber(shortcut_app_id) < 2147483648 or not account_id or type(pos) ~= "table" then
        return cjson.encode({ ok = false, error = "invalid_params" })
    end
    local grid_dir = fs.join(millennium.steam_path(), "userdata", account_id, "config", "grid")
    if not fs.exists(grid_dir) then pcall(fs.create_dir_all, grid_dir) end
    local json_path = fs.join(grid_dir, shortcut_app_id .. ".json")
    local payload = cjson.encode({ nVersion = 1, logoPosition = pos })
    local f = io.open(json_path, "w")
    if not f then return cjson.encode({ ok = false, error = "open_failed" }) end
    f:write(payload)
    f:close()
    return cjson.encode({ ok = true, exists = true, path = json_path })
end

return M
end
