import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';
const sources = Object.fromEntries(Object.entries({ properties: 'frontend/features/shortcuts/achievement-properties.ts', service: 'frontend/features/achievements/service.ts' }).map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText]));
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
try {
  const page = await browser.newPage();
  const report = await page.evaluate(async sources => {
    const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
    const initial = defer(), caps = defer(), saves = [], sequence = [];
    let persisted = { simulate: false, simulate_count: 0, simulate_online_count: 0 }, current;
    const data = count => ({ found: true, appid: '111', metadata_appid: '111', state_appid: '3000000001', total: 10, unlocked: count, simulation_enabled: persisted.simulate,
      achievements: Array.from({ length: 10 }, (_, i) => ({ name: `A${i}`, display_name: `Achievement ${i}`, earned: i < count, earned_time: 0, is_online: i >= 8 })) });
    current = data(3);
    const backend = {
      getGameAchievementOptionsBackend: () => initial.promise,
      getGameAchievementPathBackend: async () => ({ ok: true }),
      getGameAchievementCapabilitiesBackend: () => caps.promise,
      setGameAchievementOptionsBackend: ({ request_json }) => { const pending = defer(); saves.push({ ...pending, request: JSON.parse(request_json) }); return pending.promise; },
      fetchLocalAchievementsBackend: async () => JSON.stringify(data(persisted.simulate ? persisted.simulate_count + persisted.simulate_online_count : 3)),
    };
    const localization = { steamLanguageSync: () => 'english', gdlText: (_key, text, values = {}) => text.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)) };
    const preferences = { getPreferences: () => ({}), simulatedAchievementsEnabled: () => false };
    const service = {};
    new Function('require', 'exports', sources.service)(name => ({ '../../api/backend': backend, '../../core/preferences': preferences, '../../steam/localization': localization, './native-schema': { readNativeAchievementSchema: async () => null } })[name], service);
    service.subscribeLocalAchievementData(update => { if (update.data) { current = update.data; sequence.push(current.unlocked); } });
    const runtime = {
      getCachedLocalAchievementsForShortcut: () => current, cacheLocalAchievements: value => { current = value; },
      broadcastOptimisticAchievementUpdate: update => service.publishOptimisticAchievementUpdate(update), ensureLocalPlaybarStat() {},
      refreshLocalAchievementUI: target => { service.releaseOptimisticAchievementUpdate(String(target.steamAppId), String(target.stateAppId)); service.clearLocalAchievementRequestCache(); void service.fetchLocalAchievementData(target.steamAppId, { stateAppId: target.stateAppId, maxAgeMs: 0 }); },
      resetLocalAchievementToastBaseline() {}, setNextLaunchAchievementReplayEnabled() {},
    };
    const properties = {};
    new Function('require', 'exports', sources.properties)(name => ({ '../../api/backend': backend, '../../core/game-data': { getCachedGameData: () => ({ data: { achievements: { total: 10 } } }) }, '../../core/preferences': preferences,
      '../../core/text': { escapeHtml: text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) }, '../achievements/runtime': runtime, '../../steam/localization': localization,
      './achievement-picker-modal': { openAchievementPickerModal() {} }, './achievement-sync-errors': { steamSyncFailureMessage: () => '' } })[name], properties);
    document.body.innerHTML = `<section>${properties.shortcutAchievementSettingsHtml()}</section>`;
    properties.bindShortcutAchievementSettings({ section: document.querySelector('section'), steamAppId: () => '111', shortcutAppId: () => '3000000001' });
    const slider = document.querySelector('.gdl-game-achievement-count-slider');
    const move = (value, event = 'change') => { slider.value = String(value); slider.dispatchEvent(new Event(event, { bubbles: true })); };
    const accept = async index => { const save = saves[index]; persisted = { ...save.request }; save.resolve({ ok: true, configured: true, ...persisted }); await flush(); };
    move(4, 'input'); check(current.unlocked === 4, 'Dragging updates the preview immediately');
    initial.resolve({ ok: true, simulate: false, simulate_count: 0 }); caps.resolve({ ok: true, total: 10, has_online: true, online_count: 2 }); await flush();
    check(slider.value === '4' && current.unlocked === 4, 'Late initial settings and capabilities cannot reset an edited slider');
    move(4); check(saves.length === 1, 'Release commits the debounced drag once');
    move(6, 'input'); move(6); await accept(0);
    check(slider.value === '6' && current.unlocked === 6 && saves.length === 2 && saves[1].request.simulate_count === 6, 'Old acknowledgement preserves the latest queued slider position');
    check((await service.fetchLocalAchievementData('111', { stateAppId: '3000000001', maxAgeMs: 0 })).unlocked === 6, 'Polling cannot replace a pending preview with the older persisted count');
    await accept(1); check(current.unlocked === 6 && sequence.every(value => value > 0), 'Confirmation never flashes a fully locked intermediate box');
    move(7); move(8); move(7); await accept(2);
    check(saves.length === 3 && current.unlocked === 7 && slider.value === '7', 'Returning to an active save cancels its obsolete queued position');
    move(0); check(current.unlocked === 7, 'Selecting real progress retains the current box until its source is confirmed');
    await accept(3); check(current.unlocked === 3 && !sequence.includes(0), 'Disabling simulation shows confirmed real progress without an invented zero');
    move(5); saves[4].reject(Error('Save failed')); await flush();
    check(current.unlocked === 3, 'Failed save releases the preview and restores confirmed progress');
    check(document.querySelector('.gdl-game-achievement-options-status').textContent.includes('could not'), 'A failed save remains visible to the user');
    return { checks: checks.length, sequence, saves: saves.length };
  }, sources);
  assert(report.checks >= 10);
  console.log(`Achievement slider browser passed: ${report.checks} checks; preview sequence ${report.sequence.join(' → ')}; deferred settings, polling, queued writes and failure recovery.`);
} finally { await browser.close(); }
