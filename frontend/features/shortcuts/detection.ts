import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { detectGameCandidatesBackend, detectGameCandidatesLocalBackend, getShortcutDetailsBackend, backendLog } from '../../api/backend';
import { getSteamLanguage } from '../../steam/localization';
import { RetryingRequestCache } from '../../core/request-cache';
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

async function withDetectionBudget<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	return await Promise.race<T | null>([
		promise.catch((): null => null),
		new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
	]);
}

function readShortcutPathFromProperties(doc: Document): { exePath: string; startDir: string; launchOptions: string } {
	const values = Array.from(doc.querySelectorAll('input')).map(input => (input as HTMLInputElement).value?.trim() || '');
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
	const app = getShortcutAppById(validId);
	const fromProperties = doc ? readShortcutPathFromProperties(doc) : { exePath: '', startDir: '', launchOptions: '' };
	let exePath = readShortcutOverviewField(app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath') || fromProperties.exePath;
	let startDir = readShortcutOverviewField(app, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir') || fromProperties.startDir;
	let launchOptions = readShortcutOverviewField(app, 'strShortcutLaunchOptions', 'm_strShortcutLaunchOptions', 'shortcut_launch_options', 'strArguments') || fromProperties.launchOptions;
	let backendTitle = '';
	let bootstrapDetected = false;
	let recommendedExePath = '';
	let recommendedStartDir = '';
	let trackingExecutableAutoApply = false;

	// Tracking/launcher analysis comes from the backend filesystem/VDF resolver.
	// Always request it: SteamClient often already supplies exe/startDir, which
	// previously skipped this call entirely and silently removed the "use real
	// game executable" recommendation (including RDR2's Launcher.exe rule).
	const backendDetailsPromise = withDetectionBudget(
		getShortcutDetailsBackend({ shortcut_app_id: String(shortcutAppId), title: title || '' }),
		1200,
	);

	if (!exePath || !startDir) {
		const appsApi = (window as any).SteamClient?.Apps;
		if (typeof appsApi?.GetCachedAppDetails === 'function') {
			for (const id of [shortcutAppId, shortcutAppId - 4294967296]) {
				try {
					const raw = await withDetectionBudget(Promise.resolve(appsApi.GetCachedAppDetails(id)), 300);
					if (raw == null) continue;
					let details: any = raw;
					if (typeof raw === 'string') details = JSON.parse(raw);
					if (!details || typeof details !== 'object') continue;
					exePath ||= readShortcutOverviewField(details, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath');
					startDir ||= readShortcutOverviewField(details, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir');
					launchOptions ||= readShortcutOverviewField(details, 'strShortcutLaunchOptions', 'm_strShortcutLaunchOptions', 'shortcut_launch_options', 'strLaunchOptions');
					if (exePath && startDir) break;
				} catch {}
			}
		}
	}

	try {
		const raw = await backendDetailsPromise;
		if (raw == null) throw new Error('shortcut_details_budget_exceeded');
		let details: any = raw;
		for (let attempt = 0; attempt < 2 && typeof details === 'string'; attempt++) details = JSON.parse(details);
		if (details && typeof details === 'object' && !details.error) {
			exePath ||= String(details.exe_path || '');
			startDir ||= String(details.start_dir || '');
			launchOptions ||= String(details.launch_options || '');
			backendTitle = String(details.title || '').trim();
			bootstrapDetected = !!details.bootstrap_detected;
			recommendedExePath = cleanShortcutPath(details.recommended_exe_path || '');
			recommendedStartDir = cleanShortcutPath(details.recommended_start_dir || '');
			trackingExecutableAutoApply = details.tracking_executable_auto_apply === true;
			if (recommendedExePath) {
				backendLog(`Tracking executable recommendation for ${title || backendTitle || shortcutAppId}: ${recommendedExePath}`);
			} else if (exePath) {
				backendLog(`Resolved shortcut executable from shortcuts.vdf for ${title || backendTitle || shortcutAppId}`);
			}
		}
	} catch (error) {
		backendLog(`Could not enrich shortcut ${shortcutAppId} from shortcuts.vdf: ${error}`);
	}

	exePath = cleanShortcutPath(exePath);
	if (/\.lnk$/i.test(exePath)) {
		try {
			const resolver = (window as any).SteamClient?.Apps?.GetShortcutDataForPath;
			if (typeof resolver === 'function') {
				const resolved = await resolver(exePath);
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
		bootstrapDetected,
		recommendedExePath,
		recommendedStartDir,
		trackingExecutableAutoApply,
	};
}

export const DETECTION_MODEL_VERSION = 'v10';

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


export async function detectShortcutCandidatesLocal(context: ShortcutDetectionContext): Promise<ShortcutDetectionResult | null> {
	const titleHint = detectionTitleHint(context.title);
	const matchingExePath = context.recommendedExePath || context.exePath;
	const matchingStartDir = context.recommendedStartDir || context.startDir;
	try {
		const raw = await detectGameCandidatesLocalBackend({
			request_json: JSON.stringify({
				title: titleHint,
				exe_path: context.exePath,
				start_dir: context.startDir,
				game_exe_path: matchingExePath,
				game_start_dir: matchingStartDir,
				launch_options: context.launchOptions,
				shortcut_app_id: String(context.shortcutAppId),
				phase: 'local',
			}),
		});
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== 'object') return null;
		const result = parseDetectionResult(parsed);
		result.candidates = expandCandidatesWithEditions(result.candidates);
		result.phase = 'local';
		result.validation_state = 'partial';
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
	const language = await getSteamLanguage().catch((): string => 'english');
	if (signal?.aborted) return null;
	const titleHint = detectionTitleHint(context.title);
	const matchingExePath = context.recommendedExePath || context.exePath;
	const matchingStartDir = context.recommendedStartDir || context.startDir;
	try {
		const raw = await detectGameCandidatesBackend({
			request_json: JSON.stringify({
				title: titleHint,
				exe_path: context.exePath,
				start_dir: context.startDir,
				game_exe_path: matchingExePath,
				game_start_dir: matchingStartDir,
				launch_options: context.launchOptions,
				shortcut_app_id: String(context.shortcutAppId),
				language,
				phase: 'remote',
				local_candidates: (localCandidates || []).slice(0, 6),
				recovery_mode: recoveryMode,
			}),
		});
		if (signal?.aborted) return null;
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== 'object') return null;
		const result = parseDetectionResult(parsed);
		result.candidates = expandCandidatesWithEditions(result.candidates);
		result.phase = 'remote';
		return result;
	} catch (error) {
		backendLog(`Remote AppID enrichment failed for ${context.title}: ${error}`);
		return null;
	}
}

export async function detectShortcutCandidates(context: ShortcutDetectionContext): Promise<ShortcutDetectionResult | null> {
	const language = await getSteamLanguage().catch((): string => 'english');
	const titleHint = detectionTitleHint(context.title);
	const matchingExePath = context.recommendedExePath || context.exePath;
	const matchingStartDir = context.recommendedStartDir || context.startDir;
	const cacheKey = [DETECTION_MODEL_VERSION, context.shortcutAppId, titleHint, context.exePath, context.startDir, matchingExePath, matchingStartDir, context.launchOptions, language].join('|');
	try {
		return await detectionCache.get(cacheKey, async (): Promise<ShortcutDetectionResult | null> => {
			try {
				const localResult = await detectShortcutCandidatesLocal(context);
				const remoteResult = await enrichShortcutCandidatesRemote(context, localResult?.candidates);

				if (!remoteResult || remoteResult.candidates.length === 0) {
					if (localResult && localResult.candidates.length > 0) {
						return {
							...localResult,
							candidates: expandCandidatesWithEditions(mergeCandidateLists(localResult.candidates, [])),
							transient_error: true,
							validation_state: 'partial',
						};
					}
					return remoteResult || null;
				}

				const mergedCandidates = mergeCandidateLists(
					localResult?.candidates || [],
					remoteResult.candidates,
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
