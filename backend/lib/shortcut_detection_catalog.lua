-- Dynamic Open Catalog Resolver for Delisted & Retired Steam Games
-- Resolves Steam AppIDs algorithmically using open knowledge graphs when
-- Steam Store Search returns 0 results for delisted/retired games.
return function(deps)
local logger = deps.logger or { info = function() end, warn = function() end, debug = function() end }
local http = deps.http
local cjson = deps.cjson
local util = deps.util or {}
local shortcut_detection_text = deps.shortcut_detection_text or {}
local ttl_cache = deps.ttl_cache

local USER_AGENT = deps.user_agent or "NativeGameLink-for-Steam/2.0.0"
local cache_get = ttl_cache and ttl_cache.get
local cache_set = ttl_cache and ttl_cache.set
local catalog_cache = ttl_cache and ttl_cache.new and ttl_cache.new(128) or nil

local M = {}

local function http_json(url, timeout)
    if not http or not http.get then return nil, "HTTP client unavailable" end
    local ok_http, res, err = pcall(http.get, url, {
        headers = {
            ["Accept"] = "application/json",
            ["User-Agent"] = USER_AGENT,
        },
        timeout = timeout or 3.0,
    })
    if not ok_http or not res or res.status ~= 200 then
        return nil, tostring(err or (res and res.status) or "HTTP request failed")
    end
    local ok_json, body = pcall(cjson.decode, res.body or "")
    if not ok_json or type(body) ~= "table" then
        return nil, "JSON decode failed"
    end
    return body, nil
end

local function clean_query_term(value)
    local text = tostring(value or ""):match("^%s*(.-)%s*$") or ""
    if text == "" then return "" end
    -- Split CamelCase / PascalCase tokens (e.g. RocketLeague -> Rocket League)
    text = text:gsub("(%l)(%u)", "%1 %2")
        :gsub("(%a)(%d)", "%1 %2")
        :gsub("(%d)(%a)", "%1 %2")
    if shortcut_detection_text.clean_game_title then
        text = shortcut_detection_text.clean_game_title(text)
    end
    return text:match("^%s*(.-)%s*$") or ""
end

function M.resolve_catalog_appids(query, timeout)
    local cleaned = clean_query_term(query)
    if #cleaned < 2 then return {} end
    local cache_key = cleaned:lower()
    if catalog_cache and cache_get then
        local cached = cache_get(catalog_cache, cache_key, 600)
        if cached and cached.data then return cached.data end
    end

    local url_encode = util.url_encode or function(str)
        return tostring(str or ""):gsub("([^%w%-%_%.%~])", function(c)
            return string.format("%%%02X", string.byte(c))
        end)
    end

    local search_url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&search="
        .. url_encode(cleaned)
        .. "&language=en&format=json&type=item&limit=5"

    local search_body, err = http_json(search_url, timeout or 2.5)
    if not search_body or type(search_body.search) ~= "table" or #search_body.search == 0 then
        if catalog_cache and cache_set then cache_set(catalog_cache, cache_key, { data = {}, ttl = 600 }) end
        return {}
    end

    local entity_ids = {}
    local entity_meta = {}
    for _, item in ipairs(search_body.search) do
        local qid = tostring(item.id or "")
        if qid:match("^Q%d+$") then
            local desc = tostring(item.description or ""):lower()
            local is_game = desc:find("game") ~= nil or desc:find("juego") ~= nil
                or desc:find("dlc") ~= nil or desc:find("software") ~= nil
            table.insert(entity_ids, qid)
            entity_meta[qid] = {
                id = qid,
                label = item.label,
                description = item.description,
                is_game = is_game,
            }
        end
    end

    if #entity_ids == 0 then
        if catalog_cache and cache_set then cache_set(catalog_cache, cache_key, { data = {}, ttl = 600 }) end
        return {}
    end

    local claims_url = "https://www.wikidata.org/w/api.php?action=wbgetentities&ids="
        .. table.concat(entity_ids, "|")
        .. "&props=claims&format=json"

    local claims_body, err2 = http_json(claims_url, timeout or 2.5)
    local results = {}
    local seen_appids = {}

    if claims_body and type(claims_body.entities) == "table" then
        for _, qid in ipairs(entity_ids) do
            local ent = claims_body.entities[qid]
            if type(ent) == "table" and type(ent.claims) == "table" and type(ent.claims.P1733) == "table" then
                for _, claim in ipairs(ent.claims.P1733) do
                    if claim.mainsnak and claim.mainsnak.datavalue and claim.mainsnak.datavalue.value then
                        local appid = tostring(claim.mainsnak.datavalue.value):match("^(%d+)$")
                        if appid and not seen_appids[appid] then
                            seen_appids[appid] = true
                            local meta = entity_meta[qid] or {}
                            table.insert(results, {
                                appid = appid,
                                name = meta.label or cleaned,
                                description = meta.description or "",
                                is_game = meta.is_game == true,
                                source = "dynamic_catalog",
                            })
                        end
                    end
                end
            end
        end
    end

    if catalog_cache and cache_set then cache_set(catalog_cache, cache_key, { data = results, ttl = 600 }) end
    return results
end

function M.resolve_catalog_candidates(request, context, helpers)
    local terms = {}
    local function add_term(val)
        local cleaned = clean_query_term(val)
        if cleaned ~= "" and not terms[cleaned] then
            terms[cleaned] = true
            table.insert(terms, cleaned)
        end
    end

    add_term(context.pe_product)
    add_term(context.title)
    add_term(context.exe_stem)
    if context.pe_desc and context.pe_desc ~= context.pe_product then
        add_term(context.pe_desc)
    end

    local candidates = {}
    local seen_appids = {}

    for _, term in ipairs(terms) do
        local matches = M.resolve_catalog_appids(term, 2.5)
        if type(matches) == "table" and #matches > 0 then
            for _, match in ipairs(matches) do
                local appid = match.appid
                if not seen_appids[appid] then
                    seen_appids[appid] = true
                    local direct = nil
                    if helpers.direct_result then
                        direct = helpers.direct_result(
                            appid,
                            "dynamic_catalog",
                            request,
                            context.language,
                            context.launcher,
                            context.generic_launcher,
                            match.name
                        )
                    end
                    if direct and type(direct.candidates) == "table" and #direct.candidates > 0 then
                        for _, cand in ipairs(direct.candidates) do
                            cand.score = math.max(cand.score or 85, 95)
                            if not cand.reasons then cand.reasons = {} end
                            table.insert(cand.reasons, "dynamic_catalog_match")
                            table.insert(candidates, cand)
                        end
                    else
                        local details = helpers.fetch_appdetails and helpers.fetch_appdetails(appid, context.language)
                        local title = (details and details.name) or match.name
                        local image = (details and (details.header_image or details.tiny_image))
                            or ("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" .. tostring(appid) .. "/header.jpg")
                        table.insert(candidates, {
                            appid = tostring(appid),
                            name = tostring(title),
                            image = tostring(image),
                            score = 90,
                            confidence = "high",
                            reasons = { "dynamic_catalog", "dynamic_catalog_match" },
                            executable_match = false,
                            direct = false,
                            evidence_tier = "strong",
                        })
                    end
                end
            end
        end
        if #candidates > 0 then break end
    end

    return candidates
end

return M
end
