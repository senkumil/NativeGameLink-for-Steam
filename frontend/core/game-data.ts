import type { GameDataCache, SteamGameData } from '../domain/types';
import { fetchGameData, backendLog } from '../api/backend';
import { CACHE_RETENTION, CACHE_TTL, cacheDeleteMatching, cacheRead, cacheSet } from './cache';
import { RetryingRequestCache } from './request-cache';
import { getSteamLanguage, steamLanguageSync } from '../steam/localization';
import { mappings } from './mappings';
import { normalizeSteamGameData } from './steam-game-data';

export const gameDataCache: GameDataCache = {};
const MAX_GAME_DATA_CACHE_KEYS = 64;

export interface CachedGameDataSnapshot {
	data: SteamGameData;
	fresh: boolean;
}

export function gameDataLanguageKey(steamAppId: string, language: string): string {
	return `${steamAppId}:${String(language || 'english').toLowerCase()}`;
}

function persistentGameDataKey(steamAppId: string, language: string): string {
	// v4 recognizes retired AppDetails records whose Steam type is
	// "advertising". Do not reuse their former active-page classification.
	return `gamedata_v4_${steamAppId}_${String(language || 'english').toLowerCase()}`;
}

/** Keep the persistent core snapshot compact enough for large libraries. The
 * desktop/Big Picture renderers never consume Store movies, and only expose a
 * bounded number of DLC, screenshots and highlighted achievements. */
export function compactGameDataForCache(data: SteamGameData): SteamGameData {
	const normalized = normalizeSteamGameData(data) || data;
	const descriptionFallback = String(normalized.about_the_game || normalized.detailed_description || '').slice(0, 12000);
	return {
		...normalized,
		detailed_description: normalized.short_description ? undefined : descriptionFallback,
		about_the_game: normalized.short_description ? undefined : descriptionFallback,
		dlc: normalized.dlc?.slice(0, 6),
		screenshots: normalized.screenshots?.slice(0, 15),
		movies: undefined,
		achievements: normalized.achievements ? {
			total: normalized.achievements.total,
			highlighted: normalized.achievements.highlighted?.slice(0, 12),
		} : undefined,
	};
}

export function cacheGameDataValue(key: string, value: SteamGameData): void {
	const normalized = normalizeSteamGameData(value);
	if (!normalized) return;
	delete gameDataCache[key];
	gameDataCache[key] = normalized;
	const keys = Object.keys(gameDataCache);
	for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_GAME_DATA_CACHE_KEYS))) delete gameDataCache[oldest];
}

export function getCachedGameData(steamAppId: string, language: string): CachedGameDataSnapshot | null {
	const languageKey = gameDataLanguageKey(steamAppId, language);
	const memory = gameDataCache[languageKey];
	if (memory) {
		const normalized = normalizeSteamGameData(memory);
		if (normalized) {
			cacheGameDataValue(languageKey, normalized);
			return { data: normalized, fresh: true };
		}
		delete gameDataCache[languageKey];
	}
	const stored = cacheRead<SteamGameData>(persistentGameDataKey(steamAppId, language),
		CACHE_TTL.gameMetadata, CACHE_RETENTION.gameMetadata);
	if (!stored) return null;
	const normalized = normalizeSteamGameData(stored.data);
	if (!normalized) return null;
	if (stored.fresh) cacheGameDataValue(languageKey, normalized);
	return { data: normalized, fresh: stored.fresh };
}

export function getSynchronousGameData(steamAppId: string, requestedLanguage?: string): SteamGameData | null {
	const language = String(requestedLanguage || steamLanguageSync() || 'english').toLowerCase();
	const languageKey = gameDataLanguageKey(steamAppId, language);
	const memory = gameDataCache[languageKey];
	if (memory) {
		const normalized = normalizeSteamGameData(memory);
		if (normalized) return normalized;
	}
	const cached = getCachedGameData(steamAppId, language);
	return cached?.data || null;
}

export function warmupAllMappedGameData(): void {
	const language = String(steamLanguageSync() || 'english').toLowerCase();
	try {
		for (const [, value] of Object.entries(mappings)) {
			if (typeof value === 'string' && /^\d+$/.test(value)) {
				const cached = getCachedGameData(value, language);
				if (cached?.data) {
					cacheGameDataValue(gameDataLanguageKey(value, language), cached.data);
				}
			}
		}
	} catch {}
}
const transientLocalizedGameData = new WeakSet<SteamGameData>();
const gameDataRequests = new RetryingRequestCache<SteamGameData>({
	ttlMs: 5 * 60 * 1000,
	retries: 0,
	baseDelayMs: 150,
	isCacheable: (value): value is SteamGameData => Boolean(value && !transientLocalizedGameData.has(value)),
});
const canonicalGameDataRequests = new RetryingRequestCache<SteamGameData>({
	ttlMs: 30 * 60 * 1000,
	retries: 0,
	baseDelayMs: 150,
});
const sourceGameDataRequests = new RetryingRequestCache<SteamGameData>({
	ttlMs: 5 * 60 * 1000,
	retries: 2,
	baseDelayMs: 150,
});

function getSourceGameData(steamAppId: string, language: string): Promise<SteamGameData | null> {
	const normalizedLanguage = String(language || 'english').toLowerCase();
	return sourceGameDataRequests.get(gameDataLanguageKey(steamAppId, normalizedLanguage), async () => {
		const raw = await fetchGameData({ steam_app_id: steamAppId, language: normalizedLanguage });
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && !parsed.error ? normalizeSteamGameData(parsed) : null;
	});
}

export function mergeSteamEnglishFallback<T>(preferred: T, english: T): T {
	if (preferred === undefined || preferred === null || preferred === '') return english;
	if (Array.isArray(preferred)) return (preferred.length > 0 ? preferred : english) as T;
	if (typeof preferred === 'object' && preferred && typeof english === 'object' && english && !Array.isArray(english)) {
		const result: Record<string, unknown> = { ...(english as any) };
		for (const key of new Set([...Object.keys(english as any), ...Object.keys(preferred as any)])) {
			result[key] = mergeSteamEnglishFallback((preferred as any)[key], (english as any)[key]);
		}
		return result as T;
	}
	return preferred;
}


/** Fetch language-invariant identity metadata. UI content remains localized,
 * but mutating a non-Steam shortcut name from localized Store data would make
 * Steam regenerate its shortcut AppID whenever the client language changes. */
export async function getCanonicalGameData(steamAppId: string): Promise<SteamGameData | null> {
	try {
		return await canonicalGameDataRequests.get(steamAppId, async () => {
			return getSourceGameData(steamAppId, 'english');
		});
	} catch (e) {
		backendLog('Canonical game data fetch failed for ' + steamAppId + ': ' + e);
		return null;
	}
}

export async function getGameData(steamAppId: string, requestedLanguage?: string): Promise<SteamGameData | null> {
	const language = String(requestedLanguage || await getSteamLanguage().catch(() => 'english') || 'english').toLowerCase();
	const languageKey = gameDataLanguageKey(steamAppId, language);
	if (gameDataCache[languageKey]) {
		const memory = normalizeSteamGameData(gameDataCache[languageKey]);
		if (memory) {
			cacheGameDataValue(languageKey, memory);
			return memory;
		}
		delete gameDataCache[languageKey];
	}
	const cached = getCachedGameData(steamAppId, language);
	if (cached?.fresh) {
		return cached.data;
	}
	try {
	return await gameDataRequests.get(languageKey, async () => {
		const [preferredData, englishData] = await Promise.all([
			getSourceGameData(steamAppId, language),
			language === 'english' ? Promise.resolve(null) : getSourceGameData(steamAppId, 'english').catch((): null => null),
		]);
		const merged = preferredData
			? (englishData ? mergeSteamEnglishFallback(preferredData, englishData) : preferredData)
			: englishData;
		const data = normalizeSteamGameData(merged);
		if (!data) return null;
		const isPartialLocalization = language !== 'english' && (!preferredData || (!englishData && !preferredData.short_description && !preferredData.detailed_description));
		if (isPartialLocalization && (!preferredData || !englishData)) {
			// Render the available language immediately, but retry the missing half
			// instead of persisting a partial localization for thirty days.
			transientLocalizedGameData.add(data);
			return data;
		}
		cacheGameDataValue(languageKey, data);
		cacheSet(persistentGameDataKey(steamAppId, language), compactGameDataForCache(data));
		return data;
		});
	} catch (e) {
		backendLog('Fetch failed for ' + steamAppId + ': ' + e);
		return null;
	}
}

export function clearGameDataCache(): void {
	for (const key of Object.keys(gameDataCache)) delete gameDataCache[key];
	gameDataRequests.clear();
	canonicalGameDataRequests.clear();
	sourceGameDataRequests.clear();
}

/** Invalidate every localized form of selected AppIDs. Used when a shortcut is
 * relinked so a late request for the former identity cannot repaint the page. */
export function invalidateGameDataCaches(appIds: Iterable<string | number>): void {
	const ids = new Set(Array.from(appIds, value => String(value)).filter(value => /^\d+$/.test(value)));
	if (ids.size === 0) return;
	for (const key of Object.keys(gameDataCache)) {
		if (ids.has(key.split(':', 1)[0])) delete gameDataCache[key];
	}
	gameDataRequests.invalidateMatching(key => ids.has(key.split(':', 1)[0]));
	sourceGameDataRequests.invalidateMatching(key => ids.has(key.split(':', 1)[0]));
	for (const appId of ids) canonicalGameDataRequests.invalidate(appId);
	cacheDeleteMatching(key => {
		const appId = key.match(/^gamedata_v\d+_(\d+)_/)?.[1];
		return Boolean(appId && ids.has(appId));
	});
}
