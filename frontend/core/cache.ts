export const CACHE_PREFIX = 'gdl_cache_';

export const CACHE_TTL = {
	default: 30 * 24 * 60 * 60 * 1000,
	gameMetadata: 30 * 24 * 60 * 60 * 1000,
	libraryAssets: 30 * 24 * 60 * 60 * 1000,
	communityItems: 24 * 60 * 60 * 1000,
	communityContent: 2 * 60 * 60 * 1000,
	news: 30 * 60 * 1000,
	friends: 5 * 60 * 1000,
} as const;

export const CACHE_RETENTION = {
	default: 30 * 24 * 60 * 60 * 1000,
	gameMetadata: 90 * 24 * 60 * 60 * 1000,
	libraryAssets: 90 * 24 * 60 * 60 * 1000,
	communityItems: 7 * 24 * 60 * 60 * 1000,
	communityContent: 24 * 60 * 60 * 1000,
	news: 24 * 60 * 60 * 1000,
	friends: 60 * 60 * 1000,
} as const;

interface CacheEntry<T> {
	version: 1;
	ts: number;
	accessedAt?: number;
	data: T;
}

export interface CacheReadResult<T> {
	data: T;
	ageMs: number;
	fresh: boolean;
}

// Chromium localStorage commonly has a five MiB quota. Keep a conservative
// ceiling and reserve the space by resource importance: core metadata/assets
// must survive a large linked library before transient feed/sidebar payloads.
const CACHE_MAX_ENTRIES = 320;
const CACHE_MAX_BYTES = Math.floor(4.25 * 1024 * 1024);
let lastPruneAt = 0;
let pruneTimer: ReturnType<typeof setTimeout> | null = null;
let pruneIdleHandle: number | null = null;
let maintenanceGeneration = 0;
let protectedCoreAppIds = new Set<string>();

export function setProtectedCacheAppIds(appIds: Iterable<string | number>): void {
	protectedCoreAppIds = new Set(Array.from(appIds, value => String(value)).filter(value => /^\d+$/.test(value)));
}

function cacheAppId(key: string): string {
	return key.match(/^gamedata_v\d+_(\d+)_/)?.[1]
		|| key.match(/^library_assets_v\d+_.+_(\d+)$/)?.[1]
		|| key.match(/^community_items_v\d+_.+_(\d+)$/)?.[1]
		|| key.match(/^(?:events\d+|community\d+)_.+_(\d+)$/)?.[1]
		|| '';
}

function cachePriority(storageKey: string): number {
	const key = storageKey.startsWith(CACHE_PREFIX) ? storageKey.slice(CACHE_PREFIX.length) : storageKey;
	if (key.startsWith('gamedata_v') || key.startsWith('library_assets_v')) {
		return protectedCoreAppIds.has(cacheAppId(key)) ? 6 : 4;
	}
	if (key.startsWith('community_items_v')) return protectedCoreAppIds.has(cacheAppId(key)) ? 5 : 3;
	if (/^events\d+_/.test(key)) return protectedCoreAppIds.has(cacheAppId(key)) ? 3 : 0;
	if (key.startsWith('friends_')) return 2;
	if (/^community\d+_/.test(key)) return protectedCoreAppIds.has(cacheAppId(key)) ? 2 : 1;
	return 0;
}

function cacheRetentionMs(storageKey: string): number {
	const key = storageKey.startsWith(CACHE_PREFIX) ? storageKey.slice(CACHE_PREFIX.length) : storageKey;
	if (key.startsWith('gamedata_v')) return CACHE_RETENTION.gameMetadata;
	if (key.startsWith('library_assets_v')) return CACHE_RETENTION.libraryAssets;
	if (key.startsWith('community_items_v')) return CACHE_RETENTION.communityItems;
	if (/^community\d+_/.test(key)) return CACHE_RETENTION.communityContent;
	if (/^events\d+_/.test(key)) return CACHE_RETENTION.news;
	if (key.startsWith('friends_')) return CACHE_RETENTION.friends;
	return CACHE_RETENTION.default;
}

/** Bound persistent data owned by NativeGameLink so long-running Steam sessions do
 * not accumulate one metadata/news/community object for every visited game. */
export function pruneCacheStorage(maxEntries = CACHE_MAX_ENTRIES, maxBytes = CACHE_MAX_BYTES): void {
	try {
		const candidates: Array<{ key: string; ts: number; recency: number; bytes: number; priority: number }> = [];
		for (let index = 0; index < localStorage.length; index += 1) {
			const key = localStorage.key(index);
			if (!key?.startsWith(CACHE_PREFIX)) continue;
			const raw = localStorage.getItem(key) || '';
			let ts = 0;
			let recency = 0;
			try {
				const entry = JSON.parse(raw) as Partial<CacheEntry<unknown>>;
				ts = Number(entry.ts || 0);
				recency = Number(entry.accessedAt || ts);
			} catch {}
			if (!Number.isFinite(ts) || ts <= 0 || Date.now() - ts > cacheRetentionMs(key)) {
				localStorage.removeItem(key);
				index -= 1;
				continue;
			}
			candidates.push({ key, ts, recency, bytes: raw.length * 2, priority: cachePriority(key) });
		}
		candidates.sort((a, b) => b.priority - a.priority || b.recency - a.recency);
		let retainedBytes = 0;
		for (let index = 0; index < candidates.length; index += 1) {
			const candidate = candidates[index];
			retainedBytes += candidate.bytes;
			if (index >= maxEntries || retainedBytes > maxBytes) localStorage.removeItem(candidate.key);
		}
		lastPruneAt = Date.now();
	} catch {}
}

function scheduleCachePrune(): void {
	if (pruneTimer || Date.now() - lastPruneAt <= 30000) return;
	const generation = maintenanceGeneration;
	const run = (): void => {
		if (generation !== maintenanceGeneration) return;
		pruneTimer = null;
		pruneIdleHandle = null;
		if (Date.now() - lastPruneAt > 30000) pruneCacheStorage();
	};
	const requestIdle = (globalThis as typeof globalThis & {
		requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
	}).requestIdleCallback;
	if (requestIdle) {
		pruneIdleHandle = requestIdle(run, { timeout: 1500 });
		// A non-null sentinel is enough; requestIdleCallback owns the callback.
		pruneTimer = -1 as unknown as ReturnType<typeof setTimeout>;
		return;
	}
	pruneTimer = setTimeout(run, 50);
}

/** Release maintenance callbacks when the plugin is disabled or reloaded. */
export function disposeCacheMaintenance(): void {
	maintenanceGeneration += 1;
	if (pruneIdleHandle !== null) {
		(globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void })
			.cancelIdleCallback?.(pruneIdleHandle);
	} else if (pruneTimer !== null) clearTimeout(pruneTimer);
	pruneTimer = null;
	pruneIdleHandle = null;
	protectedCoreAppIds.clear();
}

export function cacheRead<T>(key: string, ttlMs = CACHE_TTL.default,
	maxAgeMs = CACHE_TTL.default): CacheReadResult<T> | null {
	try {
		const storageKey = CACHE_PREFIX + key;
		const raw = localStorage.getItem(storageKey);
		if (!raw) return null;
		const entry = JSON.parse(raw) as Partial<CacheEntry<T>>;
		if (entry.version !== 1 || !Number.isFinite(Number(entry.ts))) {
			localStorage.removeItem(storageKey);
			return null;
		}
		const ageMs = Math.max(0, Date.now() - Number(entry.ts));
		if (ageMs > maxAgeMs) {
			localStorage.removeItem(storageKey);
			return null;
		}
		// Persist recency at most once per hour so pruning is true LRU across
		// Steam restarts without turning frequent renders into write churn.
		if (Date.now() - Number(entry.accessedAt || entry.ts) > 60 * 60 * 1000) {
			entry.accessedAt = Date.now();
			try { localStorage.setItem(storageKey, JSON.stringify(entry)); } catch {}
		}
		return { data: entry.data as T, ageMs, fresh: ageMs <= ttlMs };
	} catch { return null; }
}

/** Read only a fresh value. An otherwise valid stale entry stays persisted so
 * callers that implement stale-while-revalidate can keep the UI stable. */
export function cacheGet<T>(key: string, ttlMs = CACHE_TTL.default): T | null {
	const entry = cacheRead<T>(key, ttlMs);
	return entry?.fresh ? entry.data : null;
}

/** Read the last valid snapshot regardless of its resource freshness. */
export function cachePeek<T>(key: string, maxAgeMs = CACHE_TTL.default): T | null {
	return cacheRead<T>(key, 0, maxAgeMs)?.data ?? null;
}

export function cacheSet<T>(key: string, data: T): void {
	// Pruning scans and parses every plugin-owned entry. Keep that work off the
	// synchronous rendering/write path; quota recovery below remains immediate.
	scheduleCachePrune();
	const storageKey = CACHE_PREFIX + key;
	const entry: CacheEntry<T> = { version: 1, ts: Date.now(), accessedAt: Date.now(), data };
	let raw = '';
	try { raw = JSON.stringify(entry); } catch { return; }
	try {
		localStorage.setItem(storageKey, raw);
	} catch {
		// Quota pressure can be recovered without affecting Steam-owned keys.
		pruneCacheStorage(240, Math.floor(3.5 * 1024 * 1024));
		try {
			localStorage.setItem(storageKey, raw);
			pruneCacheStorage();
		} catch {}
	}
}

export function cacheDelete(key: string): void {
	try { localStorage.removeItem(CACHE_PREFIX + key); } catch {}
}

/** Remove a family of plugin-owned entries without touching Steam storage. */
export function cacheDeleteMatching(predicate: (key: string) => boolean): void {
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const storageKey = localStorage.key(index);
			if (!storageKey?.startsWith(CACHE_PREFIX)) continue;
			const key = storageKey.slice(CACHE_PREFIX.length);
			if (predicate(key)) localStorage.removeItem(storageKey);
		}
	} catch {}
}
