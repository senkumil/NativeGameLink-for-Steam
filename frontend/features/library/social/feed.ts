import type { NewsItem } from '../../../domain/types';
import { backendLog } from '../../../api/backend';
import { escapeHtml } from '../../../core/text';
import { EVENT_CLASSES, FEED_CLASSES, HEADING_RESET_CLASSES } from '../../../steam/css';
import { gdlText, loc, steamIntlLocale } from '../../../steam/localization';
import { eventTypeLabel, formatNewsDate, isPatchNoteItem, newsExcerpt } from '../news';
import {
	deleteStatusPostOnSteam,
	deleteStatusCommentOnSteam,
	postStatusCommentToSteam,
	extractSteamIdFromValue,
} from '../../../steam/social';
import { getCachedPersona } from './personas';
import { socialRuntimeHost } from './host';
import { installNativeActivitySummaryClamps } from '../activity-summary';

// Steam's patch-event glyph; its native Icon wrapper supplies the dimensions.
const NATIVE_PATCH_ICON = `<svg class="SVGIcon_Button SVGIcon_Patch" version="1.1" xmlns="http://www.w3.org/2000/svg" width="256px" height="256px" viewBox="0 0 256 256" aria-hidden="true">
	<path d="M171.176,136.219c-5.516-5.516-14.166-5.948-20.223-1.406L92.125,75.984l-8.002-29.738c-0.324-1.406-1.73-3.027-3.028-3.785 L46.49,24.186c-1.298-0.648-3.136-0.433-4.218,0.648L25.295,41.813c-0.974,0.973-1.298,2.92-0.649,4.217l18.276,34.605 c0.648,1.297,2.379,2.596,3.785,3.027l29.739,8.003l58.828,58.828c-4.542,6.056-4.109,14.707,1.405,20.222l56.882,56.882 c6.056,6.056,15.896,6.056,21.845,0l12.544-12.544c6.056-6.056,6.056-15.788,0-21.845L171.176,136.219z"/>
	<path d="M153.116,122.16c2.271-0.648,4.65-0.973,7.138-0.973c0.865,0,1.622,0,2.486,0.107l26.928-26.927 c12.328,2.92,25.846-0.324,35.361-9.948c9.517-9.625,12.869-23.034,9.949-35.254l-20.33,20.33l-21.845-5.84l-5.84-21.952 l20.331-20.33c-12.221-2.92-25.738,0.324-35.254,9.948c-9.625,9.625-12.869,23.143-9.949,35.362L129.866,98.91L153.116,122.16z"/>
	<path d="M99.371,129.406l-32.226,32.226c-12.328-2.92-25.845,0.324-35.362,9.948c-9.517,9.625-12.869,23.034-9.949,35.254 l20.331-20.33l21.953,5.84l5.839,21.952l-20.331,20.33c12.22,2.92,25.737-0.324,35.254-9.949 c9.625-9.624,12.869-23.142,9.949-35.361l27.035-27.035c-0.325-3.136,0-6.38,0.865-9.517L99.371,129.406z"/>
</svg>`;

export interface LocalActivityComment {
	id: string;
	text: string;
	timestamp: number;
	user_name: string;
	user_avatar: string;
}

export interface LocalActivityPost {
	id: string;
	text: string;
	timestamp: number;
	user_name: string;
	user_avatar: string;
	comments?: LocalActivityComment[];
}

function getLocalActivityPostsKey(steamAppId: string, shortcutAppId?: string | null): string {
	return `gdl_posts_${shortcutAppId || steamAppId}`;
}

export function loadLocalActivityPosts(steamAppId: string, shortcutAppId?: string | null): LocalActivityPost[] {
	try {
		const key = getLocalActivityPostsKey(steamAppId, shortcutAppId);
		const raw = localStorage.getItem(key);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveLocalActivityPost(steamAppId: string, post: LocalActivityPost, shortcutAppId?: string | null): void {
	try {
		const key = getLocalActivityPostsKey(steamAppId, shortcutAppId);
		const posts = loadLocalActivityPosts(steamAppId, shortcutAppId);
		posts.unshift(post);
		localStorage.setItem(key, JSON.stringify(posts));
	} catch (e) {
		backendLog('Failed to save local activity post: ' + e);
	}
}

export function saveLocalActivityComment(
	steamAppId: string,
	postId: string,
	comment: LocalActivityComment,
	shortcutAppId?: string | null,
): void {
	try {
		const targetKeys = new Set<string>();
		if (steamAppId) targetKeys.add(`gdl_posts_${steamAppId}`);
		if (shortcutAppId) targetKeys.add(`gdl_posts_${shortcutAppId}`);
		if (socialRuntimeHost().getCurrentInjectedAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedAppId()}`);
		if (socialRuntimeHost().getCurrentInjectedShortcutAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedShortcutAppId()}`);

		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith('gdl_posts_')) targetKeys.add(k);
		}

		for (const key of targetKeys) {
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					const post = parsed.find((p: LocalActivityPost) => p.id === postId);
					if (post) {
						if (!Array.isArray(post.comments)) post.comments = [];
						post.comments.push(comment);
						localStorage.setItem(key, JSON.stringify(parsed));
					}
				}
			} catch {}
		}
	} catch (e) {
		backendLog('Failed to save local activity comment: ' + e);
	}
}

export function deleteLocalActivityComment(
	steamAppId: string,
	postId: string,
	commentId: string,
	shortcutAppId?: string | null,
): void {
	try {
		const targetKeys = new Set<string>();
		if (steamAppId) targetKeys.add(`gdl_posts_${steamAppId}`);
		if (shortcutAppId) targetKeys.add(`gdl_posts_${shortcutAppId}`);
		if (socialRuntimeHost().getCurrentInjectedAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedAppId()}`);
		if (socialRuntimeHost().getCurrentInjectedShortcutAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedShortcutAppId()}`);

		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith('gdl_posts_')) targetKeys.add(k);
		}

		for (const key of targetKeys) {
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					const post = parsed.find((p: LocalActivityPost) => p.id === postId);
					if (post && Array.isArray(post.comments)) {
						post.comments = post.comments.filter((c: LocalActivityComment) => c.id !== commentId);
						localStorage.setItem(key, JSON.stringify(parsed));
					}
				}
			} catch {}
		}
	} catch (e) {
		backendLog('Failed to delete local activity comment: ' + e);
	}
}

export function getCurrentSteamUser(doc: Document): { name: string; avatar: string } {
	let name = '';
	let avatar = '';
	try {
		const anyWin = (doc.defaultView || window) as any;
		const rawSid = anyWin?.SteamClient?.User?.GetSteamID?.()
			|| anyWin?.userStore?.m_steamid
			|| anyWin?.g_AccountInfo?.m_ulSteamID;
		const sidStr = extractSteamIdFromValue(rawSid);
		if (sidStr) {
			const cached = getCachedPersona(sidStr);
			if (cached?.name) name = cached.name;
			if (cached?.avatar) avatar = cached.avatar;
		}
		if (!name && typeof anyWin?.SteamClient?.User?.GetPersonaName === 'function') {
			name = anyWin.SteamClient.User.GetPersonaName();
		}
		if (!name && anyWin?.g_AccountInfo?.m_strPersonaName) {
			name = anyWin.g_AccountInfo.m_strPersonaName;
		}
		if (!name && anyWin?.userStore?.m_strPersonaName) {
			name = anyWin.userStore.m_strPersonaName;
		}
		if (!avatar && typeof anyWin?.SteamClient?.Friends?.GetFriendAvatarURL === 'function' && sidStr) {
			avatar = anyWin.SteamClient.Friends.GetFriendAvatarURL(sidStr, 'medium') || anyWin.SteamClient.Friends.GetFriendAvatarURL(sidStr) || '';
		}
	} catch {}

	if (!name) {
		const topProfile = doc.querySelector('[class*="AccountName"], [class*="accountName"], [class*="personaName"], .persona') as HTMLElement | null;
		if (topProfile?.textContent) {
			const clone = topProfile.cloneNode(true) as HTMLElement;
			clone.querySelectorAll('[class*="Wallet"], [class*="wallet"], [class*="Balance"], [class*="balance"]').forEach(el => el.remove());
			name = clone.textContent?.trim() || '';
		}
	}
	if (!name) {
		const btn = doc.querySelector('[class*="AccountMenu"], [class*="accountMenu"], [class*="TopBarAccount"]') as HTMLElement | null;
		if (btn?.textContent) {
			const clone = btn.cloneNode(true) as HTMLElement;
			clone.querySelectorAll('[class*="Wallet"], [class*="wallet"], [class*="Balance"], [class*="balance"]').forEach(el => el.remove());
			name = clone.textContent?.trim() || '';
		}
	}

	if (name) {
		name = name.replace(/[\$€£¥₹₩]\s*\d+(?:[.,]\d+)?/g, '')
			.replace(/\d+(?:[.,]\d+)?\s*[\$€£¥₹₩]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	if (!name) name = gdlText('steam_user', 'Steam User');

	if (!avatar) {
		const avatarImg = doc.querySelector('[class*="Avatar"] img, [class*="avatar"] img, .avatarHolder img, [class*="AccountAvatar"] img') as HTMLImageElement | null;
		if (avatarImg?.src) {
			avatar = avatarImg.src;
		}
	}
	if (!avatar) {
		avatar = 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';
	}
	return { name, avatar };
}

function formatPostTime(ts: number): string {
	try {
		return new Intl.DateTimeFormat(steamIntlLocale(), {
			hour: 'numeric', minute: '2-digit', second: '2-digit',
		}).format(new Date(ts * 1000));
	} catch {
		return new Date(ts * 1000).toLocaleTimeString(steamIntlLocale());
	}
}

function formatPostGroupDate(ts: number): string {
	const d = new Date(ts * 1000);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return gdlText('today', 'TODAY');
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) {
		return gdlText('yesterday', 'YESTERDAY');
	}
	return formatNewsDate(ts);
}

export const STEAM_EMOTICONS: { char: string; name: string }[] = [
	{ char: '🐸', name: 'frog pepe' },
	{ char: '🤢', name: 'sick green' },
	{ char: '🤠', name: 'cowboy' },
	{ char: '😎', name: 'cool sunglasses' },
	{ char: '👻', name: 'ghost' },
	{ char: '🚀', name: 'rocket' },
	{ char: '⬆️', name: 'up arrow' },
	{ char: '👎', name: 'thumbs down' },
	{ char: '👍', name: 'thumbs up' },
	{ char: '❤️', name: 'heart love' },
	{ char: '🔥', name: 'fire lit' },
	{ char: '🎉', name: 'party celebrate' },
	{ char: '💀', name: 'skull dead' },
	{ char: '🎮', name: 'game controller' },
	{ char: '⭐', name: 'star gold' },
	{ char: '🏆', name: 'trophy win' },
	{ char: '💯', name: '100 perfect' },
	{ char: '🍕', name: 'pizza food' },
	{ char: '☕', name: 'coffee tea' },
	{ char: '⚡', name: 'lightning bolt' },
	{ char: '✨', name: 'sparkles magic' },
	{ char: '💎', name: 'diamond gem' },
	{ char: '⚔️', name: 'swords battle' },
	{ char: '🛡️', name: 'shield defense' },
	{ char: '🕹️', name: 'joystick arcade' },
	{ char: '👾', name: 'alien monster' },
	{ char: '🎲', name: 'dice game' },
	{ char: '🎯', name: 'target bullseye' },
	{ char: '💥', name: 'explosion boom' },
	{ char: '👀', name: 'eyes look' },
	{ char: '🤝', name: 'handshake deal' },
	{ char: '👑', name: 'crown king' },
];

export interface FriendActivityFeedItem {
	id: string;
	date: number;
	html: string;
}

const lastInjectedNews = new Map<string, NewsItem[]>();
const lastInjectedFriendActivity = new Map<string, string>();
const lastInjectedFriendItems = new Map<string, FriendActivityFeedItem[]>();

const friendActivityFreshUntil = new Map<string, number>();

const activityCacheAccessAt = new Map<string, number>();

const visibleActivityNewsCount = new Map<string, number>();
const activityEndReached = new Map<string, boolean>();

const ACTIVITY_NEWS_PAGE_SIZE = 8;
const MAX_ACTIVITY_GAME_ENTRIES = 32;
const FRIEND_ACTIVITY_TTL_MS = 5 * 60 * 1000;

/** Reuse the existing bounded feed snapshot without another data/image cache. */
export function getRetainedActivityNews(steamAppId: string): NewsItem[] | null {
	return lastInjectedNews.get(steamAppId) || null;
}

function deleteActivityCacheEntry(appId: string): void {
	lastInjectedNews.delete(appId);
	lastInjectedFriendActivity.delete(appId);
	lastInjectedFriendItems.delete(appId);
	friendActivityFreshUntil.delete(appId);
	activityCacheAccessAt.delete(appId);
	visibleActivityNewsCount.delete(appId);
	activityEndReached.delete(appId);
}

function touchActivityCache(appId: string): void {
	activityCacheAccessAt.set(appId, Date.now());
	trimActivityCaches();
}

function trimActivityCaches(): void {
	while (activityCacheAccessAt.size > MAX_ACTIVITY_GAME_ENTRIES) {
		const oldest = Array.from(activityCacheAccessAt.entries())
			.sort((left, right) => left[1] - right[1])[0]?.[0];
		if (!oldest) break;
		deleteActivityCacheEntry(oldest);
	}
}

export function hasFreshFriendActivitySnapshot(steamAppId: string): boolean {
	return (friendActivityFreshUntil.get(steamAppId) || 0) > Date.now();
}

export function markFriendActivitySnapshotChecked(
	steamAppId: string,
	ttlMs = FRIEND_ACTIVITY_TTL_MS,
): void {
	friendActivityFreshUntil.set(steamAppId, Date.now() + Math.max(1_000, ttlMs));
	touchActivityCache(steamAppId);
}

function effectiveActivityNews(steamAppId: string, newsItems: NewsItem[]): NewsItem[] {
	const previous = lastInjectedNews.get(steamAppId) || [];
	const metadataFallback = (item: NewsItem): boolean => /^gdl-steam-(?:release|metadata)-/.test(String(item.gid || ''))
		&& item.feedname === 'steam_store_release_metadata';
	if (!Array.isArray(newsItems) || newsItems.length === 0) return previous;
	// Evicted persistent data can leave a real in-session snapshot available.
	// A synthesized Store card must not erase it while news is revalidated.
	return newsItems.every(metadataFallback) && previous.some(item => !metadataFallback(item)) ? previous : newsItems;
}

function parseFriendActivityItems(input: unknown): FriendActivityFeedItem[] {
	if (Array.isArray(input)) {
		return input.filter((item): item is FriendActivityFeedItem =>
			Boolean(item && typeof item === 'object' && typeof (item as any).html === 'string' && typeof (item as any).date === 'number')
		);
	}
	if (typeof input === 'string' && input.trim().startsWith('[')) {
		try {
			const parsed = JSON.parse(input);
			if (Array.isArray(parsed)) {
				return parsed.filter((item): item is FriendActivityFeedItem =>
					Boolean(item && typeof item === 'object' && typeof item.html === 'string' && typeof item.date === 'number')
				);
			}
		} catch {}
	}
	return [];
}

function rememberActivityFeedInputs(
	steamAppId: string,
	newsItems: NewsItem[],
	friendActivity: string | FriendActivityFeedItem[],
): { newsItems: NewsItem[]; friendItems: FriendActivityFeedItem[]; legacyFriendHtml: string } {
	touchActivityCache(steamAppId);
	newsItems = effectiveActivityNews(steamAppId, newsItems);
	if (Array.isArray(newsItems) && newsItems.length > 0) {
		lastInjectedNews.set(steamAppId, newsItems);
	} else {
		newsItems = lastInjectedNews.get(steamAppId) || [];
	}

	const parsedItems = parseFriendActivityItems(friendActivity);
	let legacyFriendHtml = '';
	if (parsedItems.length > 0) {
		lastInjectedFriendItems.set(steamAppId, parsedItems);
		lastInjectedFriendActivity.set(steamAppId, JSON.stringify(parsedItems));
		friendActivityFreshUntil.set(steamAppId, Date.now() + FRIEND_ACTIVITY_TTL_MS);
	} else if (typeof friendActivity === 'string' && friendActivity.trim().length > 0) {
		lastInjectedFriendActivity.set(steamAppId, friendActivity);
		friendActivityFreshUntil.set(steamAppId, Date.now() + FRIEND_ACTIVITY_TTL_MS);
		legacyFriendHtml = friendActivity;
	} else {
		const cachedItems = lastInjectedFriendItems.get(steamAppId);
		if (cachedItems && cachedItems.length > 0) {
			parsedItems.push(...cachedItems);
		} else {
			const cachedRaw = lastInjectedFriendActivity.get(steamAppId) || '';
			const fromRaw = parseFriendActivityItems(cachedRaw);
			if (fromRaw.length > 0) {
				parsedItems.push(...fromRaw);
				lastInjectedFriendItems.set(steamAppId, fromRaw);
			} else {
				legacyFriendHtml = cachedRaw;
			}
		}
	}

	return { newsItems, friendItems: parsedItems, legacyFriendHtml };
}

function hashFeedPart(hash: number, value: unknown): number {
	const text = String(value ?? '');
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash;
}

/** Content identity independent of DOM serialization. Steam normalizes the
 * injected HTML, so comparing innerHTML strings caused false changes and made
 * the whole feed repaint after every route visit. */
export function activityFeedContentSignature(
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string,
	friendActivity: string | FriendActivityFeedItem[] = '',
): string {
	const effectiveNews = effectiveActivityNews(steamAppId, newsItems);
	const parsedItems = parseFriendActivityItems(friendActivity);
	const effectiveFriendItems = parsedItems.length > 0
		? parsedItems
		: (lastInjectedFriendItems.get(steamAppId) || parseFriendActivityItems(lastInjectedFriendActivity.get(steamAppId) || ''));
	const rawLegacy = (typeof friendActivity === 'string' && !friendActivity.trim().startsWith('['))
		? friendActivity
		: (lastInjectedFriendActivity.get(steamAppId) || '');
	const posts = loadLocalActivityPosts(steamAppId, shortcutAppId);
	let hash = 2166136261;
	for (const value of [steamAppId, shortcutAppId || '', fallbackImage,
		visibleActivityNewsCount.get(steamAppId) || ACTIVITY_NEWS_PAGE_SIZE,
		activityEndReached.get(steamAppId) === true ? 1 : 0, rawLegacy]) {
		hash = hashFeedPart(hash, value);
	}
	for (const item of effectiveNews) {
		for (const value of [item.gid, item.date, item.event_type, item.title, item.url,
			item.image, newsExcerpt(item.contents || '', 320)]) hash = hashFeedPart(hash, value);
	}
	for (const post of posts) {
		for (const value of [post.id, post.timestamp, post.user_name, post.user_avatar, post.text]) {
			hash = hashFeedPart(hash, value);
		}
		if (Array.isArray(post.comments)) {
			for (const c of post.comments) {
				for (const value of [c.id, c.timestamp, c.user_name, c.user_avatar, c.text]) {
					hash = hashFeedPart(hash, value);
				}
			}
		}
	}
	for (const friend of effectiveFriendItems) {
		for (const value of [friend.id, friend.date, friend.html]) {
			hash = hashFeedPart(hash, value);
		}
	}
	return `${effectiveNews.length}:${posts.length}:${effectiveFriendItems.length}:${rawLegacy.length}:${(hash >>> 0).toString(16)}`;
}

export interface UnifiedActivityFeedSnapshot {
	html: string;
	signature: string;
}

export function renderUnifiedActivityFeedSnapshot(
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string,
	friendActivity: string | FriendActivityFeedItem[] = '',
): UnifiedActivityFeedSnapshot {
	const html = renderUnifiedActivityFeed(steamAppId, shortcutAppId, newsItems, fallbackImage, friendActivity);
	return {
		html,
		signature: activityFeedContentSignature(steamAppId, shortcutAppId, newsItems, fallbackImage, friendActivity),
	};
}

export function applyUnifiedActivityFeed(
	container: HTMLElement,
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string,
	friendActivity: string | FriendActivityFeedItem[] = '',
): boolean {
	rememberActivityFeedInputs(steamAppId, newsItems, friendActivity);
	const signature = activityFeedContentSignature(
		steamAppId, shortcutAppId, newsItems, fallbackImage, friendActivity,
	);
	if (container.dataset.gdlFeedSignature === signature) return false;
	const snapshot = renderUnifiedActivityFeedSnapshot(
		steamAppId, shortcutAppId, newsItems, fallbackImage, friendActivity,
	);
	container.innerHTML = snapshot.html;
	container.dataset.gdlFeedSignature = snapshot.signature;
	refreshActivitySummaryLayout(container);
	return true;
}

export function renderUnifiedActivityFeed(
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string,
	friendActivity: string | FriendActivityFeedItem[] = '',
): string {
	const { newsItems: effectiveNews, friendItems, legacyFriendHtml } = rememberActivityFeedInputs(
		steamAppId, newsItems, friendActivity,
	);

	const localPosts = loadLocalActivityPosts(steamAppId, shortcutAppId);
	const sortedNews = [...effectiveNews]
		.filter(item => item && item.title && Number(item.date || 0) > 0)
		.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
	const visibleNews = Math.min(
		Math.max(ACTIVITY_NEWS_PAGE_SIZE, visibleActivityNewsCount.get(steamAppId) || ACTIVITY_NEWS_PAGE_SIZE),
		sortedNews.length
	);

	type FeedItem =
		| { type: 'post'; post: LocalActivityPost; date: number }
		| { type: 'news'; item: NewsItem; date: number }
		| { type: 'friend'; item: FriendActivityFeedItem; date: number };

	const allItems: FeedItem[] = [
		...localPosts.map(p => ({ type: 'post' as const, post: p, date: p.timestamp })),
		...sortedNews.slice(0, visibleNews).map(item => ({ type: 'news' as const, item, date: Number(item.date || 0) })),
		...friendItems.map(f => ({ type: 'friend' as const, item: f, date: f.date })),
	].sort((a, b) => b.date - a.date);

	if (allItems.length === 0 && !legacyFriendHtml) {
		return `<div style="color:#4a5562;font-size:13px;padding:20px 0;">${escapeHtml(gdlText('no_recent_activity', loc('AppActivity_NoActivity', "There's no recent activity from the developers of this title or from your friends.")))}</div>`;
	}

	const groups: { date: string; items: FeedItem[] }[] = [];
	const map = new Map<string, FeedItem[]>();
	for (const entry of allItems) {
		const label = formatPostGroupDate(entry.date);
		if (!map.has(label)) {
			map.set(label, []);
			groups.push({ date: label, items: map.get(label)! });
		}
		map.get(label)!.push(entry);
	}

	const n = EVENT_CLASSES();
	let feedHtml = '';
	if (legacyFriendHtml && friendItems.length === 0) {
		feedHtml += legacyFriendHtml;
	}

	let firstNewsMarked = false;
	for (const group of groups) {
		feedHtml += `<div class="${n.AppActivityDay} gdl-feed-day"><h4 class="${HEADING_RESET_CLASSES().Reset} ${n.AppActivityDate} gdl-feed-date">${group.date}<div class="${n.Rule} gdl-feed-rule"></div></h4><div>`;
		for (const entry of group.items) {
			if (entry.type === 'post') {
				const p = entry.post;
				const comments = Array.isArray(p.comments) ? p.comments : [];
				const commentsHtml = comments.map(c => `
					<div class="gdl-post-comment" data-comment-id="${escapeHtml(c.id)}" data-post-id="${escapeHtml(p.id)}" style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.03);">
						<img src="${escapeHtml(c.user_avatar)}" style="width:24px;height:24px;border-radius:2px;object-fit:cover;flex-shrink:0;margin-top:2px;" data-gdl-fallback-src="https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg" />
						<div style="flex:1;min-width:0;font-size:12.5px;line-height:1.4;">
							<div style="display:flex;align-items:center;gap:6px;">
								<span style="font-weight:700;color:#66c0f4;">${escapeHtml(c.user_name)}</span>
								<span style="color:#626d7b;font-size:11px;">${formatPostTime(c.timestamp)}</span>
								<button type="button" class="gdl-delete-comment-btn" data-comment-id="${escapeHtml(c.id)}" data-post-id="${escapeHtml(p.id)}" title="${escapeHtml(gdlText('delete_comment', 'Delete reply'))}" style="margin-left:auto;background:transparent;border:none;color:#4a5562;cursor:pointer;padding:2px 4px;border-radius:2px;display:flex;align-items:center;line-height:1;transition:color 0.15s;">
									<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
								</button>
							</div>
							<div style="color:#c6d4df;margin-top:2px;word-break:break-word;">${escapeHtml(c.text)}</div>
						</div>
					</div>`).join('');

				feedHtml += `<div class="gdl-local-post" data-post-id="${escapeHtml(p.id)}" style="margin-bottom:20px;">
					<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
						<img src="${escapeHtml(p.user_avatar)}" style="width:28px;height:28px;border-radius:2px;object-fit:cover;" data-gdl-fallback-src="https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg" />
						<div style="font-size:13px;line-height:1.3;">
							<span style="font-weight:700;color:#66c0f4;">${escapeHtml(p.user_name)}</span>
							<span style="color:#8f98a0;margin-left:4px;">${escapeHtml(gdlText('status_posted_at', 'posted a status update at'))} ${formatPostTime(p.timestamp)}</span>
						</div>
						<button type="button" class="gdl-delete-post-btn" data-post-id="${escapeHtml(p.id)}" title="${escapeHtml(gdlText('delete_post', 'Delete post'))}" style="margin-left:auto;background:transparent;border:none;color:#56606c;cursor:pointer;padding:4px 6px;border-radius:3px;display:flex;align-items:center;justify-content:center;transition:color 0.15s, background 0.15s;">
							<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
						</button>
					</div>
					<div style="background:#1f252e;border:1px solid rgba(255,255,255,0.025);border-radius:2px;padding:14px 18px;">
						<div style="font-size:14px;color:#d6d7d8;line-height:1.45;word-break:break-word;">${escapeHtml(p.text)}</div>
					</div>
					<div class="gdl-post-comments-container" style="margin-top:6px;padding-left:14px;border-left:2px solid rgba(255,255,255,0.06);">
						${commentsHtml}
						<form class="gdl-comment-form" data-post-id="${escapeHtml(p.id)}" style="display:flex;align-items:center;gap:8px;margin-top:8px;">
							<input type="text" class="gdl-comment-input" data-post-id="${escapeHtml(p.id)}" placeholder="${escapeHtml(gdlText('add_comment', 'Write a reply...'))}" style="flex:1;background:#14181d;border:1px solid #232a32;border-radius:2px;color:#dcdedf;padding:6px 10px;font-size:13px;outline:none;" />
							<button type="submit" class="gdl-comment-submit-btn" data-post-id="${escapeHtml(p.id)}" style="background:#222b35;border:1px solid rgba(255,255,255,0.08);color:#66c0f4;padding:6px 12px;border-radius:2px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
								${escapeHtml(gdlText('reply', 'Reply'))}
							</button>
						</form>
					</div>
				</div>`;
			} else if (entry.type === 'friend') {
				feedHtml += entry.item.html;
			} else {
				const item = entry.item;
				const eventType = Number(item.event_type || 0);
				const isMajor = eventType === 14;
				// Steam's desktop partner-event renderer selects its text-only
				// patch card for type 12 and its ordinary media card for type 13.
				const isCompactPatch = eventType === 12 || (eventType === 0 && !item.feedlabel && isPatchNoteItem(item));
				const label = eventType > 0
					? eventTypeLabel(eventType)
					: (item.feedlabel || (isPatchNoteItem(item) ? gdlText('feed_patch_notes', 'Minor Update / Patch Notes') : gdlText('feed_news', 'News')));
				const preview = newsExcerpt(item.contents) || loc('AppActivity_RecommendedGame_ReadMore', 'Read more');
				const thumbUrl = item.image || fallbackImage;
				const firstId = !firstNewsMarked ? ' id="gdl-first-news-item"' : '';
				firstNewsMarked = true;
				if (isCompactPatch) {
					feedHtml += `<div${firstId} class="${n.Event} ${n.PartnerEvent} ${n.PartnerEventTextOnly}" data-gdl-open-url="${escapeHtml(item.url)}"><div class="${n.PartnerEventTextOnly_Container}"><div class="${n.PartnerEventTextOnly_Icon}">${NATIVE_PATCH_ICON}</div><div class="${n.PartnerEventTextOnly_TextColumn}"><div class="${n.PartnerEventType}">${escapeHtml(label.toUpperCase())}</div><div class="${n.PartnerEventTextOnly_Title}">${escapeHtml(item.title)}</div></div></div></div>`;
				} else if (isMajor) {
					const majorContentsClass = n.MajorUpdateContentContainer || n.PartnerEventLargeUpdate_Contents || '_2Dbxm-Lv_YU2jN88HErlMS';
					const blurClass = n.Blur || '_3cX_vEKsN9S9EmR0O5w1Ol';
					feedHtml += `<div${firstId} class="${n.Event} ${n.PartnerEventLargeUpdate}" data-gdl-open-url="${escapeHtml(item.url)}"><div class="${majorContentsClass}"><div class="${n.LeftSideMajorUpdateBar}"></div><div class="${n.PartnerEventLargeImage_Container}"><div class="${n.PartnerEventLargeImage_Contents}"><img class="${n.PartnerEventLargeImage_Image} ${blurClass}" src="${escapeHtml(thumbUrl)}" aria-hidden="true" /><div class="${n.ImageContainer}"><img class="${n.PartnerEventLargeImage_Image}" src="${escapeHtml(thumbUrl)}" data-gdl-fallback-src="${escapeHtml(fallbackImage || '')}" /></div><div class="${n.PartnerEventLargeImage_TextColumn}"><div class="${n.PartnerEventType} ${n.PartnerEventTypeUpdate || '_29bW1yCn25VTm4bFameBaV'}"><div>${escapeHtml(label.toUpperCase())}</div></div><div class="${n.PartnerEventLargeImage_Title}">${escapeHtml(item.title)}</div>${preview ? `<div class="${n.PartnerEventLargeImage_Summary}">${escapeHtml(preview)}</div>` : ''}</div></div></div></div></div>`;
				} else {
					feedHtml += `<div${firstId} class="${n.Event} ${n.PartnerEvent} ${n.PartnerEventMediumImage_Container} gdl-news-card" data-gdl-open-url="${escapeHtml(item.url)}"><div class="${n.PartnerEventMediumImage_Contents} gdl-news-layout"><div class="${n.MediumImageContainer} gdl-news-image"><img class="gdl-news-image-blur" src="${escapeHtml(thumbUrl)}" aria-hidden="true" /><img class="${n.PartnerEventMediumImage_Image} gdl-news-image-fg" src="${escapeHtml(thumbUrl)}" data-gdl-fallback-src="${escapeHtml(fallbackImage || '')}" /></div><div class="${n.PartnerEventMediumImage_TextColumn} gdl-news-copy"><div class="${n.PartnerEventType} gdl-news-type"><div>${escapeHtml(label.toUpperCase())}</div></div><div class="${n.PartnerEventMediumImage_Title} gdl-news-title">${escapeHtml(item.title)}</div>${preview ? `<div class="${n.PartnerEventMediumImage_Summary} gdl-news-summary">${escapeHtml(preview)}</div>` : ''}</div></div></div>`;
				}
			}
		}
		feedHtml += '</div></div>';
	}
	const endReached = activityEndReached.get(steamAppId) === true;
	if (endReached && visibleNews < sortedNews.length) {
		activityEndReached.delete(steamAppId);
	}
	if (activityEndReached.get(steamAppId) === true) {
		feedHtml += `<div class="gdl-activity-end"><span>${escapeHtml(gdlText('activity_end', 'End of activity'))}</span></div>`;
	} else {
		feedHtml += `<div class="gdl-load-more-row"><button type="button" class="DialogButton _DialogLayout Secondary ${FEED_CLASSES().FetchMoreContainer} gdl-load-more-activity">${escapeHtml(gdlText('fetch_more', loc('AppActivity_FetchMore', 'Load more activity')))}</button></div>`;
	}
	return feedHtml;
}

function deleteLocalActivityPost(steamAppId: string, postId: string, shortcutAppId?: string | null): void {
	try {
		const targetKeys = new Set<string>();
		if (steamAppId) targetKeys.add(`gdl_posts_${steamAppId}`);
		if (shortcutAppId) targetKeys.add(`gdl_posts_${shortcutAppId}`);
		if (socialRuntimeHost().getCurrentInjectedAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedAppId()}`);
		if (socialRuntimeHost().getCurrentInjectedShortcutAppId()) targetKeys.add(`gdl_posts_${socialRuntimeHost().getCurrentInjectedShortcutAppId()}`);

		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith('gdl_posts_')) targetKeys.add(k);
		}

		for (const key of targetKeys) {
			const raw = localStorage.getItem(key);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					const filtered = parsed.filter((p: LocalActivityPost) => p.id !== postId);
					if (filtered.length !== parsed.length) {
						localStorage.setItem(key, JSON.stringify(filtered));
						backendLog(`Deleted post ${postId} from key ${key}`);
					}
				}
			} catch {}
		}
		void deleteStatusPostOnSteam(postId).catch(() => {});
	} catch (e) {
		backendLog('Failed to delete local activity post: ' + e);
	}
}

const feedInteractionCleanup = new WeakMap<Document, () => void>();
const feedSummaryCleanup = new WeakMap<Document, () => void>();

function refreshActivitySummaryLayout(feed: HTMLElement): void {
	const doc = feed.ownerDocument;
	feedSummaryCleanup.get(doc)?.();
	feedSummaryCleanup.set(doc, installNativeActivitySummaryClamps(feed));
}

export function disposeActivityFeedInteractions(doc: Document): void {
	feedInteractionCleanup.get(doc)?.();
	feedSummaryCleanup.get(doc)?.();
	feedSummaryCleanup.delete(doc);
}

export function setupPostDeleteHandlers(
	doc: Document,
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string
): void {
	disposeActivityFeedInteractions(doc);
	const feedContainer = doc.getElementById('gdl-activity-feed');
	if (!feedContainer) return;
	refreshActivitySummaryLayout(feedContainer);

	const handleFormSubmit = (event: Event): void => {
		const target = event.target as HTMLElement | null;
		const form = target?.closest('.gdl-comment-form') as HTMLFormElement | null;
		if (!form) return;
		event.preventDefault();
		event.stopPropagation();
		const postId = form.getAttribute('data-post-id');
		if (!postId) return;
		const input = form.querySelector('.gdl-comment-input') as HTMLInputElement | null;
		const text = input?.value.trim() || '';
		if (!text) return;
		const user = getCurrentSteamUser(doc);
		saveLocalActivityComment(steamAppId, postId, {
			id: 'comment_' + Date.now(),
			text,
			timestamp: Math.floor(Date.now() / 1000),
			user_name: user.name,
			user_avatar: user.avatar,
		}, shortcutAppId);

		// Dispatch comment to Steam Community
		void postStatusCommentToSteam('', postId, text).catch(() => {});

		delete feedContainer.dataset.gdlFeedSignature;
		applyUnifiedActivityFeed(feedContainer, steamAppId, shortcutAppId, newsItems, fallbackImage);
		setupPostDeleteHandlers(doc, steamAppId, shortcutAppId, newsItems, fallbackImage);
	};

	const handleClick = (event: Event): void => {
		const target = event.target as HTMLElement | null;
		if (!target) return;
		const loadMore = target.closest('.gdl-load-more-activity') as HTMLElement | null;
		if (loadMore) {
			event.preventDefault();
			event.stopPropagation();
			const sourceNews = Array.isArray(newsItems) && newsItems.length > 0
				? newsItems
				: (lastInjectedNews.get(steamAppId) || []);
			const availableNews = sourceNews
				.filter(item => item && item.title && Number(item.date || 0) > 0)
				.length;
			const current = visibleActivityNewsCount.get(steamAppId) || ACTIVITY_NEWS_PAGE_SIZE;
			const next = Math.min(current + ACTIVITY_NEWS_PAGE_SIZE, availableNews);
			if (next > current) visibleActivityNewsCount.set(steamAppId, next);
			if (availableNews <= current || next >= availableNews) activityEndReached.set(steamAppId, true);
			applyUnifiedActivityFeed(feedContainer, steamAppId, shortcutAppId, sourceNews, fallbackImage);
			return;
		}
		const commentDeleteBtn = target.closest('.gdl-delete-comment-btn') as HTMLElement | null;
		if (commentDeleteBtn) {
			event.preventDefault();
			event.stopPropagation();
			const postId = commentDeleteBtn.getAttribute('data-post-id');
			const commentId = commentDeleteBtn.getAttribute('data-comment-id');
			if (postId && commentId) {
				deleteLocalActivityComment(steamAppId, postId, commentId, shortcutAppId);
				void deleteStatusCommentOnSteam('', postId, commentId).catch(() => {});
				delete feedContainer.dataset.gdlFeedSignature;
				applyUnifiedActivityFeed(feedContainer, steamAppId, shortcutAppId, newsItems, fallbackImage);
				setupPostDeleteHandlers(doc, steamAppId, shortcutAppId, newsItems, fallbackImage);
			}
			return;
		}
		const button = target.closest('.gdl-delete-post-btn') as HTMLElement | null;
		if (!button) return;
		event.preventDefault();
		event.stopPropagation();
		const postId = button.getAttribute('data-post-id');
		if (!postId) return;
		deleteLocalActivityPost(steamAppId, postId, shortcutAppId);
		void deleteStatusPostOnSteam(postId).catch(() => {});
		delete feedContainer.dataset.gdlFeedSignature;
		applyUnifiedActivityFeed(feedContainer, steamAppId, shortcutAppId, newsItems, fallbackImage);
		setupPostDeleteHandlers(doc, steamAppId, shortcutAppId, newsItems, fallbackImage);
	};
	feedContainer.addEventListener('click', handleClick);
	feedContainer.addEventListener('submit', handleFormSubmit);
	let active = true;
	const cleanup = (): void => {
		if (!active) return;
		active = false;
		feedContainer.removeEventListener('click', handleClick);
		feedContainer.removeEventListener('submit', handleFormSubmit);
		feedInteractionCleanup.delete(doc);
	};
	feedInteractionCleanup.set(doc, cleanup);
}

export function clearActivityFeedCaches(): void {
	lastInjectedNews.clear();
	lastInjectedFriendActivity.clear();
	friendActivityFreshUntil.clear();
	activityCacheAccessAt.clear();
	visibleActivityNewsCount.clear();
	activityEndReached.clear();
}

/** Forget route-local feed snapshots for relinked games so an empty or delayed
 * fresh response cannot silently restore the previous news list. */
export function invalidateActivityFeedCaches(appIds: Iterable<string | number>): void {
	for (const appId of Array.from(appIds, value => String(value)).filter(Boolean)) {
		deleteActivityCacheEntry(appId);
	}
}
