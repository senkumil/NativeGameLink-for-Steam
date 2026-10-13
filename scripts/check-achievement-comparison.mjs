import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const alice = '76561198000000001';
const bob = '76561198000000002';
const wishlisted = '76561198000000003';
const personas = new Map([[alice, { steamid: alice, name: 'Alice', avatar: 'alice.png' }]]);
let gameplayCalls = 0;
let personaCalls = 0;
let nativeCalls = 0;
let now = 1000;
let gameplay = {
  inGame: [{ steamid: bob }], recentlyPlayed: [{ steamid: alice }, { steamid: bob }],
  previouslyPlayed: [{ steamid: alice }], owns: [{ steamid: bob }, { steamid: 'invalid' }],
  wishlisted: [{ steamid: wishlisted }], totalCount: 3,
};
let response = { result: 1, data: { rgAchievements: [
  { strID: 'CONSUMED', bAchieved: true, rtUnlocked: 1700000000, flCurrentProgress: 12 },
  { strID: 'LOCKED', bAchieved: false, rtUnlocked: 0, flCurrentProgress: 3.5 },
  { strID: 'SANITIZED', bAchieved: false, rtUnlocked: -1, flCurrentProgress: -1 },
  { strID: 'UNKNOWN', rtUnlocked: 1700000000 },
] } };
const apps = {
  async GetFriendAchievementsForApp(appid, steamid) {
    assert.equal(this, apps, 'the Steam API retains its native receiver');
    assert.match(appid, /^\d+$/);
    assert.match(steamid, /^\d{16,20}$/);
    nativeCalls++;
    return response;
  },
};
const doc = { defaultView: { SteamClient: { Apps: apps } } };
class TestDate extends Date { static now() { return now; } }
const dependencies = {
  '../../api/backend': { fetchFriendPersonasBackend: async ({ steam_ids_csv }) => {
    personaCalls++;
    assert.equal(steam_ids_csv, bob);
    return JSON.stringify([{ steamid: bob, name: 'Bob', avatar: 'bob.png' },
      { steamid: wishlisted, name: 'Outside response', avatar: '' }]);
  } },
  '../../steam/social': {
    fetchFriendsGameplayInfo: async () => { gameplayCalls++; return gameplay; },
    extractSteamIdFromValue: value => /^\d{16,20}$/.test(String(value)) ? String(value) : '',
  },
  '../library/social/personas': {
    getCachedPersona: id => personas.get(id),
    cachePersona: persona => personas.set(persona.steamid, persona),
  },
};
const context = vm.createContext({ exports: {}, window: {}, Date: TestDate, setTimeout, clearTimeout,
  require: name => { assert(name in dependencies, name); return dependencies[name]; } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/achievements/comparison.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { getAchievementComparisonFriends: friends, getFriendAchievementState: state } = context.exports;

const firstFriends = friends(doc, '1790600');
assert.equal(friends(doc, 1790600), firstFriends, 'concurrent friend-list calls share one promise');
const list = await firstFriends;
assert.deepEqual(Array.from(list, item => item.steamid), [alice, bob], 'deduped relevant friends sort by real persona name');
assert.equal(list[0].name, 'Alice');
assert.equal(list[1].avatar, 'bob.png');
assert.equal(personas.has(wishlisted), false, 'unexpected persona results cannot enter the comparison list');
for (let index = 0; index < 100; index++) await friends(doc, '1790600');
assert.equal(gameplayCalls, 1, '100 renders reuse the gameplay response');
assert.equal(personaCalls, 1, 'missing names use one batch request');

const firstState = state(doc, '1790600', alice);
assert.equal(state(doc, 1790600, alice), firstState, 'concurrent native achievement calls are deduplicated');
const values = await firstState;
assert.equal(values.get('CONSUMED').earned, true);
assert.equal(values.get('CONSUMED').earnedTime, 1700000000);
assert.equal(values.get('LOCKED').earned, false);
assert.equal(values.get('LOCKED').progress, 3.5);
assert.equal(values.get('SANITIZED').earnedTime, 0);
assert.equal(values.get('SANITIZED').progress, 0);
assert.equal(values.has('UNKNOWN'), false, 'rows without an earned flag remain unknown');
assert.equal(values.has('MISSING'), false, 'absent achievements are never fabricated as locked');
for (let index = 0; index < 100; index++) await state(doc, '1790600', alice);
assert.equal(nativeCalls, 1, '100 row renders reuse the real native comparison result');

response = { result: 15, message: 'private profile', data: { rgAchievements: [] } };
await assert.rejects(state(doc, '1790600', bob), /private_or_unavailable/,
  'privacy failures reject instead of pretending the friend has zero achievements');
response = { result: 1, data: { rgAchievements: [] } };
assert.equal((await state(doc, '1790600', bob)).size, 0, 'failed requests can recover without restarting Steam');
response = { result: 1, data: {} };
await assert.rejects(state(doc, '1593500', bob), /invalid_response/);
await assert.rejects(state({ defaultView: {} }, '1790600', alice), /unavailable/,
  'documents without the native comparison API cannot invent remote progress');
assert.throws(() => state(doc, '3000000001', alice), /invalid_appid/);
assert.throws(() => state(doc, '1790600', 'not-a-steamid'), /invalid_steamid/);

response = { result: 1, data: { rgAchievements: [] } };
const beforeExpiry = nativeCalls;
now += 30_001;
await state(doc, '1790600', alice);
assert.equal(nativeCalls, beforeExpiry + 1, 'a short TTL permits real friend progress to refresh');
const beforeBound = nativeCalls;
for (let index = 0; index < 65; index++) await state(doc, '1790600', String(BigInt(alice) + 100n + BigInt(index)));
await state(doc, '1790600', alice);
assert.equal(nativeCalls, beforeBound + 66, 'old comparisons are evicted when the session cache reaches its bound');

const isolated = { defaultView: { SteamClient: { Apps: apps } } };
const beforeIsolation = nativeCalls;
await state(isolated, '1790600', alice);
assert.equal(nativeCalls, beforeIsolation + 1, 'CEF documents have separate session comparison caches');
gameplay = null;
await assert.rejects(friends(doc, '1593500'), /friends_unavailable/);
gameplay = { inGame: [], recentlyPlayed: [], previouslyPlayed: [], owns: [], totalCount: 0 };
assert.equal((await friends(doc, '1593500')).length, 0, 'a confirmed empty friend list is distinct from a failed lookup');
console.log('Achievement comparison passed: real Steam API contract, relevant friends/personas, privacy failures, truthful missing IDs, 100-call deduplication, refresh TTL, bounded caches and document isolation.');
