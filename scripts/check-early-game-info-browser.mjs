// Real-source first-header Info coverage, including native/shortcut transitions.
import './helpers/installed-steam-check.mjs';
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
assert.ok(fs.existsSync(edge) && (steamCss && fs.existsSync(steamCss)), 'This browser check requires installed Edge and Steam CSS');
const sources = Object.fromEntries([
  ['pure-class-factory', 'frontend/steam/gamepad/components/pure-class-factory.ts'], ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'], ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-details', 'frontend/steam/library-details.ts'], ['dom', 'frontend/core/dom.ts'],
  ['achievement-playbar-space', 'frontend/steam/achievement-playbar-space.ts'],
  ['info-button-target', 'frontend/features/library/info-button-target.ts'],
  ['info-panel', 'frontend/features/library/info-panel.ts'],
  ['native-chrome', 'frontend/features/library/native-chrome.ts'],
  ['early-game-info', 'frontend/features/library/early-game-info.ts'],
  ['info', 'frontend/features/library/styles/info.ts'], ['inject', 'frontend/features/library/styles/inject.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText]));

async function browserChecks(sources) {
  const results = [], check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const flush = () => new Promise(resolve => setTimeout(resolve, 25));
  const ids = { a: 3000000001, b: 3000000002, native: 123 };
  let route = ids.native, reads = 0, cloudCalls = 0, watcherCreates = 0;
  const metadata = new Map(), modules = {}, unmapped = new Set(), dismissed = new Set();
  const mapped = id => [ids.a, ids.b].includes(Number(id)) && !unmapped.has(Number(id)) ? '1790600' : null;
  const modelFor = (data, key) => ({ key, title: data.name, isLegacy: false, portrait: '',
    description: data.short_description || '', developer: data.developer || '', publisher: '', franchise: '', release: '', features: [], hasCloud: false });
  const localization = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback, steamLanguageSync: () => 'english' };
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    '../../api/backend': { backendLog() {} },
    '../../core/game-data': { getSynchronousGameData: id => { reads++; return metadata.get(id) || null; } },
    '../../core/text': { escapeHtml: value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) },
    '../../steam/localization': localization, './localization': localization,
    '../../steam/shortcuts': { getShortcutAppById: id => ({ appid: id, display_name: `Shortcut ${id}` }) },
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: mapped },
    '../shortcuts/dismissed': { isShortcutDismissed: id => dismissed.has(Number(id)) },
    './native-route': { routedSteamAppId: () => route, isPublicSteamLibraryRoute: () => route < 2147483648 },
    './library-assets': { getResolvedLibraryAssets: () => null },
    './native-game-model': { steamNativeGameInfo: modelFor },
    './cloud-status': { ensureCloudStatus: () => { cloudCalls++; }, removeCloudStatus() {} },
    './playbar-achievement-cleanup': { removeObsoletePlaybarAchievements: () => false },
    '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility() {} },
    '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records, isLibrarySidebarNode: () => false },
    './feature-icons': { nativeArrowSvg: () => '<svg class="SVGIcon_Arrow"></svg>', nativeFeatureVisual: () => '' },
    './styles': { ensureNativeGameInfoStyles: doc => load('info').ensureInfoPanelStyles(doc) },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = modules[name] = {};
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  let audit;
  const NativeObserver = window.MutationObserver;
  const NativeResizeObserver = window.ResizeObserver;
  const activeResizeObservers = new Set();
  window.MutationObserver = class extends NativeObserver { constructor(callback) { super(callback); watcherCreates++; } };
  window.ResizeObserver = class extends NativeResizeObserver {
    observe(...args) { super.observe(...args); activeResizeObservers.add(this); }
    disconnect() { super.disconnect(); activeResizeObservers.delete(this); }
  };
  try {
    const css = load('css'), classes = css.PLAYBAR_CLASSES();
    const early = load('early-game-info'), chrome = load('native-chrome');
    const info = load('info-panel');
    const playbar = document.createElement('div');
    playbar.className = `${classes.Container} ${classes.InPage}`;
    const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;min-height:60px';
    const stats = document.createElement('div'); stats.className = classes.GameStatsSection;
    const buttons = document.createElement('div'); buttons.className = classes.AppButtonsContainer;
    const favorite = document.createElement('button'); favorite.className = classes.FavoriteButton; favorite.textContent = 'Favorite';
    buttons.appendChild(favorite); row.append(stats, buttons); playbar.appendChild(row);
    const links = document.createElement('div'); links.id = 'gdl-link-bar'; links.textContent = 'Store page';
    document.getElementById('fixture').append(playbar, links);
    const commit = id => {
      for (const node of [playbar, stats, buttons]) {
        const state = {}, rootFiber = { tag: 3, return: null, stateNode: state };
        state.current = rootFiber;
        const owner = { tag: 0, memoizedProps: { overview: { appid: id } }, return: rootFiber };
        const host = { tag: 5, flags: 0, return: owner, memoizedProps: { className: node.className } };
        rootFiber.child = owner; owner.child = host; node.__reactFiber$fixture = host;
      }
    };
    commit(ids.native);
    const nativeBefore = playbar.outerHTML;
    early.syncEarlyLinkedGameInfo(document);
    check(playbar.outerHTML === nativeBefore && reads === 0 && cloudCalls === 0,
      'An initial native game receives no metadata reads, Info, Cloud or native DOM writes');
    route = ids.a;
    early.syncEarlyLinkedGameInfo(document);
    check(playbar.outerHTML === nativeBefore && reads === 0,
      'A shortcut route ahead of the native host cannot authorize Info or metadata');
    commit(ids.a);
    early.syncEarlyLinkedGameInfo(document);
    const firstButton = document.querySelector('[data-gdl-game-info-button="1"]');
    const firstPanel = document.getElementById('gdl-game-info-panel');
    check(firstButton?.isConnected && firstPanel?.isConnected && firstPanel.nextElementSibling === links,
      'The first committed external header gets its stable Info button and panel synchronously on a cold cache');
    check(firstPanel.dataset.gdlShortcutAppId === String(ids.a) && firstPanel.textContent.includes(`Shortcut ${ids.a}`),
      'Cold Info uses only the exact shortcut title and available facts');
    check(firstPanel.dataset.expanded === '0' && firstButton.getAttribute('aria-expanded') === 'false',
      'The first Info panel starts collapsed with a matching button state');
    await flush(); await flush();
    let writes = [];
    audit = new NativeObserver(records => writes.push(...records));
    audit.observe(playbar, { subtree: true, childList: true, attributes: true, characterData: true });
    audit.observe(firstPanel, { subtree: true, childList: true, attributes: true, characterData: true });
    const initialReads = reads, initialWatchers = watcherCreates;
    for (let i = 0; i < 100; i++) early.syncEarlyLinkedGameInfo(document);
    await flush(); writes.push(...audit.takeRecords());
    check(writes.length === 0 && reads === initialReads && watcherCreates === initialWatchers,
      '100 settled early syncs perform no DOM writes, metadata rereads or Info-observer reinstalls');
    audit.disconnect();
    firstButton.click();
    check(firstPanel.dataset.expanded === '1', 'The cold Info button opens its own panel before metadata arrives');
    const rich = modelFor({ name: 'Confirmed title', short_description: 'Confirmed description', developer: 'Confirmed studio' }, '1790600');
    chrome.ensureNativeGameChrome(document, rich);
    check(document.querySelector('[data-gdl-game-info-button="1"]') === firstButton
      && document.getElementById('gdl-game-info-panel') === firstPanel && firstPanel.textContent.includes('Confirmed description'),
      'Confirmed metadata enriches the existing button and panel without replacing either node');
    check(firstPanel.dataset.expanded === '1' && firstButton.getAttribute('aria-expanded') === 'true'
      && watcherCreates === initialWatchers,
      'Enrichment preserves an open panel and its installed scroll observer');
    chrome.removeNativeGameChrome(document, false, true, true, true);
    check(firstButton.isConnected && firstPanel.isConnected,
      'Metadata-layout cleanup preserves Info only for the exact committed current shortcut');
    chrome.removeNativeGameChrome(document, true, true, true, true);
    check(firstButton.isConnected && firstPanel.isConnected && firstPanel.dataset.expanded === '1'
      && chrome.getCurrentNativeGameInfoForDocument(document, ids.a) === rich
      && chrome.getCurrentNativeGameInfo() === rich,
      'Cleanup with clear-model preserves the exact early Info nodes, confirmed model and open state when requested');
    route = ids.b;
    early.syncEarlyLinkedGameInfo(document);
    check(document.querySelector('[data-gdl-game-info-button="1"]') === firstButton,
      'The next route cannot move Info into a host still committed to the previous shortcut');
    commit(ids.b); early.syncEarlyLinkedGameInfo(document);
    const siblingButton = document.querySelector('[data-gdl-game-info-button="1"]');
    const siblingPanel = document.getElementById('gdl-game-info-panel');
    check(siblingButton !== firstButton && siblingPanel !== firstPanel && !firstButton.isConnected
      && siblingPanel.dataset.gdlShortcutAppId === String(ids.b),
      'Sibling shortcuts sharing a Store AppID receive their own target and retire old click closures');
    firstButton.click();
    check(siblingPanel.dataset.expanded === '0', 'A retired previous-game click cannot open the sibling panel');
    route = ids.native; commit(ids.native);
    const expectedNative = playbar.cloneNode(true);
    expectedNative.querySelectorAll('[data-gdl-game-info-button="1"]').forEach(node => node.remove());
    early.syncEarlyLinkedGameInfo(document);
    check(playbar.outerHTML === expectedNative.outerHTML && !siblingPanel.isConnected
      && !chrome.getCurrentNativeGameInfoForDocument(document, ids.b),
      'Standalone early synchronization retires only owned Info when the target becomes native');
    const nativeAfter = playbar.outerHTML, nativeReads = reads;
    early.syncEarlyLinkedGameInfo(document); chrome.ensureNativeGameChrome(document, rich);
    check(playbar.outerHTML === nativeAfter && reads === nativeReads
      && !document.querySelector('[data-gdl-game-info-button="1"]') && !document.getElementById('gdl-game-info-panel'),
      'External-to-native retirement removes only owned UI and every native sync stays read-only');
    metadata.set('1790600', { name: 'Warm cached title', short_description: 'Warm cached description' });
    route = ids.a; commit(ids.a); early.syncEarlyLinkedGameInfo(document);
    const warmButton = document.querySelector('[data-gdl-game-info-button="1"]');
    const warmPanel = document.getElementById('gdl-game-info-panel');
    check(warmButton?.isConnected && warmPanel?.textContent.includes('Warm cached description'),
      'Native-to-external navigation paints a warm cached model in the same committed-host turn');
    firstButton.click();
    check(warmPanel.dataset.expanded === '0', 'An ABA return cannot reactivate an old detached button callback');
    dismissed.add(ids.a); early.syncEarlyLinkedGameInfo(document);
    check(!warmButton.isConnected && !warmPanel.isConnected
      && !chrome.getCurrentNativeGameInfoForDocument(document, ids.a),
      'Dismissing a shortcut synchronously retires its owned Info and cached model');
    dismissed.delete(ids.a); early.syncEarlyLinkedGameInfo(document);
    check(Boolean(document.querySelector('[data-gdl-game-info-button="1"]')),
      'Removing dismissal allows the same exact committed shortcut to acquire fresh Info');
    unmapped.add(ids.a); early.syncEarlyLinkedGameInfo(document);
    check(!document.querySelector('[data-gdl-game-info-button="1"]') && !document.getElementById('gdl-game-info-panel'),
      'An unlinked shortcut immediately retires owned Info without waiting for app-level navigation cleanup');
    unmapped.delete(ids.a); early.syncEarlyLinkedGameInfo(document);
    const detachedPanel = document.getElementById('gdl-game-info-panel');
    check(activeResizeObservers.size === 1, 'Only the live game-info panel retains a resize observer');
    detachedPanel.remove();
    info.removeNativeInfoPanel(document);
    check(activeResizeObservers.size === 0,
      'A panel detached by Steam still releases its resize observer at document cleanup');
    early.disposeEarlyLinkedGameInfo(document); info.removeNativeInfoButton(document); info.removeNativeInfoPanel(document);
    check(!chrome.getCurrentNativeGameInfoForDocument(document, ids.a)
      && !document.querySelector('[data-gdl-game-info-button="1"]'),
      'Document disposal forgets the exact model and tears down its Info observer');
    const output = document.createElement('pre'); output.id = 'playbar-startup-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results }); document.body.appendChild(output);
  } catch (error) {
    audit?.disconnect();
    const output = document.createElement('pre'); output.id = 'playbar-startup-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) }); document.body.appendChild(output);
  } finally { window.MutationObserver = NativeObserver; window.ResizeObserver = NativeResizeObserver; }
}
const scratchRoot = path.join(root, 'scratch');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'early-game-info-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'early-game-info.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:24px;background:#24282f;color:#dcdedf;font-family:Arial,sans-serif}#fixture{width:100%;min-height:120px}#playbar-startup-result{font-size:12px;white-space:pre-wrap;max-width:1100px}</style>
</head><body class="DesktopUI"><h2>First-header Info · installed Steam CSS</h2><div id="fixture"></div>
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
    try {
      endpoint = fs.readFileSync(endpointFile, 'utf8');
      if (/^\d+\r?\n.+/.test(endpoint)) break;
    } catch (error) {
      if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(endpoint, /^\d+\r?\n.+/, 'Headless Edge did not publish a readable local debugging endpoint');
  const port = endpoint.trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
  assert.ok(target?.webSocketDebuggerUrl, 'The spawned Edge fixture has no debug target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
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
    expression: `(async () => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const output = document.getElementById('playbar-startup-result'); if (output) return JSON.parse(output.textContent); await new Promise(resolve => setTimeout(resolve, 20)); } return {ok:false,results:[],error:'Fixture did not finish real RAF checks'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, `Browser evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
  report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Early game Info browser passed: ${report.checks} assertions; cold/warm first header, native/shortcut ownership, in-place enrichment, stable observers and retired ABA callbacks.`);
console.log(`Screenshot: ${screenshot}`);

