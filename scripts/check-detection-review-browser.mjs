import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';

const sources = Object.fromEntries(Object.entries({
  detection: 'frontend/features/shortcuts/detection.ts', manual: 'frontend/features/shortcuts/manual-link.ts',
  progress: 'frontend/features/shortcuts/manual-link-progress.ts',
  merger: 'frontend/features/shortcuts/candidate-merger.ts', shortcuts: 'frontend/steam/shortcuts.ts',
  details: 'frontend/steam/library-details.ts', modal: 'frontend/core/modal.ts',
  properties: 'frontend/features/shortcuts/properties.ts',
}).map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(key === 'manual' && process.env.DETECTION_REVIEW_MANUAL_SOURCE
  ? process.env.DETECTION_REVIEW_MANUAL_SOURCE : file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.setContent('<main>Isolated shortcut review; no Steam account or network</main>');
  const report = await page.evaluate(async sources => {
    const results = [], check = (value, message) => { if (!value) throw new Error(message); results.push(message); };
    const waitFor = async (predicate, message) => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw new Error(message);
    };
    const id = 3000000001, exe = 'E:\\Juegos\\Battlefield 3\\bf3.exe', folder = 'E:\\Juegos\\Battlefield 3';
    const weak = { appid: '41070', name: 'Serious Sam 3: BFE', score: 7, confidence: 'low', evidence_tier: 'hint', reasons: ['title_tokens'] };
    const strong = { appid: '1238820', name: 'Battlefield 3', score: 99, confidence: 'exact', evidence_tier: 'strong', reasons: ['known_alias', 'folder_title_match'] };
    const context = { shortcutAppId: id, title: 'bf3', exePath: exe, startDir: folder, launchOptions: '' };
    const record = { id, title: 'bf3', app: { appid: id, display_name: 'bf3', strShortcutExe: exe, strShortcutStartDir: folder } };
    const state = { requests: [], events: [], details: () => ({}), detailsCalls: 0, local: request => request.exe_path ? [strong] : [weak],
      remote: () => [weak], links: [], queued: [], cancelled: [], linkResult: () => ({ ok: false, error: 'shortcut_identity_changed' }), officialCalls: [] };
    window.appStore = { m_mapApps: new Map([[id, record.app]]) };
    const modules = {}, mocks = {
      backendLog() {}, getSteamLanguage: async () => 'english',
      loc: (_key, fallback) => fallback, setLocalizationDocumentProvider() {}, steamLanguageSync: () => 'english',
      templateToRegex: () => /^Properties - (.+)$/,
      gdlText: (_key, fallback, values = {}) => fallback.replace(/\{(\w+)\}/g, (_, key) => values[key] || ''),
      normalizeTitle: value => String(value).toLowerCase(),
      escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
      mappings: {}, shortcutMappingKey: value => `shortcut:${value}`, findMappingForTitle: () => null,
      RetryingRequestCache: class { get(_key, loader) { return loader(); } clear() {} },
      expandCandidatesWithEditions: values => values,
      getShortcutDetailsBackend: async () => { state.events.push('context'); state.detailsCalls++; return state.details(); },
      detectGameCandidatesLocalBackend: async ({ request_json }) => { const request = JSON.parse(request_json); state.events.push('local'); state.requests.push(request); return { candidates: await state.local(request) }; },
      detectGameCandidatesBackend: async ({ request_json }) => { const request = JSON.parse(request_json); state.requests.push(request); const value = await state.remote(request); return Array.isArray(value) ? { candidates: value } : value; },
      getAllShortcutRecords: () => [record], shortcutAlreadyLinked: () => false, findMappingForShortcut: () => null,
      isShortcutDismissed: () => false, undismissShortcut() {},
      shortcutRuntimeHost: () => ({ getMainWindowDoc: () => document }),
      navigateToLibraryShortcut: (_doc, shortcutId) => { state.navigated = shortcutId; },
      getGameData: async appid => { state.officialCalls.push(appid); return null; },
      getPendingLinkJob: () => state.job || null, getLinkJobCompletion: () => state.completed,
      getLinkJobCompletedShortcutAppId: () => state.completed ? state.completedId || id : null,
      PENDING_LINK_JOBS_CHANGED_EVENT: 'gdl:pending-link-jobs-changed', shouldAutoApplyNoLauncher: () => false,
      isShortcutIdentityMutationInProgress: () => false, clearShortcutEdition() {}, saveShortcutEdition() {},
      stageLinkJobForRecovery() {}, cancelPendingLinkJobs: (...args) => state.cancelled.push(args),
      enqueueLinkJob: input => { state.queued.push(input); state.completed = undefined; return state.job = { ...input, id: 'fixture-job', createdAt: Date.now(), status: 'queued', attempts: 0 }; },
      linkShortcutToSteam: async input => { state.links.push(input); return state.linkResult(); },
      getCachedGameData: () => null, subscribeMappings: () => () => {}, SHORTCUT_PROPERTIES_STYLE: '',
      rememberedShortcutSteamAppId: () => state.remembered || '',
      findNativePropertiesPage: doc => doc.getElementById('fixture-properties'), tryInjectNativePropertiesField() {}, tryInjectCustomizationArtwork() {},
      bindShortcutAchievementSettings: () => ({ sync() {} }), shortcutAchievementSettingsHtml: () => '',
      bindShortcutPlaytimeProperties: () => ({ sync() {} }), shortcutPlaytimePropertiesHtml: () => '', hasPendingLinkJob: () => false,
    };
    const load = key => {
      if (modules[key]) return modules[key];
      const exports = {}; modules[key] = exports;
      const require = spec => {
        const selected = { './detection': 'detection', './candidate-merger': 'merger', '../../steam/shortcuts': 'shortcuts',
          '../../steam/library-details': 'details', '../../core/modal': 'modal', './manual-link-progress': 'progress' }[spec];
        return selected ? load(selected) : mocks;
      };
      new Function('require', 'exports', sources[key])(require, exports); return exports;
    };
    const detection = load('detection'), manual = load('manual');
    const modal = () => document.getElementById('gdl-manual-link-modal');
    const selected = () => modal().querySelector('select');
    const confirm = () => modal().querySelector('.gdl-manual-link-confirm');
    const name = () => modal().querySelector('.gdl-manual-link-name').textContent;
    const title = () => modal().querySelector('.gdl-manual-link-dialog-title').textContent;
    const close = () => modal()?.querySelector('.gdl-manual-link-close').click();
    const choose = value => { selected().value = value; selected().dispatchEvent(new Event('change', { bubbles: true })); };

    // Only the target document's committed app/Properties/SteamClient may supply paths.
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    const owner = frame.contentWindow, ownerDoc = frame.contentDocument;
    owner.appStore = { m_mapApps: new Map([[id, { appid: id, display_name: 'bf3' }]]) };
    ownerDoc.body.innerHTML = `<input value="C:\\Wrong\\other.exe"><section role="dialog" class="PagedSettingsDialog" data-appid="3000000002"><input value="C:\\OtherGame\\other.exe"></section>`;
    let ownerReads = 0, foreignReads = 0;
    owner.SteamClient = { Apps: { GetCachedAppDetails: () => { ownerReads++; return { strShortcutExe: exe, strShortcutStartDir: folder }; } } };
    window.SteamClient = { Apps: { GetCachedAppDetails: () => { foreignReads++; return { strShortcutExe: 'C:\\Wrong\\other.exe' }; } } };
    const owned = await detection.buildShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(owned.exePath === exe && owned.startDir === folder && ownerReads === 1 && foreignReads === 0,
      'Context reads full BF3 path from its owning SteamClient, never the background realm or another Properties dialog');
    owner.SteamClient = undefined;
    const unrelated = detection.buildImmediateShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(!unrelated.exePath, 'Unscoped path fields and another shortcut Properties cannot contaminate detection');
    ownerDoc.body.innerHTML += `<section role="dialog" class="PagedSettingsDialog" data-appid="${id}"><input value="&quot;${exe}&quot;"><input value="&quot;${folder}&quot;"></section>`;
    const properties = detection.buildImmediateShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(properties.exePath === exe && properties.startDir === folder, 'Only identity-owned native Properties supplies its original quoted target and start directory');
    frame.remove(); window.SteamClient = undefined;

    state.requests = []; state.events = []; state.detailsCalls = 0;
    window.appStore.m_mapApps.set(id, { appid: id, display_name: 'bf3' });
    let releaseContext;
    state.details = () => new Promise(resolve => { releaseContext = resolve; });
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => modal() && selected().value === strong.appid, 'Full-path first phase did not select BF3');
    check(state.events[0] === 'context' && state.events[1] === 'local', 'VDF hydration starts concurrently before fast local discovery finishes');
    check(detection.DETECTION_MODEL_VERSION === 'v12', 'Changed detection behavior uses a fresh frontend cache model');
    check(state.requests[0].exe_path === exe && state.requests[0].start_dir === folder && state.requests[0].title === 'bf3',
      'The first production backend request preserves E:\\Juegos\\Battlefield 3\\bf3.exe and its folder');
    check(title() === 'Steam game detected' && name() === strong.name, 'Actual path evidence can immediately present the correct BF3 review');
    check(modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${exe}`, 'Review displays the complete original executable path rather than a basename or title');
    releaseContext({ exe_path: exe, start_dir: folder });
    await waitFor(() => state.requests.some(request => request.phase === 'remote'), 'Remote phase did not run');
    await new Promise(resolve => setTimeout(resolve, 20));
    check(state.requests.every(request => request.exe_path === exe && request.start_dir === folder), 'Both local phases and remote enrichment retain the original full launch definition');
    check(selected().value === strong.appid && selected().options[1].value === strong.appid, 'A 7-point remote result cannot displace stronger local BF3 evidence');
    check(state.requests.filter(request => request.phase === 'local').length === 1, 'Unchanged full executable context reuses its first local detection instead of repeating the same IPC');
    close();

    // Weak candidates remain available for deliberate manual selection.
    const beforeImages = state.officialCalls.length;
    manual.showShortcutManualLinkModal(document, context, { candidates: [weak] }, { source: 'native-add-auto' });
    check(title() === 'Link game' && !modal().querySelector('.gdl-manual-link-dialog-message').textContent.includes('likely'), 'Seven-point evidence is never announced as a detected or likely Steam game');
    check(!modal().querySelector('.gdl-manual-link-dialog-subtitle').textContent.includes('ready') && selected().value === '' && confirm().disabled,
      'Weak evidence starts with a neutral placeholder and disabled link action');
    check(state.officialCalls.length === beforeImages && name() === 'bf3', 'An unselected weak result does not request or display its unrelated game artwork');
    check(selected().textContent.includes('7/100') && !selected().textContent.includes('7%'), 'Heuristic score is displayed as points rather than a calibrated probability');
    choose(weak.appid);
    check(!confirm().disabled && name() === weak.name && title() === 'Link game', 'A user may explicitly choose an uncertain result without claiming automatic identification');
    modal()._updateCandidates([strong], true);
    check(selected().value === weak.appid && name() === weak.name, 'Remote results cannot replace an explicitly chosen candidate, even when absent from the new candidate list');
    const manualId = modal().querySelector('.gdl-manual-link-manual-appid'); manualId.value = '123456'; manualId.dispatchEvent(new Event('input', { bubbles: true }));
    modal()._updateCandidates([strong], true); modal()._updateContext({ ...context });
    check(manualId.value === '123456' && name() === 'Manual Steam AppID' && modal().querySelector('.gdl-manual-link-id').textContent === 'Steam AppID 123456',
      'Async candidate and context updates preserve the user AppID and its manual preview');
    modal()._updateCandidates([], false); modal()._markEnrichmentComplete();
    check(manualId.value === '123456' && name() === 'Manual Steam AppID' && !confirm().disabled, 'Finishing an empty enrichment cannot clear or disable a manual AppID');
    manualId.value = ''; manualId.dispatchEvent(new Event('input', { bubbles: true }));
    choose(weak.appid);
    modal()._updateCandidates([strong], true, [weak.appid]);
    check(selected().value === '' && confirm().disabled && ![...selected().options].some(option => option.value === weak.appid),
      'An official rejection removes the chosen suggestion without silently selecting another game');
    manualId.value = '123456'; manualId.dispatchEvent(new Event('input', { bubbles: true }));
    modal()._updateCandidates([], true, ['123456']);
    check(manualId.value === '123456' && !confirm().disabled, 'An explicit manual AppID is preserved independently from automatic candidate rejection');
    close();
    const contradictoryCandidates = [{ ...weak, direct: true, confidence: 'exact' }, { ...strong, identity_collision: true }, { ...strong, ambiguous: true }, { ...strong, negative_reasons: ['sequel_mismatch'] }];
    for (const contradictory of contradictoryCandidates) {
      manual.showShortcutManualLinkModal(document, context, { candidates: [contradictory] }, { source: 'native-add-auto' });
      check(selected().value === '' && confirm().disabled && title() === 'Link game', 'Direct/confidence flags and high scores cannot bypass weak or ambiguous identity evidence');
      choose(contradictory.appid);
      check(selected().textContent.includes('[LOW]') && modal().querySelector('.gdl-manual-link-id').textContent.includes('[LOW]'),
        'Modal option and selected badge retain low confidence for weak, ambiguous or contradictory evidence'); close();
    }

    // Newly added shortcuts can publish their executable after their title.
    record.app = { appid: id, display_name: 'bf3' }; window.appStore.m_mapApps.set(id, record.app);
    state.requests = []; state.detailsCalls = 0;
    state.details = () => state.detailsCalls === 1 ? {} : { exe_path: exe, start_dir: folder };
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => modal() && state.requests.length, 'Initial late-context request missing');
    check(selected().value === '' && confirm().disabled && title() === 'Link game', 'A title-only 7-point result remains unselected while launch context hydrates');
    await waitFor(() => selected().value === strong.appid, 'Late VDF executable was not retried');
    check(state.detailsCalls >= 2 && state.requests.some(request => request.exe_path === exe && request.start_dir === folder),
      'Missing executable triggers a bounded context retry despite an already known shortcut title');
    await waitFor(() => state.requests.some(request => request.phase === 'remote'), 'Late-context remote enrichment missing'); close();

    state.requests = []; state.detailsCalls = 0;
    state.details = () => new Promise(resolve => { releaseContext = resolve; });
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => modal() && state.requests.length, 'Cancellation fixture did not publish the first local phase');
    close(); releaseContext({ exe_path: exe, start_dir: folder });
    await new Promise(resolve => setTimeout(resolve, 30));
    check(!modal() && state.requests.length === 1 && state.detailsCalls === 1, 'Closing review cancels publication and further detection after pending launch context resolves');
    state.requests = []; state.details = () => new Promise(resolve => { releaseContext = resolve; });
    manual.requestManualShortcutLink(id, 'bf3', document);
    await waitFor(() => modal() && state.requests.length, 'Manual cancellation fixture did not start');
    close(); releaseContext({ exe_path: exe, start_dir: folder });
    await new Promise(resolve => setTimeout(resolve, 30));
    check(!modal(), 'A manually opened review also stays closed when delayed context arrives');

    // Terminal identity failures must not queue a different executable for retry.
    record.app = { appid: id, display_name: 'bf3', strShortcutExe: exe, strShortcutStartDir: folder };
    window.appStore.m_mapApps.set(id, record.app);
    for (const code of ['shortcut_identity_changed', 'shortcut_identity_ambiguous', 'shortcut_not_found']) for (const thrown of [false, true]) {
      manual.showShortcutManualLinkModal(document, context, { candidates: [weak] }, { source: 'native-add-auto' }); choose(weak.appid);
      state.linkResult = () => { if (thrown) throw new Error(code); return { ok: false, error: `Error: ${code}` }; };
      const before = state.links.length, cancelled = state.cancelled.length; confirm().click();
      await waitFor(() => state.links.length > before && state.cancelled.length >= cancelled + 2 && !confirm().disabled, 'Terminal identity failure was not cancelled');
      check(!state.queued.length && state.links.at(-1).steamAppId === weak.appid && state.links.at(-1).shortcutExecutable === exe,
        `${thrown ? 'Thrown' : 'Returned'} ${code} preserves explicit selection and original executable without automatic queue retry`);
      close();
    }

    // Real modal progress must distinguish durable completion, failure and cancellation.
    manual.showShortcutManualLinkModal(document, context, { candidates: [strong] });
    let finishLink;
    state.linkResult = () => new Promise(resolve => { finishLink = resolve; });
    confirm().click(); await waitFor(() => finishLink, 'Pending foreground operation missing');
    const initialStatus = modal().querySelector('.gdl-manual-link-status').textContent;
    modal()._updateCandidates([weak], true); modal()._markEnrichmentComplete();
    modal()._updateContext({ ...context, exePath: '', startDir: '' });
    check(selected().value === strong.appid && confirm().disabled && selected().disabled && modal().querySelector('.gdl-manual-link-status').textContent === initialStatus,
      'Late detection and context results cannot replace selection, clear progress or re-enable controls during linking');
    check(modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${exe}`, 'Empty late context cannot erase a known full executable path');
    check(![...modal().querySelectorAll('[data-step]')].some(step => step.style.color === 'rgb(164, 208, 7)'), 'No stage is marked complete before the foreground link is confirmed');
    finishLink({ ok: true, shortcutAppId: id, setup: { artworkComplete: false, iconApplied: true } });
    await waitFor(() => state.job && !modal().querySelector('.gdl-manual-link-cancel').disabled, 'Partial setup was not queued');
    check(!modal().querySelector('.gdl-manual-link-status').textContent.includes('Linked.') && confirm().disabled, 'Partial setup remains pending without a premature linked/success message');
    const latePaste = modal().querySelector('.gdl-manual-link-manual-appid'); latePaste.value = weak.appid; latePaste.dispatchEvent(new Event('input', { bubbles: true }));
    check(latePaste.value === '' && confirm().disabled, 'A late clipboard input cannot replace or re-enable a queued link selection');
    state.job.status = 'failed'; window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    check(!confirm().disabled && confirm().style.display !== 'none' && !selected().disabled, 'Failed background resources restore a visible retry action and unlock selection');
    close();
    const enqueueFixture = async () => {
      state.job = null; state.completed = undefined;
      manual.showShortcutManualLinkModal(document, context, { candidates: [strong] });
      state.linkResult = () => ({ ok: false, error: 'steam_api_timeout' }); confirm().click();
      await waitFor(() => state.job, 'Background fixture did not queue');
    };
    await enqueueFixture(); state.job = null; state.completed = false;
    window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    check(!confirm().disabled && !modal().querySelector('.gdl-manual-link-status').textContent.includes('✓ Ready'), 'Removing or cancelling a queue job never reports a successful setup'); close();
    await enqueueFixture(); state.job = null; state.completed = true; state.completedId = id + 1;
    window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    check(confirm().style.display === 'none' && modal().querySelector('.gdl-manual-link-status').textContent.includes('✓ Ready'), 'Verified queue completion alone finishes the dialog and hides the link action'); close();
    check(state.navigated === id + 1, 'Finishing after a rename opens the final regenerated shortcut ID'); state.completedId = null;
    await enqueueFixture(); const removedModal = modal(); close();
    manual.showShortcutManualLinkModal(document, context, { candidates: [weak] });
    state.job = null; state.completed = true; window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    check(!removedModal.isConnected && !modal().querySelector('.gdl-manual-link-status').textContent.includes('✓ Ready') && confirm().style.display !== 'none', 'A closed modal releases its watcher and cannot complete a replacement dialog'); close();
    state.job = null; state.completed = undefined; state.queued = [];

    // Simulate unresponsive read-only IPC without spending real timeout budgets.
    const originalTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => originalTimeout(callback, [1800, 6500].includes(delay) ? 30 : delay, ...args);
    let finishLocal;
    state.local = () => new Promise(resolve => { finishLocal = resolve; });
    check(await detection.detectShortcutCandidatesLocal(context) === null, 'Unresponsive local detection ends within its budget instead of leaving the modal searching forever');
    finishLocal([weak]); state.local = () => [strong];
    check((await detection.detectShortcutCandidatesLocal(context)).candidates[0].appid === strong.appid, 'A timed-out local request cannot poison the next successful detection');
    state.remote = () => new Promise(() => {});
    check(await detection.enrichShortcutCandidatesRemote(context, [strong]) === null, 'Unresponsive remote enrichment ends without blocking manual linking or preserving a forever-loading state');
    window.setTimeout = originalTimeout; state.remote = () => [weak];

    const propertiesApi = load('properties');
    const mountProperties = () => {
      document.getElementById('fixture-properties')?.remove(); window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
      const host = document.createElement('section'); host.id = 'fixture-properties'; host.className = 'PagedSettingsDialog'; host.dataset.appid = String(id); host.setAttribute('role', 'dialog');
      host.innerHTML = `<div>Target<input value="&quot;${exe}&quot;"></div><div>Start In<input value="&quot;${folder}&quot;"></div>`;
      document.body.appendChild(host); propertiesApi.tryInjectPropertiesField(document, 'Properties - bf3'); return host;
    };
    const propsSelect = () => document.querySelector('#fixture-properties .gdl-auto-candidates');
    const propsInput = () => document.querySelector('#fixture-properties .gdl-appid-input');
    const propsSave = () => document.querySelector('#fixture-properties .gdl-save-btn');
    const propsTitle = () => document.querySelector('#fixture-properties .gdl-auto-detect-title').textContent;
    const chooseProperty = value => { propsSelect().value = value; propsSelect().dispatchEvent(new Event('change', { bubbles: true })); };
    const hasPropertyCandidate = appid => propsSelect() && [...propsSelect().options].some(option => option.value === appid);
    state.details = () => ({ exe_path: exe, start_dir: folder }); state.local = () => [weak];
    let releaseRemote;
    state.remote = () => new Promise(resolve => { releaseRemote = resolve; }); mountProperties();
    await waitFor(() => hasPropertyCandidate(weak.appid) && releaseRemote, 'Properties did not render the real local detection result');
    check(propsSelect().value === '' && propsInput().value === '' && propsSave().disabled && !propsTitle().includes('Detected:'),
      'Properties leaves a seven-point suggestion unselected, neutral and unable to link');
    check(document.querySelector('#fixture-properties .gdl-auto-candidate-preview').style.display === 'none', 'Properties does not display unrelated weak-candidate artwork before selection');
    chooseProperty(weak.appid);
    check(propsInput().value === weak.appid && !propsSave().disabled && !propsTitle().includes('Detected:'), 'Properties permits explicit uncertain selection with a warning rather than an automatic detection claim');
    check(document.querySelector('#fixture-properties .gdl-candidate-meta').textContent.includes('7/100') && propsSelect().textContent.includes('7/100'), 'Properties preview and suggestion scores use points consistently');
    propsInput().value = 'https://store.steampowered.com/app/123456/'; propsInput().dispatchEvent(new Event('input', { bubbles: true }));
    releaseRemote([strong]); await waitFor(() => hasPropertyCandidate(strong.appid), 'Properties remote enrichment did not finish');
    check(propsInput().value === '123456' && propsSelect().value === weak.appid && !propsTitle().includes('Detected:'),
      'Properties remote enrichment preserves manual AppID entry after a previous explicit candidate selection');
    check(document.querySelector('#fixture-properties .gdl-auto-candidate-preview').style.display === 'none', 'Manual AppID preview is not overwritten by a late automatic candidate');
    state.remote = () => new Promise(resolve => { releaseRemote = resolve; }); mountProperties();
    await waitFor(() => hasPropertyCandidate(weak.appid) && releaseRemote, 'Official-rejection Properties fixture missing');
    chooseProperty(weak.appid); releaseRemote({ candidates: [strong], rejected_appids: [weak.appid] });
    await waitFor(() => hasPropertyCandidate(strong.appid), 'Official rejection did not reach Properties');
    check(!hasPropertyCandidate(weak.appid) && propsSelect().value === '' && propsInput().value === '' && propsSave().disabled,
      'Properties removes an officially rejected selection without resurrecting it or substituting BF3 automatically');
    state.remote = () => new Promise(resolve => { releaseRemote = resolve; }); mountProperties();
    await waitFor(() => hasPropertyCandidate(weak.appid), 'Offline Properties fixture missing');
    chooseProperty(weak.appid); releaseRemote({ candidates: [], transient_error: true });
    await new Promise(resolve => setTimeout(resolve, 30));
    check(hasPropertyCandidate(weak.appid) && propsSelect().value === weak.appid && !propsSave().disabled,
      'A failed remote request does not act like an official rejection of the explicit choice');
    state.local = () => [strong]; state.remote = () => ({ candidates: [], rejected_appids: [strong.appid] });
    const rejectedDetection = await detection.detectShortcutCandidates(context);
    check(rejectedDetection.candidates.length === 0 && rejectedDetection.rejected_appids.includes(strong.appid),
      'Combined detection cannot resurrect a local candidate after an empty remote result with an official rejection');
    state.local = () => [weak];
    state.remembered = weak.appid; state.remote = () => [weak]; mountProperties();
    await waitFor(() => hasPropertyCandidate(weak.appid), 'Remembered weak suggestion missing');
    check(propsSelect().value === '' && propsInput().value === '' && propsSave().disabled, 'Remembered history alone cannot preselect an unrelated weak Properties suggestion');
    state.remembered = ''; state.local = () => [strong]; mountProperties();
    await waitFor(() => propsInput().value === strong.appid, 'Properties failed to preselect corroborated BF3');
    check(propsSelect().value === strong.appid && propsTitle().includes('Detected: Battlefield 3'), 'Properties can preselect and identify BF3 when the same shared evidence criterion is satisfied');
    for (const contradictory of contradictoryCandidates) {
      state.local = () => [contradictory]; state.remote = () => []; mountProperties();
      await waitFor(() => hasPropertyCandidate(contradictory.appid), 'Contradictory Properties fixture is missing candidate');
      check(!propsSelect().value && propsSave().disabled && propsSelect().textContent.includes('[LOW]'), 'Properties applies the same uncertainty criterion to preselection and option confidence');
      chooseProperty(contradictory.appid);
      check(document.querySelector('#fixture-properties .gdl-candidate-meta').textContent.includes('[LOW]') && !propsTitle().includes('Detected:'), 'Explicit Properties preview retains uncertainty instead of displaying a misleading high-confidence badge');
    }
    state.local = () => [weak]; state.remote = () => [weak];
    for (const code of ['shortcut_identity_changed', 'shortcut_identity_ambiguous', 'shortcut_not_found']) for (const thrown of [false, true]) {
      mountProperties(); await waitFor(() => hasPropertyCandidate(weak.appid), 'Terminal Properties fixture is missing candidate'); chooseProperty(weak.appid);
      state.linkResult = () => { if (thrown) throw new Error(code); return { ok: false, error: `Error: ${code}` }; };
      const before = state.links.length, cancelled = state.cancelled.length; propsSave().click();
      await waitFor(() => state.links.length > before && state.cancelled.length >= cancelled + 2 && !propsSave().disabled, 'Terminal Properties identity failure was not cancelled');
      check(!state.queued.length && state.links.at(-1).shortcutExecutable === exe, `Properties ${thrown ? 'thrown' : 'returned'} ${code} never queues an automatic retry against another executable`);
    }
    document.getElementById('fixture-properties')?.remove(); window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    return { checks: results.length, results };
  }, sources);
  assert(report.checks >= 25);
  assert.deepEqual(pageErrors, [], 'Production modal event handlers must not throw browser errors');
  console.log(`Detection review browser passed: ${report.checks} checks; real modal/Properties, BF3 full-path/context retry, 7-point review, owner isolation, explicit/manual selection, confidence contradictions and terminal identity errors.`);
} finally { await browser.close(); }
