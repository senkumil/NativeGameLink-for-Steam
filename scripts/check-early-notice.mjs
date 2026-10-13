import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const idA = 3000000001, idB = 3000000002, idC = 3000000003;
let backendSnapshot = {
  [`shortcut:${idA}`]: '1790600', [`shortcut:${idB - 4294967296}`]: '1593500',
  'title:Shared game': '1030300', 'exe:d:/games/shared.exe': '1030300',
};
const persisted = new Map([['gdl_mappings_snapshot_v1', JSON.stringify(backendSnapshot)]]);
let getAllCalls = 0, listCalls = 0, releaseShortcuts;
const shortcuts = JSON.stringify({ ok: true, account_id: 'fixture', shortcuts: [idA, idB, idC].map(shortcut_app_id => ({ shortcut_app_id })) });
let shortcutResult = new Promise(resolve => { releaseShortcuts = resolve; });
const mappingDependencies = {
  '../api/backend': {
    getAllMappings: async () => { getAllCalls++; return JSON.stringify(backendSnapshot); },
    listShortcutsBackend: async () => { listCalls++; return shortcutResult; },
    parseMappingsResponse: raw => JSON.parse(raw), backendLog() {},
  },
  './text': { normalizeTitle: value => String(value).trim().toLowerCase() },
  './events': { nglEvents: { emit() {} } },
};
class FixtureCustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
const mappingContext = vm.createContext({ exports: {}, setTimeout, clearTimeout, CustomEvent: FixtureCustomEvent,
  localStorage: { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, String(value)) },
  window: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
  require: dependency => { assert.ok(dependency in mappingDependencies, dependency); return mappingDependencies[dependency]; },
});
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInContext(transpile('frontend/core/mappings.ts'), mappingContext);
const mappings = mappingContext.exports;

let classModules = [];
let resolutions = 0, mappingCalls = 0, routeCalls = 0;
const dismissed = new Set();
function createDocument(routeId = idA, withHead = true) {
  const styles = new Map(), attributes = new Map();
  const doc = { routeId, writes: 0 };
  const appendChild = element => { doc.writes++; styles.set(element.id, element); };
  doc.documentElement = {
    hasAttribute: name => attributes.has(name), getAttribute: name => attributes.get(name) || null,
    setAttribute: (name, value) => { doc.writes++; attributes.set(name, value); },
    removeAttribute: name => { doc.writes++; attributes.delete(name); }, appendChild,
  };
  doc.head = withHead ? { appendChild } : null;
  doc.getElementById = id => styles.get(id) || null;
  doc.createElement = tag => {
    assert.equal(tag, 'style', 'Early notice may create only its scoped stylesheet');
    return { id: '', textContent: '', remove() { doc.writes++; styles.delete(this.id); } };
  };
  doc.querySelectorAll = () => { throw Error('Early notice must not scan native DOM'); };
  doc.createTreeWalker = () => { throw Error('Early notice must not walk native text'); };
  return doc;
}
const dependencies = {
  '@steambrew/client': { findClassModule: predicate => { resolutions++; return classModules.find(predicate); } },
  '../../core/mappings': { findMappingForTitle: (title, id) => {
    mappingCalls++;
    assert.equal(title, '', 'Only an exact shortcut ID can authorize hiding, never title/executable recovery');
    return mappings.findMappingForTitle(title, id);
  } },
  '../shortcuts/dismissed': { isShortcutDismissed: id => dismissed.has(id) },
  './native-route': { routedSteamAppId: doc => { routeCalls++; return doc.routeId; } },
};
const context = vm.createContext({ exports: {}, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
vm.runInContext(transpile('frontend/features/library/early-notice.ts'), context);
const { syncEarlyLinkedNotice: sync, disposeEarlyLinkedNotice: dispose, installEarlyShortcutNoticeStyle: install } = context.exports;
const styleId = 'gdl-early-linked-notice-style', attribute = 'data-gdl-linked-route';
const fallbackRule = 'html[data-gdl-linked-route="1"] ._2jPMy2QZr8bWi6yrk5ZzHA > ._2K2bYzcKrhqLqDp0Jy6Ksz,'
  + 'html[data-gdl-linked-route="1"] ._1TGl52GwsFQg3CXUYvThP-{display:none!important}';
const doc = createDocument();
install(doc);
const style = doc.getElementById(styleId);
assert.equal(style.textContent, fallbackRule, 'Both actual native variants are covered, including module17914.Body');
assert.equal(mappingCalls + routeCalls, 0, 'Preinstallation needs no route identity or mapping');
assert.equal(doc.documentElement.hasAttribute(attribute), false, 'Preinstallation alone never hides native UI');
assert.ok(!style.textContent.includes('data-gdl-hidden') && !style.textContent.includes('Header')
  && !style.textContent.includes('PlayBar'), 'Only exact explanation leaves are concealed, without header/parent selectors');
const installationWrites = doc.writes;
install(doc);
assert.equal(doc.writes, installationWrites, 'Preinstallation is idempotent');
assert.equal(sync(doc), false, 'Persisted mappings remain unverified during cold startup');
assert.equal(doc.documentElement.hasAttribute(attribute), false);

const hydrating = mappings.loadMappings();
for (let index = 0; index < 8; index++) await Promise.resolve();
assert.equal(getAllCalls, 1);
assert.equal(listCalls, 1);
assert.equal(sync(doc), false, 'A mapping response cannot hide UI before the active shortcut registry is verified');
releaseShortcuts(shortcuts);
shortcutResult = Promise.resolve(shortcuts);
await hydrating;
assert.equal(mappings.isMappingSnapshotVerified(), true);
assert.equal(sync(doc), true, 'An exact mapping becomes eligible synchronously after verification');
assert.equal(doc.documentElement.getAttribute(attribute), '1');
assert.equal(doc.getElementById(styleId), style, 'Hydration reuses the stylesheet installed before paint');
const stableWrites = doc.writes, stableResolutions = resolutions;
for (let index = 0; index < 100; index++) assert.equal(sync(doc), true);
assert.equal(doc.writes, stableWrites, '100 observer passes do not rewrite CSS or the route marker');
assert.equal(resolutions, stableResolutions, 'Both CSS-module lookups run once per document');

doc.routeId = 1593500;
const nativeMappingCalls = mappingCalls;
assert.equal(sync(doc), false);
assert.equal(mappingCalls, nativeMappingCalls, 'Native Steam routes never enter shortcut mapping resolution');
assert.equal(doc.documentElement.hasAttribute(attribute), false, 'A native route clears the marker immediately');
assert.equal(doc.getElementById(styleId), style, 'Inactive CSS stays ready for another linked shortcut');
doc.routeId = idB;
assert.equal(sync(doc), true, 'A verified signed shortcut mapping resolves its unsigned route exactly');
assert.equal(doc.getElementById(styleId), style);
dismissed.add(idB);
assert.equal(sync(doc), false, 'Dismissed shortcuts retain their native explanation');
assert.equal(doc.documentElement.hasAttribute(attribute), false);
dismissed.clear();
doc.routeId = idC;
assert.equal(mappings.findMappingForTitle('Shared game', idC), '1030300', 'Fixture contains a real title-only mapping');
assert.equal(sync(doc), false, 'A title/executable match cannot hide an unmapped shortcut');
doc.routeId = null;
assert.equal(sync(doc), false, 'Unknown routes do not guess from an anticipated sidebar selection');
assert.equal(doc.documentElement.hasAttribute(attribute), false);

classModules = [
  { Container: 'unrelated_container', Shortcut: 'unrelated_shortcut' },
  { Container: 'native_info_container', Shortcut: 'native_info_notice native_info_extra',
    GameDescription: 'description', FeaturesList: 'features', AssociationList: 'associations' },
  { Body: 'wrong_offline_body', OfflineButton: 'offline', InnerContainer: 'inner', OfflineSectionBody: 'offline_section' },
  { Body: 'native_main_notice', OfflineButton: 'native_offline', InnerContainer: 'native_inner' },
];
const dynamicDoc = createDocument();
install(dynamicDoc);
const dynamicStyle = dynamicDoc.getElementById(styleId);
assert.ok(dynamicStyle.textContent.includes('.native_info_container > .native_info_notice.native_info_extra'),
  'The exact Game Info module can supply current classes');
assert.ok(dynamicStyle.textContent.includes('html[data-gdl-linked-route="1"] .native_main_notice'),
  'The exact main nonsteam Body module can supply its current class');
assert.ok(dynamicStyle.textContent.includes('._1TGl52GwsFQg3CXUYvThP-') && dynamicStyle.textContent.includes('._2K2bYzcKrhqLqDp0Jy6Ksz'),
  'Installed native hashes remain covered when dynamic modules are available');
assert.ok(!dynamicStyle.textContent.includes('unrelated_') && !dynamicStyle.textContent.includes('wrong_offline_body'),
  'Partial or unrelated modules cannot broaden the selector');
assert.equal(sync(dynamicDoc), true);
assert.notEqual(dynamicStyle, style, 'Documents own separate stylesheets');

classModules = [{ Container: 'unsafe{display:none}', Shortcut: 'unsafe', GameDescription: 'd', FeaturesList: 'f', AssociationList: 'a' },
  { Body: 'body:not(*)', OfflineButton: 'o', InnerContainer: 'i' }];
const invalidClasses = createDocument(idA, false);
install(invalidClasses);
assert.equal(invalidClasses.getElementById(styleId).textContent, fallbackRule, 'Invalid selectors retain exact safe hashes');
assert.equal(invalidClasses.documentElement.hasAttribute(attribute), false, 'A pre-head document can install inactive CSS safely');

backendSnapshot = {};
await mappings.loadMappings();
assert.equal(sync(dynamicDoc), false, 'An authoritative unlink removes a previously verified marker');
assert.equal(dynamicDoc.documentElement.hasAttribute(attribute), false);
assert.equal(sync(doc), false);
dispose(dynamicDoc);
const afterDispose = dynamicDoc.writes;
dispose(dynamicDoc);
assert.equal(dynamicDoc.writes, afterDispose, 'Disposal is idempotent');
assert.equal(dynamicDoc.getElementById(styleId), null);
assert.equal(sync({ documentElement: null }), false, 'A document without a root does not access route or mapping state');
install({ documentElement: null });
console.log('Early notice passed: both actual native variants, preinstalled inactive CSS, real mapping hydration/signed IDs/exact ownership, route clearing, scoped dynamic modules and 100 idempotent passes.');
