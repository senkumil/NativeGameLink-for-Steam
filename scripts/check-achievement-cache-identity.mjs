import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('frontend/features/achievements/cache.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const steam = '1030300';
const otherSteam = '1790600';
const shortcutA = '3000000001';
const shortcutB = '3000000002';
const shortcutC = '3000000003';
const storage = new Map();
let assertions = 0;
let now = Date.now();
class TestDate extends Date { static now() { return now; } }

function loadCache(backing = storage) {
  const context = vm.createContext({ exports: {}, Date: TestDate, localStorage: {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: key => backing.delete(key),
  } });
  vm.runInContext(source, context);
  return context.exports;
}

function snapshot(overrides = {}) {
  return {
    appid: steam, metadata_appid: steam, state_appid: shortcutA,
    path: 'C:\\Games\\Install A\\achievements.json', root: 'C:\\Games\\Install A',
    found: true, unlocked: 1, total: 2,
    achievements: [
      { name: 'FIRST', display_name: 'First', description: '', icon: 'first.png', icon_gray: 'first-gray.png',
        earned: true, earned_time: 1700000000, progress: 1, max_progress: 1 },
      { name: 'SECOND', display_name: 'Second', description: '', icon: 'second.png', icon_gray: 'second-gray.png',
        earned: false, earned_time: 0, progress: 0, max_progress: 1 },
    ],
    ...overrides,
  };
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions++;
}

const cache = loadCache();
const a = snapshot();
const contaminatedStorage = new Map([['gdl_local_achievement_snapshots_v2', JSON.stringify({ version: 1,
  entries: [{ updatedAt: now, aliases: [steam, shortcutB], data: a }] })]]);
contaminatedStorage.set('gdl_local_achievement_snapshots_v3', JSON.stringify({ version: 1,
  entries: [{ updatedAt: now, aliases: [steam, shortcutB], data: a }] }));
equal(loadCache(contaminatedStorage).getCachedLocalAchievementsForShortcut(steam, shortcutB), null,
  'previous renderer snapshots potentially aliased during navigation are never restored');
equal(contaminatedStorage.size, 2, 'discarding a renderer snapshot does not delete any achievement progress');
const b = snapshot({ state_appid: shortcutB, path: 'D:\\Install B\\achievements.json', root: 'D:\\Install B', unlocked: 0 });
cache.cacheLocalAchievements(a, shortcutA);
now++;
cache.cacheLocalAchievements(b, shortcutB);
equal(cache.getCachedLocalAchievementsForGame(steam, shortcutA), b,
  'the existing general API keeps its Steam-first behavior');
equal(cache.getCachedLocalAchievementsForShortcut(steam, shortcutA), a,
  'shortcut A resolves its own local state when the shared Steam alias points to B');
equal(cache.getCachedLocalAchievementsForShortcut(Number(steam), Number(shortcutB)), b,
  'numeric arguments preserve the exact shortcut alias');
equal(cache.getCachedLocalAchievementsForShortcut(steam, shortcutC), null,
  'a missing shortcut alias never falls back to the Steam snapshot');
equal(cache.getCachedLocalAchievementsForShortcut(otherSteam, shortcutA), null,
  'an alias left by a relink cannot seed a different metadata Steam AppID');
equal(cache.getCachedLocalAchievementsForShortcut(steam, ''), null, 'an absent shortcut cannot use the shared alias');
equal(cache.getCachedLocalAchievementsForShortcut('bad', shortcutA), null, 'invalid metadata IDs are rejected');

const staleA = snapshot({ unlocked: 0 });
equal(cache.pickCachedLocalAchievementSnapshot(staleA), a,
  'the render helper selects the matching local source rather than the shared Steam alias');
for (const [field, value] of [
  ['metadata_appid', otherSteam], ['state_appid', shortcutC],
  ['path', 'C:\\Games\\Other\\achievements.json'], ['root', 'C:\\Games\\Other'],
]) {
  const different = snapshot({ [field]: value });
  equal(cache.pickCachedLocalAchievementSnapshot(different), different,
    `a different ${field} preserves the input instead of using another source's snapshot`);
}

cache.clearLocalAchievementCache(false);
equal(cache.getCachedLocalAchievementsForGame(steam), b, 'the latest persisted Steam alias still points to B');
equal(cache.pickCachedLocalAchievementSnapshot(staleA).state_appid, shortcutA,
  'a source alias is searched in persistence before a shared Steam alias');
equal(cache.getCachedLocalAchievementsForShortcut(steam, shortcutC), null,
  'a persisted Steam snapshot cannot satisfy a missing shortcut alias');

const cold = loadCache();
equal(cold.getCachedLocalAchievementsForShortcut(steam, shortcutA).path, a.path,
  'a fresh renderer restores A from persistent storage without borrowing B');
equal(cold.getCachedLocalAchievementsForShortcut(steam, shortcutB).unlocked, b.unlocked,
  'a fresh renderer independently restores B');
equal(cold.getCachedLocalAchievementsForShortcut(otherSteam, shortcutA), null,
  'metadata verification also applies to cold snapshots');
equal(cold.getCachedLocalAchievementsForShortcut(steam, shortcutC), null,
  'cold alias misses remain empty');
equal(cold.pickCachedLocalAchievementSnapshot(staleA).path, a.path,
  'the render helper also recovers the matching persisted source');

const legacyStorage = new Map();
const legacy = loadCache(legacyStorage);
const legacyA = snapshot({ state_appid: steam, unlocked: 1 });
const legacyB = snapshot({ state_appid: steam, path: b.path, root: b.root, unlocked: 0 });
legacy.cacheLocalAchievements(legacyA, shortcutA);
now++;
legacy.cacheLocalAchievements(legacyB, shortcutB);
equal(legacy.getCachedLocalAchievementsForShortcut(steam, shortcutA), legacyA,
  'legacy Steam provenance does not have to equal the shortcut alias');
const legacyCold = loadCache(legacyStorage);
equal(legacyCold.getCachedLocalAchievementsForShortcut(steam, shortcutA).path, legacyA.path,
  'legacy sources with the same appid and state_appid stay separate after restart');
equal(legacyCold.getCachedLocalAchievementsForShortcut(steam, shortcutB).path, legacyB.path,
  'legacy B keeps its own persisted source');
equal(legacyCold.pickCachedLocalAchievementSnapshot({ ...legacyA, unlocked: 0 }).path, legacyA.path,
  'the source identity includes both path and root for legacy provenance');
const oldShortcutProvenance = snapshot({ state_appid: '2999999999', path: 'E:\\Legacy\\state.json', root: 'E:\\Legacy' });
legacy.cacheLocalAchievements(oldShortcutProvenance, shortcutC);
equal(legacy.getCachedLocalAchievementsForShortcut(steam, shortcutC), oldShortcutProvenance,
  'an old shortcut provenance is valid under a verified explicit current alias');
equal(legacy.getCachedLocalAchievementsForShortcut(steam, '2999999999'), null,
  'backend state_appid never creates another shortcut alias implicitly');

const percentageStorage = new Map();
const percentageCache = loadCache(percentageStorage);
const oldPercentage = snapshot({ achievements: a.achievements.map(item => ({ ...item, global_percent: 100, hidden: false })) });
percentageCache.cacheLocalAchievements(oldPercentage, shortcutA);
const freshPercentage = { ...oldPercentage, achievements: oldPercentage.achievements.map(item => ({ ...item, global_percent: 3.5, hidden: true })) };
percentageCache.cacheLocalAchievements(freshPercentage, shortcutA);
equal(percentageCache.localAchievementDataSignature(oldPercentage) === percentageCache.localAchievementDataSignature(freshPercentage), false,
  'global percentage and hidden status invalidate render and persistence signatures');
const freshCold = loadCache(percentageStorage).getCachedLocalAchievementsForShortcut(steam, shortcutA);
equal(freshCold.achievements[0].global_percent, 3.5, 'a percentage-only change persists across renderers');
equal(freshCold.achievements[0].hidden, true, 'hidden status changes also persist');
const reorderedSchema = { ...freshPercentage, achievements: freshPercentage.achievements.map((item, index) => ({ ...item, schema_order: 1 - index })) };
equal(percentageCache.localAchievementDataSignature(freshPercentage) === percentageCache.localAchievementDataSignature(reorderedSchema), false,
  'a schema-order-only metadata update invalidates the preview render signature');
percentageCache.cacheLocalAchievements(reorderedSchema, shortcutA);
equal(loadCache(percentageStorage).getCachedLocalAchievementsForShortcut(steam, shortcutA).achievements[0].schema_order, 1,
  'schema ordering survives persistence and renderer replacement');

const metadataStorage = new Map();
const metadata = loadCache(metadataStorage);
const metadataBased = snapshot({ appid: shortcutA, metadata_appid: steam });
metadata.cacheLocalAchievements(metadataBased, shortcutA);
equal(metadata.getCachedLocalAchievementsForShortcut(steam, shortcutA), metadataBased,
  'metadata_appid is authoritative when appid is a local source ID');
equal(metadata.getCachedLocalAchievementsForShortcut(shortcutA, shortcutA), null,
  'a local appid cannot masquerade as metadata when metadata_appid is present');
const noMetadata = snapshot({ metadata_appid: undefined, state_appid: undefined, path: '', root: '' });
metadata.cacheLocalAchievements(noMetadata);
equal(metadata.pickCachedLocalAchievementSnapshot({ ...noMetadata, unlocked: 0 }), noMetadata,
  'older snapshots without optional metadata or source fields still match exactly');
metadata.invalidateLocalAchievementAliases([shortcutA]);
equal(metadata.getCachedLocalAchievementsForShortcut(steam, shortcutA), null,
  'shortcut invalidation removes the only allowed alias while preserving Steam data');

console.log(`Achievement cache identity: ${assertions} assertions passed.`);
