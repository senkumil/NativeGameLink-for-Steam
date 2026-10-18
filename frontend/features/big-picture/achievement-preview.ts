import type { LocalAchievementItem } from '../../domain/types';

// Steam's AppDetails response supplies at most twelve items per preview vector;
// its gamepad carousel renders those vectors unchanged. The full achievement
// snapshot remains available to the personal/global screen opened by each tile.
export const BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT = 12;
export function bigPictureAchievementPreview(items: LocalAchievementItem[]): {
	earned: LocalAchievementItem[]; locked: LocalAchievementItem[]; earnedHidden: LocalAchievementItem[];
} {
	const percent = (item: LocalAchievementItem): number => item.global_percent_known !== false
		&& Number.isFinite(item.global_percent) ? Number(item.global_percent) : -1;
	const schemaOrder = (a: LocalAchievementItem, b: LocalAchievementItem): number => {
		const first = Number((a as LocalAchievementItem & { schema_order?: number }).schema_order);
		const second = Number((b as LocalAchievementItem & { schema_order?: number }).schema_order);
		if (Number.isFinite(first) && Number.isFinite(second)) return first - second;
		return Number.isFinite(first) ? -1 : Number.isFinite(second) ? 1 : 0;
	};
	// Preserve supplied metadata order for equal unlock timestamps instead of
	// moving rare achievements first. The backend may provide a schema ordering.
	const earned = items.filter(item => item.earned)
		.sort((a, b) => (Number(b.earned_time) || 0) - (Number(a.earned_time) || 0) || schemaOrder(a, b));
	return {
		earned: earned.slice(0, BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT),
		earnedHidden: earned.filter(item => item.hidden).slice(0, BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT),
		locked: items.filter(item => !item.earned && !item.hidden)
			.sort((a, b) => percent(b) - percent(a) || schemaOrder(a, b))
			.slice(0, BIG_PICTURE_ACHIEVEMENT_PREVIEW_LIMIT),
	};
}
