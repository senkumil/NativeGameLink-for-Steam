import type { NewsItem } from '../../domain/types';
import { getGameData, getSynchronousGameData } from '../../core/game-data';
import { escapeHtml } from '../../core/text';
import { NativePaintQueue } from '../../core/after-native-paint';
import { committedHeaderAppId } from '../../steam/library-details';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { gdlText, steamLanguageSync } from '../../steam/localization';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { routedSteamAppId } from './native-route';
import { createActivityView, parkSharedActivityComposer, refreshActivityNewsLink, wireActivityView, type ActivityViewOptions } from './activity-view';
import { discoverNativeLibraryLayout, discoverNativeLibraryLayoutForShortcut, hideLinkedShortcutNotice, insertMainContent, prepareNativeLibraryLayout } from './layout';
import { ensureNativeGameInfoStyles } from './styles';
import { getCachedNews, getNews } from './news';
import { applyUnifiedActivityFeed, setupPostDeleteHandlers } from './social';
import { disposeActivityFeedInteractions, getRetainedActivityNews } from './social/feed';
import { disposeStatusPostBox } from './social/status';
import { disposeTradingCardUI } from './trading-cards';
import { disposeControllerSidebarWatcher } from './controller';
import { getOwnedAchievementSidebar, syncEarlyAchievementSidebar } from './early-achievement-sidebar';

export const FIRST_CONTENT_ID = 'gdl-skeleton';
export interface LinkedLoadingContext { steamAppId: string; shortcutAppId: string | null; isCurrent: () => boolean }
type FirstContent = { context: LinkedLoadingContext; generation: number; activity: HTMLElement | null; requested: boolean; options: ActivityViewOptions };
const stages = new WeakMap<Document, FirstContent>();
const preparedRoutes = new WeakMap<Document, string>();
const firstPaints = new NativePaintQueue();

/** Begin data I/O while Steam paints its own artwork. No DOM or image requests. */
export function warmVisibleLinkedResources(doc: Document): void {
	if (doc.hidden) return;
	const shortcut = routedSteamAppId(doc);
	if (!shortcut || shortcut < 2147483648 || isShortcutDismissed(shortcut)) return;
	const appId = getCommittedShortcutSteamAppId(shortcut);
	if (!appId) return;
	const language = steamLanguageSync() || 'english';
	const key = `${shortcut}:${appId}:${language}`;
	if (preparedRoutes.get(doc) === key) return;
	preparedRoutes.set(doc, key);
	const cached = getSynchronousGameData(appId, language);
	void getGameData(appId, language).catch(() => {});
	void getNews(appId, language, cached).catch(() => {});
}

function current(doc: Document, state: FirstContent): boolean {
	const shortcut = Number(state.context.shortcutAppId);
	return stages.get(doc) === state && !doc.hidden && !doc.defaultView?.closed && state.context.isCurrent()
		&& routedSteamAppId(doc) === shortcut && !isShortcutDismissed(shortcut)
		&& getCommittedShortcutSteamAppId(shortcut) === state.context.steamAppId;
}

function hasRealNews(items: NewsItem[]): boolean {
	return items.some(item => item.feedname !== 'steam_store_release_metadata');
}

function pendingNewsHtml(): string {
	return `<div class="gdl-news-pending" role="status" style="margin:0 0 16px;color:#8f98a0;">
		<div style="height:17px;margin:0 0 8px;background:rgba(143,152,160,.12);width:100px;" aria-hidden="true"></div>
		<div class="gdl-news-card" style="cursor:default;"><div class="gdl-news-layout">
			<div class="gdl-news-image" style="background:rgba(143,152,160,.08);" aria-hidden="true"></div>
			<div class="gdl-news-copy" style="flex:1;min-width:0;padding:12px 18px 16px 0;">
				<div>${escapeHtml(gdlText('achievement_path_loading', 'Loading...'))}</div>
				<div style="height:14px;margin-top:16px;width:85%;background:rgba(143,152,160,.12);" aria-hidden="true"></div>
				<div style="height:12px;margin-top:12px;width:65%;background:rgba(143,152,160,.08);" aria-hidden="true"></div>
			</div></div></div></div>`;
}

/** Mount the small current-game columns without waiting for artwork decoding. */
export function stageLinkedFirstContent(doc: Document, notice: Element, generation: number, context: LinkedLoadingContext): void {
	let state = stages.get(doc);
	if (!state || state.generation !== generation || state.context.steamAppId !== context.steamAppId || state.context.shortcutAppId !== context.shortcutAppId) {
		clearLinkedFirstContent(doc);
		state = { context, generation, activity: null, requested: false,
			options: { steamAppId: context.steamAppId, shortcutAppId: context.shortcutAppId, newsItems: [], headerImage: '' } };
		stages.set(doc, state);
	} else state.context = context;
	if (!current(doc, state)) return;
	const layout = discoverNativeLibraryLayout(doc, notice);
	if (!layout.contentColumn?.isConnected || !layout.anchorRegion?.isConnected) return;
	for (const element of [notice, layout.contentColumn, layout.sidebarColumn, layout.twoColumnRow, layout.anchorRegion]) {
		const owner = element && committedHeaderAppId(element as HTMLElement);
		if (owner != null && owner !== Number(context.shortcutAppId)) return;
	}
	const mounted = doc.getElementById('gdl-library-injected');
	if (mounted?.dataset.gdlSteamAppId === context.steamAppId && mounted.dataset.gdlShortcutAppId === context.shortcutAppId) return;
	if (mounted) {
		disposeControllerSidebarWatcher(doc, true);
		disposeTradingCardUI(doc);
		disposeActivityFeedInteractions(doc);
		disposeStatusPostBox(doc);
		parkSharedActivityComposer(doc);
		(mounted.closest('#gdl-main-content-stack') || mounted).remove();
	}
	for (const section of Array.from(layout.sidebarColumn?.children || [])) {
		if (section instanceof HTMLElement && section.id.startsWith('gdl-')
			&& (section.dataset.gdlSteamAppId !== context.steamAppId || section.dataset.gdlShortcutAppId !== context.shortcutAppId)) section.remove();
	}
	if (context.shortcutAppId) syncEarlyAchievementSidebar(doc, notice, context.steamAppId, context.shortcutAppId, generation, () => current(doc, state!));
	const language = steamLanguageSync() || 'english';
	const data = getSynchronousGameData(context.steamAppId, language);
	if (!state.activity?.isConnected) {
		const news = getCachedNews(context.steamAppId, language, data);
		const retained = getRetainedActivityNews(context.steamAppId);
		const newsItems = hasRealNews(news?.data || []) ? news!.data : retained?.length ? retained : news?.data || [];
		state.options = { ...state.options, newsItems, headerImage: data?.header_image || '' };
		const activity = createActivityView(doc, layout, state.options);
		activity.id = FIRST_CONTENT_ID;
		activity.style.boxSizing = 'border-box';
		const feed = activity.querySelector<HTMLElement>('#gdl-activity-feed');
		// A retained real feed can exist even after the persistent cache expired.
		if (feed && !hasRealNews(state.options.newsItems)
			&& !news?.fresh && !feed.querySelector('.gdl-local-post,.gdl-friend-activity')) {
			feed.innerHTML = pendingNewsHtml();
			feed.setAttribute('aria-busy', 'true');
			delete feed.dataset.gdlFeedSignature;
			const latestRow = activity.querySelector<HTMLElement>('.gdl-latest-news-row');
			if (latestRow) latestRow.style.display = 'none';
		}
		state.activity = activity;
		prepareNativeLibraryLayout(layout);
		insertMainContent(activity, layout, new Set([FIRST_CONTENT_ID, 'gdl-link-bar']));
		if (!activity.isConnected) return;
		hideLinkedShortcutNotice(notice, layout);
		wireActivityView(doc, activity, state.options);
		setupPostDeleteHandlers(doc, context.steamAppId, context.shortcutAppId, state.options.newsItems, state.options.headerImage);
	}
	if (state.requested) return;
	state.requested = true;
	const active = state;
	const publish = (items: NewsItem[]): void => {
		if (!current(doc, active)) return;
		void runWhenLibrarySidebarIdle(doc, 'first-content-news', () => {
			if (!current(doc, active) || !active.activity?.isConnected) return;
			const feed = active.activity.querySelector<HTMLElement>('#gdl-activity-feed');
			if (!feed) return;
			active.options.newsItems = items;
			refreshActivityNewsLink(doc, active.options);
			applyUnifiedActivityFeed(feed, context.steamAppId, context.shortcutAppId, items, active.options.headerImage);
			feed.removeAttribute('aria-busy');
			setupPostDeleteHandlers(doc, context.steamAppId, context.shortcutAppId, items, active.options.headerImage);
		}).catch(() => {});
	};
	void getNews(context.steamAppId, language, data, publish).then(publish).catch(() => {});
}

/** The native columns can appear before the shortcut notice or its logo. This
 * cheap synchronous commit also runs from the native mutation microtask, so
 * Notes/Media never get a frame above the current game's known upper blocks. */
export function syncEarlyLinkedFirstContent(doc: Document, generation: number, isCurrent: () => boolean): HTMLElement | null {
	if (doc.hidden || doc.defaultView?.closed || !isCurrent()) return null;
	const shortcut = routedSteamAppId(doc);
	if (!shortcut || shortcut < 2147483648 || isShortcutDismissed(shortcut)) return null;
	const steamAppId = getCommittedShortcutSteamAppId(shortcut);
	if (!steamAppId) return null;
	const mounted = doc.getElementById('gdl-library-injected');
	if (mounted?.dataset.gdlSteamAppId === steamAppId && mounted.dataset.gdlShortcutAppId === String(shortcut)) return null;
	const layout = discoverNativeLibraryLayoutForShortcut(doc, shortcut);
	if (!layout.contentColumn || !layout.anchorRegion || !isCurrent()) return null;
	ensureNativeGameInfoStyles(doc);
	stageLinkedFirstContent(doc, layout.contentColumn, generation, {
		steamAppId, shortcutAppId: String(shortcut), isCurrent,
	});
	return getLinkedLoadingActivity(doc, steamAppId, String(shortcut));
}

export function getLinkedLoadingActivity(doc: Document, steamAppId: string, shortcutAppId: string | null): HTMLElement | null {
	const state = stages.get(doc);
	return state && current(doc, state) && state.context.steamAppId === steamAppId && state.context.shortcutAppId === shortcutAppId
		&& state.activity?.isConnected && state.activity.id === FIRST_CONTENT_ID ? state.activity : null;
}

export function adoptLinkedLoadingActivity(doc: Document, steamAppId: string, shortcutAppId: string | null): HTMLElement | null {
	const activity = getLinkedLoadingActivity(doc, steamAppId, shortcutAppId);
	if (activity) activity.id = 'gdl-library-injected';
	return activity;
}

export function clearLinkedFirstContent(doc: Document): void {
	cancelLinkedFirstContentPaint(doc);
	const state = stages.get(doc);
	if (state?.activity?.id === FIRST_CONTENT_ID) { parkSharedActivityComposer(doc); state.activity.remove(); }
	stages.delete(doc);
}

/** Paint the small first-content commit before optional sections do more work. */
export function paintLinkedFirstContent(doc: Document, generation: number): Promise<void> {
	const state = stages.get(doc);
	if (!state || (!state.activity?.isConnected && !getOwnedAchievementSidebar(doc, state.context.steamAppId, state.context.shortcutAppId))) return Promise.resolve();
	return firstPaints.run(doc, String(generation), () => {});
}

export function cancelLinkedFirstContentPaint(doc: Document): void { firstPaints.cancel(doc); }
