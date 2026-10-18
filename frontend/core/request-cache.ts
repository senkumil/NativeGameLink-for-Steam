/**
 * Small, per-renderer request cache for data that is safe to reuse briefly.
 *
 * It intentionally never stores failed or null responses.  A transient IPC or
 * network failure must be allowed to recover on the next library pass instead
 * of making Steam need a restart.  Concurrent callers share only the in-flight
 * promise; successful responses receive a short TTL.
 */
export interface RequestCacheOptions<T> {
	ttlMs: number;
	retries?: number;
	baseDelayMs?: number;
	maxEntries?: number;
	isCacheable?: (value: T | null) => value is T;
}

interface CachedValue<T> {
	value: T;
	expiresAt: number;
	lastAccessAt: number;
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class RetryingRequestCache<T> {
	private readonly values = new Map<string, CachedValue<T>>();
	private readonly inFlight = new Map<string, Promise<T | null>>();
	private clearEpoch = 0;
	// Tokens belong only to active requests. Retaining invalidation tombstones
	// forever would grow with every relinked or evicted game in a long session.
	private readonly keyEpochs = new Map<string, object>();

	constructor(private readonly options: RequestCacheOptions<T>) {}

	async get(key: string, loader: () => Promise<T | null>): Promise<T | null> {
		const cached = this.values.get(key);
		if (cached) {
			if (cached.expiresAt > Date.now()) {
				cached.lastAccessAt = Date.now();
				return cached.value;
			}
			this.values.delete(key);
		}
		const active = this.inFlight.get(key);
		if (active) return active;

		const requestClearEpoch = this.clearEpoch;
		const requestKeyEpoch = {};
		this.keyEpochs.set(key, requestKeyEpoch);
		const isCurrent = (): boolean => requestClearEpoch === this.clearEpoch
			&& requestKeyEpoch === this.keyEpochs.get(key);
		let request!: Promise<T | null>;
		request = this.loadWithRetry(loader, isCurrent)
			.then(value => {
				// Invalidating a key must also invalidate the result observed by its
				// original caller. Otherwise an old AppID can still repaint the page
				// even though the value was correctly kept out of this cache.
				if (!isCurrent()) return null;
				if (this.isCacheable(value)) {
					const now = Date.now();
					this.values.set(key, { value, expiresAt: now + this.options.ttlMs, lastAccessAt: now });
					this.prune();
				}
				return value;
			})
			.finally(() => {
				// A cache clear can start a newer request for the same key. An older
				// request must not remove that newer in-flight deduplication entry.
				if (this.inFlight.get(key) === request) this.inFlight.delete(key);
				if (this.keyEpochs.get(key) === requestKeyEpoch) this.keyEpochs.delete(key);
			});
		if (isCurrent()) this.inFlight.set(key, request);
		return request;
	}

	peek(key: string): T | null {
		const cached = this.values.get(key);
		if (!cached) return null;
		if (cached.expiresAt <= Date.now()) {
			this.values.delete(key);
			return null;
		}
		cached.lastAccessAt = Date.now();
		return cached.value;
	}

	clear(): void {
		this.values.clear();
		this.clearEpoch += 1;
		this.keyEpochs.clear();
		// Existing requests are deliberately allowed to settle, but their result
		// cannot be retained after this generation is invalidated.
		this.inFlight.clear();
	}

	/** Drop one key without retaining a late result from a request started before it. */
	invalidate(key: string): void {
		this.values.delete(key);
		this.keyEpochs.delete(key);
		this.inFlight.delete(key);
	}

	/** Invalidate only matching resources without cancelling unrelated requests. */
	invalidateMatching(predicate: (key: string) => boolean): void {
		const keys = new Set<string>([
			...this.values.keys(),
			...this.inFlight.keys(),
			...this.keyEpochs.keys(),
		]);
		for (const key of keys) {
			if (predicate(key)) this.invalidate(key);
		}
	}

	private isCacheable(value: T | null): value is T {
		return this.options.isCacheable ? this.options.isCacheable(value) : value !== null;
	}

	private prune(): void {
		const now = Date.now();
		for (const [key, value] of this.values) {
			if (value.expiresAt <= now) this.values.delete(key);
		}
		const maxEntries = Math.max(1, this.options.maxEntries ?? 64);
		if (this.values.size <= maxEntries) return;
		const oldest = Array.from(this.values.entries()).sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt);
		for (const [key] of oldest) {
			if (this.values.size <= maxEntries) break;
			this.values.delete(key);
		}
	}

	private async loadWithRetry(loader: () => Promise<T | null>, isCurrent: () => boolean): Promise<T | null> {
		const retries = Math.max(0, this.options.retries ?? 2);
		const baseDelay = Math.max(0, this.options.baseDelayMs ?? 120);
		let lastError: unknown = null;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			if (!isCurrent()) return null;
			// Only an error from the final attempt is meaningful to the caller. A
			// later, clean null response means "no data", not a stale IPC failure.
			lastError = null;
			try {
				const value = await loader();
				if (!isCurrent()) return null;
				if (value !== null) return value;
			} catch (error) {
				lastError = error;
			}
			if (attempt < retries) {
				await wait(baseDelay * (2 ** attempt));
				if (!isCurrent()) return null;
			}
		}
		if (lastError) throw lastError;
		return null;
	}
}
