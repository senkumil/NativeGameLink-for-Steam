return function(deps)
local logger = deps.logger
local fs = deps.fs
local cjson = deps.cjson
local process = deps.process
local config = deps.config
local M = {}
local result_sequence = 0

local function find_csc()
    local windir = os.getenv("WINDIR") or "C:\\Windows"
    local candidates = {
        fs.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
        fs.join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
    }
    for _, path in ipairs(candidates) do
        if fs.exists(path) then
            return path
        end
    end
    return nil
end

local function get_or_compile_helper()
    -- Resolve the helper source from Millennium's actual plugin location.
    -- Never assume Steam is installed on C: or under Program Files.
    local backend_dir = tostring(config and config.backend_dir and config.backend_dir() or "")
    if backend_dir == "" and config and config.plugin_dir then
        backend_dir = fs.join(config.plugin_dir(), "backend")
    end
    local cs_path = fs.join(backend_dir, "src", "steam_achievement_sync.cs")
    if not fs.exists(cs_path) then
        return nil, "source_not_found"
    end

    local temp_dir = os.getenv("TEMP") or os.getenv("TMP") or "C:\\Windows\\Temp"
    local source_file = io.open(cs_path, "rb")
    if not source_file then return nil, "source_not_found" end
    local source = source_file:read("*a")
    source_file:close()
    local fingerprint = 5381.0
    for index = 1, #source do fingerprint = (fingerprint * 33.0 + source:byte(index)) % 4294967296.0 end
    local exe_path = fs.join(temp_dir, "ngl_steam_achievement_sync_v2_" .. string.format("%.0f", fingerprint) .. ".exe")

    if fs.exists(exe_path) then
        return exe_path
    end

    -- Compile using csc.exe as winexe completely silently via process.run_silent (0 windows)
    local csc = find_csc()
    if csc and process and process.run_silent then
        local compile_cmd = string.format('"%s" /nologo /target:winexe /out:"%s" "%s"', csc, exe_path, cs_path)
        process.run_silent(compile_cmd, 10000)
    end

    if not fs.exists(exe_path) and process and process.run_silent then
        local ps_cmd = string.format('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-Type -Path \'%s\' -OutputType WindowsApplication -OutputAssembly \'%s\'"', cs_path:gsub("'", "''"), exe_path:gsub("'", "''"))
        process.run_silent(ps_cmd, 10000)
    end

    if fs.exists(exe_path) then
        return exe_path
    end

    local ps1_path = fs.join(backend_dir, "src", "steam_achievement_sync.ps1")
    if fs.exists(ps1_path) then
        return ps1_path, "is_ps1"
    end

    return nil, "compilation_failed"
end

local function extract_request_data(req)
    if type(req) == "string" then
        local trimmed = req:match("^%s*(.-)%s*$") or ""
        if trimmed:match("^%d+$") then
            return { steam_app_id = trimmed }
        end
        local ok, parsed = pcall(cjson.decode, trimmed)
        if ok and type(parsed) == "table" then
            return extract_request_data(parsed)
        end
        return { steam_app_id = trimmed }
    elseif type(req) == "table" then
        if req.request_json then
            return extract_request_data(req.request_json)
        end
        local raw_id = req.steam_app_id or req.appid or req[1]
        local id = raw_id and tostring(raw_id):match("^%d+$") or nil
        return {
            steam_app_id = id,
            unlock = req.unlock,
            lock = req.lock,
        }
    end
    return {}
end

local function run_helper(args_string)
    local helper_path, helper_type = get_or_compile_helper()
    if not helper_path then
        return nil, helper_type or "helper_not_found"
    end
    local temp_dir = os.getenv("TEMP") or os.getenv("TMP") or "C:\\Windows\\Temp"
    result_sequence = (result_sequence + 1) % 1000000
    local result_path = fs.join(temp_dir, "ngl_sync_" .. tostring(os.time()) .. "_" .. tostring(result_sequence) .. ".json")
    pcall(os.remove, result_path)

    local cmd
    if helper_type == "is_ps1" then
        cmd = string.format('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%s" %s --result-file "%s"', helper_path, args_string, result_path)
    else
        cmd = string.format('"%s" %s --result-file "%s"', helper_path, args_string, result_path)
    end

    -- Use Win32 CreateProcess with CREATE_NO_WINDOW (0 windows, instant execution)
    if process and process.run_silent then
        local launched, result = process.run_silent(cmd, args_string:match("^sync ") and 15000 or 12000)
        if launched == false then
            pcall(os.remove, result_path)
            return nil, type(result) == "string" and result or "process_launch_failed"
        end
    else
        pcall(os.execute, cmd)
    end

    local file = io.open(result_path, "rb")
    local output = nil
    if file then
        local file_output = file:read("*a")
        file:close()
        pcall(os.remove, result_path)
        if file_output and file_output ~= "" then output = file_output end
    end
    if not output or output == "" then
        return nil, "empty_output"
    end
    local ok, parsed = pcall(cjson.decode, output)
    if not ok or type(parsed) ~= "table" then
        return nil, "json_parse_failed: " .. tostring(output)
    end
    return parsed
end

local status_cache = deps.ttl_cache and deps.ttl_cache.new(50) or nil

local function valid_appid(id)
    local number = tonumber(id)
    return type(id) == "string" and id:match("^%d+$") and number and number > 0 and number < 2147483648
end

local function client_permissions(appid)
    local metadata = deps.achievement_metadata
    if not metadata or type(metadata.client_permissions) ~= "function" then return {}, false end
    local ok, permissions, all_protected = pcall(metadata.client_permissions, appid)
    if not ok or type(permissions) ~= "table" then return {}, false end
    return permissions, all_protected == true
end

local function protected_response(appid, names)
    table.sort(names)
    return cjson.encode({ ok = false, appid = tonumber(appid), error = "achievement_protected", protected_names = names })
end

function M.fetch_steam_account_achievements(request)
    local data = extract_request_data(request)
    local id = data.steam_app_id
    if not valid_appid(id) then
        return cjson.encode({ ok = false, error = "invalid_appid" })
    end

    -- Do not start a game SDK session just to open an editor when Steam's own
    -- complete local schema says that every achievement is server protected.
    local permissions, all_protected = client_permissions(id)
    if all_protected then
        local names = {}
        for name in pairs(permissions) do names[#names + 1] = name end
        return protected_response(id, names)
    end

    if status_cache then
        local cached = deps.ttl_cache.get(status_cache, id, 30)
        if cached and cached.json then
            return cached.json
        end
    end

    local result, err = run_helper(string.format("status %s", id))
    if not result then
        return cjson.encode({ ok = false, error = err or "status_failed" })
    end
    if result.ok ~= true or tostring(result.appid) ~= id or type(result.achievements) ~= "table" then
        return cjson.encode({ ok = false, error = result.error or "invalid_account_achievement_response" })
    end
    local encoded = cjson.encode(result)
    if status_cache then
        deps.ttl_cache.set(status_cache, id, { json = encoded, ttl = 30 })
    end
    return encoded
end

function M.sync_steam_account_achievements(request)
    local data = extract_request_data(request)
    local appid = data.steam_app_id
    if not valid_appid(appid) then
        return cjson.encode({ ok = false, error = "invalid_appid" })
    end

    if status_cache then
        if deps.ttl_cache.remove then
            deps.ttl_cache.remove(status_cache, appid)
        elseif status_cache.entries then
            -- Compatibility with hosts supplying the original cache adapter.
            if status_cache.entries[appid] and status_cache.count then
                status_cache.count = math.max(0, status_cache.count - 1)
            end
            status_cache.entries[appid] = nil
        end
    end

    local unlock_list = type(data.unlock) == "table" and data.unlock or {}
    local lock_list = type(data.lock) == "table" and data.lock or {}

    local seen = {}
    for _, list in ipairs({ unlock_list, lock_list }) do
        for _, name in ipairs(list) do
            if type(name) ~= "string" or name == "" or #name > 256 or name:find('[%c"&|<>^%%!]') or seen[name] then
                return cjson.encode({ ok = false, error = "invalid_achievement_selection" })
            end
            seen[name] = true
        end
    end
    if not next(seen) then return cjson.encode({ ok = false, error = "empty_achievement_selection" }) end

    local permissions, all_protected = client_permissions(appid)
    if all_protected then
        local names = {}
        for name in pairs(seen) do
            if not permissions[name] then
                return cjson.encode({ ok = false, error = "invalid_achievement_selection" })
            end
            names[#names + 1] = name
        end
        -- An obsolete frontend or a direct IPC caller must not create an SDK
        -- session for a game whose complete schema forbids every client write.
        -- Its current personal state cannot be established without that session,
        -- so this case cannot truthfully be classified as an account no-op.
        return protected_response(appid, names)
    end

    -- Re-read the official account immediately before a manual write. UI/local
    -- snapshots and the 30-second status cache are not authorization/provenance.
    local status, status_error = run_helper(string.format("status %s", appid))
    if not status or status.ok ~= true or type(status.achievements) ~= "table"
        or tostring(status.appid) ~= tostring(appid) then
        return cjson.encode({ ok = false, error = status_error or "game_stats_not_owned_or_unavailable" })
    end
    for name in pairs(seen) do
        if type(status.achievements[name]) ~= "table" or type(status.achievements[name].achieved) ~= "boolean" then
            return cjson.encode({ ok = false, error = "invalid_achievement_selection" })
        end
    end

    -- The picker submits its complete desired selection. Only mutate the
    -- differences: SetAchievement on an already earned achievement can enqueue
    -- another Steam toast and StoreStats needlessly refreshes the library.
    local args = { string.format("sync %s", appid) }
    local protected_names = {}
    for _, name in ipairs(unlock_list) do
        if not status.achievements[name].achieved then
            if permissions[name] and permissions[name].client_writable == false then
                protected_names[#protected_names + 1] = name
            else
                args[#args + 1] = string.format('"+%s"', name)
            end
        end
    end
    for _, name in ipairs(lock_list) do
        if status.achievements[name].achieved then
            if permissions[name] and permissions[name].client_writable == false then
                protected_names[#protected_names + 1] = name
            else
                args[#args + 1] = string.format('"-%s"', name)
            end
        end
    end
    if #protected_names > 0 then return protected_response(appid, protected_names) end
    if #args == 1 then
        return cjson.encode({
            ok = true, appid = tonumber(appid), noop = true,
            unlocked_count = 0, locked_count = 0,
            stored = false, callback_confirmed = false,
        })
    end

    local result, err = run_helper(table.concat(args, " "))
    if not result then
        return cjson.encode({ ok = false, error = err or "sync_failed" })
    end
    return cjson.encode(result)
end

return M
end
