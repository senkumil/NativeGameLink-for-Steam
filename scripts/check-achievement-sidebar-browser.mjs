// Exercise the actual achievement renderer, styles and ResizeObserver in Edge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.ACHIEVEMENT_BROWSER_EXECUTABLE || process.env.CLOUD_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.USERPROFILE || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const playwrightPath = fs.existsSync(playwrightModulePath) && fs.statSync(playwrightModulePath).isDirectory()
  ? path.join(playwrightModulePath, 'index.mjs') : playwrightModulePath;
assert(fs.existsSync(edge), `Edge executable missing: ${edge}`);
assert(fs.existsSync(playwrightPath), `Playwright missing; set PLAYWRIGHT_MODULE_PATH: ${playwrightPath}`);
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const sources = Object.fromEntries([
  ['sidebar', 'frontend/features/achievements/sidebar.ts'],
  ['sidebar-style', 'frontend/features/achievements/styles/sidebar.ts'],
  ['inject', 'frontend/features/achievements/styles/inject.ts'],
  ['rare', 'frontend/features/achievements/styles/rare.ts'],
  ['mask', 'frontend/features/achievements/styles/mask.ts'],
  ['rarity', 'frontend/features/achievements/rarity.ts'],
  ['format', 'frontend/features/achievements/format.ts'],
  ['text', 'frontend/core/text.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

async function browserChecks(sources) {
  const results = [], geometry = {}, modules = {};
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const near = (value, expected, message) => check(Math.abs(value - expected) < .1,
    `${message}: ${value}px (expected ${expected}px)`);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { for (let count = 0; count < 4; count++) await frame(); };
  const localization = {
    steamIntlLocale: () => 'es-419', loc: (_key, fallback) => fallback,
    gdlText: (key, fallback, values = {}) => ({
      locked_achievements: 'Logros bloqueados', view_all_achievements: 'Ver todos mis logros',
      achievements_unlocked: 'Has desbloqueado {unlocked}/{total}',
    }[key] || fallback).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match)),
  };
  const dependencies = {
    '../../api/backend': { backendLog() {} },
    '../../steam/localization': localization,
    './cache': { cacheLocalAchievements() {}, localAchievementDataSignature: data => encodeURIComponent(JSON.stringify(data)) },
    './playbar': { ensureLocalPlaybarStat() {} },
    './modal': { openLocalAchievementsModal: async () => {} },
    './steam-rare': {
      getSteamRareAchievementClasses: () => ({ wrapper: 'fixture-rare-frame', icon: 'fixture-rare-icon', iconGlow: 'fixture-rare-glow' }),
      renderSteamRareGlowHtml: () => '',
    },
  };
  const aliases = { '../../core/text': 'text', './format': 'format', './rarity': 'rarity',
    './inject': 'inject', './rare': 'rare', './mask': 'mask' };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      if (dependency in aliases) return load(aliases[dependency]);
      throw new Error(`Unexpected ${name} dependency: ${dependency}`);
    }, exports);
    return exports;
  };
  const icon = index => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#1f2d3a"/><path d="M${8 + index % 4} 37L24 8L40 37Z" stroke="#d8d8d8" fill="#748598" stroke-width="2"/><circle cx="24" cy="27" r="5" fill="#18212b"/></svg>`)}`;
  const fixtureData = (total, unlocked = 0) => ({
    found: true, appid: '1790600', state_appid: '3000000001', total, unlocked,
    achievements: Array.from({ length: total }, (_, index) => ({
      name: `ACH_${String(index).padStart(3, '0')}`, display_name: `Logro ${index + 1}`,
      description: `Completa el desafío ${index + 1}`, icon: icon(index), icon_gray: icon(index), hidden: false,
      global_percent: 75 - index, earned: index < unlocked, earned_time: unlocked - index,
      progress: 0, max_progress: 0,
    })),
  });
  const section = document.getElementById('gdl-achievements-section');
  const content = document.getElementById('gdl-achievements-content');
  try {
    load('sidebar-style').ensureAchievementSidebarStyles(document);
    const sidebar = load('sidebar');
    const render = async (data, width = 356) => {
      section.style.width = `${width}px`;
      sidebar.renderLocalAchievementSidebar(document, data);
      await settle();
      return content.querySelector('.gdl-la-summary');
    };
    const lockedRow = summary => summary.querySelector('.gdl-la-locked-row-wrap .gdl-la-icon-row');
    const checkCounts = (row, icons, more, message) => {
      check(row.querySelectorAll('.gdl-la-icon-frame').length === icons, `${message}: ${icons} achievement icons`);
      check((row.querySelector('.gdl-la-more')?.textContent || '') === more, `${message}: ${more || 'no'} overflow cell`);
    };
    const checkFeaturedText = (summary, data, expectedIndices, message) => {
      const features = Array.from(summary.querySelectorAll('.gdl-la-feature'));
      check(features.length === expectedIndices.length,
        `${message}: ${expectedIndices.length} achievements with full text`);
      for (const [index, feature] of features.entries()) {
        const expected = data.achievements[expectedIndices[index]];
        const title = feature.querySelector('.gdl-la-feature-title');
        const description = feature.querySelector('.gdl-la-feature-desc');
        const image = feature.querySelector('.gdl-la-icon');
        check(title?.textContent === expected.display_name,
          `${message}: feature ${index + 1} has the correct rarity-ordered name`);
        check(description?.textContent === expected.description,
          `${message}: feature ${index + 1} has its own complete description`);
        check(image?.getAttribute('src') === expected.icon,
          `${message}: feature ${index + 1} text belongs to its icon`);
        for (const [label, text] of [['name', title], ['description', description]]) {
          const box = text.getBoundingClientRect(), css = getComputedStyle(text);
          check(box.width > 0 && box.height > 0 && css.display !== 'none'
            && css.visibility === 'visible' && Number(css.opacity) > 0,
          `${message}: feature ${index + 1} ${label} is visibly laid out`);
          check(text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight,
            `${message}: feature ${index + 1} ${label} fits without clipping`);
          check(box.left >= image.getBoundingClientRect().right,
            `${message}: feature ${index + 1} ${label} sits beside its icon`);
        }
      }
    };
    const checkSpacing = (summary, message) => {
      const body = summary.querySelector('.gdl-la-body'), header = summary.querySelector('.gdl-la-header');
      const row = lockedRow(summary), label = summary.querySelector('.gdl-la-locked-label');
      const view = summary.querySelector('.gdl-la-view'), cells = Array.from(row.children);
      const bodyCss = getComputedStyle(body), headerCss = getComputedStyle(header), rowCss = getComputedStyle(row);
      near(parseFloat(bodyCss.paddingTop), 16, `${message}: native body top padding`);
      near(parseFloat(bodyCss.paddingLeft), 10, `${message}: native body left padding`);
      near(parseFloat(bodyCss.paddingRight), 10, `${message}: native body right padding`);
      near(parseFloat(bodyCss.paddingBottom), 10, `${message}: native body bottom padding`);
      near(parseFloat(headerCss.paddingTop), 11, `${message}: native header top padding`);
      near(parseFloat(headerCss.paddingBottom), 14, `${message}: native header bottom padding`);
      near(parseFloat(headerCss.paddingLeft), 10, `${message}: native header horizontal padding`);
      near(summary.querySelector('.gdl-la-progress-track').getBoundingClientRect().height, 8,
        `${message}: native progress height`);
      near(parseFloat(rowCss.columnGap), 8, `${message}: native icon gap`);
      for (const [index, cell] of cells.entries()) {
        const box = cell.getBoundingClientRect();
        near(box.width, 48, `${message}: cell ${index + 1} width`);
        near(box.height, 48, `${message}: cell ${index + 1} height`);
        if (index) near(box.left - cells[index - 1].getBoundingClientRect().right, 8,
          `${message}: gap before cell ${index + 1}`);
      }
      near(row.getBoundingClientRect().top - label.getBoundingClientRect().bottom, 8,
        `${message}: native label to icon spacing`);
      near(view.getBoundingClientRect().top - row.getBoundingClientRect().bottom, 18,
        `${message}: native footer spacing`);
      check(cells.at(-1).getBoundingClientRect().right <= row.getBoundingClientRect().right + .1,
        `${message}: no row overflow`);
      check(summary.scrollWidth <= summary.clientWidth, `${message}: no panel overflow`);
      return { panel: summary.getBoundingClientRect().height, body: body.getBoundingClientRect().height,
        row: row.getBoundingClientRect().width, tiles: cells.length };
    };

    for (const [total, more] of [[45, '+41'], [50, '+46']]) {
      const summary = await render(fixtureData(total));
      check(!summary.querySelector('.gdl-la-divider'), `0/${total}: no empty earned divider`);
      check(!summary.querySelector('.gdl-la-feature'), `0/${total}: no empty featured slot`);
      checkCounts(lockedRow(summary), 4, more, `0/${total}`);
      geometry[`0/${total}`] = checkSpacing(summary, `0/${total}`);
      near(summary.querySelector('.gdl-la-locked-label').getBoundingClientRect().top
        - summary.querySelector('.gdl-la-body').getBoundingClientRect().top, 16,
      `0/${total}: locked label starts at native body padding`);
    }
    const exactlyFive = await render(fixtureData(5));
    checkCounts(lockedRow(exactlyFive), 5, '', 'Exactly five locked');
    check(!exactlyFive.querySelector('.gdl-la-divider'), 'Exactly five locked: no divider');

    const oneEarned = await render(fixtureData(50, 1));
    check(oneEarned.querySelectorAll('.gdl-la-divider').length === 1, 'One earned: retained separator before locked block');
    check(oneEarned.querySelectorAll('.gdl-la-feature').length === 1, 'One earned: retained featured achievement');
    checkCounts(lockedRow(oneEarned), 4, '+45', 'One earned: locked row');
    checkSpacing(oneEarned, 'One earned');

    // Steam keeps both earned achievements as full icon/name/description rows
    // until the third achievement switches the lower portion to thumbnails.
    for (const [unlocked, expectedIndices] of [[0, []], [1, [0]], [2, [1, 0]], [3, [2]]]) {
      const data = fixtureData(50, unlocked), message = `${unlocked}/50 text layout`;
      const summary = await render(data);
      checkFeaturedText(summary, data, expectedIndices, message);
      checkCounts(lockedRow(summary), 4,
        `+${50 - unlocked - 4}`, `${message}: locked row`);
      check(summary.querySelectorAll('.gdl-la-divider').length === (unlocked ? 1 : 0),
        `${message}: separator follows earned state`);
      if (unlocked === 3) {
        checkCounts(summary.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row'), 2, '',
          `${message}: remaining earned achievements stay in thumbnail row`);
      } else {
        check(!summary.querySelector('.gdl-la-earned-row-wrap'),
          `${message}: no isolated earned thumbnails without text`);
      }
      geometry[`text-${unlocked}/50`] = checkSpacing(summary, message);
    }
    const twoCompleteData = fixtureData(2, 2), twoComplete = await render(twoCompleteData);
    check(twoComplete.classList.contains('is-complete'), '2/2: completion panel retained');
    checkFeaturedText(twoComplete, twoCompleteData, [1, 0], '2/2 completed text layout');
    check(!twoComplete.querySelector('.gdl-la-earned-row-wrap'), '2/2: no isolated earned thumbnail row');
    check(!twoComplete.querySelector('.gdl-la-locked-row-wrap'), '2/2: no empty locked row');

    const manyEarned = await render(fixtureData(50, 12));
    checkCounts(manyEarned.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row'), 4, '+7',
      'Many earned: four thumbnails after featured achievement');
    check(manyEarned.querySelectorAll('.gdl-la-feature .gdl-la-icon-frame').length === 1,
      'Many earned: retained separate featured icon');
    checkCounts(lockedRow(manyEarned), 4, '+34', 'Many earned: four locked thumbnails');

    const screenshotProgress = await render(fixtureData(50, 32));
    checkCounts(screenshotProgress.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row'), 4, '+27',
      '32/50: four earned thumbnails after featured achievement');
    checkCounts(lockedRow(screenshotProgress), 4, '+14', '32/50: four locked thumbnails');
    check(screenshotProgress.querySelectorAll('.gdl-la-divider').length === 1,
      '32/50: single separator between earned and locked achievements');
    geometry['32/50'] = checkSpacing(screenshotProgress, '32/50');
    const divider = screenshotProgress.querySelector('.gdl-la-divider');
    const earnedRow = screenshotProgress.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row');
    near(divider.getBoundingClientRect().height, 1, '32/50: native separator height');
    near(divider.getBoundingClientRect().top - earnedRow.getBoundingClientRect().bottom, 14,
      '32/50: native earned row to separator spacing');
    near(screenshotProgress.querySelector('.gdl-la-locked-label').getBoundingClientRect().top
      - divider.getBoundingClientRect().bottom, 10, '32/50: native separator to locked label spacing');

    for (const [total, icons, more] of [[2, 1, ''], [4, 3, ''], [5, 4, ''], [6, 5, '']]) {
      const summary = await render(fixtureData(total, 1));
      checkCounts(lockedRow(summary), icons, more, `One earned, ${total - 1} locked`);
      check(summary.querySelectorAll('.gdl-la-divider').length === 1,
        `One earned, ${total - 1} locked: separator retained`);
      check(!summary.querySelector('.gdl-la-earned-row-wrap'),
        `One earned, ${total - 1} locked: no extra earned thumbnail row`);
    }

    const responsiveData = fixtureData(45);
    const responsive = await render(responsiveData);
    for (const [width, icons, more] of [[240, 2, '+43'], [300, 3, '+42'], [356, 4, '+41'],
      [520, 7, '+38'], [126, 0, '+45'], [356, 4, '+41']]) {
      section.style.width = `${width}px`;
      await settle();
      check(content.querySelector('.gdl-la-summary') === responsive,
        `Resize to ${width}px: updated existing summary`);
      checkCounts(lockedRow(responsive), icons, more, `Resize to ${width}px`);
      geometry[`width-${width}`] = checkSpacing(responsive, `Resize to ${width}px`);
      check(!responsive.querySelector('.gdl-la-divider'), `Resize to ${width}px: no empty divider reappears`);
    }

    const responsiveProgressData = fixtureData(50, 32);
    const responsiveProgress = await render(responsiveProgressData);
    for (const [width, icons, more, earnedMore] of [[240, 2, '+16', '+29'], [300, 3, '+15', '+28'],
      [356, 4, '+14', '+27'], [520, 7, '+11', '+24'], [126, 0, '+18', '+31'], [356, 4, '+14', '+27']]) {
      section.style.width = `${width}px`;
      await settle();
      check(content.querySelector('.gdl-la-summary') === responsiveProgress,
        `32/50 resize to ${width}px: updated existing summary`);
      checkCounts(lockedRow(responsiveProgress), icons, more, `32/50 resize to ${width}px: locked row`);
      checkCounts(responsiveProgress.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row'), icons, earnedMore,
        `32/50 resize to ${width}px: earned row`);
      geometry[`progress-width-${width}`] = checkSpacing(responsiveProgress, `32/50 resize to ${width}px`);
      check(responsiveProgress.querySelectorAll('.gdl-la-divider').length === 1,
        `32/50 resize to ${width}px: retained separator`);
    }

    const twoEarnedData = fixtureData(50, 2), twoEarned = await render(twoEarnedData);
    for (const [width, icons, more] of [[240, 2, '+46'], [300, 3, '+45'], [356, 4, '+44'],
      [520, 7, '+41'], [240, 2, '+46'], [356, 4, '+44']]) {
      section.style.width = `${width}px`;
      await settle();
      const message = `2/50 resize to ${width}px`;
      check(content.querySelector('.gdl-la-summary') === twoEarned,
        `${message}: updated existing summary`);
      checkFeaturedText(twoEarned, twoEarnedData, [1, 0], message);
      check(!twoEarned.querySelector('.gdl-la-earned-row-wrap'),
        `${message}: both earned rows retain text during resize`);
      checkCounts(lockedRow(twoEarned), icons, more, `${message}: locked row`);
      geometry[`two-earned-width-${width}`] = checkSpacing(twoEarned, message);
    }

    // Feed new progress for the same app through the actual cached renderer.
    // Counts and remainder must update in both directions without navigation.
    const transitionData = [fixtureData(50), fixtureData(50, 1), fixtureData(50)];
    check(transitionData.every(data => data.appid === transitionData[0].appid
      && data.state_appid === transitionData[0].state_appid), 'Live progress transition keeps app identity');
    for (const [index, data] of transitionData.entries()) {
      const summary = await render(data);
      check(content.querySelectorAll('.gdl-la-summary').length === 1,
        `Live progress transition ${index + 1}: one rendered panel`);
      checkCounts(lockedRow(summary), 4, data.unlocked ? '+45' : '+46',
        `Live progress transition ${index + 1}: ${data.unlocked}/50`);
      check(summary.querySelectorAll('.gdl-la-divider').length === (data.unlocked ? 1 : 0),
        `Live progress transition ${index + 1}: separator follows earned state`);
      check(summary.querySelectorAll('.gdl-la-feature').length === (data.unlocked ? 1 : 0),
        `Live progress transition ${index + 1}: featured achievement follows earned state`);
      sidebar.renderLocalAchievementSidebar(document, data);
      await settle();
      check(content.querySelector('.gdl-la-summary') === summary,
        `Live progress transition ${index + 1}: identical progress preserves rendered panel`);
    }

    for (const [index, unlocked] of [1, 2, 3, 2].entries()) {
      const data = fixtureData(50, unlocked), summary = await render(data);
      const message = `Earned text transition ${index + 1}: ${unlocked}/50`;
      check(content.querySelectorAll('.gdl-la-summary').length === 1,
        `${message}: one rendered panel`);
      checkFeaturedText(summary, data, unlocked === 2 ? [1, 0] : [unlocked - 1], message);
      checkCounts(lockedRow(summary), 4, `+${46 - unlocked}`, `${message}: locked row`);
      if (unlocked === 3) {
        checkCounts(summary.querySelector('.gdl-la-earned-row-wrap .gdl-la-icon-row'), 2, '',
          `${message}: two remaining earned thumbnails`);
      } else {
        check(!summary.querySelector('.gdl-la-earned-row-wrap'),
          `${message}: full text rows replace earned thumbnails`);
      }
      sidebar.renderLocalAchievementSidebar(document, data);
      await settle();
      check(content.querySelector('.gdl-la-summary') === summary,
        `${message}: identical progress preserves rendered panel`);
      checkFeaturedText(summary, data, unlocked === 2 ? [1, 0] : [unlocked - 1],
        `${message} after cached render`);
    }

    // Leave the reported two-earned state for the review screenshot.
    await render(fixtureData(50, 2));
    document.getElementById('fixture-caption').textContent = '2/50 · ambos logros con nombre y descripción';
    return { ok: true, results, geometry };
  } catch (error) {
    return { ok: false, results, geometry, error: String(error.stack || error) };
  }
}

const scratchRoot = path.join(root, 'scratch'); fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'achievement-sidebar-'));
const htmlPath = path.join(scratch, 'fixture.html'), screenshot = path.join(scratch, 'achievement-sidebar.png');
const fontPath = path.join(root, 'scratch/achievement-modal-fonts/MotivaSans-Regular.ttf');
const fontCss = fs.existsSync(fontPath)
  ? `@font-face{font-family:"Motiva Sans";font-weight:400;src:url("${pathToFileURL(fontPath).href}")}` : '';
fs.writeFileSync(htmlPath, `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${fontCss}
html{background:#262c33}body{margin:28px;font-family:"Motiva Sans",Arial,sans-serif;color:#dcdedf}
#gdl-achievements-section{width:356px}#fixture-caption{font-size:12px;color:#8f98a0;margin-bottom:20px}
</style></head><body><div id="fixture-caption">Achievement sidebar</div><section id="gdl-achievements-section">
<h2 class="gdl-native-section-heading">Logros</h2><div id="gdl-achievements-content"></div></section></body></html>`);
const browser = await chromium.launch({ executablePath: edge, headless: true,
  args: ['--allow-file-access-from-files', '--disable-background-networking', '--no-first-run'] });
let report;
try {
  const page = await browser.newPage({ viewport: { width: 550, height: 390 }, deviceScaleFactor: 1.25 });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.evaluate(() => document.fonts.ready);
  report = await page.evaluate(browserChecks, sources);
  await page.screenshot({ path: screenshot, fullPage: true });
} finally { await browser.close(); }
assert(report.ok, `${report.error}\nPassed: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Achievement sidebar browser: ${report.results.length} checks passed (zero and earned progress, two earned text rows, native spacing, overflow counts, live resizing and progress transitions).`);
console.log(JSON.stringify(report.geometry));
console.log(`Screenshot: ${screenshot}`);
