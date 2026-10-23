import type { SteamCommunityItemsCatalog } from '../../domain/types';
import { communityBadgeId, communityCardId, type CommunityItemOptions } from '../../core/community-item-options';

/** Shared catalogue presentation for linked games in desktop and Big Picture.
 * This preview is independent of Steam account badge and inventory ownership. */
export function linkedCardPresentation(catalog: SteamCommunityItemsCatalog | null, options?: CommunityItemOptions | null) {
	const automatic = options == null || options.auto_foil === true;
	const enabled = automatic || options?.enabled === true;
	const allCards = [...(catalog?.cards || []), ...(catalog?.foil_cards || []).map(card => ({ ...card, foil: true }))];
	const badges = [...(catalog?.badges || []), ...(catalog?.foil_badge ? [catalog.foil_badge] : [])];
	// An incomplete public response cannot establish that foil objects do not
	// exist. Keep the preset while their definitions arrive in later batches.
	const hasFoil = allCards.some(card => card.foil) || badges.some(badge => badge.foil);
	const foil = automatic ? hasFoil || !(catalog?.cards_complete === true && catalog?.badges_complete === true)
		: enabled ? options!.card_border === 'foil' : !allCards.some(card => !card.foil) && allCards.some(card => card.foil);
	const seen = new Set<string>();
	const assets = allCards.filter(card => {
		const id = communityCardId(card);
		if (!id || seen.has(id) || (card.foil === true) !== foil) return false;
		seen.add(id); return true;
	});
	const collectionBadges = badges.filter(item => Boolean(item.foil) === foil)
		.sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1));
	const badge = enabled && !automatic ? collectionBadges.find(item => communityBadgeId(item) === options!.badge_id)
		: collectionBadges[collectionBadges.length - 1];
	const nextBadge = collectionBadges[0];
	const level = badge ? badge.foil ? 1 : Math.max(1, Number(badge.level) || 1) : 0;
	const maxLevel = foil ? 1 : Math.max(5, ...badges.filter(item => !item.foil).map(item => Number(item.level) || 0));
	const maxed = Boolean(badge) && level >= maxLevel;
	const selected = new Set(options?.card_ids || []);
	const cards = assets.map(card => ({ ...card, owned: automatic || !enabled || maxed || selected.has(communityCardId(card)) }));
	const ownedIds = new Set(cards.filter(card => card.owned).map(communityCardId));
	return { cards, badge, nextBadge, nextLevelXP: 100, remaining: cards.filter(card => !card.owned).length, xp: level * 100,
		level, maxLevel, maxed, enabled, automatic, foil, ownedIds, badgeMaxed: maxed };
}
