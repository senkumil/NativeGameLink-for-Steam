import { backendLog, fetchLibraryAssetsBackend } from '../../api/backend';
import { CACHE_RETENTION, CACHE_TTL, cacheDelete, cacheDeleteMatching, cacheRead, cacheSet } from '../../core/cache';
import { RetryingRequestCache } from '../../core/request-cache';
import { steamLanguageSync } from '../../steam/localization';
import { clearCommunityArtworkCaches } from './artwork-community';

export interface SteamLibraryAssets {
	found?: boolean;
	portrait?: string;
	hero?: string;
	hero2x?: string;
	logo?: string;
	wide?: string;
	legacy_header?: string; legacy_logo?: string;
	icon?: string;
	shortcut_icon?: string;
	shortcut_icon_extension?: string;
	shortcut_icons?: { url?: string; extension?: string }[];
	logo_position?: unknown;
	logo_position_source?: string;
	install_size?: number;
	franchise?: string;
	developers?: string[];
	publishers?: string[];
	genre_ids?: string[];
	controller_support?: string;
	category_ids?: number[];
	release_date?: string;
	source?: string;
}

const requests = new RetryingRequestCache<SteamLibraryAssets>({
	ttlMs: 10 * 60 * 1000, retries: 2, baseDelayMs: 150,
});
function requestKey(appId: string, language = steamLanguageSync() || 'english'): string {
	return `${appId}|${String(language || 'english').toLowerCase()}`;
}
function storageKey(appId: string, language: string): string {
	return `library_assets_v5_${language}_${appId}`;
}

function usableLibraryAssetSnapshot(data: SteamLibraryAssets | null | undefined): data is SteamLibraryAssets {
	// A bare { found:false, appid } response means the appinfo provider returned
	// no common block. It can be transient and must never become a 30-day miss.
	return Boolean(data && !(data.found === false && !data.source));
}

export function getCachedLibraryAssets(appId: string, language = steamLanguageSync() || 'english'):
	{ data: SteamLibraryAssets; fresh: boolean } | null {
	const entry = cacheRead<SteamLibraryAssets>(storageKey(appId, language),
		CACHE_TTL.libraryAssets, CACHE_RETENTION.libraryAssets);
	if (entry && usableLibraryAssetSnapshot(entry.data)) return { data: entry.data, fresh: entry.fresh };
	if (entry) cacheDelete(storageKey(appId, language));
	const fallbackV3 = cacheRead<SteamLibraryAssets>(`library_assets_v3_${language}_${appId}`,
		CACHE_TTL.libraryAssets, CACHE_RETENTION.libraryAssets);
	if (fallbackV3 && usableLibraryAssetSnapshot(fallbackV3.data)) return { data: fallbackV3.data, fresh: false };
	const legacy = cacheRead<SteamLibraryAssets>(`library_assets_v2_${language}_${appId}`,
		CACHE_TTL.libraryAssets, CACHE_RETENTION.libraryAssets);
	return legacy && usableLibraryAssetSnapshot(legacy.data) ? { data: legacy.data, fresh: false } : null;
}

export function getModernLibraryAssets(appId: string, requestedLanguage?: string,
	forceBackendRefresh = false): Promise<SteamLibraryAssets | null> {
	const language = String(requestedLanguage || steamLanguageSync() || 'english').toLowerCase();
	const key = requestKey(appId, language);
	const persisted = getCachedLibraryAssets(appId, language);
	if (persisted?.fresh && !forceBackendRefresh) return Promise.resolve(persisted.data);
	return requests.get(key, async () => {
		try {
			const parsed = JSON.parse(await fetchLibraryAssetsBackend({ request_json: JSON.stringify({
				steam_app_id: appId, language, force_refresh: forceBackendRefresh,
			}) }));
			const candidate = parsed && !parsed.error ? parsed as SteamLibraryAssets : null;
			const result = usableLibraryAssetSnapshot(candidate) ? candidate : null;
			if (!result) return null;
			const resolved = { ...(persisted?.data || {}), ...result };
			cacheSet(storageKey(appId, language), resolved);
			return resolved;
		} catch (error) {
			backendLog(`Modern library artwork lookup failed for ${appId}: ${error}`);
			return null;
		}
	}).then(value => value ?? persisted?.data ?? null).catch((error: unknown): SteamLibraryAssets | null => {
		backendLog(`Modern library artwork lookup exhausted for ${appId}: ${error}`);
		return persisted?.data || null;
	});
}

export function refreshModernLibraryAssets(appId: string, requestedLanguage?: string): Promise<SteamLibraryAssets | null> {
	const language = String(requestedLanguage || steamLanguageSync() || 'english').toLowerCase();
	requests.invalidate(requestKey(appId, language));
	cacheDelete(storageKey(appId, language));
	return getModernLibraryAssets(appId, language, true);
}

export function getResolvedLibraryAssets(appId: string): SteamLibraryAssets | null {
	return requests.peek(requestKey(appId)) || getCachedLibraryAssets(appId)?.data || null;
}

export function clearLibraryAssetDataCaches(): void {
	requests.clear();
	clearCommunityArtworkCaches();
	cacheDeleteMatching(key => key.startsWith('library_assets_v'));
}

export function invalidateLibraryAssetDataCaches(appIds: Iterable<string | number>): Set<string> {
	const ids = new Set(Array.from(appIds, value => String(value)).filter(value => /^\d+$/.test(value)));
	if (ids.size === 0) return ids;
	requests.invalidateMatching(key => ids.has(key.split('|', 1)[0]));
	clearCommunityArtworkCaches(ids);
	cacheDeleteMatching(key => {
		const appId = key.match(/^library_assets_v\d+_.+_(\d+)$/)?.[1];
		return Boolean(appId && ids.has(appId));
	});
	return ids;
}
