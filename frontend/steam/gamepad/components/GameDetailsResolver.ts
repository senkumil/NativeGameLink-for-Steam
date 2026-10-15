import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { gamepadCapabilities } from '../GamepadCapabilities';

class GameDetailsResolver {
	private states = new DocumentRuntimeCache(() => ({ resolvedComponent: null as any }));

	public resolve(doc?: Document): React.ComponentType<any> | null {
		const state = this.states.get(doc);
		if (state.resolvedComponent) {
			return state.resolvedComponent;
		}

		try {
			const modules = steamWebpackRuntime.getAllModules(doc);
			for (const mod of modules) {
				const exp = mod.exports;
				if (!exp) continue;
				const candidates = typeof exp === 'function' ? [exp] : typeof exp === 'object' ? Object.values(exp) : [];
				for (const item of candidates) {
					if (typeof item === 'function' && /AppDetailsSection|GameDetailsPage|AppPageContainer/i.test(item.displayName || item.name || '')) {
						state.resolvedComponent = item;
						gamepadCapabilities.setAvailable('gameDetails', true, doc);
						backendLog(`[NGL][Gamepad][GameDetails] Resolved native Steam game details component from moduleId: ${mod.id}`);
						return state.resolvedComponent;
					}
				}
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][GameDetails] Error resolving game details component: ${error}`);
			gamepadCapabilities.recordFailure('gameDetails', error, doc);
		}

		gamepadCapabilities.setAvailable('gameDetails', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const gameDetailsResolver = new GameDetailsResolver();
