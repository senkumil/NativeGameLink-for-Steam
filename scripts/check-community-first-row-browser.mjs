import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

// Test the common production layout rather than any particular game's feed.
// Oversized artwork must retain Steam's row/cell spans, but it must not lead
// the feed while enough ordinary screenshots, videos or guides are available.
const sources = Object.fromEntries(Object.entries({
  ui: process.env.COMMUNITY_VIEW_SOURCE || 'frontend/features/library/community-view.ts',
  order: 'frontend/features/library/community-order.ts',
  style: process.env.COMMUNITY_STYLE_SOURCE || 'frontend/features/library/styles/community.ts',
}).map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const steamCss = process.env.STEAM_PLAYBAR_CSS || 'C:/Program Files (x86)/Steam/steamui/css/sp.css';
assert(fs.existsSync(steamCss), 'Installed Steam CSS is required for the first-row contract');
const scratch = fs.mkdtempSync(path.resolve('scratch/community-first-row-'));
const html = path.join(scratch, 'fixture.html');
fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss)}"><style>body{margin:16px;background:#24282f;color:#dcdedf;font-family:"Motiva Sans",Arial,sans-serif}</style></head><body class="DesktopUI"></body></html>`);
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(sources => {
    const noop = () => {};
    const translation = { steamLanguageSync: () => 'spanish', gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback };
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
    const state = { checks: 0, geometry: [] };
    const check = (condition, label) => { if (!condition) throw Error(label); state.checks++; };
    const settle = async () => { for (let index = 0; index < 9; index++) await new Promise(resolve => requestAnimationFrame(resolve)); };
    const image = (width, height, color, label) => 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#192430"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><path d="M0 ${height}L${width} 0" stroke="#dce5ed" stroke-opacity=".3" stroke-width="8"/><text x="50%" y="48%" text-anchor="middle" fill="#dcdedf" font-family="Arial" font-size="26">${label}</text></svg>`);
    const specs = [
      ['portrait', 400, 800, '#987548', 'Ilustración vertical'],
      ['panorama', 1200, 300, '#4e7b8b', 'Panorama'],
      ['video', 480, 360, '#41667a', 'Vídeo de la comunidad'],
      ['photo', 640, 360, '#6a7853', 'Captura horizontal'],
      ['guide', 256, 256, '#596c85', 'Guía de la comunidad'],
      ['photo', 400, 400, '#7e637f', 'Captura cuadrada'],
      ['photo', 800, 600, '#82755b', 'Captura 4:3'],
      ['portrait', 400, 500, '#805b70', 'Imagen vertical en el límite 0.8'],
      ['panorama', 1251, 500, '#427e76', 'Panorama sobre el límite 2.5'],
      ['video', 640, 360, '#536c82', 'Segundo vídeo'],
      ['guide', 256, 256, '#6b7255', 'Segunda guía'],
      ['photo', 640, 360, '#7e6652', 'Otra captura horizontal'],
      ['photo', 640, 360, '#765987', 'Captura revelada después'],
      ['video', 640, 360, '#456b72', 'Vídeo revelado después'],
      ['portrait', 360, 1000, '#887451', 'Ilustración revelada después'],
      ['guide', 256, 256, '#727a5c', 'Guía revelada después'],
    ];
    const avatar = image(32, 32, '#5087b4', '');
    const items = specs.map(([kind, width, height, color, title], index) => ({
      type: kind === 'photo' || kind === 'panorama' ? 'screenshot' : kind === 'portrait' ? 'artwork' : kind,
      image: image(width, height, color, title), title,
      description: kind === 'guide' ? 'Consejos y contenido adicional para la comunidad.' : undefined,
      author_name: 'Autor ' + (index + 1), author_avatar: avatar,
      link: 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + (9000 + index),
      ...(kind === 'video' ? { youtube_id: 'sample' + String(index).padStart(5, '0') } : {}),
    }));
    let reveal;
    window.IntersectionObserver = class { constructor(callback) { reveal = callback; } observe() {} disconnect() {} };
    const createFixture = async (mode, firstKind = 'portrait', appid = 12210, onlyExtremes = false, delayed = false) => {
      const host = document.createElement('div'); host.style.width = '1200px';
      if (mode === 'full-width') host.innerHTML = '<main><div style="height:1800px">Actividad</div></main>';
      else {
        host.className = '_27RcNu8aXKBpYkHcNNrt-X';
        host.innerHTML = '<div class="OhSdLYuggDtBcWjYP0j_9"><aside class="_2aor4XVOYzN1PBSREk0UbO" style="height:12000px"><div style="padding:16px;background:#30343b">Grabaciones y capturas de pantalla</div></aside><main class="_1sZgBDTw5NH-yuVDZK1SUU"><div id="gdl-main-content-stack" style="display:flex;flex-direction:column;width:calc(67% - 32px)"><div style="height:1800px;flex:none">Actividad</div></div></main></div>';
      }
      document.body.append(host);
      const main = host.querySelector('main'), sidebar = host.querySelector('aside');
      const activity = mode === 'full-width' ? main.firstElementChild : main.firstElementChild.firstElementChild;
      let sequence = firstKind === 'panorama' ? [items[1], items[0], ...items.slice(2)] : [...items];
      if (onlyExtremes) sequence = [items[0], items[1], items[7], items[8], items[14]];
      if (firstKind === 'partial') sequence = [items[0], items[1], items[2], items[7], items[8]];
      const staging = document.createElement('div'); staging.innerHTML = ui.renderCommunityContentHtml({ appid }, sequence);
      const grid = staging.querySelector('.gdl-community-grid');
      const byTitle = new Map([...grid.children].map(card => [card.querySelector('.gdl-community-card-title').textContent, card]));
      // The backend's original order deliberately begins with both extreme
      // ratios. Preserve production markup while making that order explicit.
      sequence.forEach((item, index) => {
        const card = byTitle.get(item.title); card.dataset.gdlCommunityCard = String(index);
        card.hidden = index >= 12;
        if (delayed && index < 2) card.querySelector('.gdl-community-preview').removeAttribute('src');
        grid.append(card);
      });
      const root = ui.insertCommunitySection(document, { sidebarColumn: sidebar, contentColumn: main, twoColumnRow: main.parentElement }, activity, staging.innerHTML);
      const cards = [...root.querySelectorAll('[data-gdl-community-card]')].sort((a, b) => +a.dataset.gdlCommunityCard - +b.dataset.gdlCommunityCard);
      const images = cards.map(card => card.querySelector('img'));
      for (const img of root.querySelectorAll('img')) img.loading = 'eager';
      await Promise.all([...root.querySelectorAll('img[src]')].map(img => img.decode().catch(noop)));
      let thumb, player, playbackDocument;
      if (!onlyExtremes) {
        thumb = cards.find(card => card.classList.contains('gdl-community-card-video')).querySelector('.gdl-community-video-thumb');
        player = document.createElement('iframe'); player.className = 'gdl-community-video-frame';
        player.srcdoc = '<!doctype html><body style="margin:0;background:#41667a;color:#dcdedf;font:18px Arial;display:grid;place-content:center;height:100vh"><span id="playback-marker">Reproduciendo vídeo</span></body>';
        await new Promise(resolve => { player.onload = resolve; thumb.append(player); });
        playbackDocument = player.contentDocument;
      }
      await settle();
      return { host, root, cards, images, sidebar, activity, mode, sequence, player, thumb, playbackDocument, reveal, onlyExtremes };
    };
    const configure = async (fixture, targetWidth, zoom) => {
      const { host, root, sidebar, mode } = fixture;
      host.style.zoom = String(zoom);
      if (sidebar) sidebar.style.height = '12000px';
      for (let index = 0; index < 5; index++) {
        const current = root.querySelector('.gdl-community-native-header').getBoundingClientRect().width / zoom;
        host.style.width = (parseFloat(host.style.width) + (targetWidth - current) / (mode === 'full-width' ? 1 : .67)) + 'px';
        window.dispatchEvent(new Event('resize')); await settle();
      }
      if (sidebar && mode === 'short-sidebar') {
        const header = root.querySelector('.gdl-community-native-header').getBoundingClientRect();
        sidebar.style.height = ((header.bottom - sidebar.getBoundingClientRect().top) / zoom + 80) + 'px';
        window.dispatchEvent(new Event('resize')); await settle();
      }
    };
    const extreme = card => {
      if (card.classList.contains('gdl-community-card-video') || card.classList.contains('gdl-community-card-guide')) return false;
      const img = card.querySelector('.gdl-community-preview');
      const ratio = img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
      return ratio > 0 && (ratio <= .8 || ratio > 2.5);
    };
    const verify = async (fixture, label, expectedColumns, inspectFirst = true) => {
      await settle();
      const { host, root, cards, images, sidebar, player, thumb, playbackDocument, onlyExtremes } = fixture;
      const zoom = parseFloat(host.style.zoom) || 1, tolerance = 1.25 * zoom;
      const header = root.querySelector('.gdl-community-native-header').getBoundingClientRect();
      const visible = cards.filter(card => !card.hidden), boxes = visible.map(card => card.getBoundingClientRect());
      const firstTop = Math.min(...boxes.map(box => box.top));
      const first = visible.filter(card => Math.abs(card.getBoundingClientRect().top - firstTop) < tolerance);
      check(Math.abs(firstTop - header.bottom - 16 * zoom) < tolerance, `${label}: the heading retains its 16px content gap`);
      check(visible.every(card => getComputedStyle(card).position !== 'absolute'
        && getComputedStyle(card.parentElement).display === 'grid'), `${label}: every card participates in Steam's aligned grid, without absolute masonry`);
      if (inspectFirst && !onlyExtremes) {
        check(first.length === expectedColumns, `${label}: the first row has ${expectedColumns} separate ordinary contents (found ${first.length})`);
        check(first.every(card => !extreme(card)), `${label}: no vertical or panoramic image leads the feed when enough normal content exists`);
        const firstBoxes = first.map(card => card.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        const expectedWidth = (header.width - (expectedColumns - 1) * 24 * zoom) / expectedColumns;
        check(firstBoxes.every(box => Math.abs(box.width - expectedWidth) < tolerance), `${label}: every first-row item occupies one native cell`);
        check(firstBoxes.every(box => Math.abs(box.bottom - firstBoxes[0].bottom) < tolerance), `${label}: first-row cells share the same bottom edge`);
        check(firstBoxes.every((box, index) => !index || Math.abs(box.left - firstBoxes[index - 1].right - 24 * zoom) < tolerance), `${label}: first-row cells retain the native 24px gutter`);
        check(visible.filter(extreme).every(card => card.getBoundingClientRect().top > firstTop + tolerance), `${label}: extreme images remain in later rows`);
      } else check(first.length > 0 && boxes.every(box => box.width > 0 && box.height > 0), `${label}: an extreme-only feed still displays real content`);
      for (let index = 0; index < visible.length; index++) {
        const card = visible[index], box = boxes[index];
        const bounds = root.getBoundingClientRect();
        check(box.left >= bounds.left - tolerance && box.right <= bounds.right + tolerance, `${label}/card-${index}: content fits the feed`);
        if (card.classList.contains('gdl-community-card-video')) {
          const media = card.querySelector('.gdl-community-video-thumb').getBoundingClientRect();
          check(Math.abs(media.height - media.width * 9 / 16) < tolerance, `${label}/video-${index}: the video keeps its 16:9 viewport`);
        }
        for (let other = index + 1; other < boxes.length; other++) {
          const overlapWidth = Math.min(box.right, boxes[other].right) - Math.max(box.left, boxes[other].left);
          const overlapHeight = Math.min(box.bottom, boxes[other].bottom) - Math.max(box.top, boxes[other].top);
          check(overlapWidth <= .5 || overlapHeight <= .5, `${label}: cards ${index} and ${other} do not overlap`);
        }
        if (sidebar) {
          const side = sidebar.getBoundingClientRect();
          check(box.right <= side.left + tolerance || box.top >= side.bottom - tolerance, `${label}: content stays outside the native sidebar`);
        }
      }
      check(cards.every((card, index) => card.querySelector('img') === images[index])
        && cards.every(card => root.contains(card))
        && root.querySelectorAll('[data-gdl-community-card]').length === cards.length, `${label}: all cards and images keep their identity, including postponed extreme images`);
      if (player) check(thumb.querySelector('iframe') === player && player.contentDocument === playbackDocument
        && playbackDocument.getElementById('playback-marker'), `${label}: the mounted player and actual playing document survive layout changes`);
      const geometry = { label, firstRow: first.map(card => ({ title: card.querySelector('.gdl-community-card-title').textContent,
        width: card.getBoundingClientRect().width / zoom, height: card.getBoundingClientRect().height / zoom })),
      extremes: visible.filter(extreme).map(card => ({ ordinal: card.dataset.gdlCommunityCard,
        top: (card.getBoundingClientRect().top - firstTop) / zoom })) };
      state.geometry.push(geometry); return geometry;
    };
    const dispose = fixture => { ui.disposeCommunitySection(fixture.root); fixture.host.remove(); };
    window.__firstRow = { state, createFixture, configure, verify, settle, dispose };
  }, sources);

  for (const mode of ['full-width', 'short-sidebar', 'long-sidebar']) {
    for (const firstKind of ['portrait', 'panorama']) {
      await page.evaluate(async ({ mode, firstKind }) => {
        const state = window.__firstRow; state.fixture = await state.createFixture(mode, firstKind);
      }, { mode, firstKind });
      for (const zoom of [1, 1.25]) for (const [columns, width] of [[2, 620], [3, 900], [4, 1180], [2, 620]]) {
        await page.evaluate(async ({ columns, width, zoom }) => {
          const state = window.__firstRow; await state.configure(state.fixture, width, zoom);
          await state.verify(state.fixture, `${state.fixture.mode}/${width}/${zoom}`, columns);
        }, { columns, width, zoom });
      }
      await page.evaluate(async () => {
        const state = window.__firstRow, fixture = state.fixture;
        const firstTop = Math.min(...fixture.cards.filter(card => !card.hidden).map(card => card.getBoundingClientRect().top));
        fixture.reveal([{ isIntersecting: true }]); await state.settle();
        if (fixture.cards.some(card => card.hidden)) throw Error('Progressive reveal failed to retain the postponed content');
        await state.verify(fixture, `${fixture.mode}/after-reveal`, 2);
        if (Math.abs(Math.min(...fixture.cards.map(card => card.getBoundingClientRect().top)) - firstTop) > 1.25) throw Error('Reveal displaced the first row');
        state.dispose(fixture);
      });
    }
  }
  // Ratio classification must update when dimensions arrive after insertion.
  await page.evaluate(async () => {
    const state = window.__firstRow; state.fixture = await state.createFixture('long-sidebar', 'portrait', 999999, false, true);
    await state.configure(state.fixture, 620, 1.25);
    await state.verify(state.fixture, 'late-dimensions/pending', 2, false);
    state.fixture.cards.slice(0, 2).forEach((card, index) => card.querySelector('.gdl-community-preview').src = state.fixture.sequence[index].image);
    await Promise.all(state.fixture.cards.slice(0, 2).map(card => card.querySelector('.gdl-community-preview').decode()));
    await state.settle();
    await state.verify(state.fixture, 'late-dimensions/loaded', 2);
    state.dispose(state.fixture);
  });
  const appRows = [];
  for (const appid of [12110, 12210, 999999]) {
    appRows.push(await page.evaluate(async appid => {
      const state = window.__firstRow; state.fixture = await state.createFixture('full-width', 'portrait', appid);
      await state.configure(state.fixture, 900, 1);
      const geometry = await state.verify(state.fixture, `app-${appid}`, 3);
      state.dispose(state.fixture); return geometry.firstRow;
    }, appid));
  }
  assert.deepEqual(appRows[0], appRows[1], 'First-row selection is independent of AppID');
  assert.deepEqual(appRows[1], appRows[2], 'An arbitrary game uses the same common layout policy');
  for (const mode of ['full-width', 'long-sidebar']) {
    await page.evaluate(async mode => {
      const state = window.__firstRow; state.fixture = await state.createFixture(mode, 'portrait', 999999, true);
      await state.configure(state.fixture, 900, 1);
      await state.verify(state.fixture, `${mode}/only-extreme-images`, 3, false);
      state.dispose(state.fixture);
    }, mode);
  }
  for (const mode of ['full-width', 'long-sidebar']) {
    await page.evaluate(async mode => {
      const state = window.__firstRow; state.fixture = await state.createFixture(mode, 'partial');
      await state.configure(state.fixture, 900, 1.25);
      await state.verify(state.fixture, `${mode}/one-normal-content`, 3, false);
      const cards = state.fixture.cards, firstTop = Math.min(...cards.map(card => card.getBoundingClientRect().top));
      const first = cards.filter(card => Math.abs(card.getBoundingClientRect().top - firstTop) < 1.5);
      if (first.length !== 1 || !first[0].classList.contains('gdl-community-card-video')) throw Error(`${mode}: a partially filled first row must not be completed with extreme artwork`);
      state.state.checks++;
      state.dispose(state.fixture);
    }, mode);
  }
  // Keep a reviewable screenshot: a normal first row followed by the same
  // portrait and panoramic artwork, still using the native grid's cell sizes.
  await page.evaluate(async () => {
    const state = window.__firstRow; state.fixture = await state.createFixture('full-width');
    state.fixture.activity.style.height = '24px';
    await state.configure(state.fixture, 900, 1);
    await state.verify(state.fixture, 'representative-screenshot', 3);
    state.fixture.player.remove();
  });
  const screenshot = path.join(scratch, 'community-first-row.png');
  await page.screenshot({ path: screenshot });
  const result = await page.evaluate(() => window.__firstRow.state);
  fs.writeFileSync(path.join(scratch, 'geometry.json'), JSON.stringify(result, null, 2));
  assert(result.checks > 1000, 'The first-row matrix exercised its geometry and identity contracts');
  console.log(`Community first-row browser passed: ${result.checks} checks; native aligned grid, ordinary first row, postponed extreme ratios, 2/3/4 columns, zoom, sidebar, late dimensions, reveal and stable playing document.`);
  console.log('Screenshot: ' + screenshot);
} catch (error) {
  const screenshot = path.join(scratch, 'community-first-row-failure.png');
  if (page) {
    await page.evaluate(() => window.__firstRow?.fixture?.root.scrollIntoView({ block: 'start' })).catch(() => {});
    await page.screenshot({ path: screenshot }).catch(() => {});
    console.error('Failure screenshot: ' + screenshot);
  }
  throw error;
} finally { await browser.close(); }
