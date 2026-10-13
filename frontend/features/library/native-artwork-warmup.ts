import { isMappingSnapshotVerified, mappings, shortcutMappingKey, subscribeMappings } from '../../core/mappings';
import { cancelLibrarySidebarWork, runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { routedSteamAppId } from './native-route';
import { installNativeLogoSources, refreshNativeLogoInventoryReadiness } from './native-logo-sources';

const MAX_POSITION_KEYS = 128;
const MAX_IMAGE_URLS = 16;
const MAX_PENDING_IMAGES = 4;
const MAX_ACTIVE_IMAGES = 2;

type WarmImage = { image: HTMLImageElement; timer: ReturnType<typeof setTimeout>; foreground: boolean };
type ImageRequest = { url: string; fallback?: string; foreground: boolean };
type NativeStores = { details: any; apps: any };
type WarmupState = {
	positions: Map<string, true>;
	imageUrls: Map<string, true>;
	activeImages: Map<string, WarmImage>;
	pendingImages: ImageRequest[];
	pendingShortcuts: number[];
	pendingLogoShortcuts: number[];
	pumpingLogos: boolean;
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
const BACKGROUND_KEYS = ['native-artwork-positions', 'native-artwork-logos', 'native-artwork-images'];

function backgroundWork(doc: Document, state: WarmupState, key: string, work: () => void): void {
	void runWhenLibrarySidebarIdle(doc, key, () => {
		if (!state.disposed && states.get(doc) === state) work();
	}).catch(() => {});
}

function stateFor(doc: Document): WarmupState {
	let state = states.get(doc);
	if (!state) {
		state = { positions: new Map(), imageUrls: new Map(), activeImages: new Map(), pendingImages: [], pendingShortcuts: [], pendingLogoShortcuts: [], pumpingLogos: false, missingShortcuts: new Set(), retryAttempts: 0, disposed: false };
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

function localLogoUrl(doc: Document, raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	try {
		const base = doc.defaultView?.location.href;
		if (!base) return null;
		const url = new URL(raw, base), origin = new URL(base).origin;
		return url.origin === origin && /^\/customimages\/\d+_logo\.(?:jpg|png)$/i.test(url.pathname) ? url.href : null;
	} catch { return null; }
}

function drainImages(doc: Document, state: WarmupState, backgroundAllowed = false): void {
	const ImageClass = (doc.defaultView as any)?.Image;
	if (state.disposed || typeof ImageClass !== 'function') return;
	while (state.activeImages.size < MAX_ACTIVE_IMAGES && state.pendingImages.length) {
		let index = state.pendingImages.findIndex(request => request.foreground);
		if (index < 0) {
			if (!backgroundAllowed) {
				backgroundWork(doc, state, BACKGROUND_KEYS[2], () => drainImages(doc, state, true));
				return;
			}
			index = 0;
		}
		const { url, fallback, foreground } = state.pendingImages.splice(index, 1)[0];
		const image: HTMLImageElement = new ImageClass();
		const finish = (loaded: boolean): void => {
			const active = state.activeImages.get(url);
			if (!active || active.image !== image) return;
			clearTimeout(active.timer);
			image.onload = image.onerror = null;
			image.removeAttribute('src');
			state.activeImages.delete(url);
			if (!loaded && fallback && !state.imageUrls.has(fallback)) {
				remember(state.imageUrls, fallback, MAX_IMAGE_URLS);
				if (state.pendingImages.length >= MAX_PENDING_IMAGES) {
					const dropped = state.pendingImages.pop();
					if (dropped) state.imageUrls.delete(dropped.url);
				}
				state.pendingImages.unshift({ url: fallback, foreground: active.foreground });
			}
			drainImages(doc, state);
			drainBackgroundLogos(doc, state);
		};
		image.decoding = 'async';
		image.fetchPriority = 'low';
		image.onload = () => finish(true);
		image.onerror = () => finish(false);
		state.activeImages.set(url, { image, timer: setTimeout(() => finish(false), 2_000), foreground });
		image.src = url;
	}
}

function reserveSelectedLogoSlot(state: WarmupState): void {
	if (state.activeImages.size < MAX_ACTIVE_IMAGES) return;
	for (const [url, active] of state.activeImages) {
		if (active.foreground) continue;
		clearTimeout(active.timer);
		active.image.onload = active.image.onerror = null;
		active.image.removeAttribute('src');
		state.activeImages.delete(url); state.imageUrls.delete(url);
		return;
	}
}

function warmLogoImages(doc: Document, state: WarmupState, apps: any, overview: any, foreground: boolean): void {
	if (typeof apps.GetCustomLogoImageURLs !== 'function') return;
	let urls: unknown;
	try { urls = apps.GetCustomLogoImageURLs(overview); } catch { return; }
	if (!Array.isArray(urls)) return;
	const candidates = urls.slice(0, 2).map(raw => localLogoUrl(doc, raw)).filter((url): url is string => Boolean(url));
	// Plugin-written logos are normalized to PNG. Prefer that candidate for
	// warming, but retain Steam's JPG candidate if the local PNG is absent.
	candidates.sort((left, right) => Number(/\.png(?:\?|$)/i.test(right)) - Number(/\.png(?:\?|$)/i.test(left)));
	const [url, fallback] = candidates;
	if (!url) return;
	if (foreground) {
		const pending = state.pendingImages.find(request => request.url === url);
		if (pending) { pending.foreground = true; reserveSelectedLogoSlot(state); drainImages(doc, state); return; }
		const active = state.activeImages.get(url);
		if (active) { active.foreground = true; return; }
	}
	if (state.imageUrls.has(url)) return;
	if (foreground) reserveSelectedLogoSlot(state);
	remember(state.imageUrls, url, MAX_IMAGE_URLS);
	if (state.pendingImages.length >= MAX_PENDING_IMAGES) {
		const dropped = state.pendingImages.shift();
		if (dropped) state.imageUrls.delete(dropped.url);
	}
	state.pendingImages.push({ url, fallback, foreground });
	// Hero images are deliberately left to Steam: warming them would decode
	// large bitmaps for games the user may never open.
	drainImages(doc, state);
}

function drainBackgroundLogos(doc: Document, state: WarmupState): void {
	if (state.disposed || state.pumpingLogos) return;
	backgroundWork(doc, state, BACKGROUND_KEYS[1], () => {
		state.pumpingLogos = true;
		try {
			while (state.pendingLogoShortcuts.length && state.activeImages.size + state.pendingImages.length < MAX_ACTIVE_IMAGES + MAX_PENDING_IMAGES) {
				warmShortcutArtwork(doc, state.pendingLogoShortcuts.shift()!, true, false);
			}
		} finally { state.pumpingLogos = false; }
	});
}

/** Prime Steam's own grid.json cache; never assign metadata, image URLs or DOM. */
export function warmNativeShortcutArtwork(doc: Document, rawId: number, warmImages = false): boolean {
	return warmShortcutArtwork(doc, rawId, warmImages, true);
}

function warmShortcutArtwork(doc: Document, rawId: number, warmImages: boolean, foreground: boolean): boolean {
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
	if (warmImages) warmLogoImages(doc, state, stores.apps, overview, foreground);
	return true;
}

/** Warm local native caches without starting an unbounded image-fetch wave. */
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
	state.pendingLogoShortcuts = [];
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
			warmNativeShortcutArtwork(doc, current, true);
		}
	}
	state.pendingLogoShortcuts = state.pendingShortcuts.slice(0, MAX_POSITION_KEYS);
	const batch = (): void => {
		state.positionTimer = undefined;
		if (state.disposed) return;
		backgroundWork(doc, state, BACKGROUND_KEYS[0], () => {
			for (const id of state.pendingShortcuts.splice(0, 4)) warmShortcutArtwork(doc, id, false, false);
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
	drainBackgroundLogos(doc, state);
}

/** Route/header synchronization primes the selected game's logo. The native
 * game list has no artwork listeners or React-fiber reads from this feature. */
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
		for (const key of BACKGROUND_KEYS) cancelLibrarySidebarWork(doc, key);
		if (state.positionTimer) clearTimeout(state.positionTimer);
		if (state.retryTimer) clearTimeout(state.retryTimer);
		for (const active of state.activeImages.values()) {
			clearTimeout(active.timer); active.image.onload = active.image.onerror = null; active.image.removeAttribute('src');
		}
		state.activeImages.clear(); state.pendingImages = []; state.pendingShortcuts = []; state.pendingLogoShortcuts = [];
		state.positions.clear(); state.imageUrls.clear(); state.store = undefined; state.stores = undefined;
		state.missingShortcuts.clear();
		states.delete(doc);
	};
	state.dispose = dispose;
	warmMappedNativeArtwork(doc);
	return dispose;
}
