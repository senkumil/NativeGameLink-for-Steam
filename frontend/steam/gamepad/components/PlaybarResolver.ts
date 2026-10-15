import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopPlaybarCandidates, type PlaybarCandidate } from '../../modules/signatures/playbar';
import { gamepadCapabilities } from '../GamepadCapabilities';

class PlaybarResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as PlaybarCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopPlaybarCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('playbar', true, doc);
				backendLog(`[NGL][Gamepad][Playbar] Resolved native Steam playbar component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Playbar] Error resolving playbar component: ${error}`);
			gamepadCapabilities.recordFailure('playbar', error, doc);
		}

		gamepadCapabilities.setAvailable('playbar', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const playbarResolver = new PlaybarResolver();
