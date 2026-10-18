// Real browser DOM, production panel leases and the actual details teardown.
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
const sources = Object.fromEntries([
  ['panel', 'frontend/features/big-picture/panel-mount.ts'], ['details', 'frontend/features/big-picture/details.ts'],
  ['visibility', 'frontend/features/big-picture/visibility-lease.ts'],
  ['snapshot', 'frontend/features/big-picture/transition-snapshot.ts'],
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CLOUD_BROWSER_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined) });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body></body></html>');
  const report = await page.evaluate(async sources => {
    let checks = 0;
    const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
    const noop = () => {};
    const generic = new Proxy({}, { get: () => noop });
    function load(source, dependencies = {}) {
      const exports = {};
      new Function('exports', 'require', source)(exports, name => dependencies[name] || generic);
      return exports;
    }
    let linked = true, connected = true;
    const shortcutId = '3000000001';
    const presentation = load(sources.snapshot);
    const panel = load(sources.panel, {
      './transition-snapshot': presentation,
      './visibility-lease': load(sources.visibility),
      '../../steam/gamepad/GamepadContext': {
        isCurrentLinkedGamepadTarget: (doc, id, steamId) => linked && doc === document && String(id) === shortcutId && steamId === '550',
        resolveActiveGameContext: () => linked ? { type: 'shortcut-linked', identity: { steamAppId: 550 } } : { type: 'steam', steamAppId: 550 },
      },
      '../../steam/ui/SteamUIModeService': { steamUIModeService: { isGamepadUI: () => linked } },
      '../../steam/css': { PLAYBAR_CLASSES: () => ({ GameStatsSection: 'GameStatsSection', ControllerSupportInfo: 'NativeController' }) },
      '../../steam/localization': { loc: (_key, text) => text },
      '../library/controller': { detectConnectedController: () => ({ connected }), detectGameControllerSupport: () => ({ xbox: true }) },
      './PlaybarControllerIcons': { mountPlaybarControllerIcons: () => () => {}, disposePlaybarControllerIcons() {} },
    });
    const details = load(sources.details, { './panel-mount': panel });
    const signature = element => JSON.stringify({ hidden: element.hidden,
      attributes: [...element.attributes].filter(attribute => attribute.name !== 'style')
        .map(attribute => [attribute.name, attribute.value]).sort((a, b) => a[0].localeCompare(b[0])),
      style: [...element.style].map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)])
        .sort((a, b) => a[0].localeCompare(b[0])) });
    function fixture() {
      const host = document.createElement('section');
      host.innerHTML = '<div id="visible" aria-hidden="false" data-native-state="keep" '
        + 'data-gdl-bp-panel-sibling-hidden="prior" style="display:flex!important;color:red">Visible</div>'
        + '<div id="hidden" hidden="until-found" aria-hidden="true" '
        + 'data-gdl-bp-panel-sibling-hidden="1" style="display:none!important">Native hidden</div>'
        + '<div id="plain">Plain</div><div id="gdl-bp-detail-root"></div>';
      document.body.appendChild(host);
      const children = [...host.children].slice(0, 3), root = host.lastElementChild;
      return { host, children, root, before: children.map(signature) };
    }
    let f = fixture();
    for (let cycle = 0; cycle < 100; cycle++) panel.commitNativePanelRoot(f.host, f.root);
    check(f.children.every(element => element.hidden && element.style.getPropertyValue('display') === 'none'
      && element.style.getPropertyPriority('display') === 'important' && element.getAttribute('aria-hidden') === 'true'),
    'A committed linked panel hides its native siblings consistently');
    panel.restoreNativePanelChildren(f.host, f.root);
    check(f.children.every((element, index) => signature(element) === f.before[index]),
      'One hundred commits preserve exact hidden values, display priority, aria-hidden and previous markers');
    panel.restoreNativePanelChildren(f.host);
    check(f.children.every((element, index) => signature(element) === f.before[index]), 'Repeated restoration is idempotent');
    check(f.children[1].hidden && getComputedStyle(f.children[1]).display === 'none', 'A previously hidden native child is never revived');
    f.host.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    const replacement = document.createElement('div'); replacement.id = 'gdl-bp-detail-root';
    f.root.remove(); f.host.appendChild(replacement); panel.commitNativePanelRoot(f.host, replacement);
    panel.restoreNativePanelChildren(f.host, f.root);
    check(f.children.every(element => element.style.getPropertyValue('display') === 'none'),
      'An earlier linked root cannot reveal native children adopted by its replacement');
    panel.restoreNativePanelChildren(f.host, replacement);
    check(f.children.every((element, index) => signature(element) === f.before[index]), 'Replacement ownership retains the original native snapshot');
    f.host.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    const otherPanel = document.createElement('section'), otherRoot = document.createElement('div');
    otherRoot.id = 'gdl-bp-detail-root'; otherPanel.appendChild(otherRoot); document.body.appendChild(otherPanel);
    const adopted = f.children[0]; otherPanel.insertBefore(adopted, otherRoot);
    panel.commitNativePanelRoot(otherPanel, otherRoot); panel.restoreNativePanelChildren(f.host);
    check(adopted.hidden, 'Moving a native child transfers its lease so the previous panel cannot reveal it');
    panel.restoreNativePanelChildren(otherPanel);
    check(signature(adopted) === f.before[0], 'The destination panel restores the original pre-transfer native state');
    f.host.remove(); otherPanel.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    const updated = f.children[0];
    updated.hidden = false; updated.style.setProperty('display', 'grid'); updated.setAttribute('aria-hidden', 'false');
    updated.setAttribute('data-gdl-bp-panel-sibling-hidden', 'steam-new');
    const nativeUpdate = signature(updated);
    panel.restoreNativePanelChildren(f.host);
    check(signature(updated) === nativeUpdate, 'Restoration preserves newer Steam writes to every leased property');
    f.host.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    f.children[0].hidden = false; f.children[0].style.setProperty('display', 'grid', 'important');
    f.children[0].setAttribute('aria-hidden', 'false'); f.children[0].setAttribute('data-gdl-bp-panel-sibling-hidden', 'steam-refresh');
    const refreshed = signature(f.children[0]); panel.commitNativePanelRoot(f.host, f.root); panel.restoreNativePanelChildren(f.host);
    check(signature(f.children[0]) === refreshed, 'A later commit captures native updates before temporarily hiding the same child again');
    f.host.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    const detached = f.children[0]; detached.remove(); panel.commitNativePanelRoot(f.host, f.root);
    check(!detached.isConnected && signature(detached) === f.before[0], 'A removed child releases its lease without being reattached');
    panel.restoreAllNativePanelChildren(document);
    check(f.children.slice(1).every((element, index) => signature(element) === f.before[index + 1]), 'Remaining children restore after removed-node pruning');
    f.host.remove();

    // Native ContentTransition retains an outgoing tab beside the incoming one.
    // Moving our single root must not reveal the original outgoing Activity.
    f = fixture();
    f.root.dataset.gdlShortcutAppId = shortcutId; f.root.dataset.gdlSteamAppId = '550';
    panel.commitNativePanelRoot(f.host, f.root);
    const incoming = document.createElement('section'); document.body.appendChild(incoming);
    panel.retireNativePanelChildren(f.host, f.root); incoming.appendChild(f.root);
    panel.commitNativePanelRoot(incoming, f.root);
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(f.children.every(child => getComputedStyle(child).display === 'none'),
      'Outgoing native Activity stays hidden while Steam retains both transition panels');
    const lateOutgoing = document.createElement('div'); lateOutgoing.textContent = 'Late outgoing Activity'; f.host.appendChild(lateOutgoing);
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(getComputedStyle(lateOutgoing).display === 'none', 'Late outgoing content is also hidden before painting');
    f.host.remove(); await new Promise(resolve => requestAnimationFrame(resolve));
    check(f.children.every((child, index) => signature(child) === f.before[index]) && !lateOutgoing.hidden,
      'Finishing the native exit releases the detached outgoing panel and its original properties');
    panel.restoreAllNativePanelChildren(document); incoming.remove();

    f = fixture(); let originalClicks = 0;
    f.root.dataset.gdlShortcutAppId = shortcutId; f.root.dataset.gdlSteamAppId = '550';
    f.root.innerHTML = '<style>#clip-icon{color:red}</style><button id="clip-icon" class="gpfocus" data-gdl-focus-key="action" onclick="window.snapshotInlineRan=true">Action</button>'
      + '<label for="edit-value">Text</label><input id="edit-value" value="old"><input type="checkbox">'
      + '<div class="scroller" style="height:50px;overflow:auto"><div style="height:500px">Scrolled content</div></div>'
      + '<svg><defs><clipPath id="clip-region"><rect width="10" height="10"/></clipPath></defs><path clip-path="url(#clip-region)"/></svg>'
      + '<video poster="https://images.invalid/poster.png"><source src="https://media.invalid/video.mp4"></video>'
      + '<audio src="https://media.invalid/audio.mp3"></audio><iframe src="about:blank"></iframe><object data="about:blank"></object><canvas width="10" height="10"></canvas>';
    const liveAction = f.root.querySelector('button'); liveAction.onclick = () => originalClicks++;
    f.root.querySelector('input').value = 'live editor value'; f.root.querySelector('[type=checkbox]').checked = true;
    f.root.querySelector('.scroller').scrollTop = 125;
    const originalPresentation = f.root.outerHTML, snapshot = presentation.createBigPictureTransitionSnapshot(f.root);
    check(f.root.outerHTML === originalPresentation && f.root.querySelector('.scroller').scrollTop === 125,
      'A transition presentation leaves the mounted original DOM, live editor and scroll state unchanged');
    check(snapshot.inert && snapshot.getAttribute('aria-hidden') === 'true' && !snapshot.querySelector('[data-gdl-focus-key],.gpfocus')
      && !snapshot.hasAttribute('data-gdl-shortcut-app-id') && !snapshot.hasAttribute('data-gdl-steam-app-id'),
      'The outgoing presentation has neither active identity, input metadata nor native focus ownership');
    const clonedButton = snapshot.querySelector('button'); clonedButton.click(); clonedButton.focus();
    check(originalClicks === 0 && !window.snapshotInlineRan && document.activeElement !== clonedButton && clonedButton.tabIndex === -1,
      'Cloned outgoing content cannot run original callbacks, inline events or receive focus');
    check(snapshot.querySelector('input').value === 'live editor value' && snapshot.querySelector('[type=checkbox]').checked
      && snapshot.querySelector('.scroller').scrollTop === 125, 'The last painted input, checkbox and internal scroll values survive handoff');
    check(snapshot.querySelector('path').getAttribute('clip-path') === `url(#${snapshot.querySelector('clipPath').id})`
      && snapshot.querySelector('label').htmlFor === snapshot.querySelector('input').id
      && snapshot.querySelector('style').textContent.includes('#' + clonedButton.id)
      && !snapshot.querySelector('[id="clip-region"],[id="edit-value"]'),
      'Retired SVG fragments, labels and scoped styles reference unique snapshot IDs');
    check(!snapshot.querySelector('iframe,object,embed,video,audio,canvas,source') && snapshot.querySelector('img[src$="poster.png"]')
      && snapshot.querySelector('img[src^="data:image/png"]'), 'Snapshots contain only static media presentation without new players or browsing contexts');
    snapshot.remove(); f.host.remove();

    // A real outgoing native CSS transition may outlive route authority.
    f = fixture(); f.root.textContent = 'Linked outgoing presentation';
    f.root.dataset.gdlShortcutAppId = shortcutId; f.root.dataset.gdlSteamAppId = '550';
    panel.commitNativePanelRoot(f.host, f.root);
    f.host.style.transform = 'translateX(0)'; f.host.getBoundingClientRect();
    f.host.style.transition = 'transform 150ms linear'; f.host.style.transform = 'translateX(-50px)';
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(panel.preserveNativePanelExit(f.host, f.root), 'Route exit recognizes the running native CSS transition');
    linked = false; f.root.remove(); panel.restoreAllNativePanelChildren(document, true);
    await new Promise(resolve => requestAnimationFrame(resolve));
    check(f.children.every(child => child.hidden) && f.host.querySelector('[data-gdl-bp-transition-snapshot]')?.inert,
      'Route authority is revoked immediately while outgoing native notices remain hidden beneath a passive final frame');
    await new Promise(resolve => setTimeout(resolve, 210));
    check(!f.host.querySelector('[data-gdl-bp-transition-snapshot]') && f.children.every((child, index) => signature(child) === f.before[index]),
      'Native transition completion releases route-exit presentation and restores exact native properties');
    linked = true; f.host.remove();

    const foreign = document.createElement('div'); foreign.hidden = true;
    foreign.style.setProperty('display', 'none', 'important'); foreign.setAttribute('aria-hidden', 'true');
    foreign.setAttribute('data-gdl-bp-panel-sibling-hidden', '1'); document.body.appendChild(foreign);
    const foreignBefore = signature(foreign);
    f = fixture(); panel.commitNativePanelRoot(f.host, f.root);
    details.disposeBigPictureShortcutDetails(document);
    check(f.children.every((element, index) => signature(element) === f.before[index]),
      'Actual route/plugin teardown restores exact native state, including a preexisting marker with value one');
    check(signature(foreign) === foreignBefore, 'Actual details teardown ignores a foreign marker without an owned snapshot');
    details.disposeBigPictureShortcutDetails(document);
    check(signature(foreign) === foreignBefore, 'Repeated actual teardown remains safe for foreign native nodes');
    f.host.remove(); foreign.remove();

    f = fixture(); panel.commitNativePanelRoot(f.host, f.root); f.host.remove();
    panel.restoreAllNativePanelChildren(document);
    check(!f.host.isConnected && f.children.every((element, index) => signature(element) === f.before[index]),
      'A detached panel also releases every snapshot without reconnecting its native content');
    function detailFixture() {
      const detail = document.createElement('section'); detail.setAttribute('data-appid', shortcutId);
      detail.innerHTML = '<div class="GameStatsSection"><div class="NativeController" hidden="until-found" aria-hidden="false" '
        + 'data-gdl-bp-native-controller-hidden="prior" data-gdl-bp-native-controller-display="preserve" style="display:flex!important">Native control</div></div>'
        + '<section class="NativePanel"><div class="NonSteamGameNotice" hidden="until-found" aria-hidden="false" '
        + 'data-gdl-bp-hidden-notice="prior" style="display:flex!important">Non-Steam game</div>'
        + '<p aria-hidden="false" data-gdl-bp-hidden-notice="1" style="display:grid!important">Steam controls the start</p>'
        + '<div role="dialog"><div class="NonSteamGameNotice">Non-Steam game dialog</div></div>'
        + '<div class="SettingsPanel"><div class="NonSteamGameNotice">Non-Steam game settings</div></div>'
        + '<div data-appid="550"><div class="NonSteamGameNotice">Non-Steam game other native identity</div></div>'
        + '<div id="gdl-bp-detail-root" data-gdl-shortcut-app-id="' + shortcutId + '" data-gdl-steam-app-id="550"></div></section>';
      document.body.appendChild(detail);
      const foreign = document.createElement('div'); foreign.setAttribute('role', 'dialog');
      foreign.innerHTML = '<div class="NonSteamGameNotice" data-gdl-bp-hidden-notice="1" hidden style="display:none!important">Non-Steam game foreign dialog</div>'
        + '<div class="GameStatsSection"><div class="NativeController" data-gdl-bp-native-controller-hidden="1" hidden style="display:none!important">Foreign control</div></div>';
      document.body.insertBefore(foreign, detail);
      const own = [...detail.querySelector('.NativePanel').children].slice(0, 2), control = detail.querySelector('.NativeController');
      const foreignNodes = [...detail.querySelectorAll('[role="dialog"],.SettingsPanel,[data-appid="550"]'), foreign];
      return { detail, foreign, own, control, before: own.map(signature), controlBefore: signature(control), foreignBefore: foreignNodes.map(element => element.outerHTML), foreignNodes,
        remove() { detail.remove(); foreign.remove(); } };
    }
    let d = detailFixture();
    for (let i = 0; i < 100; i++) panel.hideBigPictureNonSteamNotices(document);
    check(d.own.every(element => element.hidden && element.style.getPropertyPriority('display') === 'important'), 'Only linked detail notice nodes are leased');
    check(d.foreignNodes.every((element, index) => element.outerHTML === d.foreignBefore[index]), 'Foreign dialogs, settings and native identities remain byte-for-byte unchanged');
    panel.restoreBigPictureNonSteamNotices(document);
    check(d.own.every((element, index) => signature(element) === d.before[index]), 'Notice restoration preserves original hidden, inline priority, aria and existing markers after 100 hides');
    panel.ensurePlaybarControllerStat(document, { xbox: true, ps4: false, ps5: false });
    check(d.control.hidden && d.control.style.getPropertyValue('display') === 'none', 'The exact linked detail controller row is leased');
    panel.removePlaybarControllerStat(document);
    check(signature(d.control) === d.controlBefore, 'Controller cleanup restores exact original hidden, display priority, aria and both markers');
    check(d.foreignNodes.every((element, index) => element.outerHTML === d.foreignBefore[index]), 'Controller restoration ignores foreign markers without an owned snapshot');
    d.remove();

    d = detailFixture(); panel.hideBigPictureNonSteamNotices(document);
    const fresh = d.own[0]; fresh.hidden = false; fresh.style.setProperty('display', 'grid', 'important'); fresh.setAttribute('aria-hidden', 'false'); fresh.setAttribute('data-gdl-bp-hidden-notice', 'steam-new');
    const updatedNotice = signature(fresh); panel.restoreBigPictureNonSteamNotices(document);
    check(signature(fresh) === updatedNotice, 'Notice restoration preserves later native writes');
    panel.ensurePlaybarControllerStat(document, { xbox: true });
    d.control.hidden = false; d.control.style.setProperty('display', 'grid', 'important'); d.control.setAttribute('aria-hidden', 'false');
    d.control.setAttribute('data-gdl-bp-native-controller-hidden', 'steam-new'); d.control.setAttribute('data-gdl-bp-native-controller-display', 'steam-display');
    const updatedControl = signature(d.control); panel.removePlaybarControllerStat(document);
    check(signature(d.control) === updatedControl, 'Controller restoration preserves later native writes and marker updates');
    panel.hideBigPictureNonSteamNotices(document); linked = false;
    panel.hideBigPictureNonSteamNotices(document);
    check(signature(fresh) === updatedNotice, 'A native route retires owned notices instead of adopting stale linked DOM');
    check(panel.ensurePlaybarControllerStat(document, { xbox: true }) === null, 'Native route cannot hide controls through a stale linked root');
    linked = true; connected = false;
    check(panel.ensurePlaybarControllerStat(document, { xbox: true }) === null, 'A disconnected controller leaves the original native row intact');
    check(d.foreignNodes.every((element, index) => element.outerHTML === d.foreignBefore[index]), 'Route and device cleanup leave foreign dialogs untouched');
    d.remove();
    return { checks };
  }, sources);
  assert(report.checks >= 14);
  console.log(`Big Picture panel ownership browser passed: ${report.checks} checks; 100 idempotent commits, exact native visibility snapshots, owner replacement, preserved Steam updates and actual details teardown. Steam services mocked.`);
} finally { await browser.close(); }
