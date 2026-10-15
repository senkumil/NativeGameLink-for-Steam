import './helpers/installed-steam-check.mjs';
// Scoped native ownership coverage: real app callbacks, early playbar and
// route-exit cleanup with installed Steam CSS. Achievement polling, Info/link
// coordinators and the full library runtime are stubs; Steam React is not run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || [
  'C:/Program Files (x86)/Steam/steamui/css/sp.css',
  'C:/Program Files (x86)/Steam/steamui/css/chunk~2dcc5aaf7.css',
].find(filename => fs.existsSync(filename));
assert.ok(fs.existsSync(edge) && (steamCss && fs.existsSync(steamCss)), 'Installed Edge and Steam CSS are required');
const appText = fs.readFileSync(path.join(root, 'frontend/runtime/app.tsx'), 'utf8');
const appAst = ts.createSourceFile('app.tsx', appText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appImports = appAst.statements.filter(ts.isImportDeclaration).map(statement => statement.moduleSpecifier.text);
assert.ok(!appImports.some(name => /native-info-preference/.test(name)),
  'Native preference toggles must not load in the app lifecycle');
assert.ok(appText.includes('mainWindowDoc = popupDoc; lifecycle.add(installLegacyAchievementCacheRepair(popupDoc));'),
  'Exact legacy cache sentinel repair must belong to the validated desktop document lifecycle');
assert.ok(!/reconcileNativeInfoPreference|repairLegacyNativeAchievementCaches/.test(appText),
  'App startup and route callbacks must not invoke native preference/cache mutations');
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
} }).outputText;
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['SteamWebpackRuntime', 'frontend/steam/modules/SteamWebpackRuntime.ts'],
  ['achievement-cache-repair', 'frontend/steam/achievement-cache-repair.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['disposables', 'frontend/core/disposables.ts'],
  ['dom', 'frontend/core/dom.ts'],
  ['text', 'frontend/core/text.ts'],
  ['native-route', 'frontend/features/library/native-route.ts'],
  ['notice', 'frontend/features/library/notice.ts'],
  ['early-notice', 'frontend/features/library/early-notice.ts'],
  ['early-playbar', 'frontend/features/library/early-playbar.ts'],
  ['cloud-status', 'frontend/features/library/cloud-status.ts'],
  ['playbar-visibility', 'frontend/steam/playbar-visibility.ts'],
  ['playbar-achievement-cleanup', 'frontend/features/library/playbar-achievement-cleanup.ts'],
  ['route-exit', 'frontend/features/library/route-exit.ts'],
].map(([name, file]) => [name, transpile(fs.readFileSync(path.join(root, file), 'utf8'))]));
const hooks = '\nappRuntimeLifecycle = new DisposableRegistry();\nexport { windowCreated as __windowCreated, disposeDocumentLifecycles as __dispose };\n';
sources.app = transpile(appText + hooks);
// Keep an executable negative control from the previously shipped helper. Only
// its native branch call is reintroduced; all other app code stays identical.
const legacyHelper = fs.readFileSync(path.join(root, 'scripts/fixtures/native-info-preference-legacy.ts'), 'utf8');
assert.match(legacyHelper, /former app callback used reconcileNativeInfoPreference\(popupDoc\)/,
  'The frozen negative control must identify the former native app callback');
sources['legacy-preference'] = transpile(legacyHelper);
const mainBranch = appText.indexOf('if (isMainWindow) {', appText.indexOf('const runInjection ='));
const publicBranch = appText.indexOf('if (isPublicSteamLibraryRoute(popupDoc)) {', mainBranch);
assert.ok(publicBranch > mainBranch, 'The real desktop public-route guard was not found');
const insert = publicBranch + 'if (isPublicSteamLibraryRoute(popupDoc)) {'.length;
sources['legacy-app'] = transpile(
  "import { reconcileNativeInfoPreference } from './legacy-preference';\n"
  + appText.slice(0, insert) + '\nreconcileNativeInfoPreference(popupDoc);' + appText.slice(insert) + hooks);

async function browserChecks(sources) {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
  const noop = () => {};
  const asyncNoop = async () => {};
  let clicks = 0, queueUpdates = 0, retirementCalls = 0, shortcutCalls = 0;
  let arrival = null;
  const nativeWindow = { LocationPathName: '/library/app/1030300' };
  window.uiStore = { GetActiveWindowInstance: () => nativeWindow, currentGameListSelection: { nAppId: 1030300 } };
  const nativeCacheWrites = [];
  class ObservedNativeProgressMap extends Map {
    set(key, value) { nativeCacheWrites.push(['set', key]); return super.set(key, value); }
    delete(key) { nativeCacheWrites.push(['delete', key]); return super.delete(key); }
    clear() { nativeCacheWrites.push(['clear']); return super.clear(); }
  }
  const mapCache = new ObservedNativeProgressMap();
  window.appAchievementProgressCache = { QueueCacheUpdate() { queueUpdates++; }, m_achievementProgress: { mapCache } };
  const modules = {};
  const localization = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback,
    steamLanguageSync: () => 'english', setLocalizationDocumentProvider: noop };
  const emptyService = new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : noop });
  const dependencies = {
    react: { default: {} },
    '@steambrew/client': { findClassModule: () => null, definePlugin: factory => ({ factory }) },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    '../../core/mappings': { findMappingForTitle: () => null, subscribeMappings: () => noop },
    '../core/mappings': { mappings: {}, loadMappings: asyncNoop },
    '../../steam/localization': localization, './localization': localization, '../steam/localization': localization,
    '../shortcuts/registry': { findMappingForShortcut: () => null, getCommittedShortcutSteamAppId: () => null },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    './constants': { GDL_INJECTED: 'gdl-library-injected' },
    './layout': { hideNativeLibraryElement() { throw new Error('Native elements must never be hidden by the shortcut notice helper'); } },
    '../features/library/constants': { GDL_INJECTED: 'gdl-library-injected' },
    './styles': { ensureNativeGameInfoStyles: noop },
    '../playtime/tracker': {
      removePlaytimeFallbackStats(doc) { doc.querySelectorAll('[data-gdl-playtime="1"]').forEach(node => node.remove()); },
      syncEarlyLinkedPlaytime() { shortcutCalls++; },
    },
    '../achievements/cache': { getCachedLocalAchievementsForShortcut: () => arrival },
    '../achievements/playbar': { ensureLocalPlaybarStat() { shortcutCalls++; } },
    './native-artwork-warmup': { warmNativeShortcutArtwork() { shortcutCalls++; } },
    './primary-links': { findNativePlaybar: doc => doc.getElementById('fixture-playbar') },
    './early-primary-links': { syncEarlyLinkedPrimaryLinks: noop, disposeLinkedPrimaryLinks: noop },
    './early-game-info': { syncEarlyLinkedGameInfo: noop, disposeEarlyLinkedGameInfo: noop },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
    '../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records },
    '../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    '../features/big-picture/runtime': { isBigPictureActive: () => false, getBigPictureDocument: () => null },
    './existing-windows': {
      resolveSteamWindowContext: () => ({ popupWin: window, popupDoc: document, popupName: 'SP Desktop', popupTitle: 'Steam' }),
      isDesktopSteamWindow: () => true,
    },
    '../features/library/native-artwork-warmup': { installNativeArtworkWarmup: () => noop },
    '../steam/sidebar-interaction': { installLibrarySidebarInteraction: () => noop },
    '../steam/browser-protection': { installBrowserProtection: () => noop },
    '../features/playtime/library-home': {
      isDesktopLibraryHomePlaytimeVisible: () => false, syncDesktopLibraryHomePlaytimeDom: noop,
      patchDesktopLibraryHomePlaytime: asyncNoop,
    },
    '../features/shortcuts/link-job-queue': { processPendingLinkJobs: asyncNoop },
    '../features/achievements/runtime': emptyService,
    '../steam/gamepad/GamepadRuntime': { gamepadRuntime: { invalidate: noop } },
    '../steam/native-achievement-layout': { installNativeAchievementLayout: () => noop },
    '../features/library/runtime': {
      syncLinkedFirstContent: noop,
      handleLibraryNavigation: noop, cancelPendingLibraryPaint: noop, findNonSteamNotice: () => null,
      async tryInjectLibraryData(doc) {
        retirementCalls++;
        check(load('native-route').isPublicSteamLibraryRoute(doc), 'Retirement is only called here on a public native route');
        load('route-exit').beginLibraryRouteExit(doc, retirementCalls);
        load('route-exit').removeOwnedLibraryChrome(doc);
        load('route-exit').finishLibraryRouteExit(doc);
      },
    },
  };
  function load(name) {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const key = dependency.split('/').pop();
      if (key in sources) return load(key);
      if (name === 'app' || name === 'legacy-app') return emptyService;
      throw new Error(`Unexpected actual-source dependency ${name}: ${dependency}`);
    }, exports);
    return exports;
  }
  let actualApp, legacyApp, early, audit;
  const writes = [];
  try {
    const css = load('css');
    const ps = css.PLAYBAR_CLASSES();
    const infoClasses = css.GAME_INFO_OUTER_CLASSES();
    const playbar = document.createElement('div');
    playbar.id = 'fixture-playbar';
    playbar.className = `${ps.Container} ${ps.InPage}`;
    const row = document.createElement('div');
    row.className = '_1YbtIWcfkQJOysLXQbwzRf _3CYvy-LZ_Y81QV0QU3lj1c';
    const section = document.createElement('div');
    section.className = ps.GameStatsSection;
    const achievement = document.createElement('div');
    achievement.className = `${ps.GameStat} ${ps.MiniAchievements} ${ps.Visible}`;
    achievement.innerHTML = `<div class="${ps.GameStatRight}"><div class="${ps.PlayBarLabel}">LOGROS</div>`
      + `<div class="${ps.AchievementProgressRow}"><span class="${ps.AchievementCountLabel}">41/52</span>`
      + `<div class="${ps.DetailsProgressContainer}"><div class="${ps.DetailsProgressBar}" style="width:79%"></div></div></div></div>`;
    const buttons = document.createElement('div');
    buttons.className = ps.AppButtonsContainer;
    const infoButton = document.createElement('button');
    infoButton.className = ps.MenuButton;
    infoButton.setAttribute('aria-label', 'Hide game details');
    infoButton.setAttribute('aria-expanded', 'true');
    infoButton.textContent = 'ⓘ';
    buttons.appendChild(infoButton);
    section.appendChild(achievement);
    row.append(section, buttons);
    playbar.appendChild(row);
    const panel = document.createElement('div');
    panel.className = `${infoClasses.AppGameInfoContainer} ${infoClasses.AppDetailsExpanded}`;
    panel.textContent = 'Steam native information panel; expanded by the user';
    document.getElementById('fixture').append(playbar, panel);
    infoButton.onclick = () => {
      clicks++;
      const expanded = infoButton.getAttribute('aria-expanded') === 'true';
      infoButton.setAttribute('aria-expanded', String(!expanded));
      panel.classList.toggle(infoClasses.AppDetailsExpanded, !expanded);
      panel.classList.toggle(infoClasses.AppDetailsCollapsed, expanded);
    };
    check(load('native-dom').findNativeInfoButton(document) === infoButton,
      'The real native semantic information resolver recognizes the visible Steam control');
    check(load('native-route').isPublicSteamLibraryRoute(document), 'Actual Steam route ownership resolves the public AppID');

    legacyApp = load('legacy-app');
    legacyApp.__windowCreated({ window });
    await wait(1600);
    check(clicks > 0 && infoButton.getAttribute('aria-expanded') === 'false',
      'Negative control: the actual former native app callback asynchronously clicks and collapses a user-expanded Steam panel');
    legacyApp.__dispose();
    load('legacy-preference').disposeNativeInfoPreference(document);
    clicks = 0;
    infoButton.setAttribute('aria-expanded', 'true');
    panel.className = `${infoClasses.AppGameInfoContainer} ${infoClasses.AppDetailsExpanded}`;
    load('early-playbar').installEarlyLinkedPlaybar(document).dispose();

    const snapshot = () => ({ html: achievement.outerHTML, sectionClass: section.className,
      sectionStyle: section.getAttribute('style'), playbarClass: playbar.className, playbarStyle: playbar.getAttribute('style'),
      achievementDisplay: getComputedStyle(achievement).display, achievementVisibility: getComputedStyle(achievement).visibility,
      achievementOpacity: getComputedStyle(achievement).opacity,
      progressWidth: achievement.querySelector(`.${ps.DetailsProgressBar}`).getBoundingClientRect().width,
      panelClass: panel.className, infoExpanded: infoButton.getAttribute('aria-expanded') });
    const before = JSON.stringify(snapshot());
    audit = new MutationObserver(records => { writes.push(...records); });
    audit.observe(achievement, { attributes: true, characterData: true, childList: true, subtree: true });
    actualApp = load('app');
    actualApp.__windowCreated({ window });
    early = load('early-playbar').installEarlyLinkedPlaybar(document);
    check(JSON.stringify(snapshot()) === before && clicks === 0, 'Actual app window creation leaves every native achievement field and native Info state unchanged');

    const marker = document.createElement('div');
    marker.id = 'fixture-native-mutation';
    document.getElementById('fixture').appendChild(marker);
    for (let index = 0; index < 100; index++) {
      const id = index % 2 ? 1030300 : 367520;
      nativeWindow.LocationPathName = `/library/app/${id}`;
      window.uiStore.currentGameListSelection = { nAppId: id };
      marker.textContent = `Steam navigation ${index}`;
      early.sync();
      await wait(0);
      check(JSON.stringify(snapshot()) === before, `Native→native update ${index + 1} preserves native HTML, styles and rendered progress`);
    }
    arrival = { found: true, appid: '1030300', total: 52, unlocked: 41, achievements: [] };
    // Model Steam's own arrival without counting that fixture operation as a
    // plugin write. Every normal set/delete/clear remains observed thereafter.
    const arrivedEntry = { total: 52, unlocked: 41, percentage: 79 };
    Map.prototype.set.call(mapCache, 1030300, arrivedEntry);
    marker.textContent = 'Native cache arrival';
    early.sync();
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(370);
    check(JSON.stringify(snapshot()) === before && clicks === 0 && queueUpdates === 0
      && nativeCacheWrites.length === 0 && mapCache.get(1030300) === arrivedEntry,
      'After cache arrival and the actual 350 ms startup callback, native progress stays untouched');

    // Seed only plugin-owned remnants; real early cleanup and real route exit
    // must remove them without changing the native sibling or its ancestors.
    const owned = document.createElement('div');
    owned.id = 'gdl-playbar-achievements';
    owned.dataset.gdlPlaybarAchievements = '1';
    owned.innerHTML = '<span>Old external game progress 35/50</span>';
    section.appendChild(owned);
    const cloud = document.createElement('div'); cloud.dataset.gdlCloudStatus = '1'; section.appendChild(cloud);
    const playtime = document.createElement('div'); playtime.dataset.gdlPlaytime = '1'; section.appendChild(playtime);
    const links = document.createElement('div'); links.id = 'gdl-link-bar'; playbar.after(links);
    const content = document.createElement('div'); content.id = 'gdl-library-injected'; playbar.after(content);
    early.sync();
    marker.textContent = 'External→native retirement';
    await wait(30);
    check(!owned.isConnected && !cloud.isConnected && !playtime.isConnected,
      'The actual early native playbar cleanup removes only owned achievement, Cloud and playtime remnants');
    check(!links.isConnected && !content.isConnected && retirementCalls >= 1,
      'The real app native branch calls retirement only while owned chrome exists, then actual route-exit removes it');
    check(JSON.stringify(snapshot()) === before, 'External→native retirement preserves the native achievement and both native ancestors');
    const retirementsAfterCleanup = retirementCalls;
    marker.textContent = 'After retirement';
    await wait(40);
    check(retirementCalls === retirementsAfterCleanup, 'Public native mutations do not restart clean-up after the last plugin-owned node is gone');
    nativeWindow.LocationPathName = '/library/app/999999';
    window.uiStore.currentGameListSelection = { nAppId: 999999 };
    await wait(3100);
    check(JSON.stringify(snapshot()) === before, 'The actual 2500 ms navigation watchdog and timers beyond 3000 ms preserve native progress and Info state');
    check(clicks === 0 && queueUpdates === 0 && nativeCacheWrites.length === 0 && shortcutCalls === 0
      && mapCache.size === 1 && mapCache.get(1030300) === arrivedEntry,
      'The tested app/early-cleanup callbacks perform no native Info clicks, actual progress-cache set/delete/clear/Queue updates or shortcut-only stat/artwork calls');
    check(writes.length === 0, 'A continuous DOM audit detects zero writes to the native achievement subtree');
    check(getComputedStyle(achievement).display !== 'none' && achievement.getBoundingClientRect().height > 0,
      'The native achievement remains painted using the installed Steam stylesheet');
    actualApp.__dispose();
    audit.disconnect();
    const output = document.createElement('pre');
    output.id = 'native-playbar-isolation-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, clicks, queueUpdates, retirementCalls,
      nativeAchievementWrites: writes.length, nativeCacheWrites: nativeCacheWrites.length });
    document.body.appendChild(output);
  } catch (error) {
    actualApp?.__dispose(); legacyApp?.__dispose(); early?.dispose(); audit?.disconnect();
    const output = document.createElement('pre'); output.id = 'native-playbar-isolation-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
    document.body.appendChild(output);
  }
}

const scratchRoot = path.join(root, 'scratch');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'native-playbar-isolation-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'native-playbar-isolation.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:24px;background:#24282f;color:#dcdedf;font-family:Arial,sans-serif}#fixture{width:100%;min-height:120px}#native-playbar-isolation-result{font-size:12px;white-space:pre-wrap;max-width:1100px}</style>
</head><body class="DesktopUI"><h2>Native playbar ownership · installed Steam CSS</h2><div id="fixture"></div>
<script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1280,720',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError, socket, report;
child.on('error', error => { browserError = error; });
try {
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  const endpointDeadline = Date.now() + 10_000;
  let endpoint = '';
  while (Date.now() < endpointDeadline) {
    if (browserError) throw browserError;
    try { endpoint = fs.readFileSync(endpointFile, 'utf8'); if (/^\d+\r?\n.+/.test(endpoint)) break; }
    catch (error) { if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(endpoint, /^\d+\r?\n.+/, 'Headless Edge did not publish a readable local debugging endpoint');
  const port = endpoint.trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
  assert.ok(target?.webSocketDebuggerUrl, 'The spawned Edge fixture has no debug target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Runtime.enable');
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline = Date.now() + 12000; while (Date.now() < deadline) { const output = document.getElementById('native-playbar-isolation-result'); if (output) return JSON.parse(output.textContent); await new Promise(resolve => setTimeout(resolve, 20)); } return {ok:false,results:[],error:'Fixture did not finish native ownership checks'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, `Browser evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
  report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Scoped native playbar browser passed: ${report.checks} assertions for real app/early-playbar/route-exit callbacks: ${report.nativeAchievementWrites} native achievement DOM writes, ${report.clicks} native clicks, ${report.nativeCacheWrites} actual progress-cache mutations and ${report.queueUpdates} QueueCacheUpdate calls. Achievement polling, Info/link coordinators and full library runtime are stubbed; Steam React rendering is outside this test.`);
console.log(`Screenshot: ${screenshot}`);
