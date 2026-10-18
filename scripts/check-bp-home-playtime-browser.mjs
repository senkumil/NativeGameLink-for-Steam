// Execute Steam's installed Home subtitle and pure playtime formatter with
// fixture account/controller reads, real owner React and production patches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const self = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self }, { timeout: 3000 });
const factories = Object.values(Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1])));
const homeFactory = factories.find(factory => String(factory).includes('#AppBox_NoPlayTimeYet')
  && String(factory).includes('#BasicGameCarousel_TotalPlayTime_'));
const formatterFactory = factories.find(factory => String(factory).includes('#Played_')
  && String(factory).includes('GetPreferredLocales') && String(factory).includes('maximumFractionDigits:1'));
assert(homeFactory && formatterFactory, 'Installed Home subtitle and pure playtime formatter must be inspectable');
const tree = ts.createSourceFile('native-home.js', String(homeFactory), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const candidates = [];
const visit = node => {
  if (ts.isFunctionExpression(node) && node.end - node.pos < 4000) {
    const text = node.getText(tree);
    if (text.includes('#AppBox_NoPlayTimeYet') && text.includes('.app.minutes_playtime_forever')) candidates.push(node);
  }
  ts.forEachChild(node, visit);
};
visit(tree);
assert.equal(candidates.length, 1, 'One installed Home subtitle function owns the app-prop playtime contract');
const component = candidates[0], locals = new Set(), identifiers = new Set();
const inspect = node => {
  if (ts.isParameter(node) || ts.isVariableDeclaration(node)) if (ts.isIdentifier(node.name)) locals.add(node.name.text);
  if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) identifiers.add(node.text);
  ts.forEachChild(node, inspect);
};
inspect(component);
const dependencies = [...identifiers].filter(name => !locals.has(name));
const styleFactory = factories.find(factory => String(factory).includes('BasicGameCarouselItem:') && String(factory).includes('SubMessage:'));
const styleModule = { exports: {} }; assert(styleFactory, 'Installed Home CSS module is inspectable'); styleFactory(styleModule);
const languages = {};
for (const language of ['english', 'spanish', 'latam']) {
  const self = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(path.join(steam, `localization/steamui_${language}-json.js`), 'utf8'), { self });
  const tokens = {};
  for (const chunk of self.webpackChunksteamui) for (const factory of Object.values(chunk[1])) {
    const module = { exports: {} }; factory(module); Object.assign(tokens, module.exports);
  }
  languages[language] = Object.fromEntries(Object.entries(tokens).filter(([key]) => /^(AppBox_NoPlayTimeYet|AppBox_RecentPlayTime_|BasicGameCarousel_TotalPlayTime_)/.test(key)));
}
const extraSources = Object.fromEntries([
  ['home-runtime', 'frontend/features/big-picture/runtime.ts'], ['home-playtime', 'frontend/features/big-picture/home-playtime.ts'],
  ['home-playtime-probes', 'frontend/features/big-picture/home-playtime-probes.ts'],
  ['overview-state', 'frontend/features/big-picture/overview-state.ts'], ['AppStoreAdapter', 'frontend/steam/gamepad/stores/AppStoreAdapter.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['native-route', 'frontend/features/library/native-route.ts'], ['disposables', 'frontend/core/disposables.ts'],
  ['localization', 'frontend/steam/localization.ts'], ['token-fallbacks', 'frontend/steam/token-fallbacks.ts'],
  ['token-specs', 'frontend/steam/token-specs.ts'], ['custom-translations', 'frontend/steam/custom-translations.ts'], ['text', 'frontend/core/text.ts'],
  ...['latin', 'asian', 'slavic'].map(name => [`translations-${name}`, `frontend/steam/translations-${name}.ts`]),
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
extraSources['native-home-contract'] = `Object.assign(exports, ${JSON.stringify({ component: component.getText(tree), dependencies, styles: styleModule.exports, languages })});exports.formatterFactory=(${String(formatterFactory)});`;
extraSources['app-home-gate'] = ts.transpileModule(fs.readFileSync('frontend/runtime/app.tsx', 'utf8')
  + '\nexport function __installBPWindow(context: any) { appRuntimeLifecycle = new DisposableRegistry(); windowCreated(context); }\n'
  + 'export function __disposeBPWindow() { disposeDocumentLifecycles(); appRuntimeLifecycle?.dispose(); appRuntimeLifecycle = null; }', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;
extraSources['native-home-contract'] += `exports.appSource=${JSON.stringify(extraSources['app-home-gate'])};`;

await runBPBrowserScenario(extraSources, async fixture => {
  const { load, dependencies, React, ReactDOM, dom, root, A, B, check, frame } = fixture;
  const contract = load('native-home-contract');
  let language = 'latam', locale = 'es-CO', identity = {}, exports = {}, formatCalls = 0;
  const localize = (key, value) => (contract.languages[language][key.replace(/^#/, '')] || key).replace('%1$s', String(value ?? '%1$s'));
  const requireFormatter = () => ({ we: localize, pf: { GetPreferredLocales: () => [locale] } });
  requireFormatter.d = (target, values) => { for (const [key, get] of Object.entries(values)) Object.defineProperty(target, key, { enumerable: true, get }); };
  contract.formatterFactory({}, exports, requireFormatter);
  const nativeFormat = Object.values(exports).find(value => typeof value === 'function');
  const countedFormat = (minutes, prefix) => { formatCalls++; return nativeFormat(minutes, prefix); };
  countedFormat.toString = () => String(nativeFormat);
  const runtime = { getRuntimeIdentity: () => identity, getModuleFactoryCount: () => 1,
    getAllModules: () => [{ id: 'home-format', exports: { pure: countedFormat } }], getRequire: () => null, getModuleFactories: () => [] };
  dependencies['../../steam/modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  dependencies['../modules/SteamWebpackRuntime'] = dependencies['../../steam/modules/SteamWebpackRuntime'];
  document.documentElement.lang = 'es-CO';
  dependencies['../api/backend'] = dependencies['../../api/backend'];
  dependencies['../core/text'] = load('text');
  dependencies['../../steam/localization'] = load('localization');
  dependencies['./css'] = { PLAYBAR_CLASSES: () => ({}) };
  dependencies['./native-dom'] = {};
  const committed = load('library-details');
  dependencies['../../steam/library-details'] = committed;
  dependencies['../../steam/gamepad/stores/AppStoreAdapter'] = load('AppStoreAdapter');
  dependencies['./overview-state'] = load('overview-state');
  const history = new Map([[A, { minutesForever: 258, minutesLastTwoWeeks: 150 }]]);
  let playtimeReads = 0;
  dependencies['../playtime/service'] = { fetchPlaytimeStatsBatch: async () => { playtimeReads++; return history; } };
  dependencies['./details'] = { disposeBigPictureShortcutDetails() {}, refreshBigPictureShortcutDetails: async () => {} };
  let includeUnknown = false;
  dependencies['./mapped-shortcuts-cache'] = { getBigPictureMappedShortcuts: () => (includeUnknown ? [A, B] : [A]).map(id => ({ id, steamAppId: '550', title: 'Same title' })), invalidateBigPictureMappedShortcuts() {} };
  dependencies['../../core/preferences'] = { subscribePreferences: () => () => {} };
  dependencies['../../steam/browser-protection'] = { installBrowserProtection: () => () => {} };
  dependencies['./rerender-scheduler'] = { GamepadRerenderScheduler: class { request() {} cancel() {} } };
  dependencies['./home-playtime'] = load('home-playtime');
  dependencies['./home-playtime-probes'] = load('home-playtime-probes');
  const home = load('home-runtime');
  let magic;
  magic = new Proxy((...args) => args.length ? null : contract.styles, { get: (_target, property) => {
    if (['prototype', '$$typeof', 'then', 'displayName'].includes(property)) return undefined;
    if (property === 'jsx' || property === 'jsxs') return (type, props) => React.createElement(type, props, props.children);
    if (property === 'GetFriendsInGame') return () => [];
    if (property === 'we') return localize;
    if (property === 'l') return nativeFormat;
    if (property === 'A') return (...values) => values.filter(Boolean).join(' ');
    return magic;
  } });
  const NativeHomeSubtitle = new Function(...contract.dependencies, `return (${contract.component});`)(...contract.dependencies.map(() => magic));
  root.remove();
  const ownWindow = { BrowserWindow: window, History: { location: { pathname: '/routes/home' } }, LocationPathName: `/library/app/${A}` };
  window.SteamUIStore = { WindowStore: { GetWindowInstanceFromWindow: target => target === window ? ownWindow : null } };
  window.g_Router.history.location.pathname = `/library/app/${A}`;
  const preload = document.createElement('aside'); preload.hidden = true;
  preload.innerHTML = '<div class="PlayBar AppDetailsHeader"><div id="gdl-bp-detail-root">Preloaded detail</div></div>';
  const homeAction = document.createElement('button'); homeAction.className = 'HomePlayButton'; homeAction.textContent = 'Play';
  document.body.append(preload, homeAction);
  check(!window.appStore && !window.AppStore, 'The real Home fixture has no fabricated appStore global');
  check(!window.LocalizationManager && dependencies['../../steam/localization'].steamLocalizationManager() === null,
    'The plugin uses production localization without a fabricated LocalizationManager global or mocked loc function');
  const host = document.createElement('div'); document.body.appendChild(host); const renderer = ReactDOM.createRoot(host);
  const apps = [A, 550, B].map(appid => Object.freeze({ appid, installed: true, minutes_playtime_forever: 0, minutes_playtime_last_two_weeks: 0 }));
  try {
    for (const nextLanguage of ['latam', 'spanish', 'english']) {
      language = nextLanguage; locale = language === 'english' ? 'en-US' : 'es-CO';
      document.documentElement.lang = language === 'latam' ? 'es-CO' : language === 'spanish' ? 'es' : 'en-US';
      dom.flushSync(() => renderer.render(React.createElement('div', null, apps.map(app => React.createElement(NativeHomeSubtitle, { key: `${language}-${app.appid}`, app })))));
      await frame();
      const messages = [...host.querySelectorAll(`.${contract.styles.SubMessage}`)].map(element => element.lastElementChild);
      check(messages.length === 3 && messages.every(element => !element.closest('[data-appid],a[href]')), `Installed Home subtitles carry app identity only in committed React props: ${host.innerHTML}`);
      check(committed.committedHeaderAppId(messages[0]) === A && committed.committedHeaderAppId(messages[1]) === 550,
        'Committed app props identify linked and public native Home cards without DOM markers or title inference');
      const fiberKey = Object.getOwnPropertyNames(messages[0]).find(key => key.startsWith('__reactFiber$'));
      let fiber = messages[0][fiberKey];
      while (fiber && !fiber.memoizedProps?.app) fiber = fiber.return;
      check(Boolean(fiber), 'The installed subtitle exposes its committed app prop through its real React owner');
      const pending = fiber.pendingProps;
      fiber.pendingProps = { ...pending, app: apps[1] };
      check(committed.committedHeaderAppId(messages[0]) === A, 'A pending public app prop cannot replace the committed shortcut ownership');
      fiber.pendingProps = pending;
      home.activateBigPicture(document); await home.refreshBigPicture(document); await frame();
      check(messages[0].textContent === nativeFormat(150, '#AppBox_RecentPlayTime_'), `Home shows the exact native recent-time format in ${language}`);
      check(load('context').collectActiveRouteValues(document)[0] === '/routes/home', 'The owning WindowInstance live Home history outranks its stale details pathname and another router');
      check(messages[1].textContent === contract.languages[language].AppBox_NoPlayTimeYet && messages[2].textContent === contract.languages[language].AppBox_NoPlayTimeYet,
        'Native Steam games and sibling shortcut installations with the same title remain unchanged');
      home.deactivateBigPicture();
      check(messages[0].textContent === contract.languages[language].AppBox_NoPlayTimeYet, 'Home teardown restores the precise original localized subtitle');
      // The production throttle is document-local and uses wall-clock time.
      await new Promise(resolve => setTimeout(resolve, 1510));
    }
    check(formatCalls >= 3, 'Production Home patch uses the native pure formatter from the owner runtime');
    const format = dependencies['./home-playtime'].formatBigPictureHomePlaytime;
    for (const recent of [0, 1, 60, 119, 120, 150]) {
      const prefix = recent > 0 ? '#AppBox_RecentPlayTime_' : '#BasicGameCarousel_TotalPlayTime_';
      const expected = nativeFormat(recent || 258, prefix);
      check(format(document, 258, recent) === expected, 'Native formatter retains recent/total selection and the 120-minute boundary');
    }
    identity = {}; runtime.getAllModules = () => [];
    for (const nextLanguage of ['latam', 'spanish', 'english']) {
      language = nextLanguage; locale = language === 'english' ? 'en-US' : 'es-CO';
      document.documentElement.lang = language === 'latam' ? 'es-CO' : language === 'spanish' ? 'es' : 'en-US';
      Object.defineProperty(navigator, 'language', { configurable: true, value: document.documentElement.lang });
      dependencies['../../steam/localization'].commitSteamLanguage(language);
      locale = dependencies['../../steam/localization'].steamIntlLocale();
      for (const recent of [0, 1, 60, 119, 120, 150]) {
        const prefix = recent > 0 ? '#AppBox_RecentPlayTime_' : '#BasicGameCarousel_TotalPlayTime_';
        const actual = format(document, 258, recent), expected = nativeFormat(recent || 258, prefix);
        check(actual === expected, `Unavailable pure formatter keeps the exact installed token and number-format fallback contract without localization globals (${language}/${recent}: ${actual} != ${expected})`);
      }
    }
    language = 'latam'; locale = 'es-CO';
    dependencies['../../steam/localization'].commitSteamLanguage('english');
    const manager = { m_mapTokens: new Map(Object.entries(contract.languages.latam)), m_mapFallbackTokens: new Map(),
      LocalizeString: key => localize(key), GetPreferredLocales: () => [locale] };
    identity = {}; runtime.getAllModules = () => [{ id: 'native-localization', exports: { owner: manager } }];
    check(dependencies['./home-playtime'].bigPictureHomeText(document, 'AppBox_NoPlayTimeYet', 'No playtime yet') === contract.languages.latam.AppBox_NoPlayTimeYet,
      'The native runtime manager localizes Home even when globals are absent and the plugin fallback language differs');
    check(format(document, 258, 0) === nativeFormat(258, '#BasicGameCarousel_TotalPlayTime_'),
      'Without the pure formatter, owner localization also controls decimal separators and translated time text');
    identity = {}; runtime.getAllModules = () => [];
    dependencies['./home-playtime'].bigPictureHomeText(document, 'AppBox_NoPlayTimeYet', 'No playtime yet');
    runtime.getAllModules = () => [{ id: 'late-localization', exports: { owner: manager } }];
    await new Promise(resolve => setTimeout(resolve, 1010));
    check(dependencies['./home-playtime'].bigPictureHomeText(document, 'AppBox_NoPlayTimeYet', 'No playtime yet') === contract.languages.latam.AppBox_NoPlayTimeYet,
      'A late owner localizer becomes available after the bounded retry even when the module factory count is unchanged');
    // Exercise the application composition root itself. A correct Home patch
    // is useless if startup and watchdog mistake another window for this one.
    preload.remove();
    window.uiStore = { GetActiveWindowInstance: () => ({ BrowserWindow: {}, LocationPathName: '/library/app/550' }) };
    dependencies['../shortcuts/dismissed'] = { isShortcutDismissed: () => false };
    dependencies['./constants'] = { GDL_INJECTED: 'gdl-library-injected' };
    dependencies['./notice'] = { findNonSteamNotice: () => null };
    dependencies['../../steam/css'] = { PLAYBAR_CLASSES: () => ({}), LINKS_BAR_CLASSES: () => ({}) };
    dependencies['../../steam/native-dom'] = { elementsWithCssModuleClass: () => [], isRenderedElement: () => true };
    const desktopRoutes = load('native-route');
    check(desktopRoutes.isPublicSteamLibraryRoute(document), 'Negative control: the Desktop route helper sees the retained public selection from another window');
    const noop = () => {}, empty = new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : noop });
    const appDependencies = {
      '@steambrew/client': { ...fixture.client, definePlugin: factory => ({ factory }) },
      '../api/backend': dependencies['../../api/backend'], '../core/disposables': load('disposables'),
      '../steam/localization': dependencies['../../steam/localization'],
      '../steam/ui/SteamUIModeService': dependencies['../../steam/ui/SteamUIModeService'],
      '../features/big-picture/runtime': home, '../features/library/native-route': desktopRoutes,
      '../steam/browser-protection': { installBrowserProtection: () => noop },
      '../features/library/runtime': { findNonSteamNotice: () => null },
      '../core/dom': { mutationIsWithinSelector: (record, selector) => Boolean(record.target?.closest?.(selector)) },
      './existing-windows': { resolveSteamWindowContext: () => ({ popupWin: window, popupDoc: document, popupName: 'SP BPM', popupTitle: 'Steam Big Picture' }), isDesktopSteamWindow: () => false },
    };
    const actualApp = {}, code = load('native-home-contract');
    // Keep startup dependencies unrelated to this scoped window inert; the
    // window lifecycle, observer, runInjection and watchdog remain unmodified.
    new Function('require', 'exports', code.appSource)(name => appDependencies[name] || (name === 'react' ? { default: React } : empty), actualApp);
    const timers = new Map(), intervals = new Map(); let serial = -1, clockOffset = 0;
    const set = window.setTimeout, clear = window.clearTimeout, interval = window.setInterval, cancelInterval = window.clearInterval, dateNow = Date.now;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay !== 350) return set(callback, delay, ...args);
      const id = serial--; timers.set(id, callback); return id;
    };
    window.clearTimeout = id => { if (!timers.delete(id)) clear(id); };
    window.setInterval = (callback, delay) => { const id = serial--; intervals.set(id, { callback, delay }); return id; };
    window.clearInterval = id => { if (!intervals.delete(id)) cancelInterval(id); };
    Date.now = () => dateNow() + clockOffset;
    try {
      ownWindow.History.location.pathname = '/routes/home';
      const beforeStartup = playtimeReads;
      actualApp.__installBPWindow({ window });
      check(timers.size === 1, 'Actual Big Picture window creation schedules its normal startup callback');
      for (const callback of [...timers.values()]) callback(); await frame();
      check(playtimeReads > beforeStartup && host.textContent.includes(nativeFormat(150, '#AppBox_RecentPlayTime_')),
        'Actual app startup reaches the Home patch despite a conflicting retained Desktop public route');
      const watchdog = [...intervals.values()].find(timer => timer.delay === 15000);
      check(Boolean(watchdog), 'Actual Big Picture window creation owns its normal watchdog');
      const beforeWatchdog = playtimeReads; clockOffset += 16000; watchdog.callback(); await frame();
      check(playtimeReads > beforeWatchdog, 'The actual app watchdog refreshes the owner Home route rather than returning at the Desktop guard');
      ownWindow.History.location.pathname = '/library/app/550';
      const beforePublic = playtimeReads, nativeMarkup = host.innerHTML; clockOffset += 16000; watchdog.callback(); await frame();
      check(playtimeReads === beforePublic && host.innerHTML === nativeMarkup,
        'The actual app watchdog preserves a public native details route without invoking shortcut hydration or mutating mounted content');
    } finally {
      actualApp.__disposeBPWindow();
      window.setTimeout = set; window.clearTimeout = clear; window.setInterval = interval; window.clearInterval = cancelInterval; Date.now = dateNow;
      delete window.uiStore;
    }
    check(apps.every(app => app.minutes_playtime_forever === 0 && app.minutes_playtime_last_two_weeks === 0), 'No native or shared overview object is mutated to repair Home text');
    ownWindow.History.location.pathname = '/library/app/550';
    const beforeNativeRoute = playtimeReads, beforeNativeText = host.textContent;
    home.activateBigPicture(document); await home.refreshBigPicture(document); await frame();
    check(playtimeReads === beforeNativeRoute && host.textContent === beforeNativeText,
      'A live public details route suppresses the Home patch even when old Home cards remain mounted');
    home.deactivateBigPicture(); ownWindow.History.location.pathname = '/routes/home';
    includeUnknown = true;
    const nativeCalls = [];
    window.SteamClient = { Apps: { GetPlaytime: id => { nativeCalls.push(id); return new Promise(() => {}); } } };
    // The actual application fixture advanced its clock; reset only the short
    // Home throttle by creating a fresh activation after its measured interval.
    await new Promise(resolve => setTimeout(resolve, 1510));
    const nativeNow = Date.now; Date.now = () => nativeNow() + 64000;
    home.activateBigPicture(document);
    const started = performance.now(), waiting = home.patchBigPictureHomePlaytime(document);
    await frame();
    check(host.textContent.includes(nativeFormat(150, '#AppBox_RecentPlayTime_')) && performance.now() - started < 700,
      'Confirmed positive Home time is visible before an unrelated native shortcut probe can reach its deadline');
    await waiting;
    check(performance.now() - started < 1600 && nativeCalls.length === 2 && nativeCalls.every(id => (id >>> 0) === B),
      'A never-settling sibling SDK lookup ends at its deadline and never probes the confirmed positive shortcut');
    home.deactivateBigPicture();
    Date.now = nativeNow;
    check(!host.textContent.includes(nativeFormat(150, '#AppBox_RecentPlayTime_')), 'Disposal restores the Home card after a timed-out native query');
    return { label: 'Big Picture native Home playtime', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: React.version };
  } finally { home.deactivateBigPicture(); dom.flushSync(() => renderer.unmount()); host.remove(); preload.remove(); homeAction.remove(); delete window.SteamUIStore; }
});
