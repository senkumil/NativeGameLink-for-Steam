// Set PLAYWRIGHT_MODULE_PATH when using an externally supplied Playwright runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const source = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/manual-link.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modalSource = ts.transpileModule(fs.readFileSync('frontend/core/modal.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const detectionSource = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/detection.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const detectorSource = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/native-add-autodetect.ts', 'utf8')
  + '\nexport { looksLikeNativeAddAction, looksLikeAddSelectedAction };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
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
    await page.evaluate(({ code, modalCode, detectionCode }) => {
      const modalExports = {};
      new Function('exports', modalCode)(modalExports);
      const mocks = {
        ...modalExports,
        gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (_, key) => values[key] || ''),
        escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        getGameData: async () => null,
        shortcutPathBasename: value => value.split(/[\\/]/).pop(),
        cleanShortcutPath: value => String(value || '').replace(/^"|"$/g, ''),
        shortcutRuntimeHost: () => ({ getMainWindowDoc: () => document }),
        shouldAutoApplyNoLauncher: () => false,
        getPendingLinkJob: () => null,
        isShortcutIdentityMutationInProgress: () => false,
        invalidateShortcutReview: () => 0,
      };
      const detectionExports = {};
      new Function('require', 'exports', detectionCode)(() => ({ ...mocks, RetryingRequestCache: class {} }), detectionExports);
      Object.assign(mocks, { reliableReviewCandidate: detectionExports.reliableReviewCandidate, displayReviewConfidence: detectionExports.displayReviewConfidence });
      const exports = {};
      new Function('require', 'exports', code)(() => mocks, exports);
      window.openReview = () => exports.showShortcutManualLinkModal(document,
        { shortcutAppId: 3000000000, title: 'DRAGON BALL: Sparking! ZERO', exePath: 'D:\\Games\\SparkingZERO.exe',
          startDir: 'D:\\Games', launchOptions: '', bootstrapDetected: true,
          recommendedExePath: 'D:\\Games\\Binaries\\Win64\\SparkingZERO-Win64-Shipping.exe',
          recommendedStartDir: 'D:\\Games\\Binaries\\Win64', trackingExecutableAutoApply: true },
        { candidates: [{ appid: '1790600', name: 'DRAGON BALL: Sparking! ZERO', score: 99 }] });
      window.openReview();
    }, { code: source, modalCode: modalSource, detectionCode: detectionSource });
    const overlay = page.locator('#gdl-manual-link-modal');
    assert.equal(await overlay.evaluate(el => el.matches(':modal')), true);
    const box = await overlay.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.width <= viewport.width && box.height <= viewport.height);
    const assertSelectedExecutable = async () => {
      assert.equal(await overlay.locator('.gdl-manual-link-tracking, .gdl-manual-link-tracking-input').count(), 0,
        'Legacy executable recommendations must not render an executable replacement checkbox');
      assert.equal(await overlay.locator('.gdl-manual-link-exe-summary').innerText(),
        'Game path: D:\\Games\\SparkingZERO.exe');
      assert.doesNotMatch(await overlay.innerText(), /Shipping\.exe|Use the real game executable|closes after launching/i,
        'The review dialog must not expose replacement-executable instructions');
    };
    await assertSelectedExecutable();
    await overlay.evaluate(el => el._updateContext({ shortcutAppId: 3000000000, bootstrapDetected: true,
      recommendedExePath: 'D:\\Games\\Binaries\\Win64\\Another-Shipping.exe',
      recommendedStartDir: 'D:\\Games\\Binaries\\Win64', trackingExecutableAutoApply: true }));
    await assertSelectedExecutable();
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
    console.log(`Modal browser check passed at ${viewport.width}x${viewport.height}: top layer, scroll, cancel, Escape, original executable and legacy recommendation isolation.`);
  }
} finally { await browser.close(); }
