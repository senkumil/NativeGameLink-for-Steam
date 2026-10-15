import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const source = ts.transpileModule(fs.readFileSync('frontend/runtime/copied-feedback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><head><style>'
    + 'body{background:#171d25;color:white;font:14px Arial}'
    + '._3cXgxM5dBuTxGOOYw0lxsP{display:block;background:#555;padding:8px}'
    + '</style></head><body><main id="library"></main></body></html>');
  const result = await page.evaluate(async source => {
    let checks = 0, language = 'english';
    const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const exports = {};
    new Function('require', 'exports', source)(name => {
      if (name === '../steam/localization') return {
        steamLanguageSync: () => language,
        officialSteamText: text => language === 'spanish' ? (text === 'Copied!' ? '¡Copiado!' : 'Copiado') : text,
      };
      throw Error('Unexpected dependency: ' + name);
    }, exports);
    const { scheduleCopiedFeedbackCleanup: schedule, disposeCopiedFeedbackCleanup: dispose } = exports;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const clipboardCalls = [], copyPromise = Promise.resolve('mock clipboard result');
    const originalWrite = function (...args) { clipboardCalls.push({ receiver: this, args }); return copyPromise; };
    const clipboard = { writeText: originalWrite };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    const originalFrame = window.requestAnimationFrame, originalCancelFrame = window.cancelAnimationFrame;
    const originalTimer = window.setTimeout, originalCancelTimer = window.clearTimeout;
    const frames = new Map(), timers = new Map();
    window.requestAnimationFrame = callback => {
      const id = originalFrame.call(window, timestamp => { frames.delete(id); callback(timestamp); });
      frames.set(id, callback); return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id); originalCancelFrame.call(window, id); };
    window.setTimeout = (callback, delay, ...args) => {
      const id = originalTimer.call(window, () => { timers.delete(id); callback(...args); }, delay);
      timers.set(id, callback); return id;
    };
    window.clearTimeout = id => { timers.delete(id); originalCancelTimer.call(window, id); };
    const afterFrame = () => new Promise(resolve => originalFrame.call(window,
      () => originalTimer.call(window, resolve, 0)));
    const visible = element => {
      if (!element.isConnected) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      return true;
    };
    const nativePopup = label => {
      const portal = document.createElement('div');
      portal.className = 'hoverposition_HoverPosition';
      const notice = document.createElement('div'); notice.className = '_3cXgxM5dBuTxGOOYw0lxsP';
      const text = document.createElement('span'); text.textContent = label;
      notice.appendChild(text); portal.appendChild(notice); document.body.appendChild(portal);
      return { portal, notice, text };
    };
    try {
      schedule(document);
      check(clipboard.writeText !== originalWrite, 'Initialization instruments only the mocked clipboard method');
      const library = document.getElementById('library');
      const ordinary = document.createElement('p'); ordinary.textContent = 'Copied! Your library information is available.';
      const button = document.createElement('button'); button.textContent = 'Copied!';
      const otherPopup = nativePopup('Loading library details');
      library.append(ordinary, button);
      schedule(document, [ordinary, button, otherPopup.portal]);
      const labels = ['Copiado', '¡Copiado!', 'Copied', 'Copied!'];
      let previous = null, hiddenBeforeFrame = 0;
      for (let index = 0; index < 100; index++) {
        previous?.portal.remove();
        library.dataset.route = '/library/app/' + (index % 2 ? '105600' : '1030300');
        language = index % 4 < 2 ? 'spanish' : 'english';
        previous = nativePopup(labels[index % labels.length]);
        schedule(document, [previous.portal]);
        if (!visible(previous.notice)) hiddenBeforeFrame++;
      }
      check(hiddenBeforeFrame === 100, 'All 100 ES/EN native portal recreations are hidden synchronously before a browser frame');
      await afterFrame();
      check(!visible(previous.notice), 'The last navigation artifact remains hidden after rendering');
      check(visible(ordinary) && visible(button) && visible(otherPopup.notice),
        'Longer ordinary text, an interactive Copied button and unrelated native popup text remain visible');
      previous.portal.remove();

      const wrappedWrite = clipboard.writeText;
      const returnedPromise = wrappedWrite.call(clipboard, 'fixture text', 'extra argument');
      check(returnedPromise === copyPromise && clipboardCalls.length === 1
        && clipboardCalls[0].receiver === clipboard
        && JSON.stringify(clipboardCalls[0].args) === JSON.stringify(['fixture text', 'extra argument']),
      'Clipboard wrapping preserves this, every argument and the exact original promise without a real clipboard write');
      await returnedPromise;
      language = 'english';
      const legitimate = nativePopup('Copied!');
      schedule(document, [legitimate.portal]);
      check(visible(legitimate.notice), 'A clipboard action allows its genuine native copy notice');
      schedule(document, [legitimate.portal]);
      await afterFrame();
      check(visible(legitimate.notice), 'Rescanning the same allowed notice does not consume another credit or hide it');
      legitimate.portal.remove();
      const recreated = nativePopup('Copied!');
      schedule(document, [recreated.portal]);
      check(!visible(recreated.notice), 'The next recreated popup is hidden when no new clipboard action occurred');
      recreated.portal.remove();

      document.dispatchEvent(new Event('copy', { bubbles: true }));
      language = 'spanish';
      const copyEventNotice = nativePopup('¡Copiado!');
      schedule(document, [copyEventNotice.portal]);
      check(visible(copyEventNotice.notice), 'A native document copy event also permits one legitimate localized notice');
      copyEventNotice.portal.remove();
      const afterCopyEvent = nativePopup('Copiado');
      schedule(document, [afterCopyEvent.portal]);
      check(!visible(afterCopyEvent.notice), 'A document copy event does not authorize later navigation artifacts');
      afterCopyEvent.portal.remove();

      const queued = document.createElement('section');
      for (let index = 0; index < 2000; index++) {
        const row = document.createElement('div'); row.textContent = 'Library item ' + index; queued.appendChild(row);
      }
      document.body.appendChild(queued);
      schedule(document, [queued]);
      const retiredCallbacks = [...frames.values(), ...timers.values()];
      check(retiredCallbacks.length > 0, 'A real browser cleanup slice is pending before disposal');
      dispose(document); dispose(document);
      check(clipboard.writeText === originalWrite && frames.size === 0 && timers.size === 0,
        'Disposal restores the original clipboard method and cancels all queued cleanup work');
      const afterDispose = nativePopup('Copied!');
      queued.appendChild(afterDispose.portal);
      for (const callback of retiredCallbacks) callback(performance.now());
      await afterFrame();
      check(visible(afterDispose.notice) && clipboard.writeText === originalWrite,
        'Retired callbacks cannot hide future notices or recreate clipboard instrumentation after shutdown');
      return { checks, hiddenBeforeFrame, clipboardCalls: clipboardCalls.length };
    } finally {
      dispose(document);
      for (const id of frames.keys()) originalCancelFrame.call(window, id);
      for (const id of timers.keys()) originalCancelTimer.call(window, id);
      window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancelFrame;
      window.setTimeout = originalTimer; window.clearTimeout = originalCancelTimer;
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else delete navigator.clipboard;
    }
  }, source);
  assert.equal(result.hiddenBeforeFrame, 100);
  assert.equal(result.clipboardCalls, 1);
  console.log(`Copied feedback browser passed: ${result.checks} checks; 100 native navigation portals hidden before paint, genuine copy notices retained and teardown complete. Clipboard writes mocked.`);
} finally { await browser.close(); }
