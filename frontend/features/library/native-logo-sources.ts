import { readShortcutLogoInventoryBackend } from '../../api/backend';
import { isMappingSnapshotVerified, mappings, shortcutMappingKey, subscribeMappings } from '../../core/mappings';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';

const MAX_ENTRIES = 128;
type InventoryRequest = { shortcut_app_id: string; steam_app_id: string; native_mtime: number };
type Evidence = { steamAppId: string; mtime: number };
type Bridge = {
	apps: any; original: Function; descriptor?: PropertyDescriptor; wrapper: Function;
	owners: Set<object>; evidence: Map<number, Evidence>; arrays: Map<string, string[]>;
	signature: string; generation: number; requested: boolean;
	pending?: Promise<void>; pendingGeneration?: number; refreshQueued: boolean; scheduled: boolean;
	incomplete: boolean; failed: boolean; failureRetries: number;
};
type Owner = { bridge: Bridge; dispose: () => void };
const bridges = new WeakMap<object, Bridge>();
const owners = new WeakMap<Document, Owner>();

function unsignedId(raw: unknown): number | null {
	const id = Number(raw), unsigned = id < 0 ? id >>> 0 : id;
	return Number.isInteger(id) && id >= -2147483648 && id <= 4294967295 && unsigned >= 2147483648 ? unsigned : null;
}

function exactMapping(id: number): string | null {
	const value = mappings[shortcutMappingKey(id)] || mappings[shortcutMappingKey(id - 4294967296)];
	return /^\d+$/.test(String(value || '')) ? String(value) : null;
}

function overviewById(apps: any, id: number): any {
	try { return apps.GetAppOverviewByAppID(id) || apps.GetAppOverviewByAppID(id - 4294967296); } catch { return null; }
}

function requestBatch(bridge: Bridge): InventoryRequest[] {
	bridge.incomplete = false;
	if (!isMappingSnapshotVerified()) return [];
	const result: InventoryRequest[] = [], seen = new Set<number>();
	for (const key of Object.keys(mappings)) {
		if (!key.startsWith('shortcut:')) continue;
		const id = unsignedId(key.slice(9));
		if (id === null || seen.has(id)) continue;
		seen.add(id);
		const steamAppId = exactMapping(id), overview = overviewById(bridge.apps, id), mtime = Number(overview?.rt_custom_image_mtime);
		if (!steamAppId) continue;
		if (unsignedId(overview?.appid) !== id || !Number.isFinite(mtime)) { bridge.incomplete = true; continue; }
		// Zero can be either no custom artwork or a not-yet-hydrated native
		// field. Readiness checks stop after the warmup's three startup retries.
		if (mtime <= 0) { bridge.incomplete = true; continue; }
		result.push({ shortcut_app_id: String(id), steam_app_id: steamAppId, native_mtime: mtime });
		if (result.length >= MAX_ENTRIES) break;
	}
	return result.sort((left, right) => Number(left.shortcut_app_id) - Number(right.shortcut_app_id));
}

function refreshBridge(bridge: Bridge): Promise<void> {
	if (!bridge.owners.size) return Promise.resolve();
	const batch = requestBatch(bridge), signature = JSON.stringify(batch);
	if (bridge.pending) {
		if (bridge.pendingGeneration !== bridge.generation || signature !== bridge.signature) bridge.refreshQueued = true;
		return bridge.pending;
	}
	if (bridge.signature === signature) return Promise.resolve();
	bridge.signature = signature;
	if (!batch.length) return Promise.resolve();
	bridge.requested = true;
	bridge.failed = false;
	const generation = bridge.generation;
	bridge.pendingGeneration = generation;
	const pending = Promise.resolve().then(() => readShortcutLogoInventoryBackend({ request_json: JSON.stringify({ shortcuts: batch }) }))
		.then(raw => {
			const response = typeof raw === 'string' ? JSON.parse(raw) : raw;
			if (generation !== bridge.generation || !bridge.owners.size || !isMappingSnapshotVerified()) return;
			if (response?.ok !== true || !Array.isArray(response.entries)) throw new Error('Native logo inventory unavailable');
			const requested = new Map(batch.map(item => [item.shortcut_app_id, item]));
			for (const item of batch) bridge.evidence.delete(Number(item.shortcut_app_id));
			for (const entry of response.entries.slice(0, MAX_ENTRIES)) {
				const request = requested.get(String(entry?.shortcut_app_id));
				if (!request || entry.steam_app_id !== request.steam_app_id || Number(entry.requested_native_mtime) !== request.native_mtime
					|| entry.png_exists !== true || entry.jpg_exists !== false) continue;
				const id = Number(request.shortcut_app_id), current = overviewById(bridge.apps, id);
				// Bind the filesystem observation to the real native version captured
				// before IPC and rechecked afterward; filesystem timestamps are not
				// interchangeable with Steam's rt_custom_image_mtime.
				if (exactMapping(id) !== request.steam_app_id || Number(current?.rt_custom_image_mtime) !== request.native_mtime) continue;
				bridge.evidence.set(id, { steamAppId: request.steam_app_id, mtime: request.native_mtime });
			}
			bridge.arrays.clear();
		}).catch(() => {
			if (generation === bridge.generation && bridge.owners.size) bridge.failed = true;
		}).finally(() => {
			if (bridge.pending === pending) bridge.pending = undefined;
			if (bridge.refreshQueued && bridge.owners.size) { bridge.refreshQueued = false; void refreshBridge(bridge); }
		});
	bridge.pending = pending;
	return pending;
}

function invalidateAndRefresh(bridge: Bridge): void {
	if (bridge.scheduled || !bridge.owners.size) return;
	bridge.scheduled = true;
	bridge.generation++;
	bridge.signature = '';
	bridge.failed = false; bridge.failureRetries = 0;
	bridge.evidence.clear(); bridge.arrays.clear();
	void Promise.resolve().then(() => {
		bridge.scheduled = false;
		if (bridge.owners.size) void refreshBridge(bridge);
	});
}

function candidate(url: unknown, id: number, ext: string, mtime: number): boolean {
	if (typeof url !== 'string') return false;
	try {
		const parsed = new URL(url, 'https://steamloopback.host');
		return parsed.origin === 'https://steamloopback.host' && parsed.pathname === `/customimages/${id}_logo.${ext}`
			&& parsed.searchParams.get('v') === String(mtime);
	} catch { return false; }
}

function createBridge(apps: any): Bridge | null {
	if (typeof apps?.GetCustomLogoImageURLs !== 'function' || typeof apps?.GetAppOverviewByAppID !== 'function') return null;
	const original = apps.GetCustomLogoImageURLs;
	const descriptor = Object.getOwnPropertyDescriptor(apps, 'GetCustomLogoImageURLs');
	const bridge: Bridge = {
		apps, original, descriptor, wrapper: original, owners: new Set(), evidence: new Map(), arrays: new Map(),
		signature: '', generation: 0, requested: false, refreshQueued: false, scheduled: false,
		incomplete: false, failed: false, failureRetries: 0,
	};
	bridge.wrapper = function (this: any, ...args: any[]): any {
		const urls = original.apply(this, args), overview = args[0], id = unsignedId(overview?.appid);
		if (!isMappingSnapshotVerified() || id === null || !Array.isArray(urls)) return urls;
		const evidence = bridge.evidence.get(id);
		if (!evidence) return urls;
		if (exactMapping(id) !== evidence.steamAppId || Number(overview?.rt_custom_image_mtime) !== evidence.mtime) {
			bridge.evidence.delete(id); bridge.arrays.clear(); return urls;
		}
		if (overviewById(apps, id) !== overview) return urls;
		const png = urls.findIndex(url => candidate(url, id, 'png', evidence.mtime));
		const jpg = urls.findIndex(url => candidate(url, id, 'jpg', evidence.mtime));
		if (png <= 0 || jpg < 0 || png < jpg) return urls;
		const key = `${id}:${evidence.mtime}:${JSON.stringify(urls)}`;
		const cached = bridge.arrays.get(key);
		if (cached) return cached;
		const reordered = urls.slice(); reordered.unshift(...reordered.splice(png, 1));
		bridge.arrays.set(key, reordered);
		while (bridge.arrays.size > MAX_ENTRIES) bridge.arrays.delete(bridge.arrays.keys().next().value!);
		return reordered;
	};
	try { Object.defineProperty(apps, 'GetCustomLogoImageURLs', { configurable: true, writable: true, enumerable: descriptor?.enumerable || false, value: bridge.wrapper }); }
	catch { return null; }
	bridges.set(apps, bridge);
	return bridge;
}

function resolveApps(doc: Document): any {
	const global = (doc.defaultView as any)?.appStore;
	if (typeof global?.GetCustomLogoImageURLs === 'function') return global;
	try {
		steamWebpackRuntime.captureRuntime(doc);
		return steamWebpackRuntime.getRequire(doc)?.(1776)?.tw || null;
	} catch { return null; }
}

/** Install a pure native source-order adapter before warming any logo. */
export function installNativeLogoSources(doc: Document, suppliedApps?: any): () => void {
	const apps = suppliedApps || resolveApps(doc), existing = owners.get(doc);
	if (existing?.bridge.apps === apps) {
		if (!existing.bridge.requested) void refreshBridge(existing.bridge);
		return existing.dispose;
	}
	existing?.dispose();
	if (!apps) return () => {};
	let bridge = bridges.get(apps);
	if (bridge && apps.GetCustomLogoImageURLs !== bridge.wrapper) return () => {};
	bridge ||= createBridge(apps);
	if (!bridge) return () => {};
	const ownedBridge = bridge, owner = {};
	ownedBridge.owners.add(owner);
	const refresh = (): void => invalidateAndRefresh(ownedBridge);
	const unsubscribe = subscribeMappings(refresh);
	doc.defaultView?.addEventListener?.('gdl:artwork-changed', refresh);
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		unsubscribe(); doc.defaultView?.removeEventListener?.('gdl:artwork-changed', refresh);
		owners.delete(doc); ownedBridge.owners.delete(owner);
		if (ownedBridge.owners.size) return;
		ownedBridge.generation++;
		ownedBridge.evidence.clear(); ownedBridge.arrays.clear();
		if (apps.GetCustomLogoImageURLs === ownedBridge.wrapper) {
			if (ownedBridge.descriptor) Object.defineProperty(apps, 'GetCustomLogoImageURLs', ownedBridge.descriptor);
			else delete apps.GetCustomLogoImageURLs;
		}
		bridges.delete(apps);
	};
	owners.set(doc, { bridge: ownedBridge, dispose });
	void refreshBridge(ownedBridge);
	return dispose;
}

/** Explicit artwork/mapping changes can request a new batch; navigation cannot. */
export function refreshNativeLogoInventory(doc: Document): void {
	const bridge = owners.get(doc)?.bridge;
	if (bridge) invalidateAndRefresh(bridge);
}

/** Called only by the bounded startup/store-readiness warmup, never a getter. */
export async function refreshNativeLogoInventoryReadiness(doc: Document): Promise<boolean> {
	const bridge = owners.get(doc)?.bridge;
	if (!bridge) return false;
	if (!bridge.pending && bridge.failed && bridge.failureRetries < 2) {
		bridge.failureRetries++;
		bridge.signature = '';
	}
	await refreshBridge(bridge);
	return owners.get(doc)?.bridge === bridge && (bridge.incomplete || (bridge.failed && bridge.failureRetries < 2));
}
