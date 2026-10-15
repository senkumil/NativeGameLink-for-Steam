import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const windowInstances = new WeakMap();
const windowRuntime = { getRuntimeIdentity: () => null, getAllModules: () => [], getRequire: () => null,
  getModuleFactoryCount: () => 0, getModuleFactories: () => [] };
const nativeContext = vm.createContext({ exports: {}, require: () => ({ steamWebpackRuntime: windowRuntime }) });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/native-window-store.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, nativeContext);
const context = vm.createContext({ exports: {}, require: name => name.endsWith('/native-window-store')
  ? nativeContext.exports : { backendLog: () => {} } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/ui/SteamUIModeService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const mode = context.exports.steamUIModeService;
const tokens = value => ({ contains: token => value.split(' ').includes(token) });
function doc(childClass, bodyClass = 'DesktopUI', href = 'https://steamloopback.host/index.html') {
  const result = { title: 'Steam', defaultView: { location: { href } },
    documentElement: { classList: tokens('SteamUIPopupHTML') }, body: { classList: tokens(bodyClass) },
    querySelector: selector => selector.split(',').some(raw => {
      const part = raw.trim();
      return part.startsWith('.') ? childClass.split(' ').includes(part.slice(1))
        : part.includes('class*=') && childClass.includes(part.match(/"([^"]+)"/)[1]);
    }) ? {} : null,
  };
  result.defaultView.document = result;
  result.defaultView.SteamUIStore = { WindowStore: { GetWindowInstanceFromWindow: view => windowInstances.get(view) } };
  return result;
}
assert.equal(mode.isGamepadUI(doc('Button GamepadUIToggle')), false, 'Desktop Big Picture entry button is not active Big Picture');
assert.equal(mode.isDesktop(doc('Button GamepadUIToggle')), true);
assert.equal(mode.isGamepadUI(doc('GamepadUI')), true);
assert.equal(mode.isGamepadUI(doc('', 'GamepadUI')), true);
assert.equal(mode.isGamepadUI(doc('', '', 'https://steamloopback.host/gamepadui')), true);
const hashed = doc('hashed-native-surface', '', 'https://steamloopback.host/library');
const native = { BrowserWindow: hashed.defaultView, mainGamepad: true,
  IsMainGamepadUIWindow() { return this.mainGamepad; }, IsGamepadUIWindow: () => true };
windowInstances.set(hashed.defaultView, native);
assert.equal(mode.isGamepadUI(hashed), true, 'Exact native BPM window is recognized without URL/title/CSS hints');
native.mainGamepad = false;
assert.equal(mode.isGamepadUI(hashed), false, 'The broader overlay/VR/keyboard signal cannot adopt a detail window');
const staleMarker = doc('GamepadUI', 'GamepadUI', 'https://steamloopback.host/gamepadui');
windowInstances.set(staleMarker.defaultView, { BrowserWindow: staleMarker.defaultView, IsMainGamepadUIWindow: () => false });
assert.equal(mode.isGamepadUI(staleMarker), false, 'Current native desktop type overrides stale gamepad markers');
windowInstances.set(hashed.defaultView, { BrowserWindow: staleMarker.defaultView, IsMainGamepadUIWindow: () => true });
assert.equal(mode.isGamepadUI(hashed), false, 'Another native window cannot establish this document mode');
windowInstances.set(hashed.defaultView, { IsMainGamepadUIWindow: () => true });
assert.equal(mode.isGamepadUI(hashed), false, 'A native instance without exact BrowserWindow ownership is rejected');
console.log('UI mode runtime passed: 10 checks; native WindowInstance-only BPM, exact ownership, desktop/overlay rejection and legacy surface detection.');
