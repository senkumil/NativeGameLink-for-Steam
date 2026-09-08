import type { ShortcutLinkResult } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { linkShortcutToSteam } from './linking';
import { shortcutRuntimeHost } from './host';
import { findMappingForShortcut } from './registry';
import { getFactoryResetEpoch, isFactoryEpochCurrent, isFactoryResetInProgress } from './transaction';

const STORAGE_KEY = 'gdl-pending-link-jobs-v1';
export const PENDING_LINK_JOBS_CHANGED_EVENT = 'gdl:pending-link-jobs-changed';
// The foreground link is deliberately bounded; retry the remaining assets soon
// after a slow Steam/HTTP operation settles instead of leaving the user waiting
// fifteen seconds before the first reconciliation attempt.
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 5 * 60_000;
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let processing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let processingPauseDepth = 0;

export interface PendingLinkJob {
	id: string;
	title: string;
	shortcutAppId: number | null;
	steamAppId: string;
	skipLauncher: boolean;
	existingLaunchOptions: string;
	trackingExecutable: string;
	trackingStartDir: string;
	shortcutExecutable: string;
	repairResources?: boolean;
	attempts: number;
	status: 'staged' | 'queued' | 'running' | 'failed';
	sessionId?: string;
	createdAt: number;
	lastError?: string;
	nextAttemptAt?: number;
}

function storage(): Storage | null {
	try {
		return shortcutRuntimeHost().getMainWindowDoc()?.defaultView?.localStorage
			|| (typeof localStorage !== 'undefined' ? localStorage : null);
	} catch { return null; }
}

function readJobs(): PendingLinkJob[] {
	try {
		const value = storage()?.getItem(STORAGE_KEY);
		const parsed = value ? JSON.parse(value) : [];
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((job): job is PendingLinkJob => job && /^\d+$/.test(String(job.steamAppId || '')) && typeof job.title === 'string')
			.map(job => {
				const sameSessionStage = job.status === 'staged' && job.sessionId === SESSION_ID;
				return {
					...job,
					shortcutExecutable: String(job.shortcutExecutable || ''),
					repairResources: Boolean(job.repairResources),
					// A staged foreground intent is inert only in the session that created it.
					// If Steam/CEF was terminated, a new session promotes it to queued so the
					// interrupted link can resume automatically.
					status: job.status === 'failed' ? 'failed' : (sameSessionStage ? 'staged' : 'queued'),
					attempts: Number(job.attempts) || 0,
					nextAttemptAt: Number(job.nextAttemptAt) || 0,
				};
			});
	} catch { return []; }
}

function writeJobs(jobs: PendingLinkJob[]): void {
	try {
		storage()?.setItem(STORAGE_KEY, JSON.stringify(jobs));
		window.dispatchEvent(new CustomEvent(PENDING_LINK_JOBS_CHANGED_EVENT));
	}
	catch (error) { backendLog('Could not persist background link queue: ' + String(error)); }
}

function normalizedExecutable(value: unknown): string {
	return String(value || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLocaleLowerCase();
}

/** Match one physical shortcut without conflating duplicate game titles. The
 * executable identity bridges Steam's temporary AppID regeneration window. */
function sameLogicalShortcut(left: Pick<PendingLinkJob, 'shortcutAppId' | 'shortcutExecutable' | 'title'>,
	right: Pick<PendingLinkJob, 'shortcutAppId' | 'shortcutExecutable' | 'title'>): boolean {
	const leftId = Number(left.shortcutAppId || 0);
	const rightId = Number(right.shortcutAppId || 0);
	const leftHasId = Number.isFinite(leftId) && leftId >= 2147483648;
	const rightHasId = Number.isFinite(rightId) && rightId >= 2147483648;
	if (leftHasId && rightHasId) return leftId === rightId;
	const leftExe = normalizedExecutable(left.shortcutExecutable);
	const rightExe = normalizedExecutable(right.shortcutExecutable);
	if (leftExe && rightExe) return leftExe === rightExe;
	if (leftExe || rightExe) return false;
	return String(left.title || '').trim().toLocaleLowerCase() === String(right.title || '').trim().toLocaleLowerCase();
}

/** Wake the durable queue at the earliest backoff deadline. Persisting a job
 * alone is insufficient: without this timer retries only happened after a
 * plugin reload or another unrelated user action. */
function scheduleNextRetry(jobs = readJobs()): void {
	if (retryTimer) clearTimeout(retryTimer);
	retryTimer = null;
	if (processingPauseDepth > 0) return;
	const now = Date.now();
	const next = jobs
		.filter(job => job.status === 'queued')
		.map(job => Math.max(now, Number(job.nextAttemptAt) || 0))
		.sort((a, b) => a - b)[0];
	if (!Number.isFinite(next)) return;
	retryTimer = setTimeout(() => {
		retryTimer = null;
		void processPendingLinkJobs(shortcutRuntimeHost().getMainWindowDoc());
	}, Math.max(50, next - now));
}

/** Keep durable repairs from competing with a bulk Steam bridge transaction. */
export async function pausePendingLinkJobs(waitBudgetMs = 1800): Promise<void> {
	processingPauseDepth += 1;
	scheduleNextRetry();
	const active = processing;
	if (!active) return;

	// Never let Settings/Factory Reset hang behind a network or Steam bridge
	// operation that started before the pause barrier. The reset epoch already
	// makes that work stale; after this short grace period it is safe for the
	// caller to continue while the old promise unwinds in the background.
	let settled = false;
	await Promise.race([
		active.catch(() => {}).then(() => { settled = true; }),
		new Promise<void>(resolve => setTimeout(resolve, Math.max(100, waitBudgetMs))),
	]);
	if (!settled) backendLog(`[NGL][Retry] Pause barrier timed out after ${waitBudgetMs}ms; stale queue work will finish in background.`);
}

export function resumePendingLinkJobs(): void {
	processingPauseDepth = Math.max(0, processingPauseDepth - 1);
	if (processingPauseDepth > 0) return;
	scheduleNextRetry();
	void processPendingLinkJobs(shortcutRuntimeHost().getMainWindowDoc());
}

/** Persist first, then notify the long-lived desktop runtime to process it. */
export function enqueueLinkJob(input: Omit<PendingLinkJob, 'id' | 'attempts' | 'status' | 'createdAt'>): PendingLinkJob {
	let jobs = readJobs();
	const id = `${input.shortcutAppId || input.title}|${input.steamAppId}`;
	// A newer AppID choice supersedes every queued repair for this same physical
	// shortcut. Otherwise an old repair can silently relink the previous game
	// after the user has already saved the new target.
	const obsoleteIds = new Set(jobs
		.filter(job => job.steamAppId !== input.steamAppId && sameLogicalShortcut(job, input))
		.map(job => job.id));
	if (obsoleteIds.size > 0) jobs = jobs.filter(job => !obsoleteIds.has(job.id));
	const existing = jobs.find(job => job.id === id
		|| (job.steamAppId === input.steamAppId && sameLogicalShortcut(job, input)));
	if (existing) {
		if (existing.status !== 'failed') {
			const upgradeRepair = Boolean(input.repairResources && !existing.repairResources);
			Object.assign(existing, input, {
				repairResources: Boolean(existing.repairResources || input.repairResources),
				status: 'queued' as const,
				sessionId: undefined,
			});
			if (upgradeRepair || existing.nextAttemptAt) existing.nextAttemptAt = 0;
			writeJobs(jobs);
			scheduleNextRetry(jobs);
			try { shortcutRuntimeHost().runPendingLinkJobs?.(); } catch {}
			return existing;
		}
		// Explicitly pressing Save again is a new attempt. Re-arm the existing
		// logical job instead of leaving a permanent failed record with the same
		// identity in localStorage.
		Object.assign(existing, input, { attempts: 0, status: 'queued' as const, createdAt: Date.now(), nextAttemptAt: 0 });
		delete existing.lastError;
		writeJobs(jobs);
		scheduleNextRetry(jobs);
		try { shortcutRuntimeHost().runPendingLinkJobs?.(); } catch {}
		return existing;
	}
	const job: PendingLinkJob = {
		...input,
		id,
		attempts: 0,
		status: 'queued',
		createdAt: Date.now(),
		nextAttemptAt: 0,
	};
	jobs.push(job);
	writeJobs(jobs);
	scheduleNextRetry(jobs);
	try { shortcutRuntimeHost().runPendingLinkJobs?.(); } catch {}
	return job;
}

/** Persist the user's link decision before the foreground transaction starts.
 * The staged job never competes with the active transaction in this session,
 * but after a Steam/CEF restart it is promoted to queued by readJobs(). */
export function stageLinkJobForRecovery(input: Omit<PendingLinkJob, 'id' | 'attempts' | 'status' | 'createdAt' | 'sessionId'>): PendingLinkJob {
	let jobs = readJobs().filter(job => !(job.steamAppId !== input.steamAppId && sameLogicalShortcut(job, input)));
	const id = `${input.shortcutAppId || input.title}|${input.steamAppId}`;
	let job = jobs.find(candidate => candidate.id === id
		|| (candidate.steamAppId === input.steamAppId && sameLogicalShortcut(candidate, input)));
	if (job) {
		Object.assign(job, input, { attempts: 0, status: 'staged' as const, createdAt: Date.now(), nextAttemptAt: 0, sessionId: SESSION_ID });
		delete job.lastError;
	} else {
		job = { ...input, id, attempts: 0, status: 'staged', createdAt: Date.now(), nextAttemptAt: 0, sessionId: SESSION_ID };
		jobs.push(job);
	}
	writeJobs(jobs);
	return job;
}

/** Read a durable job so an open confirmation dialog can show the result of
 * its background retry instead of remaining on a stale queued message. */
export function getPendingLinkJob(id: string): PendingLinkJob | null {
	return readJobs().find(job => job.id === id) || null;
}

function matchesRequestedShortcut(job: PendingLinkJob, shortcutAppId: number | null | undefined, title: string): boolean {
	if (shortcutAppId != null && job.shortcutAppId != null) return job.shortcutAppId === shortcutAppId;
	return Boolean(title && job.title.trim().toLowerCase() === title.trim().toLowerCase());
}

/** A user who pressed Link has already made a decision; the detector must not
 * reopen its confirmation modal while that work is queued or retried. */
export function hasPendingLinkJob(shortcutAppId: number | null | undefined, title = ''): boolean {
	return readJobs().some(job => job.status !== 'failed'
		&& matchesRequestedShortcut(job, shortcutAppId, title));
}

/** Fast-track a specific shortcut job to the front of the background link queue. */
export function prioritizePendingLinkJob(shortcutAppId: number | null | undefined, title = ''): boolean {
	const jobs = readJobs();
	const targetIndex = jobs.findIndex(job =>
		job.status !== 'failed'
		&& matchesRequestedShortcut(job, shortcutAppId, title));
	if (targetIndex < 0) return false;
	const [job] = jobs.splice(targetIndex, 1);
	job.nextAttemptAt = 0;
	jobs.unshift(job);
	writeJobs(jobs);
	scheduleNextRetry(jobs);
	void processPendingLinkJobs(shortcutRuntimeHost().getMainWindowDoc());
	return true;
}

/** Cancel durable link work for a shortcut before an explicit unlink. */
export function cancelPendingLinkJobs(shortcutAppId?: number | null, title = ''): number {
	const jobs = readJobs();
	const kept = jobs.filter(job => !matchesRequestedShortcut(job, shortcutAppId, title));
	const removed = jobs.length - kept.length;
	if (removed > 0) { writeJobs(kept); scheduleNextRetry(kept); }
	return removed;
}

/** Cancel every queued/retrying bulk link operation. */
export function cancelAllPendingLinkJobs(): number {
	const jobs = readJobs();
	if (jobs.length > 0) { writeJobs([]); scheduleNextRetry([]); }
	return jobs.length;
}

export async function processPendingLinkJobs(targetDoc?: Document | null): Promise<void> {
	const epoch = getFactoryResetEpoch();
	if (processingPauseDepth > 0 || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) return;
	if (processing) return processing;
	processing = (async () => {
		let jobs = readJobs();
		for (const snapshot of jobs) {
			// A preceding asynchronous attempt may have cancelled/replaced later jobs.
			jobs = readJobs();
			const job = jobs.find(candidate => candidate.id === snapshot.id);
			if (!job) continue;
			if (job.status === 'staged') continue;
			if (processingPauseDepth > 0 || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) {
				backendLog('[NGL][Retry] Halting queue processing due to pause or reset barrier');
				break;
			}
			if (job.status === 'failed') continue;

			// If not repairing resources, a committed mapping means the job is satisfied
			if (!job.repairResources && findMappingForShortcut(job.shortcutAppId, job.title, job.shortcutExecutable) === job.steamAppId) {
				jobs = jobs.filter(candidate => candidate.id !== job.id);
				writeJobs(jobs);
				continue;
			}

			if ((job.nextAttemptAt || 0) > Date.now()) continue;
			job.status = 'running';
			writeJobs(jobs);
			let result: ShortcutLinkResult | null = null;
			try {
				result = await linkShortcutToSteam({
					doc: targetDoc || shortcutRuntimeHost().getMainWindowDoc(),
					title: job.title, shortcutAppId: job.shortcutAppId, steamAppId: job.steamAppId,
					skipLauncher: job.skipLauncher, existingLaunchOptions: job.existingLaunchOptions,
					trackingExecutable: job.trackingExecutable, trackingStartDir: job.trackingStartDir,
					shortcutExecutable: job.shortcutExecutable,
					repairResources: Boolean(job.repairResources),
					assetTimeoutMs: 30_000,
					onStatus: message => backendLog(`[NGL][Retry] ${job.steamAppId}: ${message}`),
				});
			} catch (error) {
				result = { ok: false, error: String(error) };
			}

			if (!isFactoryEpochCurrent(epoch) || isFactoryResetInProgress()) {
				backendLog('[NGL][Retry] Reset occurred during link attempt; discarding result');
				break;
			}

			jobs = readJobs();
			const current = jobs.find(candidate => candidate.id === job.id);
			if (!current || current.status === 'staged' || current.createdAt !== job.createdAt) continue;
			if (result?.shortcutAppId && result.shortcutAppId !== current.shortcutAppId) {
				current.shortcutAppId = result.shortcutAppId;
			}
			const resourcesComplete = Boolean(result?.setup?.artworkComplete && result?.setup?.iconApplied);
			const isMapped = findMappingForShortcut(current.shortcutAppId, current.title, current.shortcutExecutable) === current.steamAppId;

			// When repairResources is true, never retire before resources are verified complete
			const success = current.repairResources
				? (isMapped && resourcesComplete)
				: (result?.ok || isMapped);

			if (success) {
				jobs = jobs.filter(candidate => candidate.id !== job.id);
				writeJobs(jobs);
				backendLog(`[NGL][Retry] Successfully settled job for ${current.title} (${current.steamAppId})`);
				continue;
			}

			current.attempts += 1;
			current.lastError = String(result?.error || (isMapped && !resourcesComplete ? 'resource_sync_incomplete' : 'link_failed')).replace(/^Error:\s*/, '');
			const isTerminalError = new Set(['invalid_appid', 'refusing_to_modify_native_steam_app', 'shortcut_not_found', 'shortcut_identity_ambiguous']).has(current.lastError);
			const hardFailure = current.attempts >= 5 || isTerminalError;
			if (hardFailure) {
				current.status = 'failed';
				current.nextAttemptAt = 0;
				backendLog(`[NGL][Retry] Job permanently failed after ${current.attempts} attempts: ${current.title} (${current.lastError})`);
			} else {
				// Transient network or Steam client delay: allow up to 5 retries with capped backoff
				current.status = 'queued';
				const exponent = Math.min(Math.max(0, current.attempts - 1), 5);
				current.nextAttemptAt = Date.now() + Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** exponent));
				backendLog(`[NGL][Retry] Queued retry attempt ${current.attempts + 1} in ${Math.round((current.nextAttemptAt - Date.now()) / 1000)}s for ${current.title}`);
			}
			writeJobs(jobs);
		}
	})().finally(() => { processing = null; scheduleNextRetry(); });
	return processing;
}
