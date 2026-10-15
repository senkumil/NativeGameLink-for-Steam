import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopNewsCandidates, type NewsCandidate } from '../../modules/signatures/news';
import { gamepadCapabilities } from '../GamepadCapabilities';

class NewsResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as NewsCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopNewsCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('news', true, doc);
				backendLog(`[NGL][Gamepad][News] Resolved native Steam news component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][News] Error resolving news component: ${error}`);
			gamepadCapabilities.recordFailure('news', error, doc);
		}

		gamepadCapabilities.setAvailable('news', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const newsResolver = new NewsResolver();
