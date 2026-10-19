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
local normalize = shortcut_detection_text.normalize
local generic_words = shortcut_detection_text.generic_words or {}
local generic_exes = shortcut_detection_text.generic_exes or {}

-- Discovery hints have different information content. A three-character
-- executable must not consume the network budget ahead of its PE or game folder.
function M.discovery_queries(context, aliases)
    local queries, seen, priorities, order, alias_candidates = {}, {}, {}, {}, {}
    local function add_query(value, priority)
        local searchable = tostring(value or ""):gsub("(%l)(%u)", "%1 %2")
            :gsub("(%a)(%d)", "%1 %2"):gsub("(%d)(%a)", "%1 %2")
        local key = normalize(searchable)
        if #key < 2 or generic_words[key] or generic_exes[key] then return end
        priorities[key] = math.max(priorities[key] or 0, priority or 50)
        if not seen[key] then
            seen[key] = true; queries[#queries + 1] = searchable; order[key] = #queries
        end
    end
    local function check_alias(value, primary)
        local key = normalize(value or "")
        local alias = aliases[key:gsub("%s+", "")] or aliases[key]
        if not alias then return end
        add_query(alias.name, primary and 95 or 65)
        for _, id in ipairs(alias.appids or {}) do
            local previous = alias_candidates[id] or {}
            alias_candidates[id] = { name = alias.name, primary = primary or previous.primary,
                unique = #(alias.appids or {}) == 1 or previous.unique,
                automatic = tostring(alias.auto_appid or "") == tostring(id) or previous.automatic }
        end
    end
    for _, value in ipairs({ context.title_hint or false, context.title or false,
        context.exe_stem or false, context.raw_exe_stem or false,
        context.pe_product or false, context.pe_desc or false }) do
        if value then check_alias(value, true) end
    end
    add_query(context.pe_product, 100); add_query(context.pe_desc, 99)
    for index, folder in ipairs(context.folders or {}) do
        check_alias(folder, false)
        if #normalize(folder):gsub("%s+", "") > 3 then add_query(folder, 85 - index) end
    end
    local title = tostring(context.title or "")
    local short = #normalize(title):gsub("%s+", "") <= 3
    add_query(title, short and 20 or 90); add_query(context.title_hint, short and 20 or 90)
    for segment in title:gmatch("[^–—:|%-]+") do
        if #segment >= 3 and segment ~= title then add_query(segment, 50); check_alias(segment, false) end
    end
    local tokens = shortcut_detection_text.tokens(context.exe_stem or "", true)
    local rebuilt = {}; for token in pairs(tokens) do rebuilt[#rebuilt + 1] = token end
    table.sort(rebuilt)
    add_query(table.concat(rebuilt, " "), #normalize(context.exe_stem or ""):gsub("%s+", "") <= 3 and 15 or 60)
    table.sort(queries, function(a, b)
        local ak, bk = normalize(a), normalize(b)
        return priorities[ak] == priorities[bk] and order[ak] < order[bk] or priorities[ak] > priorities[bk]
    end)
    return queries, alias_candidates
end

function M.identity_evidence(name, context)
    local result = { matched = false, collision = false, positive_collision = false, similarity = 0 }
    local folder_year_only = false
    local function compare(value, kind)
        local key = normalize(value or "")
        if #key:gsub("%s+", "") < 4 or generic_words[key] or generic_exes[key] then return end
        local identity = shortcut_detection_text.compare_title_identities(value, name)
        -- The first release often has no "1" in its real product name. Require
        -- the same full name in its installation folder before treating that
        -- omission as a definite conflict with a numbered later installment.
        if kind == "pe" and identity.base_matches and not identity.shortcut_id.sequel
            and (identity.candidate_id.sequel or 0) > 1 and key == identity.shortcut_id.base_title then
            for _, folder in ipairs(context.folders or {}) do
                if normalize(folder) == key then
                    result.collision, result.positive_collision = true, true
                end
            end
        end
        if identity.is_collision then
            local omitted_year = identity.year_mismatch and not identity.candidate_id.year
                and not identity.sequel_mismatch and not identity.remake_mismatch and not identity.edition_mismatch
            if kind == "folder" and omitted_year then
                folder_year_only = true
            else result.collision = true end
            if not omitted_year then result.positive_collision = true end
        end
        local similarity = math.max(shortcut_detection_text.similarity(value, name),
            shortcut_detection_text.compact_similarity(value, name))
        result.similarity = math.max(result.similarity, similarity)
        if similarity >= 0.65 then result.matched = true end
        if key == normalize(name) then result[kind .. "_exact"] = true end
    end
    compare(context.pe_product, "pe"); compare(context.pe_desc, "pe")
    compare(context.title, "title"); compare(context.exe_stem, "exe")
    for _, folder in ipairs(context.folders or {}) do compare(folder, "folder") end
    result.collision = result.collision or (folder_year_only and not result.pe_exact)
    return result
end

-- Only official metadata can permanently suppress a local-phase candidate.
-- A network miss and a weak graph label are never a positive rejection.
function M.reject_official(appid, official, context)
    if type(official) ~= "table" then return false end
    local kind = tostring(official.type or ""):lower()
    local collision = official.name and M.identity_evidence(official.name, context).positive_collision
    local rejected = (kind ~= "" and kind ~= "game" and kind ~= "app") or collision
    if rejected and context.rejected then context.rejected[tostring(appid)] = true end
    return rejected
end

function M.viable_candidate(candidate, context)
    local kind = tostring(candidate.item_type or ""):lower()
    if (kind ~= "" and kind ~= "game" and kind ~= "app")
        or (candidate._reason_set and candidate._reason_set.non_game_result) then return false end
    local evidence = M.identity_evidence(candidate.name or "", context)
    if evidence.collision then return false end
    if candidate.direct or candidate.executable_match then return true end
    return not candidate.identity_collision and not evidence.collision
        and (candidate.alias_primary == true or evidence.matched)
end

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
    if not search_body or type(search_body.search) ~= "table" then return {} end
    if #search_body.search == 0 then
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
    if not claims_body or type(claims_body.entities) ~= "table" then return {} end
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
    local terms, seen_terms = {}, {}
    local function add_term(value)
        local cleaned = clean_query_term(value)
        local key = normalize(cleaned)
        if #key:gsub("%s+", "") >= 4 and not generic_words[key] and not generic_exes[key] and not seen_terms[key] then
            seen_terms[key] = true; terms[#terms + 1] = cleaned
        end
    end
    add_term(context.pe_product); add_term(context.pe_desc)
    for _, folder in ipairs(context.folders or {}) do add_term(folder) end
    add_term(context.title); add_term(context.exe_stem)
    local candidates, seen_appids = {}, {}
    for index = 1, math.min(#terms, 3) do
        for _, match in ipairs(M.resolve_catalog_appids(terms[index], 2.5) or {}) do
            local appid = tostring(match.appid or "")
            local graph = M.identity_evidence(match.name or "", context)
            if appid:match("^%d+$") and not seen_appids[appid] and graph.matched and not graph.collision then
                seen_appids[appid] = true
                local details = helpers.fetch_appdetails and helpers.fetch_appdetails(appid, context.language)
                local appinfo = helpers.fetch_appinfo and helpers.fetch_appinfo(appid)
                local common = type(appinfo) == "table" and appinfo.common or nil
                local official = type(details) == "table" and details.name and details or common
                local kind = type(official) == "table" and tostring(official.type or ""):lower() or ""
                local title = type(official) == "table" and official.name or match.name
                local evidence = M.identity_evidence(title or "", context)
                local game = kind == "game" or kind == "app" or (kind == "" and match.is_game == true)
                local rejected = M.reject_official(appid, details, context) or M.reject_official(appid, common, context)
                if not rejected and game and evidence.matched and not evidence.collision then
                    local confirmed = type(official) == "table" and official.name ~= nil
                    local direct = confirmed and helpers.direct_result and helpers.direct_result(appid, "dynamic_catalog", request,
                        context.language, context.launcher, context.generic_launcher, match.name, context)
                    if direct and type(direct.candidates) == "table" and #direct.candidates > 0 then
                        for _, candidate in ipairs(direct.candidates) do
                            candidate.reasons = candidate.reasons or {}
                            candidate.reasons[#candidate.reasons + 1] = "dynamic_catalog_match"
                            candidates[#candidates + 1] = candidate
                        end
                    else
                        -- A graph claim discovers an AppID; it never substitutes
                        -- for executable or official-title proof rejected above.
                        local score = confirmed and (evidence.pe_exact and 94 or evidence.title_exact and 92
                            or evidence.folder_exact and 72 or 55) or 55
                        local reasons = { "dynamic_catalog", "dynamic_catalog_match" }
                        if confirmed and evidence.pe_exact then reasons[#reasons + 1] = "pe_product_exact"
                        elseif confirmed and evidence.title_exact then reasons[#reasons + 1] = "official_title_exact"
                        elseif confirmed and evidence.folder_exact then reasons[#reasons + 1] = "folder_exact"
                        else reasons[#reasons + 1] = "catalog_identity_hint" end
                        candidates[#candidates + 1] = { appid = appid, name = tostring(title),
                            image = (details and (details.header_image or details.tiny_image))
                                or ("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" .. appid .. "/header.jpg"),
                            score = score, confidence = score >= 90 and "high" or score >= 70 and "medium" or "low",
                            reasons = reasons, executable_match = false, direct = false,
                            evidence_tier = score >= 88 and "strong" or score >= 65 and "supporting" or "hint",
                            validation_state = confirmed and "confirmed" or "partial" }
                    end
                end
            end
        end
        table.sort(candidates, function(a, b) return a.score == b.score and tonumber(a.appid) < tonumber(b.appid) or a.score > b.score end)
        if candidates[1] and candidates[1].score >= 72 then break end
    end
    return candidates
end

return M
end
