// Render the real Community UI against the installed Steam Community CSS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || 'C:/Program Files (x86)/Steam/steamui/css/chunk~2dcc5aaf7.css';
assert(fs.existsSync(edge), `Edge executable missing: ${edge}`);
assert(fs.existsSync(steamCss), `Installed Steam CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['community-view', 'frontend/features/library/community-view.ts'],
  ['community-order', 'frontend/features/library/community-order.ts'],
  ['community-style', 'frontend/features/library/styles/community.ts'],
  ['navigation', 'frontend/steam/navigation.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

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
  const realIntersectionObserver = window.IntersectionObserver;
  try {
    navigationCleanup = load('navigation').installSteamNavigation(document);
    const image = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><path d="M0 ${height}L${width} 0" stroke="#eee" stroke-width="8"/></svg>`);
    const art = image(300, 900, '#a46272'), landscape = image(640, 360, '#556d59');
    const panorama = image(1200, 300, '#527e8d'), square = image(400, 400, '#9b7f46');
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
    // its resulting feed sequence across masonry, reveal, image load and resize.
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
    const videos = Array.from({ length: 14 }, (_, index) => ({ type: 'video', image: landscape,
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
    const scale = () => grid.getBoundingClientRect().width / grid.offsetWidth;
    const assertNodes = label => {
      check(cards().every((card, index) => card === originals[index] && card.querySelector('img') === originalImages[index]
        && card.dataset.gdlCommunityCard === originalIndices[index]
        && card.querySelector('.gdl-community-card-title').textContent === originalTitles[index]),
      `${label}: card/image identities and normalized feed order remain stable`);
    };
    const assertMasonry = label => {
      const zoom = scale(), box = grid.getBoundingClientRect();
      const count = Math.max(1, Math.min(10, Math.floor((grid.clientWidth + 24) / 280)));
      const width = (grid.clientWidth - (count - 1) * 24) / count;
      const bottoms = Array(count).fill(0), sizes = [];
      check([...grid.children].every(card => card.hasAttribute('data-gdl-community-card')), `${label}: one stable grid owns every card without preassigned column containers`);
      for (const card of visible()) {
        const rect = card.getBoundingClientRect();
        const left = (rect.left - box.left) / zoom, top = (rect.top - box.top) / zoom;
        const column = Math.round(left / (width + 24)), shortest = Math.min(...bottoms);
        check(column >= 0 && column < count && Math.abs(left - column * (width + 24)) <= 1.1
          && Math.abs(rect.width / zoom - width) <= 1.1, `${label}: entry ${card.dataset.gdlCommunityCard} has the native responsive width and gutter`);
        check(Math.abs(top - shortest) <= 1.1 && Math.abs(bottoms[column] - shortest) <= 1.1,
          `${label}: entry ${card.dataset.gdlCommunityCard} fills the shortest available column without a hole`);
        const height = rect.height / zoom;
        bottoms[column] = top + height + 32; sizes.push(height);
        check(rect.right <= box.right + 1.1 * zoom, `${label}: every complete card stays inside the feed width`);
      }
      const contentBottoms = bottoms.map(value => Math.max(0, value - 32));
      const maxBottom = Math.max(...contentBottoms), minBottom = Math.min(...contentBottoms);
      check(Math.abs(grid.offsetHeight - maxBottom) <= 1.1, `${label}: grid height ends at its lowest visible card`);
      if (getComputedStyle(sentinel).display !== 'none') {
        check(Math.abs((sentinel.getBoundingClientRect().top - box.top) / zoom - maxBottom) <= 1.1,
          `${label}: the next-page sentinel follows the content with no large empty region`);
      }
      check(maxBottom - minBottom <= Math.max(...sizes, 0) + 33.1, `${label}: uneven bottom fill is bounded by one card instead of modulo-column gaps`);
      geometry[label] = { count, zoom, gridHeight: grid.offsetHeight, fillGap: maxBottom - minBottom, maxCardHeight: Math.max(...sizes, 0), visible: visible().length };
    };
    const assertText = label => {
      for (const card of visible()) {
        const cardBox = card.getBoundingClientRect(), author = card.querySelector('.gdl-community-author-bar');
        const footerTop = author?.getBoundingClientRect().top ?? cardBox.bottom;
        for (const text of card.querySelectorAll('.gdl-community-card-title, .gdl-community-card-description, .gdl-community-author')) {
          const textBox = text.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(text);
          const glyphs = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          check(glyphs.length > 0 && glyphs.every(rect => rect.left >= Math.max(cardBox.left, textBox.left) - 1.1
            && rect.right <= Math.min(cardBox.right, textBox.right) + 1.1
            && rect.top >= Math.max(cardBox.top, textBox.top) - 1.1 && rect.bottom <= Math.min(cardBox.bottom, textBox.bottom) + 1.1),
          `${label}: every glyph including the final character is visible for entry ${card.dataset.gdlCommunityCard}`);
          if (!text.classList.contains('gdl-community-author')) {
            check(glyphs.every(rect => rect.bottom <= footerTop + 1.1), `${label}: the author footer never covers caption or description characters`);
          }
          check(text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1,
            `${label}: complete text wraps without line clamps or hidden overflow`);
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
    assertMasonry('initial12'); assertText('initial12');
    check(getComputedStyle(originals[0]).backgroundColor === 'rgb(62, 64, 71)' && getComputedStyle(originals[0]).borderRadius === '6px', 'Community card surface and radius match the installed native Steam CSS');
    const media = originals.find(card => card.querySelector('.gdl-community-media'));
    const caption = media.querySelector('.gdl-community-caption');
    check(caption && getComputedStyle(media.querySelector('.gdl-community-card-title')).fontSize === '14px', 'Native 14px media caption typography remains present');
    check(getComputedStyle(section.querySelector('.gdl-community-native-header')).fontSize === '14px'
      && getComputedStyle(section.querySelector('.gdl-community-native-header')).fontWeight === '400', 'Community header retains native regular 14px typography');
    check(originals.some(card => card.querySelector('.gdl-community-media')?.offsetHeight > 500), 'Tall portrait art retains its natural height instead of stretching every card to match');
    check(originals.find(isVideo)?.dataset.gdlYoutubeId.startsWith('sample')
      && originals.find(card => card.classList.contains('gdl-community-card-guide'))?.dataset.gdlOpenUrl.startsWith('https://steamcommunity.com/'), 'Video playback and community-page actions survive masonry placement');

    // Known content and dimensions: revealing a batch appends only new entries.
    // The preceding visible prefix must remain at the exact same coordinates.
    while (visible().length < originals.length) {
      const previous = visible().map(card => ({ card, left: card.style.left, top: card.style.top }));
      const previousCount = visible().length;
      revealObserver.callback([{ isIntersecting: true }]); await settle();
      check(visible().length === Math.min(originals.length, previousCount + 8), 'Each load-more signal reveals exactly the next eight normalized feed indices');
      check(previous.every(({ card, left, top }) => card.style.left === left && card.style.top === top), 'Progressive append does not move already visible cards with unchanged heights');
      assertNodes(`reveal${visible().length}`); assertMasonry(`reveal${visible().length}`); assertText(`reveal${visible().length}`);
      if (!stagedLazyCard.hidden && !stagedLazyImage.getAttribute('src')) {
        const media = stagedLazyCard.querySelector('.gdl-community-media');
        check(media.offsetHeight >= media.offsetWidth * 9 / 16 - 1,
          'The newly revealed lazy card reserves media space before its image request finishes');
        stagedLazyImage.src = stagedLazyUrl; await decode([stagedLazyImage]);
        check(stagedLazyImage.naturalHeight === 900, 'A progressive-batch thumbnail genuinely adopts its late natural portrait dimensions');
        assertNodes('progressiveLazyImage'); assertMasonry('progressiveLazyImage'); assertText('progressiveLazyImage');
      }
    }
    check(getComputedStyle(sentinel).display === 'none', 'The next-page sentinel disappears after the final real entry');

    for (const [width, zoom] of [[840, 1], [560, 1], [240, 1], [1120, 1.25], [840, 1.5], [1037, 1.25], [1193, 1.5], [1120, 1]]) {
      document.getElementById('fixture').style.width = `${width}px`;
      document.getElementById('fixture').style.zoom = String(zoom);
      await settle();
      assertNodes(`resize${width}zoom${zoom}`); assertMasonry(`resize${width}zoom${zoom}`); assertText(`resize${width}zoom${zoom}`);
      if (width === 1037 || width === 1193) await assertStableResize(`fractional${width}zoom${zoom}`);
    }
    // Lazy media may finish much later or fail. Its existing image/card nodes
    // are retained while the real load/error/ResizeObserver paths recompute gaps.
    const lateCard = originals.find(card => card.querySelector('.gdl-community-media'));
    const lateImage = lateCard.querySelector('.gdl-community-preview');
    lateImage.removeAttribute('src'); await settle();
    lateImage.src = image(300, 1600, '#6b5fa6'); await decode([lateImage]);
    assertNodes('lateTallImage'); assertMasonry('lateTallImage'); assertText('lateTallImage');
    const failedImage = originals.find(card => card.querySelector('.gdl-community-media') && card !== lateCard).querySelector('.gdl-community-preview');
    const failedOriginalUrl = failedImage.getAttribute('src');
    const failed = new Promise(resolve => failedImage.addEventListener('error', resolve, { once: true }));
    failedImage.src = 'data:image/png;base64,not-an-image'; await failed; await settle();
    assertNodes('failedImage'); assertMasonry('failedImage'); assertText('failedImage');
    check(lateImage.naturalHeight === 1600 && failedImage.naturalWidth === 0, 'The fixture exercises genuine late image decoding and a genuine browser image error');
    const failedMedia = failedImage.parentElement;
    check(getComputedStyle(failedImage).display === 'none', 'A failed media request hides the broken-image icon without deleting the existing image node');
    check(failedImage.style.display === '', 'The actual delegated navigation error handler never permanently hides a retryable Community image');
    check(failedMedia.getBoundingClientRect().height <= failedMedia.querySelector('.gdl-community-caption').getBoundingClientRect().height + 1.1,
      'Failed media retains its complete caption without an empty reserved picture rectangle');
    failedImage.src = failedOriginalUrl; await decode([failedImage]);
    assertNodes('recoveredImage'); assertMasonry('recoveredImage'); assertText('recoveredImage');
    check(getComputedStyle(failedImage).display !== 'none', 'A later successful retry restores the same image node and its actual media dimensions');
    const failedVideo = originals.find(isVideo), failedVideoImage = failedVideo.querySelector('.gdl-community-preview');
    const videoSource = failedVideoImage.getAttribute('src'), videoId = failedVideo.dataset.gdlYoutubeId;
    const playControl = failedVideo.querySelector('.gdl-community-play-button');
    const videoError = new Promise(resolve => failedVideoImage.addEventListener('error', resolve, { once: true }));
    failedVideoImage.src = 'data:image/gif;base64,not-a-video-thumbnail'; await videoError; await settle();
    assertNodes('failedVideo'); assertMasonry('failedVideo'); assertText('failedVideo');
    check(getComputedStyle(failedVideoImage).display === 'none' && failedVideo.dataset.gdlYoutubeId === videoId
      && failedVideo.querySelector('.gdl-community-play-button') === playControl && playControl.getBoundingClientRect().height > 0,
      'A missing video thumbnail preserves the same visible playback control and its exact video action');
    check(failedVideoImage.style.display === '', 'The actual delegated navigation error handler never permanently hides a retryable video thumbnail');
    const failedVideoMedia = failedVideoImage.parentElement;
    check(failedVideoMedia.getBoundingClientRect().height <= failedVideoMedia.querySelector('.gdl-community-caption').getBoundingClientRect().height
      + playControl.getBoundingClientRect().height + 17.1,
      'A failed video thumbnail leaves only its complete caption and playback control without a blank poster rectangle');
    failedVideoImage.src = videoSource; await decode([failedVideoImage]);
    assertNodes('recoveredVideo'); assertMasonry('recoveredVideo'); assertText('recoveredVideo');
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
    assertNodes('reinstalledWide'); assertMasonry('reinstalledWide'); assertText('reinstalledWide');
    check(JSON.stringify(nativeState()) === before, 'Native Community styles, geometry and markup remain byte-for-byte unchanged');
    nativeWrites.push(...nativeObserver.takeRecords()); nativeObserver.disconnect();
    check(nativeWrites.length === 0, 'Render, resize, lazy media, reveal and disposal cause zero native Community mutations');
    navigationCleanup();
    window.IntersectionObserver = realIntersectionObserver;
    window.scrollTo(0, section.offsetTop);
    const output = document.createElement('pre'); output.id = 'community-layout-result';
    output.textContent = JSON.stringify({ ok: true, checks: results.length, results, geometry }); document.body.append(output);
  } catch (error) {
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
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Edge CDP timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluated = await call('Runtime.evaluate', {
    expression: `(async () => { const deadline=Date.now()+10000; while(Date.now()<deadline){ const output=document.getElementById('community-layout-result'); if(output)return JSON.parse(output.textContent); await new Promise(resolve=>setTimeout(resolve,20)); } return {ok:false,results:[],error:'Fixture did not finish'}; })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails)); report = evaluated.result.value;
  const capture = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(screenshot, Buffer.from(capture.data, 'base64'));
} finally { socket?.close(); child.kill(); }
assert(report.ok, `${report.error}\nPassed ${report.results.length} assertions; last checks: ${report.results.slice(-6).join('; ')}\nFixture: ${htmlPath}`);
console.log(`Community layout browser passed: ${report.checks} assertions; shortest-height masonry, mixed video batches, full caption/guide/author glyphs, 125%/150% zoom, progressive/lazy/error/retry media, zero stable writes and untouched native Community.`);
console.log(`Screenshot: ${screenshot}`);

