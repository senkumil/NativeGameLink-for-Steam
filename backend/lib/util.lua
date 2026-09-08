return function(deps)
local M = {}

function M.trim(value)
    return tostring(value or ""):match("^%s*(.-)%s*$") or ""
end

function M.url_encode(value)
    return tostring(value or ""):gsub("\n", "\r\n"):gsub("([^%w%-_%.~])", function(char)
        return string.format("%%%02X", string.byte(char))
    end)
end

function M.html_unescape(value)
    local s = tostring(value or "")
    return (s:gsub("&quot;", '"'):gsub("&#39;", "'"):gsub("&lt;", "<"):gsub("&gt;", ">")
        :gsub("&nbsp;", " "):gsub("&amp;", "&"))
end

function M.strip_html(value)
    local s = tostring(value or ""):gsub("<br%s*/?>", "\n"):gsub("<[^>]+>", "")
    return M.trim(M.html_unescape(s))
end

local LOCALE_TO_STEAM_LANG = {
    en = "english", english = "english",
    es = "spanish", spanish = "spanish",
    ["es_419"] = "latam", ["es-419"] = "latam", latam = "latam",
    fr = "french", french = "french",
    de = "german", german = "german",
    it = "italian", italian = "italian",
    pt = "portuguese", portuguese = "portuguese",
    ["pt_br"] = "brazilian", ["pt-br"] = "brazilian", brazilian = "brazilian",
    ru = "russian", russian = "russian",
    pl = "polish", polish = "polish",
    tr = "turkish", turkish = "turkish",
    nl = "dutch", dutch = "dutch",
    sv = "swedish", swedish = "swedish",
    da = "danish", danish = "danish",
    fi = "finnish", finnish = "finnish",
    no = "norwegian", nb = "norwegian", nn = "norwegian", norwegian = "norwegian",
    hu = "hungarian", hungarian = "hungarian",
    cs = "czech", czech = "czech",
    ro = "romanian", romanian = "romanian",
    bg = "bulgarian", bulgarian = "bulgarian",
    el = "greek", greek = "greek",
    uk = "ukrainian", ukrainian = "ukrainian",
    vi = "vietnamese", vietnamese = "vietnamese",
    th = "thai", thai = "thai",
    ar = "arabic", arabic = "arabic",
    id = "indonesian", indonesian = "indonesian",
    ja = "japanese", japanese = "japanese",
    ko = "koreana", korean = "koreana", koreana = "koreana",
    ["zh_cn"] = "schinese", ["zh-cn"] = "schinese", ["zh_hans"] = "schinese", ["zh-hans"] = "schinese", schinese = "schinese",
    ["zh_tw"] = "tchinese", ["zh-tw"] = "tchinese", ["zh_hk"] = "tchinese", ["zh-hk"] = "tchinese", ["zh_hant"] = "tchinese", ["zh-hant"] = "tchinese", tchinese = "tchinese",
}

function M.safe_language(value)
    local raw = tostring(value or "english"):lower():gsub("%s+", "")
    if LOCALE_TO_STEAM_LANG[raw] then return LOCALE_TO_STEAM_LANG[raw] end
    local clean = raw:gsub("[^%w_-]", "")
    if LOCALE_TO_STEAM_LANG[clean] then return LOCALE_TO_STEAM_LANG[clean] end
    local base = clean:match("^([%w]+)")
    if base and LOCALE_TO_STEAM_LANG[base] then return LOCALE_TO_STEAM_LANG[base] end
    return clean ~= "" and clean or "english"
end

M.LANGUAGE_KEY_ALIASES = {
    spanish = { "spanish", "latam", "spanish_latam", "es", "es-es", "es-419", "es_es", "es_419" },
    latam = { "latam", "spanish", "spanish_latam", "es-419", "es_419", "es", "es-es", "es_es" },
    brazilian = { "brazilian", "portuguese", "pt-br", "pt_br", "pt" },
    portuguese = { "portuguese", "brazilian", "pt", "pt-pt", "pt_pt", "pt-br", "pt_br" },
    schinese = { "schinese", "zh-cn", "zh_cn", "zh-hans", "zh_hans", "chinese", "zh" },
    tchinese = { "tchinese", "zh-tw", "zh_tw", "zh-hk", "zh_hk", "zh-hant", "zh_hant" },
    koreana = { "koreana", "korean", "ko", "ko-kr", "ko_kr" },
    japanese = { "japanese", "ja", "ja-jp", "ja_jp" },
    russian = { "russian", "ru", "ru-ru", "ru_ru" },
    german = { "german", "de", "de-de", "de_de" },
    french = { "french", "fr", "fr-fr", "fr_fr" },
    italian = { "italian", "it", "it-it", "it_it" },
    polish = { "polish", "pl", "pl-pl", "pl_pl" },
    turkish = { "turkish", "tr", "tr-tr", "tr_tr" },
    dutch = { "dutch", "nl", "nl-nl", "nl_nl" },
    swedish = { "swedish", "sv", "sv-se", "sv_se" },
    danish = { "danish", "da", "da-dk", "da_dk" },
    finnish = { "finnish", "fi", "fi-fi", "fi_fi" },
    norwegian = { "norwegian", "no", "nb", "nn", "no-no", "nb-no" },
    hungarian = { "hungarian", "hu", "hu-hu", "hu_hu" },
    czech = { "czech", "cs", "cs-cz", "cs_cz" },
    romanian = { "romanian", "ro", "ro-ro", "ro_ro" },
    bulgarian = { "bulgarian", "bg", "bg-bg", "bg_bg" },
    greek = { "greek", "el", "el-gr", "el_gr" },
    ukrainian = { "ukrainian", "uk", "uk-ua", "uk_ua" },
    vietnamese = { "vietnamese", "vi", "vi-vn", "vi_vn" },
    thai = { "thai", "th", "th-th", "th_th" },
    arabic = { "arabic", "ar", "ar-sa", "ar_sa" },
    indonesian = { "indonesian", "id", "id-id", "id_id" },
}

function M.normalize_appid_and_language(first, second)
    if type(first) == "table" then
        local appid = tostring(first.steam_app_id or first.appid or first.app_id or first.id or ""):match("(%d+)") or ""
        local lang = tostring(first.language or first.lang or second or "english")
        return appid, M.safe_language(lang)
    end
    local appid = tostring(first or ""):match("(%d+)") or ""
    local language = tostring(second or "english")
    if appid == "" and language:match("^%d+$") then
        appid, language = language:match("(%d+)") or "", appid
    end
    return appid, M.safe_language(language)
end

function M.decode_json(cjson, raw)
    if type(raw) == "table" then
        if type(raw.request_json) == "string" then
            local ok, value = pcall(cjson.decode, raw.request_json)
            if ok and type(value) == "table" then return value, nil end
        elseif type(raw.request_json) == "table" then
            return raw.request_json, nil
        end
        return raw, nil
    end
    local ok, value = pcall(cjson.decode, tostring(raw or ""))
    if ok then return value, nil end
    return nil, tostring(value)
end

-- Millennium validates backend return values as UTF-8 even when the Lua JSON
-- decoder accepted malformed bytes from an upstream response. Preserve valid
-- sequences and discard only isolated/overlong/surrogate bytes so one damaged
-- punctuation mark cannot abort an otherwise valid IPC response.
function M.sanitize_utf8(value)
    local input = tostring(value or "")
    local output, index = {}, 1
    while index <= #input do
        local first = input:byte(index)
        local length = 0
        if first <= 0x7f then
            length = 1
        elseif first >= 0xc2 and first <= 0xdf then
            local second = input:byte(index + 1)
            if second and second >= 0x80 and second <= 0xbf then length = 2 end
        elseif first >= 0xe0 and first <= 0xef then
            local second, third = input:byte(index + 1), input:byte(index + 2)
            local second_valid = second and second >= 0x80 and second <= 0xbf
            if first == 0xe0 then second_valid = second and second >= 0xa0 and second <= 0xbf end
            if first == 0xed then second_valid = second and second >= 0x80 and second <= 0x9f end
            if second_valid and third and third >= 0x80 and third <= 0xbf then length = 3 end
        elseif first >= 0xf0 and first <= 0xf4 then
            local second, third, fourth = input:byte(index + 1), input:byte(index + 2), input:byte(index + 3)
            local second_valid = second and second >= 0x80 and second <= 0xbf
            if first == 0xf0 then second_valid = second and second >= 0x90 and second <= 0xbf end
            if first == 0xf4 then second_valid = second and second >= 0x80 and second <= 0x8f end
            if second_valid and third and third >= 0x80 and third <= 0xbf
                and fourth and fourth >= 0x80 and fourth <= 0xbf then length = 4 end
        end
        if length > 0 then output[#output + 1] = input:sub(index, index + length - 1) end
        index = index + math.max(length, 1)
    end
    return table.concat(output)
end

function M.sanitize_utf8_tree(value, seen)
    if type(value) == "string" then return M.sanitize_utf8(value) end
    if type(value) ~= "table" then return value end
    local visited = seen or {}
    if visited[value] then return nil end
    visited[value] = true
    local clean = {}
    for key, item in pairs(value) do
        local clean_key = type(key) == "string" and M.sanitize_utf8(key) or key
        local clean_item = M.sanitize_utf8_tree(item, visited)
        if clean_item ~= nil then clean[clean_key] = clean_item end
    end
    visited[value] = nil
    return clean
end

function M.suppress_admin_prompt(request_json)
    return true
end

local function file_exists(path)
    if not path or path == "" then return false end
    local f = io.open(path, "r")
    if f then f:close(); return true end
    return false
end

local function clean_path_input(p)
    local s = tostring(p or ""):gsub('^["\']+', ''):gsub('["\']+$', '')
    s = s:gsub("/", "\\")
    s = s:match("^%s*(.-)%s*$") or ""
    return s:gsub("\\+$", "")
end

function M.neutralize_steam_appid_file(request_json)
    local ok_req, req = pcall(deps.cjson.decode, tostring(request_json or "{}"))
    if not ok_req or type(req) ~= "table" then req = {} end
    local exe_path = clean_path_input(req.exe_path or req.shortcutExecutable or req.executable or "")
    local start_dir = clean_path_input(req.start_dir or req.trackingStartDir or req.startDir or "")
    if exe_path == "" and start_dir == "" then
        return deps.cjson.encode({ ok = true, modified = false, skipped = "missing_target" })
    end
    local search_dirs = {}
    local seen_dirs = {}
    local function add_dir(d)
        local clean = clean_path_input(d)
        if clean ~= "" and not seen_dirs[clean:lower()] then
            seen_dirs[clean:lower()] = true
            table.insert(search_dirs, clean)
        end
    end
    add_dir(start_dir)
    if exe_path ~= "" then
        local dir = clean_path_input(deps.fs.parent_path(exe_path))
        for _ = 1, 4 do
            if not dir or dir == "" then break end
            add_dir(dir)
            local p = clean_path_input(deps.fs.parent_path(dir))
            if not p or p == dir then break end
            dir = p
        end
    end
    local modified = false
    for _, d in ipairs(search_dirs) do
        local appid_path = d .. "\\steam_appid.txt"
        if file_exists(appid_path) then
            local bak_path = d .. "\\steam_appid.txt.gdl_bak"
            pcall(os.remove, bak_path)
            local ok_ren = os.rename(appid_path, bak_path)
            if ok_ren then modified = true end
        end
    end
    return deps.cjson.encode({ ok = true, modified = modified })
end

function M.restore_steam_appid_file(request_json)
    local ok_req, req = pcall(deps.cjson.decode, tostring(request_json or "{}"))
    if not ok_req or type(req) ~= "table" then req = {} end
    local exe_path = clean_path_input(req.exe_path or req.shortcutExecutable or req.executable or "")
    local start_dir = clean_path_input(req.start_dir or req.trackingStartDir or req.startDir or "")
    local search_dirs = {}
    local seen_dirs = {}
    local function add_dir(d)
        local clean = clean_path_input(d)
        if clean ~= "" and not seen_dirs[clean:lower()] then
            seen_dirs[clean:lower()] = true
            table.insert(search_dirs, clean)
        end
    end
    add_dir(start_dir)
    if exe_path ~= "" then
        local dir = clean_path_input(deps.fs.parent_path(exe_path))
        for _ = 1, 4 do
            if not dir or dir == "" then break end
            add_dir(dir)
            local p = clean_path_input(deps.fs.parent_path(dir))
            if not p or p == dir then break end
            dir = p
        end
    end
    local restored = false
    for _, d in ipairs(search_dirs) do
        local bak_path = d .. "\\steam_appid.txt.gdl_bak"
        local appid_path = d .. "\\steam_appid.txt"
        if file_exists(bak_path) and not file_exists(appid_path) then
            local ok_ren = os.rename(bak_path, appid_path)
            if ok_ren then restored = true end
        end
    end
    return deps.cjson.encode({ ok = true, restored = restored })
end

function M.binary_cstring(data, position)
    local finish = data:find("\0", position, true)
    if not finish then return nil, position end
    return data:sub(position, finish - 1), finish + 1
end

function M.binary_i32(data, position)
    local b1, b2, b3, b4 = data:byte(position, position + 3)
    if not b4 then return nil, position end
    local value = b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
    if value >= 2147483648 then value = value - 4294967296 end
    return value, position + 4
end

function M.parse_binary_vdf_object(data, position, depth)
    if depth > 16 then return nil, position, "maximum_depth" end
    local result = {}
    while position <= #data do
        local value_type = data:byte(position)
        position = position + 1
        if value_type == 8 then return result, position, nil end

        local key
        key, position = M.binary_cstring(data, position)
        if not key then return nil, position, "invalid_key" end

        if value_type == 0 then
            local child, next_position, parse_error = M.parse_binary_vdf_object(data, position, depth + 1)
            if not child then return nil, next_position, parse_error end
            result[key] = child
            position = next_position
        elseif value_type == 1 then
            local value
            value, position = M.binary_cstring(data, position)
            if value == nil then return nil, position, "invalid_string" end
            result[key] = value
        elseif value_type == 2 then
            local value
            value, position = M.binary_i32(data, position)
            if value == nil then return nil, position, "invalid_integer" end
            result[key] = value
        elseif value_type == 3 or value_type == 4 or value_type == 6 then
            if position + 3 > #data then return nil, position, "truncated_value" end
            position = position + 4
        elseif value_type == 7 then
            if position + 7 > #data then return nil, position, "truncated_uint64" end
            position = position + 8
        elseif value_type == 5 then
            local cursor = position
            local found = false
            while cursor + 1 <= #data do
                if data:byte(cursor) == 0 and data:byte(cursor + 1) == 0 then
                    position = cursor + 2
                    found = true
                    break
                end
                cursor = cursor + 2
            end
            if not found then return nil, position, "invalid_wstring" end
        else
            return nil, position, "unsupported_type_" .. tostring(value_type)
        end
    end
    return nil, position, "unexpected_eof"
end

function M.get_active_account_id()
    local millennium = deps.millennium
    local fs = deps.fs
    local logger = deps.logger
    local steam_path = millennium.steam_path()
    local vdf_path = fs.join(steam_path, "config", "loginusers.vdf")
    local function account_id_from_steamid64(id64)
        if not tostring(id64 or ""):match("^%d+$") then return nil end
        local result = 0
        for i = 1, #id64 do
            result = (result * 10 + tonumber(id64:sub(i, i))) % 4294967296
        end
        return tostring(math.floor(result))
    end
    local users = {}
    if fs.exists(vdf_path) then
        local f = io.open(vdf_path, "r")
        if f then
            local content = f:read("*a")
            f:close()
            local current = nil
            for line in content:gmatch("[^\r\n]+") do
                local id64 = line:match('^%s*"(%d%d%d%d%d%d%d%d%d+)"%s*$')
                if id64 then
                    current = { id64 = id64, most_recent = false, auto_login = false, timestamp = 0 }
                    table.insert(users, current)
                elseif current then
                    if line:match('"MostRecent"%s*"1"') then current.most_recent = true end
                    if line:match('"AutoLogin"%s*"1"') then current.auto_login = true end
                    local timestamp = line:match('"Timestamp"%s*"(%d+)"')
                    if timestamp then current.timestamp = tonumber(timestamp) or 0 end
                end
            end
        end
    end
    table.sort(users, function(a, b)
        if a.most_recent ~= b.most_recent then return a.most_recent end
        if a.auto_login ~= b.auto_login then return a.auto_login end
        return (a.timestamp or 0) > (b.timestamp or 0)
    end)
    local userdata_root = fs.join(steam_path, "userdata")
    for _, user in ipairs(users) do
        local account_id = account_id_from_steamid64(user.id64)
        if account_id and fs.exists(fs.join(userdata_root, account_id)) then
            return account_id
        end
    end
    local best_id, best_time = nil, -1
    local entries = fs.exists(userdata_root) and fs.list(userdata_root) or nil
    if entries then
        for _, entry in ipairs(entries) do
            if entry.is_directory then
                local account_id = tostring(entry.name or entry.path or ""):match("(%d+)[\\/]?$")
                local modified = tonumber(fs.last_write_time(entry.path) or 0) or 0
                if account_id and modified >= best_time then
                    best_id = account_id
                    best_time = modified
                end
            end
        end
    end
    return best_id
end

return M
end
