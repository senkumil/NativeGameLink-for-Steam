import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { runLuaCheck } from './helpers/lua-runtime.mjs';

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const source = compile('frontend/features/library/community-items.ts');
const identities = new WeakMap(), runtimes = new WeakMap();
const runtime = {
  getRuntimeIdentity: doc => identities.get(doc) || null,
  getRequire: doc => runtimes.get(doc)?.require || null,
  getModuleFactoryCount: doc => runtimes.get(doc)?.factories.length || 0,
  getModuleFactories: doc => runtimes.get(doc)?.factories || [],
};
const runtimeCache = {};
vm.runInNewContext(compile('frontend/steam/gamepad/runtime-cache.ts'), {
  exports: runtimeCache, require: () => ({ steamWebpackRuntime: runtime }),
});
class RequestCache {
  values = new Map();
  get(key, load) {
    if (!this.values.has(key)) this.values.set(key, load());
    return this.values.get(key);
  }
}
let backendCatalog = {cards:[]};
const exports = {};
vm.runInNewContext(source, { exports, URL, setTimeout, clearTimeout,
  window: { badgeStore: { GetBadgeData() { throw Error('Unrelated global window was read'); } } },
  require: name => name.endsWith('/runtime-cache') ? runtimeCache
    : name.endsWith('/SteamWebpackRuntime') ? { steamWebpackRuntime: runtime }
    : name.endsWith('/request-cache') ? { RetryingRequestCache: RequestCache }
    : name.endsWith('/cache') ? { CACHE_TTL: {}, CACHE_RETENTION: {}, cacheRead: () => null, cacheSet() {}, cacheDeleteMatching() {} }
    : name.endsWith('/backend') ? { backendLog() {}, fetchCommunityItemsCatalogBackend: async () => backendCatalog, parseCommunityItemsCatalogResponse: x => x }
    : {},
});
const card = (title, foil, image = title) => ({ title, foil, image });
const native = [card('Translated native name', false, 'native-normal')];
const publicCards = [card('Public name', false), card('Public name (Foil)', true)];
assert.equal(exports.mergeCommunityCards(native, publicCards).length, 1);
assert.equal(exports.mergeCommunityCards(native, publicCards)[0], native[0],
  'The exact native set and its order are authoritative, regardless of public names');
const nativeFoil = [card('Native foil', true)];
assert.equal(exports.mergeCommunityCards(nativeFoil, publicCards)[0], nativeFoil[0],
  'A foil legitimately supplied by Steam is never removed');
const fallback = exports.mergeCommunityCards([], [...publicCards, card(' public NAME ', false, 'cdn-alias')]);
assert.equal(fallback.length, 1, 'A public fallback selects one border and deduplicates that set');
assert.equal(fallback[0].foil, false);
const onlyFoil = exports.mergeCommunityCards([], [publicCards[1]]);
assert.equal(onlyFoil.length, 1, 'Foil-only catalogue data remains available');
assert.equal(onlyFoil[0].foil, true);
assert.equal(native.length, 1, 'Set selection does not mutate native account data');

let definitionReads = 0;
const makeStore = (title, foil = false) => ({
  GetBadgeData: () => ({ rgCards: [{ strTitle: title, strImgURL: `https://community.cloudflare.steamstatic.com/economy/image/${title}`,
    strMarketHash: foil ? `${title} (Foil)` : title }] }),
  GetCommunityItemDefinitions() { definitionReads++; },
});
const makeDocument = store => {
  const doc = { defaultView: { closed: false, badgeStore: store, addEventListener() {}, removeEventListener() {} } };
  doc.defaultView.document = doc;
  identities.set(doc, {});
  return doc;
};
const docA = makeDocument(makeStore('CEF-A')), docB = makeDocument(makeStore('CEF-B', true));
const a = await exports.getOfficialCommunityItems(docA, '1', 'english');
const b = await exports.getOfficialCommunityItems(docB, '1', 'english');
assert.equal(a.cards[0].title, 'CEF-A');
assert.equal(b.cards[0].title, 'CEF-B', 'Same AppID requests in another CEF use that document’s store and request cache');
assert.equal(b.cards[0].foil, true, 'Normalization preserves the owner store’s foil identity');
const docC = makeDocument(null), storeC = makeStore('CEF-C');
function badgeFactory() { return 'm_mapBadgeData GetBadgeData( SteamIDBadgeInfo'; }
const requireC = () => ({ x_: storeC });
requireC.m = { 17: badgeFactory };
runtimes.set(docC, { require: requireC, factories: [{ id: '17', factory: badgeFactory }] });
const c = await exports.getOfficialCommunityItems(docC, '1', 'english');
assert.equal(c.cards[0].title, 'CEF-C', 'Unpublished window stores are resolved through the owner document’s factory');
assert.equal(definitionReads, 0, 'Reading badge cards does not fetch unrelated CommunityItemDefinitions');
docA.defaultView.badgeStore = makeStore('CEF-A-new-runtime');
identities.set(docA, {});
assert.equal((await exports.getOfficialCommunityItems(docA, '1', 'english')).cards[0].title, 'CEF-A-new-runtime',
  'Runtime replacement retires realm-bound store and request snapshots');
const repeatedIcon = 'https://community.cloudflare.steamstatic.com/economy/image/shared-icon';
const nativeVariants = [{ strTitle: 'A', strImgURL: repeatedIcon },
  { strTitle: 'A', strImgURL: repeatedIcon, bFoil: true },
  { strTitle: 'B', strImgURL: repeatedIcon }];
const docD = makeDocument({ GetBadgeData: () => ({ rgCards: [...nativeVariants, nativeVariants[0]] }) });
const d = await exports.getOfficialCommunityItems(docD, '1', 'english');
assert.equal(d.cards.length, 3, 'Normalization retains distinct native titles and borders even if their icon URLs coincide');
assert.equal(d.cards[1].foil, true);

backendCatalog={cards:[
 {title:'Normal',image:'https://community.cloudflare.steamstatic.com/economy/image/normal'},
 {title:'Normal (Foil)',image:'https://community.cloudflare.steamstatic.com/economy/image/foil',foil:true},
]};
const fullDoc = makeDocument(makeStore('Native normal'));
const enriched = new Promise(resolve => { const stop = exports.subscribeOfficialCommunityItems(fullDoc,'2',value=>{ if(value.foil_cards?.length){stop();resolve(value);} },'english'); });
await exports.getOfficialCommunityItems(fullDoc,'2','english');
const full = await enriched;
assert.equal(full.cards.length,1,'Default native list remains a single authoritative set');
assert.equal(full.foil_cards.length,1,'Foil definitions stay separately available to the local selection controls');
assert.equal(full.foil_cards[0].foil,true);

runLuaCheck({ community: 'backend/lib/community.lua', lru: 'backend/lib/lru_cache.lua' }, String.raw`
local last_market_url, market_calls, badge_calls = nil, 0, 0
local badge_status = 404
local response = {results={
  {asset_description={type='Cromo coleccionable',name='A',market_hash_name='1-A',icon_url='normal',
    tags={{category='cardborder',internal_name='cardborder_0'}}}},
  {asset_description={type='Cromo reflectante',name='A reflectante',market_hash_name='1-A reflectante',icon_url='silver',
    tags={{category='cardborder',internal_name='cardborder_1'}}}},
}}
local api = factories.community({logger={info=function()end}, lru_cache=factories.lru({}),
  util={url_encode=function(s)return s end, html_unescape=function(s)return s end,
    normalize_appid_and_language=function(id,lang)return id,lang end},
  cjson={encode=function(data)return data end,decode=function()return response end},
  http={get=function(url)
    if url:find('/market/',1,true) then market_calls=market_calls+1;last_market_url=url;return {status=200,body='market'} end
    badge_calls=badge_calls+1;return {status=badge_status,body='badges'}
  end},
})
local result = api.fetch_community_items_catalog('1','spanish')
assert(#result.cards==2,'The public asset catalogue retains both border definitions')
assert(result.cards[1].foil==false and result.cards[2].foil==true,
  'Language-independent cardborder tags identify a localized foil card')
assert(not last_market_url:find('tag_cardborder_0',1,true),'The asset request must not discard foil definitions')
assert(market_calls==1 and badge_calls==1,'Legacy all mode remains compatible')
local cards=api.fetch_community_items_catalog('2','spanish','cards')
assert(#cards.cards==2 and cards.transient_error==false)
assert(market_calls==2 and badge_calls==1,'The cards reply never queries the badge index')
api.fetch_community_items_catalog('2','spanish','cards')
assert(market_calls==2,'Card part has its own success cache')
local badges=api.fetch_community_items_catalog('2','spanish','badges')
assert(#badges.cards==0 and badges.transient_error==false)
assert(market_calls==2 and badge_calls==2,'Badge enrichment never repeats the Market request')
badge_status=503
assert(api.fetch_community_items_catalog('3','spanish','cards').transient_error==false)
assert(api.fetch_community_items_catalog('3','spanish','badges').transient_error==true)
local calls=market_calls
assert(api.fetch_community_items_catalog('3','spanish','cards').transient_error==false and market_calls==calls,
 'A failed badge index cannot invalidate successful card part cache')
assert(api.fetch_community_items_catalog('3','spanish','invalid').error=='invalid_catalog_part')
response={success=false,results={}}
assert(api.fetch_community_items_catalog('4','spanish','cards').transient_error==true,
 'An HTTP200 Market failure must not be cached as a confirmed empty collection')
response={success=true,start=0,total_count=12,pagesize=10,results={}}
for i=1,10 do table.insert(response.results,{asset_description={type='Trading Card',name='Card '..i,market_hash_name='5-Card '..i,icon_url='icon'..i}}) end
local page=api.fetch_community_items_catalog('5','spanish','cards',0)
assert(#page.cards==10 and page.next_start==10 and page.total_count==12,
 'A server-imposed ten-row page exposes a continuation instead of truncating the set')
response={success=true,start=10,total_count=12,pagesize=10,results={
 {asset_description={type='Trading Card',name='Card 11',market_hash_name='5-Card 11',icon_url='icon11'}},
 {asset_description={type='Trading Card',name='Card 12',market_hash_name='5-Card 12 (Foil)',icon_url='icon12'}},
}}
local last=api.fetch_community_items_catalog('5','spanish','cards',10)
assert(#last.cards==2 and last.next_start==nil and last.cards[2].foil==true)
assert(last_market_url:find('start=10&',1,true),'Continuation requests use the actual cursor')
local page_calls=market_calls
assert(#api.fetch_community_items_catalog('5','spanish','cards',0).cards==10 and market_calls==page_calls,
 'Independent page caches never replace another cursor')
response.start=0
assert(api.fetch_community_items_catalog('6','spanish','cards',10).transient_error==true,
 'A server ignoring the requested cursor is rejected as retryable')
assert(api.fetch_community_items_catalog('6','spanish','cards',513).error=='invalid_catalog_start')
badge_status=200
local unrecognized=api.fetch_community_items_catalog('7','spanish','badges')
assert(unrecognized.transient_error==true and unrecognized.badges_complete==false,
 'An HTTP200 challenge/unknown HTML page is not a confirmed empty badge catalogue')
assert(cards.cards_complete==true and cards.badges_complete==false and badges.badges_complete==true,
 'Each independent catalogue part explicitly declares only its own completeness')
assert(page.cards_complete==false and last.cards_complete==true,
 'A paginated Market catalogue is complete only after the final page')
`);
// The preview must use the badge belonging to the displayed border. Public
// definitions can arrive out of order and contain both collections together.
const settingsModel = {}, presentationModel = {};
vm.runInNewContext(compile('frontend/core/community-item-options.ts'), { exports: settingsModel, URL, require: () => ({}) });
vm.runInNewContext(compile('frontend/features/library/linked-card-presentation.ts'), {
  exports: presentationModel, require: () => settingsModel,
});
const imageFor = name => `https://community.steamstatic.com/economy/image/${name}`;
const normalBadge = level => ({ level, title: `Normal level ${level}`, image: imageFor(`badge-${level}`) });
const foilBadge = { level: 1, foil: true, title: 'Foil badge', image: imageFor('foil-badge') };
const mixed = { cards: [{ title: 'Normal', image: imageFor('normal') }],
  foil_cards: [{ title: 'Foil', foil: true, image: imageFor('foil') }],
  badges: [normalBadge(5), foilBadge, normalBadge(1)], foil_badge: foilBadge };
const steamMode = { enabled: false, card_border: 'normal', card_ids: [], badge_id: null };
const preview = presentationModel.linkedCardPresentation(mixed, steamMode);
assert.equal(preview.cards.length, 1);
assert.equal(preview.cards[0].foil, undefined);
assert.equal(preview.badge.level, 5, 'The normal preview picks its highest normal badge even if the catalogue is unordered');
assert.equal(preview.badge.foil, undefined, 'A normal card preview never claims the foil badge');
assert.equal(preview.xp, 500, 'Displayed badge XP corresponds to its earned level');
assert.equal(preview.maxed, true);
const foilPreview = presentationModel.linkedCardPresentation({ ...mixed, cards: [] }, steamMode);
assert.equal(foilPreview.foil, true, 'A foil-only catalogue keeps its available collection');
assert.equal(foilPreview.badge, foilBadge);
assert.equal(foilPreview.xp, 100);
assert.equal(foilPreview.maxed, true);
const unearned = presentationModel.linkedCardPresentation(mixed, { enabled: true, card_border: 'normal', card_ids: [], badge_id: null });
assert.equal(unearned.badge, undefined, 'An unearned preview does not claim a selected badge');
assert.equal(unearned.xp, 0);
assert.equal(unearned.nextBadge.level, 1);
assert.equal(unearned.nextLevelXP, 100, 'The empty-circle caption describes the future badge XP separately from earned XP');
assert.equal(unearned.remaining, 1);
const automatic = { enabled: true, card_border: 'foil', card_ids: [], badge_id: null, auto_foil: true };
const preset = presentationModel.linkedCardPresentation(mixed, automatic);
assert.equal(preset.foil, true);
assert.equal(preset.cards.length, 1);
assert.equal(preset.cards[0].owned, true, 'The default unlocks every foil card without persisting catalogue-dependent IDs');
assert.equal(preset.badge, foilBadge, 'The default unlocks the foil badge too');
assert.equal(preset.maxed, true);
assert.equal(preset.remaining, 0);
assert.equal(presentationModel.linkedCardPresentation(mixed).badge, foilBadge, 'An unconfigured preview uses the same automatic foil policy');
const partial = presentationModel.linkedCardPresentation({ cards: mixed.cards, badges: [normalBadge(1)], cards_complete: false }, automatic);
assert.equal(partial.foil, true, 'A partial normal catalogue never changes the preferred foil border');
assert.equal(partial.cards.length, 0);
assert.equal(partial.badge, undefined, 'The preset never substitutes a normal badge while foil definitions are pending');
const badgeBeforeCards = presentationModel.linkedCardPresentation({ cards: mixed.cards, badges: [foilBadge], cards_complete: true, badges_complete: true }, automatic);
assert.equal(badgeBeforeCards.foil, true, 'A known foil badge keeps the foil collection while its card definitions arrive');
assert.equal(badgeBeforeCards.badge, foilBadge);
const noFoil = presentationModel.linkedCardPresentation({ cards: mixed.cards, badges: [normalBadge(1)], cards_complete: true, badges_complete: true }, automatic);
assert.equal(noFoil.foil, false, 'Only a complete catalogue with no foil objects can fall back to its available normal collection');
assert.equal(noFoil.cards[0].owned, true);
assert.equal(automatic.auto_foil, true, 'Presentation never mutates or materializes the persisted preset');
console.log('Community card sets passed: native set authority, foil preservation, badge/XP consistency, public border selection, deduplication, localized Market tags and CEF store/request isolation.');
