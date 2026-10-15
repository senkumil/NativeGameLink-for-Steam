import { isMappingSnapshotVerified, mappings, shortcutMappingKey, subscribeMappings } from '../../core/mappings';
import { cancelLibrarySidebarWork, runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { routedSteamAppId } from './native-route';
import { installNativeLogoSources, refreshNativeLogoInventoryReadiness } from './native-logo-sources';

const MAX_POSITION_KEYS = 128;

type NativeStores = { details: any; apps: any };
type WarmupState = {
	positions: Map<string, true>;
	pendingShortcuts: number[];
	missingShortcuts: Set<number>;
	positionTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	retryAttempts: number;
	store?: any;
	stores?: NativeStores;
	nextStoreProbeAt?: number;
	disposed: boolean;
	dispose?: () => void;
	logoSourcesCleanup?: () => void;
};
const states = new WeakMap<Document, WarmupState>();
const BACKGROUND_KEY = 'native-artwork-positions';

function backgroundWork(doc: Document, state: WarmupState, key: string, work: () => void): void {
	void runWhenLibrarySidebarIdle(doc, key, () => {
		if (!state.disposed && states.get(doc) === state) work();
	}).catch(() => {});
}

function stateFor(doc: Document): WarmupState {
	let state = states.get(doc);
	if (!state) {
		state = { positions: new Map(), pendingShortcuts: [], missingShortcuts: new Set(), retryAttempts: 0, disposed: false };
		states.set(doc, state);
	}
	return state;
}

function shortcutId(raw: unknown): number | null {
	const id = Number(raw), unsigned = id < 0 ? id >>> 0 : id;
	return Number.isInteger(id) && id >= -2147483648 && id <= 4294967295 && unsigned >= 2147483648 ? unsigned : null;
}

function remember(map: Map<string, true>, key: string, maximum: number): void {
	map.delete(key); map.set(key, true);
	while (map.size > maximum) map.delete(map.keys().next().value!);
}

function rememberMissing(state: WarmupState, id: number): void {
	state.missingShortcuts.delete(id); state.missingShortcuts.add(id);
	while (state.missingShortcuts.size > MAX_POSITION_KEYS) state.missingShortcuts.delete(state.missingShortcuts.values().next().value!);
}

/** Resolve this document's stores without installing native component guards. */
function nativeStores(doc: Document, state: WarmupState): NativeStores | null {
	const view = doc.defaultView as any;
	if (!view || view.closed) return null;
	let details = typeof view.appDetailsStore?.GetCustomLogoPosition === 'function' ? view.appDetailsStore : state.stores?.details;
	let apps = typeof view.appStore?.GetAppOverviewByAppID === 'function' ? view.appStore : state.stores?.apps;
	if (typeof details?.GetCustomLogoPosition === 'function' && typeof apps?.GetAppOverviewByAppID === 'function') {
		return state.stores = { details, apps };
	}
	if (Date.now() < (state.nextStoreProbeAt || 0)) return null;
	state.nextStoreProbeAt = Date.now() + 1_000;
	if (typeof details?.GetCustomLogoPosition !== 'function' || typeof apps?.GetAppOverviewByAppID !== 'function') {
		steamWebpackRuntime.captureRuntime(doc);
		const require = steamWebpackRuntime.getRequire(doc);
		try { if (typeof details?.GetCustomLogoPosition !== 'function') details = require?.(78057)?.H; } catch {}
		try { if (typeof apps?.GetAppOverviewByAppID !== 'function') apps = require?.(1776)?.tw; } catch {}
		if (typeof details?.GetCustomLogoPosition !== 'function') {
			for (const entry of steamWebpackRuntime.getAllModules(doc)) {
				const candidate = entry.exports?.H;
				if (typeof candidate?.GetCustomLogoPosition === 'function' && typeof candidate.GetAppData === 'function') { details = candidate; break; }
			}
		}
	}
	return typeof details?.GetCustomLogoPosition === 'function' && typeof apps?.GetAppOverviewByAppID === 'function' ? state.stores = { details, apps } : null;
}

/** Prime Steam's own grid.json cache; never assign metadata, image URLs or DOM. */
export function warmNativeShortcutArtwork(doc: Document, rawId: number): boolean {
	if (!isMappingSnapshotVerified()) return false;
	const id = shortcutId(rawId);
	if (id === null) return false;
	const mapping = mappings[shortcutMappingKey(id)] || mappings[shortcutMappingKey(id - 4294967296)];
	if (!/^\d+$/.test(String(mapping || ''))) return false;
	const state = stateFor(doc);
	if (state.disposed) return false;
	const stores = nativeStores(doc, state);
	if (!stores) { rememberMissing(state, id); return false; }
	state.logoSourcesCleanup = installNativeLogoSources(doc, stores.apps);
	let overview: any;
	try { overview = stores.apps.GetAppOverviewByAppID(id) || stores.apps.GetAppOverviewByAppID(id - 4294967296); }
	catch { rememberMissing(state, id); return false; }
	if (!overview || shortcutId(overview.appid) !== id || typeof overview.BHasCustomImages !== 'function') {
		rememberMissing(state, id); return false;
	}
	state.missingShortcuts.delete(id);
	const mtime = Number(overview.rt_custom_image_mtime);
	try { if (!(mtime > 0) || !overview.BHasCustomImages()) return false; } catch { return false; }
	if (state.store !== stores.details) { state.store = stores.details; state.positions.clear(); }
	const key = `${id}:${mtime}`;
	if (!state.positions.has(key)) {
		// GetCustomLogoPosition returns a pending sentinel during its asynchronous
		// read, so deduplicate before calling it rather than awaiting a result.
		remember(state.positions, key, MAX_POSITION_KEYS);
		try { stores.details.GetCustomLogoPosition(overview); }
		catch { state.positions.delete(key); return false; }
	}
	return true;
}

/** Warm only native position metadata; Steam owns all artwork image loading. */
export function warmMappedNativeArtwork(doc: Document): void { runMappedWarmup(doc, false); }

function scheduleMissingRetry(doc: Document, state: WarmupState, inventoryRetry = false): void {
	if (state.disposed || state.retryTimer || (!state.missingShortcuts.size && !inventoryRetry) || state.retryAttempts >= 3) return;
	state.retryTimer = setTimeout(() => {
		state.retryTimer = undefined; state.retryAttempts++;
		runMappedWarmup(doc, true);
	}, 1_000);
}

function runMappedWarmup(doc: Document, retry: boolean): void {
	const state = stateFor(doc);
	if (state.disposed) return;
	if (state.positionTimer) clearTimeout(state.positionTimer);
	state.positionTimer = undefined;
	state.pendingShortcuts = [];
	if (!retry) {
		if (state.retryTimer) clearTimeout(state.retryTimer);
		state.retryTimer = undefined; state.retryAttempts = 0; state.missingShortcuts.clear();
	}
	if (!isMappingSnapshotVerified()) return;
	if (retry) {
		state.pendingShortcuts = Array.from(state.missingShortcuts).slice(0, MAX_POSITION_KEYS);
	} else {
		for (const key of Object.keys(mappings)) {
			if (!key.startsWith('shortcut:')) continue;
			const id = shortcutId(key.slice(9));
			if (id !== null && !state.pendingShortcuts.includes(id)) state.pendingShortcuts.push(id);
			if (state.pendingShortcuts.length >= MAX_POSITION_KEYS) break;
		}
	}
	if (!retry) {
		const current = shortcutId(routedSteamAppId(doc));
		if (current !== null) {
			state.pendingShortcuts = [current, ...state.pendingShortcuts.filter(id => id !== current)];
			warmNativeShortcutArtwork(doc, current);
		}
	}
	const batch = (): void => {
		state.positionTimer = undefined;
		if (state.disposed) return;
		backgroundWork(doc, state, BACKGROUND_KEY, () => {
			for (const id of state.pendingShortcuts.splice(0, 4)) warmNativeShortcutArtwork(doc, id);
			if (state.pendingShortcuts.length) state.positionTimer = setTimeout(batch, 50);
			else {
				scheduleMissingRetry(doc, state);
				void refreshNativeLogoInventoryReadiness(doc).then(retryInventory => {
					if (retryInventory) scheduleMissingRetry(doc, state, true);
				});
			}
		});
	};
	batch();
}

/** Route/header synchronization primes only the selected game's logo position.
 * The native game list has no artwork listeners or React-fiber reads here. */
export function installNativeArtworkWarmup(doc: Document): () => void {
	const state = stateFor(doc);
	if (state.dispose) return state.dispose;
	state.logoSourcesCleanup = installNativeLogoSources(doc);
	const unsubscribe = subscribeMappings(() => warmMappedNativeArtwork(doc));
	const dispose = (): void => {
		if (state.disposed) return;
		state.disposed = true;
		state.logoSourcesCleanup?.();
		unsubscribe();
		cancelLibrarySidebarWork(doc, BACKGROUND_KEY);
		if (state.positionTimer) clearTimeout(state.positionTimer);
		if (state.retryTimer) clearTimeout(state.retryTimer);
		state.pendingShortcuts = [];
		state.positions.clear(); state.store = undefined; state.stores = undefined;
		state.missingShortcuts.clear();
		states.delete(doc);
	};
	state.dispose = dispose;
	warmMappedNativeArtwork(doc);
	return dispose;
}
