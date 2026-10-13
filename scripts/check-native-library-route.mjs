import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const classes = { Container: 'NativePlaybar', GameStatsSection: 'NativeStats' };
const dependencies = {
  '../../steam/css': { PLAYBAR_CLASSES: () => classes, LINKS_BAR_CLASSES: () => ({ LinksSection: 'NativeLinks' }) },
  '../../steam/native-dom': {
    elementsWithCssModuleClass: (doc, value) => doc.elements.filter(element => element.className === value),
    isRenderedElement: (_doc, element) => element.rendered && element.isConnected,
    hasCssModuleClass: (element, value) => element.className === value,
  },
  '../shortcuts/registry': { findMappingForShortcut: () => '111' },
  '../shortcuts/dismissed': { isShortcutDismissed: () => false },
  './constants': { GDL_INJECTED: 'gdl-library-injected' },
  './notice': { findNonSteamNotice: doc => doc.notice || null },
};
const helperContext = vm.createContext({ exports: {}, require: name => {
  if (name === './css') return dependencies['../../steam/css'];
  if (name === './native-dom') return dependencies['../../steam/native-dom'];
  throw new Error(`Unexpected native Library helper dependency: ${name}`);
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/library-details.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, helperContext);
dependencies['../../steam/library-details'] = helperContext.exports;
const context = vm.createContext({ exports: {}, window: {}, URL, require: name => {
  if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
  return dependencies[name];
} });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/native-route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const route = context.exports;
const id = 3000000001;
const signed = id - 4294967296;
function fiber(appId, props = { overview: { appid: appId } }) {
  const root = { tag: 3, stateNode: {}, return: null, child: null, alternate: null };
  root.stateNode.current = root;
  const host = { tag: 5, memoizedProps: props, return: root, child: null, sibling: null, alternate: null };
  root.child = host;
  return host;
}
function element(className, { rendered = true, owned = false, appId, fiberId, parentElement = null, style = {} } = {}) {
  const nativeElement = { className, rendered, isConnected: true, parentElement, style,
    closest: () => owned ? {} : null,
    getAttribute: name => name === 'data-appid' ? String(appId || '') : null };
  if (fiberId !== undefined) nativeElement.__reactFiber$fixture = fiber(fiberId);
  return nativeElement;
}
function doc(href = 'https://steamloopback.host/index.html') {
  context.window = {};
  return { defaultView: { location: { href }, getComputedStyle: element => ({ display: 'block', visibility: 'visible', opacity: '1', ...element.style }) }, location: { href }, elements: [], selected: [], details: [],
    querySelectorAll(selector) { return selector.includes('AppDetailsContainer') ? this.details : selector.includes('Selected') ? this.selected : []; },
    querySelector: () => null, getElementById: () => null,
  };
}
function store(path, appId = id) {
  return { GetActiveWindowInstance: () => ({ LocationPathName: path }), currentGameListSelection: { nAppId: appId } };
}

let target = doc(`https://steamloopback.host/library/app/${signed}`);
assert.equal(route.routedSteamAppId(target), id, 'signed shortcut URLs normalize to their unsigned AppID');
target = doc(`https://steamloopback.host/index.html?appid=${signed}`);
assert.equal(route.routedSteamAppId(target), id, 'signed AppID query parameters normalize too');
target = doc(); target.defaultView.uiStore = store(`/library/app/${id}`);
assert.equal(route.routedSteamAppId(target), id, 'SP Desktop resolves its native active window path without browser route attributes');
target = doc(); target.defaultView.uiStore = store(`/library/collection/Action%20Games/${id}`);
assert.equal(route.routedSteamAppId(target), id, 'Steam AppInCollection destinations resolve the selected shortcut before metadata');
target.defaultView.uiStore = store(`/library/collection/favorites/${signed}/achievements`);
assert.equal(route.routedSteamAppId(target), id, 'signed collection-detail routes and their achievements subpages remain supported');
target.defaultView.uiStore = store('/library/collection/favorites/123');
assert.equal(route.isPublicSteamLibraryRoute(target), true, 'native Steam games inside collections remain ownership boundaries');
target = doc('https://steamloopback.host/library/app/123'); target.defaultView.uiStore = store(`/library/app/${id}`);
assert.equal(route.routedSteamAppId(target), id, 'native window navigation outranks a stale SP Desktop browser URL');
target = doc(); target.defaultView.uiStore = store('/library/app/123'); context.window.uiStore = store(`/library/app/${id}`);
assert.equal(route.routedSteamAppId(target), 123, 'the document realm native route wins over another window context');
assert.equal(route.isPublicSteamLibraryRoute(target), true, 'native Steam destinations remain authoritative ownership boundaries');
target = doc('https://steamloopback.host/library/app/123'); target.defaultView.uiStore = store(undefined, id);
target.elements.push(element(classes.Container));
assert.equal(route.routedSteamAppId(target), 123, 'a concrete public URL remains authoritative when the native window has no route');
target = doc(); context.window.uiStore = store(`/library/app/${signed}`);
assert.equal(route.routedSteamAppId(target), id, 'root context native routing is available when the document has no local store');

target = doc(); target.defaultView.uiStore = store(undefined, signed); target.elements.push(element(classes.Container, { fiberId: id }));
assert.equal(route.routedSteamAppId(target), id, 'a matching committed native header permits the synchronous selection snapshot fallback');
assert.equal(route.libraryRouteIdentity(target), `app:${id}`);
target = doc(); target.defaultView.uiStore = store(undefined, id); target.elements.push(element(classes.GameStatsSection, { fiberId: signed }));
assert.equal(route.routedSteamAppId(target), id, 'an already mounted native statistics row permits early startup resolution');
target = doc(); target.defaultView.uiStore = { m_gameListSelection: { nAppId: signed } }; target.elements.push(element(classes.Container, { fiberId: id }));
assert.equal(route.routedSteamAppId(target), id, 'the native backing selection record supports the same unsigned identity');
target = doc(); target.defaultView.uiStore = store(undefined, id); target.elements.push(element(classes.Container));
assert.equal(route.routedSteamAppId(target), null, 'header geometry without React destination props cannot authorize selection reuse');
target.elements = [element(classes.Container, { fiberId: 123 })];
assert.equal(route.routedSteamAppId(target), null, 'selection advancing to B cannot relabel a still displayed native header for A');
context.window.uiStore = store(undefined, 123);
assert.equal(route.routedSteamAppId(target), null, 'a stale root window selection cannot override a mismatching local selection');
context.window = {};
target.elements = [element(classes.Container, { fiberId: id }), element(classes.GameStatsSection, { fiberId: 123 })];
assert.equal(route.routedSteamAppId(target), null, 'conflicting visible native headers reject an ambiguous selection snapshot');
const hiddenHeaderParent = element('', { style: { opacity: '0' } });
target.elements = [element(classes.Container, { fiberId: id, parentElement: hiddenHeaderParent })];
assert.equal(route.routedSteamAppId(target), null, 'a zero opacity header ancestor rejects a geometrically visible selection host');
target.elements.push(element(classes.GameStatsSection, { fiberId: id }));
assert.equal(route.routedSteamAppId(target), id, 'an invisible sticky header does not block the visible matching header');
for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { visibility: 'collapse' }]) {
  target.elements = [element(classes.Container, { fiberId: id, parentElement: element('', { style }) })];
  assert.equal(route.routedSteamAppId(target), null, 'hidden native header ancestors cannot authorize a destination');
}
const reusedHeader = element(classes.Container);
const staleFiber = fiber(123);
const currentFiber = fiber(id);
staleFiber.alternate = currentFiber; currentFiber.alternate = staleFiber;
const staleRoot = staleFiber.return, currentRoot = currentFiber.return;
staleRoot.alternate = currentRoot; currentRoot.alternate = staleRoot;
staleRoot.stateNode = currentRoot.stateNode;
currentRoot.stateNode.current = currentRoot;
reusedHeader.__reactFiber$fixture = staleFiber;
target.elements = [reusedHeader];
assert.equal(route.routedSteamAppId(target), id, 'a reused DOM header reads its committed alternate instead of old memoized props');
target.defaultView.uiStore = store(undefined, 123);
assert.equal(route.routedSteamAppId(target), null, 'an old selection cannot match the obsolete DOM fiber alternate');
target.defaultView.uiStore = store(undefined, id);
const pendingOnlyHeader = element(classes.Container);
pendingOnlyHeader.__reactFiber$fixture = fiber(id, {});
pendingOnlyHeader.__reactFiber$fixture.pendingProps = { overview: { appid: id } };
target.elements = [pendingOnlyHeader];
assert.equal(route.routedSteamAppId(target), null, 'pending React props do not establish the game currently displayed');
const ancestorPropsHeader = element(classes.Container);
const hostFiber = fiber(id, { className: classes.Container });
const ancestorRoot = hostFiber.return;
const ownerFiber = { tag: 0, memoizedProps: { details: { unAppID: signed } }, return: ancestorRoot, child: hostFiber, sibling: null, alternate: null };
ancestorRoot.child = ownerFiber; hostFiber.return = ownerFiber;
ancestorPropsHeader.__reactInternalInstance$fixture = hostFiber;
target.elements = [ancestorPropsHeader];
assert.equal(route.routedSteamAppId(target), id, 'bounded native React owners expose the committed details AppID');

const bailedOutHeader = element(classes.Container);
const sharedHost = fiber(id, { className: classes.Container });
const previousRoot = sharedHost.return;
const nextRoot = { tag: 3, stateNode: previousRoot.stateNode, return: null, child: null, alternate: previousRoot };
previousRoot.alternate = nextRoot; previousRoot.stateNode.current = nextRoot;
const previousOwner = { tag: 0, memoizedProps: { overview: { appid: 123 } }, return: previousRoot, child: sharedHost, sibling: null };
const nextOwner = { tag: 0, memoizedProps: { overview: { appid: id } }, return: nextRoot, child: sharedHost, sibling: null };
previousOwner.alternate = nextOwner; nextOwner.alternate = previousOwner;
previousRoot.child = previousOwner; nextRoot.child = nextOwner; sharedHost.return = previousOwner;
bailedOutHeader.__reactFiber$fixture = sharedHost;
target.elements = [bailedOutHeader];
assert.equal(route.routedSteamAppId(target), id, 'a shared bailed-out host follows its committed owner even when its return chain retains the previous root');
target.defaultView.uiStore = store(undefined, 123);
assert.equal(route.routedSteamAppId(target), null, 'the obsolete owner of a shared host cannot authorize native selection');
target = doc(); target.defaultView.uiStore = store(undefined, id);
assert.equal(route.routedSteamAppId(target), null, 'a persisted selection cannot identify a page without its native details header');
target.elements.push(element(classes.Container, { rendered: false }));
assert.equal(route.routedSteamAppId(target), null, 'a hidden details header cannot authorize selection reuse');
target.elements = [element(classes.GameStatsSection, { owned: true })];
assert.equal(route.routedSteamAppId(target), null, 'plugin-owned fallback rows do not count as native destination evidence');
target.elements = [element(classes.Container, { fiberId: id })]; target.defaultView.uiStore = store('/library', id);
assert.equal(route.routedSteamAppId(target), null, 'Library Home rejects persisted selection even while an old header remains');
target.defaultView.uiStore = store('/library/collection/favorites', id);
assert.equal(route.routedSteamAppId(target), null, 'collection routes also reject an old game selection');
target.defaultView.uiStore = { currentGameListSelection: { nAppId: id }, GetActiveWindowInstance: () => { throw new Error('window unavailable'); } };
assert.equal(route.routedSteamAppId(target), id, 'an unavailable native window accessor still permits guarded header resolution');

target = doc(); target.defaultView.g_AppHistory = { location: { pathname: '/', hash: `#/library/app/${id}` } };
assert.equal(route.routedSteamAppId(target), id, 'legacy hash routing is checked even when pathname is truthy');
target = doc(); context.window.g_History = { location: { pathname: '/library/app/456' } };
assert.equal(route.routedSteamAppId(target), 456, 'legacy parent history remains compatible');
target = doc(); target.selected = [element('', { appId: signed })];
assert.equal(route.routedSteamAppId(target), id, 'existing selected-row attribute fallbacks support signed IDs');
target = doc(); target.details = [element('', { appId: 789 })];
assert.equal(route.routedSteamAppId(target), 789, 'existing explicit native details attributes remain compatible');
target = doc(); target.defaultView.uiStore = store(undefined, id); target.elements = [element(classes.Container, { fiberId: id }), element('NativeLinks', { rendered: false })];
assert.equal(route.isPublicSteamLibraryRoute(target), false, 'hidden native links cannot override an identified shortcut destination');
for (const invalid of [0, -2147483649, 4294967296, NaN]) {
  target = doc(); target.defaultView.uiStore = store(undefined, invalid); target.elements.push(element(classes.Container, { fiberId: id }));
  assert.equal(route.routedSteamAppId(target), null, `invalid native selection ${invalid} is rejected`);
}
console.log('Native Library route checks passed: SP Desktop paths, committed React header identity, stale selection rejection, hidden ancestors, alternate fibers, signed IDs, native ownership and legacy compatibility.');
