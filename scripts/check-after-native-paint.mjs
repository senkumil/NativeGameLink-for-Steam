import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const context = vm.createContext({ exports: {}, setTimeout, clearTimeout, Promise });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/core/after-native-paint.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { NativePaintQueue } = context.exports;
function createDocument(withRaf = true) {
  const frames = new Map();
  const timers = new Map();
  let nextId = 0;
  const view = {
    closed: false,
    requestAnimationFrame: withRaf ? callback => { const id = ++nextId; frames.set(id, callback); return id; } : undefined,
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const doc = { hidden: false, defaultView: view, frames, timers };
  doc.frame = () => { const batch = Array.from(frames.values()); frames.clear(); for (const callback of batch) callback(); };
  doc.tasks = () => { const batch = Array.from(timers.values()); timers.clear(); for (const { callback } of batch) callback(); };
  doc.paintThenTask = () => { doc.frame(); doc.frame(); doc.tasks(); };
  return doc;
}

const queue = new NativePaintQueue();
const doc = createDocument();
let executions = 0;
const original = queue.run(doc, 'route:1', () => { executions++; });
assert.equal(queue.run(doc, 'route:1', () => { throw new Error('duplicate callback'); }), original, 'pending duplicate callers share one exact promise');
await Promise.resolve();
assert.equal(executions, 0, 'scheduling never starts work in a promise continuation');
doc.frame();
await Promise.resolve();
assert.equal(executions, 0, 'the first native RAF contains no heavy callback');
assert.equal(doc.timers.size, 0, 'the first native frame can paint before task scheduling');
doc.frame();
await Promise.resolve();
assert.equal(executions, 0, 'the second RAF only schedules a macro task');
assert.equal(doc.timers.size, 1);
assert.equal(Array.from(doc.timers.values())[0].delay, 0);
doc.tasks();
await original;
assert.equal(executions, 1, 'coalesced work executes exactly once after the native paint opportunity');

for (const stage of [0, 1, 2]) {
  const supersededDoc = createDocument();
  let oldExecutions = 0;
  let currentExecutions = 0;
  const old = queue.run(supersededDoc, 'old', () => { oldExecutions++; });
  for (let i = 0; i < stage; i++) supersededDoc.frame();
  const current = queue.run(supersededDoc, 'current', () => { currentExecutions++; });
  await old;
  supersededDoc.paintThenTask();
  await current;
  assert.equal(oldExecutions, 0, `navigation cancels pending work at RAF/timer stage ${stage}`);
  assert.equal(currentExecutions, 1);
}

const networkDoc = createDocument();
let resolveNetwork;
let freshExecutions = 0;
const network = queue.run(networkDoc, 'same-route', () => new Promise(resolve => { resolveNetwork = resolve; }));
networkDoc.paintThenTask();
assert.equal(typeof resolveNetwork, 'function');
const retry = queue.run(networkDoc, 'same-route', () => { freshExecutions++; });
assert.notEqual(retry, network, 'a running request is removed from pending deduplication before awaiting its result');
networkDoc.paintThenTask();
await retry;
assert.equal(freshExecutions, 1, 'a layout retry does not wait for an earlier network request');
resolveNetwork();
await network;

const firstDoc = createDocument();
const otherDoc = createDocument();
let cancelledExecutions = 0;
let otherExecutions = 0;
const cancelled = queue.run(firstDoc, 'same', () => { cancelledExecutions++; });
const other = queue.run(otherDoc, 'same', () => { otherExecutions++; });
queue.cancel(firstDoc);
await cancelled;
firstDoc.paintThenTask(); otherDoc.paintThenTask();
await other;
assert.equal(cancelledExecutions, 0, 'cancelling a document removes its callbacks');
assert.equal(otherExecutions, 1, 'document queues remain independent');

const hiddenDoc = createDocument(); hiddenDoc.hidden = true;
await queue.run(hiddenDoc, 'hidden', () => { throw new Error('hidden work'); });
assert.equal(hiddenDoc.frames.size + hiddenDoc.timers.size, 0, 'hidden documents never schedule heavy work');
hiddenDoc.hidden = false;
let hiddenExecutions = 0;
const hiddenBeforeTask = queue.run(hiddenDoc, 'visible-then-hidden', () => { hiddenExecutions++; });
hiddenDoc.frame(); hiddenDoc.frame(); hiddenDoc.hidden = true; hiddenDoc.tasks();
await hiddenBeforeTask;
assert.equal(hiddenExecutions, 0, 'a document becoming hidden before task execution is skipped');
const closedDoc = createDocument(); closedDoc.defaultView.closed = true;
await queue.run(closedDoc, 'closed', () => { throw new Error('closed work'); });
assert.equal(closedDoc.frames.size + closedDoc.timers.size, 0);

const fallbackDoc = createDocument(false);
let fallbackExecutions = 0;
const fallback = queue.run(fallbackDoc, 'fallback', () => { fallbackExecutions++; });
assert.equal(fallbackExecutions, 0);
assert.equal(Array.from(fallbackDoc.timers.values())[0].delay, 16, 'without RAF the queue yields for one frame duration');
fallbackDoc.tasks();
await fallback;
assert.equal(fallbackExecutions, 1);

const errorDoc = createDocument();
const error = queue.run(errorDoc, 'error', () => { throw new Error('task failed'); });
const checkedError = assert.rejects(error, /task failed/);
errorDoc.paintThenTask(); await checkedError;

const disposeDoc = createDocument();
const disposeOther = createDocument();
const pendingDispose = queue.run(disposeDoc, 'dispose', () => { throw new Error('disposed work'); });
const pendingOther = queue.run(disposeOther, 'dispose', () => { throw new Error('disposed other work'); });
disposeDoc.frame(); disposeOther.frame(); disposeOther.frame();
queue.dispose();
await Promise.all([pendingDispose, pendingOther]);
assert.equal(disposeDoc.frames.size + disposeDoc.timers.size + disposeOther.frames.size + disposeOther.timers.size, 0, 'disposing cancels every pending RAF and timer');
await queue.run(disposeDoc, 'after-dispose', () => { throw new Error('work after dispose'); });
console.log('After-native-paint checks passed: double RAF plus macro task, pending-only coalescing, navigation cancellation, nonblocking layout retries, document isolation, hidden/closed skipping, timer fallback and disposal.');
