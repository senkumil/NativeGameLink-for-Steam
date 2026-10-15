import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopActivityCandidates, type ActivityCandidate } from '../../modules/signatures/activity';
import { gamepadCapabilities } from '../GamepadCapabilities';

class ActivityResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as ActivityCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopActivityCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('activity', true, doc);
				backendLog(`[NGL][Gamepad][Activity] Resolved native Steam activity component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Activity] Error resolving activity component: ${error}`);
			gamepadCapabilities.recordFailure('activity', error, doc);
		}

		gamepadCapabilities.setAvailable('activity', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const activityResolver = new ActivityResolver();
