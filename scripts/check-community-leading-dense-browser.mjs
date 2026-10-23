import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';
const sources = Object.fromEntries(Object.entries({
 ui: process.env.COMMUNITY_VIEW_SOURCE || 'frontend/features/library/community-view.ts',
 order: 'frontend/features/library/community-order.ts', style: 'frontend/features/library/styles/community.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const kinds = ['portrait', 'panorama', 'video', 'photo', 'guide', 'photo', 'video', 'photo', 'panorama', 'photo', 'photo', 'photo', 'photo', 'video', 'photo', 'photo'];
const steamCss = process.env.STEAM_PLAYBAR_CSS || 'C:/Program Files (x86)/Steam/steamui/css/sp.css';
assert(fs.existsSync(steamCss), 'Installed Steam CSS is required for the dense-row contract');
const scratch = fs.mkdtempSync(path.resolve('scratch/community-leading-dense-'));
const html = path.join(scratch, 'fixture.html');
fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss)}"><style>body{margin:16px;background:#24282f;color:#dcdedf;font-family:"Motiva Sans",Arial,sans-serif}</style></head><body class="DesktopUI"></body></html>`);
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
 await page.goto(pathToFileURL(html).href);
 const result = await page.evaluate(async ({ sources, kinds }) => {
  let checks = 0;
  const check = (condition, label) => { if (!condition) throw Error(label); checks++; };
  const settle = async () => { for (let i = 0; i < 7; i++) await new Promise(resolve => requestAnimationFrame(resolve)); };
  const noop = () => {};
  const translation = { steamLanguageSync: () => 'english', gdlText: (_key, text) => text, loc: (_key, text) => text };
  const text = { escapeHtml: value => String(value).replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';') };
  const load = (source, require) => { const exports = {}; new Function('exports', 'require', source)(exports, require); return exports; };
  const order = load(sources.order, () => {});
  const ui = load(sources.ui, name => ({
   '../../steam/localization': translation, '../../core/text': text, '../../api/backend': { backendLog: noop },
   '../../steam/navigation': { extractCommunityYoutubeId: item => item.youtube_id || null },
   '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: async (_doc, _key, callback) => callback() },
   './community-order': order,
  }[name]));
  const style = load(sources.style, () => ({ injectLibraryStyle: (doc, _id, css) => { const node = doc.createElement('style'); node.textContent = css; doc.head.append(node); } }));
  style.ensureCommunityStyles(document);
  let reveal;
  window.IntersectionObserver = class { constructor(callback) { reveal = callback; } observe() {} disconnect() {} };
  const image = (kind = 'photo') => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${kind === 'panorama' ? 1200 : 640}" height="${kind === 'panorama' ? 300 : kind === 'portrait' ? 1000 : 360}"><rect width="100%" height="100%" fill="${kind === 'panorama' ? '#527e8d' : '#697f55'}"/></svg>`);
  const host = document.createElement('div'); host.className = '_27RcNu8aXKBpYkHcNNrt-X';
  host.innerHTML = '<div class="OhSdLYuggDtBcWjYP0j_9"><aside class="_2aor4XVOYzN1PBSREk0UbO" style="height:12000px">Native sidebar</aside><main class="_1sZgBDTw5NH-yuVDZK1SUU"><div id="gdl-main-content-stack" style="display:flex;flex-direction:column;width:calc(67% - 32px)"><div style="height:1200px;flex:none">Activity</div></div></main></div>';
  document.body.append(host);
  const sidebar = host.querySelector('aside'), main = host.querySelector('main'), activity = main.firstElementChild.firstElementChild;
  const items = kinds.map((kind, index) => ({ type: ['photo', 'panorama', 'portrait'].includes(kind) ? 'screenshot' : kind,
   image: image(kind), title: 'Item ' + index, author_name: 'Author ' + index,
   link: 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + (1000 + index),
   ...(kind === 'video' ? { youtube_id: 'sample' + String(index).padStart(5, '0') } : {}), description: kind === 'guide' ? 'A short guide.' : undefined }));
  // Supply extreme images first: the native opening row must promote regular
  // content while preserving every card and mounted player.
  const staging = document.createElement('div'); staging.innerHTML = ui.renderCommunityContentHtml({}, items);
  const grid = staging.querySelector('.gdl-community-grid');
  const byTitle = new Map([...grid.children].map(card => [card.querySelector('.gdl-community-card-title').textContent, card]));
  items.forEach((item, index) => { const card = byTitle.get(item.title); card.dataset.gdlCommunityCard = String(index); card.hidden = index >= 12; grid.append(card); });
  const root = ui.insertCommunitySection(document, { sidebarColumn: sidebar, contentColumn: main, twoColumnRow: main.parentElement }, activity, staging.innerHTML);
  const all = [...root.querySelectorAll('[data-gdl-community-card]')].sort((a, b) => +a.dataset.gdlCommunityCard - +b.dataset.gdlCommunityCard);
  const images = all.map(card => card.querySelector('img'));
  for (const img of images) img.loading = 'eager';
  await Promise.all(images.map(img => img.decode().catch(noop)));
  // A mounted player's browsing context must survive dense row moves as well.
  const player = document.createElement('iframe'); player.className = 'gdl-community-video-frame';
  player.srcdoc = '<!doctype html><body><span id="playback-marker">playing</span></body>';
  const thumb = all.find(card => card.classList.contains('gdl-community-card-video')).querySelector('.gdl-community-video-thumb');
  await new Promise(resolve => { player.onload = resolve; thumb.append(player); });
  const playbackDocument = player.contentDocument;
  await settle();
  for (const width of [900, 1118.4, 1400, 1750]) for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
   host.style.width = width + 'px'; host.style.zoom = String(zoom); window.dispatchEvent(new Event('resize')); await settle();
   const rows = [...root.querySelectorAll('.gdl-community-leading-row')];
   const row = rows[0], css = getComputedStyle(row);
   const count = css.gridTemplateColumns.split(' ').filter(Boolean).length;
   const bounds = row.getBoundingClientRect(), firstCards = [...row.children];
   const boxes = firstCards.map(card => card.getBoundingClientRect());
   check(count >= 1 && Number.isInteger(count) && rows.length >= 1
     && rows.every(row => getComputedStyle(row).display === 'grid'),
    `${width}/${zoom}: native leading rows own responsive grid columns`);
   check(rows.every(row => {
    const bounds = row.getBoundingClientRect(), boxes = [...row.children].map(card => card.getBoundingClientRect());
    return boxes.every(box => box.left >= bounds.left - 1.2 && box.right <= bounds.right + 1.2)
     && Math.abs(Math.max(...boxes.map(box => box.bottom)) - bounds.bottom) <= 1.2;
   }), `${width}/${zoom}: each row fits inside its available native width`);
   check(rows.every(row => [...row.children].every(card => {
    const box = card.getBoundingClientRect(), bounds = row.getBoundingClientRect();
    return getComputedStyle(card).position !== 'absolute' && !card.style.height && !card.style.width
     && !card.style.top && !card.style.left && Math.abs(box.top - bounds.top) <= 1.2 && Math.abs(box.bottom - bounds.bottom) <= 1.2;
   })), `${width}/${zoom}: cards preserve aligned native row tops and bottoms`);
   check(boxes.every((box, index) => boxes.slice(0, index).every(other => box.right + 24 * zoom <= other.left + 1.2
    || other.right + 24 * zoom <= box.left + 1.2)), `${width}/${zoom}: opening contents preserve the horizontal native gutters`);
   const columnWidth = (bounds.width / zoom - (count - 1) * 24) / count;
   check(firstCards.length === count && boxes.every(box => Math.abs(box.width / zoom - columnWidth) <= 1.2),
    `${width}/${zoom}: distinct regular contents occupy each available opening cell`);
   check(firstCards.every(card => {
    const image = card.querySelector('.gdl-community-media .gdl-community-preview');
    return !image || image.naturalWidth / image.naturalHeight > .8 && image.naturalWidth / image.naturalHeight <= 2.5;
   }), `${width}/${zoom}: portrait and panoramic images are deferred past the opening row`);
   check(all.every((card, index) => card.querySelector('img') === images[index]) && new Set(root.querySelectorAll('[data-gdl-community-card]')).size === all.length,
    `${width}/${zoom}: packing preserves every card and thumbnail identity`);
   check(thumb.querySelector('iframe') === player && player.contentDocument === playbackDocument && playbackDocument.getElementById('playback-marker'),
    `${width}/${zoom}: resizing never reloads the mounted player`);
  }
  host.style.width = '1118.4px'; host.style.zoom = '1';
  for (const card of all) card.hidden = +card.dataset.gdlCommunityCard >= 5;
  window.dispatchEvent(new Event('resize')); await settle();
  const published = all.slice(0, 5).map(card => card.getBoundingClientRect());
  reveal([{ isIntersecting: true }]); await settle();
  check(all.slice(0, 5).every((card, index) => { const box = card.getBoundingClientRect(); return Math.abs(box.top - published[index].top) < 1 && Math.abs(box.left - published[index].left) < 1; }),
   'A new progressive batch does not refill earlier rows or displace a previously published player');
  check(player.contentDocument === playbackDocument, 'Progressive reveal retains the actual playing document');
  const changes = []; const observer = new MutationObserver(records => changes.push(...records));
  observer.observe(root, { attributes: true, childList: true, subtree: true });
  for (let index = 0; index < 100; index++) window.dispatchEvent(new Event('resize'));
  await settle(); changes.push(...observer.takeRecords()); observer.disconnect();
  check(changes.length === 0, '100 unchanged resizes produce no DOM or style writes');
  window.__communityDenseFixture = { ui, root, host };
  return { checks };
 }, { sources, kinds });
 await page.locator('.gdl-community-native-header').scrollIntoViewIfNeeded();
 const screenshot = path.join(scratch, 'leading-dense.png'); await page.screenshot({ path: screenshot });
 await page.evaluate(async () => {
  const { ui, root, host } = window.__communityDenseFixture;
  ui.disposeCommunitySection(root);
  const html = root.outerHTML; host.style.width = '900px'; window.dispatchEvent(new Event('resize'));
  for (let i = 0; i < 7; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  if (root.outerHTML !== html) throw Error('Disposed dense rows stop reacting to layout events');
 });
 result.checks++;
 assert(result.checks >= 80);
 console.log(`Community leading dense browser passed: ${result.checks} checks; native aligned rows, regular opening contents, deferred extreme images, gutters, zoom, stable player documents, progressive batches and disposal.`);
 console.log('Screenshot: ' + screenshot);
} finally { await browser.close(); }
