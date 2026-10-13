import { fetchFriendPersonasBackend } from '../../api/backend';
import { extractSteamIdFromValue, fetchFriendsGameplayInfo } from '../../steam/social';
import { cachePersona, getCachedPersona } from '../library/social/personas';

export interface AchievementComparisonFriend {
	steamid: string;
	name: string;
	avatar: string;
}

export interface FriendAchievementState {
	earned: boolean;
	earnedTime: number;
	progress: number;
}

interface CachedRequest<T> {
	expiresAt: number;
	request: Promise<T>;
}

interface ComparisonCache {
	friends: Map<string, CachedRequest<AchievementComparisonFriend[]>>;
	achievements: Map<string, CachedRequest<Map<string, FriendAchievementState>>>;
}

const caches = new WeakMap<Document, ComparisonCache>();
const CACHE_MS = 30_000;
const MAX_FRIEND_LISTS = 24;
const MAX_COMPARISONS = 64;
const MAX_FRIENDS_PER_GAME = 128;
const REQUEST_TIMEOUT_MS = 10_000;

function cacheFor(doc: Document): ComparisonCache {
	let cache = caches.get(doc);
	if (!cache) {
		cache = { friends: new Map(), achievements: new Map() };
		caches.set(doc, cache);
	}
	return cache;
}

function appIdentity(appid: string | number): string {
	const value = String(appid || '').trim();
	if (!/^\d+$/.test(value) || Number(value) <= 0 || Number(value) >= 2147483648) {
		throw new Error('achievement_comparison_invalid_appid');
	}
	return String(Number(value));
}

async function timed<T>(request: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			request,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('achievement_comparison_timeout')), REQUEST_TIMEOUT_MS);
			}),
		]);
	} finally { clearTimeout(timer); }
}

function cached<T>(cache: Map<string, CachedRequest<T>>, key: string, limit: number, load: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const existing = cache.get(key);
	if (existing && existing.expiresAt > now) {
		cache.delete(key); cache.set(key, existing);
		return existing.request;
	}
	for (const [oldKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(oldKey);
	const entry: CachedRequest<T> = { expiresAt: now + CACHE_MS, request: Promise.resolve(undefined as T) };
	entry.request = Promise.resolve().then(load).then(value => {
		entry.expiresAt = Date.now() + CACHE_MS;
		return value;
	}).catch(error => {
		if (cache.get(key) === entry) cache.delete(key);
		throw error;
	});
	cache.set(key, entry);
	while (cache.size > limit) cache.delete(cache.keys().next().value as string);
	return entry.request;
}

/** Use the same relevant friends as Steam's native comparison dropdown. */
export function getAchievementComparisonFriends(doc: Document, appid: string | number): Promise<AchievementComparisonFriend[]> {
	const app = appIdentity(appid);
	return cached(cacheFor(doc).friends, app, MAX_FRIEND_LISTS, async () => {
		const gameplay = await timed(fetchFriendsGameplayInfo(Number(app)));
		if (!gameplay) throw new Error('achievement_comparison_friends_unavailable');
		const ids = Array.from(new Set([
			...(gameplay.inGame || []), ...(gameplay.recentlyPlayed || []),
			...(gameplay.previouslyPlayed || []), ...(gameplay.owns || []),
		].map(friend => extractSteamIdFromValue(friend.steamid)).filter(id => /^\d{16,20}$/.test(id))))
			.slice(0, MAX_FRIENDS_PER_GAME);
		const missing = ids.filter(id => {
			const persona = getCachedPersona(id);
			return !persona?.name || persona.name === id;
		});
		if (missing.length > 0) {
			try {
				const raw = await timed(fetchFriendPersonasBackend({ steam_ids_csv: missing.join(',') }));
				const personas: unknown = JSON.parse(raw);
				if (Array.isArray(personas)) for (const persona of personas) {
					if (persona && ids.includes(String(persona.steamid))) {
						cachePersona({ steamid: String(persona.steamid), name: String(persona.name || ''), avatar: String(persona.avatar || '') });
					}
				}
			} catch { /* SteamID remains a truthful identity when persona lookup is unavailable. */ }
		}
		return ids.map(steamid => {
			const persona = getCachedPersona(steamid);
			return { steamid, name: persona?.name || steamid, avatar: persona?.avatar || '' };
		}).sort((a, b) => a.name.localeCompare(b.name));
	});
}

function nativeApps(doc: Document): any | null {
	const candidates: any[] = [doc.defaultView];
	if (typeof window !== 'undefined') candidates.push(window);
	for (const candidate of candidates) {
		for (const field of ['self', 'parent', 'top', 'opener']) {
			try {
				const view = field === 'self' ? candidate : candidate?.[field];
				const apps = view?.SteamClient?.Apps;
				if (typeof apps?.GetFriendAchievementsForApp === 'function') return apps;
			} catch {}
		}
	}
	return null;
}

/** Missing IDs remain absent from the result, never synthesized as locked. */
export function getFriendAchievementState(
	doc: Document,
	appid: string | number,
	steamid: string,
): Promise<Map<string, FriendAchievementState>> {
	const app = appIdentity(appid);
	const sid = String(steamid || '').trim();
	if (!/^\d{16,20}$/.test(sid)) throw new Error('achievement_comparison_invalid_steamid');
	return cached(cacheFor(doc).achievements, `${app}:${sid}`, MAX_COMPARISONS, async () => {
		const apps = nativeApps(doc);
		if (!apps) throw new Error('achievement_comparison_unavailable');
		const response = await timed(Promise.resolve(apps.GetFriendAchievementsForApp(app, sid)));
		if (Number(response?.result) !== 1) throw new Error('achievement_comparison_private_or_unavailable');
		if (!Array.isArray(response?.data?.rgAchievements)) throw new Error('achievement_comparison_invalid_response');
		const values = new Map<string, FriendAchievementState>();
		for (const achievement of response.data.rgAchievements) {
			const id = typeof achievement?.strID === 'string' ? achievement.strID.trim() : '';
			if (!id || ![true, false, 0, 1].includes(achievement.bAchieved)) continue;
			const earnedTime = Number(achievement.rtUnlocked);
			const progress = Number(achievement.flCurrentProgress);
			values.set(id, {
				earned: achievement.bAchieved === true || achievement.bAchieved === 1,
				earnedTime: Number.isFinite(earnedTime) && earnedTime > 0 ? Math.floor(earnedTime) : 0,
				progress: Number.isFinite(progress) && progress >= 0 ? progress : 0,
			});
		}
		return values;
	});
}
