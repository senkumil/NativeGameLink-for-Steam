return function(deps)
local http = deps.http
local M = {}

-- Some Millennium versions expose http.get bodies through lua_pushstring,
-- truncating binary images at the first NUL. The download API preserves bytes.
function M.get(url, options)
    if type(http.download) ~= "function" then return http.get(url, options) end
    local path = os.tmpname()
    local ok, response = pcall(http.download, url, path, options)
    local body = nil
    if ok and response and response.success and tonumber(response.status) == 200 then
        local file = io.open(path, "rb")
        if file then
            body = file:read(12 * 1024 * 1024 + 1)
            file:close()
            if body and #body > 12 * 1024 * 1024 then body = nil end
        end
    end
    os.remove(path)
    if not ok then error(response) end
    if not response then return nil end
    local status = tonumber(response.status) or 0
    if status >= 300 and status < 400 then
        -- download does not return headers; obtain Location for caller validation.
        return http.get(url, options)
    end
    return { status = status, body = body or "", headers = {} }
end

return M
end
