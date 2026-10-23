import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';

const sources = Object.fromEntries(Object.entries({
  detection: 'frontend/features/shortcuts/detection.ts', manual: 'frontend/features/shortcuts/manual-link.ts',
  review: 'frontend/features/shortcuts/manual-link-review.ts',
  progress: 'frontend/features/shortcuts/manual-link-progress.ts',
  merger: 'frontend/features/shortcuts/candidate-merger.ts', shortcuts: 'frontend/steam/shortcuts.ts',
  details: 'frontend/steam/library-details.ts', modal: 'frontend/core/modal.ts',
  launchDetails: 'frontend/steam/shortcut-details.ts',
  properties: 'frontend/features/shortcuts/properties.ts',
  propertyDetection: 'frontend/features/shortcuts/properties-detection.ts',
  propertySummary: 'frontend/features/shortcuts/properties-summary.ts',
}).map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(key === 'manual' && process.env.DETECTION_REVIEW_MANUAL_SOURCE
  ? process.env.DETECTION_REVIEW_MANUAL_SOURCE : file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));
const browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
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
      detectGameCandidatesLocalBackend: async ({ request_json }) => { const request = JSON.parse(request_json); state.events.push('local'); state.requests.push(request); const value = await state.local(request); return Array.isArray(value) ? { candidates: value } : value; },
      detectGameCandidatesBackend: async ({ request_json }) => { const request = JSON.parse(request_json); state.requests.push(request); const value = await state.remote(request); return Array.isArray(value) ? { candidates: value } : value; },
      getAllShortcutRecords: () => state.records || [record], shortcutAlreadyLinked: () => false, findMappingForShortcut: () => state.linkedMapping || null,
      unlinkShortcutFromSteam: async () => { state.linkedMapping = null; return state.unlinkResult; },
      isShortcutDismissed: () => false, undismissShortcut() {},
      shortcutRuntimeHost: () => ({ getMainWindowDoc: () => document }),
      navigateToLibraryShortcut: (_doc, shortcutId) => { state.navigated = shortcutId; },
      getGameData: async appid => { state.officialCalls.push(appid); return null; },
      getPendingLinkJob: () => state.job || null, getLinkJobCompletion: () => state.completed,
      getLinkJobCompletedShortcutAppId: () => state.completed ? state.completedId || id : null,
      getLinkJobResourcesPending: () => false,
      PENDING_LINK_JOBS_CHANGED_EVENT: 'gdl:pending-link-jobs-changed', shouldAutoApplyNoLauncher: () => false,
      isShortcutIdentityMutationInProgress: () => false, clearShortcutEdition() {}, saveShortcutEdition() {},
      stageLinkJobForRecovery() {}, cancelPendingLinkJobs: (...args) => state.cancelled.push(args),
      enqueueLinkJob: input => { state.queued.push(input); state.completed = undefined; return state.job = { ...input, id: 'fixture-job', createdAt: Date.now(), status: 'queued', attempts: 0 }; },
      linkShortcutToSteam: async input => { state.links.push(input); return state.linkResult(); },
      getCachedGameData: () => null, subscribeMappings: () => () => {}, SHORTCUT_PROPERTIES_STYLE: '',
      rememberedShortcutSteamAppId: () => state.remembered || '',
      findNativePropertiesPage: doc => doc.getElementById('fixture-properties'), tryInjectNativePropertiesField() {}, tryInjectCustomizationArtwork() {},
      bindShortcutAchievementSettings: () => ({ sync() {} }), shortcutAchievementSettingsHtml: () => '',
      bindShortcutCommunityItemSettings: () => ({ sync() {}, dispose() {} }), shortcutCommunityItemSettingsHtml: () => '',
      bindShortcutPlaytimeProperties: () => ({ sync() {} }), shortcutPlaytimePropertiesHtml: () => '', hasPendingLinkJob: () => false,
    };
    const load = key => {
      if (modules[key]) return modules[key];
      const exports = {}; modules[key] = exports;
      const require = spec => {
        const selected = { './detection': 'detection', './candidate-merger': 'merger', './manual-link-review': 'review', '../../steam/shortcuts': 'shortcuts',
          '../../steam/library-details': 'details', '../../core/modal': 'modal', './manual-link-progress': 'progress', '../../steam/shortcut-details': 'launchDetails', './properties-detection': 'propertyDetection', './properties-summary': 'propertySummary' }[spec];
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
    owner.SteamClient = { Apps: { RegisterForAppDetails: (_id, callback) => { ownerReads++; callback({ unAppID: id, strShortcutExe: exe, strShortcutStartDir: folder }); return { unregister() {} }; } } };
    window.SteamClient = { Apps: { RegisterForAppDetails: (_id, callback) => { foreignReads++; callback({ unAppID: id, strShortcutExe: 'C:\\Wrong\\other.exe' }); return { unregister() {} }; } } };
    const owned = await detection.buildShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(owned.exePath === exe && owned.startDir === folder && ownerReads === 1 && foreignReads === 0,
      'Context reads full BF3 path from its owning SteamClient, never the background realm or another Properties dialog');
    owner.SteamClient = undefined;
    const unrelated = detection.buildImmediateShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(!unrelated.exePath, 'Unscoped path fields and another shortcut Properties cannot contaminate detection');
    ownerDoc.body.innerHTML += `<section role="dialog" class="PagedSettingsDialog" data-appid="${id}"><input value="&quot;${exe}&quot;"><input value="&quot;${folder}&quot;"></section>`;
    const properties = detection.buildImmediateShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(properties.exePath === exe && properties.startDir === folder, 'Only identity-owned native Properties supplies its original quoted target and start directory');

    // Explicitly cleared native arguments must outrank stale overview/VDF copies.
    owner.appStore.m_mapApps.set(id, { appid: id, display_name: 'bf3', strShortcutLaunchOptions: '-old-overview-appid 111' });
    let nativeLaunchDetails = { unAppID: id, strShortcutExe: exe, strShortcutStartDir: folder, strLaunchOptions: '' };
    owner.appDetailsStore = { GetAppDetails: requestedId => requestedId === id ? nativeLaunchDetails : null };
    state.details = () => ({ exe_path: exe, start_dir: folder, launch_options: '-old-vdf-appid 222' });
    const explicitlyCleared = detection.buildImmediateShortcutDetectionContext(ownerDoc, 'bf3', id, { strArguments: '-old-fallback-appid 333' });
    check(explicitlyCleared.launchOptions === '',
      'An explicit empty native launch-options field is preserved instead of resurrecting stale overview or fallback arguments');
    const hydratedCleared = await detection.buildShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(hydratedCleared.launchOptions === '',
      'Asynchronous VDF hydration cannot restore stale arguments after native Steam details explicitly cleared them');
    nativeLaunchDetails = { unAppID: id, strShortcutExe: exe, strShortcutStartDir: folder };
    owner.appStore.m_mapApps.set(id, { appid: id, display_name: 'bf3' });
    const genuinelyMissing = await detection.buildShortcutDetectionContext(ownerDoc, 'bf3', id);
    check(genuinelyMissing.launchOptions === '-old-vdf-appid 222',
      'VDF arguments remain available as a fallback when every native launch-options field is genuinely absent');
    state.details = () => ({});
    frame.remove(); window.SteamClient = undefined;

    // Review ownership includes popup documents, not only the module's global document.
    const popupFrames = [document.createElement('iframe'), document.createElement('iframe')];
    popupFrames.forEach(popup => document.body.appendChild(popup));
    const [firstPopupDoc, secondPopupDoc] = popupFrames.map(popup => popup.contentDocument);
    manual.showShortcutManualLinkModal(firstPopupDoc, context, { candidates: [strong] });
    const previousPopupModal = firstPopupDoc.getElementById('gdl-manual-link-modal');
    manual.showShortcutManualLinkModal(secondPopupDoc, { ...context, shortcutAppId: id + 30 }, { candidates: [strong] });
    const currentPopupModal = secondPopupDoc.getElementById('gdl-manual-link-modal');
    check(!previousPopupModal.isConnected && currentPopupModal?.isConnected,
      'Opening review in another Steam popup disposes the previous document modal instead of leaving two active reviews');
    firstPopupDoc.dispatchEvent(new popupFrames[0].contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(currentPopupModal.isConnected,
      'The previous popup document releases its Escape listener and cannot dismiss the current review');
    secondPopupDoc.dispatchEvent(new popupFrames[1].contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check(!currentPopupModal.isConnected, 'Escape in the current owning popup still disposes its own review');
    popupFrames.forEach(popup => popup.remove());

    state.requests = []; state.events = []; state.detailsCalls = 0;
    window.appStore.m_mapApps.set(id, { appid: id, display_name: 'bf3' });
    let releaseContext;
    state.details = () => new Promise(resolve => { releaseContext = resolve; });
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => modal() && selected().value === strong.appid, 'Full-path first phase did not select BF3');
    check(state.events[0] === 'context' && state.events[1] === 'local', 'VDF hydration starts concurrently before fast local discovery finishes');
    check(detection.DETECTION_MODEL_VERSION === 'v13', 'Changed detection behavior uses a fresh frontend cache model');
    check(state.requests[0].exe_path === exe && state.requests[0].start_dir === folder && state.requests[0].title === 'bf3',
      'The first production backend request preserves E:\\Juegos\\Battlefield 3\\bf3.exe and its folder');
    check(title() === 'Steam game detected' && name() === strong.name, 'Actual path evidence can immediately present the correct BF3 review');
    check(modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${exe}`, 'Review displays the complete original executable path rather than a basename or title');
    releaseContext({ exe_path: exe, start_dir: folder });
    await waitFor(() => state.requests.some(request => request.phase === 'remote'), 'Remote phase did not run');
    const firstRemoteDeadline = state.requests.find(request => request.phase === 'remote').expires_at_ms;
    check(Number.isFinite(firstRemoteDeadline) && firstRemoteDeadline > Date.now() && firstRemoteDeadline < Date.now() + 6500,
      'Remote detection supplies a future backend deadline that expires before the frontend lookup budget');
    await new Promise(resolve => setTimeout(resolve, 20));
    check(state.requests.every(request => request.exe_path === exe && request.start_dir === folder), 'Both local phases and remote enrichment retain the original full launch definition');
    check(selected().value === strong.appid && selected().options[1].value === strong.appid, 'A 7-point remote result cannot displace stronger local BF3 evidence');
    check(state.requests.filter(request => request.phase === 'local').length === 1, 'Unchanged full executable context reuses its first local detection instead of repeating the same IPC');
    close();

    // A second game's native-add event must create its own review identity.
    const rocketId = id + 10, rocketExe = 'E:\\Juegos\\Rocket League\\Binaries\\Win64\\RocketLeague.exe';
    const rocket = { appid: '252950', name: 'Rocket League', score: 99, confidence: 'exact', evidence_tier: 'strong' };
    const rocketContext = { shortcutAppId: rocketId, title: 'RocketLeague', exePath: rocketExe, startDir: 'E:\\Juegos\\Rocket League', launchOptions: '' };
    const originalRecord = { ...record };
    manual.showShortcutManualLinkModal(document, context, { candidates: [strong] });
    record.id = rocketId; record.title = rocketContext.title;
    record.app = { appid: rocketId, display_name: rocketContext.title, strShortcutExe: rocketExe, strShortcutStartDir: rocketContext.startDir };
    window.appStore.m_mapApps.set(rocketId, record.app);
    let releaseRocketLocal;
    state.local = () => new Promise(resolve => { releaseRocketLocal = resolve; });
    state.details = () => ({ exe_path: rocketExe, start_dir: rocketContext.startDir });
    state.remote = () => [rocket];
    manual.requestNativeAddShortcutReview(rocketId, rocketContext.title, document);
    await waitFor(() => releaseRocketLocal, 'Second-game detection did not start');
    check(modal()._shortcutAppId === rocketId && name() === rocketContext.title && selected().value === '',
      'A newly opened game review immediately replaces a different game dialog before asynchronous detection returns');
    releaseRocketLocal([rocket]);
    await waitFor(() => selected().value === rocket.appid, 'Second-game review did not publish Rocket League');
    check(modal()._shortcutAppId === rocketId && modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${rocketExe}`,
      'Candidate identity, executable summary and final review all belong to the same newly added game');
    close(); record.app = { appid: rocketId, display_name: rocketContext.title };
    window.appStore.m_mapApps.set(rocketId, record.app); state.requests = []; state.details = () => ({});
    state.local = request => request.exe_path === rocketExe ? [rocket] : [];
    manual.requestNativeAddShortcutReview(rocketId, rocketContext.title, document, { exePath: rocketExe, startDir: rocketContext.startDir });
    await waitFor(() => state.requests.length && modal(), 'Native-add executable hint fixture did not start');
    check(state.requests[0].exe_path === rocketExe && state.requests[0].start_dir === rocketContext.startDir
      && modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${rocketExe}`,
      'The original native-add selection supplies a full executable before Steam publishes overview or VDF details');
    await waitFor(() => selected().value === rocket.appid, 'Native-add executable hint was not used for detection');
    close(); Object.assign(record, originalRecord); window.appStore.m_mapApps.delete(rocketId);
    window.appStore.m_mapApps.set(id, record.app);
    state.local = request => request.exe_path ? [strong] : [weak]; state.remote = () => [weak]; state.details = () => ({});

    // In-flight local results must not publish into a directly replaced dialog.
    let releaseStaleLocal;
    state.local = () => new Promise(resolve => { releaseStaleLocal = resolve; });
    state.details = () => ({ exe_path: exe, start_dir: folder });
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => releaseStaleLocal, 'Stale local fixture did not start');
    manual.showShortcutManualLinkModal(document, rocketContext, { candidates: [rocket] });
    state.local = () => [strong]; releaseStaleLocal([strong]);
    await new Promise(resolve => setTimeout(resolve, 40));
    check(modal()._shortcutAppId === rocketId && name() === rocket.name && selected().value === rocket.appid
      && modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${rocketExe}`,
      'Delayed local discovery for a previous game cannot replace a different dialog candidate or executable');
    close(); state.details = () => ({}); state.requests = [];
    state.local = request => request.exe_path ? [strong] : [weak];

    // An exhausted empty lookup must settle every part of the same dialog.
    manual.showShortcutManualLinkModal(document, context, { candidates: [] }, { source: 'native-add-auto', loading: true });
    modal()._updateCandidates([], false); modal()._markEnrichmentComplete();
    check(!selected().textContent.includes('Searching') && selected().textContent.includes('No automatic suggestions'),
      'Settling an empty enrichment clears the stale searching option as well as the message and status');
    check(!modal().querySelector('.gdl-manual-link-dialog-message').textContent.includes('Searching')
      && !modal().querySelector('.gdl-manual-link-status').textContent.includes('Searching') && confirm().disabled,
      'A successful empty lookup consistently ends searching and requires a deliberate manual AppID');
    close();

    // Failure to obtain evidence is different from an actual empty result.
    manual.showShortcutManualLinkModal(document, { ...context, exePath: '', startDir: '' }, { candidates: [] }, { source: 'native-add-auto', loading: true });
    modal()._updateCandidates([], false); modal()._markEnrichmentComplete(true);
    check(!selected().textContent.includes('Searching')
      && modal().querySelector('.gdl-manual-link-dialog-message').textContent.includes('Steam search could not finish')
      && modal().querySelector('.gdl-manual-link-status').textContent.includes('Steam search could not finish'),
      'Unavailable launch context or detection does not falsely claim a completed no-match search or retain a searching option');
    const unavailableInput = modal().querySelector('.gdl-manual-link-manual-appid');
    unavailableInput.value = strong.appid; unavailableInput.dispatchEvent(new Event('input', { bubbles: true }));
    check(!confirm().disabled, 'A settled unavailable search still permits an explicit manual AppID');
    close();

    manual.showShortcutManualLinkModal(document, context, { candidates: [] }, { loading: true });
    const pendingManualInput = modal().querySelector('.gdl-manual-link-manual-appid');
    pendingManualInput.value = '123456'; pendingManualInput.dispatchEvent(new Event('input', { bubbles: true }));
    modal()._updateCandidates([], false); modal()._markEnrichmentComplete(true);
    check(!selected().textContent.includes('Searching') && selected().textContent.includes('Search unavailable')
      && pendingManualInput.value === '123456' && !confirm().disabled,
      'A lookup settling while a manual AppID is present also clears the searching placeholder without disturbing the manual choice');
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

    // Closing an old generation must release the same game's next review immediately.
    let releasePreviousReviewContext;
    state.requests = []; state.detailsCalls = 0;
    state.details = () => state.detailsCalls === 1 ? new Promise(resolve => { releasePreviousReviewContext = resolve; }) : { exe_path: exe, start_dir: folder };
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => releasePreviousReviewContext && state.requests.length, 'Previous review generation did not reach its pending context');
    close(); manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => state.requests.length >= 2 && modal(), 'Replacement review generation did not start');
    releasePreviousReviewContext({ exe_path: exe, start_dir: folder });
    await waitFor(() => selected().value === strong.appid, 'A cancelled previous generation left the immediately reopened review permanently searching');
    check(modal()._shortcutAppId === id && modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${exe}`,
      'An immediately reopened review progresses using its own generation while the previous context is still settling');
    close();

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

    // An explicit native shortcut ID must remain authoritative before the new row is indexed.
    state.details = () => ({}); state.local = () => []; state.remote = () => [];
    state.records = [{ id, title: 'Shared title', app: { appid: id, display_name: 'Shared title' } }];
    const pendingNewId = id + 20;
    check(manual.requestManualShortcutLink(pendingNewId, 'Shared title', document), 'A valid newly published shortcut ID may open review before appearing in the registry');
    check(modal()?._shortcutAppId === pendingNewId,
      'A newly added explicit shortcut ID cannot be replaced by an older shortcut merely because their titles match');
    close();
    state.records.push({ id: id + 21, title: 'Shared title', app: { appid: id + 21, display_name: 'Shared title' } });
    check(!manual.requestManualShortcutLink(0, 'Shared title', document) && !modal(),
      'Without an authoritative ID, duplicate shortcut titles cannot select an arbitrary identity or invent a synthetic hash ID');
    state.records = null; state.local = request => request.exe_path ? [strong] : [weak];

    // Terminal identity failures must not queue a different executable for retry.
    record.app = { appid: id, display_name: 'bf3', strShortcutExe: exe, strShortcutStartDir: folder };
    window.appStore.m_mapApps.set(id, record.app);
    for (const code of ['shortcut_identity_changed', 'shortcut_identity_ambiguous', 'shortcut_not_found', 'steam_appid_file_protection_failed']) for (const thrown of [false, true]) {
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
    modal()._updateContext({ ...context, exePath: 'D:\\Another game\\other.exe', startDir: 'D:\\Another game', launchOptions: '--different-game' });
    finishLink({ ok: true, shortcutAppId: id, setup: { artworkComplete: false, iconApplied: true } });
    await waitFor(() => state.job && !modal().querySelector('.gdl-manual-link-cancel').disabled, 'Partial setup was not queued');
    check(state.job.shortcutExecutable === exe && state.job.existingLaunchOptions === context.launchOptions,
      'A late different launch definition cannot retarget the queued continuation away from the executable and options confirmed at submission');
    check(modal().querySelector('.gdl-manual-link-status').textContent.includes('Linked.') && confirm().style.display === 'none', 'A committed link is successful while optional images continue in the background');
    const latePaste = modal().querySelector('.gdl-manual-link-manual-appid'); latePaste.value = weak.appid; latePaste.dispatchEvent(new Event('input', { bubbles: true }));
    check(latePaste.value === '' && confirm().disabled, 'A late clipboard input cannot replace or re-enable a queued link selection');
    state.job.status = 'failed'; window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    check(confirm().style.display === 'none' && selected().disabled, 'Optional artwork repair cannot turn a confirmed link back into a failed association');
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
    state.local = () => ({ candidates: [], transient_error: true }); state.remote = () => [];
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => modal()?.querySelector('.gdl-manual-link-status').textContent.includes('Steam search could not finish'),
      'Transient local and unavailable remote detection must settle as unavailable in the production review workflow');
    check(!selected().textContent.includes('Searching') && !modal().querySelector('.gdl-manual-link-dialog-message').textContent.includes('No reliable match'),
      'Transient empty evidence is not converted into a confident no-match message by asynchronous review completion');
    const retry = modal().querySelector('.gdl-manual-link-retry-search');
    const retryManualInput = modal().querySelector('.gdl-manual-link-manual-appid');
    retryManualInput.value = '123456'; retryManualInput.dispatchEvent(new Event('input', { bubbles: true }));
    check(retry.style.display !== 'none' && !retry.disabled, 'A failed production lookup exposes an actionable retry search control');
    const previousRemoteRequests = state.requests.filter(request => request.phase === 'remote').length;
    state.remote = () => [strong]; retry.click();
    await waitFor(() => state.requests.filter(request => request.phase === 'remote').length > previousRemoteRequests
      && [...selected().options].some(option => option.value === strong.appid), 'Retry search did not perform new detection and publish the recovered result');
    check(retryManualInput.value === '123456' && name() === 'Manual Steam AppID' && !confirm().disabled
      && modal().querySelector('.gdl-manual-link-id').textContent === 'Steam AppID 123456',
      'Retrying a transient search preserves manual AppID input and does not silently select the recovered automatic candidate');
    check(retry.style.display === 'none' && !modal().querySelector('.gdl-manual-link-status').textContent.includes('could not finish'),
      'A successful retry clears the unavailable state and hides its retry control');
    close();
    manual.showShortcutManualLinkModal(document, context, { candidates: [strong], transient_error: true });
    const retryLocalRequests = [];
    state.local = () => new Promise(resolve => retryLocalRequests.push(resolve)); state.remote = () => [];
    manual.requestManualShortcutLink(id, 'bf3', document);
    await waitFor(() => retryLocalRequests.length >= 2 && modal()?.querySelector('.gdl-manual-link-retry-search').style.display !== 'none', 'Retained-candidate retry did not settle');
    check(selected().value === strong.appid && [...selected().options].some(option => option.value === strong.appid) && !confirm().disabled,
      'Retry keeps an automatically shown candidate when the same launch context cannot obtain new local evidence');
    close(); retryLocalRequests.forEach(resolve => resolve([strong]));

    const lateLocalRequests = [];
    state.local = () => new Promise(resolve => lateLocalRequests.push(resolve)); state.remote = () => [];
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => lateLocalRequests.length >= 2 && modal()?.querySelector('.gdl-manual-link-retry-search').style.display !== 'none', 'Queued-local cold lookup did not expose retry');
    check(!modal().querySelector('.gdl-manual-link-dialog-message').textContent.includes('No reliable match'),
      'A clean empty remote response cannot turn locally timed-out evidence into a definitive no-match');
    lateLocalRequests[0]([strong]);
    await waitFor(() => selected().value === strong.appid, 'The queued local result was discarded after its fast budget');
    check(modal().querySelector('.gdl-manual-link-retry-search').style.display === 'none',
      'A valid late local completion clears the failed-search state without starting another native link operation');
    const replacementContext = { ...context, title: 'Replacement', exePath: 'C:\\Games\\Replacement\\replacement.exe', startDir: 'C:\\Games\\Replacement' };
    manual.showShortcutManualLinkModal(document, replacementContext, { candidates: [rocket] });
    lateLocalRequests[1]([strong]); await new Promise(resolve => setTimeout(resolve, 20));
    check(selected().value === rocket.appid && modal().querySelector('.gdl-manual-link-exe-summary').textContent === `Game path: ${replacementContext.exePath}`,
      'A late result cannot repaint the same modal after its executable context is replaced');
    close();

    let rejectedLateLocal;
    state.local = () => rejectedLateLocal ? [] : new Promise(resolve => { rejectedLateLocal = resolve; });
    state.remote = () => ({ candidates: [], rejected_appids: [strong.appid] });
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => rejectedLateLocal && modal()?.querySelector('.gdl-manual-link-select').textContent.includes('No automatic suggestions'), 'Official rejection fixture did not finish');
    rejectedLateLocal([strong]); await new Promise(resolve => setTimeout(resolve, 20));
    check(![...selected().options].some(option => option.value === strong.appid) && confirm().disabled,
      'Late local completion cannot resurrect an officially rejected AppID');
    close();
    const closedLocalRequests = [];
    state.local = () => new Promise(resolve => closedLocalRequests.push(resolve)); state.remote = () => [];
    manual.requestNativeAddShortcutReview(id, 'bf3', document);
    await waitFor(() => closedLocalRequests.length >= 2 && modal()?.querySelector('.gdl-manual-link-retry-search').style.display !== 'none', 'Closed late-local fixture did not settle');
    const closedReview = modal(); close(); closedLocalRequests.forEach(resolve => resolve([strong]));
    await new Promise(resolve => setTimeout(resolve, 20));
    check(!modal() && !closedReview.isConnected && !closedReview.querySelector('select').textContent.includes(strong.name),
      'Closing a timed-out lookup prevents queued local results from repainting or reopening the retired review');
    state.local = () => [strong];
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
    check(document.querySelector('#fixture-properties .gdl-link-section').dataset.linked === 'false'
      && !document.querySelector('#fixture-properties .gdl-linked-game-id').textContent,
      'Choosing a suggestion never presents it as an already committed link in the compact summary');
    check(document.querySelector('#fixture-properties .gdl-auto-candidate-strip').hidden,
      'A single candidate does not repeat its selected thumbnail in a second strip');
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
    for (const code of ['shortcut_identity_changed', 'shortcut_identity_ambiguous', 'shortcut_not_found', 'steam_appid_file_protection_failed']) for (const thrown of [false, true]) {
      mountProperties(); await waitFor(() => hasPropertyCandidate(weak.appid), 'Terminal Properties fixture is missing candidate'); chooseProperty(weak.appid);
      state.linkResult = () => { if (thrown) throw new Error(code); return { ok: false, error: `Error: ${code}` }; };
      const before = state.links.length, cancelled = state.cancelled.length; propsSave().click();
      await waitFor(() => state.links.length > before && state.cancelled.length >= cancelled + 2 && !propsSave().disabled, 'Terminal Properties identity failure was not cancelled');
      check(!state.queued.length && state.links.at(-1).shortcutExecutable === exe, `Properties ${thrown ? 'thrown' : 'returned'} ${code} never queues an automatic retry against another executable`);
    }
    window.setTimeout = (callback, delay, ...args) => originalTimeout(callback, [1800, 6500].includes(delay) ? 30 : delay, ...args);
    state.local = () => ({ candidates: [], transient_error: true }); state.remote = () => [];
    mountProperties();
    await waitFor(() => document.querySelector('#fixture-properties .gdl-auto-detect-retry')?.hidden === false, 'Incomplete Properties lookup did not expose retry');
    check(propsTitle().includes('Steam search could not finish') && !propsSelect().textContent.includes('No automatic suggestions'),
      'Properties distinguishes an incomplete local search from a completed empty result');
    state.local = () => [strong]; document.querySelector('#fixture-properties .gdl-auto-detect-retry').click();
    await waitFor(() => propsSelect().value === strong.appid, 'Properties retry failed to recover its local match');
    check(document.querySelector('#fixture-properties .gdl-auto-detect-retry').hidden,
      'A successful Properties retry clears the unavailable state');

    state.local = () => [strong]; state.remote = () => ({ candidates: [], transient_error: true }); mountProperties();
    await waitFor(() => hasPropertyCandidate(strong.appid) && document.querySelector('#fixture-properties .gdl-auto-detect-retry')?.hidden === false, 'Known Properties candidate fixture did not settle');
    const pendingPropertyRetries = [];
    state.local = () => new Promise(resolve => pendingPropertyRetries.push(resolve)); state.remote = () => [];
    document.querySelector('#fixture-properties .gdl-auto-detect-retry').click();
    await waitFor(() => pendingPropertyRetries.length && document.querySelector('#fixture-properties .gdl-auto-detect-retry').hidden === false, 'Known Properties retry did not settle');
    check(propsSelect().value === strong.appid && hasPropertyCandidate(strong.appid),
      'Properties retry preserves its automatically shown candidate when new local evidence times out');
    pendingPropertyRetries.forEach(resolve => resolve([]));

    let latePropertyLocal;
    state.local = () => new Promise(resolve => { latePropertyLocal = resolve; }); state.remote = () => [];
    mountProperties();
    await waitFor(() => document.querySelector('#fixture-properties .gdl-auto-detect-retry')?.hidden === false, 'Queued Properties local lookup did not settle');
    latePropertyLocal([strong]); await waitFor(() => propsSelect().value === strong.appid, 'Properties discarded its bounded late local result');
    check(document.querySelector('#fixture-properties .gdl-auto-detect-retry').hidden,
      'Properties can recover from an already queued local result without another query');
    state.local = () => new Promise(resolve => { latePropertyLocal = resolve; }); mountProperties();
    await waitFor(() => document.querySelector('#fixture-properties .gdl-auto-detect-retry')?.hidden === false, 'Stale Properties fixture did not settle');
    const retiredPropertyLocal = latePropertyLocal;
    state.local = () => [weak]; mountProperties(); await waitFor(() => hasPropertyCandidate(weak.appid), 'Replacement Properties fixture missing');
    retiredPropertyLocal([strong]); await new Promise(resolve => setTimeout(resolve, 20));
    check(hasPropertyCandidate(weak.appid) && !hasPropertyCandidate(strong.appid),
      'Late local results from a removed Properties section cannot update its replacement');
    window.setTimeout = originalTimeout;
    state.linkedMapping = strong.appid; state.unlinkResult = { ok: false, error: 'steam_appid_file_restore_failed' };
    state.local = () => [strong]; mountProperties();
    const propsUnlink = () => document.querySelector('#fixture-properties .gdl-unlink-btn');
    await waitFor(() => propsUnlink() && !propsUnlink().disabled, 'Linked Properties did not enable Unlink');
    check(!document.querySelector('#fixture-properties .gdl-link-section').open
      && document.querySelector('#fixture-properties .gdl-linked-game-id').textContent.includes(strong.appid),
      'Already linked Properties starts with a compact closed summary of its committed AppID');
    propsInput().value = weak.appid; propsInput().dispatchEvent(new Event('input', { bubbles: true }));
    check(document.querySelector('#fixture-properties .gdl-linked-game-id').textContent.includes(strong.appid),
      'Editing a replacement AppID leaves the summary attached to the committed link');
    propsUnlink().click();
    await waitFor(() => propsUnlink().textContent === 'Retry', 'Restore failure did not leave an actionable retry');
    check(propsSave().textContent !== 'Linked' && !propsUnlink().disabled,
      'Failed file restoration does not recreate a removed mapping and retains an enabled retry');
    check(document.querySelector('#fixture-properties .gdl-link-section').dataset.linked === 'false'
      && !document.querySelector('#fixture-properties .gdl-linked-game-id').textContent,
      'The compact summary clears the removed link even when file restoration needs retry');
    state.unlinkResult = { ok: true }; propsUnlink().click();
    await waitFor(() => propsUnlink().disabled, 'A successful restoration retry did not finish');
    check(propsUnlink().textContent === 'Unlinked', 'Confirmed restoration completes the Properties unlink state');
    document.getElementById('fixture-properties')?.remove(); window.dispatchEvent(new Event('gdl:pending-link-jobs-changed'));
    return { checks: results.length, results };
  }, sources);
  assert(report.checks >= 25);
  assert.deepEqual(pageErrors, [], 'Production modal event handlers must not throw browser errors');
  console.log(`Detection review browser passed: ${report.checks} checks; real modal/Properties, BF3 full-path/context retry, 7-point review, owner isolation, explicit/manual selection, confidence contradictions and terminal identity errors.`);
} finally { await browser.close(); }
