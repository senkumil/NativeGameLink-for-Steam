// Compare committed-header ownership against this Steam client's actual React
// reconciler. In particular, mounted bailout children do not necessarily have
// an alternate or a return chain ending at root.current.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const steamReact = process.env.STEAM_REACT_BUNDLE
  || 'C:/Program Files (x86)/Steam/steamui/libraries/libraries~00299a408.js';
const installed = fs.existsSync(steamReact) ? fs.readFileSync(steamReact, 'utf8') : null;
function functionAt(start) {
  assert(start >= 0, 'The installed React function contract must be found');
  const open = installed.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < installed.length) {
    if (installed[end] === '{') depth++;
    if (installed[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'The installed React function must be complete');
  return installed.slice(start, end);
}
let nativeCurrent = null;
if (installed) {
  const nearestSource = functionAt(installed.indexOf('function l(e){var t=e,r=e;if(e.alternate)'));
  const currentStart = installed.indexOf('return e=function(e){var t=e.alternate;');
  const currentSource = functionAt(currentStart + 'return e='.length);
  assert(currentSource.includes('.child===') && currentSource.includes('.stateNode.current'),
    'Use the installed slow path, including shared child sets and root selection');
  const reactError = number => `Installed React invariant ${number}`;
  const nearest = new Function('a', `return (${nearestSource})`)(reactError);
  const assertMounted = fiber => { if (nearest(fiber) !== fiber) throw new Error(reactError(188)); };
  nativeCurrent = new Function('l', 'c', 'a', `return (${currentSource})`)(nearest, assertMounted, reactError);
}

const classes = { Container: 'NativePlaybar', GameStatsSection: 'NativeStats' };
const helpers = {
  elementsWithCssModuleClass: (doc, name) => doc.elements.filter(element => element.className === name),
  hasCssModuleClass: (element, name) => element.className === name,
  isRenderedElement: (_doc, element) => element.painted !== false,
};
const context = vm.createContext({ exports: {}, require: name => {
  if (name === './css') return { PLAYBAR_CLASSES: () => classes };
  if (name === './native-dom') return helpers;
  throw new Error(`Unexpected native ownership dependency: ${name}`);
} });
vm.runInContext(ts.transpileModule(fs.readFileSync(process.env.LIBRARY_DETAILS_SOURCE || 'frontend/steam/library-details.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const library = context.exports;
const shortcut = 3000000001, nextShortcut = 3000000002, publicApp = 123;
let checks = 0;
function check(actual, expected, message) { assert.equal(actual, expected, message); checks++; }
function fiber(tag = 0, memoizedProps = {}) {
  return { tag, memoizedProps, pendingProps: memoizedProps, flags: 0, return: null,
    alternate: null, child: null, sibling: null, stateNode: null };
}
function append(parent, child) {
  child.return = parent;
  if (!parent.child) parent.child = child;
  else { let sibling = parent.child; while (sibling.sibling) sibling = sibling.sibling; sibling.sibling = child; }
  return child;
}
function pair(a, b) { a.alternate = b; b.alternate = a; }
function roots(currentIndex = 0) {
  const a = fiber(3), b = fiber(3); pair(a, b);
  const state = { current: currentIndex === 0 ? a : b };
  a.stateNode = b.stateNode = state;
  return [a, b];
}
function element(host, className = classes.Container) {
  return { className, __reactFiber$regression: host, isConnected: true, parentElement: null,
    hasAttribute: () => false, closest: () => null };
}
function nativeOwnership(host) {
  for (let depth = 0, current = host; current && depth < 128; depth++) {
    current = nativeCurrent(current);
    if (!current) return null;
    const props = current.memoizedProps;
    for (const value of [props?.overview?.appid, props?.appOverview?.appid, props?.details?.unAppID,
      props?.appid, props?.appId, props?.nAppID]) {
      if (value === null || value === undefined) continue;
      const id = Number(value);
      if (Number.isInteger(id) && id !== 0 && id >= -2147483648 && id <= 4294967295) return id < 0 ? id >>> 0 : id;
    }
    current = current.return;
  }
  return null;
}
function verify(host, expected, label) {
  if (nativeCurrent) check(nativeOwnership(host), expected, `${label}: the actual installed React algorithm establishes ownership`);
  check(library.committedHeaderAppId(element(host)), expected, `${label}: plugin agrees with installed React`);
}

// A native HostComponent holds className, not a fabricated overview prop. The
// semantic app identity belongs to the surrounding AppDetails component.
{
  const [root] = roots();
  const owner = append(root, fiber(0, { overview: { appid: shortcut } }));
  const host = append(owner, fiber(5, { className: classes.Container }));
  verify(host, shortcut, 'Initial committed shortcut host');
  owner.pendingProps = { overview: { appid: nextShortcut } };
  host.pendingProps = { appid: publicApp };
  verify(host, shortcut, 'Pending props cannot replace painted ownership');
}

function sharedBailout(id = shortcut, previousId = id, withAlternate = false) {
  const [oldRoot, currentRoot] = roots(1);
  const oldOwner = append(oldRoot, fiber(0, { overview: { appid: previousId } }));
  const currentOwner = append(currentRoot, fiber(0, { overview: { appid: id } }));
  pair(oldOwner, currentOwner);
  const host = append(oldOwner, fiber(5, { className: classes.Container }));
  currentOwner.child = host;
  if (withAlternate) {
    const staleHost = fiber(5, { className: 'StaleHost' });
    staleHost.return = currentOwner; pair(host, staleHost);
  }
  return { host, currentOwner, oldOwner, oldRoot, currentRoot };
}
{
  const shared = sharedBailout();
  if (nativeCurrent) check(nativeCurrent(shared.host), shared.host, 'Native React accepts a shared mounted child without an alternate');
  verify(shared.host, shortcut, 'Bailout child whose return path reaches the previous root');
  const stats = element(shared.host, classes.GameStatsSection), bar = element(shared.host);
  const doc = { elements: [bar, stats], defaultView: { getComputedStyle: () => ({ opacity: '1', visibility: 'visible', display: 'flex' }) } };
  check(library.paintedNativePlaybar(doc, shortcut), bar, 'The exact shared host remains eligible for Cloud and game-info chrome');
  check(library.paintedNativeStats(doc, shortcut)[0], stats, 'The exact shared statistics host remains eligible for achievement/playtime chrome');
  check(library.paintedNativePlaybar(doc, publicApp), null, 'A shortcut host cannot be mistaken for a native game');
  check(library.paintedNativeStats(doc, nextShortcut).length, 0, 'A shortcut host cannot receive a sibling game stat');
  bar.painted = false; stats.painted = false;
  check(library.paintedNativePlaybar(doc, shortcut), null, 'A valid React owner does not make an unpainted sticky playbar eligible');
}
{
  const shared = sharedBailout(shortcut, publicApp, true);
  if (nativeCurrent) check(nativeCurrent(shared.host), shared.host, 'Shared child-list membership wins over the alternate return path');
  verify(shared.host, shortcut, 'Each owner ancestor is resolved against current, not its stale return path');
}
{
  const shared = sharedBailout(shortcut, publicApp);
  verify(shared.host, shortcut, 'A shared host without an alternate resolves its current semantic owner');
}
{
  const [oldRoot, currentRoot] = roots(1);
  const oldOwner = append(oldRoot, fiber(0, { overview: { appid: publicApp } }));
  const currentOwner = append(currentRoot, fiber(0, { details: { unAppID: shortcut } }));
  pair(oldOwner, currentOwner);
  const oldHost = append(oldOwner, fiber(5, { className: classes.Container }));
  const currentHost = append(currentOwner, fiber(5, { className: classes.Container }));
  pair(oldHost, currentHost);
  verify(oldHost, shortcut, 'DOM attachment still references the previous host alternate');
}
{
  const [root] = roots();
  let parent = append(root, fiber(0, { appOverview: { appid: shortcut } }));
  for (let index = 0; index < 24; index++) parent = append(parent, fiber(0, { children: null }));
  const host = append(parent, fiber(5, { className: classes.GameStatsSection }));
  verify(host, shortcut, '24 context/provider/observer wrappers do not erase native ownership');
}
{
  const native = sharedBailout(publicApp);
  verify(native.host, publicApp, 'Public Steam app retains its exact own committed identity');
  const bar = element(native.host), stats = element(native.host, classes.GameStatsSection);
  const doc = { elements: [bar, stats], defaultView: { getComputedStyle: () => ({ opacity: '1', visibility: 'visible', display: 'flex' }) } };
  check(library.paintedNativePlaybar(doc, shortcut), null, 'Shortcut route ahead of a native DOM commit cannot authorize Cloud/info writes');
  check(library.paintedNativeStats(doc, shortcut).length, 0, 'Shortcut route ahead of a native DOM commit cannot authorize achievement/playtime writes');
}
{
  const detached = fiber(5, { overview: { appid: shortcut } });
  check(library.committedHeaderAppId(element(detached)), null, 'Unattached fibers never prove shortcut ownership');
  const [root] = roots();
  const pending = append(root, fiber(5, { overview: { appid: shortcut } })); pending.flags = 2;
  if (nativeCurrent) check(nativeCurrent(pending), null, 'Installed React rejects a not-yet-committed placement');
  check(library.committedHeaderAppId(element(pending)), null, 'Not-yet-committed placement fibers cannot authorize plugin writes');
  const cyclic = fiber(5); cyclic.return = cyclic;
  check(library.committedHeaderAppId(element(cyclic)), null, 'Malformed cyclic fibers are rejected with a bounded walk');
}

console.log(`Library details passed: ${checks} checks${nativeCurrent ? ' including the installed React 19.1.1 reconciler oracle' : '; installed Steam React oracle unavailable'}; shared bailout trees, alternate/current ancestry, real semantic props, deep owners, native isolation and unmounted fibers.`);
