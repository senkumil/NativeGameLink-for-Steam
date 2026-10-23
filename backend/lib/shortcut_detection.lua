return function(deps)
local logger = deps.logger
local millennium = deps.millennium
local cjson = deps.cjson
local fs = deps.fs
local util = deps.util
local config = deps.config
local M = {}
local detection_url_encode = util.url_encode
local function detection_encode(value)
    return cjson.encode(util.sanitize_utf8_tree(value))
end
-- Bounded LRU caches. TTL alone does not release entries that are never read
-- again, which matters during long-running Steam sessions with many games.
local detection_cache = deps.ttl_cache
local detection_new_cache, detection_cache_get, detection_cache_set = detection_cache.new, detection_cache.get, detection_cache.set
local detection_candidate_cache, detection_vdf_cache = detection_new_cache(128), detection_new_cache(16)
local detection_store_cache, detection_appdetails_cache, detection_appinfo_cache = detection_new_cache(96), detection_new_cache(96), detection_new_cache(96)
-- A maintained alias (for example "re4") only narrows the search.  It must
-- never look like near-certain identification unless the candidate's official
-- Steam launch configuration also contains the executable we are inspecting.
local DETECTION_UNVERIFIED_ALIAS_MAX_SCORE = 84
local DETECTION_MODEL_VERSION = "v13"
-- Pure text matching and the maintained alias catalogue live in focused
-- modules; this detector remains responsible for filesystem/network evidence.
local detection_text = deps.shortcut_detection_text
local detection_trim, detection_clean_path = detection_text.trim, detection_text.clean_path
local detection_basename, detection_stem = detection_text.basename, detection_text.stem
local detection_game_exe_hint, detection_normalize = detection_text.game_exe_hint, detection_text.normalize
local detection_clean_game_title = detection_text.clean_game_title
local DETECTION_GENERIC_WORDS, DETECTION_GENERIC_EXES = detection_text.generic_words, detection_text.generic_exes
local KNOWN_TITLE_ALIASES = deps.shortcut_detection_aliases
local detection_pe = deps.shortcut_detection_pe
local detection_tokens, detection_similarity = detection_text.tokens, detection_text.similarity
local detection_compact_similarity, detection_acronym_similarity = detection_text.compact_similarity, detection_text.acronym_similarity
local function detection_read_small_file(path, max_bytes)
    if not path or path == "" or not fs.exists(path) then return nil end
    local handle = io.open(path, "r")
    if not handle then return nil end
    local content = handle:read(max_bytes or 8192); handle:close()
    return content
end
local function detection_read_binary_file(path, max_bytes)
    if not path or path == "" or not fs.exists(path) then return nil end
    local handle = io.open(path, "rb")
    if not handle then return nil end
    local content = handle:read("*a"); handle:close()
    return (content and content ~= "" and #content <= (max_bytes or 8 * 1024 * 1024)) and content or nil
end
local detection_binary_cstring = util.binary_cstring
local detection_binary_i32 = util.binary_i32
local detection_parse_binary_vdf_object = util.parse_binary_vdf_object
local function detection_shortcut_appid(value)
    local id = tonumber(value)
    return id and math.floor(id < 0 and id + 4294967296 or id) or nil
end
local function detection_find_shortcut_record(shortcut_app_id, shortcut_title)
    local target = detection_shortcut_appid(shortcut_app_id)
    local target_title_norm = detection_normalize(shortcut_title or "")
    if not target and target_title_norm == "" then return nil end
    local userdata_root = fs.join(millennium.steam_path(), "userdata")
    if not fs.exists(userdata_root) then return nil end
    local files, title_match, title_ambiguous = {}, nil, false
    local ok_list, entries = pcall(fs.list, userdata_root)
    if ok_list and type(entries) == "table" then
        for _, entry in ipairs(entries) do
            local entry_path = tostring(entry.path or "")
            local account_id = tostring(entry.name or detection_basename(entry_path)):match("^(%d+)$")
            if account_id then
                if entry_path == "" then entry_path = fs.join(userdata_root, account_id) end
                local shortcut_file = fs.join(entry_path, "config", "shortcuts.vdf")
                if fs.exists(shortcut_file) then
                    table.insert(files, {
                        path = shortcut_file,
                        account_id = account_id,
                        modified = tonumber(fs.last_write_time(shortcut_file) or 0) or 0,
                    })
                end
            end
        end
    end
    local preferred = deps.shortcut_registry and deps.shortcut_registry.preferred_account_id
        and deps.shortcut_registry.preferred_account_id() or nil
    if preferred then
        preferred = tostring(preferred)
        local active_files = {}
        for _, file in ipairs(files) do
            if file.account_id == preferred then active_files[#active_files + 1] = file end
        end
        -- Once Steam tells us which account is active, never resolve a shortcut
        -- from another user's userdata tree.
        files = active_files
    end
    table.sort(files, function(a, b) return a.modified > b.modified end)
    for _, file in ipairs(files) do
        local shortcuts = nil
        local cached_vdf = detection_cache_get(detection_vdf_cache, file.path)
        if cached_vdf and cached_vdf.modified == file.modified then
            shortcuts = cached_vdf.shortcuts
        else
            local data = detection_read_binary_file(file.path)
            if data then
                local root = detection_parse_binary_vdf_object(data, 1, 0)
                shortcuts = type(root) == "table" and (root.shortcuts or root) or nil
                if type(shortcuts) == "table" then
                    detection_cache_set(detection_vdf_cache, file.path, { modified = file.modified, shortcuts = shortcuts })
                end
            end
        end
        if type(shortcuts) == "table" then
            for _, record in pairs(shortcuts) do
                if type(record) == "table" then
                    -- `shortcuts.vdf` keeps the shortcut id as an unsigned
                    -- 32-bit value, even though Steam's CEF can expose it as
                    -- a signed number.  Resolve both forms before comparing.
                    -- These fields are also the only reliable source of the
                    -- executable while a newly-created shortcut has not yet
                    -- been reflected in SteamClient's cached app details.
                    local rec_appid = detection_shortcut_appid(
                        record.appid or record.AppID or record.appid_64 or record.appid64)
                    local rec_title = detection_trim(record.AppName or record.appname or record.Name or record.name or "")
                    local matches_id = target ~= nil and rec_appid ~= nil and rec_appid == target
                    local rec_clean = detection_clean_game_title(rec_title):lower()
                    local target_clean = detection_clean_game_title(shortcut_title or ""):lower()
                    local matches_title = target_title_norm ~= "" and (
                        detection_normalize(rec_title) == target_title_norm
                        or (rec_clean ~= "" and rec_clean == target_clean)
                    )
                    if matches_id or (not target and matches_title) then
                        local shortcut = {
                            shortcut_app_id = tostring(rec_appid or target or ""),
                            title = rec_title,
                            exe_path = detection_clean_path(record.Exe or record.exe or ""),
                            start_dir = detection_clean_path(record.StartDir or record.startdir or ""),
                            launch_options = detection_trim(record.LaunchOptions or record.launchoptions or ""),
                            source = "shortcuts_vdf",
                        }
                        if matches_id then return shortcut end
                        if title_match then title_ambiguous = true else title_match = shortcut end
                    end
                end
            end
        end
    end
    return not title_ambiguous and title_match or nil
end
function M.get_shortcut_details(shortcut_app_id, shortcut_title)
    local target_id = shortcut_app_id
    local target_title = shortcut_title
    if type(shortcut_app_id) == "string" and shortcut_app_id:match("^%s*{") then
        local ok, parsed = pcall(cjson.decode, shortcut_app_id)
        if ok and type(parsed) == "table" then
            target_id = parsed.shortcut_app_id or parsed.id
            target_title = parsed.title or parsed.name
        end
    end
    local record = detection_find_shortcut_record(target_id, target_title)
    if not record then
        return detection_encode({ error = "shortcut_not_found" })
    end
    logger:info("Resolved shortcut details from shortcuts.vdf for " .. tostring(target_id or target_title))
    return detection_encode(record)
end
local detection_http_json = deps.shortcut_detection_catalog.http_json
local function detection_fetch_appdetails(appid, language, budget)
    local id = tostring(appid or "")
    if not id:match("^%d+$") then return nil end
    local lang = language or "english"
    local cache_key = id .. "\31" .. lang
    local cached = detection_cache_get(detection_appdetails_cache, cache_key, 1800)
    if cached then return cached.data end
    local url = "https://store.steampowered.com/api/appdetails?appids=" .. id
        .. "&l=" .. detection_url_encode(lang)
    local body = detection_http_json(url, 2.5, budget)
    local record = type(body) == "table" and body[id] or nil
    if type(record) == "table" and record.success and type(record.data) == "table" then
        detection_cache_set(detection_appdetails_cache, cache_key, { data = record.data, ttl = 1800 })
        return record.data
    end
    return nil
end
local function detection_appid_from_arguments(arguments)
    local args = tostring(arguments or "")
    return args:match("steam://rungameid/(%d+)")
        or args:match("[%-%/]appid[%s=]+(%d+)")
        or args:match("[%-%/]app_id[%s=]+(%d+)")
end
local function detection_find_steam_appid_file(exe_path)
    local dir = fs.parent_path(detection_clean_path(exe_path))
    for _ = 1, 4 do
        if not dir or dir == "" then break end
        local content = detection_read_small_file(fs.join(dir, "steam_appid.txt"), 128)
        local appid = content and content:match("(%d+)") or nil
        if appid then return appid, "steam_appid_file" end
        local parent = fs.parent_path(dir)
        if not parent or parent == "" or parent == dir then break end
        dir = parent
    end
    return nil, nil
end
local function detection_find_appmanifest(exe_path)
    local path = detection_clean_path(exe_path)
    local marker_start = path:lower():find("\\steamapps\\common\\", 1, true)
    if not marker_start then return nil, nil end
    local steamapps_dir = path:sub(1, marker_start + 10)
    local install_folder = path:sub(marker_start + 18):match("^([^\\]+)")
    if not install_folder or install_folder == "" then return nil, nil end
    local ok_list, entries = pcall(fs.list, steamapps_dir)
    if not ok_list or type(entries) ~= "table" then return nil, nil end
    for _, entry in ipairs(entries) do
        local entry_path = tostring(entry.path or "")
        local name = tostring(entry.name or detection_basename(entry_path))
        local manifest_id = name:match("^appmanifest_(%d+)%.acf$")
        if manifest_id then
            if entry_path == "" then entry_path = fs.join(steamapps_dir, name) end
            local content = detection_read_small_file(entry_path, 256 * 1024)
            local install_dir = content and content:match('"installdir"%s*"([^"]+)"') or nil
            if install_dir and install_dir:lower() == install_folder:lower() then
                return (content and content:match('"appid"%s*"(%d+)"')) or manifest_id, "steam_appmanifest"
            end
        end
    end
    return nil, nil
end
local function detection_store_search(query, language, recovery_mode, budget)
    local cleaned = deps.shortcut_detection_catalog.search_query(query)
    if #cleaned < 2 then return {}, false end
    local lang = language or "english"
    local cache_key = cleaned:lower() .. "\31" .. lang
    local cached = detection_cache_get(detection_store_cache, cache_key, 600)
    if cached then return cached.items, cached.confirmed == true end
    local function fetch_for_language(target_lang, timeout)
        local url = "https://store.steampowered.com/api/storesearch/?term="
            .. detection_url_encode(cleaned)
            .. "&l=" .. detection_url_encode(target_lang)
            .. "&cc=US"
        local body = detection_http_json(url, timeout, budget)
        if type(body) ~= "table" then return nil end
        if type(body.items) ~= "table" then
            if budget then budget.incomplete = true end
            return nil
        end
        return body.items
    end
    local timeout = recovery_mode and 4.0 or 2.5
    local items = fetch_for_language(lang, timeout)
    if recovery_mode and (type(items) ~= "table" or #items == 0) and lang:lower() ~= "english" then
        items = fetch_for_language("english", timeout)
    end
    if type(items) ~= "table" then return {}, false end
    detection_cache_set(detection_store_cache, cache_key, { items = items, confirmed = true, ttl = 600 })
    return items, true
end
local function detection_fetch_appinfo(appid, budget)
    local id = tostring(appid or "")
    if not id:match("^%d+$") then return nil end
    local cached = detection_cache_get(detection_appinfo_cache, id, 1800)
    if cached then return cached.data end
    local body = detection_http_json("https://api.steamcmd.net/v1/info/" .. id, 1.5, budget)
    local data = type(body) == "table" and type(body.data) == "table" and body.data[id] or nil
    if data then detection_cache_set(detection_appinfo_cache, id, { data = data, ttl = 1800 }) end
    return data
end
local function detection_collect_launch_executables(node, result, depth)
    if type(node) ~= "table" or depth > 8 then return end
    for key, value in pairs(node) do
        local lowered = tostring(key):lower()
        if type(value) == "string" and (lowered == "executable" or lowered == "binary") then
            local basename = detection_basename(value):lower()
            if basename ~= "" then result[basename] = true end
        elseif type(value) == "table" then
            detection_collect_launch_executables(value, result, depth + 1)
        end
    end
end
local function detection_folder_hints(exe_path, start_dir)
    local hints, seen = {}, {}
    local dir = detection_clean_path(start_dir ~= "" and start_dir or fs.parent_path(detection_clean_path(exe_path)))
    for _ = 1, 6 do
        if not dir or dir == "" then break end
        local c = detection_clean_game_title(detection_basename(dir))
        local n = detection_normalize(c)
        if c ~= "" and n ~= "" and not seen[n] then seen[n] = true; table.insert(hints, c) end
        local parent = fs.parent_path(dir)
        if not parent or parent == dir then break end
        dir = parent
    end
    return hints
end
local function detection_add_reason(candidate, reason)
    candidate._reason_set = candidate._reason_set or {}
    if not candidate._reason_set[reason] then
        candidate._reason_set[reason] = true
        table.insert(candidate.reasons, reason)
    end
end
local function detection_direct_result(appid, source, request, language, launcher, generic_launcher, fallback_name, identity_context, budget)
    local data = detection_fetch_appdetails(appid, language, budget)
    local validation_source = "steam_store_appdetails"
    local appinfo = detection_fetch_appinfo(appid, budget)
    local common = type(appinfo) == "table" and type(appinfo.common) == "table" and appinfo.common or nil
    local catalog = deps.shortcut_detection_catalog
    if catalog.reject_official(appid, data, identity_context)
        or catalog.reject_official(appid, common, identity_context) then return nil end
    if not data or not data.name or data.name == "" then
        if common and common.name and tostring(common.name) ~= "" then
            local app_type = tostring(common.type or ""):lower()
            if app_type == "" or app_type == "game" or app_type == "app" then
                data = { name = tostring(common.name), type = common.type }
                validation_source = "steam_appinfo"
            end
        end
    end
    if source == "maintained_alias" and data and data.name and fallback_name and fallback_name ~= "" then
        local fetched_norm = detection_normalize(data.name):gsub("%s+", "")
        local fallback_norm = detection_normalize(fallback_name):gsub("%s+", "")
        local title_norm = detection_normalize(request.title or ""):gsub("%s+", "")
        local matches_alias = fetched_norm:find(fallback_norm, 1, true) or fallback_norm:find(fetched_norm, 1, true)
        local matches_title = title_norm ~= "" and (fetched_norm:find(title_norm, 1, true) or title_norm:find(fetched_norm, 1, true))
        if not matches_alias and not matches_title and validation_source ~= "maintained_alias_catalogue" then
            identity_context.rejected[tostring(appid)] = true
            logger:warn("Maintained alias " .. tostring(fallback_name) .. " (AppID " .. tostring(appid) .. ") name mismatch with Store name '" .. tostring(data.name) .. "', rejecting direct match")
            return nil
        end
    end
    if (not data or not data.name or data.name == "") and fallback_name and fallback_name ~= "" then
        data = { name = fallback_name }
        validation_source = "maintained_alias_catalogue"
    end
    if not data or not data.name or data.name == "" then return nil end
    local data_type = tostring(data.type or ""):lower()
    if data_type ~= "" and data_type ~= "game" and data_type ~= "app" then return nil end
    local name = data.name
    if catalog.identity_evidence(name, identity_context).collision then return nil end
    local image = data.header_image or data.tiny_image
        or ("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" .. tostring(appid) .. "/header.jpg")
    local official_exes = {}
    if type(appinfo) == "table" and type(appinfo.config) == "table" and type(appinfo.config.launch) == "table" then
        detection_collect_launch_executables(appinfo.config.launch, official_exes, 0)
    end
    local actual_exe = detection_basename(request.exe_path):lower()
    local exe_matched = actual_exe ~= "" and official_exes[actual_exe] == true
    local comp = detection_text.compare_title_identities(request.title or fallback_name or "", name)
    local title_matched = comp.base_matches and not comp.is_collision and not comp.year_mismatch and not comp.sequel_mismatch
    local is_direct_proof = false
    local score = 100
    local confidence = "exact"
    local evidence_tier = "proof"
    local reasons = { source, validation_source }
    if source == "launch_argument" or source == "steam_appmanifest" then
        is_direct_proof = true
        evidence_tier = "proof"
    elseif exe_matched then
        is_direct_proof = true
        evidence_tier = "proof"
        table.insert(reasons, "official_executable_match")
    elseif title_matched then
        is_direct_proof = true
        evidence_tier = "strong"
        table.insert(reasons, "official_title_exact")
    end
    if not is_direct_proof then
        return nil
    end
    return {
        candidates = {{
            appid = tostring(appid),
            name = tostring(name),
            image = tostring(image),
            score = score,
            confidence = confidence,
            reasons = reasons,
            executable_match = exe_matched,
            direct = true,
            evidence_tier = evidence_tier,
        }},
        launcher_detected = launcher,
        generic_launcher = generic_launcher,
        executable = detection_basename(request.exe_path),
        source = source,
    }
end
function M.detect_game_candidates_local(request_json)
    local ok_request, request = pcall(cjson.decode, tostring(request_json or "{}"))
    if not ok_request or type(request) ~= "table" then
        return detection_encode({ error = "invalid_request", candidates = {} })
    end
    if deps.shortcut_detection_local and deps.shortcut_detection_local.discover_local_candidates then
        return detection_encode(deps.shortcut_detection_local.discover_local_candidates(request))
    end
    return detection_encode({ candidates = {}, error = "local_engine_unavailable" })
end
function M.detect_game_candidates(request_json)
    local ok_request, request = pcall(cjson.decode, tostring(request_json or "{}"))
    if not ok_request or type(request) ~= "table" then
        return detection_encode({ error = "invalid_request", candidates = {} })
    end
    if request.phase == "local" then
        return M.detect_game_candidates_local(request_json)
    end
    request.title = detection_trim(request.title):sub(1, 240)
    request.exe_path = detection_clean_path(request.exe_path):sub(1, 4096)
    request.start_dir = detection_clean_path(request.start_dir):sub(1, 4096)
    request.launch_options = detection_trim(request.launch_options):sub(1, 4096)
    request.shortcut_app_id = detection_trim(request.shortcut_app_id)
    local language = detection_trim(request.language)
    if language == "" then language = "english" end
    local recovery_mode = request.recovery_mode == true
    if (request.shortcut_app_id:match("^%d+$") or request.title ~= "") and (request.exe_path == "" or request.start_dir == "") then
        local shortcut = detection_find_shortcut_record(request.shortcut_app_id, request.title)
        if shortcut then
            if request.title == "" then request.title = shortcut.title end
            if request.exe_path == "" then request.exe_path = shortcut.exe_path end
            if request.start_dir == "" then request.start_dir = shortcut.start_dir end
            if request.launch_options == "" then request.launch_options = shortcut.launch_options end
        end
    end
    local exe_basename = detection_basename(request.exe_path)
    local raw_exe_stem = detection_stem(exe_basename)
    local exe_stem = detection_game_exe_hint(exe_basename)
    local title_hint = detection_game_exe_hint(request.title)
    if detection_trim(title_hint) == "" then title_hint = request.title end
    local title_cleaned = detection_clean_game_title(title_hint)
    if title_cleaned == "" then title_cleaned = title_hint end
    local pe_product_name, pe_file_desc = nil, nil
    if detection_pe and detection_pe.read_pe_metadata then
        pe_product_name, pe_file_desc = detection_pe.read_pe_metadata(request.exe_path)
    end
    local is_generic_pe = detection_pe and detection_pe.is_generic_product_name or function() return false end
    local clean_pe_product = (pe_product_name and not is_generic_pe(pe_product_name))
        and detection_clean_game_title(pe_product_name) or nil
    local clean_pe_desc = (pe_file_desc and not is_generic_pe(pe_file_desc))
        and detection_clean_game_title(pe_file_desc) or nil
    local exe_normalized = detection_normalize(exe_stem)
    local launcher_exe_stem = detection_game_exe_hint(detection_basename(request.exe_path))
    local launcher_exe_normalized = detection_normalize(launcher_exe_stem)
    local launcher = launcher_exe_normalized:find("launcher", 1, true) ~= nil
        or launcher_exe_normalized == "start protected game"
        or launcher_exe_normalized:find("bootstrapper", 1, true) ~= nil
    local generic_launcher = DETECTION_GENERIC_EXES[launcher_exe_normalized] == true
    local cache_key = table.concat({
        DETECTION_MODEL_VERSION, request.title, request.exe_path, request.start_dir,
        request.launch_options, language
    }, "\31")
    local cached = detection_cache_get(detection_candidate_cache, cache_key, 600)
    if cached then return cached.json end
    local budget = deps.shortcut_detection_catalog.new_request_budget(request.expires_at_ms)
    local folders = detection_folder_hints(request.exe_path, request.start_dir)
    local identity_context = { title = title_cleaned, exe_stem = exe_stem, rejected = {},
        pe_product = clean_pe_product, pe_desc = clean_pe_desc, folders = folders }
    local function encode_result(result)
        if budget.incomplete then result.transient_error, result.validation_state = true, "partial" end
        local filtered, rejected = {}, {}
        for _, candidate in ipairs(result.candidates or {}) do
            if not identity_context.rejected[tostring(candidate.appid)] then filtered[#filtered + 1] = candidate end
        end
        for appid in pairs(identity_context.rejected) do rejected[#rejected + 1] = appid end
        table.sort(rejected, function(a, b) return tonumber(a) < tonumber(b) end)
        result.candidates, result.rejected_appids = filtered, rejected
        return detection_encode(result)
    end
    local direct_appid = detection_appid_from_arguments(request.launch_options)
    local direct_source = direct_appid and "launch_argument" or nil
    if not direct_appid and request.exe_path ~= "" then
        direct_appid, direct_source = detection_find_steam_appid_file(request.exe_path)
        if not direct_appid then direct_appid, direct_source = detection_find_appmanifest(request.exe_path) end
    end
    if direct_appid then
        local direct = detection_direct_result(direct_appid, direct_source, request, language, launcher, generic_launcher, nil, identity_context, budget)
        if direct then
            local encoded = encode_result(direct)
            if not budget.incomplete then detection_cache_set(detection_candidate_cache, cache_key, { json = encoded, ttl = 600 }) end
            return encoded
        end
    end
    -- Curated aliases may declare one automatic AppID when the executable/title
    -- itself is an exact maintained identity (for example gta_sa or re9).  This
    -- bypasses several Store searches, but still goes through appdetails/appinfo
    -- validation before becoming a direct result; an unavailable or non-game
    -- AppID therefore falls back to the normal ranked-candidate path.
    local function automatic_alias_appid(value)
        local norm = detection_normalize(value)
        if norm == "" then return nil, nil end
        local alias = KNOWN_TITLE_ALIASES[norm:gsub("%s+", "")] or KNOWN_TITLE_ALIASES[norm]
        local appid = alias and tostring(alias.auto_appid or "") or ""
        return (appid:match("^%d+$") and appid or nil), (alias and alias.name or nil)
    end
    for _, identity_hint in ipairs({ clean_pe_product or false, clean_pe_desc or false, title_hint, title_cleaned, exe_stem, raw_exe_stem }) do
        if identity_hint then
            local alias_appid, alias_name = automatic_alias_appid(identity_hint)
            if alias_appid then
                local direct = detection_direct_result(alias_appid, "maintained_alias", request, language, launcher, generic_launcher, alias_name, identity_context, budget)
                if direct then
                    local encoded = encode_result(direct)
                    if not budget.incomplete then detection_cache_set(detection_candidate_cache, cache_key, { json = encoded, ttl = 600 }) end
                    return encoded
                end
            end
        end
    end
    local queries, alias_candidates = deps.shortcut_detection_catalog.discovery_queries({
        title = title_cleaned, title_hint = title_hint, exe_stem = exe_stem, raw_exe_stem = raw_exe_stem,
        pe_product = clean_pe_product, pe_desc = clean_pe_desc, folders = folders,
    }, KNOWN_TITLE_ALIASES)
    local is_short_title = #detection_normalize(title_cleaned):gsub("%s+", "") <= 3
    local by_id = {}
    if type(request.local_candidates) == "table" then
        for _, cand in ipairs(request.local_candidates) do
            local cid = tostring(cand.appid or "")
            if cid:match("^%d+$") then
                by_id[cid] = {
                    appid = cid,
                    name = tostring(cand.name or ""),
                    image = tostring(cand.image or ("https://cdn.cloudflare.steamstatic.com/steam/apps/" .. cid .. "/header.jpg")),
                    item_type = "game",
                    reasons = type(cand.reasons) == "table" and cand.reasons or { "local_discovery" },
                    query_rank = 10,
                    query_index = 1,
                    executable_match = cand.executable_match == true,
                    direct = cand.direct == true,
                    alias_hint = cand.alias_hint == true or cand.evidence_tier == "hint",
                    alias_primary = cand.alias_primary == true,
                    alias_unique = cand.alias_unique == true,
                    alias_automatic = cand.alias_automatic == true,
                    from_appid_file = cand.from_appid_file == true,
                    local_score = tonumber(cand.score) or 0,
                    identity_collision = cand.identity_collision == true,
                }
            end
        end
    end
    for direct_id, info in pairs(alias_candidates) do
        local candidate = by_id[direct_id]
        if not candidate then
            local image = "https://cdn.cloudflare.steamstatic.com/steam/apps/" .. direct_id .. "/header.jpg"
            candidate = {
                appid = direct_id,
                name = info.name,
                image = image,
                item_type = "game",
                reasons = { "franchise_alias" },
                query_rank = 10,
                query_index = 1,
                executable_match = false,
                direct = false,
            }
            by_id[direct_id] = candidate
        end
        candidate.alias_hint = true
        candidate.alias_primary = info.primary == true
        candidate.alias_unique = info.unique == true
        candidate.alias_automatic = info.automatic == true
    end
    local strong_local_candidate = false
    for _, candidate in pairs(by_id) do
        if (tonumber(candidate.local_score) or 0) >= 90 and candidate.identity_collision ~= true then
            strong_local_candidate = true
        end
    end
    -- A strong local identity already gives the UI a useful answer. Avoid serial
    -- Store Search calls in the common exact-title/maintained-alias case; remote
    -- enrichment can validate the top local candidate directly through AppInfo.
    local max_queries = recovery_mode and math.min(#queries, 6)
        or (strong_local_candidate and 0)
        or math.min(#queries, 3)
	local store_search_confirmed = true
    for query_index = 1, max_queries do
        local query_text = queries[query_index]
        local query_norm = detection_normalize(query_text)
        local is_short_query = #query_norm:gsub("%s+", "") <= 3
        local items, search_confirmed = detection_store_search(query_text, language, recovery_mode, budget)
		if not search_confirmed then store_search_confirmed = false end
        local found_exact_match = false
        for rank = 1, math.min(#items, 15) do
            local item = items[rank]
            local appid = tostring(type(item) == "table" and (item.id or item.appid) or "")
            local name = type(item) == "table" and tostring(item.name or "") or ""
            if appid:match("^%d+$") and name ~= "" then
                local candidate = by_id[appid]
                if not candidate then
                    candidate = {
                        appid = appid,
                        name = name,
                        image = tostring(item.tiny_image or item.header_image or ("https://cdn.cloudflare.steamstatic.com/steam/apps/" .. appid .. "/header.jpg")),
                        item_type = tostring(item.type or ""),
                        reasons = {},
                        query_rank = rank,
                        query_index = query_index,
                        executable_match = false,
                        direct = false,
                    }
                    by_id[appid] = candidate
                else
                    candidate.query_rank = math.min(candidate.query_rank, rank)
                    candidate.query_index = math.min(candidate.query_index, query_index)
                end
                local sim = math.max(
                    detection_similarity(title_cleaned, name),
                    detection_compact_similarity(title_cleaned, name)
                )
                if not is_short_query and (sim >= 0.82 or detection_normalize(name) == detection_normalize(title_cleaned)) then
                    found_exact_match = true
                end
            end
        end
        -- Early stop: If we already found a strong matching candidate from a distinct query, stop querying
        if found_exact_match and not is_short_query and query_index >= 1 then
            break
        end
    end
    local candidates = {}
    for _, candidate in pairs(by_id) do
        local comp = detection_text.compare_title_identities(request.title or title_cleaned, candidate.name)
        local title_similarity = math.max(
            comp.base_similarity,
            detection_similarity(title_cleaned, candidate.name),
            detection_similarity(title_hint, candidate.name),
            detection_compact_similarity(title_cleaned, candidate.name),
            detection_acronym_similarity(title_cleaned, candidate.name)
        )
        local folder_similarity, folder_exact = 0, false
        local norm_cand = detection_normalize(candidate.name)
        for _, folder in ipairs(folders) do
            local norm_f = detection_normalize(folder)
            if norm_f ~= "" and norm_f == norm_cand then folder_exact = true end
            folder_similarity = math.max(folder_similarity, detection_similarity(folder, candidate.name), detection_compact_similarity(folder, candidate.name))
        end
        local exe_similarity = DETECTION_GENERIC_EXES[exe_normalized] and 0
            or math.max(detection_similarity(exe_stem, candidate.name), detection_compact_similarity(exe_stem, candidate.name))
        local norm_title = detection_normalize(title_cleaned)
        local score = title_similarity * 55 + folder_similarity * 20 + exe_similarity * 15 + math.max(0, 8 - math.min(candidate.query_rank, 8))
        if candidate.local_score and candidate.local_score > score then score = candidate.local_score end
        if candidate.alias_hint then score = score + 5; detection_add_reason(candidate, "franchise_alias") end
        if candidate.from_appid_file then score = score + 10; detection_add_reason(candidate, "steam_appid_file") end
        if norm_title ~= "" and norm_title == norm_cand then
            if is_short_title and not folder_exact and folder_similarity < 0.7 and not candidate.executable_match then
                score = math.min(score, 60); detection_add_reason(candidate, "short_title_unverified")
            else
                score = math.max(score, 90); detection_add_reason(candidate, "title_exact")
            end
        elseif title_similarity >= 0.65 then detection_add_reason(candidate, "title_similar") end
        if folder_exact then
            score = score + 18
            if is_short_title and not comp.is_collision then score = math.max(score, 72) end
            detection_add_reason(candidate, "folder_exact")
        elseif folder_similarity >= 0.65 then score = score + 8; detection_add_reason(candidate, "folder_match") end
        if clean_pe_product and candidate.name then
            local pe_sim = math.max(detection_similarity(clean_pe_product, candidate.name), detection_compact_similarity(clean_pe_product, candidate.name))
            if pe_sim >= 0.82 or detection_normalize(candidate.name) == detection_normalize(clean_pe_product) then
                score = math.max(score, 94); detection_add_reason(candidate, "pe_product_exact")
            elseif pe_sim >= 0.60 then score = score + 16; detection_add_reason(candidate, "pe_product_match") end
        end
        if comp.year_match then score = score + 20; detection_add_reason(candidate, "year_match")
        elseif comp.year_mismatch then score = score - 25; detection_add_reason(candidate, "year_mismatch") end
        if comp.sequel_match then score = score + 15; detection_add_reason(candidate, "sequel_match")
        elseif comp.sequel_mismatch then score = score - 35; detection_add_reason(candidate, "sequel_mismatch") end
        if comp.remake_mismatch then score = score - 30; detection_add_reason(candidate, "remake_mismatch") end
        if comp.is_collision then candidate.identity_collision = true; detection_add_reason(candidate, "identity_collision") end
        if exe_similarity >= 0.75 then detection_add_reason(candidate, "executable_name_match") end
        if exe_stem ~= raw_exe_stem and exe_similarity >= 0.55 then detection_add_reason(candidate, "shipping_executable_match") end
        detection_add_reason(candidate, "steam_store_search")
        candidate.score = score
        if deps.shortcut_detection_catalog.viable_candidate(candidate, identity_context) then
            table.insert(candidates, candidate)
        end
    end
    table.sort(candidates, function(a, b) return a.score == b.score and tonumber(a.appid) < tonumber(b.appid) or a.score > b.score end)
    local actual_exe = exe_basename:lower()
    local function validate_candidate(candidate)
        if candidate._validated then return end
        candidate._validated = true
        local appinfo = detection_fetch_appinfo(candidate.appid, budget) or {}
        local details = detection_fetch_appdetails(candidate.appid, language, budget)
        if deps.shortcut_detection_catalog.reject_official(candidate.appid, details, identity_context)
            or deps.shortcut_detection_catalog.reject_official(candidate.appid, appinfo.common, identity_context) then
            candidate.identity_collision = true
            return
        end
        local common = type(appinfo.common) == "table" and appinfo.common or nil
        if not common or not common.name then common = details end
        if type(common) ~= "table" then return end
        if common.name and tostring(common.name) ~= "" then
            candidate.name = tostring((details and details.name) or common.name)
            local norm_name = detection_normalize(candidate.name)
            if norm_name == detection_normalize(title_cleaned) or norm_name == detection_normalize(request.title) then
                if is_short_title then
                    -- An exact 1-3 character Store title (e.g. "B1") is not independent
                    -- identity evidence. Keep it provisional until another signal corroborates it.
                    candidate.score = math.min(candidate.score, 60)
                    detection_add_reason(candidate, "short_title_unverified")
                else
                    candidate.score = math.max(candidate.score, 92)
                    detection_add_reason(candidate, "official_title_exact")
                end
            end
            local comp = detection_text.compare_title_identities(request.title, candidate.name)
            if comp.year_match and not (candidate._reason_set and candidate._reason_set["year_match"]) then candidate.score = candidate.score + 18; detection_add_reason(candidate, "year_match")
            elseif comp.year_mismatch and not (candidate._reason_set and candidate._reason_set["year_mismatch"]) then candidate.score = candidate.score - 25; detection_add_reason(candidate, "year_mismatch") end
            if comp.sequel_mismatch and not (candidate._reason_set and candidate._reason_set["sequel_mismatch"]) then candidate.score = candidate.score - 35; detection_add_reason(candidate, "sequel_mismatch") end
            if comp.remake_mismatch and not (candidate._reason_set and candidate._reason_set["remake_mismatch"]) then candidate.score = candidate.score - 30; detection_add_reason(candidate, "remake_mismatch") end
            if comp.is_collision then candidate.identity_collision = true; detection_add_reason(candidate, "identity_collision") end
        end
        local official_image = details and (details.header_image or details.capsule_image or details.capsule_imagev5)
            or common.header_image
        if official_image and tostring(official_image) ~= "" then
            candidate.image = tostring(official_image)
        end
        local app_type = tostring(common.type or candidate.item_type or ""):lower()
        local official_type = tostring(common.type or ""):lower()
        local details_type = type(details) == "table" and tostring(details.type or ""):lower() or ""
        candidate._official_type_verified = official_type == "game" or official_type == "app"
            or details_type == "game" or details_type == "app"
        if app_type ~= "" and app_type ~= "game" and app_type ~= "app" then
            candidate.score = candidate.score - 40; detection_add_reason(candidate, "non_game_result")
        end
        local official_exes = {}
        if type(appinfo.config) == "table" and type(appinfo.config.launch) == "table" then
            detection_collect_launch_executables(appinfo.config.launch, official_exes, 0)
        end
        if actual_exe ~= "" and official_exes[actual_exe] then
            local actual_stem = detection_normalize(detection_stem(actual_exe))
            local request_short_token = detection_normalize(title_cleaned)
            local rset = candidate._reason_set or {}
            local independent_corroboration = candidate.alias_primary == true
                or rset["pe_product_exact"] or rset["folder_exact"]
                or rset["year_match"] or rset["sequel_match"]
            if is_short_title and actual_stem == request_short_token and not independent_corroboration then
                -- Matching an official executable named exactly like the same tiny token
                -- is circular evidence (B1 -> B1.exe). It must not become proof alone.
                candidate.score = math.min(68, candidate.score + 8)
                detection_add_reason(candidate, "short_executable_unverified")
            else
                candidate.executable_match = true; candidate.score = candidate.score + 28
                detection_add_reason(candidate, "official_executable_match")
            end
        end
    end
    local initial_validation_count = strong_local_candidate and 1 or math.min(#candidates, 3)
    for i = 1, initial_validation_count do validate_candidate(candidates[i]) end
    local function rank_viable()
        local viable = {}
        for _, candidate in ipairs(candidates) do
            if not identity_context.rejected[candidate.appid]
                and deps.shortcut_detection_catalog.viable_candidate(candidate, identity_context) then viable[#viable + 1] = candidate end
        end
        table.sort(viable, function(a, b)
            if a.executable_match ~= b.executable_match then return a.executable_match end
            return a.score == b.score and tonumber(a.appid) < tonumber(b.appid) or a.score > b.score
        end)
        candidates = viable
    end
    rank_viable()
    local top, second = candidates[1], candidates[2]
    local top_gap = (top and second) and (top.score - second.score) or 100
    local has_proof = top and (top.direct or top.executable_match)
    if not has_proof or top_gap < 15 then
        local validated = initial_validation_count
        -- Rejected initial hits must not consume positions in the next window.
        -- Validate the surviving, not-yet-checked candidates, at most six total.
        for _, candidate in ipairs(candidates) do
            if validated >= 6 then break end
            if not candidate._validated then validate_candidate(candidate); validated = validated + 1 end
        end
        rank_viable()
    end
    for _, candidate in ipairs(candidates) do
        if candidate.alias_hint and candidate.alias_primary and not candidate.identity_collision then
            candidate.score = math.max(candidate.score, candidate.alias_automatic and 78 or 72)
            detection_add_reason(candidate, "maintained_alias_exact")
            if candidate.alias_unique then detection_add_reason(candidate, "maintained_alias_unique") end
            if candidate.alias_automatic then detection_add_reason(candidate, "maintained_alias_auto") end
        end
        local official_title_exact = candidate._reason_set and candidate._reason_set["official_title_exact"] == true
        if candidate.alias_hint and not candidate.executable_match and not official_title_exact then
            candidate.score = math.min(candidate.score, DETECTION_UNVERIFIED_ALIAS_MAX_SCORE)
            detection_add_reason(candidate, "alias_requires_confirmation")
        end
        if not candidate._official_type_verified and not candidate.direct then
            candidate.score = math.min(candidate.score, DETECTION_UNVERIFIED_ALIAS_MAX_SCORE)
            candidate.validation_state = "partial"
            detection_add_reason(candidate, "official_metadata_unavailable")
        end
        candidate.score = math.max(0, math.min(99, math.floor(candidate.score + 0.5)))
    end
    table.sort(candidates, function(a, b)
        if a.executable_match ~= b.executable_match then return a.executable_match end
        return a.score == b.score and tonumber(a.appid) < tonumber(b.appid) or a.score > b.score
    end)
    -- Different releases/editions can publish exactly the same executable name.
    -- That launch match proves compatibility with each candidate, not which
    -- AppID the selected installation belongs to. An exact shortcut title must
    -- not hide this conflict or turn an AppID-order tie into an automatic link.
    local shared_executable_matches = 0
    for _, candidate in ipairs(candidates) do
        if candidate.executable_match and not identity_context.rejected[candidate.appid]
            and deps.shortcut_detection_catalog.viable_candidate(candidate, identity_context) then
            shared_executable_matches = shared_executable_matches + 1
        end
    end
    local output = {}
    for index = 1, #candidates do
        local candidate = candidates[index]
        if #output >= 6 then break end
        if not identity_context.rejected[candidate.appid]
            and deps.shortcut_detection_catalog.viable_candidate(candidate, identity_context) then
        local rset = candidate._reason_set or {}
        local runner_up = candidates[index == 1 and 2 or 1]
        candidate.score_gap = runner_up and math.max(0, candidate.score - runner_up.score) or candidate.score
        local exact_identity = rset["official_title_exact"] == true or rset["title_exact"] == true
            or (candidate.alias_primary == true and candidate.alias_unique == true and candidate.score >= 90)
        candidate.ambiguous = candidate.identity_collision == true
            or (candidate.executable_match == true and shared_executable_matches > 1)
            or (index == 1 and runner_up ~= nil and candidate.score_gap < 12 and not exact_identity)
        if candidate.validation_state == "partial" then candidate.evidence_tier = candidate.score >= 65 and "supporting" or "hint"
        elseif candidate.direct or candidate.executable_match then candidate.evidence_tier = "proof"
        elseif candidate.score >= 88 or rset["pe_product_exact"] or rset["official_title_exact"] then candidate.evidence_tier = "strong"
        elseif candidate.score >= 65 then candidate.evidence_tier = "supporting"
        else candidate.evidence_tier = "hint" end
        local neg = {}
        for _, r in ipairs({ "year_mismatch", "sequel_mismatch", "remake_mismatch", "edition_mismatch", "non_game_result", "alias_requires_confirmation" }) do
            if rset[r] then table.insert(neg, r) end
        end
        candidate.negative_reasons = neg
        candidate.confidence = (candidate.score >= 90 and candidate.identity_collision ~= true and not candidate.ambiguous)
            and "high" or (candidate.score >= 70 and "medium" or "low")
        candidate._reason_set = nil; candidate._validated = nil; candidate._official_type_verified = nil
        table.insert(output, candidate)
        end
    end
    if (not store_search_confirmed or #output == 0) and deps.shortcut_detection_local and deps.shortcut_detection_local.discover_local_candidates then
        local local_res = deps.shortcut_detection_local.discover_local_candidates(request)
        if local_res and type(local_res.candidates) == "table" then
            local existing_ids = {}
            for _, c in ipairs(output) do existing_ids[c.appid] = true end
            for _, lc in ipairs(local_res.candidates) do
                if not existing_ids[lc.appid] and not identity_context.rejected[tostring(lc.appid)]
                    and deps.shortcut_detection_catalog.viable_candidate(lc, identity_context) then
                    lc.warnings = lc.warnings or {}; table.insert(lc.warnings, "remote_validation_unavailable")
                    lc.validation_state = "partial"; table.insert(output, lc)
                end
            end
        end
    end
    if #output == 0 and deps.shortcut_detection_catalog and deps.shortcut_detection_catalog.resolve_catalog_candidates then
        identity_context.language, identity_context.launcher, identity_context.generic_launcher = language, launcher, generic_launcher
        local cat_cands, catalog_confirmed = deps.shortcut_detection_catalog.resolve_catalog_candidates(request, identity_context, {
            direct_result = function(id, source, req, lang, is_launcher, is_generic, fallback, identity)
                return detection_direct_result(id, source, req, lang, is_launcher, is_generic, fallback, identity, budget)
            end,
            fetch_appdetails = function(id, lang) return detection_fetch_appdetails(id, lang, budget) end,
            fetch_appinfo = function(id) return detection_fetch_appinfo(id, budget) end,
        }, budget)
        if catalog_confirmed == false then budget.incomplete = true end
        for _, cc in ipairs(cat_cands or {}) do table.insert(output, cc) end
    end
    local validation_confirmed = store_search_confirmed and not budget.incomplete and not (output[1] and output[1].validation_state == "partial")
    local result = {
        candidates = output, launcher_detected = launcher, generic_launcher = generic_launcher,
        executable = exe_basename, queries = queries, source = "steam_store_search",
        ambiguous = output[1] and output[1].ambiguous or false, transient_error = not store_search_confirmed or budget.incomplete,
        validation_state = validation_confirmed and "confirmed" or "partial",
    }
    local encoded = encode_result(result)
    if validation_confirmed and #output > 0 then
        detection_cache_set(detection_candidate_cache, cache_key, { json = encoded, ttl = 600 })
    end
    return encoded
end
return M
end
