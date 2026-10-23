import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { detectGameCandidatesBackend, detectGameCandidatesLocalBackend, getShortcutDetailsBackend, backendLog } from '../../api/backend';
import { getSteamLanguage } from '../../steam/localization';
import { RetryingRequestCache } from '../../core/request-cache';
import { committedHeaderAppId } from '../../steam/library-details';
import { readFreshShortcutLaunchDetails, readShortcutLaunchDetails } from '../../steam/shortcut-details';
import { expandCandidatesWithEditions } from './editions';
export { expandCandidatesWithEditions } from './editions';
import {
	cleanShortcutPath,
	getShortcutAppById,
	readShortcutOverviewField,
	shortcutPathBasename,
	shortcutPathDirectory,
} from '../../steam/shortcuts';

const detectionCache = new RetryingRequestCache<ShortcutDetectionResult>({
	ttlMs: 5 * 60 * 1000,
	retries: 1,
	baseDelayMs: 180,
	isCacheable: (value): value is ShortcutDetectionResult => Boolean(value && !value.error && value.transient_error !== true),
});

/**
 * Windows assigns display names such as "tlou-i.exe - Acceso directo" when a
 * desktop shortcut is added through Steam's program list.  That is not the
 * game's title and weakens otherwise reliable alias/executable matching.
 * Keep the original title for UI and mappings; use this only for detection.
 */
function detectionTitleHint(title: string): string {
	let hint = String(title || '').trim();
	hint = hint.replace(/\s*[-–—]\s*(?:acceso directo|shortcut|verknüpfung|raccourci|collegamento|atalho)\s*$/i, '');
	hint = hint.replace(/\.(?:lnk|url|exe|com|bat|cmd|appimage)\s*$/i, '');
	return hint.trim() || String(title || '').trim();
}

export function withDetectionBudget<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve(null), timeoutMs);
		promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
	});
}

function readShortcutPathFromProperties(doc: Document, shortcutAppId: number): { exePath: string; startDir: string; launchOptions: string } {
	const scope = Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], [class*="PagedSettingsDialog"]')).find(candidate => {
		if (candidate.closest('[id^="gdl-"]')) return false;
		const owner = Number(candidate.getAttribute('data-appid') || candidate.getAttribute('data-app-id') || committedHeaderAppId(candidate));
		return (owner === shortcutAppId || (owner >>> 0) === shortcutAppId)
			&& Boolean(candidate.matches('[class*="PagedSettingsDialog"], [class*="pagedsettings"]')
				|| candidate.querySelector('[class*="PagedSettingsDialog"], [class*="PageList"], [class*="SettingsNav"], [class*="DialogNav"]'));
	});
	const values = Array.from(scope?.querySelectorAll('input') || []).map(input => (input as HTMLInputElement).value?.trim() || '');
	let exePath = '';
	let startDir = '';
	let launchOptions = '';
	for (const value of values) {
		if (!value || /^\d+$/.test(value)) continue;
		const cleaned = cleanShortcutPath(value);
		if (!exePath && (/[\\/]/.test(cleaned) || /^[a-z]:/i.test(cleaned)) && /\.(?:exe|com|bat|cmd|lnk|url|appimage)$/i.test(cleaned)) {
			exePath = cleaned;
			continue;
		}
		if (!startDir && /^[a-z]:[\\/]/i.test(cleaned) && !/\.[a-z0-9]{2,6}$/i.test(cleaned)) {
			startDir = cleaned;
			continue;
		}
		if (!launchOptions && /^[-/%]/.test(value) && !/^[a-z]:[\\/]/i.test(cleaned)) launchOptions = value;
	}
	return { exePath, startDir, launchOptions };
}

function knownShortcutLaunchOptions(...sources: any[]): string | undefined {
	for (const source of sources) {
		for (const container of [source, source?.app_overview, source?.m_appOverview, source?.overview]) {
			for (const key of ['strLaunchOptions', 'strShortcutLaunchOptions', 'm_strShortcutLaunchOptions', 'shortcut_launch_options', 'strArguments']) {
				if (typeof container?.[key] === 'string') return container[key].trim();
			}
		}
	}
	return undefined;
}

/** Preserve the committed launch definition before asynchronous VDF/IPC work. */
export function buildImmediateShortcutDetectionContext(doc: Document | null, title: string, shortcutAppId: number, fallbackApp?: any): ShortcutDetectionContext {
	const app = getShortcutAppById(shortcutAppId, doc || undefined);
	const details = readShortcutLaunchDetails(shortcutAppId, doc);
	const fromProperties = doc ? readShortcutPathFromProperties(doc, shortcutAppId) : { exePath: '', startDir: '', launchOptions: '' };
	const field = (...keys: string[]): string => readShortcutOverviewField(details, ...keys)
		|| readShortcutOverviewField(app, ...keys) || readShortcutOverviewField(fallbackApp, ...keys);
	const exePath = cleanShortcutPath(field('strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath') || fromProperties.exePath);
	return { shortcutAppId, title: String(title || field('display_name', 'm_strDisplayName', 'strDisplayName', 'strAppName') || shortcutPathBasename(exePath)).trim(),
		exePath, startDir: cleanShortcutPath(field('strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir') || fromProperties.startDir || shortcutPathDirectory(exePath)),
		launchOptions: knownShortcutLaunchOptions(details, app, fallbackApp) ?? fromProperties.launchOptions };
}

export async function buildShortcutDetectionContext(
	doc: Document | null,
	title: string,
	shortcutAppId: number,
): Promise<ShortcutDetectionContext | null> {
	let validId = Number(shortcutAppId) || 0;
	if (validId < 0) validId = (validId >>> 0);
	if (validId < 2147483648) {
		let hash = 0;
		for (let i = 0; i < (title || '').length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
		validId = 2147483648 + (hash % 1000000000);
	}
	const app = getShortcutAppById(validId, doc || undefined);
	const immediate = buildImmediateShortcutDetectionContext(doc, title, validId, app);
	let { exePath, startDir, launchOptions } = immediate;
	let launchOptionsKnown = knownShortcutLaunchOptions(readShortcutLaunchDetails(validId, doc), app) !== undefined;
	const appsApi = ((doc?.defaultView || (typeof window !== 'undefined' ? window : null)) as any)?.SteamClient?.Apps;
	let backendTitle = '';

	// Read the original shortcut definition from VDF as a fallback when Steam's
	// in-memory app details are incomplete.
	const backendDetailsPromise = withDetectionBudget(
		getShortcutDetailsBackend({ shortcut_app_id: String(shortcutAppId), title: title || '' }),
		1200,
	);

	if (!exePath || !startDir) {
		const details = await readFreshShortcutLaunchDetails(shortcutAppId, doc);
		exePath ||= readShortcutOverviewField(details, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath');
		startDir ||= readShortcutOverviewField(details, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir');
		const freshOptions = knownShortcutLaunchOptions(details);
		if (freshOptions !== undefined) { launchOptions = freshOptions; launchOptionsKnown = true; }
	}

	try {
		const raw = await backendDetailsPromise;
		if (raw == null) throw new Error('shortcut_details_budget_exceeded');
		let details: any = raw;
		for (let attempt = 0; attempt < 2 && typeof details === 'string'; attempt++) details = JSON.parse(details);
		if (details && typeof details === 'object' && !details.error) {
			exePath ||= String(details.exe_path || '');
			startDir ||= String(details.start_dir || '');
			if (!launchOptionsKnown && !launchOptions) launchOptions = String(details.launch_options || '');
			backendTitle = String(details.title || '').trim();
			if (exePath) {
				backendLog(`Resolved shortcut executable from shortcuts.vdf for ${title || backendTitle || shortcutAppId}`);
			}
		}
	} catch (error) {
		backendLog(`Could not enrich shortcut ${shortcutAppId} from shortcuts.vdf: ${error}`);
	}

	exePath = cleanShortcutPath(exePath);
	if (/\.lnk$/i.test(exePath)) {
		try {
			const resolver = appsApi?.GetShortcutDataForPath;
			if (typeof resolver === 'function') {
				const resolved = await withDetectionBudget(Promise.resolve(resolver(exePath)), 400);
				exePath = cleanShortcutPath(resolved?.strExePath || exePath);
				launchOptions = String(resolved?.strArguments || resolved?.strCmdline || launchOptions || '').trim();
			}
		} catch (error) {
			backendLog(`Could not resolve shortcut file ${exePath}: ${error}`);
		}
	}
	if (!startDir && exePath) startDir = shortcutPathDirectory(exePath);
	const appTitle = readShortcutOverviewField(app, 'display_name', 'm_strDisplayName', 'strDisplayName', 'strAppName');
	return {
		shortcutAppId,
		title: String(title || appTitle || backendTitle || shortcutPathBasename(exePath)).trim(),
		exePath,
		startDir: cleanShortcutPath(startDir),
		launchOptions: String(launchOptions || '').trim(),
	};
}

export const DETECTION_MODEL_VERSION = 'v13';

export function sameShortcutDetectionContext(left: ShortcutDetectionContext, right: ShortcutDetectionContext): boolean {
	return left.shortcutAppId === right.shortcutAppId && left.title === right.title && left.exePath === right.exePath
		&& left.startDir === right.startDir && left.launchOptions === right.launchOptions;
}

/** A suggestion can be preselected for review only with consistent identity evidence. */
export function reliableReviewCandidate(candidate?: ShortcutDetectionCandidate): boolean {
	return Boolean(candidate && candidate.score >= 70 && !candidate.ambiguous && !candidate.identity_collision
		&& !candidate.negative_reasons?.length && candidate.evidence_tier !== 'hint'
		&& (candidate.evidence_tier || candidate.score >= 90 || candidate.confidence === 'high' || candidate.confidence === 'exact'));
}

export function displayReviewConfidence(candidate: ShortcutDetectionCandidate): 'HIGH' | 'MEDIUM' | 'LOW' {
	if (candidate.ambiguous || candidate.identity_collision || candidate.negative_reasons?.length) return 'LOW';
	if (candidate.score >= 90) return 'HIGH';
	return candidate.score >= 70 ? 'MEDIUM' : 'LOW';
}

function parseDetectionCandidate(candidate: any): ShortcutDetectionCandidate {
	return {
		appid: String(candidate.appid),
		name: String(candidate.name || candidate.appid),
		image: String(candidate.image || ''),
		score: Math.max(0, Math.min(100, Number(candidate.score) || 0)),
		confidence: ['exact', 'high', 'medium', 'low'].includes(candidate.confidence) ? candidate.confidence : 'low',
		reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map(String) : [],
		negative_reasons: Array.isArray(candidate.negative_reasons) ? candidate.negative_reasons.map(String) : [],
		warnings: Array.isArray(candidate.warnings) ? candidate.warnings.map(String) : [],
		executable_match: !!candidate.executable_match,
		direct: !!candidate.direct,
		evidence_tier: ['proof', 'strong', 'supporting', 'hint'].includes(candidate.evidence_tier) ? candidate.evidence_tier : undefined,
		score_gap: typeof candidate.score_gap === 'number' ? candidate.score_gap : undefined,
		ambiguous: !!candidate.ambiguous,
		identity_collision: !!candidate.identity_collision,
		remembered: !!candidate.remembered,
		validation_state: candidate.validation_state,
		phase: candidate.phase,
	};
}

function parseDetectionResult(parsed: any): ShortcutDetectionResult {
	const candidates = Array.isArray(parsed?.candidates)
		? parsed.candidates
			.filter((candidate: any) => /^\d+$/.test(String(candidate?.appid || '')))
			.map(parseDetectionCandidate)
		: [];
	return {
		candidates,
		rejected_appids: Array.isArray(parsed?.rejected_appids)
			? parsed.rejected_appids.map(String).filter((id: string) => /^\d+$/.test(id) && Number(id) > 0 && Number(id) < 2147483648) : [],
		launcher_detected: !!parsed?.launcher_detected,
		generic_launcher: !!parsed?.generic_launcher,
		executable: String(parsed?.executable || ''),
		source: String(parsed?.source || ''),
		error: parsed?.error ? String(parsed.error) : undefined,
		transient_error: parsed?.transient_error === true,
		validation_state: parsed?.validation_state,
		phase: parsed?.phase,
	};
}

export { mergeCandidateLists } from './candidate-merger';
import { mergeCandidateLists } from './candidate-merger';


function decodedDetectionResult(raw: unknown): ShortcutDetectionResult | null {
	let parsed: any = raw;
	for (let attempt = 0; attempt < 3 && typeof parsed === 'string'; attempt++) parsed = JSON.parse(parsed);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('candidates' in parsed || parsed.error)) return null;
	if (!parsed.error && !Array.isArray(parsed.candidates)
		&& !(parsed.candidates && typeof parsed.candidates === 'object' && !Object.keys(parsed.candidates).length)) return null;
	return parseDetectionResult(parsed);
}

interface LocalDetectionObserver {
	isCurrent: () => boolean;
	onLateResult: (result: ShortcutDetectionResult) => void;
}

export async function detectShortcutCandidatesLocal(
	context: ShortcutDetectionContext, observer?: LocalDetectionObserver,
): Promise<ShortcutDetectionResult | null> {
	const titleHint = detectionTitleHint(context.title);
	try {
		const request = detectGameCandidatesLocalBackend({
			request_json: JSON.stringify({
				title: titleHint,
				exe_path: context.exePath,
				start_dir: context.startDir,
				launch_options: context.launchOptions,
				shortcut_app_id: String(context.shortcutAppId),
				phase: 'local',
			}),
		}).then(raw => {
			const result = decodedDetectionResult(raw);
			if (result) {
				result.candidates = expandCandidatesWithEditions(result.candidates);
				result.phase = 'local'; result.validation_state = 'partial';
			}
			return result;
		}).catch((error): null => { backendLog(`Local AppID detection failed for ${context.title}: ${error}`); return null; });
		// IPC can wait behind another backend call. Release the fast phase at
		// 1800 ms, but keep a bounded observer for useful results already queued.
		// Clear both callbacks at the deadline so a hung request retains no UI.
		const observeLate = Boolean(observer);
		let late = observer?.onLateResult || null, current = observer?.isCurrent || null, timedOut = false;
		observer = undefined;
		const release = (): void => { late = null; current = null; clearTimeout(deadline); };
		const deadline = observeLate ? setTimeout(release, 10000) : undefined;
		void request.then(result => {
			try { if (timedOut && result && current?.()) late?.(result); }
			catch (error) { backendLog(`Late local AppID publication failed: ${error}`); }
			finally { release(); }
		});
		const result = await withDetectionBudget(request, 1800);
		timedOut = true;
		return result;
	} catch (error) {
		backendLog(`Local AppID detection failed for ${context.title}: ${error}`);
		return null;
	}
}

export async function enrichShortcutCandidatesRemote(
	context: ShortcutDetectionContext,
	localCandidates?: ShortcutDetectionCandidate[],
	signal?: AbortSignal,
	recoveryMode = false,
): Promise<ShortcutDetectionResult | null> {
	if (signal?.aborted) return null;
	const language = await withDetectionBudget(getSteamLanguage(), 400) || 'english';
	if (signal?.aborted) return null;
	const titleHint = detectionTitleHint(context.title);
	try {
		const raw = await withDetectionBudget(detectGameCandidatesBackend({
			request_json: JSON.stringify({
				title: titleHint,
				exe_path: context.exePath,
				start_dir: context.startDir,
				launch_options: context.launchOptions,
				shortcut_app_id: String(context.shortcutAppId),
				language,
				phase: 'remote',
				local_candidates: (localCandidates || []).slice(0, 6),
				recovery_mode: recoveryMode,
				expires_at_ms: Date.now() + 5500,
			}),
		}), 6500);
		if (signal?.aborted) return null;
		const result = decodedDetectionResult(raw);
		if (!result) return null;
		result.candidates = expandCandidatesWithEditions(result.candidates);
		result.phase = 'remote';
		return result;
	} catch (error) {
		backendLog(`Remote AppID enrichment failed for ${context.title}: ${error}`);
		return null;
	}
}

export async function detectShortcutCandidates(context: ShortcutDetectionContext): Promise<ShortcutDetectionResult | null> {
	const language = await withDetectionBudget(getSteamLanguage(), 400) || 'english';
	const titleHint = detectionTitleHint(context.title);
	const cacheKey = [DETECTION_MODEL_VERSION, context.shortcutAppId, titleHint, context.exePath, context.startDir, context.launchOptions, language].join('|');
	try {
		return await detectionCache.get(cacheKey, async (): Promise<ShortcutDetectionResult | null> => {
			try {
				const localResult = await detectShortcutCandidatesLocal(context);
				const remoteResult = await enrichShortcutCandidatesRemote(context, localResult?.candidates);

				if (!remoteResult || remoteResult.candidates.length === 0) {
					if (localResult && localResult.candidates.length > 0) {
						const retained = mergeCandidateLists(localResult.candidates, [], remoteResult?.rejected_appids);
						return {
							...localResult,
							rejected_appids: remoteResult?.rejected_appids,
							candidates: expandCandidatesWithEditions(retained),
							transient_error: !remoteResult || remoteResult.transient_error === true || retained.length > 0,
							validation_state: 'partial',
						};
					}
					if (!remoteResult) return null;
					// A completed empty remote response cannot establish absence when
					// local evidence was unavailable. Keep the next attempt retryable.
					return !localResult || localResult.error || localResult.transient_error
						? { ...remoteResult, transient_error: true, validation_state: 'partial' } : remoteResult;
				}

				const mergedCandidates = mergeCandidateLists(
					localResult?.candidates || [],
					remoteResult.candidates,
					remoteResult.rejected_appids,
				);

				const result: ShortcutDetectionResult = {
					...remoteResult,
					candidates: expandCandidatesWithEditions(mergedCandidates),
					validation_state: remoteResult.validation_state || 'confirmed',
					phase: 'all',
				};
				return result.transient_error && result.candidates.length === 0 ? null : result;
			} catch (error) {
				backendLog(`Automatic AppID detection failed for ${context.title}: ${error}`);
				return null;
			}
		});
	} catch (error) {
		backendLog(`Automatic AppID detection failed for ${context.title}: ${error}`);
		return null;
	}
}

export function clearShortcutDetectionCache(): void {
	detectionCache.clear();
}
