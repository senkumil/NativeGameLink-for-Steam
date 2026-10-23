import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import luaparse from 'luaparse';
import { nativeArtworkStoresRuntime } from './helpers/native-artwork-stores-runtime.mjs';

const SID = 3300000001;
const source = fs.readFileSync('frontend/features/library/native-logo-sources.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function harness(ids = [SID]) {
  const state = { verified: true, mappings: Object.fromEntries(ids.map(id => [`shortcut:${id}`, '1030300'])) };
  const requests = [], subscriptions = new Set(), moduleStores = new WeakMap();
  let runtimeProbes = 0;
  const dependencies = {
    '../../api/backend': { readShortcutLogoInventoryBackend({ request_json }) {
      return new Promise((resolve, reject) => requests.push({ body: JSON.parse(request_json), resolve, reject }));
    } },
    '../../core/mappings': {
      isMappingSnapshotVerified: () => state.verified,
      get mappings() { return state.mappings; },
      shortcutMappingKey: id => `shortcut:${id}`,
      subscribeMappings(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); },
    },
    '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: {
      captureRuntime() { runtimeProbes++; },
      getRuntimeIdentity: doc => doc,
      getModuleFactoryCount: () => 0,
      getModuleFactories: () => [],
      getAllModules: doc => [{ id: 'renumbered', exports: { changedExport: moduleStores.get(doc) } }],
      getRequire(doc) { return id => { assert.equal(id, 1776); return { tw: moduleStores.get(doc) }; }; },
    } },
  };
  dependencies['./native-artwork-stores'] = nativeArtworkStoresRuntime(dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime);
  const context = vm.createContext({ exports: {}, URL, require: name => {
    assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  } });
  vm.runInContext(compiled, context);
  function fixture(sharedApps) {
    const overviews = new Map(ids.map(id => [id, {
      appid: id, rt_custom_image_mtime: 10, icon_data: 'preserved', BIsModOrShortcut: () => true,
    }]));
    const results = new Map(), listeners = new Map();
    const original = function (overview) {
      assert.equal(this, apps, 'Native source getter keeps its receiver');
      const key = `${overview.appid}:${overview.rt_custom_image_mtime}`;
      if (!results.has(key)) results.set(key, ['jpg', 'png'].map(ext => `/customimages/${overview.appid}_logo.${ext}?v=${overview.rt_custom_image_mtime}&native=unchanged`));
      return results.get(key);
    };
    const apps = sharedApps || {
      GetAppOverviewByAppID: id => overviews.get(id < 0 ? id >>> 0 : id),
      GetCustomLogoImageURLs: original,
      GetCustomHeroImageURLs: () => ['hero-unchanged'],
    };
    const view = {
      appStore: apps,
      addEventListener(name, callback) { let callbacks = listeners.get(name); if (!callbacks) listeners.set(name, callbacks = new Set()); callbacks.add(callback); },
      removeEventListener(name, callback) { const callbacks = listeners.get(name); callbacks?.delete(callback); if (!callbacks?.size) listeners.delete(name); },
    };
    const doc = { defaultView: view };
    view.document = doc;
    moduleStores.set(doc, apps);
    return { doc, apps, overviews, original, results, listeners, dispatch: name => { for (const callback of listeners.get(name) || []) callback(); } };
  }
  async function settle(index = requests.length - 1, alter = rows => rows) {
    const request = requests[index]; assert(request, 'An inventory batch exists');
    const entries = request.body.shortcuts.map(row => ({
      shortcut_app_id: row.shortcut_app_id, steam_app_id: row.steam_app_id, requested_native_mtime: row.native_mtime,
      png_exists: true, jpg_exists: false,
    }));
    request.resolve(JSON.stringify({ ok: true, entries: alter(entries) })); await flush();
  }
  return { ...context.exports, fixture, state, requests, subscriptions, settle,
    mappingChanged: () => { for (const callback of subscriptions) callback(); },
    get runtimeProbes() { return runtimeProbes; } };
}

{
  const h = harness([SID, SID + 1, SID + 2, SID + 3]), f = h.fixture(), app = f.overviews.get(SID);
  const before = Object.getOwnPropertyDescriptors(app), originalSources = f.original.call(f.apps, app), hero = f.apps.GetCustomHeroImageURLs;
  const descriptor = Object.getOwnPropertyDescriptor(f.apps, 'GetCustomLogoImageURLs');
  const dispose = h.installNativeLogoSources(f.doc);
  assert.equal(h.installNativeLogoSources(f.doc), dispose, 'Installation is idempotent');
  assert.equal(f.apps.GetCustomLogoImageURLs(app), originalSources, 'Before evidence arrives the exact native array is returned');
  await flush(); assert.equal(h.requests.length, 1, 'All verified shortcuts share one startup inventory batch');
  assert.equal(h.requests[0].body.shortcuts.length, 4);
  await h.settle(0, rows => rows.map((row, index) => ({ ...row,
    png_exists: index !== 2 && index !== 3, jpg_exists: index === 1 || index === 3,
  })));
  const preferred = f.apps.GetCustomLogoImageURLs(app);
  assert.equal(preferred[0], originalSources[1], 'Only a confirmed PNG-only logo moves first');
  assert.equal(preferred[1], originalSources[0], 'The original JPG fallback remains available');
  assert.match(preferred[0], /\?v=10&native=unchanged$/, 'Native query parameters remain exact');
  assert.equal(originalSources[0].includes('_logo.jpg'), true, 'The native array is never mutated');
  for (let index = 0; index < 100; index++) assert.equal(f.apps.GetCustomLogoImageURLs(app), preferred, 'The reordered array is cached by identity');
  for (const id of [SID + 1, SID + 2, SID + 3]) {
    const overview = f.overviews.get(id);
    assert.equal(f.apps.GetCustomLogoImageURLs(overview), f.original.call(f.apps, overview), 'Both formats, neither format and JPG-only keep the exact native result');
  }
  const publicApp = { appid: 1030300, rt_custom_image_mtime: 10 };
  assert.equal(f.apps.GetCustomLogoImageURLs(publicApp), f.original.call(f.apps, publicApp), 'Public games keep the exact native result');
  const unlinked = { appid: SID + 20, rt_custom_image_mtime: 10 };
  assert.equal(f.apps.GetCustomLogoImageURLs(unlinked), f.original.call(f.apps, unlinked), 'Unlinked shortcuts keep the exact native result');
  const clone = { ...app };
  assert.equal(f.apps.GetCustomLogoImageURLs(clone), f.original.call(f.apps, clone), 'A copied overview cannot impersonate the real native overview');
  h.state.verified = false;
  assert.equal(f.apps.GetCustomLogoImageURLs(app), originalSources, 'Unverified mappings cannot use earlier evidence');
  h.state.verified = true;
  assert.deepEqual(Object.getOwnPropertyDescriptors(app), before, 'No overview, shortcut classification, icon or metadata property changes');
  assert.equal(f.apps.GetCustomHeroImageURLs, hero, 'Hero source ownership remains native');
  await flush(); assert.equal(h.requests.length, 1, 'Source reads and navigation issue no filesystem IPC');
  dispose(); dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.apps, 'GetCustomLogoImageURLs'), descriptor, 'Final disposal restores the original property descriptor');
  assert.equal(h.subscriptions.size, 0); assert.equal(f.listeners.size, 0);
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID);
  const dispose = h.installNativeLogoSources(f.doc); await flush(); await h.settle();
  const previous = f.apps.GetCustomLogoImageURLs(app);
  app.rt_custom_image_mtime = 11;
  const native = f.original.call(f.apps, app);
  assert.equal(f.apps.GetCustomLogoImageURLs(app), native, 'A changed native version immediately invalidates PNG evidence');
  for (let index = 0; index < 100; index++) { h.installNativeLogoSources(f.doc); f.apps.GetCustomLogoImageURLs(app); }
  await flush(); assert.equal(h.requests.length, 1, 'Native version invalidation never adds IPC during navigation');
  app.rt_custom_image_mtime = 10;
  assert.notEqual(f.apps.GetCustomLogoImageURLs(app), previous, 'An invalidated version cannot reuse its old reordered array');
  h.refreshNativeLogoInventory(f.doc); await flush(); assert.equal(h.requests.length, 2);
  await h.settle(); assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  dispose();
}
{
  const h = harness([SID, SID + 1, SID + 2]), f = h.fixture();
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  f.overviews.get(SID + 2).rt_custom_image_mtime = 11;
  await h.settle(0, rows => rows.map((row, index) => ({ ...row,
    steam_app_id: index === 0 ? '999' : row.steam_app_id,
    requested_native_mtime: index === 1 ? 99 : row.requested_native_mtime,
  })));
  for (const id of [SID, SID + 1, SID + 2]) {
    const overview = f.overviews.get(id);
    assert.equal(f.apps.GetCustomLogoImageURLs(overview), f.original.call(f.apps, overview), 'Foreign mapping, wrong echo and changes during IPC are rejected');
  }
  dispose();
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID), descriptor = Object.getOwnPropertyDescriptor(f.apps, 'GetCustomLogoImageURLs');
  const other = h.fixture(f.apps), dispose = h.installNativeLogoSources(f.doc), wrapper = f.apps.GetCustomLogoImageURLs;
  const disposeOther = h.installNativeLogoSources(other.doc); await flush();
  assert.equal(h.requests.length, 1, 'Documents sharing one store deduplicate inventory and wrappers');
  await h.settle(); dispose();
  assert.equal(f.apps.GetCustomLogoImageURLs, wrapper, 'One document cannot remove another document\'s adapter');
  assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  disposeOther();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.apps, 'GetCustomLogoImageURLs'), descriptor);
  assert.equal(h.subscriptions.size, 0);
}
{
  const h = harness(), f = h.fixture(), dispose = h.installNativeLogoSources(f.doc);
  await flush(); const foreign = () => ['foreign']; f.apps.GetCustomLogoImageURLs = foreign;
  dispose(); await h.settle();
  assert.equal(f.apps.GetCustomLogoImageURLs, foreign, 'Cleanup never replaces a later owner\'s method');
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID);
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  h.state.mappings[`shortcut:${SID}`] = '999';
  h.mappingChanged(); h.mappingChanged(); f.dispatch('gdl:artwork-changed'); await flush();
  assert.equal(h.requests.length, 1, 'Invalidation coalesces while an earlier batch is pending');
  await h.settle(0); assert.equal(h.requests.length, 2, 'A changed mapping receives exactly one replacement batch');
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.original.call(f.apps, app), 'Stale pending inventory cannot repopulate evidence');
  assert.equal(h.requests[1].body.shortcuts[0].steam_app_id, '999');
  await h.settle(1); assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  h.state.mappings = {};
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.original.call(f.apps, app), 'Unmapping invalidates positive evidence synchronously');
  dispose();
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID), dispose = h.installNativeLogoSources(f.doc);
  await flush(); dispose(); await h.settle();
  assert.equal(f.apps.GetCustomLogoImageURLs, f.original, 'An IPC completion after disposal cannot reinstall the adapter');
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.original.call(f.apps, app));
}
{
  const h = harness(), f = h.fixture();
  h.state.mappings = { [`shortcut:${SID - 4294967296}`]: '1030300', 'title:Test': '123', 'shortcut:123': '123', 'shortcut:9999999999': '123' };
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  assert.deepEqual(h.requests[0].body.shortcuts.map(row => row.shortcut_app_id), [String(SID)], 'Only exact valid shortcut identities are sent; legacy signed keys normalize safely');
  await h.settle(); assert.match(f.apps.GetCustomLogoImageURLs(f.overviews.get(SID))[0], /_logo\.png/); dispose();
}
{
  const h = harness(), f = h.fixture(); h.state.verified = false;
  const dispose = h.installNativeLogoSources(f.doc); await flush(); assert.equal(h.requests.length, 0);
  h.state.verified = true; h.mappingChanged(); await flush(); assert.equal(h.requests.length, 1);
  h.requests[0].reject(new Error('Backend unavailable')); await flush();
  const app = f.overviews.get(SID);
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.original.call(f.apps, app), 'Failed inventories preserve native behavior');
  dispose();
}
{
  const h = harness([SID, SID + 1, SID + 2]), f = h.fixture();
  const later = [f.overviews.get(SID + 1), f.overviews.get(SID + 2)];
  f.overviews.delete(SID + 1); f.overviews.delete(SID + 2);
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  assert.equal(h.requests[0].body.shortcuts.length, 1, 'A partial native store can start with one available overview');
  await h.settle();
  assert.equal(await h.refreshNativeLogoInventoryReadiness(f.doc), true, 'Missing native overviews request a bounded startup retry');
  assert.equal(h.requests.length, 1, 'Unchanged partial signatures do not repeat IPC');
  for (const overview of later) f.overviews.set(overview.appid, overview);
  const readiness = h.refreshNativeLogoInventoryReadiness(f.doc); await flush();
  assert.equal(h.requests.length, 2, 'Newly hydrated overviews receive a changed-signature batch');
  assert.equal(h.requests[1].body.shortcuts.length, 3);
  await h.settle(1); assert.equal(await readiness, false, 'Complete native stores stop readiness retries');
  for (const overview of later) assert.match(f.apps.GetCustomLogoImageURLs(overview)[0], /_logo\.png/, 'Late overviews also receive PNG-only evidence');
  for (let index = 0; index < 100; index++) assert.equal(await h.refreshNativeLogoInventoryReadiness(f.doc), false);
  assert.equal(h.requests.length, 2, 'Stable readiness never adds more batches');
  dispose();
}
{
  const h = harness(), f = h.fixture(), dispose = h.installNativeLogoSources(f.doc);
  await flush(); h.requests[0].reject(new Error('Backend starting')); await flush();
  for (let index = 1; index <= 2; index++) {
    const readiness = h.refreshNativeLogoInventoryReadiness(f.doc); await flush();
    assert.equal(h.requests.length, index + 1, 'Startup permits only two retries after an inventory failure');
    h.requests[index].reject(new Error('Backend unavailable')); await flush();
    assert.equal(await readiness, index < 2);
  }
  for (let index = 0; index < 20; index++) assert.equal(await h.refreshNativeLogoInventoryReadiness(f.doc), false);
  assert.equal(h.requests.length, 3, 'Failed inventory retries terminate');
  f.dispatch('gdl:artwork-changed'); await flush(); assert.equal(h.requests.length, 4, 'An explicit artwork change can initiate a fresh bounded attempt');
  await h.settle(3); dispose();
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID);
  app.rt_custom_image_mtime = 0;
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  assert.equal(h.requests.length, 0, 'An unhydrated zero native version never produces unversioned filesystem evidence');
  assert.equal(await h.refreshNativeLogoInventoryReadiness(f.doc), true, 'A zero native version can use the bounded startup readiness cycle');
  assert.equal(h.requests.length, 0, 'Unchanged zero versions add no IPC');
  app.rt_custom_image_mtime = 10;
  const readiness = h.refreshNativeLogoInventoryReadiness(f.doc); await flush();
  assert.equal(h.requests.length, 1, 'Hydrating the native version permits its first inventory batch');
  await h.settle(); assert.equal(await readiness, false);
  assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  dispose();
}
{
  const ids = Array.from({ length: 160 }, (_, index) => SID + index), h = harness(ids), f = h.fixture();
  const dispose = h.installNativeLogoSources(f.doc); await flush();
  assert.equal(h.requests[0].body.shortcuts.length, 128, 'Inventory evidence is bounded');
  await h.settle();
  const excluded = f.overviews.get(ids[159]);
  assert.equal(f.apps.GetCustomLogoImageURLs(excluded), f.original.call(f.apps, excluded), 'Shortcuts outside the bound preserve native behavior');
  dispose();
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID);
  const nativeMethod = f.apps.GetCustomLogoImageURLs;
  delete f.apps.GetCustomLogoImageURLs;
  Object.setPrototypeOf(f.apps, { GetCustomLogoImageURLs: nativeMethod });
  delete f.doc.defaultView.appStore;
  const dispose = h.installNativeLogoSources(f.doc); await flush(); await h.settle();
  assert.equal(h.runtimeProbes, 1, 'Same-realm webpack fallback resolves the native store');
  assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  dispose(); assert.equal(Object.hasOwn(f.apps, 'GetCustomLogoImageURLs'), false, 'Inherited native methods are restored without creating own properties');
  assert.equal(f.apps.GetCustomLogoImageURLs, nativeMethod);
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID), dispose = h.installNativeLogoSources(f.doc);
  await flush(); await h.settle();
  const key = `${SID}:10`, first = f.original.call(f.apps, app), cached = f.apps.GetCustomLogoImageURLs(app);
  for (let index = 0; index < 140; index++) {
    f.results.set(key, ['jpg', 'png'].map(ext => `/customimages/${SID}_logo.${ext}?v=10&native=${index}`));
    assert.match(f.apps.GetCustomLogoImageURLs(app)[0], /_logo\.png/);
  }
  f.results.set(key, first);
  assert.notEqual(f.apps.GetCustomLogoImageURLs(app), cached, 'Reordered native URL arrays have a bounded 128-entry cache');
  f.results.set(key, [`/customimages/${SID}_logo.jpg?v=10`, `/customimages/${SID + 1}_logo.png?v=10`]);
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.results.get(key), 'A filename belonging to another shortcut cannot use this evidence');
  f.results.set(key, [`/customimages/${SID}_logo.jpg?v=10`, `/customimages/${SID}_logo.png?v=11`]);
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.results.get(key), 'The exact URL version must match the observed native version');
  f.results.set(key, [`/customimages/${SID}_logo.png?v=10`, `/customimages/${SID}_logo.jpg?v=10`]);
  assert.equal(f.apps.GetCustomLogoImageURLs(app), f.results.get(key), 'An already PNG-first native result is returned by identity');
  dispose();
}
{
  const h = harness(), f = h.fixture(), app = f.overviews.get(SID);
  const native = ['https://example.com/customimages/3300000001_logo.jpg?v=10', 'https://example.com/customimages/3300000001_logo.png?v=10'];
  f.apps.GetCustomLogoImageURLs = () => native;
  const dispose = h.installNativeLogoSources(f.doc); await flush(); await h.settle();
  assert.equal(f.apps.GetCustomLogoImageURLs(app), native, 'Only native loopback custom-image URLs can be reordered');
  dispose();
}

// Backend contract checks parse the real Lua; they do not claim Lua execution.
const lua = fs.readFileSync('backend/lib/shortcut_logo_inventory.lua', 'utf8');
const ast = luaparse.parse(lua, { luaVersion: '5.1' });
const calls = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.base?.type === 'MemberExpression') calls.push(`${node.base.base?.name}.${node.base.identifier?.name}`);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
}
visit(ast);
assert.equal(calls.filter(call => call === 'fs.exists').length, 2, 'Inventory reads only PNG/JPG existence');
assert.equal(calls.filter(call => call === 'config.read_json').length, 1, 'Backend mapping authority is read once per batch');
assert.equal(calls.filter(call => /^(http\.|fs\.(read|write|remove|delete))/.test(call)).length, 0, 'Inventory neither loads images nor mutates files nor uses network');
assert.match(lua, /index > 128/); assert.match(lua, /id >= 2147483648 and id <= 4294967295/);
assert.match(lua, /mappings\["shortcut:" \.\. id_text\]/); assert.match(lua, /tostring\(mapped or ""\) == steam_id/);
assert.match(lua, /get_active_account_id\(\)/); assert.match(lua, /requested_native_mtime = mtime/);
assert.match(lua, /png_exists = not not fs\.exists/); assert.match(lua, /jpg_exists = not not fs\.exists/);
console.log('Native logo sources: verified PNG-only ordering, native identity, version handshake/invalidation, bounded batch/cache, shared ownership, cleanup and Lua read-only inventory contracts passed.');
