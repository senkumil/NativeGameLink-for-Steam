import { DocumentRuntimeCache } from './runtime-cache';
import { backendLog } from '../../api/backend';

export interface GamepadCapabilities {
	runtime: boolean;
	appStore: boolean;
	libraryStore: boolean;
	navigation: boolean;
	userStore: boolean;

	hero: boolean;
	playbar: boolean;
	achievements: boolean;
	activity: boolean;
	news: boolean;
	gameInfo: boolean;
	friends: boolean;
	community: boolean;
	gameDetails: boolean;
}

export type GamepadCapabilityKey = keyof Omit<GamepadCapabilities, 'runtime'>;

class GamepadCapabilitiesManager {
	private states = new DocumentRuntimeCache(() => ({
		capabilities: {
		runtime: false,
		appStore: false,
		libraryStore: false,
		navigation: false,
		userStore: false,
		hero: false,
		playbar: false,
		achievements: true,
		activity: false,
		news: false,
		gameInfo: false,
		friends: false,
		community: false,
		gameDetails: false,
	} as GamepadCapabilities,
		circuitBreakers: new Map<GamepadCapabilityKey, { failures: number; broken: boolean; lastError?: string }>(),
	}));

	public isAvailable(key: GamepadCapabilityKey, doc?: Document): boolean {
		const state = this.states.get(doc);
		const cb = state.circuitBreakers.get(key);
		if (cb && cb.broken) return false;
		return state.capabilities[key] ?? false;
	}

	public setAvailable(key: GamepadCapabilityKey, available: boolean, doc?: Document): void {
		const state = this.states.get(doc);
		state.capabilities[key] = available;
		if (available) {
			state.circuitBreakers.delete(key);
			backendLog(`[NGL][Gamepad][Capabilities] Capability enabled: "${key}"`);
		}
	}

	public recordFailure(key: GamepadCapabilityKey, error: unknown, doc?: Document): void {
		const state = this.states.get(doc);
		const entry = state.circuitBreakers.get(key) || { failures: 0, broken: false };
		entry.failures += 1;
		entry.lastError = String(error);
		if (entry.failures >= 3 && !entry.broken) {
			entry.broken = true;
			state.capabilities[key] = false;
			backendLog(`[NGL][Gamepad][CircuitBreaker] Tripped for capability "${key}" after 3 failures. Fallback engaged. Error: ${entry.lastError}`);
		}
		state.circuitBreakers.set(key, entry);
	}

	public getSnapshot(doc?: Document): GamepadCapabilities {
		const state = this.states.get(doc);
		return { ...state.capabilities };
	}

	public resetCircuitBreakers(doc?: Document): void {
		this.states.clear(doc);
	}
}

export const gamepadCapabilities = new GamepadCapabilitiesManager();
