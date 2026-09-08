import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getGameData } from '../../core/game-data';
import { escapeHtml, normalizeTitle } from '../../core/text';
import { mountModalDialog, wirePasteButton } from '../../core/modal';
import { gdlText } from '../../steam/localization';
import { findActiveShortcutAppId, SHORTCUT_THRESHOLD, shortcutPathBasename } from '../../steam/shortcuts';
import { shortcutRuntimeHost } from './host';
import { findMappingForShortcut, getAllShortcutRecords, shortcutAlreadyLinked } from './registry';
import { buildShortcutDetectionContext, detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote, mergeCandidateLists } from './detection';
import { cancelPendingLinkJobs, enqueueLinkJob, getPendingLinkJob, PENDING_LINK_JOBS_CHANGED_EVENT, stageLinkJobForRecovery } from './link-job-queue';
import { isShortcutIdentityMutationInProgress, linkShortcutToSteam, shouldAutoApplyNoLauncher } from './linking';
import { isShortcutDismissed, undismissShortcut } from './dismissed';
import { navigateToLibraryShortcut } from '../../steam/navigation';
const REVIEW_CONFIDENCE_THRESHOLD = 70;
function displayConfidence(candidate: ShortcutDetectionCandidate): 'HIGH' | 'MEDIUM' | 'LOW' {
	if (!candidate.identity_collision && candidate.score >= 90) return 'HIGH';
	if (candidate.score >= 70) return 'MEDIUM';
	return 'LOW';
}
let shortcutLinkInProgress = false;
const shortcutDetectionInFlight = new Set<number>();
const shortcutDetectionScheduled = new Set<number>();
function shortcutMutationInProgress(): boolean {
	return shortcutLinkInProgress || isShortcutIdentityMutationInProgress();
}
let activeModalEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
function manualLinkModalPresent(doc?: Document | null): boolean {
	try {
		if (doc?.getElementById('gdl-manual-link-modal')) return true;
	} catch {}
	try {
		const hostDoc = shortcutRuntimeHost().getMainWindowDoc();
		if (hostDoc?.getElementById('gdl-manual-link-modal')) return true;
	} catch {}
	try {
		return Boolean(typeof document !== 'undefined' && document.getElementById('gdl-manual-link-modal'));
	} catch { return false; }
}
function closeShortcutManualLinkModal(doc: Document, _shortcutAppId: number, _dismiss: boolean): void {
	if (activeModalEscapeHandler) {
		try { doc.removeEventListener('keydown', activeModalEscapeHandler); } catch {}
		try { document.removeEventListener('keydown', activeModalEscapeHandler); } catch {}
		activeModalEscapeHandler = null;
	}
	doc.getElementById('gdl-manual-link-modal')?.remove();
	try { document.getElementById('gdl-manual-link-modal')?.remove(); } catch {}
}
export type ShortcutLinkReviewSource = 'manual' | 'native-add-auto';
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
		(existingModal as any)._updateCandidates(detection.candidates || [], !options.loading);
		return;
	}
	if (existingModal) {
		existingModal.remove();
	}
	try { document?.getElementById('gdl-manual-link-modal')?.remove(); } catch {}
	const source: ShortcutLinkReviewSource = options.source || 'manual';
	const loading = options.loading === true;
	let activeContext: ShortcutDetectionContext = { ...context };
	const automaticNativeAddReview = source === 'native-add-auto';
	let currentCandidates = (detection.candidates || []).slice(0, 10);
	const hasCandidates = currentCandidates.length > 0;
	const dialogTitle = automaticNativeAddReview
		? gdlText('auto_link_title', 'Steam game detected')
		: gdlText('link_game', 'Link game');
	const dialogMessage = loading
		? gdlText('link_searching', 'Searching for Steam matches…')
		: automaticNativeAddReview && hasCandidates
		? gdlText('auto_link_message', 'A likely Steam match was found for “{name}”. Confirm it before NativeGameLink loads the game data.', { name: activeContext.title })
		: automaticNativeAddReview
		? gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.')
		: gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.');
	let hasTrackingRecommendation = !!(activeContext.bootstrapDetected && activeContext.recommendedExePath);
	let exeName = activeContext.exePath ? (shortcutPathBasename(activeContext.exePath) || activeContext.exePath) : activeContext.title;
	const executableSummary = hasTrackingRecommendation
		? gdlText('selected_executable', 'Selected executable: {exe}', { exe: exeName })
		: gdlText('executable_preserved', 'Steam will keep launching the executable you selected: {exe}', { exe: exeName });
	const overlay = targetDoc.createElement('dialog');
	overlay.id = 'gdl-manual-link-modal';
	(overlay as any)._shortcutAppId = activeContext.shortcutAppId;
	overlay.style.cssText = 'position:fixed;inset:0;margin:0;padding:20px;box-sizing:border-box;border:0;max-width:none;max-height:none;width:100%;height:100%;z-index:2147483647;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(0,0,0,.72);font-family:Arial,Helvetica,sans-serif;color:#dcdedf;pointer-events:auto;';
	overlay.innerHTML = `
		<div role="dialog" aria-modal="true" style="box-sizing:border-box;width:620px;max-width:100%;max-height:100%;flex-shrink:0;overflow:auto;border-radius:6px;background:linear-gradient(145deg,#1b2531,#121922);border:1px solid rgba(102,192,244,.30);box-shadow:0 24px 80px rgba(0,0,0,.78);">
			<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;background:linear-gradient(90deg,rgba(39,65,84,.95),rgba(24,31,41,.96));border-bottom:1px solid rgba(255,255,255,.09);">
				<div><div style="font-size:20px;font-weight:600;color:#fff;">${escapeHtml(dialogTitle)}</div><div class="gdl-manual-link-dialog-subtitle" style="margin-top:4px;font-size:11px;letter-spacing:.8px;color:#66c0f4;text-transform:uppercase;">${escapeHtml(loading ? gdlText('link_searching', 'Searching for Steam matches…') : hasCandidates ? gdlText('auto_link_ready_to_review', 'Match ready for review') : gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)'))}</div></div>
				<button class="gdl-manual-link-close" aria-label="${escapeHtml(gdlText('close', 'Close'))}" style="border:0;background:transparent;color:#8f98a0;font-size:24px;line-height:1;cursor:pointer;padding:0 3px;">×</button>
			</div>
			<div style="padding:20px 22px 22px;">
				<div class="gdl-manual-link-dialog-message" style="font-size:13px;line-height:1.5;color:#acb2b8;margin-bottom:17px;">${escapeHtml(dialogMessage)}</div>
				<div style="display:flex;gap:16px;align-items:stretch;margin-bottom:16px;padding:12px;background:rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.06);border-radius:4px;">
					<img class="gdl-manual-link-image" alt="" style="width:40%;max-width:194px;min-width:0;height:91px;object-fit:cover;border:1px solid rgba(255,255,255,.10);border-radius:2px;" />
					<div style="display:flex;flex:1;min-width:0;flex-direction:column;justify-content:center;gap:7px;">
						<div class="gdl-manual-link-name" style="font-size:17px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
						<div class="gdl-manual-link-id" style="font-size:12px;color:#66c0f4;"></div>
						<select class="gdl-manual-link-select" style="width:100%;padding:7px 9px;background:#20242b;border:1px solid #3d4450;border-radius:2px;color:#dcdedf;font-size:12px;color-scheme:dark;"></select>
					</div>
				</div>
				<label style="display:block;margin:0 0 14px;font-size:11px;color:#8f98a0;">
					<span style="display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:.45px;">${escapeHtml(gdlText('manual_appid_label', 'Or enter a Steam AppID manually'))}</span>
					<span style="display:flex;gap:8px;align-items:stretch;"><input class="gdl-manual-link-manual-appid" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(gdlText('manual_appid_placeholder', 'Steam AppID'))}" style="box-sizing:border-box;width:100%;min-width:0;flex:1;padding:8px 9px;background:#101820;border:1px solid #3d4450;border-radius:2px;color:#dcdedf;font-size:12px;" /><button type="button" class="gdl-manual-link-paste" style="flex-shrink:0;padding:8px 14px;border:1px solid #3d4450;border-radius:2px;background:#3d4450;color:#dcdedf;cursor:pointer;">${escapeHtml(gdlText('paste', 'Paste'))}</button></span>
				</label>
				<div class="gdl-manual-link-exe-summary" style="padding:9px 11px;background:rgba(0,0,0,.18);color:#8f98a0;font-size:11px;line-height:1.35;overflow-wrap:anywhere;">${escapeHtml(executableSummary)}</div>
				<label class="gdl-manual-link-tracking" style="display:none;align-items:flex-start;gap:8px;margin-top:12px;padding:10px 11px;background:rgba(91,163,43,.10);border:1px solid rgba(91,163,43,.28);color:#acb2b8;font-size:12px;line-height:1.35;cursor:pointer;">
					<input class="gdl-manual-link-tracking-input" type="checkbox" style="margin-top:2px;" />
					<span><strong style="color:#dcdedf;font-weight:500;">${escapeHtml(gdlText('use_tracking_executable', 'Use the real game executable'))}</strong><br />${escapeHtml(gdlText('tracking_executable_help', '{bootstrap} closes after launching {game}. Use {game} so Steam keeps tracking playtime.', { bootstrap: shortcutPathBasename(activeContext.exePath), game: shortcutPathBasename(activeContext.recommendedExePath || '') }))}</span>
				</label>
				<label class="gdl-manual-link-launcher" style="display:none;align-items:flex-start;gap:8px;margin-top:12px;color:#acb2b8;font-size:12px;line-height:1.35;cursor:pointer;">
					<input class="gdl-manual-link-launcher-input" type="checkbox" style="margin-top:2px;" />
					<span><strong style="color:#dcdedf;font-weight:500;">${escapeHtml(gdlText('skip_launcher', 'Try to skip the launcher'))}</strong><br />${escapeHtml(gdlText('launcher_detected', 'This target looks like a game launcher. You may optionally add -nolauncher.'))}</span>
				</label>
				<div class="gdl-manual-link-progress" style="display:flex;gap:7px;margin-top:15px;color:#8f98a0;font-size:11px;"><span data-step="link" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_link', '1 · Link'))}</span><span data-step="identity" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_identity', '2 · Prepare'))}</span><span data-step="assets" style="padding:5px 8px;border-radius:12px;background:rgba(255,255,255,.05);">${escapeHtml(gdlText('auto_link_step_assets', '3 · Finish'))}</span></div>
				<div class="gdl-manual-link-status" aria-live="polite" style="display:none;margin-top:11px;padding:9px 11px;border:1px solid rgba(255,255,255,.08);border-radius:3px;background:rgba(0,0,0,.16);font-size:12px;line-height:1.4;color:#8f98a0;"></div>
				<div style="display:flex;justify-content:flex-end;gap:9px;margin-top:14px;">
					<button class="gdl-manual-link-cancel" style="padding:9px 17px;border:0;border-radius:2px;background:#3d4450;color:#dcdedf;cursor:pointer;">${escapeHtml(automaticNativeAddReview ? gdlText('reject_link', 'Reject') : gdlText('cancel', 'Cancel'))}</button>
					<button class="gdl-manual-link-confirm" style="padding:9px 18px;border:0;border-radius:2px;background:linear-gradient(90deg,#06bfff,#2d73ff);color:#fff;cursor:pointer;">${escapeHtml(gdlText('link_game', 'Link game'))}</button>
				</div>
			</div>
		</div>`;
	const select = overlay.querySelector('.gdl-manual-link-select') as HTMLSelectElement;
	const manualAppIdInput = overlay.querySelector('.gdl-manual-link-manual-appid') as HTMLInputElement;
	wirePasteButton(manualAppIdInput, overlay.querySelector('.gdl-manual-link-paste') as HTMLButtonElement);
	const image = overlay.querySelector('.gdl-manual-link-image') as HTMLImageElement;
	const name = overlay.querySelector('.gdl-manual-link-name') as HTMLElement;
	const appId = overlay.querySelector('.gdl-manual-link-id') as HTMLElement;
	const trackingLabel = overlay.querySelector('.gdl-manual-link-tracking') as HTMLElement;
	const trackingInput = overlay.querySelector('.gdl-manual-link-tracking-input') as HTMLInputElement;
	const launcherLabel = overlay.querySelector('.gdl-manual-link-launcher') as HTMLElement;
	const launcherInput = overlay.querySelector('.gdl-manual-link-launcher-input') as HTMLInputElement;
	const status = overlay.querySelector('.gdl-manual-link-status') as HTMLElement;
	const progress = overlay.querySelector('.gdl-manual-link-progress') as HTMLElement;
	const confirm = overlay.querySelector('.gdl-manual-link-confirm') as HTMLButtonElement;
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
	for (const candidate of currentCandidates) {
		const option = targetDoc.createElement('option');
		option.value = candidate.appid;
		const confBadge = ` [${displayConfidence(candidate)}]`;
		const isCollision = candidate.identity_collision ? ' ⚠️' : '';
		option.textContent = `${candidate.name} — AppID ${candidate.appid} (${Math.round(candidate.score)}%)${confBadge}${isCollision}`;
		select.appendChild(option);
	}
	if (currentCandidates.length) {
		select.selectedIndex = 0;
		select.value = currentCandidates[0].appid;
	} else {
		const option = targetDoc.createElement('option');
		option.value = '';
		option.textContent = loading
			? gdlText('link_searching', 'Searching for Steam matches…')
			: gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)');
		select.appendChild(option);
		select.disabled = true;
	}
	let userHasInteracted = false;
	let modalSubmitting = false;
	let linkSucceeded = false;
	let imageRequestRevision = 0;
	let manualLookupTimer: ReturnType<typeof setTimeout> | null = null;
	let enrichmentComplete = !loading;
	type ManualStatusTone = 'neutral' | 'active' | 'success' | 'warning' | 'error';
	const setStatus = (message: string, tone: ManualStatusTone = 'neutral'): void => {
		status.textContent = message;
		status.style.display = message ? 'block' : 'none';
		const styles: Record<ManualStatusTone, { color: string; background: string; border: string }> = {
			neutral: { color: '#acb2b8', background: 'rgba(0,0,0,.16)', border: 'rgba(255,255,255,.08)' },
			active: { color: '#66c0f4', background: 'rgba(102,192,244,.08)', border: 'rgba(102,192,244,.22)' },
			success: { color: '#a4d007', background: 'rgba(91,163,43,.10)', border: 'rgba(91,163,43,.30)' },
			warning: { color: '#e5ad37', background: 'rgba(229,173,55,.09)', border: 'rgba(229,173,55,.28)' },
			error: { color: '#ff6b6b', background: 'rgba(217,65,38,.10)', border: 'rgba(217,65,38,.30)' },
		};
		const style = styles[tone];
		status.style.color = style.color;
		status.style.background = style.background;
		status.style.borderColor = style.border;
	};
	const renderCandidate = () => {
		if (manualLookupTimer) {
			clearTimeout(manualLookupTimer);
			manualLookupTimer = null;
		}
		const candidate = currentCandidates.find(item => item.appid === select.value) || currentCandidates[0];
		const requestRevision = ++imageRequestRevision;
		if (!candidate) {
			name.textContent = activeContext.title;
			appId.textContent = '';
			clearCandidateImage();
			setStatus(
				enrichmentComplete
					? gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.')
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
		appId.textContent = `Steam AppID ${candidate.appid} · ${Math.round(candidate.score)}% · [${confLabel}]`;
		if (!candidate.direct && candidate.score < REVIEW_CONFIDENCE_THRESHOLD && candidate.executable_match) {
			setStatus(gdlText(
				'auto_link_executable_verified_review',
				'The executable matches this Steam game, but the shortcut title is uncertain. Review it before linking.',
			), 'warning');
		} else if (!candidate.direct && candidate.score < REVIEW_CONFIDENCE_THRESHOLD) {
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
			if (requestRevision !== imageRequestRevision || select.value !== candidate.appid) return;
			const officialImage = String(official?.header_image || official?.capsule_image || official?.capsule_imagev5 || '').trim();
			if (!officialImage) return;
			candidate.image = officialImage;
			loadCandidateImage(officialImage);
		}).catch(() => {});
	};
	const updateCandidatesInPlace = (newCandidates: ShortcutDetectionCandidate[], isEnriched: boolean): void => {
		if (targetDoc.getElementById('gdl-manual-link-modal') !== overlay) return;
		currentCandidates = (newCandidates || []).slice(0, 10);
		if (isEnriched) enrichmentComplete = true;
		const hasCands = currentCandidates.length > 0;
		const subtitleEl = overlay.querySelector('.gdl-manual-link-dialog-subtitle') as HTMLElement | null;
		if (subtitleEl) {
			subtitleEl.textContent = isEnriched
				? (hasCands ? gdlText('auto_link_ready_to_review', 'Match ready for review') : gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)'))
				: (hasCands ? gdlText('auto_link_ready_to_review', 'Match ready for review') : gdlText('link_searching', 'Searching for Steam matches…'));
		}
		const dialogMsgEl = overlay.querySelector('.gdl-manual-link-dialog-message') as HTMLElement | null;
		if (dialogMsgEl && !userHasInteracted) {
			const topCandidate = currentCandidates[0];
			const confident = Boolean(topCandidate && (topCandidate.direct || topCandidate.confidence === 'exact' || topCandidate.confidence === 'high' || topCandidate.score >= REVIEW_CONFIDENCE_THRESHOLD));
			dialogMsgEl.textContent = !hasCands
				? (isEnriched ? gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.') : gdlText('link_searching', 'Searching for Steam matches…'))
				: automaticNativeAddReview
					? gdlText('auto_link_message', 'A likely Steam match was found for “{name}”. Confirm it before NativeGameLink loads the game data.', { name: activeContext.title })
					: confident ? gdlText('auto_link_ready_to_review', 'Review the match before linking.') : gdlText('detection_uncertain', 'Choose the correct result or enter the AppID manually.');
		}
		const previousSelectedValue = select.value;
		select.innerHTML = '';
		if (hasCands) {
			select.disabled = false;
			if (!modalSubmitting) {
				confirm.disabled = false;
				confirm.style.opacity = '1';
			}
			for (const cand of currentCandidates) {
				const option = targetDoc.createElement('option');
				option.value = cand.appid;
				const confBadge = ` [${displayConfidence(cand)}]`;
				const isCollision = cand.identity_collision ? ' ⚠️' : '';
				option.textContent = `${cand.name} — AppID ${cand.appid} (${Math.round(cand.score)}%)${confBadge}${isCollision}`;
				select.appendChild(option);
			}
			if (userHasInteracted && previousSelectedValue && currentCandidates.some(c => c.appid === previousSelectedValue)) {
				select.value = previousSelectedValue;
			} else if (!userHasInteracted) {
				select.selectedIndex = 0;
				select.value = currentCandidates[0].appid;
			}
		} else {
			const option = targetDoc.createElement('option');
			option.value = '';
			option.textContent = isEnriched
				? gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)')
				: gdlText('link_searching', 'Searching for Steam matches…');
			select.appendChild(option);
			select.disabled = true;
			if (!modalSubmitting && !/^\d+$/.test(manualAppIdInput.value.trim())) {
				confirm.disabled = true;
				confirm.style.opacity = '.65';
			}
		}
		if (isEnriched) {
			overlay.removeAttribute('data-gdl-link-loading');
		}
		renderCandidate();
	};
	(overlay as any)._updateCandidates = updateCandidatesInPlace;
	(overlay as any)._markEnrichmentComplete = (): void => {
		enrichmentComplete = true;
		overlay.removeAttribute('data-gdl-link-loading');
		if (currentCandidates.length === 0) {
			const subtitleEl = overlay.querySelector('.gdl-manual-link-dialog-subtitle') as HTMLElement | null;
			if (subtitleEl) subtitleEl.textContent = gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)');
			const dialogMsgEl = overlay.querySelector('.gdl-manual-link-dialog-message') as HTMLElement | null;
			if (dialogMsgEl && !userHasInteracted) dialogMsgEl.textContent = gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.');
			renderCandidate();
		}
	};
	const renderManualAppId = () => {
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
		userHasInteracted = true;
		if (manualAppIdInput.value) manualAppIdInput.value = '';
		renderCandidate();
		const currentSelected = currentCandidates.find(candidate => candidate.appid === select.value) || currentCandidates[0];
		updateLauncherBypass(currentSelected?.appid || '');
	});
	manualAppIdInput.addEventListener('input', () => {
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
			const hasCandidate = Boolean(currentCandidates.find(candidate => candidate.appid === select.value) || currentCandidates[0]);
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
	const updateExeSummary = () => {
		if (hasTrackingRecommendation && (activeContext.trackingExecutableAutoApply || trackingInput.checked)) {
			const recName = shortcutPathBasename(activeContext.recommendedExePath || '') || activeContext.recommendedExePath || '';
			if (activeContext.trackingExecutableAutoApply) {
				exeSummary.innerHTML = `${escapeHtml(gdlText('selected_executable', 'Selected executable: {exe}', { exe: recName }))}<br /><span style="display:block;margin-top:3px;color:#8f98a0;font-size:10.5px;">${escapeHtml(gdlText('persistent_tracking_exe_note', '{exe} is the main process for this game to ensure playtime tracking works correctly.', { exe: recName }))}</span>`;
			} else {
				exeSummary.textContent = gdlText('selected_executable', 'Selected executable: {exe}', { exe: recName });
			}
			exeSummary.style.color = '#a4d007';
		} else {
			exeSummary.textContent = gdlText('executable_preserved', 'Steam will keep launching the executable you selected: {exe}', { exe: exeName });
			exeSummary.style.color = '#8f98a0';
		}
	};
	const syncTrackingRecommendationUi = (): void => {
		hasTrackingRecommendation = !!(activeContext.bootstrapDetected && activeContext.recommendedExePath);
		exeName = activeContext.exePath ? (shortcutPathBasename(activeContext.exePath) || activeContext.exePath) : activeContext.title;
		const help = trackingLabel.querySelector('span');
		if (help) {
			help.innerHTML = `<strong style="color:#dcdedf;font-weight:500;">${escapeHtml(gdlText('use_tracking_executable', 'Use the real game executable'))}</strong><br />${escapeHtml(gdlText('tracking_executable_help', '{bootstrap} closes after launching {game}. Use {game} so Steam keeps tracking playtime.', { bootstrap: shortcutPathBasename(activeContext.exePath), game: shortcutPathBasename(activeContext.recommendedExePath || '') }))}`;
		}
		if (hasTrackingRecommendation) {
			if (activeContext.trackingExecutableAutoApply) {
				trackingLabel.style.display = 'none';
				trackingInput.checked = true;
			} else {
				trackingLabel.style.display = 'flex';
				if (!trackingInput.dataset.gdlUserChanged) trackingInput.checked = false;
			}
		} else {
			trackingLabel.style.display = 'none';
			trackingInput.checked = false;
		}
		updateExeSummary();
	};
	trackingInput.addEventListener('change', () => {
		trackingInput.dataset.gdlUserChanged = '1';
		updateExeSummary();
	});
	(overlay as any)._updateContext = (nextContext: ShortcutDetectionContext): void => {
		if (!nextContext || Number(nextContext.shortcutAppId) !== Number(activeContext.shortcutAppId)) return;
		activeContext = { ...activeContext, ...nextContext };
		syncTrackingRecommendationUi();
		renderCandidate();
	};
	syncTrackingRecommendationUi();
	updateLauncherBypass(currentCandidates[0]?.appid || '');
	let successfulLinkedShortcutId: number | null = null, queuedLinkWatch: EventListener | null = null;
	let queuedInBackground = false;
	const stopQueuedLinkWatch = (): void => {
		if (queuedLinkWatch !== null) window.removeEventListener(PENDING_LINK_JOBS_CHANGED_EVENT, queuedLinkWatch);
		queuedLinkWatch = null;
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
	if (activeModalEscapeHandler) {
		try { targetDoc.removeEventListener('keydown', activeModalEscapeHandler); } catch {}
		try { document.removeEventListener('keydown', activeModalEscapeHandler); } catch {}
	}
	activeModalEscapeHandler = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
	};
	targetDoc.addEventListener('keydown', activeModalEscapeHandler);
	const watchQueuedLink = (jobId: string): void => {
		stopQueuedLinkWatch();
		queuedInBackground = true;
		confirm.disabled = true;
		confirm.style.opacity = '.65';
		cancel.disabled = false;
		cancel.textContent = gdlText('close', 'Close');
		const refreshQueuedState = (): void => {
			if (!targetDoc.getElementById('gdl-manual-link-modal')) {
				stopQueuedLinkWatch();
				return;
			}
			const job = getPendingLinkJob(jobId);
			if (!job) {
				stopQueuedLinkWatch();
				queuedInBackground = false;
				linkSucceeded = true;
				setProgress(3);
				setStatus(gdlText('link_queued_complete', '✓ Ready. The game is prepared in your library.'), 'success');
				confirm.style.display = 'none';
				cancel.textContent = gdlText('done', 'Done');
				shortcutRuntimeHost().resetLibraryInjection?.(true, shortcutRuntimeHost().getMainWindowDoc() || targetDoc);
				return;
			}
			if (job.status === 'failed') {
				stopQueuedLinkWatch();
				queuedInBackground = false;
				setStatus(gdlText('link_queued_failed', 'Setup could not be completed. You can try again.'), 'error');
				confirm.disabled = false;
				confirm.style.opacity = '1';
				return;
			}
			if (job.attempts > 0) {
				setStatus(gdlText('link_queued_retrying', 'Finishing setup in the background…'), 'active');
			}
		};
		refreshQueuedState();
		if (queuedInBackground) {
			queuedLinkWatch = (() => refreshQueuedState()) as EventListener;
			window.addEventListener(PENDING_LINK_JOBS_CHANGED_EVENT, queuedLinkWatch);
		}
	};
	const queueLinkInBackground = (steamAppId: string, shortcutAppId = activeContext.shortcutAppId, repairResources = false): void => {
		const job = enqueueLinkJob({
			title: activeContext.title,
			shortcutAppId,
			steamAppId,
			skipLauncher: launcherInput.checked || shouldAutoApplyNoLauncher(steamAppId),
			existingLaunchOptions: activeContext.launchOptions,
			trackingExecutable: hasTrackingRecommendation && (activeContext.trackingExecutableAutoApply || trackingInput.checked) ? activeContext.recommendedExePath : '',
			trackingStartDir: hasTrackingRecommendation && (activeContext.trackingExecutableAutoApply || trackingInput.checked) ? activeContext.recommendedStartDir : '',
			shortcutExecutable: activeContext.exePath || '',
			repairResources,
		});
		setStatus(gdlText('link_queued_background', 'Linked. Finishing resources in the background…'), 'active');
		watchQueuedLink(job.id);
	};
	confirm.addEventListener('click', async () => {
		if (modalSubmitting) return;
		const manualAppId = manualAppIdInput.value.trim();
		if (manualAppId && !/^\d+$/.test(manualAppId)) {
			setStatus(gdlText('manual_appid_invalid', 'Enter a numeric Steam AppID.'), 'error');
			return;
		}
		const selected = currentCandidates.find(candidate => candidate.appid === select.value) || currentCandidates[0];
		const steamAppId = manualAppId || selected?.appid || '';
		if (!steamAppId) {
			setStatus(gdlText('enter_appid', 'Enter an AppID or store link.'), 'error');
			manualAppIdInput.focus();
			return;
		}
		modalSubmitting = true;
		shortcutLinkInProgress = true;
		setProgress(1);
		confirm.disabled = true;
		cancel.disabled = false;
		cancel.textContent = gdlText('close', 'Close');
		confirm.style.opacity = '.65';
		cancelPendingLinkJobs(activeContext.shortcutAppId, activeContext.title);
		undismissShortcut(activeContext.shortcutAppId);
		const linkInput = {
			title: activeContext.title, shortcutAppId: activeContext.shortcutAppId, steamAppId,
			skipLauncher: launcherInput.checked || shouldAutoApplyNoLauncher(steamAppId), existingLaunchOptions: activeContext.launchOptions,
			trackingExecutable: hasTrackingRecommendation && (activeContext.trackingExecutableAutoApply || trackingInput.checked) ? activeContext.recommendedExePath : '',
			trackingStartDir: hasTrackingRecommendation && (activeContext.trackingExecutableAutoApply || trackingInput.checked) ? activeContext.recommendedStartDir : '',
			shortcutExecutable: activeContext.exePath || '',
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
					if (phase === 'identity') { setProgress(1, false, 2); setStatus(gdlText('link_status_preparing', 'Preparing game…'), 'active'); }
					if (phase === 'assets') { setProgress(2, false, 3); setStatus(gdlText('link_status_applying_resources', 'Applying resources…'), 'active'); }
				},
			});
			if (result.ok) {
				const setup = result.setup;
				const resourcesComplete = Boolean(setup?.artworkComplete && setup?.iconApplied);
				linkSucceeded = resourcesComplete;
				if (resourcesComplete) {
					cancelPendingLinkJobs(result.shortcutAppId || activeContext.shortcutAppId, activeContext.title);
					setProgress(3, false);
					setStatus(gdlText('link_ready_library', '✓ Ready. The game is prepared in your library.'), 'success');
				} else {
					setProgress(2, false, 3);
					queueLinkInBackground(steamAppId, result.shortcutAppId || activeContext.shortcutAppId, true);
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
				const retryable = !['invalid_appid', 'refusing_to_modify_native_steam_app'].includes(String(result.error || ''));
				if (retryable) {
					queueLinkInBackground(steamAppId, result.shortcutAppId || activeContext.shortcutAppId);
				} else {
					cancelPendingLinkJobs(result.shortcutAppId || activeContext.shortcutAppId, activeContext.title);
				}
				backendLog(`Link did not complete for ${activeContext.title}: ${result.error || 'unknown_error'}`);
			}
		} catch (error) {
			queueLinkInBackground(steamAppId);
			backendLog(`Background link failed for ${activeContext.title}: ${error}`);
		} finally {
			shortcutLinkInProgress = false;
			if (targetDoc.getElementById('gdl-manual-link-modal') && !linkSucceeded) {
				modalSubmitting = false;
				cancel.disabled = false;
				if (!queuedInBackground) {
					confirm.disabled = false;
					confirm.style.opacity = '1';
				}
			}
		}
	});
	mountModalDialog(overlay);
}
let globalDetectionGeneration = 0;
async function inspectShortcutReview(
	record: { id: number; title: string },
	source: ShortcutLinkReviewSource,
	targetDoc?: Document | null,
): Promise<void> {
	if (source !== 'manual' && shortcutAlreadyLinked(record.id) && !isShortcutDismissed(record.id)) return;
	const immediateDoc = (targetDoc && targetDoc.body)
		? targetDoc
		: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
	const immediateContext: ShortcutDetectionContext = {
		shortcutAppId: record.id,
		title: record.title,
		exePath: '',
		startDir: '',
		launchOptions: '',
		bootstrapDetected: false,
		recommendedExePath: '',
		recommendedStartDir: '',
	};
	const currentGeneration = ++globalDetectionGeneration;
	const loadingShown = Boolean(immediateDoc?.body && !immediateDoc.getElementById('gdl-manual-link-modal'));
	if (loadingShown) {
		showShortcutManualLinkModal(immediateDoc as Document, immediateContext, { candidates: [] }, { source, loading: true });
		const createdModal = immediateDoc?.getElementById('gdl-manual-link-modal');
		createdModal?.setAttribute('data-gdl-link-loading', '1');
	}
	let titleOnlyCandidates: ShortcutDetectionCandidate[] = [];
	try {
		const titleOnlyDetection = await detectShortcutCandidatesLocal(immediateContext);
		if (globalDetectionGeneration !== currentGeneration) return;
		titleOnlyCandidates = (titleOnlyDetection?.candidates || []).slice();
		if (titleOnlyCandidates.length > 0) {
			const fastModal = immediateDoc?.getElementById('gdl-manual-link-modal');
			if (fastModal && (fastModal as any)._updateCandidates) {
				(fastModal as any)._updateCandidates(titleOnlyCandidates, false);
			}
		}
	} catch (error) {
		backendLog(`Title-only AppID discovery failed for ${record.title}: ${error}`);
	}
	if (shortcutMutationInProgress() && source === 'manual') {
		let waitMs = 0;
		while (shortcutMutationInProgress() && waitMs < 1200) {
			await new Promise(resolve => setTimeout(resolve, 200));
			waitMs += 200;
		}
	}
	if (shortcutMutationInProgress() && source !== 'manual') {
		backendLog(`Ignoring automatic link review for ${record.title} while another identity operation is active.`);
		return;
	}
	if (source !== 'manual' && shortcutDetectionInFlight.has(record.id)) return;
	shortcutDetectionInFlight.add(record.id);
	let modalRendered = false;
	try {
		let context: ShortcutDetectionContext | null = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			context = await buildShortcutDetectionContext(immediateDoc, record.title, record.id);
			if (context?.exePath || context?.title) break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (!context) {
			context = {
				shortcutAppId: record.id,
				title: record.title,
				exePath: '',
				startDir: '',
				launchOptions: '',
				bootstrapDetected: false,
				recommendedExePath: '',
				recommendedStartDir: '',
			};
		}
		if (!context.title && !context.exePath) {
			backendLog(`Manual link review has no title or executable for shortcut ${record.title} (${record.id})`);
			if (source === 'manual') {
				const fallbackDoc = (immediateDoc && immediateDoc.body)
					? immediateDoc
					: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
				if (fallbackDoc) {
					showShortcutManualLinkModal(fallbackDoc, context, { candidates: [] }, { source: 'manual', loading: false });
					modalRendered = true;
				}
			}
			return;
		}
		if (globalDetectionGeneration !== currentGeneration) return;
		if (loadingShown && !manualLinkModalPresent(immediateDoc) && source !== 'manual') return;
		const hydratedModal = immediateDoc?.getElementById('gdl-manual-link-modal');
		if (hydratedModal && (hydratedModal as any)._updateContext) {
			(hydratedModal as any)._updateContext(context);
		}
		const localDetection = await detectShortcutCandidatesLocal(context);
		if (globalDetectionGeneration !== currentGeneration) return;
		if (loadingShown && !manualLinkModalPresent(immediateDoc) && source !== 'manual') return;
		let activeCandidates = mergeCandidateLists(titleOnlyCandidates, localDetection?.candidates || []);
		const existingMappedId = findMappingForShortcut(record.id, record.title, context.exePath);
		if (existingMappedId && /^\d+$/.test(existingMappedId)) {
			const mappedData = await getGameData(existingMappedId);
			if (mappedData) {
				const existingIndex = activeCandidates.findIndex(candidate => candidate.appid === existingMappedId);
				if (existingIndex >= 0) {
					const [item] = activeCandidates.splice(existingIndex, 1);
					item.score = 100;
					activeCandidates.unshift(item);
				} else {
					activeCandidates.unshift({
						appid: existingMappedId,
						name: mappedData.name || record.title,
						score: 100,
						direct: true,
						confidence: 'high',
						image: mappedData.header_image,
						validation_state: 'confirmed',
					});
				}
			}
		}
		const doc = (immediateDoc && immediateDoc.body)
			? immediateDoc
			: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
		if (!doc?.body) return;
		const currentModal = doc.getElementById('gdl-manual-link-modal');
		if (currentModal && (currentModal as any)._updateCandidates) {
			(currentModal as any)._updateCandidates(activeCandidates, false);
			modalRendered = true;
		} else {
			showShortcutManualLinkModal(doc, context, { candidates: activeCandidates }, { source, loading: activeCandidates.length === 0 });
			modalRendered = true;
		}
		const enrichmentContext = context;
		const localSnapshot = activeCandidates.slice();
		void enrichShortcutCandidatesRemote(enrichmentContext, localSnapshot).then(remoteDetection => {
			if (globalDetectionGeneration !== currentGeneration) return;
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			const liveModal = liveDoc?.getElementById('gdl-manual-link-modal');
			if (!liveModal || !(liveModal as any)._updateCandidates) return;
			if (remoteDetection && remoteDetection.candidates && remoteDetection.candidates.length > 0) {
				let merged = mergeCandidateLists(localSnapshot, remoteDetection.candidates);
				if (existingMappedId && /^\d+$/.test(existingMappedId)) {
					const existingIndex = merged.findIndex(c => c.appid === existingMappedId);
					if (existingIndex > 0) {
						const [item] = merged.splice(existingIndex, 1);
						item.score = 100;
						merged.unshift(item);
					}
				}
				(liveModal as any)._updateCandidates(merged, true);
			} else {
				(liveModal as any)._markEnrichmentComplete?.();
			}
		}).catch(err => {
			backendLog(`Remote candidate enrichment error for ${record.title}: ${err}`);
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			const liveModal = liveDoc?.getElementById('gdl-manual-link-modal');
			if (liveModal && (liveModal as any)._markEnrichmentComplete) {
				(liveModal as any)._markEnrichmentComplete();
			}
		});
	} catch (error) {
		backendLog(`Manual shortcut review failed for ${record.title}: ${error}`);
		if (source === 'manual' && !modalRendered) {
			try {
				const fallbackDoc = immediateDoc || shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null);
				if (fallbackDoc) {
					showShortcutManualLinkModal(fallbackDoc, immediateContext, { candidates: [] }, { source: 'manual', loading: false });
					modalRendered = true;
				}
			} catch {}
		}
	} finally {
		if (loadingShown && !modalRendered && source !== 'manual') {
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			liveDoc?.querySelector('#gdl-manual-link-modal[data-gdl-link-loading="1"]')?.remove();
		}
		shortcutDetectionScheduled.delete(record.id);
		shortcutDetectionInFlight.delete(record.id);
	}
}
function scheduleShortcutReview(
	record: { id: number; title: string },
	delay = 50,
	source: ShortcutLinkReviewSource = 'manual',
	targetDoc?: Document | null,
): void {
	if (!Number.isFinite(record.id) || record.id < 2147483648 || !record.title.trim()) return;
	if (source !== 'manual' && (shortcutDetectionScheduled.has(record.id) || shortcutDetectionInFlight.has(record.id))) return;
	shortcutDetectionScheduled.add(record.id);
	const exec = () => {
		void inspectShortcutReview(record, source, targetDoc).finally(() => shortcutDetectionScheduled.delete(record.id));
	};
	if (delay > 0) setTimeout(exec, delay);
	else exec();
}
function resolveOrSynthesizeShortcutRecord(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null): { id: number; title: string; app: any } | null {
	const numericId = Number(shortcutAppId);
	let normalizedId = Number.isFinite(numericId) && numericId < SHORTCUT_THRESHOLD ? (numericId >>> 0) : numericId;
	const records = getAllShortcutRecords();
	if (!records.some(candidate => candidate.id === normalizedId) && gameTitle.trim()) {
		try {
			const activeDoc = targetDoc || shortcutRuntimeHost().getMainWindowDoc();
			const active = findActiveShortcutAppId(activeDoc as Document, gameTitle);
			const activeId = Number(active || 0);
			if (activeId >= SHORTCUT_THRESHOLD && records.some(candidate => candidate.id === activeId)) normalizedId = activeId;
		} catch {}
	}
	const exact = normalizedId ? records.find(candidate => candidate.id === normalizedId) : undefined;
	const titleMatches = gameTitle.trim() ? records.filter(candidate => normalizeTitle(candidate.title) === normalizeTitle(gameTitle)) : [];
	const record = exact || (titleMatches.length === 1 ? titleMatches[0] : (titleMatches.find(c => !shortcutAlreadyLinked(c.id)) || titleMatches[0]));
	if (record) return record;
	const cleanTitle = gameTitle.trim();
	if (!cleanTitle && (!normalizedId || normalizedId < SHORTCUT_THRESHOLD)) return null;
	let fallbackId = normalizedId && normalizedId >= SHORTCUT_THRESHOLD ? normalizedId : 0;
	if (!fallbackId && cleanTitle) {
		let hash = 0;
		for (let i = 0; i < cleanTitle.length; i++) hash = (hash * 31 + cleanTitle.charCodeAt(i)) >>> 0;
		fallbackId = SHORTCUT_THRESHOLD + (hash % 1000000000);
	}
	return { id: fallbackId, title: cleanTitle || 'Non-Steam Game', app: null };
}
export function requestManualShortcutLink(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null): boolean {
	const record = resolveOrSynthesizeShortcutRecord(shortcutAppId, gameTitle, targetDoc);
	if (!record) return false;
	undismissShortcut(record.id);
	scheduleShortcutReview(record, 0, 'manual', targetDoc);
	return true;
}
export function requestNativeAddShortcutReview(shortcutAppId: number, gameTitle = '', targetDoc?: Document | null): boolean {
	const record = resolveOrSynthesizeShortcutRecord(shortcutAppId, gameTitle, targetDoc);
	if (!record || shortcutAlreadyLinked(record.id)) return false;
	undismissShortcut(record.id);
	scheduleShortcutReview(record, 0, 'native-add-auto', targetDoc);
	return true;
}
export { linkAllShortcutsExperimental, type BulkLinkAllResult, type BulkLinkGameOutcome, type BulkLinkOutcomeStatus, type BulkLinkProgressPhase } from './bulk-link';
