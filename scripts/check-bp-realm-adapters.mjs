import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const runtimeStates = new WeakMap();
const runtimeReads = [];
const logs = [];
const runtime = {
  captureRuntime(doc) { runtimeReads.push(doc); return runtimeStates.has(doc); },
  getRuntimeIdentity: doc => runtimeStates.get(doc)?.identity || null,
  getAllModules: doc => runtimeStates.get(doc)?.modules || [],
};
function fixture(name) {
  const doc = { body: { isConnected: true } };
  const overview = Object.freeze({ appid: 550, display_name: name, nativeValue: name });
  const appStore = { m_mapApps: new Map([[550, overview]]), nativeValue: name };
  const libraryStore = Object.freeze({ nativeValue: `library-${name}` });
  const userStore = Object.freeze({ m_strPersonaName: name, nativeValue: `user-${name}` });
  const win = { document: doc, closed: false, appStore, libraryStore, userStore };
  doc.defaultView = win;
  return { doc, win, overview, appStore, libraryStore, userStore };
}
const desktop = fixture('Desktop'), a = fixture('BP-A'), b = fixture('BP-B');
const context = vm.createContext({ exports: {}, document: desktop.doc, window: desktop.win,
  require: name => {
    if (name === './AppStoreAdapter') return appModule;
    if (name === '../../../api/backend') return { backendLog: value => logs.push(value) };
    if (name === '../../modules/SteamWebpackRuntime') return { steamWebpackRuntime: runtime };
    if (name === './pure-class-factory') return pureClasses;
    throw new Error(`Unexpected dependency ${name}`);
  },
});
function load(path) {
  const exports = {};
  const factory = vm.runInContext(`(function(exports, require) {\n${compile(fs.readFileSync(path, 'utf8'))}\n})`, context, { filename: path });
  factory(exports, context.require);
  return exports;
}
const appModule = load('frontend/steam/gamepad/stores/AppStoreAdapter.ts');
const { AppStoreAdapter: App } = appModule;
const { LibraryStoreAdapter: Library } = load('frontend/steam/gamepad/stores/LibraryStoreAdapter.ts');
const { UserStoreAdapter: User } = load('frontend/steam/gamepad/stores/UserStoreAdapter.ts');
const pureClasses = load('frontend/steam/gamepad/components/pure-class-factory.ts');
const classes = load('frontend/steam/gamepad/components/AppDetailsNativeClasses.ts');
for (const f of [a, b, desktop]) {
  check(App.getStore(f.doc) === f.appStore, 'AppStore belongs to the requested document');
  check(App.getAppOverview(550, f.doc) === f.overview, 'Native overview object identity is preserved');
  check(Library.getStore(f.doc) === f.libraryStore && User.getStore(f.doc) === f.userStore, 'Library/User stores belong to the same document');
  check(User.getPersonaName(f.doc) === f.overview.display_name, 'Persona name uses the requested realm');
}
check(App.getStore() === desktop.appStore && User.getPersonaName() === 'Desktop', 'Omitted document uses the global document, never the last BP realm');
const empty = fixture('empty');
delete empty.win.appStore; delete empty.win.libraryStore; delete empty.win.userStore;
empty.win.parent = a.win; empty.win.top = b.win;
empty.win.g_PopupManager = { GetExistingPopup: () => ({ window: a.win }) };
check(App.getStore(empty.doc) === null && Library.getStore(empty.doc) === null && User.getStore(empty.doc) === null, 'Missing local stores never borrow parent, popup or global stores');
empty.win.APPSTORE = a.appStore;
check(App.getStore(empty.doc) === a.appStore, 'Case-insensitive store aliases stay inside the owner window');
a.win.appStore = { GetAppOverviewByAppID(appid) { return appid === 550 ? a.overview : null; } };
check(App.getAppOverview(550, a.doc) === a.overview && App.getAppOverview(999, a.doc) === null, 'Store replacement is read live without retaining a detached store');
a.win.closed = true;
check(App.getStore(a.doc) === null && User.getPersonaName(a.doc) === '', 'Closed documents expose no store');
a.win.closed = false;

function install(f, name) {
  const section = Object.freeze(Object.fromEntries(['AppDetailsSection', 'AppDetailsSectionContainer', 'RightColumnSection', 'Body', 'Highlight'].map(key => [key, `${name}-${key}`])));
  function Carousel() {}
  Carousel.prototype.ScrollToElement = () => {};
  Carousel.prototype.UpdateScrollArrows = () => {};
  runtimeStates.set(f.doc, { identity: {}, modules: [{ id: name, exports: { section, Carousel } }] });
  return { section, Carousel };
}
const ca = install(a, 'A'), cb = install(b, 'B'), cd = install(desktop, 'Desktop');
const resolve = doc => classes.resolveNativeAppDetailsClasses(doc).Section;
check(resolve(a.doc) === ca.section && classes.resolveNativeSummaryCarousel(a.doc) === ca.Carousel, 'BP-A resolves its native class and carousel exports');
check(resolve(desktop.doc) === cd.section && resolve(b.doc) === cb.section, 'Desktop and a second BP resolve independent exports');
let logCount = logs.length;
check(resolve(a.doc) === ca.section && classes.resolveNativeSummaryCarousel(a.doc) === ca.Carousel && logs.length === logCount, 'Reading other CEF realms does not invalidate BP-A caches');
classes.clearNativeAppDetailsClassCache(a.doc);
check(resolve(b.doc) === cb.section && logs.length === logCount, 'Clearing BP-A leaves BP-B cached');
check(resolve(a.doc) === ca.section && logs.length > logCount, 'Clearing BP-A rescans only BP-A');
const ca2 = install(a, 'A-next-runtime');
logCount = logs.length;
check(resolve(a.doc) === ca2.section && classes.resolveNativeSummaryCarousel(a.doc) === ca2.Carousel, 'Runtime generation replacement discards only its old exports');
const afterReplace = logs.length;
check(resolve(b.doc) === cb.section && logs.length === afterReplace && afterReplace > logCount, 'Runtime replacement in BP-A preserves BP-B cached exports');
check(classes.resolveNativeAppDetailsClasses().Section === cd.section, 'Optional class resolution uses the global document rather than last active runtime');
const replacement = fixture('A-new-doc');
replacement.win = a.win; replacement.doc.defaultView = a.win; a.win.document = replacement.doc;
a.win.appStore = replacement.appStore; a.win.libraryStore = replacement.libraryStore; a.win.userStore = replacement.userStore;
const ca3 = install(replacement, 'A-new-doc');
const readsBeforeStale = runtimeReads.length;
check(resolve(a.doc) === null && classes.resolveNativeSummaryCarousel(a.doc) === null && runtimeReads.length === readsBeforeStale, 'A retired document cannot recapture or resolve a replacement window runtime');
check(App.getStore(a.doc) === null && Library.getStore(a.doc) === null && User.getStore(a.doc) === null, 'A retired document cannot read its successor stores');
check(resolve(replacement.doc) === ca3.section && App.getAppOverview(550, replacement.doc) === replacement.overview, 'Same-window document replacement receives independent classes and current stores');
check(resolve(empty.doc) === null && classes.resolveNativeSummaryCarousel(empty.doc) === null, 'A document without a runtime never inherits another realm class cache');
logCount = logs.length;
classes.clearNativeAppDetailsClassCache();
check(resolve(b.doc) === cb.section && resolve(desktop.doc) === cd.section && logs.length > logCount, 'No-argument clear retains full plugin teardown compatibility');
check(b.appStore.m_mapApps.get(550) === b.overview && b.appStore.nativeValue === 'BP-B'
  && b.libraryStore.nativeValue === 'library-BP-B' && b.userStore.nativeValue === 'user-BP-B'
  && cb.section.Body === 'B-Body', 'Native stores, values, class exports and overview identities remain unchanged');
check(runtimeReads.every(doc => doc?.defaultView?.document === doc || doc === a.doc), 'Every runtime query receives an explicit document owner');
console.log(`BP realm adapters passed: ${checks} checks of actual TypeScript in VM; no Steam account or SDK calls.`);
