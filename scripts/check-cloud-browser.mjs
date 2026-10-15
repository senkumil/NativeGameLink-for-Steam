// Exercise the current plugin in a real Chromium DOM with Steam's installed CSS.
// No browser package or running Steam session is required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = process.env.CLOUD_BROWSER_EXECUTABLE
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || [
  'C:/Program Files (x86)/Steam/steamui/css/sp.css',
  'C:/Program Files (x86)/Steam/steamui/css/chunk~2dcc5aaf7.css',
].find(filename => fs.existsSync(filename));
assert.ok(fs.existsSync(edge), `Edge executable missing: ${edge}`);
assert.ok((steamCss && fs.existsSync(steamCss)), `Installed Steam play-bar CSS missing: ${steamCss}`);
const sources = Object.fromEntries([
  ['class-module-cache', 'frontend/steam/class-module-cache.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['native-dom', 'frontend/steam/native-dom.ts'],
  ['library-details', 'frontend/steam/library-details.ts'],
  ['playbar-visibility', 'frontend/steam/playbar-visibility.ts'],
  ['cloud-status', 'frontend/features/library/cloud-status.ts'],
].map(([name, filename]) => [name, ts.transpileModule(
  fs.readFileSync(path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText]));

function browserChecks(sources) {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  const modules = {};
  const commitHost = node => {
    const state = {};
    const previousRoot = { tag: 3, stateNode: state, return: null };
    const currentRoot = { tag: 3, stateNode: state, return: null, alternate: previousRoot };
    previousRoot.alternate = currentRoot; state.current = currentRoot;
    const previousOwner = { tag: 0, memoizedProps: { overview: { appid: 3000000000 } }, return: previousRoot };
    const currentOwner = { tag: 0, memoizedProps: { overview: { appid: 3000000000 } }, return: currentRoot, alternate: previousOwner };
    previousOwner.alternate = currentOwner;
    const host = { tag: 5, flags: 0, alternate: null, memoizedProps: { className: node.className }, return: previousOwner };
    previousRoot.child = previousOwner; currentRoot.child = currentOwner;
    previousOwner.child = currentOwner.child = host;
    node.__reactFiber$fixture = host;
  };
  const localization = {
    steamLanguageSync: () => 'english',
    loc: (_key, fallback) => fallback,
    gdlText: (_key, fallback) => fallback,
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g,
    token => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[token]);
  const dependencies = {
    '@steambrew/client': { findClassModule: () => null },
    './modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRuntimeIdentity: () => null, getAllModules: () => [] } },
    './localization': localization,
    '../../steam/localization': localization,
    '../../core/text': { escapeHtml },
    './native-route': {
      isPublicSteamLibraryRoute: doc => Boolean(doc.publicRoute),
      routedSteamAppId: doc => doc.publicRoute ? 123 : 3000000000,
    },
    '../shortcuts/runtime': {
      findMappingForShortcut: () => '1790600', isShortcutDismissed: () => false,
    },
    '../shortcuts/registry': { getCommittedShortcutSteamAppId: () => '1790600' },
    '../shortcuts/dismissed': { isShortcutDismissed: () => false },
    './styles': { ensureNativeGameInfoStyles() {} },
    './primary-links': { findNativePlaybar: doc => doc.getElementById('fixture-playbar') },
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    new Function('require', 'exports', sources[name])(dependency => {
      if (dependency in dependencies) return dependencies[dependency];
      const moduleName = dependency.split('/').pop();
      if (moduleName in sources) return load(moduleName);
      throw new Error(`Unexpected dependency in ${name}: ${dependency}`);
    }, exports);
    return exports;
  };
  try {
    const css = load('css');
    const native = load('native-dom');
    load('playbar-visibility');
    const cloud = load('cloud-status');
    const ps = css.PLAYBAR_CLASSES();
    check(css.PLAYBAR_CLASS_MODULE().native === false,
      'Real PLAYBAR_CLASSES uses its installed-build fallback');
    const classes = (...keys) => keys.map(key => ps[key]).filter(Boolean).join(' ');
    const findOwned = () => document.querySelector('[data-gdl-cloud-status="1"]');
    const stat = visible => {
      const element = document.createElement('div');
      element.className = classes('GameStat', 'LastPlayed', 'SuperimposedGridItems')
        + (visible ? ` ${ps.Visible}` : '');
      element.innerHTML = `<div class="${classes('GameStatIconForced', 'PlaytimeIconForced')}"><svg viewBox="0 0 36 36"><path d="M4 10h28v18H4z"/></svg></div>`
        + `<div class="${classes('HideWhenNarrow', 'GameStatRight')}"><div class="${ps.PlayBarLabel}">Cloud status</div>`
        + `<div class="${ps.PlayBarDetailLabel}">Native up to date</div></div>`;
      return element;
    };
    const makeStats = () => {
      const section = document.createElement('div');
      section.className = ps.GameStatsSection;
      commitHost(section);
      const placeholder = document.createElement('div');
      placeholder.className = ps.PlayBarCloudStatusContainer;
      for (let index = 0; index < 4; index++) placeholder.appendChild(stat(false));
      section.appendChild(placeholder);
      return { section, placeholder };
    };
    const playbar = document.createElement('div');
    commitHost(playbar);
    playbar.id = 'fixture-playbar';
    playbar.className = classes('Container', 'InPage');
    const row = document.createElement('div');
    row.className = '_1YbtIWcfkQJOysLXQbwzRf _3CYvy-LZ_Y81QV0QU3lj1c';
    // These are Steam's layout classes; no fixture CSS overrides status visibility.
    let { section, placeholder } = makeStats();
    const fixedOuter = document.createElement('div');
    fixedOuter.className = '_2L3s2nzh7yCnNESfI5_dN1';
    const fixedPlaybar = document.createElement('div');
    commitHost(fixedPlaybar);
    fixedPlaybar.className = `${ps.Container} _39RheXihcN6H2k2muQTjkI`;
    const fixedRow = document.createElement('div');
    fixedRow.className = row.className;
    const fixed = makeStats();
    fixedRow.appendChild(fixed.section);
    fixedPlaybar.appendChild(fixedRow);
    fixedOuter.appendChild(fixedPlaybar);
    // Steam mounts its hidden fixed header before the in-page play bar.
    document.getElementById('fixture').appendChild(fixedOuter);
    row.appendChild(section);
    playbar.appendChild(row);
    document.getElementById('fixture').appendChild(playbar);
    check(document.getElementById('fixture').firstElementChild === fixedOuter
      && native.isRenderedElement(document, fixed.section)
      && getComputedStyle(fixedOuter).opacity === '0'
      && getComputedStyle(fixed.section).opacity === '0',
    'The first DOM playbar retains geometry while Steam hides both its fixed ancestor and sticky stats');
    check(native.isRenderedElement(document, placeholder),
      'The native cloud sizing container is rendered and has text');
    check(placeholder.textContent.includes('Native up to date'),
      'The inactive native sizing states contain real label/detail text');
    check(Array.from(placeholder.children).every(element =>
      getComputedStyle(element).visibility === 'hidden'),
    'Installed Steam CSS conceals all four sizing states without Visible');
    check(native.findVisibleCloudStatusStat(placeholder) === null,
      'Hidden sizing states are not an active native cloud control');

    native.clearNativeUiBlueprints();
    native.captureNativeUiBlueprints(document);
    check(native.buildNativeCloudBlueprint(document) === null,
      'Blueprint capture rejects a rendered container containing only hidden reserves');
    native.saveNativeUiBlueprint(native.NATIVE_UI_BLUEPRINT_KEYS.cloudStatus, placeholder);
    check(native.buildNativeCloudBlueprint(document) === null,
      'Blueprint build rejects a previously stored hidden-reserve template');
    native.clearNativeUiBlueprints();

    cloud.ensureCloudStatus(document);
    const wrapper = findOwned();
    check(Boolean(wrapper), 'A hidden native placeholder cannot suppress fallback cloud mounting');
    check(wrapper.parentElement === section && !fixed.section.contains(wrapper),
      'Initial mounting selects the painted in-page stats instead of the first hidden fixed host');
    const activeStat = native.findVisibleCloudStatusStat(wrapper);
    check(Boolean(activeStat) && native.isRenderedElement(document, activeStat),
      'The mounted fallback has a rendered visible stat with installed Steam CSS');
    const label = native.elementsWithCssModuleClass(activeStat, ps.PlayBarLabel)[0];
    const detail = native.elementsWithCssModuleClass(activeStat, ps.PlayBarDetailLabel)[0];
    check(native.isRenderedElement(document, label) && native.isRenderedElement(document, detail)
      && detail.textContent === 'Up to date', 'Cloud label and synchronized detail are visibly rendered');
    const stableHtml = wrapper.outerHTML;
    const stableChild = wrapper.firstElementChild;
    const mutations = new MutationObserver(() => {});
    mutations.observe(section, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 100; index++) cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.firstElementChild === stableChild
      && wrapper.outerHTML === stableHtml && mutations.takeRecords().length === 0,
    '100 updates preserve the exact wrapper, content, position and attributes without mutations');
    mutations.disconnect();

    // Finish real CSS transitions between checks without replacing visibility
    // rules. This keeps a hundred swaps deterministic and fast in headless mode.
    const settlePlaybarStyles = () => {
      getComputedStyle(fixedOuter).opacity;
      getComputedStyle(fixed.section).opacity;
      getComputedStyle(playbar).opacity;
      for (const animation of document.getAnimations()) {
        try { animation.finish(); } catch {}
      }
    };
    const showFixed = () => {
      playbar.classList.add('_3SSPIdErMyF10Bul9E0qhX');
      fixedOuter.classList.add('jnXtv79jL6SXXwlJYPtQz');
      fixedPlaybar.classList.remove('_39RheXihcN6H2k2muQTjkI');
      settlePlaybarStyles();
    };
    const showInPage = () => {
      playbar.classList.remove('_3SSPIdErMyF10Bul9E0qhX');
      fixedOuter.classList.remove('jnXtv79jL6SXXwlJYPtQz');
      fixedPlaybar.classList.add('_39RheXihcN6H2k2muQTjkI');
      settlePlaybarStyles();
    };
    showFixed();
    check(getComputedStyle(playbar).opacity === '0'
      && getComputedStyle(fixedOuter).opacity === '1'
      && getComputedStyle(fixed.section).opacity === '1',
    'Real HidePlayBar and ShowPlayBar classes exchange which stats host is painted');
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.parentElement === fixed.section
      && wrapper.firstElementChild === stableChild && wrapper.outerHTML === stableHtml,
    'Showing the other playbar migrates the same widget and preserves its contents');
    mutations.observe(fixed.section, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 100; index++) cloud.ensureCloudStatus(document);
    check(mutations.takeRecords().length === 0,
      '100 stable updates on the second painted host perform no DOM or attribute writes');
    mutations.disconnect();
    showInPage();
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.parentElement === section
      && wrapper.firstElementChild === stableChild && wrapper.outerHTML === stableHtml,
    'Restoring the in-page playbar returns the same widget and contents');
    mutations.observe(wrapper, { childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 100; index++) {
      showFixed();
      cloud.ensureCloudStatus(document);
      if (findOwned() !== wrapper || wrapper.parentElement !== fixed.section
        || wrapper.firstElementChild !== stableChild || wrapper.outerHTML !== stableHtml) {
        throw new Error(`Cloud identity or content changed during fixed-host swap ${index}`);
      }
      showInPage();
      cloud.ensureCloudStatus(document);
      if (findOwned() !== wrapper || wrapper.parentElement !== section
        || wrapper.firstElementChild !== stableChild || wrapper.outerHTML !== stableHtml) {
        throw new Error(`Cloud identity or content changed during in-page-host swap ${index}`);
      }
    }
    check(mutations.takeRecords().length === 0,
      '100 playbar visibility round trips preserve wrapper/stat identity without rewriting their contents');
    mutations.disconnect();

    const fixture = document.getElementById('fixture');
    fixture.classList.add('NarrowRightPanel');
    cloud.ensureCloudStatus(document);
    check(native.isRenderedElement(document, label) && native.isRenderedElement(document, detail),
      'Cloud copy remains visible when Steam marks the right pane narrow');
    fixture.classList.remove('NarrowRightPanel');

    wrapper.style.setProperty('display', 'none', 'important');
    wrapper.style.visibility = 'hidden';
    wrapper.style.pointerEvents = 'none';
    activeStat.style.visibility = 'hidden';
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.firstElementChild === stableChild
      && native.isRenderedElement(document, wrapper) && native.isRenderedElement(document, activeStat),
    'A connected concealed widget recovers in place without replacing its content');

    // Reproduce an older captured fallback containing only hidden sizing states.
    wrapper.replaceChildren(...Array.from({ length: 4 }, () => stat(false)));
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && native.findVisibleCloudStatusStat(wrapper)
      && native.isRenderedElement(document, native.findVisibleCloudStatusStat(wrapper)),
    'An invalid connected legacy widget is repaired while preserving wrapper identity');
    const repairedStat = wrapper.firstElementChild;
    mutations.observe(section, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 100; index++) cloud.ensureCloudStatus(document);
    check(wrapper.firstElementChild === repairedStat && mutations.takeRecords().length === 0,
      'A repaired widget remains static for another 100 updates');
    mutations.disconnect();

    const replacement = makeStats();
    section.replaceWith(replacement.section);
    section = replacement.section;
    placeholder = replacement.placeholder;
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.parentElement === section
      && wrapper.firstElementChild === repairedStat,
    'Replacing Steam\'s host row reattaches the same widget and content');

    const nativeStat = placeholder.firstElementChild;
    nativeStat.classList.add(ps.Visible);
    check(native.isRenderedElement(document, nativeStat), 'Activating Visible makes the native stat render');
    cloud.ensureCloudStatus(document);
    check(!wrapper.isConnected && findOwned() === null && nativeStat.isConnected,
      'An active native cloud control is authoritative and removes the fallback');
    native.clearNativeUiBlueprints();
    native.captureNativeUiBlueprints(document);
    const blueprint = native.buildNativeCloudBlueprint(document);
    check(Boolean(blueprint) && native.elementsWithCssModuleClass(blueprint, ps.GameStat).length === 1
      && Boolean(native.findVisibleCloudStatusStat(blueprint)) && blueprint.textContent.includes('Up to date'),
    'A valid native blueprint retains only the active stat and translated synchronized text');

    nativeStat.classList.remove(ps.Visible);
    cloud.ensureCloudStatus(document);
    check(findOwned() === wrapper && wrapper.parentElement === section,
      'Deactivating native cloud restores the same cached fallback');
    const beforeNativeRoute = section.innerHTML;
    document.publicRoute = true;
    cloud.ensureCloudStatus(document);
    check(section.innerHTML === beforeNativeRoute, 'Public Steam routes receive no cloud mutations');
    document.publicRoute = false;
    settlePlaybarStyles();
    window.scrollTo(0, 0);
    const finalLabel = native.elementsWithCssModuleClass(wrapper, ps.PlayBarLabel)[0];
    const finalDetail = native.elementsWithCssModuleClass(wrapper, ps.PlayBarDetailLabel)[0];
    const finalIcon = wrapper.querySelector('svg');
    const paintedAndHitTestable = element => {
      const rect = element.getBoundingClientRect();
      let effectiveOpacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        effectiveOpacity *= Number(style.opacity);
      }
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return effectiveOpacity > 0.95 && rect.width > 0 && rect.height > 0
        && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
        && Boolean(hit && (hit === element || element.contains(hit)));
    };
    check([finalLabel, finalDetail, finalIcon].every(paintedAndHitTestable),
      'Final screenshot label, detail and icon have painted ancestors and pass viewport hit-testing');
    const report = { ok: true, checks: results.length, results,
      cloudRect: wrapper.getBoundingClientRect().toJSON(),
      label: finalLabel.textContent, detail: finalDetail.textContent,
      finalPaintedAndHitTestable: true };
    const output = document.createElement('pre');
    output.id = 'cloud-browser-result';
    output.textContent = JSON.stringify(report);
    document.body.appendChild(output);
  } catch (error) {
    const output = document.createElement('pre');
    output.id = 'cloud-browser-result';
    output.textContent = JSON.stringify({ ok: false, results, error: String(error.stack || error) });
    document.body.appendChild(output);
  }
  document.currentScript?.remove();
}

const scratchRoot = path.join(root, 'scratch');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'cloud-browser-'));
const htmlPath = path.join(scratch, 'fixture.html');
const screenshot = path.join(scratch, 'cloud-status.png');
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(steamCss).href}">
<style>body{margin:24px;background:#24282f;color:#dcdedf;font-family:Arial,sans-serif}#fixture{width:100%;min-height:120px}#cloud-browser-result{font-size:12px;white-space:pre-wrap;max-width:1100px}</style>
</head><body class="DesktopUI"><h2>Cloud status · installed Steam CSS</h2><div id="fixture"></div>
<script>(${browserChecks.toString()})(${serialize(sources)});</script></body></html>`);
const { stdout, stderr, code } = await new Promise((resolve, reject) => {
  const child = spawn(edge, [
    '--headless=new', '--disable-gpu', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--window-size=1280,720', '--virtual-time-budget=1500', '--dump-dom',
    `--user-data-dir=${path.join(scratch, 'edge-profile')}`, `--screenshot=${screenshot}`,
    pathToFileURL(htmlPath).href,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('Cloud Edge regression timed out after 30 seconds')); }, 30_000);
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
});
assert.equal(code, 0, `Headless Edge exited with ${code}: ${stderr.slice(-1600)}`);
const raw = stdout.match(/<pre id="cloud-browser-result">([\s\S]*?)<\/pre>/)?.[1];
assert.ok(raw, `Browser did not return its test result: ${stderr.slice(-1600)}`);
const report = JSON.parse(raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
assert.ok(report.ok, `${report.error}\nPassed before failure: ${report.results.join('; ')}\nFixture: ${htmlPath}`);
console.log(`Cloud browser checks passed: ${report.checks} assertions, real Steam CSS, 300 static updates, 100 visibility round trips, hidden-state recovery, host reuse and native ownership.`);
console.log(`Screenshot: ${screenshot}`);
