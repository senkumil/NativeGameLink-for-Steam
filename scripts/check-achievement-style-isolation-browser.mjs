// Production styles and layout mutations in an isolated Edge document.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packages = process.env.CODEX_NODE_MODULES || path.join(process.env.USERPROFILE || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(packages, 'playwright'))); }
const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_ACHIEVEMENT_CSS || 'C:/Program Files (x86)/Steam/steamui/css/sp.css';
assert(fs.existsSync(edge) && fs.existsSync(steamCss), 'Installed Edge and Steam achievement CSS are required');
const sources = Object.fromEntries([
  ['layout', 'frontend/features/library/layout.ts'],
  ['sidebar', 'frontend/features/achievements/styles/sidebar.ts'],
  ['modal', 'frontend/features/achievements/styles/modal.ts'],
  ['playbar', 'frontend/features/achievements/styles/playbar.ts'],
  ['rare', 'frontend/features/achievements/styles/rare.ts'],
  ['mask', 'frontend/features/achievements/styles/mask.ts'],
  ['inject', 'frontend/features/achievements/styles/inject.ts'],
  ['native-achievement-layout', 'frontend/steam/native-achievement-layout.ts'],
  ['css', 'frontend/steam/css.ts'], ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['SteamWebpackRuntime', 'frontend/steam/modules/SteamWebpackRuntime.ts'],
  ['SteamUIModeService', 'frontend/steam/ui/SteamUIModeService.ts'],
  ['native-window-store', 'frontend/steam/native-window-store.ts'],
].map(([name, filename]) => [name, ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

async function browserChecks(sources) {
  const loaded = {}, results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const dependencies = {
    '@steambrew/client': { modules: new Map([['native-achievement-css', {
      AllAchieved: '_2YS0EBJmY2Rvs07zZ90UIJ', HighlightDiv: '_2xTb6N-jUUQ-mIkMB6OVMm',
    }]]) },
    '../../api/backend': { backendLog() {} },
    '../../steam/localization': { loc: (_key, fallback) => fallback },
    '../../steam/playbar-visibility': { restoreLinkedPlaybarVisibility() {} },
    '../../steam/library-header': { containsNativeLibraryHeader: () => false, isInsideNativeLibraryHeader: () => false },
    '../../steam/library-details': { committedHeaderAppId: () => null },
    '../../steam/native-dom': { elementsWithCssModuleClass: () => [], hasCssModuleClass: () => false },
  };
  function load(name) {
    if (loaded[name]) return loaded[name];
    const exports = loaded[name] = {};
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const key = dependency.split('/').pop();
      if (key in sources) return load(key);
      throw Error(`Unexpected ${name} dependency: ${dependency}`);
    }, exports);
    return exports;
  }
  const stock = document.getElementById('stock');
  const snapshot = () => {
    const style = getComputedStyle(stock);
    return JSON.stringify(['padding', 'display', 'height', 'minHeight', 'fontSize', 'lineHeight']
      .map(property => [property, style[property]]));
  };
  const frames = () => JSON.stringify(stock.getAnimations()[0].effect.getKeyframes().map(frame => frame.transform));
  const before = snapshot(), beforeFrames = frames();
  load('sidebar').ensureAchievementSidebarStyles(document);
  load('modal').ensureAchievementModalStyles(document);
  load('playbar').ensureAchievementPlaybarStyles(document);
  check(snapshot() === before, 'Stock achievement typography and geometry remain identical');
  check(frames() === beforeFrames, 'A Steam-global animation cannot be redefined by plugin styles');
  const matchingSelectors = [];
  for (const style of document.querySelectorAll('style[id^="gdl-achievement-"]')) {
    const inspect = rules => {
      for (const rule of rules) {
        if (rule.selectorText) {
          if ([stock, ...stock.querySelectorAll('*')].some(element => element.matches(rule.selectorText))) {
            matchingSelectors.push(rule.selectorText);
          }
        } else if (rule.cssRules) inspect(rule.cssRules);
      }
    };
    inspect(style.sheet.cssRules);
  }
  check(matchingSelectors.length === 0, 'No achievement stylesheet selector matches the stock fixture');
  const layout = load('layout');
  const content = document.createElement('div'), row = document.createElement('div'), hidden = document.createElement('div');
  content.style.cssText = 'display:grid!important;height:147px!important;min-height:73px!important;align-self:center!important;padding:11px';
  row.style.cssText = 'display:flex!important;align-items:center!important';
  hidden.style.cssText = 'display:flex!important';
  document.body.append(content, row, hidden);
  const styleState = element => ['display', 'height', 'min-height', 'align-self', 'align-items', 'padding']
    .map(property => [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
  const originals = [content, row, hidden].map(styleState);
  layout.hideNativeLibraryElement(hidden);
  layout.hideNativeLibraryElement(hidden);
  layout.prepareNativeLibraryLayout({ contentColumn: content, twoColumnRow: row });
  layout.prepareNativeLibraryLayout({ contentColumn: content, twoColumnRow: row });
  check(getComputedStyle(hidden).display === 'none', 'The fixture is actually hidden before restoring');
  check(content.style.height === 'auto', 'Preparation applies its temporary geometry before restoring');
  // Disconnected managed nodes must be restored as well: Steam may reuse them.
  content.remove();
  layout.restoreNativeLibraryStyles(document);
  check(JSON.stringify([content, row, hidden].map(styleState)) === JSON.stringify(originals),
    'Every managed inline value and !important priority is restored exactly, including absent properties');
  check(!hidden.hasAttribute('data-gdl-hidden'), 'The plugin hiding marker is removed');
  hidden.style.setProperty('display', 'inline-grid', 'important');
  layout.hideNativeLibraryElement(hidden);
  layout.restoreNativeLibraryStyles(document);
  check(hidden.style.getPropertyValue('display') === 'inline-grid'
    && hidden.style.getPropertyPriority('display') === 'important',
  'A second activation takes a fresh snapshot of Steam inline styles');
  const blank = document.createElement('div'); document.body.appendChild(blank);
  layout.prepareNativeLibraryLayout({ contentColumn: blank });
  layout.restoreNativeLibraryStyles(document);
  check(blank.style.cssText === '', 'Originally absent inline geometry is removed on cleanup');

  const late = document.createElement('div'); document.body.appendChild(late);
  late.style.cssText = 'display:grid!important;height:90px!important;min-height:20px!important';
  layout.prepareNativeLibraryLayout({ contentColumn: late });
  late.style.setProperty('height', '222px', 'important');
  layout.restoreNativeLibraryStyles(document);
  check(late.style.getPropertyValue('height') === '222px' && late.style.getPropertyPriority('height') === 'important'
    && late.style.getPropertyValue('display') === 'grid' && late.style.getPropertyPriority('display') === 'important',
    'Cleanup preserves a newer native height while restoring only properties still owned by GDL');
  layout.prepareNativeLibraryLayout({ contentColumn: late });
  late.style.setProperty('height', '333px', 'important');
  layout.prepareNativeLibraryLayout({ contentColumn: late });
  layout.restoreNativeLibraryStyles(document);
  check(late.style.getPropertyValue('height') === '333px' && late.style.getPropertyPriority('height') === 'important',
    'A repeated linked render adopts the latest native style as its restoration base');

  const nativeLayout = load('native-achievement-layout');
  const nativeClasses = '_2YS0EBJmY2Rvs07zZ90UIJ _2xTb6N-jUUQ-mIkMB6OVMm _38t1mljBjmJfqjpVzMT1CG';
  const own = document.createElement('div'); own.id = 'gdl-layout-owned-fixture';
  own.innerHTML = `<div class="${nativeClasses}">Owned completion</div>`; document.body.appendChild(own);
  const ordinary = document.createElement('div'); ordinary.className = '_2xTb6N-jUUQ-mIkMB6OVMm _38t1mljBjmJfqjpVzMT1CG';
  ordinary.textContent = 'Unfinished native achievements'; document.querySelector('main').appendChild(ordinary);
  const ownedPadding = getComputedStyle(own.firstChild).paddingInlineStart;
  const ordinaryPadding = getComputedStyle(ordinary).paddingInlineStart;
  const nativePadding = getComputedStyle(stock).paddingInlineStart;
  const untouchedPadding = [getComputedStyle(stock).paddingTop, getComputedStyle(stock).paddingBottom, getComputedStyle(stock).paddingInlineEnd];
  check(nativePadding === '10px', 'Installed Steam CSS reproduces the completed-card reservation collision');
  window.name = 'SP Desktop';
  const disposeNative = nativeLayout.installNativeAchievementLayout(document);
  check(getComputedStyle(stock).paddingInlineStart === '46px', 'Validated Desktop restores the native completed-card ribbon reservation');
  check(JSON.stringify([getComputedStyle(stock).paddingTop, getComputedStyle(stock).paddingBottom, getComputedStyle(stock).paddingInlineEnd]) === JSON.stringify(untouchedPadding),
    'The reservation fix changes only the completed card inline start padding');
  check(getComputedStyle(own.firstChild).paddingInlineStart === ownedPadding,
    'Plugin-owned cards remain unchanged even when carrying the same Steam classes');
  check(getComputedStyle(ordinary).paddingInlineStart === ordinaryPadding,
    'Unfinished native achievement cards retain Steam padding');
  check(nativeLayout.installNativeAchievementLayout(document) === disposeNative, 'Installing the compatibility rule twice shares one cleanup');
  document.body.classList.add('BasicUI');
  check(getComputedStyle(stock).paddingInlineStart === nativePadding, 'Big Picture class ancestry disables the reservation immediately');
  await Promise.resolve(); await Promise.resolve();
  check(!document.getElementById('ngl-native-achievement-layout-style'), 'A Desktop document entering Big Picture removes its compatibility stylesheet');
  document.body.classList.remove('BasicUI');
  await Promise.resolve(); await Promise.resolve();
  check(getComputedStyle(stock).paddingInlineStart === '46px', 'Returning to validated Desktop restores its reservation');
  disposeNative(); disposeNative();
  check(getComputedStyle(stock).paddingInlineStart === nativePadding
    && !document.getElementById('ngl-native-achievement-layout-style')
    && !document.documentElement.hasAttribute('data-ngl-native-achievement-layout'),
  'Disposal restores the original native padding and removes all compatibility DOM ownership');
  const themeReservation = document.createElement('style');
  themeReservation.textContent = '._2YS0EBJmY2Rvs07zZ90UIJ{padding-inline-start:64px}';
  document.head.appendChild(themeReservation);
  check(getComputedStyle(stock).paddingInlineStart === '64px', 'A larger native or theme reservation starts correctly before compatibility');
  const disposeTheme = nativeLayout.installNativeAchievementLayout(document);
  check(getComputedStyle(stock).paddingInlineStart === '64px', 'Compatibility cannot shrink an already correct larger native reservation');
  disposeTheme(); themeReservation.remove();

  const foreign = document.createElement('iframe'); document.body.appendChild(foreign);
  const foreignDoc = foreign.contentDocument;
  foreignDoc.body.innerHTML = `<main class="libraryroot_test"><div class="${nativeClasses}">Other Steam window</div></main>`;
  for (const name of ['SP BPM', 'Shared JS Context', 'SP Desktop_popup_menu']) {
    foreign.contentWindow.name = name;
    nativeLayout.installNativeAchievementLayout(foreignDoc)();
    check(!foreignDoc.getElementById('ngl-native-achievement-layout-style')
      && !foreignDoc.documentElement.hasAttribute('data-ngl-native-achievement-layout'), `${name} cannot receive the Desktop compatibility rule`);
  }
  foreign.contentWindow.name = 'SP Desktop'; foreignDoc.body.innerHTML = '<div id="root"></div>';
  nativeLayout.installNativeAchievementLayout(foreignDoc)();
  check(!foreignDoc.getElementById('ngl-native-achievement-layout-style'), 'A generic background root cannot authorize native achievement layout changes');
  foreign.remove();

  function startupFixture(withBody = true) {
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    const doc = frame.contentDocument, win = frame.contentWindow;
    win.name = 'SP Desktop';
    doc.body.innerHTML = '<div id="root"></div>';
    const nativeCss = doc.createElement('style');
    nativeCss.textContent = '._2YS0EBJmY2Rvs07zZ90UIJ{padding-inline-start:46px}'
      + '._2xTb6N-jUUQ-mIkMB6OVMm{padding:10px}';
    doc.head.appendChild(nativeCss);
    if (!withBody) doc.body.remove();
    const scheduled = new Map(), originalSet = win.setTimeout, originalClear = win.clearTimeout;
    let timerId = 0;
    win.setTimeout = (callback, delay) => { const id = ++timerId; scheduled.set(id, { callback, delay }); return id; };
    win.clearTimeout = id => { scheduled.delete(id); };
    const run = delay => {
      for (const [id, task] of [...scheduled]) {
        if (task.delay !== delay) continue;
        scheduled.delete(id); task.callback();
      }
    };
    const mount = () => {
      if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
      const main = doc.createElement('main');
      // A current hashed library sidebar must authorize Desktop without any
      // friendly "libraryroot" or "steamdesktop" substring in the DOM.
      main.className = load('css').LIBRARY_SIDEBAR_CLASSES(doc).Container;
      main.innerHTML = `<div class="${nativeClasses}">Late native completion</div>`;
      doc.body.appendChild(main);
      return main.firstChild;
    };
    const cleanup = dispose => {
      dispose(); win.setTimeout = originalSet; win.clearTimeout = originalClear; frame.remove();
    };
    return { doc, win, scheduled, run, mount, cleanup };
  }
  const lateLibrary = startupFixture();
  const disposeLateLibrary = nativeLayout.installNativeAchievementLayout(lateLibrary.doc);
  check(!lateLibrary.doc.getElementById('ngl-native-achievement-layout-style') && lateLibrary.scheduled.size === 3,
    'Desktop creation before library React mounts retains finite validation retries without styling an unknown root');
  lateLibrary.run(1000);
  check(lateLibrary.scheduled.size === 2 && !lateLibrary.doc.documentElement.hasAttribute('data-ngl-native-achievement-layout'),
    'An unresolved library surface cannot cancel later validation even when native class exports already exist');
  const lateCard = lateLibrary.mount();
  lateLibrary.run(2000);
  check(lateLibrary.win.getComputedStyle(lateCard).paddingInlineStart === '46px',
    'A library that mounts after the first startup check receives the native ribbon reservation');
  const lateTheme = lateLibrary.doc.createElement('style');
  lateTheme.textContent = '._2YS0EBJmY2Rvs07zZ90UIJ{padding-inline-start:64px}'
    + '._2xTb6N-jUUQ-mIkMB6OVMm._38t1mljBjmJfqjpVzMT1CG{padding-inline-start:10px}';
  lateLibrary.doc.head.appendChild(lateTheme);
  lateLibrary.run(4000);
  check(lateLibrary.win.getComputedStyle(lateCard).paddingInlineStart === '64px' && lateLibrary.scheduled.size === 0,
    'The final finite check preserves a larger late stylesheet reservation despite Steam padding specificity');
  let layoutWrites = 0;
  const stableObserver = new lateLibrary.win.MutationObserver(records => { layoutWrites += records.length; });
  stableObserver.observe(lateLibrary.doc.getElementById('ngl-native-achievement-layout-style'), { childList: true, subtree: true });
  for (let index = 0; index < 100; index++) lateCard.appendChild(lateLibrary.doc.createElement('span'));
  await Promise.resolve(); await Promise.resolve();
  check(layoutWrites === 0 && lateLibrary.scheduled.size === 0,
    'Achievement DOM bursts do not trigger compatibility rewrites or create a polling loop');
  stableObserver.disconnect();
  lateLibrary.cleanup(disposeLateLibrary);

  const lateBody = startupFixture(false);
  const disposeLateBody = nativeLayout.installNativeAchievementLayout(lateBody.doc);
  check(lateBody.scheduled.size === 3, 'SP Desktop without a body still owns bounded startup work and cleanup');
  const lateBodyCard = lateBody.mount();
  await Promise.resolve(); await Promise.resolve();
  check(lateBody.win.getComputedStyle(lateBodyCard).paddingInlineStart === '46px',
    'A body created after installation acquires its native reservation without waiting for another activation');
  lateBody.doc.body.classList.add('BasicUI');
  await Promise.resolve(); await Promise.resolve();
  check(!lateBody.doc.getElementById('ngl-native-achievement-layout-style'),
    'The late body is observed for Big Picture transitions and removes Desktop styles');
  lateBody.doc.body.classList.remove('BasicUI');
  await Promise.resolve(); await Promise.resolve();
  check(lateBody.win.getComputedStyle(lateBodyCard).paddingInlineStart === '46px',
    'The late body can return to Desktop with the compatibility rule restored');
  const lateCallbacks = [...lateBody.scheduled.values()].map(task => task.callback);
  disposeLateBody();
  lateBody.doc.dispatchEvent(new lateBody.win.Event('DOMContentLoaded'));
  lateBody.doc.body.classList.add('BasicUI'); lateBody.doc.body.classList.remove('BasicUI');
  for (const callback of lateCallbacks) callback();
  await Promise.resolve(); await Promise.resolve();
  check(lateBody.scheduled.size === 0 && !lateBody.doc.getElementById('ngl-native-achievement-layout-style')
    && !lateBody.doc.documentElement.hasAttribute('data-ngl-native-achievement-layout'),
    'Shutdown releases late-body observers, readiness listeners and timers; retired callbacks cannot reinstall styles');
  lateBody.cleanup(disposeLateBody);

  // Resolve with no native exports to exercise the finite late-startup retry
  // path, then deliver those callbacks after disposal as a cancellation oracle.
  dependencies['@steambrew/client'].modules.clear();
  load('SteamWebpackRuntime').steamWebpackRuntime.invalidate(document);
  load('class-module-cache').resetSteamClassModuleCache();
  const nativeSetTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;
  const retryCallbacks = new Map();
  window.setTimeout = (callback, delay) => {
    const timer = nativeSetTimeout.call(window, callback, delay); retryCallbacks.set(timer, callback); return timer;
  };
  window.clearTimeout = timer => { retryCallbacks.delete(timer); nativeClearTimeout.call(window, timer); };
  try {
    const disposeRetry = nativeLayout.installNativeAchievementLayout(document);
    check(retryCallbacks.size === 3, 'Unavailable startup exports schedule only three finite retries');
    const retiredCallbacks = [...retryCallbacks.values()];
    disposeRetry();
    check(retryCallbacks.size === 0, 'Disposal cancels every late-startup retry');
    for (const callback of retiredCallbacks) callback();
    check(!document.getElementById('ngl-native-achievement-layout-style')
      && !document.documentElement.hasAttribute('data-ngl-native-achievement-layout'),
    'Retired startup callbacks cannot recreate compatibility styles after shutdown');
  } finally {
    for (const timer of retryCallbacks.keys()) nativeClearTimeout.call(window, timer);
    window.setTimeout = nativeSetTimeout; window.clearTimeout = nativeClearTimeout;
  }
  return { results, nativePadding: getComputedStyle(stock).padding, matchingSelectors };
}

const browser = await chromium.launch({ executablePath: edge, headless: true,
  args: ['--disable-background-networking', '--no-first-run'] });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<main class="libraryroot_test"><div id="stock" class="_2YS0EBJmY2Rvs07zZ90UIJ _2xTb6N-jUUQ-mIkMB6OVMm _38t1mljBjmJfqjpVzMT1CG"><span>All achievements unlocked</span></div></main>');
  await page.addStyleTag({ content: fs.readFileSync(steamCss, 'utf8') });
  // A deliberately distinguishable native animation makes the old collision
  // fail even if Steam currently happens to use the same rotation body.
  await page.addStyleTag({ content: '@keyframes _2liIQspBwdpNtEmYw2bU9j{to{transform:translateX(17px)}}#stock{animation:_2liIQspBwdpNtEmYw2bU9j 10s linear infinite}' });
  const report = await page.evaluate(browserChecks, sources);
  console.log(`Achievement style isolation browser: ${report.results.length} checks passed; stock padding ${report.nativePadding}; no native selector matches.`);
} finally { await browser.close(); }
