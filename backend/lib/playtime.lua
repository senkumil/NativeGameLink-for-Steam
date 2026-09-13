return function(deps)
local logger = deps.logger
local cjson = deps.cjson
local config = deps.config
local fs = deps.fs
local M = {}

-- Keep the canonical history outside the plugin directory so plugin updates,
-- clean reinstalls and Steam's plugin-folder cleanup cannot remove it.
local SESSIONS_FILE = config.persistent_path("playtime_sessions.json")
local SESSION_BACKUP_COUNT = 3
local STORE = { version = 2, sessions = {}, aliases = {} }
local STORE_LOADED = false
local STORE_DIRTY = false
local LAST_SAVE_AT = 0
local LAST_EXTERNAL_CHECK_AT = 0
local LAST_FILE_MTIME = 0
local EXTERNAL_CHECK_INTERVAL_SECONDS = 2
local HEARTBEAT_FLUSH_INTERVAL_SECONDS = 30

local function normalize_title_key(title)
    local text = tostring(title or ""):lower()
    text = text:gsub("™", ""):gsub("®", ""):gsub("©", "")
    text = text:gsub("[’'`´]", ""):gsub("[–—_:|/\\%[%]%(%){}]+", " ")
    text = text:gsub("[^%w]+", " "):gsub("%s+", " ")
    return text:match("^%s*(.-)%s*$") or ""
end

local function parse_request(request_json)
    if type(request_json) == "table" then return request_json end
    if type(request_json) == "string" and request_json ~= "" then
        local ok, parsed = pcall(cjson.decode, request_json)
        if ok and type(parsed) == "table" then return parsed end
    end
    return {}
end

local function candidate_keys(shortcut_app_id, steam_app_id, title)
    local keys, seen = {}, {}
    local function add(key)
        if key and key ~= "" and not seen[key] then
            seen[key] = true
            keys[#keys + 1] = key
        end
    end
    if shortcut_app_id and tostring(shortcut_app_id):match("^%d+$") then
        local sid = tostring(shortcut_app_id)
        add("id:" .. sid)
        add(sid)
    end
    if steam_app_id and tostring(steam_app_id):match("^%d+$") then
        add("steam:" .. tostring(steam_app_id))
    end
    local normalized_title = normalize_title_key(title)
    if normalized_title ~= "" then
        add("title:" .. normalized_title)
        add(normalized_title) -- legacy title alias
    end
    return keys
end

local function empty_store()
    return { version = 2, sessions = {}, aliases = {} }
end

local function valid_shortcut_id(value)
    local id = tostring(value or "")
    return id:match("^%d+$") and id or nil
end

local function finite_number(value)
    local number = tonumber(value)
    if not number or number ~= number or number == math.huge or number == -math.huge then return nil end
    return number
end

-- Never let a malformed runtime record break every playtime request. Keep the
-- persisted schema intentionally small and normalize numeric strings emitted
-- by older versions before doing arithmetic with them.
local function sanitize_session_list(list)
    local cleaned = {}
    if type(list) ~= "table" then return cleaned end
    for _, session in ipairs(list) do
        if type(session) == "table" then
            local started = finite_number(session.started_at)
            local ended = finite_number(session.ended_at)
            if started and started >= 0 then
                started = math.floor(started)
                ended = math.floor(ended or started)
                if ended >= started then
                    local normalized = { started_at = started, ended_at = ended }
                    if type(session.instance_id) == "string" and #session.instance_id <= 256 and session.instance_id ~= "" then
                        normalized.instance_id = session.instance_id
                    end
                    cleaned[#cleaned + 1] = normalized
                end
            end
        end
    end
    return cleaned
end

local function sanitize_store(decoded)
    if type(decoded) ~= "table" or type(decoded.sessions) ~= "table" or type(decoded.aliases) ~= "table" then return nil end
    local loaded = empty_store()
    for key, list in pairs(decoded.sessions) do
        local canonical = valid_shortcut_id(key)
        if canonical then loaded.sessions[canonical] = sanitize_session_list(list) end
    end
    for alias, canonical in pairs(decoded.aliases) do
        local id = valid_shortcut_id(canonical)
        if type(alias) == "string" and id and loaded.sessions[id] then
            loaded.aliases[alias] = id
        end
    end
    return loaded
end

local function session_signature(list)
    local ok, encoded = pcall(cjson.encode, list)
    return ok and encoded or nil
end

local function migrate_legacy_store(legacy)
    local migrated = empty_store()
    local by_signature = {}
    local canonical_count = 0

    -- Older builds stored the same session array below id:, steam: and title
    -- keys. Prefer the id:<shortcutAppId> entries as the only canonical data.
    for key, list in pairs(legacy) do
        local canonical = type(key) == "string" and key:match("^id:(%d+)$") or nil
        if canonical and type(list) == "table" then
            local safe_list = sanitize_session_list(list)
            migrated.sessions[canonical] = safe_list
            canonical_count = canonical_count + 1
            local signature = session_signature(safe_list)
            if signature then by_signature[signature] = canonical end
        end
    end

    for key, list in pairs(legacy) do
        if type(key) == "string" and type(list) == "table" and not key:match("^id:%d+$") then
            local signature = session_signature(sanitize_session_list(list))
            local canonical = signature and by_signature[signature] or nil
            -- A legacy file with a single shortcut can safely recover aliases
            -- even if a previously duplicated list drifted before migration.
            if not canonical and canonical_count == 1 then
                for id in pairs(migrated.sessions) do canonical = id; break end
            end
            if canonical then migrated.aliases[key] = canonical end
        end
    end

    if canonical_count == 0 and next(legacy) ~= nil then
        logger:warn("Could not migrate playtime entries without shortcut IDs; keeping an empty canonical store")
    end
    return migrated
end

local function decode_store_file(path)
    local data = config.read_text(path)
    if not data or data == "" then return nil, false end
    local ok, decoded = pcall(cjson.decode, data)
    if not ok or type(decoded) ~= "table" then return nil, true end
    local loaded = sanitize_store(decoded)
    if loaded then return loaded, true end
    return migrate_legacy_store(decoded), true
end

local function save_sessions()
    local ok, err = config.write_json_atomic_with_backups(SESSIONS_FILE, STORE, SESSION_BACKUP_COUNT)
    if not ok then logger:warn("Could not save playtime sessions: " .. tostring(err or "write_failed")) end
    if ok then
        STORE_DIRTY = false
        LAST_SAVE_AT = os.time()
        LAST_FILE_MTIME = tonumber(fs.last_write_time(SESSIONS_FILE) or 0) or 0
    end
    return ok
end

local function prune_foreign_sessions()
    local registry = deps.shortcut_registry
    if not registry or type(registry.list) ~= "function" then return 0 end
    -- Playtime and last session history are permanently preserved per-user in
    -- playtime_sessions.json across shortcut deletions, unlinks and relinks.
    -- Only prune malformed or unparseable keys to protect store integrity.
    local removed = 0
    for canonical, list in pairs(STORE.sessions) do
        if not valid_shortcut_id(canonical) or type(list) ~= "table" then
            STORE.sessions[canonical] = nil
            removed = removed + 1
        end
    end
    if removed > 0 then
        for alias, canonical in pairs(STORE.aliases) do
            if not STORE.sessions[tostring(canonical or "")] then STORE.aliases[alias] = nil end
        end
        STORE_DIRTY = true
    end
    return removed
end

local function load_sessions()
    local now = os.time()
    if STORE_LOADED then
        if STORE_DIRTY or now - LAST_EXTERNAL_CHECK_AT < EXTERNAL_CHECK_INTERVAL_SECONDS then return end
        LAST_EXTERNAL_CHECK_AT = now
        local modified = tonumber(fs.last_write_time(SESSIONS_FILE) or 0) or 0
        if modified == LAST_FILE_MTIME then return end
    end
    STORE_LOADED = true
    LAST_EXTERNAL_CHECK_AT = now
    local candidates = {
        { path = SESSIONS_FILE, label = "persistent" },
        { path = SESSIONS_FILE .. ".bak", label = "persistent backup" },
        { path = SESSIONS_FILE .. ".bak.1", label = "persistent backup 1" },
        { path = SESSIONS_FILE .. ".bak.2", label = "persistent backup 2" },
    }
    local seen_paths = {}
    for _, candidate in ipairs(candidates) do
        if not seen_paths[candidate.path] then
            seen_paths[candidate.path] = true
            local loaded, existed = decode_store_file(candidate.path)
            if existed and not loaded then
                logger:warn("Could not parse playtime sessions candidate: " .. tostring(candidate.path))
            elseif loaded then
                STORE = loaded
                LAST_FILE_MTIME = tonumber(fs.last_write_time(SESSIONS_FILE) or 0) or 0
                local removed_foreign = prune_foreign_sessions()
                if removed_foreign > 0 then
                    logger:info("Discarded " .. tostring(removed_foreign) .. " playtime history record(s) that do not belong to the active Steam shortcut registry")
                end
                if candidate.path ~= SESSIONS_FILE then STORE_DIRTY = true end
                if STORE_DIRTY and save_sessions() and candidate.path ~= SESSIONS_FILE then
                    logger:info("Recovered playtime sessions from " .. candidate.label)
                end
                return
            end
        end
    end

    STORE = empty_store()
    LAST_FILE_MTIME = tonumber(fs.last_write_time(SESSIONS_FILE) or 0) or 0
    logger:info("No valid playtime session store found; starting with an empty store")
end

local function flush_if_due(force)
    if not STORE_DIRTY then return true end
    if not force and os.time() - LAST_SAVE_AT < HEARTBEAT_FLUSH_INTERVAL_SECONDS then return true end
    return save_sessions()
end

local function collapse_sessions(sessions)
    if type(sessions) ~= "table" or #sessions == 0 then return end
    local two_weeks_ago = os.time() - (14 * 24 * 60 * 60)
    local unix_epoch = 0
    local zero_session, latest_session = nil, nil
    local stale_sessions = {}

    for _, session in ipairs(sessions) do
        if session.started_at == unix_epoch then zero_session = session end
        if not latest_session or (session.ended_at or 0) > (latest_session.ended_at or 0) then
            latest_session = session
        end
        if (session.ended_at or 0) < two_weeks_ago then stale_sessions[#stale_sessions + 1] = session end
    end

    if not zero_session and #stale_sessions > 0 then
        zero_session = { started_at = unix_epoch, ended_at = unix_epoch }
        table.insert(sessions, 1, zero_session)
    end
    if not zero_session then return end

    for _, session in ipairs(stale_sessions) do
        if session ~= latest_session and session ~= zero_session then
            zero_session.ended_at = zero_session.ended_at + math.max(0, (session.ended_at or 0) - (session.started_at or 0))
            for index = #sessions, 1, -1 do
                if sessions[index] == session then table.remove(sessions, index); break end
            end
        end
    end
end

local function register_aliases(keys, canonical)
    if not canonical or canonical == "" then return end
    for _, key in ipairs(keys) do
        -- Any key that is not the exact canonical shortcut ID itself should point to the canonical ID.
        if key ~= ("id:" .. canonical) and key ~= canonical then
            if STORE.aliases[key] ~= canonical then
                STORE.aliases[key] = canonical
                STORE_DIRTY = true
            end
        end
    end
end

local function canonical_from_request(req, keys)
    local direct = valid_shortcut_id(req.shortcut_app_id or req.state_app_id or req.local_app_id)
    -- Steam regenerates a shortcut AppID when identity inputs such as its name
    -- or executable change. Prefer that ID only once it owns sessions; until
    -- then recover the existing canonical history through the official AppID
    -- or normalized-title alias before creating a new empty timeline.
    if direct and STORE.sessions[direct] then return direct end
    for _, key in ipairs(keys) do
        local canonical = valid_shortcut_id(STORE.aliases[key])
        if canonical and STORE.sessions[canonical] then return canonical end
    end
    return direct
end

local function find_sessions_list(req, keys)
    local direct = valid_shortcut_id(req.shortcut_app_id or req.state_app_id or req.local_app_id)
    local canonical = canonical_from_request(req, keys)

    -- If a new/relinked shortcut ID is provided and existing sessions were
    -- recovered via steam_app_id or title alias from a previous shortcut,
    -- migrate and merge the accumulated history to the current shortcut.
    if direct and canonical and direct ~= canonical and STORE.sessions[canonical] then
        if not STORE.sessions[direct] then
            STORE.sessions[direct] = STORE.sessions[canonical]
            STORE.sessions[canonical] = nil
        else
            for _, session in ipairs(STORE.sessions[canonical]) do
                table.insert(STORE.sessions[direct], session)
            end
            collapse_sessions(STORE.sessions[direct])
            STORE.sessions[canonical] = nil
        end
        register_aliases(candidate_keys(canonical), direct)
        canonical = direct
        STORE_DIRTY = true
    end

    if canonical then
        register_aliases(keys, canonical)
    end
    if STORE_DIRTY then
        save_sessions()
    end
    return canonical and STORE.sessions[canonical] or nil, canonical
end

local function ensure_sessions_list(req, keys)
    local sessions, canonical = find_sessions_list(req, keys)
    if not canonical then
        canonical = valid_shortcut_id(req.shortcut_app_id or req.state_app_id or req.local_app_id)
    end
    if not canonical then return nil, nil end
    if type(STORE.sessions[canonical]) ~= "table" then
        STORE.sessions[canonical] = {}
        STORE_DIRTY = true
    end
    register_aliases(keys, canonical)
    if STORE_DIRTY then
        save_sessions()
    end
    return STORE.sessions[canonical], canonical
end

function M.start_session(request_json)
    load_sessions()
    local req = parse_request(request_json)
    local keys = candidate_keys(req.shortcut_app_id, req.steam_app_id, req.title)
    local sessions, canonical = ensure_sessions_list(req, keys)
    if not sessions then return cjson.encode({ ok = false, error = "missing_shortcut_app_id" }) end

    local instance_id, now = tostring(req.instance_id or os.time()), os.time()
    local existing = nil
    for _, session in ipairs(sessions) do
        if session.instance_id == instance_id then existing = session; break end
    end
    if existing then
        existing.ended_at = now
    else
        sessions[#sessions + 1] = { instance_id = instance_id, started_at = now, ended_at = now }
    end

    STORE_DIRTY = true
    local saved = save_sessions()
    logger:info("Playtime session started for " .. tostring(req.title or canonical) .. " (" .. instance_id .. ")")
    return cjson.encode({ ok = saved, instance_id = instance_id, error = saved and nil or "save_failed" })
end

function M.ping_session(request_json)
    load_sessions()
    local req = parse_request(request_json)
    local keys = candidate_keys(req.shortcut_app_id, req.steam_app_id, req.title)
    local sessions = find_sessions_list(req, keys)
    local instance_id, now, updated = tostring(req.instance_id or ""), os.time(), false
    if sessions then
        for _, session in ipairs(sessions) do
            if session.instance_id == instance_id or (instance_id == "" and session.instance_id) then
                session.ended_at = now
                updated = true
                break
            end
        end
    end
    if updated then STORE_DIRTY = true end
    if updated and not flush_if_due(false) then return cjson.encode({ ok = false, error = "save_failed" }) end
    return cjson.encode({ ok = updated })
end

function M.stop_session(request_json)
    load_sessions()
    local req = parse_request(request_json)
    local keys = candidate_keys(req.shortcut_app_id, req.steam_app_id, req.title)
    local sessions, canonical = find_sessions_list(req, keys)
    local instance_id, now, stopped = tostring(req.instance_id or ""), os.time(), false
    if sessions then
        for _, session in ipairs(sessions) do
            if (instance_id ~= "" and session.instance_id == instance_id) or (instance_id == "" and session.instance_id) then
                session.ended_at = now
                session.instance_id = nil
                stopped = true
                break
            end
        end
        if not stopped and instance_id == "" and #sessions > 0 then
            sessions[#sessions].ended_at = now
            stopped = true
        end
        collapse_sessions(sessions)
    end
    if stopped then
        STORE_DIRTY = true
        save_sessions()
    end
    logger:info("Playtime session stopped for " .. tostring(req.title or canonical or ""))
    return cjson.encode({ ok = stopped })
end

local function calculate_playtime(req)
    local keys = candidate_keys(req.shortcut_app_id, req.steam_app_id, req.title)
    local sessions, canonical = find_sessions_list(req, keys)
    sessions = sessions or {}
    local two_weeks_ago, unix_epoch = os.time() - (14 * 24 * 60 * 60), 0
    local seconds_forever, seconds_last_two_weeks, last_played_at = 0, 0, 0

    for _, session in ipairs(sessions) do
        local started = session.started_at or 0
        local ended = session.ended_at or started
        local duration = math.max(0, ended - started)
        seconds_forever = seconds_forever + duration
        if started > two_weeks_ago or ended > two_weeks_ago then seconds_last_two_weeks = seconds_last_two_weeks + duration end
        if started ~= unix_epoch and ended > last_played_at then last_played_at = ended end
    end

    if canonical then
        register_aliases(keys, canonical)
    end

    return {
        ok = true,
        minutes_forever = math.floor((seconds_forever / 60) + 0.5),
        minutes_last_two_weeks = math.floor((seconds_last_two_weeks / 60) + 0.5),
        last_played_at = last_played_at > 0 and last_played_at or nil,
    }
end

function M.get_playtime(request_json)
    load_sessions()
    return cjson.encode(calculate_playtime(parse_request(request_json)))
end

-- Library Home and Big Picture refresh every mapped shortcut together. One
-- batch call avoids reopening IPC N times and guarantees all cards see the
-- same in-memory snapshot.
function M.get_all_playtime(request_json)
    load_sessions()
    local request = parse_request(request_json)
    local requests = type(request.requests) == "table" and request.requests or request
    local items = {}
    for index, item in ipairs(type(requests) == "table" and requests or {}) do
        if type(item) == "table" then
            local stats = calculate_playtime(item)
            stats.key = tostring(item.key or item.shortcut_app_id or index)
            stats.shortcut_app_id = tostring(item.shortcut_app_id or "")
            items[#items + 1] = stats
        end
    end
    return cjson.encode({ ok = true, items = items })
end

function M.set_playtime(request_json)
    load_sessions()
    local req = parse_request(request_json)
    local minutes = math.max(0, tonumber(req.minutes_forever or 0) or 0)
    local keys = candidate_keys(req.shortcut_app_id, req.steam_app_id, req.title)
    local sessions, canonical = ensure_sessions_list(req, keys)
    if not sessions then return cjson.encode({ ok = false, error = "missing_shortcut_app_id" }) end

    STORE.sessions[canonical] = { { started_at = 0, ended_at = math.floor(minutes * 60) } }
    STORE_DIRTY = true
    local saved = save_sessions()
    logger:info("Playtime manually set for " .. tostring(req.title or canonical) .. ": " .. tostring(minutes) .. " mins")
    return cjson.encode({ ok = saved, minutes_forever = minutes, error = saved and nil or "save_failed" })
end

function M.flush()
    return flush_if_due(true)
end

function M.clear_all()
    logger:info("Clearing all playtime sessions and backups")
    STORE = { version = 2, sessions = {}, aliases = {} }
    STORE_DIRTY = false
    for i = 1, SESSION_BACKUP_COUNT do
        local bak = SESSIONS_FILE .. (i == 1 and ".bak" or ".bak." .. tostring(i - 1))
        if fs.exists(bak) then os.remove(bak) end
    end
    local ok, err = config.write_json_atomic(SESSIONS_FILE, STORE)
    if not ok then logger:warn("Could not clear playtime sessions file: " .. tostring(err)) end
    LAST_SAVE_AT = os.time()
    LAST_FILE_MTIME = tonumber(fs.last_write_time(SESSIONS_FILE) or 0) or 0
    return ok
end

-- Session state is loaded lazily by the first playtime API call. Reading and
-- pruning the history during backend module construction delays Millennium
-- readiness on installations with a large playtime file.
return M
end
