import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let now = 1_000;
const fakeDate = { now: () => now };
function load(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, Date: fakeDate, console, ...globals, require: name => {
    assert(name in dependencies, `Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const news = [{ gid: '1', date: 42, title: 'Update', contents: 'Body', url: '/news/1' }];
const signature = (_steam, shortcut, items, header) => JSON.stringify([shortcut, items, header]);
let activeRoot;
function mount(steam = '123', shortcut = '3000000001') {
  const feed = { dataset: { gdlFeedSignature: signature(steam, shortcut, news, 'header') } };
  const root = { isConnected: true, feed, contains: element => element === feed,
    dataset: { gdlSteamAppId: steam, gdlShortcutAppId: shortcut } };
  activeRoot = root;
  return root;
}
const doc = { getElementById: id => id === 'gdl-library-injected' ? activeRoot
  : id === 'gdl-activity-feed' ? activeRoot?.feed : null };
const requests = [], friendCalls = [], communityCalls = [], activityCalls = [], writes = [];
const jobs = new Map();
function queue(_doc, key, callback) {
  const previous = jobs.get(key);
  if (previous) { previous.callback = callback; return previous.done.promise; }
  const done = deferred(); jobs.set(key, { callback, done }); return done.promise;
}
async function flush() {
  const work = Array.from(jobs.values()); jobs.clear();
  for (const item of work) { await item.callback(); item.done.resolve(); }
  await tick();
}
const hydration = load('frontend/features/library/hydration.ts', {
  '../../api/backend': { backendLog() {} },
  '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: queue },
  './constants': { GDL_INJECTED: 'gdl-library-injected' },
  './news': {
    getNews: (...args) => { const pending = deferred(); requests.push({ args, ...pending }); return pending.promise; },
    getCommunityContent: async () => [], newsItemsSignature: items => JSON.stringify(items),
  },
  './community-view': { scheduleCommunityHydration: (...args) => { communityCalls.push(args); return () => {}; } },
  './social': {
    getFriendData: async (...args) => { friendCalls.push(args); return { data: null }; },
    hydrateFriendPersonas: async () => {},
    populateActivityFeed: async (...args) => { activityCalls.push(args); },
    activityFeedContentSignature: signature,
    applyUnifiedActivityFeed: (feed, steam, shortcut, items, header) => {
      writes.push({ feed, steam, shortcut, items, header }); feed.dataset.gdlFeedSignature = signature(steam, shortcut, items, header);
    }, setupPostDeleteHandlers() {},
  },
});
const data = { steam_appid: 123, name: 'Game', header_image: 'header' };
let current = true;
const session = (shortcut = '3000000001', language = 'spanish', guard = () => current) => ({
  doc, steamAppId: '123', shortcutAppId: shortcut, language, isCurrent: guard,
});
const rootA = mount();
hydration.hydrateLinkedSecondaryResources(session(), data);
for (let i = 0; i < 100; i++) hydration.hydrateLinkedSecondaryResources(session(), { ...data });
assert.equal(requests.length, 1, '100 initial observer passes share one news request');
assert.equal(friendCalls.length, 1, 'Friend RPC work is started once per mounted session');
assert.equal(communityCalls.length, 1, 'Community hydration is not repeatedly cancelled/rearmed');
requests[0].resolve(news); await tick();
assert.equal(jobs.size, 1, 'News DOM commits use the sidebar interaction queue');
assert.equal(writes.length, 0, 'News does not mutate DOM while queued');
await flush();
assert.equal(writes.length, 0, 'An identical feed signature never calls the renderer');
assert.equal(activityCalls.length, 1);

// A new core object alone is not a content invalidation. Fields used by the
// secondary surfaces, language and mounted-root identity are invalidations.
hydration.hydrateLinkedSecondaryResources(session(), { ...data, short_description: 'Changed only in info panel' });
assert.equal(requests.length, 1);
hydration.hydrateLinkedSecondaryResources(session(), { ...data, header_image: 'fresh-header' });
assert.equal(requests.length, 2, 'Cached -> fresh core artwork changes bypass dedupe immediately');
requests[1].resolve(news); await tick(); await flush();
assert.equal(writes.length, 1);
assert.equal(writes[0].header, 'fresh-header');
hydration.hydrateLinkedSecondaryResources(session(undefined, 'english'), { ...data, header_image: 'fresh-header' });
assert.equal(requests.length, 3, 'Language changes rehydrate even on the same mount');
requests[2].resolve([{ ...news[0], contents: 'Updated body with same title and ID' }]); await tick(); await flush();
assert.equal(writes.length, 2, 'Content/URL changes are compared with the full feed signature');

now += 30_001;
hydration.hydrateLinkedSecondaryResources(session(undefined, 'english'), { ...data, header_image: 'fresh-header' });
assert.equal(requests.length, 4, 'Quiet dedupe expires so unsuccessful resources can recover');
current = false;
const rootB = mount('123', '3000000002');
hydration.hydrateLinkedSecondaryResources(session('3000000002', 'english', () => true), data);
assert.equal(requests.length, 5, 'A different shortcut sharing the Steam AppID gets an independent session');
requests[3].resolve([{ ...news[0], contents: 'Late previous shortcut result' }]);
requests[4].resolve(news); await tick(); await flush();
assert.equal(writes.length, 2, 'Late work from shortcut A cannot render onto shortcut B');
assert.notEqual(rootA, rootB);

// Replacing a root with the exact same IDs is an ABA navigation: a captured
// callback must not write into the new DOM, even if the old route guard says yes.
now += 30_001;
hydration.hydrateLinkedSecondaryResources(session('3000000002', 'english', () => true), data);
requests[5].resolve([{ ...news[0], title: 'Old mount payload' }]); await tick();
const rootC = mount('123', '3000000002');
hydration.hydrateLinkedSecondaryResources(session('3000000002', 'english', () => true), data);
requests[6].resolve(news); await tick(); await flush();
assert.equal(writes.length, 2, 'Queued work never crosses a mounted-root replacement');
assert.notEqual(rootB, rootC);

// A deduped pass supplies its latest generation callback to the shared request.
const rootD = mount();
let oldGenerationCurrent = true;
hydration.hydrateLinkedSecondaryResources(session(undefined, 'spanish', () => oldGenerationCurrent), data);
oldGenerationCurrent = false;
hydration.hydrateLinkedSecondaryResources(session(undefined, 'spanish', () => true), data);
requests[7].resolve([{ ...news[0], title: 'Newest generation' }]); await tick(); await flush();
assert.equal(writes.at(-1).feed, rootD.feed, 'Same mounted route updates its guard without repeating requests');
assert.equal(requests.length, 8);
const beforeNative = requests.length;
activeRoot = null;
hydration.hydrateLinkedSecondaryResources(session(), data);
assert.equal(requests.length, beforeNative, 'Native pages without the owned mount perform no secondary requests');

// Exercise the actual friend module: empty results get a short bounded memory
// cache instead of repeating native/store lookups for every observer callback.
let gameplayCalls = 0;
const positive = new Map();
const friends = load('frontend/features/library/social/friends.ts', {
  '@steambrew/client': { findModuleExport: () => null },
  '../../../core/cache': { CACHE_TTL: { friends: 300_000 }, CACHE_RETENTION: { friends: 3_600_000 },
    cacheGet: key => positive.get(key) || null, cacheRead: () => null, cacheSet: (key, value) => positive.set(key, value) },
  '../../../core/text': { escapeHtml: value => value },
  '../../../steam/localization': { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback },
  '../../../api/backend': { backendLog() {}, fetchFriendPersonasBackend: async () => '[]' },
  '../../../steam/social': { extractSteamIdFromValue: value => String(value || ''),
    fetchFriendsGameplayInfo: async () => { gameplayCalls++; return null; } },
  './personas': {}, '../layout': {}, '../../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: queue },
}, { window: {} });
await friends.getFriendData('1');
for (let i = 0; i < 100; i++) await friends.getFriendData('1');
assert.equal(gameplayCalls, 1, 'A valid zero-friend result is cached for the initial interaction window');
now += 30_001;
await friends.getFriendData('1');
assert.equal(gameplayCalls, 2, 'An empty social snapshot is retried after 30 seconds');
positive.set('friends_1', { totalCount: 1, recentlyPlayed: [], previouslyPlayed: [] });
assert.equal((await friends.getFriendData('1')).data.totalCount, 1, 'New positive resource data always supersedes an empty result');
positive.clear(); friends.clearEmptyFriendResults();
await friends.getFriendData('1');
assert.equal(gameplayCalls, 3, 'Explicit social cache clearing invalidates empty results');
for (let i = 2; i <= 130; i++) await friends.getFriendData(String(i));
const beforeEviction = gameplayCalls;
await friends.getFriendData('1');
assert.equal(gameplayCalls, beforeEviction + 1, 'Empty-result memory retains at most 128 AppIDs');

let friendRemovals = 0, friendGuard = true;
const friendsDoc = { getElementById: () => ({ dataset: { gdlSteamAppId: '123' }, remove: () => friendRemovals++ }) };
const pendingFriendCommit = friends.hydrateFriendPersonas(friendsDoc, null, '123', 'Game', { isCurrent: () => friendGuard });
assert.equal(friendRemovals, 0, 'An empty friends result also waits for sidebar-idle before removing its section');
friendGuard = false; await flush(); await pendingFriendCommit;
assert.equal(friendRemovals, 0, 'A queued friends removal checks ownership again at the actual write');
friendGuard = true;
const currentFriendCommit = friends.hydrateFriendPersonas(friendsDoc, null, '123', 'Game', { isCurrent: () => friendGuard });
await flush(); await currentFriendCommit;
assert.equal(friendRemovals, 1);

const community = load('frontend/features/library/community-view.ts', {
	'../../api/backend': { backendLog() {} },
  '../../core/text': {}, '../../steam/localization': {}, '../../steam/navigation': {},
  '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: queue },
  './community-order': load('frontend/features/library/community-order.ts', {}, { URL }),
});
let communityCurrent = true;
const inner = { querySelector: () => null };
const communityRoot = { isConnected: true, style: { display: '' }, querySelector: () => inner };
const communityDoc = { defaultView: {}, getElementById: () => communityRoot };
const communityLoad = deferred();
community.scheduleCommunityHydration(communityDoc, data, () => communityLoad.promise, () => communityCurrent);
communityLoad.resolve([]); await tick();
assert.equal(communityRoot.style.display, '', 'Community network results do not mutate their surface during queued scroll work');
assert(jobs.has('secondary-community'));
communityCurrent = false; await flush();
assert.equal(communityRoot.style.display, '', 'Community commits revalidate ownership after the idle wait');
communityCurrent = true;
community.scheduleCommunityHydration(communityDoc, data, async () => [], () => communityCurrent);
await tick(); await flush();
assert.equal(communityRoot.style.display, 'none', 'The current community result renders immediately when the interaction queue flushes');

// A denied explicit activity guard cannot fall back to a global Steam AppID.
let nativeActivityCalls = 0;
const activity = load('frontend/features/library/social/activity.ts', {
  '@steambrew/client': { findModuleExport: () => null },
  '../../../core/text': {}, '../../../steam/css': {}, '../../../steam/localization': {},
  '../../../api/backend': { backendLog() {} }, '../../../steam/social': {}, './personas': {},
  './host': { socialRuntimeHost: () => ({ getCurrentInjectedAppId: () => '123', getCurrentInjectedShortcutAppId: () => '3000000001' }) },
  './feed': { hasFreshFriendActivitySnapshot: () => false },
  '../../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: queue },
}, { window: { appActivityStore: { GetAppActivity: () => { nativeActivityCalls++; return { m_bLoaded: true }; } } } });
await activity.populateActivityFeed({ getElementById: () => ({ dataset: { gdlSteamAppId: '123' } }) }, '123', 'Game', 'header', [],
  { shortcutAppId: '3000000001', isCurrent: () => false });
assert.equal(nativeActivityCalls, 0, 'An old mount never restarts native activity scans through the global same-AppID fallback');

console.log('Secondary hydration passed: 100-pass dedupe, fresh metadata/language/retry invalidation, full feed signatures, sidebar-idle commits, exact mounted-root/shortcut guards, bounded empty social cache and native activity isolation.');
