import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';
import { nativeBackgroundOracle } from './helpers/native-background-oracle.mjs';

const oracle = nativeBackgroundOracle();
const steamPath = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const classes = { hero: oracle.heroClasses, details: oracle.detailsClasses, overview: oracle.overviewClasses, header: oracle.headerClasses };
const files = {
  layout: 'frontend/features/library/layout.ts', links: 'frontend/features/library/primary-links.ts',
  positions: 'frontend/features/library/primary-links-layout.ts', nativeDom: 'frontend/steam/native-dom.ts',
  header: 'frontend/steam/library-header.ts', styles: 'frontend/features/library/styles.ts',
  achievement: 'frontend/features/achievements/styles/sidebar.ts', achievementInject: 'frontend/features/achievements/styles/inject.ts',
  inject: 'frontend/features/library/styles/inject.ts',
  ...Object.fromEntries(['info', 'primary-links', 'activity', 'community', 'trading-cards', 'status', 'historical-sidebar', 'controller']
    .map(name => ['style-' + name, `frontend/features/library/styles/${name}.ts`])),
};
const sources = Object.fromEntries(Object.entries(files).map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
// Pure Steam class modules used by the actual link/layout code. Extract them
// from its CSS source registry, without invoking any app-dependent module.
const vm = await import('node:vm'); const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steamPath, 'sp.js'), 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const pure = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/components/pure-class-factory.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: pure });
const classModules = Object.values(factories).map(factory => pure.readPureClassFactory(factory)).filter(Boolean);
const playbar = classModules.find(value => value.StickyHeader && value.InPage && value.GameStatsSection);
const linksClasses = classModules.find(value => value.LinksSectionBody && value.LinkInner && value.Links);
const shell = classModules.find(value => value.AppDetailsSectionContainer && value.RightColumnSection && value.Body);
assert(playbar && linksClasses && shell, 'Installed native layout/link class modules exist');
Object.assign(classes, { playbar, links: linksClasses, shell });
const heroURL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="620"><rect width="960" height="620" fill="#bb4523"/><rect x="960" width="960" height="620" fill="#175a97"/><circle cx="960" cy="200" r="150" fill="#c4a746"/></svg>');
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // All fixtures are offline. CSS mask requests cannot leave the harness.
  await page.route('**/*', route => route.abort());
  for (const width of [1060, 1720]) for (const zoom of [.8, 1, 1.5]) for (const lowPerf of [false, true]) for (const canvas of [false, true]) {
    await page.setViewportSize({ width, height: 900 });
    const headerHtml = oracle.headerHtml({ heroURL, blurURL: canvas ? '' : heroURL, canvas, lowPerf, height: (width - 240) / 3 });
    const samples = [];
    for (const plugin of [false, true]) {
      await page.setContent('<!doctype html><html><head></head><body style="margin:0"></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(steamPath, 'css/library.css'), 'utf8') });
      await page.addStyleTag({ content: fs.readFileSync(path.join(steamPath, 'css/sp.css'), 'utf8') });
      await page.evaluate(({ sources, classes: c, classModules, headerHtml, plugin, zoom, lowPerf }) => {
        document.body.style.zoom = String(zoom);
        const root = document.createElement('div'); root.className = lowPerf ? 'LowPerfMode' : 'HighPerfMode';
        root.style.cssText = 'position:absolute;left:240px;right:0;top:0;bottom:0;';
        root.innerHTML = `<div id="scroll" class="${c.details.ScrollContainer} ${c.details.Glassy}"><div class="${c.details.InnerContainer}"><div id="hero-header" class="${c.details.Header} ${c.details.HeaderLoaded}"><div class="${c.header.Container}">${headerHtml}</div></div><div class="${c.details.AppDetailsOverviewPanel}"><div id="overview" class="${c.overview.Container} ${c.overview.Glassy}"><div class="${c.overview.Backdrop}"><div class="${c.overview.BackdropGlass}"></div></div><div id="playbar" class="${c.playbar.Container} ${c.playbar.InPage}" data-native-appid="3000000001" style="height:90px"><button>Play</button></div><div id="control-links" style="height:46px"></div><div id="columns" class="${c.overview.ColumnContainer}"><div id="left" class="${c.overview.LeftColumn}"><div id="native-content" style="height:2400px">Content</div></div><div id="right" class="${c.overview.RightColumn}"><div role="region" class="${c.shell.AppDetailsSection}"><div class="${c.shell.AppDetailsSectionContainer} ${c.shell.RightColumnSection}"><div class="${c.shell.Body}">Notes</div></div></div></div></div></div></div></div></div>`;
        document.body.append(root);
        if (!plugin) return;
        const modules = {};
        const cssApi = { PLAYBAR_CLASSES: () => c.playbar, LINKS_BAR_CLASSES: () => c.links,
          EVENT_CLASSES: () => ({}), POST_CLASSES: () => ({}),
          resolveClassModule: (predicate, fallback) => ({ classes: classModules.find(predicate) || fallback }) };
        const isPainted = (_doc, element) => Boolean(element?.getBoundingClientRect().width);
        const dependencies = {
          '../../steam/css': cssApi, '../../../steam/css': cssApi, './css': cssApi,
          '@steambrew/client': { findClassModule: predicate => classModules.find(predicate) },
          '../../steam/library-details': { committedHeaderAppId: element => Number(element.dataset.nativeAppid) || null,
            isPaintedLibraryElement: isPainted, paintedNativePlaybar: () => document.getElementById('playbar') },
          '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility() {} },
          '../../steam/localization': { gdlText: (_key, fallback) => fallback },
          './localization': { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback },
          '../../core/steam-links': { steamGameMainPageUrl: () => 'about:blank' },
          '../../core/text': { escapeHtml: value => value },
          '../shortcuts/registry': { getCommittedShortcutSteamAppId: () => '550' },
          '../shortcuts/dismissed': { isShortcutDismissed: () => false },
          './native-route': { routedSteamAppId: () => 3000000001 },
          './rare': { steamRareAchievementStyles: () => '' },
        };
        const load = name => {
          if (modules[name]) return modules[name];
          const exports = modules[name] = {};
          new Function('require', 'exports', sources[name])(specifier => {
            if (dependencies[specifier]) return dependencies[specifier];
            if (specifier === './styles/inject' || specifier === './inject') return load(name === 'achievement' ? 'achievementInject' : 'inject');
            if (specifier === './primary-links-layout') return load('positions');
            if (specifier === '../../steam/native-dom' || specifier === './native-dom') return load('nativeDom');
            if (specifier === '../../steam/library-header') return load('header');
            if (specifier.startsWith('./styles/')) return load('style-' + specifier.split('/').pop());
            throw Error('Unexpected visual dependency ' + name + ':' + specifier);
          }, exports);
          return exports;
        };
        load('styles').ensureNativeGameInfoStyles(document);
        load('style-controller').ensureControllerStyles(document);
        load('achievement').ensureAchievementSidebarStyles(document);
        const left = document.getElementById('left'), right = document.getElementById('right');
        const layout = { contentColumn: left, sidebarColumn: right, twoColumnRow: document.getElementById('columns'),
          anchorRegion: right.firstElementChild, noticeParent: null };
        load('layout').prepareNativeLibraryLayout(layout);
        const content = document.createElement('div'); content.id = 'gdl-main-content-stack'; content.style.height = '2400px';
        load('layout').insertMainContent(content, layout, new Set());
        document.getElementById('control-links').remove();
        const links = load('links').createPrimaryLinksBar(document, layout, { steamAppId: '550', shortcutAppId: '3000000001', hasWorkshop: true });
        load('links').insertPrimaryLinksBar(links, layout);
        if (!links.isConnected || links.dataset.gdlLinksSettled !== '1') throw Error('Production links did not settle under in-page playbar');
        const achievement = document.createElement('div'); achievement.id = 'gdl-achievements-section';
        achievement.style.cssText = 'position:fixed;left:-10000px;';
        achievement.innerHTML = '<div class="gdl-la-body">Achievement backdrop probe</div>';
        right.append(achievement);
        const nativeBody = right.querySelector('.' + c.shell.Body);
        if (getComputedStyle(achievement.firstElementChild).backdropFilter !== getComputedStyle(nativeBody).backdropFilter)
          throw Error('Linked achievements add a second backdrop filter over the native overview glass');
      }, { sources, classes, classModules, headerHtml, plugin, zoom, lowPerf });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const states = [];
      for (const top of [0, 80, 260, 600]) {
        states.push(await page.evaluate(async ({ top, c }) => {
          const scroll = document.getElementById('scroll'); scroll.scrollTop = top;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const box = scroll.getBoundingClientRect();
          const sample = selector => {
            const node = document.querySelector(selector); if (!node) return null;
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            return { left: rect.left - box.left, top: rect.top - box.top, width: rect.width, height: rect.height,
              filter: style.filter, backdropFilter: style.backdropFilter, transform: style.transform,
              perspective: style.perspective, perspectiveOrigin: style.perspectiveOrigin, transformOrigin: style.transformOrigin,
              opacity: style.opacity, maskImage: style.maskImage, background: style.background, overflow: style.overflow };
          };
          return { scroll: sample('#scroll'), header: sample('.' + c.hero.TopCapsule),
            background: sample('.' + c.hero.HeaderBackgroundImage), image: sample('.' + c.hero.ImgContainer),
            blur: sample('.' + c.hero.ImgBlur + ':not(.' + c.hero.ImgBlurBackdrop + ')'),
            reflection: sample('.' + c.hero.ImgBlurBackdrop), glass: sample('.' + c.overview.BackdropGlass) };
        }, { top, c: classes }));
      }
      samples.push(states);
    }
    assert.deepEqual(samples[1], samples[0], `Native background layers changed after plugin layout/styles/links: ${JSON.stringify({ width, zoom, lowPerf, canvas })}`);
    checks += samples[0].length * Object.keys(samples[0][0]).length;
  }
  const sensitivity = await page.evaluate(async c => {
    const scroll = document.getElementById('scroll'); scroll.parentElement.className = 'HighPerfMode';
    const measure = async top => { scroll.scrollTop = top; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.querySelector('.' + c.hero.HeaderBackgroundImage).getBoundingClientRect().top - scroll.getBoundingClientRect().top; };
    const normal = [await measure(0), await measure(80)];
    const style = document.createElement('style'); style.textContent = '#scroll{perspective:none!important}'; document.head.append(style);
    const flattened = [await measure(0), await measure(80)];
    style.remove(); return { normal, flattened };
  }, classes);
  assert(Math.abs((sensitivity.normal[1] - sensitivity.normal[0]) - (sensitivity.flattened[1] - sensitivity.flattened[0])) > 1,
    'Negative control: flattening the native perspective must visibly change background scroll movement');
  checks++;
  const customHeights = [];
  for (const width of [1060, 1280, 1720]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(({ c, height }) => {
      document.body.style.zoom = '1';
      const hero = document.querySelector('.' + c.hero.TopCapsule); hero.style.setProperty('--header-height', height + 'px');
      hero.classList.remove(c.hero.FallbackArt); const official = hero.getBoundingClientRect().height;
      hero.classList.add(c.hero.FallbackArt); const custom = hero.getBoundingClientRect().height;
      return { official, custom };
    }, { c: classes, height: (width - 240) / 3 });
    customHeights.push({ width, ...geometry });
  }
  console.log(`Native background scroll passed: ${checks} layer/movement comparisons, installed Steam render/CSS vs production plugin styles/layout/links at 4 scroll positions, 2 widths, 3 scales, High/LowPerf and image/canvas paths. Canvas blur pixel kernel is not reimplemented or compared.`);
  console.log('Native custom-artwork fallback geometry (not a plugin override): ' + JSON.stringify(customHeights));
} finally { await browser.close(); }
