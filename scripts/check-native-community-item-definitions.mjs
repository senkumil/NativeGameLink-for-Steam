import './helpers/installed-steam-check.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const ui = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(ui, 'sp.js'), 'utf8'), { self: chunks });
for (const name of fs.readdirSync(path.join(ui, 'libraries')).filter(name => name.endsWith('.js'))) {
 const source = fs.readFileSync(path.join(ui, 'libraries', name), 'utf8');
 if (source.includes('compareStructural') && source.includes('enforceActions')) vm.runInNewContext(source, { self: chunks });
}
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const badge = Object.entries(factories).find(([, fn]) => ['m_mapCommunityItemDefs', 'GetCommunityItemDefinitions(', 'SteamIDBadgeInfo'].every(token => String(fn).includes(token)));
const mobxEntry = Object.entries(factories).find(([, fn]) => ['enforceActions', 'compareStructural', 'fireImmediately'].every(token => String(fn).includes(token)));
assert(badge && mobxEntry, 'Installed native definition store and MobX factories are required');
const exportGetters = (out, values) => { for (const [name, get] of Object.entries(values)) Object.defineProperty(out, name, { enumerable: true, get }); };
const mobxModule = { exports: {} };
mobxEntry[1](mobxModule, mobxModule.exports, { d: exportGetters });
const originalMobx = mobxModule.exports;
const reactionName = Object.keys(originalMobx).find(key => typeof originalMobx[key] === 'function' && ['compareStructural', 'fireImmediately'].every(token => String(originalMobx[key]).includes(token)));
assert(reactionName, 'Real native reaction is identified semantically');
let observers = 0;
const trackedReaction = (...args) => {
 const stop = originalMobx[reactionName](...args); observers++; let active = true;
 return () => { if (active) { active = false; observers--; stop(); } };
};
trackedReaction.toString = () => String(originalMobx[reactionName]);
const mobx = Object.fromEntries(Object.entries(originalMobx)); mobx[reactionName] = trackedReaction;
let now = 0, nextTimer = 0, discoveryScans = 0;
const timers = new Map(), requests = [], messages = [], caches = new WeakMap(), owners = new WeakMap();
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const advance = async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await tick(); };
const runtime = {
 getRuntimeIdentity: doc => owners.get(doc)?.identity || null,
 getModuleFactoryCount: () => 2,
 getModuleFactories: doc => { discoveryScans++; return owners.get(doc)?.discoveryMissing ? [] : [{ id: badge[0], factory: badge[1] }, { id: mobxEntry[0], factory: mobxEntry[1] }]; },
 getRequire: doc => owners.get(doc)?.req || null,
};
const api = {};
const compiled = ts.transpileModule(fs.readFileSync('frontend/steam/desktop/community-item-definitions.ts', 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(compiled, { exports: api, URL, Date: { now: () => now }, setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
 clearTimeout: id => timers.delete(id), require: name => name.endsWith('/SteamWebpackRuntime') ? { steamWebpackRuntime: runtime }
  : name.endsWith('/backend') ? { backendLog: message => messages.push(message) } : {} });
const identities = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/core/community-item-options.ts', 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: identities, URL, require: () => ({}) });

class View extends EventTarget {}
function owner() {
 const doc = { defaultView: new View() }, view = doc.defaultView; view.document = doc; view.closed = false;
 const cache = new Map(); caches.set(doc, cache);
 const deps = {
  89193: mobx, 6739: { TS: { LANGUAGE: 'spanish' } },
  98237: { w: { Init: () => { const body = { set_appid: appid => { body.appid = appid; }, set_language() {}, set_keyvalues_as_json() {} }; return { Body: () => body }; } } },
  87722: { B7: { ResolveURL() { throw Error('Badge account endpoint was not requested'); } } },
  1345: { R: 1 }, 23347: { g: { get() { throw Error('Badge account endpoint was not requested'); } } },
  17541: { O: { GetCachedDataForApp: async (appid, key) => cache.get(appid + ':' + key), SetCachedDataForApp: (appid, key, version, data) => cache.set(appid + ':' + key, data) } },
  98089: {}, 48371: {}, 6506: { RG: {}, uy: { GetCommunityItemDefinitions: (_transport, request) => new Promise((resolve, reject) => {
   requests.push({ appid: request.Body().appid, resolve: definitions => resolve({ GetEResult: () => 1, Body: () => ({ toObject: () => ({ item_definitions: definitions }) }) }), reject });
  }) } },
  90095: { q3: callback => callback() }, 5415: { Kp: { PerHour: 3600 } },
 };
 const req = id => Number(id) === Number(mobxEntry[0]) ? mobx : deps[id]; req.d = exportGetters;
 req.m = { [badge[0]]: badge[1], [mobxEntry[0]]: mobxEntry[1] };
 const native = { exports: {} };
 // The original factory installs its own badgeStore on its owner Window.
 vm.runInNewContext('(' + String(badge[1]) + ')(module,module.exports,req)', { module: native, req, window: view });
 const store = Object.values(native.exports).find(value => typeof value?.GetCommunityItemDefinitions === 'function');
 deps[badge[0]] = native.exports;
 assert(store); store.Init({ messageHandlers: { RegisterEMessageAction() {} }, GetServiceTransport: () => ({}) });
 owners.set(doc, { identity: {}, req });
 return { doc, view, cache, store };
}
const definitions = appid => [
 { appid, item_class: 1, active: true, item_key_values: JSON.stringify({ level_images: { 1: 'bronze.png', 2: 'silver.png', foil: 'foil.png' },
  level_names: { 1: { spanish: 'Bronce', english: 'Bronze' }, 2: { english: 'Silver' }, foil: { spanish: '', english: 'Foil' } } }) },
 ...[1, 2].map(index => ({ appid, item_class: 2, item_title: 'Card ' + index, active: true,
  item_image_composed: 'normal_' + index, item_image_composed_foil: 'foil_' + index, item_image_large: 'art_' + index + '.jpg' })),
 { appid, item_class: 2, active: false, item_image_composed: 'inactive' },
 { appid: appid + 1, item_class: 2, item_image_composed: 'other_app' },
 { appid, item_class: 1, item_key_values: 'bad JSON' },
];
const a = owner(), updates = [];
assert.equal(api.getImmediateNativeCommunityItemDefinitions(a.doc, '42', 'spanish'), null);
assert.equal(requests.length, 0, 'A passive read never starts any account or network request');
const stop = api.subscribeNativeCommunityItemDefinitions(a.doc, '42', value => updates.push(value), 'spanish');
a.cache.set('42:community_items', definitions(42));
let settled = false;
const work = api.loadNativeCommunityItemDefinitions(a.doc, '42', 'spanish').then(value => { settled = true; return value; });
const concurrent = api.loadNativeCommunityItemDefinitions(a.doc, '42', 'spanish');
await tick();
assert(settled, 'Native cached definitions resolve before the CM network response');
assert.equal(requests.length, 1, 'Concurrent loads share the one native definition fetch');
const result = await work;
assert.equal((await concurrent).foil_cards.length, 2);
assert.equal(result.cards.length, 2); assert.equal(result.foil_cards.length, 2); assert.equal(result.badges.length, 3);
assert.equal(result.cards_complete, true); assert.equal(result.badges_complete, true);
assert.equal(result.badges[0].title, 'Bronce'); assert.equal(result.badges[1].title, 'Silver'); assert.equal(result.foil_badge.title, 'Foil');
assert(result.cards[0].image.includes('/economy/image/normal_1'));
assert(result.foil_cards[0].image.includes('/economy/image/foil_1'));
assert(result.cards[0].artwork.endsWith('/42/art_1.jpg'));
assert(!('nOwned' in result.cards[0]), 'Definitions never claim card ownership');
const marketImage = result.cards[0].image.replace('community.cloudflare.steamstatic.com', 'steamcommunity-a.akamaihd.net') + '/100x100';
assert.equal(identities.communityCardId(result.cards[0]), identities.communityCardId({ image: marketImage }),
 'Native definitions and public Market thumbnails retain the same persisted selection identity');
requests[0].resolve(definitions(42).slice(0, 2)); await tick();
assert.equal(updates.at(-1).cards.length, 1, 'The real native map reaction delivers subsequent CM definitions');
a.store.m_mapCommunityItemDefs.set(42, []); await tick();
assert.equal(updates.at(-1).cards.length, 1, 'A later native pending-empty sentinel never erases definitions already delivered by CM');
stop(); assert.equal(observers, 0, 'Disposing the last subscriber releases the real MobX reaction');

const b = owner(); b.store.m_mapCommunityItemDefs.set(43, []);
assert.equal(api.getImmediateNativeCommunityItemDefinitions(b.doc, '43'), null, 'The native pending [] sentinel is not a confirmed empty catalogue');
let pendingDone = false;
const pending = api.loadNativeCommunityItemDefinitions(b.doc, '43').then(value => { pendingDone = true; return value; });
await tick(); assert(!pendingDone);
requests.at(-1).resolve([]); await tick();
assert.equal((await pending).cards_complete, true, 'A completed empty native definition response is distinguishable from pending');
assert.equal(observers, 0);
const c = owner(), firstRequest = requests.length;
const timed = api.loadNativeCommunityItemDefinitions(c.doc, '44'); await tick();
await advance(8_000); assert.equal(await timed, null); assert.equal(observers, 0); assert.equal(timers.size, 0);
const retried = api.loadNativeCommunityItemDefinitions(c.doc, '44'); await tick(); assert.equal(requests.length, firstRequest + 2, 'A timed out native request permits an explicit retry');
requests.at(-1).reject(Error('offline')); await tick(); assert.equal(await retried, null); assert.equal(observers, 0); assert.equal(timers.size, 0);
requests[firstRequest].resolve(definitions(44)); await tick();
assert.equal(api.getImmediateNativeCommunityItemDefinitions(c.doc, '44').cards.length, 2, 'A late native response remains available to future readers without retaining observers');

const d = owner(), dUpdates = [];
const dStop = api.subscribeNativeCommunityItemDefinitions(d.doc, '45', value => dUpdates.push(value));
const closing = api.loadNativeCommunityItemDefinitions(d.doc, '45'); await tick();
const late = requests.at(-1); d.view.dispatchEvent(new Event('pagehide'));
assert.equal(await closing, null); assert.equal(observers, 0); assert.equal(timers.size, 0);
late.resolve(definitions(45)); await tick(); assert.equal(dUpdates.length, 0, 'A closed document receives no late catalogue publication'); dStop();
assert.equal(api.getImmediateNativeCommunityItemDefinitions(d.doc, '45'), null, 'A pagehide owner cannot be resurrected by a late reader');
const e = owner(), eUpdates = [], eStop = api.subscribeNativeCommunityItemDefinitions(e.doc, '46', value => eUpdates.push(value));
const retired = api.loadNativeCommunityItemDefinitions(e.doc, '46'); await tick(); const oldRequest = requests.at(-1);
owners.get(e.doc).identity = {};
assert.equal(api.getImmediateNativeCommunityItemDefinitions(e.doc, '46'), null);
assert.equal(await retired, null); oldRequest.resolve(definitions(46)); await tick(); assert.equal(eUpdates.length, 0); eStop();
assert.equal(observers, 0); assert.equal(timers.size, 0);

const cold = owner(), coldRuntime = owners.get(cold.doc), coldRequire = coldRuntime.req;
delete cold.view.badgeStore; coldRuntime.req = null;
assert.equal(api.getImmediateNativeCommunityItemDefinitions(cold.doc, '47'), null);
coldRuntime.req = coldRequire;
const coldWork = api.loadNativeCommunityItemDefinitions(cold.doc, '47'); await tick();
assert.equal(requests.at(-1).appid, 47, 'A require/store initialized after the first read is rediscovered without a new Webpack factory count');
requests.at(-1).resolve(definitions(47)); await tick(); assert.equal((await coldWork).foil_cards.length, 2);
assert.equal(observers, 0); assert.equal(timers.size, 0);

const startup = owner(), startupRuntime = owners.get(startup.doc), startupRequire = startupRuntime.req, startupUpdates = [];
delete startup.view.badgeStore; startupRuntime.req = null;
const stopStartup = api.subscribeNativeCommunityItemDefinitions(startup.doc, '48', value => startupUpdates.push(value));
assert.equal(observers, 0, 'A startup subscriber can register before the store/reaction exists');
startupRuntime.req = startupRequire;
assert.equal(api.getImmediateNativeCommunityItemDefinitions(startup.doc, '48'), null);
assert.equal(observers, 1, 'A passive foreground read attaches the waiting startup observer once discovery succeeds');
const requestsBeforeStartupUpdate = requests.length;
startup.store.m_mapCommunityItemDefs.set(48, definitions(48)); await tick();
assert.equal(startupUpdates.at(-1).foil_cards.length, 2, 'The original listener receives later CM definitions without a manual retry/load');
assert.equal(requests.length, requestsBeforeStartupUpdate); stopStartup();assert.equal(observers, 0);

const missing = owner(), missingRuntime = owners.get(missing.doc);delete missing.view.badgeStore;missingRuntime.discoveryMissing = true;
const scansBeforeMissing = discoveryScans;
for(let read=0;read<100;read++)assert.equal(api.getImmediateNativeCommunityItemDefinitions(missing.doc, '49'), null);
assert.equal(discoveryScans, scansBeforeMissing + 1, 'One hundred immediate misses scan native factories only once');
await advance(1_000);api.getImmediateNativeCommunityItemDefinitions(missing.doc, '49');
assert.equal(discoveryScans, scansBeforeMissing + 2, 'A later foreground read retries failed discovery after the bounded negative cache');
missingRuntime.discoveryMissing = false;missing.view.badgeStore = missing.store;missing.store.m_mapCommunityItemDefs.set(49, definitions(49));
assert.equal(api.getImmediateNativeCommunityItemDefinitions(missing.doc, '49').foil_cards.length, 2,
 'An initialized global store bypasses a recent discovery miss immediately');

let cachedCatalogues = 0, matchedAccountCards = 0;
const userdata = path.resolve(ui, '../userdata');
if (fs.existsSync(userdata)) for (const account of fs.readdirSync(userdata).filter(name => /^\d+$/.test(name))) {
 const folder = path.join(userdata, account, 'config/librarycache'); if (!fs.existsSync(folder)) continue;
 for (const name of fs.readdirSync(folder).filter(name => /^\d+\.json$/.test(name))) {
  let rows; try { rows = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')); } catch { continue; }
  const native = Array.isArray(rows) ? rows.find(row => row[0] === 'community_items')?.[1]?.data : null;
  if (!Array.isArray(native)) continue;
  const appid = Number(name.slice(0, -5)), catalog = api.communityItemDefinitionsCatalog(appid, native, 'spanish');
  const active = native.filter(item => item && item.active !== false && !item.deleted && Number(item.appid) === appid);
  const expected = new Set(active.filter(item => Number(item.item_class) === 2 && item.item_image_composed).map(item => item.item_image_composed));
  const expectedFoil = new Set(active.filter(item => Number(item.item_class) === 2 && item.item_image_composed_foil).map(item => item.item_image_composed_foil));
  assert.equal(catalog.cards.length, expected.size); assert.equal(catalog.foil_cards.length, expectedFoil.size);
  const cardIds = new Set([...catalog.cards, ...catalog.foil_cards].map(identities.communityCardId));
  const accountCards = rows.find(row => row[0] === 'badge')?.[1]?.data?.rgCards || [];
  for (const card of accountCards.filter(card => card.strImgURL)) {
   assert(cardIds.has(identities.communityCardId({ image: card.strImgURL,
    foil: /\(\s*foil\s*\)\s*$/i.test(String(card.strMarketHash || '')) })),
   'The new SDK catalogue preserves the real Steam account card selection IDs');
   matchedAccountCards++;
  }
  for (const item of active.filter(item => Number(item.item_class) === 1)) {
   let levels; try { levels = JSON.parse(item.item_key_values).level_images; } catch { continue; }
   if (levels?.foil) assert(catalog.foil_badge, 'Real cached foil badge definitions must remain selectable');
  }
  cachedCatalogues++;
 }
}
console.log('Native community definitions passed: original Steam store + MobX, cache-before-CM, both borders/all badges, stable Market/account IDs, dedup, empty sentinel, deadlines/retry, disposal/runtime fences; ' + cachedCatalogues + ' real cached catalogues and ' + matchedAccountCards + ' account card IDs verified read-only.');
