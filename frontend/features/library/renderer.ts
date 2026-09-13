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
import { setupControllerSidebarWatcher } from './controller';
import { renderOptionalStoreSections } from './optional-sections';
import { createActivityView, wireActivityView } from './activity-view';
import { createPrimaryLinksBar, insertPrimaryLinksBar } from './primary-links';
import {
	disposeCommunitySection,
	insertCommunitySection,
	communityItemsSignature,
	renderCommunityContentHtml,
} from './community-view';
import { disposeTradingCardPreview } from './trading-cards';
import { isLegacyGame } from './legacy-games';

export interface LinkedGameRenderContext {
	shortcutAppId: string | null;
	isCurrent: () => boolean;
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
	'gdl-playbar-achievements',
	'gdl-link-bar',
	'gdl-community-content',
	'gdl-historical-info-section',
	'gdl-external-achievements-section',
] as const;

const controllerWatchers = new WeakMap<Document, () => void>();

function cleanupPreviousRender(doc: Document, preserveLinkBar = false): void {
	controllerWatchers.get(doc)?.();
	controllerWatchers.delete(doc);
	removeNativeGameChrome(doc);
	disposeTradingCardPreview(doc);
	const community = doc.getElementById('gdl-community-content');
	if (community instanceof HTMLElement) disposeCommunitySection(community);
	for (const id of INJECTED_SECTION_IDS) {
		if (preserveLinkBar && id === 'gdl-link-bar') continue;
		doc.getElementById(id)?.remove();
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
	const previousBelongsToSession = previousActivity?.dataset.gdlSteamAppId === steamAppId
		&& (!context.shortcutAppId || previousActivity.dataset.gdlShortcutAppId === context.shortcutAppId);
	const layout = discoverNativeLibraryLayout(doc, noticeElement);
	if (!layout.anchorRegion?.isConnected || !layout.sidebarColumn?.isConnected
		|| !layout.twoColumnRow?.isConnected || !layout.contentColumn?.isConnected) {
		if (!previousBelongsToSession || previousActivity?.dataset.gdlLayoutComplete !== '1') cleanupPreviousRender(doc);
		return false;
	}
	cleanupPreviousRender(doc, previousBelongsToSession);
	const isLegacy = isLegacyGame(steamAppId, data);
	const initialAssets = getResolvedLibraryAssets(steamAppId);
	prepareNativeLibraryLayout(layout);

	renderLinkedSidebarCore(doc, layout, {
		steamAppId,
		shortcutAppId: context.shortcutAppId,
		data,
		friendResult,
		modern: initialAssets,
	});

	controllerWatchers.get(doc)?.();
	controllerWatchers.set(doc, setupControllerSidebarWatcher(doc, layout, steamAppId, context.shortcutAppId, context.isCurrent));

	const capabilities = renderOptionalStoreSections(doc, layout, {
		steamAppId,
		gameName: data.name,
		data,
		isCurrent: context.isCurrent,
	});

	const activityOptions = {
		steamAppId,
		shortcutAppId: context.shortcutAppId,
		newsItems,
		headerImage: data.header_image || '',
	};
	const activity = createActivityView(doc, layout, activityOptions);
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
	void getModernLibraryAssets(steamAppId).then(async modernAssets => {
		if (!context.isCurrent()) return;
		const resolvedLinkedPortrait = context.shortcutAppId
			? linkedShortcutPortrait(context.shortcutAppId, steamAppId, modernAssets?.portrait || '')
			: modernAssets?.portrait || '';
		const portrait = isLegacy
			? await resolveLegacyInfoPortrait(context.shortcutAppId, steamAppId, resolvedLinkedPortrait)
			: resolvedLinkedPortrait;
		if (!context.isCurrent()) return;
		const resolvedAssets = isLegacy ? {
			...(modernAssets || {}),
			portrait,
		} : {
			...(modernAssets || {}),
			portrait: portrait || modernAssets?.portrait || '',
		};
		ensureNativeGameChrome(doc, steamNativeGameInfo(data, steamAppId, resolvedAssets));
		refreshHistoricalSidebarSections(doc, layout, data, steamAppId, modernAssets);
	}).catch(() => {});

	activity.dataset.gdlLayoutComplete = '1';
	activity.dataset.gdlExpectsAchievements = expectsAchievements ? '1' : '0';
	activity.dataset.gdlExpectsFriends = '0';
	backendLog(`Injected layout for: ${data.name} (${newsItems.length} news items)`);
	return true;
}
