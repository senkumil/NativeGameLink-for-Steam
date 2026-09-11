import type { CommunityContentItem, SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getCommunityContent, getNews, newsItemsSignature } from './news';
import { scheduleCommunityHydration } from './community-view';
import {
	getFriendData,
	hydrateFriendPersonas,
	populateActivityFeed,
	applyUnifiedActivityFeed,
	setupPostDeleteHandlers,
} from './social';
import { GDL_INJECTED } from './constants';

export interface LinkedRenderSession {
	doc: Document;
	steamAppId: string;
	shortcutAppId: string | null;
	language: string;
	isCurrent: () => boolean;
}

function ownedActivityFeed(session: LinkedRenderSession): HTMLElement | null {
	const root = session.doc.getElementById(GDL_INJECTED) as HTMLElement | null;
	const feed = session.doc.getElementById('gdl-activity-feed') as HTMLElement | null;
	if (!root || !feed || !root.contains(feed) || root.dataset.gdlSteamAppId !== session.steamAppId) return null;
	if (session.shortcutAppId && root.dataset.gdlShortcutAppId !== session.shortcutAppId) return null;
	if (session.isCurrent()) return feed;
	// Generation may have advanced while staying on the exact same game/route
	// (e.g. mapping refresh debounce, modal dismiss, or sidebar navigation click).
	// If the current root is still connected and belongs to this game, allow hydration.
	const liveAppId = root.dataset.gdlSteamAppId;
	if (liveAppId === session.steamAppId && root.isConnected) return feed;
	return null;
}

/** Hydrate every non-core surface independently. None of these requests is
 * allowed to delay or rebuild the metadata page, and every DOM write is owned
 * by the exact document/AppID/shortcut/generation captured by the caller. */
export function hydrateLinkedSecondaryResources(session: LinkedRenderSession, data: SteamGameData): void {
	const activityGuard = {
		isCurrent: () => {
			if (session.isCurrent()) return true;
			const root = session.doc.getElementById(GDL_INJECTED) as HTMLElement | null;
			return Boolean(root?.isConnected && root.dataset.gdlSteamAppId === session.steamAppId);
		},
		shortcutAppId: session.shortcutAppId,
	};
	void getNews(session.steamAppId, session.language, data).then(newsItems => {
		const feed = ownedActivityFeed(session);
		if (!feed) return;
		const signature = newsItemsSignature(newsItems);
		applyUnifiedActivityFeed(
			feed,
			session.steamAppId,
			session.shortcutAppId,
			newsItems,
			data.header_image || '',
		);
		feed.dataset.gdlNewsSignature = signature;
		setupPostDeleteHandlers(
			session.doc,
			session.steamAppId,
			session.shortcutAppId,
			newsItems,
			data.header_image || '',
		);
		void populateActivityFeed(
			session.doc,
			session.steamAppId,
			data.name || '',
			data.header_image || '',
			newsItems,
			activityGuard,
		).catch(error => backendLog('Activity feed error: ' + String(error)));
	}).catch(error => backendLog('News hydration error: ' + String(error)));

	void getFriendData(session.steamAppId).then(async (friendResult): Promise<void> => {
		if (!session.isCurrent()) return;
		await hydrateFriendPersonas(
			session.doc,
			friendResult.data,
			session.steamAppId,
			data.name || '',
			{ isCurrent: session.isCurrent, shortcutAppId: session.shortcutAppId },
		);
	}).catch(error => backendLog('Friends hydration error: ' + String(error)));

	scheduleCommunityHydration(
		session.doc,
		data,
		() => getCommunityContent(session.steamAppId, session.language).catch((): CommunityContentItem[] => []),
		session.isCurrent,
	);
}

export function hydrateLinkedRouteResources(doc: Document, steamAppId: string, shortcutAppId: string | null,
	language: string, isCurrent: () => boolean, data: SteamGameData): void {
	hydrateLinkedSecondaryResources({ doc, steamAppId, shortcutAppId, language, isCurrent }, data);
}
