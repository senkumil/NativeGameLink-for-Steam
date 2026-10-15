import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies, globals = {}, expose = '') {
  const context = vm.createContext({ exports: {}, console, ...globals, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText + expose, context);
  return context.exports;
}
class Target {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
}
class Element extends Target {
  nodeType = 1;
  isConnected = true;
  children = [];
  dataset = {};
  style = {};
  classList = { contains: token => this.className.split(/\s+/).includes(token) };
  constructor(className = '') { super(); this.className = className; }
  closest(selector = '') {
    if (!selector.includes('[id^="gdl-"]')) return null;
    for (let current = this; current; current = current.parentElement) if (current.id?.startsWith('gdl-')) return current;
    return null;
  }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 650, right: 1200, top: 100, bottom: 900, width: 550, height: 800 }; }
}
const css = {
  LIBRARY_SIDEBAR_ENTRY_CLASSES: () => ({ Container: '_nativeRow', GameListEntryContainer: '_nativeEntry' }),
  LIBRARY_SIDEBAR_CLASSES: () => ({ Container: '_nativeSidebar' }),
};
const signals = load('frontend/steam/library-sidebar.ts', { './css': css });
const domSignals = load('frontend/core/dom.ts', {});
function scope() {
  let next = 0;
  const timers = new Map(), frames = new Map(), intervals = new Map(), observers = [];
  const win = Object.assign(new Target(), {
    setTimeout: callback => { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: callback => { const id = ++next; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    requestAnimationFrame: callback => { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: () => ({}), innerHeight: 1080,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.disconnected = true; }
    },
  });
  const doc = Object.assign(new Target(), {
    body: new Element(), documentElement: new Element(), defaultView: win, hidden: false,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  });
  const list = new Element('_nativeSidebar'), icon = new Element('_nativeIcon');
  icon.parentElement = list;
  const details = new Element('_details');
  const sidebarRecords = [{ target: list, addedNodes: [icon], removedNodes: [] }];
  const detailsRecords = [{ target: details, addedNodes: [new Element('_newDetails')], removedNodes: [] }];
  const owned = new Element('_owned'); owned.id = 'gdl-new-content';
  const ownedRecords = [{ target: details, addedNodes: [owned], removedNodes: [] }];
  const mixedOwnedRecords = [...sidebarRecords, ...ownedRecords];
  const mixedDetailsRecords = [...mixedOwnedRecords, ...detailsRecords];
  const globals = { window: win, HTMLElement: Element, Element, MutationObserver: win.MutationObserver,
    navigator: { getGamepads: () => [] }, setTimeout: win.setTimeout, clearTimeout: win.clearTimeout };
  const drainFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  return { doc, win, timers, frames, intervals, observers, list, icon, details, sidebarRecords, detailsRecords, ownedRecords,
    mixedOwnedRecords, mixedDetailsRecords, globals, drainFrames };
}

const info = scope();
let ensured = 0;
const shortcutA = 3000000001, shortcutB = 3000000002;
const linkedInfo = new Map([[shortcutA, '10'], [shortcutB, '10']]);
const infoClasses = { Container: 'NativePlaybar', AppButtonsContainer: 'NativeAppButtons' };
const classElements = (root, css) => (root.nativeClusters || []).filter(element => element.classList.contains(css));
const closestClass = (element, css) => {
  for (let current = element; current; current = current.parentElement) if (css && current.classList.contains(css)) return current;
  return null;
};
const nativeDetails = load('frontend/steam/library-details.ts', {
  './css': { PLAYBAR_CLASSES: () => infoClasses },
  './native-dom': { elementsWithCssModuleClass: classElements, hasCssModuleClass: (element, css) => element.classList.contains(css), isRenderedElement: () => true },
}, info.globals);
const infoTarget = load('frontend/features/library/info-button-target.ts', {
  '../../steam/native-dom': { elementsWithCssModuleClass: classElements, closestWithCssModuleClass: closestClass },
  './native-route': { isPublicSteamLibraryRoute: doc => Boolean(doc.publicRoute), routedSteamAppId: doc => doc.routeId ?? null },
  '../../steam/library-details': nativeDetails,
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => linkedInfo.get(id) || null },
}, info.globals);
const infoModule = load('frontend/features/library/info-panel.ts', {
  '../../core/text': {}, '../../core/dom': domSignals, '../../steam/css': { PLAYBAR_CLASS_MODULE: () => ({ native: false, classes: {} }), LIBRARY_SIDEBAR_CLASSES: () => ({ Container: '_nativeSidebar' }) },
  '../../steam/localization': {}, '../../steam/native-dom': { elementsWithCssModuleClass: classElements, closestWithCssModuleClass: closestClass },
  './native-route': { isPublicSteamLibraryRoute: doc => Boolean(doc.publicRoute), routedSteamAppId: doc => doc.routeId ?? null },
  '../../steam/library-details': nativeDetails,
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => linkedInfo.get(id) || null },
  './info-button-target': infoTarget,
  '../../steam/achievement-playbar-space': { syncAchievementPlaybarSpace() {} },
  './feature-icons': {}, '../../steam/library-sidebar': signals,
}, info.globals, '\nexports.installScrollBehavior = installInfoButtonScrollBehavior; exports.scrollMainContentToTop = scrollMainContentToTop;');
Object.assign(infoModule, infoTarget);
infoModule.installScrollBehavior(info.doc, '', () => ensured++);
info.drainFrames();
const initialEnsured = ensured;
for (let i = 0; i < 100; i++) {
  info.doc.fire('scroll', { target: info.list });
  info.doc.fire('wheel', { target: info.icon, clientX: 0 });
  info.observers[0].callback(info.sidebarRecords);
  info.observers[0].callback(info.mixedOwnedRecords);
}
assert.equal(info.frames.size + info.timers.size, 0, 'sidebar scroll/focus/icon recycling never schedules Info button updates');
assert.equal(ensured, initialEnsured);
info.observers[0].callback(info.mixedDetailsRecords);
assert(info.frames.size + info.timers.size > 0, 'a real details mutation still schedules Info reconciliation');
infoModule.removeNativeInfoButton(info.doc);
assert.equal(info.frames.size + info.timers.size, 0);

info.doc.routeId = shortcutA;
const currentInfo = () => infoModule.isCurrentInfoShortcut(info.doc, shortcutA, '10');
assert.equal(currentInfo(), true);
infoModule.installScrollBehavior(info.doc, '', () => ensured++, currentInfo);
info.drainFrames();
const beforeRouteChange = ensured;
const guardedObserver = info.observers.at(-1);
info.doc.routeId = shortcutB;
assert.equal(linkedInfo.get(shortcutA), linkedInfo.get(shortcutB), 'The race fixture shares metadata but has different shortcut identity');
assert.equal(currentInfo(), false, 'The previous callback cannot be current merely because the Steam AppID is shared');
for (let i = 0; i < 100; i++) {
  guardedObserver.callback(info.detailsRecords);
  info.doc.fire('scroll', { target: info.details });
  info.doc.fire('wheel', { target: info.details, clientX: 900 });
  info.win.fire('resize', {});
}
assert.equal(info.frames.size + info.timers.size, 0, 'Stale shortcut callbacks schedule no scans, RAFs or timers');
assert.equal(ensured, beforeRouteChange, '100 stale callbacks perform no button reconciliation or writes');
info.doc.routeId = shortcutA;
guardedObserver.callback(info.detailsRecords);
assert.ok(info.frames.size + info.timers.size > 0, 'A current shortcut still schedules real details reconciliation');
info.doc.routeId = shortcutB;
for (const [id, callback] of [...info.timers]) { info.timers.delete(id); callback(); }
info.drainFrames();
assert.equal(ensured, beforeRouteChange, 'Work queued for A rechecks identity before executing after B');
assert.equal(info.frames.size + info.timers.size, 0);
info.doc.routeId = shortcutA;
linkedInfo.set(shortcutA, '11');
assert.equal(currentInfo(), false, 'Relinking the same shortcut invalidates the captured metadata model');
linkedInfo.set(shortcutA, '10');
info.doc.publicRoute = true;
assert.equal(currentInfo(), false, 'Native Steam ownership invalidates the callback');
info.doc.publicRoute = false;
infoModule.removeNativeInfoButton(info.doc);

function committed(element, appid) {
  const root = { tag: 3, stateNode: {}, return: null, child: null, alternate: null };
  root.stateNode.current = root;
  const host = { tag: 5, memoizedProps: { overview: { appid } }, return: root, child: null, sibling: null, alternate: null };
  root.child = host; element.__reactFiber$fixture = host;
  return element;
}
function commitAlternate(element, appid) {
  const previous = element.__reactFiber$fixture, previousRoot = previous.return;
  const root = { tag: 3, stateNode: previousRoot.stateNode, return: null, child: null, alternate: previousRoot };
  const current = { tag: 5, memoizedProps: { overview: { appid } }, return: root, child: null, sibling: null, alternate: previous };
  previous.alternate = current; previousRoot.alternate = root;
  root.child = current; root.stateNode.current = root;
  return element;
}
const clusterA = committed(new Element(infoClasses.AppButtonsContainer), shortcutA);
const clusterB = committed(new Element(infoClasses.AppButtonsContainer), shortcutB);
const clusterNative = committed(new Element(infoClasses.AppButtonsContainer), 570);
const parentA = committed(new Element(infoClasses.Container), shortcutA);
const inheritedA = new Element(infoClasses.AppButtonsContainer); inheritedA.parentElement = parentA;
const conflicting = committed(new Element(infoClasses.AppButtonsContainer), shortcutB); conflicting.parentElement = parentA;
const unknown = new Element(infoClasses.AppButtonsContainer);
const ownedParent = committed(new Element(infoClasses.Container), shortcutA); ownedParent.id = 'gdl-owned';
const ownedCluster = committed(new Element(infoClasses.AppButtonsContainer), shortcutA); ownedCluster.parentElement = ownedParent;
const disconnected = committed(new Element(infoClasses.AppButtonsContainer), shortcutA); disconnected.isConnected = false;
clusterNative.children = [new Element('NativeButton')];
const nativeChildren = [...clusterNative.children];
info.doc.nativeClusters = [clusterA, clusterB, clusterNative, inheritedA, conflicting, unknown, ownedCluster, disconnected];
assert.deepEqual(Array.from(infoModule.nativeInfoButtonContainers(info.doc, infoClasses, shortcutA)), [clusterA, inheritedA],
  'Only A committed clusters and its real parent-owned cluster qualify; retained B/native/unknown/owned hosts stay untouched');
assert.deepEqual(clusterNative.children, nativeChildren, 'Host selection never changes native buttons');
assert.equal(conflicting.parentElement, parentA, 'A parent fallback cannot override explicit conflicting committed ownership');
assert.deepEqual(Array.from(infoModule.nativeInfoButtonContainers(info.doc, infoClasses, shortcutB)), [clusterB, conflicting]);

const pendingOnly = committed(new Element(infoClasses.AppButtonsContainer), shortcutA);
pendingOnly.__reactFiber$fixture.memoizedProps = { className: infoClasses.AppButtonsContainer };
pendingOnly.__reactFiber$fixture.pendingProps = { overview: { appid: shortcutA } };
const nowNative = commitAlternate(committed(new Element(infoClasses.AppButtonsContainer), shortcutA), 570);
const nowShortcut = commitAlternate(committed(new Element(infoClasses.AppButtonsContainer), 570), shortcutA);
nowNative.children = [new Element('UntouchedNativeButton')];
const committedNativeChildren = [...nowNative.children];
info.doc.nativeClusters = [pendingOnly, nowNative, nowShortcut];
assert.deepEqual(Array.from(infoModule.nativeInfoButtonContainers(info.doc, infoClasses, shortcutA)), [nowShortcut],
  'Pending props do not authorize Info writes; a reused host follows only its currently mounted alternate');
assert.deepEqual(nowNative.children, committedNativeChildren, 'An alternate committed to a native game retains all Steam buttons');

const scrollScope = scope();
scrollScope.doc.routeId = shortcutA;
const detailScroller = new Element('_detailsScroll'), unrelatedScroller = new Element('_unrelatedScroll');
const anchor = new Element(); anchor.id = 'gdl-link-bar';
const append = (parent, child) => { parent.children.push(child); child.parentElement = parent; };
append(detailScroller, anchor); append(scrollScope.doc.body, scrollScope.list); append(scrollScope.doc.body, detailScroller);
append(scrollScope.doc.body, unrelatedScroller); append(scrollScope.doc.documentElement, scrollScope.doc.body);
scrollScope.doc.getElementById = id => id === anchor.id ? anchor : null;
scrollScope.doc.nativeClusters = [scrollScope.list];
scrollScope.doc.scrollingElement = scrollScope.doc.documentElement;
for (const element of [scrollScope.list, detailScroller, unrelatedScroller, scrollScope.doc.body, scrollScope.doc.documentElement]) {
  element.scrollTop = 400; element.scrollHeight = 2000; element.clientHeight = 600;
}
let listScrollWrites = 0, listOffset = 400, globalScrollCalls = 0;
Object.defineProperty(scrollScope.list, 'scrollTop', { get: () => listOffset, set: value => { listScrollWrites++; listOffset = value; } });
scrollScope.win.scrollTo = () => { globalScrollCalls++; };
scrollScope.win.getComputedStyle = () => ({ overflowY: 'auto' });
detailScroller.scrollTo = () => { detailScroller.scrollTop = 0; };
scrollScope.doc.querySelectorAll = selector => { assert.notEqual(selector, '*', 'Back-to-top must never scan every native element'); return []; };
infoModule.scrollMainContentToTop(scrollScope.doc, [scrollScope.list, scrollScope.doc.body, unrelatedScroller]);
assert.equal(detailScroller.scrollTop, 0, 'Back-to-top scrolls only the exact ancestor of a linked details anchor');
assert.equal(listOffset, 400, 'Back-to-top preserves the virtual list’s current scroll position');
assert.equal(unrelatedScroller.scrollTop, 400, 'a geometrically similar scroller with no details anchor remains untouched');
assert.equal(scrollScope.doc.documentElement.scrollTop, 400, 'a common Library ancestor containing both panes cannot be reset');
assert.equal(globalScrollCalls + listScrollWrites, 0, 'no document-global scroll or sidebar scroll writes occur');
assert.equal(scrollScope.timers.size, 2);
detailScroller.scrollTop = 170; listOffset = 650;
const [firstSettle, secondSettle] = [...scrollScope.timers.values()];
firstSettle();
assert.equal(detailScroller.scrollTop, 0, 'the 280ms settling callback still reaches the exact details pane top');
assert.equal(listOffset, 650, 'the 280ms settling callback preserves rapid sidebar scrolling');
detailScroller.scrollTop = 230; scrollScope.doc.routeId = shortcutB; secondSettle();
assert.equal(detailScroller.scrollTop, 230, 'the 520ms callback discards work after navigation to another shortcut');
assert.equal(listOffset, 650); assert.equal(listScrollWrites + globalScrollCalls, 0);
scrollScope.doc.routeId = shortcutA;
infoModule.resetMainScrollToTop(scrollScope.doc);
assert.equal(detailScroller.scrollTop, 0, 'navigation resets only the current details scroller');
assert.equal(listOffset, 650); assert.equal(listScrollWrites + globalScrollCalls, 0, 'navigation reset never touches the sidebar or global document scroll');

const controller = scope();
const controllerModule = load('frontend/features/library/controller.ts', {
	'../achievements/navigation': { linkedAchievementTarget: () => null },
	'../../steam/library-details': { committedHeaderAppId: () => null },
  '../../api/backend': { backendLog() {} }, '../../core/text': {}, '../../core/dom': domSignals, '../../core/game-data': {},
  '../../steam/gamepad/stores/AppStoreAdapter': {}, '../../steam/localization': {}, './styles/controller': {}, './layout': {},
  '../../steam/modules/SteamModuleResolver': { getSteamStore: () => null },
  '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { getAllModules: () => [], getRequire: () => null } },
  '../../steam/sidebar-interaction': { isLibrarySidebarInteractionActive: () => false },
  './sidebar-order': { getLinkedSidebarOrder: () => null, hasLinkedSidebarOrder: () => false },
  './controller-svgs': {}, '../../steam/library-sidebar': signals,
}, controller.globals, '\nexports.installScrollBehavior = setupControllerScrollTranslucencyWatcher;');
const controllerColumn = new Element();
const disposeController = controllerModule.installScrollBehavior(controller.doc, { sidebarColumn: controllerColumn }, '10', '3000000000', () => true);
assert.equal(controller.observers[0].target, controllerColumn, 'controller recovery watches only its actual details column');
assert.deepEqual({ ...controller.observers[0].options }, { childList: true }, 'controller recovery does not observe body or nested section updates');
controller.drainFrames();
for (let i = 0; i < 100; i++) {
  controller.win.fire('scroll', { target: controller.list });
  controller.observers[0].callback(controller.sidebarRecords);
  controller.observers[0].callback(controller.mixedOwnedRecords);
}
assert.equal(controller.frames.size, 0, 'sidebar recycling never schedules controller scans or rendering');
controller.observers[0].callback(controller.mixedDetailsRecords);
assert.equal(controller.frames.size, 0, 'unrelated details changes no longer scan or rebuild the controller');
const removedController = new Element(); removedController.id = 'gdl-controller-section';
controller.observers[0].callback([{ target: controllerColumn, addedNodes: [], removedNodes: [removedController] }]);
assert.equal(controller.frames.size, 1);
disposeController();
assert.equal(controller.frames.size, 0);

const achievements = scope();
let achievementReads = 0;
const achievementModule = load('frontend/features/achievements/lifecycle.ts', {
  '../../api/backend': { backendLog() {} }, '../../core/dom': domSignals, './cache': {},
  './context': { achievementRuntimeHost: () => ({ getCurrentInjectedShortcutAppId: () => '3000000000' }) },
  './modal': { disposeLocalAchievementsModal() {}, disposeAllLocalAchievementsModals() {} }, './navigation': {
    detectLinkedSteamAppId: () => '10',
    linkedAchievementTarget: () => ({ steamAppId: '10', shortcutAppId: '3000000000' }),
    isCurrentAchievementTarget: () => true, ownsAchievementSidebar: () => false,
  }, './notifications': {}, './playbar': {},
  './service': { subscribeLocalAchievementData: () => () => {}, fetchLocalAchievementData: async () => { achievementReads++; return null; } },
  './sidebar': {}, './styles': { ensureLocalAchievementStyles() {} }, './game-info': {}, '../../steam/library-sidebar': signals,
  '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: (_doc, _key, task) => Promise.resolve(task()), cancelLibrarySidebarWork() {} },
}, achievements.globals);
achievementModule.installLocalAchievementUI(achievements.doc);
for (const [id, callback] of [...achievements.timers]) { achievements.timers.delete(id); callback(); }
await Promise.resolve(); await Promise.resolve();
const readsBeforeScroll = achievementReads;
for (let i = 0; i < 100; i++) {
  achievements.observers[0].callback(achievements.sidebarRecords);
  achievements.observers[0].callback(achievements.mixedOwnedRecords);
}
assert.equal(achievements.timers.size, 0, 'sidebar icon/focus changes never schedule achievement refresh');
assert.equal(achievementReads, readsBeforeScroll);
achievements.observers[0].callback(achievements.mixedDetailsRecords);
assert.equal(achievements.timers.size, 1, 'details updates still synchronize achievement polling');
achievementModule.disposeLocalAchievementUI(achievements.doc);
assert.equal(achievements.timers.size + achievements.intervals.size, 0);

// Exercise the real injection body and every desktop navigation signal without
// loading the settings UI or running Steam startup. Stubbing runInjection itself
// would hide repeated synchronous early-playbar work after a route change.
const app = scope(), appScans = [], copiedScans = [], appRuns = [], appInjections = [], playtimeRefreshes = [];
const appSource = ts.createSourceFile('app.tsx', fs.readFileSync('frontend/runtime/app.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let appObserver, appInjection, visibilityListener, navigationInterval;
const findApplicationSignals = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(appSource) === 'runInjection' && node.initializer) {
    appInjection = node.initializer.getText(appSource);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(appSource) === 'observer'
    && node.initializer && ts.isNewExpression(node.initializer)
    && node.initializer.expression.getText(appSource) === 'MutationObserver') appObserver = node.initializer.getText(appSource);
  if (ts.isCallExpression(node) && node.expression.getText(appSource) === 'lifecycle.listen'
    && node.arguments[1] && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === 'visibilitychange') {
    visibilityListener = node.getText(appSource);
  }
  if (ts.isCallExpression(node) && node.expression.getText(appSource) === 'lifecycle.interval'
    && node.arguments[1]?.getText(appSource) === '2500'
    && node.arguments[0].getText(appSource).includes('libraryRouteIdentity(popupDoc)')) {
    navigationInterval = node.getText(appSource);
  }
  ts.forEachChild(node, findApplicationSignals);
};
findApplicationSignals(appSource);
assert(appObserver, 'the main application observer fixture loads its real source');
assert(appInjection, 'the fixture loads the real injection body so duplicate early synchronization remains observable');
assert(visibilityListener, 'the fixture loads the real visibility listener');
assert(navigationInterval, 'the fixture loads the real navigation watchdog');
let navigations = 0, earlySyncs = 0, cancelledPaints = 0;
const appContext = vm.createContext({ exports: {}, ...app.globals, Date,
  popupDoc: app.doc, isMainWindow: true, routePath: '/library/app/3000000000', lastNavUrl: '/library/app/3000000000',
  mutationTimer: null, lastMutationInjectionAt: 0, wasBigPictureSurface: false, hasHadBigPictureSession: false,
  publicRoute: false, ownedChrome: false,
  libraryRouteIdentity: () => appContext.routePath,
  handleLibraryNavigation: () => navigations++, earlyPlaybar: { sync: () => earlySyncs++ },
  cancelPendingLibraryPaint: doc => { assert.equal(doc, app.doc); cancelledPaints++; },
  recordInjection: reason => appRuns.push(reason),
  tryInjectLibraryData: doc => { assert.equal(doc, app.doc); appInjections.push(appContext.routePath); return Promise.resolve(); },
  syncLinkedFirstContent: doc => assert.equal(doc, app.doc),
  schedulePlaytimeRefresh: immediate => playtimeRefreshes.push(immediate),
  hasOwnedLibraryChrome: () => appContext.ownedChrome,
  getBigPictureDocument: () => null, handleBigPictureExit() {}, activateBigPicture() {},
  refreshBigPicture: () => Promise.resolve(), backendLog() {},
  tryInjectPropertiesField() { assert.fail('desktop navigation must not scan Properties popup fields'); },
  tryInjectCustomizationArtwork() { assert.fail('desktop navigation must not scan customization popup fields'); },
  lifecycle: {
    listen: (target, type, callback) => target.addEventListener(type, callback),
    interval: (callback, delay) => { assert.equal(delay, 2500); app.win.setInterval(callback); },
  },
  withoutLibrarySidebarMutations: signals.withoutLibrarySidebarMutations,
  isGdlOnlyMutation: record => domSignals.mutationIsWithinSelector(record, '[id^="gdl-"]'),
  isPublicSteamLibraryRoute: () => appContext.publicRoute, isBigPictureSurface: () => false,
  mutationMayContainDesktopPlaytime: roots => { appScans.push([...roots]); return false; },
  syncDesktopLibraryHomePlaytimeDom() {}, scheduleCopiedFeedbackCleanup: (_doc, roots) => copiedScans.push([...roots]),
  mutationMayContainNonSteamNotice: roots => { appScans.push([...roots]); return false; },
  mutationMayContainProperties: roots => { appScans.push([...roots]); return false; },
});
vm.runInContext(ts.transpileModule(`
  const realRunInjection = ${appInjection};
  const runInjection = (...args) => { recordInjection(args[0]); return realRunInjection(...args); };
  exports.observer = ${appObserver};
  ${visibilityListener};
  ${navigationInterval};
`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, appContext);
const applicationObserver = appContext.exports.observer;
for (let index = 0; index < 100; index++) applicationObserver.callback(app.mixedOwnedRecords);
assert.equal(appScans.length + appRuns.length + app.timers.size, 0,
  '100 mixed sidebar/GDL batches trigger no application scans, hydration or timers');
applicationObserver.callback(app.mixedDetailsRecords);
assert.equal(app.timers.size, 1, 'a mixed batch retaining real native details schedules metadata work');
assert(appScans.length > 0);
assert(appScans.flat().every(node => !signals.isLibrarySidebarNode(node) && !node.id?.startsWith('gdl-')),
  'application text and subtree scanners receive only the real detail records');
appContext.routePath = '/library/app/3000000001';
applicationObserver.callback(app.mixedOwnedRecords);
assert.equal(navigations, 1, 'real route changes are processed even when the delivered batch is sidebar/GDL only');
assert.equal(earlySyncs, 1);
assert.deepEqual(appRuns, ['navigation']);
assert.deepEqual(appInjections, ['/library/app/3000000001'], 'actual A-to-B navigation performs one metadata injection');
assert.deepEqual(playtimeRefreshes, [true]);
assert.equal(app.timers.size, 0, 'real navigation cancels the previous details debounce');

function applicationSnapshot() {
  return { navigations, earlySyncs, runs: appRuns.length, injections: appInjections.length, playtime: playtimeRefreshes.length };
}
function assertApplicationDelta(before, expected, label) {
  const after = applicationSnapshot();
  for (const key of Object.keys(before)) assert.equal(after[key] - before[key], expected[key] ?? 0, `${label}: ${key}`);
}
const watchdog = [...app.intervals.values()][0];
assert.equal(app.intervals.size, 1, 'only the extracted real navigation watchdog is installed');

let beforeApp = applicationSnapshot();
for (let index = 0; index < 100; index++) {
  applicationObserver.callback(app.mixedOwnedRecords);
  watchdog();
}
assertApplicationDelta(beforeApp, {}, 'same-route owned/sidebar signals and watchdog polls perform no injection or early sync');
assert.equal(app.timers.size, 0);

applicationObserver.callback(app.detailsRecords);
assert.equal(app.timers.size, 1, 'ordinary same-route details mutations retain their debounce');
beforeApp = applicationSnapshot();
for (const [id, callback] of [...app.timers]) { app.timers.delete(id); callback(); }
assertApplicationDelta(beforeApp, { earlySyncs: 1, runs: 1, injections: 1, playtime: 1 },
  'ordinary metadata mutations still synchronize the early playbar exactly once');
assert.equal(appRuns.at(-1), 'mutation');
assert.equal(playtimeRefreshes.at(-1), false, 'mutation work preserves the non-immediate playtime refresh policy');

beforeApp = applicationSnapshot();
app.doc.fire('visibilitychange');
assertApplicationDelta(beforeApp, { earlySyncs: 1, runs: 1, injections: 1, playtime: 1 },
  'visibility on the same linked route synchronizes once within the real injection body');
assert.equal(appRuns.at(-1), 'visibility');

beforeApp = applicationSnapshot();
appContext.routePath = '/library/app/3000000002';
app.doc.fire('visibilitychange');
assertApplicationDelta(beforeApp, { navigations: 1, earlySyncs: 1, runs: 1, injections: 1, playtime: 1 },
  'visibility detecting a new linked route reuses its completed early synchronization');
assert.equal(appRuns.at(-1), 'visibility');

beforeApp = applicationSnapshot();
appContext.routePath = '/library/app/3000000003';
watchdog();
assertApplicationDelta(beforeApp, { navigations: 1, earlySyncs: 1, runs: 1, injections: 1, playtime: 1 },
  'the navigation watchdog performs one early synchronization when it discovers a new route');
assert.equal(appRuns.at(-1), 'navigation');
beforeApp = applicationSnapshot();
applicationObserver.callback(app.ownedRecords);
watchdog();
assertApplicationDelta(beforeApp, {}, 'observer delivery after watchdog navigation cannot repeat the same route work');

beforeApp = applicationSnapshot();
app.doc.hidden = true;
appContext.routePath = '/library/app/3000000004';
app.doc.fire('visibilitychange');
watchdog();
assertApplicationDelta(beforeApp, {}, 'hidden documents retain the existing visibility/watchdog no-work guard');
assert.equal(cancelledPaints, 1, 'hiding Steam cancels the native artwork wait instead of leaving a shared pending promise');
app.doc.hidden = false;
app.doc.fire('visibilitychange');
assertApplicationDelta(beforeApp, { navigations: 1, earlySyncs: 1, runs: 1, injections: 1, playtime: 1 },
  'revealing the hidden document processes its pending linked route exactly once');

beforeApp = applicationSnapshot();
appContext.publicRoute = true;
appContext.routePath = '/library/app/570';
applicationObserver.callback(app.mixedOwnedRecords);
assertApplicationDelta(beforeApp, { navigations: 1, earlySyncs: 1, runs: 1 },
  'navigation to a native Steam route retires early linked UI once without metadata work when no owned chrome remains');
beforeApp = applicationSnapshot();
applicationObserver.callback(app.detailsRecords);
app.doc.fire('visibilitychange');
watchdog();
assertApplicationDelta(beforeApp, { runs: 2 }, 'native same-route signals without owned chrome never start metadata injection or early sync');
assert.equal(app.timers.size, 0, 'native cleanup retains its immediate path without a metadata debounce');

beforeApp = applicationSnapshot();
appContext.ownedChrome = true;
appContext.routePath = '/library/app/730';
applicationObserver.callback(app.mixedOwnedRecords);
assertApplicationDelta(beforeApp, { navigations: 1, earlySyncs: 1, runs: 1, injections: 1 },
  'native navigation still performs one retirement injection when stale owned chrome exists');
assert.equal(playtimeRefreshes.at(-1), true);

// Body portals must be processed before both native-route and navigation exits.
const copiedPortal = new Element('_3cXgxM5dBuTxGOOYw0lxsP');
const copiedRecord = { target: app.doc.body, addedNodes: [copiedPortal], removedNodes: [] };
let copiedBefore = copiedScans.length;
appContext.routePath = '/library/app/105600';
applicationObserver.callback([copiedRecord]);
assert.equal(copiedScans.length, copiedBefore + 1, 'a copied portal is checked even in the route-change batch');
assert.equal(copiedScans.at(-1)[0], copiedPortal);
copiedBefore = copiedScans.length;
applicationObserver.callback([copiedRecord]);
assert.equal(copiedScans.length, copiedBefore + 1, 'a copied portal is checked on an already active native game');
assert.equal(app.timers.size, 0, 'copied portal cleanup on native games does not start metadata timers');

console.log('Sidebar observer integration passed: 100 native and mixed sidebar/owned cycles schedule zero Info, controller or achievement work; real navigation, visibility, watchdog and mutation injection synchronize the early playbar once and preserve native-route retirement.');
