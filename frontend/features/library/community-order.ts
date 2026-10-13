import type { CommunityContentItem } from '../../domain/types';

const MAX_COMMUNITY_ITEMS = 120;
const YOUTUBE_ID = /^[\w-]{11}$/;

function contentUrl(raw: unknown): URL | null {
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const value = raw.trim();
		const url = value.startsWith('/') ? new URL(value, 'https://steamcommunity.com') : new URL(value);
		return ['https:', 'http:', 'steam:'].includes(url.protocol) ? url : null;
	} catch { return null; }
}

function normalizedUrl(url: URL): string {
	const normalized = new URL(url.href);
	if (normalized.protocol === 'http:') normalized.protocol = 'https:';
	normalized.hash = '';
	normalized.searchParams.sort();
	return normalized.href;
}

function steamFileId(url: URL | null): string | null {
	if (!url) return null;
	let raw: string | null = null;
	if (url.protocol === 'steam:') {
		raw = `${url.hostname}${url.pathname}`.match(/^url\/CommunityFilePage\/(\d+)\/?$/i)?.[1] || null;
	} else if ((url.hostname === 'steamcommunity.com' || url.hostname.endsWith('.steamcommunity.com'))
		&& /^\/(?:sharedfiles|workshop)\/filedetails\/?$/i.test(url.pathname)) {
		raw = url.searchParams.get('id');
	}
	if (!raw || !/^\d{1,20}$/.test(raw)) return null;
	const id = raw.replace(/^0+(?=\d)/, '');
	return id !== '0' && BigInt(id) <= 18446744073709551615n ? id : null;
}

function youtubeId(url: URL | null): string | null {
	if (!url) return null;
	const host = url.hostname.toLowerCase(), path = url.pathname.split('/').filter(Boolean);
	let id: string | undefined | null;
	if (host === 'youtu.be') id = path[0];
	else if (host === 'youtube.com' || host.endsWith('.youtube.com')
		|| host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
		id = path[0] === 'watch' ? url.searchParams.get('v')
			: ['embed', 'shorts', 'v', 'vi', 'vi_webp'].includes(path[0]) ? path[1] : null;
	} else if (host === 'i.ytimg.com' || host.endsWith('.ytimg.com')) {
		id = ['vi', 'vi_webp'].includes(path[0]) ? path[1] : null;
	}
	return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Strong Steam/YouTube identities survive language, tracking and subsection
 * URL differences. Image identity is used only when no valid link is present. */
function identityKeys(item: CommunityContentItem): string[] {
	const link = contentUrl(item.link), fileId = steamFileId(link);
	const suppliedVideoId = typeof item.youtube_id === 'string' ? item.youtube_id.trim() : '';
	const videoId = YOUTUBE_ID.test(suppliedVideoId) ? suppliedVideoId : youtubeId(link) || youtubeId(contentUrl(item.image));
	const keys = [fileId ? `steam-file:${fileId}` : '', videoId ? `youtube:${videoId}` : ''].filter(Boolean);
	if (keys.length) return keys;
	if (link) return [`link:${normalizedUrl(link)}`];
	const image = typeof item.image === 'string' ? item.image.trim() : '';
	const imageUrl = contentUrl(image);
	return image ? [`image:${imageUrl ? normalizedUrl(imageUrl) : image}`] : [];
}

/** Mix the available types proportionally without inventing dates or changing
 * the upstream rank within a type. A fixed one-video cycle leaves surplus
 * videos in an artificial tail when the other pools are exhausted. */
export function orderCommunityItems(items: readonly CommunityContentItem[]): CommunityContentItem[] {
	const seen = new Set<string>();
	const pools = new Map<string, { item: CommunityContentItem; rank: number }[]>();
	for (const [rank, item] of items.slice(0, MAX_COMMUNITY_ITEMS).entries()) {
		if (!item || typeof item !== 'object') continue;
		const keys = identityKeys(item);
		const duplicate = keys.some(key => seen.has(key));
		// Retain aliases even for a duplicate, so an item seen later through its
		// YouTube URL still matches the earlier Steam published-file entry.
		for (const key of keys) seen.add(key);
		if (duplicate) continue;
		const kind = ['video', 'guide', 'artwork'].includes(item.type) ? item.type : 'screenshot';
		const pool = pools.get(kind) || [];
		pool.push({ item, rank });
		pools.set(kind, pool);
	}
	return Array.from(pools.values()).flatMap(pool => pool.map((entry, index) => ({
		...entry, midpoint: 2 * index + 1, total: pool.length,
	}))).sort((left, right) => left.midpoint * right.total - right.midpoint * left.total || left.rank - right.rank)
		.map(entry => entry.item);
}
