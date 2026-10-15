import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0, clock = 5000, foreignPlaytimeCalls = 0;
const check = (value, message) => { assert(value, message); checks++; };
const timers = new Map(); let serial = 0;
const globals = { NodeFilter: { SHOW_TEXT: 4 }, Date: class extends Date { static now() { return clock; } },
  window: { SteamClient: { Apps: { GetPlaytime: async () => { foreignPlaytimeCalls++; return { nPlaytimeForever: 9999 }; } } } },
  setTimeout: callback => { timers.set(++serial, callback); return serial; }, clearTimeout: id => timers.delete(id) };
function load(file, dependencies) {
  const context = vm.createContext({ exports: {}, ...globals, require: name => {
    assert(name in dependencies, `Unexpected ${file} dependency: ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
const id = 3000000001, sibling = id + 1, committed = new Map([[id, '550'], [sibling, '550']]);
const normalize = value => Number.isInteger(Number(value)) && Number(value) !== 0 && Number(value) >= -2147483648 && Number(value) <= 4294967295 ? Number(value) >>> 0 : null;
const modes = { steamUIModeService: { isGamepadUI: doc => doc.defaultView.gamepad === true } };
const adapters = load('frontend/steam/gamepad/stores/AppStoreAdapter.ts', {});
const overview = load('frontend/features/big-picture/overview-state.ts', {
  '../../steam/gamepad/GamepadContext': { normalizeGamepadAppId: normalize },
  '../../steam/gamepad/stores/AppStoreAdapter': adapters,
  '../../steam/ui/SteamUIModeService': modes,
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: key => committed.get(key) || null },
});
function label(doc, text = 'No playtime') {
  const attributes = new Map();
  return { ownerDocument: doc, isConnected: true, textContent: text, dataset: new Proxy({}, {
    get: (_target, key) => key === 'gdlBpPlaytime' ? attributes.get('data-gdl-bp-playtime') : undefined,
    set: (_target, key, value) => { if (key === 'gdlBpPlaytime') attributes.set('data-gdl-bp-playtime', value); return true; },
  }), getAttribute: key => attributes.get(key) ?? null,
  setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
}
function fixture(name) {
  const doc = { body: { isConnected: true }, hidden: false, route: '/library', getElementById: () => null, querySelector: () => null };
  const records = new Map();
  const view = { document: doc, closed: false, gamepad: true, name, appStore: { GetAppOverviewByAppID: key => records.get(key >>> 0) },
    renders: 0, MILLENNIUM_STEAM_FORCE_RERENDER() { this.renders++; } };
  doc.defaultView = view;
  const native = Object.freeze({ appid: 550, display_name: 'Same title', minutes_playtime_forever: 100,
    controller_support: 2, steam_deck_compat_category: 3, installed: true, BIsShortcut: () => false });
  const app = { appid: id, display_name: 'Same title', minutes_playtime_forever: 10,
    minutes_playtime_last_two_weeks: 2, rt_last_time_played: 100, installed: false, controller_support: 0,
    steam_deck_compat_category: 0, BIsShortcut: () => true, BIsModOrShortcut: () => true };
  records.set(id, app); records.set(550, native);
  const ownLabel = label(doc), publicLabel = label(doc), siblingLabel = label(doc);
  const card = key => ({ parentElement: doc.body, getAttribute: attribute => attribute === 'data-appid' ? String(key) : null, querySelectorAll: () => [] });
  ownLabel.parentElement = card(id); publicLabel.parentElement = card(550); siblingLabel.parentElement = card(sibling);
  doc.createTreeWalker = () => { const nodes = [ownLabel, publicLabel, siblingLabel].map(element => ({ textContent: element.textContent, parentElement: element })); let i = 0; return { nextNode: () => nodes[i++] || null }; };
  return { doc, view, records, app, native, ownLabel, publicLabel, siblingLabel };
}
const a = fixture('A'), b = fixture('B');
const originalA = Object.getOwnPropertyDescriptors(a.app), originalB = Object.getOwnPropertyDescriptors(b.app);
check(overview.setBigPicturePlaytimeField(a.doc, a.app, 'minutes_playtime_forever', 60), 'Measured playtime projects into the exact owner store record');
check(!overview.setBigPicturePlaytimeField(a.doc, b.app, 'minutes_playtime_forever', 60) && b.app.minutes_playtime_forever === 10,
  'A matching shortcut AppID in another Document cannot authorize a foreign object');
check(!overview.setBigPicturePlaytimeField(a.doc, a.native, 'minutes_playtime_forever', 60), 'A frozen public Steam record receives no writes');
for (const key of ['installed', 'BIsShortcut', 'BIsModOrShortcut', 'controller_support', 'steam_deck_compat_category', 'appid']) {
  check(!overview.setBigPicturePlaytimeField(a.doc, a.app, key, 1), `Classification field ${key} is never projected`);
}
overview.setBigPicturePlaytimeField(b.doc, b.app, 'minutes_playtime_forever', 90);
overview.restoreBigPictureOverviewState(a.doc);
check(a.app.minutes_playtime_forever === 10 && b.app.minutes_playtime_forever === 90, 'Scoped teardown restores one Document and preserves another projection');
b.app.minutes_playtime_forever = 120; overview.restoreBigPictureOverviewState(b.doc);
check(b.app.minutes_playtime_forever === 120, 'A newer native value survives teardown');
overview.setBigPicturePlaytimeField(b.doc, b.app, 'minutes_playtime_forever', 130);
b.app.minutes_playtime_forever = 140;
overview.setBigPicturePlaytimeField(b.doc, b.app, 'minutes_playtime_forever', 150);
overview.restoreBigPictureOverviewState(b.doc);
check(b.app.minutes_playtime_forever === 140, 'Reprojection captures the latest native descriptor as its restoration baseline');
delete a.app.minutes_playtime_last_two_weeks;
overview.setBigPicturePlaytimeField(a.doc, a.app, 'minutes_playtime_last_two_weeks', 5); overview.restoreBigPictureOverviewState(a.doc);
check(!Object.hasOwn(a.app, 'minutes_playtime_last_two_weeks'), 'An originally absent playtime property is removed on cleanup');
Object.defineProperties(a.app, originalA); Object.defineProperties(b.app, originalB);
for (const [name, change] of [['Desktop', () => { a.view.gamepad = false; }], ['closed', () => { a.view.closed = true; }],
  ['replaced Document', () => { a.view.document = {}; }], ['detached body', () => { a.doc.body.isConnected = false; }]]) {
  change(); check(!overview.setBigPicturePlaytimeField(a.doc, a.app, 'minutes_playtime_forever', 70), `${name} cannot project playtime`);
  a.view.gamepad = true; a.view.closed = false; a.view.document = a.doc; a.doc.body.isConnected = true;
}
a.ownLabel.setAttribute('data-gdl-bp-playtime', 'native-prior');
for (let i = 0; i < 100; i++) overview.setBigPicturePlaytimeLabel(a.doc, a.ownLabel, 'Playtime: 60 minutes');
overview.setBigPicturePlaytimeLabel(a.doc, b.ownLabel, 'Foreign write');
check(b.ownLabel.textContent === 'No playtime', 'A label from another Document is rejected');
overview.restoreBigPictureOverviewState(a.doc);
check(a.ownLabel.textContent === 'No playtime' && a.ownLabel.getAttribute('data-gdl-bp-playtime') === 'native-prior', 'Repeated label writes restore the exact original text and marker');
overview.setBigPicturePlaytimeLabel(a.doc, a.ownLabel, 'Playtime: 60 minutes');
a.ownLabel.textContent = 'Steam updated'; a.ownLabel.setAttribute('data-gdl-bp-playtime', 'steam-new');
overview.restoreBigPictureOverviewState(a.doc);
check(a.ownLabel.textContent === 'Steam updated' && a.ownLabel.getAttribute('data-gdl-bp-playtime') === 'steam-new', 'Later native label and marker writes survive cleanup');
a.ownLabel.textContent = 'No playtime'; a.ownLabel.removeAttribute('data-gdl-bp-playtime');

const listeners = new Set(), protections = new Set(), callbacks = [], refreshes = [], disposed = [];
const fallback = new Map([[id, { minutesForever: 60, minutesLastTwoWeeks: 5, lastPlayedAt: 300 }]]);
let pendingFallback = null;
const scheduler = load('frontend/features/big-picture/rerender-scheduler.ts', {
  '../../steam/ui/SteamUIModeService': modes,
  '../library/native-route': { isPublicSteamLibraryRoute: doc => doc.route.includes('/app/550'), libraryRouteIdentity: doc => doc.route },
});
const runtime = load('frontend/features/big-picture/runtime.ts', {
  '../../api/backend': { backendLog() {} }, '../../steam/localization': { loc: (_key, text) => text, officialSteamText: text => text, steamIntlLocale: () => 'en-US' },
  '../../steam/gamepad/stores/AppStoreAdapter': adapters,
  '../playtime/service': { fetchPlaytimeStatsBatch: () => pendingFallback || Promise.resolve(fallback) },
  './details': { disposeBigPictureShortcutDetails: doc => disposed.push(doc), refreshBigPictureShortcutDetails: async doc => { refreshes.push(doc); } },
  './mapped-shortcuts-cache': { getBigPictureMappedShortcuts: () => [{ id, steamAppId: '550', title: 'Same title' }], invalidateBigPictureMappedShortcuts() {} },
  '../../core/preferences': { subscribePreferences: callback => { listeners.add(callback); callbacks.push(callback); return () => listeners.delete(callback); } },
  '../../steam/browser-protection': { installBrowserProtection: (_view, doc) => { protections.add(doc); return () => protections.delete(doc); } },
  './rerender-scheduler': scheduler, '../../steam/ui/SteamUIModeService': modes,
  '../../steam/library-details': { committedHeaderAppId: () => null },
  '../../steam/gamepad/GamepadContext': { normalizeGamepadAppId: normalize }, './overview-state': overview,
});
const frozenNativeBefore = Object.getOwnPropertyDescriptors(a.native), classificationBefore = Object.fromEntries(
  ['installed', 'BIsShortcut', 'BIsModOrShortcut', 'controller_support', 'steam_deck_compat_category'].map(key => [key, a.app[key]]));
for (let i = 0; i < 100; i++) runtime.mergeShortcutsIntoBigPictureLibrary(a.doc);
check(Object.entries(classificationBefore).every(([key, value]) => a.app[key] === value), 'Library priming never changes shared install/classification/controller/Deck fields');
assert.deepEqual(Object.getOwnPropertyDescriptors(a.native), frozenNativeBefore); checks++;
runtime.activateBigPicture(a.doc);
for (let i = 0; i < 100; i++) runtime.activateBigPicture(a.doc);
check(listeners.size === 1 && protections.size === 1, 'Repeated activation owns one preferences subscription and one protection lease');
await runtime.patchBigPictureHomePlaytime(a.doc);
check(a.app.minutes_playtime_forever === 60 && a.app.minutes_playtime_last_two_weeks === 5 && a.app.rt_last_time_played === 300, 'Production runtime projects measured canonical playtime and timestamps');
check(a.ownLabel.textContent.includes('1 hour') && a.publicLabel.textContent === 'No playtime' && a.siblingLabel.textContent === 'No playtime', 'Home labels require the exact shortcut card identity, excluding native games and sibling installations');
check(Object.entries(classificationBefore).every(([key, value]) => a.app[key] === value), 'Measured playtime never changes classification or installation');
const oldCallback = callbacks.at(-1);
runtime.activateBigPicture(b.doc);
check(a.app.minutes_playtime_forever === 10 && a.ownLabel.textContent === 'No playtime' && listeners.size === 1
  && !protections.has(a.doc) && protections.has(b.doc), 'Document replacement restores the retired overview and releases its subscriptions');
const refreshCount = refreshes.length; oldCallback(); await Promise.resolve();
check(refreshes.length === refreshCount, 'A queued preferences callback from a retired Document cannot refresh its successor');

// Native records can be replaced while backend session history is pending.
clock += 2000; let release;
pendingFallback = new Promise(resolve => { release = resolve; });
const pending = runtime.patchBigPictureHomePlaytime(b.doc);
const freshApp = { ...b.app, minutes_playtime_forever: 80, minutes_playtime_last_two_weeks: 7, rt_last_time_played: 400 };
b.records.set(id, freshApp); release(fallback); await pending; pendingFallback = null;
check(freshApp.minutes_playtime_forever === 80 && freshApp.minutes_playtime_last_two_weeks === 7 && freshApp.rt_last_time_played === 400,
  'A newer native overview wins over stale session history when an async read completes');
check(b.app.minutes_playtime_forever === 10, 'A replaced native record is never written through a stale captured reference');

runtime.activateBigPicture(a.doc); clock += 2000;
pendingFallback = new Promise(resolve => { release = resolve; });
const stale = runtime.patchBigPictureHomePlaytime(a.doc); runtime.activateBigPicture(b.doc); release(fallback); await stale; pendingFallback = null;
check(a.app.minutes_playtime_forever === 10 && a.ownLabel.textContent === 'No playtime', 'An async result cannot write after its owner Document retires');
const ownerCalls = [];
a.app.minutes_playtime_forever = 0;
a.view.SteamClient = { Apps: { GetPlaytime: async value => { ownerCalls.push(value); return { nPlaytimeForever: 35 }; } } };
runtime.activateBigPicture(a.doc); clock += 2000; await runtime.patchBigPictureHomePlaytime(a.doc);
check(ownerCalls.length === 2 && ownerCalls[0] === id && ownerCalls[1] === (id | 0) && foreignPlaytimeCalls === 0,
  'Native playtime reads use only the owner SteamClient and its exact unsigned/signed shortcut IDs');
check(a.app.minutes_playtime_forever === 60, 'Measured canonical session time merges with the owner native response');
runtime.deactivateBigPicture(); runtime.deactivateBigPicture();
check(listeners.size === 0 && protections.size === 0 && timers.size === 0 && !runtime.isBigPictureActive() && runtime.getBigPictureDocument() === null,
  'Repeated teardown releases preferences, protections, pending rerenders and active document state');
const afterStop = refreshes.length; for (const callback of callbacks) callback(); await Promise.resolve();
check(refreshes.length === afterStop, 'Released subscription callbacks remain inert after plugin teardown');
check(disposed.includes(a.doc) && disposed.includes(b.doc), 'Both replaced Document detail trees receive scoped disposal');
console.log(`BP overview ownership passed: ${checks} checks; actual stores, overview/runtime, two Documents, native updates and subscription cleanup. No live SDK/account calls.`);
