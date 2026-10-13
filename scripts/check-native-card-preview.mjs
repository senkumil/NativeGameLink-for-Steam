import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fixtures = new WeakMap();
const timers = new Map();
let nextKey = 1;
let nextTimer = 1;
const setTimer = callback => { const id = nextTimer++; timers.set(id, callback); return id; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function fixture() {
  const shown = new Set(), popupChanged = new Set(), calls = [], pending = [], closed = [];
	const images = [], uncached = new Set();
	const view = { closed: false }, doc = { defaultView: view, createElement(tag) {
		assert.equal(tag, 'img'); const listeners = new Map();
		const image = {
			complete: false, naturalWidth: 0, naturalHeight: 0,
			addEventListener(name, callback) { listeners.set(name, callback); },
			removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
			removeAttribute(name) { assert.equal(name, 'src'); this.src = undefined; },
			finish(valid = true) { this.complete = true; this.naturalWidth = valid ? 1920 : 0; this.naturalHeight = valid ? 1080 : 0; listeners.get(valid ? 'load' : 'error')?.(); },
			listeners,
		}; images.push(image); return image;
	} };
  const subscribe = set => callback => { set.add(callback); return { Unregister: () => set.delete(callback) }; };
  const manager = {
    modals: [], legacy_popup_modals: [],
    RegisterOnModalShownCallback: subscribe(shown),
    LegacyPopupModalCountChangedCallbacks: { Register: subscribe(popupChanged) },
  };
  const open = options => { calls.push(options); const task = deferred(); pending.push(task); return task.promise; };
  const addModel = (url, { legacy = false, owner = view, dispatch = true, additionalFields } = {}) => {
    let ready = false;
    const model = { key: `Modal_${nextKey++}`, element: { props: { artworkURL: url, window: owner, additionalFields, closeModal() {
      assert(ready, 'Native controller is assigned before programmatic close');
      assert(!closed.includes(model.key), 'An owned native modal is never closed twice');
      closed.push(model.key);
      for (const property of ['modals', 'legacy_popup_modals']) {
        const collection = manager[property];
        if (collection instanceof Map) collection.delete(model.key);
        else { const index = collection.indexOf(model); if (index >= 0) collection.splice(index, 1); }
      }
      if (legacy) for (const callback of popupChanged) callback();
    } } } };
    const collection = manager[legacy ? 'legacy_popup_modals' : 'modals'];
    if (collection instanceof Map) collection.set(model.key, model); else collection.push(model);
    if (dispatch) for (const callback of legacy ? popupChanged : shown) callback();
    ready = true;
    return model;
  };
  const complete = (index, options = {}) => {
    const model = options.noModel ? null : addModel(calls[index].strURL, { additionalFields: calls[index].additionalFields, ...options });
    pending[index].resolve(); return model;
  };
  const value = { doc, view, manager, open, calls, pending, closed, shown, popupChanged, addModel, complete, images, uncached };
  fixtures.set(doc, value); return value;
}
const context = vm.createContext({ exports: {}, Promise, setTimeout: setTimer, clearTimeout: id => timers.delete(id), require: dependency => {
  if (dependency === './trading-card-preload') return { getTradingCardPreload: (doc, url) => fixtures.get(doc)?.uncached.has(url) ? undefined : { complete: true, naturalWidth: 1920 } };
  assert.equal(dependency, '../../steam/modules/SteamWebpackRuntime');
  return { steamWebpackRuntime: {
    captureRuntime() {},
    getRequire(doc) {
      const native = fixtures.get(doc);
      return id => id === 94715 ? { N: native?.open } : id === 3673 ? { tx: owner => {
        assert.equal(owner, native.view, 'Native modal manager belongs to the requested CEF realm'); return native.manager;
      } } : null;
    },
  } };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/native-card-preview.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { tryOpenNativeCardPreview: open, disposeNativeCardPreview: dispose } = context.exports;
const URL_A = 'https://community.akamai.steamstatic.com/images/items/1/a.jpg';
const URL_B = 'https://community.akamai.steamstatic.com/images/items/1/b.jpg';
const URL_C = 'https://community.akamai.steamstatic.com/images/items/1/c.jpg';

{
  const f = fixture(), originalOpen = f.open, originalShow = f.manager.RegisterOnModalShownCallback;
  const old = f.addModel(URL_A), unrelated = f.addModel(URL_B), otherWindow = f.addModel(URL_A, { owner: {} });
  assert.equal(open(f.doc, URL_A, 'Card title', URL_B), true);
  assert.equal(f.calls[0].strURL, URL_A); assert.equal(f.calls[0].strTitle, 'Card title'); assert.equal(f.calls[0].windowOverride, f.view);
  assert.equal(open(f.doc, URL_A, 'Card title', URL_B), true); assert.equal(f.calls.length, 1, 'A repeated click deduplicates the pending native render');
  const concurrentForeign = f.addModel(URL_A, { additionalFields: {} });
  const owned = f.complete(0); await flush();
  assert.equal(f.shown.size, 0); assert.equal(f.popupChanged.size, 0, 'Capture callbacks are released after native rendering');
  assert.equal(open(f.doc, URL_A, 'Card title'), true); assert.equal(f.calls.length, 1, 'An already-open owned card is not opened twice');
  dispose(f.doc); dispose(f.doc);
  assert.deepEqual(f.closed, [owned.key], 'Cleanup closes only the newly-created owned modal');
  assert(f.manager.modals.includes(old) && f.manager.modals.includes(unrelated) && f.manager.modals.includes(otherWindow) && f.manager.modals.includes(concurrentForeign), 'Preexisting, concurrent same-URL and other-owner native dialogs remain open');
  assert.equal(f.open, originalOpen); assert.equal(f.manager.RegisterOnModalShownCallback, originalShow, 'Native functions are never patched');
}
{
  const f = fixture(); open(f.doc, URL_A, 'Delayed card', URL_B); dispose(f.doc);
  const owned = f.complete(0); await flush();
  assert.deepEqual(f.closed, [owned.key], 'Navigation before image measurement closes the later-created native dialog');
  assert.equal(f.calls.length, 1, 'Cancelled renders never open fallback artwork');
  assert.equal(f.shown.size + f.popupChanged.size, 0);
}
{
  const f = fixture(); f.manager.legacy_popup_modals = new Map();
  open(f.doc, URL_A, 'Card', URL_B); f.complete(0, { noModel: true }); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].strURL, URL_B, 'A swallowed primary image failure tries the fallback once');
  const owned = f.complete(1, { legacy: true }); await flush(); dispose(f.doc);
  assert.deepEqual(f.closed, [owned.key], 'Native popup models use their own closeModal callback');
}
{
  const f = fixture(); open(f.doc, URL_A, 'Foreign during failure', URL_B);
  const foreign = f.addModel(URL_A, { additionalFields: {} }); f.complete(0, { noModel: true }); await flush();
  assert.equal(f.calls.length, 2, 'A concurrent foreign same-URL dialog does not suppress the owned fallback');
  f.complete(1); await flush(); dispose(f.doc); assert(f.manager.modals.includes(foreign));
}
{
  const f = fixture(); open(f.doc, URL_A, 'Card', URL_B);
  const owned = f.addModel(URL_A, { additionalFields: f.calls[0].additionalFields }); owned.element.props.closeModal();
  f.pending[0].resolve(); await flush();
  assert.equal(f.calls.length, 1, 'A native dialog closed by its user never reopens as fallback');
  dispose(f.doc); assert.deepEqual(f.closed, [owned.key]);
}
{
  const f = fixture(); open(f.doc, URL_A, 'A'); dispose(f.doc);
  open(f.doc, URL_B, 'B'); dispose(f.doc); open(f.doc, URL_C, 'C');
  assert.equal(f.calls.length, 1, 'Only one native image/measurement request can run per document');
  const a = f.complete(0); await flush();
  assert.deepEqual(f.closed, [a.key]); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].strURL, URL_C, 'Only the newest queued card opens after the cancelled native render completes');
  const c = f.complete(1); await flush(); dispose(f.doc); assert.deepEqual(f.closed, [a.key, c.key]);
}
{
  const f = fixture(); open(f.doc, URL_A, 'same'); dispose(f.doc); open(f.doc, URL_A, 'same');
  const first = f.complete(0); await flush(); const second = f.complete(1); await flush();
  assert.deepEqual(f.closed, [first.key], 'An old cancellation cannot capture and close a newer dialog with the same artwork URL');
  assert(f.manager.modals.includes(second)); dispose(f.doc); assert.deepEqual(f.closed, [first.key, second.key]);
}
{
  const f = fixture(); open(f.doc, URL_A, 'Card', URL_B);
  f.complete(0, { noModel: true }); await flush(); f.complete(1, { noModel: true }); await flush();
  assert.equal(f.calls.length, 2, 'Native image failures cannot create an unbounded retry loop'); dispose(f.doc);
  const unavailable = { defaultView: { closed: false } }; assert.equal(open(unavailable, URL_A, 'Missing native API'), false);
  assert.equal(open(f.doc, '', 'Empty image'), false); dispose(unavailable);
}
{
  const a = fixture(), b = fixture(); open(a.doc, URL_A, 'A'); open(b.doc, URL_A, 'B');
  const ma = a.complete(0), mb = b.complete(0); await flush(); dispose(a.doc);
  assert.deepEqual(a.closed, [ma.key]); assert.deepEqual(b.closed, [], 'Same-URL previews in another Steam window remain open');
  dispose(b.doc); assert.deepEqual(b.closed, [mb.key]);
}
{
  const f = fixture(); f.uncached.add(URL_A);
  open(f.doc, URL_A, 'Validated card', URL_B);
  assert.equal(f.calls.length, 0, 'Native measurement never starts before an uncached image is validated');
  assert.equal(f.images.length, 1); assert.equal(timers.size, 1);
  f.images[0].finish(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].strURL, URL_A);
  assert.equal(f.images[0].src, undefined); assert.equal(f.images[0].listeners.size, 0); assert.equal(timers.size, 0, 'Preflight decoded image, listeners and timer are released before native rendering');
  f.complete(0); await flush(); dispose(f.doc);
}
{
  const f = fixture(); open(f.doc, URL_A, 'Token identity');
  const owned = f.complete(0); await flush();
  const foreign = f.addModel(URL_A, { additionalFields: {} });
  foreign.key = owned.key; f.manager.modals.splice(f.manager.modals.indexOf(owned), 1);
  dispose(f.doc); assert.deepEqual(f.closed, [], 'Reused modal keys cannot close a foreign token even with the same URL and window');
}
{
  const f = fixture(); f.uncached.add(URL_A);
  open(f.doc, URL_A, 'Failed primary', URL_B); f.images[0].finish(false); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].strURL, URL_B, 'A failed primary is replaced by its validated fallback before entering native measurement');
  f.complete(0); await flush(); dispose(f.doc);
}
{
  const f = fixture(); f.uncached.add(URL_A); f.uncached.add(URL_B);
  open(f.doc, URL_A, 'Both invalid', URL_B); f.images[0].finish(false); await flush();
  assert.equal(f.images.length, 2); assert.equal(f.calls.length, 0);
  f.images[1].finish(false); await flush(); assert.equal(f.calls.length, 0, 'Neither invalid image reaches Steam native measurement');
  open(f.doc, URL_C, 'After failed images'); assert.equal(f.calls.length, 1, 'Invalid URLs do not block the next card request');
  f.complete(0); await flush(); dispose(f.doc);
}
{
  const f = fixture(); f.uncached.add(URL_A);
  open(f.doc, URL_A, 'Cancelled preflight', URL_B); dispose(f.doc);
  assert.equal(f.images[0].src, undefined); assert.equal(f.images[0].listeners.size, 0); assert.equal(timers.size, 0);
  await flush(); assert.equal(f.calls.length, 0, 'Navigation cancels image validation without ever calling the native viewer');
  open(f.doc, URL_C, 'Next card'); f.complete(0); await flush(); dispose(f.doc);
}
{
  const f = fixture(); f.uncached.add(URL_A);
  open(f.doc, URL_A, 'Timeout card');
  for (const callback of [...timers.values()]) callback(); await flush();
  assert.equal(f.calls.length, 0); assert.equal(f.images[0].src, undefined); assert.equal(timers.size, 0, 'Preflight timeout cleans up and avoids hanging native measurement');
  open(f.doc, URL_B, 'After timeout'); assert.equal(f.calls.length, 1); f.complete(0); await flush(); dispose(f.doc);
}
{
  const f = fixture(); f.uncached.add(URL_A);
  open(f.doc, URL_A, 'A'); open(f.doc, URL_B, 'B'); await flush();
  assert.equal(f.images.length, 1); assert.equal(f.images[0].src, undefined); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].strURL, URL_B, 'A newer card cancels the only pending preflight image');
  f.complete(0); await flush(); dispose(f.doc);
}
console.log('Native card preview: actual Steam model schema, native ownership, popup/inline cleanup, delayed cancellation, fallback, bounded serialization and CEF realm isolation passed.');
