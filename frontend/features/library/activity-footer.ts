import { FEED_CLASSES } from '../../steam/css';
import { escapeHtml } from '../../core/text';
import { gdlText, loc } from '../../steam/localization';

/** Use the native feed footer's boxes, including its text padding and rules. */
export function renderActivityFooter(hasMore: boolean): string {
	const css = FEED_CLASSES();
	if (hasMore) return `<div class="gdl-load-more-row"><button type="button" class="DialogButton _DialogLayout Secondary ${css.FetchMoreContainer} gdl-load-more-activity">${escapeHtml(gdlText('fetch_more', loc('AppActivity_FetchMore', 'Load more activity')))}</button></div>`;
	return `<div class="gdl-activity-end ${css.EndofFeed}"><div class="${css.EndRule}"></div><div class="${css.EndText}">${escapeHtml(gdlText('activity_end', 'End of activity'))}</div><div class="${css.EndRule}"></div></div>`;
}
