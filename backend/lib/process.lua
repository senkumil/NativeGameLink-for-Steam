return function(deps)
local logger = deps.logger
local M = {}

local ffi_ok, ffi = pcall(require, "ffi")
local kernel32 = nil

if ffi_ok and ffi then
    local def_ok = pcall(function()
        ffi.cdef[[
        typedef unsigned long DWORD;
        typedef int BOOL;
        typedef void* HANDLE;
        typedef const char* LPCSTR;
        typedef char* LPSTR;

        typedef struct _SECURITY_ATTRIBUTES {
            DWORD nLength;
            void* lpSecurityDescriptor;
            BOOL bInheritHandle;
        } SECURITY_ATTRIBUTES, *LPSECURITY_ATTRIBUTES;

        typedef struct _STARTUPINFOA {
            DWORD cb;
            LPSTR lpReserved;
            LPSTR lpDesktop;
            LPSTR lpTitle;
            DWORD dwX;
            DWORD dwY;
            DWORD dwXSize;
            DWORD dwYSize;
            DWORD dwXCountChars;
            DWORD dwYCountChars;
            DWORD dwFillAttribute;
            DWORD dwFlags;
            short wShowWindow;
            short cbReserved2;
            void* lpReserved2;
            HANDLE hStdInput;
            HANDLE hStdOutput;
            HANDLE hStdError;
        } STARTUPINFOA, *LPSTARTUPINFOA;

        typedef struct _PROCESS_INFORMATION {
            HANDLE hProcess;
            HANDLE hThread;
            DWORD dwProcessId;
            DWORD dwThreadId;
        } PROCESS_INFORMATION, *LPPROCESS_INFORMATION;

        BOOL CreateProcessA(
            LPCSTR lpApplicationName,
            LPSTR lpCommandLine,
            LPSECURITY_ATTRIBUTES lpProcessAttributes,
            LPSECURITY_ATTRIBUTES lpThreadAttributes,
            BOOL bInheritHandles,
            DWORD dwCreationFlags,
            void* lpEnvironment,
            LPCSTR lpCurrentDirectory,
            LPSTARTUPINFOA lpStartupInfo,
            LPPROCESS_INFORMATION lpProcessInformation
        );

        DWORD WaitForSingleObject(HANDLE hHandle, DWORD dwMilliseconds);
        BOOL TerminateProcess(HANDLE hProcess, unsigned int uExitCode);
        BOOL CloseHandle(HANDLE hObject);
        BOOL GetExitCodeProcess(HANDLE hProcess, DWORD* lpExitCode);
        ]]
        kernel32 = ffi.load("kernel32")
    end)
    if not def_ok then
        kernel32 = nil
    end
end

local CREATE_NO_WINDOW = 0x08000000
local STARTF_USESHOWWINDOW = 0x00000001
local SW_HIDE = 0
local WAIT_OBJECT_0 = 0
local WAIT_TIMEOUT = 258

local function base64(value)
    local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    local result = {}
    for offset = 1, #value, 3 do
        local first, second, third = value:byte(offset, offset + 2)
        local bits = first * 65536 + (second or 0) * 256 + (third or 0)
        result[#result + 1] = alphabet:sub(math.floor(bits / 262144) % 64 + 1, math.floor(bits / 262144) % 64 + 1)
            .. alphabet:sub(math.floor(bits / 4096) % 64 + 1, math.floor(bits / 4096) % 64 + 1)
            .. (second and alphabet:sub(math.floor(bits / 64) % 64 + 1, math.floor(bits / 64) % 64 + 1) or "=")
            .. (third and alphabet:sub(bits % 64 + 1, bits % 64 + 1) or "=")
    end
    return table.concat(result)
end

local function run_powershell(cmd_line, wait_timeout_ms)
    local executable, arguments = cmd_line:match('^%s*"([^"]+)"%s*(.*)$')
    if not executable then executable, arguments = cmd_line:match("^%s*(%S+)%s*(.*)$") end
    if not executable then return false, "invalid_command" end
    -- EncodedCommand contains only ASCII base64. Paths and arguments are decoded
    -- separately as UTF-8, preserving Unicode and literal shell metacharacters.
    local script = "$ErrorActionPreference='Stop';try{$info=New-Object System.Diagnostics.ProcessStartInfo;"
        .. "$info.FileName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" .. base64(executable) .. "'));"
        .. "$info.Arguments=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" .. base64(arguments or "") .. "'));"
        .. "$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$p=[Diagnostics.Process]::Start($info);"
    if wait_timeout_ms then
        script = script .. "if(!$p.WaitForExit(" .. tostring(wait_timeout_ms) .. ")){try{$p.Kill();$null=$p.WaitForExit(5000)}catch{};exit 1460};"
            .. "$code=$p.ExitCode;$p.Dispose();exit $code"
    else
        script = script .. "$p.Dispose();exit 0"
    end
    script = script .. "}catch{exit 127}"
    local utf16 = script:gsub(".", function(char) return char .. "\0" end)
    local ok, result, reason, code = pcall(os.execute,
        "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " .. base64(utf16))
    if not ok then return false, "process_launch_failed" end
    local exit_code = type(result) == "number" and result or (result == true and 0 or tonumber(code))
    if exit_code == 1460 then return false, "process_timeout" end
    if exit_code == nil or exit_code == 127 then return false, "process_launch_failed" end
    return true, exit_code
end

function M.run_silent(cmd_line, wait_timeout_ms)
    if type(cmd_line) ~= "string" or cmd_line == "" or cmd_line:find("\0", 1, true) then
        return false, "invalid_command"
    end
    wait_timeout_ms = tonumber(wait_timeout_ms)
    if wait_timeout_ms and wait_timeout_ms > 0 then
        wait_timeout_ms = math.max(1, math.floor(math.min(wait_timeout_ms, 2147483647)))
    else
        wait_timeout_ms = nil
    end
    -- The ANSI Win32 API cannot faithfully launch UTF-8 profile/game paths.
    -- The encoded PowerShell path preserves them on both Lua runtimes.
    if kernel32 and ffi and not cmd_line:find("[\128-\255]") then
        local si = ffi.new("STARTUPINFOA")
        si.cb = ffi.sizeof("STARTUPINFOA")
        si.dwFlags = STARTF_USESHOWWINDOW
        si.wShowWindow = SW_HIDE

        local pi = ffi.new("PROCESS_INFORMATION")
        local cmd_buf = ffi.new("char[?]", #cmd_line + 1)
        ffi.copy(cmd_buf, cmd_line)

        local ok = kernel32.CreateProcessA(
            nil,
            cmd_buf,
            nil,
            nil,
            0,
            CREATE_NO_WINDOW,
            nil,
            nil,
            si,
            pi
        )

        if ok == 0 then
            return false, "CreateProcess failed"
        end

        local exit_code, wait_error = 0, nil
        if wait_timeout_ms then
            local wait_result = kernel32.WaitForSingleObject(pi.hProcess, wait_timeout_ms)
            if wait_result ~= WAIT_OBJECT_0 then
                kernel32.TerminateProcess(pi.hProcess, 1460)
                kernel32.WaitForSingleObject(pi.hProcess, 5000)
                wait_error = wait_result == WAIT_TIMEOUT and "process_timeout" or "process_wait_failed"
            end
            local code_ptr = ffi.new("DWORD[1]")
            if kernel32.GetExitCodeProcess(pi.hProcess, code_ptr) ~= 0 then
                exit_code = tonumber(code_ptr[0])
            elseif not wait_error then
                wait_error = "process_exit_code_failed"
            end
        end

        kernel32.CloseHandle(pi.hThread)
        kernel32.CloseHandle(pi.hProcess)
        if wait_error then return false, wait_error end
        return true, exit_code
    else
        -- Millennium's standard Lua runtime may not provide LuaJIT FFI. Keep
        -- background work asynchronous and preserve timeouts in that runtime.
        return run_powershell(cmd_line, wait_timeout_ms)
    end
end

return M
end
