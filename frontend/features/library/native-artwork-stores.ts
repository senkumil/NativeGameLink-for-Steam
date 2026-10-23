import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';

type Stores = { details: any; apps: any };
type State = Stores & { identity: object | null; count: number; nextProbeAt: number; retryFactories: boolean };
const states = new WeakMap<object, State>();

const detailsStore = (value: any): boolean => typeof value?.GetCustomLogoPosition === 'function'
	&& typeof value?.SaveCustomLogoPosition === 'function' && typeof value?.GetAppData === 'function';
const appStore = (value: any): boolean => typeof value?.GetAppOverviewByAppID === 'function'
	&& typeof value?.GetCustomLogoImageURLs === 'function';

/** Resolve only this document's native artwork stores by their capabilities.
 * Steam renumbers private modules on updates; IDs and export names are not a
 * stable contract. Inspect loaded exports first, then only matching factories. */
export function resolveNativeArtworkStores(doc?: Document): Stores | null {
	const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
	if (!view || view.closed || (doc && view.document !== doc)) return null;
	if (detailsStore((view as any).appDetailsStore) && appStore((view as any).appStore)) {
		return { details: (view as any).appDetailsStore, apps: (view as any).appStore };
	}
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	let state = states.get(view);
	if (!state || state.identity !== identity) {
		state = { identity, count: -1, nextProbeAt: 0, retryFactories: false, details: null, apps: null };
		states.set(view, state);
	}
	if (detailsStore((view as any).appDetailsStore)) state.details = (view as any).appDetailsStore;
	if (appStore((view as any).appStore)) state.apps = (view as any).appStore;
	if (state.details && state.apps) return state;
	const count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (state.count === count && Date.now() < state.nextProbeAt) return state;
	state.nextProbeAt = Date.now() + 1_000;
	steamWebpackRuntime.captureRuntime(doc);
	const inspect = (exports: any): void => {
		for (const value of [exports, ...((exports && (typeof exports === 'object' || typeof exports === 'function')) ? Object.values(exports) : [])]) {
			if (!state!.details && detailsStore(value)) state!.details = value;
			if (!state!.apps && appStore(value)) state!.apps = value;
		}
	};
	for (const entry of steamWebpackRuntime.getAllModules(doc)) {
		try { inspect(entry.exports); } catch {}
		if (state.details && state.apps) return state;
	}
	if (state.count === count && !state.retryFactories) return state;
	state.count = count;
	state.retryFactories = false;
	const require = steamWebpackRuntime.getRequire(doc);
	if (!require) return state;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		if (require.m?.[id] !== factory) continue;
		const source = String(factory);
		const needed = (!state.details && ['GetCustomLogoPosition(', 'SaveCustomLogoPosition(', 'GetAppData('].every(token => source.includes(token)))
			|| (!state.apps && ['GetAppOverviewByAppID(', 'GetCustomLogoImageURLs('].every(token => source.includes(token)));
		if (!needed) continue;
		try { inspect(require(id)); } catch { state.retryFactories = true; }
		if (state.details && state.apps) break;
	}
	return state;
}
