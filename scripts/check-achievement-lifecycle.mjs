import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const noop = () => {};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function load(file, dependencies = {}, globals = {}, expose = '') {
  const context = vm.createContext({ exports: {}, console: { log: noop, error: noop },
    require: name => { assert(name in dependencies, `Unexpected ${file} dependency: ${name}`); return dependencies[name]; }, ...globals });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText + expose, context, { filename: file });
  return context.exports;
}
class Target {
  listeners = new Map();
  addEventListener(type, listener) { let set = this.listeners.get(type); if (!set) this.listeners.set(type, set = new Set()); set.add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  fire(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
function scheduler() {
  let serial = 0;
  const timers = new Map(), intervals = new Map(), frames = new Map();
  return { timers, intervals, frames,
    setTimeout: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: callback => { const id = ++serial; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id), requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    run(delay = null) { for (const [id, timer] of [...timers]) if (delay === null || timer.delay === delay) { timers.delete(id); timer.callback(); } },
  };
}
const generic = new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => noop });
const genericDependencies = overrides => new Proxy(overrides, { has: () => true, get: (target, key) => target[key] || generic });
const a = 3000000001, b = 3000000002;
const mappings = { [`shortcut:${a}`]: '111', [`shortcut:${b}`]: '222' };
const committed = id => mappings[`shortcut:${Number(id) >>> 0}`] || null;
const localize = { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback, steamLanguageSync: () => 'english' };

function appFixture(modalModule = { disposeLocalAchievementsModal: noop }) {
  const time = scheduler(), win = Object.assign(new Target(), { document: {} });
  const calls = []; let factory, windowHook, resolveMappings, rejectMappings;
  const pendingMappings = new Promise((resolve, reject) => { resolveMappings = resolve; rejectMappings = reject; });
  const external = new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : (..._args) => { calls.push(String(name)); return noop; } });
  const globals = { ...time, window: win, localStorage: { length: 0 }, performance: { now: () => 0 },
    MutationObserver: class { observe() {} disconnect() {} } };
  const disposables = load('frontend/core/disposables.ts', {}, globals);
  const legacyRepair = load('frontend/steam/achievement-cache-repair.ts', {}, globals);
  const existingWindows = load('frontend/runtime/existing-windows.ts', { '@steambrew/client': { findSP: () => null } }, globals);
  const nativeOwnership = load('frontend/steam/gamepad/components/NativeAchievementOwnership.ts', {
    '../../../api/backend': { backendLog() {} }, '../../../core/mappings': { mappings, isMappingSnapshotVerified: () => true, shortcutMappingKey: id => `shortcut:${id >>> 0}` },
  });
  const native = load('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts', {
    '../../native-window-store': { getNativeWindowInstance: () => null },
    './NativeAchievementOwnership': nativeOwnership,
    '../GamepadContext': { normalizeGamepadAppId: value => Number.isInteger(Number(value)) && Number(value) >= -2147483648 && Number(value) <= 4294967295 ? Number(value) >>> 0 : null, isCurrentLinkedGamepadTarget: (doc, id) => doc?.routeId === id },
    '../../ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => doc?.gamepad === true } },
    '../../../api/backend': { backendLog: noop }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: {} },
    '../../../core/mappings': { mappings, isMappingSnapshotVerified: () => true, shortcutMappingKey: id => `shortcut:${id >>> 0}` },
  });
  const nativeRecords = new Map([[a, { details: {} }]]);
  const nativeStore = { GetAppData: id => nativeRecords.get(id), GetAchievements(id) { return this.GetAppData(id)?.details?.achievements; } };
  const original = nativeStore.GetAchievements;
  native.ensureAppDetailsStoreGuarded(nativeStore);
  const resolvers = {};
  for (const name of ['Achievements', 'Activity', 'Friends', 'GameDetails', 'GameInfo', 'Hero', 'News', 'Playbar']) {
    resolvers[`./components/${name}Resolver`] = { [`${name[0].toLowerCase()}${name.slice(1)}Resolver`]: { invalidate: noop } };
  }
  const gamepad = load('frontend/steam/gamepad/GamepadRuntime.ts', {
    ...resolvers, '../../api/backend': { backendLog: noop }, '../modules/SteamWebpackRuntime': { steamWebpackRuntime: {} },
    './GamepadCapabilities': { gamepadCapabilities: { resetCircuitBreakers: noop } },
    './components/AppDetailsNativeClasses': { clearNativeAppDetailsClassCache: noop }, './components/AppDetailsNativeComponents': native,
  }, globals);
  const bpDetails = load('frontend/features/big-picture/details.ts', genericDependencies({}), globals);
  const properties = load('frontend/core/property-patches.ts');
  const bpScheduler = load('frontend/features/big-picture/rerender-scheduler.ts', {
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
    '../library/native-route': { isPublicSteamLibraryRoute: () => false, libraryRouteIdentity: () => 'bp-home' },
  }, globals);
  const bp = load('frontend/features/big-picture/runtime.ts', genericDependencies({
    '../../core/property-patches': properties, './rerender-scheduler': bpScheduler, './details': bpDetails,
    '../../core/preferences': { subscribePreferences: noop },
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
    '../../steam/browser-protection': { installBrowserProtection: () => noop },
  }), globals);
  const bpDoc = { body: { isConnected: true }, defaultView: {}, getElementById: () => null, querySelectorAll: () => [] };
  bpDoc.defaultView.document = bpDoc;
  bp.activateBigPicture(bpDoc);
  const dependencies = new Proxy({
    react: { __esModule: true, default: { createElement: () => null } },
    '@steambrew/client': { definePlugin: callback => { factory = callback; return callback; },
      Millennium: { AddWindowCreateHook: callback => { windowHook = callback; } }, IconsModule: { Settings: noop } },
    '../core/disposables': disposables, '../core/mappings': { mappings: {}, loadMappings: () => pendingMappings },
    '../steam/ui/SteamUIModeService': { steamUIModeService: new Proxy({}, { get: (_target, name) => name === 'isGamepadUI' ? () => false : external[name] }) },
    '../steam/modules/SteamComponentResolver': { steamComponents: external }, '../steam/gamepad/GamepadRuntime': gamepad,
    './existing-windows': { ...existingWindows, getCanonicalDesktopPopup: () => null, adoptExistingSteamWindows: noop,
      resolveSteamWindowContext: context => { calls.push('resolveSteamWindowContext'); return context.popupWin ? context : existingWindows.resolveSteamWindowContext(context); } },
    '../steam/achievement-cache-repair': legacyRepair,
    '../steam/native-achievement-layout': { installNativeAchievementLayout() { calls.push('installNativeAchievementLayout'); return () => calls.push('disposeNativeAchievementLayout'); } },
    '../features/library/early-playbar': { installEarlyLinkedPlaybar: () => ({ sync: noop, dispose: noop }) },
    '../features/library/native-route': { libraryRouteIdentity: () => 'app:550', isPublicSteamLibraryRoute: () => true },
    '../features/library/runtime': { findNonSteamNotice: () => null, handleLibraryNavigation: noop,
      tryInjectLibraryData: async () => {}, syncLinkedFirstContent: noop, configureLibraryRuntimeHost: noop, disposeLibraryRuntime: noop, cancelPendingLibraryPaint: noop },
    '../features/big-picture/runtime': bp,
    '../features/achievements/runtime': new Proxy(modalModule, { get: (target, name) => target[name] || external[name] }),
    '../steam/localization': { setLocalizationDocumentProvider: noop, subscribeSteamLanguageChange: () => noop, stopSteamLanguageWatcher: noop },
    './mapping-refresh': { installMappingRefresh: () => noop }, './artwork-batch-refresh': { installArtworkBatchRefresh: () => noop },
  }, { has: () => true, get: (target, name) => target[name] || external });
  const app = load('frontend/runtime/app.tsx', dependencies, globals, '\nexports.navigate = handleLibraryNavigation;');
  const descriptor = factory();
  return { ...time, app, bp, descriptor, calls, nativeStore, original, nativeRecords, native,
    resolveMappings, rejectMappings, windowHook: context => windowHook(context),
    restart: () => factory() };
}

for (const outcome of ['resolve', 'reject']) {
  const f = appFixture();
  f.run(0); // mapping hydration has actually started before disposal
  check(f.nativeStore.GetAchievements !== f.original, 'Precondition: the real native compatibility hook is installed');
  f.descriptor.onDismount();
  check(f.nativeStore.GetAchievements === f.original && !Object.hasOwn(f.nativeStore, '__ngl_achievements_guarded'),
    'Actual app -> Big Picture/details teardown -> gamepad invalidation restores the exact native method and marker');
  check(f.timers.size === 0 && f.intervals.size === 0, 'All startup, pruning and adoption timers are cancelled at teardown');
  const before = f.calls.length;
  f[outcome === 'resolve' ? 'resolveMappings' : 'rejectMappings'](outcome === 'reject' ? new Error('late failure') : undefined);
  await flush(); f.run();
  check(f.calls.length === before && f.timers.size === 0 && f.intervals.size === 0,
    `A mapping ${outcome} after teardown cannot warm data, prune storage or restart any service`);
  f.windowHook({ window: {} });
  check(!f.calls.slice(before).includes('resolveSteamWindowContext'), 'A stale Millennium window callback cannot register another document');
}
const live = appFixture(); live.bp.deactivateBigPicture(); live.run(0); live.resolveMappings(); await flush(); live.run();
check(['pruneCacheStorage', 'startPlaytimeTracker', 'startFirstLaunchAchievementWatcher', 'startLinkedGamePrefetch'].every(name => live.calls.includes(name)),
  'A live startup still performs pruning and starts all deferred services after mapping hydration');
live.descriptor.onDismount();
const replacement = appFixture(); replacement.run(0);
const currentDescriptor = replacement.restart(); replacement.descriptor.onDismount();
check(replacement.timers.size > 0 && replacement.nativeStore.GetAchievements !== replacement.original,
  'A previous instance teardown cannot cancel the new instance startup or restore its shared native hook prematurely');
replacement.bp.deactivateBigPicture(); replacement.run(0); replacement.resolveMappings(); await flush(); replacement.run();
check(replacement.calls.filter(name => name === 'startFirstLaunchAchievementWatcher').length === 1,
  'Only the current plugin instance can start services when both generations await the same mapping load');
currentDescriptor.onDismount();
check(replacement.timers.size === 0 && replacement.intervals.size === 0 && replacement.nativeStore.GetAchievements === replacement.original,
  'The current instance still performs full cleanup after an earlier instance was retired');
const waiting = appFixture(), pendingWindow = Object.assign(new Target(), { document: {}, closed: false });
waiting.windowHook({ popupWin: pendingWindow, popupDoc: pendingWindow.document });
check(pendingWindow.listenerCount === 1, 'A not-yet-loaded Steam popup temporarily registers one DOM ready listener');
waiting.descriptor.onDismount();
check(pendingWindow.listenerCount === 0 && waiting.timers.size === 0,
  'Disabling before a popup loads cancels its document-ready listener and retry timers');

function repairSurface(f, name = 'SP Desktop_uid0', title = 'Steam', withCache = true) {
  const view = Object.assign(new Target(), { ...f, name, closed: false, location: { href: 'https://steamloopback.host/library/app/550' } });
  const doc = Object.assign(new Target(), { title, hidden: false, defaultView: view,
    body: { isConnected: true, classList: { contains: () => false } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
  view.document = doc;
  let writes = 0, recordWrites = 0, saved = 0;
  class ObservedMap extends Map {
    set(...args) { writes++; return super.set(...args); }
    delete(...args) { writes++; return super.delete(...args); }
    clear() { writes++; return super.clear(); }
  }
  const sentinel = new Proxy({ appid: 550, total: 101, unlocked: 40, percentage: 39, cache_time: 2147483647 }, {
    set(target, key, value) { recordWrites++; return Reflect.set(target, key, value); },
    deleteProperty(target, key) { recordWrites++; return Reflect.deleteProperty(target, key); },
  });
  const map = new ObservedMap([[550, sentinel], [1030300, { appid: 1030300, total: 63, unlocked: 63, percentage: 100, cache_time: 123 }],
    [a, { appid: a, total: 2, unlocked: 1, percentage: 50, cache_time: 2147483647 }],
    [367520, { appid: 367520, total: 63, unlocked: 1, percentage: 1, cache_time: 2147483647, steam: true }]]);
  writes = 0;
  const queued = [], cache = { m_achievementProgress: { mapCache: map }, QueueCacheUpdate: id => queued.push(id), SaveCacheFile() { saved++; } };
  if (withCache) view.appAchievementProgressCache = cache;
  return { doc, view, map, sentinel, queued, cache, stats: () => ({ writes, recordWrites, saved }),
    context: { window: view, m_strName: name, m_strTitle: title } };
}
function notificationRegistry() {
  return load('frontend/features/achievements/notifications.ts', {
    '@steambrew/client': { findModuleExport: noop }, '../../api/backend': { backendLog: noop },
    './game-info': { clearLocalAchievementGameInfoCache: noop }, '../../steam/localization': localize,
  }, { window: {} }, '\nexports.registeredWindowCount = () => nativeAchievementToastWindows.size;');
}
for (const name of ['SP Desktop_uid0', 'SP BPM', 'SP Overlay']) {
  const registry = notificationRegistry();
  const owner = appFixture({ disposeLocalAchievementsModal: noop,
    registerNativeAchievementToastWindow: registry.registerNativeAchievementToastWindow,
    unregisterNativeAchievementToastWindow: registry.unregisterNativeAchievementToastWindow });
  const surface = repairSurface(owner, name);
  owner.windowHook(surface.context);
  check(registry.registeredWindowCount() === 1, `${name} registers exactly one native notification Window`);
  if (name === 'SP Desktop_uid0') {
    surface.view.closed = true;
    for (const callback of [...owner.intervals.values()]) callback();
  } else surface.view.fire('unload');
  check(registry.registeredWindowCount() === 0,
    `${name} teardown releases the real notification registry Window without requiring another toast or game launch`);
  owner.descriptor.onDismount();
  check(registry.registeredWindowCount() === 0 && owner.timers.size === 0 && owner.intervals.size === 0,
    `${name} subsequent plugin disposal is idempotent and leaves no notification context or lifecycle timer`);
}
{
  const time = scheduler(), running = new Set([{ appid: 550 }, { appid: 105600 }, { appid: 1030300 }]);
  let now = 100000;
  const reads = [], replays = [], transitions = [];
  const watcher = load('frontend/features/achievements/launch-watcher.ts', {
    '../../api/backend': { backendLog: noop }, '../shortcuts/registry': { findMappingForShortcut: committed },
    './service': { fetchLocalAchievementData: (...args) => new Promise(resolve => reads.push({ args, resolve })) },
    './notifications': { cancelQueuedAchievementToastsForShortcut: noop,
      enqueueFirstLaunchAchievementToasts: (...args) => replays.push(args),
      enqueueLocalAchievementToasts: (...args) => transitions.push(args),
      latestNativeAchievementToastWindowRegistration: () => 0 },
  }, { ...time, window: { SteamUIStore: { RunningApps: running } }, Date: class extends Date { static now() { return now; } } });
  const poll = () => { for (const callback of [...time.intervals.values()]) callback(); };
  watcher.startFirstLaunchAchievementWatcher(); now += 60000; poll(); await flush();
  check(reads.length === 0 && replays.length === 0 && transitions.length === 0,
    'Running native L4D2, Terraria and Silksong never creates a local achievement read or replay notification');
  running.add({ appid: a - 4294967296 }); poll(); now += 30001; poll();
  check(reads.length === 1 && reads[0].args[0] === '111' && reads[0].args[1].stateAppId === a,
    'A signed linked shortcut still reads its exact installation after the launch readiness delay');
  watcher.stopFirstLaunchAchievementWatcher();
  reads[0].resolve({ found: true, total: 1, achievements: [{ name: 'A', earned: true }] }); await flush();
  check(replays.length === 0 && transitions.length === 0 && time.intervals.size === 0,
    'A read completing after watcher teardown cannot replay achievements or restart a timer');
  watcher.startFirstLaunchAchievementWatcher(); now += 30001; poll();
  reads[1].resolve({ found: true, total: 1, achievements: [{ name: 'A', earned: true }] }); await flush();
  check(replays.length === 1 && transitions.length === 1,
    'The native-game isolation test also retains real linked-game replay and transition detection');
  running.clear(); poll(); watcher.stopFirstLaunchAchievementWatcher();
  check(time.intervals.size === 0, 'Stopping a linked session and watcher releases the remaining poll interval');
}
const repairOwner = appFixture(), repaired = repairSurface(repairOwner);
repairOwner.windowHook(repaired.context);
check(repaired.queued.join(',') === '550', 'The actual validated desktop lifecycle asks Steam to refresh only the exact legacy public sentinel');
check(repairOwner.calls.filter(name => name === 'installNativeAchievementLayout').length === 1,
  'The validated desktop document also owns one native completion-layout installer');
check(repaired.map.get(550) === repaired.sentinel && Object.values(repaired.stats()).every(value => value === 0),
  'The repair caller performs no native Map set/delete/clear, entry mutation or SaveCacheFile write');
const duplicate = repaired.queued.length; repairOwner.windowHook(repaired.context);
check(repaired.queued.length === duplicate, 'Repeated Millennium notifications for the same document do not install duplicate repair requests');
repairOwner.descriptor.onDismount();
check(repairOwner.timers.size === 0 && repairOwner.intervals.size === 0, 'App teardown cancels the active document repair discovery timer with all other lifecycle work');
check(repairOwner.calls.filter(name => name === 'disposeNativeAchievementLayout').length === 1,
  'Desktop document teardown releases its native completion-layout installer');
const lateOwner = appFixture(), lateCache = repairSurface(lateOwner, 'SP Desktop_uid0', 'Steam', false);
lateOwner.windowHook(lateCache.context); lateOwner.descriptor.onDismount();
lateCache.view.appAchievementProgressCache = lateCache.cache; lateOwner.run(250);
check(lateCache.queued.length === 0, 'A native cache discovered after plugin shutdown cannot trigger a repair request');
for (const name of ['SP Desktop Popup', 'SP Overlay', 'SP BPM', 'Shared JS Context']) {
  const rejected = appFixture(), surface = repairSurface(rejected, name);
  rejected.windowHook(surface.context);
  check(surface.queued.length === 0, 'Auxiliary, overlay, Big Picture and background documents cannot run the desktop legacy cache repair');
  check(!rejected.calls.includes('installNativeAchievementLayout'), 'Foreign Steam documents cannot install the desktop completion-layout override');
  rejected.descriptor.onDismount();
}

function modalFixture() {
  const time = scheduler(), win = Object.assign(new Target(), time, { innerWidth: 1280, innerHeight: 720, closed: false });
  let route = `/library/app/${a}`;
  win.uiStore = { GetActiveWindowInstance: () => ({ LocationPathName: route }) };
  win.location = { href: `https://steamloopback.host${route}` };
  const doc = Object.assign(new Target(), { defaultView: win, documentElement: { clientWidth: 1280, clientHeight: 720 }, elements: new Map() });
  win.document = doc;
  class Element extends Target {
    style = { setProperty: noop }; dataset = {}; value = ''; options = [{ textContent: '' }]; selectedOptions = [];
    isConnected = false; children = new Map();
    querySelector(selector) { let node = this.children.get(selector); if (!node) this.children.set(selector, node = new Element()); return node; }
    querySelectorAll() { return []; }
    appendChild() {}
    setAttribute() {} focus() {}
    remove() { this.isConnected = false; doc.elements.delete(this.id); }
  }
  doc.body = { appendChild(node) { node.isConnected = true; doc.elements.set(node.id, node); } };
  doc.getElementById = id => doc.elements.get(id) || null;
  doc.createElement = () => new Element();
  const requests = [], observers = [];
  const nativeRoute = load('frontend/features/library/native-route.ts', {
    '../../steam/css': { LINKS_BAR_CLASSES: () => ({}), PLAYBAR_CLASSES: () => ({}) },
    '../../steam/native-dom': { elementsWithCssModuleClass: () => [], isRenderedElement: () => true },
    '../shortcuts/registry': { findMappingForShortcut: committed }, '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../../steam/library-details': { committedHeaderAppId: () => null, isPaintedLibraryElement: () => false },
    './constants': { GDL_INJECTED: 'gdl-library-injected' }, './notice': { findNonSteamNotice: () => null },
  }, { window: {} });
  const navigation = load('frontend/features/achievements/navigation.ts', {
    '../../api/backend': { backendLog: noop }, '../shortcuts/registry': { getCommittedShortcutSteamAppId: committed },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false }, '../library/native-route': nativeRoute,
    '../../steam/navigation': { openSteamNavigationUrl: noop }, '../../steam/localization': localize,
  });
  const modal = load('frontend/features/achievements/modal.ts', {
    '../../core/text': { escapeHtml: String }, '../../steam/localization': localize,
    './cache': { pickCachedLocalAchievementSnapshot: data => data }, './format': { localAchievementPercent: () => 50 },
    './game-info': { getLocalAchievementGameInfo: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) },
    './rarity': { highlightedAchievementNames: () => new Set(), isRareAchievement: () => false },
    './steam-rare': { getSteamRareAchievementClasses: () => ({}), renderSteamRareGlowHtml: () => '' },
    './styles/modal': { ensureAchievementModalStyles: noop }, './navigation': navigation,
    './comparison': { getAchievementComparisonFriends: async () => [], getFriendAchievementState: async () => new Map() },
    '../library/social/feed': { getCurrentSteamUser: () => ({ name: 'Current user', avatar: '' }) },
  }, { ResizeObserver: class { constructor() { observers.push(this); } observe() {} disconnect() { this.disconnected = true; } } });
  const data = { appid: '111', metadata_appid: '111', state_appid: String(a), total: 2, unlocked: 1, achievements: [] };
  const info = { name: 'Linked A', headerImage: '', heroImage: '' };
  return { doc, win, modal, nativeRoute, navigation, requests, observers, time, data, info,
    route(next) { route = next; win.location.href = `https://steamloopback.host${route}`; },
    element: () => doc.getElementById('gdl-local-achievement-modal') };
}
for (const destination of [`/library/app/${b}`, '/library/app/550']) {
  const f = modalFixture(), pending = f.modal.openLocalAchievementsModal(f.doc, f.data);
  f.route(destination); f.requests[0].resolve(f.info); await pending;
  check(!f.element() && f.doc.listenerCount === 0, 'A delayed metadata response cannot mount a modal after the real route changes');
}
const m = modalFixture(), app = appFixture(m.modal);
let pending = m.modal.openLocalAchievementsModal(m.doc, m.data);
app.app.navigate(m.doc); m.requests[0].resolve(m.info); await pending;
check(!m.element(), 'The real app navigation wrapper invalidates pending modal ownership even if the final route is the same AppID');
pending = m.modal.openLocalAchievementsModal(m.doc, m.data);
const old = pending, oldRequest = m.requests.at(-1);
m.modal.disposeLocalAchievementsModal(m.doc);
pending = m.modal.openLocalAchievementsModal(m.doc, m.data);
m.requests.at(-1).resolve(m.info); await pending;
const mounted = m.element(); oldRequest.resolve({ ...m.info, name: 'obsolete A' }); await old;
check(m.element() === mounted && mounted.innerHTML.includes('Linked A'), 'An old A -> B -> A completion cannot replace or dispose the newer modal');
check(m.doc.listenerCount === 3 && m.win.listenerCount === 1, 'An active modal installs its geometry listeners once');
m.doc.fire('pointermove');
check(m.time.frames.size === 1, 'A geometry change queues one modal frame');
app.app.navigate(m.doc);
check(!m.element() && m.doc.listenerCount === 0 && m.win.listenerCount === 0 && m.time.frames.size === 0 && m.observers.every(item => item.disconnected),
  'Navigation removes the live modal, all global geometry listeners, queued frames and ResizeObservers');
check(mounted.listenerCount === 0 && [...mounted.children.values()].every(element => element.listenerCount === 0),
  'Closing also detaches listeners from the removed overlay and all of its controls');
pending = m.modal.openLocalAchievementsModal(m.doc, m.data); m.modal.disposeAllLocalAchievementsModals();
m.requests.at(-1).resolve(m.info); await pending;
check(!m.element(), 'Global runtime disposal also invalidates pending modals without a mounted overlay');
m.route('/library/app/550'); const requestCount = m.requests.length;
await m.modal.openLocalAchievementsModal(m.doc, m.data);
check(m.requests.length === requestCount && !m.element(), 'Public native routes cannot start a local modal request');
m.route(`/library/app/${a}`);
pending = m.modal.openLocalAchievementsModal(m.doc, m.data); m.requests.at(-1).reject(new Error('metadata unavailable'));
await assert.rejects(pending, /metadata unavailable/);
check(!m.element() && m.doc.listenerCount === 0, 'A rejected metadata request leaves no modal or geometry listener behind');
const second = modalFixture(); second.route(`/library/app/${b}`);
const firstPending = m.modal.openLocalAchievementsModal(m.doc, m.data), firstRequest = m.requests.at(-1);
const secondPending = m.modal.openLocalAchievementsModal(second.doc, { ...m.data, appid: '222', metadata_appid: '222', state_appid: String(b) });
firstRequest.resolve(m.info); m.requests.at(-1).resolve({ ...m.info, name: 'Linked B' });
await Promise.all([firstPending, secondPending]);
check(m.element() && second.element(), 'Different Steam documents can each own their exact linked-game modal');
m.modal.disposeLocalAchievementsModal(m.doc);
check(!m.element() && second.element(), 'Disposing one document does not retire another window modal');
m.modal.disposeAllLocalAchievementsModals();
check(!second.element() && second.doc.listenerCount === 0 && second.win.listenerCount === 0,
  'Global plugin disposal closes every remaining document modal and its listeners');
app.descriptor.onDismount();

const storageWindow = Object.assign(new Target(), scheduler()), readRequests = [];
const lifecycle = load('frontend/features/achievements/lifecycle.ts', {
  '../../api/backend': { backendLog: noop }, '../../core/dom': { mutationIsWithinSelector: () => false },
  './cache': { clearLocalAchievementCache: noop }, './context': { clearAchievementRuntimeHost: noop },
  './modal': m.modal, './navigation': { linkedAchievementTarget: () => null, detectLinkedSteamAppId: () => '' },
  './notifications': { disposeAchievementNotifications: noop }, './playbar': {},
  './service': { clearLocalAchievementRequestCache: noop, subscribeLocalAchievementData: () => noop,
    fetchLocalAchievementData: async (...args) => { readRequests.push(args); return null; } },
  './sidebar': {}, './styles': { ensureLocalAchievementStyles: noop }, './game-info': { clearLocalAchievementGameInfoCache: noop },
  '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
  '../../steam/sidebar-interaction': { cancelLibrarySidebarWork: noop },
}, { window: storageWindow, MutationObserver: class { observe() {} disconnect() {} } });
const refresh = { key: 'gdl_achievement_refresh_v1', newValue: JSON.stringify({ steamAppId: '111', stateAppId: String(a) }) };
const lifecycleDoc = () => Object.assign(new Target(), { body: {}, defaultView: { closed: false }, getElementById: () => null });
const d1 = lifecycleDoc(), d2 = lifecycleDoc();
lifecycle.installLocalAchievementUI(d1); lifecycle.installLocalAchievementUI(d2);
check(storageWindow.listeners.get('storage').size === 1, 'Two Steam documents share exactly one refresh storage listener');
const oldStorage = [...storageWindow.listeners.get('storage')][0];
storageWindow.fire('storage', refresh);
check(readRequests.length === 1, 'An active targeted refresh still issues its intended exact-game request');
lifecycle.disposeAchievementRuntime(); storageWindow.fire('storage', refresh); oldStorage(refresh);
check(storageWindow.listeners.get('storage').size === 0 && readRequests.length === 1,
  'Runtime disposal removes the storage handler and rejects an already queued old callback');
lifecycle.installLocalAchievementUI(d1); oldStorage(refresh); storageWindow.fire('storage', refresh);
check(storageWindow.listeners.get('storage').size === 1 && readRequests.length === 2,
  'Re-enabling installs one fresh handler while the earlier generation stays inert');
lifecycle.disposeAchievementRuntime();
let metadataReads = 0, metadataFails = true, artwork = null;
const gameInfo = load('frontend/features/achievements/game-info.ts', {
  '../../core/game-data': { getGameData: async () => { metadataReads++; if (metadataFails) throw new Error('offline'); return { name: 'Confirmed game', header_image: 'header.jpg' }; } },
  '../library/library-assets': { getResolvedLibraryAssets: () => artwork },
});
const fallbackInfo = await gameInfo.getLocalAchievementGameInfo('111');
check(fallbackInfo.name === 'App 111' && metadataReads === 1, 'A failed achievement-header metadata request returns a neutral fallback');
metadataFails = false;
const confirmedInfo = await gameInfo.getLocalAchievementGameInfo('111');
check(confirmedInfo.name === 'Confirmed game' && metadataReads === 2, 'The failed metadata fallback is not cached and the next request can recover');
await gameInfo.getLocalAchievementGameInfo('111');
check(metadataReads === 2, 'A successful metadata response remains cached instead of repeatedly requesting Steam data');
artwork = { hero: 'native-hero.jpg', icon: 'native-icon.jpg' };
const refreshedArtwork = await gameInfo.getLocalAchievementGameInfo('111');
check(metadataReads === 2 && refreshedArtwork.heroImage === 'native-hero.jpg' && refreshedArtwork.iconImage === 'native-icon.jpg',
  'Cached achievement metadata adopts newly resolved native artwork without another metadata request');
console.log(`Achievement lifecycle passed: ${checks} assertions; real app teardown/native-hook restoration, startup cancellation, routed modal ownership and storage listener cleanup.`);
