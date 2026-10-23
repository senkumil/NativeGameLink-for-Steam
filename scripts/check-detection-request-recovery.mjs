import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modules = {}, state = { local: async () => null, remote: async () => null, localCalls: 0, remoteCalls: 0 };
const delays = new Map([[1800, 8], [6500, 12], [10000, 60], [180, 1]]);
const timers = new Set();
const schedule = (callback, delay, ...args) => {
  const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, delays.get(delay) ?? delay);
  timers.add(timer); return timer;
};
const cancel = timer => { timers.delete(timer); clearTimeout(timer); };
const paths = {
  detection: 'frontend/features/shortcuts/detection.ts', cache: 'frontend/core/request-cache.ts',
  merger: 'frontend/features/shortcuts/candidate-merger.ts', editions: 'frontend/features/shortcuts/editions.ts',
};
const mocks = {
  getSteamLanguage: async () => 'english', backendLog() {},
  detectGameCandidatesLocalBackend: async () => { state.localCalls++; return state.local(); },
  detectGameCandidatesBackend: async () => { state.remoteCalls++; return state.remote(); },
};
function load(key) {
  if (modules[key]) return modules[key];
  const exports = {}; modules[key] = exports;
  const require = spec => {
    const module = { '../../core/request-cache': 'cache', './candidate-merger': 'merger', './editions': 'editions' }[spec];
    return module ? load(module) : mocks;
  };
  new Function('require', 'exports', 'setTimeout', 'clearTimeout', compile(paths[key]))(require, exports, schedule, cancel);
  return exports;
}
const api = load('detection');
const context = { shortcutAppId: 3000000001, title: 'Fixture Game', exePath: 'C:\\Games\\Fixture Game\\game.exe', startDir: 'C:\\Games\\Fixture Game', launchOptions: '' };
const candidate = { appid: '12345', name: context.title, score: 99, confidence: 'exact', evidence_tier: 'proof' };
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
for (const failure of [() => new Promise(() => {}), async () => ({ candidates: [], transient_error: true }), async () => ({ candidates: [], error: 'local_unavailable' })]) {
  api.clearShortcutDetectionCache(); state.local = failure;
  state.remote = async () => ({ candidates: [], validation_state: 'confirmed' });
  const before = state.localCalls;
  const first = await api.detectShortcutCandidates(context);
  check(first?.transient_error === true && !first.candidates.length, 'An incomplete local phase cannot become a cacheable, confirmed empty result');
  state.local = async () => ({ candidates: [candidate] });
  const recovered = await api.detectShortcutCandidates(context);
  check(state.localCalls === before + 2 && recovered?.candidates[0]?.appid === candidate.appid, 'The real request cache permits recovery on the next identical lookup');
}
api.clearShortcutDetectionCache();
state.local = async () => ({ candidates: [] }); state.remote = async () => ({ candidates: [], validation_state: 'confirmed' });
const before = state.localCalls;
await api.detectShortcutCandidates(context); await api.detectShortcutCandidates(context);
check(state.localCalls === before + 1, 'Only a completed empty lookup may reuse the short-lived cache');
state.local = async () => JSON.stringify(JSON.stringify({ candidates: [candidate] }));
check((await api.detectShortcutCandidatesLocal(context))?.candidates[0]?.appid === candidate.appid, 'Nested IPC JSON retains candidates instead of becoming a successful empty object');

let finish, published = [];
state.local = () => new Promise(resolve => { finish = resolve; });
check(await api.detectShortcutCandidatesLocal(context, { isCurrent: () => true, onLateResult: value => published.push(value) }) === null,
  'A queued local IPC call releases the fast phase within its original budget');
finish({ candidates: [candidate] }); await new Promise(resolve => setTimeout(resolve, 0));
check(published[0]?.candidates[0]?.appid === candidate.appid, 'A queued local result still enriches its active observer after the fast phase');
let current = true; published = [];
await api.detectShortcutCandidatesLocal(context, { isCurrent: () => current, onLateResult: value => published.push(value) });
current = false; finish({ candidates: [candidate] }); await new Promise(resolve => setTimeout(resolve, 0));
check(!published.length, 'A retired context cannot receive late local results');
await api.detectShortcutCandidatesLocal(context, { isCurrent: () => true, onLateResult: value => published.push(value) });
await new Promise(resolve => setTimeout(resolve, 70)); finish({ candidates: [candidate] });
await new Promise(resolve => setTimeout(resolve, 0));
check(!published.length && !timers.size, 'The observer deadline releases UI callbacks and every timer even when IPC hangs');
console.log(`Detection request recovery passed: ${checks} real-cache, incomplete-phase, IPC decoding and bounded-observer assertions.`);
