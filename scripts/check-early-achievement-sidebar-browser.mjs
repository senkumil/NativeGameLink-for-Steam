// Real DOM/rendering/cache/ownership checks, isolated from the user's Steam UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.ACHIEVEMENT_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const runtime = process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { chromium } = await import(pathToFileURL(runtime).href);
const files = {
  early: 'frontend/features/library/early-achievement-sidebar.ts', sections: 'frontend/features/library/sidebar-sections.ts',
  navigation: 'frontend/features/achievements/navigation.ts', cache: 'frontend/features/achievements/cache.ts',
  sidebar: 'frontend/features/achievements/sidebar.ts', layout: 'frontend/features/library/layout.ts',
  chrome: 'frontend/features/library/achievement-chrome.ts',
  order: 'frontend/features/library/sidebar-order.ts',
  'native-dom': 'frontend/steam/native-dom.ts',
  style: 'frontend/features/achievements/styles/sidebar.ts', inject: 'frontend/features/achievements/styles/inject.ts',
  rare: 'frontend/features/achievements/styles/rare.ts', mask: 'frontend/features/achievements/styles/mask.ts',
  rarity: 'frontend/features/achievements/rarity.ts', format: 'frontend/features/achievements/format.ts', text: 'frontend/core/text.ts',
};
const sources = Object.fromEntries(Object.entries(files).map(([key, filename]) => [key, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
async function checks(sources) {
  const results = [], modules = {}, A = '3000000001', B = '3000000002', STEAM = '1790600';
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const near = (actual, expected, message) => check(Math.abs(actual - expected) < .15, `${message}: ${actual}/${expected}`);
  const pause = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve)); };
  const maps = { [A]: STEAM, [B]: STEAM };
  let routed = Number(A), epoch = 1, knownTotal = 50, modalOpens = 0, steamOpens = 0, playbarWrites = 0, warmResult = null;
  const warmRequests = [];
  const header = document.getElementById('native-header'), anchor = document.getElementById('native-notes');
  const column = document.getElementById('sidebar'), notice = document.getElementById('native-notice');
  const layout = { anchorRegion: anchor, sidebarColumn: column, twoColumnRow: null, contentColumn: null, noticeParent: notice.parentElement };
  const localization = { steamLanguageSync: () => 'spanish', steamIntlLocale: () => 'es-419', loc: (key, fallback) => key === 'AppDetails_SectionTitle_Achievements' ? 'Logros' : fallback,
    gdlText: (key, fallback, values = {}) => ({ achievement_path_loading: 'Cargando…', locked_achievements: 'Logros bloqueados', view_all_achievements: 'Ver todos mis logros', achievements_unlocked: 'Has desbloqueado {unlocked}/{total}' }[key] || fallback).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)) };
  const nativeHeader = { containsNativeLibraryHeader: element => element === header || element.contains(header), isInsideNativeLibraryHeader: element => header.contains(element), findNativeLibraryHeader: () => header,
    getNativeLibraryArtworkSelectors: () => ({ header: '#native-header', loaded: '.loaded', hero: '.hero', logo: '.logo' }) };
  const nativeDetails = { committedHeaderAppId: element => { const value = element.closest('[data-native-appid]')?.dataset.nativeAppid; return value ? Number(value) : null; }, isPaintedLibraryElement: (_doc, element) => element.isConnected && getComputedStyle(element).opacity !== '0', paintedNativePlaybar: () => null };
  const dependencies = {
    '../../api/backend': { backendLog() {} }, '../../steam/localization': localization,
    '../../steam/css': { resolveClassModule: (_predicate, fallback) => ({ classes: fallback }) },
    '../../steam/library-details': nativeDetails, '../../steam/library-header': nativeHeader,
    '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility() {} },
    '../../core/game-data': { getSynchronousGameData: () => ({ name: 'Fixture', achievements: knownTotal > 0 ? { total: knownTotal } : undefined }) },
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => maps[id] || null }, '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../library/native-route': { routedSteamAppId: () => routed },
    '../../steam/navigation': { openSteamNavigationUrl() { steamOpens++; } },
    './playbar': { ensureLocalPlaybarStat() { playbarWrites++; } }, '../achievements/playbar': { ensureLocalPlaybarStat() { playbarWrites++; } }, './modal': { openLocalAchievementsModal: async () => { modalOpens++; } },
    '../achievements/progress': { getAchievementProgress: async () => null }, '../achievements/service': { fetchLocalAchievementData: async (id, options) => { warmRequests.push({ id, options }); return warmResult; } },
    '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: (_doc, _key, task) => Promise.resolve(task()) },
    './steam-rare': { getSteamRareAchievementClasses: () => ({ wrapper: '', icon: '', iconGlow: '' }), renderSteamRareGlowHtml: () => '' },
    './historical-sidebar': { buildHistoricalSidebarSections: () => [] }, './social': { friendDataSignature: () => 'fixture', renderFriendsSection: () => '' },
	'./controller': { syncControllerSidebarSection: () => null },
    './render-session': { isCurrentLinkedRenderDestination: (_doc, shortcut, steam) => Number(shortcut) === routed && maps[shortcut] === steam },
  };
  const aliases = { '../../core/text': 'text', './cache': 'cache', '../achievements/cache': 'cache', './format': 'format', './rarity': 'rarity', './inject': 'inject', './rare': 'rare', './mask': 'mask',
    '../achievements/navigation': 'navigation', '../achievements/sidebar': 'sidebar', '../achievements/styles/sidebar': 'style', './early-achievement-sidebar': 'early', './sidebar-order': 'order', '../../steam/native-dom': 'native-dom' };
  function load(name) {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      if (dependency === './css') return dependencies['../../steam/css'];
      if (dependency === './localization') return localization;
      if (dependency in aliases) return load(aliases[dependency]);
      if (dependency === './layout') return { ...load('layout'), discoverNativeLibraryLayout: () => layout };
      if (dependency === '../achievements/runtime') return { ...load('cache'), ...load('sidebar'), ...load('navigation'), ...load('style'), ensureAchievementModalStyles() {}, openLocalAchievementsModal: dependencies['./modal'].openLocalAchievementsModal };
      throw new Error(`Unexpected ${name} dependency: ${dependency}`);
    }, exports);
    return exports;
  }
  const cache = load('cache'), early = load('early'), sidebar = load('sidebar'), nav = load('navigation'), sections = load('sections'), chrome = load('chrome');
  cache.clearLocalAchievementCache();
  const art = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="gray"/></svg>';
  const data = (shortcut, unlocked = 29, total = 50) => ({ found: true, appid: STEAM, metadata_appid: STEAM, state_appid: shortcut, path: `C:/Fixture/${shortcut}/achievements.json`, root: `C:/Fixture/${shortcut}`, total, unlocked,
    achievements: Array.from({ length: total }, (_, i) => ({ name: `ACH_${i}`, display_name: `Logro ${shortcut} ${i}`, description: `Descripción ${i}`, icon: art, icon_gray: art, earned: i < unlocked, earned_time: 1000 - i, global_percent: 60, progress: 0, max_progress: 0 })) });
  const invoke = (shortcut = A, steam = STEAM) => { const capturedEpoch = epoch; early.syncEarlyAchievementSidebar(document, notice, steam, shortcut, capturedEpoch, () => epoch === capturedEpoch); };
  const own = (shortcut = A, steam = STEAM) => early.getOwnedAchievementSidebar(document, steam, shortcut);
  const reset = () => { document.getElementById('gdl-achievements-section')?.remove(); document.getElementById('gdl-library-injected')?.remove(); };
  const nativeMarkup = [header.outerHTML, anchor.outerHTML, notice.outerHTML];
  const nativeMutations = []; const observer = new MutationObserver(records => nativeMutations.push(...records));
  for (const node of [header, anchor, notice]) observer.observe(node, { attributes: true, subtree: true, childList: true, characterData: true });
  try {
    cache.cacheLocalAchievements(data(A), STEAM, A); await chrome.warmLocalAchievements(STEAM, A);
    check(warmRequests.length === 0, 'An exact confirmed shortcut snapshot needs no extra warmup IPC');
    warmResult = data(B, 2); await chrome.warmLocalAchievements(STEAM, B);
    check(warmRequests.length === 1 && warmRequests[0].options.stateAppId === B, 'A shared Steam alias cannot skip another installation’s progress read');
    check(cache.getCachedLocalAchievementsForShortcut(STEAM, B)?.unlocked === 2 && cache.getCachedLocalAchievementsForShortcut(STEAM, A)?.unlocked === 29, 'Warmup preserves distinct cached progress for sibling shortcuts');
    warmResult = { ...data('3000000003'), appid: '999', metadata_appid: '999' }; await chrome.warmLocalAchievements(STEAM, '3000000003');
    check(!cache.getCachedLocalAchievementsForShortcut(STEAM, '3000000003'), 'A mismatched backend AppID cannot be aliased as this installation’s progress');
    cache.cacheLocalAchievements(data(A), STEAM, A); knownTotal = 0;
    invoke();
    let section = own(); check(Boolean(section), 'Confirmed snapshot mounts synchronously before main-column layout or Store metadata');
    check(!layout.contentColumn && !layout.twoColumnRow && !document.getElementById('gdl-library-injected'), 'Early mount needs no main activity root or complete columns');
    check(section.textContent.includes('29/50') && section.textContent.includes(`Logro ${A}`), 'The real cached count, names and descriptions are immediately present');
    check(nav.ownsAchievementSidebar(document, { steamAppId: STEAM, shortcutAppId: A }), 'Exact early section is owned before metadata root exists');
    const content = section.querySelector('#gdl-achievements-content'), summary = content.querySelector('.gdl-la-summary');
    invoke(); check(own() === section && content.querySelector('.gdl-la-summary') === summary, 'Repeated early synchronization preserves section, content and summary identity');
    await pause();
    near(summary.querySelector('.gdl-la-icon-frame').getBoundingClientRect().height, 48, 'Cached panel retains native achievement icon height');
    summary.querySelector('.gdl-la-view').click(); await Promise.resolve(); check(modalOpens === 1 && steamOpens === 0, 'Confirmed early body opens the real achievement modal');
    const main = document.createElement('div'); main.id = 'gdl-library-injected'; main.dataset.gdlSteamAppId = STEAM; main.dataset.gdlShortcutAppId = A; document.body.append(main);
    const moves = []; const preserveObserver = new MutationObserver(records => moves.push(...records)); preserveObserver.observe(column, { childList: true });
    sections.renderLinkedSidebarCore(document, layout, { steamAppId: STEAM, shortcutAppId: A, data: { name: 'Fixture' }, friendResult: null });
    await Promise.resolve(); preserveObserver.disconnect();
    check(document.getElementById('gdl-achievements-section') === section && section.querySelector('#gdl-achievements-content') === content && content.querySelector('.gdl-la-summary') === summary, 'Full renderer adopts the same confirmed DOM even when Store achievement total is absent');
    check(!moves.some(record => [...record.removedNodes].includes(section)), 'Adoption does not detach or remount the existing section');
    epoch++; check(nav.ownsAchievementSidebar(document, { steamAppId: STEAM, shortcutAppId: A }), 'After adoption, current metadata root owns the section independently of the retired early callback');
    routed = 1790600; check(!own(), 'A stale full root on a native destination cannot preserve the previous linked sidebar'); routed = Number(A);
    reset(); cache.clearLocalAchievementCache(); knownTotal = 50; invoke(); section = own();
    check(Boolean(section) && section.dataset.gdlAchievementsPending === '1', 'Cold local state gets a neutral section when a total is known');
    const pending = section.querySelector('.gdl-la-summary');
    check(pending.textContent.includes('Cargando') && !/0\s*\/\s*50|\d+%|Logros bloqueados/.test(pending.textContent), 'Pending box invents no unlock count, percentage or locked state');
    check(!pending.querySelector('img') && !pending.querySelector('.gdl-la-progress-fill'), 'Pending box issues no image request and asserts no zero-valued progress fill');
    await pause();
    near(pending.querySelector('.gdl-la-icon-row').getBoundingClientRect().height, 48, 'Pending row reserves native icon geometry');
    near(pending.querySelector('.gdl-la-progress-track').getBoundingClientRect().height, 8, 'Pending header keeps the native progress-track height');
    near(parseFloat(getComputedStyle(pending.querySelector('.gdl-la-body')).paddingTop), 16, 'Pending body keeps native top padding');
    const pendingHeight = pending.getBoundingClientRect().height, stableContent = section.querySelector('#gdl-achievements-content');
    invoke(); check(own() === section && stableContent.querySelector('.gdl-la-summary') === pending, 'Repeated pending sync preserves geometry and creates no duplicate box');
    sidebar.revealPendingAchievementSidebar(document);
    check(!pending.textContent.includes('Cargando') && !/0\s*\/\s*50|\d+%/.test(pending.textContent) && pending.getAttribute('aria-busy') === 'false', 'An unavailable local result ends loading truthfully without an invented zero');
    check(section.querySelector('.gdl-la-summary') === pending, 'Terminal unavailable state does not remount the neutral panel');
    cache.cacheLocalAchievements(data(A, 0), STEAM, A); invoke();
    check(own() === section && section.querySelector('#gdl-achievements-content') === stableContent && !section.hasAttribute('data-gdl-achievements-pending'), 'Confirmed progress replaces neutral content without remounting section/content');
    await pause(); near(stableContent.querySelector('.gdl-la-summary').getBoundingClientRect().height, pendingHeight, 'Neutral geometry exactly matches the native zero-earned panel');
    check(section.textContent.includes('0/50') && !section.textContent.includes('Cargando'), 'Confirmed zero is displayed only after local data exists');
    check(nativeMutations.length === 0 && observer.takeRecords().length === 0, 'Early staging, confirmation and adoption never write native header, Notes or notice nodes');
    const oldSection = section; epoch++; routed = Number(B);
    check(!own() && !nav.ownsAchievementSidebar(document, { steamAppId: STEAM, shortcutAppId: A }), 'A different route immediately revokes old standalone ownership');
    invoke(B); check(document.getElementById('gdl-achievements-section') === oldSection, 'A new route cannot paint in the previous game’s still-committed header');
    header.dataset.nativeAppid = B; anchor.dataset.nativeAppid = B; cache.cacheLocalAchievements(data(B, 2), STEAM, B); invoke(B);
    const b = own(B); check(b && b !== oldSection && b.textContent.includes('2/50') && !b.textContent.includes(`Logro ${A}`), 'Sibling shortcuts sharing a Steam AppID retain their own local progress');
    header.dataset.nativeAppid = A; check(!own(B), 'Changing committed header identity revokes early ownership even while URL remains unchanged');
    header.dataset.nativeAppid = B; epoch++; check(!own(B), 'A superseded generation cannot preserve its section');
    reset(); routed = 1790600; invoke(B); check(!document.getElementById('gdl-achievements-section'), 'Native Steam routes are never injected');
    routed = Number(A); header.dataset.nativeAppid = A; anchor.dataset.nativeAppid = A; knownTotal = 0; cache.clearLocalAchievementCache(); invoke();
    check(!document.getElementById('gdl-achievements-section'), 'Unknown total with no confirmed snapshot creates no fabricated panel');
    knownTotal = 50; anchor.dataset.nativeAppid = B; invoke(); check(!document.getElementById('gdl-achievements-section'), 'A previous game’s Notes anchor cannot authorize early placement');
    anchor.dataset.nativeAppid = A; maps[A] = '999'; invoke(); check(!document.getElementById('gdl-achievements-section'), 'A relinked shortcut cannot reuse another metadata AppID’s snapshot');
    maps[A] = STEAM; invoke(); check(Boolean(own()), 'A verified current mapping can stage neutral state again');
    reset(); cache.cacheLocalAchievements(data(A, 29), STEAM, A); invoke();
    observer.takeRecords(); nativeMutations.length = 0;
    check(playbarWrites > 0, 'Real local snapshots continue updating the playbar');
    check(!/\bawait\b|new\s+Image|\bfetch\s*\(|\.decode\s*\(/.test(sources.early), 'Early staging has no awaited Store request or image preload/decode');
    check([header.outerHTML, anchor.outerHTML, notice.outerHTML].every((value, i) => value === nativeMarkup[i]), 'Native header, Notes and shortcut notice retain their original markup');
    return { ok: true, results, pendingHeight };
  } catch (error) { return { ok: false, results, error: String(error.stack || error) }; }
  finally { observer.disconnect(); }
}
const scratch = fs.mkdtempSync(path.join(root, 'scratch/early-achievement-sidebar-'));
const fixture = path.join(scratch, 'fixture.html'), screenshot = path.join(scratch, 'sidebar.png');
fs.writeFileSync(fixture, `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>body{margin:24px;background:#232b35;color:#c8ccd0;font-family:Arial,sans-serif}#native-header{height:150px;background:#344356;margin-bottom:24px}#sidebar{width:356px}.native-heading{font-size:14px;font-weight:400;line-height:20px;text-transform:uppercase;letter-spacing:.7px;margin:0 0 8px}.native-shell{margin:0 0 18px}#native-notice{display:none}</style></head><body><div id="native-header" data-native-appid="3000000001">Steam hero and logo</div><div id="sidebar"><div class="native-shell"><div id="native-notes" data-native-appid="3000000001" role="region"><h2 class="native-heading">Notes</h2><div><div>Native notes content</div></div></div></div></div><div id="native-notice">Native shortcut explanation</div></body></html>`);
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ['--allow-file-access-from-files', '--disable-background-networking', '--no-first-run'] });
let report;
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 720 }, deviceScaleFactor: 1.25 });
  await page.goto(pathToFileURL(fixture).href); report = await page.evaluate(checks, sources); await page.screenshot({ path: screenshot, fullPage: true });
} finally { await browser.close(); }
assert(report.ok, `${report.error}\nPassed: ${report.results.join('; ')}\nFixture: ${fixture}`);
console.log(`Early achievement sidebar browser: ${report.results.length} checks passed (real cached data, independent partial layout, ownership, native geometry, neutral cold state and same-node adoption).`);
console.log(`Screenshot: ${screenshot}`);
