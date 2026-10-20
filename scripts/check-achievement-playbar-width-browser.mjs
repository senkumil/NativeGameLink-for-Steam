import './helpers/installed-steam-check.mjs';
// Exercise real plugin rendering against the installed Steam playbar CSS.
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
assert(fs.existsSync(edge), `Edge executable missing: ${edge}`);
assert((steamCss && fs.existsSync(steamCss)), `Installed Steam CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'], ['native-dom', 'frontend/steam/native-dom.ts'],
  ['playbar-visibility', 'frontend/steam/playbar-visibility.ts'],
  ['achievement-playbar-space', 'frontend/steam/achievement-playbar-space.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['playbar', 'frontend/features/achievements/playbar.ts'],
  ['navigation', 'frontend/features/achievements/navigation.ts'],
  ['achievement-playbar-style', 'frontend/features/achievements/styles/playbar.ts'],
  ['inject', 'frontend/features/achievements/styles/inject.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

async function browserChecks(sources) {
  const results = [], modules = {}, geometry = {};
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  let currentAppId = 3000000001, nativeClasses;
  const localization = {
    steamLanguageSync: () => 'english', gdlText: (_key, fallback) => fallback,
    loc: (_key, fallback) => fallback,
  };
  const dependencies = {
    '@steambrew/client': { findClassModule: predicate => nativeClasses && predicate(nativeClasses) ? nativeClasses : undefined },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => nativeClasses, getAllModules: () => nativeClasses ? [{ id: 'fixture-classes', exports: nativeClasses }] : [] } },
    './localization': localization, '../../steam/localization': localization,
    '../../api/backend': { backendLog() {} },
    '../../core/text': { escapeHtml: value => String(value) },
    '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => false } },
    './modal': { openLocalAchievementsModal: async () => {} },
    './format': { localAchievementPercent: data => Math.round(100 * data.unlocked / data.total) },
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: id => Number(id) >= 2147483648 ? '1790600' : null },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    '../library/native-route': { routedSteamAppId: () => currentAppId },
    '../../steam/navigation': { openSteamNavigationUrl() {} },
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
  try {
    const css = load('css'); nativeClasses = { ...css.PLAYBAR_CLASSES_FALLBACK };
    const ps = css.PLAYBAR_CLASSES(), playbar = load('playbar'), space = load('achievement-playbar-space');
    const visibility = load('playbar-visibility');
    check(css.PLAYBAR_CLASS_MODULE().native, 'Class discovery resolves the real native playbar classes');
    const putFiber = (element, appid) => {
      const state = {};
      const root = { tag: 3, stateNode: state, return: null };
      state.current = root;
      const owner = { tag: 0, memoizedProps: { overview: { appid } }, return: root };
      const host = { tag: 5, flags: 0, memoizedProps: { className: element.className }, return: owner };
      root.child = owner; owner.child = host; element.__reactFiber$widthFixture = host;
    };
    const textStat = (kind, label, value, icon = false) => {
      const element = document.createElement('div'); element.className = `${ps.GameStat} ${ps[kind] || ''}`;
      element.innerHTML = `${icon ? `<div class="${ps.GameStatIconForced}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="currentColor"/></svg></div>` : ''}`
        + `<div class="${ps.GameStatRight} ${ps.HideWhenNarrow}"><div class="${ps.PlayBarLabel}">${label}</div><div class="${ps.PlayBarDetailLabel}">${value}</div></div>`;
      return element;
    };
    const fixture = (appid, width) => {
      const panel = document.createElement('div'); panel.className = '_1iWOJQlrzyvbZvZo_x2KA3';
      panel.style.cssText = `position:relative;flex:none;width:${width}px;min-height:100px`;
      if (width <= 884) panel.classList.add('NarrowRightPanel');
      const bar = document.createElement('div'); bar.className = `${ps.Container} ${ps.InPage}`;
      const inner = document.createElement('div'); inner.className = '_3Y87YQY56ZCOqhgcZFaDc5';
      const row = document.createElement('div'); row.className = '_9EHg918wH6CQCQlD5PWOO';
      const action = document.createElement('div'); action.className = '_2zxzStp5qY5M1evOm8keES';
      action.style.width = '164px'; action.textContent = 'PLAY';
      const status = document.createElement('div'); status.className = '_1YbtIWcfkQJOysLXQbwzRf _3CYvy-LZ_Y81QV0QU3lj1c';
      const stats = document.createElement('div'); stats.className = ps.GameStatsSection;
      const cloud = textStat('LastPlayed', 'Cloud status', 'Up to date', true);
      const last = textStat('LastPlayed', 'Last played', '3 Oct');
      const time = textStat('Playtime', 'Playtime', '2.1 hours', true);
      stats.append(cloud, last, time); status.append(stats);
      const right = document.createElement('div'); right.className = '_1EAxK56o5a9Nieu5HYkJ4k';
      const buttons = document.createElement('div'); buttons.className = ps.AppButtonsContainer;
      const gear = document.createElement('button'); gear.className = ps.MenuButton; gear.textContent = '⚙';
      const favorite = document.createElement('button'); favorite.className = `${ps.MenuButton} ${ps.FavoriteButton}`; favorite.textContent = '♥';
      buttons.append(gear, favorite); right.append(buttons); row.append(action, status, right); inner.append(row); bar.append(inner); panel.append(bar);
      document.getElementById('fixture').append(panel);
      putFiber(bar, appid); putFiber(stats, appid);
      return { panel, bar, status, stats, buttons, favorite, native: [cloud, last, time] };
    };
    const data = appid => ({ found: true, metadata_appid: '1790600', appid: '1790600', state_appid: String(appid), total: 50, unlocked: 35, achievements: [] });
    const resize = (host, width) => {
      host.panel.style.width = `${width}px`;
      host.panel.classList.toggle('NarrowRightPanel', width <= 884);
      host.panel.classList.toggle('UltraNarrowRightPanel', width <= 600);
    };
    const measure = (stat, host) => {
      const rect = stat.getBoundingClientRect(), clip = host.status.getBoundingClientRect();
      return { width: rect.width, height: rect.height, relativeTop: rect.top - clip.top,
        display: getComputedStyle(stat).display, margin: getComputedStyle(stat).marginInlineEnd,
        available: clip.width, painted: rect.width > 0 && rect.height > 0 && rect.top >= clip.top - .1 && rect.top < clip.bottom - 1 };
    };
    const info = host => {
      const button = document.createElement('button'); button.className = ps.MenuButton;
      button.dataset.gdlGameInfoButton = '1'; button.innerHTML = '<svg class="SVGIcon_Information" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="currentColor"/></svg>';
      host.buttons.insertBefore(button, host.favorite);
      space.syncAchievementPlaybarSpace(document); return button;
    };
    const narrow = fixture(currentAppId, 800);
    const nativeBefore = narrow.native.map(element => element.outerHTML);
    let stat = playbar.ensureLocalPlaybarStat(document, data(currentAppId));
    check(stat?.parentElement === narrow.stats && getComputedStyle(stat).display === 'none',
      'An already narrow right panel hides owned achievements synchronously on their first mount');
    check(stat.style.display === '' && stat.style.getPropertyPriority('display') === '',
      'No inline flex override defeats Steam’s native narrow-panel achievement rule');
    await frame();
    check(!measure(stat, narrow).painted, 'The first animation-frame paint contains no narrow-panel achievement flash');
    narrow.panel.style.display = 'none';
    currentAppId++;
    const next = fixture(currentAppId, 800);
    check(playbar.ensureLocalPlaybarStat(document, data(currentAppId)) === stat && stat.parentElement === next.stats,
      'Immediate navigation migrates the same owned achievement element to the newly committed shortcut host');
    check(getComputedStyle(stat).display === 'none', 'Navigation into a second narrow host stays hidden before the next paint');
    await frame();
    check(!measure(stat, next).painted, 'The navigation frame also contains no achievement flash');
    resize(next, 1500); visibility.preserveLinkedPlaybarVisibility(document);
    check(measure(stat, next).painted, 'Widening the panel reveals achievements through native CSS without replacing the element');
    resize(next, 800);
    check(!measure(stat, next).painted && getComputedStyle(stat).display === 'none', 'Narrowing the same panel hides achievements again');
    info(next);
    check(stat.style.marginInlineEnd === '' && !measure(stat, next).painted, 'Info hydration releases its margin without overriding narrow visibility');
    check(JSON.stringify(nativeBefore) === JSON.stringify(narrow.native.map(element => element.outerHTML)),
      'All attributes and inline styles of native sibling stats remain byte-for-byte intact');

    next.panel.style.display = 'none'; currentAppId++;
    const marginal = fixture(currentAppId, 1100);
    stat = playbar.ensureLocalPlaybarStat(document, data(currentAppId));
    const statusStyle = getComputedStyle(marginal.status), statsStyle = getComputedStyle(marginal.stats);
    check(statusStyle.maxHeight === '46px' && statusStyle.overflow === 'hidden' && statsStyle.flexWrap === 'wrap',
      'The fixture exercises Steam’s actual 46px clipped status container and wrapping statistics row');
    let marginalWidth;
    for (let width = 885; width <= 1500; width++) {
      resize(marginal, width);
      stat.style.removeProperty('margin-inline-end');
      const oldPainted = measure(stat, marginal).painted;
      space.syncAchievementPlaybarSpace(document);
      if (oldPainted && !measure(stat, marginal).painted) { marginalWidth = width; break; }
    }
    check(Boolean(marginalWidth), 'A real layout boundary reproduces the former flash: unreserved stats fit while the final Info slot does not');
    const beforeInfo = measure(stat, marginal);
    check(beforeInfo.margin === '47px' && !beforeInfo.painted && marginalWidth > 884,
      'A marginal panel wider than NarrowRightPanel reserves 42px before the first hydrated Info control');
    load('achievement-playbar-style').ensureAchievementPlaybarStyles(document);
    const styledBeforeInfo = measure(stat, marginal);
    check(styledBeforeInfo.width === beforeInfo.width && styledBeforeInfo.relativeTop === beforeInfo.relativeTop
      && styledBeforeInfo.painted === beforeInfo.painted,
    'Installing the achievement style after first mount does not change its width or clipped visibility');
    const buttonsBefore = marginal.buttons.getBoundingClientRect().width;
    info(marginal);
    const afterInfo = measure(stat, marginal);
    geometry.marginal = { panelWidth: marginalWidth, beforeInfo, afterInfo };
    check(Math.abs(marginal.buttons.getBoundingClientRect().width - buttonsBefore - 42) < .1,
      'The actual native Info insertion consumes exactly the 42px that were reserved');
    check(afterInfo.margin === '5px' && !afterInfo.painted && beforeInfo.relativeTop === afterInfo.relativeTop,
      'Info insertion and reservation retirement preserve the same wrapped and clipped visibility synchronously');
    for (let count = 0; count < 4; count++) { await frame(); check(!measure(stat, marginal).painted, 'No marginal-width achievement flash appears on the following paint'); }

    marginal.panel.style.display = 'none'; currentAppId++;
    const wide = fixture(currentAppId, 1500);
    stat = playbar.ensureLocalPlaybarStat(document, data(currentAppId));
    const wideNativeBefore = wide.native.map(element => element.outerHTML);
    check(measure(stat, wide).painted && stat.style.marginInlineEnd === '47px', 'A sufficiently wide host shows achievements immediately with the future Info space already reserved');
    await frame(); check(measure(stat, wide).painted, 'The first wide-host paint shows achievements');
    info(wide);
    check(measure(stat, wide).painted && stat.style.marginInlineEnd === '', 'Info hydration does not hide achievements when the final bar has enough room');
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(wide.bar, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let count = 0; count < 100; count++) {
      playbar.ensureLocalPlaybarStat(document, data(currentAppId));
      space.syncAchievementPlaybarSpace(document); visibility.preserveLinkedPlaybarVisibility(document);
    }
    await Promise.resolve(); mutations.push(...observer.takeRecords()); observer.disconnect();
    check(mutations.length === 0, '100 complete identical updates perform zero DOM or inline-style writes');
    check(JSON.stringify(wideNativeBefore) === JSON.stringify(wide.native.map(element => element.outerHTML)),
      'Wide-host native sibling markup remains unchanged after reservation and repeated updates');
    const nativeDOM = load('native-dom');
    const originalStat = textStat('Playtime', 'PLAY TIME', '25 hours');
    const copiedStat = textStat('Playtime', 'PLAY TIME', '25 hours');
    copiedStat.dataset.gdlPlaytime = '1';
    wide.stats.append(originalStat, copiedStat);
    nativeDOM.saveNativeUiBlueprint(nativeDOM.NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime, originalStat);
    nativeDOM.applyNativePlaybarTypography(copiedStat, nativeDOM.NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime);
    const readType = element => {
      const label = getComputedStyle(element.querySelector(`.${ps.PlayBarLabel}`));
      const value = getComputedStyle(element.querySelector(`.${ps.PlayBarDetailLabel}`));
      return [label.fontSize, label.lineHeight, value.fontSize, value.lineHeight].join('|');
    };
    for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const width of [600, 800, 885, 1100, 1500]) {
      wide.panel.style.zoom = String(zoom); resize(wide, width);
      check(readType(copiedStat) === readType(originalStat),
        `Copied playbar typography follows the native CSS at ${width}px and zoom ${zoom}: ${readType(copiedStat)} vs ${readType(originalStat)}`);
      const infoControl = wide.buttons.querySelector('[data-gdl-game-info-button]'), controlStyle = getComputedStyle(infoControl);
      check(controlStyle.width === '32px' && controlStyle.height === '32px' && controlStyle.marginInlineEnd === '10px'
        && Math.abs(infoControl.getBoundingClientRect().width / zoom - 32) < .1,
        `Native action sizing reserves 42 logical pixels at ${width}px and zoom ${zoom}`);
    }
    copiedStat.remove(); originalStat.remove(); wide.panel.style.zoom = ''; resize(wide, 1500);
    currentAppId = 123;
    const originalMarkup = wide.bar.outerHTML;
    check(playbar.ensureLocalPlaybarStat(document, data(currentAppId)) === null && wide.bar.outerHTML === originalMarkup,
      'A native game route cannot initiate any achievement render or style mutation');
    const output = document.createElement('pre'); output.id = 'achievement-width-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, geometry }); document.body.append(output);
  } catch (error) {
    const output = document.createElement('pre'); output.id = 'achievement-width-result';
    output.textContent = JSON.stringify({ ok: false, results, geometry, error: String(error.stack || error) }); document.body.append(output);
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'achievement-width-'));
const htmlPath = path.join(scratch, 'fixture.html'), screenshot = path.join(scratch, 'achievement-width.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:16px;background:#24282f;color:#dcdedf;font-family:Arial,sans-serif}#fixture{position:relative}#achievement-width-result{font-size:12px;white-space:pre-wrap}</style>
</head><body class="DesktopUI"><h2>Achievement width · installed Steam CSS</h2><div id="fixture"></div><script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files', '--window-size=1600,1000', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browserError, socket, report;
child.on('error', error => { browserError = error; });
try {
  const endpointFile = path.join(profile, 'DevToolsActivePort'), deadline = Date.now() + 10_000;
  let endpoint = '';
  while (Date.now() < deadline) {
    if (browserError) throw browserError;
    try { endpoint = fs.readFileSync(endpointFile, 'utf8'); if (/^\d+\r?\n.+/.test(endpoint)) break; }
    catch (error) { if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(endpoint, /^\d+\r?\n.+/, 'Headless Edge did not publish a debugging endpoint');
  const port = endpoint.trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.url === pathToFileURL(htmlPath).href);
  assert(target?.webSocketDebuggerUrl, 'The spawned Edge fixture has no debug target');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline=Date.now()+10000; while(Date.now()<deadline){ const output=document.getElementById('achievement-width-result'); if(output)return JSON.parse(output.textContent); await new Promise(resolve=>setTimeout(resolve,20)); } return {ok:false,results:[],error:'Fixture did not finish'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails)); report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert(report.ok, `${report.error}\nPassed: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Achievement playbar width browser passed: ${report.checks} assertions; real Steam CSS, narrow navigation, native resize visibility, pending Info width, marginal clipping and 100 updates without writes.`);
console.log(JSON.stringify(report.geometry));
console.log(`Screenshot: ${screenshot}`);
