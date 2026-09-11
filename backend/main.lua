local logger     = require("logger")
local millennium = require("millennium")
local http       = require("http")
local cjson      = require("json")
local fs         = require("fs")

local USER_AGENT = "NativeGameLink-for-Steam/2.0.0"

local function resolve_backend_dir()
    local raw = tostring(MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE or "")
    if raw == "" then error("Millennium backend path is unavailable") end
    if raw:lower():match("%.lua$") then return fs.parent_path(raw) end
    if fs.exists(fs.join(raw, "main.lua")) then return raw end
    return raw
end

local BACKEND_DIR = resolve_backend_dir()

local function load_factory(name)
    local path = fs.join(BACKEND_DIR, "lib", name .. ".lua")
    local chunk, err = loadfile(path)
    if not chunk then error("Could not load backend module " .. name .. ": " .. tostring(err)) end
    local factory = chunk()
    if type(factory) ~= "function" then error("Backend module " .. name .. " did not return a factory") end
    return factory
end

local deps = {
    logger = logger,
    millennium = millennium,
    http = http,
    cjson = cjson,
    fs = fs,
    user_agent = USER_AGENT,
}

local LAZY_MODULES = {
    util = "util",
    config = "config",
    lru_cache = "lru_cache",
    ttl_cache = "ttl_cache",
    process = "process",
    artwork_icon = "artwork_icon",
    binary_http = "binary_http",
    shortcut_detection_text = "shortcut_detection_text",
    shortcut_detection_aliases = "shortcut_detection_aliases",
    shortcut_detection_rules = "shortcut_detection_rules",
    shortcut_detection_tracking = "shortcut_detection_tracking",
    shortcut_detection_pe = "shortcut_detection_pe",
    shortcut_detection_local = "shortcut_detection_local",
    shortcut_detection_catalog = "shortcut_detection_catalog",
    mappings = "mappings",
    store = "store",
    shortcut_detection = "shortcut_detection",
    shortcut_registry = "shortcut_registry",
    community = "community",
    news = "news",
    social = "social",
    artwork_candidates = "artwork_candidates",
    artwork = "artwork",
    artwork_image_io = "artwork_image_io",
    achievement_settings = "achievement_settings",
    achievement_policy = "achievement_policy",
    achievement_sources = "achievement_sources",
    achievement_state = "achievement_state",
    achievement_export = "achievement_export",
    steamworks_sync = "steamworks_sync",
    steam_card_farmer = "steam_card_farmer",
    achievements = "achievements",
    playtime = "playtime",
}

local loading_modules = {}
setmetatable(deps, {
    __index = function(t, key)
        local module_name = LAZY_MODULES[key]
        if not module_name then return nil end
        if loading_modules[key] then
            error("Circular lazy backend dependency while loading " .. tostring(key))
        end
        loading_modules[key] = true
        local ok, instance_or_error = pcall(function()
            return load_factory(module_name)(t)
        end)
        loading_modules[key] = nil
        if not ok then error(instance_or_error) end
        rawset(t, key, instance_or_error)
        return instance_or_error
    end,
})

local function module(name)
    return deps[name]
end

-- Millennium discovers frontend-callable functions by global name. Keep the
-- IPC surface stable while delegating implementation to cohesive modules.
function save_mapping(non_steam_id, steam_id) return module("mappings").save_mapping(non_steam_id, steam_id) end
function remove_mapping(non_steam_id) return module("mappings").remove_mapping(non_steam_id) end
function update_mappings(request_json) return module("mappings").update_mappings(request_json) end
function get_all_mappings() return module("mappings").get_all_mappings() end
function fetch_game_data(steam_app_id, language) return module("store").fetch_game_data(steam_app_id, language) end
function get_shortcut_details(shortcut_app_id, title) return module("shortcut_detection").get_shortcut_details(shortcut_app_id, title) end
function list_shortcuts() return module("shortcut_registry").list() end
function detect_game_candidates(request_json) return module("shortcut_detection").detect_game_candidates(request_json) end
function detect_game_candidates_local(request_json) return module("shortcut_detection").detect_game_candidates_local(request_json) end
function fetch_news(steam_app_id, language) return module("news").fetch_news(steam_app_id, language) end
function fetch_partner_events(steam_app_id, language) return module("news").fetch_partner_events(steam_app_id, language) end
function fetch_published_file_previews(file_ids_csv) return module("social").fetch_published_file_previews(file_ids_csv) end
function fetch_friend_review(steam_id64, steam_app_id) return module("social").fetch_friend_review(steam_id64, steam_app_id) end
function fetch_friend_personas(steam_ids_csv) return module("social").fetch_friend_personas(steam_ids_csv) end
function fetch_community_activity(steam_app_id, steam_id64) return module("social").fetch_community_activity(steam_app_id, steam_id64) end
function fetch_community_content(steam_app_id, language)
    local ok, res = pcall(module("community").fetch_community_content, steam_app_id, language)
    return ok and res or cjson.encode({ items = {}, available = false, error = "backend_error" })
end
function fetch_community_items_catalog(steam_app_id, language)
    local ok, res = pcall(module("community").fetch_community_items_catalog, steam_app_id, language)
    return ok and res or cjson.encode({ error = "backend_error" })
end
function fetch_library_assets(request_json) return module("artwork").fetch_library_assets(request_json) end
function fetch_community_artwork(request_json)
    local ok, res = pcall(module("artwork").fetch_community_artwork, request_json)
    return ok and res or cjson.encode({ error = "backend_error" })
end
function fetch_community_artwork_candidates(request_json)
    local ok, res = pcall(module("artwork_candidates").fetch, request_json)
    return ok and res or cjson.encode({ eligible = false, error = "backend_error" })
end
function fetch_artwork_image(request_json)
    local ok, res = pcall(module("artwork_image_io").fetch_remote, request_json)
    return ok and res or cjson.encode({ ok = false, error = "backend_error" })
end
function read_local_artwork_image(request_json) return module("artwork_image_io").read_local(request_json) end
function validate_steamgriddb_api_key(request_json) return module("artwork").validate_steamgriddb_api_key(request_json) end
function save_shortcut_icon(request_json) return module("artwork").save_shortcut_icon(request_json) end
function save_shortcut_artwork(request_json) return module("artwork").save_shortcut_artwork(request_json) end
function clear_artwork(shortcut_app_id) return module("artwork").clear_artwork(shortcut_app_id) end
function clear_artwork_except_icon(shortcut_app_id) return module("artwork").clear_artwork_except_icon(shortcut_app_id) end
function clear_artwork_slots(request_json) return module("artwork").clear_artwork_slots(request_json) end
function clear_all_linked_artworks() return module("artwork").clear_all_linked_artworks() end
function read_custom_logo_position(request_json) return module("artwork").read_custom_logo_position(request_json) end
function save_custom_logo_position(request_json) return module("artwork").save_custom_logo_position(request_json) end
function read_logo_layout_images(request) return module("artwork").read_logo_layout_images(request) end
function get_achievement_base_path() return module("achievements").get_achievement_base_path() end
function set_achievement_base_path(path) return module("achievements").set_achievement_base_path(path) end
function get_game_achievement_path(request_json) return module("achievements").get_game_achievement_path(request_json) end
function set_game_achievement_path(request_json) return module("achievements").set_game_achievement_path(request_json) end
function get_game_achievement_options(request_json) return module("achievements").get_game_achievement_options(request_json) end
function set_game_achievement_options(request_json) return module("achievements").set_game_achievement_options(request_json) end
function get_game_achievement_capabilities(request_json) return module("achievements").get_game_achievement_capabilities(request_json) end
function export_achievements_json(request_json) return module("achievement_export").export_achievements_json(request_json) end
function fetch_steam_account_achievements(steam_app_id) return module("steamworks_sync").fetch_steam_account_achievements(steam_app_id) end
function sync_steam_account_achievements(request_json) return module("steamworks_sync").sync_steam_account_achievements(request_json) end
function start_steam_card_farming(request_json) return module("steam_card_farmer").start_card_farming(request_json) end
function stop_steam_card_farming() return module("steam_card_farmer").stop_card_farming() end
function get_steam_card_farming_status() return module("steam_card_farmer").get_card_farming_status() end
function fetch_local_achievement_data(request_json, language, state_app_id)
    return module("achievements").fetch_local_achievement_data(request_json, language, state_app_id)
end
function start_playtime_session(request_json) return module("playtime").start_session(request_json) end
function ping_playtime_session(request_json) return module("playtime").ping_session(request_json) end
function stop_playtime_session(request_json) return module("playtime").stop_session(request_json) end
function get_playtime_data(request_json) return module("playtime").get_playtime(request_json) end
function get_all_playtime_data(request_json) return module("playtime").get_all_playtime(request_json) end
function set_playtime_data(request_json) return module("playtime").set_playtime(request_json) end
function suppress_admin_prompt(request_json) return module("util").suppress_admin_prompt(request_json) end
function neutralize_steam_appid_file(request_json) return module("util").neutralize_steam_appid_file(request_json) end
function restore_steam_appid_file(request_json) return module("util").restore_steam_appid_file(request_json) end
function factory_reset(request_json)
    local ok_req, req = pcall(cjson.decode, tostring(request_json or "{}"))
    local delete_playtime = ok_req and type(req) == "table" and req.delete_playtime == true
    logger:info("Executing factory reset (delete_playtime=" .. tostring(delete_playtime) .. ")")
    pcall(function() module("artwork").clear_all_linked_artworks() end)
    pcall(function() module("mappings").clear_all() end)
    pcall(function() module("achievements").clear_all_settings() end)
    if delete_playtime then
        pcall(function() module("playtime").clear_all() end)
    end
    return cjson.encode({ ok = true, deleted_playtime = delete_playtime })
end
function fe_log(msg)
    logger:info("[FE] " .. tostring(msg))
    return "ok"
end

local function on_load()
    -- Millennium waits for ready() before exposing the plugin frontend. Keep this
    -- path deliberately constant-time: diagnostics, state parsing and other disk
    -- work belong to normal callable paths after the UI is already available.
    logger:info("NativeGameLink for Steam plugin loaded; publishing readiness immediately")
    millennium.ready()
end

local function on_unload()
    local loaded_playtime = rawget(deps, "playtime")
    if loaded_playtime then
        local ok_flush, flush_err = pcall(function() loaded_playtime.flush() end)
        if not ok_flush then logger:warn("Could not flush playtime sessions: " .. tostring(flush_err)) end
    end
    logger:info("NativeGameLink for Steam plugin unloaded")
end

local function on_frontend_loaded()
    logger:info("Frontend loaded - NativeGameLink for Steam ready")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
}
