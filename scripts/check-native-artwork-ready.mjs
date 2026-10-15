import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let assertions = 0;
const check = (value, message) => { assertions++; assert(value, message); };
const selectors = { header: 'header', loaded: 'loaded', hero: 'hero', logo: 'logo' };
class EventTarget {
  listeners = new Map();
  addEventListener(type, callback) { let list = this.listeners.get(type); if (!list) this.listeners.set(type, list = new Set()); list.add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { for (const callback of [...this.listeners.get(type) || []]) callback({ type, target: this }); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, list) => sum + list.size, 0); }
}
class Element extends EventTarget {
  nodeType = 1; children = []; parentElement = null; nativeLoaded = false; owned = false; isConnected = true;
  constructor(kind, appid = null) { super(); this.kind = kind; this.appid = appid; }
  append(child) { child.parentElement = this; child.isConnected = this.isConnected; this.children.push(child); return child; }
  remove(child) { this.children.splice(this.children.indexOf(child), 1); child.isConnected = false; child.parentElement = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) { return selector === 'loaded' ? this.nativeLoaded : selector === this.kind; }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (selector === '[id^="gdl-"]' ? current.owned : current.matches(selector)) return current; return null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const context = vm.createContext({ exports: {}, Array, Map, Number, Image: class { constructor() { throw new Error('No image preloads'); } }, fetch() { throw new Error('No network requests'); }, require(name) {
  if (name === '../../steam/library-details') return { committedHeaderAppId: element => element.appid };
  if (name === '../../steam/library-header') return { findNativeLibraryHeader: doc => doc.body.querySelector('header'), getNativeLibraryArtworkSelectors: () => selectors };
  if (name === './native-route') return { routedSteamAppId: doc => doc.routeId };
  throw new Error(`Unexpected dependency ${name}`);
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/native-artwork-ready.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { waitForNativeArtwork } = context.exports;
function fixture({ hasHeader = true, loaded = false, hero = true, logo = true, imageLoaded = false, notifyShell = false } = {}) {
  const observers = [], timers = new Map(); let nextTimer = 0;
  class Observer {
    targets = [];
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; }
    records(records = []) { if (this.targets.length) this.callback(records); }
  }
  const view = new EventTarget(); Object.assign(view, { closed: false, MutationObserver: Observer, setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  const doc = new EventTarget(); Object.assign(doc, { hidden: false, defaultView: view, body: new Element('body'), routeId: 3300000001, querySelectorAll(selector) { return this.body.querySelectorAll(selector); } });
  const header = new Element('header', doc.routeId); header.nativeLoaded = loaded;
  if (hasHeader) doc.body.append(header); else header.isConnected = false;
  const image = kind => { const img = new Element(kind); img.complete = imageLoaded; img.naturalWidth = imageLoaded ? 1920 : 0; return header.append(img); };
  const heroImage = hero ? image('hero') : null, logoImage = logo ? image('logo') : null;
  const effects = [];
  const shellEffects = [];
  const dispose = waitForNativeArtwork(doc, () => effects.push('ready'), notifyShell ? () => shellEffects.push(doc.routeId) : undefined);
  const fireTimeout = () => { const first = [...timers.values()][0]; timers.clear(); first?.callback(); };
  const scoped = () => observers[0]; const mount = () => observers[1];
  const cleaned = () => {
    check(!timers.size, 'No timer remains');
    check(observers.every(observer => !observer.targets.length), 'All observer targets are released');
    check(!doc.listenerCount() && !view.listenerCount() && !header.listenerCount(), 'All event listeners are released');
  };
  return { doc, view, header, heroImage, logoImage, effects, shellEffects, observers, timers, dispose, fireTimeout, scoped, mount, cleaned };
}
const load = image => { image.complete = true; image.naturalWidth = 1920; };

{
  const f = fixture({ notifyShell: true });
  check(f.shellEffects.length === 1 && !f.effects.length, 'The committed native shell can publish light columns while heavy artwork work stays pending');
  f.scoped().records([{ type: 'attributes', target: f.heroImage }]);
  check(f.shellEffects.length === 2 && !f.effects.length, 'Split native image commits reuse the scoped shell callback without waiting for decoded pixels');
  f.doc.routeId = 3300000002; f.header.emit('load');
  check(f.shellEffects.length === 2 && !f.effects.length, 'A retired native shell callback cannot publish into another destination');
  f.cleaned();
}

{
  const f = fixture({ loaded: true, imageLoaded: true });
  check(f.effects.length === 1, 'Warm native art is ready synchronously, with no fixed wait');
  f.cleaned(); f.dispose(); check(f.effects.length === 1, 'Disposal is idempotent after synchronous readiness');
}
{
  const f = fixture();
  check(!f.effects.length, 'Pending hero and logo yield before plugin work');
  check(f.scoped().targets[0].target === f.header, 'Image and class observation is scoped to the native header');
  check(f.mount().targets.every(({ options }) => !options.subtree), 'Mounted header does not keep a whole-page subtree observer');
  load(f.heroImage); f.header.emit('load');
  check(!f.effects.length, 'Hero load alone does not skip Steam HeaderLoaded or a pending logo');
  f.header.nativeLoaded = true; f.scoped().records();
  check(!f.effects.length, 'A mounted pending logo still gets priority after the hero');
  load(f.logoImage); f.header.emit('load');
  check(f.effects.length === 1, 'Native hero, HeaderLoaded and logo release work immediately');
  f.cleaned();
}
{
  const f = fixture({ loaded: true, imageLoaded: true });
  check(f.effects.length === 1, 'Cached same-game reopen is not artificially delayed'); f.cleaned();
}
{
  const f = fixture({ loaded: true, logo: false });
  f.heroImage.complete = true; f.heroImage.naturalWidth = 0; f.header.emit('error');
  check(!f.effects.length, 'A failed first hero candidate does not count as loaded');
  f.heroImage.complete = false; f.scoped().records([{ type: 'attributes', target: f.heroImage }]);
  check(!f.effects.length, 'Steam may begin its PNG fallback without plugin interruption');
  load(f.heroImage); f.header.emit('load');
  check(f.effects.length === 1, 'Successful native fallback releases the wait'); f.cleaned();
}
{
  const f = fixture({ loaded: true, hero: false, logo: false });
  check(f.effects.length === 1, 'Steam-confirmed no-art header has no artificial delay'); f.cleaned();
}
{
  const f = fixture({ hasHeader: false });
  check(f.mount().targets[0].target === f.doc.body && f.mount().targets[0].options.subtree, 'Before mount, bounded discovery listens for a native header');
  f.doc.body.append(f.header); f.header.nativeLoaded = true; load(f.heroImage); load(f.logoImage);
  f.mount().records([{ target: f.doc.body, addedNodes: [f.header], removedNodes: [] }]);
  check(f.effects.length === 1, 'A later native mount is recognized immediately'); f.cleaned();
}
{
  const f = fixture({ loaded: true, imageLoaded: false });
  const previous = f.header; previous.appid = 3300000002;
  load(f.heroImage); load(f.logoImage); previous.emit('load');
  check(!f.effects.length, 'A stale header is never authorized by another game’s loaded images');
  const current = new Element('header', f.doc.routeId); current.nativeLoaded = true;
  for (const kind of ['hero', 'logo']) { const img = new Element(kind); load(img); current.append(img); }
  f.doc.body.append(current);
  f.mount().records([{ target: f.doc.body, addedNodes: [current], removedNodes: [] }]);
  check(f.effects.length === 1, 'Current header is found even when an old header remains first in DOM'); f.cleaned();
}
{
  const f = fixture();
  const old = f.header; f.doc.body.remove(old);
  const current = new Element('header', f.doc.routeId); current.nativeLoaded = true; const img = new Element('hero'); load(img); current.append(img); f.doc.body.append(current);
  f.mount().records([{ target: f.doc.body, addedNodes: [current], removedNodes: [old] }]);
  check(f.effects.length === 1, 'Replacing a pending header follows its new native node'); f.cleaned();
}
{
  const f = fixture({ hasHeader: false });
  const sidebar = f.doc.body.append(new Element('sidebar'));
  const before = f.mount().targets[0]; f.mount().records([{ target: sidebar, addedNodes: [new Element('row')], removedNodes: [] }]);
  check(!f.effects.length && f.mount().targets[0] === before, 'Unrelated sidebar mounts do not rescan/rebind readiness');
  check([...f.timers.values()][0].delay === 1500, 'Unknown layouts have one finite 1500 ms fallback');
  f.fireTimeout(); check(f.effects.length === 1, 'Unknown/no-art layout cannot starve the plugin'); f.cleaned();
}
for (const condition of ['dispose', 'hide', 'route', 'close', 'pagehide']) {
  const f = fixture();
  if (condition === 'dispose') f.dispose();
  if (condition === 'hide') { f.doc.hidden = true; f.doc.emit('visibilitychange'); }
  if (condition === 'route') { f.doc.routeId++; f.view.emit('popstate'); }
  if (condition === 'close') { f.view.closed = true; f.scoped().records(); }
  if (condition === 'pagehide') f.view.emit('pagehide');
  f.fireTimeout(); load(f.heroImage); load(f.logoImage); f.header.nativeLoaded = true; f.header.emit('load');
  check(!f.effects.length, `${condition} cannot run stale work`); f.cleaned();
}
for (const condition of ['hidden', 'closed']) {
  const f = fixture(); f.dispose();
  if (condition === 'hidden') f.doc.hidden = true;
  if (condition === 'closed') f.view.closed = true;
  waitForNativeArtwork(f.doc, () => { throw new Error(`Unexpected readiness for ${condition}`); });
  f.cleaned();
}
{
  const f = fixture(); f.dispose(); f.doc.routeId = null;
  let continued = 0; waitForNativeArtwork(f.doc, () => { continued++; });
  check(continued === 1, 'Visible Home/non-library surfaces continue immediately without a routed AppID'); f.cleaned();
}
check(!/new\s+(?:Image|[^\s;]+\.Image)\s*\(|\bfetch\s*\(|\.decode\s*\(|\.src\s*=|\.style\.|\.appendChild\s*\(|\.setAttribute\s*\(/.test(fs.readFileSync('frontend/features/library/native-artwork-ready.ts', 'utf8')), 'Helper creates no image, request, decode, native DOM write or image cache');
console.log(`Native artwork readiness checks passed: ${assertions} assertions; warm/cold loads, Steam visibility signal, native fallback, late/replaced/stale headers, bounded discovery, no-art fallback and complete disposal.`);
