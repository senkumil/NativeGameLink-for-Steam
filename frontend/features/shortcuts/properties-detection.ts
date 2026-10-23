import type { ShortcutDetectionCandidate, ShortcutDetectionContext, ShortcutDetectionResult } from '../../domain/types';
import { gdlText } from '../../steam/localization';
import { backendLog } from '../../api/backend';
import { buildShortcutDetectionContext, detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote, mergeCandidateLists, sameShortcutDetectionContext } from './detection';

/** Keep lookup recovery separate from Properties' link/write controls. */
export function bindPropertySuggestionSearch(options: {
	doc: Document; section: HTMLElement; title: string; shortcutAppId: number;
	getCandidates: () => ShortcutDetectionCandidate[];
	onContext: (context: ShortcutDetectionContext) => void;
	publish: (candidates: ShortcutDetectionCandidate[], final: boolean, rejected?: string[]) => void;
}): void {
	const { doc, section } = options;
	const retry = doc.createElement('button');
	retry.type = 'button'; retry.className = 'gdl-auto-detect-retry gdl-native-button'; retry.hidden = true;
	retry.textContent = gdlText('link_search_retry', 'Retry search');
	section.querySelector('.gdl-auto-candidates')?.after(retry);
	let generation = 0, lastContext: ShortcutDetectionContext | null = null;
	const run = async (): Promise<void> => {
		const token = ++generation;
		const current = (): boolean => token === generation && section.isConnected;
		retry.hidden = true; retry.disabled = true;
		try {
			const context = await buildShortcutDetectionContext(doc, options.title, options.shortcutAppId);
			if (!current()) return;
			if (!context) throw new Error('shortcut_context_unavailable');
			let localCandidates = lastContext && sameShortcutDetectionContext(context, lastContext) ? options.getCandidates().slice() : [];
			lastContext = context; options.onContext(context);
			let localComplete = false, finished = false, remote: ShortcutDetectionResult | null = null;
			const update = (): void => {
				if (!current()) return;
				const rejected = remote && !remote.error ? remote.rejected_appids || [] : [];
				const candidates = mergeCandidateLists(localCandidates, remote && !remote.error ? remote.candidates : [], rejected);
				options.publish(candidates, finished, rejected);
				const unavailable = finished && (!remote || Boolean(remote.error || remote.transient_error) || (!localComplete && !remote.candidates.length));
				retry.hidden = !unavailable; retry.disabled = !finished;
				if (unavailable && !candidates.length) {
					const title = section.querySelector<HTMLElement>('.gdl-auto-detect-title');
					if (title) { title.style.display = 'block'; title.textContent = gdlText('link_search_unavailable', 'Steam search could not finish. You can retry or enter the AppID manually.'); }
					const select = section.querySelector<HTMLSelectElement>('.gdl-auto-candidates');
					if (select?.options[0]) select.options[0].textContent = gdlText('link_search_unavailable_title', 'Search unavailable');
				}
			};
			const acceptLocal = (result: ShortcutDetectionResult | null): void => {
				if (!current() || !sameShortcutDetectionContext(context, lastContext!)) return;
				localComplete ||= Boolean(result && !result.error && !result.transient_error);
				localCandidates = mergeCandidateLists(localCandidates, result?.candidates || [], remote && !remote.error ? remote.rejected_appids : []);
				update();
			};
			acceptLocal(await detectShortcutCandidatesLocal(context, { isCurrent: current, onLateResult: acceptLocal }));
			remote = await enrichShortcutCandidatesRemote(context, localCandidates);
			finished = true; update();
		} catch (error) {
			backendLog(`Properties automatic detection error: ${error}`);
			if (!current()) return;
			retry.hidden = false; retry.disabled = false;
			options.publish(options.getCandidates(), true);
			const title = section.querySelector<HTMLElement>('.gdl-auto-detect-title');
			if (title && !options.getCandidates().length) { title.style.display = 'block'; title.textContent = gdlText('link_search_unavailable', 'Steam search could not finish. You can retry or enter the AppID manually.'); }
			const select = section.querySelector<HTMLSelectElement>('.gdl-auto-candidates');
			if (!options.getCandidates().length && select?.options[0]) select.options[0].textContent = gdlText('link_search_unavailable_title', 'Search unavailable');
		}
	};
	retry.addEventListener('click', () => { if (!retry.disabled) void run(); });
	void run();
}
