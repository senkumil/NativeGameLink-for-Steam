import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('frontend/runtime/existing-windows.ts', 'utf8');
let sp;
const context = vm.createContext({ exports: {}, require: () => ({ findSP: () => sp }) });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { isDesktopSteamWindow, getCanonicalDesktopPopup } = context.exports;
function surface(name, title = 'Steam', desktop = false) {
  return { name, closed: false, document: { title, body: {}, querySelector: () => desktop ? {} : null } };
}
const desktop = surface('SP Desktop_uid0');
assert.equal(isDesktopSteamWindow(desktop), true);
assert.equal(isDesktopSteamWindow(surface('', 'Steam', true)), true);
for (const name of ['', 'Steam', 'SP Desktop Popup', 'SP Desktop Menu', 'Shared JS Context', 'SP BPM']) {
  assert.equal(isDesktopSteamWindow(surface(name)), false, `must reject auxiliary surface ${name}`);
}
const menu = surface('SP Desktop Popup');
sp = menu;
assert.equal(getCanonicalDesktopPopup({ GetExistingPopup: () => ({ window: menu }) }), null);
sp = desktop;
assert.equal(getCanonicalDesktopPopup({ GetExistingPopup: () => ({ window: menu }) }).window, desktop);
assert.equal(getCanonicalDesktopPopup({ GetExistingPopup: () => ({ window: desktop }) }).window, desktop);
desktop.closed = true;
assert.equal(isDesktopSteamWindow(desktop), false);
console.log('Window runtime checks passed: desktop selected, menus/background/BPM rejected, fallback and closed windows verified.');
