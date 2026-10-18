// Production input engine and spatial/editable helpers in a real Edge DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))); }
const sources = Object.fromEntries(['gamepad-nav', 'navigation-session', 'spatial-navigation', 'editable-target', 'modal-actions', 'native-focus'].map(name => [name,
  ts.transpileModule(fs.readFileSync(`frontend/features/big-picture/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText]));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<style>body{background:#151b23;color:white}button,input{display:block;width:220px;height:44px;margin:12px}'
    + '#tabs{display:flex}#gdl-bp-detail-root{padding:20px}#gdl-bp-focus-ring-root{position:fixed;inset:0;pointer-events:none}</style>'
    + '<nav id="tabs"></nav><main id="panel"><div id="gdl-bp-detail-root"></div></main>');
  const report = await page.evaluate(async sources => {
    let checks = 0, now = 1000, hiddenKeyboards = 0, native = true, route = 3000000001, metadata = 1790600;
    const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const originalDateNow = Date.now, originalSet = window.setTimeout, originalClear = window.clearTimeout;
    const originalFrame = window.requestAnimationFrame, originalCancelFrame = window.cancelAnimationFrame;
    const timers = new Map(), frames = new Map(); let serial = 0;
    Date.now = () => now;
    window.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
    window.clearTimeout = id => timers.delete(id);
    window.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, buttons, axes: [] }] });
    const loaded = {}, dependencies = {
      '../../steam/gamepad/components/AppDetailsNativeClasses': {
        resolveNativeAppDetailsClasses: () => ({ FocusRing: { FocusRingRoot: 'fixture-ring-root', FocusRing: 'fixture-ring' } }),
        FALLBACK_FOCUS_RING_CLASSES: {},
      },
      '../../steam/gamepad/GamepadContext': { isCurrentLinkedGamepadTarget: (_doc, shortcut, steam) =>
        Number(shortcut) === route && Number(steam) === metadata && route >= 2147483648 },
      '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => true } },
      '../../steam/gamepad/virtual-keyboard': { hideSteamVirtualKeyboard: () => { hiddenKeyboards++; return true; } },
    };
    function load(name) {
      if (loaded[name]) return loaded[name];
      const exports = loaded[name] = {};
      new Function('require', 'exports', sources[name])(dependency => {
        if (dependency in dependencies) return dependencies[dependency];
        if (dependency === './spatial-navigation') return load('spatial-navigation');
        if (dependency === './editable-target') return load('editable-target');
        if (dependency === './navigation-session') return load('navigation-session');
        if (dependency === './modal-actions') return load('modal-actions');
        if (dependency === './native-focus') return load('native-focus');
        throw Error('Unexpected dependency ' + dependency);
      }, exports);
      return exports;
    }
    const nav = load('gamepad-nav'), spatial = load('spatial-navigation'), editable = load('editable-target');
    const root = document.getElementById('gdl-bp-detail-root'), panel = document.getElementById('panel'), strip = document.getElementById('tabs');
    root.dataset.gdlShortcutAppId = String(route); root.dataset.gdlSteamAppId = String(metadata);
    const controls = new Map(); let tabClicks = 0;
    for (const tab of ['activity', 'stuff', 'community', 'info']) {
      const button = document.createElement('button'); button.textContent = tab; button.dataset.tab = tab;
      button.setAttribute('aria-selected', String(tab === 'activity'));
      button.onclick = () => { tabClicks++; for (const item of controls.values()) item.setAttribute('aria-selected', String(item === button)); };
      controls.set(tab, button); strip.appendChild(button);
    }
    const makeButton = (id, label = id) => { const button = document.createElement('button'); button.id = id; button.textContent = label; root.appendChild(button); return button; };
    const first = makeButton('first'), second = makeButton('second');
    const disabled = makeButton('disabled'); disabled.disabled = true;
    const inert = document.createElement('div'); inert.inert = true; inert.innerHTML = '<button id="inert-child">inert child</button>'; root.appendChild(inert);
    const hidden = document.createElement('div'); hidden.setAttribute('aria-hidden', 'true'); hidden.innerHTML = '<button>hidden child</button>'; root.appendChild(hidden);
    const xAction = makeButton('x-action'); xAction.dataset.gdlGamepadAction = 'x';
    const yAction = makeButton('y-action'); yAction.dataset.gdlGamepadAction = 'y';
    let firstClicks = 0, xClicks = 0, yClicks = 0;
    first.onclick = () => firstClicks++; xAction.onclick = () => xClicks++; yAction.onclick = () => yClicks++;
    const mountedNativeElement = document.createElement('div'); root.appendChild(mountedNativeElement);
    const nativeTree = { CreateNode() {}, Window: window, WindowContext: { RootWindow: window },
      Root: { Element: document.body }, SubscribableIsMounted: { Value: true },
      GetLastFocusedNode: () => ({ Element: document.activeElement }) };
    const tree = { Tree: nativeTree };
    const ownNativeNode = { Parent: tree, Tree: nativeTree, Element: mountedNativeElement,
      BTakeFocus: () => { first.focus(); return true; } };
    const nativeHandle = { Node: () => ownNativeNode, NavTree: () => nativeTree };
    const install = (authority = native ? 'native' : 'fallback', generation = 1) => nav.installBigPictureGamepadNavigation(document, root, strip, controls,
      { authority, generation, panel, nativeNavNode: authority === 'native' ? tree : undefined,
        nativeNavHandle: authority === 'native' ? nativeHandle : undefined });
    const key = key => { const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event; };
    const poll = () => {
      const task = [...timers].find(([, task]) => task.callback.name === 'pollGamepads');
      if (!task) throw Error('No fallback polling task'); timers.delete(task[0]); now += 200; task[1].callback();
    };
    const press = index => { buttons[index].pressed = true; poll(); buttons[index].pressed = false; poll(); };
    const flushFrames = () => { const work = [...frames.values()]; frames.clear(); for (const callback of work) callback(now); };
    let cleanup = null;
    try {
      cleanup = install('native');
      check(nav.getBigPictureNavigationAuthority(document) === 'native' && timers.size === 0,
        'A verified native focus tree installs zero fallback polling tasks');
      first.focus();
      check(!key('Enter').defaultPrevented && firstClicks === 0, 'Native authority adds no document keyboard activation handler');
      controls.get('activity').focus();
      const nativeDown = new CustomEvent('vgp_ondirection', { bubbles: true, cancelable: true, detail: { button: 10, is_repeat: false } });
      controls.get('activity').dispatchEvent(nativeDown);
      check(nativeDown.defaultPrevented && document.activeElement === first && timers.size === 0,
        'Native Down enters registered content without adding fallback controller polling');
      cleanup(); cleanup = nav.installBigPictureGamepadNavigation(document, root, strip, controls,
        { authority: 'native', generation: 1, panel, nativeNavNode: {} });
      check(nav.getBigPictureNavigationAuthority(document) === 'none' && timers.size === 0,
        'An unregistered native handle cannot claim native authority or start an overlapping fallback engine');
      cleanup(); native = false; cleanup = install('fallback');
      check(nav.getBigPictureNavigationAuthority(document) === 'fallback' && timers.size === 1,
        'Missing native navigation selects exactly one fallback engine');
      const play = document.createElement('button'); play.className = 'PlayButton'; play.textContent = 'Play';
      document.body.prepend(play);
      let nativeLaunches = 0;
      play.addEventListener('keydown', event => {
        if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) nativeLaunches++;
      });
      first.focus(); key('Enter'); firstClicks = 0;
      play.focus();
      for (const activation of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key: activation, bubbles: true, cancelable: true });
        play.dispatchEvent(event);
        check(!event.defaultPrevented, 'Native Play activation passes through during the owned navigation cooldown: ' + activation);
      }
      check(nativeLaunches === 2 && firstClicks === 0, 'Steam receives both launch keys without activating stale plugin content');
      play.remove(); now += 600;
      const layout = spatial.collectFocusableLayout(root);
      check(!layout.some(item => item.element === disabled || item.element.id === 'inert-child'
        || item.element.parentElement.getAttribute('aria-hidden') === 'true'), 'Production spatial navigation excludes disabled, inert and hidden ancestor content');
      first.focus(); press(0);
      check(firstClicks === 1, 'One gamepad A edge activates the focused action once');
      first.focus(); press(13);
      check(document.activeElement === second, 'D-pad navigation follows the production spatial geometry');
      press(1);
      check(document.activeElement === controls.get('activity'), 'B returns content focus to the selected native tab');
      press(5); check(controls.get('stuff').getAttribute('aria-selected') === 'true', 'RB switches to the next native tab');
      press(4); check(controls.get('activity').getAttribute('aria-selected') === 'true', 'LB switches to the previous native tab');
      controls.get('stuff').disabled = true; press(5);
      check(controls.get('community').getAttribute('aria-selected') === 'true', 'Bumpers skip a disabled native tab');
      controls.get('stuff').disabled = false; controls.get('activity').click();
      first.focus(); press(2); press(3);
      check(xClicks === 1 && yClicks === 1, 'X/Y execute only explicitly declared owned semantic actions');
      yAction.removeAttribute('data-gdl-gamepad-action'); press(3);
      check(yClicks === 1, 'An undeclared Y has no invented action');
      xAction.setAttribute('aria-disabled', 'true'); press(2);
      check(xClicks === 1, 'Disabled semantic actions cannot be triggered through X');
      xAction.removeAttribute('aria-disabled');

      document.body.style.zoom = '1.25'; first.focus();
      await new Promise(resolve => originalSet(resolve, 40));
      const alignedRing = () => {
        const ring = document.getElementById('gdl-bp-focus-ring');
        if (!ring) return false;
        const a = first.getBoundingClientRect(), b = ring.getBoundingClientRect();
        return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2;
      };
      const waitForRing = async () => {
        for (let attempt = 0; attempt < 40 && !alignedRing(); attempt++) await new Promise(resolve => originalSet(resolve, 10));
      };
      await waitForRing();
      check(alignedRing(), 'Fallback focus frame uses owner CSS coordinates under Steam UI scaling');
      first.style.width = '500px';
      await waitForRing();
      check(alignedRing(), 'Focus frame follows an expanded achievement without another navigation event');
      first.style.width = ''; document.body.style.zoom = ''; now += 600;

      const editor = document.createElement('input'); root.appendChild(editor);
      document.addEventListener(editable.EXIT_TEXT_EDITOR_EVENT, () => first.focus());
      editor.focus();
      const beforeTabs = tabClicks;
      check(!key('e').defaultPrevented && tabClicks === beforeTabs, 'Typing tab shortcut letters in a search/editor is not intercepted');
      check(key('Escape').defaultPrevented && hiddenKeyboards === 1 && document.activeElement === first,
        'Escape exits the text editor through its owned lifecycle and hides the native keyboard');
      editor.focus(); press(1);
      check(hiddenKeyboards === 2 && document.activeElement === first, 'Gamepad B also exits the text editor without navigating background tabs');

      const modal = document.createElement('div'); modal.id = 'gdl-bp-achievements-screen'; modal.setAttribute('role', 'dialog');
      const mine = document.createElement('button'), global = document.createElement('button');
      mine.dataset.gdlAchievementTab = 'mine'; global.dataset.gdlAchievementTab = 'global'; mine.textContent = 'Mine'; global.textContent = 'Global';
      mine.setAttribute('aria-selected', 'true'); global.setAttribute('aria-selected', 'false');
      mine.onclick = () => { mine.setAttribute('aria-selected', 'true'); global.setAttribute('aria-selected', 'false'); };
      global.onclick = () => { mine.setAttribute('aria-selected', 'false'); global.setAttribute('aria-selected', 'true'); };
      const close = document.createElement('button'); close.className = 'gdl-bp-ach-close-trigger'; close.textContent = 'Close';
      const restore = nav.captureBigPictureReturnFocus(document, first);
      close.onclick = () => { modal.remove(); restore(); };
      modal.append(mine, global, close); document.body.appendChild(modal); mine.focus();
      const backgroundTabs = tabClicks;
      press(5); check(global.getAttribute('aria-selected') === 'true' && tabClicks === backgroundTabs, 'RB switches owned achievement tabs without switching the background page');
      press(4); check(mine.getAttribute('aria-selected') === 'true' && tabClicks === backgroundTabs, 'LB remains inside the owned achievement modal');
      press(1); flushFrames();
      check(!modal.isConnected && document.activeElement === first, 'B closes an owned modal and restores its captured trigger');

      const foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog'); foreign.innerHTML = '<button>Steam dialog</button>'; document.body.appendChild(foreign);
      check(!key('Escape').defaultPrevented && foreign.isConnected, 'A foreign Steam modal retains its own Back action');
      press(0); check(firstClicks === 1 && foreign.isConnected, 'Fallback gamepad input cannot activate background content under a foreign modal');
      foreign.remove();

      panel.remove();
      check(nav.getBigPictureNavigationAuthority(document) === 'none' && !nav.performBigPictureSemanticAction(document, 'x'),
        'A detached panel immediately loses semantic and navigation authority');
      document.body.appendChild(panel);
      root.dataset.gdlBpGeneration = '2';
      check(nav.getBigPictureNavigationAuthority(document) === 'none' && !nav.switchBigPictureNativeTab(document, 1),
        'A reused root with a different generation cannot use the previous controls');
      delete root.dataset.gdlBpGeneration;

      const retired = [];
      for (let index = 0; index < 120; index++) {
        retired.push(...[...timers.values()].map(task => task.callback));
        cleanup(); route = 3000000001 + index % 2; metadata = index % 2 ? 49520 : 1790600;
        root.dataset.gdlShortcutAppId = String(route); root.dataset.gdlSteamAppId = String(metadata);
        cleanup = install(index % 2 ? 'fallback' : 'native', index + 2);
        const expected = index % 2 ? 'fallback' : 'native';
        if (nav.getBigPictureNavigationAuthority(document) !== expected || timers.size !== (expected === 'fallback' ? 1 : 0)) throw Error('Navigation authority overlaps during route churn');
      }
      check(true, 'One hundred twenty rapid route/native/fallback transitions retain one exclusive authority');
      const beforeRetired = timers.size;
      for (const callback of retired) callback();
      check(timers.size === beforeRetired, 'Retired polling callbacks cannot reintroduce a second engine');
      const staleReturn = nav.captureBigPictureReturnFocus(document, first);
      cleanup(); route = 3000000009; root.dataset.gdlShortcutAppId = String(route); cleanup = install('native', 999);
      staleReturn(); check(frames.size === 0, 'A modal callback from another route cannot schedule stale focus work');
      cleanup(); cleanup = install('none', 1000);
      check(nav.getBigPictureNavigationAuthority(document) === 'none' && timers.size === 0, 'None authority owns no input engine');
      cleanup(); cleanup = null; nav.disposeBigPictureGamepadNavigation(document);
      check(timers.size === 0 && frames.size === 0 && !document.getElementById('gdl-bp-focus-ring'), 'Final teardown leaves no poll, focus frame or focus ring');
      return { checks };
    } finally {
      cleanup?.(); nav.disposeBigPictureGamepadNavigation(document);
      Date.now = originalDateNow; window.setTimeout = originalSet; window.clearTimeout = originalClear;
      window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancelFrame;
    }
  }, sources);
  assert(report.checks >= 20);
  console.log(`Big Picture input runtime browser passed: ${report.checks} checks; production spatial/actions, native/fallback exclusivity, editor/modal focus and 120 route transitions. Steam APIs mocked.`);
} finally { await browser.close(); }
