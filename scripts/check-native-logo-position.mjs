import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assetDeadlineRuntime } from './helpers/asset-deadline-runtime.mjs';

const ID = 3300000001;
const position = { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 50 };
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const source = compile('frontend/features/library/native-logo-position.ts');
const bridgeSource = compile('frontend/features/library/steam-bridge.ts');
const nativeBundle = 'C:/Program Files (x86)/Steam/steamui/chunk~2dcc5aaf7.js';
let nativeSaveSource = null;
let nativeCacheContract = null;
if (fs.existsSync(nativeBundle)) {
  const installed = fs.readFileSync(nativeBundle, 'utf8');
  const start = installed.indexOf('async SaveCustomLogoPosition(e,t){');
  const end = installed.indexOf('ClearCustomLogoPosition(e)', start);
  assert(start >= 0 && end > start, 'Find the installed native logo save contract');
  nativeSaveSource = installed.slice(start, end);
  assert(nativeSaveSource.includes('customImageInfoRtime') && nativeSaveSource.includes('SetCachedDataForApp'),
    'The native contract updates its own exact-app custom image cache');
  const ast = ts.createSourceFile('native-logo-fixture.js', `({${nativeSaveSource}})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const cacheCalls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'SetCachedDataForApp') cacheCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(cacheCalls.length, 1, 'Resolve exactly one semantic native cache call');
  const call = cacheCalls[0], path = [];
  let owner = call.expression.expression;
  while (ts.isPropertyAccessExpression(owner)) { path.unshift(owner.name.text); owner = owner.expression; }
  assert(ts.isIdentifier(owner), 'The native cache owner has an explicit module binding');
  const key = call.arguments[1];
  assert(ts.isIdentifier(key) || ts.isStringLiteral(key), 'The native cache namespace is an explicit binding or literal');
  nativeCacheContract = { owner: owner.text, path, namespace: ts.isIdentifier(key) ? key.text : null };
}

let checks = 0;
const check = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
function harness({ runtime = false, missingDetails = false, missingApps = false, nativeResult = 'native', rawResult = Promise.resolve(), wrongId = null, forceTimeout = false } = {}) {
  const nativeCalls = [], rawCalls = [], cacheWrites = [], probes = [];
  const data = {};
  const overview = Object.freeze({ appid: wrongId ?? ID, rt_custom_image_mtime: 97 });
  const SteamClient = { Apps: { SetCustomLogoPositionForApp(id, json) {
    check(this, SteamClient.Apps, 'Steam bridge keeps its receiver');
    rawCalls.push({ id, payload: JSON.parse(json) });
    return rawResult;
  } } };
  const nativeBindings = { SteamClient };
  if (nativeCacheContract) {
    let cache = nativeBindings[nativeCacheContract.owner] = {};
    for (const key of nativeCacheContract.path) cache = cache[key] = {};
    cache.SetCachedDataForApp = (...args) => { cacheWrites.push(args); };
    if (nativeCacheContract.namespace) nativeBindings[nativeCacheContract.namespace] = 'customimage';
  }
  const installedNativeSave = nativeSaveSource && new Function(...Object.keys(nativeBindings),
    `return ({${nativeSaveSource}}).SaveCustomLogoPosition;`)(...Object.values(nativeBindings));
  const details = { GetAppData(id) { check(id, ID, 'Native cache belongs only to the shortcut'); return data; },
    SaveCustomLogoPosition(currentOverview, selectedPosition) {
      check(this, details, 'Native store keeps its receiver');
      nativeCalls.push({ overview: currentOverview, position: selectedPosition });
      if (nativeResult !== 'native') return typeof nativeResult === 'function' ? nativeResult() : nativeResult;
      if (installedNativeSave) return installedNativeSave.call(this, currentOverview, selectedPosition);
      return SteamClient.Apps.SetCustomLogoPositionForApp(currentOverview.appid, JSON.stringify({ nVersion: 1, logoPosition: selectedPosition })).then(() => {
        data.customImageInfo = { nVersion: 1, logoPosition: selectedPosition };
        data.customImageInfoRtime = currentOverview.rt_custom_image_mtime;
        cacheWrites.push([currentOverview.appid, 'customimage', 1, data.customImageInfo]);
      });
    } };
  const apps = { GetAppOverviewByAppID(id) { check(this, apps, 'App store keeps its receiver'); check(id, ID, 'Look up only the exact unsigned shortcut'); return overview; } };
  const window = { closed: false, SteamClient };
  const document = { defaultView: window }; window.document = document;
  if (!runtime && !missingDetails) window.appDetailsStore = details;
  if (!runtime && !missingApps) window.appStore = apps;
  const bridgeContext = vm.createContext({ exports: {}, setTimeout: forceTimeout ? fn => setTimeout(fn, 0) : setTimeout, clearTimeout });
  vm.runInContext(bridgeSource, bridgeContext);
  const dependencies = {
    './native-asset-write': assetDeadlineRuntime({ setTimeout: forceTimeout ? fn => setTimeout(fn, 0) : setTimeout }),
    './steam-bridge': bridgeContext.exports,
    '../../steam/modules/SteamWebpackRuntime': { steamWebpackRuntime: {
      captureRuntime(doc) { check(doc, document, 'Resolve only the calling document'); probes.push('capture'); },
      getRequire(doc) {
        check(doc, document, 'Require belongs to the calling document');
        return id => {
          probes.push(id);
          if (id === 78057) return missingDetails ? undefined : { H: details };
          if (id === 1776) return missingApps ? undefined : { tw: apps };
          throw new Error(`Unexpected native module ${id}`);
        };
      },
    } },
  };
  const context = vm.createContext({ exports: {}, window, require: name => {
    assert(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  } });
  vm.runInContext(source, context);
  return { save: context.exports.saveNativeShortcutLogoPosition, nativeCalls, rawCalls, cacheWrites, data, overview, window, probes, details };
}

{
  const h = harness();
  check(await h.save(ID, position, () => true), true, 'The native Promise<void> save succeeds');
  check(h.nativeCalls.length, 1, 'Call the native method once');
  check(h.rawCalls.length, 1, 'The native store makes its own single bridge call');
  check(h.cacheWrites.length, 1, 'The native method updates its own cache');
  check(h.nativeCalls[0].overview, h.overview, 'Pass the real exact overview rather than synthesizing one');
  check(h.data.customImageInfo.logoPosition, position, 'Steam cache retains the final position');
  check(h.data.customImageInfoRtime, 97, 'Steam cache retains its own current native mtime');
}
{
  const h = harness({ runtime: true });
  check(await h.save(ID, position, () => true), true, 'Resolve the native modules for the calling realm');
  assert.deepEqual(h.probes, ['capture', 78057, 1776]); checks++;
}
for (const missing of [{ missingDetails: true }, { missingApps: true }, { missingDetails: true, missingApps: true }]) {
  const h = harness(missing);
  check(await h.save(ID, position, () => true), true, 'Use one raw bridge call when the native method/store is unavailable');
  check(h.nativeCalls.length, 0, 'Unavailable native path is not called');
  check(h.rawCalls.length, 1, 'Fallback saves exactly once');
  check(h.cacheWrites.length, 0, 'Fallback never writes private native caches');
  assert.deepEqual(h.rawCalls[0].payload, { nVersion: 1, logoPosition: position }); checks++;
}
for (const id of [0, 123, 2147483647, -994967295, 4294967296, NaN, ID + 0.5]) {
  const h = harness();
  check(await h.save(id, position, () => true), false, 'Reject public, signed or invalid IDs');
  check(h.nativeCalls.length + h.rawCalls.length + h.probes.length, 0, 'Invalid targets never resolve stores or save');
}
for (const wrongId of [123, ID + 1, ID - 4294967296]) {
  const h = harness({ wrongId });
  check(await h.save(ID, position, () => true), false, 'Reject mismatched overviews');
  check(h.nativeCalls.length + h.rawCalls.length, 0, 'Do not fall through to raw save for a mismatched overview');
}
{
  const h = harness();
  check(await h.save(ID, position, () => false), false, 'Reject stale work before lookup');
  check(h.nativeCalls.length + h.rawCalls.length + h.probes.length, 0, 'Initially stale work has no side effects');
  let validations = 0;
  check(await h.save(ID, position, () => ++validations < 2), false, 'Revalidate after resolving the native overview');
  check(h.nativeCalls.length + h.rawCalls.length, 0, 'Work superseded during lookup never saves');
}
for (const nativeResult of [undefined, true, Promise.resolve()]) {
  const h = harness({ nativeResult: () => nativeResult });
  check(await h.save(ID, position, () => true), true, 'Accept void, true and Promise<void> native completions');
  check(h.nativeCalls.length, 1, 'Successful native results do not fall through');
  check(h.rawCalls.length, 0, 'No duplicate fallback operation');
}
for (const nativeResult of [() => false, () => Promise.resolve(false), () => Promise.reject(new Error('rejected')), () => { throw new Error('thrown'); }]) {
  const h = harness({ nativeResult });
  check(await h.save(ID, position, () => true), false, 'Reject failed native saves without a duplicate raw fallback');
  check(h.nativeCalls.length, 1, 'Failed native method is dispatched once');
  check(h.rawCalls.length, 0, 'Failed native method is not duplicated by raw fallback');
}
{
  const h = harness({ nativeResult: new Promise(() => {}), forceTimeout: true });
  check(await h.save(ID, position, () => true), false, 'Bound a pending native operation with the bridge timeout');
  check(h.nativeCalls.length, 1, 'Timed out native method is dispatched once');
  check(h.rawCalls.length, 0, 'Do not dispatch a second save after a timeout');
}
for (const raw of [false, Promise.resolve(false), Promise.reject(new Error('rejected'))]) {
  const h = harness({ missingDetails: true, rawResult: raw });
  check(await h.save(ID, position, () => true), false, 'Reject false, resolved-false and rejected raw saves');
  check(h.rawCalls.length, 1, 'Failed fallback still calls the bridge only once');
}
{
  let finish;
  const h = harness({ nativeResult: new Promise(resolve => { finish = resolve; }) });
  let current = true;
  const operation = h.save(ID, position, () => current);
  current = false; finish();
  check(await operation, false, 'A completed obsolete save must not be marked current');
  check(h.nativeCalls.length, 1, 'The already dispatched native save is not duplicated');
}
{
  const h = harness(); h.window.closed = true;
  check(await h.save(ID, position, () => true), false, 'Closed windows cannot save');
  check(h.nativeCalls.length + h.rawCalls.length, 0, 'Closed windows cause no writes');
}
console.log(`Native logo position passed: ${checks} checks${nativeSaveSource ? ' using the installed Steam save method' : ''}.`);
