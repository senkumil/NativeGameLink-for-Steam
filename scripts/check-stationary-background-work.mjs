import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const drain = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
let now = 1_000, nextTimer = 0;
const timers = new Map();
const clock = {
  setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { due: now + delay, callback }); return id; },
  clearTimeout(id) { timers.delete(id); },
  async advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, value]) => value.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      now = due[1].due; timers.delete(due[0]); due[1].callback(); await drain();
    }
    now = end; await drain();
  },
};
class FakeDate extends Date { static now() { return now; } }
class Target {
  listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event) { for (const callback of this.listeners.get(type) || []) callback({ type, ...event }); }
}
class Element extends Target {
  nodeType = 1;
  children = [];
  dataset = {};
  style = {};
  id = '';
  parentElement = null;
  constructor(doc) { super(); this.ownerDocument = doc; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
  appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
  remove() { if (!this.parentElement) return; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  removeAttribute() {}
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
}
function documentFixture() {
  const doc = Object.assign(new Target(), {
    hidden: false,
    createElement: () => new Element(doc),
    querySelectorAll: () => [],
    getElementById(id) {
      const find = root => root.id === id ? root : root.children.map(find).find(Boolean);
      return find(doc.body) || null;
    },
  });
  doc.body = new Element(doc);
  doc.documentElement = doc.body;
  doc.defaultView = Object.assign(new Target(), { closed: false, document: doc, ...clock });
  const sidebar = new Element(doc); sidebar.sidebar = true; doc.body.appendChild(sidebar);
  const content = new Element(doc); doc.body.appendChild(content);
  const notice = new Element(doc); content.appendChild(notice);
  return { doc, sidebar, content, notice };
}
function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, console, Date: FakeDate, HTMLElement: Element,
    ...globals, require: dependency => {
      assert(dependency in dependencies, `Unexpected dependency ${dependency} in ${file}`);
      return dependencies[dependency];
    } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context, { filename: file });
  return context.exports;
}

// Use the production event/quiet queue and production renderer together. The
// sidebar stays on one selection: only actual wheel events advance its clock.
const interaction = load('frontend/steam/sidebar-interaction.ts', {
  './library-sidebar': { isLibrarySidebarNode: node => node?.sidebar === true },
});
const scope = documentFixture();
const { doc, sidebar, content, notice } = scope;
const writes = [], requests = [], portraits = [];
let legacy = false, layoutReady = true;
const renderSession = load('frontend/features/library/render-session.ts', {
  '../../steam/library-details': { paintedNativePlaybar: () => content },
  './native-route': { routedSteamAppId: scope => scope.routeId || null, isPublicSteamLibraryRoute: () => false },
  '../shortcuts/registry': { findMappingForShortcut: () => '123' },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
});
const renderer = load('frontend/features/library/renderer.ts', {
  '../../api/backend': { backendLog() {} },
  '../../steam/sidebar-interaction': interaction,
  './render-session': renderSession,
  './first-content': { adoptLinkedLoadingActivity: () => null, getLinkedLoadingActivity: () => null },
  './early-achievement-sidebar': { getOwnedAchievementSidebar: () => null },
  './sidebar-order': { disposeLinkedSidebarOrder() {}, ensureLinkedSidebarOrder() {} },
  './constants': { GDL_INJECTED: 'gdl-library-injected' },
  './artwork': {
    getResolvedLibraryAssets: () => ({ portrait: 'instant' }),
    linkedShortcutPortrait: (_shortcut, _steam, portrait) => portrait,
    getModernLibraryAssets: () => { const work = deferred(); requests.push(work); return work.promise; },
  },
  './legacy-info-portrait': {
    legacyInfoPortraitSync: () => 'legacy-instant',
    resolveLegacyInfoPortrait: () => { const work = deferred(); portraits.push(work); return work.promise; },
  },
  './native-chrome': {
    removeNativeGameChrome() {},
    steamNativeGameInfo: (_data, key, assets) => ({ key, assets }),
    ensureNativeGameChrome: (_doc, model) => writes.push(['chrome', model]),
  },
  './layout': {
    discoverNativeLibraryLayout: () => layoutReady
      ? { anchorRegion: notice, sidebarColumn: sidebar, twoColumnRow: content, contentColumn: content } : {},
    hideLinkedShortcutNotice() {}, prepareNativeLibraryLayout() {},
    insertMainContent: stack => content.appendChild(stack),
  },
  './sidebar-sections': {
    renderLinkedSidebarCore() {},
    refreshHistoricalSidebarSections: (_doc, _layout, _data, steam, assets) => writes.push(['history', steam, assets]),
  },
  './controller': { setupControllerSidebarWatcher: () => () => {}, getOwnedControllerSidebar: () => null, disposeControllerSidebarWatcher() {} },
  './optional-sections': { linkedStoreCapabilities: () => ({ hasWorkshop: false, dlcIds: [] }), renderOptionalStoreSections: () => ({ hasWorkshop: false, dlcIds: [] }) },
  './activity-view': {
    parkSharedActivityComposer() {},
    createActivityView: (_doc, _layout, options) => {
      const activity = new Element(doc); activity.id = 'gdl-library-injected';
      activity.dataset = { gdlSteamAppId: options.steamAppId, gdlShortcutAppId: options.shortcutAppId };
      const feed = new Element(doc); feed.id = 'gdl-activity-feed'; activity.appendChild(feed); return activity;
    }, wireActivityView() {},
  },
  './primary-links': {
    createPrimaryLinksBar: (_doc, _layout, options) => {
      const existing = doc.getElementById('gdl-link-bar');
      if (existing?.dataset.gdlSteamAppId === options.steamAppId
        && existing?.dataset.gdlShortcutAppId === options.shortcutAppId) return existing;
      const bar = new Element(doc); bar.id = 'gdl-link-bar';
      bar.dataset = { gdlSteamAppId: options.steamAppId, gdlShortcutAppId: options.shortcutAppId }; return bar;
    },
    insertPrimaryLinksBar: bar => content.appendChild(bar),
  },
  './community-view': {
    disposeCommunitySection() {}, insertCommunitySection: () => null,
    communityItemsSignature: () => '', renderCommunityContentHtml: () => '',
  },
  './trading-cards': { disposeTradingCardUI() {} },
  './legacy-games': { isLegacyGame: () => legacy },
});
function mount(shortcut = '3000000001', isCurrent = () => true) {
  doc.routeId = Number(shortcut);
  equal(renderer.renderLinkedGamePage(doc, notice, { name: 'Game', achievements: { total: 0 } }, '123', [], null, [], {
    shortcutAppId: shortcut, isCurrent,
  }), true, 'Linked page mounts its initial chrome immediately');
  return doc.getElementById('gdl-library-injected');
}
function wheel() { doc.fire('wheel', { target: sidebar }); }
interaction.installLibrarySidebarInteraction(doc);
const firstMount = mount();
equal(writes.length, 1, 'The initial cached chrome has no added wait');
await clock.advance(2_500);
wheel(); requests[0].resolve({ portrait: 'late-A' }); await drain();
equal(writes.length, 1, 'Late assets do not mutate an already stationary linked page during wheel');
await clock.advance(100); wheel(); await clock.advance(100); wheel();
equal(writes.length, 1, 'Repeated rapid wheel keeps optional model and DOM commits paused');
await clock.advance(179);
equal(writes.length, 1, 'The queued result cannot commit before the final quiet period');
await clock.advance(1);
equal(writes.length, 3, 'One chrome and one history update commit after actual interaction ends');
equal(writes[1][1].assets.portrait, 'late-A', 'The delayed result preserves the resolved asset data');

// Both callbacks share one queue key, but the newer exact mount wins even when
// the Steam AppID is shared between two external shortcuts.
mount(); wheel(); requests[1].resolve({ portrait: 'superseded-A' }); await drain();
const secondMount = mount('3000000002');
requests[2].resolve({ portrait: 'latest-B' }); await drain();
const beforeQuiet = writes.length;
await clock.advance(180);
equal(writes.length, beforeQuiet + 2, 'Coalescing retains only the newest mounted shortcut result');
equal(writes.at(-2)[1].assets.portrait, 'latest-B', 'The previous shortcut payload never reaches the new mount');
equal(firstMount.isConnected, false, 'Old activity roots have been retired');
equal(secondMount.isConnected, true, 'The latest exact root remains mounted');

// Replacing the DOM with the same IDs is not permission to update it.
const oldMount = mount(); wheel(); requests[3].resolve({ portrait: 'old-root' }); await drain();
const replacement = new Element(doc); replacement.id = oldMount.id; replacement.dataset = { ...oldMount.dataset };
oldMount.remove(); content.appendChild(replacement);
const beforeReplacementQuiet = writes.length;
await clock.advance(180);
equal(writes.length, beforeReplacementQuiet, 'An ABA replacement with identical IDs rejects the queued result');

let generationCurrent = true;
mount('3000000003', () => generationCurrent); wheel(); requests[4].resolve({ portrait: 'old-generation' }); await drain();
generationCurrent = false;
const beforeGenerationQuiet = writes.length;
await clock.advance(180);
equal(writes.length, beforeGenerationQuiet, 'Generation is revalidated inside the quiet callback');

legacy = true;
mount('3000000004'); requests[5].resolve({ portrait: 'legacy-metadata' }); await drain();
equal(portraits.length, 1, 'The legacy portrait lookup starts without delaying foreground artwork');
wheel(); portraits[0].resolve('legacy-resolved'); await drain();
const beforeLegacyQuiet = writes.length;
await clock.advance(180);
equal(writes.length, beforeLegacyQuiet + 2, 'Legacy asset work also commits only when the sidebar is quiet');
equal(writes.at(-2)[1].assets.portrait, 'legacy-resolved', 'The resolved legacy portrait reaches its exact mount');

// Header links precede metadata layout, and must survive every render retry.
doc.getElementById('gdl-library-injected')?.remove();
doc.getElementById('gdl-link-bar')?.remove();
doc.routeId = 3000000005;
const earlyLinks = new Element(doc); earlyLinks.id = 'gdl-link-bar';
earlyLinks.dataset = { gdlSteamAppId: '123', gdlShortcutAppId: String(doc.routeId) };
content.appendChild(earlyLinks); layoutReady = false;
const beforeLayoutRetry = writes.length;
equal(renderer.renderLinkedGamePage(doc, notice, { name: 'Game' }, '123', [], null, [], {
  shortcutAppId: String(doc.routeId), isCurrent: () => true,
}), false, 'Incomplete metadata columns postpone only metadata rendering');
equal(doc.getElementById('gdl-link-bar'), earlyLinks, 'An incomplete layout retains the already painted exact-shortcut links node');
equal(earlyLinks.isConnected, true, 'The early links never leave their header host during a failed render');
equal(writes.length, beforeLayoutRetry, 'A failed layout performs no replacement chrome paint');
layoutReady = true; legacy = false;
mount(String(doc.routeId));
equal(doc.getElementById('gdl-link-bar'), earlyLinks, 'A settled first metadata render reuses the same early links node');

// Exercise production controller detection, including native-store discovery.
// A missing store must not walk the complete Steam module cache on every poll.
let scans = 0, resolverCalls = 0, runtime = {}, modules = [];
const controllerScope = documentFixture();
const controllerDoc = controllerScope.doc;
const controllerWindow = Object.assign(controllerDoc.defaultView, { navigator: { getGamepads: () => [] } });
const svg = new Proxy({}, { get: () => '' });
const controller = load('frontend/features/library/controller.ts', {
	'../achievements/navigation': { linkedAchievementTarget: () => null },
	'../../steam/library-details': { committedHeaderAppId: () => null },
  '../../api/backend': { backendLog() {} },
  '../../core/text': { escapeHtml: value => value },
  '../../core/game-data': { getCachedGameData: () => null },
  '../../steam/gamepad/stores/AppStoreAdapter': { AppStoreAdapter: {} },
  '../../steam/localization': { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback, steamLanguageSync: () => 'english' },
  './styles/controller': { ensureControllerStyles() {} },
  './sidebar-order': { getLinkedSidebarOrder: () => null, hasLinkedSidebarOrder: () => false },
  './layout': { buildNativeSidebarSection: () => null },
  '../../steam/modules/SteamModuleResolver': { getSteamStore: () => { resolverCalls++; return null; } },
  '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: {
    getRequire: () => runtime,
    getAllModules: () => { scans++; return modules; },
  } },
  '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
  '../../steam/sidebar-interaction': interaction,
  '../../core/dom': { mutationIsWithinSelector: () => false },
  './controller-svgs': svg,
}, { window: controllerWindow, navigator: controllerWindow.navigator });
for (let i = 0; i < 100; i++) controller.detectConnectedController(controllerDoc);
equal(scans, 1, '100 polls of a missing store inspect Webpack only once');
equal(resolverCalls, 2, 'Missing globals do not trigger repeated popup/global resolver walks');
await clock.advance(1_999); controller.detectConnectedController(controllerDoc);
equal(scans, 1, 'A missing-store lookup remains cached for the bounded interval');
await clock.advance(1); controller.detectConnectedController(controllerDoc);
equal(scans, 2, 'Missing native exports are retried after two seconds');
controllerWindow.ControllerStore = { GetControllers: () => [{ bConnected: true, eControllerType: 31, strName: 'Live Xbox' }] };
equal(controller.detectConnectedController(controllerDoc).connected, true, 'A newly exposed live global bypasses the negative cache immediately');
equal(scans, 2, 'Live globals never require a module-cache scan');
delete controllerWindow.ControllerStore;
modules = [{ exports: { sY: { GetControllers: () => [{ bConnected: true, eControllerType: 45, strName: 'Module PS5' }] } } }];
runtime = {};
equal(controller.detectConnectedController(controllerDoc).name, 'Module PS5', 'A new native runtime invalidates a prior negative lookup immediately');
equal(scans, 3, 'The new runtime performs exactly one fresh discovery');
for (let i = 0; i < 100; i++) controller.detectConnectedController(controllerDoc);
equal(scans, 3, 'A discovered native controller store is reused across connection-state polls');
modules = [];
await clock.advance(5_000);
equal(controller.detectConnectedController(controllerDoc).connected, false, 'Positive discoveries are bounded so a removed native store does not survive indefinitely');
equal(scans, 4, 'Positive native-store discovery is refreshed after five seconds');
const otherWindow = Object.assign(new Target(), { navigator: { getGamepads: () => [] } });
controller.detectConnectedController({ defaultView: otherWindow });
equal(scans, 5, 'A separate CEF window does not borrow another window negative cache');
runtime = {}; controller.detectConnectedController(controllerDoc);
const scansBeforeLongWheel = scans;
interaction.installLibrarySidebarInteraction(controllerDoc);
for (let i = 0; i < 100; i++) {
  controllerDoc.fire('wheel', { target: controllerScope.sidebar });
  await clock.advance(50); controller.detectConnectedController(controllerDoc);
}
equal(scans, scansBeforeLongWheel, 'One hundred polls across five seconds of rapid wheel perform no expired-cache module scans');
controllerWindow.ControllerStore = { GetControllers: () => [{ bConnected: true, eControllerType: 31, strName: 'Live during wheel' }] };
equal(controller.detectConnectedController(controllerDoc).connected, true, 'Live native globals remain immediate during a prolonged gesture');
delete controllerWindow.ControllerStore;
await clock.advance(180); controller.detectConnectedController(controllerDoc);
equal(scans, scansBeforeLongWheel + 1, 'The next quiet controller poll refreshes expired discovery without another timer');
const uncachedController = documentFixture();
uncachedController.doc.defaultView.navigator = { getGamepads: () => [] };
interaction.installLibrarySidebarInteraction(uncachedController.doc);
uncachedController.doc.fire('wheel', { target: uncachedController.sidebar });
controller.detectConnectedController(uncachedController.doc);
equal(scans, scansBeforeLongWheel + 1, 'First discovery on a new window also avoids scanning modules during wheel');
await clock.advance(180); controller.detectConnectedController(uncachedController.doc);
equal(scans, scansBeforeLongWheel + 2, 'A first discovery resumes on the next quiet poll');

// The achievement lifecycle and finalizer share the same native-scroll queue.
// Resolve their real asynchronous branches while one linked game is stationary.
const achievementScope = documentFixture();
const achievementDoc = achievementScope.doc;
achievementDoc.querySelector = () => null;
const achievementWindow = achievementDoc.defaultView;
const intervals = new Map();
achievementWindow.setInterval = callback => { const id = ++nextTimer; intervals.set(id, callback); return id; };
achievementWindow.clearInterval = id => intervals.delete(id);
const storage = new Map();
const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const achievementObservers = [];
const achievementGlobals = { window: achievementWindow, localStorage, MutationObserver: class {
  records = [];
  constructor(callback) { this.callback = callback; achievementObservers.push(this); }
  observe() {} disconnect() {}
  takeRecords() { const records = this.records; this.records = []; return records; }
} };
const cache = load('frontend/features/achievements/cache.ts', {}, achievementGlobals);
let route = 3000000001;
const linked = new Map([[3000000001, '123'], [3000000002, '123']]);
const navigation = load('frontend/features/achievements/navigation.ts', {
  '../../api/backend': { backendLog() {} },
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => linked.get(id) || null },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
  '../library/native-route': { routedSteamAppId: () => route },
  '../../steam/navigation': { openSteamNavigationUrl() {} },
  '../../steam/localization': { gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'english' },
}, achievementGlobals);
const achievementRequests = [], subscribers = new Set(), achievementWrites = [], progressRequests = [];
const publish = update => { for (const listener of subscribers) listener(update); };
const service = {
  clearLocalAchievementRequestCache() {},
  subscribeLocalAchievementData: listener => { subscribers.add(listener); return () => subscribers.delete(listener); },
  publishAchievementUpdate: publish,
  fetchLocalAchievementData: (steam, options) => {
    const work = deferred(); achievementRequests.push({ ...work, steam, shortcut: options.stateAppId });
    return work.promise.then(data => { publish({ steamAppId: steam, stateAppId: options.stateAppId, data }); return data; });
  },
};
const paintSidebar = (_doc, data) => achievementWrites.push(['sidebar', data]);
const paintStat = (_doc, data) => achievementWrites.push(['playbar', data]);
const lifecycle = load('frontend/features/achievements/lifecycle.ts', {
  '../../api/backend': { backendLog() {} }, '../../core/dom': { mutationIsWithinSelector: () => false },
  '../../steam/sidebar-interaction': interaction, '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
  './cache': cache, './navigation': navigation, './service': service,
  './context': { clearAchievementRuntimeHost() {} }, './modal': { openLocalAchievementsModal: async () => {}, disposeLocalAchievementsModal() {}, disposeAllLocalAchievementsModals() {} },
  './notifications': { disposeAchievementNotifications() {} }, './playbar': { ensureLocalPlaybarStat: paintStat },
  './sidebar': { renderLocalAchievementSidebar: paintSidebar }, './styles': { ensureLocalAchievementStyles() {} },
  './game-info': { clearLocalAchievementGameInfoCache() {} },
}, achievementGlobals);
const finalizer = load('frontend/features/library/achievement-chrome.ts', {
  '../../api/backend': { backendLog() {} }, '../../steam/sidebar-interaction': interaction,
  '../achievements/cache': cache, '../achievements/navigation': navigation, '../achievements/service': service,
  '../achievements/playbar': { ensureLocalPlaybarStat: paintStat },
  '../achievements/sidebar': { renderLocalAchievementSidebar: paintSidebar, revealPendingAchievementSidebar: () => achievementWrites.push(['reveal']) },
  '../achievements/progress': { getAchievementProgress: () => { const work = deferred(); progressRequests.push(work); return work.promise; } },
}, achievementGlobals);
function achievementRoot(shortcut = route) {
  achievementDoc.getElementById('gdl-library-injected')?.remove();
  const root = new Element(achievementDoc); root.id = 'gdl-library-injected';
  root.dataset = { gdlSteamAppId: '123', gdlShortcutAppId: String(shortcut) };
  achievementScope.content.appendChild(root); return root;
}
const achievementData = (unlocked, shortcut = route) => ({ found: true, appid: '123', metadata_appid: '123', state_appid: String(shortcut), total: 4, unlocked, achievements: [] });
const achievementWheel = () => achievementDoc.fire('wheel', { target: achievementScope.sidebar });
const requestRefresh = () => achievementDoc.fire('visibilitychange', {});
interaction.installLibrarySidebarInteraction(achievementDoc);
achievementRoot(); lifecycle.installLocalAchievementUI(achievementDoc);
achievementRequests[0].resolve(achievementData(1)); await drain();
equal(achievementWrites.length, 4, 'Without wheel, the initial bus and IPC paths paint immediately');
await clock.advance(2_500);
achievementWrites.length = 0;
achievementWheel(); requestRefresh(); achievementRequests[1].resolve(achievementData(2)); await drain();
equal(achievementWrites.length, 0, 'A stationary linked game receives no achievement DOM writes when IPC resolves during sidebar wheel');
equal(cache.getCachedLocalAchievementsForShortcut('123', route)?.unlocked, 2, 'Confirmed data becomes available to the cache while DOM painting waits');
for (let i = 0; i < 100; i++) publish({ steamAppId: '123', stateAppId: String(route), data: achievementData(3) });
await clock.advance(100); achievementWheel(); await clock.advance(179);
equal(achievementWrites.length, 0, 'One hundred live updates cannot repaint the sidebar or playbar during rapid scroll');
await clock.advance(1);
equal(achievementWrites.length, 2, 'IPC and live updates coalesce into one sidebar/playbar batch after quiet');
equal(achievementWrites[0][1].unlocked, 3, 'The last confirmed shortcut snapshot wins the shared queued commit');

achievementWrites.length = 0;
achievementWheel(); requestRefresh(); achievementRequests[2].resolve(achievementData(4)); await drain();
route = 3000000002; achievementRoot();
await clock.advance(180);
equal(achievementWrites.length, 0, 'Navigating to a sibling shortcut with the same SteamID rejects the previous queued render');
equal(cache.getCachedLocalAchievementsForShortcut('123', route), null, 'A sibling route does not receive the previous shortcut cache alias');

// The real service publishes before the awaiting caller resumes. Both paths
// reject a same-ID root replacement using the root captured before the request.
route = 3000000001; achievementRoot();
achievementWheel(); requestRefresh(); achievementRoot();
achievementRequests[3].resolve(achievementData(4)); await drain(); await clock.advance(180);
equal(achievementWrites.length, 0, 'A same-ID ABA mount rejects both the late service bus and IPC response');

achievementWheel(); publish({ steamAppId: '123', stateAppId: String(route), data: achievementData(2) });
lifecycle.disposeLocalAchievementUI(achievementDoc); await clock.advance(180);
equal(achievementWrites.length, 0, 'Disposing the achievement lifecycle cancels its pending UI commit');
equal(subscribers.size, 0, 'A disposed lifecycle cannot receive later service-bus updates');

// Cached data stays synchronous when there is no gesture; late finalization
// does not interrupt a gesture and validates the exact mounted root again.
achievementRoot();
let finalizerCurrent = true;
const context = () => ({ steamAppId: '123', stateAppId: String(route), fallbackTotal: 4, isCurrent: () => finalizerCurrent });
const cachedFinalization = finalizer.finalizeLinkedAchievements(achievementDoc, context());
equal(achievementWrites.length, 2, 'The finalizer paints an existing shortcut cache synchronously when idle');
achievementWrites.length = 0;
achievementWheel(); achievementRequests[4].resolve(achievementData(3)); await drain();
equal(achievementWrites.length, 0, 'The finalizer backend completion does not repaint during wheel');
await clock.advance(180); await cachedFinalization;
equal(achievementWrites.length, 2, 'A finalizer result produces one batch after quiet');

achievementWrites.length = 0; cache.clearLocalAchievementCache();
const abandonedFinalization = finalizer.finalizeLinkedAchievements(achievementDoc, context());
achievementWheel(); achievementRequests[5].resolve(achievementData(4)); await drain();
achievementRoot(); await clock.advance(180); await abandonedFinalization;
equal(achievementWrites.length, 0, 'A finalizer queued before root replacement cannot resurrect old chrome');

// A slower provisional count must prefer confirmed data already queued by the
// lifecycle, rather than replacing the latest local count on the same key.
cache.clearLocalAchievementCache(); lifecycle.installLocalAchievementUI(achievementDoc);
achievementWheel();
const provisionalFinalization = finalizer.finalizeLinkedAchievements(achievementDoc, context());
achievementRequests[7].resolve(null); await drain();
equal(progressRequests.length, 1, 'Unavailable local data starts the native read-only fallback');
publish({ steamAppId: '123', stateAppId: String(route), data: achievementData(3) });
progressRequests[0].resolve({ unlocked: 0, total: 4 }); await drain();
equal(achievementWrites.length, 0, 'Neither confirmed nor provisional results repaint the list during wheel');
await clock.advance(180); await provisionalFinalization;
equal(achievementWrites.length, 2, 'Lifecycle and provisional finalizer share one commit batch');
equal(achievementWrites[1][1].unlocked, 3, 'A late provisional zero never replaces confirmed local achievement progress');
equal(achievementWrites[1][1].found, true, 'The shared queue preserves confirmed data provenance');
lifecycle.disposeLocalAchievementUI(achievementDoc);

achievementWrites.length = 0; cache.clearLocalAchievementCache();
const fallbackFinalization = finalizer.finalizeLinkedAchievements(achievementDoc, context());
achievementWheel(); achievementRequests[8].resolve(null); await drain();
progressRequests[1].resolve({ unlocked: 1, total: 4 }); await drain();
equal(achievementWrites.length, 0, 'Provisional playbar and pending-sidebar reveal both wait during wheel');
await clock.advance(180); await fallbackFinalization;
equal(achievementWrites.length, 2, 'A current provisional result and reveal commit together after quiet');
equal(achievementWrites[0][0], 'playbar', 'The provisional result reaches the linked playbar');
equal(achievementWrites[1][0], 'reveal', 'Pending fallback content is revealed in the same quiet commit');

achievementWrites.length = 0; cache.clearLocalAchievementCache();
const beforeNativeRequests = achievementRequests.length;
route = 123;
await finalizer.finalizeLinkedAchievements(achievementDoc, { steamAppId: '123', stateAppId: '3000000001', fallbackTotal: 4, isCurrent: () => true });
lifecycle.installLocalAchievementUI(achievementDoc);
publish({ steamAppId: '123', stateAppId: '3000000001', data: achievementData(4, 3000000001) }); await drain();
equal(achievementRequests.length, beforeNativeRequests, 'A public Steam route starts no linked achievement IPC');
equal(achievementWrites.length, 0, 'Public native game routes never receive linked achievement UI writes');
lifecycle.disposeLocalAchievementUI(achievementDoc);

// Steam publishes its native header before the metadata renderer creates the
// first owned root. That first mount must not look like an ABA replacement.
route = 3000000001;
function startHeaderOnly() {
  achievementDoc.getElementById('gdl-library-injected')?.remove();
  achievementWrites.length = 0; cache.clearLocalAchievementCache();
  lifecycle.installLocalAchievementUI(achievementDoc);
  return achievementRequests.at(-1);
}
let headerRequest = startHeaderOnly();
headerRequest.resolve(achievementData(1)); await drain();
equal(achievementWrites.filter(([kind]) => kind === 'sidebar').length, 0, 'A header-only page never invents a metadata sidebar');
equal(achievementWrites.filter(([kind]) => kind === 'playbar').length, 2, 'A confirmed header-only response can still update the native-owned playbar host');
equal(cache.getCachedLocalAchievementsForShortcut('123', route)?.unlocked, 1, 'A header-only response preserves its confirmed shortcut snapshot');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
const firstMetadataRoot = achievementRoot();
headerRequest.resolve(achievementData(2)); await drain();
equal(achievementWrites.filter(([kind]) => kind === 'sidebar').length, 2, 'A first matching metadata root mounted before IPC completion receives confirmed progress immediately');
equal(achievementWrites.at(-1)[1].unlocked, 2, 'Null to first metadata mount does not discard valid playbar data');
equal(firstMetadataRoot.isConnected, true, 'The first metadata root remains the valid exact owner');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
achievementWheel(); headerRequest.resolve(achievementData(3)); await drain();
equal(achievementWrites.length, 0, 'A header-only IPC result waits while the list is scrolling');
achievementRoot(); await clock.advance(180);
equal(achievementWrites.length, 2, 'A first exact root mounted during the quiet queue is adopted for one sidebar/playbar batch');
equal(achievementWrites.at(-1)[1].unlocked, 3, 'The first root adopts the latest confirmed count after quiet');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
achievementWheel(); headerRequest.resolve(achievementData(4)); await drain();
const adoptedRoot = achievementRoot();
achievementObservers.at(-1).callback([{ target: achievementScope.content, addedNodes: [adoptedRoot], removedNodes: [] }]);
const replacedRoot = achievementRoot();
achievementObservers.at(-1).callback([{ target: achievementScope.content, addedNodes: [replacedRoot], removedNodes: [adoptedRoot] }]);
await clock.advance(180);
equal(achievementWrites.length, 0, 'After first-root adoption, an ABA replacement invalidates the earlier header-only queue epoch');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
const removedFirstRoot = achievementRoot();
achievementRoot();
achievementObservers.at(-1).records.push({ target: achievementScope.content, addedNodes: [], removedNodes: [removedFirstRoot] });
headerRequest.resolve(achievementData(4)); await drain();
equal(achievementWrites.length, 0, 'Undelivered first-root removal records invalidate both bus and IPC paths before a same-ID replacement can be adopted');
equal(cache.getCachedLocalAchievementsForShortcut('123', route), null, 'An ABA header-only response cannot seed the replacement mount cache');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
achievementRoot(3000000002);
headerRequest.resolve(achievementData(4)); await drain();
equal(achievementWrites.length, 0, 'A first root for a sibling shortcut cannot adopt another header-only request');
equal(cache.getCachedLocalAchievementsForShortcut('123', route), null, 'A mismatched first root cannot accept the previous shortcut snapshot');
lifecycle.disposeLocalAchievementUI(achievementDoc);

headerRequest = startHeaderOnly();
route = 3000000002;
achievementObservers.at(-1).callback([{ target: achievementScope.content, addedNodes: [new Element(achievementDoc)], removedNodes: [] }]);
route = 3000000001;
const returningRoot = achievementRoot();
achievementObservers.at(-1).callback([{ target: achievementScope.content, addedNodes: [returningRoot], removedNodes: [] }]);
headerRequest.resolve(achievementData(4)); await drain();
equal(achievementWrites.length, 0, 'Leaving and returning to the same header-only shortcut advances ownership epoch and rejects the old request');
lifecycle.disposeLocalAchievementUI(achievementDoc);

console.log(`Stationary background work: ${assertions} assertions passed`);
