import './helpers/installed-steam-check.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;
const sources = { cards: compile('frontend/features/big-picture/NativeBigPictureTradingCards.tsx'),
  'linked-card-presentation': compile('frontend/features/library/linked-card-presentation.ts') };
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync((process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') + '/sp.js', 'utf8'), { self: chunks });
const factory = Object.values(Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1])))
  .find(value => ['CardWrapper:', 'TradingCardCarouselItem:', 'EmptyCircle:', 'BadgeName:'].every(token => String(value).includes(token)));
if (!factory) throw Error('Installed card CSS classes are required');
const cssModule = { exports: {} }; factory(cssModule); sources.nativeCardCSS = 'exports.classes=' + JSON.stringify(cssModule.exports) + ';';
const installedCards = Object.values(Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1])))
  .find(value => ['AppDetails_SectionTitle_TradingCards', 'nOwned', 'strMarketHash', 'data-carousel'].every(token => String(value).includes(token)));
if (!installedCards || !String(installedCards).includes('animateHover:!1')) throw Error('Installed Big Picture cards must use the non-tilting carousel presentation');
const translations = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync((process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') + '/localization/steamui_spanish-json.js', 'utf8'), { self: translations });
const translationModule = { exports: {} }; Object.values(translations.webpackChunksteamui[0][1])[0](translationModule);
sources.nativeCardText = 'exports.tokens=' + JSON.stringify(Object.fromEntries(Object.entries(translationModule.exports)
  .filter(([key]) => key.startsWith('AppDetails_TradingCards') || ['AppDetails_ViewBadgePage', 'AppDetails_BadgeLevel', 'AppDetails_UnearnedBadgeXP'].includes(key)))) + ';';

await runBPBrowserScenario(sources, async fixture => {
  const { React, ReactDOM, dom, dependencies, root, load, frame, check, nativeRequire } = fixture;
  document.body.classList.add('BasicUI');
  const errors = [], oldError = console.error; console.error = (...values) => errors.push(values.map(String).join(' '));
  const nativeText = load('nativeCardText').tokens, originalLoc = dependencies['../../steam/localization'].loc;
  dependencies['../../steam/localization'].loc = (key, fallback) => nativeText[key] || originalLoc(key, fallback);
  let badge = {}, active = true, reads = [], opened = [], badgeOpens = 0; const badgeBorders = [];
  function readBadge(appid) { React.useState(0); const GetBadgeData = () => { reads.push(appid); return badge; }; return GetBadgeData(); }
  function badgeFactory() { return 'm_mapBadgeData GetBadgeData( strNextLevelName GetCommunityItemDefinitions( H_:'; }
  const req = id => Number(id) === 700001 ? { H_: readBadge } : nativeRequire(id); req.m = { 700001: badgeFactory };
  Object.assign(dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime, { getRequire: () => req,
    getModuleFactoryCount: () => 1, getModuleFactories: () => [{ id: 700001, factory: badgeFactory }] });
  const settings = new Map(), optionListeners = new Map(), optionLoads = [], catalogListeners = new Set();
  let delayedOptions = false, publicCatalog = null, delayedCatalog = false, immediateUnavailable = false; const catalogLoads = [];
  const cardId = card => 'card:' + Boolean(card.foil) + ':' + card.image;
  const badgeId = item => 'badge:' + Boolean(item.foil) + ':' + Number(item.level || 0) + ':' + item.image;
  const defaults = () => ({ enabled: true, card_border: 'foil', card_ids: [], badge_id: null, auto_foil: true });
  const steamData = () => ({ enabled: false, card_border: 'normal', card_ids: [], badge_id: null });
  settings.set('1001:550', steamData()); settings.set('1002:550', steamData());
  const optionsApi = {
    communityCardId: cardId, communityBadgeId: badgeId,
    getCachedCommunityItemOptions: (_doc, shortcut, appid) => settings.get(shortcut + ':' + appid) || null,
    getCommunityItemOptions: (_doc, shortcut, appid) => delayedOptions ? new Promise((resolve, reject) => optionLoads.push({ shortcut, appid, resolve, reject })) : Promise.resolve(settings.get(shortcut + ':' + appid) || defaults()),
    subscribeCommunityItemOptions: (_doc, shortcut, appid, listener) => {
      const key = shortcut + ':' + appid; let set = optionListeners.get(key); if (!set) optionListeners.set(key, set = new Set());
      set.add(listener); return () => { set.delete(listener); if (!set.size) optionListeners.delete(key); };
    },
  };
  dependencies['../../core/community-item-options'] = optionsApi;
  dependencies['../library/linked-card-presentation'] = load('linked-card-presentation');
  dependencies['../../api/backend'] = { backendLog() {} };
  dependencies['../library/community-items'] = {
    normalizeCommunityAssetUrl: value => String(value || '').replace('/100x100', ''),
    getImmediateOfficialCommunityItems: () => immediateUnavailable ? null : publicCatalog,
    getOfficialCommunityItems: () => delayedCatalog ? new Promise(resolve => catalogLoads.push(resolve)) : Promise.resolve(publicCatalog),
    subscribeOfficialCommunityItems: (_doc, _appid, listener) => { catalogListeners.add(listener); return () => catalogListeners.delete(listener); },
  };
  const publishOptions = (shortcut, value) => {
    const key = shortcut + ':550'; settings.set(key, value); for (const listener of optionListeners.get(key) || []) listener(value);
  };
  const publishCatalog = value => { publicCatalog = value; for (const listener of catalogListeners) listener(value); };
  const Provider = load('document-primitives').BigPictureUIProvider, css = load('nativeCardCSS').classes, mod = load('cards');
  const Section = props => React.createElement('section', null, React.createElement('h2', null, props.label), props.highlight, props.children);
  const Strip = props => React.createElement('div', { 'data-card-row': props.name, style: { display: 'flex', overflowX: 'auto' } }, props.children);
  const catalog = { cards_complete: true, badges_complete: true,
    cards: Array.from({ length: 23 }, (_, i) => ({ title: 'Card ' + i, image: 'https://cards.test/' + i + '.png', artwork: 'https://cards.test/art-' + i + '.png' })),
    foil_cards: [{ title: 'Foil A', image: 'https://cards.test/foil-a.png', foil: true }, { title: 'Foil B', image: 'https://cards.test/foil-b.png', foil: true }],
    badges: [{ title: 'First badge', image: 'https://cards.test/first.png', level: 1 }, { title: 'Max badge', image: 'https://cards.test/max.png', level: 5 }],
    foil_badge: { title: 'Foil badge', image: 'https://cards.test/foil-badge.png', foil: true, level: 0 } };
  publicCatalog = catalog;
  const rendered = ReactDOM.createRoot(root);
  const props = { document, steamAppId: '550', shortcutAppId: '1001', catalog, hydrating: false, classes: { TradingCard: css }, Section, Strip,
    isCurrent: () => active, onOpenCard: card => opened.push(card.title), onOpenBadge: foil => { badgeOpens++; badgeBorders.push(foil); } };
  const render = extra => {
    if (extra && Object.hasOwn(extra, 'catalog')) publicCatalog = extra.catalog;
    dom.flushSync(() => rendered.render(React.createElement(Provider, { document }, React.createElement(mod.NativeBigPictureTradingCards, { ...props, ...extra }))));
  };
  const tiles = () => [...root.querySelectorAll('.gdl-bp-trading-card')], count = state => root.querySelectorAll('[data-gdl-card-ownership="' + state + '"]').length;
  render();
  check(root.querySelector('.' + css.Card)?.classList.contains(css.Loading), 'Images start in the installed Loading state before network completion');
  await frame();
  check(reads.length > 0 && reads.every(id => id === 550), 'Account inventory remains a read-only exact-AppID source: ' + errors.join('\n') + ' DOM: ' + root.textContent);
  check(tiles().length === 23 && count('unknown') === 23, 'Restored HTML/CSS shows the full normal catalogue without inventing ownership');
  check(!root.querySelector('[data-gdl-bp-native-cards]') && !root.querySelector('img[src$="foil-a.png"]'), 'The custom section uses one border and no native presentation factory');
  check(root.querySelector('.' + css.EmptyCircle) && !root.querySelector('.' + css.CardsLeft), 'Unknown account data has a neutral badge and no invented remaining/XP');
  check(tiles().every(tile => Math.abs(tile.querySelector('.' + css.CardWrapper).getBoundingClientRect().width - 100) < 1), 'Restored catalogue CSS keeps 100px card sizing');
  check(tiles().every(tile => tile.getAttribute('role') === 'listitem' && document.getElementById(tile.getAttribute('aria-labelledby'))?.textContent),
    'Every focusable card has the native list-item role and a stable accessible title');
  check(!root.querySelector('.' + css.AnimateHover), 'Big Picture keeps the native non-tilting carousel instead of borrowing desktop mouse effects');
  const firstImage = tiles()[0].querySelector('img'), firstCard = tiles()[0].querySelector('.' + css.Card);
  dom.flushSync(() => firstImage.dispatchEvent(new Event('load')));
  check(firstCard.classList.contains(css.Loaded) && firstImage.style.visibility !== 'hidden', 'Successful image loading switches to the actual Loaded presentation');
  const beforeImageFailure = tiles()[0].getBoundingClientRect();
  dom.flushSync(() => firstImage.dispatchEvent(new Event('error')));
  check(firstCard.classList.contains(css.LoadFailed) && firstImage.style.visibility === 'hidden'
    && getComputedStyle(tiles()[0].querySelector('.' + css.Title)).display !== 'none', 'A failed CDN image retains the card and displays its native fallback title');
  check(Math.abs(tiles()[0].getBoundingClientRect().height - beforeImageFailure.height) < .5, 'Image failure never collapses or resizes the card slot');
  dom.flushSync(() => firstImage.dispatchEvent(new Event('load')));
  check(firstCard.classList.contains(css.Loaded) && !tiles()[0].querySelector('.' + css.Title).classList.contains(css.LoadFailed), 'A recovered image clears the failed title state');
  tiles()[0].click(); check(opened.at(-1) === 'Card 0', 'Catalogue artwork action remains enabled');
  const firstTile = tiles()[0], firstSection = root.querySelector('section');
  dom.flushSync(() => publishCatalog({ ...catalog, badges: [...catalog.badges, { title: 'Late badge', image: 'https://cards.test/late.png', level: 2 }] })); await frame();
  check(tiles()[0] === firstTile && root.querySelector('section') === firstSection, 'Background catalogue enrichment preserves the mounted CSS section and card DOM');
  dom.flushSync(() => publishCatalog({ ...catalog, cards: [{ title: 'Earlier card', image: 'https://cards.test/earlier.png' }, ...catalog.cards] })); await frame();
  check(tiles()[1] === firstTile, 'New definitions inserted before an existing card preserve its DOM and image state');
  dom.flushSync(() => publishCatalog(catalog)); await frame();
  root.querySelector('button').click(); check(badgeOpens === 1, 'The restored badge navigation action stays enabled');
  check(badgeBorders.at(-1) === false, 'Saved Steam/normal mode keeps the ordinary badge-page route');
  check(root.querySelector('button').textContent === nativeText.AppDetails_ViewBadgePage, 'Badge navigation uses Steam current localized action label');
  badge = { rgCards: [] }; render(); await frame(); check(tiles().length === 23, 'An empty account set cannot hide the linked catalogue');
  badge = { nLevel: 0, nNextLevelXP: 100, strNextLevelName: 'Real next badge', rgCards: [{ strTitle: 'Real card', strImgURL: catalog.cards[0].image, nOwned: 0 }] };
  render(); await frame(); check(root.textContent.includes('Real next badge') && root.textContent.includes(nativeText.AppDetails_UnearnedBadgeXP.replace('%1$s', '100')),
    'An unearned real account badge preserves Steam next-level name and XP');
  badge = { nLevel: 1, nXP: 125, strName: 'Actual badge', strIconURL: 'https://cards.test/earned.png', bMaxed: false,
    rgCards: Array.from({ length: 9 }, (_, i) => ({ strTitle: 'Actual ' + i, strImgURL: catalog.cards[i].image + (i === 0 ? '/100x100' : ''), nOwned: i < 5 ? 1 : 0 })) };
  render(); await frame();
  check(count('owned') === 5 && count('unowned') === 4 && root.querySelectorAll('[data-card-row]').length === 2, 'Custom CSS preserves real owned/missing partitions');
  check(Math.abs(root.querySelector('[data-gdl-card-ownership="unowned"] .' + css.CardWrapper).getBoundingClientRect().width - 85) < 1
    && root.querySelector('[data-gdl-card-ownership="unowned"] img').style.filter.includes('0.1'), 'Missing cards retain 85px size and dim saturation');
  check(root.textContent.includes('Actual badge') && root.querySelector('img[src$="earned.png"]'), 'Real account badge metadata remains authoritative outside simulation');
  check(root.querySelector('.' + css.CardsLeft).textContent === nativeText.AppDetails_TradingCardsLeft_Plural.replace('%1$s', '4'), 'Remaining cards use Steam current plural token');
  root.querySelector('img[data-gdl-badge-preview]').click(); check(badgeOpens === 2, 'Earned badge artwork opens its page like the native header');
  const beforeMissing = opened.length; root.querySelector('[data-gdl-card-ownership="unowned"]').click(); check(opened.length === beforeMissing, 'Missing cards do not activate owned artwork');
  const localNormal = { enabled: true, card_border: 'normal', card_ids: [cardId(catalog.cards[0]), cardId(catalog.cards[1])], badge_id: badgeId(catalog.badges[0]) };
  dom.flushSync(() => publishOptions('1001', localNormal)); await frame();
  check(count('owned') === 2 && count('unowned') === 21 && root.textContent.includes('First badge'), 'Properties selection controls local cards and badge without account mutation');
  check(!root.querySelector('img[src$="earned.png"]'), 'Local selection replaces only this linked preview');
  const localFoil = { enabled: true, card_border: 'foil', card_ids: [cardId(catalog.foil_cards[0])], badge_id: null };
  dom.flushSync(() => publishOptions('1001', localFoil)); await frame();
  check(tiles().length === 2 && count('owned') === 1 && count('unowned') === 1 && root.querySelector('img[src$="foil-a.png"]'), 'Foil selection shows one silver-border set with exact selected ownership');
  check(root.querySelector('.' + css.CardsLeft).textContent === nativeText.AppDetails_TradingCardsLeft, 'A single missing card uses the native singular token');
  check(root.textContent.includes('Foil badge') && root.querySelector('.' + css.BadgeLevel).textContent === nativeText.AppDetails_UnearnedBadgeXP.replace('%1$s', '100')
    && root.querySelector('.' + css.EmptyCircle) && !root.querySelector('img[data-gdl-badge-preview]'),
    'An unearned local badge shows a neutral circle and the native future name/XP without claiming an earned level');
  dom.flushSync(() => publishOptions('1001', { ...localFoil, badge_id: badgeId(catalog.foil_badge) })); await frame();
  check(count('owned') === 2 && count('unowned') === 0 && root.textContent.includes('Foil badge'), 'A selected foil maximum badge completes its local set');
  root.querySelector('button').click(); check(badgeBorders.at(-1) === true, 'An explicit foil selection requests the silver-border badge-page route');
  check(root.querySelector('.' + css.CardsLeft).textContent === nativeText.AppDetails_TradingCardsMaxed, 'A maximum badge uses Steam current completion wording');
  const hydratedFoilTile = tiles()[0], hydratedFoilSection = root.querySelector('section');
  immediateUnavailable = true;
  render({ catalog: { cards: catalog.cards, cards_complete: false, badges_complete: false, loading: true } }); await frame();
  check(tiles().length === 2 && count('owned') === 2 && tiles()[0] === hydratedFoilTile && root.querySelector('section') === hydratedFoilSection,
    'A delayed parent normal-only snapshot cannot erase a previously hydrated foil collection while the service cache is unavailable');
  dom.flushSync(() => publishCatalog({ cards: [], foil_cards: [], badges: [], transient_error: true, cards_complete: false, badges_complete: false })); await frame();
  check(tiles().length === 2 && root.querySelector('img[src$="foil-badge.png"]') && tiles()[0] === hydratedFoilTile,
    'A transient empty catalogue retains the same scoped foil card DOM and selected badge without inventing new ownership');
  immediateUnavailable = false;
  dom.flushSync(() => publishCatalog({ cards: [], foil_cards: [], badges: [], cards_complete: true, badges_complete: true })); await frame();
  check(!root.querySelector('section') && tiles().length === 0, 'A healthy complete service catalogue can authoritatively retire cards instead of retaining them forever');
  dom.flushSync(() => publishCatalog(catalog)); await frame();
  check(tiles().length === 2 && count('owned') === 2 && root.querySelector('img[src$="foil-badge.png"]'),
    'Restored complete service definitions rebuild the exact same linked foil selection without navigation or a preference write');
  render({ shortcutAppId: '1002' }); await frame(); check(count('owned') === 5 && root.textContent.includes('Actual badge'), 'Two shortcuts sharing an AppID keep independent selections');
  dom.flushSync(() => publishOptions('1001', localFoil)); await frame(); check(count('owned') === 5, 'Changes to the previous shortcut cannot affect the active linked page');
  check(!optionListeners.has('1001:550') && optionListeners.get('1002:550')?.size === 1 && catalogListeners.size === 1, 'Navigation disposes prior settings and catalogue subscriptions');
  badge = {}; render({ shortcutAppId: '1001', catalog: { cards: catalog.cards } }); await frame();
  check(tiles().length === 0, 'A pending foil catalogue never falls back to normal cards in a foil selection');
  const sameHost = root;
  dom.flushSync(() => publishCatalog(catalog)); await frame(); check(root === sameHost && tiles().length === 2 && count('owned') === 1, 'Progressive foil definitions hydrate the saved selection without navigation');
  const beforeColdReads = reads.length;
  delayedOptions = true; delayedCatalog = true; render({ shortcutAppId: '1003' }); await frame(); const oldOptionRequest = optionLoads.at(-1), oldCatalogRequest = catalogLoads.at(-1);
  check(tiles().length === 0 && root.querySelector('[data-gdl-card-selection-state="loading"]') && reads.length === beforeColdReads,
    'A cold preference read paints neither normal cards nor account ownership before the saved mode is confirmed');
  render({ shortcutAppId: '1004' }); await frame(); oldOptionRequest.resolve(localFoil); oldCatalogRequest(catalog); await frame();
  check(tiles().length === 0 && root.querySelector('[data-gdl-card-selection-state="loading"]'), 'Late results from retired shortcut settings cannot overwrite the current pending mode');
  optionLoads.at(-1).resolve(defaults()); await frame();
  check(tiles().length === 2 && count('owned') === 2 && root.querySelector('img[src$="foil-badge.png"]') && reads.length === beforeColdReads,
    'The automatic new-link preset unlocks every foil card and badge without reading Steam account ownership');
  root.querySelector('button').click(); check(badgeBorders.at(-1) === true, 'The automatic foil preset requests the foil badge page');
  render({ shortcutAppId: '1005' }); await frame(); check(tiles().length === 0, 'Cold saved manual choices remain pending instead of briefly displaying automatic foil');
  optionLoads.at(-1).resolve(localNormal); await frame();
  check(tiles().length === 23 && count('owned') === 2 && count('unowned') === 21 && !root.querySelector('img[src$="foil-a.png"]'),
    'Existing manual normal preferences without the new flag preserve their exact selection');
  render({ shortcutAppId: '1006', catalog: { cards: catalog.cards, cards_complete: false, badges_complete: false } }); await frame();
  optionLoads.at(-1).resolve(defaults()); await frame();
  check(tiles().length === 0 && !root.querySelector('img[src$="0.png"]'), 'Automatic foil never falls back to normal cards while foil definitions are incomplete');
  dom.flushSync(() => publishCatalog(catalog)); await frame();
  check(tiles().length === 2 && count('owned') === 2 && root.textContent.includes('Foil badge'), 'Late complete foil definitions fulfil the automatic preset without saving concrete IDs');
  dom.flushSync(() => publishCatalog({ ...catalog, foil_cards: [...catalog.foil_cards, { title: 'Foil C', image: 'https://cards.test/foil-c.png', foil: true }] })); await frame();
  check(tiles().length === 3 && count('owned') === 3, 'The automatic preset includes new foil definitions that arrive after first paint');
  render({ shortcutAppId: '1007', catalog }); await frame(); optionLoads.at(-1).reject(Error('IPC unavailable')); await frame();
  check(tiles().length === 0 && root.querySelector('[data-gdl-card-selection-state="failed"]') && root.querySelector('button'),
    'A failed preference read offers retry and never silently applies account data or automatic foil');
  root.querySelector('button').click(); await frame(); optionLoads.at(-1).resolve(steamData()); await frame();
  check(tiles().length === 23 && count('unknown') === 23, 'Explicit Use Steam Data remains available after retry and does not restore the automatic preset');
  root.querySelector('button').click(); check(badgeBorders.at(-1) === false, 'Explicit Use Steam Data restores the ordinary badge-page route');
  const noFoil = { cards: catalog.cards, badges: catalog.badges, cards_complete: true, badges_complete: true };
  render({ shortcutAppId: '1008', catalog: noFoil }); await frame(); optionLoads.at(-1).resolve(defaults()); await frame();
  check(tiles().length === 23 && count('owned') === 23 && root.textContent.includes('Max badge'), 'Only confirmed complete absence of foil permits the automatic fully unlocked normal fallback');
  root.querySelector('button').click(); check(badgeBorders.at(-1) === false, 'The confirmed normal fallback opens the matching normal badge page');
  dom.flushSync(() => publishCatalog({ cards: [], foil_badge: catalog.foil_badge, cards_complete: false, badges_complete: true })); await frame();
  check(tiles().length === 0 && root.querySelector('img[src$="foil-badge.png"]') && root.querySelector('button'),
    'A known foil badge remains visible while its card definitions are still unavailable');
  root.querySelector('button').click(); check(badgeBorders.at(-1) === true, 'A badge-only foil definition also keeps the foil route');
  dom.flushSync(() => publishCatalog(catalog)); await frame(); check(tiles().length === 2 && count('owned') === 2, 'The preset returns to the foil collection automatically when definitions become available');
  const stale = tiles()[0], openedBeforeStale = opened.length; active = false; stale.click(); render(); await frame();
  check(opened.length === openedBeforeStale && !root.querySelector('section'), 'Retired page callbacks and sections lose interactivity');
  rendered.unmount(); check(catalogListeners.size === 0 && optionListeners.size === 0, 'Unmount releases all catalogue and selection listeners');
  check(errors.length === 0, 'Custom card rendering produces no React/provider errors: ' + errors.join('\n'));
  console.error = oldError;
  return { label: 'Big Picture CSS trading cards and persisted selector', checks: fixture.checks(), modalMounts: 0, react: React.version };
});
