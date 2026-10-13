import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { ACH_CLASSES } from '../../steam/css';
import { loc } from '../../steam/localization';

export interface AchievementProgress { unlocked: number; total: number }

export function achievementPercentText(unlocked: number, total: number): string {
	if (total <= 0) return '(0%)';
	const pct = Math.round((100 * unlocked) / total);
	if (pct === 0 && unlocked > 0) return '(<1%)';
	if (pct === 100 && unlocked < total) return '(>99%)';
	return `(${pct}%)`;
}

/** Read Steam's native achievement-progress cache for a linked Store AppID. */
export async function getAchievementProgress(appId: number, fallbackTotal: number): Promise<AchievementProgress | null> {
	try {
		const cache = (window as any).appAchievementProgressCache;
		const read = (): AchievementProgress | null => {
			try {
				const entry = cache?.m_achievementProgress?.mapCache?.get?.(appId);
				return entry && entry.total > 0 ? { unlocked: entry.unlocked || 0, total: entry.total } : null;
			} catch { return null; }
		};
		// This AppID identifies the public Steam game. Reading a linked game's
		// provisional count must not trigger native cache writes or list refreshes.
		const result = read();
		if (result) {
			backendLog(`Achievement progress for ${appId}: ${result.unlocked}/${result.total}`);
			return result;
		}
	} catch (error) {
		backendLog('Achievement progress error: ' + error);
	}
	return fallbackTotal > 0 ? { unlocked: 0, total: fallbackTotal } : null;
}

/** Native Steam sidebar progress fragment. */
export function renderAchievementsPanel(unlocked: number, total: number): string {
	const classes = ACH_CLASSES();
	const pct = total > 0 ? Math.round((100 * unlocked) / total) : 0;
	const token = unlocked >= total ? 'AppDetails_PlayerUnlockedPercentAll' : 'AppDetails_PlayerUnlockedPercent';
	const text = loc(token, "You've unlocked %1$s/%2$s")
		.replace('%1$s', String(unlocked))
		.replace('%2$s', String(total));
	return `<div class="${classes.HighlightDiv}">
		<div class="${classes.UnlockedLabel}" style="font-size:13px;line-height:18px;"><span>${escapeHtml(text)}</span><span class="${classes.UnlockedLabelPercent}"> ${achievementPercentText(unlocked, total)}</span></div>
		<div class="${classes.AchievementProgressContainer}"><div class="${classes.AchievementProgress}" style="width:${pct}%;"></div></div>
	</div>`;
}
