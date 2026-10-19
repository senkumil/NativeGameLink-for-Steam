-- Text/path normalization and fuzzy title comparison for shortcut detection.
-- Keeping this pure makes the expensive filesystem/network detector easier to
-- profile and lets fixture tests exercise identity rules independently.
return function(_deps)
local M = {}

function M.trim(value)
    return tostring(value or ""):match("^%s*(.-)%s*$") or ""
end

function M.clean_path(value)
    local path = M.trim(value)
    local quoted = path:match('^"(.-)"$')
    if quoted then path = quoted end
    return path:gsub("/", "\\")
end

function M.basename(value)
    local path = M.clean_path(value):gsub("[\\/]+$", "")
    return path:match("([^\\/]+)$") or path
end

function M.stem(value)
    return M.basename(value):gsub("%.[^%.]+$", "")
end

function M.game_exe_hint(value)
    local stem = M.basename(value)
    local lower = stem:lower()
    while lower:match("%.lnk$") or lower:match("%.url$") do
        stem = M.stem(stem)
        lower = stem:lower()
    end
    if lower:match("%.exe$") or lower:match("%.com$") or lower:match("%.bat$")
        or lower:match("%.cmd$") or lower:match("%.appimage$") then
        stem = M.stem(stem)
    end
    stem = stem:gsub("[%s_%-]+[Ww][Ii][Nn]64[%s_%-]+[Ss][Hh][Ii][Pp][Pp][Ii][Nn][Gg]$", "")
    stem = stem:gsub("[%s_%-]+[Ww][Ii][Nn]32[%s_%-]+[Ss][Hh][Ii][Pp][Pp][Ii][Nn][Gg]$", "")
    stem = stem:gsub("[%s_%-]+[Ll][Ii][Nn][Uu][Xx][%s_%-]+[Ss][Hh][Ii][Pp][Pp][Ii][Nn][Gg]$", "")
    return stem
end

local function strip_accents(value)
    local accents = {
        ["á"] = "a", ["à"] = "a", ["ä"] = "a", ["â"] = "a", ["ã"] = "a", ["å"] = "a",
        ["é"] = "e", ["è"] = "e", ["ë"] = "e", ["ê"] = "e",
        ["í"] = "i", ["ì"] = "i", ["ï"] = "i", ["î"] = "i",
        ["ó"] = "o", ["ò"] = "o", ["ö"] = "o", ["ô"] = "o", ["õ"] = "o",
        ["ú"] = "u", ["ù"] = "u", ["ü"] = "u", ["û"] = "u", ["ñ"] = "n", ["ç"] = "c",
        ["Á"] = "a", ["À"] = "a", ["Ä"] = "a", ["Â"] = "a", ["É"] = "e", ["È"] = "e",
        ["Ë"] = "e", ["Ê"] = "e", ["Í"] = "i", ["Ì"] = "i", ["Ï"] = "i", ["Î"] = "i",
        ["Ó"] = "o", ["Ò"] = "o", ["Ö"] = "o", ["Ô"] = "o", ["Ú"] = "u", ["Ù"] = "u",
        ["Ü"] = "u", ["Û"] = "u", ["Ñ"] = "n", ["Ç"] = "c",
    }
    local result = tostring(value or "")
    for from, to in pairs(accents) do result = result:gsub(from, to) end
    return result
end

function M.normalize(value)
    local text = strip_accents(value):lower()
    text = text:gsub("™", ""):gsub("®", ""):gsub("©", "")
    text = text:gsub("[’'`´]", ""):gsub("[–—_:|/\\%[%]%(%){}]+", " ")
    text = text:gsub("[^%w]+", " "):gsub("%s+", " ")
    return M.trim(text)
end

function M.clean_game_title(value)
    local text = tostring(value or "")
    local function filter_enclosure(content)
        local inner = content:sub(2, -2)
        local year = inner:match("(%d%d%d%d)")
        local y_num = tonumber(year)
        if y_num and y_num >= 1980 and y_num <= 2040 then
            return " " .. inner .. " "
        end
        local lower = inner:lower()
        if lower:match("remake") or lower:match("remaster") or lower:match("edition")
            or lower:match("goty") or lower:match("cut") or lower:match("part")
            or lower:match("chapter") or lower:match("episode") then
            return " " .. inner .. " "
        end
        return " "
    end
    text = text:gsub("%b[]", filter_enclosure):gsub("%b()", filter_enclosure)
    text = text:gsub("[vV]%d+%.%d+[%d%.]*", " ")
    text = text:gsub("[%s_%-]+[Bb][Uu][Ii][Ll][Dd][%s_%-]+%d+", " ")
    text = text:gsub("[%s_%-]+[Ww][Ii][Nn]%d%d[%s_%-]+[Ss][Hh][Ii][Pp][Pp][Ii][Nn][Gg]", " ")
    text = text:gsub("[%s_%-]+[Ll][Ii][Nn][Uu][Xx][%s_%-]+[Ss][Hh][Ii][Pp][Pp][Ii][Nn][Gg]", " ")
    text = text:gsub("[%s_%-]+[Ww][Ii][Nn]%d%d$", ""):gsub("[%s_%-]+[Xx]64$", "")
    text = text:gsub("[%s_%-]+[Xx]86$", ""):gsub("[%s_%-]+[Dd][Xx]11$", "")
    text = text:gsub("[%s_%-]+[Dd][Xx]12$", ""):gsub("[%s_%-]+[Rr][Ee][Pp][Aa][Cc][Kk]", " ")
    return M.trim(text)
end

function M.extract_year(value)
    local text = tostring(value or "")
    for year_str in text:gmatch("(%d%d%d%d)") do
        local y = tonumber(year_str)
        if y and y >= 1980 and y <= 2040 then return y end
    end
    return nil
end

local ROMAN_NUMERALS = {
    viii = 8, vii = 7, vi = 6, iv = 4, v = 5, iii = 3, ii = 2, ix = 9, x = 10,
    xi = 11, xii = 12, xiii = 13, xiv = 14, xv = 15, i = 1,
}

function M.extract_sequel_number(value)
    local norm = " " .. M.normalize(value) .. " "
    -- Look for explicit indicators like part/chapter/episode or roman/arabic numerals
    local part_num = norm:match("%s+part%s+(%d+)%s+")
        or norm:match("%s+chapter%s+(%d+)%s+")
        or norm:match("%s+episode%s+(%d+)%s+")
    if part_num then return tonumber(part_num) end
    -- Walk source order rather than pairs(): a title containing several Roman
    -- tokens must have the same identity in every Lua runtime.
    for token in norm:gmatch("%S+") do
        if ROMAN_NUMERALS[token] then return ROMAN_NUMERALS[token] end
        local n = tonumber(token)
        if n and n >= 1 and n <= 25 then return n end
    end
    return nil
end

local QUALIFIER_PATTERNS = {
    remake = { is_remake = true },
    reimagined = { is_remake = true },
    remaster = { is_remaster = true },
    remastered = { is_remaster = true },
    hd = { is_remaster = true },
    enhanced = { is_remaster = true },
    complete = { edition = "complete" },
    definitive = { edition = "definitive" },
    ultimate = { edition = "ultimate" },
    deluxe = { edition = "deluxe" },
    goty = { edition = "goty" },
    directors = { edition = "directors_cut" },
    anniversary = { edition = "anniversary" },
}

function M.extract_qualifiers(value)
    local norm = " " .. M.normalize(value) .. " "
    local res = { is_remake = false, is_remaster = false, edition = nil }
    for token, props in pairs(QUALIFIER_PATTERNS) do
        if norm:match("%s+" .. token .. "%s+") then
            if props.is_remake then res.is_remake = true end
            if props.is_remaster then res.is_remaster = true end
            if props.edition and not res.edition then res.edition = props.edition end
        end
    end
    if norm:match("game%s+of%s+the%s+year") then res.edition = "goty" end
    if norm:match("director%s*s%s+cut") then res.edition = "directors_cut" end
    return res
end

function M.parse_title_identity(value)
    local raw = tostring(value or "")
    local cleaned = M.clean_game_title(raw)
    local year = M.extract_year(raw)
    local sequel = M.extract_sequel_number(raw)
    local quals = M.extract_qualifiers(raw)
    local words = {}
    for token in M.normalize(cleaned):gmatch("%S+") do
        local number = tonumber(token)
        if not ROMAN_NUMERALS[token] and not QUALIFIER_PATTERNS[token]
            and not (number and (number == year or (number >= 1 and number <= 25))) then
            words[#words + 1] = token
        end
    end
    -- Pad phrase removal too: terminal sequel/edition tokens used to survive
    -- because the old patterns required a space after the final word.
    local base = " " .. table.concat(words, " ") .. " "
    base = base:gsub("%s+edition%s+", " ")
        :gsub("%s+game%s+of%s+the%s+year%s+", " ")
        :gsub("%s+cut%s+", " ")
        :gsub("%s+part%s+", " ")
    base = M.trim(base:gsub("%s+", " "))
    return {
        raw = raw,
        cleaned = cleaned,
        base_title = base,
        year = year,
        sequel = sequel,
        is_remake = quals.is_remake,
        is_remaster = quals.is_remaster,
        edition = quals.edition,
    }
end

function M.compare_title_identities(shortcut_title, candidate_title)
    local a = M.parse_title_identity(shortcut_title)
    local b = M.parse_title_identity(candidate_title)
    local base_sim = (a.base_title ~= "" and b.base_title ~= "")
        and math.max(M.similarity(a.base_title, b.base_title), M.compact_similarity(a.base_title, b.base_title))
        or 0
    local base_matches = (a.base_title ~= "" and a.base_title == b.base_title) or base_sim >= 0.82
    local sequel_match = base_matches and (a.sequel ~= nil and b.sequel ~= nil and a.sequel == b.sequel)
    local sequel_mismatch = (a.sequel ~= nil and b.sequel ~= nil and a.sequel ~= b.sequel)
    local year_match = base_matches and (a.year ~= nil and b.year ~= nil and a.year == b.year)
    local year_mismatch = (a.year ~= nil and b.year ~= nil and a.year ~= b.year)
        or (a.year ~= nil and b.year == nil and (b.is_remake or a.year < 2015))
    local remake_mismatch = (a.is_remake and not b.is_remake and b.year and b.year < 2015)
        or (not a.is_remake and b.is_remake and a.year and a.year < 2015)
    local edition_mismatch = (a.edition ~= nil and b.edition ~= nil and a.edition ~= b.edition)
    local is_collision = base_matches and (sequel_mismatch or year_mismatch or remake_mismatch or edition_mismatch)
    return {
        shortcut_id = a,
        candidate_id = b,
        base_matches = base_matches,
        base_similarity = base_sim,
        sequel_match = sequel_match,
        sequel_mismatch = sequel_mismatch,
        year_match = year_match,
        year_mismatch = year_mismatch,
        remake_mismatch = remake_mismatch,
        edition_mismatch = edition_mismatch,
        is_collision = is_collision,
    }
end

local function replace_roman(value)
    local text = " " .. M.normalize(value) .. " "
    for roman, number in pairs({ viii = 8, vii = 7, vi = 6, iv = 4, v = 5, iii = 3, ii = 2, ix = 9, x = 10 }) do
        text = text:gsub("%s+" .. roman .. "%s+", " " .. number .. " ")
    end
    return M.trim(text)
end

M.generic_words = {
    launcher = true, launch = true, game = true, start = true, protected = true,
    shipping = true, win64 = true, win32 = true, windows = true, x64 = true,
    x86 = true, dx11 = true, dx12 = true, binary = true, binaries = true,
    games = true, juegos = true, steamapps = true, common = true,
    repack = true, fitgirl = true, dodi = true, gog = true, rune = true,
    unins000 = true, uninstaller = true, uninstall = true, setup = true, installer = true, install = true,
}
M.generic_exes = {
    ["game"] = true, ["launcher"] = true, ["start"] = true,
    ["start protected game"] = true, ["playnite fullscreenapp"] = true,
    ["playnite desktopapp"] = true, ["heroic"] = true, ["epicgameslauncher"] = true,
    ["galaxyclient"] = true, ["retroarch"] = true, ["steam"] = true,
    ["unins000"] = true, ["uninstall"] = true, ["uninstaller"] = true, ["setup"] = true,
}

function M.tokens(value, discard_generic)
    local set, count = {}, 0
    for token in M.normalize(value):gmatch("%S+") do
        if #token > 1 and (not discard_generic or not M.generic_words[token]) and not set[token] then
            set[token], count = true, count + 1
        end
    end
    return set, count
end

local function raw_similarity(left, right)
    local a, ac = M.tokens(left, false)
    local b, bc = M.tokens(right, false)
    if ac == 0 or bc == 0 then return 0 end
    local common = 0
    for token in pairs(a) do if b[token] then common = common + 1 end end
    return (2 * common) / (ac + bc)
end

function M.similarity(left, right)
    return math.max(raw_similarity(left, right), raw_similarity(replace_roman(left), replace_roman(right)))
end

local function raw_compact_similarity(left, right)
    local a, b = M.normalize(left):gsub("%s+", ""), M.normalize(right):gsub("%s+", "")
    if a == "" or b == "" then return 0 end
    if a == b then return 1 end
    local shorter, longer = a, b
    if #shorter > #longer then shorter, longer = longer, shorter end
    if #shorter >= 4 and longer:find(shorter, 1, true) then return math.min(0.95, (#shorter / #longer) + 0.30) end
    return 0
end

function M.compact_similarity(left, right)
    return math.max(raw_compact_similarity(left, right), raw_compact_similarity(replace_roman(left), replace_roman(right)))
end

local OPTIONAL_ACRONYM_WORDS = { part = true, chapter = true, episode = true, edition = true }
local function title_acronym(value, omit_optional_words)
    local pieces = {}
    for token in M.normalize(value):gmatch("%S+") do
        if token:match("^%d+$") or token:match("^[ivxlcdm]+$") then pieces[#pieces + 1] = token
        elseif #token > 0 and (not omit_optional_words or not OPTIONAL_ACRONYM_WORDS[token]) then
            pieces[#pieces + 1] = token:sub(1, 1)
        end
    end
    return table.concat(pieces, "")
end

function M.acronym_similarity(left, right)
    local left_compact = M.normalize(left):gsub("%s+", "")
    local right_compact = M.normalize(right):gsub("%s+", "")
    local function compare(compact, acronym)
        if #compact < 3 or #acronym < 3 then return 0 end
        if compact == acronym then return 1 end
        if acronym:sub(1, #compact) == compact then return 0.96 end
        return 0
    end
    return math.max(
        compare(left_compact, title_acronym(right)), compare(left_compact, title_acronym(right, true)),
        compare(right_compact, title_acronym(left)), compare(right_compact, title_acronym(left, true))
    )
end

return M
end
