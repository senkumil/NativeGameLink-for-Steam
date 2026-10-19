import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';

const timers = new Map();
const frames = new Map();
let nextHandle = 0;
const schedule = callback => { const id = ++nextHandle; timers.set(id, callback); return id; };
function loadModule(file, dependencies = {}, globals = {}) {
  const context = vm.createContext({
    exports: {}, console, performance, Element: FakeElement, Node: FakeElement,
    setTimeout: schedule, clearTimeout: id => timers.delete(id), ...globals,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name} in ${file}`);
      return dependencies[name];
    },
  });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}

class FakeTarget {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  fire(type, event = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
class FakeElement extends FakeTarget {
  dataset = {};
  children = [];
  isConnected = true;
  naturalWidth = 0;
  naturalHeight = 0;
  style = { values: new Map(),
    setProperty(name, value) { this.values.set(name, value); },
    getPropertyValue(name) { return this.values.get(name) || ''; },
    removeProperty(name) { this.values.delete(name); } };
  attributes = new Map();
  classes = new Set();
  classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) };
  constructor(doc) { super(); this.ownerDocument = doc; doc?.elements.push(this); }
  get src() { return this.attributes.get('src') || ''; }
  set src(value) { this.attributes.set('src', value); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  insertBefore(child) { this.appendChild(child); }
  remove() {
    this.isConnected = false;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelector(selector) { return this.queries?.[selector] || null; }
  querySelectorAll(selector) { return this.collections?.[selector] || []; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 120, width: 100, height: 120 }; }
}
function documentSurface() {
  const doc = new FakeTarget();
  doc.elements = [];
  doc.images = [];
  doc.observers = [];
  doc.createElement = tag => {
    const element = new FakeElement(doc);
    if (tag === 'img') doc.images.push(element);
    return element;
  };
  doc.body = new FakeElement(doc);
  doc.documentElement = new FakeElement(doc);
  doc.getElementById = id => id === 'gdl-library-injected' ? doc.body : null;
  doc.querySelectorAll = () => [];
  doc.defaultView = Object.assign(new FakeTarget(), {
    innerWidth: 1920, innerHeight: 1080,
    getComputedStyle: element => ({ width: `${element.getBoundingClientRect().width}px` }),
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++nextHandle; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor() { doc.observers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  return doc;
}
const preload = loadModule('frontend/features/library/trading-card-preload.ts');
const doc = documentSurface();
const otherDoc = documentSurface();
const url = n => `https://community.steamstatic.com/card-${n}.jpg`;
for (let i = 0; i < 120; i++) preload.preloadTradingCardImage(doc, url(i));
assert.equal(doc.images.filter(image => image.src).length, 2, 'rapid hovers retain at most two transfers/images');
assert.equal(timers.size, 2, 'eviction also cancels expiry timers');
preload.preloadTradingCardImage(doc, url(119));
assert.equal(doc.images.length, 120, 'duplicate hovers share the same preload');
preload.getTradingCardPreload(doc, url(118));
preload.preloadTradingCardImage(doc, url(120));
assert(preload.getTradingCardPreload(doc, url(118)), 'recently accessed artwork survives eviction');
assert.equal(preload.getTradingCardPreload(doc, url(119)), undefined);
const small = preload.getTradingCardPreload(doc, url(118));
small.naturalWidth = 1920; small.naturalHeight = 1080; small.onload();
const large = preload.getTradingCardPreload(doc, url(120));
large.naturalWidth = 4096; large.naturalHeight = 4096; large.onload();
assert.equal(doc.images.filter(image => image.src).length, 0, 'oversized decoded artwork is not retained');
preload.preloadTradingCardImage(doc, url('failure'));
doc.images.at(-1).onerror();
assert.equal(timers.size, 0, 'failed images release timers and image sources');
preload.preloadTradingCardImage(doc, url('idle'));
for (const callback of [...timers.values()]) callback();
assert.equal(doc.images.at(-1).src, '', 'unused art is released after the idle TTL');
preload.preloadTradingCardImage(doc, url('desktop'));
preload.preloadTradingCardImage(otherDoc, url('other'));
preload.clearTradingCardPreloads(doc);
assert(preload.getTradingCardPreload(otherDoc, url('other')), 'one window cleanup does not evict another realm');
preload.clearTradingCardPreloads(otherDoc);
assert.equal(timers.size, 0);

const disposables = loadModule('frontend/core/disposables.ts');
let catalog;
let section;
let sectionHtml;
let nativePreviewEnabled = false;
let nativePreviewDisposals = 0;
const nativePreviewCalls = [];
const cards = loadModule('frontend/features/library/trading-cards.ts', {
  '../../api/backend': { backendLog() {} },
  '../../core/text': { escapeHtml: value => String(value) },
  '../../core/disposables': disposables,
  '../../steam/css': { ACH_CLASSES: () => ({ HighlightDiv: 'highlight' }), resolveClassModule: (_predicate, fallback) => ({ classes: fallback }) },
  '../../steam/localization': { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback },
  './community-items': { getOfficialCommunityItems: async () => catalog, normalizeCommunityAssetUrl: value => value || '' },
  './constants': { GDL_INJECTED: 'gdl-library-injected' },
  './layout': { buildNativeSidebarSection: (_doc, _layout, options) => { sectionHtml = options.innerHtml; return section; } },
  './trading-card-preload': preload,
  './linked-card-presentation': loadModule('frontend/features/library/linked-card-presentation.ts'),
  './sidebar-order': { getLinkedSidebarOrder: (_doc, layout) => ({
    shortcutAppId: '3000000001', isCurrent: () => true,
    publish: node => { layout.sidebarColumn.appendChild(node); return true; },
  }) },
  './native-card-preview': {
    tryOpenNativeCardPreview: (...args) => { nativePreviewCalls.push(args); return nativePreviewEnabled; },
    disposeNativeCardPreview() { nativePreviewDisposals++; },
  },
});
function cardPanel(doc) {
  const root = new FakeElement(doc);
  const card = new FakeElement(doc);
  const surface = new FakeElement(doc);
  card.queries = { '.gdl-trading-card-surface': surface };
  root.collections = { '.gdl-trading-card': [card] };
  root.appendChild(card); card.appendChild(surface);
  return { root, card, surface };
}
for (let i = 0; i < 100; i++) {
  const { root, card, surface } = cardPanel(doc);
  cards.setupTradingCardTilt(root);
  cards.setupTradingCardTilt(root);
  assert.equal(card.children.length, 2, 'reinitializing does not duplicate hitboxes');
  assert.equal(doc.listenerCount, 3, 'reinitializing does not duplicate document listeners');
  card.dataset.gdlFullImage = url(i);
  card.fire('pointerenter', { clientX: 30, clientY: 30 });
  surface.fire('pointerout', { relatedTarget: null });
  root.remove();
  cards.disposeTradingCardUI(doc);
  assert.equal(doc.listenerCount + doc.defaultView.listenerCount, 0, 'navigation releases global listeners without pointer movement');
  assert.equal(root.listenerCount + card.listenerCount + surface.listenerCount, 0, 'navigation releases element listeners');
  assert.equal(timers.size + frames.size, 0, 'navigation cancels preload, leave timers and animation frames');
  assert.equal(card.dataset.gdlTiltReady, undefined, 'disposed cards can be mounted again');
}
// Prefer the native image viewer without allocating the former overlay.
nativePreviewEnabled = true;
const nativePreviewPanel = cardPanel(doc);
const thumbnail = new FakeElement(doc); thumbnail.src = url('preview-thumbnail');
nativePreviewPanel.card.queries.img = thumbnail;
nativePreviewPanel.card.dataset.gdlFullImage = url('preview-full');
nativePreviewPanel.card.setAttribute('aria-label', 'Card title');
cards.setupTradingCardTilt(nativePreviewPanel.root);
const elementsBeforeNativePreview = doc.elements.length;
const disposalsBeforeNativePreview = nativePreviewDisposals;
nativePreviewPanel.card.fire('click', { preventDefault() {}, stopPropagation() {} });
assert.equal(nativePreviewCalls.length, 1, 'a trading-card click opens the Steam-native viewer once');
assert.equal(nativePreviewCalls[0][0], doc, 'the native viewer uses the clicked card document');
assert.deepEqual(nativePreviewCalls[0].slice(1), [url('preview-full'), 'Card title', url('preview-thumbnail')]);
assert.equal(doc.elements.length, elementsBeforeNativePreview, 'native preview creates no imitation overlay, frame or close buttons');
assert.equal(timers.size + frames.size, 0, 'native preview schedules no custom fade or focus timers');
assert.equal(nativePreviewDisposals, disposalsBeforeNativePreview, 'opening a card leaves replacement and duplicate handling to the native bridge');
cards.disposeTradingCardUI(doc);
assert.equal(nativePreviewDisposals, disposalsBeforeNativePreview + 1, 'navigation disposes the native preview exactly once');
nativePreviewEnabled = false;

// A pending pointer-recovery frame must also be cancelled at teardown.
const recovering = cardPanel(doc);
cards.setupTradingCardTilt(recovering.root);
recovering.card.fire('pointerenter', { clientX: 500, clientY: 500 });
recovering.surface.fire('pointerout', { relatedTarget: null });
for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
assert.equal(frames.size, 1);
cards.disposeTradingCardUI(doc);
assert.equal(frames.size, 0);

const panel = cardPanel(doc);
section = panel.root;
section.queries = { '.gdl-trading-cards-body': new FakeElement(doc), '.gdl-trading-card-grid': new FakeElement(doc) };
catalog = { cards: [{ image: url('thumbnail'), artwork: url('full'), title: 'Card' }], badges: [] };
const imagesBefore = doc.images.length;
await cards.renderOfficialTradingCards(doc, { anchorRegion: new FakeElement(doc), sidebarColumn: new FakeElement(doc) }, {
  steamAppId: '123', shortcutAppId: '3000000001', gameName: 'Game', isCurrent: () => true,
});
assert.equal(doc.images.length, imagesBefore, 'rendering a game never preloads full-size card artwork');
assert(sectionHtml.includes(url('thumbnail')), 'card thumbnails remain visible');
assert.equal(doc.observers.filter(observer => observer.active).length, 1);
cards.disposeTradingCardUI(doc);
assert.equal(doc.observers.filter(observer => observer.active).length, 0, 'rerender cleanup disconnects responsive grid observers');
assert.equal(doc.listenerCount + doc.defaultView.listenerCount + timers.size + frames.size, 0);

const perf = loadModule('frontend/core/perf.ts');
perf.setPerfLogging(false);
for (let i = 0; i < 1000; i++) {
  perf.perfMark('memory-test');
  assert(perf.perfMeasure('memory-test', 'memory-test') >= 0);
}
assert.equal(performance.getEntriesByName('ngl:memory-test', 'mark').length, 1);
assert.equal(performance.getEntriesByName('ngl:memory-test', 'measure').length, 0, 'timing entries do not accumulate on navigation');
performance.clearMarks('ngl:memory-test');

// Invalidation must not keep one tombstone per game forever, including identities
// that were never fetched. Old requests must still remain inert after replacement.
const { RetryingRequestCache } = loadModule('frontend/core/request-cache.ts');
const requests = new RetryingRequestCache({ ttlMs: 60000, retries: 0, maxEntries: 8 });
for (let index = 0; index < 10000; index++) requests.invalidate(`unused-${index}`);
assert.equal(requests.keyEpochs.size, 0, 'invalidating absent identities retains no tombstones');
for (let index = 0; index < 100; index++) await requests.get(String(index), async () => index);
assert.equal(requests.values.size, 8, 'successful requests retain only the configured cache bound');
assert.equal(requests.keyEpochs.size + requests.inFlight.size, 0, 'settled requests release all bookkeeping');
let settleOld, settleNew;
const oldRequest = requests.get('relinked', () => new Promise(resolve => { settleOld = resolve; }));
requests.invalidate('relinked');
const newRequest = requests.get('relinked', () => new Promise(resolve => { settleNew = resolve; }));
settleOld('obsolete');
assert.equal(await oldRequest, null, 'an invalidated original caller cannot observe obsolete metadata');
assert.equal(requests.inFlight.size, 1, 'obsolete completion preserves the replacement request');
settleNew('current');
assert.equal(await newRequest, 'current');
assert.equal(requests.peek('relinked'), 'current');
assert.equal(requests.keyEpochs.size + requests.inFlight.size, 0);
let settleCleared;
const cleared = requests.get('disabled', () => new Promise(resolve => { settleCleared = resolve; }));
requests.clear();
settleCleared('late');
assert.equal(await cleared, null);
assert.equal(requests.keyEpochs.size + requests.inFlight.size + requests.values.size, 0);

let manualLinkRequests = 0;
const manualLink = loadModule('frontend/features/library/manual-link-button.ts', {
  '../../steam/localization': { gdlText: (_key, fallback) => fallback },
  '../../steam/shortcuts': {},
  '../shortcuts/runtime': { requestManualShortcutLink() { manualLinkRequests++; return false; } },
});
function manualLinkSurface() {
  const doc = documentSurface();
  doc.defaultView.MutationObserver = class {
    constructor() { doc.observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  };
  const host = new FakeElement(doc); doc.documentElement.appendChild(host);
  host.closest = () => host;
  let row;
  doc.getElementById = id => id === 'gdl-manual-link-notice-styles' ? {} : row?.id === id && row.isConnected ? row : null;
  return { doc, mount() {
    row = new FakeElement(doc); row.id = 'gdl-manual-link-notice-button-row';
    const button = new FakeElement(doc); row.appendChild(button); host.appendChild(row);
    button.closest = selector => selector === '#gdl-manual-link-notice-button' ? button : null;
    row.queries = { button };
    manualLink.ensureManualLinkNoticeButton(doc, host, '3000000001', 'Game', () => null);
    return button;
  } };
}
const manualSurface = manualLinkSurface();
for (let index = 0; index < 100; index++) {
  const button = manualSurface.mount();
  const event = { target: button, preventDefault() {}, stopPropagation() {} };
  manualSurface.doc.fire('click', event);
  manualSurface.doc.fire('click', event);
  assert.equal(manualSurface.doc.listenerCount, 1);
  assert.equal(timers.size, 1, 'repeated clicks retain only one retry');
  const staleRetry = [...timers.values()][0];
  manualLink.removeManualLinkNoticeButton(manualSurface.doc);
  assert.equal(manualSurface.doc.listenerCount + timers.size, 0, 'notice removal releases delegated clicks and retries');
  assert.equal(manualSurface.doc.observers.filter(observer => observer.active).length, 0);
  const callsBefore = manualLinkRequests;
  staleRetry();
  assert.equal(manualLinkRequests, callsBefore, 'already queued retry cannot reopen the dialog after cleanup');
}

// Both idle-callback and timeout maintenance paths are owned by the plugin.
for (const useIdle of [false, true]) {
  const entries = new Map(), idleJobs = new Map();
  const storage = { get length() { return entries.size; }, key: index => [...entries.keys()][index],
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const globals = { localStorage: storage };
  if (useIdle) Object.assign(globals, {
    requestIdleCallback: callback => { const id = ++nextHandle; idleJobs.set(id, callback); return id; },
    cancelIdleCallback: id => idleJobs.delete(id),
  });
  const persistent = loadModule('frontend/core/cache.ts', {}, globals);
  persistent.cacheSet('metadata', { name: 'Game' });
  const queue = useIdle ? idleJobs : timers;
  assert.equal(queue.size, 1);
  const staleMaintenance = [...queue.values()][0];
  persistent.disposeCacheMaintenance();
  assert.equal(queue.size, 0, 'disposal cancels pending storage maintenance');
  entries.set('gdl_cache_malformed', '{');
  staleMaintenance();
  assert(entries.has('gdl_cache_malformed'), 'a queued obsolete maintenance callback performs no storage writes');
  persistent.cacheSet('current', {});
  assert.equal(queue.size, 1, 'a replacement runtime can schedule maintenance');
  persistent.disposeCacheMaintenance();
}
console.log('Memory runtime checks passed: bounded artwork/requests, 100 navigation and manual-link cleanups, obsolete async isolation, observer/frame disposal and cancelled storage maintenance.');
