import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getGameData } from '../../core/game-data';
import { escapeHtml, normalizeTitle } from '../../core/text';
import { mountModalDialog, wirePasteButton } from '../../core/modal';
import { gdlText } from '../../steam/localization';
import { cleanShortcutPath, findActiveShortcutAppId, SHORTCUT_THRESHOLD } from '../../steam/shortcuts';
import { shortcutRuntimeHost } from './host';
import { getAllShortcutRecords, shortcutAlreadyLinked } from './registry';
import { reliableReviewCandidate, displayReviewConfidence } from './detection';
import { inspectShortcutReview, invalidateShortcutReview, isShortcutReviewInFlight, type ShortcutLinkReviewSource } from './manual-link-review';
import { cancelPendingLinkJobs, enqueueLinkJob, stageLinkJobForRecovery, type PendingLinkJob } from './link-job-queue';
import { observeManualLinkJob } from './manual-link-progress';
import { isShortcutIdentityMutationInProgress, linkShortcutToSteam, shouldAutoApplyNoLauncher } from './linking';
import { undismissShortcut } from './dismissed';
import { navigateToLibraryShortcut } from '../../steam/navigation';
import { clearShortcutEdition, saveShortcutEdition } from './editions';
function displayConfidence(candidate: ShortcutDetectionCandidate): 'HIGH' | 'MEDIUM' | 'LOW' {
	return displayReviewConfidence(candidate);
}
function getCandidateKey(candidate: ShortcutDetectionCandidate): string {
	return candidate.candidate_key || (candidate.edition ? `${candidate.appid}:edition:${candidate.edition}` : candidate.appid);
}
function retryableLinkError(error: unknown): boolean {
	return !['invalid_appid', 'refusing_to_modify_native_steam_app', 'shortcut_identity_changed', 'shortcut_identity_ambiguous', 'shortcut_not_found', 'steam_appid_file_protection_failed', 'link_cancelled_by_unlink']
		.includes(String(error || '').replace(/^Error:\s*/i, '').trim());
}
let shortcutLinkInProgress = false;
const shortcutDetectionScheduled = new Map<number, symbol>();
function shortcutMutationInProgress(): boolean {
	return shortcutLinkInProgress || isShortcutIdentityMutationInProgress();
}
let activeModalEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
let activeModalDocument: Document | null = null;
let activeModalElement: HTMLElement | null = null;
function disposeActiveModal(): void {
	if (activeModalEscapeHandler) {
		try { activeModalDocument?.removeEventListener('keydown', activeModalEscapeHandler); } catch {}
	}
	(activeModalElement as any)?._dispose?.();
	activeModalElement?.remove();
	activeModalEscapeHandler = null;
	activeModalDocument = null;
	activeModalElement = null;
}
function closeShortcutManualLinkModal(doc: Document, _shortcutAppId: number, _dismiss: boolean): void {
	invalidateShortcutReview();
	shortcutDetectionScheduled.delete(_shortcutAppId);
	disposeActiveModal();
	const remove = (modal: HTMLElement | null): void => { (modal as any)?._dispose?.(); modal?.remove(); };
	remove(doc.getElementById('gdl-manual-link-modal'));
	try { remove(document.getElementById('gdl-manual-link-modal')); } catch {}
}
export type { ShortcutLinkReviewSource } from './manual-link-review';
export function showShortcutManualLinkModal(
	doc: Document,
	context: ShortcutDetectionContext,
	detection: ShortcutDetectionResult,
	options: { source?: ShortcutLinkReviewSource; loading?: boolean } = {},
): void {
	const targetDoc = (doc && doc.body) ? doc : (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' && document.body ? document : null));
	if (!targetDoc || !targetDoc.body) return;
	const existingModal = targetDoc.getElementById('gdl-manual-link-modal');
	if (existingModal && (existingModal as any)._updateCandidates && (existingModal as any)._shortcutAppId === context.shortcutAppId) {
		if ((existingModal as any)._updateContext) (existingModal as any)._updateContext(context);
		(existingModal as any)._updateCandidates(detection.candidates || [], !options.loading, detection.rejected_appids);
		return;
	}
	disposeActiveModal();
	if (existingModal) {
		(existingModal as any)._dispose?.();
		existingModal.remove();
	}
	try { const old = document?.getElementById('gdl-manual-link-modal'); (old as any)?._dispose?.(); old?.remove(); } catch {}
	const source: ShortcutLinkReviewSource = options.source || 'manual';
	const loading = options.loading === true;
	let activeContext: ShortcutDetectionContext = { ...context };
	const automaticNativeAddReview = source === 'native-add-auto';
	let currentCandidates = (detection.candidates || []).slice(0, 10);
	const hasCandidates = currentCandidates.length > 0;
	const reliable = currentCandidates.some(reliableReviewCandidate);
	const dialogTitle = automaticNativeAddReview && reliable
		? gdlText('auto_link_title', 'Steam game detected')
		: gdlText('link_game', 'Link game');
	const dialogMessage = loading
		? gdlText('link_searching', 'Searching for Steam matches…')
		: automaticNativeAddReview && reliable
		? gdlText('auto_link_message', 'A likely Steam match was found for “{name}”. Confirm it before NativeGameLink loads the game data.', { name: activeContext.title })
		: automaticNativeAddReview && !hasCandidates
		? gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.')
		: gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.');
	const pathSummary = (): string => {
		const path = cleanShortcutPath(activeContext.exePath || activeContext.startDir || '');
		return path ? gdlText('game_path', 'Game path: {path}', { path }) : gdlText('game_path_pending', 'Game path is not available yet.');
	};
	const executableSummary = pathSummary();
	const overlay = targetDoc.createElement('dialog');
	overlay.id = 'gdl-manual-link-modal';
	(overlay as any)._shortcutAppId = activeContext.shortcutAppId;
	overlay.style.cssText = 'position:fixed;inset:0;margin:0;padding:20px;box-sizing:border-box;border:0;max-width:none;max-height:none;width:100%;height:100%;z-index:2147483647;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(0,0,0,.72);font-family:Arial,Helvetica,sans-serif;color:#dcdedf;pointer-events:auto;';
	overlay.innerHTML = `
		<div role="dialog" aria-modal="true" style="box-sizing:border-box;width:620px;max-width:100%;max-height:100%;flex-shrink:0;overflow:auto;border-radius:6px;background:linear-gradient(145deg,#1b2531,#121922);border:1px solid rgba(102,192,244,.30);box-shadow:0 24px 80px rgba(0,0,0,.78);">
			<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:linear-gradient(90deg,rgba(39,65,84,.95),rgba(24,31,41,.96));border-bottom:1px solid rgba(255,255,255,.09);">
				<div><div class="gdl-manual-link-dialog-title" style="font-size:20px;font-weight:600;color:#fff;">${escapeHtml(dialogTitle)}</div><div class="gdl-manual-link-dialog-subtitle" style="margin-top:4px;font-size:11px;letter-spacing:.8px;color:#66c0f4;text-transform:uppercase;">${escapeHtml(loading ? gdlText('link_searching', 'Searching for Steam matches…') : reliable ? gdlText('auto_link_ready_to_review', 'Match ready for review') : gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.'))}</div></div>
				<button class="gdl-manual-link-close" aria-label="${escapeHtml(gdlText('close', 'Close'))}" style="border:0;background:transparent;color:#8f98a0;font-size:24px;line-height:1;cursor:pointer;padding:0 3px;">×</button>
			</div>
			<div style="padding:20px 22px 22px;">
				<div class="gdl-manual-link-dialog-message" style="font-size:13px;line-height:1.5;color:#acb2b8;margin-bottom:17px;">${escapeHtml(dialogMessage)}</div>
				<div style="display:flex;gap:16px;align-items:stretch;margin-bottom:16px;padding:12px;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.06);border-radius:4px;">
					<img class="gdl-manual-link-image" alt="" style="width:40%;max-width:194px;min-width:0;height:91px;object-fit:cover;border:1px solid rgba(255,255,255,.10);border-radius:2px;" />
					<div style="display:flex;flex:1;min-width:0;flex-direction:column;justify-content:center;gap:7px;"><div class="gdl-manual-link-name" style="font-size:17px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div><div class="gdl-manual-link-id" style="font-size:12px;color:#66c0f4;"></div><select class="gdl-manual-link-select" style="width:100%;padding:7px 9px;background:#20242b;border:1px solid #3d4450;border-radius:2px;color:#dcdedf;font-size:12px;color-scheme:dark;"></select></div>
				</div>
				<label style="display:block;margin:0 0 14px;font-size:11px;color:#8f98a0;">
					<span style="display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.45px;">${escapeHtml(gdlText('manual_appid_label', 'Or enter a Steam AppID manually'))}</span>
					<span style="display:flex;gap:8px;align-items:stretch;"><input class="gdl-manual-link-manual-appid" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(gdlText('manual_appid_placeholder', 'Steam AppID'))}" style="box-sizing:border-box;width:100%;min-width:0;flex:1;padding:8px 9px;background:#101820;border:1px solid #3d4450;border-radius:2px;color:#dcdedf;font-size:12px;" /><button type="button" class="gdl-manual-link-paste" style="flex-shrink:0;padding:8px 14px;border:1px solid #3d4450;border-radius:2px;background:#3d4450;color:#dcdedf;cursor:pointer;">${escapeHtml(gdlText('paste', 'Paste'))}</button></span>
				</label>
				<div class="gdl-manual-link-exe-summary" style="padding:9px 11px;background:rgba(0,0,0,.18);color:#acb2b8;font-size:11px;line-height:1.35;overflow-wrap:anywhere;user-select:text;">${escapeHtml(executableSummary)}</div>
				<label class="gdl-manual-link-launcher" style="display:none;align-items:flex-start;gap:8px;margin-top:12px;color:#acb2b8;font-size:12px;line-height:1.35;cursor:pointer;"><input class="gdl-manual-link-launcher-input" type="checkbox" style="margin-top:2px;" /><span><strong style="color:#dcdedf;font-weight:500;">${escapeHtml(gdlText('skip_launcher', 'Try to skip the launcher'))}</strong><br />${escapeHtml(gdlText('launcher_detected', 'This target looks like a game launcher. You may optionally add -nolauncher.'))}</span></label>
				<div class="gdl-manual-link-progress" style="display:flex;gap:7px;margin-top:15px;color:#8f98a0;font-size:11px;"><span data-step="link" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_link', '1 · Link'))}</span><span data-step="identity" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_identity', '2 · Prepare'))}</span><span data-step="assets" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_assets', '3 · Finish'))}</span></div>
				<div class="gdl-manual-link-status" aria-live="polite" style="display:none;margin-top:11px;padding:9px 11px;border:1px solid rgba(255,255,255,.08);border-radius:3px;background:rgba(0,0,0,.16);font-size:12px;line-height:1.4;color:#8f98a0;"></div>
				<button type="button" class="gdl-manual-link-retry-search" style="display:none;margin-top:10px;padding:7px 12px;border:1px solid #3d4450;border-radius:2px;background:#20242b;color:#66c0f4;cursor:pointer;">${escapeHtml(gdlText('link_search_retry', 'Retry search'))}</button>
				<div style="display:flex;justify-content:flex-end;gap:9px;margin-top:14px;"><button class="gdl-manual-link-cancel" style="padding:9px 17px;border:0;border-radius:2px;background:#3d4450;color:#dcdedf;cursor:pointer;">${escapeHtml(automaticNativeAddReview ? gdlText('reject_link', 'Reject') : gdlText('cancel', 'Cancel'))}</button><button class="gdl-manual-link-confirm" style="padding:9px 18px;border:0;border-radius:2px;background:linear-gradient(90deg,#06bfff,#2d73ff);color:#fff;cursor:pointer;">${escapeHtml(gdlText('link_game', 'Link game'))}</button></div>
			</div>
		</div>`;
	const select = overlay.querySelector('.gdl-manual-link-select') as HTMLSelectElement;
	const manualAppIdInput = overlay.querySelector('.gdl-manual-link-manual-appid') as HTMLInputElement;
	wirePasteButton(manualAppIdInput, overlay.querySelector('.gdl-manual-link-paste') as HTMLButtonElement);
	const image = overlay.querySelector('.gdl-manual-link-image') as HTMLImageElement;
	const name = overlay.querySelector('.gdl-manual-link-name') as HTMLElement;
	const appId = overlay.querySelector('.gdl-manual-link-id') as HTMLElement;
	const launcherLabel = overlay.querySelector('.gdl-manual-link-launcher') as HTMLElement;
	const launcherInput = overlay.querySelector('.gdl-manual-link-launcher-input') as HTMLInputElement;
	const status = overlay.querySelector('.gdl-manual-link-status') as HTMLElement;
	const progress = overlay.querySelector('.gdl-manual-link-progress') as HTMLElement;
	const confirm = overlay.querySelector('.gdl-manual-link-confirm') as HTMLButtonElement;
	const retrySearch = overlay.querySelector('.gdl-manual-link-retry-search') as HTMLButtonElement;
	retrySearch.addEventListener('click', () => { if (!busy()) (overlay as any)._retrySearch?.(); });
	const cancel = overlay.querySelector('.gdl-manual-link-cancel') as HTMLButtonElement;
	const clearCandidateImage = (): void => {
		image.onload = null;
		image.onerror = null;
		image.removeAttribute('src');
		image.style.visibility = 'hidden';
	};
	const loadCandidateImage = (source: string): void => {
		const url = source.trim();
		if (!url) {
			clearCandidateImage();
			return;
		}
		image.style.visibility = 'visible';
		const settleImage = (loaded: boolean): void => {
			image.style.visibility = loaded ? 'visible' : 'hidden';
		};
		image.onload = () => settleImage(true);
		image.onerror = () => settleImage(false);
		if (image.getAttribute('src') !== url) image.src = url;
		else if (image.complete) settleImage(image.naturalWidth > 0);
	};
	const addSelectionPlaceholder = (): void => {
		const option = targetDoc.createElement('option'); option.value = '';
		option.textContent = gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.'); select.appendChild(option);
	};
	addSelectionPlaceholder();
	for (const candidate of currentCandidates) {
		const option = targetDoc.createElement('option');
		option.value = getCandidateKey(candidate);
		const confBadge = ` [${displayConfidence(candidate)}]`;
		const isCollision = candidate.identity_collision ? ' ⚠️' : '';
		const editionBadge = candidate.edition ? ` [${candidate.edition.toUpperCase()}]` : '';
		option.textContent = `${candidate.name} — AppID ${candidate.appid} (${Math.round(candidate.score)}/100)${confBadge}${editionBadge}${isCollision}`;
		select.appendChild(option);
	}
	if (currentCandidates.length) {
		const initial = currentCandidates.find(reliableReviewCandidate);
		select.value = initial ? getCandidateKey(initial) : '';
	} else {
		select.options[0].textContent = loading
			? gdlText('link_searching', 'Searching for Steam matches…')
			: gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)');
		select.disabled = true;
	}
	let userHasInteracted = false;
	let modalSubmitting = false;
	let linkSucceeded = false;
	let queuedInBackground = false;
	let lockedManualAppId = '';
	const busy = (): boolean => modalSubmitting || queuedInBackground || linkSucceeded;
	const lockSelection = (locked: boolean): void => {
		if (locked) lockedManualAppId = manualAppIdInput.value;
		select.disabled = locked || !currentCandidates.length;
		manualAppIdInput.disabled = launcherInput.disabled = locked;
		retrySearch.disabled = locked;
		(overlay.querySelector('.gdl-manual-link-paste') as HTMLButtonElement).disabled = locked;
	};
	let imageRequestRevision = 0;
	let manualLookupTimer: ReturnType<typeof setTimeout> | null = null;
	let enrichmentComplete = !loading;
	let searchUnavailable = Boolean(detection.error || detection.transient_error);
	const emptySearchMessage = (): string => searchUnavailable
		? gdlText('link_search_unavailable', 'Steam search could not finish. You can retry or enter the AppID manually.')
		: gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.');
	const selectedCandidate = (): ShortcutDetectionCandidate | undefined => currentCandidates.find(item => getCandidateKey(item) === select.value);
	const refreshReviewLabels = (): void => {
		if (!currentCandidates.length && select.options[0]) select.options[0].textContent = !enrichmentComplete
			? gdlText('link_searching', 'Searching for Steam matches…') : searchUnavailable
			? gdlText('link_search_unavailable_title', 'Search unavailable') : gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)');
		const confident = reliableReviewCandidate(selectedCandidate()) && !manualAppIdInput.value.trim();
		const pending = !enrichmentComplete && !currentCandidates.length;
		overlay.querySelector('.gdl-manual-link-dialog-title')!.textContent = automaticNativeAddReview && confident ? gdlText('auto_link_title', 'Steam game detected') : gdlText('link_game', 'Link game');
		overlay.querySelector('.gdl-manual-link-dialog-subtitle')!.textContent = confident ? gdlText('auto_link_ready_to_review', 'Match ready for review') : pending ? gdlText('link_searching', 'Searching for Steam matches…') : !currentCandidates.length && searchUnavailable ? gdlText('link_search_unavailable_title', 'Search unavailable') : gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.');
		overlay.querySelector('.gdl-manual-link-dialog-message')!.textContent = pending ? gdlText('link_searching', 'Searching for Steam matches…') : confident && automaticNativeAddReview
			? gdlText('auto_link_message', 'A likely Steam match was found for “{name}”. Confirm it before NativeGameLink loads the game data.', { name: activeContext.title })
			: !currentCandidates.length && enrichmentComplete ? emptySearchMessage() : gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.');
		retrySearch.style.display = enrichmentComplete && searchUnavailable ? '' : 'none';
	};
	type ManualStatusTone = 'neutral' | 'active' | 'success' | 'warning' | 'error';
	const setStatus = (message: string, tone: ManualStatusTone = 'neutral'): void => {
		status.textContent = message;
		status.style.display = message ? 'block' : 'none';
		const styles: Record<ManualStatusTone, { color: string; background: string; border: string }> = {
			neutral: { color: '#acb2b8', background: 'rgba(0,0,0,.16)', border: 'rgba(255,255,255,.08)' }, active: { color: '#66c0f4', background: 'rgba(102,192,244,.08)', border: 'rgba(102,192,244,.22)' },
			success: { color: '#a4d007', background: 'rgba(91,163,43,.10)', border: 'rgba(91,163,43,.30)' }, warning: { color: '#e5ad37', background: 'rgba(229,173,55,.09)', border: 'rgba(229,173,55,.28)' },
			error: { color: '#ff6b6b', background: 'rgba(217,65,38,.10)', border: 'rgba(217,65,38,.30)' },
		};
		const style = styles[tone];
		status.style.color = style.color;
		status.style.background = style.background;
		status.style.borderColor = style.border;
	};
	const renderCandidate = () => {
		if (busy()) return;
		if (manualLookupTimer) {
			clearTimeout(manualLookupTimer);
			manualLookupTimer = null;
		}
		refreshReviewLabels();
		const candidate = selectedCandidate();
		const requestRevision = ++imageRequestRevision;
		if (!candidate) {
			name.textContent = activeContext.title;
			appId.textContent = '';
			clearCandidateImage();
			setStatus(
				currentCandidates.length ? gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.') : enrichmentComplete
					? emptySearchMessage()
					: gdlText('link_searching', 'Searching for Steam matches…'),
				enrichmentComplete ? 'warning' : 'active',
			);
			if (!modalSubmitting && !manualAppIdInput.value.trim()) {
				confirm.disabled = true;
				confirm.style.opacity = '.65';
			}
			return;
		}
		name.textContent = candidate.name;
		const confLabel = displayConfidence(candidate);
		appId.textContent = `Steam AppID ${candidate.appid} · ${Math.round(candidate.score)}/100 · [${confLabel}]`;
		if (!reliableReviewCandidate(candidate) && candidate.executable_match) {
			setStatus(gdlText(
				'auto_link_executable_verified_review',
				'The executable matches this Steam game, but the shortcut title is uncertain. Review it before linking.',
			), 'warning');
		} else if (!reliableReviewCandidate(candidate)) {
			setStatus(gdlText(
				'detection_uncertain',
				'The match is uncertain. Choose the correct result or enter the AppID manually.',
			), 'warning');
		} else {
			setStatus('');
		}
		if (!modalSubmitting) {
			confirm.disabled = false;
			confirm.style.opacity = '1';
		}
		loadCandidateImage(candidate.image || '');
		void getGameData(candidate.appid).then(official => {
			if (requestRevision !== imageRequestRevision || select.value !== getCandidateKey(candidate)) return;
			const officialImage = String(official?.header_image || official?.capsule_image || official?.capsule_imagev5 || '').trim();
			if (!officialImage) return;
			candidate.image = officialImage;
			loadCandidateImage(officialImage);
		}).catch(() => {});
	};
	const updateCandidatesInPlace = (newCandidates: ShortcutDetectionCandidate[], isEnriched: boolean, rejectedAppIds: string[] = []): void => {
		if (targetDoc.getElementById('gdl-manual-link-modal') !== overlay || busy()) return;
		const previousCandidate = selectedCandidate();
		const rejected = new Set(rejectedAppIds);
		currentCandidates = (newCandidates || []).filter(candidate => !rejected.has(candidate.appid)).slice(0, 10);
		if (userHasInteracted && previousCandidate && !rejected.has(previousCandidate.appid)
			&& !currentCandidates.some(candidate => getCandidateKey(candidate) === getCandidateKey(previousCandidate))) currentCandidates.push(previousCandidate);
		if (isEnriched) enrichmentComplete = true;
		const hasCands = currentCandidates.length > 0;
		const previousSelectedValue = select.value;
		select.innerHTML = '';
		addSelectionPlaceholder();
		if (hasCands) {
			select.disabled = false;
			if (!modalSubmitting) {
				confirm.disabled = false;
				confirm.style.opacity = '1';
			}
			for (const cand of currentCandidates) {
				const option = targetDoc.createElement('option');
				option.value = getCandidateKey(cand);
				const confBadge = ` [${displayConfidence(cand)}]`;
				const isCollision = cand.identity_collision ? ' ⚠️' : '';
				const editionBadge = cand.edition ? ` [${cand.edition.toUpperCase()}]` : '';
				option.textContent = `${cand.name} — AppID ${cand.appid} (${Math.round(cand.score)}/100)${confBadge}${editionBadge}${isCollision}`;
				select.appendChild(option);
			}
			if (userHasInteracted && previousSelectedValue && currentCandidates.some(c => getCandidateKey(c) === previousSelectedValue)) {
				select.value = previousSelectedValue;
			} else if (!userHasInteracted) {
				const initial = currentCandidates.find(reliableReviewCandidate);
				select.value = initial ? getCandidateKey(initial) : '';
			}
		} else {
			select.options[0].textContent = isEnriched
				? gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)')
				: gdlText('link_searching', 'Searching for Steam matches…');
			select.disabled = true;
			if (!modalSubmitting && !/^\d+$/.test(manualAppIdInput.value.trim())) {
				confirm.disabled = true;
				confirm.style.opacity = '.65';
			}
		}
		if (isEnriched) {
			overlay.removeAttribute('data-gdl-link-loading');
		}
		if (manualAppIdInput.value.trim()) renderManualAppId(); else renderCandidate();
	};
	(overlay as any)._updateCandidates = updateCandidatesInPlace;
	(overlay as any)._getDetectionSnapshot = () => ({ context: { ...activeContext }, candidates: currentCandidates.slice() });
	(overlay as any)._beginEnrichment = (): void => {
		if (busy()) return;
		searchUnavailable = false;
		enrichmentComplete = false;
		if (manualAppIdInput.value.trim()) renderManualAppId(); else renderCandidate();
	};
	(overlay as any)._markEnrichmentComplete = (unavailable = false): void => {
		if (busy()) return;
		searchUnavailable = unavailable;
		enrichmentComplete = true;
		overlay.removeAttribute('data-gdl-link-loading');
		if (manualAppIdInput.value.trim()) renderManualAppId(); else renderCandidate();
	};
	const renderManualAppId = () => {
		if (busy()) return;
		refreshReviewLabels();
		let manualAppId = manualAppIdInput.value.trim();
		const urlMatch = manualAppId.match(/\/app\/(\d+)/i);
		if (urlMatch) {
			manualAppId = urlMatch[1];
			manualAppIdInput.value = manualAppId;
		}
		if (!manualAppId) {
			renderCandidate();
			return;
		}
		if (!/^\d+$/.test(manualAppId)) {
			imageRequestRevision += 1;
			name.textContent = gdlText('manual_appid_title', 'Manual Steam AppID');
			appId.textContent = '';
			clearCandidateImage();
			setStatus(gdlText('manual_appid_invalid', 'Enter a numeric Steam AppID.'), 'warning');
			confirm.disabled = true;
			confirm.style.opacity = '.65';
			return;
		}
		if (!modalSubmitting) {
			confirm.disabled = false;
			confirm.style.opacity = '1';
		}
		const requestRevision = ++imageRequestRevision;
		name.textContent = gdlText('manual_appid_title', 'Manual Steam AppID');
		appId.textContent = `Steam AppID ${manualAppId}`;
		clearCandidateImage();
		setStatus(gdlText('verifying_steam', 'Verifying on Steam...'), 'active');
		if (manualLookupTimer) clearTimeout(manualLookupTimer);
		manualLookupTimer = setTimeout(() => {
			void getGameData(manualAppId).then(official => {
				if (requestRevision !== imageRequestRevision || manualAppIdInput.value.trim() !== manualAppId) return;
				if (!official) {
					setStatus(gdlText('appid_not_found', 'AppID {id} was not found on Steam.', { id: manualAppId }), 'error');
					return;
				}
				name.textContent = String(official.name || gdlText('manual_appid_title', 'Manual Steam AppID'));
				const officialImage = String(official.header_image || official.capsule_image || official.capsule_imagev5 || '').trim();
				if (officialImage) loadCandidateImage(officialImage);
				setStatus(gdlText('manual_appid_ready', 'Manual AppID selected. Review the Steam game before linking.'), 'active');
			}).catch(() => {
				if (requestRevision !== imageRequestRevision || manualAppIdInput.value.trim() !== manualAppId) return;
				setStatus(gdlText('appid_not_found', 'AppID {id} was not found on Steam.', { id: manualAppId }), 'error');
			});
		}, 250);
	};
	const updateLauncherBypass = (appId: string) => {
		const shouldBypass = shouldAutoApplyNoLauncher(appId);
		if (shouldBypass) {
			launcherLabel.style.display = 'flex';
			launcherInput.checked = true;
		} else {
			launcherLabel.style.display = 'none';
			launcherInput.checked = false;
		}
	};
	select.addEventListener('change', () => {
		if (busy()) return;
		userHasInteracted = true;
		if (manualAppIdInput.value) manualAppIdInput.value = '';
		renderCandidate();
		const currentSelected = selectedCandidate();
		updateLauncherBypass(currentSelected?.appid || '');
	});
	manualAppIdInput.addEventListener('input', () => {
		if (busy()) { manualAppIdInput.value = lockedManualAppId; return; }
		userHasInteracted = true;
		renderManualAppId();
		updateLauncherBypass(manualAppIdInput.value.trim());
		const val = manualAppIdInput.value.trim();
		if (/^\d+$/.test(val)) {
			if (!modalSubmitting) {
				confirm.disabled = false;
				confirm.style.opacity = '1';
			}
		} else if (!val) {
			const hasCandidate = Boolean(selectedCandidate());
			confirm.disabled = !hasCandidate || modalSubmitting;
			confirm.style.opacity = (hasCandidate && !modalSubmitting) ? '1' : '.65';
		} else {
			confirm.disabled = true;
			confirm.style.opacity = '.65';
		}
	});
	renderCandidate();
	if (loading) {
		setStatus(gdlText('link_searching', 'Searching for Steam matches…'), 'active');
		confirm.disabled = true;
		confirm.style.opacity = '.65';
	}
	const exeSummary = overlay.querySelector('.gdl-manual-link-exe-summary') as HTMLElement;
	exeSummary.title = cleanShortcutPath(activeContext.exePath || activeContext.startDir || '');
	(overlay as any)._updateContext = (nextContext: ShortcutDetectionContext): void => {
		if (!nextContext || Number(nextContext.shortcutAppId) !== Number(activeContext.shortcutAppId)) return;
		activeContext = { ...activeContext, ...nextContext, exePath: nextContext.exePath || activeContext.exePath,
			startDir: nextContext.startDir || activeContext.startDir, launchOptions: nextContext.launchOptions ?? activeContext.launchOptions };
		exeSummary.textContent = pathSummary();
		exeSummary.title = cleanShortcutPath(activeContext.exePath || activeContext.startDir || '');
		if (manualAppIdInput.value.trim()) renderManualAppId(); else renderCandidate();
	};
	updateLauncherBypass(selectedCandidate()?.appid || '');
	let successfulLinkedShortcutId: number | null = null, queuedLinkWatch: (() => void) | null = null;
	const stopQueuedLinkWatch = (): void => {
		queuedLinkWatch?.();
		queuedLinkWatch = null;
	};
	(overlay as any)._dispose = (): void => {
		stopQueuedLinkWatch();
		imageRequestRevision += 1;
		if (manualLookupTimer) clearTimeout(manualLookupTimer);
		clearCandidateImage();
	};
	const setProgress = (completed: number, warning = false, active = 0) => {
		for (const step of Array.from(progress.querySelectorAll<HTMLElement>('[data-step]'))) {
			const index = ['link', 'identity', 'assets'].indexOf(String(step.dataset.step)) + 1;
			step.style.background = index <= completed
				? (warning && index === 3 ? 'rgba(229,173,55,.18)' : 'rgba(91,163,43,.18)')
				: index === active ? 'rgba(102,192,244,.16)' : 'rgba(255,255,255,.05)';
			step.style.color = index <= completed
				? (warning && index === 3 ? '#e5ad37' : '#a4d007')
				: index === active ? '#66c0f4' : '#8f98a0';
		}
	};
	const dismiss = () => {
		if (targetDoc.getElementById('gdl-manual-link-modal') !== overlay) return;
		stopQueuedLinkWatch();
		modalSubmitting = false;
		closeShortcutManualLinkModal(targetDoc, activeContext.shortcutAppId, false);
		if (successfulLinkedShortcutId) {
			const liveDoc = shortcutRuntimeHost().getMainWindowDoc() || targetDoc;
			navigateToLibraryShortcut(liveDoc, successfulLinkedShortcutId);
			shortcutRuntimeHost().resetLibraryInjection?.(true, liveDoc);
		}
	};
	overlay.querySelector('.gdl-manual-link-close')?.addEventListener('click', dismiss);
	cancel.addEventListener('click', dismiss);
	overlay.addEventListener('click', event => { if (event.target === overlay) dismiss(); });
	activeModalEscapeHandler = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
	};
	activeModalDocument = targetDoc;
	activeModalElement = overlay;
	targetDoc.addEventListener('keydown', activeModalEscapeHandler);
	const watchQueuedLink = (job: PendingLinkJob): void => {
		stopQueuedLinkWatch();
		queuedInBackground = true;
		lockSelection(true);
		confirm.disabled = true;
		confirm.style.opacity = '.65';
		cancel.disabled = false;
		cancel.textContent = gdlText('close', 'Close');
		queuedLinkWatch = observeManualLinkJob(targetDoc, overlay, job, state => {
			if (state.status === 'completed') {
				queuedInBackground = false;
				linkSucceeded = true;
				successfulLinkedShortcutId = state.shortcutAppId;
				setProgress(3);
				setStatus(state.resourcesPending
					? gdlText('link_ready_resources_pending', '✓ Linked. Available artwork will continue loading in the background.')
					: gdlText('link_queued_complete', '✓ Ready. The game is prepared in your library.'), 'success');
				confirm.style.display = 'none';
				cancel.textContent = gdlText('done', 'Done');
				shortcutRuntimeHost().resetLibraryInjection?.(true, shortcutRuntimeHost().getMainWindowDoc() || targetDoc);
				return;
			}
			if (state.status === 'failed' || state.status === 'cancelled') {
				queuedInBackground = false;
				modalSubmitting = false;
				lockSelection(false);
				setStatus(gdlText('link_queued_failed', 'Setup could not be completed. You can try again.'), 'error');
				confirm.style.display = '';
				confirm.disabled = false;
				confirm.style.opacity = '1';
				return;
			}
			const assets = state.phase === 'assets';
			setProgress(assets ? 2 : 0, false, state.status === 'running' ? assets ? 3 : 2 : 0);
			setStatus(state.status === 'queued' && state.attempts > 0
				? gdlText('link_queued_retrying', 'Setup is incomplete. Another attempt will start automatically…')
				: assets ? gdlText('link_status_applying_resources', 'Applying resources…')
				: gdlText('link_status_preparing', 'Preparing game…'), state.status === 'queued' && state.attempts > 0 ? 'warning' : 'active');
		});
	};
	const queueLinkInBackground = (input: Parameters<typeof enqueueLinkJob>[0], shortcutAppId = input.shortcutAppId, repairResources = false): void => {
		const job = enqueueLinkJob({ ...input, shortcutAppId, repairResources });
		setStatus(gdlText('link_queued_background', 'Continuing setup in the background…'), 'active');
		watchQueuedLink(job);
	};
	confirm.addEventListener('click', async () => {
		if (busy()) return;
		const manualAppId = manualAppIdInput.value.trim();
		if (manualAppId && !/^\d+$/.test(manualAppId)) {
			setStatus(gdlText('manual_appid_invalid', 'Enter a numeric Steam AppID.'), 'error');
			return;
		}
		const selected = selectedCandidate();
		const steamAppId = manualAppId || selected?.appid || '';
		if (!steamAppId) {
			setStatus(gdlText('enter_appid', 'Enter an AppID or store link.'), 'error');
			manualAppIdInput.focus();
			return;
		}
		if (selected?.is_edition && !manualAppId) {
			saveShortcutEdition(activeContext.shortcutAppId, {
				edition: selected.edition || '',
				name: selected.name,
				appId: selected.appid,
				assets: selected.edition_assets,
				bundleId: selected.bundle_id,
			});
		} else {
			clearShortcutEdition(activeContext.shortcutAppId);
		}
		modalSubmitting = true;
		imageRequestRevision += 1;
		if (manualLookupTimer) clearTimeout(manualLookupTimer);
		lockSelection(true);
		shortcutLinkInProgress = true;
		setProgress(0, false, 1);
		confirm.disabled = true;
		cancel.disabled = false;
		cancel.textContent = gdlText('close', 'Close');
		confirm.style.opacity = '.65';
		cancelPendingLinkJobs(activeContext.shortcutAppId, activeContext.title);
		undismissShortcut(activeContext.shortcutAppId);
		const linkInput = {
			title: activeContext.title, shortcutAppId: activeContext.shortcutAppId, steamAppId,
			skipLauncher: launcherInput.checked || shouldAutoApplyNoLauncher(steamAppId), existingLaunchOptions: activeContext.launchOptions,
			shortcutExecutable: activeContext.exePath || '',
			canonicalNameHint: selected?.is_edition && !manualAppId ? selected.name : undefined,
		};
		stageLinkJobForRecovery({ ...linkInput, repairResources: false });
		try {
			const result = await linkShortcutToSteam({
				doc: targetDoc, ...linkInput,
				onStatus: (message, color = '#8f98a0') => {
					const tone: ManualStatusTone = /ff6b6b|d94126/i.test(color) ? 'error' : /e5ad37|d6b24c/i.test(color) ? 'warning' : /5ba32b|a4d007/i.test(color) ? 'success' : 'active';
					setStatus(message, tone);
				},
				onPhase: phase => {
					if (phase === 'identity') { setProgress(0, false, 2); setStatus(gdlText('link_status_preparing', 'Preparing game…'), 'active'); }
					if (phase === 'assets') { setProgress(2, false, 3); setStatus(gdlText('link_status_applying_resources', 'Applying resources…'), 'active'); }
				},
			});
			if (result.ok) {
				const setup = result.setup;
				const resourcesComplete = Boolean(setup?.artworkComplete && setup?.iconApplied);
				linkSucceeded = true;
				// Retire the original recovery intent even when Steam regenerated
				// the ID during rename, before queuing optional artwork for the new ID.
				cancelPendingLinkJobs(activeContext.shortcutAppId, activeContext.title);
				if (result.shortcutAppId && result.shortcutAppId !== activeContext.shortcutAppId) {
					if (selected?.is_edition && !manualAppId) {
						saveShortcutEdition(result.shortcutAppId, {
							edition: selected.edition || '',
							name: selected.name,
							appId: selected.appid,
							assets: selected.edition_assets,
							bundleId: selected.bundle_id,
						});
					} else {
						clearShortcutEdition(result.shortcutAppId);
					}
				}
				if (resourcesComplete) {
					cancelPendingLinkJobs(result.shortcutAppId || activeContext.shortcutAppId, activeContext.title);
					setProgress(3, false);
					setStatus(gdlText('link_ready_library', '✓ Ready. The game is prepared in your library.'), 'success');
				} else {
					enqueueLinkJob({ ...linkInput, shortcutAppId: result.shortcutAppId || linkInput.shortcutAppId, repairResources: true, linkCommitted: true });
					setProgress(3, false);
					setStatus(gdlText('link_ready_resources_pending', '✓ Linked. Available artwork will continue loading in the background.'), 'success');
				}
				confirm.style.display = 'none';
				cancel.textContent = gdlText('done', 'Done');
				cancel.disabled = false;
				confirm.disabled = true;
				modalSubmitting = false;
				successfulLinkedShortcutId = Number(result.shortcutAppId || activeContext.shortcutAppId) || null;
				return;
			}
			if (!result.ok) {
				if (retryableLinkError(result.error)) {
					queueLinkInBackground(linkInput, result.shortcutAppId || linkInput.shortcutAppId);
				} else {
					cancelPendingLinkJobs(result.shortcutAppId || activeContext.shortcutAppId, activeContext.title);
				}
				backendLog(`Link did not complete for ${activeContext.title}: ${result.error || 'unknown_error'}`);
			}
		} catch (error) {
			if (retryableLinkError(error)) queueLinkInBackground(linkInput);
			else { cancelPendingLinkJobs(activeContext.shortcutAppId, activeContext.title); setStatus(String(error), 'error'); }
			backendLog(`Background link failed for ${activeContext.title}: ${error}`);
		} finally {
			shortcutLinkInProgress = false;
			if (targetDoc.getElementById('gdl-manual-link-modal') === overlay && !linkSucceeded) {
				modalSubmitting = false;
				cancel.disabled = false;
				if (!queuedInBackground) {
					lockSelection(false);
					confirm.style.display = '';
					confirm.disabled = false;
					confirm.style.opacity = '1';
				}
			}
		}
	});
	mountModalDialog(overlay);
}
function scheduleShortcutReview(
	record: { id: number; title: string; app?: any },
	delay = 50,
	source: ShortcutLinkReviewSource = 'manual',
	targetDoc?: Document | null,
	launchContext?: Partial<ShortcutDetectionContext>,
): void {
	if (!Number.isFinite(record.id) || record.id < 2147483648 || !record.title.trim()) return;
	if (source !== 'manual' && (shortcutDetectionScheduled.has(record.id) || isShortcutReviewInFlight(record.id))) return;
	const scheduledToken = Symbol();
	shortcutDetectionScheduled.set(record.id, scheduledToken);
	const exec = () => {
		if (shortcutDetectionScheduled.get(record.id) !== scheduledToken) return;
		shortcutDetectionScheduled.delete(record.id);
		void inspectShortcutReview(record, source, targetDoc, { showReview: showShortcutManualLinkModal, isMutationInProgress: shortcutMutationInProgress }, launchContext);
	};
	if (delay > 0) setTimeout(exec, delay);
	else exec();
}
function resolveShortcutReviewRecord(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null): { id: number; title: string; app: any } | null {
	const numericId = Number(shortcutAppId);
	const normalizedId = Number.isInteger(numericId) && numericId >= -2147483648 && numericId <= 0xffffffff ? numericId >>> 0 : 0;
	const records = getAllShortcutRecords();
	const cleanTitle = gameTitle.trim();
	// New native shortcuts can precede registry hydration. Their supplied ID must
	// never be replaced with a same-title entry or the game behind the dialog.
	if (normalizedId >= SHORTCUT_THRESHOLD) {
		return records.find(candidate => candidate.id === normalizedId)
			|| { id: normalizedId, title: cleanTitle || 'Non-Steam Game', app: null };
	}
	if (!cleanTitle) return null;
	const titleMatches = records.filter(candidate => normalizeTitle(candidate.title) === normalizeTitle(cleanTitle));
	if (titleMatches.length === 1) return titleMatches[0];
	if (titleMatches.length > 1) {
		try {
			const activeDoc = targetDoc || shortcutRuntimeHost().getMainWindowDoc();
			const activeId = Number(findActiveShortcutAppId(activeDoc as Document, cleanTitle) || 0) >>> 0;
			return titleMatches.find(candidate => candidate.id === activeId) || null;
		} catch {}
	}
	return null;
}
export function requestManualShortcutLink(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null): boolean {
	const record = resolveShortcutReviewRecord(shortcutAppId, gameTitle, targetDoc);
	if (!record) return false;
	undismissShortcut(record.id);
	scheduleShortcutReview(record, 0, 'manual', targetDoc);
	return true;
}
export function requestNativeAddShortcutReview(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null, launchContext?: Partial<ShortcutDetectionContext>): boolean {
	const record = resolveShortcutReviewRecord(shortcutAppId, gameTitle, targetDoc);
	if (!record || shortcutAlreadyLinked(record.id)) return false;
	undismissShortcut(record.id);
	scheduleShortcutReview(record, 0, 'native-add-auto', targetDoc, record.id === (Number(shortcutAppId) >>> 0) ? launchContext : undefined);
	return true;
}
export { linkAllShortcutsExperimental, type BulkLinkAllResult, type BulkLinkGameOutcome, type BulkLinkOutcomeStatus, type BulkLinkProgressPhase } from './bulk-link';
