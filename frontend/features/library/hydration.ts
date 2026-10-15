import type { CommunityContentItem, SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getCommunityContent, getNews, newsItemsSignature } from './news';
import { scheduleCommunityHydration } from './community-view';
import {
	getFriendData,
	hydrateFriendPersonas,
	populateActivityFeed,
	activityFeedContentSignature,
	applyUnifiedActivityFeed,
	setupPostDeleteHandlers,
} from './social';
import { GDL_INJECTED } from './constants';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { refreshActivityNewsLink } from './activity-view';
import { getRetainedActivityNews } from './social/feed';

export interface LinkedRenderSession {
	doc: Document;
	steamAppId: string;
	shortcutAppId: string | null;
	language: string;
	isCurrent: () => boolean;
}

const HYDRATION_QUIET_MS = 30_000;
type MountedHydration = { key: string; input: string; checkedAt: number; session: LinkedRenderSession };
const mountedHydrations = new WeakMap<HTMLElement, MountedHydration>();

function ownedActivityFeed(session: LinkedRenderSession): HTMLElement | null {
	const root = session.doc.getElementById(GDL_INJECTED) as HTMLElement | null;
	const feed = session.doc.getElementById('gdl-activity-feed') as HTMLElement | null;
	if (!root || !feed || !root.contains(feed) || root.dataset.gdlSteamAppId !== session.steamAppId) return null;
	if ((root.dataset.gdlShortcutAppId || null) !== session.shortcutAppId) return null;
	return root.isConnected && session.isCurrent() ? feed : null;
}

/** Only fields consumed by secondary surfaces. Fresh core metadata may change
 * these without replacing the mounted root, and must still reach the feed. */
function hydrationInput(data: SteamGameData): string {
	return JSON.stringify([data.name, data.header_image, data.is_delisted === true,
		data.release_date?.date, data.release_date?.coming_soon,
		data.screenshots?.slice(0, 30).map(item => [item.path_thumbnail, item.path_full])]);
}

/** Hydrate every non-core surface independently. None of these requests is
 * allowed to delay or rebuild the metadata page, and every DOM write is owned
 * by the exact document/AppID/shortcut/generation captured by the caller. */
export function hydrateLinkedSecondaryResources(session: LinkedRenderSession, data: SteamGameData): void {
	const initialFeed = ownedActivityFeed(session);
	const root = session.doc.getElementById(GDL_INJECTED) as HTMLElement | null;
	if (!root || !initialFeed) return;
	const key = JSON.stringify([session.steamAppId, session.shortcutAppId, session.language.toLowerCase()]);
	const input = hydrationInput(data);
	const previous = mountedHydrations.get(root);
	if (previous?.key === key && previous.input === input && Date.now() - previous.checkedAt < HYDRATION_QUIET_MS) {
		// Observer passes can advance a generation on this exact mount. Keep the
		// newest guard while sharing the original network work and DOM callbacks.
		previous.session = session;
		return;
	}
	const state: MountedHydration = { key, input, checkedAt: Date.now(), session };
	mountedHydrations.set(root, state);
	const isCurrent = (): boolean => mountedHydrations.get(root) === state
		&& session.doc.getElementById(GDL_INJECTED) === root
		&& ownedActivityFeed(state.session) === initialFeed;
	const activityGuard = { isCurrent, shortcutAppId: session.shortcutAppId };
	const commitNews = (newsItems: import('../../domain/types').NewsItem[]): void => {
		if (!isCurrent()) return;
		void runWhenLibrarySidebarIdle(session.doc, 'secondary-news', () => {
			if (!isCurrent()) return;
			const signature = newsItemsSignature(newsItems);
			const header = data.header_image || '';
			if (initialFeed.dataset.gdlFeedSignature !== activityFeedContentSignature(session.steamAppId, session.shortcutAppId, newsItems, header)) {
				applyUnifiedActivityFeed(initialFeed, session.steamAppId, session.shortcutAppId, newsItems, header);
			}
			initialFeed.dataset.gdlNewsSignature = signature;
			initialFeed.removeAttribute('aria-busy');
			refreshActivityNewsLink(session.doc, { steamAppId: session.steamAppId, shortcutAppId: session.shortcutAppId,
				newsItems: getRetainedActivityNews(session.steamAppId) || newsItems, headerImage: header });
			setupPostDeleteHandlers(session.doc, session.steamAppId, session.shortcutAppId, newsItems, header);
		}).catch(error => backendLog('News render error: ' + String(error)));
	};
	void getNews(session.steamAppId, session.language, data, commitNews).then(commitNews)
		.catch(error => backendLog('News hydration error: ' + String(error)));
	// Friend activity is independent of slow publisher endpoints. Resolve the
	// news input from the feed's latest snapshot when activity eventually commits,
	// rather than capturing a partial news result and repainting it much later.
	void populateActivityFeed(session.doc, session.steamAppId, data.name || '', data.header_image || '', [], activityGuard)
		.catch(error => backendLog('Activity feed error: ' + String(error)));

	void getFriendData(session.steamAppId).then(async (friendResult): Promise<void> => {
		if (!isCurrent()) return;
		await hydrateFriendPersonas(
			session.doc,
			friendResult.data,
			session.steamAppId,
			data.name || '',
			{ isCurrent, shortcutAppId: session.shortcutAppId },
		);
	}).catch(error => backendLog('Friends hydration error: ' + String(error)));

	scheduleCommunityHydration(
		session.doc,
		data,
		() => getCommunityContent(session.steamAppId, session.language).catch((): CommunityContentItem[] => []),
		isCurrent,
	);
}

export function hydrateLinkedRouteResources(doc: Document, steamAppId: string, shortcutAppId: string | null,
	language: string, isCurrent: () => boolean, data: SteamGameData): void {
	hydrateLinkedSecondaryResources({ doc, steamAppId, shortcutAppId, language, isCurrent }, data);
}
