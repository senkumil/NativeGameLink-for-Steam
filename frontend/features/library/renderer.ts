import type { CommunityContentItem, FriendCategories, NewsItem, SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { GDL_INJECTED } from './constants';
import { getModernLibraryAssets, getResolvedLibraryAssets, linkedShortcutPortrait } from './artwork';
import { legacyInfoPortraitSync, resolveLegacyInfoPortrait } from './legacy-info-portrait';
import { ensureNativeGameChrome, removeNativeGameChrome, steamNativeGameInfo } from './native-chrome';
import {
	discoverNativeLibraryLayout,
	hideLinkedShortcutNotice,
	insertMainContent,
	prepareNativeLibraryLayout,
} from './layout';
import { refreshHistoricalSidebarSections, renderLinkedSidebarCore } from './sidebar-sections';
import { disposeControllerSidebarWatcher, getOwnedControllerSidebar, setupControllerSidebarWatcher } from './controller';
import { renderOptionalStoreSections } from './optional-sections';
import { createActivityView, parkSharedActivityComposer, wireActivityView } from './activity-view';
import { createPrimaryLinksBar, insertPrimaryLinksBar } from './primary-links';
import {
	disposeCommunitySection,
	insertCommunitySection,
	communityItemsSignature,
	renderCommunityContentHtml,
} from './community-view';
import { disposeTradingCardUI } from './trading-cards';
import { isLegacyGame } from './legacy-games';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { ownsCurrentLinkedPrimaryLinks } from './render-session';
import { adoptLinkedLoadingActivity, getLinkedLoadingActivity } from './first-content';
import { getOwnedAchievementSidebar } from './early-achievement-sidebar';
import { disposeLinkedSidebarOrder, ensureLinkedSidebarOrder } from './sidebar-order';

export interface LinkedGameRenderContext {
	shortcutAppId: string | null;
	isCurrent: () => boolean;
	generation?: number;
}

const INJECTED_SECTION_IDS = [
	'gdl-main-content-stack',
	GDL_INJECTED,
	'gdl-skeleton',
	'gdl-sidebar-skeleton',
	'gdl-controller-section',
	'gdl-friends-section',
	'gdl-achievements-section',
	'gdl-trading-cards-section',
	'gdl-dlc-section',
	'gdl-workshop-section',
	'gdl-link-bar',
	'gdl-community-content',
	'gdl-historical-info-section',
	'gdl-external-achievements-section',
] as const;

function cleanupPreviousRender(doc: Document, preserveLinkBar = false, preserveActivity?: HTMLElement | null, preserveAchievements?: HTMLElement | null, preserveController?: HTMLElement | null, preservedSidebar = new Set<HTMLElement>()): void {
	// The header can already have mounted this destination's links before the
	// metadata columns exist. A layout retry must keep that same visible node.
	preserveLinkBar = ownsCurrentLinkedPrimaryLinks(doc) || preserveLinkBar;
	if (!preserveActivity) parkSharedActivityComposer(doc);
	disposeControllerSidebarWatcher(doc, Boolean(preserveController));
	if (!preservedSidebar.size && !preserveAchievements && !preserveController) disposeLinkedSidebarOrder(doc);
	removeNativeGameChrome(doc, false, true, true, true);
	const cards = doc.getElementById('gdl-trading-cards-section');
	if (!cards || !preservedSidebar.has(cards)) disposeTradingCardUI(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	for (const id of INJECTED_SECTION_IDS) {
		if (preserveLinkBar && id === 'gdl-link-bar') continue;
		const node = doc.getElementById(id);
		if (node === preserveActivity || node === preserveAchievements || node === preserveController || (node && preservedSidebar.has(node))) continue;
		node?.remove();
	}
	doc.querySelectorAll<HTMLElement>('[data-gdl-hidden]').forEach(element => {
		element.style.display = '';
		element.removeAttribute('data-gdl-hidden');
	});
}

/**
 * Orchestrate one linked-game desktop Library render.
 *
 * Visual responsibilities intentionally live in small feature modules so Steam
 * parity work can evolve playbar/navigation/sidebar/community independently.
 * This function owns no Steam CSS discovery and no feature-specific markup.
 */
export function renderLinkedGamePage(
	doc: Document,
	noticeElement: Element,
	data: SteamGameData,
	steamAppId: string,
	newsItems: NewsItem[],
	friendResult: FriendCategories | null | undefined,
	communityItems: CommunityContentItem[] | undefined,
	context: LinkedGameRenderContext,
): boolean {
	if (noticeElement.ownerDocument !== doc || !noticeElement.isConnected || !context.isCurrent()) return false;
	const previousActivity = doc.getElementById(GDL_INJECTED) as HTMLElement | null;
	const firstActivity = getLinkedLoadingActivity(doc, steamAppId, context.shortcutAppId);
	const firstAchievements = getOwnedAchievementSidebar(doc, steamAppId, context.shortcutAppId);
	const firstController = getOwnedControllerSidebar(doc, steamAppId, context.shortcutAppId);
	const previousBelongsToSession = previousActivity?.dataset.gdlSteamAppId === steamAppId
		&& (!context.shortcutAppId || previousActivity.dataset.gdlShortcutAppId === context.shortcutAppId);
	const layout = discoverNativeLibraryLayout(doc, noticeElement);
	if (!layout.anchorRegion?.isConnected || !layout.sidebarColumn?.isConnected
		|| !layout.twoColumnRow?.isConnected || !layout.contentColumn?.isConnected) {
		if (!previousBelongsToSession || previousActivity?.dataset.gdlLayoutComplete !== '1') cleanupPreviousRender(doc, false, firstActivity, firstAchievements, firstController);
		return false;
	}
	// A metadata update for this same shortcut must not tear down the sidebar's
	// images, interactions or native neighbours before rebuilding the main feed.
	const preservedSidebar = new Set<HTMLElement>();
	for (const node of Array.from(layout.sidebarColumn.children)) {
		if (node instanceof HTMLElement && node.id.startsWith('gdl-')
			&& node.dataset.gdlSteamAppId === steamAppId
			&& (node.dataset.gdlShortcutAppId || null) === context.shortcutAppId) preservedSidebar.add(node);
	}
	cleanupPreviousRender(doc, previousBelongsToSession, firstActivity, firstAchievements, firstController, preservedSidebar);
	const isLegacy = isLegacyGame(steamAppId, data);
	const initialAssets = getResolvedLibraryAssets(steamAppId);
	prepareNativeLibraryLayout(layout);
	ensureLinkedSidebarOrder(doc, layout, { steamAppId, shortcutAppId: context.shortcutAppId,
		generation: context.generation, isCurrent: context.isCurrent });

	renderLinkedSidebarCore(doc, layout, {
		steamAppId,
		shortcutAppId: context.shortcutAppId,
		data,
		friendResult,
		modern: initialAssets,
		isCurrent: context.isCurrent,
		generation: context.generation,
	});

	setupControllerSidebarWatcher(doc, layout, steamAppId, context.shortcutAppId, context.isCurrent);

	const capabilities = renderOptionalStoreSections(doc, layout, {
		steamAppId,
		gameName: data.name,
		data,
		shortcutAppId: context.shortcutAppId,
		isCurrent: context.isCurrent,
	});

	const activityOptions = {
		steamAppId,
		shortcutAppId: context.shortcutAppId,
		newsItems,
		headerImage: data.header_image || '',
	};
	const activity = adoptLinkedLoadingActivity(doc, steamAppId, context.shortcutAppId) || createActivityView(doc, layout, activityOptions);
	// Steam's native content column can itself be a grid/flex layout. Inserting
	// Activity and Community as separate direct children lets that outer layout
	// place Community on a new row after the entire sidebar, leaving a tall gap.
	// Keep every injected main-column section inside one atomic native child.
	const mainContentStack = doc.createElement('div');
	mainContentStack.id = 'gdl-main-content-stack';
	mainContentStack.style.cssText = 'display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;min-width:0 !important;max-width:100% !important;height:auto !important;min-height:0 !important;flex:0 0 auto !important;box-sizing:border-box !important;overflow:visible !important;';
	mainContentStack.appendChild(activity);
	const primaryLinks = createPrimaryLinksBar(doc, layout, {
		steamAppId,
		shortcutAppId: context.shortcutAppId || undefined,
		isDelisted: data.is_delisted === true,
		hasWorkshop: capabilities.hasWorkshop,
		hasDlc: capabilities.dlcIds.length > 0,
	});

	insertMainContent(mainContentStack, layout, new Set(['gdl-main-content-stack', GDL_INJECTED, 'gdl-community-content']));
	if (!activity.isConnected || doc.getElementById(GDL_INJECTED) !== activity) {
		cleanupPreviousRender(doc);
		return false;
	}
	insertPrimaryLinksBar(primaryLinks, layout, activity);
	const expectsAchievements = (data.achievements?.total || 0) > 0;
	if (!doc.getElementById('gdl-link-bar') || !doc.getElementById('gdl-activity-feed')
		|| (expectsAchievements && !doc.getElementById('gdl-achievements-section'))) {
		cleanupPreviousRender(doc);
		return false;
	}
	hideLinkedShortcutNotice(noticeElement, layout);
	wireActivityView(doc, activity, activityOptions);

	const communityHtml = renderCommunityContentHtml(data, communityItems);
	const communityNode = insertCommunitySection(doc, layout, activity, communityHtml);
	if (communityNode) communityNode.dataset.gdlCommunitySignature = communityItemsSignature(communityItems || []);

	const linkedPortrait = context.shortcutAppId
		? linkedShortcutPortrait(context.shortcutAppId, steamAppId, initialAssets?.portrait || '')
		: initialAssets?.portrait || '';
	const initialModelAssets = {
		...(initialAssets || {}),
		// Information must reuse the exact validated portrait that was applied to
		// the shortcut, even when Steam's appinfo response omits library_capsule.
		portrait: isLegacy
			? legacyInfoPortraitSync(context.shortcutAppId, steamAppId) || linkedPortrait
			: linkedPortrait,
	};
	const initialInfo = steamNativeGameInfo(data, steamAppId, initialModelAssets);
	ensureNativeGameChrome(doc, initialInfo);
	const ownsMountedActivity = (): boolean => context.isCurrent() && activity.isConnected
		&& doc.getElementById(GDL_INJECTED) === activity
		&& activity.dataset.gdlSteamAppId === steamAppId
		&& (activity.dataset.gdlShortcutAppId || null) === context.shortcutAppId;
	void getModernLibraryAssets(steamAppId).then(async modernAssets => {
		if (!ownsMountedActivity()) return;
		const resolvedLinkedPortrait = context.shortcutAppId
			? linkedShortcutPortrait(context.shortcutAppId, steamAppId, modernAssets?.portrait || '')
			: modernAssets?.portrait || '';
		const portrait = isLegacy
			? await resolveLegacyInfoPortrait(context.shortcutAppId, steamAppId, resolvedLinkedPortrait)
			: resolvedLinkedPortrait;
		if (!ownsMountedActivity()) return;
		const resolvedAssets = isLegacy ? {
			...(modernAssets || {}),
			portrait,
		} : {
			...(modernAssets || {}),
			portrait: portrait || modernAssets?.portrait || '',
		};
		await runWhenLibrarySidebarIdle(doc, 'library-assets-chrome', () => {
			if (!ownsMountedActivity()) return;
			ensureNativeGameChrome(doc, steamNativeGameInfo(data, steamAppId, resolvedAssets));
			refreshHistoricalSidebarSections(doc, layout, data, steamAppId, modernAssets);
		});
	}).catch(() => {});

	activity.dataset.gdlLayoutComplete = '1';
	activity.dataset.gdlExpectsAchievements = expectsAchievements ? '1' : '0';
	activity.dataset.gdlExpectsFriends = '0';
	backendLog(`Injected layout for: ${data.name} (${newsItems.length} news items)`);
	return true;
}
