import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const source = fs.readFileSync('frontend/features/shortcuts/properties.ts', 'utf8');
const styleSource = fs.readFileSync('frontend/features/shortcuts/properties-style.ts', 'utf8');
const style = styleSource.slice(styleSource.indexOf('`') + 1, styleSource.lastIndexOf('`'));
const start = source.indexOf('section.innerHTML = `') + 'section.innerHTML = '.length;
const end = source.indexOf('\n\t`;', start) + '\n\t`'.length;
const html = new Function('SHORTCUT_PROPERTIES_STYLE', 'escapeHtml', 'gdlText', 'initialAppId', 'currentLinked', 'initialOptionHtml', 'shortcutAchievementSettingsHtml', `return ${source.slice(start, end)}`)(
  style, value => String(value), (_key, fallback) => fallback, '1091500', false,
  '<option>Cyberpunk 2077 — AppID 1091500</option>', () => '<div style="height:700px">Achievement options</div>',
);
assert.ok(html.indexOf('<div class="gdl-auto-detect ') < html.indexOf('<div class="gdl-native-setting-row gdl-link-actions'), 'actions follow suggestions');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const width of [680, 420]) {
    const page = await browser.newPage({ viewport: { width: width + 40, height: 700 } });
    await page.setContent(`<div id="scroll" style="width:${width}px;height:560px;overflow:auto;background:#171d25"><div style="height:600px">Native Steam fields</div><div class="gdl-properties-injected">${html}</div></div>`);
    await page.locator('.gdl-auto-candidate-preview').evaluate(el => { el.style.display = 'block'; el.style.height = '150px'; el.textContent = 'Cyberpunk 2077'; });
    await page.locator('#scroll').evaluate(el => {
      const suggestions = el.querySelector('.gdl-auto-detect');
      el.scrollTop += suggestions.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    const button = page.locator('.gdl-save-btn');
    const rect = await button.boundingBox();
    const host = await page.locator('#scroll').boundingBox();
    assert.ok(rect.y >= host.y && rect.y + rect.height <= host.y + host.height);
    assert.ok(rect.x >= host.x && rect.x + rect.width <= host.x + host.width);
    await button.evaluate(el => el.addEventListener('click', () => { el.dataset.clicked = 'true'; }));
    // Coordinates avoid Playwright auto-scrolling an offscreen action into view.
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal(await button.getAttribute('data-clicked'), 'true');
    await page.close();
    console.log(`Properties actions visible and clickable with suggestions scrolled to top at width ${width}.`);
  }
} finally { await browser.close(); }
