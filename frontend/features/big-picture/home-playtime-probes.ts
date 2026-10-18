/** Steam exposes no cancellation for GetPlaytime. Bound outstanding IPC by
 * shortcut and document, including calls that never settle after our deadline. */
interface Probe {
	pending: boolean;
	expiresAt: number;
	request: Promise<number | null>;
	timer: ReturnType<typeof setTimeout> | null;
	resolve: ((value: number | null) => void) | null;
}
const probes = new WeakMap<Document, Map<number, Probe>>();
const MAX_PENDING_PROBES = 4, MAX_CACHED_PROBES = 32, PROBE_TIMEOUT_MS = 800, CACHE_MS = 15000;

export function cancelBigPictureHomePlaytimeProbes(doc: Document | null): void {
	if (!doc) return;
	for (const probe of probes.get(doc)?.values() || []) {
		if (probe.timer !== null) clearTimeout(probe.timer);
		probe.timer = null;
		probe.resolve?.(null); probe.resolve = null;
	}
}

export function readBigPictureShortcutPlaytime(doc: Document, id: number): Promise<number | null> {
	const view = doc.defaultView, apps = (view as any)?.SteamClient?.Apps;
	if (!view || view.closed || view.document !== doc || typeof apps?.GetPlaytime !== 'function') return Promise.resolve(null);
	let cache = probes.get(doc);
	if (!cache) probes.set(doc, cache = new Map());
	const now = Date.now(), previous = cache.get(id);
	if (previous && (previous.pending || now < previous.expiresAt)) return previous.request;
	if (previous) cache.delete(id);
	if ([...cache.values()].filter(probe => probe.pending).length >= MAX_PENDING_PROBES) return Promise.resolve(null);
	for (const [key, probe] of cache) if (!probe.pending && (probe.expiresAt <= now || cache.size >= MAX_CACHED_PROBES)) cache.delete(key);
	const probe: Probe = { pending: true, expiresAt: now + CACHE_MS, request: Promise.resolve(null), timer: null, resolve: null };
	probe.request = new Promise(resolve => { probe.resolve = resolve; });
	cache.set(id, probe);
	probe.timer = setTimeout(() => { probe.timer = null; probe.resolve?.(null); probe.resolve = null; }, PROBE_TIMEOUT_MS);
	// Both representations share one deadline and at most four shortcuts may
	// remain in flight. A timed-out SDK call is never duplicated by refreshes.
	void Promise.all([id, id | 0].map(async value => {
		try {
			const data = await apps.GetPlaytime(value), minutes = Number(data?.nPlaytimeForever ?? data?.minutes_playtime_forever ?? 0);
			return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
		} catch { return 0; }
	})).then(values => {
		const minutes = Math.max(...values), result = minutes > 0 ? minutes : null;
		probe.pending = false; probe.expiresAt = Date.now() + CACHE_MS;
		if (probe.timer !== null) clearTimeout(probe.timer);
		probe.timer = null;
		probe.resolve?.(result); probe.resolve = null;
		probe.request = Promise.resolve(result);
	});
	return probe.request;
}
