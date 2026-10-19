import { getLinkJobCompletion, getLinkJobCompletedShortcutAppId, getPendingLinkJob, PENDING_LINK_JOBS_CHANGED_EVENT, type PendingLinkJob } from './link-job-queue';

export type ManualLinkProgress = {
	status: 'queued' | 'running' | 'failed' | 'completed' | 'cancelled';
	shortcutAppId: number | null;
	phase?: 'identity' | 'assets';
	attempts: number;
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
				shortcutAppId: completed ? getLinkJobCompletedShortcutAppId(job.id, job.createdAt) || shortcutAppId : shortcutAppId, attempts: 0 });
			return;
		}
		shortcutAppId = current.shortcutAppId || shortcutAppId;
		if (current.status === 'failed') stop();
		onChange({ status: current.status === 'staged' ? 'queued' : current.status, shortcutAppId,
			phase: current.phase, attempts: current.attempts });
	};
	window.addEventListener(PENDING_LINK_JOBS_CHANGED_EVENT, refresh);
	refresh();
	return stop;
}
