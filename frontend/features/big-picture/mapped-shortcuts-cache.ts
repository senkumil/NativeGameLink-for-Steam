import { getMappingsRevision } from '../../core/mappings';
import { getMappedShortcuts } from '../../steam/shortcuts';
import type { MappedShortcut } from './types';

interface CachedMappedShortcuts {
	revision: number;
	expiresAt: number;
	items: MappedShortcut[];
}

const CACHE_MS = 1000;
const cache = new WeakMap<Document, CachedMappedShortcuts>();

/** Big Picture can request the same mapping projection several times in one
 * mutation burst. Cache it briefly per CEF document while mappings are stable. */
export function getBigPictureMappedShortcuts(doc: Document): MappedShortcut[] {
	const now = Date.now();
	const revision = getMappingsRevision();
	const current = cache.get(doc);
	if (current && current.revision === revision && current.expiresAt > now) return current.items;
	const items = getMappedShortcuts(doc);
	cache.set(doc, { revision, expiresAt: now + CACHE_MS, items });
	return items;
}

export function invalidateBigPictureMappedShortcuts(doc?: Document | null): void {
	if (doc) cache.delete(doc);
}
