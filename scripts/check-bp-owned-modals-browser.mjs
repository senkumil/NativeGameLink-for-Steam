import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const sources = Object.fromEntries(Object.entries({
  'media-modals': 'frontend/features/big-picture/media-modals.tsx',
  'detail-target': 'frontend/features/big-picture/detail-target.ts',
  'achievement-screen-parts': 'frontend/features/big-picture/achievement-screen-parts.ts',
  'achievement-comparison': 'frontend/features/big-picture/achievement-comparison.tsx',
  'pure-class-factory': 'frontend/steam/gamepad/components/pure-class-factory.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText]));
const chunks = { webpackChunksteamui: [] };
vm.runInNewContext(fs.readFileSync((process.env.STEAM_UI_PATH || 'C:/Program Files (x86)/Steam/steamui') + '/sp.js', 'utf8'), { self: chunks });
const artworkFactory = Object.values(Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1])))
  .find(factory => ['ArtworkModal:', 'ModalBox:', 'ArtworkModalContainer:', 'ModalArtCloseButton:'].every(token => String(factory).includes(token)));
if (!artworkFactory) throw Error('Installed native artwork modal presentation is required');
const artworkModule = { exports: {} }; artworkFactory(artworkModule);
sources.artworkCSS = 'exports.classes=' + JSON.stringify(artworkModule.exports) + ';';

await runBPBrowserScenario(sources, async fixture => {
  const { load, dependencies, client, root, A, frame, check } = fixture;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, buttons, axes: [] }] });
  const routeListeners = new Map();
  const originalAdd = window.addEventListener, originalRemove = window.removeEventListener;
  window.addEventListener = function(type, callback, options) {
    if (['popstate', 'hashchange', 'beforeunload'].includes(type)) {
      if (!routeListeners.has(type)) routeListeners.set(type, new Set()); routeListeners.get(type).add(callback);
    }
    return originalAdd.call(this, type, callback, options);
  };
  window.removeEventListener = function(type, callback, options) {
    routeListeners.get(type)?.delete(callback); return originalRemove.call(this, type, callback, options);
  };
  const listenerCount = () => [...routeListeners.values()].reduce((sum, values) => sum + values.size, 0);
  let handleCloses = 0;
  const originalShow = client.showModal;
  client.showModal = (...args) => {
    const handle = originalShow(...args);
    [...document.querySelectorAll('.fixture-modal')].at(-1)?.classList.add('fixture-backdrop');
    return { Close: () => { handleCloses++; handle.Close(); } };
  };
  let runtimeIdentity = {}, currentReact = fixture.React;
  const documentRequire = id => id === 63696 ? currentReact : fixture.nativeRequire(id);
  Object.assign(documentRequire, fixture.nativeRequire);
  for (const path of ['../../steam/modules/SteamWebpackRuntime', '../modules/SteamWebpackRuntime']) {
    Object.assign(dependencies[path].steamWebpackRuntime, { getRuntimeIdentity: () => runtimeIdentity, getRequire: () => documentRequire });
  }
  window.SP_REACTDOM = fixture.ReactDOM;
  dependencies['../library/artwork'] = { linkedShortcutPortrait: () => 'https://example.invalid/portrait.png' };
  dependencies['../playtime/service'] = { getInstantPlaytimeStats: () => null, fetchPlaytimeStats: async () => null };
  dependencies['../playtime/playtime-settings'] = { isShortcutPlaytimeTrackingEnabled: () => false };
  dependencies['../playtime/format'] = { formatPlaytimeMinutes: value => `${value} min` };
  dependencies['./detail-views'] = { createBigPictureDetailViews: () => ({ overview: {}, details: {} }) };
  dependencies['../achievements/comparison'] = { getAchievementComparisonFriends: async () => [], getFriendAchievementState: async () => new Map() };
  dependencies['../../steam/navigation'] = { openSteamNavigationUrl: () => { throw Error('A working owned modal must not fall back to external navigation'); } };
  const nav = load('navigation'), owned = load('owned'), media = load('media-modals'), actions = load('modal-actions');
  const strip = document.getElementById('tabs'), tab = strip.querySelector('button');
  const controls = new Map([['stuff', tab]]);
  const trigger = document.createElement('button'); trigger.textContent = 'Open media'; trigger.dataset.gdlFocusKey = 'media-trigger';
  root.appendChild(trigger);
  nav.installBigPictureGamepadNavigation(document, root, strip, controls, { authority: 'fallback', generation: 1, panel: root.parentElement });
  const owner = { document, shortcut: { id: A, steamAppId: '550', title: 'A' }, generation: 1 };
  const baselineObservers = fixture.observerCount(), baselineListeners = listenerCount();
  const foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog'); foreign.hidden = true;
  foreign.innerHTML = '<button data-native-close="keep">Steam unrelated dialog</button>'; document.body.appendChild(foreign);
  const foreignBefore = foreign.outerHTML;
  const modal = () => document.getElementById('gdl-bp-community-modal');
  const legacyClose = '.gdl-bp-news-modal-close,.gdl-bp-news-modal-close-btn,.gdl-bp-ach-close-trigger,.gdl-bp-fullscreen-card-close-btn';
  for (const [kind, input, empty] of [['image', 'B', true], ['video', 'Escape', false], ['image', 'Escape', false], ['video', 'B', true]]) {
    await wait(550); trigger.focus();
    if (kind === 'image') media.showNativeImageModal(owner, 'Image fixture', 'https://example.invalid/image.png', { Media: {} });
    else media.showNativeVideoModal(owner, 'Video fixture', 'abcdefghijk');
    await frame(); const inner = modal(), beforeClose = handleCloses;
    check(inner && document.querySelector('.fixture-backdrop') && !inner.querySelector(legacyClose), `${kind} opens through production owned lifecycle without a historical close selector`);
    check(listenerCount() === baselineListeners + 3 && fixture.observerCount() === baselineObservers + 2, 'An open media modal owns exactly its route listeners and two observers');
    const button = inner.querySelector('button');
    if (empty) button.hidden = true; else button.focus();
    if (input === 'B') { buttons[1].pressed = true; await wait(140); buttons[1].pressed = false; await wait(70); }
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frame();
    check(!modal() && !document.querySelector('.fixture-backdrop') && handleCloses === beforeClose + 1,
      `${input} closes the ${kind} native handle and backdrop exactly once, including the empty-focusables path`);
    check(listenerCount() === baselineListeners && fixture.observerCount() === baselineObservers, 'Close releases every media observer and route listener');
    check(!actions.closeRegisteredBigPictureModal(inner), 'The retired exact inner element no longer retains a close callback');
    check(document.activeElement === trigger, `${input} restores the captured owned media trigger`);
    check(foreign.outerHTML === foreignBefore, 'Unrelated Steam dialog markup remains byte-for-byte unchanged');
  }
  document.body.classList.add('BasicUI');
  document.documentElement.style.setProperty('--basicui-header-height', '56px');
  document.documentElement.style.setProperty('--gamepadui-current-footer-height', '48px');
  trigger.focus();
  const imageURL = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="blue"/></svg>');
  media.showNativeImageModal(owner, 'Card artwork', imageURL, { Media: {}, ArtworkModal: load('artworkCSS').classes }, true);
  await frame();
  const cardModal = modal(), image = cardModal.querySelector('img'); await image.decode(); await frame();
  const bounds = cardModal.getBoundingClientRect(), imageBounds = image.getBoundingClientRect();
  check(cardModal.dataset.gdlBpFullscreen === '1' && bounds.left === 0 && bounds.width === innerWidth
    && bounds.top === 56 && bounds.bottom === innerHeight - 48, 'Card artwork fills the Steam safe area rather than a centered compact dialog');
  check(Math.abs(imageBounds.height - 600) < 1 && imageBounds.width > 1000, 'Large card artwork keeps the native 600px height and natural widescreen ratio');
  const closeButton = cardModal.querySelector('button'), buttonBounds = closeButton.getBoundingClientRect();
  check(buttonBounds.width > bounds.width * .4 && buttonBounds.width < bounds.width * .6,
    'The native artwork close button is centered at half screen width');
  closeButton.click(); await frame();
  check(!modal() && document.activeElement === trigger, 'Closing full-screen card art restores the exact card trigger');
  check(listenerCount() === baselineListeners && fixture.observerCount() === baselineObservers,
    'The full-screen card viewer releases its entire owned lifecycle');
  check(foreign.outerHTML === foreignBefore, 'Card artwork does not alter unrelated native Steam modals');
  document.body.classList.remove('BasicUI');
  await wait(550);
  foreign.hidden = false; const visibleForeign = foreign.outerHTML, beforeForeignClose = handleCloses;
  foreign.querySelector('button').focus();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); document.dispatchEvent(escape);
  buttons[1].pressed = true; await wait(140); buttons[1].pressed = false; await frame();
  check(!escape.defaultPrevented && foreign.outerHTML === visibleForeign && handleCloses === beforeForeignClose, 'B/Escape leave a visible foreign Steam modal entirely under Steam ownership');
  foreign.remove();

  trigger.focus(); media.showNativeImageModal(owner, 'Externally closed', 'https://example.invalid/second.png', { Media: {} }); await frame();
  const externallyClosed = modal(); fixture.externalCloseLatestModal(); await frame();
  check(!modal() && !document.querySelector('.fixture-backdrop') && listenerCount() === baselineListeners
    && fixture.observerCount() === baselineObservers && !actions.closeRegisteredBigPictureModal(externallyClosed),
    'Native external unmount also unregisters the callback and releases the owned lifecycle');

  for (const replacement of ['runtime', 'renderer', 'modal-resolver']) {
    trigger.focus(); media.showNativeImageModal(owner, replacement, 'https://example.invalid/lease.png', { Media: {} }); await frame();
    const inner = modal(), beforeClose = handleCloses;
    if (replacement === 'runtime') runtimeIdentity = {};
    if (replacement === 'renderer') window.SP_REACTDOM = { createRoot: (...args) => fixture.ReactDOM.createRoot(...args) };
    if (replacement === 'modal-resolver') window.MILLENNIUM_API = { ...client, ModalRoot: props => fixture.React.createElement('div', { role: 'dialog' }, props.children) };
    const notification = document.createElement('i'); root.appendChild(notification); await frame(); notification.remove();
    check(!modal() && !document.querySelector('.fixture-backdrop') && handleCloses === beforeClose + 1,
      `A same-route ${replacement} replacement retires only the captured native modal handle`);
    check(listenerCount() === baselineListeners && fixture.observerCount() === baselineObservers && !actions.closeRegisteredBigPictureModal(inner),
      'Realm invalidation unregisters the exact callback and releases all modal resources');
    window.SP_REACTDOM = fixture.ReactDOM; window.MILLENNIUM_API = client;
  }

  const cache = load('cache'), screen = load('screen');
  const data = { found: true, appid: '550', metadata_appid: '550', total: 1, unlocked: 0, path: 'C:/A/state.json', achievements: [
    { name: 'FIRST', display_name: 'First', description: 'Local state', earned: false, earned_time: 0, hidden: false, icon: '', icon_gray: '', global_percent: 25, progress: 0, max_progress: 0 },
  ] };
  const update = { ...data, unlocked: 1, achievements: data.achievements.map(item => ({ ...item, earned: true, earned_time: 1000 })) };
  const swapReact = () => { currentReact = fixture.foreignReact; window.SP_REACT = fixture.foreignReact;
    window.SP_REACTDOM = fixture.foreignReactDOM; runtimeIdentity = {}; };
  const restoreReact = () => { currentReact = fixture.React; window.SP_REACT = fixture.React; window.SP_REACTDOM = fixture.ReactDOM; runtimeIdentity = {}; };
  cache.cacheLocalAchievements(data, '550', String(A)); trigger.focus();
  check(screen.openBigPictureAchievementsScreen(document, owner.shortcut, data), 'Achievement body opens under the captured modal React lease'); await frame();
  const retiredCallbacks = [...fixture.listeners], beforeSwapClose = handleCloses;
  swapReact();
  for (const callback of retiredCallbacks) callback({ steamAppId: '550', stateAppId: String(A), data: update });
  check(!document.getElementById('gdl-bp-achievements-screen') && handleCloses === beforeSwapClose + 1
    && fixture.listeners.size === 0 && cache.getCachedLocalAchievementsForShortcut('550', String(A)) === data,
    'A notification delivered synchronously after React/runtime replacement rejects publication and closes before any DOM observer');
  await frame();
  check(!document.querySelector('.fixture-backdrop') && listenerCount() === baselineListeners && fixture.observerCount() === baselineObservers,
    'The retired achievement renderer leaves no handle, backdrop, observer or subscription');
  restoreReact(); cache.cacheLocalAchievements(data, '550', String(A)); trigger.focus();
  check(screen.openBigPictureAchievementsScreen(document, owner.shortcut, data), 'A restored owner realm can open its own fresh achievement lease'); await frame();
  const stagedCallbacks = [...fixture.listeners], beforeStagedClose = handleCloses;
  for (const callback of stagedCallbacks) callback({ steamAppId: '550', stateAppId: String(A), data: update });
  swapReact(); await frame();
  check(!document.getElementById('gdl-bp-achievements-screen') && !document.querySelector('.fixture-backdrop')
    && fixture.listeners.size === 0 && handleCloses === beforeStagedClose + 1 && listenerCount() === baselineListeners
    && fixture.observerCount() === baselineObservers,
    'A previously queued self-update uses the old React hooks, renders no successor children and closes the retired lease');
  restoreReact();
  owned.disposeBigPictureModals(document); nav.disposeBigPictureGamepadNavigation(document); await frame();
  check(listenerCount() === 0 && fixture.observerCount() === baselineObservers, 'Final plugin teardown leaves no modal listeners or observers');
  window.addEventListener = originalAdd; window.removeEventListener = originalRemove;
  return { label: 'Big Picture owned media modal lifecycle', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: fixture.React.version };
});
