import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

let assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const truthy = (actual, message) => { assertions++; assert.ok(actual, message); };
const classModules = [
  { Container: '_2-O4ZG0KrnSrzISHBKctFQ', GameListEntryContainer: '_1vO6BoiVslZgs1kqDGdUs8', GameListEntryName: '_2SXJM0PeFEi3gbC7V3S5pE', GameIcon: 'ga1hyw11cdBVodrCAidPF' },
  { Container: '_3x1HklzyDs4TEjACrRO2tB', GameListHomeAndSearch: '_2TKEazUUS3TlniZfpc8OOe', CollectionsButton: '_2CEKFex6JMsAse2lqMMjUp' },
];

class Target {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type).set(callback, options);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event = {}) {
    for (const callback of [...(this.listeners.get(type)?.keys() || [])]) callback({ type, ...event });
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
class Element extends Target {
  nodeType = 1;
  isConnected = true;
  classList = { contains: token => this.className.split(/\s+/).includes(token) };
  constructor(className = '', parentElement = null) { super(); this.className = className; this.parentElement = parentElement; }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (selector.split(',').some(part => {
        const contains = part.trim().match(/^\[class\*="([^"]+)"\]$/);
        return contains && element.className.includes(contains[1]);
      })) return element;
    }
    return null;
  }
}
function createClock() {
  let time = 1000, next = 0;
  const timers = new Map();
  const setTimeout = (callback, delay = 0) => {
    const id = ++next; timers.set(id, { callback, due: time + Number(delay) }); return id;
  };
  const clearTimeout = id => timers.delete(id);
  const tick = elapsed => {
    const end = time + elapsed;
    for (;;) {
      const due = [...timers].filter(([, entry]) => entry.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!due) break;
      time = due[1].due; timers.delete(due[0]); due[1].callback();
    }
    time = end;
  };
  return { timers, setTimeout, clearTimeout, tick, now: () => time };
}
function createDocument(clock) {
  let next = 0;
  const frames = new Map();
  const view = Object.assign(new Target(), {
    closed: false, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    performance: { now: clock.now },
    requestAnimationFrame: callback => { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const doc = Object.assign(new Target(), { nodeType: 9, hidden: false, defaultView: view,
    querySelector: () => { throw new Error('Interaction tracking must not scan the document'); },
    querySelectorAll: () => { throw new Error('Interaction tracking must not scan virtual library rows'); },
  });
  const body = new Element(); body.ownerDocument = doc;
  const sidebar = new Element(classModules[1].Container, body);
  const row = new Element(classModules[0].Container, sidebar);
  const icon = new Element(classModules[0].GameIcon, row);
  const details = new Element('_nativeDetails', body);
  const detachedRow = new Element(classModules[0].GameListEntryContainer);
  const detachedText = { nodeType: 3, parentElement: detachedRow };
  doc.body = body; doc.documentElement = body;
  for (const element of [sidebar, row, icon, details, detachedRow]) element.ownerDocument = doc;
  doc.frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(clock.now())); };
  const fire = (type, target = icon) => doc.fire(type, { target });
  // Runtime capture owns its own unload listener. Take that existing baseline
  // before installing interaction so teardown must restore the exact callbacks.
  webpackRuntime.captureRuntime(doc);
  return { doc, view, sidebar, row, icon, details, detachedRow, detachedText, frames, fire,
    listenersBefore: [listenerSnapshot(doc), listenerSnapshot(view)] };
}
function listenerSnapshot(target) {
  return [...target.listeners].flatMap(([type, callbacks]) => [...callbacks.keys()].map(callback => [type, callback]));
}
function listenersRestored(scope, message) {
  assertions++;
  assert.deepEqual([listenerSnapshot(scope.doc), listenerSnapshot(scope.view)], scope.listenersBefore, message);
}
function loadModules(clock) {
  const cache = new Map();
  class FakeDate extends Date { static now() { return clock.now(); } }
  function load(filename) {
    const absolute = path.resolve(filename);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {}; cache.set(absolute, exports);
    const context = vm.createContext({ exports, console, Date: FakeDate, performance: { now: clock.now },
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Element, HTMLElement: Element,
      require: request => {
        if (request === '@steambrew/client') return { modules: new Map(classModules.map((exports, id) => [String(id), exports])) };
        if (!request.startsWith('.')) throw new Error(`Unexpected dependency ${request} in ${filename}`);
        const resolved = path.resolve(path.dirname(absolute), request);
        if (resolved === path.resolve('frontend/api/backend')) return { backendLog() {} };
        return load(fs.existsSync(resolved) ? resolved : `${resolved}.ts`);
      },
    });
    vm.runInContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context, { filename: absolute });
    return exports;
  }
  return { interaction: load('frontend/steam/sidebar-interaction.ts'),
    sidebar: load('frontend/steam/library-sidebar.ts'), paint: load('frontend/core/after-native-paint.ts'),
    webpackRuntime: load('frontend/steam/modules/SteamWebpackRuntime.ts').steamWebpackRuntime };
}
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const clock = createClock();
const { interaction, sidebar, paint, webpackRuntime } = loadModules(clock);
const { installLibrarySidebarInteraction: install, runWhenLibrarySidebarIdle: idle, cancelLibrarySidebarWork: cancel } = interaction;
const scope = createDocument(clock);
const dispose = install(scope.doc);
for (const event of ['wheel', 'scroll', 'touchmove']) {
  const registrations = [...(scope.doc.listeners.get(event)?.values() || [])];
  truthy(registrations.some(options => options === true || options?.capture === true), `${event} is captured before non-bubbling native list signals are lost`);
}
let calls = 0;
const selectedAt = clock.now();
let selectionCallbackAt;
await idle(scope.doc, 'metadata', () => { calls++; selectionCallbackAt = clock.now(); });
equal(calls, 1, 'a selection with no list interaction starts useful work immediately');
equal(selectionCallbackAt, selectedAt, 'selecting a shortcut without scrolling never waits 180 ms or two seconds');
equal(clock.timers.size, 0, 'an idle selection does not create polling or a fixed navigation delay');
equal(sidebar.isLibrarySidebarNode(scope.icon), true, 'production hashed classes identify native icons');
equal(sidebar.isLibrarySidebarNode(scope.detachedText), true, 'a virtualized detached row keeps its native identity');
equal(sidebar.isLibrarySidebarNode(scope.details), false, 'the main details pane is not a library sidebar');

for (const event of ['wheel', 'scroll', 'touchmove']) {
  scope.fire(event);
  let executed = 0;
  const pending = idle(scope.doc, `event:${event}`, () => { executed++; });
  clock.tick(179); await flush();
  equal(executed, 0, `${event} leaves the native virtual list alone throughout the quiet interval`);
  clock.tick(1); await pending;
  equal(executed, 1, `${event} releases one job after 180 ms of quiet`);
}
scope.fire('wheel');
let sharedLatest = 0;
const sharedOriginal = idle(scope.doc, 'shared', () => { throw new Error('superseded callback'); });
const sharedUpdated = idle(scope.doc, 'shared', () => { sharedLatest++; });
equal(sharedOriginal, sharedUpdated, 'a resource burst retains one shared promise, without accumulating resolver arrays');
clock.tick(180); await sharedOriginal;
equal(sharedLatest, 1, 'the shared promise executes only its final callback');
for (const event of ['wheel', 'scroll', 'touchmove', 'pointerover', 'focusin']) {
  scope.fire(event, scope.details);
  await idle(scope.doc, `details:${event}`, () => { calls++; });
}
equal(calls, 6, 'details scrolling and focus do not postpone metadata');
equal(clock.timers.size, 0, 'unrelated details events create no sidebar timer');

scope.fire('wheel');
const rapid = [];
let lastCommitted = -1, commits = 0, resolutions = 0;
for (let index = 0; index < 100; index++) {
  rapid.push(idle(scope.doc, 'metadata', () => { commits++; lastCommitted = index; }).then(() => { resolutions++; }));
  clock.tick(5);
  scope.fire('scroll', index % 2 ? scope.detachedText : scope.icon);
}
await flush();
equal(commits, 0, '100 continuous native row scroll events never execute a queued metadata commit');
equal(resolutions, 0, 'coalesced callers remain pending until the latest job finishes');
equal(clock.timers.size, 1, 'continuous scrolling uses one quiet timer, without polling or accumulating timers');
clock.tick(179); await flush();
equal(commits, 0, 'the last scroll, rather than the first, owns the quiet deadline');
clock.tick(1); await Promise.all(rapid);
equal(commits, 1, 'a burst of requests commits only once');
equal(lastCommitted, 99, 'the final selection callback replaces earlier work under the same resource key');
equal(resolutions, 100, 'every replaced caller is settled after the surviving callback');

scope.fire('wheel');
let old = 0, current = 0, separate = 0;
const stale = idle(scope.doc, 'metadata', () => { old++; });
cancel(scope.doc, 'metadata');
await stale;
const fresh = idle(scope.doc, 'metadata', () => { current++; });
const otherResource = idle(scope.doc, 'controller-info', () => { separate++; });
clock.tick(180); await Promise.all([fresh, otherResource]);
equal(old, 0, 'navigation cancellation prevents obsolete route work');
equal(current, 1, 'the next route still receives its own metadata');
equal(separate, 1, 'independent resources do not erase each other');
cancel(scope.doc, 'missing-key');

scope.fire('wheel');
let resolveNetwork, networkFinished = false, sameKeyNew = 0;
const network = idle(scope.doc, 'network', () => new Promise(resolve => { resolveNetwork = resolve; })).then(() => { networkFinished = true; });
clock.tick(180); await flush();
equal(typeof resolveNetwork, 'function', 'asynchronous work begins at the idle boundary');
await idle(scope.doc, 'network', () => { sameKeyNew++; });
equal(sameKeyNew, 1, 'a running request does not block a later useful callback under its old key');
equal(networkFinished, false, 'the first request promise still tracks its actual completion');
resolveNetwork(); await network;

const independent = createDocument(clock), independentDispose = install(independent.doc);
scope.fire('wheel');
let blockedDocument = 0, independentCalls = 0;
const blocked = idle(scope.doc, 'metadata', () => { blockedDocument++; });
await idle(independent.doc, 'metadata', () => { independentCalls++; });
equal(independentCalls, 1, 'one Steam document can stay idle while another is scrolling');
equal(blockedDocument, 0, 'scrolling state remains local to its document');
clock.tick(180); await blocked;
independentDispose();

const temporarilyHidden = createDocument(clock);
const hiddenDispose = install(temporarilyHidden.doc);
temporarilyHidden.fire('wheel');
let hiddenCommits = 0;
const hiddenPending = idle(temporarilyHidden.doc, 'metadata', () => { hiddenCommits++; });
temporarilyHidden.doc.hidden = true;
clock.tick(180); await hiddenPending;
equal(hiddenCommits, 0, 'a document hidden during the quiet interval cannot commit deferred content');
equal(clock.timers.size, 0, 'hiding a document settles queued work without polling for visibility');
temporarilyHidden.doc.hidden = false;
await idle(temporarilyHidden.doc, 'metadata', () => { hiddenCommits++; });
equal(hiddenCommits, 1, 'a visible document can run fresh metadata immediately after cancellation');
hiddenDispose();

for (const stateChange of ['closed', 'replaced-document', 'replaced-view']) {
  const disappearing = createDocument(clock);
  const disappearingDispose = install(disappearing.doc);
  disappearing.fire('wheel');
  let obsolete = 0;
  const scheduled = idle(disappearing.doc, 'metadata', () => { obsolete++; });
  if (stateChange === 'closed') disappearing.view.closed = true;
  if (stateChange === 'replaced-document') disappearing.view.document = {};
  if (stateChange === 'replaced-view') disappearing.doc.defaultView = {};
  clock.tick(180); await scheduled;
  equal(obsolete, 0, `${stateChange} cancels queued callbacks before they reach an obsolete Steam document`);
  listenersRestored(disappearing, `${stateChange} releases interaction listeners`);
  disappearingDispose();
}

scope.fire('wheel');
let boundedExecutions = 0, boundedResolutions = 0;
const bounded = Array.from({ length: 30 }, (_, index) => idle(scope.doc, `bounded:${index}`, () => { boundedExecutions++; }).then(() => { boundedResolutions++; }));
await flush();
truthy(boundedResolutions >= 14, 'at least 14 overflow waiters settle before the queue exceeds 16 resource keys');
equal(boundedExecutions, 0, 'resource overflow never executes metadata during a native scroll');
clock.tick(180); await Promise.all(bounded);
truthy(boundedExecutions <= 16, 'at most 16 pending resource callbacks survive');
equal(boundedResolutions, 30, 'bounded queue eviction never strands a promise');

const queue = new paint.NativePaintQueue();
const quietSelectionAt = clock.now();
let quietPaintAt;
const quietPaintPending = idle(scope.doc, 'selection', () => queue.run(scope.doc, 'shortcut:3000000000', () =>
  idle(scope.doc, 'metadata', () => { quietPaintAt = clock.now(); })));
scope.doc.frame(); scope.doc.frame(); clock.tick(0); await quietPaintPending;
equal(quietPaintAt, quietSelectionAt, 'selection without a scroll adds no quiet timer after the native paint opportunity');
let paintCommit = 0;
const paintPending = idle(scope.doc, 'selection', () => queue.run(scope.doc, 'shortcut:3000000001', () =>
  idle(scope.doc, 'metadata', () => { paintCommit++; })));
scope.doc.frame();
scope.fire('wheel');
scope.doc.frame(); clock.tick(0); await flush();
equal(paintCommit, 0, 'scrolling between the two native RAFs blocks the deferred metadata commit');
clock.tick(179); await flush();
equal(paintCommit, 0, 'the callback rechecks sidebar interaction at execution time');
clock.tick(1); await paintPending;
equal(paintCommit, 1, 'metadata resumes once native sidebar recycling is quiet');
queue.dispose();

scope.fire('wheel');
const failed = idle(scope.doc, 'error', () => { throw new Error('expected callback failure'); });
const checkedFailure = assert.rejects(failed, /expected callback failure/);
clock.tick(180); await checkedFailure;
assertions++;
await idle(scope.doc, 'after-error', () => { calls++; });
equal(calls, 7, 'a failed resource does not poison later work');

scope.fire('wheel');
let afterDispose = 0;
const discarded = idle(scope.doc, 'dispose', () => { afterDispose++; });
dispose(); await discarded;
equal(clock.timers.size, 0, 'disposal removes the quiet timer');
listenersRestored(scope, 'disposal removes document and window event listeners');
clock.tick(1000); await flush();
equal(afterDispose, 0, 'disposed callbacks never mutate a detached Steam document');
dispose();

const primaryA = createDocument(clock), primaryB = createDocument(clock);
primaryA.view.document = primaryA.doc; primaryB.view.document = primaryB.doc;
const disposeA = interaction.installLibrarySidebarInteraction(primaryA.doc, true);
const disposeB = interaction.installLibrarySidebarInteraction(primaryB.doc, true);
equal(interaction.findLibrarySidebarDocument(primaryA.view), primaryA.doc, 'A service resolves its exact adopted desktop document');
equal(interaction.findLibrarySidebarDocument({ parent: primaryB.view }), primaryB.doc, 'A Millennium child frame resolves the desktop that owns its list');
equal(interaction.findLibrarySidebarDocument(), null, 'Multiple visible desktops are not guessed');
primaryB.doc.hidden = true;
equal(interaction.findLibrarySidebarDocument(), primaryA.doc, 'A background service can resolve the unique visible desktop');
primaryA.fire('wheel');
equal(interaction.isLibrarySidebarInteractionActive(primaryA.doc), true, 'Store publishers can query active interaction without scanning');
clock.tick(180);
equal(interaction.isLibrarySidebarInteractionActive(primaryA.doc), false, 'The active query retires with the real quiet period');
disposeA();
equal(interaction.findLibrarySidebarDocument(primaryA.view), null, 'Disposed primary documents cannot be retained by the service registry');
primaryB.doc.hidden = false; primaryB.view.closed = true;
equal(interaction.findLibrarySidebarDocument(), null, 'Closed desktops are removed from the bounded registry');
disposeB();

console.log(`Sidebar interaction checks passed: ${assertions} assertions covering native hashed rows, immediate-scroll navigation, latest callbacks, bounded queues, cancellation, independent documents and RAF execution rechecks.`);
