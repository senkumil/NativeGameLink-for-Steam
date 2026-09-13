import type { LocalAchievementItem } from '../../domain/types';

export const RARE_ACHIEVEMENT_MAX_PERCENT = 10;
export const MAX_HIGHLIGHTED_ACHIEVEMENTS = 1;

function safePercent(item: LocalAchievementItem): number {
	const value = Number(item.global_percent);
	return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function isRareAchievement(item: LocalAchievementItem): boolean {
	return safePercent(item) < RARE_ACHIEVEMENT_MAX_PERCENT;
}

function compareRarity(a: LocalAchievementItem, b: LocalAchievementItem): number {
	const aRare = Number(isRareAchievement(a));
	const bRare = Number(isRareAchievement(b));
	if (aRare !== bRare) return bRare - aRare;
	const percentDelta = safePercent(a) - safePercent(b);
	if (percentDelta !== 0) return percentDelta;
	return 0;
}

export function compareEarnedAchievementsForDisplay(a: LocalAchievementItem, b: LocalAchievementItem): number {
	return compareRarity(a, b)
		|| Number(b.earned_time || 0) - Number(a.earned_time || 0)
		|| String(a.display_name || a.name).localeCompare(String(b.display_name || b.name));
}

export function compareLockedAchievementsForDisplay(a: LocalAchievementItem, b: LocalAchievementItem): number {
	return compareRarity(a, b)
		|| String(a.display_name || a.name).localeCompare(String(b.display_name || b.name));
}

export function compareAchievementsForGlobalRarity(a: LocalAchievementItem, b: LocalAchievementItem): number {
	return safePercent(a) - safePercent(b)
		|| Number(b.earned) - Number(a.earned)
		|| Number(b.earned_time || 0) - Number(a.earned_time || 0)
		|| String(a.display_name || a.name).localeCompare(String(b.display_name || b.name));
}

/**
 * Pick a small, deterministic set of earned rare achievements for animated
 * highlighting. Keeping this selection bounded prevents every rare icon in a
 * large achievement set from animating at once and keeps the panel readable.
 */
export function highlightedAchievementNames(
	items: LocalAchievementItem[],
	max = MAX_HIGHLIGHTED_ACHIEVEMENTS,
): Set<string> {
	const limit = Math.max(0, Math.floor(Number(max) || 0));
	if (!limit) return new Set<string>();
	return new Set(
		items
			.filter(item => item.earned && isRareAchievement(item))
			.sort(compareEarnedAchievementsForDisplay)
			.slice(0, limit)
			.map(item => String(item.name)),
	);
}
