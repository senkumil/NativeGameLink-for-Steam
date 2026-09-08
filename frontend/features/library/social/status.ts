import type { NewsItem } from '../../../domain/types';
import { DisposableRegistry } from '../../../core/disposables';
import { escapeHtml } from '../../../core/text';
import { POST_CLASSES } from '../../../steam/css';
import { gdlText } from '../../../steam/localization';
import { postStatusUpdate } from '../../../steam/social';
import { steamUIModeService } from '../../../steam/ui/SteamUIModeService';
import { showSteamVirtualKeyboard, hideSteamVirtualKeyboard } from '../../../steam/gamepad/virtual-keyboard';
import {
	getCurrentSteamUser,
	applyUnifiedActivityFeed,
	saveLocalActivityPost,
	setupPostDeleteHandlers,
	STEAM_EMOTICONS,
} from './feed';

const statusComposerLifecycles = new WeakMap<Document, DisposableRegistry>();

export function disposeStatusPostBox(doc: Document): void {
	statusComposerLifecycles.get(doc)?.dispose();
	statusComposerLifecycles.delete(doc);
	doc.getElementById('gdl-emoticon-picker')?.remove();
}

export function setupStatusPostBox(
	doc: Document,
	wrapper: HTMLElement,
	steamAppId: string,
	shortcutAppId: string | null | undefined,
	newsItems: NewsItem[],
	fallbackImage: string,
): void {
	disposeStatusPostBox(doc);
	const statusArea = wrapper.querySelector('#gdl-status-text') as HTMLTextAreaElement | null;
	const statusRow = wrapper.querySelector('#gdl-status-controls') as HTMLElement | null;
	const postButton = wrapper.querySelector('#gdl-status-post') as HTMLButtonElement | null;
	const emoticonButton = wrapper.querySelector('.gdl-emoticon-btn') as HTMLButtonElement | null;
	const latestNewsButton = wrapper.querySelector('.gdl-latest-news-button') as HTMLButtonElement | null;
	if (!statusArea) return;

	const isGamepad = steamUIModeService.isGamepadUI(doc);

	const lifecycle = new DisposableRegistry(() => {
		doc.getElementById('gdl-emoticon-picker')?.remove();
		statusComposerLifecycles.delete(doc);
	});
	statusComposerLifecycles.set(doc, lifecycle);

	const activeClass = POST_CLASSES().Active;
	const enabledClass = POST_CLASSES().Enabled;
	const container = (wrapper.querySelector('.gdl-status-box-container') as HTMLElement | null) || wrapper;
	const syncPostButtonState = (): void => {
		if (!postButton) return;
		const enabled = statusArea.value.trim().length > 0;
		postButton.classList.toggle(enabledClass, enabled);
		postButton.classList.toggle('is-enabled', enabled);
		postButton.toggleAttribute('data-gdl-enabled', enabled);
		postButton.disabled = false;
	};

	const autoResizeTextarea = (): void => {
		if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content')) {
			statusArea.style.removeProperty('height');
			return;
		}
		const hasContent = statusArea.value.length > 0;
		const isActive = container.classList.contains('gdl-composer-active') || doc.activeElement === statusArea || hasContent;
		if (!isActive && !hasContent) {
			statusArea.style.setProperty('height', '40px', 'important');
			return;
		}
		statusArea.style.setProperty('height', 'auto', 'important');
		const contentH = statusArea.scrollHeight;
		const nextH = Math.max(64, contentH);
		statusArea.style.setProperty('height', `${nextH}px`, 'important');
	};

	const setActive = (active: boolean): void => {
		if (statusRow) statusRow.classList.toggle(activeClass, active);
		container.classList.toggle('gdl-composer-active', active);
		autoResizeTextarea();
	};

	const submitPost = (): void => {
		const text = statusArea.value.trim();
		if (!text) return;
		const user = getCurrentSteamUser(doc);
		saveLocalActivityPost(steamAppId, {
			id: 'post_' + Date.now(),
			text,
			timestamp: Math.floor(Date.now() / 1000),
			user_name: user.name,
			user_avatar: user.avatar,
		}, shortcutAppId);
		statusArea.value = '';
		syncPostButtonState();
		setActive(false);
		autoResizeTextarea();
		doc.getElementById('gdl-emoticon-picker')?.remove();

		const numericAppId = Number.parseInt(steamAppId, 10);
		if (Number.isFinite(numericAppId) && numericAppId > 0) void postStatusUpdate(numericAppId, text).catch(() => {});

		const feedContainer = doc.getElementById('gdl-activity-feed');
		if (feedContainer) {
			delete feedContainer.dataset.gdlFeedSignature;
			applyUnifiedActivityFeed(feedContainer, steamAppId, shortcutAppId, newsItems, fallbackImage);
			setupPostDeleteHandlers(doc, steamAppId, shortcutAppId, newsItems, fallbackImage);
		}
	};

	lifecycle.listen(statusArea, 'input', () => {
		syncPostButtonState();
		autoResizeTextarea();
	});
	lifecycle.listen(statusArea, 'focus', () => {
		setActive(true);
		autoResizeTextarea();
		if (isGamepad) {
			showSteamVirtualKeyboard(doc, statusArea);
		}
	});
	lifecycle.listen(statusArea, 'click', () => {
		if (isGamepad) {
			showSteamVirtualKeyboard(doc, statusArea);
		}
	});
	lifecycle.listen(statusArea, 'blur', () => {
		lifecycle.timeout(() => {
			if (!statusArea.value.trim() && doc.activeElement !== statusArea && !doc.getElementById('gdl-emoticon-picker')) {
				setActive(false);
			}
			autoResizeTextarea();
		}, 60);
	});
	lifecycle.listen(statusArea, 'keydown', rawEvent => {
		const event = rawEvent as KeyboardEvent;
		if (event.key === 'Enter') {
			if (isGamepad) {
				if (!event.shiftKey) {
					event.preventDefault();
					submitPost();
					hideSteamVirtualKeyboard(doc);
				}
			} else if (event.ctrlKey || event.metaKey) {
				submitPost();
			}
		} else if (event.key === 'Escape') {
			if (isGamepad) {
				hideSteamVirtualKeyboard(doc);
			}
		}
	});

	if (postButton) {
		lifecycle.listen(postButton, 'click', submitPost);
	}

	syncPostButtonState();
	autoResizeTextarea();

	// Keep the expanded composer from collapsing between pointer down and click.
	// Its height change moves the news button out from under the pointer, causing
	// the browser to cancel the first click instead of following the link.
	if (latestNewsButton) {
		lifecycle.listen(latestNewsButton, 'mousedown', event => event.preventDefault());
	}

	if (emoticonButton) {
		const togglePicker = (event: MouseEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			const existing = doc.getElementById('gdl-emoticon-picker');
			if (existing) {
				existing.remove();
				return;
			}
			const picker = doc.createElement('div');
			picker.id = 'gdl-emoticon-picker';
			picker.innerHTML = `
				<div class="gdl-ep-heading">${escapeHtml(gdlText('recent_emoticons', 'RECENT EMOTICONS'))}</div>
				<div class="gdl-ep-grid gdl-ep-recents">
					<div class="gdl-ep-item" data-emo="🐸">🐸</div>
					<div class="gdl-ep-item" data-emo="😎">😎</div>
					<div class="gdl-ep-item" data-emo="👍">👍</div>
					<div class="gdl-ep-item" data-emo="🎮">🎮</div>
					<div class="gdl-ep-item" data-emo="🔥">🔥</div>
				</div>
				<div class="gdl-ep-heading" style="margin-top:8px;">${escapeHtml(gdlText('all_emoticons', 'ALL EMOTICONS'))}</div>
				<div class="gdl-ep-grid gdl-ep-all" style="max-height:120px;overflow-y:auto;">
					${STEAM_EMOTICONS.map(emoticon => `<div class="gdl-ep-item" data-emo="${emoticon.char}" title="${emoticon.name}">${emoticon.char}</div>`).join('')}
				</div>
				<input class="gdl-ep-search" type="text" placeholder="${escapeHtml(gdlText('search', 'Search'))}..." />`;
			const boxContainer = (wrapper.querySelector('.gdl-status-box-container') as HTMLElement) || wrapper;
			boxContainer.style.position = 'relative';
			boxContainer.style.zIndex = '500';
			boxContainer.appendChild(picker);

			// Anchor the popup to the actual emoticon button instead of the top of
			// the whole composer. Steam opens this surface directly above the
			// button, so it should stay floating above it.
			const containerRect = boxContainer.getBoundingClientRect();
			const buttonRect = emoticonButton.getBoundingClientRect();
			const pickerHeight = picker.offsetHeight;
			const buttonTop = buttonRect.top - containerRect.top;
			const buttonRightInset = Math.max(0, containerRect.right - buttonRect.right);
			const preferredTop = buttonTop - pickerHeight - 10;
			picker.style.top = `${preferredTop}px`;
			picker.style.right = `${buttonRightInset}px`;
			picker.style.bottom = 'auto';

			const searchInput = picker.querySelector('.gdl-ep-search') as HTMLInputElement | null;
			if (searchInput) {
				searchInput.addEventListener('input', () => {
					const query = searchInput.value.trim().toLowerCase();
					picker.querySelectorAll('.gdl-ep-all .gdl-ep-item').forEach(element => {
						const title = element.getAttribute('title') || '';
						(element as HTMLElement).style.display = !query || title.includes(query) ? 'flex' : 'none';
					});
				});
				searchInput.addEventListener('click', event => event.stopPropagation());
				searchInput.addEventListener('mousedown', event => event.stopPropagation());
			}

			picker.querySelectorAll('.gdl-ep-item').forEach(button => {
				button.addEventListener('mousedown', event => {
					event.preventDefault();
					event.stopPropagation();
				});
				button.addEventListener('click', event => {
					event.preventDefault();
					event.stopPropagation();
					const emoticon = button.getAttribute('data-emo') || '';
					const start = statusArea.selectionStart || statusArea.value.length;
					const end = statusArea.selectionEnd || statusArea.value.length;
					const value = statusArea.value;
					statusArea.value = value.substring(0, start) + emoticon + value.substring(end);
					statusArea.selectionStart = statusArea.selectionEnd = start + emoticon.length;
					statusArea.focus();
					syncPostButtonState();
					autoResizeTextarea();
					picker.remove();
				});
			});
		};
		lifecycle.listen(emoticonButton, 'mousedown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		lifecycle.listen(emoticonButton, 'click', togglePicker as EventListener);
		lifecycle.listen(doc, 'mousedown', event => {
			const picker = doc.getElementById('gdl-emoticon-picker');
			if (picker && !picker.contains(event.target as Node) && event.target !== emoticonButton && !emoticonButton.contains(event.target as Node)) picker.remove();
		});
	}

	setupPostDeleteHandlers(doc, steamAppId, shortcutAppId, newsItems, fallbackImage);
}
