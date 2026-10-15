import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
function load(file, dependencies = {}, extras = {}) {
  const context = vm.createContext({ exports: {}, require: name => {
    assert(name in dependencies, `Unexpected dependency ${file}: ${name}`); return dependencies[name];
  }, ...extras });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText, context, { filename: file });
  return context.exports;
}

const storage = new Map();
const cache = load('frontend/features/achievements/cache.ts', {}, { localStorage: {
  getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
} });
const id = 3000000001, sibling = id + 1;
const mappings = { [`shortcut:${id}`]: '111', [`shortcut:${sibling}`]: '111' };
const nativeOwnership = load('frontend/steam/gamepad/components/NativeAchievementOwnership.ts', {
  '../../../api/backend': { backendLog() {} }, '../../../core/mappings': { mappings, isMappingSnapshotVerified: () => true, shortcutMappingKey: value => `shortcut:${value >>> 0}` },
});
const native = load('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts', {
  '../../native-window-store': { getNativeWindowInstance: () => null },
  './NativeAchievementOwnership': nativeOwnership,
  '../GamepadContext': { normalizeGamepadAppId: value => Number.isInteger(Number(value)) && Number(value) >= -2147483648 && Number(value) <= 4294967295 ? Number(value) >>> 0 : null, isCurrentLinkedGamepadTarget: (doc, id) => doc?.routeId === id },
  '../../ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => doc?.gamepad === true } },
  '../../../api/backend': { backendLog() {} }, '../../modules/SteamWebpackRuntime': { steamWebpackRuntime: {} },
  '../../../core/mappings': { mappings, isMappingSnapshotVerified: () => true, shortcutMappingKey: value => `shortcut:${value >>> 0}` },
});
const records = new Map(), reads = [];
const store = { GetAppData(key) { reads.push(key); if (!records.has(key)) records.set(key, { details: null }); return records.get(key); },
  GetAchievements(key) { return this.GetAppData(key).details?.achievements; } };
const originalGet = store.GetAchievements;
const myMap = new Map(), achievementStore = { m_mapMyAchievements: myMap };
function projectionOwner(routeId = id, steamAppId = '111', gamepad = true) {
  const doc = { routeId, steamAppId, gamepad, body: { isConnected: true }, defaultView: { closed: false } };
  doc.defaultView.document = doc;
  return doc;
}
const ownerA = projectionOwner(), ownerB = projectionOwner();
const currentProjectionTarget = (doc, shortcutId, steamAppId) => Boolean(doc?.defaultView && !doc.defaultView.closed
  && doc.defaultView.document === doc && doc.body?.isConnected && doc.routeId === (Number(shortcutId) >>> 0)
  && doc.steamAppId === String(steamAppId) && mappings[`shortcut:${Number(shortcutId) >>> 0}`] === String(steamAppId));
const bp = load('frontend/features/big-picture/NativeBigPictureAchievements.tsx', {
  react: { default: { createElement: (type, props, ...children) => ({ type, props, children }) } },
  '../../api/backend': { backendLog() {} }, '../../steam/localization': { gdlText: (_key, text) => text, loc: (_key, text) => text },
  '../../steam/gamepad/components/AppDetailsNativeComponents': native, '../achievements/rarity': {},
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: value => mappings[`shortcut:${value >>> 0}`] || null },
  '../achievements/cache': cache,
  './NativeBigPictureAchievementScreen': { openBigPictureAchievementsScreen() {} },
  '../../steam/gamepad/document-ui-runtime': { getDocumentReact: () => ({}) },
  '../../steam/gamepad/GamepadContext': { isCurrentLinkedGamepadTarget: currentProjectionTarget },
  '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => doc.gamepad === true } },
});
const item = (name, earned, hidden = false) => ({ name, display_name: name, description: 'Description', icon: '', icon_gray: '', hidden,
  earned, earned_time: earned ? 1600000000 : 0, progress: earned ? 5 : 1, max_progress: 5, global_percent: 0, global_percent_known: false });
const a = { found: true, appid: '111', metadata_appid: '111', state_appid: '111', path: 'C:/A/state.json', root: 'C:/A',
  total: 3, unlocked: 2, achievements: [item('A', true), item('B', false, true), item('C', true, true)] };
const b = { ...a, path: 'D:/B/state.json', root: 'D:/B', unlocked: 3, achievements: a.achievements.map(value => ({ ...value, earned: true })) };
cache.cacheLocalAchievements(a, '111', String(id)); cache.cacheLocalAchievements(b, '111', String(sibling));
check(cache.getCachedLocalAchievementsForShortcut('111', String(id)) === a, 'Sibling installations retain separate snapshots');
const before = reads.length;
bp.syncAchievementsToNativeStore(store, id, b, achievementStore, ownerA);
check(reads.length === before && !myMap.has(id), 'Another installation cannot project through matching metadata alone');
for (const invalid of [111, 367520, 1030300, 0, -2147483649, 4294967296, id + .5, NaN]) {
  bp.syncAchievementsToNativeStore(store, invalid, a, achievementStore, ownerA);
  check(reads.length === before, 'Public and invalid destinations perform no native reads or writes');
}
bp.syncAchievementsToNativeStore(store, id, a, achievementStore);
check(reads.length === before && !myMap.has(id), 'A valid cached payload without its owning Document cannot perform a native read or write');
for (const [label, mutate] of [
  ['native destination', doc => { doc.routeId = 111; }],
  ['another shortcut with the same Store AppID', doc => { doc.routeId = sibling; }],
  ['closed Window', doc => { doc.defaultView.closed = true; }],
  ['replaced Document', doc => { doc.defaultView.document = {}; }],
  ['detached body', doc => { doc.body.isConnected = false; }],
  ['Desktop mode', doc => { doc.gamepad = false; }],
  ['relinked Store identity', doc => { doc.steamAppId = '222'; }],
]) {
  const rejected = projectionOwner(); mutate(rejected);
  bp.syncAchievementsToNativeStore(store, id, a, achievementStore, rejected);
  check(reads.length === before && !myMap.has(id), `${label} rejects the projection before reading or writing its native store`);
}
mappings[`shortcut:${id}`] = '222';
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerA);
check(reads.length === before && !myMap.has(id), 'A mapping replaced after owner capture cannot project its old payload');
mappings[`shortcut:${id}`] = '111';

const originalDetails = Object.freeze({ unAppID: id, achievements: Object.freeze({ nTotal: 1, nAchieved: 0, vecHighlight: [] }) });
const originalMy = { data: { achieved: {}, unachieved: {}, hidden: {} } };
records.set(id, { details: originalDetails }); myMap.set(id, originalMy);
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerA);
const projection = records.get(id).details;
check(projection !== originalDetails && originalDetails.achievements.nAchieved === 0, 'Projection does not mutate inherited native cache objects');
check(projection.achievements.nAchieved === 2, 'Projection uses the exact installation count');
check(projection.achievements.vecHighlight[0].rtUnlocked === 1600000000, 'Native projection retains the actual unlock timestamp');
check(!Object.hasOwn(projection.achievements.vecHighlight[0], 'flAchieved'), 'Unknown global rarity is omitted instead of becoming 0, 25 or 50');
check(projection.achievements.vecHighlight[0].flMaxProgress === 5, 'Native progress fields use actual local progress');
check(projection.achievements.vecAchievedHidden.length === 1, 'Earned hidden achievements retain their native collection');
const my = myMap.get(id).data;
check(my.achieved.A.strID === 'A' && my.achieved.C.bHidden && my.hidden.B.strID === 'B', 'Native achievement maps include complete achieved, hidden and unachieved records');
check(Object.keys(my).sort().join(',') === 'achieved,hidden,unachieved', 'Native consumers receive the complete map shape');
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerB);
bp.restoreBigPictureAchievementProjections(id, ownerA);
check(records.get(id).details !== originalDetails, 'One owner unmounting preserves another live projection owner');
bp.restoreBigPictureAchievementProjections(id, ownerB);
check(records.get(id).details === originalDetails && myMap.get(id) === originalMy, 'Last owner unmount restores the exact original model and map entry');

bp.syncAchievementsToNativeStore(store, id - 4294967296, a, achievementStore, ownerA);
check(!records.has(id - 4294967296) && !myMap.has(id - 4294967296), 'Signed shortcuts normalize to the canonical unsigned native key');
native.clearNativeComponentsCache();
check(records.get(id).details === originalDetails && myMap.get(id) === originalMy && store.GetAchievements === originalGet, 'Global disposal restores projections and original methods');

records.set(id, { details: null }); myMap.delete(id);
native.ensureAppDetailsStoreGuarded(store);
check(store.GetAchievements(id).nTotal === 0, 'Compatibility fallback remains available to a verified shortcut');
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerA);
native.clearNativeComponentsCache();
check(records.get(id).details === null && !myMap.has(id), 'Projection then compatibility fallback unwind back to null without a fabricated permanent zero');

records.set(id, { details: originalDetails }); myMap.set(id, originalMy);
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerA);
const freshDetails = { unAppID: id, achievements: { nTotal: 42 } }, freshMy = { data: { achieved: { STEAM: true } } };
records.get(id).details = freshDetails; myMap.set(id, freshMy);
native.clearNativeComponentsCache();
check(records.get(id).details === freshDetails && myMap.get(id) === freshMy, 'Disposal preserves newer Steam callbacks instead of overwriting them');
bp.syncAchievementsToNativeStore(store, id, a, achievementStore, ownerA);
native.clearNativeComponentsCache();
check(records.get(id).details === freshDetails && myMap.get(id) === freshMy, 'A subsequent projection captures the new native baseline');

const rarity = load('frontend/features/achievements/rarity.ts');
check(!rarity.isRareAchievement(a.achievements[0]), 'Unknown global rarity does not receive rare-achievement styling');

// A fake native store follows the installed OnNotification/ExpireToast contract:
// notifications reach both the transient toast queue and the persistent tray.
let timerSequence = 0;
let metadataRequest = null;
const timers = new Map(), setTimeout = callback => { const id = ++timerSequence; timers.set(id, callback); return id; };
const clearTimeout = id => timers.delete(id);
class Proto {
  getClassName() { return 'CClientNotificationAchievement'; }
  static fromObject(value) { return { serializeBinary: () => value }; }
}
const realNotification = { notificationID: 42, eType: 5, eSource: 2, data: { appid: 550 } };
const realGroup = { notifications: [realNotification] };
const nativeStore = {
  m_rgNotificationToasts: [realNotification], m_rgNotificationTray: [realGroup], m_nUnviewedNotifications: 7, m_nNextTestNotificationID: 10000,
  m_cbkNotificationTray: { Dispatch() {} },
  OnNewNotificationReceived() { this.m_nUnviewedNotifications++; },
  OnNotification(notificationID, eType, data) {
    const notification = { notificationID, eType, eSource: 1, data };
    this.m_rgNotificationTray.unshift({ notifications: [notification] }); this.OnNewNotificationReceived(notification);
    this.m_rgNotificationToasts.push(notification);
  },
  RemoveGroupFromTray(group) { this.m_rgNotificationTray.splice(this.m_rgNotificationTray.indexOf(group), 1); },
  ExpireToast(notification) { const index = this.m_rgNotificationToasts.indexOf(notification); if (index >= 0) this.m_rgNotificationToasts.splice(index, 1); },
};
const win = { closed: false, NotificationStore: nativeStore, setTimeout, clearTimeout, location: { href: 'https://steamloopback.host/' } };
const activeObservers = new Set();
win.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() { activeObservers.add(this); }
  disconnect() { activeObservers.delete(this); }
};
nativeStore.GetCurrentToastNotification = function () { return this.m_rgNotificationToasts[0]; };
function element(tag = 'div') {
  return { tag, children: [], attributes: {}, style: { setProperty() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
  };
}
win.document = { documentElement: element('html'), head: element('head'), body: element('body'), defaultView: win, images: [],
  getElementById(id) { return this.head.children.find(value => value.id === id); }, createElement: element };
const notifications = load('frontend/features/achievements/notifications.ts', {
  '@steambrew/client': { findModuleExport: predicate => {
    if (predicate(Proto)) return Proto;
    const templates = { ShortTemplate: 'native-toast-short', StandardLogoDimensions: 'native-toast-logo' };
    return predicate(templates) ? templates : null;
  } },
  '../../api/backend': { backendLog() {} }, './game-info': { getLocalAchievementGameInfo: () => metadataRequest || Promise.resolve({ name: 'Test' }), clearLocalAchievementGameInfoCache() {} },
  '../../steam/localization': { gdlText: (_key, text) => text },
}, { window: win, setTimeout, clearTimeout });
await notifications.showAchievementToast('550', a.achievements[0]);
check(nativeStore.m_rgNotificationTray.length === 1 && nativeStore.m_rgNotificationTray[0] === realGroup, 'Synthetic notification immediately leaves the tray while retaining real entries');
check(nativeStore.m_nUnviewedNotifications === 7 && nativeStore.m_nNextTestNotificationID === 10000, 'Synthetic notification leaves unread and native test counters unchanged');
check(nativeStore.m_rgNotificationToasts.length === 2 && nativeStore.m_rgNotificationToasts[1].notificationID < 0, 'Native visual toast uses an isolated synthetic ID');
notifications.disposeAchievementNotifications();
check(nativeStore.m_rgNotificationToasts.length === 1 && nativeStore.m_rgNotificationToasts[0] === realNotification, 'Disposal removes an owned toast even while queued behind a real toast');
check(nativeStore.m_rgNotificationTray[0] === realGroup && nativeStore.m_nUnviewedNotifications === 7, 'Disposal never changes real notification state');

const originalOnNotification = nativeStore.OnNotification, originalOnNew = nativeStore.OnNewNotificationReceived;
nativeStore.OnNotification = function (...args) {
  originalOnNotification.apply(this, args);
  this.m_nUnviewedNotifications++; // A separate real notification arrives in a synchronous observer.
};
await notifications.showAchievementToast('550', a.achievements[0]);
check(nativeStore.m_nUnviewedNotifications === 8 && nativeStore.OnNewNotificationReceived === originalOnNew,
  'Unread retirement preserves another real increment and restores its temporary callback descriptor');
notifications.disposeAchievementNotifications();
nativeStore.OnNotification = function (...args) { originalOnNotification.apply(this, args); throw new Error('partial native failure'); };
await notifications.showAchievementToast('550', a.achievements[0]);
check(nativeStore.m_rgNotificationTray.length === 1 && nativeStore.m_rgNotificationToasts.length === 1 && nativeStore.OnNewNotificationReceived === originalOnNew,
  'A partially failed native injection leaves no synthetic queue/tray entry or callback patch');
notifications.disposeAchievementNotifications();
nativeStore.OnNotification = originalOnNotification;

nativeStore.RemoveGroupFromTray = () => { throw new Error('native local remover unavailable'); };
await notifications.showAchievementToast('550', a.achievements[0]);
check(nativeStore.m_rgNotificationTray.length === 1 && nativeStore.m_rgNotificationTray[0] === realGroup, 'Exact object retirement remains safe if the local remover throws');
notifications.disposeAchievementNotifications();
await notifications.showAchievementToast('550', { ...a.achievements[0], icon: 'https://cdn.example/achievement.png' });
check(activeObservers.size === 1 && timers.size === 2,
  'A queued native toast observes for its own presentation with a finite timeout');
notifications.disposeAchievementNotifications();
check(activeObservers.size === 0 && timers.size === 0 && nativeStore.m_rgNotificationToasts[0] === realNotification,
  'Disable immediately disconnects the pending presentation observer and clears both timers without touching the real toast');

delete nativeStore.RemoveGroupFromTray;
await notifications.showAchievementToast('550', a.achievements[0]);
check(win.document.body.children.length === 1 && nativeStore.m_rgNotificationTray.length === 1 && nativeStore.m_rgNotificationToasts.length === 1,
  'Unknown native tray contracts use the transient fallback without native injection');
notifications.disposeAchievementNotifications();
check(win.document.body.children.length === 0 && timers.size === 0, 'Transient fallback nodes and timers are removed on disposal');
let resolveMetadata;
metadataRequest = new Promise(resolve => { resolveMetadata = resolve; });
const lateToast = notifications.showAchievementToast('550', a.achievements[0]);
notifications.disposeAchievementNotifications();
resolveMetadata({ name: 'Late' }); await lateToast;
check(win.document.body.children.length === 0 && timers.size === 0, 'Metadata resolving after disable cannot resurrect a synthetic toast');
console.log(`Achievement state ownership passed: ${checks} assertions; source isolation, reversible native models, real timestamps/rarity, and transient notifications.`);
