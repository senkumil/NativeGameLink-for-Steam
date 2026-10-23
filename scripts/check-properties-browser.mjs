import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const source = fs.readFileSync('frontend/features/shortcuts/properties.ts', 'utf8');
const styleSource = fs.readFileSync('frontend/features/shortcuts/properties-style.ts', 'utf8');
const style = styleSource.slice(styleSource.indexOf('`') + 1, styleSource.lastIndexOf('`'));
const start = source.indexOf('section.innerHTML = `') + 'section.innerHTML = '.length;
const end = source.indexOf('\n\t`;', start) + '\n\t`'.length;
assert.ok(start > 0 && end > start, 'The fixture must render the production Properties template');

// Use the actual Spanish strings and all three production settings templates.
// Only their HTML factories run: this layout check makes no backend calls.
const localizationSource = ts.createSourceFile('localization.ts', fs.readFileSync('frontend/steam/localization.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let spanishInitializer;
const findSpanish = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(localizationSource) === 'SPANISH_TRANSLATIONS') spanishInitializer = node.initializer?.getText(localizationSource);
  ts.forEachChild(node, findSpanish);
};
findSpanish(localizationSource);
assert.ok(spanishInitializer, 'Spanish translations are available for the responsive layout fixture');
const spanish = new Function(`return (${spanishInitializer});`)();
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
const gdlText = (key, fallback, values = {}) => (spanish[key] || fallback).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
const htmlModule = file => {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(key => key === '../../steam/localization' ? { gdlText } : key === '../../core/text' ? { escapeHtml } : {}, exports);
  return exports;
};
const achievements = htmlModule('frontend/features/shortcuts/achievement-properties.ts');
const playtime = htmlModule('frontend/features/shortcuts/playtime-properties.ts');
const community = htmlModule('frontend/features/shortcuts/community-item-properties.ts');
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="184" height="86"><rect width="184" height="86" fill="#f0e800"/><path d="M90 0h94v86H60z" fill="#737016"/><text x="12" y="49" fill="#17232d" font-family="sans-serif" font-size="18" font-weight="bold">CYBERPUNK</text><text x="61" y="69" fill="#17232d" font-family="sans-serif" font-size="15">2077</text></svg>')}`;
const renderHtml = linked => new Function('SHORTCUT_PROPERTIES_STYLE', 'escapeHtml', 'gdlText', 'initialAppId', 'currentLinked', 'initialOptionHtml', 'initialGameName', 'initialHeaderUrl', 'shortcutAchievementSettingsHtml', 'shortcutPlaytimePropertiesHtml', 'shortcutCommunityItemSettingsHtml', `return ${source.slice(start, end)}`)(
  style, escapeHtml, gdlText, linked ? '1091500' : '', linked ? '1091500' : '',
  linked ? '<option value="1091500">Cyberpunk 2077 — AppID 1091500</option>' : '<option value="">Selecciona un juego</option>',
  'Cyberpunk 2077', image, achievements.shortcutAchievementSettingsHtml, playtime.shortcutPlaytimePropertiesHtml, community.shortcutCommunityItemSettingsHtml,
);
const linkedHtml = renderHtml(true);
assert.ok(linkedHtml.indexOf('gdl-link-actions') < linkedHtml.indexOf('gdl-auto-detect '), 'Link actions precede optional suggestions');
assert.doesNotMatch(linkedHtml, /gdl-tracking-executable|Use the real game executable/, 'Properties must not render executable replacement controls');

const screenshotDirectory = path.resolve('scratch');
fs.mkdirSync(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
try {
  for (const { width, viewportWidth, screenshotWidth } of [
    { width: 680, viewportWidth: 720, screenshotWidth: '680' },
    { width: 420, viewportWidth: 460, screenshotWidth: '420' },
    { width: 420, viewportWidth: 1200, screenshotWidth: '420-wide-viewport' },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewportWidth, height: 740 }, deviceScaleFactor: 1 });
    await page.route('http://**/*', route => route.abort());
    await page.route('https://**/*', route => route.abort());
    const mount = async linked => {
      await page.setContent(`<style>
        body { margin: 20px; background: #10151b; color: #dfe3e6; font: 14px Arial, sans-serif; }
        #scroll { width: ${width}px; height: 680px; overflow: auto; background: #171d25; }
        .native-fields { padding: 24px 24px 0; }
        .native-fields h1 { margin: 0 0 24px; color: #fff; font-size: 24px; }
        .native-fields label { display: block; color: #9da5ae; font-size: 13px; }
        .native-fields input { box-sizing: border-box; width: 100%; margin: 8px 0 14px; padding: 9px 12px; border: 1px solid #303741; border-radius: 2px; background: #101419; color: #dfe3e6; }
      </style><main id="scroll"><div class="native-fields"><h1>Acceso directo</h1><label>Destino<input value="&quot;D:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe&quot;" /></label><label>Opciones de lanzamiento<input value="-nolauncher" /></label></div><section class="gdl-properties-injected" style="padding:0 24px 24px;margin-top:24px;font-family:inherit;">${renderHtml(linked)}</section></main>`);
      if (linked) await page.evaluate(({ image }) => {
        // Simulate a hydrated committed link so the genuine card section can be
        // included in the layout without altering its default disclosure state.
        document.querySelector('.gdl-community-item-options').hidden = false;
        document.querySelector('.gdl-community-options-content').hidden = false;
        document.querySelector('.gdl-community-card-summary').textContent = '5 de 5 tarjetas seleccionadas';
        document.querySelector('.gdl-community-card-border').value = 'foil';
        document.querySelector('.gdl-community-badge').innerHTML = '<option>Futuro sombrío — Foil</option>';
        document.querySelector('.gdl-community-card-list').innerHTML = ['Calle 6', 'Aldecaldo', 'Animales', 'Mox', 'Hijos del Vudú'].map(title => `<label class="gdl-community-card-choice"><input type="checkbox" checked /><img src="${image}" alt="" /><span>${title}</span></label>`).join('');
        document.querySelector('.gdl-game-achievement-count-display').textContent = '25 / 57 logros';
        const slider = document.querySelector('.gdl-game-achievement-count-slider'); slider.max = '57'; slider.value = '25';
        document.querySelector('.gdl-game-achievement-online-row').style.display = 'flex';
        document.querySelector('.gdl-game-achievement-online-count-display').textContent = '2 / 7 logros online';
        const onlineSlider = document.querySelector('.gdl-game-achievement-online-count-slider'); onlineSlider.max = '7'; onlineSlider.value = '2';
        document.querySelector('.gdl-skip-launcher').style.display = 'flex';
        document.querySelector('.gdl-skip-launcher-input').checked = true;
      }, { image });
    };
    const assertNoOverflow = async label => {
      const layout = await page.locator('#scroll').evaluate(scroll => {
        const host = scroll.getBoundingClientRect();
        const visible = Array.from(scroll.querySelectorAll('summary, button, input, select, .gdl-community-card-choice')).filter(element => element.checkVisibility());
        return { horizontalOverflow: scroll.scrollWidth - scroll.clientWidth, clipped: visible.flatMap(element => {
          const rect = element.getBoundingClientRect();
          return rect.left < host.left - 1 || rect.right > host.left + scroll.clientWidth + 1 || element.tagName === 'BUTTON' && element.scrollWidth > element.clientWidth + 1
            ? [{ className: element.className, text: element.textContent, left: rect.left - host.left, right: rect.right - host.left, width: scroll.clientWidth }] : [];
        }) };
      });
      assert.ok(layout.horizontalOverflow <= 1 && layout.clipped.length === 0, `${label} at content/viewport ${width}/${viewportWidth}: ${JSON.stringify(layout)}`);
    };
    const screenshot = async name => {
      await page.locator('#scroll').screenshot({ path: path.join(screenshotDirectory, `props-layout-${name}-${screenshotWidth}.png`) });
    };

    await mount(true);
    const categories = page.locator('.gdl-properties-injected > details.gdl-properties-category');
    assert.equal(await categories.count(), 4, 'Linked Properties group every setting into four categories');
    assert.deepEqual(await categories.evaluateAll(elements => elements.map(element => element.open)), [false, false, false, false], 'A linked game starts with compact summaries only');
    assert.equal(await page.locator('.gdl-linked-game-name').textContent(), 'Cyberpunk 2077');
    assert.match(await page.locator('.gdl-linked-game-state').textContent(), /Vinculado/);
    const compact = await page.locator('.gdl-properties-injected').boundingBox();
    assert.ok(compact.height <= 440, `Collapsed categories remain compact at width ${width}: ${compact.height}px`);
    const host = await page.locator('#scroll').boundingBox();
    const summaries = await categories.locator(':scope > summary').all();
    for (const summary of summaries) {
      const rect = await summary.boundingBox();
      assert.ok(rect.y >= host.y && rect.y + rect.height <= host.y + host.height, 'All category summaries fit below the native shortcut fields');
    }
    await assertNoOverflow('Collapsed categories');
    await screenshot('compact');
    await summaries[0].focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.classList.contains('gdl-launch-settings')), true, 'Tab skips controls inside the closed linking category');

    for (const [selector, name] of [['.gdl-link-section', 'link'], ['.gdl-launch-settings', 'launch'], ['.gdl-game-achievement-source', 'achievements'], ['.gdl-community-item-options', 'cards']]) {
      const details = page.locator(selector);
      const summary = details.locator(':scope > summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await details.evaluate(element => element.open), true, `${name} opens with Enter`);
      await assertNoOverflow(`${name} expanded`);
      if (name === 'achievements') {
        const online = await page.locator('.gdl-game-achievement-online-row').evaluate(row => {
          const style = getComputedStyle(row), control = row.querySelector('.gdl-achievement-control'), slider = row.querySelector('input[type="range"]');
          return { direction: style.flexDirection, height: row.getBoundingClientRect().height,
            availableWidth: row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            controlWidth: control.getBoundingClientRect().width, sliderWidth: slider.getBoundingClientRect().width };
        });
        assert.equal(online.direction, 'column', `Online achievement controls stack at content/viewport ${width}/${viewportWidth}`);
        assert.ok(online.height < 200, `Stacked online achievement row stays compact: ${JSON.stringify(online)}`);
        assert.ok(Math.abs(online.controlWidth - online.availableWidth) <= 2 && Math.abs(online.sliderWidth - online.controlWidth) <= 2,
          `The stacked online achievement slider fills the available row width: ${JSON.stringify(online)}`);
      }
      if (name === 'link') {
        const button = page.locator('.gdl-save-btn');
        await button.scrollIntoViewIfNeeded();
        const rect = await button.boundingBox();
        const host = await page.locator('#scroll').boundingBox();
        assert.ok(rect.y >= host.y && rect.y + rect.height <= host.y + host.height, 'Link action is not vertically clipped');
        assert.ok(rect.x >= host.x && rect.x + rect.width <= host.x + host.width, 'Link action is not horizontally clipped');
        await button.evaluate(element => element.addEventListener('click', () => { element.dataset.clicked = 'true'; }));
        // Coordinates prove the visible action can be hit without auto-scroll.
        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        assert.equal(await button.getAttribute('data-clicked'), 'true');
      }
      await summary.evaluate(element => {
        const scroll = document.querySelector('#scroll');
        scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        element.blur();
      });
      await screenshot(name);
      if (name === 'achievements') {
        const pathSummary = page.locator('.gdl-achievement-path-disclosure > summary');
        await pathSummary.focus();
        await page.keyboard.press('Enter');
        await assertNoOverflow('Achievement path expanded');
        await pathSummary.evaluate(element => {
          const scroll = document.querySelector('#scroll');
          scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
          element.blur();
        });
        await screenshot('achievement-path');
      }
      await summary.focus();
      await page.keyboard.press('Space');
      assert.equal(await details.evaluate(element => element.open), false, `${name} closes with Space`);
    }

    await mount(false);
    assert.equal(await page.locator('.gdl-link-section').evaluate(element => element.open), true, 'Unlinked shortcut exposes the linking controls immediately');
    assert.equal(await page.locator('.gdl-launch-settings').evaluate(element => element.open), false, 'Launch settings stay collapsed for unlinked shortcuts');
    assert.equal(await page.locator('.gdl-game-achievement-source').evaluate(element => element.open), false, 'Achievement settings stay collapsed for unlinked shortcuts');
    await assertNoOverflow('Unlinked shortcut');
    await page.close();
    console.log(`Properties categories passed at content/viewport ${width}/${viewportWidth}: compact defaults, unlinked setup, keyboard toggling, online achievement sizing, no overflow, visible click, and Spanish screenshots.`);
  }
  console.log(`Properties layout screenshots: ${screenshotDirectory}${path.sep}props-layout-*.png`);
} finally { await browser.close(); }
