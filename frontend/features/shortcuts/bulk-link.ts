import type { ShortcutDetectionCandidate, ShortcutDetectionContext } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { shortcutRuntimeHost } from './host';
import { buildShortcutDetectionContext, detectShortcutCandidates, detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote } from './detection';
import { mergeCandidateLists } from './candidate-merger';
import { evaluateBulkCandidate } from './bulk-policy';
import { cancelPendingLinkJobs, enqueueLinkJob, pausePendingLinkJobs, resumePendingLinkJobs, stageLinkJobForRecovery } from './link-job-queue';
import { linkShortcutToSteam, warmShortcutLinkResources } from './linking';
import { undismissShortcut } from './dismissed';
import { rememberedShortcutSteamAppId } from './link-history';
import { findMappingForDuplicateShortcut, getAllShortcutRecords, shortcutAlreadyLinked } from './registry';
import { pauseLinkedGamePrefetch, resumeLinkedGamePrefetch } from '../library/prefetch';
import { applyOfficialShortcutIcon, spoofArtwork } from '../library/artwork';
import { syncMissingArtworkForMappedShortcuts } from '../library/artwork-sync';
import { runDurableReconciliation } from './reconciler';
import { isPriorityShortcut } from './link-job-priority';
import { getFactoryResetEpoch, isFactoryEpochCurrent, isFactoryResetInProgress, readShortcutManifest } from './transaction';
import { saveShortcutEdition } from './editions';
export { setPriorityShortcut as prioritizeBulkLinkShortcut } from './link-job-priority';

const BULK_ANALYSIS_CONCURRENCY = 2;
const BULK_REVIEW_CONCURRENCY = 1;
export type BulkLinkOutcomeStatus =
	| 'READY'
	| 'READY_DEGRADED'
	| 'RETRY_PENDING'
	| 'SKIPPED'
	| 'FAILED'
	| 'linked'
	| 'queued'
	| 'skipped'
	| 'failed';
export interface BulkLinkGameOutcome {
	title: string;
	shortcutAppId: number;
	steamAppId?: string;
	status: BulkLinkOutcomeStatus;
	reason?: string;
	resourceRepairQueued?: boolean;
}
export interface BulkLinkAllResult {
	total: number;
	matched: number;
	linked: number;
	queued: number;
	skipped: number;
	failed: number;
	outcomes: BulkLinkGameOutcome[];
}
export type BulkLinkProgressPhase = 'analyzing' | 'linking' | 'resources';

function evaluateReliableBulkCandidate(
	context: ShortcutDetectionContext,
	candidates: ShortcutDetectionCandidate[],
	rememberedAppId = '',
): ReturnType<typeof evaluateBulkCandidate> {
	const evalResult = evaluateBulkCandidate(context, candidates, rememberedAppId);
	if (evalResult.safe && evalResult.candidate) {
		backendLog(`[NGL][Detection] Bulk decision for "${context.title}": SAFE -> AppID ${evalResult.candidate.appid} (${evalResult.reason})`);
	} else {
		backendLog(`[NGL][Detection] Bulk decision for "${context.title}": REVIEW (${evalResult.reason})`);
	}
	return evalResult;
}

function enqueueBulkRetry(
	item: { record: { id: number; title: string }; context: ShortcutDetectionContext; candidate: ShortcutDetectionCandidate },
	repairResources: boolean,
	shortcutAppId = item.record.id,
): void {
	enqueueLinkJob({
		title: item.context.title,
		shortcutAppId,
		steamAppId: item.candidate.appid,
		skipLauncher: false,
		existingLaunchOptions: item.context.launchOptions || '',
		trackingExecutable: item.context.trackingExecutableAutoApply && item.context.recommendedExePath ? item.context.recommendedExePath : '',
		trackingStartDir: item.context.trackingExecutableAutoApply && item.context.recommendedStartDir ? item.context.recommendedStartDir : '',
		shortcutExecutable: item.context.exePath || '',
		repairResources,
	});
}

export async function linkAllShortcutsExperimental(
	onProgress?: (done: number, total: number, title: string, phase: BulkLinkProgressPhase) => void,
	signal?: AbortSignal,
): Promise<BulkLinkAllResult> {
	pauseLinkedGamePrefetch();
	await pausePendingLinkJobs();
	try {
		const epoch = getFactoryResetEpoch();
		const records = getAllShortcutRecords().filter(record => !shortcutAlreadyLinked(record.id));
		const result: BulkLinkAllResult = {
			total: records.length,
			matched: 0,
			linked: 0,
			queued: 0,
			skipped: 0,
			failed: 0,
			outcomes: [],
		};
		if (!records.length || signal?.aborted || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) return result;

		type Item = {
			record: { id: number; title: string };
			context: ShortcutDetectionContext;
			candidate: ShortcutDetectionCandidate;
			index: number;
		};
		let analyzed = 0;
		let nextRecord = 0;
		const matchedItems: Item[] = [];
		type ReviewItem = {
			record: { id: number; title: string };
			context: ShortcutDetectionContext;
			index: number;
			reason: string;
		};
		const reviewItems: ReviewItem[] = [];

		// Stage 1: Concurrent discovery. Keep concurrency deliberately below the
		// backend's remote AppInfo/store budget so a bulk pass sees the same
		// evidence that the single-game manual modal receives.
		const analyzeRecord = async (record: { id: number; title: string }, index: number): Promise<void> => {
			if (signal?.aborted || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) return;
			let context: ShortcutDetectionContext | null = null;
			let candidate: ShortcutDetectionCandidate | null = null;
			let reason = 'no_candidates';
			try {
				context = await buildShortcutDetectionContext(null, record.title, record.id);
				if (!context) {
					reason = 'context_unavailable';
				} else {
					const duplicateAppId = findMappingForDuplicateShortcut(record.id);
					if (duplicateAppId) {
						candidate = {
							appid: duplicateAppId,
							name: context.title,
							image: '',
							score: 100,
							confidence: 'exact',
							reasons: ['duplicate_launch_identity'],
							executable_match: true,
							direct: true,
						};
					} else {
						for (let attempt = 0; attempt < 3 && !signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch); attempt += 1) {
							const detected = await detectShortcutCandidates(context);
							const decision = evaluateReliableBulkCandidate(context, detected?.candidates || [], rememberedShortcutSteamAppId(record.id));
							candidate = decision.safe ? decision.candidate : null;
							reason = decision.reason;
							if (candidate || (detected && detected.transient_error !== true)) break;
							if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
						}
					}
				}
			} catch (error) {
				reason = 'detection_failed';
				backendLog(`[NGL][Bulk] Detection failed for ${record.title}: ${error}`);
			} finally {
				analyzed += 1;
				if (!signal?.aborted) onProgress?.(analyzed, records.length, record.title, 'analyzing');
			}

			if (signal?.aborted || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) return;
			if (context && candidate) {
				result.matched += 1;
				matchedItems.push({ record, context, candidate, index });
			} else if (context && reason !== 'detection_failed' && reason !== 'context_unavailable') {
				// Do not finalize a policy skip from the highly-concurrent pass. The
				// manual modal often succeeds moments later because AppInfo/store
				// validation runs alone. Give these records one fresh low-concurrency
				// validation pass before declaring them ambiguous.
				reviewItems.push({ record, context, index, reason });
			} else {
				const status: BulkLinkOutcomeStatus = reason === 'detection_failed' ? 'FAILED' : 'SKIPPED';
				if (status === 'FAILED') result.failed += 1;
				else result.skipped += 1;
				result.outcomes.push({ title: record.title, shortcutAppId: record.id, status, reason });
			}
		};

		const workers = Array.from({ length: Math.min(BULK_ANALYSIS_CONCURRENCY, records.length) }, async () => {
			while (!signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch)) {
				const index = nextRecord++;
				const record = records[index];
				if (!record) return;
				await analyzeRecord(record, index);
			}
		});
		await Promise.all(workers);

		// Stage 1.5: Fresh low-concurrency review for first-pass skips. This avoids
		// false negatives caused by remote validation saturation/cache snapshots
		// while preserving the exact same conservative bulk policy.
		let nextReview = 0;
		const unresolvedAfterReview: ReviewItem[] = [];
		const reviewWorkers = Array.from({ length: Math.min(BULK_REVIEW_CONCURRENCY, reviewItems.length) }, async () => {
			while (!signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch)) {
				const item = reviewItems[nextReview++];
				if (!item) return;
				let decisionReason = item.reason;
				let accepted: ShortcutDetectionCandidate | null = null;
				try {
					const local = await detectShortcutCandidatesLocal(item.context);
					let remote = await enrichShortcutCandidatesRemote(item.context, local?.candidates || [], signal, true);
					if ((!remote || remote.transient_error === true) && !signal?.aborted) {
						await new Promise(resolve => setTimeout(resolve, 350));
						remote = await enrichShortcutCandidatesRemote(item.context, local?.candidates || [], signal, true);
					}
					const candidates = mergeCandidateLists(local?.candidates || [], remote?.candidates || []);
					const decision = evaluateReliableBulkCandidate(item.context, candidates, rememberedShortcutSteamAppId(item.record.id));
					decisionReason = decision.reason;
					accepted = decision.safe ? decision.candidate : null;
				} catch (error) {
					decisionReason = 'detection_failed';
					backendLog(`[NGL][Bulk] Review validation failed for ${item.record.title}: ${error}`);
				}

				if (accepted) {
					result.matched += 1;
					matchedItems.push({ record: item.record, context: item.context, candidate: accepted, index: item.index });
					backendLog(`[NGL][Bulk] Second-pass recovery accepted ${item.record.title} -> ${accepted.appid}`);
				} else {
					unresolvedAfterReview.push({ ...item, reason: decisionReason });
				}
			}
		});
		await Promise.all(reviewWorkers);

		// Stage 1.75: final SERIAL rescue. Factory-reset/bulk reliability matters
		// more than raw analysis speed. Every unresolved title gets isolated Store
		// enrichment with larger recovery budgets before we finally ask for manual
		// review. This removes the false negatives seen when manual linking works
		// immediately after Bulk has skipped the same shortcut.
		for (const item of unresolvedAfterReview.sort((a, b) => a.index - b.index)) {
			if (signal?.aborted || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) break;
			let decisionReason = item.reason;
			let accepted: ShortcutDetectionCandidate | null = null;
			for (let attempt = 0; attempt < 3 && !accepted; attempt += 1) {
				try {
					const local = await detectShortcutCandidatesLocal(item.context);
					const remote = await enrichShortcutCandidatesRemote(item.context, local?.candidates || [], signal, true);
					const candidates = mergeCandidateLists(local?.candidates || [], remote?.candidates || []);
					const decision = evaluateReliableBulkCandidate(item.context, candidates, rememberedShortcutSteamAppId(item.record.id));
					decisionReason = decision.reason;
					accepted = decision.safe ? decision.candidate : null;
				} catch (error) {
					decisionReason = 'detection_failed';
					backendLog(`[NGL][Bulk] Serial rescue ${attempt + 1}/3 failed for ${item.record.title}: ${error}`);
				}
				if (!accepted && attempt < 2) await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));
			}

			if (accepted) {
				result.matched += 1;
				matchedItems.push({ record: item.record, context: item.context, candidate: accepted, index: item.index });
				backendLog(`[NGL][Bulk] Serial rescue accepted ${item.record.title} -> ${accepted.appid}`);
			} else {
				const status: BulkLinkOutcomeStatus = decisionReason === 'detection_failed' ? 'FAILED' : 'SKIPPED';
				if (status === 'FAILED') result.failed += 1;
				else result.skipped += 1;
				result.outcomes.push({ title: item.record.title, shortcutAppId: item.record.id, status, reason: decisionReason });
			}
		}

		matchedItems.sort((left, right) => {
			const isLeftPriority = isPriorityShortcut(left.record.id, left.record.title) || isPriorityShortcut(Number(left.candidate.appid));
			const isRightPriority = isPriorityShortcut(right.record.id, right.record.title) || isPriorityShortcut(Number(right.candidate.appid));
			if (isLeftPriority && !isRightPriority) return -1;
			if (!isLeftPriority && isRightPriority) return 1;
			return left.index - right.index;
		});

		// Stage 2: Transactional identity commit across all matched shortcuts
		interface SuccessfullyLinkedItem {
			sid: number;
			steamAppId: string;
			title: string;
			recordId: number;
			item: Item;
		}
		const successfullyLinked: SuccessfullyLinkedItem[] = [];
		const remainingToLink = [...matchedItems];
		let linkedCount = 0;

		while (remainingToLink.length > 0 && !signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch)) {
			const priorityIdx = remainingToLink.findIndex(item =>
				isPriorityShortcut(item.record.id, item.record.title) || isPriorityShortcut(Number(item.candidate.appid)));
			const item = priorityIdx >= 0 ? remainingToLink.splice(priorityIdx, 1)[0] : remainingToLink.shift()!;

			onProgress?.(linkedCount, result.matched, item.record.title, 'linking');
			cancelPendingLinkJobs(item.record.id, item.context.title);
			undismissShortcut(item.record.id);
			// Persist the chosen bulk target before the identity mutation. If Steam
			// exits during this exact window, the next CEF session promotes the
			// staged intent into the normal durable retry queue.
			stageLinkJobForRecovery({
				title: item.context.title,
				shortcutAppId: item.record.id,
				steamAppId: item.candidate.appid,
				skipLauncher: false,
				existingLaunchOptions: item.context.launchOptions || '',
				trackingExecutable: item.context.trackingExecutableAutoApply && item.context.recommendedExePath ? item.context.recommendedExePath : '',
				trackingStartDir: item.context.trackingExecutableAutoApply && item.context.recommendedStartDir ? item.context.recommendedStartDir : '',
				shortcutExecutable: item.context.exePath || '',
				repairResources: false,
			});

			try {
				if (item.candidate.is_edition) {
					saveShortcutEdition(item.record.id, {
						edition: item.candidate.edition || '',
						name: item.candidate.name,
						appId: item.candidate.appid,
						assets: item.candidate.edition_assets,
						bundleId: item.candidate.bundle_id,
					});
				}
				const linked = await linkShortcutToSteam({
					doc: null,
					title: item.context.title,
					shortcutAppId: item.record.id,
					steamAppId: item.candidate.appid,
					shortcutExecutable: item.context.exePath,
					trackingExecutable: item.context.trackingExecutableAutoApply && item.context.recommendedExePath ? item.context.recommendedExePath : '',
					trackingStartDir: item.context.trackingExecutableAutoApply && item.context.recommendedStartDir ? item.context.recommendedStartDir : '',
					refreshLibrary: false,
					assetTimeoutMs: 30_000,
					deferAssetSync: true,
					metadataTimeoutMs: 1_200,
					canonicalNameHint: item.candidate.name,
					onStatus: message => backendLog(`[NGL][Bulk] ${item.record.title}: ${message}`),
				});

				const resolvedShortcutId = Number(linked.shortcutAppId || item.record.id);
				if (linked.ok && item.candidate.is_edition && resolvedShortcutId && resolvedShortcutId !== item.record.id) {
					saveShortcutEdition(resolvedShortcutId, {
						edition: item.candidate.edition || '',
						name: item.candidate.name,
						appId: item.candidate.appid,
						assets: item.candidate.edition_assets,
						bundleId: item.candidate.bundle_id,
					});
				}

				if (linked.ok) {
					cancelPendingLinkJobs(item.record.id, item.context.title);
					successfullyLinked.push({
						sid: resolvedShortcutId || item.record.id,
						steamAppId: item.candidate.appid,
						title: item.candidate.name || item.record.title,
						recordId: item.record.id,
						item,
					});
				} else if (!['invalid_appid', 'refusing_to_modify_native_steam_app'].includes(String(linked.error || ''))) {
					enqueueBulkRetry(item, false, resolvedShortcutId);
					result.queued += 1;
					result.outcomes.push({
						title: item.record.title,
						shortcutAppId: resolvedShortcutId,
						steamAppId: item.candidate.appid,
						status: 'RETRY_PENDING',
						reason: String(linked.error || 'setup_incomplete'),
						resourceRepairQueued: true,
					});
				} else {
					result.failed += 1;
					cancelPendingLinkJobs(item.record.id, item.context.title);
					result.outcomes.push({
						title: item.record.title,
						shortcutAppId: item.record.id,
						steamAppId: item.candidate.appid,
						status: 'FAILED',
						reason: String(linked.error || 'link_failed'),
					});
				}
			} catch (error) {
				backendLog(`[NGL][Bulk] Identity commit failed for ${item.record.title}: ${error}`);
				enqueueBulkRetry(item, false);
				result.queued += 1;
				result.outcomes.push({
					title: item.record.title,
					shortcutAppId: item.record.id,
					steamAppId: item.candidate.appid,
					status: 'RETRY_PENDING',
					reason: 'link_failed',
					resourceRepairQueued: true,
				});
			} finally {
				linkedCount += 1;
				if (!signal?.aborted) onProgress?.(linkedCount, result.matched, item.record.title, 'linking');
			}
		}

		// Stage 3: Fast concurrent artwork and icon sync (Slot 0 Portrait applies first)
		if (successfullyLinked.length > 0 && !signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch)) {
			const BULK_ARTWORK_CONCURRENCY = 3;
			const remainingArt = [...successfullyLinked];
			let artDone = 0;
			const artWorkers = Array.from({ length: Math.min(BULK_ARTWORK_CONCURRENCY, remainingArt.length) }, async () => {
				while (!signal?.aborted && !isFactoryResetInProgress() && isFactoryEpochCurrent(epoch) && remainingArt.length > 0) {
					const priorityIdx = remainingArt.findIndex(target =>
						isPriorityShortcut(target.recordId, target.title) || isPriorityShortcut(Number(target.steamAppId)));
					const target = priorityIdx >= 0 ? remainingArt.splice(priorityIdx, 1)[0] : remainingArt.shift();
					if (!target) return;

					onProgress?.(artDone, successfullyLinked.length, target.title, 'resources');

					// Do not let icon work compete with Hero/Logo/Portrait during the first
					// visible paint. Critical artwork gets the worker/network budget first.
					await Promise.race([
						spoofArtwork(target.sid, target.steamAppId, target.title, false)
							.catch(error => backendLog(`[NGL][Bulk] Artwork failed for ${target.sid}: ${error}`)),
						new Promise(resolve => setTimeout(resolve, 15_000)),
					]);
					await Promise.race([
						applyOfficialShortcutIcon(target.sid, target.steamAppId, false)
							.catch(error => backendLog(`[NGL][Bulk] Icon failed for ${target.sid}: ${error}`)),
						new Promise(resolve => setTimeout(resolve, 5_000)),
					]);

					artDone += 1;
					if (!signal?.aborted) {
						onProgress?.(artDone, successfullyLinked.length, target.title, 'resources');
					}
				}
			});
			await Promise.all(artWorkers);
		}

		// Stage 3.5: Accurately resolve outcomes for all successfully linked items
		for (const target of successfullyLinked) {
			const manifest = readShortcutManifest(target.sid, target.steamAppId);
			const portraitReady = manifest?.portrait.status === 'READY';
			const heroReady = manifest?.hero.status === 'READY';
			const logoReady = manifest?.logo.status === 'READY';
			const wideReady = manifest?.wide.status === 'READY';
			const iconReady = manifest?.icon.status === 'READY';

			const allReady = portraitReady && heroReady && logoReady && wideReady && iconReady;

			if (allReady) {
				result.linked += 1;
				result.outcomes.push({
					title: target.title,
					shortcutAppId: target.sid,
					steamAppId: target.steamAppId,
					status: 'READY',
					resourceRepairQueued: false,
				});
			} else if (portraitReady) {
				const hasPendingOrFailed =
					manifest?.hero.status === 'PENDING' || manifest?.hero.status === 'FAILED' ||
					manifest?.wide.status === 'PENDING' || manifest?.wide.status === 'FAILED' ||
					manifest?.icon.status === 'PENDING' || manifest?.icon.status === 'FAILED';

				if (hasPendingOrFailed) {
					enqueueBulkRetry(target.item, true, target.sid);
					result.queued += 1;
					result.outcomes.push({
						title: target.title,
						shortcutAppId: target.sid,
						steamAppId: target.steamAppId,
						status: 'RETRY_PENDING',
						reason: 'assets_retrying_in_background',
						resourceRepairQueued: true,
					});
				} else {
					result.linked += 1;
					result.outcomes.push({
						title: target.title,
						shortcutAppId: target.sid,
						steamAppId: target.steamAppId,
						status: 'READY_DEGRADED',
						reason: 'non_critical_assets_unavailable',
						resourceRepairQueued: false,
					});
				}
			} else {
				enqueueBulkRetry(target.item, true, target.sid);
				result.queued += 1;
				result.outcomes.push({
					title: target.title,
					shortcutAppId: target.sid,
					steamAppId: target.steamAppId,
					status: 'RETRY_PENDING',
					reason: 'portrait_pending_in_background',
					resourceRepairQueued: true,
				});
			}
		}

		// Stage 4: Background warmup, reconciliation and finalize
		for (const item of matchedItems) {
			const steamAppId = item.candidate.appid;
			void warmShortcutLinkResources(steamAppId).catch(error => backendLog(`[NGL][Bulk] Warm-up failed for ${steamAppId}: ${error}`));
		}
		void syncMissingArtworkForMappedShortcuts();
		void runDurableReconciliation().catch(error => backendLog(`[NGL][Bulk] Reconciler pass: ${error}`));

		const recordOrder = new Map(records.map((record, index) => [record.id, index]));
		result.outcomes.sort((left, right) => (recordOrder.get(left.shortcutAppId) ?? Number.MAX_SAFE_INTEGER)
			- (recordOrder.get(right.shortcutAppId) ?? Number.MAX_SAFE_INTEGER));

		shortcutRuntimeHost().resetLibraryInjection?.(true, shortcutRuntimeHost().getMainWindowDoc());
		return result;
	} finally {
		resumePendingLinkJobs();
		resumeLinkedGamePrefetch();
	}
}
