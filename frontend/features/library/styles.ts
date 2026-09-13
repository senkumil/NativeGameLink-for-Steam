import { injectLibraryStyle } from './styles/inject';
import { ensureInfoPanelStyles } from './styles/info';
import { ensurePrimaryLinksStyles } from './styles/primary-links';
import { ensureActivityStyles } from './styles/activity';
import { ensureCommunityStyles } from './styles/community';
import { ensureTradingCardStyles } from './styles/trading-cards';
import { ensureStatusComposerStyles } from './styles/status';
import { ensureHistoricalSidebarStyles } from './styles/historical-sidebar';

/**
 * Central library-style entry point. Individual visual surfaces own their own
 * fallback CSS so pixel-parity work can be changed and reviewed independently.
 */
export function ensureNativeGameInfoStyles(doc: Document): void {
	if (doc.getElementById('gdl-library-style-sentinel')) return;
	injectLibraryStyle(doc, 'gdl-library-style-sentinel', `
		[data-gdl-playbar-achievements="1"] .gdl-lp-fill{background:#2d73ff!important;}
		[class*="GameStatsSection"], [class*="gameStatsSection"] {
			min-width: 0 !important;
			flex-shrink: 1 !important;
			gap: 8px !important;
		}
		[class*="GameStat"], [class*="gameStat"] {
			min-width: 0 !important;
			overflow: visible !important;
		}
		[class*="PlayBarLabel"], [class*="playBarLabel"], [class*="LastPlayedLabel"], [class*="lastPlayedLabel"], [class*="GameStat"] [class*="PlayBarLabel"] {
			white-space: nowrap !important;
			overflow: visible !important;
			text-overflow: clip !important;
			font-size: 11px !important;
			letter-spacing: 0.3px !important;
		}
		[class*="PlayBarDetailLabel"], [class*="playBarDetailLabel"], [class*="LastPlayedInfo"], [class*="lastPlayedInfo"], [class*="GameStat"] [class*="PlayBarDetailLabel"] {
			white-space: nowrap !important;
			overflow: visible !important;
			font-size: 13px !important;
			font-weight: 600 !important;
		}
	`);
	ensureInfoPanelStyles(doc);
	ensurePrimaryLinksStyles(doc);
	ensureActivityStyles(doc);
	ensureCommunityStyles(doc);
	ensureTradingCardStyles(doc);
	ensureStatusComposerStyles(doc);
	ensureHistoricalSidebarStyles(doc);
}
