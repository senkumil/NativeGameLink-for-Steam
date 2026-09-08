// Set PLAYWRIGHT_MODULE_PATH when using an externally supplied Playwright runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const source = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/manual-link.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modalSource = ts.transpileModule(fs.readFileSync('frontend/core/modal.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const detectorSource = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/native-add-autodetect.ts', 'utf8')
  + '\nexport { looksLikeNativeAddAction, looksLikeAddSelectedAction };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 800, height: 450 }, { width: 360, height: 640 }]) {
    const page = await browser.newPage({ viewport });
    // Reproduce Steam's constrained/transformed host; no user state or Steam IPC.
    await page.setContent('<style>body{width:380px;height:340px;transform:translate(-25px,-60px);overflow:hidden}</style><div>Steam host</div>');
    const foreignActions = await page.evaluate(code => {
      const exports = {};
      new Function('require', 'exports', code)(() => ({}), exports);
      const frame = document.createElement('iframe');
      document.body.appendChild(frame);
      const button = frame.contentDocument.createElement('button');
      button.textContent = 'Añadir seleccionados';
      frame.contentDocument.body.appendChild(button);
      const result = { differentRealm: !(button instanceof Element),
        add: exports.looksLikeNativeAddAction(button), selected: exports.looksLikeAddSelectedAction(button) };
      frame.remove();
      return result;
    }, detectorSource);
    assert.deepEqual(foreignActions, { differentRealm: true, add: true, selected: true });
    await page.evaluate(({ code, modalCode }) => {
      const modalExports = {};
      new Function('exports', modalCode)(modalExports);
      const mocks = {
        ...modalExports,
        gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (_, key) => values[key] || ''),
        escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        getGameData: async () => null,
        shortcutPathBasename: value => value.split(/[\\/]/).pop(),
        shortcutRuntimeHost: () => ({ getMainWindowDoc: () => document }),
        shouldAutoApplyNoLauncher: () => false,
        getPendingLinkJob: () => null,
        isShortcutIdentityMutationInProgress: () => false,
      };
      const exports = {};
      new Function('require', 'exports', code)(() => mocks, exports);
      window.openReview = () => exports.showShortcutManualLinkModal(document,
        { shortcutAppId: 3000000000, title: 'The Last of Us Part I', exePath: 'D:\\Games\\tlou-i.exe' },
        { candidates: [{ appid: '1888930', name: 'The Last of Us Part I', score: 99 }] });
      window.openReview();
    }, { code: source, modalCode: modalSource });
    const overlay = page.locator('#gdl-manual-link-modal');
    assert.equal(await overlay.evaluate(el => el.matches(':modal')), true);
    const box = await overlay.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.width <= viewport.width && box.height <= viewport.height);
    const cancel = page.locator('.gdl-manual-link-cancel');
    await page.evaluate(() => {
      window.SteamClient = { Browser: { Paste() {
        const input = document.activeElement;
        input.setRangeText('1332010', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } } };
    });
    const appid = page.locator('.gdl-manual-link-manual-appid');
    await appid.fill('123');
    await appid.selectText();
    await page.locator('.gdl-manual-link-paste').click();
    assert.equal(await appid.inputValue(), '1332010', 'Paste preserves selection and targets the AppID field');
    await cancel.scrollIntoViewIfNeeded();
    await cancel.click();
    assert.equal(await overlay.count(), 0);
    await page.evaluate(() => window.openReview());
    await page.keyboard.press('Escape');
    assert.equal(await overlay.count(), 0);
    await page.close();
    console.log(`Modal browser check passed at ${viewport.width}x${viewport.height}: top layer, scroll, cancel and Escape.`);
  }
} finally { await browser.close(); }
