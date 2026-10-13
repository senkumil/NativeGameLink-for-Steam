const LEGACY_CACHE_TIME = 2147483647;
const DISCOVERY_MS = 3000;
const RETRY_MS = 250;
const SCAN_CHUNK = 1024;
const MAX_REPAIRS = 128;
const installed = new WeakMap<Document, () => void>();
const queuedByMap = new WeakMap<object, Set<number>>();

function legacyPublicEntry(key: unknown, value: any): number | null {
	if (typeof key !== 'number' || !Number.isInteger(key) || key < 1 || key >= 2147483648
		|| !value || value.appid !== key || value.cache_time !== LEGACY_CACHE_TIME) return null;
	const keys = Object.keys(value);
	if (keys.length !== 5 || keys.some(property => !['appid', 'total', 'unlocked', 'percentage', 'cache_time'].includes(property))) return null;
	if (!Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.unlocked)
		|| value.unlocked < 0 || value.unlocked > value.total) return null;
	const percentage = value.total > 0 ? Math.floor(100 * value.unlocked / value.total) : 0;
	return value.percentage === percentage ? key : null;
}

/** Ask Steam to replace only the exact old plugin sentinel shape with its own
 * official progress. No native cache entry, queue or file is modified here. */
export function installLegacyAchievementCacheRepair(doc: Document): () => void {
	const existing = installed.get(doc);
	if (existing) return existing;
	const view = doc.defaultView;
	if (!view || view.closed) return () => {};
	const deadline = Date.now() + DISCOVERY_MS;
	let timer: number | null = null, disposed = false;
	let lastMap: any = null, lastSize = -1;
	let iterator: Iterator<[unknown, unknown]> | null = null;
	let retryAt = 0;
	const failed = new Set<number>();
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (timer !== null) view.clearTimeout(timer);
		timer = null; iterator = null; lastMap = null; failed.clear();
		installed.delete(doc);
	};
	const tick = (): void => {
		timer = null;
		if (disposed) return;
		if (Date.now() >= deadline) { iterator = null; lastMap = null; failed.clear(); return; }
		try {
			if (view.closed || doc.defaultView !== view || (view.document && view.document !== doc)) { dispose(); return; }
			const cache = (view as any).appAchievementProgressCache;
			const map = cache?.m_achievementProgress?.mapCache;
			const queue = cache?.QueueCacheUpdate;
			if (map && typeof map.entries === 'function' && typeof map.size === 'number' && typeof queue === 'function') {
				let queued = queuedByMap.get(map);
				if (!queued) { queued = new Set(); queuedByMap.set(map, queued); }
				if (map !== lastMap || map.size !== lastSize) {
					lastMap = map; lastSize = map.size; iterator = map.entries(); failed.clear();
				}
				const enqueue = (id: number): void => {
					if (queued!.has(id) || queued!.size >= MAX_REPAIRS) return;
					try { queue.call(cache, id); queued!.add(id); failed.delete(id); }
					catch { failed.add(id); }
				};
				if (Date.now() >= retryAt) {
					for (const id of failed) {
						if (legacyPublicEntry(id, map.get?.(id)) !== null) enqueue(id);
						else failed.delete(id);
					}
					retryAt = Date.now() + RETRY_MS;
				}
				for (let count = 0; iterator && count < SCAN_CHUNK && queued.size + failed.size < MAX_REPAIRS; count += 1) {
					const entry = iterator.next();
					if (entry.done) { iterator = null; break; }
					const id = legacyPublicEntry(entry.value[0], entry.value[1]);
					if (id !== null) enqueue(id);
				}
				if (queued.size + failed.size >= MAX_REPAIRS) iterator = null;
				if (queued.size >= MAX_REPAIRS) { iterator = null; failed.clear(); }
			}
		} catch {}
		const remaining = deadline - Date.now();
		if (remaining > 0) timer = view.setTimeout(tick, Math.min(iterator ? 16 : RETRY_MS, remaining));
	};
	installed.set(doc, dispose);
	tick();
	return dispose;
}
