// Real DOM, production Properties entry point and native account controls.
// Backend calls are fixtures; no Steam account or launcher is touched.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const sources = Object.fromEntries(Object.entries({
  properties: 'frontend/features/shortcuts/properties.ts', native: 'frontend/features/shortcuts/native-properties.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage();
  const report = await page.evaluate(async sources => {
    let checks = 0, reads = 0, writes = 0;
    const check = (value, label) => { if (!value) throw Error(label); checks++; };
    const noop = () => {};
    const backend = new Proxy({ getSteamCardFarmingStatusBackend: async () => { reads++; return { active: false }; } }, {
      get: (object, key) => object[key] || (() => { writes++; throw Error(`Unexpected backend ${String(key)}`); }),
    });
    const localization = { loc: (_key, fallback) => fallback, gdlText: (_key, fallback) => fallback,
      setLocalizationDocumentProvider: noop, steamLanguageSync: () => 'english' };
    const text = { escapeHtml: value => String(value), templateToRegex: () => /^Properties - (.+)$/i };
    const native = {};
    new Function('exports', 'require', sources.native)(native, key => {
      if (key === '../../api/backend') return backend;
      if (key === '../../steam/localization') return localization;
      if (key === '../../core/text') return text;
      if (key === '../../steam/shortcuts') return { SHORTCUT_THRESHOLD: 2147483648, findNativeSteamAppIdByName: () => '431960' };
      return new Proxy({}, { get: () => noop });
    });
    const properties = {};
    new Function('exports', 'require', sources.properties)(properties, key => {
      if (key === './native-properties') return native;
      if (key === '../../steam/localization') return localization;
      if (key === '../../core/text') return text;
      if (key === '../../api/backend') return backend;
      return new Proxy({}, { get: () => noop });
    });
    const launch = `<div class="DialogContent" role="dialog"><h1>Wallpaper Engine</h1>
      <div>Seleccionar configuraciones de lanzamiento</div><div>Launch Options</div>
      <label><input type="checkbox">Always use this option</label><button>Play</button><button>Cancel</button></div>`;
    const inject = () => properties.tryInjectPropertiesField(document, 'Wallpaper Engine');
    for (const markup of [launch, '<div class="DialogContent">Steam Cloud</div>',
      '<div role="dialog">Launch Options <input type="text"></div>',
      '<div class="PagedSettingsDialog"><div class="PagedSettingsDialog_PageList">General</div><div class="PagedSettingsDialog_PageContent">Steam Cloud</div></div>',
      '<div class="library">Steam Cloud <div>Launch Options</div><input value="Wallpaper Engine"></div>']) {
      document.body.innerHTML = markup;
      const before = document.body.innerHTML;
      for (let i = 0; i < 50; i++) inject();
      native.tryInjectNativePropertiesField(document, 'Wallpaper Engine', document.body.firstElementChild);
      await Promise.resolve();
      check(document.body.innerHTML === before, 'Launch dialogs, library and global settings stay byte-for-byte untouched');
    }
    check(reads === 0 && writes === 0, 'Foreign surfaces do not even start native account status requests');
    document.body.innerHTML = launch + `<div class="AppProperties PagedSettingsDialog">
      <aside class="PagedSettingsDialog_PageListColumn"><div class="PagedSettingsDialog_PageList">General</div></aside>
      <main class="PagedSettingsDialog_PageContent"><div>Launch Options</div><input type="text"></main></div>`;
    const launchNode = document.body.firstElementChild, beforeLaunch = launchNode.outerHTML;
    const content = document.querySelector('main');
    check(native.findNativePropertiesPage(document) === content, 'Only the owned content page is eligible when a launch dialog exists beside it');
    inject(); await Promise.resolve(); await Promise.resolve();
    check(content.querySelectorAll('.gdl-native-properties-injected').length === 1 && launchNode.outerHTML === beforeLaunch,
      'Legitimate native Properties keep achievement/card controls inside their content column');
    for (let i = 0; i < 50; i++) inject();
    check(document.querySelectorAll('.gdl-native-properties-injected').length === 1, 'Repeated mutations never duplicate the controls');
    content.hidden = true; inject();
    check(!document.querySelector('.gdl-native-properties-injected') && native.findNativePropertiesPage(document) === null,
      'A hidden or retired Properties page cannot retain its injected controls');
    document.body.innerHTML = launch;
    const stale = document.createElement('div'); stale.className = 'gdl-native-properties-injected';
    launchNode.append(stale); document.body.firstElementChild.append(stale); inject();
    check(!document.querySelector('.gdl-native-properties-injected') && document.body.innerHTML === launch,
      'A stale plugin block is removed without rewriting the native launch dialog');
    check(writes === 0, 'The entire regression scenario performs zero achievement, farming or launcher writes');
    return { checks, statusReads: reads, writes };
  }, sources);
  console.log(`Properties surface isolation passed: ${report.checks} checks, ${report.statusReads} authorized status reads, ${report.writes} account writes; real Edge DOM.`);
} finally { await browser.close(); }
