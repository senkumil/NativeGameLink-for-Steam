import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

// Exercise the shipped renderer and CSS, including the native floated sidebar.
// Video posters deliberately have different source ratios: both must remain 16:9.
const sources = Object.fromEntries(Object.entries({
  ui: process.env.COMMUNITY_VIEW_SOURCE || 'frontend/features/library/community-view.ts',
  order: 'frontend/features/library/community-order.ts',
  style: 'frontend/features/library/styles/community.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const steamCss = process.env.STEAM_PLAYBAR_CSS || 'C:/Program Files (x86)/Steam/steamui/css/sp.css';
assert(fs.existsSync(steamCss), 'Installed Steam CSS is required for the video-cell contract');
const scratch = fs.mkdtempSync(path.resolve('scratch/community-video-cells-'));
const html = path.join(scratch, 'fixture.html');
fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss)}"><style>body{margin:16px;background:#24282f;color:#dcdedf;font-family:"Motiva Sans",Arial,sans-serif}</style></head><body class="DesktopUI"></body></html>`);
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.goto(pathToFileURL(html).href);
  const result = await page.evaluate(async sources => {
    let checks = 0;
    const check = (condition, label) => { if (!condition) throw Error(label); checks++; };
    const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => requestAnimationFrame(resolve)); };
    const noop = () => {};
    const translation = { steamLanguageSync: () => 'spanish', gdlText: (_key, text) => text, loc: (_key, text) => text };
    const text = { escapeHtml: value => String(value).replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';') };
    const load = (source, require) => { const exports = {}; new Function('exports', 'require', source)(exports, require); return exports; };
    const order = load(sources.order, () => {});
    const ui = load(sources.ui, name => ({
      '../../steam/localization': translation, '../../core/text': text,
      '../../api/backend': { backendLog: noop },
      '../../steam/navigation': { extractCommunityYoutubeId: item => item.youtube_id || null },
      '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: async (_doc, _key, callback) => callback() },
      './community-order': order,
    }[name]));
    const style = load(sources.style, () => ({ injectLibraryStyle: (doc, _id, css) => {
      const node = doc.createElement('style'); node.textContent = css; doc.head.append(node);
    } }));
    style.ensureCommunityStyles(document);
    const poster = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="48%" text-anchor="middle" fill="#dcdedf" font-family="Arial" font-size="30">Contenido de la comunidad</text></svg>`);
    const videos = [
      { type: 'video', image: poster(640, 360, '#394e63'), title: 'Primer vídeo de la comunidad', author_name: 'Primer autor', youtube_id: 'sample00001' },
      { type: 'video', image: poster(800, 600, '#465e50'), title: 'Segundo vídeo de la comunidad', author_name: 'Segundo autor', youtube_id: 'sample00002' },
    ];
    const createFixture = async floated => {
      const host = document.createElement('div');
      host.style.width = '1000px';
      if (floated) {
        host.className = '_27RcNu8aXKBpYkHcNNrt-X';
        host.innerHTML = '<div class="OhSdLYuggDtBcWjYP0j_9"><aside class="_2aor4XVOYzN1PBSREk0UbO" style="height:900px"><div style="padding:16px;background:#30343b">Grabaciones y capturas de pantalla</div></aside><main class="_1sZgBDTw5NH-yuVDZK1SUU"><div id="gdl-main-content-stack" style="display:flex;flex-direction:column;width:calc(67% - 32px)"><div style="height:80px;flex:none">Actividad</div></div></main></div>';
      } else {
        host.innerHTML = '<main><div style="height:24px">Actividad</div></main>';
      }
      document.body.append(host);
      const main = host.querySelector('main'), sidebar = host.querySelector('aside');
      const activity = floated ? main.firstElementChild.firstElementChild : main.firstElementChild;
      const root = ui.insertCommunitySection(document, { sidebarColumn: sidebar, contentColumn: main, twoColumnRow: main.parentElement }, activity, ui.renderCommunityContentHtml({}, videos));
      const cards = [...root.querySelectorAll('[data-gdl-community-card]')];
      const images = cards.map(card => card.querySelector('img'));
      for (const image of images) image.loading = 'eager';
      await Promise.all(images.map(image => image.decode().catch(noop)));
      // A local browsing context verifies playback survives real DOM row moves.
      const thumb = cards[0].querySelector('.gdl-community-video-thumb');
      const player = document.createElement('iframe');
      player.className = 'gdl-community-video-frame';
      player.srcdoc = '<!doctype html><body style="margin:0;background:#394e63;color:#dcdedf;font:18px Arial;display:grid;place-content:center;height:100vh"><span id="playback-marker">Reproduciendo vídeo</span></body>';
      await new Promise(resolve => { player.onload = resolve; thumb.append(player); });
      const playbackDocument = player.contentDocument;
      await settle();
      return { host, root, cards, images, sidebar, player, thumb, playbackDocument };
    };
    const verify = async (fixture, width, label) => {
      const { host, root, cards, images, sidebar, player, thumb, playbackDocument } = fixture;
      host.style.width = width + 'px';
      // Native Steam collapses its sidebar at narrow widths; retain the full feed.
      if (sidebar) sidebar.style.display = width < 560 ? 'none' : '';
      window.dispatchEvent(new Event('resize'));
      await settle();
      const header = root.querySelector('.gdl-community-native-header').getBoundingClientRect();
      const boxes = cards.map(card => card.getBoundingClientRect());
      const bounds = root.getBoundingClientRect();
      const first = Math.min(...boxes.map(box => box.top));
      check(first - header.bottom >= 15.9 && first - header.bottom <= 16.2,
        `${label}/${width}: header has a visible 16px gap before content (${first - header.bottom})`);
      check(cards.every(card => {
        const style = getComputedStyle(card);
        return style.position !== 'absolute' && !card.style.height && !card.style.width
          && !card.style.top && !card.style.left
          && (style.gridColumnEnd === 'span 1' || style.gridColumnStart === 'span 1');
      }),
        `${label}/${width}: each video participates in one native grid cell`);
      for (const card of cards) {
        const media = card.querySelector('.gdl-community-video-thumb').getBoundingClientRect();
        check(Math.abs(media.height - media.width * 9 / 16) <= 1.1,
          `${label}/${width}: the poster and player preserve a 16:9 viewport`);
        const footer = card.querySelector('.gdl-community-author-bar').getBoundingClientRect();
        check(Math.abs(footer.top - media.bottom) <= 1.1
          && Math.abs(card.getBoundingClientRect().bottom - footer.bottom) <= 1.1,
          `${label}/${width}: the video ends directly after its media and author without a gray filler area`);
      }
      check(boxes.every(box => box.left >= bounds.left - .1 && box.right <= bounds.right + .1 && box.width > 0),
        `${label}/${width}: both video cells fit inside the responsive feed`);
      const overlapWidth = Math.min(boxes[0].right, boxes[1].right) - Math.max(boxes[0].left, boxes[1].left);
      const overlapHeight = Math.min(boxes[0].bottom, boxes[1].bottom) - Math.max(boxes[0].top, boxes[1].top);
      check(overlapWidth <= .1 || overlapHeight <= .1, `${label}/${width}: the two video cells never overlap`);
      const row = cards[0].parentElement;
      const columns = getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length;
      if (columns >= 2) {
        check(cards[1].parentElement === row && Math.abs(boxes[0].top - boxes[1].top) <= .1,
          `${label}/${width}: two separate contents share every row that can fit two cells`);
        const columnWidth = (row.getBoundingClientRect().width - (columns - 1) * 24) / columns;
        check(boxes.every(box => Math.abs(box.width - columnWidth) <= 1.1),
          `${label}/${width}: neither video expands into the second cell`);
        check(Math.abs(boxes[1].left - boxes[0].right - 24) <= 1.1,
          `${label}/${width}: neighboring contents retain their 24px gutter`);
      }
      if (sidebar && width >= 560) {
        check(Boolean(root.querySelector('.gdl-community-leading-row')),
          `${label}/${width}: videos use the real leading-row layout beside the float`);
        const side = sidebar.getBoundingClientRect();
        check(boxes.every(box => box.right <= side.left + 1.1 || box.top >= side.bottom - 1.1),
          `${label}/${width}: no content intrudes into the native sidebar`);
      }
      check(cards.every((card, index) => card.querySelector('img') === images[index])
        && root.querySelectorAll('[data-gdl-community-card]').length === 2,
        `${label}/${width}: resize preserves both cards and original posters`);
      check(thumb.querySelector('iframe') === player && player.contentDocument === playbackDocument
        && playbackDocument.getElementById('playback-marker'),
        `${label}/${width}: resizing preserves the actual playing document`);
      return { width, columns, cards: boxes.map(box => ({ width: box.width, top: box.top - first })) };
    };
    const geometry = [];
    const plain = await createFixture(false);
    for (const width of [560, 760, 1000, 320, 1000]) geometry.push(await verify(plain, width, 'full-width'));
    ui.disposeCommunitySection(plain.root); plain.host.remove();
    const floated = await createFixture(true);
    for (const width of [560, 760, 1000, 320, 1000]) geometry.push(await verify(floated, width, 'native-sidebar'));
    window.__videoCellsFixture = { ui, ...floated };
    return { checks, geometry };
  }, sources);
  const screenshot = path.join(scratch, 'community-video-cells.png');
  await page.screenshot({ path: screenshot });
  await page.evaluate(async () => {
    const { ui, host, root } = window.__videoCellsFixture;
    ui.disposeCommunitySection(root);
    const markup = root.outerHTML;
    host.style.width = '560px'; window.dispatchEvent(new Event('resize'));
    for (let index = 0; index < 8; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    if (root.outerHTML !== markup) throw Error('Disposed video-cell layout continues mutating the section');
  });
  result.checks++;
  assert(result.checks >= 90);
  console.log(`Community video cells browser passed: ${result.checks} checks; single-cell videos, two contents per available row, 16px heading gap, native float, 320px fit, 16:9 posters, stable player document and disposal.`);
  console.log('Screenshot: ' + screenshot);
} finally { await browser.close(); }
