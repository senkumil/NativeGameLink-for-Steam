"""Compare the real Lua artwork codec against Python's base64. Requires lupa."""
import base64
from pathlib import Path
from lupa import LuaRuntime

root = Path(__file__).resolve().parents[1]
lua = LuaRuntime(encoding=None)
codec = lua.execute((root / 'backend/lib/artwork_icon.lua').read_bytes())(lua.table())
for length in [0, 1, 2, 3, 4094, 4095, 4096, 4097, 4098, 8191, 8192, 8193, 100_000]:
    original = bytes((i * 73 + 19) % 256 for i in range(length))
    encoded = codec[b'encode_base64'](original)
    assert encoded == base64.b64encode(original), f'Corrupt encoding at {length} bytes'
    if original:
        assert codec[b'decode_base64'](encoded) == original, f'Corrupt round trip at {length} bytes'
print('Artwork codec: binary data and chunk boundaries passed')

lua.globals()[b'binary_factory'] = lua.execute((root / 'backend/lib/binary_http.lua').read_bytes())
lua.globals()[b'image_factory'] = lua.execute((root / 'backend/lib/artwork_image_io.lua').read_bytes())
lua.globals()[b'codec'] = codec
lua.execute(b'''
    local payload = string.char(255, 216, 0) .. string.rep('binary\\0image', 1000)
    local last_path, downloads, mode = nil, 0, 'ok'
    local host = {
        download = function(url, path, options)
            last_path = path
            downloads = downloads + 1
            assert(options.follow_redirects == false)
            local file = assert(io.open(path, 'wb'))
            file:write(payload)
            file:close()
            if mode == 'throw' then error('network') end
            if mode == 'missing' then return { success = false, status = 404 } end
            return { success = true, status = 200 }
        end,
        get = function() error('binary GET must not be used') end,
    }
    local binary = binary_factory({ http = host })
    local images = image_factory({ binary_http = binary, artwork_icon = codec,
        cjson = { encode = function(value) return value end } })
    local result = images.fetch_remote({ url = 'https://shared.steamstatic.com/image.jpg' })
    assert(result.ok and result.mime == 'image/jpeg')
    assert(codec.decode_base64(result.data_base64) == payload)
    assert(io.open(last_path, 'rb') == nil, 'temporary file leaked')
    mode = 'missing'
    result = images.fetch_remote({ url = 'https://shared.steamstatic.com/image.jpg' })
    assert(not result.ok and result.status == 404)
    assert(io.open(last_path, 'rb') == nil)
    mode = 'throw'
    result = images.fetch_remote({ url = 'https://shared.steamstatic.com/image.jpg' })
    assert(not result.ok and result.error == 'network_error')
    assert(io.open(last_path, 'rb') == nil)
    local previous = downloads
    images.fetch_remote({ url = 'https://example.com/image.jpg' })
    assert(downloads == previous, 'untrusted host downloaded')
    local legacy = binary_factory({http = {get = function() return {status=404} end}})
    assert(legacy.get('url', {}).status == 404)
''')
print('Binary download: NUL bytes preserved, 404 and failure cleanup, host validation passed')
