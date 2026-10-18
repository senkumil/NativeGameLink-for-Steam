import './helpers/installed-steam-check.mjs';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const sources = { cards: ts.transpileModule(fs.readFileSync('frontend/features/big-picture/NativeBigPictureTradingCards.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText };
sources['linked-card-presentation'] = ts.transpileModule(fs.readFileSync('frontend/features/library/linked-card-presentation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const steamChunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync((process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') + '/sp.js', 'utf8'), { self: steamChunks });
const classFactory = Object.values(Object.assign({}, ...steamChunks.webpackChunksteamui.map(chunk => chunk[1])))
  .find(factory => ['CardWrapper:', 'TradingCardCarouselItem:', 'EmptyCircle:', 'BadgeName:'].every(token => String(factory).includes(token)));
if (!classFactory) throw Error('Installed native card presentation classes are required');
const nativeClassModule = { exports: {} }; classFactory(nativeClassModule);
sources.nativeCardCSS = 'exports.classes=' + JSON.stringify(nativeClassModule.exports) + ';';

await runBPBrowserScenario(sources, async fixture => {
  const { React, ReactDOM, dom, dependencies, root, load, frame, check, nativeRequire } = fixture;
  document.body.classList.add('BasicUI');
  const runtime = dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime;
  let badge = {}, active = true, reads = [], opened = [], badgeOpens = 0;
  function useBadgeData(appid) { React.useState(0); const GetBadgeData = () => { reads.push(appid); return badge; }; return GetBadgeData(); }
  function factory() { const signature = 'm_mapBadgeData GetBadgeData( strNextLevelName GetCommunityItemDefinitions( H_:'; return signature; }
  const native = id => id === 700001 ? { H_: useBadgeData } : nativeRequire(id);
  native.m = { 700001: factory };
  Object.assign(runtime, { getRequire: () => native, getModuleFactoryCount: () => 1,
    getModuleFactories: () => [{ id: 700001, factory }] });
  dependencies['../library/community-items'] = { normalizeCommunityAssetUrl: value => String(value || '').replace('/100x100', '') };
  dependencies['../library/linked-card-presentation'] = load('linked-card-presentation');
  const fallbackText = dependencies['../../steam/localization'].loc;
  const fallbackGdlText = dependencies['../../steam/localization'].gdlText;
  dependencies['../../steam/localization'].gdlText = (key, fallback, values) => key === 'cards_remaining'
    ? `${values.count} tarjetas por coleccionar` : fallbackGdlText(key, fallback, values);
  dependencies['../../steam/localization'].loc = (key, fallback) => key === 'AppDetails_TradingCardsLeft' ? '1 tarjeta por coleccionar'
    : key === 'AppDetails_TradingCardsLeft_Plural' ? '%1$s tarjetas por coleccionar' : fallbackText(key, fallback);
  const mod = load('cards');
  const Provider = load('document-primitives').BigPictureUIProvider;
  const css = load('nativeCardCSS').classes;
  const catalog = { cards: Array.from({ length: 23 }, (_, i) => ({ title: `Card ${i}`, image: `https://cards.test/${i}.png`, artwork: `https://cards.test/art-${i}.png` })),
    badges: [{ title: 'First badge preview', image: 'https://cards.test/first.png', level: 1 },
      { title: 'Maximum catalogue badge', image: 'https://cards.test/max.png', level: 5 }] };
  const Section = props => React.createElement('section', null, React.createElement('h2', null, props.label), props.highlight, props.children);
  const Strip = props => React.createElement('div', { 'data-card-row': props.name, style: { display: 'flex', overflowX: 'auto' } }, props.children);
  const rendered = ReactDOM.createRoot(root);
  const props = { document, steamAppId: '550', catalog, hydrating: false, classes: { TradingCard: css }, Section, Strip,
    isCurrent: () => active, onOpenCard: card => opened.push(card.title), onOpenBadge: () => badgeOpens++ };
  const render = extra => dom.flushSync(() => rendered.render(React.createElement(Provider, { document },
    React.createElement(mod.NativeBigPictureTradingCards, { ...props, ...extra }))));
  render(); await frame();
  check(reads.length === 0, 'An available linked catalogue performs no native account badge reads on tab entry');
  check(reads.every(id => id === 550), 'The native badge reader receives only this exact linked metadata AppID');
  const tiles = () => [...root.querySelectorAll('.gdl-bp-trading-card')];
  check(tiles().length === 23, 'An empty native badge response cannot hide or truncate the complete linked catalogue');
  check(tiles().every(tile => tile.dataset.gdlCardOwnership === 'unknown' && !tile.querySelector(`.${css.Owned},.${css.Unowned}`)),
    'Unknown inventory is not reported as owned, maxed or missing');
  check(root.querySelector('img[data-gdl-badge-preview="1"][src$="max.png"]'), 'Big Picture uses the same catalogue badge selection as linked desktop');
  check(!root.textContent.includes('Level 5'), 'The catalogue badge preview does not claim an earned account level');
  const foil = { title: 'Dark Future', image: 'https://cards.test/foil.png', foil: true };
  render({ catalog: { ...catalog, foil_badge: foil } }); await frame();
  check(root.textContent.includes('Dark Future') && root.querySelector('img[src$="foil.png"]'), 'The desktop foil badge takes precedence over normal catalogue badges');
  render(); await frame();
  check(tiles().every(tile => Math.abs(tile.querySelector(`.${css.CardWrapper}`).getBoundingClientRect().width - 100) < 1
    && Math.abs(tile.querySelector(`.${css.CardWrapper}`).getBoundingClientRect().height - 100 * 261 / 224) < 1),
    'Catalogue cards have the native 100px width and 224:261 aspect ratio with nonzero height');
  tiles()[0].click(); check(opened[0] === 'Card 0', 'A linked catalogue card is enabled and opens its artwork');
  badge = { nLevel: 1, nXP: 100, strName: 'Actual badge', strIconURL: 'https://cards.test/earned.png', rgCards: [
    { strImgURL: catalog.cards[0].image + '/100x100', nOwned: 2 }, { strImgURL: catalog.cards[1].image, nOwned: 0 } ] };
  render(); await frame();
  check(root.querySelectorAll('[data-card-row]').length === 1, 'All linked catalogue cards share one navigable row regardless of account inventory');
  check(mod.bigPictureTradingCards(catalog, badge)[0].owned === 2, 'Optional native inventory normalization still recognizes low bandwidth asset URLs');
  const missing = tiles()[1];
  check(Math.abs(missing.querySelector(`.${css.CardWrapper}`).getBoundingClientRect().width - 100) < 1
    && getComputedStyle(missing.querySelector('img')).filter === 'none'
    && !missing.querySelector(`.${css.Unowned}`), 'Linked catalogue cards remain full size and in color regardless of inventory ownership');
  missing.click(); check(opened.at(-1) === 'Card 1', 'Missing cards remain accessible for linked game artwork viewing');
  check(!root.querySelector('img[src$="earned.png"]') && root.querySelector('img[src$="max.png"]'), 'Account badge data cannot replace the linked desktop catalogue badge');
  badge = { rgCards: catalog.cards.map(card => ({ strImgURL: card.image, nOwned: 0 })) }; render(); await frame();
  check(!root.textContent.includes('23 tarjetas por coleccionar') && root.textContent.includes('0'), 'Linked catalogue completion remains zero pending as in desktop, independently of account inventory');
  for (const id of ['1790600', '480490', '1030300']) {
    render({ steamAppId: id, catalog: null }); await frame();
    check(root.querySelector('section') && root.querySelector(`[data-gdl-focus-key="trading-cards-badge-${id}"]`), `The cards section stays available for linked AppID ${id}`);
  }
  badge = {}; render({ catalog: null }); await frame();
  check(root.querySelector('section [role="status"]') && root.querySelector('button') && tiles().length === 0,
    'A game with no available card assets has an enabled section and truthful empty state');
  root.querySelector('button').click(); check(badgeOpens === 1, 'Badge navigation remains enabled for every linked title');
  render({ hydrating: true, catalog: null }); await frame(); check(root.querySelector('[role="status"]').textContent.includes('Loading'), 'Loading remains distinct from a known empty catalogue');
  render(); await frame(); const stale = tiles()[0]; active = false; stale.click();
  check(opened.length === 2, 'An old card callback cannot open artwork after ownership of the linked page is lost');
  render(); await frame(); check(!root.querySelector('section'), 'Retired owners cannot keep an interactive cards section');
  rendered.unmount();
  return { label: 'Big Picture linked trading cards', checks: fixture.checks(), modalMounts: 0, react: React.version };
});
