import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;
const shortcutA = 3000000001, shortcutB = 3000000002;
const linked = new Map([[shortcutA, '550'], [shortcutB, '550']]);
const mappingReads = [], overviewReads = [];
const shortcuts = {
  getMappedShortcuts(doc) {
    mappingReads.push(doc);
    return [...linked].map(([id, steamAppId]) => ({ id, steamAppId, title: 'Same title' }));
  },
  getShortcutAppById(id, doc) { overviewReads.push({ id, doc }); return { exe: `game-${id}.exe`, display_name: 'Same title' }; },
  toSignedShortcutAppId: id => id | 0,
  looseMatchTitle: (a, b) => a === b,
};
const mappings = new Proxy({}, { get: (_target, key) => linked.get(Number(String(key).replace('shortcut:', ''))) });
let verified = true;
const dependencies = {
  '../native-window-store': { getNativeWindowInstance: () => null },
  '../../core/text': { normalizeTitle: value => String(value).toLowerCase() },
  '../shortcuts': shortcuts,
  '../../core/mappings': { mappings, isMappingSnapshotVerified: () => verified, findMappingForTitle: () => '550', shortcutMappingKey: id => `shortcut:${id}` },
  '../modules/SteamWebpackRuntime': { steamWebpackRuntime: { getRequire: () => null } },
};
const contextVM = vm.createContext({ exports: {}, require: name => { assert(name in dependencies, name); return dependencies[name]; } });
vm.runInContext(compile(fs.readFileSync('frontend/steam/gamepad/GamepadContext.ts', 'utf8')), contextVM);
const { resolveActiveGameContext: resolve, isCurrentLinkedGamepadTarget: owns, normalizeGamepadAppId: normalize, collectActiveRouteValues } = contextVM.exports;

function fixture(path = `/routes/library/app/${shortcutA}`) {
  const doc = {
    URL: 'https://steamloopback.host/gamepadui', baseURI: 'https://steamloopback.host/gamepadui',
    body: { isConnected: true }, marker: shortcutB, headings: [],
    querySelector: selector => selector.includes('data-gdl-active-shortcut-id') && doc.marker !== null
      ? { getAttribute: () => String(doc.marker) } : null,
    querySelectorAll: selector => selector.startsWith('h1') ? doc.headings : [],
  };
  const view = {
    document: doc, closed: false, gamepad: true,
    location: { href: doc.URL, pathname: '/gamepadui', hash: '' },
    g_Router: { history: { location: { pathname: path } } },
  };
  doc.defaultView = view;
  return { doc, view, route: next => { view.g_Router.history.location.pathname = next; } };
}
const route = (id, prefix = '/routes/library/app/') => `${prefix}${id}`;
const f = fixture();
check(resolve(f.doc).identity.canonicalId === `${shortcutA}:550`, 'The current native route wins over an old linked marker');
check(owns(f.doc, shortcutA, '550') && !owns(f.doc, shortcutB, '550'), 'Two shortcuts sharing metadata keep separate ownership');
verified = false;
check(!owns(f.doc, shortcutA, '550'), 'An unverified mapping snapshot cannot authorize input or projection');
verified = true;
const readsBeforeInput = mappingReads.length;
for (let tick = 0; tick < 100; tick++) owns(f.doc, shortcutA, '550');
check(mappingReads.length === readsBeforeInput, 'Repeated input ownership checks never enumerate the Steam library');
check(mappingReads.every(doc => doc === f.doc) && overviewReads.every(({ doc }) => doc === f.doc), 'Identity reads use the owner Document');
for (const prefix of ['/routes/library/app/', '/library/app/', '/games/details/', '/appdetails/', '/game/']) {
  f.route(route(shortcutA, prefix));
  check(owns(f.doc, shortcutA, 550), `Supported detail route ${prefix} resolves the exact pair`);
}
f.route(`/routes/library/app/${shortcutA | 0}?tab=activity`);
check(resolve(f.doc).shortcutAppId === shortcutA && owns(f.doc, shortcutA | 0, 550), 'Signed shortcut routes normalize without changing the state key');
for (const id of [550, 105600, 1030300]) {
  f.route(route(id));
  check(resolve(f.doc).type === 'steam' && resolve(f.doc).steamAppId === id && !owns(f.doc, shortcutA, 550), 'A native destination rejects stale linked DOM');
}
linked.set(550, '999'); f.route(route(550));
check(resolve(f.doc).type === 'steam', 'Even a malformed mapping cannot claim a public AppID');
linked.delete(550);
for (const path of ['/routes/library/home', '/routes/library/all', '/routes/settings', '/routes/store']) {
  f.route(path); f.doc.URL = `https://steamloopback.host${route(shortcutA)}`;
  check(resolve(f.doc).type === 'none' && !owns(f.doc, shortcutA, 550), 'A live non-detail route wins over old URL, marker and state');
}
f.doc.URL = 'https://steamloopback.host/gamepadui';
f.route(route(shortcutA));
for (const path of ['/library/home', '/library/all', '/library/collection/123', '/library', '/routes/store', '/store', '/settings']) {
  f.view.uiStore = { GetActiveWindowInstance: () => ({ LocationPathName: `${path}?appid=${shortcutA}` }) };
  check(resolve(f.doc).type === 'none' && !owns(f.doc, shortcutA, 550), 'The current shell destination revokes a stale router and AppID query');
}
delete f.view.uiStore;
for (const path of ['/routes/store', '/store', '/routes/library/home', '/library/home', '/settings']) {
  f.route(`${path}?appid=${shortcutA}`);
  check(resolve(f.doc).type === 'none' && !owns(f.doc, shortcutA, 550), 'Non-detail routes remain non-detail when an AppID query is present');
}
f.route(route(3000000999));
check(resolve(f.doc).type === 'shortcut-unlinked' && !owns(f.doc, shortcutA, 550), 'An unlinked shortcut cannot inherit a linked marker');
for (const bad of [0, NaN, Infinity, 4294967296, -2147483649, shortcutA + .5]) {
  check(normalize(bad) === null && !owns(f.doc, bad, 550), 'Invalid IDs cannot wrap into a linked identity');
}
f.route(route(shortcutA + .5));
check(resolve(f.doc).type === 'none', 'A fractional route does not resolve its integer prefix');

const foreign = fixture(route(shortcutB));
f.route(route(550));
f.view.parent = foreign.view; f.view.top = foreign.view;
f.doc.querySelectorAll = selector => selector === 'iframe' ? [{ contentWindow: foreign.view }] : [];
check(resolve(f.doc).type === 'steam' && !collectActiveRouteValues(f.doc).some(value => value === route(shortcutB)), 'Parent, top and iframe routes cannot own another Document');
f.route('/gamepadui'); f.doc.marker = shortcutA;
check(resolve(f.doc).type === 'shortcut-linked' && !owns(f.doc, shortcutA, 550), 'A presentation-only marker never grants mutation or input ownership');
f.doc.marker = 550;
check(resolve(f.doc).type === 'none', 'An invalid public shortcut marker is not a linked identity');
f.doc.marker = shortcutA;
f.doc.baseURI = `https://steamloopback.host${route(shortcutA)}`;
check(!owns(f.doc, shortcutA, 550), 'A document base URL cannot authorize a game');
f.route(route(shortcutA));
linked.set(shortcutA, '999');
check(!owns(f.doc, shortcutA, 550) && owns(f.doc, shortcutA, 999), 'Relinking revokes the previous metadata owner immediately');
linked.set(shortcutA, '550');
for (const mutate of [() => { f.view.closed = true; }, () => { f.view.document = {}; }, () => { f.doc.body.isConnected = false; }]) {
  mutate(); check(resolve(f.doc).type === 'none' && !owns(f.doc, shortcutA, 550), 'Closed, replaced and detached documents have no ownership');
  f.view.closed = false; f.view.document = f.doc; f.doc.body.isConnected = true;
}

// Execute the actual detail-state guard and deferred patch callback. These are
// model/DOM fixtures; physical controller navigation remains a separate gate.
const timers = new Map(); let timerId = 0;
const generic = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => {} });
const moduleDependencies = new Proxy({
  '../../steam/gamepad': contextVM.exports,
  '../../steam/shortcuts': shortcuts,
  './mapped-shortcuts-cache': { getBigPictureMappedShortcuts: doc => shortcuts.getMappedShortcuts(doc) },
  '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: doc => doc.defaultView.gamepad } },
}, { get: (target, key) => target[key] || generic });
const detailsVM = vm.createContext({ exports: {}, require: name => moduleDependencies[name],
  setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
});
vm.runInContext(compile(fs.readFileSync('frontend/features/big-picture/details.ts', 'utf8') +
  '\nexport { detailStates, isLiveDetailState, applyDetailPatch, detectCurrentMappedShortcut };'), detailsVM);
const details = detailsVM.exports;
f.route('/gamepadui');
check(details.detectCurrentMappedShortcut(f.doc) === null, 'Presentation-only DOM cannot start a detail mount or controller subscription');
f.route(route(shortcutA));
check(details.detectCurrentMappedShortcut(f.doc).id === shortcutA, 'The detail mount starts only for the committed routed shortcut');
const state = { shortcut: { id: shortcutA, steamAppId: '550' }, language: 'english', generation: 1,
  root: { isConnected: true, dataset: { gdlSteamAppId: '550', gdlShortcutAppId: String(shortcutA) } },
  panel: { isConnected: true }, data: { game: null } };
details.detailStates.set(f.doc, state);
check(details.isLiveDetailState(f.doc, state), 'A live detail state requires the current exact routed target');
details.applyDetailPatch(f.doc, state, 'game', { name: 'Late result' });
check(timers.size === 1, 'A live hydration patch schedules a coalesced update');
f.route(route(550));
for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
check(state.data.game === null && timers.size === 0, 'A queued result is rejected immediately after native navigation before DOM cleanup');
f.route(route(shortcutA)); f.view.gamepad = false;
check(!details.isLiveDetailState(f.doc, state), 'Desktop cannot adopt a pending GamepadUI detail state');
f.view.gamepad = true; linked.set(shortcutA, '999');
check(!details.isLiveDetailState(f.doc, state), 'A pending detail response cannot survive relinking');
linked.set(shortcutA, '550');
details.detailStates.set(f.doc, { ...state, generation: 2 });
check(!details.isLiveDetailState(f.doc, state), 'A retired generation cannot regain authority after returning to the same shortcut');
console.log(`Big Picture foundation passed: ${checks} checks of actual route/context and deferred detail code; no Steam account writes.`);
