import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let writes = 0;
let typographyCalls = 0;
let blueprintCalls = 0;
let blueprintAvailable = false;
let language = 'english';
const classes = {
  Container: 'NativePlaybar',
  GameStatsSection: 'GameStatsSection', PlayBarCloudStatusContainer: 'CloudContainer',
  AppButtonsContainer: 'AppButtons', GameStat: 'GameStat', LastPlayed: 'LastPlayed',
  SuperimposedGridItems: 'SuperimposedGridItems', Visible: 'Visible',
  PlayBarLabel: 'PlayBarLabel', PlayBarDetailLabel: 'PlayBarDetailLabel',
};
class Element {
  nodeType = 1;
  className = '';
  dataset = {};
  children = [];
  textContent = '';
  visible = true;
  style = {
    display: '', visibility: '', pointerEvents: '', opacity: '1',
    setProperty(name, value) { writes++; this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value; },
    removeProperty(name) { writes++; this[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = ''; },
  };
  constructor(doc) { this.ownerDocument = doc; }
  get classList() { return { contains: token => this.className.split(/\s+/).includes(token) }; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  hasAttribute(name) { return name.startsWith('data-') && Object.hasOwn(this.dataset, name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())); }
  set innerHTML(html) {
    writes++; this.html = html;
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    const statClasses = html.match(/<div class="([^"]+)"/u)?.[1];
    if (statClasses?.split(/\s+/).includes(classes.GameStat)) {
      const stat = createCloudStat(this.ownerDocument, statClasses.split(/\s+/).includes(classes.Visible));
      stat.className = statClasses;
      this.appendChild(stat);
    }
  }
  insertBefore(child, reference) {
    if (child === reference) return;
    child.remove();
    writes++;
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    assert(index >= 0, 'insert reference must belong to the host');
    this.children.splice(index, 0, child); child.parentElement = this;
  }
  appendChild(child) { this.insertBefore(child, null); }
  remove() {
    if (this.parentElement) { writes++; this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    this.parentElement = null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const idPrefix = part.match(/\[id\^="([^"]+)"\]/);
      if (idPrefix) return Boolean(this.id?.startsWith(idPrefix[1]));
      const data = part.match(/\[data-gdl-([\w-]+)="1"\]/);
      if (data) return this.dataset[`gdl${data[1].replace(/(^|-)([a-z])/g, (_, _dash, c) => c.toUpperCase())}`] === '1';
      const classPart = part.match(/\[class\*="([^"]+)"\]/);
      if (classPart) return this.className.includes(classPart[1]);
      return false;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  getElementsByClassName(className) { return elementsByClass(this, className).filter(element => element !== this); }
}
function createCloudStat(doc, active = true) {
  const stat = new Element(doc);
  stat.className = [classes.GameStat, classes.SuperimposedGridItems, active ? classes.Visible : ''].filter(Boolean).join(' ');
  stat.visible = active;
  const label = new Element(doc); label.className = classes.PlayBarLabel; label.textContent = 'Cloud status'; stat.appendChild(label);
  const detail = new Element(doc); detail.className = classes.PlayBarDetailLabel; detail.textContent = 'Up to date'; stat.appendChild(detail);
  return stat;
}
function createDocument() {
  const doc = { publicRoute: false, routeId: 3000000000, mapped: true };
  doc.defaultView = { getComputedStyle: element => ({
    opacity: element.style.opacity || '1',
    visibility: element.visible ? element.style.visibility || 'visible' : 'hidden',
    display: element.style.display || 'block',
  }) };
  doc.body = new Element(doc);
  doc.createElement = () => new Element(doc);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.playbar = new Element(doc); doc.playbar.className = classes.Container; commitHost(doc.playbar, doc.routeId); doc.body.appendChild(doc.playbar);
  const buttons = new Element(doc); buttons.className = classes.AppButtonsContainer; doc.playbar.appendChild(buttons);
  return doc;
}
function commitHost(element, appid) {
  // React can share an unchanged child across both committed owner branches.
  // Its return chain may still end in the previous root; this is mounted.
  const state = {};
  const previousRoot = { tag: 3, stateNode: state, return: null };
  const currentRoot = { tag: 3, stateNode: state, return: null, alternate: previousRoot };
  previousRoot.alternate = currentRoot; state.current = currentRoot;
  const previousOwner = { tag: 0, memoizedProps: { overview: { appid } }, return: previousRoot };
  const currentOwner = { tag: 0, memoizedProps: { overview: { appid } }, return: currentRoot, alternate: previousOwner };
  previousOwner.alternate = currentOwner;
  const host = { tag: 5, flags: 0, alternate: null, memoizedProps: { className: element.className }, return: previousOwner };
  previousRoot.child = previousOwner; currentRoot.child = currentOwner;
  previousOwner.child = currentOwner.child = host;
  element.__reactFiber$fixture = host;
}
function nativeStatsIn(doc, parent = doc.playbar) {
  const section = new Element(doc); section.className = classes.GameStatsSection;
  commitHost(section, doc.routeId); parent.appendChild(section); return section;
}
function elementsByClass(root, className) {
  if (!className) return [];
  const all = [];
  const visit = element => { if (element.className.split(/\s+/).includes(className)) all.push(element); for (const child of element.children) visit(child); };
  visit(root.body || root);
  return all;
}
const nativeDomDependencies = {
  './css': { PLAYBAR_CLASSES: () => classes },
  './localization': { steamLanguageSync: () => language, loc: (_key, fallback) => `${language}:${fallback}` },
};
const nativeDomContext = vm.createContext({ exports: {}, require: name => {
  if (!(name in nativeDomDependencies)) throw new Error(`Unexpected native DOM dependency ${name}`);
  return nativeDomDependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/native-dom.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, nativeDomContext);
const { findVisibleCloudStatusStat } = nativeDomContext.exports;
function isRenderedElement(_doc, element) {
  if (!element?.isConnected) return false;
  // Fresh owned rows have zero height until their first Cloud stat is inserted.
  if (element.dataset.gdlCloudStats === '1' && element.children.length === 0) return false;
  for (let current = element; current; current = current.parentElement) {
    if (!current.visible || current.style.display === 'none' || current.style.visibility === 'hidden') return false;
  }
  return true;
}
const detailsDependencies = {
  './css': { PLAYBAR_CLASSES: () => classes },
  './native-dom': {
    elementsWithCssModuleClass: elementsByClass, isRenderedElement,
    hasCssModuleClass: (element, css) => Boolean(css) && css.split(/\s+/).every(token => element.classList.contains(token)),
  },
};
const detailsContext = vm.createContext({ exports: {}, require: name => {
  assert.ok(name in detailsDependencies, `Unexpected Library-details dependency ${name}`); return detailsDependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/library-details.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, detailsContext);
const structuralDoc = createDocument();
const detachedCloud = new Element(structuralDoc);
const detachedActive = createCloudStat(structuralDoc); detachedCloud.appendChild(detachedActive);
assert.equal(detachedCloud.isConnected, false);
assert.equal(findVisibleCloudStatusStat(detachedCloud), detachedActive, 'active blueprint states are recognized before attachment');
detachedActive.className = classes.GameStat;
assert.equal(findVisibleCloudStatusStat(detachedCloud), detachedActive, 'older active layouts without superimposed classes remain supported');
detachedActive.children[0].remove();
assert.equal(findVisibleCloudStatusStat(detachedCloud), null, 'an older layout still needs its Cloud label and detail');
const dependencies = {
  '../../core/text': { escapeHtml: String },
  '../../steam/css': { PLAYBAR_CLASSES: () => classes },
  '../../steam/localization': { steamLanguageSync: () => language, loc: (_key, fallback) => `${language}:${fallback}` },
  '../../steam/native-dom': {
    elementsWithCssModuleClass: elementsByClass,
    closestWithCssModuleClass: (element, className) => {
      for (let current = element; current; current = current.parentElement) if (current.className === className) return current;
      return null;
    },
    findVisibleCloudStatusStat,
    isRenderedElement,
    NATIVE_UI_BLUEPRINT_KEYS: { cloudStatus: 'cloud-status' },
    applyNativePlaybarTypography: () => { typographyCalls++; },
    buildNativeCloudBlueprint: doc => {
      blueprintCalls++;
      if (!blueprintAvailable) return null;
      const node = new Element(doc); node.className = classes.PlayBarCloudStatusContainer; node.dataset.gdlCloudStatus = '1';
      node.dataset.gdlNativeBlueprint = '1'; node.appendChild(createCloudStat(doc));
      return node;
    },
  },
  '../../steam/playbar-visibility': { preserveLinkedPlaybarVisibility() {} },
  '../../steam/library-details': detailsContext.exports,
  './native-route': { isPublicSteamLibraryRoute: doc => doc.publicRoute, routedSteamAppId: doc => doc.routeId },
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: () => '10' },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
  './styles': { ensureNativeGameInfoStyles() {} },
  './primary-links': { findNativePlaybar: doc => doc.playbar },
};
const context = vm.createContext({ exports: {}, require: name => {
  if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
  return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/cloud-status.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const cloud = context.exports;
const doc = createDocument();
cloud.syncEarlyLinkedCloudStatus(doc);
const wrapper = doc.querySelector('[data-gdl-cloud-status="1"]');
assert(wrapper, 'never-played/no-achievement shortcuts receive cloud status');
assert(wrapper.html.includes('Up to date'));
assert.equal(wrapper.parentElement.dataset.gdlCloudStats, '1', 'a missing statistics row gets an owned fallback');
const stableWrites = writes;
const stableTypography = typographyCalls;
const stableBlueprints = blueprintCalls;
blueprintAvailable = true;
for (let i = 0; i < 100; i++) cloud.syncEarlyLinkedCloudStatus(doc);
assert.equal(doc.querySelector('[data-gdl-cloud-status="1"]'), wrapper, 'late blueprint hydration preserves the same widget');
assert.equal(writes, stableWrites, 'scroll/focus/metadata checks never rewrite or reposition the widget');
assert.equal(typographyCalls, stableTypography);
assert.equal(blueprintCalls, stableBlueprints);

const nativeStats = nativeStatsIn(doc);
cloud.ensureCloudStatus(doc);
assert.equal(wrapper.parentElement, nativeStats, 'native stats hydration reuses the exact same node');
assert.equal(doc.querySelectorAll('[data-gdl-cloud-stats="1"]').length, 0, 'temporary row is retired after migration');
nativeStats.remove();
const replacement = nativeStatsIn(doc);
cloud.ensureCloudStatus(doc);
assert.equal(wrapper.parentElement, replacement, 'replacing a playbar reattaches the same static cloud indicator');
wrapper.style.display = 'none'; wrapper.style.visibility = 'hidden'; wrapper.style.pointerEvents = 'none';
cloud.removeCloudStatus(doc);
doc.routeId++;
commitHost(doc.playbar, doc.routeId); commitHost(replacement, doc.routeId);
cloud.ensureCloudStatus(doc);
assert.equal(doc.querySelector('[data-gdl-cloud-status="1"]'), wrapper);
assert.equal(wrapper.style.display + wrapper.style.visibility + wrapper.style.pointerEvents, '', 'route retirement cannot leave the reused indicator hidden');

wrapper.style.display = 'none'; wrapper.style.visibility = 'hidden'; wrapper.style.pointerEvents = 'none';
cloud.ensureCloudStatus(doc);
assert.equal(doc.querySelector('[data-gdl-cloud-status="1"]'), wrapper, 'a still-connected concealed widget is repaired in place');
assert.equal(wrapper.style.display + wrapper.style.visibility + wrapper.style.pointerEvents, '', 'connected owned nodes cannot keep retired-route styles');
assert(isRenderedElement(doc, findVisibleCloudStatusStat(wrapper)), 'the repaired connected widget has a visible active status');
const repairedWrites = writes;
const repairedTypography = typographyCalls;
const repairedBlueprints = blueprintCalls;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(doc);
assert.equal(writes, repairedWrites, 'repair is one-time; 100 later updates do not mutate the widget');
assert.equal(typographyCalls, repairedTypography);
assert.equal(blueprintCalls, repairedBlueprints);

const placeholderDoc = createDocument();
const emptyStats = nativeStatsIn(placeholderDoc);
const placeholder = new Element(placeholderDoc); placeholder.className = classes.PlayBarCloudStatusContainer; emptyStats.appendChild(placeholder);
cloud.ensureCloudStatus(placeholderDoc);
assert(placeholderDoc.querySelector('[data-gdl-cloud-status="1"]'), 'an initially empty native placeholder cannot suppress first mount');

const reserveDoc = createDocument();
const reserveStats = nativeStatsIn(reserveDoc);
const reserveContainer = new Element(reserveDoc); reserveContainer.className = classes.PlayBarCloudStatusContainer;
reserveContainer.textContent = 'Cloud status Up to date Cloud status Synchronizing Cloud status Uploading Cloud status Downloading';
for (let i = 0; i < 4; i++) reserveContainer.appendChild(createCloudStat(reserveDoc, false));
reserveStats.appendChild(reserveContainer);
assert(isRenderedElement(reserveDoc, reserveContainer), 'native sizing placeholders can have a visible container');
assert.equal(findVisibleCloudStatusStat(reserveContainer), null, 'hidden native sizing states are never an active Cloud status');
cloud.ensureCloudStatus(reserveDoc);
const reserveFallback = reserveDoc.querySelector('[data-gdl-cloud-status="1"]');
assert(reserveFallback, 'a native container with four hidden reserves and text cannot suppress the fallback');
assert(isRenderedElement(reserveDoc, findVisibleCloudStatusStat(reserveFallback)));
assert.equal(reserveContainer.children.length, 4, 'native sizing states stay owned by Steam');
const reserveWrites = writes;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(reserveDoc);
assert.equal(reserveDoc.querySelector('[data-gdl-cloud-status="1"]'), reserveFallback);
assert.equal(writes, reserveWrites, 'hidden native reserves cannot trigger recurring fallback rewrites');

const multiHostDoc = createDocument();
const fixedHeader = new Element(multiHostDoc); fixedHeader.style.opacity = '0'; multiHostDoc.playbar.appendChild(fixedHeader);
const fixedStats = nativeStatsIn(multiHostDoc, fixedHeader);
const inPageHeader = new Element(multiHostDoc); multiHostDoc.playbar.appendChild(inPageHeader);
const inPageStats = nativeStatsIn(multiHostDoc, inPageHeader);
assert(isRenderedElement(multiHostDoc, fixedStats), 'a transparent sticky host still has native geometry');
assert.equal(multiHostDoc.defaultView.getComputedStyle(fixedStats).opacity, '1', 'the hidden opacity belongs to the ancestor, not the stats row');
cloud.ensureCloudStatus(multiHostDoc);
const movingWrapper = multiHostDoc.querySelector('[data-gdl-cloud-status="1"]');
const movingStat = findVisibleCloudStatusStat(movingWrapper);
assert.equal(movingWrapper.parentElement, inPageStats, 'the visible in-page host wins over an earlier transparent sticky host');
for (let i = 0; i < 100; i++) {
  const showFixed = i % 2 === 0;
  fixedHeader.style.opacity = showFixed ? '1' : '0';
  inPageHeader.style.opacity = showFixed ? '0' : '1';
  cloud.ensureCloudStatus(multiHostDoc);
  assert.equal(multiHostDoc.querySelector('[data-gdl-cloud-status="1"]'), movingWrapper, 'host changes keep the same Cloud wrapper');
  assert.equal(movingWrapper.parentElement, showFixed ? fixedStats : inPageStats, 'the cached widget moves when its ancestor becomes transparent');
  assert.equal(findVisibleCloudStatusStat(movingWrapper), movingStat, '100 sticky/in-page transitions preserve the same inner status');
  assert.equal(multiHostDoc.querySelectorAll('[data-gdl-cloud-status="1"]').length, 1, 'host transitions never duplicate Cloud status');
}
const hostStableWrites = writes;
const hostStableTypography = typographyCalls;
const hostStableBlueprints = blueprintCalls;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(multiHostDoc);
assert.equal(writes, hostStableWrites, '100 checks on an unchanged visible host perform no DOM writes');
assert.equal(typographyCalls, hostStableTypography);
assert.equal(blueprintCalls, hostStableBlueprints);

const partialDoc = createDocument();
const partialSticky = new Element(partialDoc); partialSticky.style.opacity = '0'; partialDoc.body.insertBefore(partialSticky, partialDoc.playbar);
const partialStickyStats = nativeStatsIn(partialDoc, partialSticky);
const partialReserve = new Element(partialDoc); partialReserve.className = classes.PlayBarCloudStatusContainer;
partialReserve.textContent = 'Cloud status Up to date Cloud status Synchronizing';
for (let i = 0; i < 4; i++) partialReserve.appendChild(createCloudStat(partialDoc, false));
partialStickyStats.appendChild(partialReserve);
cloud.ensureCloudStatus(partialDoc);
const partialWrapper = partialDoc.querySelector('[data-gdl-cloud-status="1"]');
const partialInnerStat = findVisibleCloudStatusStat(partialWrapper);
const partialFallback = partialWrapper.parentElement;
assert.equal(partialFallback.dataset.gdlCloudStats, '1', 'hidden native sticky stats cannot suppress an early visible fallback row');
assert.equal(partialFallback.parentElement, partialDoc.playbar, 'the first-frame Cloud slot belongs to the visible playbar before its native stats hydrate');
const partialStableWrites = writes;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(partialDoc);
assert.equal(partialWrapper.parentElement, partialFallback, 'the visible fallback remains mounted while only hidden native stats exist');
assert.equal(writes, partialStableWrites, '100 partial-header checks do not recreate or rewrite the fallback');
const hydratedPartialStats = nativeStatsIn(partialDoc);
cloud.ensureCloudStatus(partialDoc);
assert.equal(partialDoc.querySelector('[data-gdl-cloud-status="1"]'), partialWrapper, 'native in-page hydration migrates the same Cloud wrapper');
assert.equal(partialWrapper.parentElement, hydratedPartialStats);
assert.equal(findVisibleCloudStatusStat(partialWrapper), partialInnerStat, 'partial-header hydration retains the same static inner status');
assert.equal(partialFallback.isConnected, false, 'the temporary row retires after its Cloud indicator migrates');
assert.equal(partialDoc.querySelectorAll('[data-gdl-cloud-stats="1"]').length, 0);
const partialHydratedWrites = writes;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(partialDoc);
assert.equal(writes, partialHydratedWrites, 'the hydrated native host remains static across 100 checks');

const emptyNative = new Element(doc); emptyNative.className = classes.PlayBarCloudStatusContainer; replacement.appendChild(emptyNative);
cloud.ensureCloudStatus(doc);
assert.equal(wrapper.parentElement, replacement, 'an empty native placeholder cannot suppress the indicator');
emptyNative.textContent = 'Real native Cloud status';
emptyNative.appendChild(createCloudStat(doc));
cloud.ensureCloudStatus(doc);
assert.equal(wrapper.isConnected, false, 'a real native Cloud control remains authoritative without duplicates');
assert.equal(emptyNative.isConnected, true);
emptyNative.visible = false;
cloud.ensureCloudStatus(doc);
assert.equal(wrapper.parentElement, replacement, 'a hidden placeholder cannot suppress the indicator');

const corruptDoc = createDocument();
cloud.ensureCloudStatus(corruptDoc);
const corruptWrapper = corruptDoc.querySelector('[data-gdl-cloud-status="1"]');
assert.equal(corruptWrapper.dataset.gdlNativeBlueprint, '1');
const reserveOnlyMarkup = '<div class="GameStat SuperimposedGridItems"><div class="PlayBarLabel">Cloud status</div><div class="PlayBarDetailLabel">Synchronizing</div></div>';
corruptWrapper.innerHTML = reserveOnlyMarkup;
assert.equal(findVisibleCloudStatusStat(corruptWrapper), null);
cloud.ensureCloudStatus(corruptDoc);
assert.equal(corruptDoc.querySelector('[data-gdl-cloud-status="1"]'), corruptWrapper, 'a corrupt connected owned blueprint is repaired without replacing its wrapper');
assert(isRenderedElement(corruptDoc, findVisibleCloudStatusStat(corruptWrapper)), 'repair replaces the hidden-only contents with one active status');
cloud.removeCloudStatus(corruptDoc);
corruptWrapper.innerHTML = reserveOnlyMarkup;
cloud.ensureCloudStatus(corruptDoc);
assert.equal(corruptDoc.querySelector('[data-gdl-cloud-status="1"]'), corruptWrapper, 'a corrupt detached cached blueprint reuses and repairs its wrapper');
assert(isRenderedElement(corruptDoc, findVisibleCloudStatusStat(corruptWrapper)));
const corruptWrites = writes;
for (let i = 0; i < 100; i++) cloud.ensureCloudStatus(corruptDoc);
assert.equal(writes, corruptWrites, 'cached blueprint recovery is one-time and leaves the widget static');

const otherDoc = createDocument();
cloud.ensureCloudStatus(otherDoc);
assert.notEqual(otherDoc.querySelector('[data-gdl-cloud-status="1"]'), wrapper, 'CEF documents have separate widgets');
const nativeDoc = createDocument(); nativeDoc.routeId = 123; nativeDoc.publicRoute = true;
cloud.ensureCloudStatus(nativeDoc);
assert.equal(nativeDoc.querySelector('[data-gdl-cloud-status="1"]'), null, 'real Steam games are untouched');
const aheadDoc = createDocument();
const previousStats = nativeStatsIn(aheadDoc);
commitHost(aheadDoc.playbar, 123); commitHost(previousStats, 123);
aheadDoc.playbar.__reactFiber$fixture.pendingProps = { overview: { appid: aheadDoc.routeId } };
previousStats.__reactFiber$fixture.pendingProps = { overview: { appid: aheadDoc.routeId } };
const beforeAheadWrites = writes;
cloud.ensureCloudStatus(aheadDoc);
assert.equal(writes, beforeAheadWrites, 'An advanced shortcut URI never alters the previous committed native Steam playbar');
assert.equal(aheadDoc.querySelector('[data-gdl-cloud-status="1"]'), null, 'Pending React props cannot authorize Cloud injection');
commitHost(aheadDoc.playbar, aheadDoc.routeId); commitHost(previousStats, aheadDoc.routeId);
cloud.ensureCloudStatus(aheadDoc);
assert(aheadDoc.querySelector('[data-gdl-cloud-status="1"]'), 'Cloud mounts once this shortcut owns the committed native host');
blueprintAvailable = false;
language = 'spanish';
cloud.ensureCloudStatus(doc);
const translated = doc.querySelector('[data-gdl-cloud-status="1"]');
assert.notEqual(translated, wrapper, 'an explicit language change can refresh the translated copy once');
assert(translated.html.includes('spanish:'));
console.log('Cloud runtime checks passed: empty playbars, 100 static updates, native-row migration, detached-node reuse, hidden native sizing states, connected-node visibility recovery, corrupt cached blueprint recovery, partial-header first-frame fallback, 100 transparent sticky/in-page host transitions, native Cloud ownership, realm isolation and language changes.');
