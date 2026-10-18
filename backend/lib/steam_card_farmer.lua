return function(deps)
local logger = deps.logger
local fs = deps.fs
local cjson = deps.cjson
local process = deps.process
local config = deps.config
local M = {}
local active_helper_path, active_helper_type = nil, nil
local active_control_path, active_event_name = nil, nil

local active_session = {
    active = false,
    steam_app_id = nil,
    game_title = nil,
    started_at = 0,
}

local function reset_session()
    active_session.active = false
    active_session.steam_app_id = nil
    active_session.game_title = nil
    active_session.started_at = 0
    active_helper_path, active_helper_type = nil, nil
    active_control_path, active_event_name = nil, nil
end

local function write_control(path, value)
    local file = io.open(path, "wb")
    if not file then return false end
    local wrote, result = pcall(file.write, file, value)
    local closed, close_result = pcall(file.close, file)
    return wrote and result ~= nil and closed and close_result ~= nil
end

local function create_session_control()
    local ok, temporary = pcall(os.tmpname)
    if not ok or type(temporary) ~= "string" or temporary == "" then return nil end
    pcall(os.remove, temporary)
    local name = temporary:match("([^/\\]+)$") or temporary
    local temp_dir = os.getenv("TEMP") or os.getenv("TMP") or "C:\\Windows\\Temp"
    local path = fs.join(temp_dir, name .. ".ngl-farmer")
    if not write_control(path, "run") then pcall(os.remove, path); return nil end
    return path, "NativeGameLink_CardFarmer_" .. name:gsub("[^%w]", "_")
end

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
    local cs_path = fs.join(backend_dir, "src", "steam_card_farmer.cs")
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
    local exe_path = fs.join(temp_dir, "ngl_steam_card_farmer_v2_" .. string.format("%.0f", fingerprint) .. ".exe")

    if fs.exists(exe_path) then
        return exe_path
    end

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

    local ps1_path = fs.join(backend_dir, "src", "steam_card_farmer.ps1")
    if fs.exists(ps1_path) then
        return ps1_path, "is_ps1"
    end

    return nil, "compilation_failed"
end

local function extract_request(req)
    if type(req) == "string" then
        local trimmed = req:match("^%s*(.-)%s*$") or ""
        if trimmed:match("^%d+$") then
            return { steam_app_id = trimmed }
        end
        local ok, parsed = pcall(cjson.decode, trimmed)
        if ok and type(parsed) == "table" then
            return extract_request(parsed)
        end
        return { steam_app_id = trimmed }
    elseif type(req) == "table" then
        if req.request_json then
            return extract_request(req.request_json)
        end
        local raw_id = req.steam_app_id or req.appid or req[1]
        local id = raw_id and tostring(raw_id):match("^%d+$") or nil
        return {
            steam_app_id = id,
            game_title = req.game_title or req.title,
        }
    end
    return {}
end

function M.get_card_farming_status()
    if active_session.active and active_control_path and not fs.exists(active_control_path) then reset_session() end
    local now = os.time()
    local elapsed = 0
    if active_session.active and active_session.started_at > 0 then
        elapsed = math.max(0, now - active_session.started_at)
    end
    return cjson.encode({
        ok = true,
        active = active_session.active,
        steam_app_id = active_session.steam_app_id,
        game_title = active_session.game_title,
        started_at = active_session.started_at,
        elapsed_seconds = elapsed,
    })
end

function M.stop_card_farming()
    -- An idle unload must never compile or launch a helper merely to stop it.
    if not active_session.active then return cjson.encode({ ok = true, active = false }) end
    local helper_path, helper_type = active_helper_path, active_helper_type
    if not helper_path then return cjson.encode({ ok = false, error = "farmer_not_found" }) end
    -- This durable cancellation is visible even if stop beats async helper
    -- startup. A missing control file also means cancellation to the helper.
    if not write_control(active_control_path, "stop") then
        return cjson.encode({ ok = false, active = true, error = "session_control_failed" })
    end
    if helper_path then
        local cmd
        if helper_type == "is_ps1" then
            cmd = string.format('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%s" stop 0 "%s" "%s"', helper_path, active_event_name, active_control_path)
        else
            cmd = string.format('"%s" stop 0 "%s" "%s"', helper_path, active_event_name, active_control_path)
        end
        local launched, result = process.run_silent(cmd, 5000)
        if not launched or result ~= 0 then
            return cjson.encode({ ok = false, active = true, error = type(result) == "string" and result or "stop_failed" })
        end
    end
    pcall(os.remove, active_control_path)
    reset_session()
    return cjson.encode({ ok = true, active = false })
end

function M.start_card_farming(request)
    local data = extract_request(request)
    local appid = data.steam_app_id
    local numeric_appid = tonumber(appid)
    if not appid or not appid:match("^%d+$") or not numeric_appid or numeric_appid <= 0 or numeric_appid >= 2147483648 then
        return cjson.encode({ ok = false, error = "invalid_appid" })
    end

    local helper_path, helper_type = get_or_compile_helper()
    if not helper_path then
        return cjson.encode({ ok = false, error = helper_type or "farmer_not_found" })
    end

    -- If another game is farming, stop it first
    if active_session.active then
        M.stop_card_farming()
        if active_session.active then return cjson.encode({ ok = false, active = true, error = "stop_failed" }) end
    end

    local control_path, event_name = create_session_control()
    if not control_path then return cjson.encode({ ok = false, active = false, error = "session_control_failed" }) end

    local cmd
    if helper_type == "is_ps1" then
        cmd = string.format('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%s" run %s "%s" "%s"', helper_path, appid, event_name, control_path)
    else
        cmd = string.format('"%s" run %s "%s" "%s"', helper_path, appid, event_name, control_path)
    end

    -- Launch asynchronously in background with CREATE_NO_WINDOW (zero console/cmd window)
    local launched, result = process.run_silent(cmd, nil)
    if not launched or result ~= 0 then
        pcall(os.remove, control_path)
        return cjson.encode({ ok = false, active = false, error = type(result) == "string" and result or "start_failed" })
    end

    active_session.active = true
    active_session.steam_app_id = appid
    active_session.game_title = data.game_title or appid
    active_session.started_at = os.time()
    active_helper_path, active_helper_type = helper_path, helper_type
    active_control_path, active_event_name = control_path, event_name

    return cjson.encode({
        ok = true,
        active = true,
        steam_app_id = appid,
        game_title = active_session.game_title,
        started_at = active_session.started_at,
    })
end

return M
end
