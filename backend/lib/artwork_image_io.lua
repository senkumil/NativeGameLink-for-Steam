return function(deps)
local http = deps.binary_http
local cjson = deps.cjson
local icon_files = deps.artwork_icon
local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local M = {}

local function encode_image(body)
    if type(body) ~= "string" or #body <= 100 or #body > 12 * 1024 * 1024 then return nil, nil end
    local mime = nil
    if body:byte(1) == 137 and body:sub(2, 4) == "PNG" then mime = "image/png"
    elseif body:byte(1) == 255 and body:byte(2) == 216 then mime = "image/jpeg"
    elseif body:sub(1, 4) == "RIFF" and body:sub(9, 12) == "WEBP" then mime = "image/webp" end
    if not mime then return nil, nil end
    return mime, icon_files.encode_base64(body)
end

function M.read_local(request_json)
    local ok_request, request = pcall(cjson.decode, tostring(request_json or ""))
    if not ok_request or type(request) ~= "table" then return cjson.encode({ ok = false, error = "invalid_request" }) end
    local path = tostring(request.path or ""):gsub("^%s+", ""):gsub("%s+$", "")
    if path == "" or #path > 4096 or path:find("%z") or path:find("[\r\n]") then
        return cjson.encode({ ok = false, error = "invalid_path" })
    end
    local file = io.open(path, "rb")
    if not file then file = io.open(path:gsub("\\", "/"), "rb") end
    if not file then return cjson.encode({ ok = false, error = "open_failed" }) end
    local body = file:read("*a")
    file:close()
    local mime, data = encode_image(body)
    if not mime then return cjson.encode({ ok = false, error = "unsupported_image" }) end
    return cjson.encode({ ok = true, mime = mime, data_base64 = data })
end

local function trusted_download_url(value)
    local url = tostring(value or "")
    local host = url:match("^https://([^/%?#]+)")
    host = host and host:lower():gsub(":%d+$", "") or ""
    if host == "steamgriddb.com" or host:match("^[a-z0-9-]+%.steamgriddb%.com$")
        or host == "steamstatic.com" or host:match("^[a-z0-9.-]+%.steamstatic%.com$")
        or host == "steampowered.com" or host:match("^[a-z0-9.-]+%.steampowered%.com$") then
        return url
    end
    return ""
end

function M.fetch_remote(request_json)
    local ok_request, request = true, nil
    if type(request_json) == "table" then
        if type(request_json.request_json) == "string" then
            ok_request, request = pcall(cjson.decode, request_json.request_json)
        elseif type(request_json.url) == "string" then
            request = request_json
        else
            request = request_json
        end
    else
        ok_request, request = pcall(cjson.decode, tostring(request_json or ""))
    end
    if not ok_request or type(request) ~= "table" then return cjson.encode({ ok = false, error = "invalid_request" }) end
    local url = trusted_download_url(request.url)
    if url == "" then return cjson.encode({ ok = false, error = "untrusted_url" }) end
    local current_url = url
    local response = nil
    for _ = 1, 4 do
        local ok_http, res = pcall(http.get, current_url, {
            headers = { ["Accept"] = "image/webp,image/png,image/jpeg,*/*", ["User-Agent"] = USER_AGENT },
            timeout = 15,
            follow_redirects = false,
        })
        if not ok_http or not res then return cjson.encode({ ok = false, error = "network_error" }) end
        local status = tonumber(res.status) or 0
        if status == 200 then
            response = res
            break
        elseif (status == 301 or status == 302 or status == 307 or status == 308) and type(res.headers) == "table" then
            local location = tostring(res.headers.location or res.headers.Location or "")
            if location ~= "" then
                if location:match("^/") then
                    local scheme_host = current_url:match("^(https?://[^/]+)")
                    location = (scheme_host or "") .. location
                end
                current_url = trusted_download_url(location)
                if current_url == "" then return cjson.encode({ ok = false, error = "untrusted_redirect" }) end
            else
                return cjson.encode({ ok = false, error = "http_error", status = status })
            end
        else
            return cjson.encode({ ok = false, error = "http_error", status = status })
        end
    end
    if not response or tonumber(response.status) ~= 200 then
        return cjson.encode({ ok = false, error = "http_error", status = response and response.status or 0 })
    end
    local mime, data = encode_image(response.body)
    if not mime then return cjson.encode({ ok = false, error = "unsupported_image" }) end
    return cjson.encode({ ok = true, mime = mime, data_base64 = data })
end

return M
end
