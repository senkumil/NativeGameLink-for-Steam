import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let now = 0;
const context = vm.createContext({ exports: {}, Date: { now: () => now } });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/achievement-cache-repair.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const install = context.exports.installLegacyAchievementCacheRepair;
const legacy = (appid, overrides = {}) => ({ appid, total: 4, unlocked: 1, percentage: 25, cache_time: 2147483647, ...overrides });
function fixture(entries = [], queue) {
  const timers = new Map(), calls = [], map = new Map(entries);
  let nextTimer = 0, reads = 0, cache;
  const view = { closed: false,
    setTimeout(callback, delay) { const key = ++nextTimer; timers.set(key, { callback, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
  };
  const doc = { defaultView: view }; view.document = doc;
  const nativeCache = { m_achievementProgress: { mapCache: map }, QueueCacheUpdate(id) {
    assert.equal(this, nativeCache, 'The official native method retains its native cache receiver');
    calls.push(id); queue?.(id, calls);
  } };
  cache = nativeCache;
  Object.defineProperty(view, 'appAchievementProgressCache', { get() { reads++; return cache; }, set(value) { cache = value; } });
  const advance = milliseconds => {
    const until = now + milliseconds; let iterations = 0;
    while (timers.size) {
      const [key, next] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (next.at > until) break;
      assert(++iterations < 10000, 'Repair discovery is bounded');
      now = next.at; timers.delete(key); next.callback();
    }
    now = until;
  };
  return { doc, view, map, calls, timers, nativeCache, advance, get reads() { return reads; } };
}

{
  const entries = [
    [100, legacy(100)], [101, legacy(101, { cache_time: '2147483647' })],
    [102, legacy(102, { percentage: 99 })], [103, legacy(103, { foreign: true })],
    [104, legacy(104, { unlocked: -1 })], [105, legacy(999)],
    [106, legacy(106, { cache_time: 12345 })], ['107', legacy(107)],
    [108, legacy(108, { total: 0, unlocked: 0, percentage: 0 })],
    [3000000001, legacy(3000000001)], [0, legacy(0)], [-1, legacy(-1)],
  ].map(([id, data]) => [id, Object.freeze(data)]);
  const f = fixture(entries), before = [...f.map];
  for (const method of ['set', 'delete', 'clear']) f.map[method] = () => { throw new Error(`Manual cache mutation forbidden: ${method}`); };
  const dispose = install(f.doc);
  assert.equal(install(f.doc), dispose, 'A document has one repair installer');
  assert.deepEqual(f.calls, [100, 108], 'Only the exact historical public numeric entry shape reaches Steam');
  f.advance(4000); assert.equal(f.timers.size, 0, 'Startup discovery stops after three seconds');
  const reads = f.reads; f.advance(60000); assert.equal(f.reads, reads, 'There is no per-route or idle repair polling');
  assert.deepEqual([...f.map], before, 'No native cache entry, object identity or file is mutated by the repair helper');
  dispose(); dispose(); install(f.doc); assert.deepEqual(f.calls, [100, 108], 'Reinstalling cannot queue already repaired entries from the same cache map');
}
{
  const f = fixture([[200, legacy(200)]]); f.view.appAchievementProgressCache = undefined;
  const dispose = install(f.doc); assert.equal(f.calls.length, 0);
  f.advance(500); f.view.appAchievementProgressCache = f.nativeCache;
  f.advance(250); assert.deepEqual(f.calls, [200], 'A late native store is discovered within the startup budget');
  const replacement = new Map([[201, legacy(201)]]); f.nativeCache.m_achievementProgress.mapCache = replacement;
  f.advance(250); assert.deepEqual(f.calls, [200, 201], 'Late LoadCacheFile map replacement is inspected once as its own native generation');
  f.advance(4000); dispose(); assert.equal(f.timers.size, 0);
}
{
  const f = fixture([[300, legacy(300)]], (_id, calls) => { if (calls.length === 1) throw new Error('Native store not ready'); });
  install(f.doc); assert.deepEqual(f.calls, [300]); f.advance(250);
  assert.deepEqual(f.calls, [300, 300], 'Synchronous native readiness failures retry inside the bounded discovery window');
  f.advance(4000); assert.equal(f.calls.length, 2, 'A successful native enqueue is never repeated');
}
{
  const f = fixture([[400, legacy(400)]], () => { throw new Error('Unavailable'); });
  install(f.doc); f.nativeCache.m_achievementProgress.mapCache.set(400, legacy(400, { cache_time: 12345 }));
  f.advance(4000); assert.equal(f.calls.length, 1, 'Failed enqueues are revalidated and skip entries Steam has already refreshed');
}
{
  const f = fixture(Array.from({ length: 200 }, (_, index) => [500 + index, legacy(500 + index)]));
  install(f.doc); f.advance(4000);
  assert.equal(f.calls.length, 128, 'At most 128 legacy public IDs are submitted to the native batching queue');
  assert.equal(new Set(f.calls).size, 128);
}
{
  const f = fixture(Array.from({ length: 200 }, (_, index) => [800 + index, legacy(800 + index)]), () => { throw new Error('Unavailable'); });
  const dispose = install(f.doc); assert.equal(f.calls.length, 128, 'Even synchronous failures retain at most 128 candidate IDs');
  f.advance(4000); assert(f.calls.length <= 128 * 12, 'Repeated failures have a finite startup retry budget');
  assert.equal(new Set(f.calls).size, 128); dispose();
}
{
  const entries = Array.from({ length: 2048 }, (_, index) => [10000 + index, legacy(10000 + index, { cache_time: 12345 })]);
  entries.push([15000, legacy(15000)]); const f = fixture(entries);
  install(f.doc); assert.equal(f.calls.length, 0, 'A large native cache scan yields after a bounded chunk');
  f.advance(32); assert.deepEqual(f.calls, [15000], 'Chunked scanning still finds a legacy entry beyond the first two chunks');
}
{
  const f = fixture([[16000, legacy(16000)]]); f.view.appAchievementProgressCache = undefined;
  const dispose = install(f.doc); dispose(); f.view.appAchievementProgressCache = f.nativeCache;
  f.advance(4000); assert.equal(f.calls.length + f.timers.size, 0, 'Disposal cancels late discovery without queueing work');
}
{
  const f = fixture([[17000, legacy(17000)]]); f.view.appAchievementProgressCache = undefined;
  install(f.doc); f.view.document = {}; f.view.appAchievementProgressCache = f.nativeCache;
  f.advance(250); assert.equal(f.calls.length + f.timers.size, 0, 'A replaced document cannot repair through another document realm');
}
{
  const a = fixture([[18000, legacy(18000)]]), b = fixture([[19000, legacy(19000)]]);
  install(a.doc); assert.deepEqual(a.calls, [18000]); assert.deepEqual(b.calls, [], 'Another Steam window cache is never borrowed');
  install(b.doc); assert.deepEqual(b.calls, [19000]);
}
console.log('Legacy native achievement cache repair passed: exact sentinel ownership, official receiver, no cache writes, late-store/map discovery, bounded scans/retries, 128-ID cap, disposal and realm isolation.');
