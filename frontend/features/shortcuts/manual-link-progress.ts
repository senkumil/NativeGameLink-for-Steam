import { getLinkJobCompletion, getLinkJobCompletedShortcutAppId, getLinkJobResourcesPending, getPendingLinkJob, PENDING_LINK_JOBS_CHANGED_EVENT, type PendingLinkJob } from './link-job-queue';
import { findMappingForShortcut } from './registry';

export type ManualLinkProgress = {
	status: 'queued' | 'running' | 'failed' | 'completed' | 'cancelled';
	shortcutAppId: number | null;
	phase?: 'identity' | 'assets';
	attempts: number;
	resourcesPending?: boolean;
};

/** Subscribe before the initial read so a fast queue completion cannot be lost.
 * A missing job alone is never proof that setup succeeded. */
export function observeManualLinkJob(
	doc: Document,
	modal: HTMLElement,
	job: Pick<PendingLinkJob, 'id' | 'createdAt' | 'shortcutAppId'>,
	onChange: (state: ManualLinkProgress) => void,
): () => void {
	let stopped = false;
	let shortcutAppId = job.shortcutAppId;
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		window.removeEventListener(PENDING_LINK_JOBS_CHANGED_EVENT, refresh);
	};
	const refresh = (): void => {
		if (stopped) return;
		if (doc.getElementById('gdl-manual-link-modal') !== modal) { stop(); return; }
		const current = getPendingLinkJob(job.id);
		if (!current || current.createdAt !== job.createdAt) {
			stop();
			const completed = getLinkJobCompletion(job.id, job.createdAt) === true;
			onChange({ status: completed ? 'completed' : 'cancelled',
				shortcutAppId: completed ? getLinkJobCompletedShortcutAppId(job.id, job.createdAt) || shortcutAppId : shortcutAppId,
				resourcesPending: completed && getLinkJobResourcesPending(job.id, job.createdAt), attempts: 0 });
			return;
		}
		shortcutAppId = current.shortcutAppId || shortcutAppId;
		// Only an acknowledged transaction can complete the link. Missing optional
		// artwork continues through the resource queue without holding the dialog open.
		if (current.linkCommitted && current.status !== 'failed' && findMappingForShortcut(shortcutAppId, current.title, current.shortcutExecutable) === current.steamAppId) {
			stop();
			onChange({ status: 'completed', shortcutAppId, attempts: current.attempts, resourcesPending: true });
			return;
		}
		if (current.status === 'failed') stop();
		onChange({ status: current.status === 'staged' ? 'queued' : current.status, shortcutAppId,
			phase: current.phase, attempts: current.attempts });
	};
	window.addEventListener(PENDING_LINK_JOBS_CHANGED_EVENT, refresh);
	refresh();
	return stop;
}
