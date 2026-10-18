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
const installedFactories = Object.values(Object.assign({}, ...steamChunks.webpackChunksteamui.map(chunk => chunk[1])));
const classFactory = installedFactories
  .find(factory => ['CardWrapper:', 'TradingCardCarouselItem:', 'EmptyCircle:', 'BadgeName:'].every(token => String(factory).includes(token)));
if (!classFactory) throw Error('Installed native card presentation classes are required');
const nativeClassModule = { exports: {} }; classFactory(nativeClassModule);
sources.nativeCardCSS = 'exports.classes=' + JSON.stringify(nativeClassModule.exports) + ';';
const nativeCardsFactory = installedFactories.find(factory => ['AppDetails_SectionTitle_TradingCards', 'nOwned', 'strMarketHash', 'data-carousel'].every(token => String(factory).includes(token)));
if (!nativeCardsFactory) throw Error('Installed native trading cards implementation is required');
sources.nativeCardsFactory = 'exports.factory=' + String(nativeCardsFactory) + ';';

await runBPBrowserScenario(sources, async fixture => {
  const { React, ReactDOM, dom, dependencies, root, load, frame, check, nativeRequire } = fixture;
  document.body.classList.add('BasicUI');
  const caughtErrors = [];
  const originalConsoleError = console.error;
  console.error = (...values) => caughtErrors.push(values.map(String).join(' '));
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
  let nativeCardsSection = null;
  dependencies['../../steam/gamepad/components/NativeStuffComponents'] = {
    resolveNativeStuffComponents: () => ({ Cards: nativeCardsSection }),
  };
  const mod = load('cards');
  const Provider = load('document-primitives').BigPictureUIProvider;
  const css = load('nativeCardCSS').classes;
  const catalog = { cards: Array.from({ length: 23 }, (_, i) => ({ title: `Card ${i}`, image: `https://cards.test/${i}.png`, artwork: `https://cards.test/art-${i}.png` })),
    badges: [{ title: 'First badge preview', image: 'https://cards.test/first.png', level: 1 },
      { title: 'Maximum catalogue badge', image: 'https://cards.test/max.png', level: 5 }] };
  const Section = props => React.createElement('section', null, React.createElement('h2', null, props.label), props.highlight, props.children);
  const Strip = props => React.createElement('div', { 'data-card-row': props.name, style: { display: 'flex', overflowX: 'auto' } }, props.children);
  const NativeFocusable = load('document-primitives').NativeFocusable;
  const wrapper = props => React.createElement('div', { className: props.className }, props.children);
  const nativeCardRequire = id => Number(id) === 12492 ? { H_: useBadgeData }
    : Number(id) === 38731 ? css
    : Number(id) === 45026 ? { nZ: Section, l_: wrapper, Zt: wrapper }
    : Number(id) === 39828 ? { rV: { GetClientSetting: () => [false] } }
    : Number(id) === 83780 ? { wY: callback => React.useCallback(node => {
      if (node) callback({ contentRect: { width: node.getBoundingClientRect().width } });
    }, []) }
    : Number(id) === 38348 ? { c: props => React.createElement('img', { src: props.rgSources[0], alt: props.alt, style: props.style, className: props.className }) }
    : Number(id) === 39608 ? { N: value => opened.push(value.strTitle) }
    : Number(id) === 57575 ? { uX: () => window }
    : Number(id) === 38850 ? { Z: NativeFocusable }
    : Number(id) === 62402 ? { Q: props => React.createElement('div', { className: props.className, 'data-native-card-row': '1', style: { display: 'flex' } }, props.children) }
    : Number(id) === 23501 ? { S1: () => ({}), VJ: wrapper }
    : Number(id) === 15023 ? { ck: wrapper }
    : nativeRequire(id);
  Object.assign(nativeCardRequire, nativeRequire);
  const nativeCardsModule = { exports: {} };
  load('nativeCardsFactory').factory(nativeCardsModule, nativeCardsModule.exports, nativeCardRequire);
  nativeCardsSection = nativeCardsModule.exports.on;
  const rendered = ReactDOM.createRoot(root);
  const props = { document, steamAppId: '550', catalog, hydrating: false, classes: { TradingCard: css }, Section, Strip,
    isCurrent: () => active, onOpenCard: card => opened.push(card.title), onOpenBadge: () => badgeOpens++ };
  const render = extra => dom.flushSync(() => rendered.render(React.createElement(Provider, { document },
    React.createElement(mod.NativeBigPictureTradingCards, { ...props, ...extra }))));
  render(); await frame();
  check(reads.length > 0, 'The owner native badge reader remains available when a public catalogue is cached');
  check(reads.every(id => id === 550), 'The native badge reader receives only this exact linked metadata AppID');
  const tiles = () => [...root.querySelectorAll('.gdl-bp-trading-card')];
  check(tiles().length === 23, 'An empty native badge response cannot hide or truncate the complete linked catalogue');
  check(tiles().every(tile => tile.dataset.gdlCardOwnership === 'unknown' && !tile.querySelector(`.${css.Owned},.${css.Unowned}`)),
    'Unknown inventory is not reported as owned, maxed or missing');
  check(root.querySelector(`.${css.Badge}.${css.EmptyCircle}`) && !root.querySelector('img[data-gdl-badge-preview="1"]'),
    'Unknown account badges use a neutral circle without a misleading maximum catalogue preview');
  check(!root.textContent.includes('Level 5'), 'The catalogue badge preview does not claim an earned account level');
  check(!root.textContent.includes('100 XP') && !root.querySelector(`.${css.CardsLeft}`),
    'An unknown inventory catalogue invents neither earned XP nor zero cards remaining');
  const foil = { title: 'Dark Future', image: 'https://cards.test/foil.png', foil: true };
  render({ catalog: { ...catalog, foil_badge: foil } }); await frame();
  check(!root.textContent.includes('Dark Future') && !root.querySelector('img[src$="foil.png"]'),
    'Public foil art never replaces an unknown personal badge before native account data arrives');
  render(); await frame();
  check(tiles().every(tile => Math.abs(tile.querySelector(`.${css.CardWrapper}`).getBoundingClientRect().width - 100) < 1
    && Math.abs(tile.querySelector(`.${css.CardWrapper}`).getBoundingClientRect().height - 100 * 261 / 224) < 1),
    'Catalogue cards have the native 100px width and 224:261 aspect ratio with nonzero height');
  tiles()[0].click(); check(opened[0] === 'Card 0', 'A linked catalogue card is enabled and opens its artwork');
  badge = { nLevel: 0, nNextLevelXP: 100, strNextLevelName: 'Bone Scroll', bMaxed: false, rgCards: Array.from({ length: 9 }, (_, index) => ({
    strTitle: `Actual card ${index}`, strName: `Actual card ${index}`, strMarketHash: `Actual card ${index}`,
    strImgURL: catalog.cards[index].image + (index === 0 ? '/100x100' : ''), strArtworkURL: catalog.cards[index].artwork,
    nOwned: index < 5 ? 1 : 0,
  })) };
  render(); await frame();
  check(root.querySelector('[data-gdl-bp-native-cards="1"]') && root.querySelectorAll('[data-native-card-row]').length === 2,
    'Authoritative account data renders the actual installed native owned and missing card carousels: ' + caughtErrors.join('\n'));
  check(root.querySelectorAll(`.${css.TradingCardCarouselItem}.${css.Owned}`).length === 5
    && root.querySelectorAll(`.${css.TradingCardCarouselItem}.${css.Unowned}`).length === 4,
    'The installed native component partitions five owned and four missing cards instead of fabricating catalogue completion');
  check(root.textContent.includes('Bone Scroll') && !root.querySelector('img[src$="max.png"]')
    && root.querySelector(`.${css.Badge}.${css.EmptyCircle}`), 'An unearned native badge keeps its empty circle and next-level name');
  check(root.querySelector(`.${css.CardsLeft}`)?.textContent.includes('4'), 'The native remaining label reports the four authoritative missing cards');
  check(mod.bigPictureTradingCards(catalog, badge)[0].owned === 1, 'Account asset normalization still recognizes low-bandwidth URLs');
  const ownedCard = root.querySelector(`.${css.TradingCardCarouselItem}.${css.Owned} .${css.Card}`);
  const missingCard = root.querySelector(`.${css.TradingCardCarouselItem}.${css.Unowned} .${css.Card}`);
  const ownedWidth = root.querySelector(`.${css.TradingCardCarouselItem}.${css.Owned} .${css.CardWrapper}`).getBoundingClientRect().width;
  const missingWidth = root.querySelector(`.${css.TradingCardCarouselItem}.${css.Unowned} .${css.CardWrapper}`).getBoundingClientRect().width;
  check(Math.abs(ownedWidth - 100) < 1 && Math.abs(missingWidth - 85) < 1,
    'Real installed CSS keeps owned cards at 100px and missing cards at the native smaller 85px width');
  check(missingCard?.querySelector('img')?.style.filter.includes('0.1'), 'Native missing cards retain their dim saturation');
  ownedCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(opened.at(-1) === 'Actual card 0', 'An owned native card uses Steam artwork activation');
  const beforeMissing = opened.length; missingCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  check(opened.length === beforeMissing, 'A missing native card does not claim an enabled owned-artwork action');
  badge = { ...badge, nLevel: 1, nXP: 125, strName: 'Actual earned badge', strIconURL: 'https://cards.test/earned.png' };
  render(); await frame();
  check(root.textContent.includes('Actual earned badge') && root.querySelector('img[src$="earned.png"]')
    && !root.querySelector('img[src$="max.png"]'), 'Authoritative earned badge image and name replace the public catalogue preview');
  badge = { ...badge, bMaxed: true }; render(); await frame();
  check(root.querySelector(`.${css.CardsLeft}.${css.BadgeMaxed}`), 'A truly maxed native badge uses the installed max-level presentation');
  nativeCardsSection = null; badge = { ...badge, bMaxed: false }; render(); await frame();
  check(root.querySelectorAll('[data-card-row]').length === 2
    && root.querySelectorAll('[data-gdl-card-ownership="owned"]').length === 5
    && root.querySelectorAll('[data-gdl-card-ownership="unowned"]').length === 4,
    'A missing native presentation component preserves the authoritative owned/missing partition');
  check(Math.abs(root.querySelector('[data-gdl-card-ownership="unowned"] .' + css.CardWrapper).getBoundingClientRect().width - 85) < 1
    && root.querySelector('[data-gdl-card-ownership="unowned"] img').style.filter.includes('0.1'),
    'Known-inventory fallback keeps native missing-card size and saturation');
  check(root.querySelector(`.${css.CardsLeft}`).textContent.includes('4') && root.querySelector('img[src$="earned.png"]'),
    'Known-inventory fallback retains real remaining count and earned badge');
  nativeCardsSection = nativeCardsModule.exports.on;
  badge = { ...badge, rgCards: badge.rgCards.map((card, index) => index === 0 ? { ...card, nOwned: undefined } : card) };
  render(); await frame();
  check(!root.querySelector('[data-gdl-bp-native-cards]') && tiles().length === 23
    && tiles().every(tile => tile.dataset.gdlCardOwnership === 'unknown'),
    'A partial native inventory never fabricates ownership for cards missing an authoritative count');
  check(!root.querySelector(`.${css.CardsLeft}`) && !root.querySelector('img[src$="earned.png"]'),
    'Known-to-unknown transitions release the prior earned badge and remaining count');
  badge = {};
  for (const id of ['1790600', '480490', '1030300']) {
    render({ steamAppId: id, catalog: null }); await frame();
    check(!root.querySelector('section') && !root.querySelector(`[data-gdl-focus-key="trading-cards-badge-${id}"]`),
      `Linked AppID ${id} has no empty card section or badge action while no assets are available`);
  }
  badge = {}; render({ catalog: null }); await frame();
  check(!root.querySelector('section') && !root.querySelector('button') && tiles().length === 0,
    'Unavailable card assets leave no invented empty-catalogue message or focus stop');
  render({ catalog: { cards: [] } }); await frame();
  check(!root.querySelector('section'), 'A completed empty public catalogue also leaves no cards section');
  badge = { nLevel: 0, nNextLevelXP: 100, strNextLevelName: 'Late native badge', rgCards: [{
    strTitle: 'Late native card', strName: 'Late native card', strMarketHash: 'Late native card',
    strImgURL: catalog.cards[0].image, strArtworkURL: catalog.cards[0].artwork, nOwned: 1,
  }] };
  render({ catalog: null }); await frame();
  check(root.querySelector('[data-gdl-bp-native-cards="1"]') && root.textContent.includes('Late native card'),
    'The mounted native badge hook reveals authoritative late card data after an initially absent section');
  badge = {}; render(); await frame();
  root.querySelector('button').click(); check(badgeOpens === 1, 'Badge navigation remains enabled for every linked title');
  render({ hydrating: true, catalog: null }); await frame(); check(root.querySelector('[role="status"]').textContent.includes('Loading'), 'Loading remains distinct from a known empty catalogue');
  render(); await frame(); const stale = tiles()[0]; active = false; stale.click();
  check(opened.length === 2, 'An old card callback cannot open artwork after ownership of the linked page is lost');
  render(); await frame(); check(!root.querySelector('section'), 'Retired owners cannot keep an interactive cards section');
  rendered.unmount();
  check(caughtErrors.length === 0, 'Actual installed card presentation renders without a hidden native failure');
  console.error = originalConsoleError;
  return { label: 'Big Picture linked trading cards', checks: fixture.checks(), modalMounts: 0, react: React.version };
});
