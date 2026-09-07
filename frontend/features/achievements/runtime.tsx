/**
 * Public achievements facade.
 *
 * Keep consumers depending on this stable surface while implementation details
 * live in focused modules. This file intentionally contains no rendering logic.
 */
export type { AchievementRuntimeHost } from './context';
export { configureAchievementRuntimeHost } from './context';
export type { AchievementProgress } from './progress';
export { achievementPercentText, getAchievementProgress, renderAchievementsPanel, syncNativeAchievementProgressCache } from './progress';
export { deterministicTestUnlockCount, formatLocalUnlockDate, localAchievementPercent } from './format';
export { makeLinkedAchievementsClickable, focusAchievementsSection, detectLinkedSteamAppId } from './navigation';
export {
	registerNativeAchievementToastWindow,
	unregisterNativeAchievementToastWindow,
	showAchievementToast,
	isEveryLaunchAchievementReplayEnabled,
	setEveryLaunchAchievementReplayEnabled,
	setNextLaunchAchievementReplayEnabled,
	resetLocalAchievementToastBaseline,
	subscribeAchievementReplayPreferences,
} from './notifications';
export { startFirstLaunchAchievementWatcher, stopFirstLaunchAchievementWatcher } from './launch-watcher';
export { renderLocalAchievementSidebarHtml, renderLocalAchievementSidebar, revealPendingAchievementSidebar, ensureLocalAchievementSidebarResponsiveGrid, achievementSidebarColumnsForWidth } from './sidebar';
export { findVisibleTextElement, ensureLocalPlaybarStat } from './playbar';
export { openLocalAchievementsModal } from './modal';
export {
	getCachedLocalAchievements,
	getCachedLocalAchievementsForGame,
	hasCachedLocalAchievements,
	cacheLocalAchievements,
	clearLocalAchievementCache,
} from './cache';
export { installLocalAchievementUI, disposeLocalAchievementUI, refreshLocalAchievementUI, disposeAchievementRuntime } from './lifecycle';
