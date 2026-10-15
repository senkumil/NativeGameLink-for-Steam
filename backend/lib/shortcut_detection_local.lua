-- Local Discovery Engine for Shortcut Candidate Detection (Phase A)
-- Evaluates local filesystem, PE headers, shortcuts.vdf, launch options,
-- and maintained aliases with zero network calls for instant candidate presentation (<30ms).
return function(deps)
local fs = deps.fs
local logger = deps.logger or { info = function() end, warn = function() end, debug = function() end }
local detection_text = deps.shortcut_detection_text or {}
local KNOWN_TITLE_ALIASES = deps.shortcut_detection_aliases or {}
local detection_pe = deps.shortcut_detection_pe

local detection_trim = detection_text.trim or function(v) return tostring(v or ""):match("^%s*(.-)%s*$") or "" end
local detection_clean_path = detection_text.clean_path or function(v) return tostring(v or "") end
local detection_basename = detection_text.basename or function(v) return tostring(v or "") end
local detection_stem = detection_text.stem or function(v) return tostring(v or "") end
local detection_game_exe_hint = detection_text.game_exe_hint or function(v) return tostring(v or "") end
local detection_normalize = detection_text.normalize or function(v) return tostring(v or ""):lower() end
local detection_clean_game_title = detection_text.clean_game_title or function(v) return tostring(v or "") end
local DETECTION_GENERIC_WORDS = detection_text.generic_words or {}
local DETECTION_GENERIC_EXES = detection_text.generic_exes or {}
local detection_similarity = detection_text.similarity or function() return 0 end
local detection_compact_similarity = detection_text.compact_similarity or function() return 0 end
local detection_acronym_similarity = detection_text.acronym_similarity or function() return 0 end

local DETECTION_UNVERIFIED_ALIAS_MAX_SCORE = 84

-- Canonical titles for multi-version or historical aliases to guarantee immediate
-- distinct names (e.g. distinguishing Resident Evil 4 [2023] from Resident Evil 4 [2005]).
local KNOWN_APPID_TITLES = {
    ["2050650"] = "Resident Evil 4",
    ["254700"] = "Resident Evil 4 (2005)",
    ["12120"] = "Grand Theft Auto: San Andreas",
    ["1547000"] = "Grand Theft Auto: San Andreas – The Definitive Edition",
    ["12110"] = "Grand Theft Auto: Vice City",
    ["1546990"] = "Grand Theft Auto: Vice City – The Definitive Edition",
    ["12100"] = "Grand Theft Auto III",
    ["1546970"] = "Grand Theft Auto III – The Definitive Edition",
    ["12210"] = "Grand Theft Auto IV: The Complete Edition",
    ["271590"] = "Grand Theft Auto V",
    ["1174180"] = "Red Dead Redemption 2",
    ["2668510"] = "Red Dead Redemption",
    ["1593500"] = "God of War",
    ["2322010"] = "God of War Ragnarök",
    ["883710"] = "Resident Evil 2",
    ["952060"] = "Resident Evil 3",
    ["418370"] = "Resident Evil 7 Biohazard",
    ["1196590"] = "Resident Evil Village",
    ["3764200"] = "Resident Evil Requiem",
    ["1091500"] = "Cyberpunk 2077",
    ["1245620"] = "Elden Ring",
    ["570940"] = "Dark Souls: Remastered",
    ["335300"] = "Dark Souls II: Scholar of the First Sin",
    ["374320"] = "Dark Souls III",
    ["582010"] = "Monster Hunter: World",
    ["1446780"] = "Monster Hunter Rise",
    ["1888930"] = "The Last of Us Part I",
    ["2124490"] = "SILENT HILL 2",
    ["2651280"] = "Marvel's Spider-Man 2",
    ["1817070"] = "Marvel's Spider-Man Remastered",
    ["1817190"] = "Marvel's Spider-Man: Miles Morales",
    ["237110"] = "Mortal Kombat Komplete Edition",
    ["221430"] = "Pro Evolution Soccer 2013",
    ["1086940"] = "Baldur's Gate 3",
    ["2358720"] = "Black Myth: Wukong",
    ["1790600"] = "DRAGON BALL: Sparking! ZERO",
    ["1643320"] = "S.T.A.L.K.E.R. 2: Heart of Chornobyl",
    ["990080"] = "Hogwarts Legacy",
    ["1778820"] = "TEKKEN 8",
    ["1627720"] = "Lies of P",
    ["397540"] = "Borderlands 3",
    ["548430"] = "Deep Rock Galactic",
    ["1282100"] = "Remnant II",
    ["1681430"] = "RoboCop: Rogue City",
    ["1501750"] = "Lords of the Fallen",
    ["1623730"] = "Palworld",
    ["1462040"] = "FINAL FANTASY VII REMAKE INTERGRADE",
    ["2515020"] = "FINAL FANTASY XVI",
    ["3007510"] = "Stellar Blade",
    ["2054970"] = "Dragon's Dogma 2",
    ["1888160"] = "ARMORED CORE VI FIRES OF RUBICON",
    ["814380"] = "Sekiro: Shadows Die Twice",
    ["553850"] = "HELLDIVERS™ 2",
    ["1771300"] = "Kingdom Come: Deliverance II",
    ["1364780"] = "Street Fighter 6",
    ["2161700"] = "Persona 3 Reload",
    ["1687950"] = "Persona 5 Royal",
    ["2620600"] = "Metaphor: ReFantazio",
}

local function detection_read_small_file(path, max_bytes)
    if not path or path == "" or not fs.exists(path) then return nil end
    local handle = io.open(path, "r")
    if not handle then return nil end
    local content = handle:read(max_bytes or 8192)
    handle:close()
    return content
end

local function detection_appid_from_arguments(arguments)
    local args = tostring(arguments or "")
    return args:match("steam://rungameid/(%d+)")
        or args:match("[%-%/]appid[%s=]+(%d+)")
        or args:match("[%-%/]app_id[%s=]+(%d+)")
end

local function detection_find_steam_appid_file(exe_path)
    local directory = fs.parent_path(detection_clean_path(exe_path))
    for _ = 1, 4 do
        if not directory or directory == "" then break end
        local content = detection_read_small_file(fs.join(directory, "steam_appid.txt"), 128)
        local appid = content and content:match("(%d+)") or nil
        if appid then return appid, "steam_appid_file" end
        local parent = fs.parent_path(directory)
        if not parent or parent == "" or parent == directory then break end
        directory = parent
    end
    return nil, nil
end

local function detection_find_appmanifest(exe_path)
    local path = detection_clean_path(exe_path)
    local lower = path:lower()
    local marker = "\\steamapps\\common\\"
    local marker_start = lower:find(marker, 1, true)
    if not marker_start then return nil, nil end

    local steamapps_dir = path:sub(1, marker_start + #("\\steamapps") - 1)
    local relative = path:sub(marker_start + #marker)
    local install_folder = relative:match("^([^\\]+)")
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
                local content_id = content:match('"appid"%s*"(%d+)"')
                return content_id or manifest_id, "steam_appmanifest"
            end
        end
    end
    return nil, nil
end

local function detection_folder_hints(exe_path, start_dir)
    local hints, seen = {}, {}
    local function add(value)
        local cleaned = detection_clean_game_title(value)
        local normalized = detection_normalize(cleaned)
        if cleaned ~= "" and normalized ~= "" and not seen[normalized] then
            seen[normalized] = true
            table.insert(hints, cleaned)
        end
    end
    local directory = detection_clean_path(start_dir)
    if directory == "" then directory = fs.parent_path(detection_clean_path(exe_path)) end
    for _ = 1, 6 do
        if not directory or directory == "" then break end
        add(detection_basename(directory))
        local parent = fs.parent_path(directory)
        if not parent or parent == directory then break end
        directory = parent
    end
    return hints
end

local function detection_add_reason(candidate, reason)
    if not candidate._reason_set then
        candidate._reason_set = {}
        for _, existing in ipairs(candidate.reasons or {}) do
            candidate._reason_set[existing] = true
        end
    end
    if not candidate._reason_set[reason] then
        candidate._reason_set[reason] = true
        table.insert(candidate.reasons, reason)
    end
end

local M = {}

function M.discover_local_candidates(request)
    local title = detection_trim(request.title):sub(1, 240)
    local exe_path = detection_clean_path(request.exe_path):sub(1, 4096)
    local start_dir = detection_clean_path(request.start_dir):sub(1, 4096)
    local launch_options = detection_trim(request.launch_options):sub(1, 4096)

    local exe_basename = detection_basename(exe_path)
    local raw_exe_stem = detection_stem(exe_basename)
    local exe_stem = detection_game_exe_hint(exe_basename)
    local title_hint = detection_game_exe_hint(title)
    if detection_trim(title_hint) == "" then title_hint = title end
    local title_cleaned = detection_clean_game_title(title_hint)
    if title_cleaned == "" then title_cleaned = title_hint end

    local pe_product_name, pe_file_desc = nil, nil
    if detection_pe and detection_pe.read_pe_metadata then
        pe_product_name, pe_file_desc = detection_pe.read_pe_metadata(exe_path)
    end
    local is_generic_pe = detection_pe and detection_pe.is_generic_product_name or function() return false end
    local clean_pe_product = (pe_product_name and not is_generic_pe(pe_product_name))
        and detection_clean_game_title(pe_product_name) or nil
    local clean_pe_desc = (pe_file_desc and not is_generic_pe(pe_file_desc))
        and detection_clean_game_title(pe_file_desc) or nil

    local exe_normalized = detection_normalize(exe_stem)
    local launcher_exe_stem = detection_game_exe_hint(detection_basename(exe_path))
    local launcher_exe_normalized = detection_normalize(launcher_exe_stem)
    local launcher = launcher_exe_normalized:find("launcher", 1, true) ~= nil
        or launcher_exe_normalized == "start protected game"
        or launcher_exe_normalized:find("bootstrapper", 1, true) ~= nil
    local generic_launcher = DETECTION_GENERIC_EXES[launcher_exe_normalized] == true

    local folders = detection_folder_hints(exe_path, start_dir)

    -- Direct proof signals from local filesystem or launch arguments
    local direct_appid = detection_appid_from_arguments(launch_options)
    local direct_source = direct_appid and "launch_argument" or nil
    if not direct_appid and exe_path ~= "" then
        direct_appid, direct_source = detection_find_steam_appid_file(exe_path)
    end
    if not direct_appid and exe_path ~= "" then
        direct_appid, direct_source = detection_find_appmanifest(exe_path)
    end

    local by_id = {}

    -- Fast alias matching across title, exe stem, PE product, and folder hierarchy
    local alias_candidates = {}
    local function check_alias(key, primary_identity)
        if not key or key == "" then return end
        local raw_norm = detection_normalize(key)
        local compact = raw_norm:gsub("%s+", "")
        local alias = KNOWN_TITLE_ALIASES[compact] or KNOWN_TITLE_ALIASES[raw_norm]
        if alias then
            for _, direct_id in ipairs(alias.appids or {}) do
                local c_title = KNOWN_APPID_TITLES[direct_id] or alias.name
                local existing = alias_candidates[direct_id]
                alias_candidates[direct_id] = {
                    name = c_title, alias_name = alias.name,
                    primary = primary_identity == true or (type(existing) == "table" and existing.primary == true),
                    unique = #(alias.appids or {}) == 1 or (type(existing) == "table" and existing.unique == true),
                    automatic = tostring(alias.auto_appid or "") == tostring(direct_id)
                        or (type(existing) == "table" and existing.automatic == true),
                }
            end
        end
    end

    check_alias(title_hint, true)
    check_alias(title_cleaned, true)
    check_alias(exe_stem, true)
    check_alias(raw_exe_stem, true)
    if clean_pe_product then check_alias(clean_pe_product, true) end
    if clean_pe_desc then check_alias(clean_pe_desc, true) end
    for _, folder in ipairs(folders) do check_alias(folder, false) end

    -- Sub-segment query decomposition for compound titles
    for segment in tostring(title_cleaned):gmatch("[^–—:|%-]+") do
        local seg_trimmed = detection_trim(segment)
        if #seg_trimmed >= 3 and seg_trimmed ~= title_cleaned then
            check_alias(seg_trimmed, false)
        end
    end

    -- Direct proof fast path
    if direct_appid then
        local is_proof = direct_source == "launch_argument" or direct_source == "steam_appmanifest"
        local name = KNOWN_APPID_TITLES[direct_appid] or (title ~= "" and title or ("Steam AppID " .. direct_appid))
        local image = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" .. direct_appid .. "/header.jpg"
        by_id[direct_appid] = {
            appid = tostring(direct_appid),
            name = tostring(name),
            image = image,
            score = is_proof and 100 or 80,
            confidence = is_proof and "exact" or "medium",
            reasons = { direct_source },
            direct = is_proof,
            from_appid_file = (direct_source == "steam_appid_file"),
            evidence_tier = is_proof and "proof" or "supporting",
            validation_state = "pending",
        }
    end

    -- Incorporate alias-derived candidates
    for direct_id, info in pairs(alias_candidates) do
        if not by_id[direct_id] then
            local image = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" .. direct_id .. "/header.jpg"
            by_id[direct_id] = {
                appid = tostring(direct_id),
                name = tostring(info.name),
                image = image,
                reasons = { "franchise_alias" },
                alias_hint = true,
                alias_primary = info.primary == true,
                alias_unique = info.unique == true,
                alias_automatic = info.automatic == true,
                validation_state = "pending",
            }
        end
    end

    -- Local candidate scoring
    local candidates = {}
    local is_short_title = #detection_normalize(title_cleaned) <= 3
    for _, candidate in pairs(by_id) do
        if candidate.direct and candidate.score == 100 then
            table.insert(candidates, candidate)
        else
            local comp = detection_text.compare_title_identities(title or title_cleaned, candidate.name)
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
            local score = title_similarity * 55 + folder_similarity * 20 + exe_similarity * 15 + 8

            if candidate.alias_hint then score = score + 5; detection_add_reason(candidate, "franchise_alias") end
            if candidate.from_appid_file then score = score + 10; detection_add_reason(candidate, "steam_appid_file") end

            if norm_title ~= "" and norm_title == norm_cand then
                if is_short_title and not folder_exact and folder_similarity < 0.7 then
                    score = math.min(score, 60); detection_add_reason(candidate, "short_title_unverified")
                else
                    score = math.max(score, candidate.alias_unique and 99 or 90); detection_add_reason(candidate, "title_exact")
                end
            elseif title_similarity >= 0.65 then
                detection_add_reason(candidate, "title_similar")
            end

            if folder_exact then score = score + 18; detection_add_reason(candidate, "folder_exact")
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

            if candidate.alias_hint and candidate.alias_primary and not candidate.identity_collision then
                score = math.max(score, candidate.alias_automatic and 78 or 72)
                detection_add_reason(candidate, "maintained_alias_exact")
                if candidate.alias_unique then detection_add_reason(candidate, "maintained_alias_unique") end
                if candidate.alias_automatic then detection_add_reason(candidate, "maintained_alias_auto") end
            end
            if candidate.alias_hint and not candidate.executable_match and (score < 90 or candidate.identity_collision) then
                score = math.min(score, DETECTION_UNVERIFIED_ALIAS_MAX_SCORE)
                detection_add_reason(candidate, "alias_requires_confirmation")
            end

            candidate.score = math.max(0, math.min(99, math.floor(score + 0.5)))
            table.insert(candidates, candidate)
        end
    end

    table.sort(candidates, function(a, b)
        if a.direct ~= b.direct then return a.direct end
        return a.score == b.score and tonumber(a.appid) < tonumber(b.appid) or a.score > b.score
    end)

    local output = {}
    for index = 1, math.min(#candidates, 6) do
        local candidate = candidates[index]
        local rset = candidate._reason_set or {}
        candidate._reason_set = nil
        local runner_up = candidates[index == 1 and 2 or 1]
        candidate.score_gap = runner_up and math.max(0, candidate.score - runner_up.score) or candidate.score
        local exact_identity = rset["title_exact"] == true
            or (candidate.alias_primary == true and candidate.alias_unique == true and candidate.score >= 90)
        candidate.ambiguous = candidate.identity_collision == true
            or (index == 1 and runner_up ~= nil and candidate.score_gap < 12 and not exact_identity)

        if candidate.direct then candidate.evidence_tier = "proof"
        elseif candidate.score >= 88 or rset["pe_product_exact"] then candidate.evidence_tier = "strong"
        elseif candidate.score >= 65 then candidate.evidence_tier = "supporting"
        else candidate.evidence_tier = "hint" end

        local neg = {}
        for _, r in ipairs({ "year_mismatch", "sequel_mismatch", "remake_mismatch", "edition_mismatch", "non_game_result", "alias_requires_confirmation" }) do
            if rset[r] then table.insert(neg, r) end
        end
        candidate.negative_reasons = neg
        if candidate.score >= 90 and not candidate.ambiguous then candidate.confidence = "high"
        elseif candidate.score >= 70 then candidate.confidence = "medium"
        else candidate.confidence = "low" end
        candidate.validation_state = "pending"
        table.insert(output, candidate)
    end

    return {
        candidates = output,
        launcher_detected = launcher,
        generic_launcher = generic_launcher,
        executable = exe_basename,
        source = "local_discovery",
        ambiguous = output[1] and output[1].ambiguous or false,
        validation_state = "pending",
        phase = "local",
    }
end

return M
end
