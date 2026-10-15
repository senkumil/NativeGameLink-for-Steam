import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopGameInfoCandidates, type GameInfoCandidate } from '../../modules/signatures/gameInfo';
import { gamepadCapabilities } from '../GamepadCapabilities';

class GameInfoResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as GameInfoCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopGameInfoCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('gameInfo', true, doc);
				backendLog(`[NGL][Gamepad][GameInfo] Resolved native Steam game info component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][GameInfo] Error resolving game info component: ${error}`);
			gamepadCapabilities.recordFailure('gameInfo', error, doc);
		}

		gamepadCapabilities.setAvailable('gameInfo', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const gameInfoResolver = new GameInfoResolver();
