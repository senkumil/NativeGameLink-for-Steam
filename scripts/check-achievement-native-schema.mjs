import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function load(file, dependencies, extras) {
  const context = vm.createContext({ exports: {}, require: name => {
    assert(name in dependencies, `Unexpected dependency ${file}: ${name}`); return dependencies[name];
  }, ...extras });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context, { filename: file });
  return context.exports;
}
const id = '550', shortcut = '3000000001';
// These IDs occur in the installed Steam L4D2 schema. Display names/percentages
// must not be used to guess or replace those authoritative identifiers.
const canonicalId = 'ACH_HONK_A_CLOWNS_NOSE';
const nativeRow = Object.freeze({ strID: canonicalId, strName: 'Native clown achievement', strDescription: 'Native description',
  strImage: 'https://shared.steamstatic.com/community_assets/images/apps/550/icon.jpg', strImageGray: 'gray.jpg',
  bHidden: false, flAchieved: 3.5, bAchieved: true, rtUnlocked: 1787958828, flCurrentProgress: 10, flMaxProgress: 10,
  accountProgress: 100, unlocked: true });
const nativeResult = () => ({ result: 1, data: { rgAchievements: [nativeRow] } });
const unverified = () => ({ found: true, appid: id, metadata_appid: id, state_appid: shortcut, metadata_source: 'steam_public_unverified',
  total: 1, unlocked: 0, achievements: [{ name: 'UNVERIFIED_PUBLIC_HINT', earned: false }] });
const verified = () => ({ ...unverified(), metadata_source: 'steam_native_schema', achievements: [{ name: canonicalId, earned: false }] });

function harness() {
  let now = 1000, sequence = 0, writes = 0;
  const timers = new Map(), nativeCalls = [], backendCalls = [], published = [];
  class TestDate extends Date { static now() { return now; } }
  const setTimeout = (callback, delay) => { const key = ++sequence; timers.set(key, { callback, due: now + delay, delay }); return key; };
  const clearTimeout = key => timers.delete(key);
  let nativeImplementation = () => Promise.resolve(nativeResult());
  let backendImplementation = () => Promise.resolve(JSON.stringify(verified()));
  const blockedStore = new Proxy({}, { set() { writes++; throw new Error('Native store write is forbidden'); },
    get(_target, key) { if (String(key).startsWith('m_') || String(key).startsWith('Save')) throw new Error('Native cache access is forbidden'); } });
  const window = Object.freeze({ SteamClient: Object.freeze({ Apps: Object.freeze({
    GetMyAchievementsForApp(appid) { nativeCalls.push(appid); return nativeImplementation(appid); },
  }) }), appStore: blockedStore, appDetailsStore: blockedStore, achievementStore: blockedStore, appAchievementProgressCache: blockedStore });
  const extras = { window, Date: TestDate, setTimeout, clearTimeout };
  const schema = load('frontend/features/achievements/native-schema.ts', {}, extras);
  const service = load('frontend/features/achievements/service.ts', {
    '../../api/backend': { fetchLocalAchievementsBackend(request) { backendCalls.push(JSON.parse(request.request_json)); return backendImplementation(request); } },
    '../../core/preferences': { getPreferences: () => ({}), simulatedAchievementsEnabled: () => false },
    '../../steam/localization': { steamLanguageSync: () => 'spanish' }, './native-schema': schema,
  }, extras);
  service.subscribeLocalAchievementData(value => published.push(value));
  return { schema, service, nativeCalls, backendCalls, published, timers, writes: () => writes,
    native: implementation => { nativeImplementation = implementation; }, backend: implementation => { backendImplementation = implementation; },
    advance: async milliseconds => {
      now += milliseconds;
      for (const [key, timer] of Array.from(timers)) if (timer.due <= now) { timers.delete(key); timer.callback(); }
      await flush();
    },
  };
}

const h = harness(), nativePending = deferred();
h.native(() => nativePending.promise);
const first = h.schema.readNativeAchievementSchema(id), same = h.schema.readNativeAchievementSchema(id);
check(first === same && h.nativeCalls.length === 1, 'Concurrent schema readers coalesce into one native API read');
check(h.nativeCalls[0] === id, 'The native API receives the requested official AppID');
nativePending.resolve(nativeResult()); const schema = await first; await flush();
check(schema.appid === id && schema.rows[0].strID === canonicalId, 'Schema preserves authoritative native IDs rather than community order or percentage guesses');
check(schema.rows[0] !== nativeRow && Object.isFrozen(nativeRow), 'Schema extraction copies immutable native records');
check(Object.keys(schema.rows[0]).sort().join(',') === 'bHidden,flAchieved,strDescription,strID,strImage,strImageGray,strName',
  'Only schema fields survive extraction; personal earned state, timestamps and progress are stripped');
check(!h.timers.size && h.writes() === 0, 'Completed native reads clear their timeout and never write native stores');
for (const invalid of ['0', '-1', 'bad', '2147483648', '4294967295']) {
  check(await h.schema.readNativeAchievementSchema(invalid) === null && h.nativeCalls.length === 1, 'Invalid and shortcut IDs never reach the public native schema API');
}

const duplicate = harness();
duplicate.native(() => ({ result: 1, data: { rgAchievements: [nativeRow, nativeRow, { strID: '' }, { strID: 'x'.repeat(257) }] } }));
check((await duplicate.schema.readNativeAchievementSchema(id)).rows.length === 1, 'Duplicate and invalid achievement IDs are rejected');
const oversized = harness(); oversized.native(() => ({ result: 1, data: { rgAchievements: Array(2001).fill(nativeRow) } }));
check(await oversized.schema.readNativeAchievementSchema(id) === null, 'Oversized native responses are rejected before copying');
for (const field of ['unAppID', 'appid', 'nAppID']) {
  const mismatched = harness(); mismatched.native(() => ({ result: 1, data: { [field]: '730', rgAchievements: [nativeRow] } }));
  check(await mismatched.schema.readNativeAchievementSchema(id) === null && mismatched.timers.size === 0,
    `A native response tagged with another game's ${field} cannot establish this schema`);
  const matching = harness(); matching.native(() => ({ result: 1, data: { [field]: Number(id), rgAchievements: [nativeRow] } }));
  check((await matching.schema.readNativeAchievementSchema(id)).appid === id,
    `A matching numeric ${field} retains the requested authoritative identity`);
}
const failed = harness(); failed.native(() => { throw new Error('bridge unavailable'); });
check(await failed.schema.readNativeAchievementSchema(id) === null, 'Native bridge errors resolve as unavailable schema');
check(await failed.schema.readNativeAchievementSchema(id) === null && failed.nativeCalls.length === 1, 'A failed native read has bounded retry backoff');
await failed.advance(15001); failed.native(() => nativeResult());
check((await failed.schema.readNativeAchievementSchema(id)).rows[0].strID === canonicalId && failed.nativeCalls.length === 2, 'Failure backoff permits a later successful read');
const timeout = harness(); timeout.native(() => new Promise(() => {}));
const timedRead = timeout.schema.readNativeAchievementSchema(id);
check([...timeout.timers.values()][0].delay === 1500, 'Native schema reads have a fixed finite timeout');
await timeout.advance(1500);
check(await timedRead === null && timeout.timers.size === 0, 'A hung native bridge settles without retained timers');

const retry = harness(), backendFirst = deferred(), schemaWait = deferred();
retry.backend(() => backendFirst.promise); retry.native(() => schemaWait.promise);
const requestA = retry.service.fetchLocalAchievementData(id, { stateAppId: shortcut });
const requestB = retry.service.fetchLocalAchievementData(id, { stateAppId: shortcut });
check(retry.backendCalls.length === 1, 'Concurrent local readers coalesce before schema fallback');
backendFirst.resolve(JSON.stringify(unverified())); await flush();
check(retry.nativeCalls.length === 1, 'Only explicitly unverified public metadata requests native schema verification');
retry.backend(() => JSON.stringify(verified())); schemaWait.resolve(nativeResult());
const [dataA, dataB] = await Promise.all([requestA, requestB]);
check(dataA === dataB && dataA.achievements[0].name === canonicalId, 'Coalesced callers receive the verified native identifier');
check(retry.backendCalls.length === 2 && retry.backendCalls[1].native_schema.appid === id, 'Verification retries the backend exactly once with the matching native schema AppID');
check(retry.backendCalls[1].state_app_id === shortcut && retry.backendCalls[1].language === 'spanish', 'Verification preserves requested local installation and language');
check(!('bAchieved' in retry.backendCalls[1].native_schema.rows[0]) && !('rtUnlocked' in retry.backendCalls[1].native_schema.rows[0]), 'Retry IPC cannot import native personal progress into local achievements');
check(retry.published.length === 1 && retry.published[0].stateAppId === shortcut && retry.writes() === 0, 'Only one verified local update is published and native stores remain untouched');

const trusted = harness(); trusted.backend(() => JSON.stringify({ ...verified(), metadata_source: 'steam_schema' }));
await trusted.service.fetchLocalAchievementData(id, { stateAppId: shortcut });
check(trusted.nativeCalls.length === 0 && trusted.backendCalls.length === 1, 'Already authoritative native schema metadata skips fallback verification');
const simulated = harness(); let simulatedCalls = 0;
simulated.backend(() => JSON.stringify(++simulatedCalls === 1
  ? { ...unverified(), metadata_source: 'steam_public_unverified:simulated-test' }
  : { ...verified(), metadata_source: 'steam_client_schema:simulated-test' }));
check((await simulated.service.fetchLocalAchievementData(id)).metadata_source === 'steam_client_schema:simulated-test'
  && simulated.nativeCalls.length === 1 && simulated.backendCalls.length === 2,
  'Simulated linked progress also repairs unverified public names/icons through a read-only native schema');
const wrongApp = harness(); let wrongCount = 0;
wrongApp.backend(() => JSON.stringify(++wrongCount === 1 ? unverified() : { ...verified(), appid: '730', metadata_appid: '730' }));
check((await wrongApp.service.fetchLocalAchievementData(id)).metadata_appid === id, 'A retry response for another AppID cannot replace this game');
const schemaFailure = harness(); let onlyBackend = 0;
schemaFailure.backend(() => { onlyBackend++; return JSON.stringify(unverified()); }); schemaFailure.native(() => ({ result: 2 }));
check((await schemaFailure.service.fetchLocalAchievementData(id)).metadata_source === 'steam_public_unverified' && onlyBackend === 1,
  'Unavailable native schema preserves explicitly unverified metadata without repeated retry IPC');

const offBeforeSchema = harness(), offFirst = deferred();
offBeforeSchema.backend(() => offFirst.promise);
const offEarly = offBeforeSchema.service.fetchLocalAchievementData(id);
offBeforeSchema.service.clearLocalAchievementRequestCache(); offFirst.resolve(JSON.stringify(unverified())); await flush();
check(await offEarly === null && offBeforeSchema.nativeCalls.length === 0 && offBeforeSchema.backendCalls.length === 1 && offBeforeSchema.published.length === 0,
  'Disable before the first IPC resolves prevents both native schema reads and verification retry IPC');

const offDuringSchema = harness(), offSchema = deferred();
offDuringSchema.backend(() => JSON.stringify(unverified())); offDuringSchema.native(() => offSchema.promise);
const offMiddle = offDuringSchema.service.fetchLocalAchievementData(id, { stateAppId: shortcut }); await flush();
offDuringSchema.service.clearLocalAchievementRequestCache(); offSchema.resolve(nativeResult());
check(await offMiddle === null && offDuringSchema.backendCalls.length === 1 && offDuringSchema.published.length === 0,
  'Disable during schema verification prevents retry IPC and stale publication');

const offDuringRetry = harness(), retryWait = deferred(); let retryCount = 0;
offDuringRetry.backend(() => ++retryCount === 1 ? JSON.stringify(unverified()) : retryWait.promise);
const offLate = offDuringRetry.service.fetchLocalAchievementData(id); await flush();
check(offDuringRetry.backendCalls.length === 2, 'The verified retry began while the request was still live');
offDuringRetry.service.clearLocalAchievementRequestCache(); retryWait.resolve(JSON.stringify(verified()));
check(await offLate === null && offDuringRetry.published.length === 0, 'A verification response arriving after disable never publishes');
check([h, duplicate, oversized, failed, timeout, retry, trusted, wrongApp, schemaFailure, offBeforeSchema, offDuringSchema, offDuringRetry].every(test => test.writes() === 0),
  'All success, failure, timeout and cancellation paths avoid native store writes');
const slider = harness(), stalePoll = deferred();
slider.backend(() => stalePoll.promise);
const staleRead = slider.service.fetchLocalAchievementData(id, { stateAppId: shortcut });
const preview = { ...verified(), simulation_enabled: true, unlocked: 1, achievements: [{ name: canonicalId, earned: true }] };
slider.service.publishOptimisticAchievementUpdate({ steamAppId: id, stateAppId: shortcut, data: preview });
stalePoll.resolve(JSON.stringify(verified()));
check(await staleRead === null && slider.published.length === 1 && slider.published[0].data.unlocked === 1,
  'An old zero-progress response cannot undo a newer slider preview');
check(await slider.service.fetchLocalAchievementData(id, { stateAppId: shortcut, maxAgeMs: 0 }) === preview
  && slider.backendCalls.length === 1, 'Polling retains the preview while the options write is pending');
const other = { ...verified(), state_appid: '3000000002' };
slider.backend(() => JSON.stringify(other));
check((await slider.service.fetchLocalAchievementData(id, { stateAppId: '3000000002' })).unlocked === 0,
  'A pending slider does not hold another installation of the same game');
slider.service.releaseOptimisticAchievementUpdate(id, shortcut);
slider.backend(() => JSON.stringify(preview));
check((await slider.service.fetchLocalAchievementData(id, { stateAppId: shortcut })).unlocked === 1
  && slider.backendCalls.length === 3, 'The save acknowledgement releases the exact pair for backend confirmation');
slider.service.publishOptimisticAchievementUpdate({ steamAppId: id, stateAppId: shortcut, data: preview });
const retiringPreview = slider.service.fetchLocalAchievementData(id, { stateAppId: shortcut });
slider.service.releaseOptimisticAchievementUpdate(id, shortcut);
check(await retiringPreview === null, 'A preview queued before acknowledgement cannot repaint after its hold is released');
slider.service.publishOptimisticAchievementUpdate({ steamAppId: id, stateAppId: shortcut, data: preview });
await slider.advance(15001);
slider.backend(() => JSON.stringify(verified()));
check((await slider.service.fetchLocalAchievementData(id, { stateAppId: shortcut, maxAgeMs: 0 })).unlocked === 0,
  'An abandoned preview expires rather than retaining simulated state forever');
console.log(`Achievement native schema passed: ${checks} assertions; coalescing, canonical IDs, schema-only IPC, bounded failures and cancellation.`);
