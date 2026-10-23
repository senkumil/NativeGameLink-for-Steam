return function(deps)
local config, cjson, mappings = deps.config, deps.cjson, deps.mappings
local M = {}
local FILENAME = "community_item_options.json"

local function parse(raw)
    if type(raw) == "table" then return raw end
    if type(raw) ~= "string" or #raw > 2 * 1024 * 1024 then return nil end
    local ok, value = pcall(cjson.decode, raw)
    return ok and type(value) == "table" and value or nil
end

local function scope(request)
    if not request then return nil, "invalid_request" end
    local shortcut, steam = tostring(request.shortcut_app_id or ""), tostring(request.steam_app_id or "")
    if #shortcut > 20 or #steam > 20 or not shortcut:match("^%d+$") or not steam:match("^%d+$")
        or tonumber(shortcut) == 0 or tonumber(steam) == 0 then return nil, "missing_game_id" end
    -- A local preview belongs to this exact link, never to a native Steam app
    -- or every installation that happens to share its metadata AppID.
    local linked = mappings.read_mappings()
    -- Mapping keys are namespaced by the shared mapping layer. Bare decimal
    -- keys are titles, not shortcut identities, and must not authorize a link.
    local target = linked["shortcut:" .. shortcut]
    local numeric = tonumber(shortcut)
    if target == nil and numeric > 2147483647 and numeric <= 4294967295 then
        target = linked["shortcut:" .. string.format("%.0f", numeric - 4294967296)]
    end
    if tostring(target or "") ~= steam then return nil, "not_linked" end
    return shortcut .. ":" .. steam
end

local function clean_id(value)
    if type(value) ~= "string" or #value == 0 or #value > 2048 or value:find("[%z\1-\31]") then return nil end
    return value
end

local function clean(request)
    local cards, seen = {}, {}
    if request.auto_foil ~= nil and type(request.auto_foil) ~= "boolean" then return nil, "invalid_auto_foil" end
    if request.card_ids ~= nil and type(request.card_ids) ~= "table" then return nil, "invalid_cards" end
    local count = 0
    for key in pairs(request.card_ids or {}) do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then return nil, "invalid_cards" end
        count = count + 1
    end
    if count > 512 then return nil, "too_many_cards" end
    for index = 1, count do
        if request.card_ids[index] == nil then return nil, "invalid_cards" end
    end
    for index, value in ipairs(request.card_ids or {}) do
        if index > 512 then return nil, "too_many_cards" end
        local id = clean_id(value)
        if not id then return nil, "invalid_card_id" end
        if not seen[id] then seen[id] = true; cards[#cards + 1] = id end
    end
    local badge = request.badge_id
    if badge == cjson.null or badge == "" then badge = nil end
    if badge ~= nil and not clean_id(badge) then return nil, "invalid_badge_id" end
    if request.card_border ~= nil and request.card_border ~= "normal" and request.card_border ~= "foil" then
        return nil, "invalid_card_border"
    end
    local record = { enabled = request.enabled == true, card_border = request.card_border or "normal", card_ids = cards, badge_id = badge }
    if request.auto_foil == true then
        if not record.enabled or record.card_border ~= "foil" then return nil, "invalid_auto_foil" end
        record.auto_foil = true
    end
    return record
end

local function response(record)
    -- This preset is declarative: missing preferences do not require a network
    -- catalogue or write synthetic card/badge IDs into the user's settings.
    local data = record or { enabled = true, card_border = "foil", card_ids = {}, auto_foil = true }
    return cjson.encode({ ok = true, enabled = data.enabled == true, card_border = data.card_border,
        card_ids = data.card_ids, badge_id = data.badge_id, auto_foil = data.auto_foil == true and true or nil })
end

function M.get_options(raw)
    local key, err = scope(parse(raw))
    if not key then return cjson.encode({ ok = false, error = err }) end
    local values = config.read_json(config.state_path(FILENAME), {})
    local record = type(values) == "table" and values[key] or nil
    return response(type(record) == "table" and clean(record) or nil)
end

function M.set_options(raw)
    local request = parse(raw)
    local key, err = scope(request)
    if not key then return cjson.encode({ ok = false, error = err }) end
    local record
    if request.reset ~= true then
        record, err = clean(request)
        if not record then return cjson.encode({ ok = false, error = err }) end
    end
    local values = config.read_json(config.state_path(FILENAME), {})
    if type(values) ~= "table" then values = {} end
    if not values[key] and record then
        local count = 0
        for _ in pairs(values) do count = count + 1 end
        if count >= 4096 then return cjson.encode({ ok = false, error = "too_many_games" }) end
    end
    values[key] = record
    local ok = config.write_json_atomic(config.state_path(FILENAME), values)
    if not ok then return cjson.encode({ ok = false, error = "write_failed" }) end
    return response(record)
end

function M.clear_all()
    return config.write_json_atomic(config.state_path(FILENAME), {})
end

return M
end
