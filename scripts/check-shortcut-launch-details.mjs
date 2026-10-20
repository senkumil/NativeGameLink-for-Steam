import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const id = 3000000001;
const signedId = id - 4294967296;
const executable = 'E:\\Juegos\\Battlefield 3\\bf3.exe';
const details = () => ({ unAppID: id, strDisplayName: 'bf3', strShortcutExe: executable,
 strShortcutStartDir: 'E:\\Juegos\\Battlefield 3', strLaunchOptions: '' });
const source = fs.readFileSync('frontend/steam/shortcut-details.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
 module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;
let assertions = 0;
function check(actual, expected, message) { assertions++; assert.equal(actual, expected, message); }
function harness(globalWindow = {}) {
 const context = vm.createContext({ exports: {}, window: globalWindow, setTimeout, clearTimeout });
 vm.runInContext(compiled, context);
 return context.exports;
}

{
 const raw = details();
 const overview = Object.freeze({ appid: id, display_name: 'bf3', BIsShortcut: () => true });
 const owner = { appStore: { GetAppOverviewByAppID: () => overview },
  appDetailsStore: { GetAppDetails: lookup => { check(lookup, id, 'Details lookup uses the unsigned shortcut ID'); return raw; } } };
 const api = harness({ appDetailsStore: { GetAppDetails() { throw Error('Wrong window'); } } });
 check(api.readShortcutLaunchDetails(id, { defaultView: owner }), raw, 'Read the raw native details object');
 check(api.readShortcutLaunchDetails(signedId, { defaultView: owner }), raw, 'Signed identity resolves to the same exact native details row');
 check(overview.strShortcutExe, undefined, 'Never mutate the live observable overview');
 check(api.readShortcutLaunchDetails(id, { defaultView: null }), null, 'A detached owner never falls through to another window');
 check(api.readShortcutLaunchDetails(1238820, { defaultView: owner }), null, 'Native Steam apps cannot become shortcut identities');
}
{
 const raw = details();
 let subscriptions = 0;
 const owner = { appDetailsStore: { GetAppDetails: () => raw },
  SteamClient: { Apps: { RegisterForAppDetails() { subscriptions++; throw Error('Unexpected subscription'); } } } };
 const api = harness(owner);
 check(await api.readFreshShortcutLaunchDetails(id), raw, 'Complete native details resolve without subscribing');
 check(subscriptions, 0, 'A cached launch definition does not add native listeners');
}
{
 const wrong = { ...details(), unAppID: id + 1 };
 const api = harness({ appDetailsStore: { GetAppDetails: () => wrong } });
 check(api.readShortcutLaunchDetails(id), null, 'A store response carrying another unAppID is rejected');
}
{
 let callback;
 let releases = 0;
 const raw = details();
 const owner = { appDetailsStore: { GetAppDetails: () => ({ unAppID: id, strDisplayName: 'bf3' }) },
  SteamClient: { Apps: { RegisterForAppDetails(lookup, onDetails) {
   check(lookup, id, 'Native registration receives the unsigned shortcut AppID');
   callback = onDetails; return { unregister() { releases++; } };
  } } } };
 const api = harness();
 const pending = api.readFreshShortcutLaunchDetails(id, { defaultView: owner }, 100);
 callback({ ...details(), unAppID: id + 1 });
 callback({ strShortcutExe: 'C:\\MissingOwner.exe' });
 callback({ unAppID: id, strDisplayName: 'bf3' });
 check(releases, 0, 'Wrong IDs and incomplete callbacks keep the bounded subscription alive');
 callback(raw);
 check(await pending, raw, 'An exact native callback establishes the executable');
 check(releases, 1, 'Successful asynchronous callbacks unregister once');
 callback({ ...details(), strShortcutExe: 'C:\\Other.exe' });
 check(releases, 1, 'Late callbacks cannot reenter a completed request');
}
{
 let releases = 0;
 const raw = { ...details(), unAppID: signedId };
 const api = harness({ SteamClient: { Apps: { RegisterForAppDetails(_lookup, callback) {
  callback(raw); return { unregister() { releases++; } };
 } } } });
 check(await api.readFreshShortcutLaunchDetails(id), raw, 'A synchronous native callback can use the equivalent signed unAppID');
 check(releases, 1, 'A synchronous callback unregisters its handle once registration returns');
}
{
 let callback;
 let releases = 0;
 const api = harness({ SteamClient: { Apps: { RegisterForAppDetails(_lookup, onDetails) {
  callback = onDetails; return { unregister() { releases++; } };
 } } } });
 check(await api.readFreshShortcutLaunchDetails(id, undefined, 10), null, 'A missing native response expires');
 check(releases, 1, 'Expired native subscriptions unregister');
 callback(details());
 check(releases, 1, 'A response arriving after expiry cannot retain its subscription');
}
{
 let releases = 0;
 const api = harness({ SteamClient: { Apps: { RegisterForAppDetails(_lookup, callback) {
  callback(details()); return { unregister() { releases++; throw Error('Bridge cleanup failed'); } };
 } } } });
 check((await api.readFreshShortcutLaunchDetails(id)).strShortcutExe, executable, 'Unregister failure cannot discard verified launch data');
 check(releases, 1, 'Cleanup failure does not cause duplicate unregister');
 const failed = harness({ SteamClient: { Apps: { RegisterForAppDetails() { throw Error('Unavailable'); } } } });
 check(await failed.readFreshShortcutLaunchDetails(id), null, 'A registration error completes without keeping a timer alive');
}
{
 let otherWindowRegistrations = 0;
 const api = harness({ SteamClient: { Apps: { RegisterForAppDetails() { otherWindowRegistrations++; } } } });
 check(await api.readFreshShortcutLaunchDetails(id, { defaultView: {} }), null, 'A secondary document with no native API cannot borrow another window');
 check(await api.readFreshShortcutLaunchDetails(id, { defaultView: null }), null, 'Detached documents do not register against the global window');
 check(otherWindowRegistrations, 0, 'Only the owning document can register for its launch definition');
}
check(/GetCachedAppDetails\s*\(/.test(source), false, 'Launch identity never calls the unrelated app detail cache');
console.log(`PASS shortcut launch details: ${assertions} native-contract assertions`);
