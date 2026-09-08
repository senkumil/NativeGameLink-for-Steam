import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context = vm.createContext({ exports: {}, require: () => ({ backendLog: () => {} }) });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/ui/SteamUIModeService.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const mode = context.exports.steamUIModeService;
const tokens = value => ({ contains: token => value.split(' ').includes(token) });
function doc(childClass, bodyClass = 'DesktopUI', href = 'https://steamloopback.host/index.html') {
  return { title: 'Steam', defaultView: { location: { href } },
    documentElement: { classList: tokens('SteamUIPopupHTML') }, body: { classList: tokens(bodyClass) },
    querySelector: selector => selector.split(',').some(raw => {
      const part = raw.trim();
      return part.startsWith('.') ? childClass.split(' ').includes(part.slice(1))
        : part.includes('class*=') && childClass.includes(part.match(/"([^"]+)"/)[1]);
    }) ? {} : null,
  };
}
assert.equal(mode.isGamepadUI(doc('Button GamepadUIToggle')), false, 'Desktop Big Picture entry button is not active Big Picture');
assert.equal(mode.isDesktop(doc('Button GamepadUIToggle')), true);
assert.equal(mode.isGamepadUI(doc('GamepadUI')), true);
assert.equal(mode.isGamepadUI(doc('', 'GamepadUI')), true);
assert.equal(mode.isGamepadUI(doc('', '', 'https://steamloopback.host/gamepadui')), true);
console.log('UI mode runtime passed: desktop GamepadUIToggle rejected, active gamepad surfaces retained.');
