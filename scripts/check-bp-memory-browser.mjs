// One browser/page, production navigation and modal/screen lifecycles, and
// Steam's installed React. Explicit GC measures retained JS, not process RSS.
import assert from 'node:assert/strict';
import { runBPBrowserScenario } from './check-bp-achievements-workflow-browser.mjs';

const report = await runBPBrowserScenario({}, async fixture => {
  const { load, root, A, frame, check, listeners, observerCount } = fixture;
  check(typeof window.gc === 'function', 'Exposed Chromium GC is required for retained-heap verification');
  check(Number.isFinite(performance.memory?.usedJSHeapSize), 'Precise Chromium JS heap metrics are required');
  const nav = load('navigation'), owned = load('owned'), actions = load('modal-actions'), cache = load('cache'), screen = load('screen');
  const shortcut = { id: A, steamAppId: '550', title: 'Heap soak shortcut' };
  const data = { found: true, appid: '550', metadata_appid: '550', total: 48, unlocked: 12,
    path: 'C:/heap-soak/state.json', achievements: Array.from({ length: 48 }, (_, index) => ({
      name: `HEAP_${index}`, display_name: `Achievement ${index}`, description: `Description ${index}`,
      icon: '', icon_gray: '', earned: index < 12, earned_time: index < 12 ? 1000 + index : 0,
      hidden: index === 47, progress: 1, max_progress: 5, global_percent: 99 - index, global_percent_known: true,
    })) };
  cache.cacheLocalAchievements(data, '550', String(A));
  const opener = document.createElement('button'); opener.textContent = 'Achievements'; opener.dataset.gdlFocusKey = 'heap-soak-opener'; root.appendChild(opener);
  const strip = document.getElementById('tabs'), controls = new Map([['stuff', strip.firstElementChild]]);
  const tree = { CreateNode() {}, Window: window, WindowContext: { RootWindow: window }, Root: { Element: root },
    SubscribableIsMounted: { Value: true } };
  const parent = { Tree: tree }, node = { Tree: tree, Parent: parent, Element: opener, BTakeFocus: () => true };
  const nativeHandle = { Node: () => node, NavTree: () => tree };
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });

  const timeouts = new Set(), animationFrames = new Set(), globalListeners = new Map();
  const originalSet = window.setTimeout, originalClear = window.clearTimeout;
  const originalFrame = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
  window.setTimeout = (callback, delay, ...args) => {
    const id = originalSet(() => { timeouts.delete(id); callback(...args); }, delay);
    timeouts.add(id); return id;
  };
  window.clearTimeout = id => { timeouts.delete(id); originalClear(id); };
  window.requestAnimationFrame = callback => {
    const id = originalFrame(time => { animationFrames.delete(id); callback(time); });
    animationFrames.add(id); return id;
  };
  window.cancelAnimationFrame = id => { animationFrames.delete(id); originalCancel(id); };
  const listenerBindings = [window, document].map(target => {
    const add = target.addEventListener, remove = target.removeEventListener, byType = new Map();
    globalListeners.set(target, byType);
    const key = (type, options) => `${type}:${typeof options === 'boolean' ? options : options?.capture === true}`;
    target.addEventListener = function(type, listener, options) {
      const name = key(type, options);
      if (!byType.has(name)) byType.set(name, new Set());
      byType.get(name).add(listener);
      return add.call(this, type, listener, options);
    };
    target.removeEventListener = function(type, listener, options) {
      byType.get(key(type, options))?.delete(listener);
      return remove.call(this, type, listener, options);
    };
    return () => { target.addEventListener = add; target.removeEventListener = remove; };
  });
  let resizeCount = 0;
  const OriginalResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends OriginalResizeObserver {
    active = false;
    observe(...args) { if (!this.active) { resizeCount++; this.active = true; } super.observe(...args); }
    disconnect() { if (this.active) { resizeCount--; this.active = false; } super.disconnect(); }
  };
  const resources = () => ({
    subscriptions: listeners.size, mutationObservers: observerCount(), resizeObservers: resizeCount,
    timeouts: timeouts.size, animationFrames: animationFrames.size,
    globalListeners: [...globalListeners.values()].reduce((sum, byType) => sum + [...byType.values()].reduce((count, values) => count + values.size, 0), 0),
    modalRoots: document.querySelectorAll('.fixture-modal,[data-gdl-bp-modal-owner]').length,
    focusRings: document.querySelectorAll('#gdl-bp-focus-ring,#gdl-bp-focus-ring-root').length,
    authority: nav.getBigPictureNavigationAuthority(document),
  });
  const settle = async () => { await frame(); await new Promise(resolve => originalSet(resolve, 0)); };
  const sampleHeap = async () => {
    await settle(); window.gc(); await new Promise(resolve => originalSet(resolve, 0)); window.gc();
    const bytes = performance.memory.usedJSHeapSize;
    check(Number.isFinite(bytes) && bytes > 0, 'A post-GC heap sample is available');
    return bytes;
  };
  const cycle = async index => {
    const authority = index % 2 ? 'native' : 'fallback';
    nav.installBigPictureGamepadNavigation(document, root, strip, controls, { authority, generation: 1,
      ...(authority === 'native' ? { nativeNavNode: parent, nativeNavHandle: nativeHandle } : {}) });
    opener.focus();
    if (!screen.openBigPictureAchievementsScreen(document, shortcut, data)) throw Error('Production screen did not open during heap soak');
    await frame();
    let modal = document.getElementById('gdl-bp-achievements-screen');
    const tab = modal.querySelector('[data-gdl-achievement-tab="global"]');
    tab.focus(); tab.click(); await frame();
    const search = modal.querySelector('input'); search.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Achievement 2');
    search.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    if (!actions.closeRegisteredBigPictureModal(modal)) throw Error('Production modal has no owned close action');
    modal = null;
    nav.disposeBigPictureGamepadNavigation(document);
    await settle();
  };
  const warmupCycles = 24, batchSize = 40, batches = 5, heapSamples = [];
  let baseline;
  try {
    for (let index = 0; index < warmupCycles; index++) await cycle(index);
    heapSamples.push(await sampleHeap()); baseline = resources();
    check(baseline.subscriptions === 0 && baseline.mutationObservers === 0 && baseline.resizeObservers === 0
      && baseline.timeouts === 0 && baseline.animationFrames === 0 && baseline.modalRoots === 0 && baseline.focusRings === 0
      && baseline.authority === 'none', 'Warm production screen/navigation teardown releases every scoped resource');
    for (let batch = 0; batch < batches; batch++) {
      for (let index = 0; index < batchSize; index++) await cycle(warmupCycles + batch * batchSize + index);
      heapSamples.push(await sampleHeap());
      check(JSON.stringify(resources()) === JSON.stringify(baseline), `Batch ${batch + 1} returns observers, listeners, subscriptions, timers, frames, roots and authority to its warm baseline`);
    }
    // React/V8 can retain lazy code and allocator capacity after warmup. A real
    // retained growth limit allows that noise without hiding multi-MB leaks.
    const tolerance = Math.max(4 * 1024 * 1024, heapSamples[0] * .2);
    const growth = heapSamples.at(-1) - heapSamples[0];
    const tailGrowth = heapSamples.at(-1) - heapSamples[2];
    check(Math.max(...heapSamples.slice(1)) - heapSamples[0] <= tolerance,
      `Post-GC heap stays bounded after ${batches * batchSize} measured cycles (${growth} bytes growth; ${tolerance} bytes limit)`);
    check(tailGrowth <= Math.max(2 * 1024 * 1024, heapSamples[0] * .1), 'The last three batches do not accumulate retained heap after warmup');
    return { label: 'Big Picture retained JS heap soak', checks: fixture.checks(), modalMounts: fixture.modalMounts(), react: fixture.React.version,
      memory: { warmupCycles, measuredCycles: batches * batchSize, batchSize, heapSamplesBytes: heapSamples,
        retainedGrowthBytes: growth, tailGrowthBytes: tailGrowth, toleranceBytes: tolerance, resources: baseline } };
  } finally {
    owned.disposeBigPictureModals(document); nav.disposeBigPictureGamepadNavigation(document);
    window.setTimeout = originalSet; window.clearTimeout = originalClear;
    window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancel;
    window.ResizeObserver = OriginalResizeObserver;
    for (const restore of listenerBindings) restore();
  }
}, { chromiumArgs: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });

assert(report.memory, 'The browser must return actual post-GC heap measurements');
console.log(JSON.stringify(report.memory, null, 2));
