import { backendLog } from '../../api/backend';
import { getCachedGameData, getGameData } from '../../core/game-data';
import { mappings } from '../../core/mappings';
import { steamLanguageSync } from '../../steam/localization';
import { getMappedShortcuts } from '../../steam/shortcuts';
import { getCachedLibraryAssets, getModernLibraryAssets } from './artwork';
import { getCommunityContent, getNews } from './news';

type PrefetchPhase = 'core' | 'news';

interface PrefetchTask {
	appId: string;
	language: string;
	phase: PrefetchPhase;
	order: number;
}

interface FailureCooldown {
	attempts: number;
	retryAt: number;
}

const START_DELAY_MS = 1_000;
const LANGUAGE_RETRY_MS = 1_000;
const CORE_PAUSE_MS = 650;
const NEWS_PAUSE_MS = 1_200;
const MAX_FAILURE_ATTEMPTS = 3;
const MAX_PREFETCH_APP_IDS = 6;

let started = false;
let generation = 0;
let scheduledWave: ReturnType<typeof setTimeout> | null = null;
let activeWorker: Promise<void> | null = null;
let pendingTasks: PrefetchTask[] = [];
let visibleAppIdProvider: (() => string | null) | null = null;
let preferredAppId: string | null = null;
let mutationBatchDepth = 0;
let restartAfterMutationBatch = false;

const completedTasks = new Set<string>();
const failureCooldowns = new Map<string, FailureCooldown>();

function normalizedAppId(value: unknown): string | null {
	const appId = String(value ?? '').trim();
	return /^\d+$/.test(appId) && Number(appId) > 0 ? appId : null;
}

function currentLanguage(): string | null {
	const language = String(steamLanguageSync() || '').trim().toLowerCase();
	return /^[a-z_]+$/.test(language) ? language : null;
}

function taskKey(task: Pick<PrefetchTask, 'phase' | 'language' | 'appId'>): string {
	return `${task.phase}:${task.language}:${task.appId}`;
}

function currentVisibleAppId(): string | null {
	if (preferredAppId) return preferredAppId;
	try { return normalizedAppId(visibleAppIdProvider?.()); }
	catch { return null; }
}

function phaseRank(phase: PrefetchPhase): number {
	return phase === 'core' ? 0 : 1;
}

function sortPendingTasks(): void {
	const visible = currentVisibleAppId();
	pendingTasks.sort((left, right) => {
		const leftVisible = left.appId === visible ? 0 : 1;
		const rightVisible = right.appId === visible ? 0 : 1;
		if (leftVisible !== rightVisible) return leftVisible - rightVisible;
		const phaseDifference = phaseRank(left.phase) - phaseRank(right.phase);
		if (phaseDifference !== 0) return phaseDifference;
		return left.order - right.order;
	});
}

function mappedSteamAppIds(language?: string): string[] {
	const unique = new Set<string>();
	try {
		for (const shortcut of getMappedShortcuts()) {
			const appId = normalizedAppId(shortcut.steamAppId);
			if (appId) unique.add(appId);
		}
	} catch {}

	// Steam's app store can still be empty during the first seconds of startup.
	// Only exact shortcut mappings are safe as a fallback: title/executable
	// aliases can outlive a removed shortcut or be shared by another entry.
	if (unique.size === 0) {
		for (const [key, value] of Object.entries(mappings)) {
			if (!/^shortcut:\d+$/.test(key)) continue;
			const appId = normalizedAppId(value);
			if (appId) unique.add(appId);
		}
	}
	const all = Array.from(unique);
	const visible = currentVisibleAppId();
	const uncompleted = language
		? all.filter(appId => !completedTasks.has(`core:${language}:${appId}`) || !completedTasks.has(`news:${language}:${appId}`))
		: all;
	const candidateList = uncompleted.length > 0 ? uncompleted : all;
	if (visible && candidateList.includes(visible)) {
		return [visible, ...candidateList.filter(appId => appId !== visible)].slice(0, MAX_PREFETCH_APP_IDS);
	}
	if (visible && all.includes(visible)) {
		return [visible, ...all.filter(appId => appId !== visible)].slice(0, MAX_PREFETCH_APP_IDS);
	}
	return candidateList.slice(0, MAX_PREFETCH_APP_IDS);
}

function buildPendingTasks(language: string): void {
	const appIds = mappedSteamAppIds(language);
	pendingTasks = [];
	let order = 0;
	for (const phase of ['core', 'news'] as const) {
		for (const appId of appIds) {
			const task: PrefetchTask = { appId, language, phase, order: order++ };
			if (!completedTasks.has(taskKey(task))) pendingTasks.push(task);
		}
	}
	sortPendingTasks();
}

function clearScheduledWave(): void {
	if (!scheduledWave) return;
	clearTimeout(scheduledWave);
	scheduledWave = null;
}

function scheduleWave(delayMs: number, expectedGeneration = generation): void {
	if (!started || expectedGeneration !== generation) return;
	clearScheduledWave();
	scheduledWave = setTimeout(() => {
		scheduledWave = null;
		void launchWave(expectedGeneration);
	}, Math.max(0, delayMs));
}

function pauseDuration(phase: PrefetchPhase): number {
	const base = phase === 'core' ? CORE_PAUSE_MS : NEWS_PAUSE_MS;
	// A small deterministic jitter keeps restarts from repeatedly aligning this
	// plugin's requests with Steam's own periodic Store/community refreshes.
	return base + Math.floor(Math.random() * 250);
}

function wait(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function registerFailure(task: PrefetchTask): void {
	const key = taskKey(task);
	const previous = failureCooldowns.get(key);
	const attempts = Math.min(MAX_FAILURE_ATTEMPTS, (previous?.attempts || 0) + 1);
	const delays = [15_000, 60_000, 5 * 60_000];
	failureCooldowns.set(key, {
		attempts,
		retryAt: Date.now() + delays[Math.min(attempts - 1, delays.length - 1)],
	});
}

async function runTask(task: PrefetchTask): Promise<boolean> {
	if (task.phase === 'core') {
		const cachedData = getCachedGameData(task.appId, task.language);
		const cachedAssets = getCachedLibraryAssets(task.appId, task.language);
		if (cachedData?.fresh && cachedAssets?.fresh) {
			return true;
		}
		const data = await getGameData(task.appId, task.language);
		const assets = await getModernLibraryAssets(task.appId, task.language);
		return data !== null && assets !== null
			&& getCachedGameData(task.appId, task.language)?.fresh === true
			&& getCachedLibraryAssets(task.appId, task.language)?.fresh === true;
	}

	// Feed prefetch: load news and community content concurrently
	await Promise.allSettled([
		getNews(task.appId, task.language),
		getCommunityContent(task.appId, task.language),
	]);
	return true;
}

function scheduleFailureRetry(expectedGeneration: number): void {
	if (!started || expectedGeneration !== generation) return;
	let earliest = Number.POSITIVE_INFINITY;
	for (const failure of failureCooldowns.values()) {
		earliest = Math.min(earliest, failure.retryAt);
	}
	if (Number.isFinite(earliest)) {
		scheduleWave(Math.max(500, earliest - Date.now()), expectedGeneration);
	}
}

async function runWorker(expectedGeneration: number, language: string): Promise<void> {
	while (started && expectedGeneration === generation) {
		if (currentLanguage() !== language) {
			restartLinkedGamePrefetch();
			return;
		}

		sortPendingTasks();
		const task = pendingTasks.shift();
		if (!task) break;
		const key = taskKey(task);
		if (completedTasks.has(key)) continue;

		const cooldown = failureCooldowns.get(key);
		if (cooldown && cooldown.retryAt > Date.now()) {
			continue;
		}

		const wasCached = task.phase === 'core'
			&& getCachedGameData(task.appId, task.language)?.fresh === true
			&& getCachedLibraryAssets(task.appId, task.language)?.fresh === true;
		let succeeded = false;
		try { succeeded = await runTask(task); }
		catch (error) {
			backendLog(`Background prefetch failed for ${task.phase} ${task.appId}: ${String(error)}`);
		}

		// A request that was already in flight may settle after a language change
		// or plugin restart. Its resource functions own their language-keyed cache,
		// but this obsolete worker must not advance the current queue.
		if (!started || expectedGeneration !== generation) return;
		if (currentLanguage() !== language) {
			restartLinkedGamePrefetch();
			return;
		}

		if (succeeded) {
			completedTasks.add(key);
			failureCooldowns.delete(key);
		} else {
			registerFailure(task);
		}

		await wait(wasCached && succeeded ? 0 : pauseDuration(task.phase));
	}

	if (started && expectedGeneration === generation) {
		buildPendingTasks(language);
		if (pendingTasks.length > 0) {
			scheduleWave(CORE_PAUSE_MS, expectedGeneration);
			return;
		}
		scheduleFailureRetry(expectedGeneration);
	}
}

async function launchWave(expectedGeneration: number): Promise<void> {
	// Millennium callables cannot be aborted. Wait for an obsolete worker to
	// settle before starting the replacement so background concurrency stays at
	// exactly one even across language or mapping restarts.
	if (activeWorker) {
		try { await activeWorker; } catch {}
	}
	if (!started || expectedGeneration !== generation) return;

	const language = currentLanguage();
	if (!language) {
		scheduleWave(LANGUAGE_RETRY_MS, expectedGeneration);
		return;
	}

	buildPendingTasks(language);
	if (pendingTasks.length === 0) {
		scheduleFailureRetry(expectedGeneration);
		return;
	}

	let worker!: Promise<void>;
	worker = runWorker(expectedGeneration, language).finally(() => {
		if (activeWorker === worker) activeWorker = null;
	});
	activeWorker = worker;
	await worker;
}

/** Start one read-only background warm-up pass for all currently linked games. */
export function startLinkedGamePrefetch(getVisibleAppId?: () => string | null): void {
	if (getVisibleAppId) visibleAppIdProvider = getVisibleAppId;
	if (started) {
		sortPendingTasks();
		return;
	}
	started = true;
	generation += 1;
	completedTasks.clear();
	failureCooldowns.clear();
	pendingTasks = [];
	if (mutationBatchDepth > 0) { restartAfterMutationBatch = true; return; }
	scheduleWave(START_DELAY_MS, generation);
}

/** Promote the visible game within its current phase without starting I/O. */
export function reprioritizeLinkedGame(appId: string): void {
	preferredAppId = normalizedAppId(appId);
	if (!preferredAppId) return;
	const language = currentLanguage();
	if (language) {
		for (const phase of ['core', 'news'] as const) {
			const task: PrefetchTask = { appId: preferredAppId, language, phase, order: -1 };
			const key = taskKey(task);
			if (!completedTasks.has(key) && !pendingTasks.some(t => taskKey(t) === key)) {
				pendingTasks.unshift(task);
			}
		}
	}
	if (pendingTasks.length > 1) sortPendingTasks();
}

/** Rebuild targets after mappings or the Steam language changes. */
export function restartLinkedGamePrefetch(appIds?: Iterable<string | number>): void {
	if (!started) return;
	if (appIds) {
		const ids = new Set(Array.from(appIds, value => String(value)).filter(Boolean));
		for (const key of Array.from(completedTasks)) {
			if (ids.has(key.split(':').pop() || '')) completedTasks.delete(key);
		}
		for (const key of Array.from(failureCooldowns.keys())) {
			if (ids.has(key.split(':').pop() || '')) failureCooldowns.delete(key);
		}
	} else {
		completedTasks.clear();
		failureCooldowns.clear();
	}
	generation += 1;
	pendingTasks = [];
	clearScheduledWave();
	if (mutationBatchDepth > 0) { restartAfterMutationBatch = true; return; }
	scheduleWave(START_DELAY_MS, generation);
}

/** Keep mass link/unlink network work from competing with background warm-up. */
export function pauseLinkedGamePrefetch(): void {
	mutationBatchDepth += 1;
	if (!started || mutationBatchDepth > 1) return;
	generation += 1;
	pendingTasks = [];
	clearScheduledWave();
}

export function resumeLinkedGamePrefetch(): void {
	mutationBatchDepth = Math.max(0, mutationBatchDepth - 1);
	if (mutationBatchDepth > 0 || !started) return;
	const needsRestart = restartAfterMutationBatch;
	restartAfterMutationBatch = false;
	if (needsRestart || pendingTasks.length === 0) scheduleWave(START_DELAY_MS, generation);
}

/** Stop timers and make every obsolete completion inert. */
export function disposeLinkedGamePrefetch(): void {
	started = false;
	generation += 1;
	clearScheduledWave();
	pendingTasks = [];
	visibleAppIdProvider = null;
	preferredAppId = null;
	completedTasks.clear();
	failureCooldowns.clear();
	mutationBatchDepth = 0;
	restartAfterMutationBatch = false;
}
