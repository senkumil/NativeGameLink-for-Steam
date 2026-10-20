import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const source = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/native-add-guard.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
try {
  const page = await browser.newPage();
  const report = await page.evaluate(source => {
    let checks = 0, documents = [document];
    const check = (value, message) => { if (!value) throw Error(message); checks++; };
    const clean = value => String(value || '').trim().replace(/^"|"$/g, '');
    const identity = value => clean(value).replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
    const api = {};
    new Function('require', 'exports', source)(specifier => {
      if (specifier === '../../steam/shortcuts') return { cleanShortcutPath: clean, shortcutExecutableIdentity: identity };
      if (specifier === '../../steam/localization') return { loc: (_key, fallback) => fallback };
      if (specifier === './host') return { shortcutRuntimeHost: () => ({ getSteamDocuments: () => documents, getMainWindowDoc: () => documents[0] }) };
      throw Error(`Unexpected dependency: ${specifier}`);
    }, api);
    const picker = (items, doc = document) => {
      doc.body.innerHTML = '<style>[role="dialog"]{width:760px;min-height:400px} [role="row"]{display:flex;min-height:34px}input{width:24px;height:24px}</style>'
        + '<div role="dialog"><h1>Add a Non-Steam Game</h1><input type="search" placeholder="Search"><section></section></div>';
      const list = doc.querySelector('section');
      for (const item of items) {
        const row = doc.createElement('div'); row.setAttribute('role', 'row');
        const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = item.checked !== false;
        const label = doc.createElement('div'); label.className = item.native ? '_opaque_name_123' : 'ProgramName'; label.textContent = item.title;
        const path = doc.createElement('div'); path.className = '_opaque_path_456'; path.textContent = item.displayPath ?? item.exePath;
        row.append(input, label, path); list.appendChild(row);
        if (item.native) row.__reactFiber$selection = { memoizedProps: {}, return: { memoizedProps: {
          app: { strAppName: item.title, strExePath: item.nativePath ?? item.exePath }, bIsSelected: item.selected !== false,
        } } };
      }
    };
    const selections = [
      { title: 'Aventura Ártica', exePath: 'Z:\\Biblioteca portátil\\Ártica\\StartGame.exe', native: true },
      { title: '別のゲーム', exePath: 'H:\\インストール\\ゲーム\\game.exe', native: true },
      { title: 'Third program', exePath: 'Q:\\Tools\\third.exe', checked: false, native: true },
    ];
    picker(selections);
    const before = document.body.innerHTML;
    check(api.documentHasNativeAddNonSteamDialog(document), 'The real native picker structure is recognized');
    let actual = api.nativeAddSelectedPrograms();
    check(actual.length === 2, 'Only checked native rows are captured');
    check(actual.every((item, index) => item.title === selections[index].title && item.exePath === selections[index].exePath), 'Original native program titles and full path case are preserved');
    check(document.body.innerHTML === before, 'Capturing native selection performs no DOM writes');
    check(api.nativeAddSelectedExecutableIdentities()[0] === identity(selections[0].exePath), 'Identity consumers still receive normalized executable keys');

    picker([{ title: 'Filtered program', exePath: 'D:\\Installed\\Single\\single.exe', native: true }]);
    const opaqueRow = document.querySelector('[role="row"]');
    opaqueRow.removeAttribute('role'); opaqueRow.className = '_opaque_native_row_789';
    check(api.nativeAddSelectedPrograms()[0]?.title === 'Filtered program', 'A filtered native list with one hashed row is still recognized');

    for (const exePath of ['\\\\NAS\\Shared games\\App\\play.exe', '/mnt/library/別のゲーム/start', '/media/Games/My Game/start.AppImage']) {
      picker([{ title: 'Portable program', exePath, native: true, displayPath: '…' }]);
      actual = api.nativeAddSelectedPrograms();
      check(actual.length === 1 && actual[0].exePath === exePath, 'Native properties preserve network paths and Unix executables without deriving a filename');
    }
    picker([{ title: 'Full Name', exePath: 'U:\\Games\\Full Name\\play.exe', native: true, displayPath: '…play.exe' }]);
    check(api.nativeAddSelectedPrograms()[0]?.title === 'Full Name', 'Opaque classes and visually truncated paths use native row properties');
    picker([{ title: 'Native mismatch', exePath: 'V:\\Visible\\visible.exe', native: true, nativePath: 'W:\\Different\\actual.exe' }]);
    check(api.nativeAddSelectedPrograms().length === 0, 'Contradictory native and visible executables are rejected');
    picker([{ title: 'No longer selected', exePath: 'R:\\Games\\stale.exe', native: true, selected: false }]);
    check(api.nativeAddSelectedPrograms().length === 0, 'A stale checked DOM control cannot override native deselection');
    picker([{ title: 'Fallback Label', exePath: 'T:\\Games\\Visible\\visible.exe' }]);
    check(api.nativeAddSelectedPrograms()[0]?.title === 'Fallback Label', 'An explicit program-name DOM field remains a read-only fallback');
    picker([{ title: 'No path', exePath: 'Unavailable' },
      { title: 'Other one', exePath: 'X:\\Other\\one.exe', checked: false },
      { title: 'Other two', exePath: 'Y:\\Other\\two.exe', checked: false }]);
    check(api.nativeAddSelectedPrograms().length === 0, 'A checked row without a path cannot capture executable paths from its multi-program ancestor');

    document.body.innerHTML = '<iframe></iframe>';
    const foreign = document.querySelector('iframe').contentDocument;
    documents = [foreign];
    picker([{ title: 'Programa externo', exePath: 'S:\\Installed\\Otro\\client.exe', native: true }], foreign);
    check(api.nativeAddSelectedPrograms()[0]?.title === 'Programa externo', 'Native selection works in Steam popup documents from another realm');
    return { checks };
  }, source);
  assert(report.checks >= 14);
  console.log(`Native Add selection browser checks passed: ${report.checks} checks for native row properties, path preservation, multiple programs, ambiguity, mismatches and popup ownership.`);
} finally { await browser.close(); }
