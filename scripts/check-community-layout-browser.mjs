import './helpers/installed-steam-check.mjs';
// Render the real Community UI against the installed Steam Community CSS.
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
assert(steamCss && fs.existsSync(steamCss), `Installed Steam CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['community-view', 'frontend/features/library/community-view.ts'],
  ['community-order', 'frontend/features/library/community-order.ts'],
  ['community-style', 'frontend/features/library/styles/community.ts'],
  ['navigation', 'frontend/steam/navigation.ts'],
].map(([name, filename]) => {
  let source = ts.transpileModule(fs.readFileSync(name === 'community-view' && process.env.COMMUNITY_VIEW_SOURCE
    ? process.env.COMMUNITY_VIEW_SOURCE : path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  if (name === 'community-view') {
    assert(source.includes('const occupied = [];'), 'The resize-work probe must instrument the production dense placement loop');
    source = source.replace('const occupied = [];', 'window.__gdlDensePlacementPasses = (window.__gdlDensePlacementPasses || 0) + 1; const occupied = [];');
  }
  return [name, source];
}));

async function browserChecks(sources) {
  const results = [], modules = {}, geometry = {};
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { for (let index = 0; index < 5; index++) await frame(); };
  const localization = { steamLanguageSync: () => 'english', gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback };
  const dependencies = {
    '../../steam/localization': localization,
    '../../core/text': { escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') },
    '../../api/backend': { backendLog() {} },
    '../api/backend': { backendLog() {} },
    './browser-protection': { installBrowserProtection: () => () => {} },
    '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: async (_doc, _key, callback) => callback() },
    './inject': { injectLibraryStyle: (doc, id, css) => { const style = doc.createElement('style'); style.id = id; style.textContent = css; doc.head.append(style); } },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const name = dependency.split('/').pop();
      if (name in sources) return load(name);
      throw new Error(`Unexpected ${name} dependency: ${dependency}`);
    }, exports); return exports;
  };
  let section, nativeObserver, navigationCleanup;
  // Keep the delegated click intact, replacing only the remote player document
  // so the real iframe box is measured without any YouTube network requests.
  const remotePlayers = [];
  const originalInnerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...originalInnerHtml,
    set(value) {
      if (this.classList.contains('gdl-community-video-thumb')) {
        value = String(value).replace(/src="(https:\/\/www\.youtube-nocookie\.com\/embed\/[^\"]+)"/g, (_match, url) => {
          remotePlayers.push(url);
          return `data-test-player-source="${url}" srcdoc="<!doctype html><html><body style='margin:0;background:#536d86'></body></html>"`;
        });
      }
      originalInnerHtml.set.call(this, value);
    },
  });
  const realIntersectionObserver = window.IntersectionObserver;
  try {
    navigationCleanup = load('navigation').installSteamNavigation(document);
    const image = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><path d="M0 ${height}L${width} 0" stroke="#eee" stroke-width="8"/></svg>`);
    const art = image(300, 900, '#a46272'), landscape = image(640, 360, '#556d59');
    const panorama = image(1200, 300, '#527e8d'), square = image(400, 400, '#9b7f46');
    // YouTube hqdefault posters are 480x360 with 45px letterbox bars above
    // and below their actual 480x270 picture. Native Steam crops those bars
    // to fill its 16:9 poster; ordinary pictures also cover their row's media.
    const videoPoster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#000"/><rect y="45" width="480" height="270" fill="#4e9b8c"/><path d="M0 315L480 45" stroke="#eee" stroke-width="8"/></svg>');
    const avatar = image(32, 32, '#609bbf');
    const native = document.getElementById('native-oracle');
    const nativeState = () => Array.from(native.querySelectorAll('*')).map(element => {
      const css = getComputedStyle(element), box = element.getBoundingClientRect();
      return [element.outerHTML, css.background, css.borderRadius, css.fontSize, css.padding, box.width, box.height];
    });
    const before = JSON.stringify(nativeState()), nativeWrites = [];
    nativeObserver = new MutationObserver(records => nativeWrites.push(...records));
    nativeObserver.observe(native, { subtree: true, attributes: true, childList: true, characterData: true });
    load('community-style').ensureCommunityStyles(document);
    const ui = load('community-view');
    // Realistic backend ordering: mixed San Andreas pictures/guides followed by
    // a separate video batch. The renderer must normalize this once and retain
    // its resulting feed sequence across grid rows, reveal, image load and resize.
    const mixed = Array.from({ length: 20 }, (_, index) => ({
      type: index % 5 === 1 ? 'guide' : index % 4 === 0 ? 'artwork' : 'screenshot',
      image: [art, panorama, square, landscape][index % 4],
      title: index % 3 === 0
        ? `San Andreas ${index}: Grove Street families return to Los Santos with widescreen fixes, restored effects and the complete original atmosphere — final character Z`
        : index % 3 === 1 ? `GTA_San_Andreas_${index}_` + 'CompleteMapAndHiddenCollectibles'.repeat(4) + '_END'
          : `Grand Theft Auto: San Andreas — community picture ${index}`,
      description: index % 5 === 1 ? `Guide ${index}: All gang territories, hidden packages, driving school medals and the complete checklist. `.repeat(index % 2 ? 8 : 3) + 'Final description Z' : undefined,
      author_name: index % 3 === 0 ? `San Andreas community author ${index} with a complete long visible profile name Z` : `Author ${index}`,
      author_avatar: avatar, link: `https://steamcommunity.com/sharedfiles/filedetails/?id=${1000 + index}`,
    }));
    const videos = Array.from({ length: 14 }, (_, index) => ({ type: 'video', image: videoPoster,
      title: `San Andreas video ${index}: Los Santos, San Fierro and Las Venturas — complete community video title with ending Z`,
      author_name: `Video author ${index}`, author_avatar: avatar, youtube_id: `sample${String(index).padStart(5, '0')}`,
      link: `https://steamcommunity.com/sharedfiles/filedetails/?id=${2000 + index}` }));
    const items = [...mixed, ...videos];
    const signature = ui.communityItemsSignature(items);
    check(ui.communityItemsSignature(items.map(item => ({ ...item }))) === signature, 'Identical feed content retains a stable hydration signature');
    for (const field of ['title', 'description', 'author_name', 'author_avatar', 'youtube_id']) {
      const changed = items.map(item => ({ ...item })); changed[0][field] = `${changed[0][field] || ''} updated`;
      check(ui.communityItemsSignature(changed) !== signature,
        `A ${field} change with the same media URLs and entry links invalidates the feed signature`);
    }
    const html = ui.renderCommunityContentHtml({}, items);
    const staging = document.createElement('div'); staging.innerHTML = html;
    [...staging.querySelectorAll('[data-gdl-community-card]')].forEach((card, index) => { if (index >= 12) card.hidden = true; });
    let revealObserver;
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; revealObserver = this; }
      observe() {} disconnect() {}
    };
    const activity = document.getElementById('activity');
    // Community normally sits below the activity feed. Keep the sentinel out
    // of the initial viewport so each progressive batch is exercised explicitly.
    activity.style.height = '1800px';
    section = ui.insertCommunitySection(document, {}, activity, staging.innerHTML);
    const grid = section.querySelector('.gdl-community-grid');
    const sentinel = section.querySelector('.gdl-community-sentinel');
    const cards = () => [...section.querySelectorAll('[data-gdl-community-card]')].sort((a, b) => Number(a.dataset.gdlCommunityCard) - Number(b.dataset.gdlCommunityCard));
    const originals = cards(), originalImages = originals.map(card => card.querySelector('img'));
    const originalAuthors = originals.map(card => card.querySelector('.gdl-community-author-bar'));
    const playingFrames = new Map();
    const stagedLazyCard = originals.slice(12).find(card => card.querySelector('.gdl-community-media .gdl-community-preview')?.getAttribute('src') === art);
    check(Boolean(stagedLazyCard), 'The realistic feed includes a hidden portrait thumbnail for delayed progressive loading');
    const stagedLazyImage = stagedLazyCard.querySelector('.gdl-community-preview');
    const stagedLazyUrl = stagedLazyImage.getAttribute('src');
    // A lazy request has not started while its card is hidden. Start it only
    // after that batch becomes visible, then exercise the native load event.
    stagedLazyImage.removeAttribute('src');
    const originalIndices = originals.map(card => card.dataset.gdlCommunityCard);
    const originalTitles = originals.map(card => card.querySelector('.gdl-community-card-title').textContent);
    const isVideo = card => card.classList.contains('gdl-community-card-video');
    check(originals.length === 34 && new Set(originalIndices).size === 34, 'The normalized mixed feed retains every distinct San Andreas entry exactly once');
    check(originals.slice(-8).some(card => !isVideo(card)), 'A separately concatenated video batch does not become an artificial video-only feed tail');
    check(originals.filter(isVideo).length === 14, 'Video blending retains every video instead of removing the tail');
    const decode = async images => {
      for (const img of images) img.loading = 'eager';
      await Promise.all(images.map(img => img.decode().catch(() => {}))); await settle();
    };
    await decode([...section.querySelectorAll('img')].filter(img => img !== stagedLazyImage));
    const visible = () => cards().filter(card => !card.hidden);
    const scale = () => grid.getBoundingClientRect().width / Number.parseFloat(getComputedStyle(grid).width);
    const assertNodes = label => {
      check(cards().every((card, index) => card === originals[index]
        && card.dataset.gdlCommunityCard === originalIndices[index]
        && card.querySelector('.gdl-community-author-bar') === originalAuthors[index]
        && (playingFrames.has(card)
          ? card.querySelector('iframe') === playingFrames.get(card) && card.classList.contains('gdl-video-playing')
          : card.querySelector('img') === originalImages[index]
            && card.querySelector('.gdl-community-card-title').textContent === originalTitles[index])),
      `${label}: card/image/player identities and normalized feed order remain stable`);
    };
    const assertPlayers = label => {
      for (const [card, player] of playingFrames) {
        const thumb = card.querySelector('.gdl-community-video-thumb');
        const thumbBox = thumb.getBoundingClientRect(), playerBox = player.getBoundingClientRect();
        check(Math.abs(thumbBox.height - thumbBox.width * 9 / 16) <= 1.1 * scale(),
          `${label}: the playing video keeps a single 16:9 media rectangle`);
        check(Math.abs(playerBox.top - thumbBox.top) <= 1.1 && Math.abs(playerBox.left - thumbBox.left) <= 1.1
          && Math.abs(playerBox.width - thumbBox.width) <= 1.1 && Math.abs(playerBox.height - thumbBox.height) <= 1.1,
          `${label}: the iframe fills the media from its top edge without a blank row`);
        check(player.getAttribute('srcdoc') && !player.hasAttribute('src'),
          `${label}: the playback fixture loads a local stub without any remote YouTube request`);
      }
    };
    const assertPosters = (label, posterCards = visible()) => {
      for (const card of posterCards) {
        const image = card.querySelector('.gdl-community-preview');
        if (!image || !image.naturalWidth || getComputedStyle(image).display === 'none') continue;
        const css = getComputedStyle(image);
        if (!isVideo(card)) {
          check(css.objectFit === 'cover', `${label}: ordinary pictures cover their native aligned row without letterbox gaps`);
          continue;
        }
        check(css.objectFit === 'cover' && css.objectPosition === '50% 50%',
          `${label}: video posters use native centered cover without altering other media`);
        check(image.naturalWidth === 480 && image.naturalHeight === 360,
          `${label}: the video fixture exercises a real 4:3 poster containing 45px black bands`);
        const imageBox = image.getBoundingClientRect(), thumbBox = image.parentElement.getBoundingClientRect();
        check(Math.abs(imageBox.left - thumbBox.left) <= 1.1 && Math.abs(imageBox.top - thumbBox.top) <= 1.1
          && Math.abs(imageBox.width - thumbBox.width) <= 1.1 && Math.abs(imageBox.height - thumbBox.height) <= 1.1,
          `${label}: the video image element fills every edge of the native 16:9 media rectangle`);
        // Calculate the visible source rectangle from the browser's measured
        // box and computed fit. It must begin/end exactly on the colored
        // picture, excluding both black bands and preserving its full width.
        const posterScale = Math.max(imageBox.width / image.naturalWidth, imageBox.height / image.naturalHeight);
        const sourceTop = (image.naturalHeight * posterScale - imageBox.height) / 2 / posterScale;
        const sourceBottom = sourceTop + imageBox.height / posterScale;
        check(Math.abs(sourceTop - 45) <= 0.9 && Math.abs(sourceBottom - 315) <= 0.9
          && Math.abs(imageBox.width / posterScale - 480) <= 0.9,
          `${label}: centered cover removes both embedded black bands without cropping the 16:9 picture`);
      }
    };
    const playVideo = async (card, label, preserveHeight) => {
      const thumb = card.querySelector('.gdl-community-video-thumb');
      const before = thumb.getBoundingClientRect();
      thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();
      const player = thumb.querySelector('iframe');
      check(Boolean(player) && card.classList.contains('gdl-video-playing'),
        `${label}: the actual delegated click starts the existing video's embedded player`);
      playingFrames.set(card, player);
      const after = thumb.getBoundingClientRect();
      geometry[label] = { before: { width: before.width, height: before.height },
        after: { width: after.width, height: after.height }, playerTop: player.getBoundingClientRect().top - after.top };
      if (preserveHeight) check(Math.abs(before.height - after.height) <= 1.1 && Math.abs(before.width - after.width) <= 1.1,
        `${label}: starting playback preserves the exact thumbnail rectangle`);
      assertPlayers(label); assertNodes(label); assertRows(label); assertText(label);
      thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await settle();
      check(thumb.querySelector('iframe') === player,
        `${label}: another click on the playing card retains the same iframe and playback session`);
    };
    const publishedBatchEnds = [12];
    const gridGeometry = (targetGrid, targetCards) => {
      const css = getComputedStyle(targetGrid), box = targetGrid.getBoundingClientRect();
      const zoom = box.width / Number.parseFloat(css.width);
      const count = Math.max(1, Math.min(10, Math.floor((targetGrid.clientWidth + 24) / 280)));
      const width = (Number.parseFloat(css.width) - (count - 1) * 24) / count;
      const heights = css.gridTemplateRows.split(' ').map(value => Number.parseFloat(value));
      const rowTops = heights.map((_height, index) => heights.slice(0, index).reduce((sum, height) => sum + height + 32, 0));
      const placements = targetCards.map(card => {
        const rect = card.getBoundingClientRect(), image = card.querySelector('.gdl-community-media .gdl-community-preview');
        const ratio = image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 16 / 9;
        const span = isVideo(card) ? Math.min(2, count) : image && ratio > 2.5 ? Math.min(3, count) : 1;
        const rows = !isVideo(card) && image && ratio <= .8 ? 2 : 1;
        const top = (rect.top - box.top) / zoom, left = (rect.left - box.left) / zoom;
        const row = rowTops.findIndex(value => Math.abs(value - top) <= 1.1);
        const column = Math.round(left / (width + 24));
        return { card, rect, top, left, height: rect.height / zoom, width: rect.width / zoom, span, rows, row, column };
      });
      return { css, box, zoom, count, width, heights, rowTops, placements };
    };
    const assertGridRows = (label, targetGrid, targetCards) => {
      const measured = gridGeometry(targetGrid, targetCards);
      const { css, box, zoom, count, width, heights, rowTops, placements } = measured;
      check(css.display === 'grid' && css.gridAutoFlow.includes('dense') && css.rowGap === '32px' && css.columnGap === '24px',
        `${label}: native dense grid rows preserve the 24px horizontal and 32px vertical gutters`);
      check(!targetGrid.style.height && [...targetGrid.children].every(card => card.hasAttribute('data-gdl-community-card')),
        `${label}: one natural-height grid owns all feed nodes without artificial column wrappers`);
      const occupied = new Set();
      for (const [index, placement] of placements.entries()) {
        const { card, rect, top, left, height, span, rows, row, column } = placement;
        const expectedWidth = span * width + (span - 1) * 24;
        check(getComputedStyle(card).position !== 'absolute' && !card.style.left && !card.style.top && !card.style.width && !card.style.height,
          `${label}: entry ${card.dataset.gdlCommunityCard} participates in real rows without absolute-position coordinates`);
        check(row >= 0 && column >= 0 && column + span <= count && Math.abs(left - column * (width + 24)) <= 1.1
          && Math.abs(rect.width / zoom - expectedWidth) <= 1.1,
          `${label}: entry ${card.dataset.gdlCommunityCard} has its native ${span}-column responsive width`);
        const expectedHeight = heights.slice(row, row + rows).reduce((sum, value) => sum + value, 0) + (rows - 1) * 32;
        check(row + rows <= heights.length && Math.abs(height - expectedHeight) <= 1.1,
          `${label}: entry ${card.dataset.gdlCommunityCard} stretches to its complete ${rows}-row boundary`);
        const batchStart = targetGrid === grid ? Math.max(0, ...publishedBatchEnds.filter(end => end <= index)) : 0;
        const firstRow = Math.max(0, ...placements.slice(0, batchStart).map(item => item.row + item.rows));
        const earlierFit = Array.from({ length: row - firstRow + 1 }, (_value, offset) => firstRow + offset).some(candidateRow =>
          Array.from({ length: count - span + 1 }, (_value, candidateColumn) => candidateColumn).some(candidateColumn => {
            if (candidateRow === row && candidateColumn >= column) return false;
            return Array.from({ length: rows }, (_value, offsetRow) => offsetRow).every(offsetRow =>
              Array.from({ length: span }, (_value, offsetColumn) => offsetColumn).every(offsetColumn =>
                !occupied.has(`${candidateRow + offsetRow}:${candidateColumn + offsetColumn}`)));
          }));
        check(row >= firstRow && !earlierFit, `${label}: entry ${card.dataset.gdlCommunityCard} fills the earliest free cells in its published batch without moving previous rows`);
        for (let y = row; y < row + rows; y++) for (let x = column; x < column + span; x++) {
          check(!occupied.has(`${y}:${x}`), `${label}: entry ${card.dataset.gdlCommunityCard} never shares an occupied row cell`);
          occupied.add(`${y}:${x}`);
        }
        check(placements.slice(0, index).every(previous => rect.right <= previous.rect.left + 1.1
          || previous.rect.right <= rect.left + 1.1 || rect.top >= previous.rect.bottom + 32 * zoom - 1.1
          || previous.rect.top >= rect.bottom + 32 * zoom - 1.1),
          `${label}: every foreground card remains separated from its neighbors without overlap`);
        const footer = card.querySelector('.gdl-community-author-bar')?.getBoundingClientRect();
        if (footer) check(Math.abs(footer.bottom - rect.bottom) <= 1.1,
          `${label}: entry ${card.dataset.gdlCommunityCard} anchors its complete author footer to the row bottom`);
        const thumb = card.querySelector('.gdl-community-video-thumb');
        if (thumb && thumb.dataset.gdlMediaState !== 'error') {
          const thumbBox = thumb.getBoundingClientRect();
          check(Math.abs(thumbBox.width / zoom - expectedWidth) <= 1.1
            && Math.abs(thumbBox.height / zoom - expectedWidth * 9 / 16) <= 1.1,
            `${label}: the enlarged video poster or player retains the native 16:9 rectangle`);
        }
        check(rect.right <= box.right + 1.1 * zoom, `${label}: every complete card stays inside the feed width`);
      }
      for (const row of new Set(placements.filter(item => item.rows === 1).map(item => item.row))) {
        const neighbors = placements.filter(item => item.rows === 1 && item.row === row);
        check(neighbors.every(item => Math.abs(item.top - rowTops[row]) <= 1.1
          && Math.abs(item.top + item.height - rowTops[row] - heights[row]) <= 1.1),
          `${label}: all ordinary cards in row ${row} share their top and bottom edges`);
      }
      const maxBottom = Math.max(...placements.map(item => item.top + item.height), 0);
      check(Math.abs(box.height / zoom - maxBottom) <= 1.1, `${label}: grid height ends at its lowest complete row`);
      return measured;
    };
    const assertRows = label => {
      const measured = assertGridRows(label, grid, visible());
      const { box, zoom, count, placements } = measured;
      const maxBottom = Math.max(...placements.map(item => item.top + item.height), 0);
      if (getComputedStyle(sentinel).display !== 'none') {
        check(Math.abs((sentinel.getBoundingClientRect().top - box.top) / zoom - maxBottom) <= 1.1,
          `${label}: the next-page sentinel follows the content with no large empty region`);
      }
      geometry[label] = { count, zoom, gridHeight: box.height / zoom, visible: visible().length,
        rows: measured.heights, cards: placements.map(({ row, column, span, rows, top, left, width, height }) => ({ row, column, span, rows, top, left, width, height })) };
    };
    const assertText = label => {
      for (const card of visible()) {
        const cardBox = card.getBoundingClientRect(), author = card.querySelector('.gdl-community-author-bar');
        const footerTop = author?.getBoundingClientRect().top ?? cardBox.bottom;
        for (const text of card.querySelectorAll('.gdl-community-card-title, .gdl-community-card-description, .gdl-community-author')) {
          const textBox = text.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(text);
          const glyphs = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          const clamp = text.classList.contains('gdl-community-card-description') ? 6 : text.parentElement.classList.contains('gdl-community-caption') ? 2 : 0;
          const rendered = clamp ? glyphs.filter(rect => rect.top < textBox.bottom - 1 && rect.bottom > textBox.top + 1) : glyphs;
          check(rendered.length > 0 && rendered.every(rect => rect.left >= Math.max(cardBox.left, textBox.left) - 1.1
            && rect.right <= Math.min(cardBox.right, textBox.right) + 1.1
            && rect.top >= Math.max(cardBox.top, textBox.top) - 1.1 && rect.bottom <= Math.min(cardBox.bottom, textBox.bottom) + 1.1),
          `${label}: every rendered glyph remains inside entry ${card.dataset.gdlCommunityCard}`);
          if (!text.classList.contains('gdl-community-author')) {
            check(rendered.every(rect => rect.bottom <= footerTop + 1.1), `${label}: the author footer never covers caption or description characters`);
          }
          if (clamp) check(getComputedStyle(text).webkitLineClamp === String(clamp) && getComputedStyle(text).overflow === 'hidden',
            `${label}: ${clamp === 6 ? 'guide summaries' : 'media captions'} use Steam's native ${clamp}-line limit`);
          check(text.scrollWidth <= text.clientWidth + 1 && (clamp || text.scrollHeight <= text.clientHeight + 1),
            `${label}: native text wraps inside its card without horizontal overflow`);
        }
      }
    };
    const assertStableResize = async label => {
      const writes = [];
      const observer = new MutationObserver(records => writes.push(...records));
      observer.observe(grid, { attributes: true, childList: true, subtree: true });
      for (let index = 0; index < 100; index++) window.dispatchEvent(new Event('resize'));
      await settle(); writes.push(...observer.takeRecords()); observer.disconnect();
      check(writes.length === 0, `${label}: 100 same-width resize signals perform zero card, image or inline-style writes`);
    };
    assertRows('initial12'); assertText('initial12'); assertPosters('initial12');
    check(getComputedStyle(originals[0]).backgroundColor === 'rgb(62, 64, 71)' && getComputedStyle(originals[0]).borderRadius === '6px', 'Community card surface and radius match the installed native Steam CSS');
    const media = originals.find(card => card.querySelector('.gdl-community-media'));
    const caption = media.querySelector('.gdl-community-caption');
    check(caption && getComputedStyle(media.querySelector('.gdl-community-card-title')).fontSize === '14px', 'Native 14px media caption typography remains present');
    check(getComputedStyle(section.querySelector('.gdl-community-native-header')).fontSize === '14px'
      && getComputedStyle(section.querySelector('.gdl-community-native-header')).fontWeight === '400', 'Community header retains native regular 14px typography');
    check(originals.some(card => card.querySelector('.gdl-community-media .gdl-community-preview')?.naturalHeight === 900
      && getComputedStyle(card).gridRowEnd === 'span 2'), 'Tall portrait art occupies two native grid rows');
    check(originals.find(isVideo)?.dataset.gdlYoutubeId.startsWith('sample')
      && originals.find(card => card.classList.contains('gdl-community-card-guide'))?.dataset.gdlOpenUrl.startsWith('https://steamcommunity.com/'), 'Video playback and community-page actions survive aligned grid placement');

    // A newly published batch starts after all preceding rows, preserving the
    // complete visible prefix and any playing iframe at the current scroll.
    const progressivePlayerCard = visible().filter(isVideo).at(-1);
    await playVideo(progressivePlayerCard, 'progressiveVideoPlayback', true);
    window.scrollTo(0, progressivePlayerCard.getBoundingClientRect().top + window.scrollY - 180); await settle();
    while (visible().length < originals.length) {
      const previous = visible().map(card => { const rect = card.getBoundingClientRect();
        return { card, left: rect.left, top: rect.top, width: rect.width, height: rect.height }; });
      const playing = [...playingFrames.values()].map(player => ({ player, rect: player.getBoundingClientRect() }));
      const scrollBefore = window.scrollY;
      const previousCount = visible().length;
      revealObserver.callback([{ isIntersecting: true }]); await settle();
      publishedBatchEnds.push(visible().length);
      check(visible().length === Math.min(originals.length, previousCount + 8), 'Each load-more signal reveals exactly the next eight normalized feed indices');
      check(previous.every(({ card, left, top, width, height }) => {
        const rect = card.getBoundingClientRect(); return Math.abs(rect.left - left) <= 1.1 && Math.abs(rect.top - top) <= 1.1
          && Math.abs(rect.width - width) <= 1.1 && Math.abs(rect.height - height) <= 1.1;
      }), 'Progressive append preserves the actual rectangles of every previously published card');
      check(playing.every(({ player, rect }) => {
        const after = player.getBoundingClientRect(); return player.isConnected && Math.abs(after.top - rect.top) <= 1.1
          && Math.abs(after.left - rect.left) <= 1.1 && Math.abs(after.width - rect.width) <= 1.1 && Math.abs(after.height - rect.height) <= 1.1;
      }) && Math.abs(window.scrollY - scrollBefore) <= 1.1,
      'Progressive append preserves the active player rectangle and current scroll without a visual jump');
      assertNodes(`reveal${visible().length}`); assertRows(`reveal${visible().length}`); assertText(`reveal${visible().length}`);
      if (!stagedLazyCard.hidden && !stagedLazyImage.getAttribute('src')) {
        const media = stagedLazyCard.querySelector('.gdl-community-media');
        check(media.offsetHeight >= media.offsetWidth * 9 / 16 - 1,
          'The newly revealed lazy card reserves media space before its image request finishes');
        stagedLazyImage.src = stagedLazyUrl; await decode([stagedLazyImage]);
        check(stagedLazyImage.naturalHeight === 900, 'A progressive-batch thumbnail genuinely adopts its late natural portrait dimensions');
        assertNodes('progressiveLazyImage'); assertRows('progressiveLazyImage'); assertText('progressiveLazyImage');
      }
    }
    check(getComputedStyle(sentinel).display === 'none', 'The next-page sentinel disappears after the final real entry');

    await playVideo(originals.filter(isVideo).at(-1), 'normalVideoPlayback', true);

    // A real splitter drag changes width every frame while staying inside the
    // same native column breakpoint. Keep mounted players and measure actual
    // media writes plus entries into the production dense placement loop.
    const dragFixture = document.getElementById('fixture');
    dragFixture.style.width = '1160px'; await settle();
    const cappedMedia = new Set([...grid.querySelectorAll('.gdl-community-media')].filter(media =>
      Number.parseFloat(getComputedStyle(media,'::before').height) >= 799.9));
    let dragMediaWrites = 0, dragUncappedWrites = 0;
    const countDragWrites = records => {
      for (const record of records) {
        if (!record.target.matches('.gdl-community-media,.gdl-community-video-thumb')) continue;
        dragMediaWrites++;
        if (!cappedMedia.has(record.target)) dragUncappedWrites++;
      }
    };
    const dragObserver = new MutationObserver(records => {
      countDragWrites(records);
    });
    dragObserver.observe(grid, { attributes:true, attributeFilter:['style'], subtree:true });
    window.__gdlDensePlacementPasses = 0;
    for (let step = 1; step <= 60; step++) {
      const previous = originals[0].getBoundingClientRect().width;
      dragFixture.style.width = `${1160 + step}px`;
      check(originals[0].getBoundingClientRect().width > previous,
        `splitter pixel ${step}: the visible card width updates synchronously without waiting for a timer`);
      await frame();
    }
    await settle();
    countDragWrites(dragObserver.takeRecords());
    dragObserver.disconnect();
    geometry.splitterResizeWork = { steps:60, densePlacementPasses:window.__gdlDensePlacementPasses, mediaStyleWrites:dragMediaWrites, uncappedMediaStyleWrites:dragUncappedWrites,cappedMedia:cappedMedia.size };
    check(window.__gdlDensePlacementPasses === 0, 'Sixty splitter pixels inside one column breakpoint never repeat dense placement');
    check(dragUncappedWrites === 0, 'Sixty splitter pixels retain intrinsic picture/video ratios without uncapped media style writes');
    check(cappedMedia.size > 0 && dragMediaWrites <= cappedMedia.size*60,
      'Only actual 800px-capped media update their width-dependent ratios during the drag');
    assertNodes('splitterDrag'); assertRows('splitterDrag'); assertText('splitterDrag'); assertPlayers('splitterDrag');
    dragFixture.style.width='1120px'; await settle();

    for (const [width, zoom] of [[840, 1], [560, 1], [240, 1], [1120, 1.25], [840, 1.5], [1037, 1.25], [1193, 1.5], [1120, 1]]) {
      document.getElementById('fixture').style.width = `${width}px`;
      document.getElementById('fixture').style.zoom = String(zoom);
      await settle();
      assertNodes(`resize${width}zoom${zoom}`); assertRows(`resize${width}zoom${zoom}`); assertText(`resize${width}zoom${zoom}`);
      assertPosters(`resize${width}zoom${zoom}`);
      assertPlayers(`resize${width}zoom${zoom}`);
      if (width === 1037 || width === 1193) await assertStableResize(`fractional${width}zoom${zoom}`);
    }
    // Lazy media may finish much later or fail. Its existing image/card nodes
    // are retained while the real load/error/ResizeObserver paths recompute gaps.
    const lateCard = originals.find(card => card.querySelector('.gdl-community-media'));
    const lateImage = lateCard.querySelector('.gdl-community-preview');
    lateImage.removeAttribute('src'); await settle();
    lateImage.src = image(300, 1600, '#6b5fa6'); await decode([lateImage]);
    assertNodes('lateTallImage'); assertRows('lateTallImage'); assertText('lateTallImage');
    const failedImage = originals.find(card => card.querySelector('.gdl-community-media') && card !== lateCard).querySelector('.gdl-community-preview');
    const failedOriginalUrl = failedImage.getAttribute('src');
    const failed = new Promise(resolve => failedImage.addEventListener('error', resolve, { once: true }));
    failedImage.src = 'data:image/png;base64,not-an-image'; await failed; await settle();
    assertNodes('failedImage'); assertRows('failedImage'); assertText('failedImage');
    check(lateImage.naturalHeight === 1600 && failedImage.naturalWidth === 0, 'The fixture exercises genuine late image decoding and a genuine browser image error');
    const failedMedia = failedImage.parentElement;
    check(getComputedStyle(failedImage).display === 'none', 'A failed media request hides the broken-image icon without deleting the existing image node');
    check(failedImage.style.display === '', 'The actual delegated navigation error handler never permanently hides a retryable Community image');
    check(Number.parseFloat(getComputedStyle(failedMedia, '::before').height) === 0
      && failedMedia.querySelector('.gdl-community-caption').getBoundingClientRect().height > 0,
      'Failed media drops its reserved picture aspect while retaining a visible native caption in the aligned card');
    failedImage.src = failedOriginalUrl; await decode([failedImage]);
    assertNodes('recoveredImage'); assertRows('recoveredImage'); assertText('recoveredImage');
    check(getComputedStyle(failedImage).display !== 'none', 'A later successful retry restores the same image node and its actual media dimensions');
    const failedVideo = originals.find(card => isVideo(card) && !playingFrames.has(card)), failedVideoImage = failedVideo.querySelector('.gdl-community-preview');
    const videoSource = failedVideoImage.getAttribute('src'), videoId = failedVideo.dataset.gdlYoutubeId;
    const playControl = failedVideo.querySelector('.gdl-community-play-button');
    const videoError = new Promise(resolve => failedVideoImage.addEventListener('error', resolve, { once: true }));
    failedVideoImage.src = 'data:image/gif;base64,not-a-video-thumbnail'; await videoError; await settle();
    assertNodes('failedVideo'); assertRows('failedVideo'); assertText('failedVideo');
    check(getComputedStyle(failedVideoImage).display === 'none' && failedVideo.dataset.gdlYoutubeId === videoId
      && failedVideo.querySelector('.gdl-community-play-button') === playControl && playControl.getBoundingClientRect().height > 0,
      'A missing video thumbnail preserves the same visible playback control and its exact video action');
    check(failedVideoImage.style.display === '', 'The actual delegated navigation error handler never permanently hides a retryable video thumbnail');
    const failedVideoMedia = failedVideoImage.parentElement;
    check(failedVideoMedia.getBoundingClientRect().height <= failedVideoMedia.querySelector('.gdl-community-caption').getBoundingClientRect().height
      + playControl.getBoundingClientRect().height + 17.1,
      'A failed video thumbnail leaves only its complete caption and playback control without a blank poster rectangle');
    failedVideoImage.src = videoSource; await decode([failedVideoImage]);
    assertNodes('recoveredVideo'); assertRows('recoveredVideo'); assertText('recoveredVideo');
    assertPosters('recoveredVideo');
    const failedAgain = new Promise(resolve => failedVideoImage.addEventListener('error', resolve, { once: true }));
    failedVideoImage.src = 'data:image/gif;base64,not-a-video-thumbnail'; await failedAgain; await settle();
    await playVideo(failedVideo, 'failedThumbnailPlayback', false);
    document.getElementById('fixture').style.width = '840px';
    document.getElementById('fixture').style.zoom = '1.5';
    await settle();
    assertNodes('failedThumbnailPlayingResize'); assertRows('failedThumbnailPlayingResize'); assertPlayers('failedThumbnailPlayingResize');
    document.getElementById('fixture').style.width = '1120px';
    document.getElementById('fixture').style.zoom = '1'; await settle();
    check(remotePlayers.length === 3, 'All real progressive, normal and failed-thumbnail playback paths use isolated stubs without remote navigation');
    await assertStableResize('final1120');
    ui.disposeCommunitySection(section);
    const disposedMarkup = grid.outerHTML;
    document.getElementById('fixture').style.width = '560px'; window.dispatchEvent(new Event('resize')); lateImage.dispatchEvent(new Event('load'));
    await settle();
    check(grid.outerHTML === disposedMarkup, 'Disposal stops responsive, card-size and image-load callbacks');
    // Reinstall after the disposal check, so the exported wide screenshot is a
    // freshly settled live layout rather than stale coordinates after a resize.
    document.getElementById('fixture').style.width = '1120px';
    ui.setupCommunityProgressiveReveal(document, section); await settle();
    assertNodes('reinstalledWide'); assertRows('reinstalledWide'); assertText('reinstalledWide');
    assertPosters('reinstalledWide');
    assertPlayers('reinstalledWide');
    check(Math.abs(Number.parseFloat(getComputedStyle(section).paddingBottom) - 24) <= 1.1,
      'An ordinary unclipped page retains exactly the native 24px Community bottom spacing');
    // Steam's native scroll host uses height:100%. A preceding header can put
    // its bottom beyond a clipping ancestor even though scrollTop is already
    // maximal, leaving the last Community author footer unreachable.
    const fixture = document.getElementById('fixture');
    const tailViewport = document.createElement('div');
    tailViewport.id = 'tail-viewport';
    tailViewport.style.cssText = 'height:500px;width:1120px;overflow:hidden;position:relative';
    tailViewport.innerHTML = `<div style="height:50px;flex:none"></div>
      <div class="_3VQUewWB8g6Z5qB4C7dGFr _2iE-78WxX2Pj4GHbq7YJiA">
        <div id="tail-scroller" class="_3lDczhulqraStjCitLYJ1K _2l416KfEtI4CL0mCUEmOBw">
          <div class="_1SvpjsckP9cPRxO6gCBHrw"><div class="_1_cYNJSvS6IXs9vLTEYjy5">
            <div class="_27RcNu8aXKBpYkHcNNrt-X"><div class="OhSdLYuggDtBcWjYP0j_9">
              <div class="_1sZgBDTw5NH-yuVDZK1SUU"><div id="tail-mount"></div></div>
            </div></div>
          </div></div>
        </div>
      </div>`;
    fixture.before(tailViewport); tailViewport.querySelector('#tail-mount').append(fixture);
    const tailScroller = tailViewport.querySelector('#tail-scroller');
    // The real app already has its native host when the section is inserted.
    // Reinstall after this final wrapper move to register that ancestor chain.
    ui.setupCommunityProgressiveReveal(document, section); await settle();
    for (const [height, zoom, communityZoom, headerHeight] of [
      [500, 1, 1, 50], [420, 1, 1, 50], [500, 1.25, 1, 50], [500, 1.5, 1, 50],
      [500, 1, 1.25, 50], [500, 1, 1.5, 50], [500, 1, 1, 0], [500, 1.25, 1.5, 0],
    ]) {
      const label = `tail${height}zoom${zoom}communityZoom${communityZoom}header${headerHeight}`;
      tailViewport.style.height = `${height}px`; tailViewport.style.zoom = String(zoom);
      tailViewport.firstElementChild.style.height = `${headerHeight}px`; section.style.zoom = String(communityZoom);
      window.dispatchEvent(new Event('resize')); await settle();
      check(getComputedStyle(tailScroller).overflowY === 'scroll' && tailScroller.scrollHeight > tailScroller.clientHeight,
        `${label}: the real native Steam scroll host owns the complete long feed`);
      const viewportBottom = Math.min(window.innerHeight, tailViewport.getBoundingClientRect().bottom);
      const scrollerBottom = tailScroller.getBoundingClientRect().bottom;
      check(Math.abs(scrollerBottom - viewportBottom - headerHeight * zoom) <= 1.1,
        `${label}: the native scroll viewport has the requested parent clipping overlap`);
      const sectionWidth = Number.parseFloat(getComputedStyle(section).width);
      const rootScale = section.getBoundingClientRect().width / sectionWidth;
      const expectedPadding = 24 + Math.max(0, scrollerBottom - viewportBottom) / rootScale;
      check(Math.abs(Number.parseFloat(getComputedStyle(section).paddingBottom) - expectedPadding) <= 1.1,
        `${label}: bottom spacing is exactly 24 CSS pixels plus the measured clipping converted to the Community scale`);
      tailScroller.scrollTop = tailScroller.scrollHeight; await settle();
      const lowest = visible().reduce((bottom, card) => Math.max(bottom, card.getBoundingClientRect().bottom), -Infinity);
      geometry[label] = { viewportBottom, cardBottom: lowest, rootScale, expectedPadding,
        scrollerBottom, scrollTop: tailScroller.scrollTop };
      check(lowest <= viewportBottom + 1.1,
        `${label}: at maximum scroll the lowest card and complete author footer remain visible above the clipping edge (card=${lowest.toFixed(2)}, edge=${viewportBottom.toFixed(2)})`);
      assertNodes(label); assertRows(label); assertPlayers(label); await assertStableResize(label);
    }
    section.style.zoom = '';
    tailViewport.before(fixture); tailViewport.remove();
    ui.setupCommunityProgressiveReveal(document, section);
    window.dispatchEvent(new Event('resize')); await settle();
    check(Math.abs(Number.parseFloat(getComputedStyle(section).paddingBottom) - 24) <= 1.1,
      'Removing clipping restores exactly the native 24px bottom gap without retaining any clearance');
    // Match the user's ordinary three-column row (picture and two guides),
    // then exercise tall art, wide videos and panoramas through native cell
    // packing. Short descriptions must stretch their cards to their row, not
    // leave independent masonry bottoms or oversized portrait-only columns.
    for (const [width, columns] of [[1100, 3], [1120, 4], [1400, 5]]) {
      const rowFixture = document.createElement('div'); rowFixture.id = `dense-gap-preview-${columns}`;
      rowFixture.style.width = `${width}px`;
      const rowActivity = document.createElement('div'); rowFixture.append(rowActivity); fixture.after(rowFixture);
      const rowPicture = image(640, 480, '#77956d');
      const rowItems = [
        { type: 'screenshot', image: rowPicture, title: 'Native aligned picture', author_name: 'Picture author' },
        ...Array.from({ length: columns - 1 }, (_, index) => ({ type: 'guide', image: square,
          title: `Native guide ${index + 1}`, description: index ? 'A short native community guide.' : 'A complete guide to the game and its characters. Find the locations and finish each challenge.', author_name: `Guide author ${index + 1}` })),
        { type: 'artwork', image: art, title: 'Native tall artwork', author_name: 'Artwork author' },
        { ...videos[0], title: 'Native wide video' },
        ...Array.from({ length: 2 * columns }, (_, index) => ({ type: index % 2 ? 'guide' : 'screenshot', image: index % 2 ? square : rowPicture,
          title: `Later aligned card ${index}`, description: index % 2 ? 'A short guide in the aligned native row.' : undefined, author_name: `Later author ${index}` })),
        { type: 'screenshot', image: panorama, title: 'Native panorama spanning three columns', author_name: 'Panorama author' },
      ].map((item, index) => ({ ...item, link: `https://steamcommunity.com/sharedfiles/filedetails/?id=${3000 + columns * 100 + index}` }));
      const staging = document.createElement('div'); staging.innerHTML = ui.renderCommunityContentHtml({}, rowItems);
      const stagingGrid = staging.querySelector('.gdl-community-grid');
      // The separate mixed-feed normalization contract is already checked;
      // supply this known row sequence without replacing any live DOM node.
      rowItems.forEach((item, index) => {
        const card = [...stagingGrid.children].find(card => card.querySelector('.gdl-community-card-title').textContent === item.title);
        card.dataset.gdlCommunityCard = String(index); stagingGrid.append(card);
      });
      const rowSection = ui.insertCommunitySection(document, {}, rowActivity, staging.innerHTML);
      await decode([...rowSection.querySelectorAll('img')]);
      const rowCards = [...rowSection.querySelectorAll('[data-gdl-community-card]')];
      const rowImages = rowCards.map(card => card.querySelector('img'));
      const rowGrid = rowSection.querySelector('.gdl-community-grid');
      const initial = assertGridRows(`nativeRows${columns}`, rowGrid, rowCards);
      check(initial.count === columns && rowCards.slice(0, columns).every(card => {
        const box = card.getBoundingClientRect(); return Math.abs(box.top - initial.box.top) <= 1.1
          && Math.abs(box.bottom - rowCards[0].getBoundingClientRect().bottom) <= 1.1;
      }), `nativeRows${columns}: a picture and short guides share the same native row top, bottom and footer baseline`);
      check(rowCards.find(card => card.querySelector('.gdl-community-card-title').textContent === 'Native panorama spanning three columns')
        .getBoundingClientRect().width >= initial.width * Math.min(3, columns) + 24 * (Math.min(3, columns) - 1) - 1.1,
        `nativeRows${columns}: an actual panoramic image uses the native wide-media span`);
      const beforeRows = rowCards.map(card => card.getBoundingClientRect());
      for (let index = 0; index < 20; index++) window.dispatchEvent(new Event('resize'));
      await settle();
      check(rowCards.every((card, index) => {
        const after = card.getBoundingClientRect(), before = beforeRows[index];
        return card === rowSection.querySelectorAll('[data-gdl-community-card]')[index]
          && card.querySelector('img') === rowImages[index] && Math.abs(after.left - before.left) <= 1.1 && Math.abs(after.top - before.top) <= 1.1;
      }), `nativeRows${columns}: row alignment preserves stable media nodes, feed order and measured coordinates`);
      if (columns === 3) {
        // An independent oracle uses the installed Steam grid, card, picture,
        // guide and author CSS. The 640x480 image determines the 310px first
        // row at 344px per column; shorter guide bodies fill the remaining area.
        const nativeRows = document.createElement('div'); nativeRows.id = 'native-row-preview';
        nativeRows.style.width = `${width}px`;
        const nativeAuthor = name => `<div class="_1ul9ZRBfhF0vyj-hrit6nU"><img src="${avatar}" style="width:32px;height:32px"><div class="rMbCqh2ydczoq62EticF5">${name}</div></div>`;
        nativeRows.innerHTML = `<section class="_2r4TK4BAuU-J4FuF_O7v_5 A6G1leLXs7Vqw45hoXg-l"><div class="_31ptFGGMZrSQc5BCX1e5lm _2G5B7o_YoI__u11--EFjal"><div class="_3Uy7tGY-DstlA3jV6dGEfB"><div class="_1I55h8ejmOddwvE4LFbSEq _290KSp85s48oovzIXHpZ1k" style="grid-template-columns:repeat(3,minmax(256px,1fr))">
          <div class="_3QS6OBHpvI5bXsSQA2zQuW"><div class="_2EOPVRm0FFn4LjXaGZ0Xh9"><div class="_1aP1bu_l_kDbKMN7XDNmzg"><div class="_3XZzfVx8SPRZc4kLownPRd" style="height:258px"><img class="AxZMHRu3YIxDFr0a-MP6n" src="${rowPicture}"></div><div class="_3uabislt81gdMksbxzc-iN"><div class="UhvgnRdPkZbRLaSD8iqLd">Native aligned picture</div></div></div></div>${nativeAuthor('Picture author')}</div>
          ${rowItems.slice(1,3).map(item => `<div class="_3QS6OBHpvI5bXsSQA2zQuW"><div class="_2EOPVRm0FFn4LjXaGZ0Xh9"><div class="_-85o5-M_cGo-fefOuWwER"><div class="_23Pup1qLf91kwjALd-jFGc">Community guide</div><div class="_1dJuvQ4rvlB0q8vmLJH3l2 _33Cd4gWWUSqwn-dCRv_9Ko"><div class="_3XZzfVx8SPRZc4kLownPRd"><img class="AxZMHRu3YIxDFr0a-MP6n" src="${square}"></div><div class="l0pbvMApUzYaf32F51pIO"><div class="_2xEgUh8bB82nVRtIzS6EHD">${item.title}</div></div></div><div class="_3uabislt81gdMksbxzc-iN"><div class="xsBpzsjWWv0lqaQr0yzrG">${item.description}</div></div></div></div>${nativeAuthor(item.author_name)}</div>`).join('')}
          </div></div></div></section>`;
        rowFixture.after(nativeRows); await decode([...nativeRows.querySelectorAll('img')]);
        const oracleCards = [...nativeRows.querySelectorAll('._3QS6OBHpvI5bXsSQA2zQuW')];
        const nativeBox = oracleCards[0].getBoundingClientRect(), linkedBox = rowCards[0].getBoundingClientRect();
        check(Math.abs(initial.width - 344) <= 1.1 && Math.abs(nativeBox.width - linkedBox.width) <= 1.1
          && Math.abs(nativeBox.height - 310) <= 1.1 && Math.abs(linkedBox.height - nativeBox.height) <= 1.1,
          `nativeRows3: the ordinary 640x480 picture row matches the installed native CSS at 344px wide and 310px high (column=${initial.width}, native=${nativeBox.width}x${nativeBox.height}, linked=${linkedBox.width}x${linkedBox.height})`);
        check(oracleCards.every((card, index) => Math.abs(card.getBoundingClientRect().height - rowCards[index].getBoundingClientRect().height) <= 1.1
          && Math.abs(card.querySelector('._1ul9ZRBfhF0vyj-hrit6nU').getBoundingClientRect().height
            - rowCards[index].querySelector('.gdl-community-author-bar').getBoundingClientRect().height) <= 1.1),
          'nativeRows3: guides and their footer heights match the native row rather than ending at separate masonry bottoms');
        geometry.nativeRowOracle = { native: oracleCards.map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height })),
          linked: rowCards.slice(0,3).map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height })) };
        nativeRows.hidden = true;
      }
      geometry[`nativeRows${columns}`] = { columns, rows: initial.heights, cards: initial.placements.map(({ top, left, width, height, span, rows }) => ({ top, left, width, height, span, rows })) };
      ui.disposeCommunitySection(rowSection); rowFixture.hidden = true;
    }
    // Steam displays two videos side by side across its four normal columns.
    // An isolated pair makes that visual contract independent of the variable
    // heights and mixed ordering in the long progressive feed above.
    const pairFixture = document.createElement('div'); pairFixture.id = 'video-pair-preview'; pairFixture.style.width = '1120px';
    const pairActivity = document.createElement('div'); pairFixture.append(pairActivity); fixture.after(pairFixture);
    const pairSection = ui.insertCommunitySection(document, {}, pairActivity, ui.renderCommunityContentHtml({}, videos.slice(0, 2)));
    await decode([...pairSection.querySelectorAll('img')]);
    const pairCards = [...pairSection.querySelectorAll('[data-gdl-community-card]')];
    const pairImages = pairCards.map(card => card.querySelector('.gdl-community-preview'));
    // Use the installed native section margins and actual grid CSS as a
    // separate width oracle. The reported 1118.4px host at 125% zoom loses a
    // whole column if owned horizontal padding differs by even 2px per side.
    const nativePairFixture = document.createElement('div');
    nativePairFixture.innerHTML = `<section class="_2r4TK4BAuU-J4FuF_O7v_5 A6G1leLXs7Vqw45hoXg-l"><div class="_31ptFGGMZrSQc5BCX1e5lm _2G5B7o_YoI__u11--EFjal"><div class="_3Uy7tGY-DstlA3jV6dGEfB"><div class="_1I55h8ejmOddwvE4LFbSEq _290KSp85s48oovzIXHpZ1k"><div style="aspect-ratio:16/9"></div></div></div></div></section>`;
    pairFixture.after(nativePairFixture);
    const nativePairGrid = nativePairFixture.querySelector('._1I55h8ejmOddwvE4LFbSEq');
    const nativePairPoster = nativePairGrid.firstElementChild;
    for (const [width, zoom] of [[1118.4, 1.25], [1116, 1.25], [1115.6, 1.25], [1115.4, 1.25], [840, 1], [560, 1.5], [240, 1.25]]) {
      pairFixture.style.width = nativePairFixture.style.width = `${width}px`;
      pairFixture.style.zoom = nativePairFixture.style.zoom = String(zoom);
      const columns = Math.max(1, Math.min(10, Math.floor((nativePairGrid.clientWidth + 24) / 280)));
      nativePairGrid.style.gridTemplateColumns = `repeat(${columns},minmax(256px,1fr))`;
      nativePairPoster.style.gridColumn = `span ${Math.min(2, columns)}`;
      window.dispatchEvent(new Event('resize')); await settle();
      const label = `nativeVideoWidth${width}zoom${zoom}`;
      const pairGrid = pairSection.querySelector('.gdl-community-grid');
      const nativeBox = nativePairPoster.getBoundingClientRect(), actual = pairCards[0].getBoundingClientRect();
      const actualPoster = pairCards[0].querySelector('.gdl-community-video-thumb').getBoundingClientRect();
      check(Number(pairGrid.style.getPropertyValue('--gdl-community-columns')) === columns
        && pairGrid.clientWidth === nativePairGrid.clientWidth,
        `${label}: native section margins and rounded client width produce the same responsive column count`);
      if (nativePairGrid.clientWidth >= 256) {
        check(Math.abs(actual.width - nativeBox.width) <= 1.1 && Math.abs(actualPoster.height - nativeBox.height) <= 1.1,
          `${label}: the video matches the installed native grid's exact poster width and height`);
      } else {
        check(Math.abs(actual.width - pairGrid.getBoundingClientRect().width) <= 1.1
          && Math.abs(actualPoster.height - actual.width * 9 / 16) <= 1.1,
          `${label}: below the native 256px minimum, the single-column fallback fits the feed with a complete 16:9 poster`);
      }
      if (width === 1118.4) check(columns === 4 && Math.abs(actual.width - 671.5) <= 1.1,
        `${label}: the reported native view retains four normal columns and a 671.5px two-column video`);
      if (width === 1115.6) check(columns === 4,
        `${label}: rounding clientWidth retains the native fourth column immediately below the fractional breakpoint`);
      assertPosters(label, pairCards);
      geometry[label] = { columns, zoom, nativeGridWidth: nativePairGrid.clientWidth, actualGridWidth: pairGrid.clientWidth,
        nativeVideoWidth: nativeBox.width, actualVideoWidth: actual.width, nativePosterHeight: nativeBox.height, actualPosterHeight: actualPoster.height };
    }
    nativePairFixture.remove(); pairFixture.style.zoom = '1';
    for (const [width, columns] of [[1120, 4], [840, 3], [240, 1]]) {
      pairFixture.style.width = `${width}px`; window.dispatchEvent(new Event('resize')); await settle();
      const pairGrid = pairSection.querySelector('.gdl-community-grid'), gridBox = pairGrid.getBoundingClientRect();
      const gridWidth = Number.parseFloat(getComputedStyle(pairGrid).width), columnWidth = (gridWidth - (columns - 1) * 24) / columns;
      const span = Math.min(2, columns), videoWidth = span * columnWidth + (span - 1) * 24;
      const boxes = pairCards.map(card => card.getBoundingClientRect());
      assertPosters(`videoPair${width}`, pairCards);
      check(Number(pairGrid.style.getPropertyValue('--gdl-community-columns')) === columns,
        `videoPair${width}: the real renderer uses ${columns} normal responsive columns`);
      check(boxes.every(box => Math.abs(box.width - videoWidth) <= 1.1)
        && pairCards.every(card => Math.abs(card.querySelector('.gdl-community-video-thumb').getBoundingClientRect().height - videoWidth * 9 / 16) <= 1.1),
        `videoPair${width}: each video occupies ${span} native column${span === 1 ? '' : 's'} with an exact 16:9 poster`);
      check(Math.abs(boxes[0].left - gridBox.left) <= 1.1 && Math.abs(boxes[0].top - gridBox.top) <= 1.1,
        `videoPair${width}: the first video starts at the native grid origin`);
      if (columns === 4) {
        check(Math.abs(boxes[1].left - boxes[0].right - 24) <= 1.1 && Math.abs(boxes[1].top - boxes[0].top) <= 1.1,
          'videoPair1120: two enlarged videos share a full four-column row with the native 24px gutter');
      } else {
        check(Math.abs(boxes[1].left - boxes[0].left) <= 1.1 && Math.abs(boxes[1].top - boxes[0].bottom - 32) <= 1.1,
          `videoPair${width}: videos wrap completely with the native 32px vertical gap`);
      }
      check(pairCards.every((card, index) => card === pairSection.querySelectorAll('[data-gdl-community-card]')[index]
        && card.querySelector('.gdl-community-preview') === pairImages[index])
        && boxes.every(box => box.left >= gridBox.left - 1.1 && box.right <= gridBox.right + 1.1),
        `videoPair${width}: resizing retains both videos and poster nodes entirely inside the feed`);
      check(Math.abs(gridBox.bottom - Math.max(...boxes.map(box => box.bottom))) <= 1.1,
        `videoPair${width}: the feed height reaches the full final video footer`);
      geometry[`videoPair${width}`] = { columns, span, columnWidth, videoWidth, cards: boxes.map(box => ({ left: box.left - gridBox.left,
        top: box.top - gridBox.top, width: box.width, height: box.height })) };
    }
    pairFixture.style.width = '1118.4px'; pairFixture.style.zoom = '1.25'; window.dispatchEvent(new Event('resize')); await settle();
    ui.disposeCommunitySection(pairSection); pairFixture.hidden = true;
    // Use Steam's actual topology: the LeftColumn is full width, its owned
    // activity stack is narrow, and RightColumn floats beside it. Optional
    // Controller, Notes and Media must never trap Community in that narrow stack.
    const adaptiveHost = document.createElement('div');
    adaptiveHost.id = 'controller-layout-preview';
    adaptiveHost.className = '_27RcNu8aXKBpYkHcNNrt-X';
    adaptiveHost.style.cssText = 'position:relative';
    adaptiveHost.innerHTML = '<div class="OhSdLYuggDtBcWjYP0j_9"><aside class="_2aor4XVOYzN1PBSREk0UbO"><div data-native-notes style="height:74px;margin-bottom:26px">Notes</div><div data-native-media style="height:134px;margin-bottom:26px">Recordings &amp; Screenshots</div></aside><main class="_1sZgBDTw5NH-yuVDZK1SUU"><div style="display:flex;flex-direction:column;align-items:stretch;width:calc(67% - 32px);overflow:visible"><div style="height:300px;flex:none">One news item and the end of activity</div></div></main></div>';
    fixture.after(adaptiveHost);
    const adaptiveSidebar = adaptiveHost.querySelector('aside'), adaptiveMain = adaptiveHost.querySelector('main');
    const adaptiveStack = adaptiveMain.firstElementChild, adaptiveActivity = adaptiveStack.firstElementChild;
    const adaptiveRow = adaptiveMain.parentElement;
    const controller = document.createElement('div'); controller.id = 'controller-connection-fixture';
    controller.style.cssText = 'height:170px;margin-bottom:26px'; controller.textContent = 'Connected controller';
    const notes = adaptiveSidebar.querySelector('[data-native-notes]'), recordings = adaptiveSidebar.querySelector('[data-native-media]');
    const sidebarMarkup = [notes.outerHTML, recordings.outerHTML];
    const adaptive = ui.insertCommunitySection(document, { sidebarColumn: adaptiveSidebar, contentColumn: adaptiveMain, twoColumnRow: adaptiveRow },
      adaptiveActivity, ui.renderCommunityContentHtml({}, videos.slice(0, 2)));
    const firstCommunityBox = adaptive.getBoundingClientRect();
    check(adaptive.classList.contains('gdl-community-wide')
      && Math.abs(firstCommunityBox.width - adaptiveMain.getBoundingClientRect().width) <= 1.1,
      'Community publishes the whole detail width synchronously before the first column layout or paint');
    check(Math.abs(firstCommunityBox.top - Math.max(adaptiveActivity.getBoundingClientRect().bottom + 34,
      adaptiveSidebar.getBoundingClientRect().bottom)) <= 1.1,
      'Community publishes its initial sidebar clearance before the first paint');
    await decode([...adaptive.querySelectorAll('img')]);
    const adaptiveCards = [...adaptive.querySelectorAll('[data-gdl-community-card]')];
    const adaptivePlaybackThumb = adaptive.querySelector('.gdl-community-video-thumb');
    adaptivePlaybackThumb.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true })); await settle();
    const adaptivePlayer = adaptivePlaybackThumb.querySelector('iframe');
    check(Boolean(adaptivePlayer), 'The controller-layout fixture starts a real delegated Community player');
    const adaptiveMedia = [...adaptive.querySelectorAll('img')];
    const sidebarStates = [
      { name:'disconnected', connected:false, activity:300 },
      { name:'connected', connected:true, activity:300 },
      { name:'disconnected-again', connected:false, activity:300 },
      { name:'reconnected', connected:true, activity:300 },
      { name:'late-controller-content', connected:true, activity:300, controllerHeight:260 },
      { name:'long-activity', connected:true, activity:900 },
      { name:'no-news', connected:true, activity:80 },
      { name:'disabled-native-sections', connected:true, activity:80, noNotes:true, noMedia:true },
      { name:'hidden-sidebar', connected:true, activity:80, hidden:true },
      { name:'stacked-columns', connected:true, activity:300, stacked:true },
    ];
    for (const width of [320, 560.6, 840.4, 1118.4, 1400]) for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
      adaptiveHost.style.width = `${width}px`; adaptiveHost.style.zoom = String(zoom);
      for (const state of sidebarStates) {
        if (state.connected) adaptiveSidebar.prepend(controller); else controller.remove();
        controller.style.height = `${state.controllerHeight || 170}px`;
        notes.hidden = Boolean(state.noNotes); recordings.hidden = Boolean(state.noMedia);
        adaptiveSidebar.style.display = state.hidden ? 'none' : '';
        adaptiveActivity.style.height = `${state.activity}px`;
        adaptiveHost.classList.toggle('UltraNarrowRightPanel', Boolean(state.stacked));
        adaptiveStack.style.width = state.stacked ? '100%' : 'calc(67% - 32px)';
        // No synthetic window resize: the production observers must react to
        // actual controller insertion/removal and late sidebar height changes.
        await settle(); await settle();
        const label = `adaptive${width}zoom${zoom}/${state.name}`;
        const actual = adaptive.getBoundingClientRect(), mainBox = adaptiveMain.getBoundingClientRect();
        const activityBox = adaptiveActivity.getBoundingClientRect(), sidebarBox = adaptiveSidebar.getBoundingClientRect();
        const expectedTop = Math.max(activityBox.bottom + 34 * zoom, state.hidden ? 0 : sidebarBox.bottom);
        check(adaptive.classList.contains('gdl-community-wide'), `${label}: controller connection preserves full-width Community`);
        check(Math.abs(actual.width - mainBox.width) <= 1.1,
          `${label}: Community occupies the whole native LeftColumn without applying zoom twice`);
        check(Math.abs(actual.top - expectedTop) <= 1.1,
          `${label}: Community follows the taller column with the logical native section gap`);
        const media = [...adaptive.querySelectorAll('img')];
        check(media.every((image, index) => image === adaptiveMedia[index]), `${label}: width changes retain every live media node`);
        check(adaptiveCards.every((card, index) => card === adaptive.querySelectorAll('[data-gdl-community-card]')[index]),
          `${label}: connection changes retain the same cards`);
        check(adaptivePlayer === adaptivePlaybackThumb.querySelector('iframe'), `${label}: the playing video remains mounted`);
        check(notes.outerHTML.replace(/ hidden=""/g, '') === sidebarMarkup[0]
          && recordings.outerHTML.replace(/ hidden=""/g, '') === sidebarMarkup[1],
          `${label}: Notes and Media retain their exact native markup`);
        check([...adaptive.querySelectorAll('[data-gdl-community-card]')].every(card => card.getBoundingClientRect().right <= actual.right + 1.1),
          `${label}: the final card remains inside its actual available width`);
      }
    }
    const adaptiveWrites = [];
    const adaptiveObserver = new MutationObserver(records => adaptiveWrites.push(...records));
    adaptiveObserver.observe(adaptiveHost, { attributes:true, childList:true, subtree:true });
    for (let index = 0; index < 100; index++) window.dispatchEvent(new Event('resize'));
    await settle(); adaptiveWrites.push(...adaptiveObserver.takeRecords()); adaptiveObserver.disconnect();
    check(adaptiveWrites.length === 0, '100 unchanged desktop pane resizes perform zero Community attribute or DOM writes');
    adaptiveHost.classList.remove('UltraNarrowRightPanel'); adaptiveHost.style.width = '1118.4px'; adaptiveHost.style.zoom = '1.25';
    adaptiveStack.style.width = 'calc(67% - 32px)';
    notes.hidden = false; recordings.hidden = false; controller.style.height = '170px';
    adaptiveActivity.style.height = '300px'; await settle(); await settle();
    const connectedPreview = { community: adaptive.getBoundingClientRect().toJSON(),
      activity: adaptiveActivity.getBoundingClientRect().toJSON(), sidebar: adaptiveSidebar.getBoundingClientRect().toJSON(),
      main: adaptiveMain.getBoundingClientRect().toJSON() };
    geometry.controllerConnection = connectedPreview;
    ui.disposeCommunitySection(adaptive);
    const adaptiveMarkup = adaptive.outerHTML;
    adaptiveSidebar.style.display = ''; adaptiveSidebar.style.height = '400px';
    adaptiveHost.style.width = '900px'; window.dispatchEvent(new Event('resize')); await settle();
    check(adaptive.outerHTML === adaptiveMarkup, 'Disposed Community stops adaptive sidebar and pane-width callbacks');
    // Restore the captured geometry using only fixture styles after disposal.
    // Keep the retired DOM hidden for the visual artifact below.
    adaptiveSidebar.style.removeProperty('height'); adaptiveHost.style.width = '1118.4px';
    adaptiveHost.hidden = true;
    check(JSON.stringify(nativeState()) === before, 'Native Community styles, geometry and markup remain byte-for-byte unchanged');
    nativeWrites.push(...nativeObserver.takeRecords()); nativeObserver.disconnect();
    check(nativeWrites.length === 0, 'Render, resize, lazy media, reveal and disposal cause zero native Community mutations');
    navigationCleanup();
    Object.defineProperty(Element.prototype, 'innerHTML', originalInnerHtml);
    window.IntersectionObserver = realIntersectionObserver;
    window.scrollTo(0, section.offsetTop);
    const output = document.createElement('pre'); output.id = 'community-layout-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, geometry }); document.body.append(output);
  } catch (error) {
    Object.defineProperty(Element.prototype, 'innerHTML', originalInnerHtml);
    window.IntersectionObserver = realIntersectionObserver;
    navigationCleanup?.();
    nativeObserver?.disconnect(); if (section) load('community-view').disposeCommunitySection(section);
    const output = document.createElement('pre'); output.id = 'community-layout-result';
    output.textContent = JSON.stringify({ ok: false, results, geometry, error: String(error.stack || error) }); document.body.append(output);
  }
}
const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'community-layout-'));
const htmlPath = path.join(scratch, 'fixture.html'), screenshot = path.join(scratch, 'community-layout.png');
const videoPairScreenshot = path.join(scratch, 'community-video-pair.png');
const nativeRowsScreenshot = path.join(scratch, 'community-native-row-oracle.png');
const controllerLayoutScreenshot = path.join(scratch, 'community-controller-layout.png');
const rowScreenshots = [3, 4, 5].map(columns => ({ columns, file: path.join(scratch, `community-native-rows-${columns}-columns.png`) }));
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:16px;background:#24282f;color:#dcdedf;font-family:"Motiva Sans",Arial,sans-serif}#fixture{width:1120px;position:relative}#community-layout-result{font-size:12px;white-space:pre-wrap}#native-oracle{position:absolute;left:1200px;top:16px;width:256px}</style>
</head><body class="DesktopUI"><div id="fixture"><div id="activity"></div></div><section id="native-oracle"><div class="_3QS6OBHpvI5bXsSQA2zQuW"><div class="_1aP1bu_l_kDbKMN7XDNmzg" style="height:144px"><div class="_3XZzfVx8SPRZc4kLownPRd" style="height:144px;background:#515e6a"></div><div class="_3uabislt81gdMksbxzc-iN"><div class="UhvgnRdPkZbRLaSD8iqLd">Native caption</div></div></div><div class="_1ul9ZRBfhF0vyj-hrit6nU"><div style="width:32px;height:32px;background:#3a6382"></div><div class="rMbCqh2ydczoq62EticF5">Native author</div></div></div></section><script>(${browserChecks.toString()})(${serialize(sources)});document.currentScript.remove();</script></body></html>`);
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 100_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline=Date.now()+90000; while(Date.now()<deadline){ const output=document.getElementById('community-layout-result'); if(output)return JSON.parse(output.textContent); await new Promise(resolve=>setTimeout(resolve,20)); } return {ok:false,results:[],error:'Fixture did not finish'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails)); report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
  if (report.ok) {
    await call('Runtime.evaluate', { expression: `(async () => { document.getElementById('community-layout-result').style.visibility='hidden';const pair=document.getElementById('video-pair-preview');pair.hidden=false;pair.scrollIntoView({block:'start'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); })()`, awaitPromise: true });
    const pairCapture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(videoPairScreenshot, Buffer.from(pairCapture.data, 'base64'));
    // Read the real rendered PNG, rather than only trusting computed fit.
    // Sample the top band and both side edges away from captions/controls.
    const pixels = await call('Runtime.evaluate', {
      expression: `(async () => {
        const screenshot = new Image(); screenshot.src = ${serialize(`data:image/png;base64,${pairCapture.data}`)}; await screenshot.decode();
        const canvas = document.createElement('canvas'); canvas.width = screenshot.naturalWidth; canvas.height = screenshot.naturalHeight;
        const context = canvas.getContext('2d'); context.drawImage(screenshot,0,0);
        const scale = canvas.width / window.innerWidth;
        return [...document.querySelectorAll('#video-pair-preview .gdl-community-video-thumb')].flatMap(thumb => {
          const box = thumb.getBoundingClientRect();
          return [[.15,.03],[.85,.03],[.02,.5],[.98,.5],[.02,.75],[.98,.75]].map(([x,y]) => {
            const pixelX = Math.floor((box.left + box.width*x)*scale), pixelY = Math.floor((box.top + box.height*y)*scale);
            return {x:pixelX,y:pixelY,rgba:[...context.getImageData(pixelX,pixelY,1,1).data]};
          });
        });
      })()`, awaitPromise: true, returnByValue: true,
    });
    assert(!pixels.exceptionDetails, JSON.stringify(pixels.exceptionDetails));
    assert(pixels.result.value.length === 12 && pixels.result.value.every(({ rgba }) => rgba[3] === 255
      && Math.abs(rgba[0] - 78) <= 3 && Math.abs(rgba[1] - 155) <= 3 && Math.abs(rgba[2] - 140) <= 3),
    `The real video screenshot contains letterbox pixels at its poster edges: ${JSON.stringify(pixels.result.value)}`);
    report.results.push('Real captured poster-edge pixels contain the full colored picture without top or side black bands'); report.checks++;
    for (const { columns, file } of rowScreenshots) {
      await call('Runtime.evaluate', { expression: `(async () => { document.getElementById('video-pair-preview').hidden=true;for(const element of document.querySelectorAll('[id^="dense-gap-preview-"]'))element.hidden=true;const dense=document.getElementById('dense-gap-preview-${columns}');dense.hidden=false;dense.scrollIntoView({block:'start'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); })()`, awaitPromise: true });
      const denseCapture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(denseCapture.data, 'base64'));
    }
    await call('Runtime.evaluate', { expression: `(async () => {for(const element of document.querySelectorAll('[id^="dense-gap-preview-"]'))element.hidden=true;const native=document.getElementById('native-row-preview');native.hidden=false;native.scrollIntoView({block:'start'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`, awaitPromise: true });
    const nativeCapture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(nativeRowsScreenshot, Buffer.from(nativeCapture.data, 'base64'));
    await call('Runtime.evaluate', { expression: `(async () => {document.getElementById('native-row-preview').hidden=true;const controller=document.getElementById('controller-layout-preview');controller.hidden=false;controller.scrollIntoView({block:'start'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`, awaitPromise: true });
    const controllerCapture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(controllerLayoutScreenshot, Buffer.from(controllerCapture.data, 'base64'));
  }
} finally { socket?.close(); child.kill(); }
fs.writeFileSync(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2));
assert(report.ok, `${report.error}\nPassed ${report.results.length} assertions; last checks: ${report.results.slice(-6).join('; ')}\nFixture: ${htmlPath}`);
console.log(`Community layout browser passed: ${report.checks} assertions; aligned native rows and footer baselines against installed Steam CSS, portrait/panorama/video spans with 24px/32px gutters, native video width at fractional breakpoints and captured poster pixels without black bands, real 16:9 playback and failed-thumbnail recovery, stable progressive player rectangles and scroll, complete final cards inside clipped native hosts, native caption/guide line limits, 125%/150% zoom, lazy/error/retry media, zero stable writes and untouched native Community.`);
console.log(`Screenshot: ${screenshot}`);
console.log(`Splitter resize work: ${JSON.stringify(report.geometry.splitterResizeWork)}`);
console.log(`Two-video screenshot: ${videoPairScreenshot}`);
console.log(`Native CSS row oracle screenshot: ${nativeRowsScreenshot}`);
console.log(`Controller connection layout screenshot: ${controllerLayoutScreenshot}`);
for (const { columns, file } of rowScreenshots) console.log(`Aligned ${columns}-column screenshot: ${file}`);

