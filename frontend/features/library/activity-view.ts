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

type SharedComposer = { nodes: HTMLElement[]; key: string; textarea: HTMLTextAreaElement; drafts: Map<string, string> };
const sharedComposers = new WeakMap<Document, SharedComposer>();

/** Game-independent chrome keeps its DOM, focusable controls and native spacing.
 * Drafts remain scoped to the exact game instead of following the shared input. */
function reuseActivityComposer(doc: Document, wrapper: HTMLElement, options: ActivityViewOptions): void {
	let shared = sharedComposers.get(doc);
	const key = `${options.steamAppId}:${options.shortcutAppId || ''}`;
	if (shared) {
		if (shared.key !== key) {
			shared.drafts.delete(shared.key);
			if (shared.textarea.value) shared.drafts.set(shared.key, shared.textarea.value);
			while (shared.drafts.size > 16) shared.drafts.delete(shared.drafts.keys().next().value!);
			shared.textarea.value = shared.drafts.get(key) || '';
			shared.key = key;
			shared.nodes.find(node => node.classList.contains('gdl-status-box-container'))?.classList.remove('gdl-composer-active');
		}
		const feed = wrapper.querySelector('#gdl-activity-feed');
		for (const node of shared.nodes) wrapper.insertBefore(node, feed);
	} else {
		const textarea = wrapper.querySelector<HTMLTextAreaElement>('#gdl-status-text');
		if (!textarea) return;
		shared = { key, textarea, drafts: new Map(), nodes: Array.from(wrapper.children).filter(node => node.id !== 'gdl-activity-feed') as HTMLElement[] };
		sharedComposers.set(doc, shared);
	}
	shared.textarea.placeholder = gdlText('post_placeholder', loc('AppActivity_StatusUpdate_Post', 'Say something about this game to your friends...'));
	const heading = wrapper.querySelector<HTMLElement>('.gdl-ui-activity-heading');
	const label = heading?.querySelector('div div') || heading?.querySelector('div') || heading;
	if (label) label.textContent = gdlText('activity', loc('AppDetails_SectionTitle_Activity', 'Activity'));
	refreshActivityNewsLink(doc, options);
}

export function refreshActivityNewsLink(doc: Document, options: ActivityViewOptions): void {
	const shared = sharedComposers.get(doc);
	if (!shared || shared.key !== `${options.steamAppId}:${options.shortcutAppId || ''}`) return;
	const row = shared.nodes.find(node => node.classList.contains('gdl-latest-news-row'));
	const button = row?.querySelector<HTMLElement>('.gdl-latest-news-button');
	if (!row || !button) return;
	const latest = [...options.newsItems].filter(item => item?.url && item.title && Number(item.date || 0) > 0)
		.sort((a, b) => Number(b.date || 0) - Number(a.date || 0))[0];
	button.dataset.gdlOpenUrl = latest?.url || '';
	button.textContent = gdlText('latest_news', loc('AppActivity_ViewLatestNews', 'View latest news'));
	row.style.display = latest && !steamUIModeService.isGamepadUI(doc) ? '' : 'none';
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
	// Always ask the feed snapshot owner for initial markup. It can reuse the
	// last in-memory news/friend snapshot when persistent storage is under quota,
	// avoiding an empty feed followed by a second paint on every revisit.
	const feedSnapshot = renderUnifiedActivityFeedSnapshot(
		options.steamAppId, options.shortcutAppId, options.newsItems, options.headerImage,
	);
	wrapper.innerHTML = `
		${sharedComposers.has(doc) ? '' : `
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
		<div class="gdl-latest-news-row"><button type="button" class="gdl-latest-news-button" data-gdl-open-url="">${escapeHtml(gdlText('latest_news', loc('AppActivity_ViewLatestNews', 'View latest news')))}</button></div>`}
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
	reuseActivityComposer(doc, wrapper, options);
	return wrapper;
}

export function wireActivityView(doc: Document, wrapper: HTMLElement, options: ActivityViewOptions): void {
	refreshActivityNewsLink(doc, options);
	setupStatusPostBox(doc, wrapper, options.steamAppId, options.shortcutAppId, options.newsItems, options.headerImage);
}

export function disposeSharedActivityComposer(doc: Document): void { sharedComposers.delete(doc); }

/** Retain only the small shared controls, never their previous feed/ancestors. */
export function parkSharedActivityComposer(doc: Document): void {
	for (const node of sharedComposers.get(doc)?.nodes || []) node.remove();
}
