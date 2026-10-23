import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert(fs.existsSync(edge), `Edge executable missing: ${edge}`);
const sourceFiles = {
  'pure-class-factory': 'frontend/steam/gamepad/components/pure-class-factory.ts', 'class-module-cache': 'frontend/steam/class-module-cache.ts',
  css: 'frontend/steam/css.ts', 'native-dom': 'frontend/steam/native-dom.ts',
  'pure-class-factory': 'frontend/steam/gamepad/components/pure-class-factory.ts', 'class-module-cache': 'frontend/steam/class-module-cache.ts', SteamWebpackRuntime: 'frontend/steam/modules/SteamWebpackRuntime.ts',
  'library-details': 'frontend/steam/library-details.ts', 'playbar-visibility': 'frontend/steam/playbar-visibility.ts',
  'achievement-playbar-space': 'frontend/steam/achievement-playbar-space.ts',
  'native-route': 'frontend/features/library/native-route.ts', navigation: 'frontend/features/achievements/navigation.ts',
  playbar: 'frontend/features/achievements/playbar.ts', format: 'frontend/features/achievements/format.ts',
  lifecycle: 'frontend/features/achievements/lifecycle.ts', cache: 'frontend/features/achievements/cache.ts',
  dom: 'frontend/core/dom.ts',
  progress: 'frontend/features/achievements/progress.ts', service: 'frontend/features/achievements/service.ts',
  'native-schema': 'frontend/features/achievements/native-schema.ts',
  'achievement-chrome': 'frontend/features/library/achievement-chrome.ts',
};
const sources = Object.fromEntries(Object.entries(sourceFiles).map(([name, filename]) => [name,
  ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText]));

async function browserChecks(sources) {
  const results = [], modules = {}, requests = [], sidebar = [], opened = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const a = 3000000001, b = 3000000002, sibling = 3000000003;
  let routePath = '/library/app/123', verified = true;
  const mapping = { [`shortcut:${a}`]: '111', [`shortcut:${b}`]: '111', [`shortcut:${sibling}`]: '222' };
  const committed = id => verified ? mapping[`shortcut:${Number(id) >>> 0}`] || null : null;
  window.uiStore = { GetActiveWindowInstance: () => ({ LocationPathName: routePath }) };
  const native111 = { total: 99, unlocked: 7, native: true }, native222 = { total: 88, unlocked: 8, native: true };
  const originalSibling = { total: 77, unlocked: 9, sibling: true };
  let nativeCacheWrites = 0;
  class NativeCacheMap extends Map {
    set(key, value) { nativeCacheWrites++; return super.set(key, value); }
    delete(key) { nativeCacheWrites++; return super.delete(key); }
    clear() { nativeCacheWrites++; return super.clear(); }
  }
  const mapCache = new NativeCacheMap([[111, native111], [222, native222], [sibling, originalSibling]]);
  nativeCacheWrites = 0;
  window.appAchievementProgressCache = { m_achievementProgress: { mapCache }, QueueCacheUpdate() { nativeCacheWrites++; } };
  const localization = { steamLanguageSync: () => 'english', gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback };
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    './localization': localization, '../../steam/localization': localization,
    '../../api/backend': { backendLog() {}, fetchLocalAchievementsBackend({ request_json }) {
      let resolve; const promise = new Promise(done => { resolve = done; });
      requests.push({ request: JSON.parse(request_json), resolve }); return promise;
    } },
    '../../core/mappings': { isMappingSnapshotVerified: () => verified, mappings: mapping, shortcutMappingKey: id => `shortcut:${Number(id) >>> 0}` },
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: committed, findMappingForShortcut: committed },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../../steam/navigation': { openSteamNavigationUrl() {} },
    '../../steam/shortcuts': { toSignedShortcutAppId: id => id > 2147483647 ? id - 4294967296 : id },
    '../../core/text': { escapeHtml: value => String(value) },
    '../../core/preferences': { getPreferences: () => ({}), simulatedAchievementsEnabled: () => false },
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
    '../../steam/sidebar-interaction': { findLibrarySidebarDocument: () => document, runWhenLibrarySidebarIdle: (_doc, _key, task) => Promise.resolve(task()), cancelLibrarySidebarWork() {} },
    './constants': { GDL_INJECTED: 'gdl-library-injected' }, './notice': { findNonSteamNotice: () => null },
    './modal': { openLocalAchievementsModal: async (_doc, data) => { opened.push(data); }, disposeLocalAchievementsModal() {}, disposeAllLocalAchievementsModals() {} },
    './sidebar': { renderLocalAchievementSidebar: (_doc, data) => sidebar.push(data), revealPendingAchievementSidebar() {} },
    '../achievements/sidebar': { renderLocalAchievementSidebar: (_doc, data) => sidebar.push(data), revealPendingAchievementSidebar() {} },
    './styles': { ensureLocalAchievementStyles() {} }, './notifications': {}, './game-info': {}, './context': {},
    './cloud-status': { ensureCloudStatus() {} },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected ${name} dependency: ${dependency}`);
    }, exports); return exports;
  };
  const css = load('css').PLAYBAR_CLASSES(), native = load('native-dom'), cache = load('cache');
  const playbar = load('playbar'), lifecycle = load('lifecycle'), service = load('service'), progress = load('progress');
  const chrome = load('achievement-chrome');
  cache.clearLocalAchievementCache();
  const putFiber = (element, appid) => {
    const state = {};
    const previousRoot = { tag: 3, stateNode: state, return: null };
    const currentRoot = { tag: 3, stateNode: state, return: null, alternate: previousRoot };
    previousRoot.alternate = currentRoot; state.current = currentRoot;
    const previousOwner = { tag: 0, memoizedProps: { overview: { appid } }, return: previousRoot };
    const currentOwner = { tag: 0, memoizedProps: { overview: { appid } }, return: currentRoot, alternate: previousOwner };
    previousOwner.alternate = currentOwner;
    const host = { tag: 5, flags: 0, alternate: null, memoizedProps: { className: element.className }, return: previousOwner };
    previousRoot.child = previousOwner; currentRoot.child = currentOwner;
    previousOwner.child = currentOwner.child = host;
    element.__reactFiber$fixture = host;
  };
  const host = appid => {
    const bar = document.createElement('div'); bar.className = css.Container; bar.style.cssText = 'display:flex;width:1000px;height:100px';
    const stats = document.createElement('div'); stats.className = css.GameStatsSection; stats.style.cssText = 'display:flex;width:900px;height:80px';
    const copy = document.createElement('div'); copy.className = css.HideWhenNarrow; copy.textContent = 'Native Steam copy'; copy.style.setProperty('display', 'none', 'important');
    stats.append(copy); bar.append(stats); document.getElementById('fixture').append(bar);
    putFiber(bar, appid); putFiber(stats, appid); return { bar, stats, copy };
  };
  const data = (shortcut, steam = '111', unlocked = 1) => ({ found: true, appid: steam, metadata_appid: steam,
    state_appid: String(shortcut), total: 4, unlocked, achievements: [] });
  const first = host(123), nativeMarkup = first.copy.outerHTML;
  const beforeNative = document.getElementById('fixture').innerHTML;
  check(playbar.ensureLocalPlaybarStat(document, data(a)) === null && document.getElementById('fixture').innerHTML === beforeNative,
    'A public Steam route is rejected before any achievement DOM or style write');
  routePath = `/library/app/${b}`;
  check(playbar.ensureLocalPlaybarStat(document, data(b)) === null && document.getElementById('fixture').innerHTML === beforeNative,
    'A shortcut URL ahead of the native React commit cannot inject into the old native game header');
  putFiber(first.bar, b); putFiber(first.stats, b);
  const stat = playbar.ensureLocalPlaybarStat(document, data(b)), inner = stat?.firstElementChild;
  check(stat?.parentElement === first.stats && stat.dataset.gdlShortcutAppId === String(b) && stat.dataset.gdlSteamAppId === '111',
    'A matching committed native shortcut host receives exactly its mapped achievement stat');
  check(first.copy.outerHTML === nativeMarkup, 'Linked visibility fixes never modify native Steam stat copy');
  const mutations = [];
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(document.getElementById('fixture'), { childList: true, subtree: true, attributes: true, characterData: true });
  for (let index = 0; index < 100; index++) check(playbar.ensureLocalPlaybarStat(document, data(b)) === stat, 'Stable achievement wrapper identity');
  await flush();
  check(mutations.length === 0 && observer.takeRecords().length === 0 && stat.firstElementChild === inner,
    '100 identical updates perform zero DOM writes or blueprint replacements');
  observer.disconnect();
  first.bar.style.opacity = '0'; const second = host(b);
  check(playbar.ensureLocalPlaybarStat(document, data(b)) === stat && stat.parentElement === second.stats && stat.firstElementChild === inner,
    'Visibility migration retains the same wrapper and inner stat instead of duplicating sticky headers');
  check(document.querySelectorAll('#gdl-playbar-achievements').length === 1, 'Only one achievement playbar ID exists across native headers');
  const ownedFallback = document.createElement('div'); ownedFallback.className = css.GameStatsSection;
  ownedFallback.dataset.gdlCloudStats = '1'; ownedFallback.style.cssText = 'display:flex;width:900px;height:80px';
  const cloud = document.createElement('div'); cloud.dataset.gdlCloudStatus = '1'; ownedFallback.append(cloud);
  second.stats.remove(); second.bar.append(ownedFallback);
  check(playbar.ensureLocalPlaybarStat(document, data(b)) === stat && stat.parentElement === ownedFallback,
    'An owned Cloud fallback inherits ownership only from its matching painted native playbar');
  const stable = document.getElementById('fixture').innerHTML;
  check(playbar.ensureLocalPlaybarStat(document, data(b, '222')) === null && document.getElementById('fixture').innerHTML === stable,
    'A snapshot for a different linked Steam game cannot repaint the current shortcut');
  routePath = '/library/app/123';
  check(playbar.ensureLocalPlaybarStat(document, data(b)) === null && document.getElementById('fixture').innerHTML === stable,
    'A public URL ahead of DOM replacement immediately blocks old shortcut achievement writes');
  const requestCount = requests.length;
  await chrome.finalizeLinkedAchievements(document, { steamAppId: '111', stateAppId: String(b), fallbackTotal: 4, isCurrent: () => true });
  check(requests.length === requestCount && document.getElementById('fixture').innerHTML === stable,
    'Even a stale always-current finalizer cannot fetch or render on a public Steam route');

  routePath = `/library/app/${a}`; putFiber(second.bar, a);
  const injected = document.createElement('div'); injected.id = 'gdl-library-injected';
  injected.dataset.gdlSteamAppId = '111'; injected.dataset.gdlShortcutAppId = String(a); document.body.append(injected);
  lifecycle.installLocalAchievementUI(document);
  check(requests.length === requestCount + 1 && String(requests.at(-1).request.state_app_id) === String(a),
    'The lifecycle captures the requested shortcut before starting asynchronous achievement IPC');
  routePath = `/library/app/${b}`;
  requests.at(-1).resolve(JSON.stringify(data(a, '111', 3))); await flush();
  check(cache.getCachedLocalAchievementsForShortcut('111', b) === null && sidebar.length === 0,
    'A late response for sibling A sharing the same SteamID cannot be cached or rendered as sibling B');
  service.publishAchievementUpdate({ steamAppId: '111', stateAppId: String(a), data: data(a, '111', 3) });
  check(cache.getCachedLocalAchievementsForShortcut('111', b) === null,
    'A service-bus update for another shortcut cannot seed the current shortcut alias');
  putFiber(second.bar, b);
  for (let index = 0; index < 100; index++) service.publishAchievementUpdate({ steamAppId: '111', stateAppId: String(b), data: data(b) });
  check(cache.getCachedLocalAchievementsForShortcut('111', b)?.unlocked === 1 && stat.parentElement === ownedFallback,
    'Exact current-shortcut updates cache and repaint only their verified destination');
  check(mapCache.get(111) === native111 && mapCache.get(222) === native222 && mapCache.get(sibling) === originalSibling,
    'Repeated local updates leave public Steam cache objects and sibling shortcut progress unchanged');
  check(!('syncNativeAchievementProgressCache' in progress), 'The native global progress writer no longer exists');
  service.publishAchievementUpdate({ steamAppId: '111', stateAppId: '', data: data(b) });
  service.publishAchievementUpdate({ steamAppId: '222', stateAppId: String(b), data: data(b, '222') });
  verified = false;
  service.publishAchievementUpdate({ steamAppId: '111', stateAppId: String(b), data: data(b, '111', 4) });
  check(nativeCacheWrites === 0 && mapCache.size === 3 && mapCache.get(111) === native111
    && mapCache.get(222) === native222 && mapCache.get(sibling) === originalSibling && !mapCache.has(b),
    'All local progress publications, including exact verified targets, leave every Steam-owned cache entry unchanged');
  verified = true;
  const nativeCache = window.appAchievementProgressCache;
  const initializingStore = {};
  window.appAchievementProgressCache = initializingStore;
  service.publishAchievementUpdate({ steamAppId: '111', stateAppId: String(b), data: data(b, '111', 2) });
  check(Object.keys(initializingStore).length === 0,
    'Local progress never initializes or replaces a Steam store that has not hydrated yet');
  window.appAchievementProgressCache = nativeCache;
  check(playbar.ensureLocalPlaybarStat(document, data(b, '111', 2)) === stat && stat.firstElementChild === inner,
    'A real progress change updates the existing stat without recreating its medal or event handler');
  stat.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush();
  check(opened.at(-1)?.unlocked === 2, 'The stable click handler opens the current data instead of a captured older snapshot');
  const achievementClasses = load('css').ACH_CLASSES();
  const blueprint = document.createElement('div'); blueprint.className = `${css.GameStat} ${css.MiniAchievements}`;
  blueprint.innerHTML = `<div class="${css.GameStatIcon}"></div><div class="${css.HideWhenNarrow}"><div class="${css.PlayBarLabel}">Achievements</div><span class="${css.AchievementCountLabel}">0/4</span><div class="${achievementClasses.AchievementProgress}" style="width:0%"></div></div>`;
  native.saveNativeUiBlueprint(native.NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements, blueprint);
  check(playbar.ensureLocalPlaybarStat(document, data(b, '111', 2)) === stat,
    'Capturing a later native blueprint never replaces a fallback stat that is already mounted');
  const iframe = document.createElement('iframe'); iframe.style.cssText = 'width:1100px;height:150px'; document.body.append(iframe);
  const childDoc = iframe.contentDocument; iframe.contentWindow.uiStore = window.uiStore;
  const childBar = childDoc.createElement('div'); childBar.className = css.Container; childBar.style.cssText = 'display:flex;width:1000px;height:100px';
  const childStats = childDoc.createElement('div'); childStats.className = css.GameStatsSection; childStats.style.cssText = 'display:flex;width:900px;height:80px';
  childDoc.body.append(childBar); childBar.append(childStats); putFiber(childBar, b); putFiber(childStats, b);
  const nativeStat = playbar.ensureLocalPlaybarStat(childDoc, data(b)), nativeInner = nativeStat?.firstElementChild;
  check(nativeStat?.dataset.gdlNativeBlueprint === '1', 'A new document can use the captured native blueprint without borrowing the first document stat');
  playbar.ensureLocalPlaybarStat(childDoc, data(b, '111', 2));
  check(nativeStat.firstElementChild === nativeInner && nativeStat.querySelector('.gdl-lp-count').textContent === '2/4'
    && nativeStat.querySelector('.gdl-lp-fill').style.width === '50%',
    'Native blueprint counts and alternate native progress classes update in place');
  lifecycle.disposeLocalAchievementUI(document);
  const output = document.createElement('pre'); output.id = 'achievement-routing-result';
  output.textContent = JSON.stringify({ ok: true, checks: results.length, results }); document.body.append(output);
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'achievement-routing-'));
const htmlPath = path.join(scratch, 'fixture.html');
const serialize = value => JSON.stringify(value).replace(/</g, '\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#171d25;color:#ddd;font:14px Arial}pre{white-space:pre-wrap}#fixture{width:1050px}</style></head><body><div id="fixture"></div><script>(${browserChecks.toString()})(${serialize(sources)}).catch(error=>{const output=document.createElement('pre');output.id='achievement-routing-result';output.textContent=JSON.stringify({ok:false,results:[],error:String(error.stack||error)});document.body.append(output)});document.currentScript.remove();</script></body></html>`);
const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.USERPROFILE || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({ executablePath: edge, headless: true,
  args: ['--disable-background-networking', '--no-first-run', '--allow-file-access-from-files'] });
let report;
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('#achievement-routing-result').waitFor({ timeout: 10000 });
  report = JSON.parse(await page.locator('#achievement-routing-result').textContent());
} finally { await browser.close(); }
assert(report.ok, `${report.error}\nFixture: ${htmlPath}`);
console.log(`Achievement routing passed: ${report.checks} checks; actual DOM and route ownership, zero writes on 100 stable updates, same-SteamID races, stable migration/click state and public native-cache preservation.`);
