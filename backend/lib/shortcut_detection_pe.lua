-- PE metadata inspection and product name extraction for Windows executables.
return function(deps)
local fs = deps.fs
local detection_text = deps.shortcut_detection_text or {}
local detection_normalize = detection_text.normalize or function(v) return tostring(v or ""):lower() end
local DETECTION_GENERIC_WORDS = detection_text.generic_words or {}
local DETECTION_GENERIC_EXES = detection_text.generic_exes or {}

local M = {}

-- Millennium also runs without LuaJIT/FFI. Read the version resource directly in
-- that runtime, without loading/executing the game or spawning a shell. Every
-- file read, resource directory and VERSIONINFO node is explicitly bounded.
local function read_version_resource(path)
    local opened, file = pcall(io.open, path, "rb")
    if not opened or not file then return nil, nil end
    local ok, product, description = pcall(function()
        local size = file:seek("end")
        if not size or size < 64 then return nil, nil end
        local total_read = 0
        local function read_at(offset, length)
            if not offset or not length or offset < 0 or length < 0
                or length > 1024 * 1024 or offset + length > size
                or total_read + length > 2 * 1024 * 1024 then return nil end
            if not file:seek("set", offset) then return nil end
            local value = file:read(length)
            total_read = total_read + length
            return value and #value == length and value or nil
        end
        local function u16(value, index)
            local a, b = value:byte(index, index + 1)
            return b and a + b * 256 or nil
        end
        local function u32(value, index)
            local a, b, c, d = value:byte(index, index + 3)
            return d and a + b * 256 + c * 65536 + d * 16777216.0 or nil
        end
        local dos = read_at(0, 64)
        if not dos or dos:sub(1, 2) ~= "MZ" then return nil, nil end
        local pe_offset = u32(dos, 61)
        local pe = read_at(pe_offset, 24)
        if not pe or pe:sub(1, 4) ~= "PE\0\0" then return nil, nil end
        local sections, optional_size = u16(pe, 7), u16(pe, 21)
        if sections < 1 or sections > 96 or optional_size < 96 or optional_size > 4096 then return nil, nil end
        local optional = read_at(pe_offset + 24, optional_size)
        local headers = read_at(pe_offset + 24 + optional_size, sections * 40)
        if not optional or not headers then return nil, nil end
        local magic = u16(optional, 1)
        local directory = magic == 267 and 97 or (magic == 523 and 113 or nil)
        if not directory or #optional < directory + 23 or u32(optional, directory - 4) < 3 then return nil, nil end
        local resource_rva, resource_size = u32(optional, directory + 16), u32(optional, directory + 20)
        if resource_rva == 0 or resource_size < 16 then return nil, nil end
        local function rva_offset(rva, length)
            for index = 0, sections - 1 do
                local start = index * 40 + 1
                local address, raw_size, raw_offset = u32(headers, start + 12), u32(headers, start + 16), u32(headers, start + 20)
                local relative = rva - address
                if relative >= 0 and relative + length <= raw_size then return raw_offset + relative end
            end
            return nil
        end
        local function resource_at(offset, length)
            if offset < 0 or offset + length > resource_size then return nil end
            return read_at(rva_offset(resource_rva + offset, length), length)
        end
        local function utf8_character(code)
            if code < 128 then return string.char(code) end
            if code < 2048 then return string.char(192 + math.floor(code / 64), 128 + code % 64) end
            if code < 65536 then return string.char(224 + math.floor(code / 4096), 128 + math.floor(code / 64) % 64, 128 + code % 64) end
            return string.char(240 + math.floor(code / 262144), 128 + math.floor(code / 4096) % 64,
                128 + math.floor(code / 64) % 64, 128 + code % 64)
        end
        local function utf16(value, first, last)
            local pieces, index = {}, first
            while index + 1 <= last do
                local code = u16(value, index)
                if code == 0 then break end
                index = index + 2
                if code >= 55296 and code <= 56319 then
                    local low = index + 1 <= last and u16(value, index) or nil
                    if low and low >= 56320 and low <= 57343 then
                        code = 65536 + (code - 55296) * 1024 + low - 56320
                        index = index + 2
                    else code = 65533 end
                elseif code >= 56320 and code <= 57343 then code = 65533 end
                pieces[#pieces + 1] = utf8_character(code)
            end
            return table.concat(pieces)
        end
        local function align(index) return math.floor((index + 2) / 4) * 4 + 1 end
        local prod, desc, nodes, directories = nil, nil, 0, 0
        local function parse_version(value)
            local walk
            walk = function(first, last, depth)
                nodes = nodes + 1
                if depth > 6 or nodes > 512 or first + 5 > last then return end
                local length, value_length, kind = u16(value, first), u16(value, first + 2), u16(value, first + 4)
                if length < 6 or first + length - 1 > last then return end
                local finish, key_end = first + length - 1, first + 6
                while key_end + 1 <= finish and key_end - first < 520 and u16(value, key_end) ~= 0 do key_end = key_end + 2 end
                if key_end + 1 > finish or u16(value, key_end) ~= 0 then return end
                local key = utf16(value, first + 6, key_end - 1)
                local value_start = align(key_end + 2)
                local value_bytes = value_length * (kind == 1 and 2 or 1)
                if value_start + value_bytes - 1 > finish then return end
                if kind == 1 and value_bytes <= 8192 and (key == "ProductName" or key == "FileDescription") then
                    local decoded = utf16(value, value_start, value_start + value_bytes - 1)
                    if decoded ~= "" then
                        if key == "ProductName" and not prod then prod = decoded end
                        if key == "FileDescription" and not desc then desc = decoded end
                    end
                end
                local child = align(value_start + value_bytes)
                while child + 5 <= finish and nodes < 512 do
                    local child_length = u16(value, child)
                    if child_length < 6 or child + child_length - 1 > finish then break end
                    walk(child, finish, depth + 1)
                    child = align(child + child_length)
                end
            end
            walk(1, #value, 0)
        end
        local visit
        visit = function(offset, depth, version_type)
            directories = directories + 1
            if depth > 3 or directories > 32 or (prod and desc) then return end
            local header = resource_at(offset, 16)
            if not header then return end
            local count = u16(header, 13) + u16(header, 15)
            if count > 256 then return end
            local entries = resource_at(offset + 16, count * 8)
            if not entries then return end
            for index = 0, count - 1 do
                local id, target = u32(entries, index * 8 + 1), u32(entries, index * 8 + 5)
                if version_type or id == 16 then
                    if target >= 2147483648 then visit(target - 2147483648, depth + 1, true)
                    else
                        local data = resource_at(target, 16)
                        if data then
                            local rva, length = u32(data, 1), u32(data, 5)
                            if length >= 6 and length <= 1024 * 1024 then
                                local value = read_at(rva_offset(rva, length), length)
                                if value then parse_version(value) end
                            end
                        end
                    end
                end
                if prod and desc then return end
            end
        end
        visit(0, 0, false)
        return prod, desc
    end)
    pcall(file.close, file)
    if ok then return product, description end
    return nil, nil
end

local ffi_ok, ffi = pcall(require, "ffi")
local version_dll = nil

if ffi_ok and ffi then
    pcall(function()
        ffi.cdef[[
            typedef unsigned long DWORD;
            typedef int BOOL;
            DWORD GetFileVersionInfoSizeA(const char* lptstrFilename, DWORD* lpdwHandle);
            BOOL GetFileVersionInfoA(const char* lptstrFilename, DWORD dwHandle, DWORD dwLen, void* lpData);
            BOOL VerQueryValueA(const void* pBlock, const char* lpSubBlock, void** lplpBuffer, unsigned int* puLen);
        ]]
        version_dll = ffi.load("version.dll")
    end)
end

function M.is_generic_product_name(value)
    if not value or value == "" then return true end
    local norm = detection_normalize(value)
    if #norm < 2 then return true end
    if DETECTION_GENERIC_WORDS[norm] or DETECTION_GENERIC_EXES[norm] then return true end
    if norm:match("^unreal") or norm:match("^unity") or norm:match("^cryengine")
        or norm:match("^redengine") or norm:match("^godot") or norm:match("^microsoft")
        or norm:match("^windows") or norm:match("^steam") or norm:match("^epic games")
        or norm:match("^game launcher") or norm:match("^crash handler")
        or norm == "game" or norm == "launcher" or norm == "application"
        or norm == "shipping" or norm == "executable" or norm == "bootstrapper"
        or norm == "start" or norm == "unins000" or norm == "setup" or norm == "installer" then
        return true
    end
    return false
end

function M.read_pe_metadata(exe_path)
    if not exe_path or exe_path == "" then return nil, nil end
    local ok_exists, exists = pcall(fs.exists, exe_path)
    if not ok_exists or not exists then return nil, nil end
    local product, description = read_version_resource(exe_path)
    if product or description then return product, description end
    if not version_dll or not ffi then return nil, nil end

    local ok, prod, desc = pcall(function()
        local handle = ffi.new("DWORD[1]")
        local size = version_dll.GetFileVersionInfoSizeA(exe_path, handle)
        if size <= 0 or size > 1024 * 1024 then return nil, nil end
        local buf = ffi.new("char[?]", size)
        if version_dll.GetFileVersionInfoA(exe_path, 0, size, buf) == 0 then return nil, nil end
        local function query_str(sub_block)
            local ptr = ffi.new("void*[1]")
            local len = ffi.new("unsigned int[1]")
            if version_dll.VerQueryValueA(buf, sub_block, ptr, len) ~= 0
                and len[0] > 1 and len[0] <= 8192 and ptr[0] ~= nil then
                return ffi.string(ptr[0], len[0] - 1)
            end
            return nil
        end
        local p = nil
        local d = nil
        local sub_blocks = {}
        local trans_ptr = ffi.new("void*[1]")
        local trans_len = ffi.new("unsigned int[1]")
        if version_dll.VerQueryValueA(buf, "\\VarFileInfo\\Translation", trans_ptr, trans_len) ~= 0 and trans_len[0] >= 4 and trans_ptr[0] ~= nil then
            local trans = ffi.cast("unsigned short*", trans_ptr[0])
            local count = math.min(math.floor(trans_len[0] / 4), 8)
            for i = 0, count - 1 do
                local hex = string.format("%04x%04x", trans[i * 2], trans[i * 2 + 1])
                table.insert(sub_blocks, hex)
            end
        end
        for _, hex in ipairs({ "040904b0", "040904e4", "000004b0", "04090000", "080904b0" }) do
            table.insert(sub_blocks, hex)
        end
        for _, hex in ipairs(sub_blocks) do
            if not p then p = query_str("\\StringFileInfo\\" .. hex .. "\\ProductName") end
            if not d then d = query_str("\\StringFileInfo\\" .. hex .. "\\FileDescription") end
            if p and d then break end
        end
        return p, d
    end)
    if ok and (prod or desc) then
        return prod, desc
    end
    return nil, nil
end

return M
end
