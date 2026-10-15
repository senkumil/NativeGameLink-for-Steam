import './installed-steam-check.mjs';
// Inspect installed code, then execute only its pure exact-window lookup in
// fixture objects. Never initialize the native App/WindowStore/NavStore factory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export function nativeWindowOracle(steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') {
  const source = fs.readFileSync(path.join(steam, 'sp.js'), 'utf8');
  const self = { webpackChunksteamui: [] };
  vm.runInNewContext(source, { self }, { timeout: 3000 });
  const factories = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
  const matches = Object.entries(factories).filter(([, factory]) => {
    const code = String(factory);
    return code.includes('GetWindowInstanceFromWindow(') && code.includes('get SteamUIWindows()')
      && code.includes('IsMainGamepadUIWindow()') && code.includes('window.SteamUIStore=');
  });
  assert.equal(matches.length, 1, 'Installed native WindowStore has one semantic owner factory');
  const [id, factory] = matches[0], factorySource = String(factory);
  const method = factorySource.match(/GetWindowInstanceFromWindow\([^)]*\)\{[^{}]+\}/)?.[0];
  assert(method?.includes('.BrowserWindow=='), 'Installed WindowStore verifies the exact receiver BrowserWindow');
  const lookup = vm.runInNewContext(`({${method}})`).GetWindowInstanceFromWindow;
  const navMatches = Object.entries(factories).filter(([, candidate]) => {
    const code = String(candidate);
    return code.includes('window.tempNavStore=') && code.includes('UpdateRoutingInfo(')
      && code.includes('m_locationPathname') && code.includes('m_history');
  });
  assert.equal(navMatches.length, 1, 'Installed native routing has one local NavStore singleton factory');
  const [navStoreId, navFactory] = navMatches[0], navFactorySource = String(navFactory);
  const routeUpdate = navFactorySource.match(/UpdateRoutingInfo\([^)]*\)\{[^{}]+\}/)?.[0];
  assert(routeUpdate?.includes('.pathname') && routeUpdate.includes('m_history'),
    'Installed NavStore copies the local history and committed React router pathname');
  const updateRoutingInfo = vm.runInNewContext(`({${routeUpdate}})`).UpdateRoutingInfo;
  const tabIds = [...new Set([...source.matchAll(/\{id:"([^"]+)",title:"#AppDetails_Tab_(?:Activity|YourStuff|Community|GameInfo)"/g)]
    .map(match => match[1]))];
  return { id, factorySource, lookup, tabIds, navStoreId, navFactorySource, updateRoutingInfo };
}
