import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { ACH_CLASSES } from '../../steam/css';
import { loc } from '../../steam/localization';
import { getMappedShortcuts, toSignedShortcutAppId } from '../../steam/shortcuts';

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
		let result = read();
		if (!result && cache?.QueueCacheUpdate) {
			try { cache.QueueCacheUpdate(appId); } catch {}
			await new Promise(resolve => window.setTimeout(resolve, 50));
			result = read();
		}
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

function collectWindows(doc?: Document): any[] {
	const result: any[] = [];
	const add = (value: any): void => {
		if (value && !result.includes(value)) result.push(value);
	};
	if (doc?.defaultView) add(doc.defaultView);
	try {
		if (doc?.defaultView?.parent && doc.defaultView.parent !== doc.defaultView) {
			add(doc.defaultView.parent);
		}
	} catch {}
	try {
		if (doc?.defaultView?.top && doc.defaultView.top !== doc.defaultView) {
			add(doc.defaultView.top);
		}
	} catch {}
	if (typeof window !== 'undefined') add(window);
	return result;
}

/** Sync achievement progress to Steam's native appAchievementProgressCache for capsule sorting and subscript. */
export function syncNativeAchievementProgressCache(
	appId: number | string,
	unlocked: number,
	total: number,
	doc?: Document
): void {
	const raw = Number(appId);
	if (!Number.isFinite(raw) || raw === 0) return;
	const unsigned = raw >>> 0;
	const signed = toSignedShortcutAppId(unsigned);
	const targetTotal = Math.max(0, Number(total) || 0);
	const targetUnlocked = Math.min(targetTotal, Math.max(0, Number(unlocked) || 0));
	const percentage = targetTotal > 0 ? Math.floor((targetUnlocked / targetTotal) * 100) : 0;
	const entry = {
		appid: unsigned,
		total: targetTotal,
		unlocked: targetUnlocked,
		percentage,
		cache_time: 2147483647,
	};

	const wins = collectWindows(doc);
	for (const win of wins) {
		try {
			const cache = win?.appAchievementProgressCache;
			if (!cache) continue;
			if (!cache.m_achievementProgress) {
				cache.m_achievementProgress = { nVersion: 3, mapCache: new Map() };
			}
			if (!cache.m_achievementProgress.mapCache) {
				cache.m_achievementProgress.mapCache = new Map();
			}
			const mapCache = cache.m_achievementProgress.mapCache;
			mapCache.set(unsigned, { ...entry, appid: unsigned });
			mapCache.set(signed, { ...entry, appid: signed });
			mapCache.set(raw, { ...entry, appid: raw });

			const shortcuts = getMappedShortcuts();
			const shortcut = shortcuts.find(s => {
				const sUnsigned = Number(s.id) >>> 0;
				const sSigned = toSignedShortcutAppId(sUnsigned);
				return sUnsigned === unsigned || sSigned === signed || Number(s.steamAppId) === raw;
			});
			if (shortcut) {
				const sUnsigned = Number(shortcut.id) >>> 0;
				const sSigned = toSignedShortcutAppId(sUnsigned);
				const steamAppId = Number(shortcut.steamAppId);
				mapCache.set(sUnsigned, { ...entry, appid: sUnsigned });
				mapCache.set(sSigned, { ...entry, appid: sSigned });
				if (steamAppId > 0) {
					mapCache.set(steamAppId, { ...entry, appid: steamAppId });
				}
			}
		} catch (e) {
			backendLog(`[NGL] Failed to sync achievement progress cache: ${e}`);
		}
	}
}
