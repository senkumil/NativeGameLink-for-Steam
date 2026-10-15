import type { CommunityContentItem, NewsItem, SteamGameData } from '../../domain/types';
import { backendLog, fetchCommunityContentBackend, fetchNewsBackend, fetchPartnerEventsBackend } from '../../api/backend';
import { CACHE_RETENTION, CACHE_TTL, cacheDeleteMatching, cacheGet, cacheRead, cacheSet } from '../../core/cache';
import { RetryingRequestCache } from '../../core/request-cache';
import { getGameData, getSynchronousGameData } from '../../core/game-data';
import { gdlText, getSteamLanguage, loc, steamIntlLocale, steamLanguageSync } from '../../steam/localization';
import { orderCommunityItems } from './community-order';

// A partially available legacy feed is still a useful last-known-good snapshot.
// Keep transient failures in memory briefly so revisiting a game does not launch
// the same four requests again, while allowing recovery much sooner than the
// normal persistent-news TTL.
const TRANSIENT_NEWS_RETRY_MS = 2 * 60 * 1000;
const communityRequests = new RetryingRequestCache<CommunityContentItem[]>({
	ttlMs: CACHE_TTL.communityContent,
	retries: 1,
	baseDelayMs: 250,
	maxEntries: 96,
	isCacheable: (value): value is CommunityContentItem[] => Array.isArray(value),
});
const newsRequests = new RetryingRequestCache<NewsItem[]>({
	ttlMs: TRANSIENT_NEWS_RETRY_MS,
	retries: 1,
	baseDelayMs: 300,
	maxEntries: 128,
	isCacheable: (value): value is NewsItem[] => Array.isArray(value),
});

export type NewsProgressCallback = (items: NewsItem[]) => void;
type NewsSourceResult = { raw: string; ok: boolean };
type NewsProgress = { listeners: Set<NewsProgressCallback>; latest: NewsItem[] | null; signature: string };
// These are subscribers to current requests, never another persistent cache.
const pendingNewsProgress = new Map<string, NewsProgress>();
const MAX_PROGRESS_REQUESTS = 128;
const MAX_PROGRESS_LISTENERS = 32;

function notifyNewsListener(listener: NewsProgressCallback, items: NewsItem[]): void {
	try { listener(items); } catch {}
}

function newsProgressFor(key: string): NewsProgress {
	let state = pendingNewsProgress.get(key);
	if (!state) {
		state = { listeners: new Set(), latest: null, signature: '' };
		pendingNewsProgress.set(key, state);
		while (pendingNewsProgress.size > MAX_PROGRESS_REQUESTS) {
			const oldest = pendingNewsProgress.keys().next().value!;
			pendingNewsProgress.get(oldest)?.listeners.clear();
			pendingNewsProgress.delete(oldest);
		}
	}
	return state;
}

function publishNewsProgress(key: string, state: NewsProgress, items: NewsItem[]): void {
	if (pendingNewsProgress.get(key) !== state || items.length === 0) return;
	const signature = JSON.stringify(items);
	if (state.signature === signature) return;
	state.latest = items; state.signature = signature;
	for (const listener of Array.from(state.listeners)) notifyNewsListener(listener, items);
}

function isMetadataNewsFallback(item: NewsItem): boolean {
	return /^gdl-steam-(?:release|metadata)-/.test(String(item.gid || '')) && item.feedname === 'steam_store_release_metadata';
}

/** Merge completed sources in language/source order rather than arrival order.
 * Pending or failed siblings keep the last known posts in a partial snapshot. */
function availableNewsSources(steamAppId: string, preferredLanguage: string, results: (NewsSourceResult | undefined)[]):
	{ items: NewsItem[]; hadTransportFailure: boolean } {
	const parsed = results.map(result => {
		try { return result ? JSON.parse(result.raw) : { items: [], transient_error: true }; }
		catch { return { items: [], transient_error: true }; }
	});
	const [preferred, english, announcements, englishAnnouncements] = parsed;
	const hadTransportFailure = results.some(result => !result?.ok)
		|| parsed.some(value => value?.transient_error === true || Boolean(value?.error));
	const partnerItems = [
		...(Array.isArray(preferred?.items) ? preferred.items : []),
		...(Array.isArray(english?.items) ? english.items : []),
	];
	const officialAnnouncements = [
		...(Array.isArray(announcements?.items) ? announcements.items : []),
		...(Array.isArray(englishAnnouncements?.items) ? englishAnnouncements.items : []),
	].filter(item => {
		const feedname = String(item?.feedname || '').toLowerCase();
		if (feedname && !['steam_community_announcements', 'steam_store_release_metadata', 'steam_release'].includes(feedname)) return false;
		try {
			const url = new URL(String(item?.url || ''));
			return /^https?:$/.test(url.protocol) && ['steampowered.com', 'steamcommunity.com']
				.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
		} catch { return false; }
	});
	const items: NewsItem[] = [
		...partnerItems.map((item: any) => ({
			gid: String(item.gid || ''), title: item.title || '',
			url: `https://store.steampowered.com/news/app/${steamAppId}/view/${item.gid || ''}`,
			contents: item.contents || '', date: item.date || 0,
			event_type: item.event_type || 0, image: item.image || '',
		})),
		...officialAnnouncements.map((item: any) => {
			const feedLabel = String(item.feedlabel || ''), feedName = String(item.feedname || '').toLowerCase();
			const historicalCommunity = Boolean(item.historical_community) || /^Steam Community(?:\s|·|$)/i.test(feedLabel);
			const isReleaseFeed = feedName === 'steam_release' || feedName === 'steam_store_release_metadata';
			return { ...item, gid: String(item.gid || ''), title: item.title || '', contents: item.contents || '', date: Number(item.date || 0),
				event_type: historicalCommunity ? 0 : (isReleaseFeed ? 10 : (Number(item.event_type || 0) || inferAnnouncementEventType(item.title || '', item.contents || ''))),
				image: item.image || newsImageFromContents(item.contents || ''),
			};
		}),
	];
	const seenIds = new Set<string>(), seenTitles = new Set<string>();
	return {
		items: items.filter(item => {
			const id = String(item.gid || '').toLowerCase();
			const title = stripTags(String(item.title || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
			if (!title || !isNewsItemLanguageCompatible(item, preferredLanguage) || (id && seenIds.has(id)) || seenTitles.has(title)) return false;
			if (id) seenIds.add(id);
			seenTitles.add(title);
			return true;
		}),
		hadTransportFailure,
	};
}


function historicalNewsModeSync(steamAppId: string, language: string, metadata?: SteamGameData | null): boolean {
	return (metadata || getSynchronousGameData(steamAppId, language))?.is_delisted === true;
}

async function historicalNewsMode(steamAppId: string, language: string, metadata?: SteamGameData | null): Promise<boolean> {
	if (metadata) return metadata.is_delisted === true;
	const cached = getSynchronousGameData(steamAppId, language);
	if (cached) return cached.is_delisted === true;
	const loaded = await getGameData(steamAppId, language).catch((): null => null);
	return loaded?.is_delisted === true;
}

function newsCacheKey(steamAppId: string, language: string, historical: boolean): string {
	return `${historical ? 'events19_removed' : 'events19_standard'}_${language}-en_${steamAppId}`;
}

function steamReleaseTimestamp(value: unknown): number | null {
	const releaseText = String(value || '').trim();
	if (!releaseText) return null;
	const native = Date.parse(releaseText);
	if (Number.isFinite(native) && native > 0) return Math.floor(native / 1000);

	// Steam localizes release_date.date. Chromium's Date.parse understands the
	// English form but rejects otherwise valid Spanish/German/French/etc. month
	// names, which used to make the guaranteed feed card disappear on legacy
	// games. Normalize the common month stems and retain numeric CJK dates.
	const normalized = releaseText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	const ymd = normalized.match(/\b(19\d{2}|20\d{2})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2})\b/);
	if (ymd) {
		const year = Number(ymd[1]);
		const month = Number(ymd[2]);
		const day = Number(ymd[3]);
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return Math.floor(Date.UTC(year, month - 1, day) / 1000);
	}
	const monthAliases: string[][] = [
		['jan', 'ene', 'gen', 'januar', 'janvier', 'janeiro'],
		['feb', 'fev', 'februar', 'fevrier', 'fevereiro'],
		['mar', 'marz', 'mars', 'marzo', 'marco'],
		['apr', 'abr', 'avr', 'avril', 'abril'],
		['may', 'mai', 'mayo', 'maggio'],
		['jun', 'juin', 'juni', 'junio', 'giugno'],
		['jul', 'juil', 'juli', 'julio', 'luglio'],
		['aug', 'ago', 'aout', 'agosto'],
		['sep', 'set', 'sept', 'september', 'septiembre', 'setembro'],
		['oct', 'out', 'okt', 'octubre', 'ottobre'],
		['nov', 'noviembre', 'novembro'],
		['dec', 'dic', 'dez', 'des', 'decembre', 'diciembre', 'dicembre'],
	];
	const year = Number(normalized.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || 0);
	const tokens: string[] = Array.from(normalized.match(/[a-z]+|\d+/g) || []);
	const monthIndex = monthAliases.findIndex(aliases => tokens.some(token => aliases.some(alias => token.startsWith(alias))));
	const day = Number(tokens.find(token => /^\d{1,2}$/.test(token) && Number(token) >= 1 && Number(token) <= 31) || 1);
	if (year > 0 && monthIndex >= 0) return Math.floor(Date.UTC(year, monthIndex, day) / 1000);
	return null;
}

function officialReleaseFallback(steamAppId: string, language: string, metadata?: SteamGameData | null): NewsItem[] {
	const data = metadata || getSynchronousGameData(steamAppId, language)
		|| getSynchronousGameData(steamAppId, 'english');
	const releaseTimestamp = steamReleaseTimestamp(data?.release_date?.date);
	const name = String(data?.name || `Steam App ${steamAppId}`).trim();
	const retired = data?.is_delisted === true;
	// The date is only used to place the generic metadata card in the activity
	// chronology. Round it to the current UTC day so repeated renders remain
	// byte-for-byte stable even when the Store record has no public release date.
	const fallbackTimestamp = Math.floor(Date.now() / 86_400_000) * 86_400;
	return [{
		gid: releaseTimestamp ? `gdl-steam-release-${steamAppId}` : `gdl-steam-metadata-${steamAppId}`,
		title: releaseTimestamp
			? gdlText('feed_release_title', '{name} was released on Steam', { name })
			: gdlText('feed_metadata_title', '{name} is linked to its Steam information', { name }),
		url: retired
			? `https://steamcommunity.com/app/${steamAppId}`
			: `https://store.steampowered.com/app/${steamAppId}`,
		contents: String(data?.short_description || gdlText('feed_metadata_description', 'Official Steam information is available for this game.')),
		date: releaseTimestamp || fallbackTimestamp,
		event_type: releaseTimestamp ? 10 : 28,
		image: String(data?.header_image || data?.capsule_image || ''),
		feedlabel: releaseTimestamp
			? gdlText('steam_release_label', 'Steam release')
			: gdlText('feed_metadata_label', 'Steam game information'),
		feedname: 'steam_store_release_metadata',
	}];
}

function ensureNewsFeed(steamAppId: string, language: string, items: NewsItem[], metadata?: SteamGameData | null): NewsItem[] {
	return items.length > 0 ? items : officialReleaseFallback(steamAppId, language, metadata);
}

function compactNewsItems(items: NewsItem[]): NewsItem[] {
	return items.slice(0, 48).map(item => ({
		...item,
		// Every renderer uses a short excerpt. Retaining five thousand characters
		// per item made feeds the first cache family evicted in larger libraries.
		contents: String(item.contents || '').slice(0, 1600),
	}));
}

export function newsItemsSignature(items: NewsItem[]): string {
	let hash = 2166136261;
	for (const item of items) {
		const value = `${item.gid}|${item.date}|${item.title}|${item.image || ''}`;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
	}
	return `${items.length}:${(hash >>> 0).toString(16)}`;
}

export function isNewsItemLanguageCompatible(item: Partial<NewsItem>, preferredLanguage = 'spanish'): boolean {
	const normLang = String(preferredLanguage || '').toLowerCase();
	const isRussian = normLang === 'russian' || normLang === 'ru';
	const isCjk = normLang === 'schinese' || normLang === 'tchinese' || normLang === 'zh' || normLang === 'japanese' || normLang === 'ja' || normLang === 'koreana' || normLang === 'korean' || normLang === 'ko';
	const isArabic = normLang === 'arabic' || normLang === 'ar';
	const title = String(item.title || '');
	const sample = `${title} ${String(item.contents || '')}`;
	if (!isRussian) {
		const cyrillic = sample.match(/[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]/g);
		if (cyrillic && (cyrillic.length > 8 || /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]{4,}/.test(title))) return false;
	}
	if (!isCjk) {
		const cjk = sample.match(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g);
		if (cjk && (cjk.length > 8 || /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]{4,}/.test(title))) return false;
	}
	if (!isArabic) {
		const arabic = sample.match(/[\u0600-\u06FF]/g);
		if (arabic && (arabic.length > 8 || /[\u0600-\u06FF]{4,}/.test(title))) return false;
	}
	return true;
}

export function getCachedNews(steamAppId: string, language = steamLanguageSync() || 'english', metadata?: SteamGameData | null):
	{ data: NewsItem[]; fresh: boolean } | null {
	const historical = historicalNewsModeSync(steamAppId, language, metadata);
	const key = newsCacheKey(steamAppId, language, historical);
	const entry = cacheRead<NewsItem[]>(key, CACHE_TTL.news, CACHE_RETENTION.news);
	const memory = newsRequests.peek(key);
	const combined = [...(memory || []), ...(entry?.data || [])]
		.filter(item => isNewsItemLanguageCompatible(item, language));
	const data = ensureNewsFeed(steamAppId, language,
		compactNewsItems(mergeSupplementalPatchNotes(steamAppId, combined)), metadata);
	return {
		data,
		// A synthesized card is ready to render but never counts as a fresh
		// network snapshot; getNews will still replace it with real Steam posts.
		fresh: Boolean((entry?.fresh || memory !== null) && combined.length > 0),
	};
}

export function getCachedCommunityContent(steamAppId: string, language = steamLanguageSync() || 'english'):
	{ data: CommunityContentItem[]; fresh: boolean } | null {
	const key = `community14_${language}_${steamAppId}`;
	const entry = cacheRead<CommunityContentItem[]>(key, CACHE_TTL.communityContent, CACHE_RETENTION.communityContent);
	if (entry) return { data: entry.data, fresh: entry.fresh };
	const legacy = cacheRead<CommunityContentItem[]>(`community13_${language}_${steamAppId}`,
		CACHE_TTL.communityContent, CACHE_RETENTION.communityContent);
	return legacy ? { data: legacy.data, fresh: false } : null;
}

export function eventTypeLabel(t: number): string {
	switch (t) {
		case 10: return loc('EventDisplay_EventType_10', gdlText('feed_game_launch', 'Game Launch'));
		case 12: return loc('AppActivity_EventType_GameUpdate', gdlText('feed_game_update', 'Game Update'));
		case 13: case 14: return loc('MajorUpdate_Type14', gdlText('feed_major_update', 'Major Update'));
		case 15: return loc('EventDisplay_EventType_15', gdlText('feed_dlc', 'DLC Release'));
		case 20: case 21: return loc('EventDisplay_EventType_20', gdlText('feed_offer', 'Offer'));
		case 22: case 23: case 24: case 25: case 26: case 35: return loc('EventDisplay_EventType_22', gdlText('feed_event', 'Game Event'));
		case 28: return loc('EventDisplay_EventType_28', gdlText('feed_news', 'News'));
		case 29: return loc('EventDisplay_EventType_29', gdlText('feed_beta', 'Beta Release'));
		case 30: return loc('EventDisplay_EventType_30', gdlText('feed_content', 'Content Release'));
		case 31: return loc('EventDisplay_EventType_31', gdlText('feed_free_trial', 'Free Trial'));
		case 32: return loc('EventDisplay_EventType_32', gdlText('feed_season', 'Season Release'));
		default: return loc('EventDisplay_EventType_Other', gdlText('feed_community', 'Community Announcements'));
	}
}

export async function getCommunityContent(steamAppId: string, requestedLanguage?: string): Promise<CommunityContentItem[]> {
	const language = requestedLanguage || await getSteamLanguage().catch(() => steamLanguageSync() || 'english');
	const cacheKey = `community14_${language}_${steamAppId}`;
	const cached = cacheGet<CommunityContentItem[]>(cacheKey, CACHE_TTL.communityContent);
	if (cached !== null) return cached;
	const stale = getCachedCommunityContent(steamAppId, language)?.data || [];
	const loaded = await communityRequests.get(cacheKey, async () => {
		try {
			const json = await fetchCommunityContentBackend({ steam_app_id: steamAppId, language });
			const parsed = JSON.parse(json);
			if (parsed?.error || parsed?.transient_error === true) return null;
			const items = Array.isArray(parsed.items) ? orderCommunityItems(parsed.items).slice(0, 80) : [];
			cacheSet(cacheKey, items);
			return items;
		} catch (e) {
			backendLog('Community content fetch error: ' + e);
			return null;
		}
	});
	return loaded ?? stale;
}

export async function getNews(steamAppId: string, requestedLanguage?: string, metadata?: SteamGameData | null,
	onProgress?: NewsProgressCallback): Promise<NewsItem[]> {
	const preferredLanguage = requestedLanguage || await getSteamLanguage().catch(() => steamLanguageSync() || 'english');
	const historical = await historicalNewsMode(steamAppId, preferredLanguage, metadata);
	const cacheKey = newsCacheKey(steamAppId, preferredLanguage, historical);
	const snapshot = getCachedNews(steamAppId, preferredLanguage, metadata);
	if (snapshot?.fresh) {
		if (onProgress) notifyNewsListener(onProgress, snapshot.data);
		return snapshot.data;
	}
	const stale = (snapshot?.data || []).filter(item => isNewsItemLanguageCompatible(item, preferredLanguage));
	const retainedStale = stale.filter(item => !isMetadataNewsFallback(item));
	const progress = newsProgressFor(cacheKey);
	if (onProgress) {
		progress.listeners.add(onProgress);
		while (progress.listeners.size > MAX_PROGRESS_LISTENERS) progress.listeners.delete(progress.listeners.values().next().value!);
		if (progress.latest) notifyNewsListener(onProgress, progress.latest);
	}
	try {
		const loaded = await newsRequests.get(cacheKey, async () => { try {
			const settled = async (request: Promise<string>, timeoutMs = 30_000): Promise<NewsSourceResult> => {
				const safeRequest = request.then(raw => ({ raw, ok: true })).catch(() => ({ raw: '{"items":[]}', ok: false }));
				let timer: ReturnType<typeof setTimeout> | undefined;
				try { return await Promise.race([safeRequest, new Promise<NewsSourceResult>(resolve => {
					timer = setTimeout(() => resolve({ raw: '{"items":[]}', ok: false }), timeoutMs);
				})]); } finally { clearTimeout(timer); }
			};
			const emptyResult = Promise.resolve({ raw: '{"items":[]}', ok: true });
			const results: (NewsSourceResult | undefined)[] = Array.from({ length: 4 });
			const requests = [
				historical ? emptyResult : settled(fetchPartnerEventsBackend({ steam_app_id: steamAppId, language: preferredLanguage })),
				historical || preferredLanguage === 'english' ? emptyResult : settled(fetchPartnerEventsBackend({ steam_app_id: steamAppId, language: 'english' })),
				settled(fetchNewsBackend({ steam_app_id: steamAppId, language: preferredLanguage })),
				preferredLanguage === 'english' ? emptyResult : settled(fetchNewsBackend({ steam_app_id: steamAppId, language: 'english' })),
			];
			await Promise.all(requests.map(async (request, index) => {
				results[index] = await request;
				const available = availableNewsSources(steamAppId, preferredLanguage, results);
				if (available.items.length > 0) {
					// Keep the useful chronology while siblings enrich/localize it;
					// incomplete results never become a fresh persistent snapshot.
					const partial = compactNewsItems(mergeSupplementalPatchNotes(steamAppId, [...available.items, ...retainedStale]));
					publishNewsProgress(cacheKey, progress, partial);
				}
			}));
			const available = availableNewsSources(steamAppId, preferredLanguage, results);
			if (available.items.length > 0) {
				const merged = ensureNewsFeed(steamAppId, preferredLanguage, compactNewsItems(mergeSupplementalPatchNotes(steamAppId,
					available.hadTransportFailure ? [...available.items, ...retainedStale] : available.items)), metadata);
				if (pendingNewsProgress.get(cacheKey) === progress) cacheSet(cacheKey, merged);
				publishNewsProgress(cacheKey, progress, merged);
				return merged;
			}
			if (!available.hadTransportFailure) {
				const merged = ensureNewsFeed(steamAppId, preferredLanguage, compactNewsItems(mergeSupplementalPatchNotes(steamAppId, [])), metadata);
				if (pendingNewsProgress.get(cacheKey) === progress) cacheSet(cacheKey, merged);
				return merged;
			}
		} catch (error) { backendLog('Official Steam activity fetch error: ' + error); }
		return stale.length > 0 ? stale : ensureNewsFeed(steamAppId, preferredLanguage, compactNewsItems(mergeSupplementalPatchNotes(steamAppId, [])), metadata);
		});
		return loaded ?? (stale.length > 0 ? stale : ensureNewsFeed(steamAppId, preferredLanguage, compactNewsItems(mergeSupplementalPatchNotes(steamAppId, [])), metadata));
	} finally {
		if (onProgress) progress.listeners.delete(onProgress);
		// Joined callers have the terminal result; retain no progress callback.
		if (pendingNewsProgress.get(cacheKey) === progress) pendingNewsProgress.delete(cacheKey);
	}
}

export function invalidateLibraryContentCaches(appIds: Iterable<string | number>): void {
	const ids = new Set(Array.from(appIds, value => String(value)).filter(value => /^\d+$/.test(value)));
	if (ids.size === 0) return;
	const matches = (key: string): boolean => ids.has(key.match(/_(\d+)$/)?.[1] || '');
	communityRequests.invalidateMatching(matches);
	newsRequests.invalidateMatching(matches);
	for (const [key, progress] of pendingNewsProgress) {
		if (!matches(key)) continue;
		progress.listeners.clear(); pendingNewsProgress.delete(key);
	}
	cacheDeleteMatching(key => /^(?:events\d+|community\d+)_/.test(key) && matches(key));
}

function newsImageFromContents(contents: string): string {
	const value = String(contents || '');
	const bbcode = value.match(/\[img\](https?:\/\/[^\[]+)\[\/img\]/i);
	if (bbcode?.[1]) return bbcode[1].replace(/&amp;/g, '&');
	const html = value.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
	return html?.[1]?.replace(/&amp;/g, '&') || '';
}

function inferAnnouncementEventType(title: string, contents: string): number {
	const text = `${title} ${contents.slice(0, 240)}`.toLowerCase();
	if (/major update|actualizaci[oó]n importante|free update|gran actualizaci[oó]n/.test(text)) return 13;
	if (/patch notes?|hotfix|notas? (?:del|de) parche|actualizaci[oó]n|\bupdate\b/.test(text)) return 12;
	if (/\bdlc\b|downloadable content|contenido descargable|expansi[oó]n/.test(text)) return 15;
	if (/sale|oferta|descuento|discount/.test(text)) return 20;
	if (/event|evento|livestream|retransmisi[oó]n|tournament|torneo/.test(text)) return 22;
	return 28;
}

export function formatNewsDate(ts: number): string {
	try {
		const date = new Date(ts * 1000);
		const isCurrentYear = date.getFullYear() === new Date().getFullYear();
		return new Intl.DateTimeFormat(steamIntlLocale(), isCurrentYear
			? { day: 'numeric', month: 'long' }
			: { day: 'numeric', month: 'short', year: 'numeric' })
			.format(date).replace(/\./g, '').toUpperCase();
	} catch {
		return new Date(ts * 1000).toLocaleDateString(steamIntlLocale(), { day: 'numeric', month: 'long' }).toUpperCase();
	}
}



export function isPatchNoteItem(item: NewsItem): boolean {
	const et = Number(item.event_type || 0);
	if (et === 12 || et === 13 || et === 14) return true;
	const title = String(item.title || '').toLowerCase();
	const feedlabel = String(item.feedlabel || '').toLowerCase();
	if (feedlabel.includes('parche') || feedlabel.includes('patch') || feedlabel.includes('actualización') || feedlabel.includes('update')) return true;
	if (title.includes('patch') || title.includes('parche') || title.includes('update') || title.includes('actualización') || title.includes('hotfix')) return true;
	if (/\bv?\d+\.\d+(\.\d+)*\b/i.test(title)) return true;
	return false;
}

/**
 * Official patch notes that are not published as Steam partner events.
 * Keep these isolated by AppID so they never affect unrelated linked games.
 * They are merged with Steam's own feed and sorted newest-first.
 */
function supplementalPatchNotes(steamAppId: string): NewsItem[] {
	if (String(steamAppId) !== '1790600') return [];
	return [
		{
			gid: 'gdl-bandai-1790600-20260807',
			title: 'August 7, 2026 Update — Ver. 3021.020.003.012.014',
			url: 'https://en.bandainamcoent.eu/dragon-ball/news/dragon-ball-sparking-zero-update-notice-august-7-2026',
			contents: 'Fixed character-model display issues, added Limit Breaker Journey adjustments, and improved overall stability.',
			date: 1786089600,
			event_type: 12,
			image: '',
			feedlabel: 'Official update',
		},
		{
			gid: 'gdl-bandai-1790600-20260729',
			title: 'July 29, 2026 Update — Ver. 3020.019.003.012.013',
			url: 'https://en.bandainamcoent.eu/dragon-ball/news/dragon-ball-sparking-zero-update-notice-july-29-2026',
			contents: 'Added stages, BGM, new options and mechanics, game-mode changes, combat adjustments, and general stability and performance improvements.',
			date: 1785312000,
			event_type: 12,
			image: '',
			feedlabel: 'Official update',
		},
	];
}

function mergeSupplementalPatchNotes(steamAppId: string, items: NewsItem[]): NewsItem[] {
	const merged = [...supplementalPatchNotes(steamAppId), ...(Array.isArray(items) ? items : [])];
	const seen = new Set<string>();
	return merged
		.filter(item => {
			const key = String(item.url || item.gid || item.title || '').toLowerCase();
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
}





export function stripTags(str: string): string {
	if (!str) return '';
	let res = str
		.replace(/\[\/?\w+[^\]]*\]/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, '');
	for (let i = 0; i < 3; i++) {
		if (!res.includes('&')) break;
		res = res
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&apos;/g, "'")
			.replace(/&nbsp;/g, ' ');
	}
	return res.trim();
}

export function newsExcerpt(contents: string, maxLength = 250): string {
	// Steam announcements can consist solely of an embedded trailer and a
	// Store URL. Removing only the BBCode tags exposes media/link addresses as
	// prose. Drop complete embeds, retain labeled-link text, and omit raw URLs.
	const prose = String(contents || '')
		.replace(/\[(img|previewimg|previewyoutube|youtube|video|webm)\b[^\]]*\][\s\S]*?\[\/\1\]/gi, ' ')
		.replace(/<(script|style|iframe|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
		.replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, ' ')
		.replace(/\[(?:\/?(?:h[1-6]|p|list|olist|table|tr|td)|\*)(?:=[^\]]*)?\]/gi, ' ');
	const clean = stripTags(prose)
		.replace(/<[^>]+>/g, ' ')
		.replace(/(?:https?:\/\/|steam:\/\/|www\.)[^\s<>"']+/gi, ' ')
		.replace(/\(\s*\)|\[\s*\]/g, ' ')
		.replace(/\s+/g, ' ').trim();
	if (clean.length <= maxLength) return clean;
	const candidate = clean.slice(0, maxLength + 1);
	const sentenceEnd = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
	if (sentenceEnd >= Math.floor(maxLength * 0.55)) return candidate.slice(0, sentenceEnd + 1);
	const wordEnd = candidate.lastIndexOf(' ');
	return candidate.slice(0, wordEnd > 0 ? wordEnd : maxLength).trimEnd() + '…';
}
