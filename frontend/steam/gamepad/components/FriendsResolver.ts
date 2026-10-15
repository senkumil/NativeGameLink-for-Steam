import { DocumentRuntimeCache } from '../runtime-cache';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { gamepadCapabilities } from '../GamepadCapabilities';

class FriendsResolver {
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
					if (typeof item === 'function' && /FriendsWhoPlay|FriendActivityRow|FriendsSection/i.test(item.displayName || item.name || '')) {
						state.resolvedComponent = item;
						gamepadCapabilities.setAvailable('friends', true, doc);
						backendLog(`[NGL][Gamepad][Friends] Resolved native Steam friends component from moduleId: ${mod.id}`);
						return state.resolvedComponent;
					}
				}
			}
		} catch (error) {
			backendLog(`[NGL][Gamepad][Friends] Error resolving friends component: ${error}`);
			gamepadCapabilities.recordFailure('friends', error, doc);
		}

		gamepadCapabilities.setAvailable('friends', false, doc);
		return null;
	}

	public invalidate(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const friendsResolver = new FriendsResolver();
