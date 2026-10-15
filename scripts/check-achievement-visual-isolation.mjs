import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let now = 1000, probes = 0, scans = 0, invalidations = 0;
class Clock extends Date { static now() { return now; } }
const desktop = { defaultView: { webpackChunksteamui: [] } };
const bigPicture = { defaultView: { webpackChunksteamui: [] } };
const realms = new Map([
  [desktop, { identity: {}, modules: [] }], [bigPicture, { identity: {}, modules: [] }],
]);
let selected = bigPicture;
const runtime = {
	invalidate(doc) { invalidations++; realms.get(doc).identity = {}; },
  getRuntimeIdentity(doc) { probes++; return realms.get(doc || selected).identity; },
  getAllModules(doc) { scans++; return realms.get(doc || selected).modules.map((exports, id) => ({ id, exports })); },
};
const loaded = {};
function load(file, dependencies) {
  const context = vm.createContext({ exports: {}, Date: Clock, document: desktop, require: name => {
    assert(name in dependencies, `Unexpected ${file} dependency: ${name}`); return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context, { filename: file });
  return context.exports;
}
loaded.cache = load('frontend/steam/class-module-cache.ts', {
  './modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
});
loaded.css = load('frontend/steam/css.ts', { './class-module-cache': loaded.cache });
loaded.rare = load('frontend/features/achievements/steam-rare.ts', { '../../steam/class-module-cache': loaded.cache });

const achievementClasses = name => ({ AchievementHoverContainer: `${name}-hover`,
  UnlockedLabel: `${name}-unlocked`, SingleAchievementProgressBar: `${name}-progress` });
const rareClasses = name => ({ RareAchievementIconGlowContainerRoot: `${name}-root`,
  RareAchievementIconGlow: `${name}-glow`, Icon: `${name}-icon` });
const replace = (doc, modules) => Object.assign(realms.get(doc), { identity: {}, modules });
assert.equal(loaded.css.ACH_CLASS_MODULE(desktop).native, false, 'Startup may safely use fallback');
const firstProbes = probes, firstScans = scans;
for (let index = 0; index < 1000; index++) {
  loaded.css.ACH_CLASS_MODULE(desktop); loaded.rare.getSteamRareAchievementClasses(desktop);
}
assert.equal(probes, firstProbes, 'A row of icons must not rescan the runtime on every access');
assert.equal(scans, firstScans, 'Fallback lookups are bounded too');
replace(desktop, [{ AchievementHoverContainer() {}, UnlockedLabel() {}, SingleAchievementProgressBar() {} },
  achievementClasses('desktop'), { nested: rareClasses('desktop') }]);
now += 1000;
assert.equal(loaded.css.ACH_CLASS_MODULE(desktop).classes.AchievementHoverContainer, 'desktop-hover',
  'A late chunk replaces the startup fallback');
assert.equal(loaded.rare.getSteamRareAchievementClasses(desktop).icon, 'desktop-icon');

replace(bigPicture, [achievementClasses('gamepad'), rareClasses('gamepad')]);
assert.equal(loaded.css.ACH_CLASS_MODULE(bigPicture).classes.AchievementHoverContainer, 'gamepad-hover');
assert.equal(loaded.rare.getSteamRareAchievementClasses(bigPicture).icon, 'gamepad-icon');
selected = bigPicture;
assert.equal(loaded.css.ACH_CLASSES().AchievementHoverContainer, 'desktop-hover',
  'An implicit Desktop lookup cannot borrow the last selected Big Picture runtime');
assert.equal(loaded.rare.getSteamRareAchievementClasses().icon, 'desktop-icon');

replace(desktop, [achievementClasses('replacement'), rareClasses('replacement')]);
now += 1000;
assert.equal(loaded.css.ACH_CLASSES(desktop).AchievementHoverContainer, 'replacement-hover',
  'Runtime generations invalidate successful CSS resolutions');
assert.equal(loaded.rare.getSteamRareAchievementClasses(desktop).icon, 'replacement-icon',
  'Rare classes obey the same generation and document boundaries');
replace(desktop, []);
now += 1000;
assert.equal(loaded.css.ACH_CLASS_MODULE(desktop).native, false, 'Unloaded exports do not remain native');
assert.equal(loaded.rare.getSteamRareAchievementClasses(desktop), loaded.rare.FALLBACK_RARE_CLASSES);
// Older runtime adapters can omit a generation change while adding an export.
realms.get(desktop).modules.push(achievementClasses('late-without-signal'));
now += 1000;
assert.equal(loaded.css.ACH_CLASSES(desktop).AchievementHoverContainer, 'late-without-signal-hover',
  'An unresolved family is retried even when an old adapter keeps its token');
replace(desktop, [achievementClasses('reset'), rareClasses('reset')]);
loaded.css.resetResolvedCssClassModules();
assert.equal(loaded.rare.getSteamRareAchievementClasses(desktop).icon, 'reset-icon',
  'Lifecycle reset clears rare-class resolution through the shared cache');
assert.equal(loaded.css.ACH_CLASSES(desktop).AchievementHoverContainer, 'reset-hover');
const before = probes;
for (let index = 0; index < 1000; index++) {
  loaded.css.ACH_CLASS_MODULE(desktop); loaded.rare.getSteamRareAchievementClasses(desktop);
}
assert.equal(probes, before, 'Successful accesses also share one bounded runtime probe');
realms.get(desktop).modules = [achievementClasses('new-chunk-source'), rareClasses('new-chunk-source')];
desktop.defaultView.webpackChunksteamui = [];
assert.equal(loaded.rare.getSteamRareAchievementClasses(desktop).icon, 'new-chunk-source-icon',
  'Replacing a window runtime source invalidates its captured require immediately');
assert.equal(invalidations, 1);

const rarity = load('frontend/features/achievements/rarity.ts', {});
const htmlRenderer = load('frontend/features/achievements/sidebar.ts', {
  '../../api/backend': { backendLog() {} }, '../../core/text': { escapeHtml: String },
  '../../steam/localization': { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback },
  './cache': { cacheLocalAchievements() {}, localAchievementDataSignature: () => 'fixture' },
  './format': { localAchievementPercent: () => 100 }, './playbar': { ensureLocalPlaybarStat() {} },
  './modal': { openLocalAchievementsModal() {} }, './rarity': rarity, './steam-rare': loaded.rare,
});
const iconItem = { name: 'TEST', display_name: 'Test', description: '', icon: 'fixture.png', icon_gray: 'fixture-gray.png',
  earned: true, earned_time: 1, global_percent: null, global_percent_known: false };
const htmlFor = item => htmlRenderer.renderLocalAchievementSidebarHtml({ total: 1, unlocked: 1,
  achievements: [item] }, 6, desktop);
assert(!htmlFor(iconItem).includes('is-rare-glow'), 'Unknown rarity with no percentage cannot invent a rare icon glow');
assert(!htmlFor({ ...iconItem, global_percent: 0 }).includes('is-rare-glow'),
  'An unknown rarity placeholder of zero cannot invent a rare icon glow');
assert(htmlFor({ ...iconItem, global_percent: 4, global_percent_known: true }).includes('is-rare-glow'),
  'Confirmed rare earned achievements retain their icon glow');
assert(!htmlFor({ ...iconItem, earned: false, global_percent: 4, global_percent_known: true }).includes('is-rare-glow'),
  'A confirmed rare locked achievement retains its locked presentation');

// The shipped Desktop wrappers were unreachable and advertised incorrect props.
// Removing the dead edge preserves the HTML renderer and stops resolver prewarm.
const sidebar = fs.readFileSync('frontend/features/achievements/sidebar.ts', 'utf8');
const resolver = fs.readFileSync('frontend/steam/modules/SteamComponentResolver.ts', 'utf8');
assert(!/mountSingleDesktopNativeAchievement|gdl-la-latest|desktopNativeAchievements/.test(sidebar));
assert(!/DesktopAchievementItem|DesktopAchievementSection|findTopAchievement/.test(resolver));
assert(sidebar.includes('gdl-la-feature') && sidebar.includes('renderLocalAchievementSidebarHtml'));
for (const file of [
  'frontend/features/desktop/achievements/SingleDesktopNativeAchievement.tsx',
  'frontend/features/desktop/achievements/DesktopNativeAchievementSection.tsx',
  'frontend/steam/desktop/adapters/SteamDesktopAchievementAdapter.ts',
]) assert(!fs.existsSync(file), `An unused wrapper with an unverified native contract must not ship: ${file}`);
const rareStyle = fs.readFileSync('frontend/features/achievements/styles/rare.ts', 'utf8');
assert.deepEqual([...rareStyle.matchAll(/@keyframes\s+([^\s{]+)/g)].map(match => match[1]), ['gdl-rare-rotate'],
  'Plugin animations cannot redefine a Steam-global keyframe');
console.log('Achievement visual isolation passed: late fallback recovery, bounded scans, document/runtime replacement, reset, unknown rarity and removed dead Desktop bridge.');
