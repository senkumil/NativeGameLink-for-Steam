import type { SteamCommunityItemsCatalog } from '../../domain/types';

/** Shared catalogue presentation for linked games in desktop and Big Picture.
 * This preview is independent of Steam account badge and inventory ownership. */
export function linkedCardPresentation(catalog: SteamCommunityItemsCatalog | null) {
	const badge = catalog?.foil_badge || catalog?.badges?.find(item => item.foil)
		|| catalog?.badges?.[catalog.badges.length - 1];
	return { badge, remaining: 0, xp: 100 };
}
