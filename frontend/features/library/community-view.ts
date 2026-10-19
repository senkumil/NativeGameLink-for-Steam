import type { CommunityContentItem, SteamGameData } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { backendLog } from '../../api/backend';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import { extractCommunityYoutubeId } from '../../steam/navigation';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import type { NativeLibraryLayout } from './layout';
import { orderCommunityItems } from './community-order';

const progressiveRevealCleanup = new WeakMap<HTMLElement, () => void>();
const deferredHydrationCleanup = new WeakMap<HTMLElement, () => void>();
const adaptiveWidthCleanup = new WeakMap<HTMLElement, () => void>();
const columnLayoutCleanup = new WeakMap<HTMLElement, () => void>();
const communityLayoutRequests = new WeakMap<HTMLElement, () => void>();
const communityRowBatches = new WeakMap<HTMLElement, number[]>();

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
	columnLayoutCleanup.get(root)?.();
}

/** Follow Steam's dense grid of aligned rows without moving mounted cards.
 * Images can change their native span after loading; players stay mounted. */
function setupCommunityColumns(doc: Document, root: HTMLElement): void {
	columnLayoutCleanup.get(root)?.();
	const grid = root.querySelector<HTMLElement>('.gdl-community-grid');
	if (!grid) return;
	const view = doc.defaultView;
	let disposed = false;
	let frame = 0;
	const ancestors: HTMLElement[] = [];
	for (let parent = root.parentElement; parent && parent !== doc.body; parent = parent.parentElement) ancestors.push(parent);
	const pixels = (value: number): string => `${Math.round(value * 1000) / 1000}px`;
	const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-gdl-community-card]'))
		.sort((a, b) => Number(a.dataset.gdlCommunityCard) - Number(b.dataset.gdlCommunityCard));
	const mediaBindings = new Map(cards.map(card => {
		const media = card.querySelector<HTMLElement>('.gdl-community-media,.gdl-community-video-thumb');
		return [card, { media, firstChild: media?.firstElementChild,
			image: media?.querySelector<HTMLImageElement>('.gdl-community-preview'),
			video: card.classList.contains('gdl-community-card-video') }];
	}));
	const imageFor = (card: HTMLElement): HTMLImageElement | null | undefined => {
		const binding = mediaBindings.get(card)!;
		if (binding.firstChild !== binding.media?.firstElementChild) {
			binding.firstChild = binding.media?.firstElementChild;
			binding.image = binding.media?.querySelector<HTMLImageElement>('.gdl-community-preview');
		}
		return binding.image;
	};
	const batchEnds = communityRowBatches.get(grid) || [];
	communityRowBatches.set(grid, batchEnds);
	let placementKey = '';
	let styleWrites: Array<[HTMLElement, string, string]> = [];
	let mediaStates: Array<[HTMLElement, string]> = [];
	const setStyle = (element: HTMLElement, key: string, value: string): void => {
		styleWrites.push([element, key, value]);
	};
	const syncBottomClearance = (): void => {
		// Steam's 100%-height scroll viewport can extend below its clipped pane.
		// Reserve only that measured overlap so the last author footer can scroll
		// fully into view, retaining the usual bottom gap on an unclipped page.
		let scrollBottom = 0;
		let scrollTop = 0;
		let scrollScale = 1;
		let visibleBottom = view?.innerHeight || Infinity;
		for (const ancestor of ancestors) {
			const overflow = view?.getComputedStyle(ancestor).overflowY || '';
			if (!/^(auto|scroll|overlay|hidden|clip)$/.test(overflow)) continue;
			const rect = ancestor.getBoundingClientRect();
			const scale = ancestor.offsetHeight > 0 ? rect.height / ancestor.offsetHeight : 1;
			const bottom = rect.top + (ancestor.clientTop + ancestor.clientHeight) * scale;
			if (!scrollBottom && /^(auto|scroll|overlay)$/.test(overflow)
				&& ancestor.scrollHeight > ancestor.clientHeight + 1) {
				scrollBottom = bottom;
				scrollTop = rect.top;
				scrollScale = scale || 1;
			} else if (scrollBottom) {
				visibleBottom = Math.min(visibleBottom, bottom);
			}
		}
		const rootWidth = Number.parseFloat(view?.getComputedStyle(root).width || '') || root.offsetWidth;
		const rootScale = rootWidth > 0 ? root.getBoundingClientRect().width / rootWidth : scrollScale;
		const clearance = scrollBottom && scrollTop < visibleBottom
			? Math.max(0, (scrollBottom - visibleBottom) / (rootScale || 1)) : 0;
		setStyle(root, '--gdl-community-bottom-clearance', pixels(clearance));
	};
	const syncMedia = (card: HTMLElement, width: number): void => {
		const binding = mediaBindings.get(card)!;
		const media = binding.media, image = imageFor(card);
		if (!image || !media) return;
		const loaded = image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
		const failed = image.complete && image.naturalWidth === 0 && Boolean(image.currentSrc || image.getAttribute('src'));
		const state = loaded ? 'loaded' : failed ? 'error' : 'pending';
		mediaStates.push([media, state]);
		// An intrinsic ratio stays identical while CSS resizes the card. Only
		// Steam's 800px media-height cap requires a width-dependent ratio.
		const ratio = loaded && !binding.video
			? width * image.naturalHeight / image.naturalWidth > 800
				? `${width} / 800` : `${image.naturalWidth} / ${image.naturalHeight}`
			: '16 / 9';
		setStyle(media, '--gdl-community-media-ratio', ratio);
	};
	const layout = (): void => {
		if (disposed || !root.isConnected || !grid.isConnected) return;
		styleWrites = []; mediaStates = [];
		// Computed dimensions are CSS pixels even when Steam uses a zoom factor.
		const width = Number.parseFloat(view?.getComputedStyle(grid).width || '') || grid.clientWidth;
		if (!(width > 0)) return;
		const count = Math.max(1, Math.min(10, Math.floor((grid.clientWidth + 24) / 280)));
		const cardWidth = (width - (count - 1) * 24) / count;
		setStyle(grid, '--gdl-community-columns', String(count));
		const visible = cards.filter(card => !card.hidden);
		if (visible.length < (batchEnds[batchEnds.length - 1] || 0)) batchEnds.length = 0;
		if (visible.length > (batchEnds[batchEnds.length - 1] || 0)) batchEnds.push(visible.length);
		const spans = visible.map(card => {
			const video = mediaBindings.get(card)!.video;
			const image = video ? null : imageFor(card);
			const aspect = image?.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 0;
			const columns = video ? Math.min(2, count) : aspect > 2.5 ? Math.min(3, count) : 1;
			const rows = aspect > 0 && aspect <= 0.8 ? 2 : 1;
			syncMedia(card, cardWidth * columns + 24 * (columns - 1));
			return { columns, rows };
		});
		const nextPlacementKey = `${count}|${batchEnds.join(',')}|${visible.map((card, index) =>
			`${card.dataset.gdlCommunityCard}:${spans[index].columns}:${spans[index].rows}`).join(';')}`;
		if (placementKey !== nextPlacementKey) {
			placementKey = nextPlacementKey;
			for (let index = 0; index < visible.length; index++) {
				setStyle(visible[index], '--gdl-community-card-columns', String(spans[index].columns));
				setStyle(visible[index], '--gdl-community-card-rows', String(spans[index].rows));
				for (const property of ['width', 'height', 'left', 'top']) setStyle(visible[index], property, '');
			}
			let rowOffset = 0;
			let batchStart = 0;
			for (const batchEnd of batchEnds) {
				// Fill whole grid cells densely within the published batch. Newly
				// revealed cards start in new rows, as in Steam, so they cannot grow
				// a previously visible row and displace an active video.
				const occupied: boolean[][] = [];
				for (let index = batchStart; index < batchEnd; index++) {
					const span = spans[index];
					let row = 0;
					let column = 0;
					findSlot: for (;; row++) {
						for (column = 0; column <= count - span.columns; column++) {
							let available = true;
							for (let y = row; y < row + span.rows; y++) {
								for (let x = column; x < column + span.columns; x++) {
									if (occupied[y]?.[x]) available = false;
								}
							}
							if (available) break findSlot;
						}
					}
					setStyle(visible[index], 'grid-column-start', String(column + 1));
					setStyle(visible[index], 'grid-row-start', String(rowOffset + row + 1));
					for (let y = row; y < row + span.rows; y++) {
						occupied[y] ||= [];
						for (let x = column; x < column + span.columns; x++) occupied[y][x] = true;
					}
				}
				rowOffset += occupied.length;
				batchStart = batchEnd;
			}
		}
		setStyle(grid, 'height', '');
		syncBottomClearance();
		// Complete every geometry read before invalidating layout. Card and
		// ancestor observers can then settle without another forced reflow here.
		for (const [element, property, value] of styleWrites) {
			if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
		}
		for (const [media, state] of mediaStates) {
			if (media.dataset.gdlMediaState !== state) media.dataset.gdlMediaState = state;
		}
	};
	const queue = (): void => {
		if (disposed || frame) return;
		frame = view?.requestAnimationFrame(() => {
			frame = 0;
			void runWhenLibrarySidebarIdle(doc, 'secondary-community-columns', layout)
				.catch(error => backendLog('Community column layout error: ' + String(error)));
		}) || 0;
		if (!frame) layout();
	};
	const Observer = view?.ResizeObserver;
	const observer = typeof Observer === 'function' ? new Observer(queue) : null;
	observer?.observe(grid);
	for (const ancestor of ancestors) observer?.observe(ancestor);
	grid.addEventListener('load', queue, true);
	grid.addEventListener('error', queue, true);
	view?.addEventListener('resize', queue, { passive: true });
	communityLayoutRequests.set(root, layout);
	columnLayoutCleanup.set(root, () => {
		disposed = true;
		if (frame) view?.cancelAnimationFrame(frame);
		observer?.disconnect();
		grid.removeEventListener('load', queue, true);
		grid.removeEventListener('error', queue, true);
		view?.removeEventListener('resize', queue);
		columnLayoutCleanup.delete(root);
		communityLayoutRequests.delete(root);
		root.style.removeProperty('--gdl-community-bottom-clearance');
	});
	layout();
}

/**
 * Keep Community below both columns at the full detail-pane width. The right
 * float can grow after controller connection or sidebar hydration; narrowing
 * the whole feed then leaves even its lower rows trapped in the activity width.
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
		const contentStyle = win?.getComputedStyle(content);
		let contentWidth = Number.parseFloat(contentStyle?.width || '') || content.clientWidth;
		if (contentStyle?.boxSizing !== 'border-box') {
			for (const value of [contentStyle?.paddingLeft, contentStyle?.paddingRight,
				contentStyle?.borderLeftWidth, contentStyle?.borderRightWidth]) contentWidth += Number.parseFloat(value || '') || 0;
		}
		// Steam can zoom the whole desktop surface. DOM rectangles include that
		// zoom; an inline CSS width and the native 34px section gap do not.
		const scale = contentWidth > 0 ? contentRect.width / contentWidth : 1;
		const sidebarVisible = sidebarStyle?.display !== 'none' && sidebarStyle?.visibility !== 'hidden'
			&& sidebarRect.width > 1 && sidebarRect.height > 1;
		const topGap = sidebarVisible && scale > 0
			? Math.max(34, (sidebarRect.bottom - activityRect.bottom) / scale)
			: 34;
		const gap = `${Math.round(topGap * 1000) / 1000}px`;
		const width = `${Math.max(0, contentWidth)}px`;
		if (!root.classList.contains('gdl-community-wide')) root.classList.add('gdl-community-wide');
		if (root.style.getPropertyValue('--gdl-community-top-gap') !== gap) {
			root.style.setProperty('--gdl-community-top-gap', gap);
		}
		if (root.style.getPropertyValue('--gdl-community-wide-width') !== width) {
			root.style.setProperty('--gdl-community-wide-width', width);
		}
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
	// The column layout below runs immediately. Publish its full width and
	// clearance before that first pass so no narrow initial frame is painted.
	update();
}

/** Progressive reveal that owns and disposes every listener/observer it installs. */
export function setupCommunityProgressiveReveal(doc: Document, root: HTMLElement): () => void {
	disposeCommunityProgressiveReveal(root);
	setupCommunityColumns(doc, root);
	const sentinel = root.querySelector('.gdl-community-sentinel') as HTMLElement | null;
	if (!sentinel) return () => {};

	const hiddenCards = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.gdl-community-card[hidden]'))
		.sort((a, b) => Number(a.dataset.gdlCommunityCard) - Number(b.dataset.gdlCommunityCard));
	if (hiddenCards().length === 0) {
		sentinel.style.display = 'none';
		return () => {};
	}

	let disposed = false;
	const revealNext = (): void => {
		for (const card of hiddenCards().slice(0, 8)) card.removeAttribute('hidden');
		communityLayoutRequests.get(root)?.();
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
		void pendingLoad.then(items => runWhenLibrarySidebarIdle(doc, 'secondary-community', () => {
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
		})).catch(error => backendLog('Community render error: ' + String(error))).finally(cleanup);
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
	let hash = 2166136261;
	for (const item of items) {
		const value = JSON.stringify([item.type, item.image, item.link, item.youtube_id,
			item.title, item.description, item.author_name, item.author_avatar]);
		for (let index = 0; index < value.length; index++) {
			hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
		}
	}
	return `${items.length}:${(hash >>> 0).toString(16)}`;
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

	const ordered = orderCommunityItems(sortByLanguage(filteredItems));

	const authorBar = (item: CommunityContentItem): string => {
		if (!item.author_name && !item.author_avatar) return '';
		return `<div class="gdl-community-author-bar">
			${item.author_avatar ? `<img class="gdl-community-avatar" src="${escapeHtml(item.author_avatar)}" alt="" loading="lazy" decoding="async" data-gdl-hide-on-error="1" />` : ''}
			<span class="gdl-community-author">${escapeHtml(item.author_name || '')}</span>
		</div>`;
	};
	const caption = (item: CommunityContentItem): string => item.title
		? `<div class="gdl-community-caption"><div class="gdl-community-card-title">${escapeHtml(item.title)}</div></div>` : '';

	const card = (item: CommunityContentItem, index: number): string => {
		const click = item.link ? ` data-gdl-open-url="${escapeHtml(item.link)}"` : '';
		if (item.type === 'guide') {
			return `<div class="gdl-community-card gdl-community-card-guide" data-gdl-community-card="${index}"${click}>
				<div class="gdl-community-guide-kind">${escapeHtml(gdlText('community_guide', 'Community guide').toUpperCase())}</div>
				<div class="gdl-community-guide-header">
					<img class="gdl-community-guide-preview" src="${escapeHtml(item.image || '')}" alt="" loading="lazy" decoding="async" data-gdl-hide-on-error="1" />
					<div class="gdl-community-card-title">${escapeHtml(item.title || '')}</div>
				</div>
				${item.description ? `<div class="gdl-community-description-body"><div class="gdl-community-card-description">${escapeHtml(item.description)}</div></div>` : ''}
				${authorBar(item)}
			</div>`;
		}
		const ytId = item.type === 'video' ? extractCommunityYoutubeId(item) : null;
		if (item.type === 'video' || ytId) {
			const resolvedYtId = ytId || extractCommunityYoutubeId(item);
			const ytAttr = resolvedYtId ? ` data-gdl-youtube-id="${escapeHtml(resolvedYtId)}"` : '';
			const click = resolvedYtId ? '' : (item.link ? ` data-gdl-open-url="${escapeHtml(item.link)}"` : '');
			return `<div class="gdl-community-card gdl-community-card-video" data-gdl-community-card="${index}"${ytAttr}${click}>
				<div class="gdl-community-video-thumb">
					<img class="gdl-community-preview" src="${escapeHtml(item.image || '')}" alt="" loading="lazy" decoding="async" />
					<div class="gdl-community-play-button">
						<svg viewBox="0 0 24 24" style="width:26px;height:26px;fill:#fff;margin-left:3px;"><path d="M8 5v14l11-7z"/></svg>
					</div>
					${caption(item)}
				</div>
				${authorBar(item)}
			</div>`;
		}
		return `<div class="gdl-community-card" data-gdl-community-card="${index}"${click}>
			<div class="gdl-community-media"><img class="gdl-community-preview" src="${escapeHtml(item.image || '')}" alt="" loading="lazy" decoding="async" />${caption(item)}</div>
			${authorBar(item)}
		</div>`;
	};

	return `<div class="gdl-community-grid">${ordered.map(card).join('')}</div><div class="gdl-community-sentinel" aria-hidden="true"></div>`;
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
	node.style.cssText = 'display:block;min-width:0;box-sizing:border-box;color:#acb2b8;font-family:inherit;padding:0 10px calc(24px + var(--gdl-community-bottom-clearance,0px));overflow:visible;';
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
