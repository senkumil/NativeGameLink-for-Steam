"""Isolated clean-profile smoke test. Requires Python and lupa (pip install lupa).

Runs real Lua modules with Millennium's host APIs stubbed. No live Steam state,
network requests, helper processes, or achievement mutations are used.
"""
import json
import shutil
import tempfile
from pathlib import Path
from lupa import LuaRuntime, lua_type

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='ngl-clean-profile-') as temporary:
    sandbox = Path(temporary)
    backend = sandbox / 'Plugin with spaces' / 'backend'
    shutil.copytree(ROOT / 'backend', backend)
    profile = sandbox / 'New User' / 'AppData'
    steam = sandbox / 'Steam'
    steam.mkdir()
    lua = LuaRuntime(unpack_returned_tuples=True)

    def from_lua(value):
        if lua_type(value) != 'table':
            return value
        keys = list(value.keys())
        if keys and all(isinstance(k, int) for k in keys) and set(keys) == set(range(1, len(keys) + 1)):
            return [from_lua(value[k]) for k in range(1, len(keys) + 1)]
        return {str(k): from_lua(v) for k, v in value.items()}

    def table(values):
        return lua.table_from(values, recursive=True)

    messages, ready = [], []
    modules = {
        'logger': table({level: lambda *args: messages.append(str(args[-1])) for level in ['info', 'warn', 'error']}),
        'millennium': table({'steam_path': lambda: str(steam), 'ready': lambda: ready.append(True)}),
        'json': table({'encode': lambda value: json.dumps(from_lua(value)), 'decode': lambda value: table(json.loads(value))}),
        'fs': table({
            'join': lambda *parts: str(Path(*parts)),
            'parent_path': lambda value: str(Path(value).parent),
            'exists': lambda value: Path(value).exists(),
            'create_directories': lambda value: Path(value).mkdir(parents=True, exist_ok=True),
        }),
        'http': table({'get': lambda *_: (_ for _ in ()).throw(AssertionError('Unexpected network request'))}),
    }
    lua.globals().host_modules = table(modules)
    lua.globals().clean_profile = str(profile)
    lua.globals().MILLENNIUM_PLUGIN_SECRET_BACKEND_ABSOLUTE = str(backend)
    lua.execute('''
        local original_require = require
        function require(name) return host_modules[name] or original_require(name) end
        os.getenv = function(name)
            if name == "APPDATA" or name == "TEMP" or name == "TMP" then return clean_profile end
            return nil
        end
        os.execute = function() error("Unexpected process launch") end
        io.popen = function() error("Unexpected process launch") end
    ''')
    plugin = lua.execute((backend / 'main.lua').read_text(encoding='utf-8'))
    plugin.on_load()
    assert ready == [True], 'fresh backend must publish readiness'
    assert not profile.exists(), 'startup must not depend on a pre-existing profile'
    api = lua.globals()
    assert json.loads(api.get_all_mappings()) == {}, 'fresh mappings must be empty'
    result = json.loads(api.update_mappings(json.dumps({'set': {'shortcut:3000000000': '1888930'}})))
    assert result['ok'], result
    expected = {'shortcut:3000000000': '1888930'}
    assert json.loads(api.get_all_mappings()) == expected
    state_file = profile / 'NativeGameLinkForSteam' / 'mappings.json'
    assert json.loads(state_file.read_text()) == expected
    assert not (backend.parent / 'mappings.json').exists()
    state_file.write_text('broken json')
    assert json.loads(api.get_all_mappings()) == expected, 'backup must recover a corrupt primary'
    result = json.loads(api.update_mappings(json.dumps({'remove': ['shortcut:3000000000']})))
    assert result['ok'] and json.loads(api.get_all_mappings()) == {}
    plugin.on_unload()
    print('Backend runtime passed: readiness, empty profile, first write, readback, backup recovery and unlink in isolated paths.')
