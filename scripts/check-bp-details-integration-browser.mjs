// All four production detail tabs with independent Steam React dispatchers.
// Steam account/network/SDK calls are fixtures; no live client state is changed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';
import { nativeWindowOracle } from './helpers/native-window-oracle.mjs';

const files = {
  'linked-card-presentation': 'frontend/features/library/linked-card-presentation.ts',
  NativeBigPictureDetails: 'frontend/features/big-picture/NativeBigPictureDetails.tsx',
  NativeBigPictureCarousel: 'frontend/features/big-picture/NativeBigPictureCarousel.tsx',
  NativeBigPictureTradingCards: 'frontend/features/big-picture/NativeBigPictureTradingCards.tsx',
  details: 'frontend/features/big-picture/details.ts',
  'detail-views': 'frontend/features/big-picture/detail-views.ts',
  'detail-target': 'frontend/features/big-picture/detail-target.ts',
  'information-tab': 'frontend/features/big-picture/information-tab.tsx',
  'media-modals': 'frontend/features/big-picture/media-modals.tsx',
  'activity-section': 'frontend/features/big-picture/activity-section.tsx',
  'details-styles': 'frontend/features/big-picture/details-styles.ts',
  'panel-mount': 'frontend/features/big-picture/panel-mount.ts',
  'visibility-lease': 'frontend/features/big-picture/visibility-lease.ts',
  'transition-snapshot': 'frontend/features/big-picture/transition-snapshot.ts',
  'achievement-preview': 'frontend/features/big-picture/achievement-preview.ts',
  AppDetailsNativeComponents: 'frontend/steam/gamepad/components/AppDetailsNativeComponents.ts',
  AppDetailsNativeClasses: 'frontend/steam/gamepad/components/AppDetailsNativeClasses.ts',
  'pure-class-factory': 'frontend/steam/gamepad/components/pure-class-factory.ts',
  NativeAchievementOwnership: 'frontend/steam/gamepad/components/NativeAchievementOwnership.ts',
  NativeInformationComponents: 'frontend/steam/gamepad/components/NativeInformationComponents.ts',
  NativeStuffComponents: 'frontend/steam/gamepad/components/NativeStuffComponents.ts',
  SteamWebpackRuntime: 'frontend/steam/modules/SteamWebpackRuntime.ts',
  SteamUIModeService: 'frontend/steam/ui/SteamUIModeService.ts',
  tabs: 'frontend/features/big-picture/tabs.ts',
  AppStoreAdapter: 'frontend/steam/gamepad/stores/AppStoreAdapter.ts',
  LibraryStoreAdapter: 'frontend/steam/gamepad/stores/LibraryStoreAdapter.ts',
};
const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name,
  ts.transpileModule(fs.readFileSync(file, 'utf8') + (name === 'details'
    ? '\nexport { detailStates, renderNativeRoot, startDetailHydration };' : ''), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText]));
const windowOracle = nativeWindowOracle();
sources['native-window-oracle-data'] = `exports.id=${JSON.stringify(windowOracle.id)};exports.source=${JSON.stringify(windowOracle.factorySource)};exports.updateRoutingInfo=({${String(windowOracle.updateRoutingInfo)}}).UpdateRoutingInfo;`;
// Execute Steam's actual ContentTransition, TransitionGroup and CSSTransition,
// with its shipped CSS. Account stores and the focus primitive stay fixtures.
const steamUI = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const transitionFactories = {};
for (const file of [path.join(steamUI, 'sp.js'), ...fs.readdirSync(path.join(steamUI, 'libraries'))
  .filter(name => name.endsWith('.js')).map(name => path.join(steamUI, 'libraries', name))]) {
  const self = { webpackChunksteamui: [] };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { self });
  Object.assign(transitionFactories, ...self.webpackChunksteamui.map(chunk => chunk[1]));
}
const transitionModule = Object.entries(transitionFactories).find(([, factory]) => String(factory).includes('activeProps:new Set') && String(factory).includes('childrenKey'));
if (!transitionModule) throw Error('Installed Steam ContentTransition contract is required');
const selectedFactories = {};
function includeTransitionFactory(id) {
  if ([63696, 62540, 78325, 8658, 38850].includes(Number(id)) || selectedFactories[id]) return;
  const factory = transitionFactories[id];
  if (!factory) throw Error(`Installed transition dependency ${id} is missing`);
  selectedFactories[id] = String(factory);
  const parameters = String(factory).match(/^\(([^)]+)\)=>/)?.[1].split(',');
  if (!parameters?.[2]) return;
  for (const match of String(factory).matchAll(new RegExp(`\\b${parameters[2]}\\((\\d+)\\)`, 'g'))) includeTransitionFactory(match[1]);
}
includeTransitionFactory(transitionModule[0]);
sources['native-transition-oracle'] = `exports.id=${JSON.stringify(transitionModule[0])};exports.factories=${JSON.stringify(selectedFactories)};`;

await runBPBrowserScenario(sources, async fixture => {
  const { React, foreignReact, ReactDOM, foreignReactDOM, dom, load, loaded, req, registry, nativeRequire, nativeRegistry, nativeModules, dependencies,
    client, root, mapping, A, B, frame, check, listeners } = fixture;
  const logs = [], actions = [], nativeProps = [], modelReads = [];
  const runtime = dependencies['../../steam/modules/SteamWebpackRuntime'].steamWebpackRuntime;
	const legacySteamOptions = () => ({ enabled: false, card_border: 'normal', card_ids: [], badge_id: null });
	const communityOptions = new Map([[String(A) + ':550', legacySteamOptions()], [String(B) + ':550', legacySteamOptions()]]);
	const optionsKey = (shortcut, appid) => {
		if (!/^[1-9]\d*$/.test(shortcut) || !/^[1-9]\d*$/.test(appid)) throw Error('Invalid scoped card options fixture');
		return shortcut + ':' + appid;
	};
	dependencies['../../core/community-item-options'] = {
		communityCardId: card => 'card:' + Boolean(card.foil) + ':' + card.image,
		communityBadgeId: badge => 'badge:' + Boolean(badge.foil) + ':' + Number(badge.level || 0) + ':' + badge.image,
		getCachedCommunityItemOptions: (_doc, shortcut, appid) => communityOptions.get(optionsKey(shortcut, appid)) || null,
		getCommunityItemOptions: async (_doc, shortcut, appid) => {
			const key = optionsKey(shortcut, appid);
			if (!communityOptions.has(key)) communityOptions.set(key, { enabled: true, card_border: 'foil', card_ids: [], badge_id: null, auto_foil: true });
			return communityOptions.get(key);
		},
		subscribeCommunityItemOptions: (_doc, shortcut, appid) => { optionsKey(shortcut, appid); return () => {}; },
	};
  dependencies['../library/linked-card-presentation'] = load('linked-card-presentation');
  const originalRuntime = { ...runtime };
  const factoryReads = [];
  const factoryRequire = id => { factoryReads.push(String(id)); return registry[id] && !nativeRegistry[id] ? req(id) : nativeRequire(id); };
  Object.assign(factoryRequire, { ...nativeRequire, m: { ...registry, ...nativeRegistry,
    999999() { throw Error('Unrelated account-store factory must never initialize'); } } });
  window.webpackChunksteamui = { push: chunk => chunk[2](factoryRequire) };
  client.modules = new Map();
  const productionRuntime = load('SteamWebpackRuntime').steamWebpackRuntime;
  Object.assign(runtime, Object.fromEntries(['captureRuntime', 'getRequire', 'getAllModules', 'getRuntimeIdentity', 'getModuleFactories', 'getModuleFactoryCount', 'ensureChunk', 'authorizeSharedDocumentRuntime']
    .map(key => [key, productionRuntime[key].bind(productionRuntime)])));
  const tradingCardClasses = Object.fromEntries(['TradingCardCarouselItem', 'CardWrapper', 'Card', 'CardImage', 'Title', 'EmptyCircle', 'Owned', 'Unowned', 'BadgeImage', 'BadgeName']
    .map(key => [key, `native-card-${key}`]));
  const cardClassModule = { id: 'fixture-trading-card-css', exports: tradingCardClasses };
  runtime.getAllModules = doc => [...productionRuntime.getAllModules(doc), cardClassModule];
  const oldModeService = dependencies['../../steam/ui/SteamUIModeService'];
  dependencies['../modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  const nativeUIMode = load('SteamUIModeService');
  const originalRouter = window.g_Router;
  const windowInstance = { BrowserWindow: window, LocationPathName: '/gamepadui', IsMainGamepadUIWindow: () => true };
  const windowOracle = load('native-window-oracle-data');
  window.tempNavStore = {};
  const nativeLocation = { pathname: `/library/app/${A}/tab/WhatsNew`, search: '', hash: '' };
  windowOracle.updateRoutingInfo.call(window.tempNavStore, { location: nativeLocation }, nativeLocation);
  const nativeWindows = new Map([[window, windowInstance]]);
  const nativeWindowExports = { oy: { WindowStore: { GetWindowInstanceFromWindow: view => nativeWindows.get(view) || null } } };
  const nativeWindowFactory = module => { module.exports = nativeWindowExports; };
  nativeWindowFactory.toString = () => windowOracle.source;
  factoryRequire.m[windowOracle.id] = nativeWindowFactory;
  nativeModules[windowOracle.id] = { exports: nativeWindowExports };
  delete window.g_Router;
  Object.assign(dependencies, {
    '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
    '../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
    '../../../api/backend': { backendLog: value => logs.push(String(value)) },
    '../../api/backend': { backendLog: value => logs.push(String(value)), fetchFriendPersonasBackend: async () => [] },
    '../../../core/mappings': dependencies['../../core/mappings'],
    '../GamepadContext': load('context'),
    '../../steam/ui/SteamUIModeService': nativeUIMode,
    '../ui/SteamUIModeService': nativeUIMode,
    '../../ui/SteamUIModeService': nativeUIMode,
    '../../core/game-data': { getCachedGameData: () => null, getGameData: async () => null },
    '../../steam/shortcuts': { toSignedShortcutAppId: id => id | 0 },
    '../../steam/gamepad': { ...load('context'), gamepadRuntime: { initialize() {} } },
    '../../steam/css': { PLAYBAR_CLASSES: () => ({}), APP_DETAILS_CLASSES: () => ({}) },
    './PlaybarControllerIcons': { mountPlaybarControllerIcons: () => () => {}, disposePlaybarControllerIcons() {} },
    '../achievements/lifecycle': { ACHIEVEMENT_REFRESH_STORAGE_KEY: 'fixture-achievement-refresh' },
    '../library/community-items': { getCachedOfficialCommunityItems: () => null, getImmediateOfficialCommunityItems: () => null,
			subscribeOfficialCommunityItems: () => () => {}, getOfficialCommunityItems: async () => null,
      normalizeCommunityAssetUrl: value => String(value || '') },
    '../library/artwork': { linkedShortcutPortrait: (_id, appid) => `https://fixture.invalid/${appid}/library_600x900.jpg` },
    '../library/news': { getCachedCommunityContent: () => null, getCachedNews: () => null,
      getCommunityContent: async () => [], getNews: async () => [], eventTypeLabel: () => 'News', newsExcerpt: value => String(value) },
    '../library/social/friends': { getCachedFriendData: () => null, getFriendData: async () => null },
    '../library/social/personas': { cachePersona() {}, hasCachedPersona: () => false, getCachedPersona: () => null },
    '../library/controller': { detectConnectedController: () => ({ connected: false }),
      detectGameControllerSupport: () => ({ xbox: false, ps4: false, ps5: false }), subscribeControllerChanges: () => () => {} },
    '../../core/preferences': { defaultBigPictureModeEnabled: () => false },
    './native-info-bridge': { activateNativeGameInfoBridge() {}, deactivateNativeGameInfoBridge() {} },
    './playbar-metadata': { syncBigPicturePlaybarMetadata() {}, disposeBigPicturePlaybarMetadata() {} },
    './mapped-shortcuts-cache': { getBigPictureMappedShortcuts: () => [{ id: A, title: 'Game A', steamAppId: '550' }, { id: B, title: 'Game B', steamAppId: '550' }] },
    '../../steam/navigation': { openSteamNavigationUrl: (doc, url) => actions.push(['url', doc, url]),
      extractCommunityYoutubeId: item => item.type === 'video' ? 'abcdefghijk' : null },
  });
  dependencies['../achievements/service'].fetchLocalAchievementData = async () => null;
  Object.assign(dependencies['../library/social/feed'], { loadLocalActivityPosts: () => [], saveLocalActivityPost: () => null });
  Object.assign(dependencies['../../steam/localization'], { steamIntlLocale: () => 'en-US', steamLanguageSync: () => 'english' });
  Object.assign(dependencies['../../steam/gamepad/virtual-keyboard'], { showSteamVirtualKeyboard: () => true });
  delete dependencies['../../steam/gamepad/components/AppDetailsNativeComponents'];
  delete dependencies['../../steam/gamepad/components/AppDetailsNativeClasses'];
  const strip = document.getElementById('tabs'); strip.setAttribute('role', 'tablist'); strip.innerHTML = '';
  strip.style.minHeight = '50px'; strip.style.display = 'flex';
  const controls = new Map();
  for (const key of ['activity', 'stuff', 'community', 'info']) {
    const button = document.createElement('button'); button.textContent = { activity: 'Actividad', stuff: 'Tus cosas', community: 'Comunidad', info: 'Información del juego' }[key]; button.setAttribute('role', 'tab');
    button.id = `native-${key}`; button.setAttribute('aria-controls', `native-${key}-Content`);
    button.setAttribute('aria-selected', String(key === 'activity')); strip.appendChild(button); controls.set(key, button);
  }
  const fixtureTabs = { findBigPictureTabStrip: () => ({ strip, controls }),
    activeTabFromNative: () => [...controls].find(([, button]) => button.getAttribute('aria-selected') === 'true')?.[0] || 'activity' };
  dependencies['./tabs'] = load('tabs');
  const panel = document.createElement('section'); root.parentElement.insertBefore(panel, root); panel.appendChild(root);
  panel.id = 'native-activity-Content'; panel.setAttribute('aria-labelledby', 'native-activity');
  panel.setAttribute('role', 'tabpanel'); panel.style.minHeight = '420px';
  const sibling = document.createElement('div'); sibling.textContent = 'Native original'; sibling.style.setProperty('display', 'flex', 'important');
  sibling.setAttribute('aria-hidden', 'false'); panel.insertBefore(sibling, root);
  const previouslyHidden = document.createElement('div'); previouslyHidden.hidden = true; previouslyHidden.style.display = 'none'; panel.insertBefore(previouslyHidden, root);
  const originalSibling = sibling.outerHTML, originalHidden = previouslyHidden.outerHTML;
  const nativePublic = document.getElementById('native-public').outerHTML;
  delete window.SP_REACTDOM;
  const localUI = load('document-ui-runtime');
  const [rendererId, rendererFactory] = Object.entries(registry).find(([, factory]) => String(factory).includes('react-dom-client.production.js'));
  delete factoryRequire.m[rendererId];
  const originalButton = client.DialogButton; delete client.DialogButton;
  check(localUI.getDocumentRenderer(document) === null && !localUI.getDocumentUIComponents(document).DialogButton,
    'Absent renderer and button factories preserve a usable negative cache before their chunks arrive');
  const beforeLateFactory = runtime.getRuntimeIdentity(document);
  function LateDialogButton(props) {
    const signature = '"DialogButton","_DialogLayout","Secondary"';
    return React.createElement('button', props, props.children);
  }
  function lateButtonFactory(module) {
    const signature = '"DialogButton","_DialogLayout","Secondary"'; module.exports = { Button: LateDialogButton };
  }
  let lateFactoryScans = 0;
  const lateFactorySource = String(lateButtonFactory);
  lateButtonFactory.toString = () => { lateFactoryScans++; return lateFactorySource; };
  nativeModules[999998] = { exports: { Button: LateDialogButton } };
  factoryRequire.m[999998] = lateButtonFactory; factoryRequire.m[rendererId] = rendererFactory;
  check(localUI.getDocumentRenderer(document) === ReactDOM && localUI.getDocumentUIComponents(document).DialogButton === LateDialogButton
    && runtime.getRuntimeIdentity(document) === beforeLateFactory,
    'Appending renderer and UI factories to the same private-cache lease retries bootstrap and invalidates only missing UI capabilities');
  for (let tick = 0; tick < 100; tick++) { localUI.getDocumentRenderer(document); localUI.getDocumentUIComponents(document); }
  check(lateFactoryScans === 1 && !factoryReads.includes('999999'),
    'A warm bootstrap never rescans unchanged late-factory sources or executes unrelated account modules');
  client.DialogButton = originalButton;
  const deepReadonly = value => new Proxy(value, { set() { throw Error('Public Steam record was mutated'); },
    deleteProperty() { throw Error('Public Steam record was mutated'); } });
  const officialOverview = deepReadonly({ appid: 550, display_name: 'Official native game', controller_support: 2,
    steam_deck_compat_category: 3, steam_os_compat_category: 2, BIsShortcut: () => false, GetCanonicalReleaseDate: () => 123456 });
  const localShortcutName = 'My renamed local game';
  const localGameID = String((BigInt(A) << 32n) | 33554432n);
  const shortcutOverview = deepReadonly({ appid: A, display_name: localShortcutName, gameid: localGameID, controller_support: 0,
    BIsShortcut: () => true, BIsModOrShortcut: () => true, GetCanonicalReleaseDate: () => 0 });
  const appOverviews = new Map([[A, shortcutOverview], [B, { ...shortcutOverview, appid: B }], [550, officialOverview]]);
  window.appStore = { GetAppOverviewByAppID: id => { modelReads.push(['overview', id]); return appOverviews.get(id); } };
  window.libraryStore = { GetCollectionListForAppID: id => { modelReads.push(['collections', id]); return [{ id: 'collection-A', display_name: 'Local collection' }]; } };
  window.SteamClient = { Screenshots: { ShowScreenshotsOnDisk: id => actions.push(['screenshots', id]) } };
  originalRouter.history.push = path => actions.push(['notes-route', path]);
  const publicDetails = deepReadonly({ unAppID: 550, vecDLC: [999], vecDeckCompatTestResults: [], vecSteamOSCompatTestResults: [] });
  const localDetails = deepReadonly({ unAppID: A, vecDLC: [] });
  nativeModules[78057] = { exports: { H: { GetAppDetails: id => { modelReads.push(['details', id]); return id === 550 ? publicDetails : localDetails; } } } };
  function NativeProbe(name) {
    return props => {
      React.useState(0);
      nativeProps.push([name, props]);
      return React.createElement('div', { 'data-native-probe': name }, name,
        name === 'notes' ? React.createElement('button', { 'data-notes-parent': props.overview.BIsShortcut()
          ? props.overview.display_name.trim() : String(props.overview.appid),
          onClick: () => actions.push(['notes', props.details.unAppID]) }, 'Native notes') : null);
    };
  }
  nativeModules[57150] = { exports: { E: NativeProbe('screenshots') } };
  nativeModules[9066] = { exports: { E: NativeProbe('notes') } };
  nativeModules[3651] = { exports: { Kf: NativeProbe('dlc') } };
  nativeModules[81452] = { exports: { y: NativeProbe('workshop') } };
  nativeModules[77163] = { exports: {} }; // Native community absent: exercise real fallback cards/modals.
  class NativeInfo extends React.Component {
    OnImageLoad() {} onCollapseStarted() {} onCollapseComplete() {}
    render() { nativeProps.push(['info', this.props]); return React.createElement('div', { 'data-native-probe': 'info' }, this.props.overview.display_name); }
  }
  nativeModules[15448] = { exports: { b: NativeInfo } };
  const navContext = React.createContext(null), configContext = React.createContext(null);
  nativeModules[28869] = { exports: { TJ: navContext } };
  nativeModules[72476] = { exports: { t: configContext } };
  const native = load('AppDetailsNativeComponents');
  delete dependencies['./detail-views']; // Integration exercises the production identity projections.
  dependencies['../playtime/service'] = { getInstantPlaytimeStats: (id, metadata) => id === A && metadata === '550'
    ? { totalSeconds: 4440, minutesForever: 74, minutesLastTwoWeeks: 0, lastPlayedAt: null } : null,
    fetchPlaytimeStats: async () => ({ totalSeconds: 4440, minutesForever: 74, minutesLastTwoWeeks: 0, lastPlayedAt: null }) };
  dependencies['../playtime/playtime-settings'] = { isShortcutPlaytimeTrackingEnabled: () => true };
  dependencies['../../steam/gamepad/components/NativeStuffComponents'] = { resolveNativeStuffComponents: doc => ({
    Media: native.resolveNativeScreenshotsComponent(doc), Notes: native.resolveNativeNotesComponent(doc), Review: NativeProbe('review'), Cards: null,
    DLC: native.resolveNativeDLCComponent(doc), Workshop: native.resolveNativeWorkshopComponent(doc),
  }) };
  dependencies['./NativeBigPictureAchievements'] = load('summary');
  dependencies['./visibility-lease'] = load('visibility-lease');
  const leases = load('panel-mount');
  dependencies['./panel-mount'] = { ...leases, ensureCloudDivider() {}, ensurePlaybarControllerStat() {},
    hideBigPictureNonSteamNotices() {}, removeBigPictureFallbackPanel() {}, removeCloudDivider() {}, removePlaybarControllerStat() {}, restoreBigPictureNonSteamNotices() {} };
  const NativeDetails = load('NativeBigPictureDetails');
  const details = load('details'), owned = load('owned'), cache = load('cache'), navigation = load('navigation');
  const achievements = { found: true, appid: '550', metadata_appid: '550', total: 2, unlocked: 1,
    path: 'C:/A/state.json', achievements: [
      { name: 'FIRST', display_name: 'First achievement', description: 'A local unlock', icon: '', icon_gray: '', hidden: false, earned: true, earned_time: 1000, global_percent: 25, progress: 0, max_progress: 0 },
      { name: 'SECOND', display_name: 'Second achievement', description: 'Still locked', icon: '', icon_gray: '', hidden: false, earned: false, earned_time: 0, global_percent: 10, progress: 0, max_progress: 0 },
    ] };
  cache.cacheLocalAchievements(achievements, '550', String(A));
  const data = { achievements, game: { name: 'Linked metadata title', short_description: 'Official description', developers: ['Developer'], publishers: ['Publisher'],
    release_date: { date: '1 Jan, 2000' }, categories: [{ id: 30, description: 'Workshop' }], dlc: [999],
    screenshots: [{ path_full: 'https://images.invalid/screen.png' }], website: 'https://game.invalid/' },
    news: [{ gid: '1', title: 'Production news item', contents: 'News body', date: 1000000, url: 'https://steamcommunity.com/games/550/announcements/detail/1' }],
    community: [{ type: 'screenshot', title: 'Public screenshot', image: 'https://images.invalid/public.png' },
      { type: 'video', title: 'Public video', image: 'https://images.invalid/video.png', youtube_id: 'abcdefghijk' }],
    cards: { appid: '550', cards: [{ title: 'Catalog card', image: 'https://images.invalid/catalog-card.png', artwork: 'https://images.invalid/catalog-art.png' }],
      badges: [{ title: 'Catalog maximum badge', image: 'https://images.invalid/catalog-max-badge.png', level: 5 }],
      foil_badge: { title: 'Catalog foil badge', image: 'https://images.invalid/catalog-foil-badge.png', foil: true, level: 1 } }, friends: null };
  const state = { shortcut: { id: A, steamAppId: '550', title: 'Game A' }, language: 'english', generation: 1,
    root, panel, activeTab: 'activity', data, hydrationStarted: false };
  details.detailStates.set(document, state);
  let activeTab = 'activity';
  const showTab = async key => {
    activeTab = key; state.activeTab = key;
    for (const [name, button] of controls) button.setAttribute('aria-selected', String(name === key));
    details.renderNativeRoot(document, state); await frame();
  };
  await details.refreshBigPictureShortcutDetails(document);
  check(!window.g_Router && !window.uiStore && !window.SteamUIStore && !document.querySelector('.GamepadUI,.gamepadui')
    && document.location.pathname === '/library' && nativeUIMode.steamUIModeService.isGamepadUI(document)
    && load('context').isCurrentLinkedGamepadTarget(document, A, '550'),
    'The full refresh entry mounts from the native local NavStore route while WindowInstance and browser retain their shell paths');
  check(!('c' in factoryRequire) && productionRuntime.getRequire(document) && loaded['document-ui-runtime'].getDocumentRenderer(document) === ReactDOM,
    'Authentic factory-only Steam require.m without require.c bootstraps the owner React and renderer without renderer globals');
  check(!sibling.hidden, 'Native panel content stays visible until the first React commit');
  await frame();
  check(root.textContent.includes('Production news item') && !logs.some(line => line.includes('failed:')), 'Activity executes production hooks on owner React, including composer and news');
  check(sibling.hidden && sibling.style.getPropertyValue('display') === 'none' && root.childElementCount > 0,
    'The native sibling is hidden only after the production React tree commits');
  check(previouslyHidden.hidden, 'A previously hidden Steam node is never revived by mounting');
  check(factoryReads.includes('63696') && factoryReads.some(id => String(registry[id]).includes('react-dom-client.production.js'))
    && !factoryReads.includes('999999') && new Set(factoryReads).size < 30,
    'The full production Activity mount initializes only selected local exports and leaves unrelated Steam factories untouched');
  const newsCard = [...root.querySelectorAll('[tabindex]')].filter(node => node.textContent.includes('Production news item')).at(-1);
  check(Boolean(newsCard), 'Production news card exposes an interactive focus target');
  newsCard.focus(); newsCard.click(); await frame();
  check(document.getElementById('gdl-bp-news-modal')?.textContent.includes('News body'), 'Activity opens the production owned news modal');
  document.querySelector('.gdl-bp-news-modal-close')?.click(); await frame();
  check(!document.getElementById('gdl-bp-news-modal') && document.activeElement === newsCard, 'Closing news returns focus to its card');

  // Exercise the real native tab listener instead of directly rendering a tab.
  // A requested tab must not mark itself rendered before React receives it.
  for (const [key, button] of controls) button.setAttribute('aria-selected', String(key === 'stuff'));
  controls.get('stuff').click();
  const firstStuffPaint = await new Promise(resolve => requestAnimationFrame(() => resolve(root.textContent)));
  check(!firstStuffPaint.includes('Production news item') && firstStuffPaint.includes('Catalog'),
    'The first paint after native tab selection contains Stuff, never the previous Activity tree');
  await new Promise(resolve => setTimeout(resolve, 65)); await frame();
  check(details.detailStates.get(document)?.activeTab === 'stuff' && root.querySelector('.gdl-bp-trading-card')
    && !root.textContent.includes('Production news item'), 'Native Activity-to-Stuff input replaces the old content without waiting for data hydration');
  const newerAchievements = { ...achievements, achievements: achievements.achievements.map((item, index) => index === 0
    ? { ...item, display_name: 'Newest cached local achievement', icon: 'https://images.invalid/preloaded-achievement.png' } : item) };
  cache.cacheLocalAchievements(newerAchievements, '550', String(A));
  details.renderNativeRoot(document, state); await frame();
  check(root.textContent.includes('Newest cached local achievement') && root.querySelector('[data-gdl-focus-key^="achievement-summary-"]'),
    'A newer authorized shortcut cache renders immediately while parent hydration props still contain the previous snapshot');
  check(document.head.querySelector('link[rel="preload"][as="image"][href$="preloaded-achievement.png"]'),
    'Visible achievement image requests begin from the owning detail cache without waiting for Stuff to mount');
  cache.cacheLocalAchievements(achievements, '550', String(A));
  for (const [key, button] of controls) button.setAttribute('aria-selected', String(key === 'activity'));
  controls.get('activity').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const firstActivityPaint = await new Promise(resolve => requestAnimationFrame(() => resolve(root.textContent)));
  check(firstActivityPaint.includes('Production news item') && !root.querySelector('.gdl-bp-trading-card'),
    'Keyboard tab selection commits Activity before its first paint');
  await new Promise(resolve => setTimeout(resolve, 65)); await frame();
  check(root.textContent.includes('Production news item') && !root.querySelector('.gdl-bp-trading-card'),
    'Native keyboard activation also replaces Stuff with Activity without stale content');
  const lateNative = document.createElement('div'); lateNative.textContent = 'Late Steam tab content';
  lateNative.style.display = 'flex';
  const lateNativeBefore = lateNative.outerHTML;
  panel.appendChild(lateNative);
  const lateNativePaint = await new Promise(resolve => requestAnimationFrame(() => resolve(getComputedStyle(lateNative).display)));
  check(lateNativePaint === 'none' && !root.hidden,
    'Native content appended after a linked commit cannot flash beside the active linked tab');
  lateNative.remove(); await frame();
  check(lateNative.outerHTML === lateNativeBefore, 'A detached native replacement regains its original visibility properties');

  // Steam's actual SP BPM has a document.write popup with no own JavaScript.
  // Its native tree is a portal from SharedJSContext, whose WindowStore binds
  // the popup BrowserWindow. Reproduce that architecture with installed React.
  const popupObserverBaseline = fixture.observerCount(), popupListenerBaseline = listeners.size;
  const popupActionsBaseline = actions.length;
  const childFrame = document.createElement('iframe');
  childFrame.style.cssText = 'position:fixed;inset:0;width:1280px;height:900px;z-index:100;border:0';
  const childLoaded = new Promise(resolve => { childFrame.onload = resolve; });
  childFrame.src = '/library'; document.body.appendChild(childFrame); await childLoaded;
  const childView = childFrame.contentWindow, childDoc = childFrame.contentDocument;
  childDoc.open(); childDoc.write('<!doctype html><html><head><title>SP BPM</title></head><body><div id="popup_target"></div></body></html>'); childDoc.close();
  childView.history.replaceState({}, '', '/index.html');
  for (const style of document.querySelectorAll('style')) childDoc.head.appendChild(style.cloneNode(true));
  const childLocation = { pathname: `/library/app/${A}/tab/WhatsNew`, search: '', hash: '' };
  const childInstance = { BrowserWindow: childView, IsMainGamepadUIWindow: () => true,
    get LocationPathName() { return childLocation.pathname; }, History: { location: childLocation } };
  nativeWindows.set(childView, childInstance);
  const childTabNames = { activity: 'Actividad', stuff: 'Tus cosas', community: 'Comunidad', info: 'Información del juego' };
  const childNativeIds = { activity: 'WhatsNew', stuff: 'YourStuff', community: 'Community', info: 'GameInfo' };
  const transitionOracle = load('native-transition-oracle'), transitionModules = {};
  const transitionRequire = id => {
    if (id === 8658) return { A: (...values) => values.filter(Boolean).join(' ') };
    if (id === 38850) return { Z: props => React.createElement('div', { className: props.className }, props.children) };
    if (!transitionOracle.factories[id]) return req(id);
    if (transitionModules[id]) return transitionModules[id].exports;
    const module = transitionModules[id] = { exports: {} };
    new Function(`return (${transitionOracle.factories[id]})`)()(module, module.exports, transitionRequire);
    return module.exports;
  };
  Object.assign(transitionRequire, { d: req.d, n: req.n, r: req.r, o: req.o });
  const nativeTransition = transitionRequire(transitionOracle.id), tabCSS = nativeRequire(62645);
  let selectChildTab;
  function NativePopupDetails() {
    const [selected, select] = React.useState('activity'); selectChildTab = select;
    return React.createElement('div', { className: `native-popup-details ${tabCSS.GamepadTabbedPage}` },
      React.createElement('div', { role: 'tablist', style: { display: 'flex', minHeight: 50 } },
        ...Object.entries(childTabNames).map(([key, title]) => React.createElement('button', {
          key, id: `child-${key}`, role: 'tab', 'aria-selected': selected === key,
          'aria-controls': `child-${key}-Content`, onClick() {
            childLocation.pathname = `/library/app/${A}/tab/${childNativeIds[key]}`; select(key);
          },
        }, title))),
      React.createElement('div', { className: tabCSS.TabContents, style: { height: 520 } },
        React.createElement(nativeTransition.FF, { childrenKey: selected, directionClass: tabCSS.Right,
          childrenClasses: nativeTransition.Qh(tabCSS, tabCSS.ContentTransition) },
          React.createElement('section', { id: `child-${selected}-Content`, role: 'tabpanel',
            className: `${tabCSS.TabContentsScroll} _TabContentsScroll`, 'aria-labelledby': `child-${selected}`, style: { minHeight: 420 } },
          React.createElement('div', { 'data-native-popup-content': selected, style: { display: 'flex' } }, `Native popup ${selected}`)))));
  }
  const portalHost = document.createElement('div'); document.body.appendChild(portalHost);
  const nativePortalRoot = ReactDOM.createRoot(portalHost);
  dom.flushSync(() => nativePortalRoot.render(dom.createPortal(React.createElement(NativePopupDetails), childDoc.getElementById('popup_target'))));
  const childNativeActivity = childDoc.querySelector('[data-native-popup-content="activity"]');
  const childActivityBefore = childNativeActivity.outerHTML;
  const childDataMocks = [
    [dependencies['../../core/game-data'], 'getCachedGameData', () => ({ data: data.game })],
    [dependencies['../../core/game-data'], 'getGameData', async () => ({ data: data.game })],
    [dependencies['../library/news'], 'getCachedNews', () => ({ data: data.news })],
    [dependencies['../library/news'], 'getNews', async () => data.news],
    [dependencies['../library/social/friends'], 'getFriendData', async () => ({ data: null })],
  ].map(([owner, key, value]) => { const prior = owner[key]; owner[key] = value; return () => { owner[key] = prior; }; });
  check(childDoc.location.pathname === '/index.html' && !childView.webpackChunksteamui && !childView.g_Router
    && !childView.tempNavStore && !childView.SteamUIStore && !childView.SP_REACT && !childView.SP_REACTDOM,
    'Native portal popup exposes only its shell document, without a child runtime, router or React globals');
  check(childDoc.querySelectorAll('[role=tab]').length === 4 && childDoc.querySelectorAll('[role=tabpanel]').length === 1
    && Object.keys(childNativeActivity).some(key => key.startsWith('__reactFiber$')),
    'Installed parent React commits the four tabs and Steam ContentTransition active panel into the child through createPortal');
  await details.refreshBigPictureShortcutDetails(childDoc); await frame(); await frame();
  const childRoot = childDoc.getElementById('gdl-bp-detail-root');
  check(childRoot?.textContent.includes('Production news item') && childRoot.dataset.gdlShortcutAppId === String(A),
    'Full production refresh mounts Activity inside a scriptless native popup using its exact shared WindowStore owner');
  check(productionRuntime.getRequire(childDoc) && localUI.getDocumentReact(childDoc) === React
    && localUI.getDocumentRenderer(childDoc) === ReactDOM,
    'The native child gets the same paired React and renderer that Steam used for its parent portal');
  check(childNativeActivity.hidden && childRoot.childElementCount > 0 && !logs.some(line => line.includes('failed:')),
    'Only the owned child panel is hidden after its shared renderer commits successfully');
  childDoc.getElementById('child-stuff').click();
  const popupStuffPaint = await new Promise(resolve => requestAnimationFrame(() => resolve({
    parent: childRoot.parentElement?.id, text: childRoot.textContent,
    nativeHidden: childDoc.querySelector('[data-native-popup-content="stuff"]').hidden,
    outgoingHidden: childNativeActivity.hidden,
  })));
  check(popupStuffPaint.parent === 'child-stuff-Content' && popupStuffPaint.text.includes('Achievements')
    && !popupStuffPaint.text.includes('Production news item') && popupStuffPaint.nativeHidden && popupStuffPaint.outgoingHidden,
    `A real shared React portal tab switch moves and commits the linked Stuff root before the first paint: ${JSON.stringify(popupStuffPaint)}`);
  const outgoingSnapshot = childDoc.querySelector('[data-gdl-bp-transition-snapshot]');
  check(childDoc.querySelectorAll('[role=tabpanel]').length === 2 && outgoingSnapshot?.textContent.includes('Production news item')
    && outgoingSnapshot.inert && outgoingSnapshot.getAttribute('aria-hidden') === 'true'
    && !outgoingSnapshot.querySelector('[data-gdl-shortcut-app-id],[data-gdl-steam-app-id],[data-gdl-focus-key]'),
    'Real native ContentTransition retains a passive outgoing Activity image while the single live root renders Stuff');
  check(new Set([...childDoc.querySelectorAll('[id]')].map(node => node.id)).size === childDoc.querySelectorAll('[id]').length,
    'Concurrent native panels and the outgoing snapshot have no duplicate IDs');
  await new Promise(resolve => setTimeout(resolve, 400)); await frame();
  check(childDoc.querySelectorAll('[role=tabpanel]').length === 1 && !childDoc.querySelector('[data-gdl-bp-transition-snapshot]')
    && !childNativeActivity.hidden, 'Native transition completion removes its outgoing snapshot and restores detached native properties');
  childDoc.getElementById('child-activity').click();
  await new Promise(resolve => requestAnimationFrame(resolve));
  check(childRoot.parentElement?.id === 'child-activity-Content' && childRoot.textContent.includes('Production news item')
    && childDoc.querySelector('[data-native-popup-content="activity"]').hidden, 'Returning to Activity in the real native tab tree never exposes the native replacement');
  await new Promise(resolve => setTimeout(resolve, 400)); await frame();
  const transitionObserverBaseline = fixture.observerCount(), headerBounds = childDoc.querySelector('[role=tablist]').getBoundingClientRect();
  for (let index = 0; index < 20; index++) {
    const selected = ['stuff', 'community', 'info', 'activity'][index % 4];
    childDoc.getElementById(`child-${selected}`).click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const active = childDoc.getElementById(`child-${selected}-Content`), snapshots = [...childDoc.querySelectorAll('[data-gdl-bp-transition-snapshot]')];
    check(childRoot === childDoc.getElementById('gdl-bp-detail-root') && childRoot.parentElement === active && childRoot.childElementCount > 0
      && active.querySelector('[data-native-popup-content]').hidden,
      `Rapid native transition ${index} commits the same live owner to ${selected} before paint without a native notice frame: ${JSON.stringify({ parent: childRoot.parentElement?.id, requested: active?.id, tab: details.detailStates.get(childDoc)?.activeTab, children: childRoot.childElementCount, hidden: active?.querySelector('[data-native-popup-content]')?.hidden, same: childRoot === childDoc.getElementById('gdl-bp-detail-root'), runtime: NativeDetails.isNativeBigPictureDetailsRuntimeCurrent(childRoot), log: logs.slice(-6) })}`);
    check(snapshots.every(snapshot => snapshot.inert && snapshot.getAttribute('aria-hidden') === 'true'
      && !snapshot.querySelector('[data-gdl-shortcut-app-id],[data-gdl-steam-app-id],[data-gdl-gamepad-action]'))
      && snapshots.length <= childDoc.querySelectorAll('[role=tabpanel]').length - 1,
      `Rapid native transition ${index} keeps only passive outgoing presentations bounded by Steam's retained panels`);
    const bounds = childDoc.querySelector('[role=tablist]').getBoundingClientRect();
    check(bounds.top === headerBounds.top && bounds.height === headerBounds.height,
      `Rapid native transition ${index} leaves the native header stationary`);
  }
  await new Promise(resolve => setTimeout(resolve, 450)); await frame();
  check(!childDoc.querySelector('[data-gdl-bp-transition-snapshot]') && childDoc.querySelectorAll('[role=tabpanel]').length === 1
    && fixture.observerCount() === transitionObserverBaseline,
    'Twenty rapid real native transitions release every outgoing snapshot, visibility observer and panel');
  const childRequireLease = productionRuntime.getRequire(childDoc);
  const wrongFrame = document.createElement('iframe');
  const wrongLoaded = new Promise(resolve => { wrongFrame.onload = resolve; });
  wrongFrame.src = '/library'; document.body.appendChild(wrongFrame); await wrongLoaded;
  const wrongDoc = wrongFrame.contentDocument;
  wrongDoc.open(); wrongDoc.write('<!doctype html><html><head><title>SP BPM</title></head><body><div role="tablist"><button role="tab">Actividad</button><button role="tab">Tus cosas</button><button role="tab">Comunidad</button><button role="tab">Información del juego</button></div><section role="tabpanel">Unregistered native window</section></body></html>'); wrongDoc.close();
  wrongFrame.contentWindow.history.replaceState({}, '', '/index.html');
  const wrongBefore = wrongDoc.body.outerHTML;
  await details.refreshBigPictureShortcutDetails(wrongDoc); await frame();
  check(!productionRuntime.getRequire(wrongDoc) && !wrongDoc.getElementById('gdl-bp-detail-root') && wrongDoc.body.outerHTML === wrongBefore,
    'A different scriptless document cannot borrow the registered popup renderer or change its native markup');
  childLocation.pathname = '/library/app/550/tab/WhatsNew';
  check(!load('context').isCurrentLinkedGamepadTarget(childDoc, A, '550'),
    'The exact child route immediately revokes linked authority on a public native game');
  await details.refreshBigPictureShortcutDetails(childDoc); await frame();
  check(!childDoc.getElementById('gdl-bp-detail-root') && childNativeActivity.outerHTML === childActivityBefore,
    'Navigating the native portal popup to a public game releases the linked root and restores its original native panel');
  check(actions.length === popupActionsBaseline && document.getElementById('native-public').outerHTML === nativePublic,
    'Shared popup rendering and navigation perform no account writes or changes to public native games');
  nativeWindows.delete(childView);
  let retainedChildRejected = false;
  try { childRequireLease(63696); } catch { retainedChildRejected = true; }
  check(retainedChildRejected && !productionRuntime.getRequire(childDoc) && productionRuntime.getRequire(document),
    'Removing the exact native BrowserWindow binding revokes a retained child require without invalidating its shared parent');
  details.disposeBigPictureShortcutDetails(childDoc); details.disposeBigPictureShortcutDetails(wrongDoc);
  dom.flushSync(() => nativePortalRoot.unmount());
  childFrame.remove(); wrongFrame.remove(); portalHost.remove();
  for (const restore of childDataMocks) restore();
  await frame();
  check(listeners.size === popupListenerBaseline && fixture.observerCount() === popupObserverBaseline,
    'Native shared popup teardown leaves no child subscriptions, observers or roots');

  delete nativeModules[windowOracle.id]; delete factoryRequire.m[windowOracle.id]; delete window.tempNavStore; window.g_Router = originalRouter;
  dependencies['./tabs'] = fixtureTabs;
  Object.assign(nativeUIMode.steamUIModeService, oldModeService.steamUIModeService);
  Object.assign(runtime, originalRuntime); runtime.getAllModules = () => [cardClassModule]; window.SP_REACTDOM = ReactDOM;
  leases.restoreNativePanelChildren(panel);
  state.activeTab = 'info'; details.renderNativeRoot(document, state);
  state.activeTab = 'stuff'; await frame();
  check(!sibling.hidden, 'A queued commit for a retired tab cannot hide the current native panel');
  state.activeTab = 'info'; details.renderNativeRoot(document, state);
  details.detailStates.set(document, { ...state, generation: 2 }); root.dataset.gdlBpGeneration = '2';
  await frame(); check(!sibling.hidden, 'A queued commit for a retired detail generation cannot take over the native panel');
  details.detailStates.set(document, state); root.dataset.gdlBpGeneration = '1';
  await showTab('stuff');
  const catalogCard = root.querySelector('.gdl-bp-trading-card');
  check(catalogCard?.textContent.includes('Catalog card') && !catalogCard.querySelector(`.${tradingCardClasses.Owned}`)
    && !catalogCard.classList.contains(tradingCardClasses.Owned), 'Public catalog cards retain unknown ownership instead of borrowing an Owned style');
  check(!root.querySelector('img[src*="catalog-foil-badge"]') && !root.querySelector('img[data-gdl-badge-preview="1"]'),
    'Unknown personal inventory keeps public catalogue cards without inventing an earned foil badge');
  const badgeProgress = root.querySelector('[data-gdl-focus-key="trading-cards-badge-550"]');
  check(badgeProgress?.tagName === 'BUTTON', 'The localized badge-page action retains its stable exact-AppID focus key');
  badgeProgress.click(); check(actions.at(-1)?.[2] === 'https://steamcommunity.com/my/gamecards/550',
    'Catalog badge availability provides only the explicit personal badge-progress URL');
  for (const name of ['screenshots', 'notes']) {
    const props = nativeProps.filter(([kind]) => kind === name).at(-1)?.[1];
    check(props?.overview.appid === A && props?.details.unAppID === A, `${name} uses the real shortcut for personal operations`);
  }
  const review = nativeProps.filter(([kind]) => kind === 'review').at(-1)?.[1];
  check(review?.overview.appid === 550 && review.details.unAppID === 550 && review.details.nPlaytimeForever === 74
    && review.overview.minutes_playtime_forever === 74 && publicDetails.nPlaytimeForever === undefined,
    'Review uses public action identity with exact linked playtime through local views and no native record writes');
  check([...root.querySelectorAll('[data-native-probe]')].map(node => node.dataset.nativeProbe).join(',') === 'dlc,workshop,screenshots,review,notes',
    'Tus cosas keeps native DLC, Workshop, Media, Review and Notes section order');
  const nativeNotesButton = document.querySelector('[data-native-probe=notes] button'); nativeNotesButton.click();
  check(nativeNotesButton.dataset.notesParent === localShortcutName && nativeNotesButton.dataset.notesParent !== data.game.name,
    'A renamed shortcut retains its actual native notes parent, independently of the public metadata title');
  check(nativeProps.filter(([kind]) => kind === 'screenshots').at(-1)?.[1].overview.gameid === localGameID,
    'Native media receives the exact non-Steam 64-bit GameID without numeric coercion');
  check(actions.at(-1)?.[0] === 'notes' && actions.at(-1)?.[1] === A, 'Native notes destination remains the shortcut AppID');
  const actionCount = actions.length;
  const nativeGamepadCallback = () => actions.push(['native-gamepad', A]);
  nativeNotesButton.addEventListener('vgp_onbuttondown', nativeGamepadCallback);
  window.g_Router.history.location.pathname = '/routes/library/app/550';
  nativeNotesButton.click();
  const staleGamepad = new CustomEvent('vgp_onbuttondown', { bubbles: true, cancelable: true }); nativeNotesButton.dispatchEvent(staleGamepad);
  check(actions.length === actionCount && staleGamepad.defaultPrevented, 'Native child click and gamepad callbacks are blocked on a native destination before DOM cleanup');
  nativeNotesButton.removeEventListener('vgp_onbuttondown', nativeGamepadCallback);
  window.g_Router.history.location.pathname = `/routes/library/app/${A}`;
  await showTab('stuff');
  const queuedNotesButton = document.querySelector('[data-native-probe=notes] button');
  queuedNotesButton.addEventListener('vgp_onbuttondown', nativeGamepadCallback);
  check(NativeDetails.mountNativeBigPictureDetails(root, { document, shortcut: state.shortcut, generation: 1, data,
    tab: 'stuff', hydrating: false, panel }), 'A new exact owner render can be queued');
  queuedNotesButton.click();
  const pendingGamepad = new CustomEvent('vgp_onbuttondown', { bubbles: true, cancelable: true }); queuedNotesButton.dispatchEvent(pendingGamepad);
  check(actions.length === actionCount && pendingGamepad.defaultPrevented, 'Old native children remain inert while a new owner is queued but not committed');
  await frame(); document.querySelector('[data-native-probe=notes] button').click();
  check(actions.length === actionCount + 1 && actions.at(-1)?.[1] === A, 'Native child actions resume once the new exact owner commits');
  queuedNotesButton.removeEventListener('vgp_onbuttondown', nativeGamepadCallback);
  for (const name of ['dlc', 'workshop']) check(nativeProps.filter(([kind]) => kind === name).at(-1)?.[1].details.unAppID === 550,
    `${name} reads official metadata without borrowing personal progress`);
  const achievementOpener = root.querySelector('[data-gdl-focus-key^="achievement-summary-"]'); achievementOpener.focus(); achievementOpener.click(); await frame();
  check(document.getElementById('gdl-bp-achievements-screen')?.textContent.includes('1 of 2'), 'Tus cosas opens the complete production shortcut achievement screen');
  owned.disposeBigPictureModals(document);
  nativeModules[9066].exports = {}; nativeModules[57150].exports = {};
  native.clearNativeComponentsCache(document); await showTab('activity'); await showTab('stuff');
  const fallbackNotes = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Abrir notas'));
  check(Boolean(fallbackNotes), 'Missing native notes component retains an actionable owned fallback');
  fallbackNotes.click(); check(actions.at(-1)?.[0] === 'notes-route' && actions.at(-1)?.[1] === `/notes/app/${A}/`,
    'Fallback notes use the native owner history route without a fabricated SteamClient.GameNotes.OpenGameNotes API');
  const localScreenshots = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Mostrar en disco'));
  check(Boolean(localScreenshots) && !root.querySelector('img[src="https://images.invalid/screen.png"]')
    && !root.querySelector('img[src="https://images.invalid/public.png"]'), 'Personal screenshot fallback exposes local files without substituting Store or community promotional media');
  localScreenshots.click(); check(actions.at(-1)?.[0] === 'screenshots' && actions.at(-1)?.[1] === localGameID && localGameID !== String(A),
    'Fallback screenshot manager targets the exact 64-bit GameID, preserving non-Steam media identity');
  function NativeTradingCard(props) {
    React.useState(0); nativeProps.push(['trading-card', props]); return React.createElement('span', null, props.data.strTitle);
  }
  nativeModules[22165] = { exports: { dI: NativeTradingCard } };
  native.clearNativeComponentsCache(document); await showTab('activity'); await showTab('stuff');
  const neutralCard = root.querySelector('.gdl-bp-trading-card');
  check(!nativeProps.some(([kind]) => kind === 'trading-card') && neutralCard?.textContent.includes('Catalog card')
    && neutralCard.querySelector('img')?.getAttribute('src') === 'https://images.invalid/catalog-card.png',
    'Unknown catalog inventory uses a neutral title/image tile even when the account-backed native card is available');
  check(neutralCard.getAttribute('tabindex') === '0' && !neutralCard.querySelector('button,input,select,textarea,a[href],[tabindex]'),
    'The catalog preview owns one focus target without a nested native inventory control');
  check(!neutralCard.matches(`.${tradingCardClasses.Owned},.${tradingCardClasses.Unowned}`)
    && !neutralCard.querySelector(`.${tradingCardClasses.Owned},.${tradingCardClasses.Unowned}`),
    'Unknown catalog inventory acquires neither Owned nor Unowned personal presentation');
  const progress = client.ProgressBar; delete client.ProgressBar; loaded['document-ui-runtime'].clearDocumentUIRuntime(document);
  await showTab('activity'); await showTab('stuff');
  const fallbackProgress = root.querySelector('[role="progressbar"]');
  check(fallbackProgress?.getAttribute('aria-valuenow') === '50' && fallbackProgress.style.width === '50%',
    'The native achievement fill retains correct 0–100 percent semantics without the generic progress component');
  client.ProgressBar = progress; loaded['document-ui-runtime'].clearDocumentUIRuntime(document);
  const resources = new Map();
  const deferred = name => new Promise(resolve => resources.set(name, resolve));
  dependencies['../../core/game-data'].getGameData = () => deferred('game');
  dependencies['../achievements/service'].fetchLocalAchievementData = () => deferred('achievements');
  dependencies['../library/news'].getNews = () => deferred('news');
  dependencies['../library/news'].getCommunityContent = () => deferred('community');
  dependencies['../library/community-items'].getOfficialCommunityItems = () => deferred('cards');
  dependencies['../library/social/friends'].getFriendData = () => deferred('friends');
  state.data = { ...data, news: [] }; state.hydrationStarted = false;
  await showTab('activity'); details.startDetailHydration(document, state); await frame();
  check(state.pendingResources === 6 && root.querySelector('.gdl-bp-loading'), 'All six pending resources produce a real owner loading state');
  for (const [name, resolve] of resources) if (name !== 'friends') resolve(['news', 'community'].includes(name) ? [] : null);
  await frame(); check(state.pendingResources === 1 && root.querySelector('.gdl-bp-loading'), 'Five completions keep loading active while the last resource is pending');
  resources.get('friends')({ data: null }); await frame();
  check(state.pendingResources === 0 && !root.querySelector('.gdl-bp-loading'), 'The final resource completion removes empty-content loading instead of spinning forever');
  state.data = data;
  await showTab('community');
  check(root.textContent.includes('Public screenshot') && root.textContent.includes('Public video'), 'Community renders real fallback content with owner primitives');
  const screenshot = root.querySelector('[data-id="screenshot-0"]'); screenshot.focus(); screenshot.click(); await frame();
  check(document.querySelector('#gdl-bp-community-modal img')?.getAttribute('src') === 'https://images.invalid/public.png', 'Community screenshot opens an owned image modal');
  owned.disposeBigPictureModals(document);
  root.querySelector('[data-id="video-1"]').click(); await frame();
  check(document.querySelector('#gdl-bp-community-modal iframe')?.getAttribute('src')?.includes('youtube-nocookie.com/embed/abcdefghijk'), 'Video uses the production owned privacy-enhanced embed');
  const externalCloseObservers = fixture.observerCount(); fixture.externalCloseLatestModal(); await frame();
  check(!document.getElementById('gdl-bp-community-modal') && fixture.observerCount() === externalCloseObservers - 2,
    'Steam removing an owned modal externally still releases its lifecycle observers');
  screenshot.focus(); screenshot.click(); await frame();
  const baselineModeObservers = fixture.observerCount();
  const modeService = dependencies['../../steam/ui/SteamUIModeService'].steamUIModeService;
  modeService.isGamepadUI = () => false; document.body.classList.add('fixture-mode-change'); await frame();
  check(!document.getElementById('gdl-bp-community-modal') && fixture.observerCount() <= baselineModeObservers - 2,
    'Changing UI mode without changing route retires both modal observers');
  modeService.isGamepadUI = () => true; document.body.classList.remove('fixture-mode-change');
  await showTab('info');
  const info = nativeProps.filter(([kind]) => kind === 'info').at(-1)?.[1];
  check(info?.overview.appid === A && info.details.unAppID === A && info.overview.display_name === data.game.name,
    'Information gets a component-local metadata view while keeping shortcut identity');
  check(info.overview.BIsShortcut() === false && shortcutOverview.BIsShortcut() === true, 'Presentation classification never mutates the real shortcut overview');
  check(modelReads.some(([kind, id]) => kind === 'collections' && id === A), 'Collections are read for the shortcut, not the official game');
  const storeButton = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Página de la tienda'));
  storeButton.click(); check(actions.at(-1)?.[2] === 'https://store.steampowered.com/app/550/', 'The public Store link uses metadata AppID');
  const collectionsButton = [...root.querySelectorAll('button')].find(button => button.textContent.includes('Local collection'));
  const originalPush = window.g_Router.history.push;
  window.g_Router.history.push = route => actions.push(['route', route]);
  collectionsButton.click(); check(actions.at(-1)?.[1] === '/library/collection/collection-A', 'Local collections use the owning window router');
  window.g_Router.history.push = originalPush;
  const savedRouter = window.g_Router, savedTempNav = window.tempNavStore;
  delete window.g_Router;
  window.tempNavStore = { m_history: { location: { pathname: `/routes/library/app/${A}` },
    push: route => actions.push(['local-history', route]) } };
  collectionsButton.click();
  check(actions.at(-1)?.[0] === 'local-history' && actions.at(-1)?.[1] === '/library/collection/collection-A',
    'Collection fallback navigates through the owning document history when no global router exists');
  const beforeRetiredCollection = actions.length;
  window.tempNavStore.m_history.location.pathname = '/routes/library/app/550';
  collectionsButton.click();
  check(actions.length === beforeRetiredCollection, 'A retired collection button cannot navigate away from a native game');
  window.g_Router = savedRouter;
  if (savedTempNav === undefined) delete window.tempNavStore; else window.tempNavStore = savedTempNav;
  let unsafeQuickLinkReads = 0;
  function NativeLink({ url, label, link, isVisible }) {
    React.useState(0); nativeProps.push(['native-link', { url, label, link, isVisible }]);
    const onActivate = () => actions.push(['url', document, url]);
    return React.createElement(client.Focusable, { role: 'link', onActivate, onClick: onActivate, 'data-native-link': url }, label);
  }
  function CollectionCard({ collection, eCoverSize, bStartFocused, bNoFooterFilter }) {
    React.useState(0); nativeProps.push(['collection-card', { collection, eCoverSize, bStartFocused, bNoFooterFilter }]);
    return React.createElement('button', { 'data-native-collection': collection.id,
      onClick: () => actions.push(['route', `/library/collection/${collection.id}`]) }, collection.displayName);
  }
  function CollectionWrapper(props) { return React.createElement('div', { style: { display: 'contents' }, role: 'gridcell', ...props }); }
  function CollectionGrid({ childElements, childWidth, scaleGridItems, paddingLeft, ...rest }) {
    React.useState(0); nativeProps.push(['collection-grid', { childWidth, scaleGridItems, paddingLeft, ...rest }]);
    return React.createElement('div', { role: 'grid', 'data-native-grid': 'collections' }, childElements);
  }
  const nativeCollection = Object.freeze({ id: 'native-collection-A', displayName: 'Native collection A', visibleApps: Object.freeze([]), bIsEditable: false, bIsDynamic: false });
  nativeModules[52470] = { exports: { aX: NativeLink, Qd: () => { unsafeQuickLinkReads++; throw Error('Account-backed quick-link helper must not run'); } } };
  nativeModules[14663] = { exports: { F9: React.memo(props => React.createElement(CollectionCard, props)), R0: () => null, T4: () => 1,
    lc: () => null, lp: () => [], V$: { childWidth: 185, childHeight: 185, gridColumnGap: 22, gridRowGap: 22 } } };
  nativeModules[18489] = { exports: { Ei: CollectionWrapper } };
  nativeModules[59298] = { exports: { i: CollectionGrid } };
  nativeModules[96000] = { exports: { md: { GetCollectionListForAppID(id) { modelReads.push(['native-collections', id]); return [nativeCollection]; } } } };
  const newRuntime = {}; runtime.getRuntimeIdentity = () => newRuntime;
  await showTab('info');
  const nativeStoreLink = root.querySelector('[data-native-link="https://store.steampowered.com/app/550/"]');
  check(Boolean(nativeStoreLink), 'Available native individual quick links replace generic buttons');
  nativeStoreLink.click(); check(actions.at(-1)?.[2] === 'https://store.steampowered.com/app/550/', 'Native quick links receive explicit official URLs without a public progress identity');
  check(unsafeQuickLinkReads === 0, 'The account-backed Qd/badge-store helper is never invoked');
  const cardProps = nativeProps.filter(([kind]) => kind === 'collection-card').at(-1)?.[1];
  check(cardProps?.collection === nativeCollection && cardProps.eCoverSize === 2 && cardProps.bStartFocused === false && cardProps.bNoFooterFilter === true,
    'Native collection cards receive the exact shortcut collection object and Steam presentation options');
  check(modelReads.filter(([kind]) => kind === 'native-collections').every(([, id]) => id === A), 'Native collection store reads never substitute the public metadata AppID');
  root.querySelector('[data-native-collection]').click(); check(actions.at(-1)?.[1] === '/library/collection/native-collection-A', 'Native collection activation preserves the real collection destination');
  check(root.querySelector('[data-native-grid=collections]') && nativeProps.filter(([kind]) => kind === 'collection-grid').at(-1)?.[1].scrollElement.ownerDocument === document,
    'Optional native collection grid uses its owner document scroll element');
  const oldInfo = root.querySelector('[data-native-probe=info]');
  let replacementRoots = 0;
  window.SP_REACTDOM = { ...ReactDOM, createRoot: (...args) => { replacementRoots++; return ReactDOM.createRoot(...args); } };
  details.renderNativeRoot(document, state); await frame();
  check(replacementRoots === 1 && !oldInfo.isConnected && root.querySelector('[data-native-probe=info]'),
    'Replacing the owning renderer retires the previous React root before mounting another');
  const realmErrors = [];
  const onRealmError = event => realmErrors.push(String(event.error || event.message)); window.addEventListener('error', onRealmError);
  const foreignUI = { ...client,
    Focusable: props => foreignReact.createElement('div', { role: props.role, className: props.className, tabIndex: props.focusable ? 0 : props.tabIndex,
      onClick: props.onClick || props.onActivate, onClickCapture: props.onClickCapture, onContextMenuCapture: props.onContextMenuCapture,
      'data-native-foreign-ui': '1' }, props.children),
    DialogButton: props => foreignReact.createElement('button', props, props.children),
    TextField: props => foreignReact.createElement('input', props),
    ProgressBar: props => foreignReact.createElement('div', { role: 'progressbar', 'aria-valuenow': props.nProgress }),
  };
  const foreignRuntime = id => id === 63696 ? foreignReact : {};
  runtime.getRequire = () => foreignRuntime; runtime.getRuntimeIdentity = () => foreignRuntime;
  const readiness = document.createElement('div'); panel.appendChild(readiness);
  await frame(); await frame();
  check(realmErrors.length === 0 && !sibling.hidden && !NativeDetails.isNativeBigPictureDetailsRuntimeCurrent(root),
    'Publishing replacement runtime React before its renderer preserves Steam content and never mixes foreign hooks with the old renderer');
  window.SP_REACT = foreignReact; panel.appendChild(document.createElement('div')); await frame(); await frame();
  check(realmErrors.length === 0 && !sibling.hidden && !NativeDetails.isNativeBigPictureDetailsRuntimeCurrent(root),
    'Publishing new global React while the old renderer remains cannot rebind an already known renderer to foreign hooks');
  window.SP_REACTDOM = foreignReactDOM; window.MILLENNIUM_API = foreignUI;
  panel.appendChild(document.createElement('div'));
  for (let attempt = 0; attempt < 12 && !root.textContent.includes('Official description'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50)); await frame();
  }
  check(root.textContent.includes('Official description') && root.querySelector('[data-native-foreign-ui]') && realmErrors.length === 0,
    'A readiness callback after a React/runtime swap remounts with the new owner renderer before executing new hooks');
  const missingReactRuntime = () => ({});
  runtime.getRequire = () => missingReactRuntime; runtime.getRuntimeIdentity = () => missingReactRuntime;
  window.SP_REACT = null; readiness.appendChild(document.createElement('div')); panel.appendChild(document.createElement('div'));
  await frame(); await frame();
  check(realmErrors.length === 0, 'A temporary missing owner React never executes replacement hooks on the previous renderer');
  runtime.getRequire = () => foreignRuntime; runtime.getRuntimeIdentity = () => foreignRuntime; window.SP_REACT = foreignReact;
  panel.appendChild(document.createElement('div'));
  for (let attempt = 0; attempt < 12 && !root.textContent.includes('Official description'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50)); await frame();
  }
  check(root.textContent.includes('Official description') && realmErrors.length === 0, 'The same linked page recovers after its owner React becomes available again');
  window.removeEventListener('error', onRealmError);
  const currentStoreButton = [...root.querySelectorAll('button,[role=link]')].find(button => button.textContent.includes('Página de la tienda'));
  state.hydrationStarted = false; details.startDetailHydration(document, state);
  for (const [name, resolve] of resources) if (name !== 'friends') resolve(['news', 'community'].includes(name) ? [] : null);
  await frame(); check(state.pendingResources === 1, 'A second hydration can remain pending until navigation');
  const beforeActions = actions.length;
  window.g_Router.history.location.pathname = '/routes/library/app/550';
  currentStoreButton.click(); fallbackNotes.click();
  check(actions.length === beforeActions, 'Callbacks lose authority immediately on a native route, before DOM teardown');
  check(!NativeDetails.mountNativeBigPictureDetails(root, { document, shortcut: state.shortcut, generation: 1, data, tab: 'stuff', hydrating: false }),
    'The mount entry point refuses a stale linked action on a native destination');
  details.disposeBigPictureShortcutDetails(document); await frame();
  resources.get('friends')({ data: null }); await frame();
  check(state.pendingResources === 1 && !document.getElementById('gdl-bp-detail-root'), 'The final resource from a retired session cannot remount or mutate its counter');
  check(!document.getElementById('gdl-bp-detail-root') && sibling.outerHTML === originalSibling && previouslyHidden.outerHTML === originalHidden,
    'Production teardown restores exact native panel state and releases its React root');
  check(listeners.size === 0 && fixture.observerCount() === 0 && navigation.getBigPictureNavigationAuthority(document) === 'none',
    'All tab, modal, detail and achievement resources retire after route cleanup');
  check(document.getElementById('native-public').outerHTML === nativePublic && officialOverview.display_name === 'Official native game'
    && publicDetails.unAppID === 550 && publicDetails.vecDLC[0] === 999, 'Public native DOM and store objects remain unchanged through all four tabs');
  check(React !== loaded['document-ui-runtime'].getDocumentReact(document) && foreignReact === loaded['document-ui-runtime'].getDocumentReact(document),
    'The owner renderer really changed after all four tabs initially rendered with a distinct imported React');
  check(activeTab === 'info', 'The integration exercised Activity, Tus cosas, Community and Information');
  return { label: 'Big Picture four-tab integration', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: React.version };
});
