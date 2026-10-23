import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getGameData } from '../../core/game-data';
import { shortcutRuntimeHost } from './host';
import { findMappingForShortcut, shortcutAlreadyLinked } from './registry';
import { buildImmediateShortcutDetectionContext, buildShortcutDetectionContext, detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote, mergeCandidateLists, sameShortcutDetectionContext, withDetectionBudget } from './detection';
import { isShortcutDismissed } from './dismissed';
import { cleanShortcutPath, shortcutPathDirectory } from '../../steam/shortcuts';
export type ShortcutLinkReviewSource = 'manual' | 'native-add-auto';
interface ShortcutReviewHost {
	showReview(doc: Document, context: ShortcutDetectionContext, detection: ShortcutDetectionResult, options?: { source?: ShortcutLinkReviewSource; loading?: boolean }): void;
	isMutationInProgress(): boolean;
}
const shortcutDetectionInFlight = new Map<number, number>();
export function isShortcutReviewInFlight(id: number): boolean { return shortcutDetectionInFlight.has(id); }
export function invalidateShortcutReview(): number {
	shortcutDetectionInFlight.clear();
	return ++globalDetectionGeneration;
}
let globalDetectionGeneration = 0;
export async function inspectShortcutReview(
	record: { id: number; title: string; app?: any },
	source: ShortcutLinkReviewSource,
	targetDoc: Document | null | undefined,
	host: ShortcutReviewHost,
	launchContext?: Partial<ShortcutDetectionContext>,
): Promise<void> {
	if (source !== 'manual' && shortcutAlreadyLinked(record.id) && !isShortcutDismissed(record.id)) return;
	if (source !== 'manual' && (host.isMutationInProgress() || shortcutDetectionInFlight.has(record.id))) return;
	const immediateDoc = (targetDoc && targetDoc.body)
		? targetDoc
		: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
	if (!immediateDoc?.body) return;
	const immediateContext = buildImmediateShortcutDetectionContext(immediateDoc, record.title, record.id, record.app);
	const selectedPath = cleanShortcutPath(launchContext?.exePath || '');
	if (!immediateContext.exePath && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(selectedPath)) {
		immediateContext.exePath = selectedPath;
		immediateContext.startDir ||= cleanShortcutPath(launchContext?.startDir || '') || shortcutPathDirectory(selectedPath);
	}
	const currentGeneration = ++globalDetectionGeneration;
	shortcutDetectionInFlight.clear();
	shortcutDetectionInFlight.set(record.id, currentGeneration);
	const previousModal = immediateDoc.getElementById('gdl-manual-link-modal') as any;
	const loadingShown = !previousModal || previousModal._shortcutAppId !== record.id;
	if (loadingShown) {
		host.showReview(immediateDoc as Document, immediateContext, { candidates: [] }, { source, loading: true });
		const createdModal = immediateDoc?.getElementById('gdl-manual-link-modal');
		createdModal?.setAttribute('data-gdl-link-loading', '1');
	}
	const ownedModal = immediateDoc.getElementById('gdl-manual-link-modal') as any;
	const ownsReview = (): boolean => globalDetectionGeneration === currentGeneration
		&& immediateDoc.getElementById('gdl-manual-link-modal') === ownedModal && ownedModal?._shortcutAppId === record.id;
	ownedModal?._beginEnrichment?.();
	if (ownedModal) ownedModal._retrySearch = () => {
		void inspectShortcutReview(record, source, immediateDoc, host, launchContext);
	};
	const previous = ownedModal?._getDetectionSnapshot?.();
	let titleOnlyCandidates: ShortcutDetectionCandidate[] = previous?.context && sameShortcutDetectionContext(previous.context, immediateContext)
		? previous.candidates.slice() : [];
	let firstLocalDetection: ShortcutDetectionResult | null = null;
	let reviewContext = immediateContext, localSnapshot = titleOnlyCandidates.slice(), localComplete = false, enrichmentFinished = false;
	let latestRemote: ShortcutDetectionResult | null = null;
	const unavailable = (): boolean => !latestRemote || Boolean(latestRemote.error || latestRemote.transient_error)
		|| (!localComplete && !latestRemote.candidates.length);
	const remoteRejections = (): string[] | undefined => latestRemote && !latestRemote.error ? latestRemote.rejected_appids : undefined;
	const localObserver = (requestedContext: ShortcutDetectionContext) => ({
		isCurrent: () => ownsReview() && sameShortcutDetectionContext(requestedContext, reviewContext)
			&& sameShortcutDetectionContext(requestedContext, ownedModal._getDetectionSnapshot?.().context || reviewContext),
		onLateResult: (result: ShortcutDetectionResult): void => {
			localComplete ||= !result.error && !result.transient_error;
			localSnapshot = mergeCandidateLists(localSnapshot, result.candidates, remoteRejections());
			titleOnlyCandidates = localSnapshot.slice();
			ownedModal._updateCandidates?.(mergeCandidateLists(localSnapshot, latestRemote && !latestRemote.error ? latestRemote.candidates : [], remoteRejections()), enrichmentFinished, remoteRejections());
			if (enrichmentFinished) ownedModal._markEnrichmentComplete?.(unavailable());
		},
	});
	const contextPromise = buildShortcutDetectionContext(immediateDoc, record.title, record.id).then(context => {
		const modal = immediateDoc?.getElementById('gdl-manual-link-modal') as any;
		if (context && ownsReview() && modal?._shortcutAppId === record.id) modal._updateContext?.(context);
		return context;
	}).catch((): null => null);
	try {
		const titleOnlyDetection = await detectShortcutCandidatesLocal(immediateContext, localObserver(immediateContext));
		firstLocalDetection = titleOnlyDetection;
		if (!ownsReview()) return;
		localComplete ||= Boolean(titleOnlyDetection && !titleOnlyDetection.error && !titleOnlyDetection.transient_error);
		titleOnlyCandidates = mergeCandidateLists(titleOnlyCandidates, titleOnlyDetection?.candidates || []);
		localSnapshot = titleOnlyCandidates.slice();
		if (titleOnlyCandidates.length > 0) {
			const fastModal = immediateDoc?.getElementById('gdl-manual-link-modal');
			if (fastModal && (fastModal as any)._shortcutAppId === record.id && (fastModal as any)._updateCandidates) {
				(fastModal as any)._updateCandidates(titleOnlyCandidates, false);
			}
		}
	} catch (error) {
		backendLog(`Title-only AppID discovery failed for ${record.title}: ${error}`);
	}
	if (host.isMutationInProgress() && source === 'manual') {
		let waitMs = 0;
		while (host.isMutationInProgress() && waitMs < 1200) {
			await new Promise(resolve => setTimeout(resolve, 200));
			waitMs += 200;
		}
	}
	if (host.isMutationInProgress() && source !== 'manual') {
		backendLog(`Ignoring automatic link review for ${record.title} while another identity operation is active.`);
		if (shortcutDetectionInFlight.get(record.id) === currentGeneration) shortcutDetectionInFlight.delete(record.id);
		if (ownsReview()) ownedModal?._markEnrichmentComplete?.(true);
		return;
	}
	let modalRendered = false;
	try {
		let context = await contextPromise;
		for (let attempt = 1; !context?.exePath && !immediateContext.exePath && attempt < 3; attempt++) {
			if (!ownsReview()) return;
			await new Promise(resolve => setTimeout(resolve, 100));
			context = await buildShortcutDetectionContext(immediateDoc, record.title, record.id);
		}
		context = { ...immediateContext, ...context, exePath: context?.exePath || immediateContext.exePath,
			startDir: context?.startDir || immediateContext.startDir, launchOptions: context?.launchOptions ?? immediateContext.launchOptions };
		if (!sameShortcutDetectionContext(context, immediateContext)) {
			titleOnlyCandidates = (firstLocalDetection?.candidates || []).slice(); localComplete = false;
		}
		reviewContext = context;
		if (!context.title && !context.exePath) {
			backendLog(`Manual link review has no title or executable for shortcut ${record.title} (${record.id})`);
			if (source === 'manual') {
				const fallbackDoc = (immediateDoc && immediateDoc.body)
					? immediateDoc
					: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
				if (fallbackDoc) {
					host.showReview(fallbackDoc, context, { candidates: [] }, { source: 'manual', loading: false });
					modalRendered = true;
				}
			}
			return;
		}
		if (!ownsReview()) return;
		const hydratedModal = immediateDoc?.getElementById('gdl-manual-link-modal');
		if (hydratedModal && (hydratedModal as any)._shortcutAppId === record.id && (hydratedModal as any)._updateContext) {
			(hydratedModal as any)._updateContext(context);
		}
		const sameLaunchDefinition = context.exePath === immediateContext.exePath && context.startDir === immediateContext.startDir
			&& context.launchOptions === immediateContext.launchOptions;
		const localDetection = sameLaunchDefinition && firstLocalDetection && !firstLocalDetection.transient_error && !firstLocalDetection.error
			? firstLocalDetection : await detectShortcutCandidatesLocal(context, localObserver(context));
		if (!ownsReview()) return;
		localComplete ||= Boolean(localDetection && !localDetection.error && !localDetection.transient_error);
		let activeCandidates = mergeCandidateLists(titleOnlyCandidates, localDetection?.candidates || []);
		const existingMappedId = findMappingForShortcut(record.id, record.title, context.exePath);
		if (existingMappedId && /^\d+$/.test(existingMappedId)) {
			const mappedData = await withDetectionBudget(getGameData(existingMappedId), 1200);
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
		if (!ownsReview()) return;
		const doc = (immediateDoc && immediateDoc.body)
			? immediateDoc
			: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
		if (!doc?.body) return;
		const currentModal = doc.getElementById('gdl-manual-link-modal');
		if (currentModal && (currentModal as any)._shortcutAppId === record.id && (currentModal as any)._updateCandidates) {
			(currentModal as any)._updateCandidates(activeCandidates, false);
			modalRendered = true;
		} else {
			host.showReview(doc, context, { candidates: activeCandidates }, { source, loading: activeCandidates.length === 0 });
			modalRendered = true;
		}
		const enrichmentContext = context;
		localSnapshot = activeCandidates.slice();
		void enrichShortcutCandidatesRemote(enrichmentContext, localSnapshot).then(remoteDetection => {
			if (!ownsReview() || !sameShortcutDetectionContext(enrichmentContext, ownedModal._getDetectionSnapshot?.().context || reviewContext)) return;
			latestRemote = remoteDetection; enrichmentFinished = true;
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			const liveModal = liveDoc?.getElementById('gdl-manual-link-modal');
			if (!liveModal || (liveModal as any)._shortcutAppId !== record.id || !(liveModal as any)._updateCandidates) return;
			if (remoteDetection && !remoteDetection.error && (remoteDetection.candidates.length > 0 || remoteDetection.rejected_appids?.length)) {
				let merged = mergeCandidateLists(localSnapshot, remoteDetection.candidates, remoteDetection.rejected_appids);
				if (existingMappedId && /^\d+$/.test(existingMappedId)) {
					const existingIndex = merged.findIndex(c => c.appid === existingMappedId);
					if (existingIndex > 0) {
						const [item] = merged.splice(existingIndex, 1);
						item.score = 100;
						merged.unshift(item);
					}
				}
				(liveModal as any)._updateCandidates(merged, true, remoteDetection.rejected_appids);
				(liveModal as any)._markEnrichmentComplete?.(unavailable());
			} else {
				(liveModal as any)._markEnrichmentComplete?.(unavailable());
			}
		}).catch(err => {
			backendLog(`Remote candidate enrichment error for ${record.title}: ${err}`);
			if (!ownsReview()) return;
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			const liveModal = liveDoc?.getElementById('gdl-manual-link-modal');
			if (liveModal && (liveModal as any)._shortcutAppId === record.id && (liveModal as any)._markEnrichmentComplete) {
				(liveModal as any)._markEnrichmentComplete(true);
			}
		});
	} catch (error) {
		backendLog(`Manual shortcut review failed for ${record.title}: ${error}`);
		if (!ownsReview()) return;
		ownedModal._markEnrichmentComplete?.(true);
		modalRendered = true;
	} finally {
		if (loadingShown && !modalRendered && source !== 'manual' && ownsReview()) {
			const liveDoc = (immediateDoc && immediateDoc.body)
				? immediateDoc
				: (shortcutRuntimeHost().getMainWindowDoc() || (typeof document !== 'undefined' ? document : null));
			liveDoc?.querySelector('#gdl-manual-link-modal[data-gdl-link-loading="1"]')?.remove();
		}
		if (shortcutDetectionInFlight.get(record.id) === currentGeneration) shortcutDetectionInFlight.delete(record.id);
	}
}
