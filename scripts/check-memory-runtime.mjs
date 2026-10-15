import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';

const timers = new Map();
const frames = new Map();
let nextHandle = 0;
const schedule = callback => { const id = ++nextHandle; timers.set(id, callback); return id; };
function loadModule(file, dependencies = {}) {
  const context = vm.createContext({
    exports: {}, console, performance, Element: FakeElement, Node: FakeElement,
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
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
  style = { setProperty() {}, removeProperty() {} };
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
  '../../steam/css': { ACH_CLASSES: () => ({ HighlightDiv: 'highlight' }) },
  '../../steam/localization': { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback },
  './community-items': { getOfficialCommunityItems: async () => catalog, normalizeCommunityAssetUrl: value => value || '' },
  './constants': { GDL_INJECTED: 'gdl-library-injected' },
  './layout': { buildNativeSidebarSection: (_doc, _layout, options) => { sectionHtml = options.innerHtml; return section; } },
  './trading-card-preload': preload,
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
console.log('Memory runtime checks passed: bounded artwork, expiry, realm isolation, 100 navigation cleanups, observer/frame disposal and bounded performance entries.');
