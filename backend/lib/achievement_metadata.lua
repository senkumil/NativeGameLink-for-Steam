-- Achievement identities come from a schema or Steam's own display map, never
-- from a percentage/order heuristic. Only public schema fields are retained.
return function(deps)
local fs, util, millennium = deps.fs, deps.util, deps.millennium
local state = deps.achievement_state
local M = {}
local VERSION, TTL, STALE_TTL = 4, 1800, 30 * 86400

function M.schema_order(value)
    local n = tonumber(value)
    return n and n >= 0 and n <= 68719476735 and n == math.floor(n) and n or nil
end
local function row_order(row, index)
    return M.schema_order(row.schema_order)
        or (type(index) == "number" and index >= 1 and M.schema_order(index - 1) or nil)
end
local function native_order(stat, bit)
    local s, b = M.schema_order(stat), M.schema_order(bit)
    return s and s <= 2147483647 and b and b < 32 and (s * 32 + b) or nil
end

function M.icon_url(appid, icon)
    icon = tostring(icon or "")
    if icon == "" then return "" end
    if icon:match("^https?://") then
        local legacy_app, file = icon:match("^https?://[^/]+/steamcommunity/public/images/apps/(%d+)/([^/?]+)$")
        if not legacy_app then return icon end
        appid, icon = legacy_app, file
    end
    local base = icon:match("([^/\\]+)$") or icon
    if base == "" then return "" end
    if not base:match("%.[%w]+$") then base = base .. ".jpg" end
    return "https://shared.fastly.steamstatic.com/community_assets/images/apps/" .. tostring(appid) .. "/" .. base
end

local function read_native_schema(appid)
    if not millennium or type(millennium.steam_path) ~= "function"
        or not util or type(util.parse_binary_vdf_object) ~= "function" then return nil end
    local steam = millennium.steam_path()
    if type(steam) ~= "string" or steam == "" then return nil end
    local path = fs.join(steam, "appcache", "stats", "UserGameStatsSchema_" .. tostring(appid) .. ".bin")
    if not fs.exists(path) then return nil end
    local file = io.open(path, "rb")
    if not file then return nil end
    local bytes = file:read(4 * 1024 * 1024 + 1)
    file:close()
    if not bytes or #bytes > 4 * 1024 * 1024 then return nil end
    local ok, parsed, _, parse_error = pcall(util.parse_binary_vdf_object, bytes, 1, 0)
    local schema = ok and not parse_error and type(parsed) == "table" and parsed[tostring(appid)] or nil
    return type(schema) == "table" and type(schema.stats) == "table" and schema or nil
end

-- Only the installed Steam schema establishes write restrictions. Public API
-- hints, local game JSON and display-map fields are not permission evidence.
function M.client_permissions(appid)
    local schema = read_native_schema(appid)
    if not schema then return {}, false end
    local result, count, all_protected = {}, 0, true
    for stat_key, stat in pairs(schema.stats) do
        for bit_key, item in pairs(type(stat) == "table" and type(stat.bits) == "table" and stat.bits or {}) do
            if type(item) ~= "table" or type(item.name) ~= "string" or item.name == "" or #item.name > 256
                or result[item.name] then return {}, false end
            count = count + 1
            if count > 2000 then return {}, false end
            local permission = item.permission
            local protected = type(permission) == "number" and permission >= 0 and permission <= 2147483647
                and permission == math.floor(permission) and permission % 4 ~= 0
            local entry = { name = item.name, schema_order = native_order(stat_key, bit_key) }
            if protected then entry.client_writable = false else all_protected = false end
            result[item.name] = entry
        end
    end
    return result, count > 0 and all_protected
end

function M.apply_client_permissions(appid, by_name)
    local permissions = M.client_permissions(appid)
    for name, item in pairs(by_name) do
        -- Revalidate even cached metadata, since Steam can update the schema
        -- independently of the localized text/rarity cache's expiration.
        if type(item) == "table" then
            item.client_writable = nil
            if permissions[name] and permissions[name].client_writable == false then item.client_writable = false end
            item.schema_order = permissions[name] and permissions[name].schema_order or M.schema_order(item.schema_order)
        end
    end
    return by_name
end

function M.read_cached(path, appid, language, allow_stale)
    local entry = state.decode(path)
    -- Version 3 has verified identities/text but no source ordering. Refresh it
    -- normally, retaining that metadata if the schema service is unavailable.
    if type(entry) ~= "table" or (entry.version ~= VERSION and not (allow_stale and entry.version == 3)) or tostring(entry.appid) ~= tostring(appid)
        or entry.language ~= language or type(entry.by_name) ~= "table" then return nil end
    local age = os.time() - (tonumber(entry.fetched_at) or 0)
    if age < 0 or age > (allow_stale and STALE_TTL or TTL) then return nil end
    for _, row in pairs(entry.by_name) do
        if type(row) == "table" then
            row.icon = M.icon_url(appid, row.icon)
            row.icongray = M.icon_url(appid, row.icongray)
        end
    end
    return entry.by_name
end

function M.cache_record(appid, language, by_name)
    return { version = VERSION, appid = tostring(appid), language = language,
        fetched_at = os.time(), by_name = by_name }
end

function M.normalize_rows(appid, rows)
    local result, count = {}, 0
    for index, row in pairs(type(rows) == "table" and rows or {}) do
        if type(row) == "table" then
            local name = row.strID or row.name
            if type(name) == "string" and name ~= "" and #name <= 256 and not result[name] then
                count = count + 1
                if count > 2000 then return {} end
                result[name] = { name = name, title = tostring(row.strName or row.title or name),
                    description = tostring(row.strDescription or row.description or ""),
                    icon = M.icon_url(appid, row.strImage or row.icon),
                    icongray = M.icon_url(appid, row.strImageGray or row.icongray or row.strImage or row.icon),
                    hidden = row.bHidden == true or row.hidden == true, schema_order = row_order(row, index),
                    global_percent = tonumber(row.flAchieved or row.global_percent) }
            end
        end
    end
    return result
end

-- IPlayerService supplies the API ID together with localized text and both
-- icons, including games that are not owned by the signed-in Steam account.
function M.normalize_public_rows(appid, rows, icon_url)
    local result, count = {}, 0
    for index, row in pairs(type(rows) == "table" and rows or {}) do
        if type(row) == "table" and type(row.internal_name) == "string" then
            local name = row.internal_name
            if name ~= "" and #name <= 256 and not result[name] then
                count = count + 1
                if count > 2000 then return {} end
                local title = type(row.localized_name) == "string" and row.localized_name or ""
                local icon = icon_url(appid, row.icon)
                local gray = icon_url(appid, row.icon_gray)
                result[name] = { name = name, title = title ~= "" and title or name,
                    description = type(row.localized_desc) == "string" and row.localized_desc or "",
                    icon = icon, icongray = gray ~= "" and gray or icon,
                    hidden = row.hidden == true, schema_order = row_order(row, index), global_percent = tonumber(row.player_percent_unlocked) }
            end
        end
    end
    return result
end

function M.native_schema(appid, localized, icon_url)
    local schema = read_native_schema(appid)
    if schema then
        local result = {}
        for _, stat in pairs(schema.stats) do
            for _, item in pairs(type(stat) == "table" and type(stat.bits) == "table" and stat.bits or {}) do
                if type(item) == "table" and type(item.name) == "string" and type(item.display) == "table" then
                    local d = item.display
                    result[item.name] = { name = item.name, title = localized(d.name),
                        description = localized(d.desc), icon = icon_url(appid, d.icon),
                        icongray = icon_url(appid, d.icon_gray), hidden = d.hidden == 1 or d.hidden == true }
                end
            end
        end
        if next(result) then return M.apply_client_permissions(appid, result), "steam_schema" end
    end
    local steam = millennium and type(millennium.steam_path) == "function" and millennium.steam_path() or nil
    if type(steam) ~= "string" or steam == "" then return {}, "" end
    local account = type(util.get_active_account_id) == "function" and util.get_active_account_id() or nil
    if account then
        local cache_path = fs.join(steam, "userdata", account, "config", "librarycache", tostring(appid) .. ".json")
        local entries = state.decode(cache_path)
        for _, pair in pairs(type(entries) == "table" and entries or {}) do
            if type(pair) == "table" and pair[1] == "achievementmap" and type(pair[2]) == "table" then
                local data = pair[2].data
                if type(data) == "string" then
                    local ok, decoded = pcall(deps.cjson.decode, data)
                    data = ok and decoded or nil
                end
                for _, app in pairs(type(data) == "table" and data or {}) do
                    if type(app) == "table" and tostring(app[1]) == tostring(appid) then
                        local rows = {}
                        for _, entry in pairs(type(app[2]) == "table" and app[2] or {}) do
                            if type(entry) == "table" and type(entry[2]) == "table" then rows[#rows + 1] = entry[2] end
                        end
                        local result = M.normalize_rows(appid, rows)
                        if next(result) then return result, "steam_display_map" end
                    end
                end
            end
        end
    end
    return {}, ""
end

function M.enrich_by_icon(schema, community, percentages)
    local function icon_key(value)
        return tostring(value or ""):gsub("[?#].*$", ""):match("([^/\\]+)$")
    end
    local by_icon = {}
    for _, row in ipairs(community) do
        local icon = icon_key(row.icon)
        if icon then by_icon[icon] = by_icon[icon] == nil and row or false end
    end
    for name, item in pairs(schema) do
        local icon = icon_key(item.icon)
        local row = icon and by_icon[icon]
        if row then
            if row.title ~= "" then item.title = row.title end
            if row.description ~= "" then item.description = row.description end
        end
        item.global_percent = tonumber(percentages[name]) or item.global_percent
    end
    return schema
end

return M
end
