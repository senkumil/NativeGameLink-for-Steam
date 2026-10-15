// Local integration check against the installed Steam client. No Steam UI or IPC is invoked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const steamUi = process.env.STEAM_UI_DIR || 'C:/Program Files (x86)/Steam/steamui';
const chunkPath = path.join(steamUi, 'chunk~2dcc5aaf7.js');
const cssPath = process.env.STEAM_PLAYBAR_CSS || ['css/sp.css', 'css/chunk~2dcc5aaf7.css']
  .map(filename => path.join(steamUi, filename)).find(filename => fs.existsSync(filename));
assert.ok(fs.existsSync(chunkPath), `Installed Steam library chunk is required: ${chunkPath}`);
const chunk = fs.readFileSync(chunkPath, 'utf8');
let assertions = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions++; };
const ok = (value, message) => { assert.ok(value, message); assertions++; };

// These installed factories contain ordinary strings/comments and no regex or
// interpolated template literals. Balance their bodies without evaluating the chunk.
function extractFactory(id) {
  const match = new RegExp(`(?:^|[,{])${id}:`).exec(chunk);
  assert.ok(match, `Installed Steam module ${id} was not found`);
  const start = match.index + match[0].length;
  const body = chunk.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let comment = '';
  for (let index = body; index < chunk.length; index++) {
    const char = chunk[index], next = chunk[index + 1];
    if (comment === '//') { if (char === '\n') comment = ''; continue; }
    if (comment === '/*') { if (char === '*' && next === '/') { comment = ''; index++; } continue; }
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '/' && (next === '/' || next === '*')) { comment = char + next; index++; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      assert.match(chunk.slice(index + 1, index + 35), /^,\d+:/, `Module ${id} has a complete factory boundary`);
      return chunk.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated installed Steam module ${id}`);
}

const globalView = { name: 'unrelated global window', closed: false, screen: { width: 1000, height: 750 }, innerWidth: 1000, innerHeight: 750 };
const viewA = { name: 'Steam library A', closed: false, screen: { width: 1536, height: 864 }, innerWidth: 1536, innerHeight: 816 };
const viewB = { name: 'Steam library B', closed: false, screen: { width: 1280, height: 800 }, innerWidth: 1280, innerHeight: 760 };
const managers = new Map();
const calls = [];
const errors = [];
let nextKey = 0;
const NativeModalRoot = Symbol('Steam ModalRoot');
const NativeFocusContainer = Symbol('Steam Focusable');
const NativeDialogButton = Symbol('Steam 64608.jn');
const jsx = (type, props, key) => ({ type, props, key });
const react = { useRef: current => ({ current }),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
  cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }) };
const nativeContext = vm.createContext({ window: globalView, console: { error: (...args) => errors.push(args) } });

function evaluateFactory(id, require) {
  const module = { exports: {} };
  require.d = (target, definitions) => {
    for (const [key, get] of Object.entries(definitions)) Object.defineProperty(target, key, { enumerable: true, get });
  };
  vm.runInContext(`(${extractFactory(id)})`, nativeContext, { filename: `${chunkPath}#${id}` })(module, module.exports, require);
  return module.exports;
}

const classes = evaluateFactory(25517, id => { throw new Error(`Unexpected CSS dependency ${id}`); });
for (const name of ['ArtworkModal', 'ModalBox', 'ArtworkModalContainer', 'ArtworkContainer', 'ArtworkImage', 'ArtworkModalDetails', 'Header', 'ModalArtCloseButton']) {
  // ArtworkImage is intentionally absent in this installed class module; I uses undefined.
  if (name === 'ArtworkImage') continue;
  ok(typeof classes[name] === 'string' && classes[name].length > 8, `Class ${name} comes from the installed module 25517`);
}

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  const children = node.props?.children;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(descendants)];
}

function renderArtwork(element) {
  equal(typeof element.type, 'function', '94715.N passes its real function component I to the native modal API');
  const tree = element.type(element.props);
  const nodes = descendants(tree);
  const image = nodes.find(node => node.type === 'img');
  const button = nodes.find(node => node.type === NativeDialogButton);
  ok(image && button, 'The real I component contains an artwork image and native 64608.jn button');
  equal(tree.type, NativeModalRoot, 'The real I component uses native ModalRoot');
  equal(tree.props.className, classes.ArtworkModal, 'ModalRoot uses the installed ArtworkModal class');
  equal(button.props.className, classes.ModalArtCloseButton, 'The close button uses the installed artwork-button class');
  equal(button.props.children, '#Generic_Close', 'The real close label goes through the Generic_Close localization token');
  equal(image.props.className, classes.ArtworkImage, 'The image class follows the installed module, including an absent optional export');
  ok(!nodes.some(node => node.props?.className === classes.FileDetails), 'A card with no file_details adds no native file metadata UI');
  ok(!nodes.some(node => node.props?.className === classes.AdditionalFields), 'An ownership marker does not render as an additional field or footer');
  for (const name of ['ModalBox', 'ArtworkModalContainer', 'ArtworkContainer', 'ArtworkModalDetails', 'Header']) {
    ok(nodes.some(node => node.props?.className === classes[name]), `The real I tree retains native ${name}`);
  }
  return { tree, image, button };
}

function makeManager(view) {
  const shown = new Set(), popupChanged = new Set();
  const manager = {
    modals: [], legacy_popup_modals: [], measurements: [], closedKeys: [], shows: [],
    BUsePopups: () => true,
    BOnlyPopups: () => false,
    RegisterOnModalShownCallback: callback => { shown.add(callback); return { Unregister: () => shown.delete(callback) }; },
    LegacyPopupModalCountChangedCallbacks: { Register: callback => { popupChanged.add(callback); return { Unregister: () => popupChanged.delete(callback) }; } },
    RequestModalMeasure(element, complete, promiseRenderComplete) {
      const rendered = renderArtwork(element);
      const measurement = { element, ...rendered, completed: false, promiseRenderComplete };
      this.measurements.push(measurement);
      Promise.resolve(promiseRenderComplete).then(() => {
        measurement.completed = true;
        complete({ width: rendered.image.props.style.maxWidth + 48, height: rendered.image.props.style.maxHeight + 83 });
      });
    },
    ShowModal(element) { return this.addModel('modals', element); },
    ShowLegacyPopupModal(title, element, options, icons) {
      this.shows.push({ title, options, icons });
      return this.addModel('legacy_popup_modals', element);
    },
    addModel(collectionName, element) {
      const model = { key: `native-artwork-${++nextKey}`, element };
      this[collectionName].push(model);
      // Steam notifies before assigning the returned controller to closeModal's closure.
      for (const callback of shown) callback();
      if (collectionName === 'legacy_popup_modals') for (const callback of popupChanged) callback();
      return { Close: () => {
        const index = this[collectionName].indexOf(model);
        if (index >= 0) { this[collectionName].splice(index, 1); this.closedKeys.push(model.key); }
      } };
    },
    get subscriberCount() { return shown.size + popupChanged.size; },
  };
  managers.set(view, manager);
  return manager;
}

const managerA = makeManager(viewA), managerB = makeManager(viewB);
makeManager(globalView);
const getManager = view => {
  const manager = managers.get(view);
  assert.ok(manager, 'Native modal lookup receives the requested window');
  return manager;
};
const nativeModalDependencies = {
  62540: { jsx, jsxs: jsx }, 63696: react, 3673: { tx: getManager },
  46701: { x_: NativeModalRoot }, 85688: { wT: condition => assert.ok(condition) },
  46108: { we: token => token }, 72476: { TS: { USE_POPUPS: true } },
};
const nativeModal = evaluateFactory(13869, id => {
  assert.ok(id in nativeModalDependencies, `Unexpected native modal dependency ${id}`);
  return nativeModalDependencies[id];
});
const artworkDependencies = {
  62540: { jsx, jsxs: jsx }, 63696: react, 44846: { IDH: () => false },
  64608: { jn: NativeDialogButton }, 50376: {}, 25517: classes, 36934: {},
  31084: {}, 88750: {}, 8573: {}, 48289: {}, 36464: {}, 46108: { we: token => token },
  10606: { x_: NativeModalRoot }, 68608: {}, 33867: {}, 34792: {},
  13869: { mK: (element, view, options) => { calls.push({ element, view, options }); return nativeModal.mK(element, view, options); } },
  60142: {}, 54644: {}, 72476: { Qn: () => false, TS: { LAUNCHER_TYPE: 0 } },
  69164: { Z: NativeFocusContainer }, 61657: { pR: { DIR_UP: 1, DIR_DOWN: 2 } }, 11010: {}, 11131: {},
};
const artwork = evaluateFactory(94715, id => {
  assert.ok(id in artworkDependencies, `Unexpected artwork dependency ${id}`);
  return artworkDependencies[id];
});
equal(typeof artwork.N, 'function', 'The installed 94715.N export is callable');
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const latestMeasurement = manager => manager.measurements.at(-1);
const allModels = manager => [...manager.modals, ...manager.legacy_popup_modals];

let resolved = false;
const directURL = 'https://community.cloudflare.steamstatic.com/economy/image/native-contract-direct';
const directOpen = artwork.N({ strURL: directURL, strTitle: 'Native card contract', windowOverride: viewA }).then(() => { resolved = true; });
const direct = latestMeasurement(managerA);
equal(calls.at(-1).view, viewA, 'N passes the same windowOverride to the actual mK implementation');
equal(calls.at(-1).element.props.window, viewA, 'I receives the requested window, not the unrelated global realm');
equal(calls.at(-1).element.props.artworkURL, directURL, 'N preserves the artwork URI');
equal(calls.at(-1).element.props.title, 'Native card contract', 'N preserves the title');
equal(calls.at(-1).options.strTitle, 'Native card contract', 'The native popup title preserves the same title');
ok(typeof calls.at(-1).options.promiseRenderComplete?.then === 'function', 'N supplies its image-load promise to mK');
equal(direct.image.props.style.maxWidth, viewA.screen.width * .8, 'The real I image fits 80% of screen width');
equal(direct.image.props.style.maxHeight, viewA.screen.height * .8, 'The real I image fits 80% of screen height');
equal(direct.image.props.src, directURL, 'The rendered image retains the exact URI');
await flush();
equal(resolved, false, 'Actual mK waits for onImageLoad before completing measurement');
equal(allModels(managerA).length, 0, 'A pending measurement does not prematurely create a displayed native modal');
direct.image.props.onLoad();
await directOpen;
equal(direct.completed, true, 'I.onImageLoad resolves N.promiseRenderComplete');
equal(managerA.legacy_popup_modals.length, 1, 'Actual mK chooses the native popup for screen-relative card dimensions');
equal(managerA.shows.at(-1).title, 'Native card contract', 'ShowLegacyPopupModal receives the original title');
const directModel = managerA.legacy_popup_modals[0];
renderArtwork(directModel.element).button.props.onClick();
equal(allModels(managerA).length, 0, 'The real I button invokes the real mK closeModal/controller closure');

const inlineOpen = artwork.N({ strURL: 'inline-artwork', strTitle: 'Smaller artwork', windowOverride: viewA, nMaxScreenPercentage: .6 });
const inline = latestMeasurement(managerA);
equal(inline.image.props.style.maxWidth, viewA.screen.width * .6, 'An explicit native screen percentage reaches I unchanged');
inline.image.props.onLoad();
await inlineOpen;
equal(managerA.modals.length, 1, 'Actual mK also exercises its inline ShowModal path for smaller artwork');
renderArtwork(managerA.modals[0].element).tree.props.onEscKeypress();
equal(allModels(managerA).length, 0, 'The real ModalRoot Escape handler closes the inline native model');

let adapterChecked = false;
const adapterPath = 'frontend/features/library/native-card-preview.ts';
if (fs.existsSync(adapterPath)) {
  const captures = [], requireDocs = [], requireIDs = [];
  const preflightImages = [];
  const makeDoc = view => ({ defaultView: view, createElement: tag => {
    equal(tag, 'img', 'Cold preflight creates only a detached image');
    const listeners = new Map();
    const image = {
      complete: false, naturalWidth: 0, naturalHeight: 0, _src: '', listeners,
      addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
      removeAttribute(name) { equal(name, 'src', 'Preflight releases its detached image source'); this._src = ''; },
      set src(value) {
        this._src = value;
        queueMicrotask(() => {
          if (this._src !== value) return;
          this.complete = true;
          const valid = !value.startsWith('invalid-');
          this.naturalWidth = valid ? 1920 : 0;
          this.naturalHeight = valid ? 1080 : 0;
          for (const callback of [...(listeners.get(valid ? 'load' : 'error') || [])]) callback();
        });
      },
      get src() { return this._src; },
    };
    preflightImages.push(image);
    return image;
  } });
  const docs = [makeDoc(viewA), makeDoc(viewB)];
  const runtime = {
    captureRuntime: doc => { captures.push(doc); return true; },
    getRequire: doc => {
      requireDocs.push(doc);
      assert.ok(docs.includes(doc), 'The adapter requests a runtime for its exact document');
      return id => {
        requireIDs.push(id);
        if (id === 94715) return artwork;
        if (id === 3673) return { tx: view => { equal(view, doc.defaultView, 'The adapter resolves the modal manager in its own realm'); return getManager(view); } };
        throw new Error(`Unexpected adapter native module ${id}`);
      };
    },
  };
  const adapterContext = vm.createContext({ exports: {}, setTimeout, clearTimeout, require: dependency => {
    if (dependency === './trading-card-preload') return {
      getTradingCardPreload: (_doc, url) => url.startsWith('cold-') || url.startsWith('invalid-')
        ? undefined : { complete: true, naturalWidth: 1920, naturalHeight: 1080 },
    };
    equal(dependency, '../../steam/modules/SteamWebpackRuntime', 'The adapter uses the real runtime boundary');
    return { steamWebpackRuntime: runtime };
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(adapterPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, adapterContext, { filename: adapterPath });
  const { tryOpenNativeCardPreview: open, disposeNativeCardPreview: dispose } = adapterContext.exports;
  const [docA, docB] = docs;
  const unrelated = { key: 'unrelated-native-dialog', element: { props: { artworkURL: 'foreign-dialog', window: viewA, closeModal: () => { throw new Error('Unrelated native dialog must not be closed'); } } } };
  managerA.modals.push(unrelated);
  equal(open(docA, 'adapter-card-A', 'Card A'), true, 'The adapter delegates to the installed real N export');
  const pendingA = latestMeasurement(managerA);
  equal(calls.at(-1).element.props.artworkURL, 'adapter-card-A', 'The real N receives the adapter URI');
  equal(calls.at(-1).element.props.title, 'Card A', 'The real N receives the adapter title');
  equal(calls.at(-1).element.props.window, viewA, 'The real I uses the adapter document window');
  const markerA = calls.at(-1).element.props.additionalFields;
  ok(markerA != null, 'The real N forwards the adapter ownership marker into I props');
  equal(calls.at(-1).element.props.file_details, undefined, 'The ownership marker does not request native file metadata');
  const callsBeforeDuplicate = calls.length;
  equal(open(docA, 'adapter-card-A', 'Card A'), true, 'A duplicate pending card request is accepted');
  equal(calls.length, callsBeforeDuplicate, 'A duplicate request does not start a second native measurement');

  const foreignOpen = artwork.N({ strURL: 'adapter-card-A', strTitle: 'Foreign same URI', windowOverride: viewA });
  const foreignMeasurement = latestMeasurement(managerA);
  equal(foreignMeasurement.element.props.additionalFields, undefined, 'A concurrent native caller does not have the adapter marker');
  foreignMeasurement.image.props.onLoad();
  await foreignOpen;
  const foreignModel = managerA.legacy_popup_modals.find(model => model.element.props.title === 'Foreign same URI');
  ok(foreignModel, 'A foreign native card with the same URI/window can open during adapter measurement');
  dispose(docA);
  pendingA.image.props.onLoad();
  await flush();
  ok(managerA.legacy_popup_modals.includes(foreignModel), 'Cancellation never captures or closes a concurrent foreign same-URI native card');
  renderArtwork(foreignModel.element).button.props.onClick();
  equal(allModels(managerA).length, 1, 'Cancellation before native measurement closes only the late owned modal');
  equal(managerA.modals[0], unrelated, 'The unrelated native dialog survives disposal');
  equal(managerA.subscriberCount, 0, 'Late cancellation releases both native manager subscriptions');

  equal(open(docA, 'adapter-card-A2', 'Card A2'), true, 'A disposed adapter can open another card');
  const visibleA = latestMeasurement(managerA);
  const markerA2 = visibleA.element.props.additionalFields;
  ok(markerA2 != null && markerA2 !== markerA, 'Each adapter request gets a distinct native ownership marker');
  equal(open(docB, 'adapter-card-B', 'Card B'), true, 'A second document opens through its own runtime');
  const visibleB = latestMeasurement(managerB);
  ok(visibleB.element.props.additionalFields != null && visibleB.element.props.additionalFields !== markerA2,
    'Ownership markers also differ between native window realms');
  visibleA.image.props.onLoad();
  visibleB.image.props.onLoad();
  await flush();
  const modelA = managerA.legacy_popup_modals.find(model => model.element.props.artworkURL === 'adapter-card-A2');
  const modelB = managerB.legacy_popup_modals.find(model => model.element.props.artworkURL === 'adapter-card-B');
  ok(modelA && modelB, 'The actual native manager schema contains independently owned card models');
  equal(modelA.element.props.window, viewA, 'A remains in its own native window');
  equal(modelB.element.props.window, viewB, 'B remains in its own native window');
  equal(modelA.element.props.additionalFields, markerA2, 'The live native manager preserves the exact adapter ownership marker');
  dispose(docA);
  equal(managerA.legacy_popup_modals.length, 0, 'Disposal finds A via model.key and model.element.props');
  equal(managerB.legacy_popup_modals[0], modelB, 'Disposal of A does not close B in another realm');
  renderArtwork(modelB.element).button.props.onClick();
  equal(allModels(managerB).length, 0, 'The displayed adapter card closes through the real native button');
  dispose(docB);

  const beforeCold = calls.length;
  equal(open(docA, 'cold-valid-card', 'Cold card'), true, 'A cold card begins a bounded detached-image preflight');
  equal(calls.length, beforeCold, 'The native N export is not invoked before cold image validation');
  await flush();
  equal(calls.length, beforeCold + 1, 'A validated cold image invokes the actual N export once');
  const coldImage = preflightImages.at(-1);
  equal(coldImage.src, '', 'A valid preflight releases its detached image before native measurement');
  equal([...coldImage.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0,
    'A valid preflight leaves no image event handlers');
  equal(latestMeasurement(managerA).image.props.src, 'cold-valid-card', 'The validated URI passes unchanged into the real I image');
  latestMeasurement(managerA).image.props.onLoad();
  await flush();
  dispose(docA);

  const beforeInvalid = calls.length;
  equal(open(docA, 'invalid-primary', 'Invalid card'), true, 'An invalid source is handled by preflight');
  await flush();
  equal(calls.length, beforeInvalid, 'An invalid image never enters the native measurement path that can hang');
  equal(managerA.subscriberCount, 0, 'Invalid preflight installs no native modal subscriptions');
  dispose(docA);

  equal(open(docA, 'invalid-primary', 'Fallback card', 'validated-fallback'), true, 'An invalid primary can use one validated fallback');
  await flush();
  equal(calls.length, beforeInvalid + 1, 'The fallback is the only URI sent to actual N');
  equal(latestMeasurement(managerA).image.props.src, 'validated-fallback', 'The real native image receives the fallback URI');
  equal(calls.at(-1).element.props.title, 'Fallback card', 'Fallback keeps the requested native title');
  latestMeasurement(managerA).image.props.onLoad();
  await flush();
  dispose(docA);

  const beforeCancelledCold = calls.length;
  equal(open(docA, 'cold-cancelled-card', 'Cancelled cold card'), true, 'A cold pending card can be cancelled');
  dispose(docA);
  await flush();
  equal(calls.length, beforeCancelledCold, 'Cancelled cold preflight never starts N or native measurement');
  equal(managerA.subscriberCount + managerB.subscriberCount, 0, 'Completed adapter opens leave no manager subscriptions');
  equal(captures.length, requireDocs.length, 'Every adapter runtime lookup is captured for the same document');
  ok(requireIDs.includes(94715) && requireIDs.includes(3673), 'The adapter resolves native artwork and modal-manager modules');
  equal(open({ defaultView: { closed: true } }, 'closed-card', 'Closed window'), false, 'A closed document never borrows another window runtime');
  adapterChecked = true;
}

let cssChecked = false;
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), match => ({ selector: match[1].trim(), body: match[2] }));
  const declarations = selector => {
    const rule = rules.find(rule => rule.selector === selector);
    assert.ok(rule, `Installed native CSS selector ${selector} exists`);
    return new Map(rule.body.split(';').filter(Boolean).map(declaration => {
      const colon = declaration.indexOf(':');
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }));
  };
  const details = declarations(`.${classes.ArtworkModalDetails}`);
  const close = declarations(`.${classes.ArtworkModal} .${classes.ModalArtCloseButton}`);
  equal(details.get('width'), '1000px', 'Native details/header width is 1000 CSS pixels');
  equal(close.get('width'), '50%', 'The native close button uses half of the details width');
  equal(Number.parseFloat(details.get('width')) * Number.parseFloat(close.get('width')) / 100, 500,
    'Installed CSS computes the reference 500-CSS-pixel close button');
  equal(close.get('margin-top'), '14px', 'The real native header places the button 14 CSS pixels below artwork');
  equal(close.get('min-height'), '37px', 'The native button minimum height is 37 CSS pixels');
  equal(declarations(`.${classes.ArtworkModal}`).get('border'), '2px solid #000', 'The native frame retains its black artwork border');
  ok(declarations(`.${classes.ModalBox}`).get('background').includes('radial-gradient'), 'The actual native frame uses its radial background');
  equal(declarations(`.${classes.ArtworkModalContainer}`).get('padding'), '24px', 'The native viewer owns 24-CSS-pixel artwork padding');
  cssChecked = true;
}

equal(errors.length, 0, 'The installed native factories completed without rendering errors');
console.log(`Installed Steam card contract: ${assertions} assertions passed; real modules 94715/13869/25517; adapter=${adapterChecked}; CSS=${cssChecked}.`);
