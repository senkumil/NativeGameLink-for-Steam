import type { NewsItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { FEED_CLASSES, POST_CLASSES } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { GDL_INJECTED } from './constants';
import { newsItemsSignature } from './news';
import type { NativeLibraryLayout } from './layout';
import { renderUnifiedActivityFeedSnapshot, setupStatusPostBox } from './social';

export interface ActivityViewOptions {
	steamAppId: string;
	shortcutAppId: string | null;
	newsItems: NewsItem[];
	headerImage: string;
}

export function createActivityView(
	doc: Document,
	layout: NativeLibraryLayout,
	options: ActivityViewOptions,
): HTMLElement {
	const wrapper = doc.createElement('div');
	wrapper.id = GDL_INJECTED;
	wrapper.dataset.gdlSteamAppId = options.steamAppId;
	if (options.shortcutAppId) wrapper.dataset.gdlShortcutAppId = options.shortcutAppId;
	wrapper.className = 'gdl-activity-container';
	wrapper.style.cssText = 'display:flex !important;flex-direction:column !important;justify-content:flex-start !important;align-items:stretch !important;min-height:0 !important;height:auto !important;flex:none !important;font-family:inherit;padding:0 12px 24px;margin-top:0 !important;padding-top:0 !important;overflow:visible;position:relative;';

	const postClasses = POST_CLASSES();
	const feedClasses = FEED_CLASSES();
	const isGamepad = steamUIModeService.isGamepadUI(doc);
	// Remote activity is hydrated after the page is mounted. Leave this area
	// empty until it arrives instead of rendering a second skeleton state.
	const sortedNews = [...options.newsItems].filter(item => item && item.title && Number(item.date || 0) > 0).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
	const latestNewsUrl = String(sortedNews[0]?.url || '').trim();
	// Always ask the feed snapshot owner for initial markup. It can reuse the
	// last in-memory news/friend snapshot when persistent storage is under quota,
	// avoiding an empty feed followed by a second paint on every revisit.
	const feedSnapshot = renderUnifiedActivityFeedSnapshot(
		options.steamAppId, options.shortcutAppId, options.newsItems, options.headerImage,
	);
	wrapper.innerHTML = `
		<div class="gdl-native-activity-heading-fallback gdl-ui-activity-heading" style="font-family:'Motiva Sans',Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:700;letter-spacing:1.5px;color:#8f98a0;margin:0 0 8px 0 !important;padding:0 !important;text-transform:uppercase;">${escapeHtml(gdlText('activity', loc('AppDetails_SectionTitle_Activity', 'Activity')).toUpperCase())}</div>
		<div class="${feedClasses.AddToFeed || ''} ${feedClasses.PostTextEntry || ''} gdl-status-box-container ${postClasses.PostTextEntry || ''}" style="display:block !important;margin:0 0 2px 0 !important;min-height:0 !important;position:relative !important;z-index:50 !important;">
			<textarea id="gdl-status-text" class="${postClasses.PostTextEntryArea}" rows="1" placeholder="${escapeHtml(gdlText('post_placeholder', loc('AppActivity_StatusUpdate_Post', 'Say something about this game to your friends...')))}"></textarea>
			${!isGamepad ? `
			<div id="gdl-status-controls" class="${postClasses.Controls}">
				<div class="${postClasses.FormattingSpacer}"></div>
				<button type="button" class="${postClasses.EmoticonButton} gdl-emoticon-btn" tabindex="-1" title="${escapeHtml(gdlText('emoticons', 'Emoticons'))}" style="position:relative;">
					<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style="display:block;">
						<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm-3.6 7.6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm8.7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM6.5 14.1h11c0 3.3-2.46 4.1-5.5 4.1s-5.5-.8-5.5-4.1Z"/>
					</svg>
					<span style="position:absolute;top:3px;right:4px;width:6px;height:6px;border-radius:50%;background:#ffd000;box-shadow:0 0 5px rgba(255,208,0,.95),0 0 10px rgba(255,180,0,.5);pointer-events:none;"></span>
				</button>
				<button type="button" id="gdl-status-post" class="${postClasses.PostButton}">
					<div class="${postClasses.Label}">${escapeHtml(gdlText('publish', loc('AppActivity_PostStatusUpdate', 'Post')))}</div>
				</button>
			</div>` : ''}
		</div>
		${(!isGamepad && latestNewsUrl) ? `<div class="gdl-latest-news-row"><button type="button" class="gdl-latest-news-button" data-gdl-open-url="${escapeHtml(latestNewsUrl)}">${escapeHtml(gdlText('latest_news', loc('AppActivity_ViewLatestNews', 'View latest news')))}</button></div>` : ''}
		<div id="gdl-activity-feed" data-gdl-news-signature="${newsItemsSignature(options.newsItems)}" data-gdl-feed-signature="${feedSnapshot.signature}">${feedSnapshot.html}</div>`;

	const sourceHeading = layout.anchorRegion
		? Array.from(layout.anchorRegion.children).find(child => child.tagName === 'H2') as HTMLElement | undefined
		: undefined;
	const fallbackHeading = wrapper.querySelector('.gdl-native-activity-heading-fallback');
	if (sourceHeading && fallbackHeading) {
		const heading = sourceHeading.cloneNode(true) as HTMLElement;
		const headingText = heading.querySelector('div div') || heading.querySelector('div') || heading;
		headingText.textContent = gdlText('activity', loc('AppDetails_SectionTitle_Activity', 'Activity'));
		heading.classList.add('gdl-ui-activity-heading');
		heading.style.setProperty('margin-top', '0px', 'important');
		heading.style.setProperty('margin-bottom', '8px', 'important');
		heading.style.setProperty('margin-left', '-12px', 'important');
		heading.style.setProperty('padding-bottom', '0px', 'important');
		fallbackHeading.replaceWith(heading);
	}
	return wrapper;
}

export function wireActivityView(doc: Document, wrapper: HTMLElement, options: ActivityViewOptions): void {
	setupStatusPostBox(doc, wrapper, options.steamAppId, options.shortcutAppId, options.newsItems, options.headerImage);
}
