import fs from 'node:fs';
import fengari from 'fengari';
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

/** Production Lua runs with explicitly supplied mocked host dependencies. */
export function runLuaCheck(files, assertions, globals = {}) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  for (const [key, value] of Object.entries(globals)) {
    lua.lua_pushlstring(state, value instanceof Uint8Array ? value : to_luastring(value));
    lua.lua_setglobal(state, to_luastring(key));
  }
  const factories = Object.entries(files).map(([name, file]) =>
    `factories[${JSON.stringify(name)}] = (function()\n${fs.readFileSync(file, 'utf8')}\nend)()`
  ).join('\n');
  const source = `local factories = {}\n${factories}\n${assertions}`;
  const result = lauxlib.luaL_dostring(state, to_luastring(source));
  if (result !== lua.LUA_OK) throw Error(to_jsstring(lua.lua_tostring(state, -1)));
  lua.lua_close(state);
}
