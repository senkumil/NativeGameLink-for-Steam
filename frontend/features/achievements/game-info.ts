import { getGameData } from '../../core/game-data';
import { getResolvedLibraryAssets } from '../library/library-assets';

export interface LocalAchievementGameInfo {
	name: string;
	headerImage: string;
	heroImage: string;
	iconImage?: string;
}

const gameInfoCache = new Map<string, LocalAchievementGameInfo>();
const MAX_GAME_INFO_CACHE_ENTRIES = 24;

/** Use artwork already resolved for the Library without another backend read.
 * A notification can prime this metadata before artwork becomes available, so
 * refresh these fields even when the game-info snapshot itself is cached. */
function withCachedLibraryArtwork(appid: string, info: LocalAchievementGameInfo): LocalAchievementGameInfo {
	const assets = getResolvedLibraryAssets(appid);
	const heroImage = String(assets?.hero || assets?.hero2x || info.heroImage || '');
	const iconImage = String(assets?.icon || assets?.shortcut_icon || info.iconImage || '') || undefined;
	return heroImage === info.heroImage && iconImage === info.iconImage ? info : { ...info, heroImage, iconImage };
}

export async function getLocalAchievementGameInfo(appid: string): Promise<LocalAchievementGameInfo> {
	const cached = gameInfoCache.get(appid);
	if (cached) {
		const info = withCachedLibraryArtwork(appid, cached);
		if (info !== cached) gameInfoCache.set(appid, info);
		return info;
	}
	const data = await getGameData(appid).catch((): null => null);
	const info = withCachedLibraryArtwork(appid, {
		name: String(data?.name || `App ${appid}`),
		headerImage: String(data?.header_image || ''),
		heroImage: String(data?.background_raw || data?.background || data?.header_image || ''),
	});
	if (!data) return info;
	gameInfoCache.set(appid, info);
	while (gameInfoCache.size > MAX_GAME_INFO_CACHE_ENTRIES) {
		const oldest = gameInfoCache.keys().next().value as string | undefined;
		if (!oldest) break;
		gameInfoCache.delete(oldest);
	}
	return info;
}

export function clearLocalAchievementGameInfoCache(): void {
	gameInfoCache.clear();
}

export function invalidateLocalAchievementGameInfoCache(appIds: Iterable<string | number>): void {
	for (const appId of appIds) gameInfoCache.delete(String(appId));
}
