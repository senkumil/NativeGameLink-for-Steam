import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopHeroCandidates, type HeroCandidate } from '../../modules/signatures/hero';
import { gamepadCapabilities } from '../GamepadCapabilities';

class HeroResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as HeroCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopHeroCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('hero', true, doc);
				backendLog(`[NGL][Gamepad][Hero] Resolved native Steam hero component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Hero] Error resolving hero component: ${error}`);
			gamepadCapabilities.recordFailure('hero', error, doc);
		}

		gamepadCapabilities.setAvailable('hero', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const heroResolver = new HeroResolver();
