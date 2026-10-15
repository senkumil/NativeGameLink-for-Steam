import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const source = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/achievement-picker-modal.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const errorSource = ts.transpileModule(fs.readFileSync('frontend/features/shortcuts/achievement-sync-errors.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.setContent('<!doctype html><html><body style="background:#171d25;color:white;font:14px Arial"></body></html>');
  const result = await page.evaluate(async ({ source, errorSource }) => {
    let checks = 0, calls = 0, imagesCreated = 0;
    const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const exports = {};
    const errors = {};
    const resolve = name => {
      if (name.endsWith('/text')) return { escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) };
      if (name.endsWith('/localization')) return { gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)) };
      if (name === './achievement-sync-errors') return errors;
      throw Error('Unexpected dependency: ' + name);
    };
    new Function('require', 'exports', errorSource)(resolve, errors);
    new Function('require', 'exports', source)(resolve, exports);
    const originalCreate = document.createElement.bind(document);
    document.createElement = (tag, ...args) => { if (tag === 'img') imagesCreated++; return originalCreate(tag, ...args); };
    const icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="44" height="44"%3E%3Crect width="44" height="44" fill="blue"/%3E%3C/svg%3E';
    const items = Array.from({ length: 137 }, (_, index) => ({ name: 'ACH_' + index, display_name: 'Achievement ' + index,
      description: 'Description ' + index, icon, icon_gray: icon, earned: false, hidden: false, is_online: index % 2 === 0 }));
    let settle;
    const open = () => exports.openAchievementPickerModal({ doc: document, gameTitle: 'Fixture', items, initialSelectedNames: ['ACH_0'],
      hasOnlineAchievements: true, onSyncSteam: names => { calls++; window.lastSelection = names;
        return new Promise((resolve, reject) => { settle = { resolve, reject }; }); } });
    open();
    const rows = Array.from(document.querySelectorAll('.gdl-picker-row'));
    const images = rows.map(row => row.querySelector('img'));
    check(rows.length === 137 && imagesCreated === 137, 'One row/image per achievement at first mount');
    for (let i = 0; i < 100; i++) rows[0].click();
    check(Array.from(document.querySelectorAll('.gdl-picker-row')).every((row, index) => row === rows[index]
      && row.querySelector('img') === images[index]), 'One hundred selection changes keep every original row and decoded image node');
    check(imagesCreated === 137 && rows[0].classList.contains('is-selected'), 'Selection parity is correct without allocating more images');
    const search = document.querySelector('.gdl-picker-search');
    for (let i = 0; i < 20; i++) {
      search.value = 'Description 13'; search.dispatchEvent(new Event('input'));
      search.value = ''; search.dispatchEvent(new Event('input'));
    }
    check(imagesCreated === 137 && Array.from(document.querySelectorAll('.gdl-picker-row')).every((row, index) => row === rows[index]),
      'Filtering and restoring reuse the same bounded row/image cache');
    document.querySelector('.gdl-picker-btn-none').click();
    check(!document.querySelector('.gdl-picker-row.is-selected'), 'Deselect all updates current rows');
    document.querySelector('.gdl-picker-btn-all').click();
    check(document.querySelectorAll('.gdl-picker-row.is-selected').length === 137 && imagesCreated === 137, 'Bulk selection creates no replacement images');
    const sync = document.querySelector('.gdl-picker-sync-steam');
    sync.click();
    check(calls === 1 && window.lastSelection.length === 137, 'Synchronization captures the explicit selected snapshot once');
    check(Array.from(document.querySelectorAll('.gdl-picker-btn-all,.gdl-picker-btn-none,.gdl-picker-search,.gdl-picker-sync-steam')).every(control => control.disabled),
      'Selection controls are frozen during the pending request');
    sync.dispatchEvent(new Event('click')); rows[0].click();
    document.querySelector('.gdl-picker-btn-none').dispatchEvent(new Event('click'));
    check(calls === 1 && document.querySelectorAll('.gdl-picker-row.is-selected').length === 137,
      'A repeated event or selection change cannot overlap the in-flight synchronization');
    settle.reject(Error('Fake failure')); await drain();
    check(!sync.disabled && !search.disabled && !document.querySelector('.gdl-picker-sync-error').hidden,
      'Failed synchronization preserves the picker and restores its controls');
    rows[0].click(); sync.click();
    check(calls === 2 && window.lastSelection.length === 136 && !window.lastSelection.includes('ACH_0'), 'Retry uses the new explicit selection');
    settle.resolve(); await drain();
    check(!document.getElementById('gdl-achievement-picker-overlay'), 'Confirmed completion disposes the picker');
    open();
    check(document.querySelectorAll('.gdl-picker-row').length === 137 && imagesCreated === 274, 'A new picker owns only its new bounded node set');
    document.querySelector('.gdl-picker-cancel').click();
    check(!document.getElementById('gdl-achievement-picker-overlay'), 'Cancel disposes a fresh picker');
    items[0].client_writable = false;
    items[1].client_writable = false;
    open();
    const protectedRows = Array.from(document.querySelectorAll('.gdl-picker-row')).slice(0, 2);
    check(protectedRows.every(row => row.getAttribute('aria-disabled') === 'true'), 'Protected native achievements are marked read-only');
    protectedRows[0].click(); protectedRows[1].click();
    check(protectedRows[0].classList.contains('is-selected') && !protectedRows[1].classList.contains('is-selected'),
      'Individual clicks cannot change either earned or locked protected achievements');
    for (const button of ['.gdl-picker-btn-none', '.gdl-picker-btn-all', '.gdl-picker-btn-offline', '.gdl-picker-btn-online']) {
      document.querySelector(button).click();
      check(protectedRows[0].classList.contains('is-selected') && !protectedRows[1].classList.contains('is-selected'),
        'Bulk action preserves protected official states: ' + button);
    }
    document.querySelector('.gdl-picker-cancel').click();
    let localSelection;
    exports.openAchievementPickerModal({ doc: document, gameTitle: 'Local fixture', items: items.slice(0, 2),
      initialSelectedNames: ['ACH_0'], hasOnlineAchievements: false,
      onSave: names => { localSelection = names; }, onSyncSteam: () => {} });
    document.querySelectorAll('.gdl-picker-row')[1].click();
    document.querySelector('.gdl-picker-save').click(); await drain();
    check(localSelection.includes('ACH_1'), 'Steam restrictions do not disable editing a separate local achievement file');
    document.createElement = originalCreate;
    return { checks, imagesCreated, syncCalls: calls };
  }, { source, errorSource });
  assert.equal(result.syncCalls, 2);
  console.log(`Achievement picker runtime browser passed: ${result.checks} checks; stable row/image nodes, bounded filtering, serialized actions and cleanup. All synchronization calls mocked.`);
} finally { await browser.close(); }
