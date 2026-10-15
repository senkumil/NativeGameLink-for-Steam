import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { nativeWindowOracle } from './helpers/native-window-oracle.mjs';

const oracle = nativeWindowOracle();
let checks = 0, clock = 1000;
const check = (value, message) => { assert(value, message); checks++; };
const retired = (operation, message) => { assert.throws(operation, /Document was retired/, message); checks++; };
function documentRealm(name, reused) {
  const view = reused || { closed: false }, listeners = new Map();
  view.location = { pathname: '/index.html', href: `https://steamloopback.host/index.html?${name}` };
  view.addEventListener = (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
  };
  view.removeEventListener = (event, listener) => listeners.get(event)?.delete(listener);
  const doc = { defaultView: view, body: { isConnected: true } }; view.document = doc;
  return { view, doc, listeners,
    beforeUnload() { for (const fn of [...(listeners.get('beforeunload') || [])]) fn({ type: 'beforeunload' }); },
    unload() { for (const fn of [...(listeners.get('unload') || [])]) fn({ type: 'unload' }); },
  };
}
function nativeBootstrap(realm, factories, initialized = new Map()) {
  const privateCache = new Map([...initialized].map(([id, exports]) => [String(id), { exports }]));
  let probes = 0;
  const executions = [];
  const req = id => {
    id = String(id);
    if (privateCache.has(id)) return privateCache.get(id).exports;
    const factory = req.m[id];
    if (!factory) throw Error(`Missing native factory ${id}`);
    executions.push(id); const mod = { exports: {} }; privateCache.set(id, mod);
    factory(mod, mod.exports, req); return mod.exports;
  };
  req.m = factories; req.e = async id => `chunk:${id}`;
  realm.view.webpackChunksteamui = { push(chunk) { probes++; chunk[2](req); } };
  return { req, privateCache, executions, get probes() { return probes; } };
}

const source = documentRealm('SharedJSContext'), popup = documentRealm('BigPicture'), second = documentRealm('DesktopPopup');
const foreign = documentRealm('ForeignOverlay'); foreign.view.opener = source.view;
const instances = [popup, second].map(({ view }) => ({ BrowserWindow: view, LocationPathName: '/library', IsMainGamepadUIWindow: true }));
const windowStore = { SteamUIWindows: instances, GetWindowInstanceFromWindow: oracle.lookup };
const storeExports = { oy: { WindowStore: windowStore } }, react = { owner: 'shared native React' };
const registry = new Map([[oracle.id, storeExports], ['51745', react], ['not-a-factory', { shouldNeverTransfer: true }]]);
const ownerStoreFactory = mod => { mod.exports = storeExports; };
ownerStoreFactory.toString = () => oracle.factorySource;
const bootstrap = nativeBootstrap(source, {
  [oracle.id]: ownerStoreFactory,
  51745(mod) { mod.exports = react; },
  98131(mod) { mod.exports = { owner: 'shared native renderer', createRoot() {} }; },
  99001() { throw Error('Unrelated native store must never initialize'); },
}, registry);
const logs = [];
const context = vm.createContext({
  exports: {}, window: source.view,
  Date: class extends Date { static now() { return clock; } },
  require(name) {
    if (name === '@steambrew/client') return { modules: registry };
    if (name === '../../api/backend') return { backendLog(message) { logs.push(message); } };
    throw Error(`Unexpected runtime dependency ${name}`);
  },
});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/modules/SteamWebpackRuntime.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const runtime = context.exports.steamWebpackRuntime;
let proofCalls = 0;
const proof = realm => () => {
  proofCalls++;
  const instance = windowStore.GetWindowInstanceFromWindow(realm.view);
  return instance?.BrowserWindow === realm.view;
};

check(runtime.captureRuntime(source.doc) && bootstrap.req.c === undefined, 'Real shared owner uses .m with a private module cache');
check(runtime.getAllModules(source.doc).length === 2 && bootstrap.executions.length === 0,
  'Shared owner seeds only actual loaded registry entries with matching native factories');
check(runtime.getRequire(popup.doc) === null && runtime.getAllModules(popup.doc).length === 0,
  'A /index.html popup without local Webpack is denied before explicit native ownership authorization');
check(!runtime.authorizeSharedDocumentRuntime(foreign.doc, source.doc, proof(foreign)) && runtime.getRequire(foreign.doc) === null,
  'An opener and common CEF shell URL do not authorize an unrelated overlay');
check(!runtime.authorizeSharedDocumentRuntime(popup.doc, source.doc, () => false), 'A false native ownership proof denies sharing');
check(!runtime.authorizeSharedDocumentRuntime(popup.doc, source.doc, () => { throw Error('retired native store'); }),
  'An unavailable native ownership lookup denies sharing');
check(runtime.authorizeSharedDocumentRuntime(popup.doc, source.doc, proof(popup)),
  'Installed Steam exact BrowserWindow lookup explicitly authorizes the empty Big Picture popup');
const shared = runtime.getRequire(popup.doc), initialLease = runtime.getRuntimeIdentity(popup.doc);
check(shared !== bootstrap.req && shared !== runtime.getRequire(source.doc) && shared.m === bootstrap.req.m,
  'Shared popup gets a distinct revocable require while preserving the verified native factory table');
check(initialLease !== runtime.getRuntimeIdentity(source.doc), 'Popup and owner always have distinct Document lease identities');
check(runtime.getAllModules(popup.doc).some(entry => entry.exports === storeExports)
  && runtime.getAllModules(popup.doc).some(entry => entry.exports === react),
  'Already loaded owner WindowStore and React exports are copied into the authorized popup cache');
check(shared(98131).owner === 'shared native renderer' && bootstrap.executions.join(',') === '98131',
  'Authorized shared require loads only the selected native renderer factory');
check(runtime.getRuntimeIdentity(popup.doc) === initialLease && runtime.getAllModules(source.doc).some(entry => entry.id === '98131'),
  'Lazy shared presentation acquisition remains visible to the source without invalidating its first render');
const sourceProbes = bootstrap.probes, beforeProofs = proofCalls;
let pendingPopupProbes = 0;
popup.view.webpackChunksteamui = { push() { pendingPopupProbes++; } };
const warmState = runtime.states.get(popup.view), warmModules = warmState.moduleCache, warmFactories = warmState.loadedFactories;
for (let i = 0; i < 100; i++) {
  check(runtime.getRequire(popup.doc) === shared && shared(51745) === react && shared.m === bootstrap.req.m,
    'Repeated popup accesses keep the verified native runtime');
}
check(bootstrap.probes === sourceProbes && proofCalls > beforeProofs,
  'Warm access rechecks ownership without repeated Webpack bootstrap probes or arbitrary factory execution');
check(warmState.moduleCache === warmModules && warmState.loadedFactories === warmFactories,
  'One hundred warm ownership checks reuse cached module/factory maps without repeated large allocations');
check(pendingPopupProbes === 1, 'An empty local chunk array is probed once across one hundred warm ownership checks');
check(runtime.authorizeSharedDocumentRuntime(popup.doc, source.doc, proof(popup))
  && runtime.getRuntimeIdentity(popup.doc) === initialLease && runtime.getRequire(popup.doc) === shared,
  'Refreshing an equivalent exact-owner proof preserves the current React lease');
check(runtime.authorizeSharedDocumentRuntime(second.doc, source.doc, proof(second)), 'A second explicitly owned popup can share the native runtime');
const otherShared = runtime.getRequire(second.doc);
check(otherShared !== shared && runtime.getRuntimeIdentity(second.doc) !== initialLease, 'Two owned popup Documents retain independent leases');

const heldChunk = shared.e;
const heldBoundRequire = shared.bind(null, 51745), heldApply = shared.apply;
check(heldBoundRequire() === react && heldApply(null, [51745]) === react,
  'Native call/apply/bind preserve the authorized require receiver and lazy export tracking');
instances.splice(instances.findIndex(instance => instance.BrowserWindow === popup.view), 1);
retired(() => shared(51745), 'Removing the exact native WindowInstance revokes held require calls');
retired(() => shared.m, 'Removing the exact native WindowInstance revokes held require property access');
retired(() => heldChunk(9), 'Removing the exact native WindowInstance revokes retained require methods');
retired(() => heldBoundRequire(), 'Removing native ownership revokes a require created through Function.prototype.bind');
retired(() => heldApply(null, [51745]), 'Removing native ownership revokes retained Function.prototype.apply');
check(runtime.getRequire(popup.doc) === null && runtime.getAllModules(popup.doc).length === 0,
  'An unregistered popup cannot inspect stale modules through a public runtime accessor');
check(otherShared(51745) === react, 'Revoking one popup does not affect the other exact native owner');
instances.push({ BrowserWindow: popup.view, LocationPathName: '/library', IsMainGamepadUIWindow: true });
const renewed = runtime.getRequire(popup.doc);
check(renewed !== shared && renewed(51745) === react && runtime.getRuntimeIdentity(popup.doc) !== initialLease,
  'A newly proven same-Document registration acquires a new lease');
retired(() => shared(51745), 'The old require never revives after an A/B/A native registration');

const sourceIdentity = runtime.getRuntimeIdentity(source.doc), popupIdentity = runtime.getRuntimeIdentity(popup.doc);
bootstrap.req.m[51745] = mod => { mod.exports = { owner: 'replacement shared React' }; };
bootstrap.privateCache.delete('51745');
retired(() => renewed(51745), 'Replacing an already loaded source factory revokes held popup requires');
check(runtime.getRuntimeIdentity(source.doc) !== sourceIdentity, 'Source factory replacement rotates its native runtime identity');
const refreshed = runtime.getRequire(popup.doc);
check(refreshed !== renewed && runtime.getRuntimeIdentity(popup.doc) !== popupIdentity
  && refreshed(51745).owner === 'replacement shared React',
  'The still exact-owned popup reacquires the new source identity and native React export');
const beforeInvalidation = runtime.getRequire(popup.doc);
runtime.invalidate(source.doc);
retired(() => beforeInvalidation(51745), 'Explicit source runtime invalidation immediately revokes a retained popup require');
const afterInvalidation = runtime.getRequire(popup.doc);
check(afterInvalidation !== beforeInvalidation && afterInvalidation(51745).owner === 'replacement shared React',
  'The source can be recaptured and shared again only under the live exact-window proof');

const independent = documentRealm('IndependentCEF');
instances.push({ BrowserWindow: independent.view });
const independentBootstrap = nativeBootstrap(independent, { 51745(mod) { mod.exports = { owner: 'independent native React' }; } });
check(!runtime.authorizeSharedDocumentRuntime(independent.doc, source.doc, proof(independent)),
  'Explicit proof never overrides an independently bootstrapped CEF');
check(runtime.getRequire(independent.doc)(51745).owner === 'independent native React' && independentBootstrap.probes === 1,
  'Independent CEF keeps its own native require and exports');
const transitioning = documentRealm('LateLocalBootstrap'); instances.push({ BrowserWindow: transitioning.view });
check(runtime.authorizeSharedDocumentRuntime(transitioning.doc, source.doc, proof(transitioning)), 'A proven popup starts with shared CEF bootstrap');
const previousShared = runtime.getRequire(transitioning.doc);
nativeBootstrap(transitioning, { 51745(mod) { mod.exports = { owner: 'late local React' }; } });
check(runtime.getRequire(transitioning.doc)(51745).owner === 'late local React', 'A subsequently exposed local CEF bootstrap takes immediate precedence');
retired(() => previousShared(51745), 'Acquiring a local bootstrap retires every previously shared require');

const closed = documentRealm('ClosedPopup'); instances.push({ BrowserWindow: closed.view });
check(runtime.authorizeSharedDocumentRuntime(closed.doc, source.doc, proof(closed)), 'A live exact-owned popup can authorize');
const closedRequire = runtime.getRequire(closed.doc); closed.view.closed = true;
retired(() => closedRequire(51745), 'A closed target Window revokes held shared access');
check(runtime.getRequire(closed.doc) === null, 'Closed target cannot resolve shared modules');
const replaced = documentRealm('ReplacedPopup'); instances.push({ BrowserWindow: replaced.view });
check(runtime.authorizeSharedDocumentRuntime(replaced.doc, source.doc, proof(replaced)), 'An exact-owned Document can authorize before replacement');
const replacedRequire = runtime.getRequire(replaced.doc), replacement = documentRealm('NextPopupDocument', replaced.view);
retired(() => replacedRequire(51745), 'Replacing a target Document revokes its old shared require');
check(runtime.getRequire(replaced.doc) === null && runtime.getRequire(replacement.doc) === null,
  'Authorization cannot silently transfer to a same-Window successor Document');
check(runtime.authorizeSharedDocumentRuntime(replacement.doc, source.doc, proof(replacement)) && runtime.getRequire(replacement.doc)(51745),
  'A same-Window successor requires a fresh explicit native ownership authorization');
const unloaded = documentRealm('UnloadedPopup'); instances.push({ BrowserWindow: unloaded.view });
check(runtime.authorizeSharedDocumentRuntime(unloaded.doc, source.doc, proof(unloaded)), 'A live popup authorizes before its unload');
const unloadedRequire = runtime.getRequire(unloaded.doc); unloaded.beforeUnload();
retired(() => unloadedRequire(51745), 'Target beforeunload permanently retires its Document lease');
check(runtime.getRequire(unloaded.doc) === null, 'An unloading target Document cannot reacquire a shared runtime');

const duringClose = runtime.getRequire(popup.doc); source.view.closed = true;
retired(() => duringClose(51745), 'Closing the shared owner Window revokes every held popup require');
check(runtime.getRequire(popup.doc) === null && runtime.getAllModules(second.doc).length === 0,
  'Source closure prevents every authorized popup from borrowing retired native exports');
source.view.closed = false;
const beforeSourceReplacement = runtime.getRequire(popup.doc);
const successorSource = documentRealm('NextSharedJSContext', source.view);
retired(() => beforeSourceReplacement(51745), 'Replacing the shared owner Document revokes held popup requires');
check(runtime.getRequire(popup.doc) === null, 'Old ownership authorization cannot transfer to a successor shared source Document');
const nextBootstrap = nativeBootstrap(successorSource, {
  [oracle.id]: ownerStoreFactory,
  51745(mod) { mod.exports = { owner: 'successor shared React' }; },
});
check(runtime.authorizeSharedDocumentRuntime(popup.doc, successorSource.doc, proof(popup))
  && runtime.getRequire(popup.doc)(51745).owner === 'successor shared React' && nextBootstrap.probes === 1,
  'A fresh exact-window proof can explicitly bind the successor source Document');
const beforeOwnerUnload = runtime.getRequire(popup.doc); successorSource.unload();
retired(() => beforeOwnerUnload(51745), 'Shared owner actual unload revokes retained popup requires');
check(runtime.getRequire(popup.doc) === null, 'An unloading source Document cannot be recaptured from a lingering chunk array');
check(!bootstrap.executions.includes('99001'), 'Shared ownership never initializes unrelated native stores');
console.log(`Webpack shared CEF ownership passed: ${checks} checks; actual native lookup, private cache, explicit leases, source renewal and retired-window rejection.`);
