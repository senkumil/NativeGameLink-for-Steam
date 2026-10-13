import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const steam = 'C:/Program Files (x86)/Steam';
const edge = process.env.ACHIEVEMENT_BROWSER_EXECUTABLE || `${steam.replace('/Steam', '')}/Microsoft/Edge/Application/msedge.exe`;
assert.ok(fs.existsSync(edge), `Edge executable missing: ${edge}`);
const fontRoot = path.join(root, 'scratch', 'achievement-modal-fonts');
fs.mkdirSync(fontRoot, { recursive: true });
const fontUrls = Object.fromEntries(await Promise.all(['Regular', 'Medium', 'Bold'].map(async weight => {
  const filename = `MotivaSans-${weight}.ttf`;
  const local = path.join(fontRoot, filename);
  if (!fs.existsSync(local)) {
    const response = await fetch(`https://store.cloudflare.steamstatic.com/public/shared/fonts/${filename}?v=4.015`,
      { signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `Official QA font failed: ${filename} HTTP ${response.status}`);
    const contents = Buffer.from(await response.arrayBuffer());
    assert.ok(contents.readUInt32BE(0) === 0x00010000 || ['OTTO', 'wOFF', 'wOF2'].includes(contents.subarray(0, 4).toString()),
      `Official QA font returned a non-font response: ${filename}`);
    fs.writeFileSync(local, contents);
  }
  return [weight.toLowerCase(), pathToFileURL(local).href];
})));
const sources = Object.fromEntries([
  ['modal', 'frontend/features/achievements/modal.ts'],
  ['modal-style', 'frontend/features/achievements/styles/modal.ts'],
  ['inject', 'frontend/features/achievements/styles/inject.ts'],
  ['format', 'frontend/features/achievements/format.ts'],
  ['rarity', 'frontend/features/achievements/rarity.ts'],
  ['rare', 'frontend/features/achievements/styles/rare.ts'],
  ['mask', 'frontend/features/achievements/styles/mask.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const metadataPath = 'C:/Users/david/AppData/Roaming/NativeGameLinkForSteam/metadata_cache/1030300_english.json';
const nativePath = `${steam}/userdata/860367772/config/librarycache/1030300.json`;
const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};
const native = fs.existsSync(nativePath) ? JSON.parse(fs.readFileSync(nativePath, 'utf8')).find(entry => entry[0] === 'achievements')?.[1]?.data : null;
const nativeRows = new Map([...(native?.vecHighlight || []), ...(native?.vecUnachieved || []), ...(native?.vecAchievedHidden || [])].map(item => [item.strID, item]));
const bondedId = Object.entries(metadata).find(([_name, item]) => item.title === 'Bonded')?.[0] || 'BELLWAY_MELODY';
const first = ['ALL_CRESTS', 'ALL_SILK_HEARTS', 'ALL_SILK_SKILLS', 'ALL_SILK_SPOOLS', bondedId];
const firstNames = ['Consumed', 'Regenerated', 'Woven', 'Extended', 'Bonded'];
const ordered = Array.from(new Set([...first, ...Object.keys(metadata)]));
while (ordered.length < 52) ordered.push(`FIXTURE_${ordered.length}`);
const iconSvg = index => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#080a0f"/><g stroke="#d4d7dd" stroke-width="2.5" fill="none"><path d="M18 49Q3 25 22 12Q16 32 30 36Q44 24 42 12Q62 31 47 49Q33 61 18 49Z"/><path d="M16 ${22 + index % 8}Q32 5 49 ${23 + index % 8}M22 46Q32 36 42 46"/><circle cx="25" cy="35" r="2" fill="#fff"/><circle cx="39" cy="35" r="2" fill="#fff"/></g></svg>`)}`;
const fixtureData = {
  found: true, appid: '1030300', state_appid: '3000000001', unlocked: 41, total: 52,
  achievements: ordered.slice(0, 52).map((name, index) => {
    const meta = metadata[name] || {};
    const saved = nativeRows.get(name);
    return {
      name, display_name: first[index] ? firstNames[index] : meta.title || saved?.strName || `Achievement ${index + 1}`,
      description: meta.description || saved?.strDescription || 'Explore Pharloom and complete the challenge',
      icon: saved?.strImage || meta.icon || iconSvg(index),
      icon_gray: meta.icongray || saved?.strImage || meta.icon || iconSvg(index), hidden: Boolean(meta.hidden),
      global_percent: Number(saved?.flAchieved ?? meta.global_percent ?? (50 - index / 2)),
      earned: index < 41, earned_time: 1789782614 - Math.max(0, index - 4) * 3600,
      progress: saved?.flCurrentProgress || 0, max_progress: saved?.flMaxProgress || 0,
    };
  }),
};
const localUrl = filename => fs.existsSync(filename) ? pathToFileURL(filename).href : iconSvg(0);
const assets = {
  icon: localUrl(`${steam}/appcache/librarycache/1030300/b4a999c1302e3ac123c041fd41bb8a34528c6ab5.jpg`),
  hero: localUrl(`${steam}/appcache/librarycache/1030300/70d7e70ae2fd0f8a46661d4a425cd84479dc7a61/library_hero_blur.jpg`),
};

async function browserChecks(sources, fixtureData, assets) {
  const results = [];
  let geometry = {};
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const near = (value, expected, message, tolerance = 2) => check(Math.abs(value - expected) <= tolerance, `${message}: ${value.toFixed(2)}px (target ${expected}px)`);
  const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
  const modules = {};
  let comparisonMode = 'success';
  let resolveComparison;
  let comparisonRequests = 0;
  const comparisonSteamid = '76561198000000001';
  const localization = {
    steamIntlLocale: () => 'es-419',
    loc: (key, fallback) => ({
      Achievements_HeaderStats_Earned_Label: '%1$s de %2$s logros conseguidos',
      Achievements_Tab_MyAchievements: 'Mis logros',
      Achievements_Tab_GlobalAchievements: 'Logros mundiales',
      Achievements_ComparisonLabel_NotComparing: 'Comparar con...',
      Achievements_ComparisonLabel_Comparing: 'Comparado con %1$s',
      Achievements_ComparisonLabel_Clear: 'Borrar la comparación',
      Achievements_Filter_Default: 'Buscar',
      Achievements_ListItem_UnlockDateTime: 'Se desbloqueó el %1$s',
    }[key] || fallback),
    gdlText: (key, fallback, values = {}) => ({
      close: 'Cerrar', search: 'Buscar', achievements_mine: 'MIS LOGROS', achievements_global: 'LOGROS MUNDIALES',
      achievements_unlocked: '{unlocked} de {total} logros desbloqueados', unlocked_on: 'Desbloqueado el {date}',
      players_have_achievement: 'de los jugadores tienen este logro', compare_achievements: 'Comparar logros',
      native_steam_achievements_loading: 'Cargando logros de Steam...',
      achievement_comparison_unavailable: 'Los logros de este amigo son privados o no están disponibles.',
    }[key] || fallback).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)),
  };
  const dependencies = {
    '../../core/text': { escapeHtml: value => String(value).replace(/[&<>"']/g, token => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[token]) },
    '../../steam/localization': localization,
    './cache': { pickCachedLocalAchievementSnapshot: data => data },
    './game-info': { getLocalAchievementGameInfo: async () => ({ name: 'Hollow Knight: Silksong', headerImage: assets.icon, iconImage: assets.icon, heroImage: assets.hero }) },
    './steam-rare': { getSteamRareAchievementClasses: () => ({ wrapper: 'fixture-rare-frame', icon: 'fixture-rare-icon', iconGlow: 'fixture-rare-glow' }), renderSteamRareGlowHtml: () => '' },
    './comparison': {
      getAchievementComparisonFriends: async () => [{ steamid: comparisonSteamid, name: 'Amiga real', avatar: assets.icon }],
      getFriendAchievementState: () => {
        comparisonRequests++;
        if (comparisonMode === 'error') return Promise.reject(new Error('achievement_comparison_private_or_unavailable'));
        if (comparisonMode === 'pending') return new Promise(resolve => { resolveComparison = resolve; });
        return Promise.resolve(new Map([
          [fixtureData.achievements[0].name, { earned: true, earnedTime: 1789782614, progress: 10 }],
          [fixtureData.achievements[1].name, { earned: false, earnedTime: 0, progress: 3 }],
        ]));
      },
    },
  };
  const aliases = { './styles/modal': 'modal-style', './inject': 'inject', './rare': 'rare', './mask': 'mask', './format': 'format', './rarity': 'rarity' };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      if (dependency in aliases) return load(aliases[dependency]);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  const rect = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height', 'right', 'bottom'].map(key => [key, box[key] * 1.25]));
  };
  try {
    const { openLocalAchievementsModal } = load('modal');
    const open = async () => {
      await openLocalAchievementsModal(document, fixtureData);
      await Promise.race([
        Promise.all(Array.from(document.querySelectorAll('.gdl-lam-row-icon')).slice(0, 5)
          .map(image => image.decode().catch(() => {}))),
        wait(4000),
      ]);
      await wait(220);
    };
    await Promise.race([
      Promise.all([document.fonts.load('16px "Motiva Sans"'), document.fonts.load('500 16px "Motiva Sans"'), document.fonts.load('700 22px "Motiva Sans"')]).catch(() => {}),
      wait(4000),
    ]);
    await Promise.race([document.fonts.ready, wait(4000)]);
    check(document.fonts.check('500 16px "Motiva Sans"'), 'The official Motiva Sans medium font is loaded at native row weight 500');
    await open();
    check(Array.from(document.querySelectorAll('.gdl-lam-row-icon')).slice(0, 5)
      .every(image => image.complete && image.naturalWidth > 0), 'First five real achievement icons decode before the geometry check and screenshot');
    geometry = Object.fromEntries(Object.entries({
      window: '.gdl-lam-window', header: '.gdl-lam-head', gameIcon: '.gdl-lam-game-icon',
      progress: '.gdl-lam-progressbox', tabs: '.gdl-lam-tabs', search: '.gdl-lam-search',
      compare: '.gdl-lam-compare', firstRow: '.gdl-lam-row', secondRow: '.gdl-lam-row:nth-child(2)', icon: '.gdl-lam-row-icon-frame',
    }).map(([key, selector]) => [key, rect(selector)]));
    near(geometry.window.x, 729, 'Window left'); near(geometry.window.y, 169, 'Window top'); near(geometry.window.width, 1020, 'Window width');
    near(geometry.header.y, 169, 'Header top'); near(geometry.header.bottom, 397, 'Header bottom');
    near(geometry.gameIcon.width, 40, 'Game icon width'); near(geometry.gameIcon.height, 40, 'Game icon height');
    near(geometry.progress.x, 760, 'Progress left'); near(geometry.progress.y, 249, 'Progress top');
    near(geometry.progress.width, 959, 'Progress width'); near(geometry.progress.height, 75, 'Progress height');
    near(geometry.tabs.y, 339, 'Tabs top'); near(geometry.tabs.bottom, 382, 'Tabs bottom');
    near(geometry.search.x, 1146, 'Search left'); near(geometry.search.y, 407, 'Search top');
    near(geometry.search.width, 275, 'Search width'); near(geometry.search.height, 52, 'Search height');
    check(Boolean(geometry.compare), 'Compare achievements control exists');
    near(geometry.compare.x, 1434, 'Compare left'); near(geometry.compare.width, 275, 'Compare width');
    near(geometry.firstRow.x, 755, 'Row left'); near(geometry.firstRow.y, 469, 'Row top');
    near(geometry.firstRow.width, 954, 'Row width'); near(geometry.firstRow.height, 100, 'Row height');
    near(geometry.secondRow.y - geometry.firstRow.bottom, 10, 'Row gap');
    near(geometry.icon.width, 60, 'Achievement icon width'); near(geometry.icon.height, 60, 'Achievement icon height');
    check(document.querySelector('.gdl-lam-progressline').textContent.includes('41') && document.querySelector('.gdl-lam-progressline').textContent.includes('52'), 'Progress shows 41 of 52 achievements');
    check(document.querySelector('.gdl-lam-progressline').textContent.includes('41 de 52 logros conseguidos')
      && document.querySelector('[data-tab="global"]').textContent === 'Logros mundiales'
      && document.querySelector('.gdl-lam-compare').options[0].textContent === 'Comparar con...',
    'Header, global tab and comparison control preserve exact native LATAM wording');
    check(Array.from(document.querySelectorAll('.gdl-lam-row-title')).slice(0, 4).map(element => element.textContent).join('|') === 'Consumed|Regenerated|Woven|Extended', 'Mine tab preserves the native reference ordering');
    const search = document.querySelector('.gdl-lam-search'); search.value = 'Woven'; search.dispatchEvent(new Event('input', { bubbles: true }));
    check(document.querySelectorAll('.gdl-lam-row').length === 1 && document.querySelector('.gdl-lam-row-title').textContent === 'Woven', 'Search filters achievement rows');
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-tab="global"]').click();
    check(document.querySelector('[data-tab="global"]').classList.contains('active') && document.querySelector('.gdl-lam-row-right').textContent.includes('%'), 'Global tab activates and shows percentage values');
    document.querySelector('[data-tab="mine"]').click();
    const comparison = document.querySelector('.gdl-lam-compare');
    const selectFriend = value => { comparison.value = value; comparison.dispatchEvent(new Event('change', { bubbles: true })); };
    check(comparison.options.length === 2 && comparison.options[1].textContent === 'Amiga real', 'Compare options use the friend provider response');
    selectFriend(comparisonSteamid); await wait(30);
    const comparisonMarks = Array.from(document.querySelectorAll('.gdl-lam-comparison-friend span')).slice(0, 3).map(element => element.textContent);
    check(comparisonMarks.join('|') === '✓|○|—', 'Comparison renders confirmed earned/locked states and keeps absent achievement IDs unknown');
    selectFriend('');
    comparisonMode = 'pending'; selectFriend(comparisonSteamid);
    check(!document.querySelector('.gdl-lam-comparison-status').hidden && document.querySelector('.gdl-lam-comparison-status').textContent.includes('Cargando'), 'A selected friend displays localized loading while its request is pending');
    selectFriend(''); resolveComparison(new Map([[fixtureData.achievements[0].name, { earned: true, earnedTime: 1, progress: 1 }]]));
    await wait(30);
    check(document.querySelectorAll('.gdl-lam-comparison-friend').length === 0, 'A late comparison response cannot restore a cleared selection');
    comparisonMode = 'error'; selectFriend(comparisonSteamid); await wait(30);
    check(!document.querySelector('.gdl-lam-comparison-status').hidden
      && document.querySelector('.gdl-lam-comparison-status').textContent.includes('privados')
      && document.querySelectorAll('.gdl-lam-comparison-friend').length === 0,
    'Private/unavailable friend results show an explicit state without fabricating achievement rows');
    selectFriend(''); comparisonMode = 'success';
    check(comparisonRequests === 3, 'Comparison requests run on selection changes without repeated row-render requests');
    const list = document.querySelector('.gdl-lam-scroll'); list.scrollTop = 240;
    check(list.scrollTop > 0 && list.scrollHeight > list.clientHeight, 'Rows scroll inside the achievements sheet');
    document.getElementById('gdl-local-achievement-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(!document.getElementById('gdl-local-achievement-modal'), 'Escape closes the sheet');
    await open(); document.querySelector('.gdl-lam-close').click();
    check(!document.getElementById('gdl-local-achievement-modal'), 'Close control removes the sheet');
    await open();
    window.__achievementModalResize = async () => {
      const pane = document.getElementById('gdl-library-injected');
      Object.assign(pane.style, { left: '360px', top: '60px', width: '840px', height: '640px' });
      window.dispatchEvent(new Event('resize')); await wait(80);
      const modal = document.querySelector('.gdl-lam-window').getBoundingClientRect();
      const overlay = document.getElementById('gdl-local-achievement-modal').getBoundingClientRect();
      return { ok: Math.abs(overlay.left - 360) <= 1 && Math.abs(overlay.top - 60) <= 1
        && modal.left >= overlay.left && modal.right <= window.innerWidth + 1 && modal.bottom <= window.innerHeight + 1,
      modal: { x: modal.x, y: modal.y, width: modal.width, height: modal.height },
      overlay: { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height } };
    };
    const output = document.createElement('pre'); output.id = 'achievement-modal-result'; output.hidden = true;
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, geometry,
      mediumFontLoaded: document.fonts.check('500 16px "Motiva Sans"') }); document.body.appendChild(output);
  } catch (error) {
    const output = document.createElement('pre'); output.id = 'achievement-modal-result'; output.hidden = true;
    output.textContent = JSON.stringify({ ok: false, results, geometry, error: String(error.stack || error) }); document.body.appendChild(output);
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'achievement-modal-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'achievement-modal.png');
const profile = path.join(scratch, 'edge-profile');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Motiva Sans";src:url('${fontUrls.regular}') format('truetype');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Motiva Sans";src:url('${fontUrls.medium}') format('truetype');font-weight:500;font-style:normal;font-display:swap}
@font-face{font-family:"Motiva Sans";src:url('${fontUrls.bold}') format('truetype');font-weight:700;font-style:normal;font-display:swap}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171d25;font-family:Arial,sans-serif}#steam-top{height:78.4px;background:#171d25;color:#b8bcbf;padding:20px;box-sizing:border-box}#steam-sidebar{position:absolute;left:0;top:78.4px;bottom:49.6px;width:446.4px;background:#252a33;color:#aab2be;padding:18px;box-sizing:border-box;line-height:32px}#gdl-library-injected{position:absolute;left:446.4px;top:78.4px;width:1089.6px;height:688px;background:#1d242f url('${assets.hero}') center/cover no-repeat}#steam-bottom{position:absolute;left:0;bottom:0;height:49.6px;width:100%;background:#151a22}
</style></head><body class="DesktopUI"><div id="steam-top">Steam　 Ver　 Amigos　 Juegos　 Ayuda<br>BIBLIOTECA　 COMUNIDAD</div><aside id="steam-sidebar">TODOS (49)<br>Hollow Knight<br>Hollow Knight: Silksong</aside><div id="gdl-library-injected"></div><div id="steam-bottom"></div></body></html>`;
fs.writeFileSync(htmlPath, html);
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.resume();
let browserError; child.on('error', error => { browserError = error; });
let socket;
let report;
try {
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(endpointFile) && Date.now() < deadline) { if (browserError) throw browserError; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(fs.existsSync(endpointFile), 'Edge did not publish its local debugging endpoint');
  const port = fs.readFileSync(endpointFile, 'utf8').trim().split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const target = targets.find(item => item.type === 'page'); socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!pending.has(message.id)) return; const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1536, height: 816, deviceScaleFactor: 1.25, mobile: false });
  const evaluated = await call('Runtime.evaluate', { expression: `(${browserChecks.toString()})(${serialize(sources)},${serialize(fixtureData)},${serialize(assets)}).then(() => JSON.parse(document.getElementById('achievement-modal-result').textContent))`, awaitPromise: true, returnByValue: true });
  assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails)); report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1533.6, height: 816, scale: 1 } });
  fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
  if (report.ok) {
    await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 1.25, mobile: false });
    const resized = await call('Runtime.evaluate', { expression: 'window.__achievementModalResize()', awaitPromise: true, returnByValue: true });
    report.resized = resized.result.value;
    if (!report.resized.ok) { report.ok = false; report.error = `Resized sheet escapes its library pane: ${JSON.stringify(report.resized)}`; }
    else { report.results.push('Window and library pane resizing preserve the sheet bounds'); report.checks++; }
  }
  fs.writeFileSync(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2));
} finally { socket?.close(); child.kill(); }
assert.ok(report.ok, `${report.error}\nGeometry: ${JSON.stringify(report.geometry)}\nFixture: ${htmlPath}`);
console.log(`Achievement modal browser passed: ${report.checks} geometry and interaction assertions at 1917×1020 physical pixels / Steam 125% scale.`);
console.log(`Motiva Sans medium loaded: ${report.mediumFontLoaded}`);
console.log(`Screenshot: ${screenshot}`);
