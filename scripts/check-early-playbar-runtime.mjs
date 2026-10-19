import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const observers = new Set();
const mappingListeners = new Set();
const classes = { Container: 'PlaybarContainer', GameStatsSection: 'GameStatsSection' };
let cloudSyncs = 0;
let playtimeSyncs = 0;
let mappingVerified = false;
class Element {
  nodeType = 1;
  children = [];
  className = '';
  dataset = {};
  style = { opacity: '1', display: 'block', visibility: 'visible' };
  constructor(doc) { this.ownerDocument = doc; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  removeChild(child) {
    this.children = this.children.filter(value => value !== child);
    child.parentElement = null;
    return child;
  }
  contains(node) { return node === this || this.children.some(child => child === node || child.contains?.(node)); }
  closest() { return this.owned ? this : this.parentElement?.closest() || null; }
  getBoundingClientRect() { return { width: 180, height: 40 }; }
}
class Observer {
  targets = new Map();
  constructor(callback) { this.callback = callback; observers.add(this); }
  observe(target, options) { this.targets.set(target, options); }
  disconnect() { this.targets.clear(); }
}
function deliver(record) {
  for (const observer of Array.from(observers)) {
    const matched = Array.from(observer.targets).some(([target, options]) => {
      if (record.target !== target && !(options.subtree && target.contains(record.target))) return false;
      if (!options[record.type]) return false;
      return record.type !== 'attributes' || !options.attributeFilter || options.attributeFilter.includes(record.attributeName);
    });
    if (matched) observer.callback([record]);
  }
}
function record(type, target, changes = {}) { return { type, target, addedNodes: [], removedNodes: [], ...changes }; }
function elementsByClass(root, value) {
  const all = [];
  const visit = node => {
    if (node.className === value) all.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root.body || root);
  return all;
}
function createDocument() {
  const events = new Map();
  const frames = new Map();
  let nextFrame = 0;
  const doc = { routeId: 3000000000 };
  doc.body = new Element(doc);
  doc.documentElement = new Element(doc);
  doc.playbar = new Element(doc); doc.playbar.className = classes.Container; doc.body.appendChild(doc.playbar);
  doc.querySelector = () => doc.cloud?.isConnected ? doc.cloud : null;
  doc.querySelectorAll = () => [];
  doc.addEventListener = (name, listener) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); };
  doc.removeEventListener = (name, listener) => events.get(name)?.delete(listener);
  doc.emit = (name, target) => { for (const listener of events.get(name) || []) listener({ target }); };
  doc.defaultView = {
    MutationObserver: Observer,
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: element => element.style,
  };
  doc.frames = frames;
  doc.flushFrames = () => {
    let count = 0;
    while (frames.size && count < 100) {
      const batch = Array.from(frames.values()); frames.clear();
      for (const callback of batch) { count++; callback(); }
    }
    return count;
  };
  return doc;
}
const lifecycleContext = vm.createContext({ exports: {}, MutationObserver: Observer });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/core/disposables.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, lifecycleContext);
const domContext = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/core/dom.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, domContext);
const dependencies = {
  '../../core/disposables': lifecycleContext.exports,
  '../../core/dom': domContext.exports,
  '../../core/mappings': { findMappingForTitle: () => mappingVerified ? '1790600' : null, subscribeMappings: listener => {
    mappingListeners.add(listener); return () => mappingListeners.delete(listener);
  } },
  '../../steam/css': { PLAYBAR_CLASSES: () => classes },
  '../../steam/library-sidebar': { withoutLibrarySidebarMutations: records => records.filter(item => !item.target.sidebar) },
  '../../steam/native-dom': { elementsWithCssModuleClass: elementsByClass },
  '../../steam/library-details': { paintedNativeStats: doc => elementsByClass(doc, classes.GameStatsSection) },
  '../playtime/tracker': { syncEarlyLinkedPlaytime: () => { playtimeSyncs++; }, removePlaytimeFallbackStats() {} },
  '../achievements/cache': { getCachedLocalAchievementsForShortcut: () => null },
  '../achievements/playbar': { ensureLocalPlaybarStat() {} },
  '../shortcuts/runtime': { findMappingForShortcut: () => null, isShortcutDismissed: () => false },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
  './early-notice': { syncEarlyLinkedNotice() {}, disposeEarlyLinkedNotice() {}, installEarlyShortcutNoticeStyle() {} },
  './playbar-achievement-cleanup': { removeObsoletePlaybarAchievements() {} },
  './cloud-status': { removeCloudStatus() {}, syncEarlyLinkedCloudStatus: doc => {
    cloudSyncs++;
    if (!mappingVerified || doc.cloud?.isConnected) return;
    const stats = elementsByClass(doc, classes.GameStatsSection)[0];
    if (!stats) return;
    doc.cloud = new Element(doc); doc.cloud.owned = true; stats.appendChild(doc.cloud);
  } },
  './native-route': { routedSteamAppId: doc => doc.routeId },
  './native-artwork-warmup': { warmNativeShortcutArtwork() {} },
  './primary-links': { findNativePlaybar: doc => doc.playbar },
  './early-primary-links': { syncEarlyLinkedPrimaryLinks() {}, disposeLinkedPrimaryLinks() {} },
  './early-game-info': { syncEarlyLinkedGameInfo() {}, disposeEarlyLinkedGameInfo() {} },
};
const context = vm.createContext({ exports: {}, Date, require: name => {
  if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
  return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/early-playbar.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { installEarlyLinkedPlaybar } = context.exports;
const doc = createDocument();
const early = installEarlyLinkedPlaybar(doc);
assert.equal(installEarlyLinkedPlaybar(doc), early, 'one installer owns each document');
assert.equal(cloudSyncs, 1, 'the first synchronization runs immediately');
assert.equal(playtimeSyncs, 1);
assert.equal(doc.flushFrames(), 12, 'missing mappings/hosts receive only a bounded before-paint retry');
assert.equal(doc.frames.size, 0, 'there is no perpetual idle polling');
assert.equal(doc.cloud, undefined, 'the installer does not bypass mapping verification');

const stats = new Element(doc); stats.className = classes.GameStatsSection; doc.playbar.appendChild(stats);
deliver(record('childList', doc.playbar, { addedNodes: [stats] }));
mappingVerified = true;
for (const listener of mappingListeners) listener();
assert.equal(doc.cloud.parentElement, stats, 'explicit mapping hydration synchronizes the already mounted host');
assert.equal(doc.frames.size, 0, 'a painted Cloud indicator cancels settling frames');
const bodyOptions = Array.from(observers).flatMap(observer => Array.from(observer.targets)).filter(([target]) => target === doc.body);
assert(bodyOptions.length > 0);
assert(bodyOptions.every(([, options]) => options.childList && !options.attributes && !options.characterData), 'body observation is discovery-only');
const attributeOptions = Array.from(observers).flatMap(observer => Array.from(observer.targets)).filter(([, options]) => options.attributes);
assert(attributeOptions.every(([, options]) => !options.subtree), 'native visibility styles are observed directly without descendant attribute feedback');

const nativeDetail = new Element(doc); stats.appendChild(nativeDetail);
const nativeText = { nodeType: 3, parentElement: nativeDetail };
nativeDetail.children.push(nativeText);
const beforeText = cloudSyncs;
deliver(record('characterData', nativeText));
assert.equal(cloudSyncs, beforeText + 1, 'React text updates synchronize before the next paint');
assert.equal(playtimeSyncs, cloudSyncs);
const beforeStyle = cloudSyncs;
for (let index = 0; index < 100; index++) deliver(record('attributes', doc.playbar, { attributeName: 'style' }));
assert.equal(cloudSyncs, beforeStyle, 'splitter style bursts do not synchronously repeat every playbar scanner');
assert.equal(doc.frames.size, 1, '100 ancestor width/style signals share one pending frame');
assert.equal(doc.flushFrames(), 1, 'the next paint flushes the coalesced ancestor style work');
assert.equal(cloudSyncs, beforeStyle + 1, 'ancestor opacity/style changes synchronize without a child replacement');
deliver(record('attributes', stats, { attributeName: 'class' }));
assert.equal(cloudSyncs, beforeStyle + 2, 'statistics class changes synchronize directly');

const beforeMixed = cloudSyncs;
deliver(record('attributes', doc.playbar, { attributeName: 'style' }));
deliver(record('characterData', nativeText));
assert.equal(cloudSyncs, beforeMixed + 1, 'native content synchronizes immediately while ancestor style work is pending');
assert.equal(doc.frames.size, 0, 'immediate content synchronization consumes redundant pending style work');

const beforeDrag = cloudSyncs;
for (let step = 0; step < 60; step++) {
  for (let event = 0; event < 8; event++) deliver(record('attributes', doc.playbar, { attributeName: 'style' }));
  assert.equal(doc.frames.size, 1, 'each drag frame retains one ancestor refresh');
  doc.flushFrames();
}
assert.equal(cloudSyncs - beforeDrag, 60, '480 splitter signals perform 60 refreshes, one per rendered frame');

const beforeOwned = cloudSyncs;
deliver(record('characterData', { nodeType: 3, parentElement: doc.cloud }));
deliver(record('attributes', nativeDetail, { attributeName: 'style' }));
assert.equal(cloudSyncs, beforeOwned, 'owned text changes and descendant visibility overrides do not feed back');
const sidebar = new Element(doc); sidebar.sidebar = true; doc.body.appendChild(sidebar);
deliver(record('childList', sidebar, { addedNodes: [new Element(doc)] }));
assert.equal(cloudSyncs, beforeOwned, 'virtual sidebar recycling never synchronizes the playbar');
const bodyDiscovery = Array.from(observers).find(observer => observer.targets.has(doc.body));
const hero = new Element(doc); hero.className = 'HeaderBackgroundImage'; doc.body.appendChild(hero);
const content = new Element(doc); content.className = 'CommunityContent'; doc.body.appendChild(content);
for (let index = 0; index < 100; index++) {
  const image = new Element(doc); image.className = index % 2 ? 'TitleLogo' : 'ImgSrc'; hero.appendChild(image);
  const article = new Element(doc); article.className = 'CommunityCard'; content.appendChild(article);
  bodyDiscovery.callback([
    record('childList', hero, { addedNodes: [image] }),
    record('childList', content, { addedNodes: [article] }),
  ]);
  hero.removeChild(image); content.removeChild(article);
  bodyDiscovery.callback([
    record('childList', hero, { removedNodes: [image] }),
    record('childList', content, { removedNodes: [article] }),
  ]);
}
assert.equal(cloudSyncs, beforeOwned, '100 image/content insertion and removal batches never resynchronize the playbar');
assert.equal(doc.frames.size, 0, 'unrelated hero/logo/content changes never schedule settling frames');

const hostWrapper = new Element(doc);
const extraPlaybar = new Element(doc); extraPlaybar.className = classes.Container;
hostWrapper.appendChild(extraPlaybar); doc.body.appendChild(hostWrapper);
bodyDiscovery.callback([record('childList', doc.body, { addedNodes: [hostWrapper] })]);
assert.equal(cloudSyncs, beforeOwned + 1, 'a native playbar nested inside a newly mounted wrapper is discovered');
doc.body.removeChild(hostWrapper);
bodyDiscovery.callback([record('childList', doc.body, { removedNodes: [hostWrapper] })]);
assert.equal(cloudSyncs, beforeOwned + 2, 'removing a wrapper containing a native playbar synchronizes the remaining hosts');
const removedStats = doc.playbar.removeChild(stats);
bodyDiscovery.callback([record('childList', doc.playbar, { removedNodes: [removedStats] })]);
assert.equal(cloudSyncs, beforeOwned + 3, 'removing a statistics host is discovered outside its former subtree');
doc.playbar.appendChild(stats);
bodyDiscovery.callback([record('childList', doc.playbar, { addedNodes: [stats] })]);
assert.equal(cloudSyncs, beforeOwned + 4, 'remounting the statistics host rebinds its scoped observer');
const afterHostChanges = cloudSyncs;
const sidebarChange = record('childList', sidebar, { addedNodes: [new Element(doc)] });
const ownChange = record('childList', doc.body, { addedNodes: [doc.cloud] });
for (let i = 0; i < 100; i++) bodyDiscovery.callback([sidebarChange, ownChange]);
assert.equal(cloudSyncs, afterHostChanges, 'mixed sidebar/owned batches never restart early synchronization');
bodyDiscovery.callback([sidebarChange, ownChange, record('childList', doc.playbar, { addedNodes: [stats] })]);
assert.equal(cloudSyncs, afterHostChanges + 1, 'mixed batches retain real native details host replacements');

doc.playbar.style.opacity = '0';
deliver(record('attributes', doc.playbar, { attributeName: 'style' }));
assert.equal(doc.frames.size, 1, 'an unpainted host gets a bounded settling pass');
doc.playbar.style.opacity = '1';
assert.equal(doc.flushFrames(), 1, 'the first painted frame stops retries');
const beforeTransition = cloudSyncs;
doc.emit('transitionend', doc.playbar);
assert.equal(cloudSyncs, beforeTransition + 1, 'native ancestor transition completion is a visibility signal');
doc.emit('transitionend', sidebar);
assert.equal(cloudSyncs, beforeTransition + 1, 'unrelated transitions are ignored');

doc.playbar.style.opacity = '0'; early.sync();
assert.equal(doc.frames.size, 1);
deliver(record('attributes', doc.playbar, { attributeName: 'style' }));
assert.equal(doc.frames.size, 2, 'settling and a pending ancestor signal are both owned by the lifecycle');
early.dispose();
assert.equal(mappingListeners.size, 0, 'disposing unsubscribes mapping hydration callbacks');
assert.equal(doc.frames.size, 0, 'disposing cancels pending frames');
assert(Array.from(observers).every(observer => observer.targets.size === 0), 'disposing disconnects every observer');
const disposedSyncs = cloudSyncs;
deliver(record('characterData', nativeText)); doc.emit('transitionend', doc.playbar); doc.flushFrames();
assert.equal(cloudSyncs, disposedSyncs, 'retired documents cannot run callbacks');
const replacement = installEarlyLinkedPlaybar(doc);
assert.notEqual(replacement, early, 'a disposed document can be installed again');
doc.routeId = 10;
const beforeNative = cloudSyncs;
replacement.sync();
assert.equal(cloudSyncs, beforeNative, 'native Steam routes do not run shortcut synchronization');
assert.equal(doc.frames.size, 0);
replacement.dispose();
console.log('Early playbar runtime checks passed: immediate sync, verified-mapping hydration, native text/style signals, host mount/removal discovery, image/content isolation, bounded settling, sidebar isolation, owned-mutation isolation and lifecycle cleanup.');
