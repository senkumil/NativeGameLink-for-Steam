import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { findTopAchievementCandidates, findTopAchievementSectionCandidates, type AchievementCandidate } from '../../modules/signatures/achievements';
import { gamepadCapabilities } from '../GamepadCapabilities';

class AchievementsResolver {
	private states = new DocumentRuntimeCache(() => ({ cachedCandidate: null as AchievementCandidate | null, cachedSectionCandidate: null as AchievementCandidate | null }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedCandidate?.component) {
			return state.cachedCandidate.component;
		}

		try {
			const candidates = findTopAchievementCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedCandidate = candidates[0];
				gamepadCapabilities.setAvailable('achievements', true, doc);
				backendLog(`[NGL][Gamepad][Achievements] Resolved native Steam achievement item component from moduleId: ${state.cachedCandidate.moduleId}`);
				return state.cachedCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Achievements] Error resolving achievement item component: ${error}`);
			gamepadCapabilities.recordFailure('achievements', error, doc);
		}

		gamepadCapabilities.setAvailable('achievements', false, doc);
		return null;
	}

	public resolveSection(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.cachedSectionCandidate?.component) {
			return state.cachedSectionCandidate.component;
		}

		try {
			const candidates = findTopAchievementSectionCandidates(1, doc);
			if (candidates.length > 0 && candidates[0].component) {
				state.cachedSectionCandidate = candidates[0];
				backendLog(`[NGL][Gamepad][Achievements] Resolved native Steam achievement section component from moduleId: ${state.cachedSectionCandidate.moduleId}`);
				return state.cachedSectionCandidate.component;
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Achievements] Error resolving achievement section component: ${error}`);
		}
		return null;
	}

	public getCandidateInfo(doc?: Document): AchievementCandidate | null {
		const state = this.states.get(doc);
		return state.cachedCandidate;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const achievementsResolver = new AchievementsResolver();
