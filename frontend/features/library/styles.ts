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
	`);
	ensureInfoPanelStyles(doc);
	ensurePrimaryLinksStyles(doc);
	ensureActivityStyles(doc);
	ensureCommunityStyles(doc);
	ensureTradingCardStyles(doc);
	ensureStatusComposerStyles(doc);
	ensureHistoricalSidebarStyles(doc);
}

export function removeNativeGameInfoStyles(doc: Document): void {
	doc.getElementById('gdl-library-style-sentinel')?.remove();
}
