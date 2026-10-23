import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { nativeArtworkStoresRuntime } from './helpers/native-artwork-stores-runtime.mjs';
import { assetDeadlineRuntime } from './helpers/asset-deadline-runtime.mjs';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const detailFactory = function () { /* GetCustomLogoPosition( SaveCustomLogoPosition( GetAppData( */ };
const appFactory = function () { /* GetAppOverviewByAppID( GetCustomLogoImageURLs( */ };
const details = () => ({ GetCustomLogoPosition() {}, SaveCustomLogoPosition() {}, GetAppData() {} });
const apps = () => ({ GetAppOverviewByAppID() {}, GetCustomLogoImageURLs() {} });

function harness(factories = [{ id: 'changed-details', factory: detailFactory }, { id: 'changed-apps', factory: appFactory }]) {
  const doc = { defaultView: { closed: false } }; doc.defaultView.document = doc;
  let identity = {}, now = 0, loaded = [], capture = 0;
  const required = [], exports = new Map(), nativeDetails = details(), nativeApps = apps();
  for (const entry of factories) {
    const source = String(entry.factory);
    if (['GetCustomLogoPosition(', 'SaveCustomLogoPosition(', 'GetAppData('].every(token => source.includes(token)))
      exports.set(entry.id, { unpredictableExport: nativeDetails });
    if (['GetAppOverviewByAppID(', 'GetCustomLogoImageURLs('].every(token => source.includes(token)))
      exports.set(entry.id, { anotherExport: nativeApps });
  }
  const require = id => { required.push(id); const value = exports.get(id); if (value instanceof Error) throw value; return value; };
  require.m = Object.fromEntries(factories.map(entry => [entry.id, entry.factory]));
  const runtime = {
    captureRuntime(value) { assert.equal(value, doc); capture++; },
    getRuntimeIdentity: () => identity,
    getAllModules: () => loaded,
    getModuleFactoryCount: () => factories.length,
    getModuleFactories: () => factories,
    getRequire: () => require,
  };
  const api = nativeArtworkStoresRuntime(runtime, { Date: { now: () => now } });
  return { api, doc, required, exports, nativeDetails, nativeApps, factories, runtime,
    get capture() { return capture; },
    set loaded(value) { loaded = value; },
    advance() { now += 1001; }, replaceRuntime() { identity = {}; },
  };
}

{
  const h = harness();
  const first = h.api.resolveNativeArtworkStores(h.doc);
  check(first.details === h.nativeDetails && first.apps === h.nativeApps, 'Renumbered modules and renamed exports resolve by native capabilities');
  check(h.required.length === 2, 'Only the two matching store factories are required');
  for (let index = 0; index < 100; index++) h.api.resolveNativeArtworkStores(h.doc);
  check(h.required.length === 2 && h.capture === 1, 'Repeated navigation does not rescan or instantiate native modules');
  const replacement = details(); h.exports.set('changed-details', { completelyRenamed: replacement }); h.replaceRuntime();
  check(h.api.resolveNativeArtworkStores(h.doc).details === replacement, 'A rebuilt runtime never reuses the retired store');
  const reads = h.required.length; h.doc.defaultView.closed = true;
  check(h.api.resolveNativeArtworkStores(h.doc) === null && h.required.length === reads, 'Closed windows cannot resolve or initialize stores');
}
{
  const h = harness(); h.loaded = [{ exports: h.nativeDetails }, { exports: { renamed: h.nativeApps } }];
  check(h.api.resolveNativeArtworkStores(h.doc).apps === h.nativeApps && !h.required.length,
    'Loaded direct/named exports are preferred without instantiating factories');
  const anotherDocument = { defaultView: h.doc.defaultView };
  check(h.api.resolveNativeArtworkStores(anotherDocument) === null, 'A mismatched document cannot borrow another realm stores');
}
{
  const h = harness([]);
  for (let index = 0; index < 100; index++) h.api.resolveNativeArtworkStores(h.doc);
  check(h.capture === 1, 'A missing runtime has a bounded discovery cooldown');
  h.advance(); h.loaded = [{ exports: { moved: h.nativeDetails } }, { exports: h.nativeApps }];
  check(h.api.resolveNativeArtworkStores(h.doc).details === h.nativeDetails, 'Late loaded exports recover without restarting the document');
  h.doc.defaultView.appDetailsStore = details(); h.doc.defaultView.appStore = apps();
  check(h.api.resolveNativeArtworkStores(h.doc).apps === h.doc.defaultView.appStore, 'Live global replacements take precedence over cached stores');
}
{
  const irrelevant = function () { throw Error('Unrelated native services must never initialize'); };
  const h = harness([{ id: 'account-service', factory: irrelevant }, { id: 'new-a', factory: detailFactory }, { id: 'new-b', factory: appFactory }]);
  h.api.resolveNativeArtworkStores(h.doc);
  check(!h.required.includes('account-service'), 'Discovery does not initialize unrelated native services');
}
{
  const h = harness(), healthy = h.exports.get('changed-apps');
  h.exports.set('changed-apps', new Error('Native chunk is not ready'));
  for (let index = 0; index < 100; index++) h.api.resolveNativeArtworkStores(h.doc);
  check(h.required.length === 2 && h.capture === 1, 'A failing matching factory does not create a discovery loop');
  h.exports.set('changed-apps', healthy); h.advance();
  check(h.api.resolveNativeArtworkStores(h.doc).apps === h.nativeApps, 'Transient initialization failure retries after the bounded cooldown');
}

const installed = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
if (process.env.NGL_INSTALLED_STEAM_CHECKS !== 'unavailable' && fs.existsSync(installed + '/sp.js')) {
  const chunks = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(installed + '/sp.js', 'utf8'), { self: chunks });
  const all = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
  const factories = Object.entries(all).map(([id, factory]) => ({ id, factory }));
  const h = harness(factories), result = h.api.resolveNativeArtworkStores(h.doc);
  check(result.details === h.nativeDetails && result.apps === h.nativeApps, 'Installed Steam factories resolve without old module IDs or account services');
  check(h.required.length === 2, 'Installed factory discovery requires exactly the two artwork stores');
  // Re-key the exact installed code to prove that another client build can use
  // different IDs without adding a version- or game-specific exception.
  const renamed = harness(factories.map((entry, index) => ({ ...entry, id: 'different-client-' + index })));
  const resolved = renamed.api.resolveNativeArtworkStores(renamed.doc);
  check(resolved.details === renamed.nativeDetails && resolved.apps === renamed.nativeApps,
    'The same installed code works after every private module ID changes');
  const shortcutId = 3300000001, overview = { appid: shortcutId }, saves = [];
  h.nativeApps.GetAppOverviewByAppID = id => id === shortcutId ? overview : null;
  h.nativeDetails.SaveCustomLogoPosition = (target, position) => { saves.push({ target, position }); };
  const dependencies = { './native-artwork-stores': h.api, './native-asset-write': assetDeadlineRuntime(),
    '../shortcuts/host': { shortcutRuntimeHost: () => ({ getMainWindowDoc: () => h.doc }) },
    '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: h.runtime } };
  const backgroundWindow = { closed: false, document: {} };
  const context = vm.createContext({ exports: {}, window: backgroundWindow, require: name => dependencies[name] });
  vm.runInContext(ts.transpileModule(fs.readFileSync(process.env.NGL_NATIVE_LOGO_POSITION_SOURCE || 'frontend/features/library/native-logo-position.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  check(await context.exports.saveNativeShortcutLogoPosition(shortcutId,
    { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 50 }, () => true),
    'Production logo positioning reaches the current native store APIs without globals or legacy module IDs');
  check(saves.length === 1 && saves[0].target === overview, 'Exactly the current native shortcut reaches its own save method');
  check(h.doc.defaultView !== backgroundWindow, 'Logo positioning uses the authorized Steam document rather than the plugin background window');
}
console.log(`Native artwork store discovery passed: ${checks} checks; runtime changes, realm isolation, late readiness, bounded scans and current installed factory signatures. Native store initialization is mocked.`);
