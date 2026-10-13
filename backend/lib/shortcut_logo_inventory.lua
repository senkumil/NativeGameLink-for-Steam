return function(deps)
local cjson, fs, config, util = deps.cjson, deps.fs, deps.config, deps.util
local M = {}

function M.read(request_json)
    local ok, request = pcall(cjson.decode, tostring(request_json or ""))
    if not ok or type(request) ~= "table" or type(request.shortcuts) ~= "table" then
        return cjson.encode({ ok = false, error = "invalid_request", entries = {} })
    end
    local account = util.get_active_account_id()
    if not account then return cjson.encode({ ok = false, error = "active_user_not_found", entries = {} }) end
    local mappings = config.read_json(config.mappings_file_path(), {})
    local grid = fs.join(deps.millennium.steam_path(), "userdata", account, "config", "grid")
    local entries, seen = {}, {}
    for index, item in ipairs(request.shortcuts) do
        if index > 128 then break end
        if type(item) == "table" then
            local id_text = tostring(item.shortcut_app_id or "")
            local id, mtime = tonumber(id_text), tonumber(item.native_mtime)
            local steam_id = tostring(item.steam_app_id or "")
            if id_text:match("^%d+$") and id and id >= 2147483648 and id <= 4294967295 and id == math.floor(id)
                and steam_id:match("^%d+$") and mtime and mtime == mtime and mtime > 0 and mtime < math.huge
                and not seen[id_text] then
                local mapped = mappings["shortcut:" .. id_text] or mappings["shortcut:" .. string.format("%.0f", id - 4294967296)]
                if tostring(mapped or "") == steam_id then
                    seen[id_text] = true
                    entries[#entries + 1] = {
                        shortcut_app_id = id_text, steam_app_id = steam_id,
                        -- Lua has no native AppOverview store. This is an echoed
                        -- version token, never an invented filesystem/native mtime.
                        -- The frontend checks the real overview before and after IPC.
                        requested_native_mtime = mtime,
                        png_exists = not not fs.exists(fs.join(grid, id_text .. "_logo.png")),
                        jpg_exists = not not fs.exists(fs.join(grid, id_text .. "_logo.jpg")),
                    }
                end
            end
        end
    end
    return cjson.encode({ ok = true, entries = entries })
end

return M
end
