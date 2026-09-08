import type { CommunityContentItem, SteamGameData } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import { extractCommunityYoutubeId } from '../../steam/navigation';
import type { NativeLibraryLayout } from './layout';

const progressiveRevealCleanup = new WeakMap<HTMLElement, () => void>();
const deferredHydrationCleanup = new WeakMap<HTMLElement, () => void>();
const adaptiveWidthCleanup = new WeakMap<HTMLElement, () => void>();

function createCommunityHeader(doc: Document): HTMLElement {
	const header = doc.createElement('div');
	header.className = 'gdl-community-native-header';
	const tooltipFirst = loc('AppDetails_Community_Tooltip1', 'This section contains screenshots, artwork, videos, guides, and more, submitted by the community.');
	const tooltipSecond = loc('AppDetails_Community_Tooltip2', 'You can like, share, comment on, or report this content.');
	header.innerHTML = `<span>${escapeHtml(gdlText('community_content', loc('AppDetails_SectionTitle_Community', 'Community Content')).toUpperCase())}</span><span class="gdl-community-help" aria-label="${escapeHtml(tooltipFirst)}">?<span class="gdl-community-help-tooltip">${escapeHtml(tooltipFirst)}<br><br>${escapeHtml(tooltipSecond)}</span></span>`;
	return header;
}

export function disposeCommunityProgressiveReveal(root: HTMLElement): void {
	progressiveRevealCleanup.get(root)?.();
	deferredHydrationCleanup.get(root)?.();
}

/** Dispose every observer owned by a Community section before removing it. */
export function disposeCommunitySection(root: HTMLElement): void {
	disposeCommunityProgressiveReveal(root);
	adaptiveWidthCleanup.get(root)?.();
}

/**
 * Let Community use the area below a shorter right sidebar without ever
 * crossing it. Steam's sidebar is a float, so this must follow live geometry:
 * news hydration and optional sidebar sections can change both heights later.
 */
function setupCommunityAdaptiveWidth(
	doc: Document,
	root: HTMLElement,
	activity: HTMLElement,
	layout: NativeLibraryLayout,
): void {
	adaptiveWidthCleanup.get(root)?.();
	const sidebar = layout.sidebarColumn;
	const content = layout.contentColumn;
	if (!sidebar || !content) return;
	const win = doc.defaultView;
	let frame = 0;
	let disposed = false;
	const update = (): void => {
		frame = 0;
		if (disposed || !root.isConnected || !activity.isConnected || !sidebar.isConnected || !content.isConnected) return;
		const sidebarStyle = win?.getComputedStyle(sidebar);
		const sidebarRect = sidebar.getBoundingClientRect();
		const activityRect = activity.getBoundingClientRect();
		const contentRect = content.getBoundingClientRect();
		const sidebarVisible = sidebarStyle?.display !== 'none' && sidebarStyle?.visibility !== 'hidden'
			&& sidebarRect.width > 1 && sidebarRect.height > 1;
		const canUseFreedSidebarArea = !sidebarVisible || activityRect.bottom + 34 >= sidebarRect.bottom - 1;
		root.classList.toggle('gdl-community-wide', canUseFreedSidebarArea);
		if (canUseFreedSidebarArea) root.style.setProperty('--gdl-community-wide-width', `${Math.max(0, contentRect.width)}px`);
		else root.style.removeProperty('--gdl-community-wide-width');
	};
	const queueUpdate = (): void => {
		if (disposed || frame) return;
		frame = win?.requestAnimationFrame(update) || 0;
		if (!frame) update();
	};
	const ResizeObserverCtor = win?.ResizeObserver;
	const observer = typeof ResizeObserverCtor === 'function' ? new ResizeObserverCtor(queueUpdate) : null;
	observer?.observe(activity);
	observer?.observe(sidebar);
	observer?.observe(content);
	win?.addEventListener('resize', queueUpdate, { passive: true });
	const cleanup = (): void => {
		if (disposed) return;
		disposed = true;
		if (frame) win?.cancelAnimationFrame(frame);
		observer?.disconnect();
		win?.removeEventListener('resize', queueUpdate);
		adaptiveWidthCleanup.delete(root);
	};
	adaptiveWidthCleanup.set(root, cleanup);
	queueUpdate();
}

/** Progressive reveal that owns and disposes every listener/observer it installs. */
export function setupCommunityProgressiveReveal(doc: Document, root: HTMLElement): () => void {
	disposeCommunityProgressiveReveal(root);
	const sentinel = root.querySelector('.gdl-community-sentinel') as HTMLElement | null;
	if (!sentinel) return () => {};

	const hiddenCards = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.gdl-community-card[hidden]'));
	if (hiddenCards().length === 0) {
		sentinel.style.display = 'none';
		return () => {};
	}

	let disposed = false;
	const revealNext = (): void => {
		for (const card of hiddenCards().slice(0, 8)) card.removeAttribute('hidden');
		if (hiddenCards().length === 0) sentinel.style.display = 'none';
	};
	const checkScrollPosition = (): void => {
		if (!root.isConnected) {
			cleanup();
			return;
		}
		const bounds = sentinel.getBoundingClientRect();
		if (bounds.top <= (doc.defaultView?.innerHeight || 0) + 480) revealNext();
	};

	const scrollTargets: EventTarget[] = [doc.defaultView || doc];
	let parent: HTMLElement | null = root.parentElement;
	while (parent) {
		const style = doc.defaultView?.getComputedStyle(parent);
		if (style && (style.overflowY === 'auto' || style.overflowY === 'scroll' || parent.scrollHeight > parent.clientHeight + 4)) {
			scrollTargets.push(parent);
		}
		parent = parent.parentElement;
	}
	for (const target of scrollTargets) target.addEventListener('scroll', checkScrollPosition, { passive: true });

	const IntersectionObserverCtor = (doc.defaultView as any)?.IntersectionObserver as typeof IntersectionObserver | undefined;
	const intersectionObserver = typeof IntersectionObserverCtor === 'function'
		? new IntersectionObserverCtor((entries: IntersectionObserverEntry[]) => {
			if (!root.isConnected) {
				cleanup();
				return;
			}
			if (!entries.some(entry => entry.isIntersecting)) return;
			revealNext();
			if (hiddenCards().length === 0) intersectionObserver?.disconnect();
		}, { root: null, rootMargin: '480px 0px' })
		: null;
	if (intersectionObserver) intersectionObserver.observe(sentinel);
	else while (hiddenCards().length > 0) revealNext();

	function cleanup(): void {
		if (disposed) return;
		disposed = true;
		intersectionObserver?.disconnect();
		for (const target of scrollTargets) target.removeEventListener('scroll', checkScrollPosition);
		progressiveRevealCleanup.delete(root);
	}

	progressiveRevealCleanup.set(root, cleanup);
	checkScrollPosition();
	return cleanup;
}

/** Eagerly start community content in background and seamlessly hydrate
 * the community section with rich cards. */
export function scheduleCommunityHydration(
	doc: Document,
	data: SteamGameData,
	load: () => Promise<CommunityContentItem[]>,
	isCurrent: () => boolean,
	onHydrated?: (items: CommunityContentItem[]) => void,
): () => void {
	const root = doc.getElementById('gdl-community-content') as HTMLElement | null;
	if (!root) return () => {};
	deferredHydrationCleanup.get(root)?.();
	let disposed = false;
	let started = false;
	let observer: IntersectionObserver | null = null;
	const cleanup = (): void => {
		if (disposed) return;
		disposed = true;
		observer?.disconnect();
		deferredHydrationCleanup.delete(root);
	};

	// Eagerly dispatch the request immediately in background without blocking Frame 0
	const pendingLoad = load();

	const start = (): void => {
		if (started || disposed) return;
		started = true;
		observer?.disconnect();
		void pendingLoad.then(items => {
			if (disposed || !root.isConnected || !isCurrent()) return;
			onHydrated?.(items);
			const inner = root.querySelector<HTMLElement>('#gdl-community-inner');
			if (!inner) return;
			if (items.length > 0) {
				const signature = communityItemsSignature(items);
				if (root.dataset.gdlCommunitySignature !== signature) {
					inner.innerHTML = renderCommunityContentHtml(data, items);
					root.dataset.gdlCommunitySignature = signature;
				}
				root.style.display = '';
				setupCommunityProgressiveReveal(doc, root);
			} else if (!inner.querySelector('.gdl-community-card')) {
				root.style.display = 'none';
			}
		}).finally(cleanup);
	};

	// If inner is empty or has only placeholder screenshots, trigger start as soon as pendingLoad settles
	void pendingLoad.then(items => {
		if (!disposed && root.isConnected && isCurrent() && items.length > 0) {
			const inner = root.querySelector<HTMLElement>('#gdl-community-inner');
			if (!inner || !inner.querySelector('.gdl-community-card') || root.dataset.gdlCommunitySignature !== communityItemsSignature(items)) {
				start();
			}
		}
	});

	const Observer = (doc.defaultView as any)?.IntersectionObserver as typeof IntersectionObserver | undefined;
	if (typeof Observer === 'function') {
		observer = new Observer(entries => {
			if (entries.some(entry => entry.isIntersecting)) start();
		}, { root: null, rootMargin: '600px 0px' });
		observer.observe(root);
	} else {
		start();
	}
	deferredHydrationCleanup.set(root, cleanup);
	return cleanup;
}

export function communityItemsSignature(items: CommunityContentItem[]): string {
	return `${items.length}:` + items.map(item => `${item.type}|${item.image}|${item.link || ''}`).join('|');
}

function hasForeignScript(text: string): boolean {
	if (!text) return false;
	return /[\u0400-\u04FF\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function isSpanishText(text: string): boolean {
	if (!text) return false;
	const lower = text.toLowerCase();
	if (/[áéíóúñ¿¡]/.test(lower)) return true;
	return /\b(guia|guía|logro|logros|español|castellano|juego|juegos|historia|final|todos|como|cómo|trucos|consejos|secreto|secretos|jefe|jefes|completo|completa|mapa|armas|herramientas|requisitos|diario|alma|acero)\b/i.test(lower);
}

export function renderCommunityContentHtml(data: SteamGameData, communityItems: CommunityContentItem[] | undefined): string {
	const items = communityItems && communityItems.length > 0 ? communityItems : [];
	const fallbackScreenshots = items.length === 0 && !!data.screenshots?.length;
	const displayItems: CommunityContentItem[] = fallbackScreenshots
		? data.screenshots!.slice(0, 30).map(screenshot => ({ type: 'screenshot', image: screenshot.path_thumbnail, link: screenshot.path_full }))
		: items;
	if (displayItems.length === 0) return '';

	const safeLang = (steamLanguageSync() || 'english').toLowerCase();
	const isLatinClient = safeLang !== 'russian' && safeLang !== 'schinese' && safeLang !== 'tchinese' && safeLang !== 'japanese' && safeLang !== 'koreana';
	const isSpanishClient = safeLang === 'spanish' || safeLang === 'latam';

	const filteredItems = displayItems.filter(item => {
		if (isLatinClient && (hasForeignScript(item.title || '') || hasForeignScript(item.description || ''))) {
			return false;
		}
		return true;
	});

	const sortByLanguage = (list: CommunityContentItem[]) => {
		if (!isSpanishClient) return list;
		return [...list].sort((a, b) => {
			const aSpanish = (isSpanishText(a.title || '') || isSpanishText(a.description || '')) ? 1 : 0;
			const bSpanish = (isSpanishText(b.title || '') || isSpanishText(b.description || '')) ? 1 : 0;
			return bSpanish - aSpanish;
		});
	};

	const videos = sortByLanguage(filteredItems.filter(item => item.type === 'video'));
	const guides = sortByLanguage(filteredItems.filter(item => item.type === 'guide'));
	const artworks = sortByLanguage(filteredItems.filter(item => item.type === 'artwork'));
	const screenshots = sortByLanguage(filteredItems.filter(item => item.type === 'screenshot' || (item.type !== 'video' && item.type !== 'guide' && item.type !== 'artwork')));

	const ordered: CommunityContentItem[] = [];
	const vList = [...videos];
	const gList = [...guides];
	const aList = [...artworks];
	const sList = [...screenshots];

	while (vList.length > 0 || gList.length > 0 || aList.length > 0 || sList.length > 0) {
		if (vList.length > 0) ordered.push(vList.shift()!);
		if (aList.length > 0) ordered.push(aList.shift()!);
		else if (sList.length > 0) ordered.push(sList.shift()!);
		if (sList.length > 0) ordered.push(sList.shift()!);
		else if (aList.length > 0) ordered.push(aList.shift()!);
		if (gList.length > 0) ordered.push(gList.shift()!);
		if (gList.length > 0) ordered.push(gList.shift()!);
		if (aList.length > 0) ordered.push(aList.shift()!);
		if (sList.length > 0) ordered.push(sList.shift()!);
	}

	const authorBar = (item: CommunityContentItem): string => {
		if (!item.author_name && !item.author_avatar) return '';
		return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(0,0,0,.25);margin-top:auto;min-height:32px;">
			${item.author_avatar ? `<img src="${escapeHtml(item.author_avatar)}" style="width:32px;height:32px;flex-shrink:0;object-fit:cover;" data-gdl-hide-on-error="1" />` : ''}
			<span class="gdl-community-author" style="font-size:13px;color:#8f98a0;">${escapeHtml(item.author_name || '')}</span>
		</div>`;
	};

	const card = (item: CommunityContentItem, index: number): string => {
		const click = item.link ? ` data-gdl-open-url="${escapeHtml(item.link)}"` : '';
		if (item.type === 'guide') {
			return `<div class="gdl-community-card gdl-community-card-guide" data-gdl-community-card="${index}"${click}>
				<div style="padding:8px 12px;background:rgba(0,0,0,.25);font-size:11px;letter-spacing:.5px;font-weight:500;color:#9da4ab;text-transform:uppercase;">${escapeHtml(gdlText('community_guide', 'Community guide').toUpperCase())}</div>
				<div style="display:flex;gap:12px;padding:12px;align-items:flex-start;">
					<img src="${escapeHtml(item.image || '')}" loading="lazy" decoding="async" style="width:92px;height:92px;object-fit:cover;flex-shrink:0;" data-gdl-hide-on-error="1" />
					<div class="gdl-community-card-title" style="font-size:15px;font-weight:500;color:#dcdedf;line-height:1.35;min-width:0;">${escapeHtml(item.title || '')}</div>
				</div>
				${item.description ? `<div class="gdl-community-card-description" style="font-size:13px;color:#9da4ab;line-height:1.5;padding:0 12px 12px;">${escapeHtml(item.description)}</div>` : ''}
				${authorBar(item)}
			</div>`;
		}
		const ytId = item.type === 'video' ? extractCommunityYoutubeId(item) : null;
		if (item.type === 'video' || ytId) {
			const resolvedYtId = ytId || extractCommunityYoutubeId(item);
			const ytAttr = resolvedYtId ? ` data-gdl-youtube-id="${escapeHtml(resolvedYtId)}"` : '';
			const click = resolvedYtId ? '' : (item.link ? ` data-gdl-open-url="${escapeHtml(item.link)}"` : '');
			return `<div class="gdl-community-card gdl-community-card-video" data-gdl-community-card="${index}"${ytAttr}${click}>
				<div class="gdl-community-video-thumb" style="position:relative;width:100%;max-width:100%;aspect-ratio:16/9;overflow:hidden;background:#000;">
					<img src="${escapeHtml(item.image || '')}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;" data-gdl-hide-on-error="1" />
					<div class="gdl-community-play-button">
						<svg viewBox="0 0 24 24" style="width:26px;height:26px;fill:#fff;margin-left:3px;"><path d="M8 5v14l11-7z"/></svg>
					</div>
				</div>
				${item.title ? `<div class="gdl-community-card-title" style="padding:8px 12px 4px;font-size:13px;color:#dcdedf;line-height:1.35;">${escapeHtml(item.title)}</div>` : ''}
				${authorBar(item)}
			</div>`;
		}
		return `<div class="gdl-community-card" data-gdl-community-card="${index}"${click}>
			<img src="${escapeHtml(item.image || '')}" loading="lazy" decoding="async" style="width:100%;max-width:100%;aspect-ratio:16/9;object-fit:cover;display:block;" data-gdl-hide-on-error="1" />
			${item.title ? `<div class="gdl-community-card-title" style="padding:8px 12px 4px;font-size:13px;color:#dcdedf;line-height:1.35;">${escapeHtml(item.title)}</div>` : ''}
			${authorBar(item)}
		</div>`;
	};

	return `<div class="gdl-community-grid">${ordered.map(card).join('')}<div class="gdl-community-sentinel" aria-hidden="true"></div></div>`;
}

export function insertCommunitySection(
	doc: Document,
	_layout: NativeLibraryLayout,
	activityWrapper: HTMLElement,
	communityHtml: string,
): HTMLElement | null {
	if (!activityWrapper.parentElement) return null;
	const node = doc.createElement('section');
	node.id = 'gdl-community-content';
	node.className = 'gdl-community-section';
	node.style.cssText = 'display:block;min-width:0;box-sizing:border-box;color:#acb2b8;font-family:inherit;padding:0 12px 24px;overflow:visible;';
	node.appendChild(createCommunityHeader(doc));
	const inner = doc.createElement('div');
	inner.id = 'gdl-community-inner';
	inner.innerHTML = communityHtml || '';
	node.appendChild(inner);
	activityWrapper.parentElement.insertBefore(node, activityWrapper.nextSibling);
	setupCommunityAdaptiveWidth(doc, node, activityWrapper, _layout);

	if (communityHtml) {
		setupCommunityProgressiveReveal(doc, node);
	}
	return node;
}
