import { backendLog } from '../../api/backend';
import { ensureLocalPlaybarStat } from '../achievements/playbar';
import { getAchievementProgress } from '../achievements/progress';
import { revealPendingAchievementSidebar, renderLocalAchievementSidebar } from '../achievements/sidebar';
import { cacheLocalAchievements, getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import { isCurrentAchievementTarget, linkedAchievementTarget, ownsAchievementSidebar } from '../achievements/navigation';
import { fetchLocalAchievementData } from '../achievements/service';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';

export interface LinkedAchievementChromeContext {
	steamAppId: string;
	fallbackTotal: number;
	stateAppId?: string;
	isCurrent: () => boolean;
}

/** Warm only this installation's snapshot; a Steam alias may describe another
 * shortcut linked to the same public AppID and cannot satisfy this request. */
export async function warmLocalAchievements(steamAppId: string, shortcutAppId: string | null): Promise<void> {
	if (getCachedLocalAchievementsForShortcut(steamAppId, shortcutAppId)) return;
	const data = await fetchLocalAchievementData(steamAppId, { stateAppId: shortcutAppId });
	if (data?.found && String(data.metadata_appid || data.appid) === steamAppId
		&& Array.isArray(data.achievements) && data.total > 0) cacheLocalAchievements(data, steamAppId, shortcutAppId);
}

/** All cached, IPC and native-cache paths share the same final ownership guard. */
export async function finalizeLinkedAchievements(doc: Document, context: LinkedAchievementChromeContext): Promise<void> {
	const target = linkedAchievementTarget(doc);
	if (!target || target.steamAppId !== context.steamAppId || target.shortcutAppId !== context.stateAppId || !context.isCurrent()) return;
	const root = doc.getElementById('gdl-library-injected');
	const current = (): boolean => context.isCurrent() && isCurrentAchievementTarget(doc, target)
		&& doc.getElementById('gdl-library-injected') === root && (!root || root.isConnected);
	const paint = (data: import('../../domain/types').LocalAchievementData): void => {
		if (ownsAchievementSidebar(doc, target)) renderLocalAchievementSidebar(doc, data);
		ensureLocalPlaybarStat(doc, data);
	};
	const apply = (data: import('../../domain/types').LocalAchievementData): Promise<void> => {
		if (!current() || String(data.metadata_appid || data.appid) !== target.steamAppId) return Promise.resolve();
		cacheLocalAchievements(data, target.steamAppId, target.shortcutAppId);
		return runWhenLibrarySidebarIdle(doc, 'linked-achievements', () => {
			if (!current()) return;
			paint(getCachedLocalAchievementsForShortcut(target.steamAppId, target.shortcutAppId) || data);
		});
	};
	const cachedLocal = getCachedLocalAchievementsForShortcut(target.steamAppId, target.shortcutAppId);
	if (cachedLocal?.found && Array.isArray(cachedLocal.achievements) && cachedLocal.total > 0) {
		void apply(cachedLocal).catch(error => backendLog('Cached achievements render error: ' + String(error)));
	}
	try {
		const local = await fetchLocalAchievementData(target.steamAppId, { stateAppId: target.shortcutAppId });
		if (!current()) return;
		if (local?.found && Array.isArray(local.achievements) && local.total > 0) { await apply(local); return; }
	} catch (error) {
		backendLog('Local achievements check in finalizeLinkedAchievements error: ' + error);
	}
	const progress = await getAchievementProgress(Number(target.steamAppId), context.fallbackTotal);
	if (!current()) return;
	await runWhenLibrarySidebarIdle(doc, 'linked-achievements', () => {
		if (!current()) return;
		const latest = getCachedLocalAchievementsForShortcut(target.steamAppId, target.shortcutAppId);
		if (latest?.found && latest.total > 0) { paint(latest); return; }
		if (progress && progress.total > 0) {
			// A provisional result can never replace confirmed data queued by the
			// lifecycle while the native list was scrolling.
			ensureLocalPlaybarStat(doc, {
				found: false, appid: target.steamAppId, metadata_appid: target.steamAppId,
				state_appid: target.shortcutAppId, ...progress, achievements: [],
			});
		}
		if (ownsAchievementSidebar(doc, target)) revealPendingAchievementSidebar(doc);
	});
}
