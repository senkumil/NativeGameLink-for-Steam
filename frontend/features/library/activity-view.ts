import type { NewsItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { FEED_CLASSES, HEADING_RESET_CLASSES, POST_CLASSES, resolveClassModule } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { GDL_INJECTED } from './constants';
import { newsItemsSignature } from './news';
import { nativeSectionClass, type NativeLibraryLayout } from './layout';
import { renderUnifiedActivityFeedSnapshot, setupStatusPostBox } from './social';

export interface ActivityViewOptions {
	steamAppId: string;
	shortcutAppId: string | null;
	newsItems: NewsItem[];
	headerImage: string;
}

type SharedComposer = { nodes: HTMLElement[]; key: string; textarea: HTMLTextAreaElement; drafts: Map<string, string> };
const sharedComposers = new WeakMap<Document, SharedComposer>();

const sectionFallback = {
	AppDetailsSection: '_2r4TK4BAuU-J4FuF_O7v_5', AppDetailsSectionContainer: '_31ptFGGMZrSQc5BCX1e5lm',
	AppDetailsSectionHasLabel: '_2G5B7o_YoI__u11--EFjal', Body: '_5uvIN6jXDXzzck59F-nhv',
};
const headingFallback = {
	SectionHeader: '_1Q2q_tQ9_Eq8YdEHNAHS3F', PadLeft: '_3jY6xWI4URhFyYsanh9VKL',
	Label: '_1SQ30LQnUhED7sXI79rmas', LabelText: '_3i0kopAostOz2IDi9HqmeN',
};
const emoticonFallback = { chatSubmitButton: 'RVIs84dAE6wHcjH9tkinc', EmoticonPickerButton: 'Aupswi7-c-w3XwNO5cp2i' };

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
		const body = wrapper.querySelector('.gdl-activity-body')!;
		const feed = body.querySelector('#gdl-activity-feed');
		for (const node of shared.nodes) {
			if (node.classList.contains('gdl-ui-activity-heading')) wrapper.insertBefore(node, wrapper.firstChild);
			else body.insertBefore(node, feed);
		}
	} else {
		const textarea = wrapper.querySelector<HTMLTextAreaElement>('#gdl-status-text');
		if (!textarea) return;
		shared = { key, textarea, drafts: new Map(), nodes: Array.from(wrapper.querySelectorAll<HTMLElement>(
			'.gdl-ui-activity-heading,.gdl-status-box-container,.gdl-latest-news-row')) };
		sharedComposers.set(doc, shared);
	}
	shared.textarea.placeholder = gdlText('post_placeholder', loc('AppActivity_StatusUpdate_Post', 'Say something about this game to your friends...'));
	const heading = wrapper.querySelector<HTMLElement>('.gdl-ui-activity-heading');
	const label = heading?.querySelector(':scope > div > div') || heading?.querySelector(':scope > div') || heading;
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
	wrapper.className = `gdl-activity-container ${nativeSectionClass(doc)}`;
	wrapper.style.cssText = 'min-height:0;height:auto;flex:none;padding:0;margin-top:0;overflow:visible;position:relative;';

	const postClasses = POST_CLASSES(doc);
	const feedClasses = FEED_CLASSES(doc);
	const section = resolveClassModule(module => Boolean(module.AppDetailsSectionContainer && module.AppDetailsSectionHasLabel && module.Body), sectionFallback, doc).classes;
	const heading = resolveClassModule(module => Boolean(module.SectionHeader && module.PadLeft && module.LabelText), headingFallback, doc).classes;
	const emoticon = resolveClassModule(module => Boolean(module.chatSubmitButton && module.EmoticonPickerButton), emoticonFallback, doc).classes;
	const isGamepad = steamUIModeService.isGamepadUI(doc);
	// Always ask the feed snapshot owner for initial markup. It can reuse the
	// last in-memory news/friend snapshot when persistent storage is under quota,
	// avoiding an empty feed followed by a second paint on every revisit.
	const feedSnapshot = renderUnifiedActivityFeedSnapshot(
		options.steamAppId, options.shortcutAppId, options.newsItems, options.headerImage,
	);
	// Keep Steam's heading, labeled section container and body as distinct
	// layers. The body's native gutter is additional to the heading's padding;
	// flattening them makes the composer and dates align with the heading.
	wrapper.innerHTML = `
		${sharedComposers.has(doc) ? '' : `
		<h2 class="gdl-native-activity-heading-fallback gdl-ui-activity-heading ${heading.SectionHeader} ${heading.PadLeft} ${HEADING_RESET_CLASSES(doc).Reset}"><div class="${heading.Label}"><div class="${heading.LabelText}">${escapeHtml(gdlText('activity', loc('AppDetails_SectionTitle_Activity', 'Activity')))}</div></div></h2>`}
		<div class="${section.AppDetailsSectionContainer} ${section.AppDetailsSectionHasLabel}"><div class="${section.Body} ${feedClasses.InnerContainer || ''} gdl-activity-body">
		${sharedComposers.has(doc) ? '' : `
		<div class="${feedClasses.AddToFeed || ''} ${feedClasses.PostTextEntry || ''} gdl-status-box-container ${postClasses.PostTextEntry || ''}">
			<textarea id="gdl-status-text" class="${postClasses.PostTextEntryArea}" rows="1" placeholder="${escapeHtml(gdlText('post_placeholder', loc('AppActivity_StatusUpdate_Post', 'Say something about this game to your friends...')))}"></textarea>
			${!isGamepad ? `
			<div id="gdl-status-controls" class="${postClasses.Controls}">
				<div class="${postClasses.FormattingSpacer}"></div>
				<button type="button" class="${postClasses.EmoticonButton} ${emoticon.chatSubmitButton} ${emoticon.EmoticonPickerButton} gdl-emoticon-btn" tabindex="-1" title="${escapeHtml(gdlText('emoticons', 'Emoticons'))}" style="position:relative;">
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
		<div class="gdl-latest-news-row"><button type="button" class="${feedClasses.ViewLastNews || ''} gdl-latest-news-button" data-gdl-open-url="">${escapeHtml(gdlText('latest_news', loc('AppActivity_ViewLatestNews', 'View latest news')))}</button></div>`}
		<div id="gdl-activity-feed" class="${feedClasses.ActivityFeedContainer}" data-gdl-news-signature="${newsItemsSignature(options.newsItems)}" data-gdl-feed-signature="${feedSnapshot.signature}">${feedSnapshot.html}</div></div></div>`;

	const sourceHeading = layout.anchorRegion
		? Array.from(layout.anchorRegion.children).find(child => child.tagName === 'H2') as HTMLElement | undefined
		: undefined;
	const fallbackHeading = wrapper.querySelector('.gdl-native-activity-heading-fallback');
	if (sourceHeading && fallbackHeading && heading.SectionHeader.split(/\s+/).filter(Boolean)
		.every(token => sourceHeading.classList.contains(token))) {
		const heading = sourceHeading.cloneNode(true) as HTMLElement;
		const headingText = heading.querySelector(':scope > div > div') || heading.querySelector(':scope > div') || heading;
		headingText.textContent = gdlText('activity', loc('AppDetails_SectionTitle_Activity', 'Activity'));
		heading.classList.add('gdl-ui-activity-heading');
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
