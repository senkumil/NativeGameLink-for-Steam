import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self: chunks });
const installed = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const cardFactory = Object.values(installed).find(factory => ['AppDetails_SectionTitle_TradingCards', 'SlightlyLargerThanNarrow', 'strMarketHash'].every(token => String(factory).includes(token)));
assert(cardFactory, 'Installed Steam desktop card factory is required for the visual oracle');
const libraries = fs.readdirSync(path.join(steam, 'libraries')).filter(file => file.endsWith('.js'))
 .map(file => fs.readFileSync(path.join(steam, 'libraries', file), 'utf8')).find(source => source.includes('63696:') && source.includes('.createRoot=function'));
assert(libraries, 'Installed Steam React and ReactDOM are required for the visual oracle');
const reactChunks = { webpackChunksteamui: [] };
vm.runInNewContext(libraries, { self: reactChunks });
const reactFactories = Object.assign({}, ...reactChunks.webpackChunksteamui.map(chunk => chunk[1]));
const rendererId = Object.entries(reactFactories).find(([, factory]) => String(factory).includes('.createRoot=function'))?.[0];
const localeChunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'localization/steamui_english-json.js'), 'utf8'), { self: localeChunks });
const locale = { exports: {} };
Object.values(localeChunks.webpackChunksteamui[0][1])[0](locale, locale.exports, () => {});
const classModules = Object.fromEntries([38731, 19819, 15334, 92556, 39012].map(id => { const module = { exports: {} }; installed[id](module); return [id, module.exports]; }));
const factories = Object.fromEntries(Object.entries({ ...Object.fromEntries([45026, 10909, 75315, 78999, 23501].map(id => [id, installed[id]])), cards: cardFactory })
 .map(([id, factory]) => [id, String(factory)]));
const files = {
 cards: 'frontend/features/library/trading-cards.ts', styles: 'frontend/features/library/styles/trading-cards.ts',
 help: 'frontend/features/library/trading-card-help.ts',
 layout: 'frontend/features/library/layout.ts', presentation: 'frontend/features/library/linked-card-presentation.ts',
 service: 'frontend/core/community-item-options.ts', disposables: 'frontend/core/disposables.ts',
 preloads: 'frontend/features/library/trading-card-preload.ts', inject: 'frontend/features/library/styles/inject.ts',
};
const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
 const capture = process.env.NGL_CARD_CHROME_SCREENSHOTS === '1';
 if (capture) {
  const output = path.resolve('scratch/trading-card-chrome'); fs.mkdirSync(output, { recursive: true });
  await page.exposeFunction('captureTradingCardChrome', async name => {
   const height = await page.evaluate(() => Math.ceil(Math.max(...['oracle', 'actual'].map(id => document.getElementById(id).getBoundingClientRect().bottom))) + 20);
   await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled', clip: { x: 0, y: 0, width: 900, height: Math.min(1000, height) } });
  });
 }
 await page.route('**/*', route => { const height = route.request().url().includes('badge') ? 224 : 261;
  return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="224" height="${height}"><rect width="224" height="${height}" fill="#568da2"/></svg>` }); });
 await page.setContent('<!doctype html><body style="margin:0"></body>');
 // Steam's index.html loads library.css before the lazy AppDetails sp.css.
 // The former supplies DialogButton's border reset and baseline metrics.
 await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/library.css'), 'utf8') });
 await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
 const result = await page.evaluate(async ({ sources, factories, reactFactories, rendererId, tokens, classes, capture }) => {
  let checks = 0; const check = (condition, label) => { if (!condition) throw Error(label); checks++; };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const modules = {}, registry = Object.fromEntries(Object.entries(reactFactories).map(([id, value]) => [id, new Function('return (' + value + ')')()]));
  const requireReact = id => { if (modules[id]) return modules[id].exports; const module = modules[id] = { exports: {} }; registry[id](module, module.exports, requireReact); return module.exports; };
  Object.assign(requireReact, { d: (exports, definitions) => { for (const [key, get] of Object.entries(definitions)) Object.defineProperty(exports, key, { enumerable: true, get }); },
   r: exports => Object.defineProperty(exports, '__esModule', { value: true }), n: value => { const getter = () => value?.__esModule ? value.default : value; getter.a = getter; return getter; }, o: (value, key) => Object.prototype.hasOwnProperty.call(value, key) });
  const React = requireReact(63696), ReactDOM = requireReact(rendererId), dom = requireReact(78325);
  const text = (key, fallback, ...values) => String(tokens[key.replace(/^#/, '')] || fallback || key).replace(/%([1-9])\$s/g, (match, index) => String(values[Number(index) - 1] ?? match));
  const locale = { we: (key, ...values) => text(key, undefined, ...values), Yp: (key, count) => text(key + (count === 1 ? '' : '_Plural'), undefined, count) };
  const native = { ...classes, 63696: React, 62540: requireReact(62540), 8658: { A: (...values) => values.filter(Boolean).join(' ') },
   7727: locale, 843: { o: { rightPanelWidth: 1280 } }, 6739: { Qn: () => false }, 41230: { PA: value => value }, 54069: { jR: { BIsFeatureBlocked: () => false } },
   92819: { qw: () => ({ BIsOfflineMode: () => false }) }, 28532: { WJ: 1 },
   38850: { Z: React.forwardRef(({ children, focusable, onActivate, ...props }, ref) => React.createElement('div', { ...props, ref }, children)) },
   96017: { q: ({ children }) => React.createElement(React.Fragment, null, children) },
   15023: { DZ: ({ level, children, ...props }) => React.createElement('h' + level, props, children) },
   // 50777.$n reexports 76982.R; preserve that primitive's real DOM classes.
   50777: { $n: ({ className, children, ...props }) => React.createElement('button', { ...props, className: 'DialogButton _DialogLayout Secondary ' + className }, children) },
   47438: { m9: ({ className, children }) => React.createElement('div', { className }, children), t1: ({ children }) => children, MA: ({ children }) => children },
   38348: { c: ({ rgSources, onIncrementalError, ...props }) => React.createElement('img', { ...props, src: rgSources[0] }) },
   39828: { rV: { GetClientSetting: () => [false] } }, 83780: { wY: callback => {
    const latest = React.useRef(callback); latest.current = callback; const observer = React.useRef(null);
    React.useEffect(() => () => observer.current?.disconnect(), []);
    return React.useCallback(node => { observer.current?.disconnect(); if (node) { observer.current = new ResizeObserver(entries => entries.forEach(entry => latest.current(entry))); observer.current.observe(node); } }, []);
   } }, 23365: { Fu: (value, a, b, x, y) => x + (value - a) / (b - a) * (y - x) }, 60712: classes[38731],
   39608: { N() {} }, 57575: { uX: () => window }, 94601: {}, 87722: {}, 377: {}, 12711: {}, 42095: {}, 62402: {},
  };
  let badge;
  native[12492] = { H_: () => badge };
  const requireNative = id => { if (id in native) return native[id]; if (!factories[id]) throw Error('Unexpected installed oracle dependency ' + id);
   const module = { exports: {} }; new Function('return (' + factories[id] + ')')()(module, module.exports, requireNative); return native[id] = module.exports; };
  Object.assign(requireNative, requireReact);
  const cardExports = {}; new Function('return (' + factories.cards + ')')()({ exports: cardExports }, cardExports, requireNative);
  const Desktop = cardExports.LB;
  const css = classes[38731], shell = classes[19819], header = classes[15334], button = classes[92556], help = classes[39012];
  document.body.innerHTML = '<div id="gdl-library-injected"></div><div style="display:flex;gap:20px"><aside id="oracle" style="width:420px"></aside><aside id="actual" style="width:420px"></aside></div>';
  const oracle = document.getElementById('oracle'), actual = document.getElementById('actual'), oracleRoot = ReactDOM.createRoot(oracle);
  const load = (name, dependency = () => ({})) => { const exports = {}; new Function('exports', 'require', sources[name])(exports, dependency); return exports; };
  let options, catalog;
  const backend = { backendLog() {}, getGameCommunityItemOptionsBackend: async () => ({ ok: true, ...options }) };
  const service = load('service', () => backend), presentation = load('presentation', () => service);
  const classCandidates = Object.values(classes);
  const cssApi = { ACH_CLASSES: () => ({ HighlightDiv: '_2xTb6N-jUUQ-mIkMB6OVMm' }), PLAYBAR_CLASSES: () => ({}),
   resolveClassModule: (predicate, fallback) => ({ classes: classCandidates.find(predicate) || fallback }) };
  const localization = { loc: text, gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)) };
  const layoutApi = load('layout', key => key === '../../steam/css' ? cssApi : key === '../../steam/library-header'
   ? { containsNativeLibraryHeader: () => false, findNativeLibraryHeader: () => null, isInsideNativeLibraryHeader: () => false } : {});
  const anchor = document.createElement('div'); anchor.className = shell.AppDetailsSection;
  anchor.innerHTML = `<h2 class="${header.SectionHeader} ${header.PadLeft}"><div class="${header.Label}"><div class="${header.LabelText}">Notes</div></div></h2><div class="${shell.AppDetailsSectionContainer} ${shell.AppDetailsSectionHasLabel} ${shell.RightColumnSection}"><div class="${shell.Body}"></div></div>`;
  actual.append(anchor); const layout = { anchorRegion: anchor, sidebarColumn: actual, twoColumnRow: actual.parentElement, contentColumn: null, noticeParent: null };
  anchor.style.display = 'none';
  if (capture) {
   document.body.style.cssText = 'margin:0;padding:20px;background:#1b2633;color:white';
   oracle.parentElement.style.marginTop = '30px';
   const caption = document.createElement('div'); caption.style.cssText = 'position:absolute;left:20px;top:12px;display:flex;gap:20px;font:14px Arial;color:#9da8b5';
   caption.innerHTML = '<span style="width:420px">Installed Steam</span><span style="width:420px">Plugin CSS</span>'; document.body.append(caption);
  }
  const order = { shortcutAppId: '3000000091', column: actual, isCurrent: () => true, publish: section => { section.dataset.gdlShortcutAppId = '3000000091'; section.dataset.gdlSteamAppId = '550'; actual.append(section); return true; } };
  const catalogueApi = { getImmediateOfficialCommunityItems: () => catalog, getOfficialCommunityItems: async () => catalog, subscribeOfficialCommunityItems: () => () => {}, normalizeCommunityAssetUrl: value => value || '' };
  const dependencies = { '../../api/backend': backend, '../../core/community-item-options': service,
   '../../core/text': { escapeHtml: value => String(value).replace(/[&<>"']/g, character => '&#' + character.charCodeAt(0) + ';') },
   '../../core/disposables': load('disposables'), '../../steam/css': cssApi, '../../steam/localization': localization,
   './community-items': catalogueApi, './constants': { GDL_INJECTED: 'gdl-library-injected' }, './layout': layoutApi,
   './trading-card-preload': load('preloads'), './native-card-preview': { disposeNativeCardPreview() {}, tryOpenNativeCardPreview: () => false },
   './sidebar-order': { getLinkedSidebarOrder: () => order }, './linked-card-presentation': presentation };
  dependencies['./trading-card-help'] = load('help', key => dependencies[key]);
  const cards = load('cards', key => { if (!(key in dependencies)) throw Error('Unexpected production chrome dependency ' + key); return dependencies[key]; });
  load('styles', () => load('inject')).ensureTradingCardStyles(document);
  const sample = (node, properties) => Object.fromEntries(properties.map(property => [property, getComputedStyle(node)[property]]));
  const compare = (a, b, properties, label) => check(JSON.stringify(sample(a, properties)) === JSON.stringify(sample(b, properties)), label + ': ' + JSON.stringify({ actual: sample(a, properties), native: sample(b, properties) }));
  const dimensions = (a, b, label) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); check(Math.abs(x.width - y.width) < .2 && Math.abs(x.height - y.height) < .2, label + ': ' + JSON.stringify({ actual: [x.width, x.height], native: [y.width, y.height] })); };
  const relative = (a, b, parentA, parentB, label) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(), p = parentA.getBoundingClientRect(), q = parentB.getBoundingClientRect();
   check(Math.abs(x.left - p.left - y.left + q.left) < .2 && Math.abs(x.top - p.top - y.top + q.top) < .2, label + ': ' + JSON.stringify({ actual: [x.left - p.left, x.top - p.top], native: [y.left - q.left, y.top - q.top] })); };
  const image = index => 'https://community.steamstatic.com/economy/image/chrome' + index;
  const baseCards = [0, 1].map(index => ({ title: 'Card ' + index, image: image(index) }));
  const foilCards = baseCards.map(card => ({ ...card, image: card.image + '-foil', foil: true }));
  const badges = [...[1, 5].map(level => ({ title: 'Badge level ' + level, level, image: image('badge' + level) })),
   { title: 'Foil badge', level: 1, foil: true, image: image('foil-badge') }];
  const cases = [{ name: 'unearned', level: 0, owned: [] }, { name: 'missing', level: 1, owned: [0] },
   { name: 'ready', level: 1, owned: [0, 1] }, { name: 'maxed', level: 5, owned: [0, 1] },
   { name: 'foil-maxed', level: 1, foil: true, owned: [0, 1] }];
  for (const state of cases) {
   cards.disposeTradingCardUI(document); service.clearCommunityItemOptions();
   catalog = { cards: baseCards, foil_cards: foilCards, badges, cards_complete: true, badges_complete: true };
   const chosen = badges.find(item => item.level === state.level && Boolean(item.foil) === Boolean(state.foil));
   const assets = state.foil ? foilCards : baseCards;
   options = { enabled: true, card_border: state.foil ? 'foil' : 'normal', card_ids: state.owned.map(index => service.communityCardId(assets[index])), badge_id: chosen ? service.communityBadgeId(chosen) : null };
   badge = { nLevel: state.level, nXP: state.level * 100, nNextLevelXP: 100, strNextLevelName: badges[0].title, strName: chosen?.title || '', strIconURL: chosen?.image || '', bMaxed: state.level === 5 || state.foil,
    rgCards: assets.map((card, index) => ({ strName: card.title, strTitle: card.title, strImgURL: card.image, strArtworkURL: card.image, strMarketHash: '550-' + index + (state.foil ? '-foil' : ''), nOwned: state.owned.includes(index) ? 1 : 0 })) };
   dom.flushSync(() => oracleRoot.render(React.createElement(Desktop, { details: { unAppID: 550 } })));
   await cards.renderOfficialTradingCards(document, layout, { steamAppId: '550', shortcutAppId: '3000000091', gameName: 'Chrome fixture', isCurrent: () => true }); await frame(); await frame();
   const region = actual.querySelector('#gdl-trading-cards-section'); check(region, state.name + ' CSS chrome exists');
   const actualBadge = region.querySelector(state.level ? '.gdl-trading-badge-image' : '.gdl-trading-badge-empty,.gdl-trading-badge.' + css.EmptyCircle + ',.' + css.EmptyCircle);
   const nativeBadge = oracle.querySelector('.' + css.Badge);
   check(actualBadge, state.name + ' has the native badge image or empty-circle structure'); dimensions(actualBadge, nativeBadge, state.name + ' badge dimensions match Steam');
   const actualTitle = region.querySelector('.gdl-trading-badge-title'), nativeTitle = oracle.querySelector('.' + css.BadgeName);
   const actualXP = region.querySelector('.gdl-trading-badge-xp'), nativeXP = oracle.querySelector('.' + css.BadgeLevel);
   compare(actualTitle, nativeTitle, ['fontSize', 'fontWeight', 'color', 'whiteSpace', 'lineHeight'], state.name + ' badge name typography matches Steam');
   compare(actualXP, nativeXP, ['fontSize', 'color', 'lineHeight'], state.name + ' badge XP typography matches Steam');
   check(actualTitle.textContent === nativeTitle.textContent && actualXP.textContent === nativeXP.textContent, state.name + ' badge level/XP text is rendered from the native state');
   const status = region.querySelector('.gdl-trading-card-remaining'), nativeStatus = oracle.querySelector('.' + css.CardsLeft);
   check(status.textContent === nativeStatus.textContent, state.name + ' remaining/ready/maxed text matches installed locale');
   compare(status, nativeStatus, ['color', 'backgroundImage', 'padding', 'fontSize', 'marginBottom', 'textAlign', 'borderRadius'], state.name + ' status treatment matches Steam');
   const footer = region.querySelector('.gdl-trading-cards-view-link'), nativeFooter = oracle.querySelector('button.' + button.BottomRight);
   check(footer.textContent === nativeFooter.textContent, state.name + ' footer label matches installed locale');
   compare(footer, nativeFooter, ['fontSize', 'color', 'padding', 'marginTop', 'textAlign', 'backgroundColor'], state.name + ' footer styling matches Steam');
   dimensions(footer, nativeFooter, state.name + ' footer hit target matches Steam');
   const actualHeader = region.querySelector('.gdl-trading-cards-badge-header'), nativeHeader = oracle.querySelector('.' + css.BadgeSection);
   compare(actualHeader, nativeHeader, ['padding', 'marginBottom', 'backgroundImage', 'boxShadow', 'borderBottomWidth'], state.name + ' badge highlight is a separate native header');
   dimensions(actualHeader, nativeHeader, state.name + ' badge highlight dimensions match Steam');
   relative(actualBadge, nativeBadge, actualHeader, nativeHeader, state.name + ' badge inset matches Steam');
   relative(actualTitle, nativeTitle, actualHeader, nativeHeader, state.name + ' badge text alignment matches Steam');
   const actualBody = region.querySelector('.gdl-trading-cards-body'), nativeBody = oracle.querySelector('.' + shell.Body);
   compare(actualBody, nativeBody, ['padding', 'display', 'flexDirection', 'backgroundColor'], state.name + ' body gutters and background match Steam');
   const actualSurface = region.querySelector('.' + shell.RightColumnSection), nativeSurface = oracle.querySelector('.' + shell.RightColumnSection);
   compare(actualSurface, nativeSurface, ['backgroundImage', 'backgroundColor', 'boxShadow', 'borderRadius'], state.name + ' outer native surface is not overpainted');
   const actualHelp = region.querySelector('.gdl-trading-cards-help-btn'), nativeHelp = oracle.querySelector('.' + help.MoreInfoIcon);
   dimensions(actualHelp, nativeHelp, state.name + ' header help dimensions match Steam');
   relative(actualHelp, nativeHelp, region.querySelector('h2'), oracle.querySelector('h2'), state.name + ' header help alignment matches Steam');
   compare(actualHelp, nativeHelp, ['color', 'backgroundColor', 'marginLeft', 'marginRight', 'borderRadius'], state.name + ' header help colours and spacing match Steam');
   if (capture) await window.captureTradingCardChrome(state.name);
  }
  cards.disposeTradingCardUI(document); dom.flushSync(() => oracleRoot.unmount());
  return { checks, react: React.version };
 }, { sources, factories, reactFactories: Object.fromEntries(Object.entries(reactFactories).map(([id, factory]) => [id, String(factory)])), rendererId, tokens: locale.exports, classes: classModules, capture });
 assert(result.checks >= 75);
 console.log(`Trading card chrome browser passed: ${result.checks} comparisons against installed Steam factory/React ${result.react}; badge, unearned, missing, ready, maxed, footer and native surfaces.`);
} finally { await browser.close(); }
