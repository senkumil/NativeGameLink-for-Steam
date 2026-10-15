import './helpers/installed-steam-check.mjs';
// Production linked header/service in real Edge DOM and installed Steam CSS.
// Native stores, account data and IPC are fixtures; no Steam account changes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const steam = process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui';
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync(path.join(steam, 'sp.js'), 'utf8'), { self: chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const cssFactory = Object.values(factories).find(factory => {
  const source = String(factory); return source.includes('GameStatsSection:') && source.includes('LastPlayedInfo:') && source.includes('CloudStatusRow:');
});
assert(cssFactory, 'Installed Steam playbar class literal is available');
const cssModule = { exports: {} }; cssFactory(cssModule);
const nativeCSS = cssModule.exports;
const shellFactory = Object.values(factories).find(factory => String(factory).includes('PlaySection:') && String(factory).includes('ActionRow:'));
assert(shellFactory, 'Installed Big Picture play section class literal is available');
const shellModule = { exports: {} }; shellFactory(shellModule);
const shellCSS = shellModule.exports;
const nativePlaybar = Object.values(factories).map(String).find(source => source.includes('nPlaytimeForever==0?null:') && source.includes('AppDetails_SectionTitle_LastPlayed'));
assert(nativePlaybar?.includes('GameStatRight') && nativePlaybar.includes('PlayBarDetailLabel'), 'Installed last-played/playtime markup contract is inspectable');
const sources = Object.fromEntries(Object.entries({
  metadata: 'frontend/features/big-picture/playbar-metadata.ts',
  service: 'frontend/features/playtime/service.ts', format: 'frontend/features/playtime/format.ts',
  adapter: 'frontend/steam/gamepad/stores/AppStoreAdapter.ts', settings: 'frontend/features/playtime/playtime-settings.ts',
  pureClasses: 'frontend/steam/gamepad/components/pure-class-factory.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.route('https://steamloopback.host/library', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body class="BasicUI"></body></html>' }));
  await page.goto('https://steamloopback.host/library');
  await page.addStyleTag({ content: fs.readFileSync(path.join(steam, 'css/sp.css'), 'utf8') });
  const report = await page.evaluate(async ({ sources, c, shell }) => {
    let checks = 0, now = Date.now(), writes = 0, moduleReads = 0, factoryReads = 0;
    // Millennium augments exported CSS values with semantic class names in the
    // actual client: selectors must treat "hash PlaySection" as two classes.
    const augment = classes => Object.fromEntries(Object.entries(classes).map(([key, value]) => [key, `${value} ${key}`]));
    const privateCSSFactory = new Function(`return module=>{module.exports=${JSON.stringify(augment(c))}}`)();
    const privateShellFactory = new Function(`return module=>{module.exports=${JSON.stringify(augment(shell))}}`)();
    const { PlayBar: _missingPlaybar, ...fallbackCSS } = c;
    const check = (value, message) => { if (!value) throw Error(message); checks++; };
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const frame = async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await flush(); };
    const noop = () => {};
    const a = 3000000001, b = 3000000002;
    const sourceWindow = window, docs = new Map(), reads = [], pending = [], modules = {};
    const locale = {
      loc: (_key, fallback) => fallback, steamIntlLocale: () => 'en-US', isSpanishLanguage: () => false,
      gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ''),
    };
    const runtime = {
      getModuleFactoryCount: () => 2,
      getModuleFactories: doc => { factoryReads++; return docs.get(doc)?.live ? [{ id: 96821, factory: privateCSSFactory }, { id: 20297, factory: privateShellFactory }] : []; },
      getRuntimeIdentity: doc => docs.get(doc)?.live && doc.defaultView?.document === doc ? docs.get(doc).identity : null,
      getAllModules: doc => {
        moduleReads++;
        const state = docs.get(doc);
        return state?.live ? [{ id: 123, exports: { app: state.appStore, details: state.detailsStore } }] : [];
      },
    };
    const owns = (doc, id, steam) => {
      const state = docs.get(doc);
      return Boolean(state?.live && state.gamepad && state.route === Number(id) && Number(id) >= 2147483648
        && state.steamAppId === String(steam) && doc.defaultView?.document === doc && !state.closed);
    };
    const dependencies = {
      '../../steam/css': { PLAYBAR_CLASSES: doc => { if (!doc) throw Error('Classes require the popup document'); return fallbackCSS; } }, '../../steam/localization': locale,
      '../../steam/native-window-store': { getNativeWindowInstance: doc => docs.get(doc)?.live ? { BrowserWindow: doc.defaultView } : null },
      '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: runtime },
      '../../steam/gamepad/GamepadContext': { isCurrentLinkedGamepadTarget: owns },
      '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => docs.get(doc)?.gamepad === true } },
      '../../api/backend': { backendLog: noop,
        getAllPlaytimeDataBackend: ({ request_json }) => new Promise(resolve => pending.push({ input: JSON.parse(request_json), resolve })),
        getPlaytimeDataBackend: () => { throw Error('Unexpected fallback IPC'); } },
    };
    function load(name) {
      if (modules[name]) return modules[name];
      const exports = {}; modules[name] = exports;
      new Function('exports', 'require', 'Date', sources[name])(exports, key => {
        const alias = { '../playtime/service': 'service', '../playtime/format': 'format', '../playtime/playtime-settings': 'settings',
          '../../steam/gamepad/stores/AppStoreAdapter': 'adapter', '../../steam/gamepad/components/pure-class-factory': 'pureClasses' }[key];
        if (alias) return load(alias);
        if (key in dependencies) return dependencies[key];
        throw Error(`Unexpected ${name} dependency: ${key}`);
      }, class extends Date { static now() { return now; } });
      return exports;
    }
    const service = load('service'), metadata = load('metadata'), settings = load('settings');
    function fixture(doc = document, id = a, steamAppId = '550') {
      const outer = doc.createElement('section'); outer.dataset.appid = String(id);
      outer.innerHTML = `<div class="${shell.PlaySection}"><div class="${shell.ActionRow}"><button id="play-${id}">Play</button><div class="${c.StatusAndStats} ${c.PermanentlyUnavailable}"><div class="${c.GameStatsSection}"><button id="gdl-bp-playbar-controller" class="${c.ControllerSupportInfo}">Controller</button></div></div></div></div><div id="gdl-bp-detail-root" data-gdl-shortcut-app-id="${id}" data-gdl-steam-app-id="${steamAppId}"></div>`;
      for (const node of outer.querySelectorAll('[class]')) for (const [key, value] of Object.entries({ ...c, ...shell })) {
        if (node.classList.contains(value)) node.classList.add(key);
      }
      doc.body.append(outer);
      const state = { live: true, gamepad: true, identity: {}, route: id, steamAppId, overviews: new Map(), details: new Map(),
        appStore: null, detailsStore: null };
      state.appStore = { GetAppOverviewByAppID(key) { reads.push(['overview', key]); return state.overviews.get(key); } };
      state.detailsStore = { GetAppDetails(key) { reads.push(['details', key]); return state.details.get(key); } };
      docs.set(doc, state);
      const root = outer.querySelector('#gdl-bp-detail-root'), stats = outer.querySelector(`.${c.GameStatsSection}`);
      return { doc, outer, root, stats, state, shortcut: { id, title: `Shortcut ${id}`, steamAppId },
        sync() { metadata.syncBigPicturePlaybarMetadata(doc, this.shortcut); },
        owned(kind) { return outer.querySelector(`[data-gdl-bp-playbar-metadata="${kind}"]`); },
        route(next, steam = steamAppId) { state.route = next; state.steamAppId = steam; outer.dataset.appid = String(next); root.dataset.gdlShortcutAppId = String(next); root.dataset.gdlSteamAppId = steam; this.shortcut = { id: next, title: `Shortcut ${next}`, steamAppId: steam }; },
      };
    }
    const protect = value => new Proxy(Object.freeze(value), { set() { writes++; throw Error('Native mutation'); }, deleteProperty() { writes++; throw Error('Native mutation'); } });
    const today = Math.floor(now / 1000), first = fixture();
    first.state.overviews.set(a, protect({ appid: a, minutes_playtime_forever: 1, rt_last_time_played_or_installed: today }));
    first.state.overviews.set(550, protect({ appid: 550, minutes_playtime_forever: 999999, rt_last_time_played: today }));
    service.setInstantPlaytimeStats(a, { minutesForever: 126, minutesLastTwoWeeks: 5, totalSeconds: 7560, lastPlayedAt: today }, '550');
    const controller = first.stats.firstElementChild, play = first.outer.querySelector(`#play-${a}`);
    const untouched = [controller.outerHTML, play.outerHTML]; controller.focus(); first.sync(); await flush();
    check(first.owned('last-played')?.textContent.includes('Today') && first.owned('playtime')?.textContent.includes('2.1 hours'),
      'Warm backend-confirmed last session and playtime render synchronously for the exact shortcut');
    check([...first.stats.children].map(node => node.dataset.gdlBpPlaybarMetadata || 'controller').join(',') === 'last-played,playtime,controller',
      'Native order is last session, playtime, controller');
    check(first.owned('playtime').classList.contains(c.GameStat) && first.owned('playtime').classList.contains(c.Playtime)
      && first.owned('last-played').classList.contains(c.LastPlayed), 'Header uses the installed native class families');
    const fixedCloud = first.owned('cloud');
    check(!fallbackCSS.PlayBar && factoryReads === 1, 'Private-cache popup resolves the missing playbar class from its exact runtime CSS literal');
    check(fixedCloud?.textContent === 'Steam Cloud: Up to date', 'Linked games display the requested fixed synchronized Cloud row without waiting for native account flags');
    check(fixedCloud?.previousElementSibling === first.outer.querySelector(`.${shell.PlaySection}`)
      && fixedCloud.classList.contains(c.CloudStatusRow) && fixedCloud.querySelector(`.${c.CloudStatusIcon} svg.${c.CloudIconSVG}`),
      'The fixed row follows the playbar and uses the native separator, icon and typography classes');
    check(pending.length === 1 && pending[0].input.requests[0].shortcut_app_id === String(a)
      && pending[0].input.requests[0].steam_app_id === '550', 'Header refresh requests the shortcut session store and retains metadata identity separately');
    const lastNode = first.owned('last-played'), timeNode = first.owned('playtime'), beforeModuleReads = moduleReads;
    for (let i = 0; i < 100; i++) first.sync(); await frame();
    check(first.owned('last-played') === lastNode && first.owned('playtime') === timeNode && first.owned('cloud') === fixedCloud && pending.length === 1,
      'One hundred syncs preserve exact DOM nodes and coalesce the in-flight backend request');
    check(moduleReads === beforeModuleReads && document.activeElement === controller && writes === 0,
      'Warm sync does not rescan thousands of exports, steal native focus or write Steam records');
    check(factoryReads === 1, 'Warm metadata updates do not rescan the native factory table');
    check(controller.outerHTML === untouched[0] && play.outerHTML === untouched[1], 'Play and native controller buttons remain byte-for-byte unchanged');
    const style = getComputedStyle(timeNode), labelStyle = getComputedStyle(timeNode.firstElementChild.firstElementChild);
    check(style.marginTop === '0px' && style.paddingTop === '0px' && style.display === 'flex', 'Big Picture metadata inherits native zero-margin stat geometry');
    check(labelStyle.textTransform === 'uppercase', 'Native stylesheet owns header label typography');
    pending[0].resolve(JSON.stringify({ items: [{ ...pending[0].input.requests[0], ok: true, seconds_forever: 7600, minutes_forever: 126, last_played_at: today }] }));
    await flush();
    check(first.owned('playtime') === timeNode, 'Canonical refresh updates the mounted stat without replacing it');

    // The linked presentation remains fixed independently of native Cloud data.
    first.state.details.set(a, protect({ unAppID: a, eCloudStatus: 3, bCloudEnabledForApp: true, bCloudEnabledForAccount: true, bHasAnyLocalContent: true }));
    first.sync();
    check(first.owned('cloud')?.textContent === 'Steam Cloud: Up to date' && first.owned('cloud').classList.contains(c.CloudStatusRow),
      'The linked Cloud row retains native separate-row markup');
    first.state.details.set(a, protect({ unAppID: a, eCloudStatus: 9, bCloudEnabledForApp: true, bCloudEnabledForAccount: true, bHasAnyLocalContent: true }));
    first.sync(); check(first.owned('cloud') === fixedCloud && fixedCloud.textContent.endsWith('Up to date'), 'An unrelated Cloud enum cannot change the fixed linked presentation');
    first.state.details.set(a, protect({ unAppID: 550, eCloudStatus: 3, bCloudEnabledForApp: true, bCloudEnabledForAccount: true, bHasAnyLocalContent: true }));
    first.sync(); check(first.owned('cloud') === fixedCloud, 'A public AppID payload cannot change or remount the linked presentation');
    first.state.details.set(a, protect({ unAppID: a, eCloudStatus: 3, bCloudEnabledForApp: false, bCloudEnabledForAccount: true, bHasAnyLocalContent: true }));
    first.sync(); check(first.owned('cloud') === fixedCloud, 'Absent or disabled native Cloud flags do not hide the fixed linked row');
    const realCloud = fixedCloud.cloneNode(true); realCloud.removeAttribute('data-gdl-bp-playbar-metadata');
    realCloud.textContent = 'Native Cloud'; first.outer.append(realCloud); const nativeCloudBefore = realCloud.outerHTML;
    first.sync(); check(!first.owned('cloud') && realCloud.outerHTML === nativeCloudBefore, 'A genuine native row is preserved exactly and is never duplicated');
    realCloud.remove(); first.sync(); check(first.owned('cloud')?.textContent.endsWith('Up to date'), 'The fixed linked row returns when no native row is present');
    const nativeLast = lastNode.cloneNode(true), nativeTime = timeNode.cloneNode(true);
    nativeLast.removeAttribute('data-gdl-bp-playbar-metadata'); nativeTime.removeAttribute('data-gdl-bp-playbar-metadata');
    first.stats.prepend(nativeLast, nativeTime); const beforeNative = [nativeLast.outerHTML, nativeTime.outerHTML]; first.sync();
    check(!first.owned('last-played') && !first.owned('playtime') && nativeLast.outerHTML === beforeNative[0] && nativeTime.outerHTML === beforeNative[1],
      'Native Steam header stats take precedence and are never duplicated or rewritten');
    nativeLast.remove(); nativeTime.remove(); first.sync();
    const oldStats = first.stats, nextStats = oldStats.cloneNode(false); nextStats.append(controller); oldStats.replaceWith(nextStats); first.stats = nextStats;
    await frame();
    check(first.owned('last-played')?.parentElement === nextStats && first.owned('playtime')?.parentElement === nextStats,
      'Steam replacing the whole stats section repairs metadata in the successor native container');

    // A delayed old A response must not paint B, even when both share one AppID.
    now += 6000; first.sync(); const oldRequest = pending.at(-1);
    first.route(b); first.state.overviews.set(b, protect({ appid: b, minutes_playtime_forever: 2, rt_last_time_played_or_installed: today }));
    first.sync(); const bRequest = pending.at(-1);
    check(!first.owned('last-played') && first.owned('playtime')?.textContent.includes('2 min'),
      'A cold second shortcut uses only its own native counter and never calls installation time a last session');
    oldRequest.resolve(JSON.stringify({ items: [{ ...oldRequest.input.requests[0], ok: true, seconds_forever: 999999, minutes_forever: 16666, last_played_at: today }] }));
    await flush(); check(first.owned('playtime')?.textContent.includes('2 min'), 'A late old shortcut response cannot replace the successor header');
    bRequest.resolve(JSON.stringify({ items: [{ ...bRequest.input.requests[0], ok: true, seconds_forever: 39, minutes_forever: 0, last_played_at: today }] }));
    await flush(); check(first.owned('playtime')?.textContent.includes('< 1 min') && first.owned('last-played')?.textContent.includes('Today'),
      'Sub-minute tracked sessions retain real seconds and last session instead of disappearing at zero rounded minutes');

    // Portal popup has no local stores. Its exact proven runtime owns the data.
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const child = fixture(iframe.contentDocument, a, '550'); child.doc.body.className = 'BasicUI';
    child.state.overviews.set(a, protect({ appid: a, minutes_playtime_forever: 4, rt_last_time_played: today }));
    settings.setShortcutPlaytimeTrackingEnabled(a, false); child.sync();
    check(!child.doc.defaultView.appStore && child.owned('playtime')?.textContent.includes('4 min') && child.owned('last-played')?.textContent.includes('Today'),
      'Scriptless portal reads exact-owner already loaded native stores without parent globals or a public AppID fallback');
    const childNative = child.outer.innerHTML;
    docs.get(child.doc).live = false; child.sync();
    check(!child.owned('playtime') && !child.owned('last-played') && child.stats.firstElementChild?.id === controller.id,
      'Removing the native popup ownership retires only plugin metadata and preserves its native controls');
    check(childNative.includes('4 min'), 'Portal baseline was actually rendered before ownership removal');
    settings.setShortcutPlaytimeTrackingEnabled(a, true);
    for (const [label, mutate] of [
      ['native route', f => { f.state.route = 550; }],
      ['Desktop', f => { f.state.gamepad = false; }],
      ['wrong mapped AppID', f => { f.state.steamAppId = '222'; }],
      ['foreign dialog', f => { f.outer.setAttribute('role', 'dialog'); }],
    ]) {
      first.sync(); mutate(first); first.sync();
      check(!first.owned('last-played') && !first.owned('playtime') && !first.owned('cloud'), `${label} cannot retain linked header metadata`);
      first.state.route = b; first.state.steamAppId = '550'; first.state.gamepad = true; first.outer.removeAttribute('role');
    }
    first.sync(); const late = pending.at(-1); metadata.disposeAllBigPicturePlaybarMetadata();
    late.resolve(JSON.stringify({ items: [] })); await flush(); await frame();
    check(!document.querySelector('[data-gdl-bp-playbar-metadata]'), 'Full disposal removes owned metadata and prevents pending responses from resurrecting it');
    check(reads.every(([, id]) => id >= 2147483648) && writes === 0,
      'Every native data read uses an actual shortcut AppID and the entire workflow performs zero Steam record writes');
    return { checks, requests: pending.length, nativeWrites: writes };
  }, { sources, c: nativeCSS, shell: shellCSS });
  console.log(`Big Picture playbar metadata passed: ${report.checks} checks, ${report.requests} coalesced IPC batches, ${report.nativeWrites} native writes; installed Steam CSS and real DOM.`);
} finally { await browser.close(); }
