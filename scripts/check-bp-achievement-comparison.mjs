import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0, accountWrites = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const alice = '76561198000000001', bob = '76561198000000002', outsider = '76561198000000003';
const shortcut = { id: 3875025402, steamAppId: '1790600', title: 'Linked game' };
const calls = [], pending = new Map(), people = new Map([
  [alice, { steamid: alice, name: 'Alice', avatar: 'alice.png' }],
  [bob, { steamid: bob, name: 'Bob', avatar: 'bob.png' }],
]);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let friendList = Promise.resolve({ inGame: [], recentlyPlayed: [{ steamid: alice }], previouslyPlayed: [{ steamid: bob }], owns: [] });
const apps = { GetFriendAchievementsForApp(app, sid) {
  check(this === apps && app === shortcut.steamAppId && [alice, bob].includes(sid), 'Comparison reads retain the exact public AppID, 64-bit friend identity and native API receiver');
  calls.push([app, sid]); const request = deferred(); pending.set(sid, request); return request.promise;
}, SetAchievement() { accountWrites++; }, ClearAchievement() { accountWrites++; }, StoreStats() { accountWrites++; } };
const document = () => { const doc = {}; doc.defaultView = { document: doc, SteamClient: { Apps: apps } }; return doc; };
const backend = new Proxy({ fetchFriendPersonasBackend: async () => '[]' }, { get(target, key) {
  if (key in target) return target[key]; throw Error(`Unexpected backend capability ${String(key)}`);
} });
const uiRuntime = { getRequire: () => Object.assign(() => {}, { m: {} }), getModuleFactoryCount: () => 0,
  getAllModules: () => [], getModuleFactories: () => [] };
const NativeButton = function NativeButton() {}, NativeFocusable = function NativeFocusable() {};
const dependencies = {
  '../../api/backend': backend,
  '../../steam/social': { fetchFriendsGameplayInfo: async app => { assert.equal(app, Number(shortcut.steamAppId)); return friendList; }, extractSteamIdFromValue: value => String(value) },
  '../library/social/personas': { getCachedPersona: id => people.get(id), cachePersona: item => people.set(item.steamid, item) },
  react: { Component: class { constructor(props) { this.props = props; } setState(next, callback) {
    this.state = { ...this.state, ...next }; callback?.();
  } }, createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  '../../steam/localization': { gdlText: (_token, text) => text, loc: (_token, text) => text },
  '../../steam/gamepad/document-ui-runtime': { getDocumentUIComponents: () => ({ DialogButton: NativeButton, Focusable: NativeFocusable }) },
  '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: uiRuntime },
  '../../steam/gamepad/runtime-cache': { DocumentRuntimeCache: class { constructor(factory) { this.factory = factory; this.values = new WeakMap(); }
    get(doc) { if (!this.values.has(doc)) this.values.set(doc, this.factory()); return this.values.get(doc); } } },
};
function load(file) {
  const result = {}, context = vm.createContext({ exports: result, window: {}, setTimeout, clearTimeout,
    require: key => { assert(key in dependencies, key); return dependencies[key]; } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, context); return result;
}
dependencies['../achievements/comparison'] = load('frontend/features/achievements/comparison.ts');
dependencies['./native-focus'] = load('frontend/features/big-picture/native-focus.ts');
const { createBigPictureAchievementComparisonSession: create, BigPictureAchievementComparison: ComparisonControl } = load('frontend/features/big-picture/achievement-comparison.tsx');
const doc = document(), changes = []; let current = true;
const session = create(doc, shortcut, () => current, view => changes.push(view));
await session.loadFriends();
check(session.snapshot.friends.map(item => item.steamid).join(',') === `${alice},${bob}`, 'Only relevant real Steam friends populate the native selector');
check(session.snapshot.selection === null && !session.snapshot.friendsLoading && !session.snapshot.friendsError, 'A loaded friend list does not fabricate a selection or progress');
check(await session.select(outsider) === false && calls.length === 0, 'A stale/forged dropdown friend ID cannot query an outside account');
const a = session.select(alice); await Promise.resolve(); await Promise.resolve();
check(session.snapshot.selection.friendId === alice && session.snapshot.selection.friendName === 'Alice'
  && session.snapshot.selection.friendAvatar === 'alice.png' && session.snapshot.selection.loading
  && session.snapshot.selection.achievements === null, 'Selecting a friend publishes its truthful identity and an explicit loading state');
const b = session.select(bob); await Promise.resolve(); await Promise.resolve();
pending.get(bob).resolve({ result: 1, data: { rgAchievements: [{ strID: 'KNOWN', bAchieved: true, rtUnlocked: 123, flCurrentProgress: 2 }] } }); await b;
check(session.snapshot.selection.friendId === bob && session.snapshot.selection.achievements.get('KNOWN').earned === true
  && !session.snapshot.selection.achievements.has('MISSING'), 'A friend response exposes confirmed unlocks while absent achievement IDs stay unknown');
pending.get(alice).resolve({ result: 1, data: { rgAchievements: [{ strID: 'OTHER', bAchieved: false }] } }); await a;
check(session.snapshot.selection.friendId === bob && session.snapshot.selection.achievements.has('KNOWN'), 'An older friend response cannot overwrite the newer selected friend');
await session.select('');
check(session.snapshot.selection === null, 'Clear comparison removes the second-user state');

const privateDoc = document(), privateChanges = [], privateSession = create(privateDoc, shortcut, () => true, value => privateChanges.push(value));
await privateSession.loadFriends(); const unavailable = privateSession.select(alice); await Promise.resolve(); await Promise.resolve();
pending.get(alice).resolve({ result: 15 }); await unavailable;
check(privateSession.snapshot.selection.friendId === alice && !privateSession.snapshot.selection.loading
  && privateSession.snapshot.selection.error && privateSession.snapshot.selection.achievements === null,
  'Private/unavailable friend data remains distinct from zero achievements');
const clearedDoc = document(), cleared = create(clearedDoc, shortcut, () => true, () => {});
await cleared.loadFriends(); const late = cleared.select(alice); await Promise.resolve(); await Promise.resolve();
await cleared.select(''); pending.get(alice).resolve({ result: 1, data: { rgAchievements: [] } }); await late;
check(cleared.snapshot.selection === null, 'Clearing comparison invalidates an in-flight friend response');
const retiredDoc = document(), retiredChanges = [], retired = create(retiredDoc, shortcut, () => current, value => retiredChanges.push(value));
await retired.loadFriends(); const retiredLoad = retired.select(bob); await Promise.resolve(); await Promise.resolve();
const beforeRetire = retiredChanges.length; current = false;
pending.get(bob).resolve({ result: 1, data: { rgAchievements: [] } }); await retiredLoad;
check(retiredChanges.length === beforeRetire, 'A route/generation change prevents pending comparison results from publishing');
current = true;
const disposedDoc = document(), disposedChanges = [], disposed = create(disposedDoc, shortcut, () => true, value => disposedChanges.push(value));
await disposed.loadFriends(); const disposedLoad = disposed.select(bob); await Promise.resolve(); await Promise.resolve();
const beforeDispose = disposedChanges.length; disposed.dispose();
pending.get(bob).resolve({ result: 1, data: { rgAchievements: [] } }); await disposedLoad;
check(disposedChanges.length === beforeDispose && await disposed.select(alice) === false, 'Closing/unmounting cancels old responses and later actions');
const delayed = deferred(); friendList = delayed.promise;
const delayedDoc = document(), delayedChanges = [], delayedSession = create(delayedDoc, shortcut, () => true, value => delayedChanges.push(value));
const delayedLoad = delayedSession.loadFriends(); await Promise.resolve(); delayedSession.dispose();
delayed.resolve({ recentlyPlayed: [{ steamid: alice }] }); await delayedLoad;
check(delayedChanges.length === 1 && delayedChanges[0].friendsLoading, 'Closing while loading friend options cannot mutate the retired selector');
friendList = Promise.resolve({ recentlyPlayed: [{ steamid: alice }, { steamid: bob }] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const elements = node => !node ? [] : Array.isArray(node) ? node.flatMap(elements) : typeof node === 'object'
  ? [node, ...elements(node.props?.children)] : [];
class Dropdown { SetSelectedOption() {} BuildMenu() {} OnValueSelected() {} ToggleMenu() {} }
uiRuntime.getAllModules = () => [{ exports: { ZU: Dropdown } }];
const controlDoc = document(), selections = []; let controlCurrent = true;
const control = new ComparisonControl({ document: controlDoc, shortcut, isCurrent: () => controlCurrent, onSelection: value => selections.push(value) });
control.componentDidMount(); await tick();
const nativeControl = control.render();
check(nativeControl.type === Dropdown && nativeControl.props.controlled && nativeControl.props.selectedOption === ''
  && nativeControl.props.rgOptions.map(item => item.data).join(',') === `,${alice},${bob}`,
  'The native controlled dropdown receives exact string SteamIDs and a real clear option');
const aliceLabel = nativeControl.props.rgOptions[1].label;
check(elements(aliceLabel).some(item => item.type === 'img' && item.props.src === 'alice.png'), 'Native friend options show the real persona avatar');
controlCurrent = false;
const beforeStaleDropdown = calls.length;
nativeControl.props.onChange({ data: bob }); await tick();
check(nativeControl.props.onMenuWillOpen() === false && calls.length === beforeStaleDropdown, 'Retired native menu callbacks cannot navigate or request friend data');
control.componentWillUnmount();
uiRuntime.getAllModules = () => [];
const fallbackDoc = document(), fallbackSelections = [], fallback = new ComparisonControl({ document: fallbackDoc, shortcut,
  isCurrent: () => true, onSelection: value => fallbackSelections.push(value) });
let focusTransfers = 0, domFocusTransfers = 0, nativeFocusHandled = true;
const focusTargets = [];
fallbackDoc.defaultView.CustomEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
const focusTarget = name => ({ ownerDocument: fallbackDoc, isConnected: true, dispatchEvent(event) {
  assert.equal(event.type, 'vgp_requestfocus'); assert.equal(event.detail.button, 9); assert.equal(event.detail.source, 0);
  focusTransfers++; focusTargets.push(name); return !nativeFocusHandled;
}, focus(options) { assert.equal(options.preventScroll, true); domFocusTransfers++; } });
const optionTarget = focusTarget('option'), triggerTarget = focusTarget('trigger');
fallback.host = { querySelector: selector => selector.includes('-option') ? optionTarget : triggerTarget };
fallback.componentDidMount(); await tick();
const trigger = elements(fallback.render()).find(item => item.props?.['data-gdl-bp-comparison-trigger']);
trigger.props.onActivate();
check(fallback.state.pickerOpen && focusTransfers === 1, 'Missing native Dropdown uses inline native navigation options in the existing achievement screen');
const bobButton = elements(fallback.render()).find(item => item.type === NativeButton && item.props?.key === bob);
const beforeInline = calls.length;
bobButton.props.onActivate(); bobButton.props.onClick(); await tick();
check(calls.length === beforeInline + 1 && calls.at(-1)[1] === bob && !fallback.state.pickerOpen,
  'Keyboard/gamepad fallback activation reads the selected exact friend once and preserves the achievement screen');
pending.get(bob).resolve({ result: 1, data: { rgAchievements: [] } }); await tick();
check(fallbackSelections.at(-1)?.friendId === bob && fallbackSelections.at(-1).achievements.size === 0 && focusTransfers === 2,
  'Inline selection publishes the real friend response and restores focus to the comparison trigger');
trigger.props.onClick();
let cancelled = 0;
const group = elements(fallback.render()).find(item => item.type === NativeFocusable && item.props.onCancelButton);
group.props.onCancelButton({ preventDefault() { cancelled++; }, stopPropagation() { cancelled++; } });
check(!fallback.state.pickerOpen && cancelled === 2 && focusTransfers === 4, 'Cancelling the inline picker consumes only its own cancel action and restores the trigger focus');
check(focusTargets.join(',') === 'option,trigger,option,trigger' && domFocusTransfers === 0,
  'Opening, selecting and cancelling use Steam vgp_requestfocus for its exact option/trigger, without bypassing the native focus tree');
nativeFocusHandled = false; trigger.props.onActivate(); group.props.onCancelButton({ preventDefault() {}, stopPropagation() {} });
check(focusTransfers === 6 && domFocusTransfers === 2 && focusTargets.at(-1) === 'trigger',
  'DOM focus is used only after the native focus request is unhandled, and B still returns to the trigger');
fallback.componentWillUnmount();
check(accountWrites === 0, 'All comparison operations are reads; no achievement or account writes occur');
console.log(`BP achievement comparison passed: ${checks} checks; exact friend/AppID data, private/unknown states, selection/clear/route/unmount races and zero account writes.`);
