import type { SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getCachedCommunityContent, getCachedNews } from './news';
import { getCachedFriendData } from './social';
import { steamLanguageSync } from '../../steam/localization';
import { finalizeLinkedAchievements } from './achievement-chrome';
import { renderLinkedGamePage, type LinkedGameRenderContext } from './renderer';
import { refreshTradingCardUI } from './trading-cards';

/** A retained activity root does not prove that Steam retained its sidebar.
 * Renew intact card bindings without rebuilding the feed; rediscover a replaced
 * native column before mounting any of the destination's optional sections. */
export function renewMountedLinkedSidebar(doc: Document, notice: Element, data: SteamGameData | null,
	steamAppId: string, context: LinkedGameRenderContext): boolean {
	if (refreshTradingCardUI(doc, { steamAppId, ...context })) return true;
	if (!data || !context.isCurrent()) return false;
	const language = String(steamLanguageSync() || 'english').toLowerCase();
	const rendered = renderLinkedGamePage(doc, notice, data, steamAppId,
		getCachedNews(steamAppId, language, data)?.data || [], getCachedFriendData(steamAppId)?.data,
		getCachedCommunityContent(steamAppId, language)?.data || [], context);
	if (rendered) void finalizeLinkedAchievements(doc, { steamAppId, stateAppId: context.shortcutAppId || undefined,
		fallbackTotal: data.achievements?.total || 0, isCurrent: context.isCurrent })
		.catch(error => backendLog('Sidebar achievements recovery failed: ' + String(error)));
	return rendered;
}
