/** Stable public facade for social/activity features. */
export type { SocialRuntimeHost } from './social/host';
export { configureSocialRuntimeHost } from './social/host';
export { friendDataSignature, getCachedFriendData, getFriendData, renderFriendsSection, hydrateFriendPersonas } from './social/friends';
export { populateActivityFeed } from './social/activity';
export {
	activityFeedContentSignature,
	applyUnifiedActivityFeed,
	renderUnifiedActivityFeed,
	renderUnifiedActivityFeedSnapshot,
	setupPostDeleteHandlers,
} from './social/feed';
export { setupStatusPostBox } from './social/status';

import { clearActivityFeedCaches } from './social/feed';
import { clearPersonaCache } from './social/personas';
import { clearEmptyFriendResults } from './social/friends';

export function clearSocialRuntimeCaches(): void {
	clearEmptyFriendResults();
	clearPersonaCache();
	clearActivityFeedCaches();
}
