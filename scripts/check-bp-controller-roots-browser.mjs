import fs from 'node:fs';
import ts from 'typescript';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const sources = Object.fromEntries(Object.entries({
  PlaybarControllerIcons: 'frontend/features/big-picture/PlaybarControllerIcons.tsx',
  'panel-mount': 'frontend/features/big-picture/panel-mount.ts',
  'visibility-lease': 'frontend/features/big-picture/visibility-lease.ts',
}).map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText]));

await runBPBrowserScenario(sources, async fixture => {
  const { React, foreignReact, ReactDOM, foreignReactDOM, load, dependencies, nativeRequire, root, A, B, frame, check } = fixture;
  const events = [], instances = new Map();
  const iframe = document.createElement('iframe'); document.body.appendChild(iframe);
  const docB = iframe.contentDocument, viewB = iframe.contentWindow;
  const outer = document.createElement('section'); root.parentElement.insertBefore(outer, root); outer.appendChild(root);
  const rootB = docB.createElement('div'); rootB.id = root.id;
  Object.assign(rootB.dataset, { gdlShortcutAppId: String(B), gdlSteamAppId: '550', gdlBpGeneration: '1' });
  const outerB = docB.createElement('section'); outerB.appendChild(rootB); docB.body.appendChild(outerB);
  viewB.g_Router = { history: { location: { pathname: `/routes/library/app/${B}` } } };
  window.SP_REACT = React; viewB.SP_REACT = foreignReact;
  const identityA = {}, identityB = {};
  const runtime = { getRequire: doc => doc === docB ? id => id === 63696 ? foreignReact : {} : nativeRequire,
    getAllModules: () => [], getModuleFactoryCount: () => 0, getModuleFactories: () => [],
    getRuntimeIdentity: doc => instances.get(doc)?.identity || (doc === docB ? identityB : identityA) };
  dependencies['../../steam/modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  dependencies['../modules/SteamWebpackRuntime'] = { steamWebpackRuntime: runtime };
  dependencies['../../steam/gamepad/components/AppDetailsNativeComponents'] = { resolveNativeControllerIcons: () => null };
  dependencies['./NativeBigPictureDetails'] = { findReactDom: doc => instances.get(doc)?.renderer || null };
  function renderer(owner, native) {
    return { createRoot: container => { events.push(['root', owner]); const actual = native.createRoot(container); return {
      render: node => actual.render(node), unmount: () => { events.push(['unmount', owner]); actual.unmount(); },
    }; } };
  }
  function icons(owner, react) {
    const make = kind => props => {
      react.useState(0);
      react.useEffect(() => { events.push(['effect', owner]); return () => events.push(['cleanup', owner]); }, []);
      return react.createElement('span', { 'data-controller-owner': owner, 'data-controller-kind': kind, 'data-controller-type': props.controllerType }, kind);
    };
    return { ControllerType: make('platform'), Controller: make('generic') };
  }
  window.MILLENNIUM_API = { IconsModule: icons('A', React) }; viewB.MILLENNIUM_API = { IconsModule: icons('B', foreignReact) };
  instances.set(document, { identity: identityA, renderer: renderer('A', ReactDOM) });
  instances.set(docB, { identity: identityB, renderer: renderer('B', foreignReactDOM) });
  const controllers = load('PlaybarControllerIcons');
  const boxA = document.createElement('div'), boxB = docB.createElement('div'); outer.appendChild(boxA); outerB.appendChild(boxB);
  const cleanupA = controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true, ps4: false, ps5: false });
  controllers.mountPlaybarControllerIcons(boxB, docB, { xbox: false, ps4: true, ps5: false }); await frame();
  check(boxA.querySelector('[data-controller-owner="A"][data-controller-type="32"]') && boxB.querySelector('[data-controller-owner="B"][data-controller-type="34"]'),
    'Two real Steam React/ReactDOM instances render controller glyphs with their owning CEF hooks');
  for (let i = 0; i < 100; i++) controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true }); await frame();
  check(events.filter(([event, owner]) => event === 'root' && owner === 'A').length === 1, 'One hundred renders reuse the exact owner root');
  controllers.mountPlaybarControllerIcons(boxA, docB, { ps4: true }); await frame();
  check(boxA.querySelector('[data-controller-owner="A"]') && !events.some(([event, owner]) => event === 'unmount' && owner === 'A'),
    'A query through a different Document cannot clear the existing root');
  controllers.mountPlaybarControllerIcons(boxA, document, { xbox: false, ps4: false, ps5: false }); await frame();
  check(boxA.querySelector('[data-controller-kind="generic"]') && !boxA.querySelector('[data-controller-type]'), 'Unknown support renders a generic controller without asserting Xbox compatibility');
  const originalB = boxB.innerHTML;
  instances.set(document, { identity: {}, renderer: instances.get(document).renderer });
  const successorCleanup = controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true }); await frame();
  const unmountedA = events.filter(([event, owner]) => event === 'unmount' && owner === 'A').length;
  check(unmountedA === 1 && boxB.innerHTML === originalB, 'A runtime replacement unmounts only its own previous root');
  cleanupA(); await frame();
  check(boxA.querySelector('[data-controller-owner="A"]') && events.filter(([event, owner]) => event === 'unmount' && owner === 'A').length === unmountedA,
    'An old cleanup callback cannot unmount a successor root');
  const newParent = document.createElement('div'); outer.appendChild(newParent); newParent.appendChild(boxA);
  controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true }); await frame();
  check(events.filter(([event, owner]) => event === 'unmount' && owner === 'A').length === 2, 'Moving a container retires the old parent-bound root');
  instances.set(document, { identity: {}, renderer: renderer('A-new-renderer', ReactDOM) });
  controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true }); await frame();
  check(events.some(([event, owner]) => event === 'root' && owner === 'A-new-renderer'), 'A changed native renderer receives a fresh root');
  const foreignModal = document.createElement('div'); foreignModal.setAttribute('role', 'dialog'); outer.appendChild(foreignModal);
  const modalBox = document.createElement('div'); foreignModal.appendChild(modalBox);
  const beforeForeign = foreignModal.outerHTML; controllers.mountPlaybarControllerIcons(modalBox, document, { xbox: true }); await frame();
  check(foreignModal.outerHTML === beforeForeign, 'A foreign modal cannot become a controller mount');
  window.g_Router.history.location.pathname = '/routes/library/app/550';
  controllers.mountPlaybarControllerIcons(boxA, document, { xbox: true }); await frame();
  check(!boxA.firstChild && boxB.innerHTML === originalB, 'A native route removes only the stale linked controller root');
  boxB.remove(); controllers.disposePlaybarControllerIcons(docB); await frame();
  check(!boxB.firstChild && events.some(([event, owner]) => event === 'cleanup' && owner === 'B'), 'Document cleanup unmounts even a detached controller container and releases its effects');
  successorCleanup(); controllers.disposePlaybarControllerIcons(document); controllers.disposePlaybarControllerIcons(docB);

  // Exercise the production panel removal path with real controller roots.
  window.g_Router.history.location.pathname = `/routes/library/app/${A}`;
  const stats = document.createElement('div'); stats.className = 'GameStatsSection'; outer.appendChild(stats);
  const nativeRow = document.createElement('div'); nativeRow.className = 'NativeController'; nativeRow.style.setProperty('display', 'flex', 'important');
  nativeRow.setAttribute('aria-hidden', 'false'); stats.appendChild(nativeRow); const beforeNative = nativeRow.outerHTML;
  dependencies['../../steam/css'] = { PLAYBAR_CLASSES: () => ({ GameStatsSection: 'GameStatsSection', ControllerSupportInfo: 'NativeController' }) };
  dependencies['../library/controller'] = { detectConnectedController: () => ({ connected: true }), detectGameControllerSupport: () => ({ xbox: true }) };
  dependencies['./details-styles'] = { ensureBigPictureDetailStyles() {} };
  dependencies['./PlaybarControllerIcons'] = controllers;
  dependencies['./visibility-lease'] = load('visibility-lease');
  const panel = load('panel-mount');
  panel.ensurePlaybarControllerStat(document, { xbox: true }); await frame();
  check(document.querySelector('#gdl-bp-playbar-controller [data-controller-owner="A"]') && nativeRow.hidden,
    'Production panel mounts a local controller root and temporarily leases the native row');
  const cleanupBefore = events.filter(([event, owner]) => event === 'cleanup' && owner === 'A').length;
  panel.removePlaybarControllerStat(document); await frame();
  check(!document.getElementById('gdl-bp-playbar-controller') && nativeRow.outerHTML === beforeNative
    && events.filter(([event, owner]) => event === 'cleanup' && owner === 'A').length === cleanupBefore + 1,
    'Production panel removal explicitly unmounts React effects before restoring the exact native row');
  iframe.remove();
  return { label: 'Big Picture controller root ownership', checks: fixture.checks(), modalMounts: 0, react: React.version,
    controllerRoots: events.filter(([event]) => event === 'root').length };
});
