import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let writes = 0;
let fetchCalls = 0;
let overviewWrites = 0;
let now = 1_000, timerId = 0;
const timers = new Map();
class Clock extends Date { static now() { return now; } }
const idleContext = vm.createContext({ exports: {}, Date: Clock, require: name => {
  assert.equal(name, './library-sidebar'); return { isLibrarySidebarNode: target => Boolean(target?.sidebar) };
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/sidebar-interaction.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, idleContext);
const sidebar = idleContext.exports;
const classes = {
  Container: 'NativePlaybar',
  GameStatsSection: 'GameStatsSection', GameStat: 'GameStat', Playtime: 'Playtime',
  LastPlayed: 'LastPlayed', PlayBarLabel: 'PlayBarLabel', PlayBarDetailLabel: 'PlayBarDetailLabel',
  LastPlayedInfo: 'LastPlayedInfo', PlayBarCloudStatusContainer: 'CloudContainer', Visible: 'Visible',
};
class Element {
  nodeType = 1;
  className = '';
  dataset = {};
  style = {};
  children = [];
  constructor(doc) { this.ownerDocument = doc; }
  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text || ''; }
  set textContent(value) { writes++; this.text = String(value); for (const child of this.children) child.parentElement = null; this.children = []; }
  get classList() { return { contains: token => this.className.split(/\s+/).includes(token), add: token => { if (!this.className.split(/\s+/).includes(token)) this.className += ` ${token}`; } }; }
  setAttribute(name, value) { if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value); }
  hasAttribute(name) { return name.startsWith('data-') && Object.hasOwn(this.dataset, dataKey(name)); }
  matches(selector) {
    return selector.split(',').some(part => {
      if (/^(?:span|div)$/.test(part.trim())) return true;
      const idPrefix = part.match(/\[id\^="([^"]+)"\]/);
      if (idPrefix) return Boolean(this.id?.startsWith(idPrefix[1]));
      const data = part.match(/\[(data-[\w-]+)="([^"]+)"\]/);
      if (data) return this.dataset[dataKey(data[1])] === data[2];
      const css = part.match(/\[class\*="([^"]+)"\]/);
      if (css) return this.className.includes(css[1]);
      return part.trim().startsWith('#') && this.id === part.trim().slice(1);
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  insertBefore(child, reference) {
    if (child === reference) return;
    child.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    assert(index >= 0, 'reference belongs to its host');
    writes++; this.children.splice(index, 0, child); child.parentElement = this;
  }
  appendChild(child) { this.insertBefore(child, null); }
  remove() { if (this.parentElement) { writes++; this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
}
function dataKey(name) { return name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()); }
function elementsByClass(root, css) {
  if (!css) return [];
  const tokens = css.split(/\s+/).filter(Boolean);
  const found = [];
  const visit = element => { if (tokens.every(token => element.classList.contains(token))) found.push(element); for (const child of element.children) visit(child); };
  visit(root.body || root);
  return found;
}
function closestByClass(element, css) {
  for (let current = element; current; current = current.parentElement) if (css && current.classList.contains(css)) return current;
  return null;
}
function stat(doc, kind, label, value) {
  const root = new Element(doc); root.className = `${classes.GameStat} ${kind === 'playtime' ? classes.Playtime : classes.LastPlayed}`;
  const caption = new Element(doc); caption.className = classes.PlayBarLabel; caption.textContent = label; root.appendChild(caption);
  const detail = new Element(doc); detail.className = classes.PlayBarDetailLabel; detail.textContent = value; root.appendChild(detail);
  return { root, detail };
}
function documentFor(appid, native = true) {
  const listeners = new Map();
  const doc = { routeId: appid, publicRoute: false, hidden: false,
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    wheel() { for (const listener of listeners.get('wheel') || []) listener({ target: { sidebar: true } }); },
  };
  doc.defaultView = { document: doc, closed: false,
    getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.style }),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  doc.body = new Element(doc);
  doc.createElement = () => new Element(doc);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.playbar = new Element(doc); doc.playbar.className = classes.Container; commitHost(doc.playbar, appid); doc.body.appendChild(doc.playbar);
  const stats = new Element(doc); stats.className = classes.GameStatsSection; commitHost(stats, appid); doc.playbar.appendChild(stats); doc.stats = stats;
  if (native) {
    doc.playtime = stat(doc, 'playtime', 'Playtime', '11 min'); stats.appendChild(doc.playtime.root);
    doc.lastPlayed = stat(doc, 'last-played', 'Last played', '10 Oct'); stats.appendChild(doc.lastPlayed.root);
  }
  const cloud = new Element(doc); cloud.className = classes.PlayBarCloudStatusContainer; stats.appendChild(cloud);
  doc.reserve = stat(doc, 'last-played', 'Cloud status', 'Up to date'); cloud.appendChild(doc.reserve.root);
  sidebar.installLibrarySidebarInteraction(doc);
  return doc;
}
function commitHost(element, appid) {
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
function isRenderedElement(_doc, element) {
  if (!element?.isConnected) return false;
  for (let current = element; current; current = current.parentElement) {
    if (current.visible === false || current.style.display === 'none' || current.style.visibility === 'hidden') return false;
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
const detailsContext = vm.createContext({ exports: {}, require: dependency => {
  assert.ok(dependency in detailsDependencies, `Unexpected Library-details dependency ${dependency}`); return detailsDependencies[dependency];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/library-details.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, detailsContext);
const instant = new Map();
const pending = new Map();
const apps = new Map();
const disabled = new Set();
function appFor(appid) {
  if (!apps.has(appid)) apps.set(appid, { appid, display_name: `Game ${appid}`, minutes_playtime_forever: 11, rt_last_time_played: 999, BIsModOrShortcut() { return true; } });
  return apps.get(appid);
}
function deferred(appid) {
  let resolve;
  const request = new Promise(finish => { resolve = value => { instant.set(appid, value); finish(value); }; });
  pending.set(appid, request);
  return resolve;
}
const dependencies = {
  '../../api/backend': {}, '../../core/text': { escapeHtml: String },
  '../../steam/css': { PLAYBAR_CLASSES: () => classes },
  '../../steam/localization': { loc: (_key, fallback) => fallback },
  '../../steam/native-dom': {
    elementsWithCssModuleClass: elementsByClass, closestWithCssModuleClass: closestByClass,
    applyNativePlaybarTypography() {}, NATIVE_UI_BLUEPRINT_KEYS: {},
    buildNativePlaybarStatBlueprint: (doc, kind, label, value) => stat(doc, kind === 'playtime' ? 'playtime' : 'last-played', label, value).root,
  },
  '../../steam/playbar-visibility': { preserveLinkedPlaybarVisibility() {} },
  '../../steam/library-sidebar': { isLibrarySidebarNode: () => false },
  '../../steam/sidebar-interaction': sidebar,
  '../../steam/library-details': detailsContext.exports,
  '../library/cloud-status': { ensureCloudStatus() {} },
  '../library/native-route': { routedSteamAppId: doc => doc.routeId, isPublicSteamLibraryRoute: doc => doc.publicRoute },
  '../shortcuts/registry': { getCommittedShortcutSteamAppId: () => '123' },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
  '../../steam/shortcuts': { getShortcutAppById: appFor },
  './service': { getInstantPlaytimeStats: appid => instant.get(appid) || null, fetchPlaytimeStats: appid => { fetchCalls++; return pending.get(appid) || Promise.resolve(instant.get(appid) || null); } },
  './format': { formatPlaytimeMinutes: minutes => `${minutes} min`, formatLastPlayedDate: timestamp => `date:${timestamp}` },
  './library-home': { setDesktopPlaytimeField(app, key, value) { overviewWrites++; app[key] = value; } },
  '../../core/mappings': {},
  './playtime-settings': { isShortcutPlaytimeTrackingEnabled: appid => !disabled.has(appid) },
};
const context = vm.createContext({ exports: {}, require: name => {
  assert(name in dependencies, `Unexpected dependency ${name}`);
  return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/playtime/tracker.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { injectPlaytimeFallbackStats: inject, syncEarlyLinkedPlaytime: sync, removePlaytimeFallbackStats: remove } = context.exports;
const canonical = { minutesForever: 3, minutesLastTwoWeeks: 1, totalSeconds: 180, lastPlayedAt: 123 };
const zero = { minutesForever: 0, minutesLastTwoWeeks: 0, totalSeconds: 0, lastPlayedAt: null };
const drain = async () => { await Promise.resolve(); await Promise.resolve(); };
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
async function advance(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  await flush();
}

const cold = documentFor(3000000001);
const finishCold = deferred(cold.routeId);
const coldRequest = inject(cold, cold.routeId, 'Cold', '123');
assert.equal(cold.playtime.detail.textContent, '—', 'uncached Steam shortcut minutes are masked before IPC');
assert.equal(cold.lastPlayed.detail.textContent, '—', 'uncached Steam shortcut dates are masked before IPC');
assert.equal(cold.reserve.detail.textContent, 'Up to date', 'Cloud sizing reserves never become dates');
finishCold(canonical); await coldRequest;
assert.equal(cold.playtime.detail.textContent, '3 min', 'canonical totals may be below Steam shortcut totals');
assert.equal(cold.lastPlayed.detail.textContent, 'date:123');
const stableNativeWrites = writes;
for (let i = 0; i < 100; i++) sync(cold);
await drain();
assert.equal(writes, stableNativeWrites, '100 early sync passes do not rewrite native values or trigger observer loops');

const warm = documentFor(3000000002); instant.set(warm.routeId, zero);
const finishWarm = deferred(warm.routeId);
const warmRequest = inject(warm, warm.routeId, 'Warm');
assert.equal(warm.playtime.detail.textContent, '0 min', 'a confirmed zero snapshot paints synchronously');
assert.equal(warm.lastPlayed.detail.textContent, '—', 'a confirmed empty history cannot keep Steam last-played data');
finishWarm(zero); await warmRequest;

const fallback = documentFor(3000000003, false); instant.set(fallback.routeId, canonical);
await inject(fallback, fallback.routeId, 'Fallback');
const container = fallback.querySelector('[data-gdl-playtime="1"]');
const fallbackTime = container.querySelector('[data-gdl-stat="playtime"]');
const fallbackDate = container.querySelector('[data-gdl-stat="last-played"]');
assert(fallbackTime && fallbackDate, 'missing native fields receive distinct owned stats');
assert.equal(fallback.reserve.detail.textContent, 'Up to date', 'native Cloud reserves cannot suppress an owned date');
const stableFallbackWrites = writes;
for (let i = 0; i < 100; i++) sync(fallback);
await drain();
assert.equal(writes, stableFallbackWrites, '100 early sync passes keep fallback children intact');
instant.set(fallback.routeId, { ...canonical, minutesForever: 4, lastPlayedAt: 456 });
await inject(fallback, fallback.routeId, 'Fallback');
assert.equal(container.querySelector('[data-gdl-stat="playtime"]'), fallbackTime, 'new totals update the existing stat');
assert.equal(container.querySelector('[data-gdl-stat="last-played"]'), fallbackDate, 'new dates update the existing stat');
assert.equal(elementsByClass(fallbackTime, classes.PlayBarDetailLabel)[0].textContent, '4 min');
instant.set(fallback.routeId, zero); await inject(fallback, fallback.routeId, 'Fallback');
assert.equal(container.querySelector('[data-gdl-stat="last-played"]'), null, 'empty canonical history removes only the owned date');
assert.equal(container.querySelector('[data-gdl-stat="playtime"]'), fallbackTime);

const racing = documentFor(3000000004);
const finishA = deferred(racing.routeId);
sync(racing);
racing.routeId = 3000000005;
const finishB = deferred(racing.routeId);
const beforeAheadWrites = writes, beforeAheadFetches = fetchCalls;
sync(racing);
await drain();
assert.equal(writes, beforeAheadWrites, 'A URI advancing to B cannot mask or overwrite still-committed A stats');
assert.equal(fetchCalls, beforeAheadFetches, 'A destination without a committed host does not request playtime yet');
commitHost(racing.playbar, racing.routeId); commitHost(racing.stats, racing.routeId);
sync(racing);
finishB({ ...canonical, minutesForever: 5, lastPlayedAt: 555 }); await drain();
finishA({ ...canonical, minutesForever: 99, lastPlayedAt: 999 }); await drain();
assert.equal(racing.playtime.detail.textContent, '5 min', 'a late former-game result cannot overwrite the current game');
assert.equal(racing.lastPlayed.detail.textContent, 'date:555');
const staleWrites = writes;
await inject(racing, 3000000004, 'Former');
assert.equal(writes, staleWrites, 'stale callers cannot mask the new game before awaiting');
racing.publicRoute = true; sync(racing); await drain();
assert.equal(writes, staleWrites, 'native Steam routes remain untouched');

const untracked = documentFor(3000000006); disabled.add(untracked.routeId);
await inject(untracked, untracked.routeId, 'Untracked');
assert.equal(untracked.playtime.detail.textContent, '11 min', 'disabled tracking preserves native Steam history');
const previousNative = documentFor(3000000007);
commitHost(previousNative.playbar, 123); commitHost(previousNative.stats, 123);
previousNative.playbar.__reactFiber$fixture.pendingProps = { overview: { appid: previousNative.routeId } };
previousNative.stats.__reactFiber$fixture.pendingProps = { overview: { appid: previousNative.routeId } };
const beforeNativeWrites = writes, beforeNativeFetches = fetchCalls;
await inject(previousNative, previousNative.routeId, 'Ahead of native commit');
assert.equal(writes, beforeNativeWrites, 'Pending shortcut props cannot alter the previous native Steam game');
assert.equal(fetchCalls, beforeNativeFetches, 'Pending props do not authorize backend requests');
assert.equal(previousNative.playtime.detail.textContent, '11 min');
assert.equal(previousNative.lastPlayed.detail.textContent, '10 Oct');
const unknownHost = documentFor(3000000008);
delete unknownHost.playbar.__reactFiber$fixture; delete unknownHost.stats.__reactFiber$fixture;
const beforeUnknownWrites = writes, beforeUnknownFetches = fetchCalls;
await inject(unknownHost, unknownHost.routeId, 'Unknown host');
assert.equal(writes, beforeUnknownWrites, 'A host without committed identity is not used as a placeholder target');
assert.equal(fetchCalls, beforeUnknownFetches);

const scrolling = documentFor(3000000100);
const finishScrolling = deferred(scrolling.routeId);
const scrollingRequest = inject(scrolling, scrolling.routeId, 'Scrolling', '123');
scrolling.wheel();
const beforeScrollCompletion = writes;
finishScrolling(canonical); await flush();
assert.equal(writes, beforeScrollCompletion, 'a delayed backend response performs zero native text writes during sidebar scrolling');
assert.equal(scrolling.playtime.detail.textContent, '—');
await advance(181); await scrollingRequest;
assert.equal(scrolling.playtime.detail.textContent, '3 min', 'the canonical backend result paints after scrolling stops');
assert.equal(scrolling.lastPlayed.detail.textContent, 'date:123');

const warmScrolling = documentFor(3000000101); instant.set(warmScrolling.routeId, canonical);
const finishWarmScrolling = deferred(warmScrolling.routeId);
warmScrolling.wheel();
const warmScrollingRequest = inject(warmScrolling, warmScrolling.routeId, 'Instant while scrolling', '123');
assert.equal(warmScrolling.playtime.detail.textContent, '3 min', 'the foreground cached value remains synchronous even while scrolling');
const beforeWarmCompletion = writes;
finishWarmScrolling({ ...canonical, minutesForever: 4 }); await flush();
assert.equal(writes, beforeWarmCompletion, 'only the fresh backend completion waits behind sidebar interaction');
await advance(181); await warmScrollingRequest;
assert.equal(warmScrolling.playtime.detail.textContent, '4 min');

const nativeAfterWait = documentFor(3000000102);
const finishNativeAfterWait = deferred(nativeAfterWait.routeId);
const nativeAfterWaitRequest = inject(nativeAfterWait, nativeAfterWait.routeId, 'Former external', '123');
nativeAfterWait.wheel(); finishNativeAfterWait(canonical); await flush();
nativeAfterWait.routeId = 570; nativeAfterWait.publicRoute = true;
commitHost(nativeAfterWait.playbar, 570); commitHost(nativeAfterWait.stats, 570);
nativeAfterWait.playtime.detail.textContent = 'Native time'; nativeAfterWait.lastPlayed.detail.textContent = 'Native date';
const beforeNativeQueue = writes;
await advance(181); await nativeAfterWaitRequest;
assert.equal(writes, beforeNativeQueue, 'a queued external completion cannot rewrite a later native Steam destination');
assert.equal(nativeAfterWait.playtime.detail.textContent, 'Native time');
assert.equal(nativeAfterWait.lastPlayed.detail.textContent, 'Native date');

const siblingScrolling = documentFor(3000000103);
const finishSiblingA = deferred(siblingScrolling.routeId);
const siblingARequest = inject(siblingScrolling, siblingScrolling.routeId, 'Sibling A', '123');
siblingScrolling.wheel(); finishSiblingA({ ...canonical, minutesForever: 99 }); await flush();
siblingScrolling.routeId = 3000000104;
commitHost(siblingScrolling.playbar, siblingScrolling.routeId); commitHost(siblingScrolling.stats, siblingScrolling.routeId);
instant.set(siblingScrolling.routeId, { ...canonical, minutesForever: 5 });
const finishSiblingB = deferred(siblingScrolling.routeId);
const siblingBRequest = inject(siblingScrolling, siblingScrolling.routeId, 'Sibling B', '123');
const beforeSiblingQueue = writes;
await advance(181); await siblingARequest;
assert.equal(writes, beforeSiblingQueue, 'sibling shortcuts sharing a Steam AppID cannot commit each other’s queued completion');
assert.equal(siblingScrolling.playtime.detail.textContent, '5 min');
finishSiblingB({ ...canonical, minutesForever: 6 }); await siblingBRequest;
assert.equal(siblingScrolling.playtime.detail.textContent, '6 min');

// React can reuse both the DOM bar and the stats row through A → B → A.
const aba = documentFor(3000000105), abaA = aba.routeId;
const finishOldA = deferred(abaA), oldARequest = inject(aba, abaA, 'Old A', '123');
aba.wheel(); aba.routeId = 3000000106;
commitHost(aba.playbar, aba.routeId); commitHost(aba.stats, aba.routeId);
instant.set(aba.routeId, canonical);
const finishMiddleB = deferred(aba.routeId), middleBRequest = inject(aba, aba.routeId, 'Middle B', '123');
aba.routeId = abaA; commitHost(aba.playbar, abaA); commitHost(aba.stats, abaA);
instant.set(abaA, { ...canonical, minutesForever: 4 });
const finishNewA = deferred(abaA), newARequest = inject(aba, abaA, 'Current A', '123');
const beforeAbaQueue = writes;
finishOldA({ ...canonical, minutesForever: 99 }); finishMiddleB({ ...canonical, minutesForever: 77 }); await flush();
await advance(181); await oldARequest; await middleBRequest;
assert.equal(writes, beforeAbaQueue, 'an A → B → A navigation rejects old responses even when React reuses the exact same native DOM host');
assert.equal(aba.playtime.detail.textContent, '4 min');
finishNewA({ ...canonical, minutesForever: 5 }); await newARequest;
assert.equal(aba.playtime.detail.textContent, '5 min', 'the current A request can still update the reused host');

const replaced = documentFor(3000000107);
const finishReplaced = deferred(replaced.routeId), replacedRequest = inject(replaced, replaced.routeId, 'Replaced header', '123');
replaced.wheel();
replaced.playbar.remove();
replaced.playbar = new Element(replaced); replaced.playbar.className = classes.Container; commitHost(replaced.playbar, replaced.routeId); replaced.body.appendChild(replaced.playbar);
replaced.stats = new Element(replaced); replaced.stats.className = classes.GameStatsSection; commitHost(replaced.stats, replaced.routeId); replaced.playbar.appendChild(replaced.stats);
replaced.playtime = stat(replaced, 'playtime', 'Playtime', 'Current header'); replaced.stats.appendChild(replaced.playtime.root);
const beforeReplacementQueue = writes;
finishReplaced({ ...canonical, minutesForever: 99 }); await flush(); await advance(181); await replacedRequest;
assert.equal(writes, beforeReplacementQueue, 'a response captured for a replaced native header never writes into its successor');
assert.equal(replaced.playtime.detail.textContent, 'Current header');

const coldHeader = documentFor(3000000108);
coldHeader.stats.remove();
const finishColdHeader = deferred(coldHeader.routeId), coldHeaderRequest = inject(coldHeader, coldHeader.routeId, 'Cold header', '123');
coldHeader.wheel();
coldHeader.stats = new Element(coldHeader); coldHeader.stats.className = classes.GameStatsSection; commitHost(coldHeader.stats, coldHeader.routeId); coldHeader.playbar.appendChild(coldHeader.stats);
coldHeader.playtime = stat(coldHeader, 'playtime', 'Playtime', 'New stats'); coldHeader.stats.appendChild(coldHeader.playtime.root);
const beforeColdHeaderQueue = writes;
finishColdHeader(canonical); await flush();
assert.equal(writes, beforeColdHeaderQueue, 'a cold header’s newly mounted stats still wait during actual sidebar scrolling');
await advance(181); await coldHeaderRequest;
assert.equal(coldHeader.playtime.detail.textContent, '3 min', 'initially absent stats can receive the canonical result under the same native playbar');

const preserved = documentFor(3000000200, false); instant.set(preserved.routeId, canonical);
await inject(preserved, preserved.routeId, 'Current destination', '123');
const currentContainer = preserved.querySelector('[data-gdl-playtime="1"]');
const currentTimeStat = currentContainer.querySelector('[data-gdl-stat="playtime"]');
function ownedContainer(doc, shortcutId, parent) {
  const container = new Element(doc); container.dataset.gdlPlaytime = '1'; container.dataset.gdlPlaytimeShortcutId = String(shortcutId);
  parent.appendChild(container); return container;
}
const formerContainer = ownedContainer(preserved, 3000000199, preserved.stats);
const orphanContainer = ownedContainer(preserved, preserved.routeId, preserved.body);
const formerStats = new Element(preserved); formerStats.className = classes.GameStatsSection;
commitHost(formerStats, 3000000199); preserved.body.appendChild(formerStats);
const wrongHostContainer = ownedContainer(preserved, preserved.routeId, formerStats);
remove(preserved, true);
assert.equal(currentContainer.parentElement, preserved.stats, 'route cleanup preserves the already-mounted current shortcut time widget');
assert.equal(currentContainer.querySelector('[data-gdl-stat="playtime"]'), currentTimeStat, 'the current destination keeps its exact stat nodes');
assert.equal(formerContainer.parentElement, null, 'a former shortcut container cannot survive under current stats');
assert.equal(orphanContainer.parentElement, null, 'an orphaned same-ID container is not preserved');
assert.equal(wrongHostContainer.parentElement, null, 'a matching data attribute cannot authorize the previous game’s native host');
const preservedWrites = writes;
remove(preserved, true);
assert.equal(writes, preservedWrites, 'repeated preserving cleanup performs zero writes on the current widget');
preserved.publicRoute = true;
remove(preserved, true);
assert.equal(currentContainer.parentElement, null, 'native Steam destinations retire all owned fallback containers even when preservation was requested');
assert.equal(preserved.reserve.detail.textContent, 'Up to date', 'owned fallback cleanup leaves Steam’s native Cloud text intact');
preserved.publicRoute = false;
await inject(preserved, preserved.routeId, 'Current destination', '123');
remove(preserved);
assert.equal(preserved.querySelector('[data-gdl-playtime="1"]'), null, 'the default cleanup API still purges the current owned fallback');

for (const app of apps.values()) {
  assert.equal(app.BIsModOrShortcut(), true); assert.equal(Object.hasOwn(app, 'BIsModOrShortcut'), true);
  assert.equal(app.minutes_playtime_forever, 11, 'instant and refreshed detail values never write Steam AppOverview playtime');
  assert.equal(app.rt_last_time_played, 999, 'instant and refreshed detail dates never write Steam AppOverview history');
}
assert.equal(overviewWrites, 0, 'detail playbar updates never call the Library Home AppOverview writer');

// Steam owns every sidebar title and running color. Observe its real running
// suffix to preserve playtime tracking without mirroring it onto another row.
const runningDoc = documentFor(3000000300);
const nativeList = new Element(runningDoc); nativeList.className = 'NativeSidebar'; runningDoc.body.appendChild(nativeList);
const nativeRunning = new Element(runningDoc); nativeRunning.textContent = 'Mapped - En ejecución'; nativeList.appendChild(nativeRunning);
const shortcutLabel = new Element(runningDoc); shortcutLabel.textContent = 'Mapped'; nativeList.appendChild(shortcutLabel);
shortcutLabel.style = { color: '#dcdedf', getPropertyValue(name) { return this[name] || ''; },
  setProperty(name, value) { writes++; this[name] = value; }, removeProperty(name) { writes++; delete this[name]; } };
const runningSnapshot = () => [nativeRunning, shortcutLabel].map(label => ({ text: label.textContent, data: { ...label.dataset }, color: label.style.color }));
const initialRunningSnapshot = runningSnapshot(), beforeTrackerWrites = writes;
const sessions = { start: [], ping: [], stop: [] };
let pollCallback;
const trackerDependencies = { ...dependencies,
  '../../api/backend': { backendLog() {},
    startPlaytimeSessionBackend: args => { sessions.start.push(JSON.parse(args.request_json)); return Promise.resolve(); },
    pingPlaytimeSessionBackend: args => { sessions.ping.push(JSON.parse(args.request_json)); return Promise.resolve(); },
    stopPlaytimeSessionBackend: args => { sessions.stop.push(JSON.parse(args.request_json)); return Promise.resolve(); } },
  '../../steam/css': { PLAYBAR_CLASSES: () => classes, LIBRARY_SIDEBAR_CLASSES: () => ({ Container: 'NativeSidebar' }) },
  '../../steam/library-sidebar': { isLibrarySidebarNode: element => Boolean(closestByClass(element, 'NativeSidebar')) },
  '../../steam/shortcuts': { getShortcutAppById: appFor, getMappedShortcuts: () => [{ id: runningDoc.routeId, title: 'Mapped', steamAppId: '123' }] },
};
const trackerContext = vm.createContext({ exports: {}, document: runningDoc,
  window: { SteamUIStore: { RunningApps: new Set() }, dispatchEvent() {} }, CustomEvent: class {},
  setInterval(callback) { pollCallback = callback; return 1; }, clearInterval() {},
  require: name => { assert(name in trackerDependencies, `Unexpected tracker dependency ${name}`); return trackerDependencies[name]; },
});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/playtime/tracker.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, trackerContext);
trackerContext.exports.startPlaytimeTracker(); await flush();
for (let index = 0; index < 99; index++) { await pollCallback(); await flush(); }
assert.equal(sessions.start.length, 1, 'reading Steam’s running title still starts the mapped shortcut’s tracking session');
assert.equal(sessions.start[0].shortcut_app_id, String(runningDoc.routeId));
assert.equal(sessions.ping.length, 99, 'subsequent native running observations keep that same session alive');
assert.deepEqual(runningSnapshot(), initialRunningSnapshot, '100 polls preserve native running text and plain shortcut names, colors and attributes');
assert.equal(writes, beforeTrackerWrites, '100 tracker polls perform zero native sidebar DOM writes');
trackerContext.exports.stopPlaytimeTracker(); await flush();
assert.equal(sessions.stop.length, 1, 'stopping tracking still closes the active session');
assert.deepEqual(runningSnapshot(), initialRunningSnapshot, 'tracker teardown does not rewrite or recolor any native row');
console.log('Playtime runtime passed: instant snapshots, zero native AppOverview writes, 100 stable syncs, backend completions gated during scrolling, native/sibling/ABA/replaced-host rejection, cold-header adoption and disabled tracking.');
