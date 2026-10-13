import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(file, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, console, ...globals, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}

class App {
  constructor(id) {
    this.appid = id;
    this.app_type = 1073741824;
    this.canonicalAppType = 1073741824;
    this.display_name = `Game ${id}`;
    this.icon = `shortcut-icon-${id}`;
    this.controller_support = 0;
    this.xbox_controller_support = 0;
    this.gamepad_preferred = false;
    this.minutes_playtime_forever = 0;
    this.minutes_playtime_last_two_weeks = 0;
  }
  BIsShortcut() { return this.appid >= 2147483648; }
}
const app = new App(3000000000);
const unlinked = new App(3000000001);
const native = new App(570);
const originalMethod = App.prototype.BIsShortcut;
const prototypeKeys = Reflect.ownKeys(App.prototype);
const identityKeys = ['appid', 'app_type', 'canonicalAppType', 'display_name', 'icon', 'controller_support', 'xbox_controller_support', 'gamepad_preferred'];
const descriptors = Object.fromEntries(identityKeys.map(key => [key, Object.getOwnPropertyDescriptor(app, key)]));
const writes = [];
const observedApp = new Proxy(app, {
  set(target, key, value) { writes.push(key); return Reflect.set(target, key, value, target); },
  defineProperty(target, key, descriptor) { writes.push(key); return Reflect.defineProperty(target, key, descriptor); },
});
const snapshot = { shortcutAppId: app.appid, title: app.display_name, minutesForever: 120, minutesRecent: 30, lastPlayedAt: 1000 };
let renderedSnapshots;
const playtime = loadModule('frontend/features/playtime/library-home.ts', {
  '../../steam/shortcuts': {
    getShortcutAppById: id => id === app.appid ? observedApp : null,
    getMappedShortcuts: () => [{ id: app.appid, title: app.display_name, steamAppId: '10' }],
    getShortcutPlaytimeMinutes: async () => 0,
  },
  './service': { setInstantPlaytimeStats() {}, fetchPlaytimeStatsBatch: async () => new Map() },
  './format': { formatPlaytimeMinutes: String },
  './playtime-settings': { isShortcutPlaytimeTrackingEnabled: () => true },
  '../../steam/css': { APP_PORTRAIT_CLASS_MODULE: () => ({ classes: { LibraryItemBox: 'HomeCard' } }) },
  '../../steam/native-dom': { elementsWithCssModuleClass: () => [{ closest: () => null }], isRenderedElement: () => true },
  '../../steam/library-sidebar': { isLibrarySidebarNode: () => false },
  '../../steam/sidebar-interaction': { runWhenLibrarySidebarIdle: (_doc, _key, task) => Promise.resolve(task()) },
  '../library/native-route': { routedSteamAppId: () => null, isPublicSteamLibraryRoute: () => false },
  './library-home-dom': { patchDesktopLibraryHomePlaytimeCards: (_doc, values) => { renderedSnapshots = values; } },
}, { localStorage: { getItem: () => JSON.stringify({ version: 1, values: [snapshot] }), setItem() {} } });
const playtimeDoc = { body: {}, hidden: false, querySelectorAll: () => [] };
for (let i = 0; i < 100; i++) playtime.syncDesktopLibraryHomePlaytimeDom(playtimeDoc);
await playtime.patchDesktopLibraryHomePlaytime(playtimeDoc);
assert.equal(app.minutes_playtime_forever, 0, 'Library Home hydration does not write Steam AppOverview totals');
assert.equal(app.minutes_playtime_last_two_weeks, 0);
assert.equal(renderedSnapshots[0].minutesForever, 120, 'native card text still receives the snapshot');
assert.equal(App.prototype.BIsShortcut, originalMethod, 'desktop hydration never wraps a shared Steam prototype');
assert.deepEqual(Reflect.ownKeys(App.prototype), prototypeKeys);
assert.equal(app.BIsShortcut(), true, 'linked shortcuts keep their native icon routing');
assert.equal(unlinked.BIsShortcut(), true, 'unlinked shortcuts keep their native icon routing');
assert.equal(native.BIsShortcut(), false);
assert.equal(Object.hasOwn(app, 'BIsShortcut'), false);
for (const key of identityKeys) assert.deepEqual(Object.getOwnPropertyDescriptor(app, key), descriptors[key], `${key} stays Steam-owned`);
assert.equal(writes.length, 0, 'Library Home hydration never writes any Steam AppOverview field');

let queries = 0;
let domWrites = 0;
class Element {
  nodeType = 1;
  children = [];
  attributes = new Map();
  dataset = {};
  textContent = '';
  style = {
    display: '',
    setProperty(name, value, priority = '') { domWrites++; this[name] = value; this[`${name}:priority`] = priority; },
    getPropertyValue(name) { return this[name] || ''; },
    getPropertyPriority(name) { return this[`${name}:priority`] || ''; },
    removeProperty(name) { domWrites++; this[name] = ''; this[`${name}:priority`] = ''; },
  };
  constructor(className = '', role = '') { this.className = className; this.role = role; }
  classList = { contains: token => this.className.split(/\s+/).includes(token) };
  matches(selector) {
    return selector.split(',').some(part => {
      const attr = part.trim().match(/^\[([\w-]+)([\*\^]?=)"([^"]+)"\]$/);
      if (!attr) throw new Error(`Unsupported selector: ${part}`);
      const [, name, operator, value] = attr;
      const actual = name === 'class' ? this.className : name === 'role' ? this.role : name === 'id' ? this.id || '' : this.attributes.get(name) || '';
      return operator === '*=' ? actual.includes(value) : operator === '^=' ? actual.startsWith(value) : actual === value;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    queries++;
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  append(child) { this.children.push(child); child.parentElement = this; }
  getAttribute(name) { return name === 'class' ? this.className : this.attributes.get(name) || null; }
  removeAttribute(name) { domWrites++; this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())]; }
}
const body = new Element('libraryroot_Root');
const list = new Element('gamelistbar_GameList');
const steamHidden = new Element('gamelistentry_Container');
steamHidden.style.display = 'none';
const pluginHidden = new Element('gamelistentry_Container');
pluginHidden.style.display = 'none'; pluginHidden.attributes.set('data-gdl-hidden', '1');
const name = new Element('', 'button'); name.textContent = 'Non-Steam Adventure';
steamHidden.append(name); list.append(steamHidden); list.append(pluginHidden); body.append(list);
const details = new Element('appdetails_Container'); body.append(details);
const nativeHeader = new Element('CollectionHeader_Title'); nativeHeader.textContent = 'Non-Steam'; list.append(nativeHeader);
const nativeFilter = new Element('FilterOption_Label', 'button'); nativeFilter.textContent = 'Non-Steam'; list.append(nativeFilter);
const legacyHeader = new Element('CollectionHeader_Title'); legacyHeader.textContent = 'Non-Steam'; legacyHeader.attributes.set('data-gdl-nonsteam', '1');
legacyHeader.style.setProperty('display', 'none', 'important'); legacyHeader.style.setProperty('visibility', 'hidden', 'important'); legacyHeader.style.setProperty('pointer-events', 'none', 'important');
list.append(legacyHeader);
const legacyAlias = new Element(); legacyAlias.textContent = 'Shortcut - En ejecución';
legacyAlias.attributes.set('data-gdl-running-alias', '1'); legacyAlias.dataset.gdlRunningOriginalText = 'Shortcut'; legacyAlias.dataset.gdlRunningOriginalColor = '#abc'; legacyAlias.style.setProperty('color', '#a1cd44', 'important'); list.append(legacyAlias);
const recycledAlias = new Element(); recycledAlias.textContent = 'A different native game';
recycledAlias.attributes.set('data-gdl-running-alias', '1'); recycledAlias.dataset.gdlRunningOriginalText = 'Previous shortcut'; recycledAlias.style.setProperty('color', '#a1cd44', 'important'); list.append(recycledAlias);
const observers = [];
const doc = {
  nodeType: 9, body, querySelectorAll: selector => body.querySelectorAll(selector),
  defaultView: { MutationObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  } },
};
const classModules = [
  { Container: '_2-O4ZG0KrnSrzISHBKctFQ', GameListEntryContainer: '_1vO6BoiVslZgs1kqDGdUs8', GameListEntryName: '_2SXJM0PeFEi3gbC7V3S5pE', GameIcon: 'ga1hyw11cdBVodrCAidPF' },
  { Container: '_3x1HklzyDs4TEjACrRO2tB', GameListHomeAndSearch: '_2TKEazUUS3TlniZfpc8OOe', CollectionsButton: '_2CEKFex6JMsAse2lqMMjUp' },
];
const css = loadModule('frontend/steam/css.ts', { '@steambrew/client': { findClassModule: predicate => classModules.find(predicate) } });
const sidebarSignals = loadModule('frontend/steam/library-sidebar.ts', { './css': css });
const domSignals = loadModule('frontend/core/dom.ts', {});
const sidebar = loadModule('frontend/features/library/sidebar-cleanup.ts', {
  '../../core/mappings': {}, '../../core/dom': domSignals, '../../steam/navigation': {},
  '../../steam/gamepad/stores/AppStoreAdapter': {}, './native-route': {},
  '../../steam/library-sidebar': sidebarSignals,
});
const dispose = sidebar.installGhostSidebarCleanup(doc);
assert.equal(sidebar.installGhostSidebarCleanup(doc), dispose, 'installation is idempotent per document');
assert.equal(observers.length, 0, 'sidebar recovery never installs a body or list observer');
assert.equal(steamHidden.style.display, 'none', 'Steam-owned virtual row visibility is preserved');
assert.equal(pluginHidden.style.display, '', 'only plugin-hidden rows are restored');
assert.equal(pluginHidden.attributes.has('data-gdl-hidden'), false);
assert.equal(name.style.display, '', 'a game title containing Non-Steam is never treated as a filter');
assert.equal(nativeHeader.style.display, '', 'the native Non-Steam collection header remains visible');
assert.equal(nativeFilter.style.display, '', 'the native Non-Steam filter remains visible');
assert.equal(legacyHeader.style.display, '', 'only a legacy plugin-marked header is restored once');
assert.equal(legacyHeader.style.visibility, ''); assert.equal(legacyHeader.style['pointer-events'], '');
assert.equal(legacyHeader.attributes.has('data-gdl-nonsteam'), false);
assert.equal(legacyAlias.textContent, 'Shortcut', 'the old plugin running alias is removed once at startup');
assert.equal(legacyAlias.style.color, '#abc');
assert.equal(legacyAlias.attributes.has('data-gdl-running-alias'), false);
assert.equal(recycledAlias.textContent, 'A different native game', 'legacy cleanup cannot overwrite a row already recycled to another game');
assert.equal(recycledAlias.style.color, '#a1cd44', 'a recycled row also keeps Steam’s current running color');
const scrollMutation = { target: list, addedNodes: [steamHidden], removedNodes: [pluginHidden] };
const detailMutation = { target: details, addedNodes: [new Element('appdetails_GameStats')], removedNodes: [] };
assert.equal(sidebar.isLibrarySidebarMutation([scrollMutation]), true);
assert.equal(sidebar.isLibrarySidebarMutation([{ target: name, addedNodes: [] }]), true, 'focus/title/icon changes are sidebar-only');
assert.equal(sidebar.isLibrarySidebarMutation([scrollMutation, detailMutation]), false, 'mixed batches still update game details');
assert.deepEqual(Array.from(sidebarSignals.withoutLibrarySidebarMutations([scrollMutation, detailMutation])), [detailMutation],
  'a mixed navigation batch retains details without passing virtual rows to downstream scanners');
assert.equal(sidebar.isLibrarySidebarMutation([]), false);
const nativeList = new Element(classModules[1].Container);
const nativeRow = new Element(classModules[0].Container);
const nativeIcon = new Element(classModules[0].GameIcon);
nativeList.append(nativeRow); nativeRow.append(nativeIcon);
assert.equal(sidebarSignals.isLibrarySidebarNode(nativeIcon), true, 'production hashed classes identify icons inside the actual sidebar');
assert.equal(sidebar.isLibrarySidebarMutation([{ target: nativeList, addedNodes: [nativeRow], removedNodes: [] }]), true);
const detachedNativeRow = new Element(classModules[0].GameListEntryContainer);
assert.equal(sidebar.isLibrarySidebarMutation([{ target: new Element('_virtualScroller'), addedNodes: [], removedNodes: [detachedNativeRow] }]), true, 'removed virtual rows retain their identity without an ancestor');
assert.equal(sidebar.isLibrarySidebarMutation([{ target: nativeRow, addedNodes: [], removedNodes: [] }, detailMutation]), false);
const updatedClassModules = classModules.map(module => ({ ...module, Container: module.Container + '_updated' }));
classModules.splice(0, classModules.length, ...updatedClassModules);
css.resetResolvedCssClassModules();
assert.equal(sidebarSignals.isLibrarySidebarNode(new Element(classModules[1].Container)), true, 'runtime CSS resolution follows a Steam class-module refresh');
const queriesBeforeScroll = queries;
const writesBeforeScroll = domWrites;
for (let i = 0; i < 100; i++) sidebar.installGhostSidebarCleanup(doc);
assert.equal(queries, queriesBeforeScroll, '100 scroll/navigation installation signals never rescan virtual rows');
assert.equal(domWrites, writesBeforeScroll, '100 scroll/navigation signals never rewrite native rows, titles, filters or visibility');
assert.equal(steamHidden.style.display, 'none');
const header = new Element('CollectionHeader_Title'); header.textContent = 'Non-Steam';
details.append(header);
assert.equal(header.style.display, '', 'new collection labels are never hidden by normal runtime work');
sidebar.disposeGhostSidebarCleanup(doc);
assert.equal(observers.length, 0, 'teardown has no native observers to retain');
sidebar.installGhostSidebarCleanup(doc);
assert.equal(observers.length, 0, 'reinstalling a disposed scope still creates no observers');
assert.equal(domWrites, writesBeforeScroll, 'a clean document recovery pass performs zero native writes');
sidebar.disposeGhostSidebarCleanup(doc);

const homeClasses = { LibraryItemBox: 'HomeCard', PlayedRecent: 'PlayedRecent', PlayedTotal: 'PlayedTotal' };
const homeElements = (root, css) => {
  const result = [];
  const visit = element => { if (element.classList.contains(css)) result.push(element); for (const child of element.children) visit(child); };
  visit(root.body || root); return result;
};
const homeClosest = (element, css) => {
  for (let current = element; current; current = current.parentElement) if (current.classList.contains(css)) return current;
  return null;
};
let homeTextWrites = 0;
const homeCard = parent => {
  const card = new Element('HomeCard'); card.attributes.set('data-appid', String(app.appid)); parent.append(card);
  const leaf = (css, value) => {
    const element = new Element(css); let text = value;
    Object.defineProperty(element, 'textContent', { get: () => text, set: value => { homeTextWrites++; text = value; } });
    card.append(element); return element;
  };
  return { card, recent: leaf('PlayedRecent', 'Native recent'), total: leaf('PlayedTotal', 'Native total') };
};
const actualHome = homeCard(details), sidebarPortrait = homeCard(list);
const portal = new Element(); portal.attributes.set('popover', 'manual'); body.append(portal);
const hoverPortrait = homeCard(portal);
const homeDom = loadModule('frontend/features/playtime/library-home-dom.ts', {
  '../../steam/css': { APP_PORTRAIT_CLASS_MODULE: () => ({ classes: homeClasses }) },
  '../../steam/native-dom': { elementsWithCssModuleClass: homeElements, closestWithCssModuleClass: homeClosest, isRenderedElement: () => true },
  '../../steam/localization': { loc: (_key, fallback) => fallback, steamIntlLocale: () => 'en-US' },
  '../../steam/library-sidebar': sidebarSignals,
}, { Node: { ELEMENT_NODE: 1 } });
assert.equal(homeDom.mutationMayContainDesktopPlaytime([list, portal]), false, 'sidebar and hover portraits cannot trigger a Library Home scan');
assert.equal(homeDom.mutationMayContainDesktopPlaytime([actualHome.recent]), true, 'real Home playtime leaves still trigger their intended update');
homeDom.patchDesktopLibraryHomePlaytimeCards(doc, [snapshot]);
assert.equal(actualHome.recent.textContent, 'Last two weeks: 30 min');
assert.equal(actualHome.total.textContent, 'Total: 2 h', 'a real Home card still receives the persisted playtime snapshot');
assert.equal(sidebarPortrait.recent.textContent, 'Native recent'); assert.equal(sidebarPortrait.total.textContent, 'Native total');
assert.equal(hoverPortrait.recent.textContent, 'Native recent'); assert.equal(hoverPortrait.total.textContent, 'Native total');
const homeStableWrites = homeTextWrites;
for (let index = 0; index < 100; index++) homeDom.patchDesktopLibraryHomePlaytimeCards(doc, [snapshot]);
assert.equal(homeTextWrites, homeStableWrites, '100 Home patches leave sidebar/hover text untouched and preserve unchanged Home values');
console.log('Sidebar runtime checks passed: 100 playtime/scroll cycles preserve shortcut identity, icons, titles, native filters and visibility; startup-only legacy recovery creates no observers or normal DOM writes.');
await import('./check-sidebar-observers.mjs');
