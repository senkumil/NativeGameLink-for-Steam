import './helpers/installed-steam-check.mjs';
// Production resolvers against the installed client's factory signatures.
// Exports/stores are fixtures: no native factory or account API is executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const self = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync('C:/Program Files (x86)/Steam/steamui/sp.js', 'utf8'), { self });
const installed = Object.assign({}, ...self.webpackChunksteamui.map(chunk => chunk[1]));
const lookup = tokens => {
  const found = Object.entries(installed).find(([, factory]) => tokens.every(token => String(factory).includes(token)));
  assert(found, `Installed presentation contract: ${tokens.join(', ')}`); return found;
};
const contracts = {
  info: lookup(['OnImageLoad', 'onCollapseStarted', 'onCollapseComplete', 'AppGameInfoContainer', 'GetAssociations']),
  details: lookup(['GetAppData(', 'GetAssociations(', 'GetDescriptions(', 'RequestDescriptionsData(', 'GetAchievements(']),
  links: lookup(['aX:', 'Qd:', 'isVisible', 'onActivate', 'GetParentalFeatureForFullUrl']),
  cards: lookup(['F9:', 'R0:', 'T4:', 'V$:', 'bStartFocused', 'bNoFooterFilter']),
  wrapper: lookup(['Ei:', 'gridcell', 'display:"contents"']),
  grid: lookup(['childElements', 'childWidth', 'scaleGridItems', 'paddingLeft', 'gridColumnGap', 'refItemsPerRow']),
};
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; };
const id = 3000000001, reads = [], modules = new Map(), realm = new WeakMap();
function Info() {}
Info.prototype = { render() {}, OnImageLoad() {}, onCollapseStarted() {}, onCollapseComplete() {} };
function Link({ url, label, link, isVisible, onActivate }) { return { url, label, link, isVisible, onActivate }; }
function Card({ collection, eCoverSize, bStartFocused, bNoFooterFilter }) { return collection; }
function Wrapper() { return 'gridcell contents'; }
function Grid({ childElements, childWidth, scaleGridItems, paddingLeft }) { return childElements; }
const ownedDetails = Object.freeze({ unAppID: id }), publicDetails = Object.freeze({ unAppID: 550 });
const detailStore = { GetAppData() {}, GetAppDetails: key => key === id ? ownedDetails : publicDetails, GetAchievements() {} };
const collection = { id: 'local', visibleApps: [], displayName: 'Local collection' };
const collectionStore = { GetCollectionListForAppID: key => key === id ? [collection] : [] };
const exportsByName = {
  info: { b: Info }, details: { H: detailStore }, links: { aX: Link },
  cards: { F9: Card, R0() {}, T4() {}, lc() {}, lp() {}, V$: { childWidth: 180, childHeight: 270, gridColumnGap: 20, gridRowGap: 20 } },
  wrapper: { Ei: Wrapper }, grid: { i: Grid },
};
const factories = {};
for (const [name, [key, actual]] of Object.entries(contracts)) {
  const mock = () => { throw Error('Native factories must not execute'); };
  mock.toString = () => String(actual); factories[key] = mock;
}
factories[999999] = () => { throw Error('Unrelated account factory'); };
const req = key => {
  reads.push(String(key));
  const name = Object.keys(contracts).find(name => contracts[name][0] === String(key));
  if (!name) throw Error(`Unavailable legacy module ${key}`);
  const result = exportsByName[name]; modules.set(String(key), { id: key, exports: result }); return result;
};
req.m = factories;
const runtime = { captureRuntime() {}, getRuntimeIdentity: doc => realm.get(doc), getRequire: () => req,
  getModuleFactoryCount: () => Object.keys(factories).length,
  getModuleFactories: () => Object.entries(factories).map(([id, factory]) => ({ id, factory })),
  getAllModules: () => [...modules.values(), { id: 'local-collections', exports: { md: collectionStore } }], ensureChunk: async () => false };
const doc = { body: { isConnected: true } }, win = { document: doc, closed: false, addEventListener() {}, removeEventListener() {} };
doc.defaultView = win; realm.set(doc, {});
const dependencies = {
  '../../../api/backend': { backendLog() {} },
  '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime }, '../modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
  '../../native-window-store': { getNativeWindowInstance: () => ({ BrowserWindow: win }) },
  '../../../core/mappings': { mappings: {}, shortcutMappingKey: String },
  '../GamepadContext': { isCurrentLinkedGamepadTarget: () => true, normalizeGamepadAppId: Number },
  '../../ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
  './NativeAchievementOwnership': { clearAppDetailsGuards() {}, ensureAppDetailsStoreGuarded() {}, releaseAppDetailsGuards() {}, restoreNativeAchievementState() {} },
};
function load(file) {
  const exports = {};
  vm.runInNewContext(`(function(exports,require){${ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText}\n})`, { document: doc })(exports, key => {
    assert(key in dependencies, `Unexpected dependency ${key}`); return dependencies[key];
  });
  return exports;
}
dependencies['../runtime-cache'] = load('frontend/steam/gamepad/runtime-cache.ts');
const native = load('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts');
check(native.resolveNativeGameInfoComponent(doc) === Info, 'Information component follows the current factory signature rather than a stale module ID');
check(native.resolveNativeAppDetailsStore(doc) === detailStore, 'Descriptions/associations resolve from the same native detail store');
check(native.resolveNativeAppDetails(doc, id) === ownedDetails, 'The component receives the real linked shortcut detail identity');
const parts = load('frontend/steam/gamepad/components/NativeInformationComponents.ts').resolveNativeInformationComponents(doc);
check(parts.Link === Link && parts.CollectionCard === Card && parts.CollectionWrapper === Wrapper && parts.CollectionGrid === Grid,
  'Links and complete collection presentation resolve from installed signatures');
check(parts.collectionStore.GetCollectionListForAppID(id)[0] === collection, 'Collections belong to the shortcut rather than the public metadata AppID');
check(parts.grid.childWidth === 180 && parts.grid.childHeight === 270, 'Native collection grid dimensions are preserved');
const warmReads = reads.length;
for (let i = 0; i < 100; i++) native.resolveNativeGameInfoComponent(doc);
check(reads.length === warmReads && !reads.includes('999999'), 'Warm resolution is cached and unrelated account factories are never loaded');

const shortcutOverview = Object.freeze({ appid: id, BIsShortcut: () => true, BIsModOrShortcut: () => true, BHasCustomImages: () => true });
const publicOverview = Object.freeze({ appid: 550, GetCanonicalReleaseDate: () => 123456 });
dependencies['../../steam/gamepad/stores/AppStoreAdapter'] = { AppStoreAdapter: { getAppOverview: () => null } };
dependencies['../../steam/gamepad/components/AppDetailsNativeComponents'] = native;
dependencies['../../steam/modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
dependencies['../../steam/native-window-store'] = { getNativeWindowInstance: () => ({ BrowserWindow: win }) };
modules.set('owner-overviews', { id: 'owner-overviews', exports: { store: { GetAppOverviewByAppID: key => key === id ? shortcutOverview : publicOverview } } });
const { createBigPictureDetailViews } = load('frontend/features/big-picture/detail-views.ts');
const view = createBigPictureDetailViews(doc, { id, steamAppId: '550', title: 'Linked' }, {
  name: 'Metadata', categories: [{ id: 2 }, { id: 22 }, { id: 60 }], controller_support: 'full',
}, true);
check(view.overview.BHasCustomImages() && view.overview.appid === id, 'A scriptless popup keeps the real shortcut artwork methods');
check(view.overview.BHasStoreCategory(2) && view.overview.BHasStoreCategory(28) && !view.overview.BHasStoreCategory(999),
  'Localized native feature icons use actual capabilities and controller support');
check(shortcutOverview.BIsShortcut() && view.overview.BIsShortcut() === false && Object.isFrozen(shortcutOverview) && Object.isFrozen(publicOverview),
  'Information semantics stay inside the component view with zero writes to real native or shortcut records');
console.log(`Big Picture information components passed: ${checks} checks; installed factory contracts, private-cache exports, real shortcut artwork identity and zero native factory execution.`);
