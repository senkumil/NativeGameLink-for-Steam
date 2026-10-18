import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const summaryFactory = Object.values(factories).find(factory => String(factory).includes('SummaryCarouselContainer')
  && String(factory).includes('AppDetails_Achievements_Locked') && String(factory).includes('vecUnachieved'));
assert(summaryFactory, 'Installed native gamepad achievement summary is inspectable');
const summaryTree = ts.createSourceFile('native-summary.js', `(${summaryFactory})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = [], nativeImports = {}, interopNames = [];
let achievementItemName;
const inspectSummary = node => {
  if (ts.isFunctionDeclaration(node)) declarations.push(node);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const initializer = node.initializer;
    if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === 't'
      && initializer.arguments[0] && ts.isNumericLiteral(initializer.arguments[0])) nativeImports[node.name.text] = Number(initializer.arguments[0].text);
    if (ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression)
      && initializer.expression.name.text === 'n') interopNames.push(node.name.text);
    if (node.getText(summaryTree).includes('#AppActivity_Achieved_View_Achievements')
      && node.getText(summaryTree).includes('iconClassNames:')) achievementItemName = node.name.text;
  }
  ts.forEachChild(node, inspectSummary);
};
inspectSummary(summaryTree);
const nativeRow = declarations.find(node => node.getText(summaryTree).includes('fnRenderScrollingDiv:')
  && node.getText(summaryTree).includes('SummaryCarouselContainer'));
const nativeTile = declarations.find(node => node.getText(summaryTree).includes('AchievementCarouselItem')
  && node.getText(summaryTree).includes('detailed:'));
const nativeDetails = declarations.find(node => node.getText(summaryTree).includes('AchivementCarouselItemDetails'));
const nativePercent = declarations.find(node => node.getText(summaryTree).includes('Math.max(')
  && node.getText(summaryTree).includes('.flAchieved') && node.getText(summaryTree).includes('.toFixed(1)'));
assert(nativeRow && nativeTile && nativeDetails && nativePercent && achievementItemName,
  'Native row, expanded tile, details and percentage functions form an isolated presentation oracle');
const selected = {};
for (const [id, factory] of Object.entries(factories)) {
  const code = String(factory);
  if ((code.includes('ScrollToElement(') && code.includes('fnRenderScrollingDiv'))
    || (code.includes('scrollPadding:') && code.includes('marginLeft=') && code.includes('S1:'))
    || (code.includes('OnForceMeasureFocusRing:') && code.includes('disableFocusRing:'))
    || (code.includes('imgURL') && code.includes('RareAchievementIconGlowContainerRoot') && code.includes('pauseAnimation'))
    || code.includes('AchievementIconWrapper:')
    || (code.startsWith('je=>{je.exports=') && ['AchivementCarouselItemDetails:', 'BoxCarouselContents:', 'FocusRingOnHiddenItem:'].some(key => code.includes(key)))) selected[id] = code;
}
assert(Object.keys(selected).length >= 6, 'Installed native carousel, focus, spacing and CSS contracts');
const sources = {
  carousel: ts.transpileModule(fs.readFileSync('frontend/features/big-picture/NativeBigPictureCarousel.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText,
  nativeCarouselFixtures: `exports.factories=${JSON.stringify(selected)};exports.summary=${JSON.stringify({
    source: [nativePercent, nativeDetails, nativeTile, nativeRow].map(node => node.getText(summaryTree)).join('\n'),
    row: nativeRow.name.text, imports: nativeImports, interopNames, achievementItemName,
  })};`,
};
for (const [name, file] of Object.entries({
  'achievement-screen-parts': 'frontend/features/big-picture/achievement-screen-parts.ts',
  'achievement-comparison': 'frontend/features/big-picture/achievement-comparison.tsx',
  'pure-class-factory': 'frontend/steam/gamepad/components/pure-class-factory.ts',
})) sources[name] = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;

await runBPBrowserScenario(sources, async fixture => {
  const { React, ReactDOM, dom, load, dependencies, client, root, A, frame, check, req } = fixture;
  const errors = []; window.addEventListener('error', event => errors.push(String(event.error?.stack || event.message)));
  document.body.classList.add('BasicUI');
  root.style.cssText = 'position:relative;width:1160px;margin:20px auto';
  const registry = Object.fromEntries(Object.entries(load('nativeCarouselFixtures').factories)
    .map(([id, source]) => [id, new Function(`return (${source})`)()]));
  const nativeContext = React.createContext({});
  const nativeDeps = {
    62540: req(62540), 63696: React,
    8658: { A: (...values) => values.filter(Boolean).join(' ') }, 4452: (...values) => values.filter(Boolean).join(' '),
    71262: { Fd: (element, callback) => { const observer = new ResizeObserver(callback); observer.observe(element); return observer; },
      oI: (prototype, key, descriptor) => ({ configurable: true, get() { const bound = descriptor.value.bind(this);
        Object.defineProperty(this, key, { value: bound, configurable: true }); return bound; } }) },
    34560: { s: () => (_prototype, _key, descriptor) => descriptor }, 47537: { JV: class {} },
    1574: { wd: class { Debug() {} } }, 6739: { Qn: () => true }, 92393: { CZ: {} },
    23569: { bJ: () => true }, 38189: { QI: () => false }, 47428: { sQ: nativeContext },
    34699: { D5: (ref, value) => { if (ref) ref.current = value; } },
    2469: { qR: () => ({ bActiveTree: true, bDisableFocusClasses: false }) },
  };
  const modules = {}, nativeReq = id => {
    if (id in nativeDeps) return nativeDeps[id];
    if (modules[id]) return modules[id].exports;
    if (!registry[id]) throw Error(`Unexpected native dependency ${id}`);
    const module = modules[id] = { exports: {} }; registry[id](module, module.exports, nativeReq); return module.exports;
  };
  Object.assign(nativeReq, { m: registry, d: req.d, n: req.n, r: req.r });
  let identity = nativeReq;
  const runtime = { captureRuntime() {}, getRuntimeIdentity: () => identity, getRequire: () => nativeReq,
    getModuleFactoryCount: () => Object.keys(registry).length, getModuleFactories: () => Object.entries(registry).map(([id, factory]) => ({ id, factory })),
    getAllModules: () => Object.entries(modules).map(([id, value]) => ({ id, exports: value.exports })) };
  dependencies['../../steam/modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  dependencies['../modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  dependencies['../library/artwork'] = { linkedShortcutPortrait: () => 'https://example.invalid/portrait.png' };
  dependencies['../playtime/service'] = { getInstantPlaytimeStats: () => null, fetchPlaytimeStats: async () => null };
  dependencies['../playtime/playtime-settings'] = { isShortcutPlaytimeTrackingEnabled: () => false };
  dependencies['../playtime/format'] = { formatPlaytimeMinutes: value => `${value} min` };
  dependencies['./detail-views'] = { createBigPictureDetailViews: () => ({ overview: {}, details: {} }) };
  dependencies['../achievements/comparison'] = { getAchievementComparisonFriends: async () => [], getFriendAchievementState: async () => new Map() };
  // Fixtures replace only native app state and input dispatch. Geometry, React,
  // BoxCarousel, inset provider and ring implementation execute installed code.
  const BaseFocusable = client.Focusable;
  client.Focusable = props => {
    const focus = React.useContext(nativeContext);
    return React.createElement(BaseFocusable, { ...props, onFocus: event => {
      const element = event.currentTarget;
      if (props.focusable !== false) focus.OnFocus?.(null, { Element: element, BWantsFocusRing: () => true,
        GetBoundingRectForFocusRing: () => element.getBoundingClientRect(), GetBorderRadiusForFocusRing: () => ({}) });
      props.onFocus?.(event);
    } });
  };
  const nativeUI = load('document-ui-runtime'); nativeUI.clearDocumentUIRuntime(document);
  const carousel = load('carousel'), primitives = load('document-primitives');
  const parts = carousel.resolveBigPictureCarouselParts(document);
  check(parts.Carousel && parts.FocusRing && parts.Spacing && parts.useSpacing, 'Private-cache factories resolve all native presentation providers without guessed module IDs');
  const achievementCSS = Object.values(modules).map(module => module.exports).find(value => value.AchievementCarouselItem)
    || nativeReq(Object.keys(registry).find(id => String(registry[id]).includes('AchievementCarouselItem:')));
  const focusCSS = nativeReq(Object.keys(registry).find(id => String(registry[id]).includes('FocusRingRoot:')));
  const oracle = load('nativeCarouselFixtures').summary;
  const NativeImage = load('achievement-screen-parts').resolveBigPictureAchievementScreenParts(document, true).Image;
  const oracleDeps = {
    ...nativeDeps, 23501: { S1: parts.useSpacing, VJ: parts.Spacing },
    38850: { Z: props => React.createElement(client.Focusable, { focusable: false, ...props }) },
    96017: { q: parts.FocusRing }, 62402: { Q: parts.Carousel }, 15023: { ck: React.Fragment },
    49519: { W6: () => ({ push() {} }) }, 78158: { dd: () => true },
    72500: { BV: { Library: { App: { Achievements: { My: { Individual: () => '' } } } } } },
    7727: { we: (_token, value) => `${value}% of players have this achievement` },
  };
  const oracleBindings = Object.fromEntries(Object.entries(oracle.imports).map(([name, id]) => [name, oracleDeps[id] || {}]));
  for (const name of oracle.interopNames) oracleBindings[name] = () => achievementCSS;
  oracleBindings[oracle.achievementItemName] = props => React.createElement('div', {
    className: props.achievement.bAchieved ? achievementCSS.Achieved : achievementCSS.NotAchieved,
  }, React.createElement('div', { className: achievementCSS.AchievementHoverContainer },
    React.createElement(NativeImage, { className: [achievementCSS.Icon, props.iconClassNames].filter(Boolean).join(' '),
      imgURL: props.achievement.strImage, glow: false, pauseAnimation: true })));
  const NativeReferenceRow = new Function(...Object.keys(oracleBindings), `${oracle.source}; return ${oracle.row};`)(...Object.values(oracleBindings));
  const cache = load('cache'), summary = load('summary');
  const data = { found: true, appid: '550', metadata_appid: '550', total: 50, unlocked: 32,
    achievements: Array.from({ length: 50 }, (_, index) => ({ name: `ACH_${index}`, display_name: `Achievement ${index}`,
      description: `Long achievement description ${index}`, icon: '', earned: index < 32, earned_time: index,
      global_percent: 80 - index, global_percent_known: true })) };
  cache.cacheLocalAchievements(data, '550', String(A));
  const section = props => React.createElement('section', { style: { position: 'relative' } }, props.highlight, props.children);
  const rendered = ReactDOM.createRoot(root);
  const render = (currentData = data, stateKey = 'mixed', extraProps = {}) => {
    cache.cacheLocalAchievements(currentData, '550', String(A));
    dom.flushSync(() => rendered.render(React.createElement(primitives.BigPictureUIProvider, { document },
    React.createElement(summary.NativeBigPictureAchievements, {
      key: stateKey, shortcut: { id: A, steamAppId: '550', title: 'Linked' }, data: { achievements: currentData }, document, hydrating: false,
      classes: { Achievement: achievementCSS }, SectionComponent: section, LoadingComponent: () => null,
      NativeButton: primitives.NativeButton, NativeFocusable: primitives.NativeFocusable, NativeProgress: primitives.NativeProgress,
      NativeIcons: {}, NativeStrip: carousel.NativeBigPictureCarousel, ...extraProps,
    }))));
  };
  render(); await frame();
  const strips = () => [...root.querySelectorAll('[data-gdl-bp-carousel]')];
  const tiles = index => [...strips()[index].querySelectorAll('[data-gdl-focus-key]')];
  check(strips().length === 2 && tiles(0).length === 12 && tiles(1).length === 12,
    'A 32-earned/18-locked game matches Steam preview vectors: twelve tiles per row, with the complete snapshot preserved: ' + errors.join('\n'));
  check(cache.getCachedLocalAchievementsForShortcut('550', String(A)).achievements.length === 50,
    'Preview bounds do not truncate local progress or the full personal/global screen');
  check(tiles(0)[0].dataset.gdlFocusKey === 'achievement-summary-ACH_31'
    && tiles(1)[0].dataset.gdlFocusKey === 'achievement-summary-ACH_32',
    'The preview starts with newest earned and most commonly unlocked locked achievements');
  tiles(0)[0].click(); await frame();
  check(document.querySelectorAll('#gdl-bp-achievements-screen [data-gdl-achievement-name]').length === 50,
    'Selecting a bounded preview opens all fifty achievements in the complete native-style screen');
  load('owned').disposeBigPictureModals(document); await frame();
  check(strips().every(row => row.querySelector('[data-gdl-carousel-viewport="1"]')
    && row.querySelector(`.${focusCSS.FocusRingRoot}`)), 'Each strip has its own exact native scroll viewport and native ring provider');
  const nav = load('navigation'), tabs = document.getElementById('tabs');
  nav.installBigPictureGamepadNavigation(document, root, tabs, new Map([['stuff', tabs.firstElementChild]]), { authority: 'fallback', generation: 1 });
  const realNow = Date.now; let navTime = realNow(); Date.now = () => navTime;
  const arrow = async key => { navTime += 200; document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await frame(); };
  tiles(0)[0].focus(); await frame();
  await new Promise(resolve => setTimeout(resolve, 200));
  const icon = tile => tile.querySelector(`.${achievementCSS.CarouselIcon}`);
  check(tiles(0).every(tile => Math.abs(icon(tile).getBoundingClientRect().width - 74) < 1),
    'Every icon in the active native row is 74px, including unselected achievements');
  check(tiles(1).every(tile => Math.abs(icon(tile).getBoundingClientRect().width - 52) < 1),
    'The inactive native row uses 52px icons instead of enlarging only the selected achievement');
  check(tiles(1).every(tile => getComputedStyle(icon(tile)).filter === 'grayscale(1)'),
    'Locked achievements are visibly grayscale even if the supplied gray image is colored');
  let firstWidth = tiles(0)[0].getBoundingClientRect().width;
  check(firstWidth > tiles(0)[1].getBoundingClientRect().width * 3, 'The real Steam Detailed CSS expands the focused tile instead of a fixed-width test mock');
  for (let index = 1; index < tiles(0).length; index++) {
    await arrow('ArrowRight');
    check(document.activeElement === tiles(0)[index], `Right visits earned tile ${index} despite expansion and overflow`);
  }
  const viewport = strips()[0].querySelector('[data-gdl-carousel-viewport="1"]');
  check(viewport.scrollLeft > 0, 'Lateral focus scrolls the native clipped carousel viewport');
  const last = tiles(0).at(-1).getBoundingClientRect(), edge = viewport.getBoundingClientRect();
  check(last.left >= edge.left - 2 && last.right <= edge.right + 2, 'The final expanded tile remains entirely inside the viewport');
  for (let index = tiles(0).length - 2; index >= 0; index--) {
    await arrow('ArrowLeft'); check(document.activeElement === tiles(0)[index], `Left returns through earned tile ${index}`);
  }
  await arrow('ArrowDown');
  await new Promise(resolve => setTimeout(resolve, 200));
  check(tiles(1).every(tile => Math.abs(icon(tile).getBoundingClientRect().width - 74) < 1)
    && tiles(0).every(tile => Math.abs(icon(tile).getBoundingClientRect().width - 52) < 1),
    'Moving down swaps native priority sizing for the entire earned and locked rows');
  check(tiles(1).includes(document.activeElement), 'Down moves to the locked row instead of skipping to a later section');
  const lockedIndex = tiles(1).indexOf(document.activeElement);
  await arrow('ArrowRight'); check(document.activeElement === tiles(1)[lockedIndex + 1], 'Right navigates independently through locked achievements');
  // Native virtual-focus events carry focus even when DOM focus does not move.
  tiles(0)[0].focus(); await new Promise(resolve => setTimeout(resolve, 200));
  const virtual = tiles(0).at(-1); virtual.dispatchEvent(new CustomEvent('vgp_onfocus', { bubbles: true })); await frame();
  check(viewport.scrollLeft > 0, 'Native virtual focus also scrolls its own viewport');
  nav.disposeBigPictureGamepadNavigation(document);
  Date.now = realNow;
  tiles(0)[4].focus(); await new Promise(resolve => setTimeout(resolve, 600)); await frame();
  const nativeRing = strips()[0].querySelector(`.${focusCSS.FocusRing}`);
  const focusedBounds = tiles(0)[4].getBoundingClientRect(), ringBounds = nativeRing?.getBoundingClientRect();
  check(ringBounds && Math.abs(ringBounds.left - focusedBounds.left) < 2
    && Math.abs(ringBounds.top - focusedBounds.top) < 2 && Math.abs(ringBounds.width - focusedBounds.width) < 2,
    'Native local ring follows the expanded tile geometry after its layout transition');
  check(!document.getElementById('gdl-bp-focus-ring'), 'Native focus measurement does not recreate a second fallback ring');
  root.style.transform = 'scale(.8)'; root.style.transformOrigin = 'top left';
  viewport.scrollLeft = 0;
  virtual.dispatchEvent(new CustomEvent('vgp_onfocus', { bubbles: true })); await frame();
  const scaledTile = virtual.getBoundingClientRect(), scaledViewport = viewport.getBoundingClientRect();
  check(scaledTile.left >= scaledViewport.left - 2 && scaledTile.right <= scaledViewport.right + 2,
    'CEF CSS scaling converts measured rect distances into logical scroll pixels');
  viewport.scrollLeft = 0; identity = {};
  virtual.dispatchEvent(new CustomEvent('vgp_onfocus', { bubbles: true })); await frame();
  check(viewport.scrollLeft === 0, 'A retired runtime lease cannot continue scrolling its old connected row');
  root.style.transform = ''; root.style.transformOrigin = '';
  const summaryState = (total, unlocked) => ({ found: true, appid: '550', metadata_appid: '550', total, unlocked,
    achievements: Array.from({ length: total }, (_, index) => ({ name: `STATE_${index}`, display_name: `State achievement ${index}`,
      description: `Description ${index}`, icon: `https://example.invalid/normal-${index}.png`, icon_gray: `https://example.invalid/gray-${index}.png`,
      earned: index < unlocked, earned_time: index, global_percent: 80 - index, global_percent_known: true })) });
  render(summaryState(52, 45), 'floor'); await frame();
  check(root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '86' && root.textContent.includes('(86%)'),
    'The native summary floors 45 of 52 to 86 percent rather than rounding up');
  check(!root.querySelector('.gdl-bp-view-all-achievements'), 'Rows are their own achievement opener without an extra full-width View All button');
  check(tiles(0).every(tile => /\/normal-\d+\.png$/.test(tile.querySelector('img').getAttribute('src')))
    && tiles(1).every(tile => /\/gray-\d+\.png$/.test(tile.querySelector('img').getAttribute('src'))),
    'Earned tiles use their normal image and locked tiles use each achievement gray URL');
  render(summaryState(52, 52), 'all-earned'); await frame();
  check(strips().length === 1 && tiles(0).length === 12 && !root.querySelector(`.${achievementCSS.LockedAchievementsLabel}`),
    'All-earned data renders one bounded native preview without a locked heading or ghost second row');
  check(root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '100'
    && !root.querySelector('.gdl-bp-view-all-achievements'), 'A complete set retains 100 percent and no additional focus stop');
  render(summaryState(52, 0), 'all-locked'); await frame();
  check(strips().length === 1 && tiles(0).length === 12 && strips()[0].dataset.gdlBpCarousel === 'NativeGameLink Locked Achievements'
    && root.querySelector(`.${achievementCSS.LockedAchievementsLabel}`),
    'All-locked data renders a labeled locked row instead of duplicating it as an earned row');
  check(tiles(0).every(tile => /\/gray-\d+\.png$/.test(tile.querySelector('img').getAttribute('src')))
    && root.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '0', 'All-locked images and completion remain genuinely locked');
  nav.installBigPictureGamepadNavigation(document, root, tabs, new Map([['stuff', tabs.firstElementChild]]), { authority: 'fallback', generation: 1 });
  Date.now = () => navTime;
  tiles(0)[0].focus(); await frame(); await arrow('ArrowRight');
  check(document.activeElement === tiles(0)[1], 'The sole locked row remains laterally navigable when there are no earned achievements');
  nav.disposeBigPictureGamepadNavigation(document); Date.now = realNow;
  render(summaryState(0, 0), 'zero'); await frame();
  check(strips().length === 0 && !root.querySelector('[role="progressbar"]') && !root.querySelector('.gdl-bp-view-all-achievements'),
    'A genuine zero-achievement summary invents no carousel, progress percentage or extra opener');
  render({ ...summaryState(0, 0), total: 52 }, 'pending-items'); await frame();
  check(strips().length === 0 && root.querySelectorAll('.gdl-bp-view-all-achievements').length === 1,
    'Known total without loaded items retains exactly one native fallback opener');
  render(summaryState(0, 0), 'hidden-empty', { hideIfEmpty: true }); await frame();
  check(!root.querySelector('section'), 'An explicitly hidden empty summary leaves no blank section or focus stop');
  const secrets = summaryState(20, 0); secrets.achievements.forEach(item => { item.hidden = true; });
  render(secrets, 'all-hidden'); await frame();
  check(strips().length === 0 && root.querySelectorAll('.gdl-bp-view-all-achievements').length === 1,
    'Unrevealed hidden achievements do not leak through the locked preview; the complete screen remains reachable');

  // Compare production geometry to Steam's actual row/tile/detail functions,
  // using the exact same CSS, image component, carousel, ring and inset provider.
  // Account-backed achievement navigation/hover reads alone are fixture-owned.
  const referenceHost = document.createElement('div'); referenceHost.className = 'native-summary-oracle';
  referenceHost.style.cssText = 'position:absolute;left:0;top:1500px'; document.body.appendChild(referenceHost);
  const referenceRoot = ReactDOM.createRoot(referenceHost);
  const preview = load('achievement-preview').bigPictureAchievementPreview(data.achievements);
  const nativeItems = items => items.map(item => ({ strID: item.name, strName: item.display_name, strDescription: item.description,
    strImage: item.icon, bAchieved: item.earned, flAchieved: item.global_percent }));
  const nativeGeometry = host => {
    const row = host.querySelector(`.${achievementCSS.AchievementCarouselItem}`)?.parentElement;
    const items = [...host.querySelectorAll(`.${achievementCSS.AchievementCarouselItem}`)];
    const viewport = host.querySelector('[data-gdl-carousel-viewport="1"]') || row.parentElement;
    const view = viewport.getBoundingClientRect();
    return { icon: items[0].querySelector(`.${achievementCSS.CarouselIcon}`).getBoundingClientRect().width,
      detail: items[0].getBoundingClientRect().width, height: items[0].getBoundingClientRect().height,
      visible: items.filter(item => { const rect = item.getBoundingClientRect(); return rect.left >= view.left - 1 && rect.right <= view.right + 1; }).length };
  };
  for (const [width, scale] of [[680, 1], [1160, 1], [1452, 1.135], [1160, .8]]) {
    root.style.width = referenceHost.style.width = `${width}px`;
    root.style.transform = referenceHost.style.transform = `scale(${scale})`;
    root.style.transformOrigin = referenceHost.style.transformOrigin = 'top left';
    render(data, `geometry-${width}-${scale}`);
    dom.flushSync(() => referenceRoot.render(React.createElement(NativeReferenceRow, {
      appid: A, achievements: nativeItems(preview.earned), prioritized: true, onRequestPriority() {}, labelledBy: 'oracle',
    })));
    await new Promise(resolve => setTimeout(resolve, 190)); await frame();
    const actual = nativeGeometry(strips()[0]), expected = nativeGeometry(referenceHost);
    check(['icon', 'detail', 'height'].every(key => Math.abs(actual[key] - expected[key]) < 1),
      `Earned preview matches installed native geometry at ${width}px and scale ${scale}: ${JSON.stringify({ actual, expected })}`);
    check(actual.visible === expected.visible,
      `The count of fully visible earned tiles follows native clipping at ${width}px and scale ${scale}`);
    dom.flushSync(() => referenceRoot.render(React.createElement(NativeReferenceRow, {
      appid: A, achievements: nativeItems(preview.locked), prioritized: false, onRequestPriority() {}, labelledBy: 'oracle',
    })));
    await new Promise(resolve => setTimeout(resolve, 190)); await frame();
    const actualLocked = nativeGeometry(strips()[1]), expectedLocked = nativeGeometry(referenceHost);
    check(['icon', 'detail', 'height'].every(key => Math.abs(actualLocked[key] - expectedLocked[key]) < 1),
      `Inactive locked preview matches installed native geometry at ${width}px and scale ${scale}`);
    check(actualLocked.visible === expectedLocked.visible,
      `The locked preview count and clipped tail follow native layout at ${width}px and scale ${scale}`);
  }
  referenceRoot.unmount(); referenceHost.remove();
  rendered.unmount(); await frame();
  check(!root.querySelector('[data-gdl-bp-carousel]') && !document.getElementById('gdl-bp-focus-ring'), 'Unmount releases both rows, scrolling effects and fallback ring');
  check(document.getElementById('native-public').textContent === 'Native untouched', 'Native sibling content remains untouched');
  check(carousel.resolveBigPictureCarouselParts(document).Carousel === parts.Carousel, 'A replacement lease resolves the current local presentation contracts anew');
  return { label: 'Big Picture Tus cosas native carousel', checks: fixture.checks(), modalMounts: 1, react: React.version };
});
