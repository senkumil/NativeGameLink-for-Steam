// Measure final logo positions with this Steam client's own CSS and pin algorithm.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || [
  'C:/Program Files (x86)/Steam/steamui/css/sp.css',
  'C:/Program Files (x86)/Steam/steamui/css/chunk~2dcc5aaf7.css',
].find(filename => fs.existsSync(filename));
const steamBundle = process.env.STEAM_UI_BUNDLE || 'C:/Program Files (x86)/Steam/steamui/sp.js';
for (const filename of [edge, steamCss, steamBundle]) assert(filename && fs.existsSync(filename), `Missing fixture dependency: ${filename}`);
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(steamBundle, 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const headerFactory = Object.values(factories).map(String).find(source => source.includes('nBottomPct') && source.includes('BoxSizerValidRegion') && source.includes('pinnedPosition'));
const storeFactory = Object.values(factories).map(String).find(source => source.includes('async SaveCustomLogoPosition('));
assert(headerFactory && storeFactory, 'Installed native TopCapsule and logo store contracts are required');
let anchorSource, nativeSaveSource;
for (const [source, name] of [[headerFactory, 'header'], [storeFactory, 'store']]) {
  const ast = ts.createSourceFile(name + '.js', `const factory=${source};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.body?.getText(ast).includes('switch(')
      && ['nBottomPct:', 'nTopPct:', 'nLeftPct:', 'nRightPct:'].every(key => node.body.getText(ast).includes(key))) anchorSource = node.getText(ast);
    if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === 'SaveCustomLogoPosition') nativeSaveSource = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
assert(anchorSource && nativeSaveSource, 'Native logo anchor and save methods are inspectable');
const anchorAlias = anchorSource.match(/case (\w+)\.Pk:/)?.[1];
const defaultMatch = headerFactory.match(/pinnedPosition:\w+\.Pk,nWidthPct:(\d+),nHeightPct:(\d+)/);
assert(defaultMatch, 'Find Steam TopCapsule’s own fallback dimensions');
const nativeDefault = { pinnedPosition: 'BottomLeft', nWidthPct: Number(defaultMatch[1]), nHeightPct: Number(defaultMatch[2]) };
const classFactory = Object.values(factories).find(factory => /^\w+=>\{\w+\.exports=\{/.test(String(factory))
  && ['BoxSizerValidRegion:', 'TitleLogo:', 'TopCapsule:'].every(key => String(factory).includes(key)));
assert(classFactory, 'Installed pure TopCapsule class map is required');
const classModule = { exports: {} }; classFactory(classModule); const nativeClasses = classModule.exports;
const nativeSaveAliases = { cache: nativeSaveSource.match(/(\w+)\.O\.SetCachedDataForApp/)?.[1],
  version: nativeSaveSource.match(/nVersion:(\w+)/)?.[1],
  key: nativeSaveSource.match(/SetCachedDataForApp\([^,]+,(\w+),/)?.[1],
  cacheVersion: nativeSaveSource.match(/SetCachedDataForApp\([^,]+,\w+,(\w+),/)?.[1] };
assert(Object.values(nativeSaveAliases).every(Boolean), 'Native logo save closure contract is inspectable');
for (const alias of [nativeSaveAliases.version, nativeSaveAliases.cacheVersion]) {
  assert(new RegExp(`\\b${alias}=1(?:[,;])`).test(storeFactory), 'The installed native logo/cache version is one');
}
assert(storeFactory.includes(`${nativeSaveAliases.key}="customimage"`), 'The installed native logo cache key is customimage');
const sources = Object.fromEntries(['logo-layout', 'artwork-logo-position', 'native-logo-position', 'steam-bridge', 'asset-deadline', 'asset-write', 'native-asset-write'].map(name => [name,
  ts.transpileModule(fs.readFileSync(path.join(root, `frontend/features/library/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
]));
const dbzLogo = 'C:/Program Files (x86)/Steam/userdata/860367772/config/grid/4084967508_logo.png';
const localLogo = fs.existsSync(dbzLogo) ? `data:image/png;base64,${fs.readFileSync(dbzLogo).toString('base64')}` : null;

async function browserChecks({ sources, anchorSource, anchorAlias, nativeDefault, nativeClasses: cls, nativeSaveSource, nativeSaveAliases, localLogo }) {
  const results = [], geometry = [], modules = {}, overviews = new Map(), nativeCache = new Map(), disk = new Map();
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const near = (left, right) => Math.abs(left - right) < .12;
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const counters = { diskReads: 0, diskWrites: 0, bridgeWrites: 0, cacheWrites: 0, layoutReads: 0 };
  const anchor = new Function(anchorAlias, `return (${anchorSource});`)({ Pk: 'BottomLeft', QG: 'UpperLeft', NO: 'CenterCenter', Ag: 'UpperCenter', Fv: 'BottomCenter' });
  const dependencies = {
    '../../api/backend': {
      backendLog() {},
      async readCustomLogoPositionBackend({ shortcut_app_id }) {
        counters.diskReads++; const position = disk.get(Number(shortcut_app_id));
        return JSON.stringify({ ok: true, exists: Boolean(position), logo_position: position });
      },
      async saveCustomLogoPositionBackend({ request_json }) {
        counters.diskWrites++; const body = JSON.parse(request_json);
        disk.set(Number(body.shortcut_app_id), body.logo_position); return JSON.stringify({ ok: true });
      },
      async readLogoLayoutImagesBackend() { counters.layoutReads++; throw new Error('Automatic native sizing must not decode or analyze logo/hero contents'); },
    },
    '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: { captureRuntime() {}, getRequire() { return null; } } },
  };
  window.SteamClient = { Apps: { async SetCustomLogoPositionForApp(id, json) {
    check(this === window.SteamClient.Apps && id >= 2147483648, 'The native bridge receives only the exact shortcut target');
    counters.bridgeWrites++; const body = JSON.parse(json); disk.set(id, body.logoPosition);
  } } };
  window.appStore = { GetAppOverviewByAppID: id => overviews.get(id) };
  window.appDetailsStore = {
    GetAppData(id) { check(id >= 2147483648, 'Native cache lookup never targets a public game');
      if (!nativeCache.has(id)) nativeCache.set(id, {}); return nativeCache.get(id); },
    SaveCustomLogoPosition: new Function('SteamClient', nativeSaveAliases.cache, nativeSaveAliases.key, nativeSaveAliases.version,
      nativeSaveAliases.cacheVersion, `return ({${nativeSaveSource}}).SaveCustomLogoPosition;`)(window.SteamClient,
      { O: { SetCachedDataForApp(id, key, version) {
        check(id >= 2147483648 && key === 'customimage' && version === 1, 'Steam persists its own exact-shortcut position cache'); counters.cacheWrites++;
      } } }, 'customimage', 1, 1),
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const target = dependency.split('/').pop();
      if (target in sources) return load(target);
      throw new Error(`Unexpected ${name} dependency ${dependency}`);
    }, exports); return exports;
  };
  const logoData = (width, height, color) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#dcdedf'; context.lineWidth = Math.max(2, height / 25); context.strokeRect(1, 1, width - 2, height - 2);
    return canvas.toDataURL('image/png');
  };
  const createHeader = async (id, position, src, title) => {
    const card = document.createElement('section'); card.className = 'fixture-card';
    const label = document.createElement('h3'); label.textContent = title; card.append(label);
    const host = document.createElement('div'); host.className = 'header-host'; host.style.cssText = 'position:relative;isolation:isolate;width:1200px;height:320px';
    const capsule = document.createElement('div'); capsule.className = cls.TopCapsule; capsule.style.setProperty('--header-height', '400px');
    const container = document.createElement('div'); container.className = cls.BoxSizerContainer;
    const region = document.createElement('div'); region.className = cls.BoxSizerValidRegion;
    const box = document.createElement('div'); box.className = `${cls.BoxSizer} ${cls[position.pinnedPosition]}`;
    const bounds = anchor(position.pinnedPosition, position.nWidthPct, position.nHeightPct);
    Object.assign(box.style, { left: `${bounds.nLeftPct}%`, top: `${bounds.nTopPct}%`, width: `${position.nWidthPct}%`, height: `${position.nHeightPct}%` });
    const imageContainer = document.createElement('div'); imageContainer.className = cls.TitleImageContainer;
    const image = new Image(); image.src = src; await image.decode(); image.className = `${cls.TitleLogo} ${cls.Loaded}`;
    imageContainer.append(image); box.append(imageContainer); region.append(box); container.append(region); capsule.append(container); host.append(capsule); card.append(host);
    card.dataset.appId = String(id); document.getElementById('fixture').append(card);
    return { card, host, capsule, container, region, box, image, source: src, position };
  };
  const resize = (header, width) => {
    header.host.style.width = `${width}px`; header.host.style.height = `${Math.min(width / 3, 320)}px`;
    header.capsule.style.setProperty('--header-height', `${width / 3}px`);
  };
  const measure = header => {
    const host = header.capsule.getBoundingClientRect(), region = header.region.getBoundingClientRect(), box = header.box.getBoundingClientRect();
    const image = header.image.getBoundingClientRect();
    const scale = Math.min(image.width / header.image.naturalWidth, image.height / header.image.naturalHeight);
    return { region: { x: region.left - host.left, y: region.top - host.top, width: region.width, height: region.height },
      box: { x: box.left - region.left, y: box.top - region.top, width: box.width, height: box.height },
      image: { x: image.left - region.left, y: image.top - region.top, width: image.width, height: image.height },
      painted: { width: header.image.naturalWidth * scale, height: header.image.naturalHeight * scale },
      host: { width: host.width, height: host.height } };
  };
  try {
    const layout = load('logo-layout'), positions = load('artwork-logo-position');
    check(equal(layout.STEAM_DEFAULT_LOGO_POSITION, nativeDefault), 'Plugin fallback exactly equals the installed TopCapsule BottomLeft 50×50 default');
    const native = await createHeader(1030300, nativeDefault, logoData(600, 150, '#536e90'), 'Native Steam game · protected');
    const nativeMarkup = native.card.outerHTML;
    const nativeMutations = [], protectedObserver = new MutationObserver(records => nativeMutations.push(...records));
    protectedObserver.observe(native.card, { attributes: true, childList: true, characterData: true, subtree: true });
    const cases = [
      { game: '1790600', title: 'DRAGON BALL · official', raw: { pinned_position: 'BottomLeft', width_pct: 50, height_pct: 71.40030514949518 } },
      { game: '1091500', title: 'Cyberpunk · official', raw: { pinned_position: 'BottomCenter', width_pct: 31.631133954793142, height_pct: 99.68523781140851 } },
      { game: '999991', title: 'No official metadata · native default', raw: null },
      { game: '999992', title: 'Upper left', raw: { pinned_position: 'UpperLeft', width_pct: 42.25, height_pct: 68.75 } },
      { game: '999993', title: 'Centered', raw: { pinned_position: 'CenterCenter', width_pct: 60, height_pct: 60 } },
      { game: '999994', title: 'Upper center', raw: { pinned_position: 'UpperCenter', width_pct: 48, height_pct: 40 } },
    ];
    const shapes = [{ name: 'wide', width: 800, height: 180, color: '#4f9baf' }, { name: 'square', width: 400, height: 400, color: '#a270ae' }, { name: 'tall', width: 180, height: 700, color: '#739e70' }];
    let id = 3300000000;
    const visible = [];
    for (const item of cases) {
      id++; overviews.set(id, Object.freeze({ appid: id, rt_custom_image_mtime: 51 }));
      const expected = item.raw ? { pinnedPosition: item.raw.pinned_position, nWidthPct: item.raw.width_pct, nHeightPct: item.raw.height_pct } : nativeDefault;
      check(await positions.applyLogoPosition(id, item.game, item.raw, false, 'BottomLeft', 'native_official', () => true), `${item.title}: final position resolves before rendering`);
      check(equal(nativeCache.get(id)?.customImageInfo?.logoPosition, expected), `${item.title}: Steam cache receives precise per-game percentages`);
      check(equal(disk.get(id), expected), `${item.title}: persisted grid position matches the cached position`);
      for (const shape of shapes) {
        const src = item.game === '1790600' && shape.name === 'wide' && localLogo ? localLogo : logoData(shape.width, shape.height, shape.color);
        const header = await createHeader(id, expected, src, `${item.title} · ${shape.name}`);
        const first = measure(header), style = getComputedStyle(header.image);
        check(near(first.region.x, 26) && near(first.region.y, 16) && near(first.region.width, first.host.width - 52) && near(first.region.height, first.host.height - 32),
          `${item.title}/${shape.name}: use Steam’s exact 26/16px valid region`);
        check(style.objectFit === 'contain' && style.maxWidth === '100%' && style.maxHeight === '100%', `${item.title}/${shape.name}: native CSS contains the original aspect ratio`);
        check(header.image.src === src && header.image.naturalWidth > 0 && header.image.naturalHeight > 0, `${item.title}/${shape.name}: the logo source is neither replaced nor resampled`);
        const seen = new Map();
        for (const zoom of [1, .75, 1.25, 1.5, 2]) for (const width of [1200, 800, 400, 1200, 400, 800, 1200]) {
          header.host.style.zoom = String(zoom);
          resize(header, width); const measured = measure(header), nativeBounds = anchor(expected.pinnedPosition, expected.nWidthPct, expected.nHeightPct);
          check(near(measured.box.x, measured.region.width * nativeBounds.nLeftPct / 100)
            && near(measured.box.y, measured.region.height * nativeBounds.nTopPct / 100)
            && near(measured.box.width, measured.region.width * expected.nWidthPct / 100)
            && near(measured.box.height, measured.region.height * expected.nHeightPct / 100), `${item.title}/${shape.name}/${width}: box agrees with the installed native pin algorithm`);
          check(measured.painted.width <= measured.box.width + .12 && measured.painted.height <= measured.box.height + .12,
            `${item.title}/${shape.name}/${width}: logo fits its final native box`);
          const key = `${zoom}:${width}`;
          if (seen.has(key)) check(equal(measured, seen.get(key)), `${item.title}/${shape.name}/${width}/${zoom}: returning to the same width and zoom gives exactly the same geometry`);
          else seen.set(key, measured);
        }
        header.host.style.zoom = ''; resize(header, 1200);
        check(equal(first, measure(header)), `${item.title}/${shape.name}: repeated resize produces no size or position drift`);
        if (shape.name === 'wide') { visible.push(header); geometry.push({ title: item.title, pin: expected.pinnedPosition, position: expected, measurement: first }); }
        else header.card.remove();
      }
      const before = JSON.stringify(counters);
      for (let count = 0; count < 100; count++) check(await positions.applyLogoPosition(id, item.game, null, false, 'BottomLeft', 'sync', () => true), 'Repeated automatic sync accepts the already final layout');
      check(JSON.stringify(counters) === before, `${item.title}: 100 later syncs cause zero disk/bridge/cache/layout operations`);
    }
    const beforeNativeAttempt = JSON.stringify(counters);
    check(!await positions.applyLogoPosition(1030300, '1030300', { pinned_position: 'BottomCenter', width_pct: 80, height_pct: 80 }, true, 'BottomLeft', 'native_official', () => true),
      'Public Steam game is rejected before any layout operation');
    check(JSON.stringify(counters) === beforeNativeAttempt, 'Public game attempts perform no storage, cache or bridge operations');
    await frame(); await frame();
    nativeMutations.push(...protectedObserver.takeRecords()); protectedObserver.disconnect();
    check(nativeMutations.length === 0 && native.card.outerHTML === nativeMarkup, 'Native game header remains byte-for-byte intact with zero mutations');
    check(counters.layoutReads === 0, 'Automatic positions perform no logo decoding, trimming or hero content analysis');
    for (const header of visible) { resize(header, 680); header.host.style.width = '100%'; }
    native.card.remove();
    const output = document.createElement('pre'); output.id = 'logo-layout-result'; output.style.display = 'none';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, geometry, counters }); document.body.append(output);
  } catch (error) {
    const output = document.createElement('pre'); output.id = 'logo-layout-result';
    output.textContent = JSON.stringify({ ok: false, results, geometry, counters, error: String(error.stack || error) }); document.body.append(output);
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'logo-layout-'));
const htmlPath = path.join(scratch, 'fixture.html'), screenshot = path.join(scratch, 'native-logo-layout.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:20px;background:#1b2027;color:#dcdedf;font-family:Arial,sans-serif}h2{margin:0 0 18px}#fixture{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.fixture-card{overflow:hidden;border:1px solid #414a56}.fixture-card h3{font-size:14px;margin:12px}.header-host{background:linear-gradient(125deg,#253842,#3d263b);overflow:hidden}.header-host .${nativeClasses.TopCapsule}{position:relative}</style>
</head><body class="DesktopUI"><h2>Logo layout · native Steam CSS and exact per-game positions</h2><div id="fixture"></div><script>(${browserChecks.toString()})(${serialize({ sources, anchorSource, anchorAlias, nativeDefault, nativeClasses, nativeSaveSource, nativeSaveAliases, localLogo })});document.currentScript.remove();</script></body></html>`);
const profile = path.join(scratch, 'edge-profile');
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--window-size=1500,1100', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(htmlPath).href],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
  assert(target?.webSocketDebuggerUrl, 'The spawned logo fixture has no debug target');
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
  const evaluated = await call('Runtime.evaluate', { expression: `(async()=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const output=document.getElementById('logo-layout-result');if(output)return JSON.parse(output.textContent);await new Promise(resolve=>setTimeout(resolve,20));}return{ok:false,results:[],error:'Fixture did not finish'};})()`, awaitPromise: true, returnByValue: true });
  assert(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails)); report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert(report.ok, `${report.error}\nPassed: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Logo layout browser passed: ${report.checks} assertions; installed Steam CSS and pin algorithm, exact official/default dimensions, wide/square/tall resize stability, 100 syncs without writes and untouched native header.`);
console.log(JSON.stringify({ geometry: report.geometry, counters: report.counters }));
console.log(`Screenshot: ${screenshot}`);
