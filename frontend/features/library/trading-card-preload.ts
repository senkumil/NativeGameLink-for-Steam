interface PreloadedArtwork {
	image: HTMLImageElement;
	timer: ReturnType<typeof setTimeout>;
}

// Full-size card art is often 1920x1080 or larger. Bound decoded pixels,
// rather than retaining 120 images merely because their URLs are small.
const MAX_PRELOADS = 2;
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const PRELOAD_TTL_MS = 15_000;
const preloads = new WeakMap<Document, Map<string, PreloadedArtwork>>();

function release(cache: Map<string, PreloadedArtwork>, url: string): void {
	const entry = cache.get(url);
	if (!entry) return;
	cache.delete(url);
	clearTimeout(entry.timer);
	entry.image.onload = null;
	entry.image.onerror = null;
	entry.image.removeAttribute('src');
}

function prune(cache: Map<string, PreloadedArtwork>): void {
	let bytes = 0;
	for (const { image } of cache.values()) bytes += image.naturalWidth * image.naturalHeight * 4;
	while (cache.size > MAX_PRELOADS || bytes > MAX_DECODED_BYTES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const { image } = cache.get(oldest)!;
		bytes -= image.naturalWidth * image.naturalHeight * 4;
		release(cache, oldest);
	}
}

export function getTradingCardPreload(doc: Document, url: string): HTMLImageElement | undefined {
	const cache = preloads.get(doc);
	const entry = cache?.get(url);
	if (!cache || !entry) return undefined;
	cache.delete(url);
	cache.set(url, entry);
	return entry.image;
}

/** Warm only artwork the user is interacting with, in its owning CEF realm. */
export function preloadTradingCardImage(doc: Document, url: string): void {
	if (!url || getTradingCardPreload(doc, url)) return;
	let cache = preloads.get(doc);
	if (!cache) { cache = new Map(); preloads.set(doc, cache); }
	const ownedCache = cache;
	const image = doc.createElement('img');
	image.decoding = 'async';
	const entry = { image, timer: setTimeout(() => release(ownedCache, url), PRELOAD_TTL_MS) };
	ownedCache.set(url, entry);
	prune(ownedCache);
	image.onload = () => prune(ownedCache);
	image.onerror = () => release(ownedCache, url);
	image.src = url;
}

export function clearTradingCardPreloads(doc: Document): void {
	const cache = preloads.get(doc);
	if (!cache) return;
	for (const url of cache.keys()) release(cache, url);
	preloads.delete(doc);
}
