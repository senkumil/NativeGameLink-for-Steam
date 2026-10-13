import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('frontend/features/playtime/service.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const storage = new Map();
let storageWrites = 0;
function createService() {
  const pending = [];
  const context = vm.createContext({ exports: {}, localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => { storageWrites++; storage.set(key, value); },
  }, require: name => {
    assert.equal(name, '../../api/backend');
    return {
      backendLog() {},
      getAllPlaytimeDataBackend: ({ request_json }) => new Promise(resolve => {
        pending.push({ requests: JSON.parse(request_json).requests, resolve });
      }),
      getPlaytimeDataBackend() { throw new Error('Unexpected single-item fallback'); },
    };
  } });
  vm.runInContext(source, context);
  const respond = stats => {
    const request = pending.shift();
    assert(request, 'a backend batch is pending');
    request.resolve({ items: request.requests.map(item => ({ ...item, ok: true, ...stats })) });
  };
  return { service: context.exports, pending, respond };
}

const { service, pending, respond } = createService();
const lookup = { shortcutAppId: 3000000001, title: 'Game A', steamAppId: '100' };
const first = service.fetchPlaytimeStatsBatch([lookup]);
assert.equal(pending.length, 1);
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId, '100'), null, 'cold reads have no invented native values');
respond({ minutes_forever: 126, minutes_last_two_weeks: 15, total_seconds: 7560, last_played_at: 1700000000 });
await first;
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId, '100').minutesForever, 126);
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId, '200'), null, 'snapshots belong to the exact linked app');
const writesAfterFirst = storageWrites;
await service.fetchPlaytimeStatsBatch([lookup]);
assert.equal(pending.length, 0, 'repeated render checks share the resolved request');
assert.equal(storageWrites, writesAfterFirst, 'cached checks perform no storage writes');
const restarted = createService().service;
assert.equal(restarted.getInstantPlaytimeStats(lookup.shortcutAppId, '100').minutesForever, 126, 'last confirmed values survive plugin restart');
assert.equal(restarted.getInstantPlaytimeStats(lookup.shortcutAppId, '100').lastPlayedAt, 1700000000);

const zeroLookup = { shortcutAppId: 3000000002, title: 'Never played', steamAppId: '200' };
const zero = service.fetchPlaytimeStatsBatch([zeroLookup]);
respond({ minutes_forever: 0, minutes_last_two_weeks: 0, total_seconds: 0, last_played_at: null });
await zero;
assert.equal(service.getInstantPlaytimeStats(zeroLookup.shortcutAppId, '200').minutesForever, 0);
assert.equal(createService().service.getInstantPlaytimeStats(zeroLookup.shortcutAppId, '200').lastPlayedAt, null, 'confirmed zero is persisted instead of replaced by Steam counters');

service.clearPlaytimeStatsCache();
const obsolete = service.fetchPlaytimeStatsBatch([lookup]);
service.invalidatePlaytimeStatsCache(['100'], [lookup.shortcutAppId]);
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId), null);
respond({ minutes_forever: 999, last_played_at: 1800000000 });
assert.equal((await obsolete).get(lookup.shortcutAppId), null, 'invalidated requests cannot publish a stale result');
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId), null, 'late results cannot resurrect an invalidated persistent snapshot');
assert.equal(createService().service.getInstantPlaytimeStats(lookup.shortcutAppId), null);
assert(service.getInstantPlaytimeStats(zeroLookup.shortcutAppId, '200'), 'unrelated game snapshots survive targeted invalidation');

const inFlight = service.fetchPlaytimeStatsBatch([lookup]);
service.clearPlaytimeStatsCache();
respond({ minutes_forever: 777 });
await inFlight;
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId), null, 'generation invalidation also protects instant values');
const replacement = service.fetchPlaytimeStatsBatch([lookup]);
respond({ minutes_forever: 7, last_played_at: null });
await replacement;
assert.equal(service.getInstantPlaytimeStats(lookup.shortcutAppId, '100').minutesForever, 7, 'canonical lower values remain exact');

for (let index = 0; index < 110; index++) {
  service.setInstantPlaytimeStats(3100000000 + index, { minutesForever: index, minutesLastTwoWeeks: 0, lastPlayedAt: null }, '300');
}
const persisted = JSON.parse(storage.get('gdl_playtime_stats_snapshot_v1'));
assert.equal(persisted.values.length, 96, 'persistent snapshots have a fixed memory/storage bound');
assert.equal(service.getInstantPlaytimeStats(3100000000), null, 'evicted snapshots leave memory too');
console.log('Playtime service passed: synchronous confirmed snapshots, restart/zero values, exact app identity, request deduplication, stale IPC rejection, targeted invalidation and 96-entry bound.');
