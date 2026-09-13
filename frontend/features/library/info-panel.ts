import type { NativeGameFeature, NativeGameInfo } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import {
	GAME_INFO_CLASS_MODULE,
	GAME_INFO_OUTER_CLASS_MODULE,
	PLAYBAR_CLASS_MODULE,
	PLAYBAR_CLASSES,
} from '../../steam/css';
import type { CssClasses } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import {
	addCssModuleClass,
	buildNativeInfoButtonBlueprint,
	closestWithCssModuleClass,
	elementsWithCssModuleClass,
	hasCssModuleClass,
	isRenderedElement,
	removeCssModuleClass,
} from '../../steam/native-dom';
import { isPublicSteamLibraryRoute } from './native-route';

const GDL_INFO_PANEL_EXPANDED_KEY = 'gdl_info_panel_expanded';

export function getPersistentInfoExpanded(): boolean {
	// Info panel must always start collapsed when selecting, switching or exiting games.
	return false;
}

export function setPersistentInfoExpanded(_expanded: boolean): void {
	try {
		localStorage.removeItem(GDL_INFO_PANEL_EXPANDED_KEY);
	} catch {}
}

const nativeInfoResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

function informationSvg(): string {
	// Exact geometry used by Steam's current SVGIcon_Information component.
	return `<svg class="SVGIcon_Button SVGIcon_Information" viewBox="0 0 256 256" aria-hidden="true"><polyline class="I" points="86.883,110.957 152.894,110.957 152.894,181.406 177.117,181.406 177.117,202.485 86.883,202.485 86.883,181.775 109.441,181.775 109.441,130.372 86.883,130.372 "></polyline><circle class="I" cx="128.47" cy="67.607" r="25.517"></circle><circle fill="none" stroke="#000000" stroke-width="14" stroke-miterlimit="10" cx="128" cy="128" r="116.833"></circle></svg>`;
}

function informationSvgForButton(button: HTMLElement): string {
	return button.dataset.gdlNativeInformationSvg || informationSvg();
}

function scrollToTopSvg(): string {
	return `<svg class="SVGIcon_Button gdl-scroll-top-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6.7 10.2 12 4.9l5.3 5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const infoScrollCleanups = new WeakMap<Document, () => void>();
const infoKnownScrollTargets = new WeakMap<Document, Set<HTMLElement>>();
const SCROLL_TOP_BUTTON_THRESHOLD = 360;

function infoButtonLabel(expanded: boolean): string {
	return expanded
		? loc('GameAction_ViewDetails_Collapse', gdlText('hide_game_details', 'Hide game details'))
		: loc('GameAction_ViewDetails', gdlText('show_game_details', 'Show game details'));
}

function scrollTopButtonLabel(): string {
	return loc('AppDetails_ScrollToTop', 'Back to top');
}

function setInfoButtonScrollMode(button: HTMLElement, active: boolean, nativeWrapperClass = ''): void {
	button.dataset.gdlScrollTopActive = active ? '1' : '0';
	const svg = button.querySelector('svg');
	const html = active ? scrollToTopSvg() : informationSvgForButton(button);
	if (svg) svg.outerHTML = html;
	else button.innerHTML = `<div class="${nativeWrapperClass}">${html}</div>`;
	const isExpanded = (button.ownerDocument?.getElementById('gdl-game-info-panel') as HTMLElement | null)?.dataset.expanded === '1';
	const label = active ? scrollTopButtonLabel() : infoButtonLabel(isExpanded);
	button.setAttribute('aria-label', label);
	button.title = label;
}

function mainScrollAnchors(doc: Document): HTMLElement[] {
	const anchors = [
		doc.getElementById('gdl-library-injected'),
		doc.getElementById('gdl-link-bar'),
		doc.getElementById('gdl-playbar-achievements'),
		doc.querySelector<HTMLElement>('[data-gdl-game-info-button="1"]'),
	].filter((element): element is HTMLElement => element instanceof HTMLElement && element.isConnected);
	return anchors;
}

/**
 * Steam can move the library details view between different internal scroll
 * containers when the splitter, route, or sticky playbar layout changes. Do not
 * cache one container: derive every relevant scrollable ancestor from live GDL
 * anchors so the Info/Back-to-top state always follows the actual details pane.
 */
function collectMainScrollTargets(doc: Document, knownTargets?: Iterable<HTMLElement>): HTMLElement[] {
	const view = doc.defaultView;
	const targets = new Set<HTMLElement>();
	const anchors = mainScrollAnchors(doc);
	const detailsLeft = rightDetailsLeftFromAnchors(doc, anchors);

	const consider = (current: HTMLElement): void => {
		if (!current.isConnected) return;
		const style = view?.getComputedStyle(current);
		const overflowY = style?.overflowY || '';
		const hasScrollableRange = current.scrollHeight > current.clientHeight + 8;
		const permitsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
		if (!hasScrollableRange || (!permitsScroll && current.scrollTop <= 0)) return;
		const rect = current.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const containsRightAnchor = anchors.some(anchor => current === anchor || current.contains(anchor));
		const belongsToRightPane = rect.right > detailsLeft + 80 && rect.width >= 360 && rect.height >= 180;
		if (containsRightAnchor || belongsToRightPane) targets.add(current);
	};

	for (const anchor of anchors) {
		let current: HTMLElement | null = anchor;
		while (current && current !== doc.body && current !== doc.documentElement) {
			consider(current);
			current = current.parentElement;
		}
	}

	if (knownTargets) {
		for (const target of knownTargets) consider(target);
	}

	const scrolling = doc.scrollingElement;
	if (scrolling instanceof HTMLElement && scrolling.scrollHeight > scrolling.clientHeight + 8) targets.add(scrolling);
	return Array.from(targets);
}

function nativeInPagePlaybar(doc: Document): HTMLElement | null {
	const playbar = PLAYBAR_CLASS_MODULE();
	if (!playbar.native || !playbar.classes.Container || !playbar.classes.InPage) return null;
	const candidates = elementsWithCssModuleClass(doc, playbar.classes.Container)
		.filter(element => element.isConnected && hasCssModuleClass(element, playbar.classes.InPage));
	if (candidates.length === 0) return null;
	// Prefer the original in-page playbar even after Steam creates a sticky copy.
	return candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
}
function isStickyPlaybarVisible(doc: Document): boolean {
	const topCapsule = doc.querySelector<HTMLElement>('[class*="TopCapsule"], [class*="topCapsule"], [class*="HeroContainer"], [class*="HeroAndLogo"]');
	if (topCapsule && isRenderedElement(doc, topCapsule) && topCapsule.getBoundingClientRect().bottom > 40) {
		return false;
	}

	const inPage = nativeInPagePlaybar(doc);
	if (inPage && isRenderedElement(doc, inPage)) {
		const rect = inPage.getBoundingClientRect();
		// If the original in-page playbar is still visibly sitting below the hero,
		// we are still at/near the top and must keep the info icon.
		if (rect.top >= 30 && rect.bottom > 80) return false;
	}

	const playbar = PLAYBAR_CLASS_MODULE();
	const classes = playbar.classes;
	if (!playbar.native || !classes.Container || !classes.InPage) return false;

	const viewportHeight = Math.max(0, doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0);
	for (const container of elementsWithCssModuleClass(doc, classes.Container)) {
		if (!container.isConnected || hasCssModuleClass(container, classes.InPage) || !isRenderedElement(doc, container)) continue;
		const rect = container.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= viewportHeight) continue;
		// Count as sticky only when the duplicate playbar is actually docked near
		// the top chrome and the original in-page bar has already moved away.
		if (rect.top <= 88 && rect.bottom >= 36) return true;
	}
	return false;
}


function isMainContentVisuallyScrolled(doc: Document): boolean {
	const topCapsule = doc.querySelector<HTMLElement>('[class*="TopCapsule"], [class*="topCapsule"], [class*="HeroContainer"], [class*="HeroAndLogo"]');
	if (topCapsule && isRenderedElement(doc, topCapsule) && topCapsule.getBoundingClientRect().bottom > 40) {
		return false;
	}
	const inPage = nativeInPagePlaybar(doc);
	if (inPage && isRenderedElement(doc, inPage)) {
		const rect = inPage.getBoundingClientRect();
		if (rect.bottom > 80 && rect.top > 0) return false;
		// Once the original playbar has moved above the top chrome, Steam swaps to
		// the sticky playbar. This is a more reliable signal than scrollTop on some
		// non-Steam detail layouts.
		if (rect.bottom < 28 || rect.top < -88) return true;
	}
	const linkBar = doc.getElementById('gdl-link-bar');
	if (linkBar?.isConnected && isRenderedElement(doc, linkBar)) {
		const rect = linkBar.getBoundingClientRect();
		if (rect.bottom < 30) return true;
	}
	return false;
}

function currentMainScrollTop(doc: Document, knownTargets?: Iterable<HTMLElement>): number {
	const learnedTargets = knownTargets || infoKnownScrollTargets.get(doc);
	const targets = collectMainScrollTargets(doc, learnedTargets);
	let top = 0;
	for (const target of targets) top = Math.max(top, Math.max(0, target.scrollTop || 0));
	if (top <= 0) top = Math.max(0, doc.defaultView?.scrollY || 0);
	return top;
}

/**
 * Keep the native Information button while the primary Steam links bar is still
 * visibly present underneath the sticky playbar. This matches the visual state
 * shown by Steam better than a raw scrollTop threshold and stays stable across
 * splitter widths / window sizes.
 */
function primaryLinksAreStillVisible(doc: Document): boolean {
	const linkBar = doc.getElementById('gdl-link-bar');
	if (!linkBar?.isConnected || !isRenderedElement(doc, linkBar)) return false;
	const rect = linkBar.getBoundingClientRect();
	const viewportHeight = Math.max(0, doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0);
	if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= viewportHeight) return false;
	// The sticky playbar occupies roughly the upper ~90px of the details pane.
	// As long as the links bar is still clearly visible below it, keep Information.
	return rect.bottom > 118;
}

function shouldShowScrollTopButton(doc: Document, knownTargets?: Iterable<HTMLElement>): boolean {
	const topCapsule = doc.querySelector<HTMLElement>('[class*="TopCapsule"], [class*="topCapsule"], [class*="HeroContainer"], [class*="HeroAndLogo"]');
	if (topCapsule && isRenderedElement(doc, topCapsule) && topCapsule.getBoundingClientRect().bottom > 40) {
		return false;
	}
	const inPage = nativeInPagePlaybar(doc);
	if (inPage && isRenderedElement(doc, inPage) && inPage.getBoundingClientRect().bottom > 80 && inPage.getBoundingClientRect().top > 0) {
		return false;
	}
	if (primaryLinksAreStillVisible(doc)) return false;
	const top = currentMainScrollTop(doc, knownTargets);
	return top > SCROLL_TOP_BUTTON_THRESHOLD || isStickyPlaybarVisible(doc) || isMainContentVisuallyScrolled(doc);
}

export function resetMainScrollToTop(doc: Document): void {
	try {
		for (const target of collectMainScrollTargets(doc)) target.scrollTop = 0;
		const scrolling = doc.scrollingElement;
		if (scrolling instanceof HTMLElement) scrolling.scrollTop = 0;
		doc.defaultView?.scrollTo(0, 0);
	} catch {}
}

function scrollMainContentToTop(doc: Document, knownTargets?: Iterable<HTMLElement>): void {
	const learnedTargets = knownTargets || infoKnownScrollTargets.get(doc);
	const view = doc.defaultView;
	if (!view) {
		for (const target of collectMainScrollTargets(doc, learnedTargets)) target.scrollTop = 0;
		return;
	}

	const duration = 460;
	const startedAt = view.performance.now();
	const starts = new Map<HTMLElement, { top: number; progress: number }>();
	let windowStart = Math.max(0, view.scrollY || 0);

	const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
	const frame = (now: number): void => {
		const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
		const liveTargets = collectMainScrollTargets(doc, learnedTargets);

		for (const target of liveTargets) {
			let start = starts.get(target);
			if (!start) {
				start = { top: Math.max(0, target.scrollTop || 0), progress };
				starts.set(target, start);
			}
			const span = Math.max(0.001, 1 - start.progress);
			const localProgress = Math.max(0, Math.min(1, (progress - start.progress) / span));
			const nextTop = Math.round(start.top * (1 - easeOutCubic(localProgress)));
			if (Math.abs((target.scrollTop || 0) - nextTop) > 0) target.scrollTop = nextTop;
		}

		if (windowStart > 0) {
			const nextWindowTop = Math.round(windowStart * (1 - easeOutCubic(progress)));
			view.scrollTo(0, nextWindowTop);
		}

		if (progress < 1) {
			view.requestAnimationFrame(frame);
			return;
		}

		// Steam may create the final non-sticky scroller on the last frame. Clear
		// every live right-pane target once, without another visual animation.
		for (const target of collectMainScrollTargets(doc, learnedTargets)) target.scrollTop = 0;
		const scrolling = doc.scrollingElement;
		if (scrolling instanceof HTMLElement) scrolling.scrollTop = 0;
		view.scrollTo(0, 0);
	};

	view.requestAnimationFrame(frame);
}


function rightDetailsLeftFromAnchors(doc: Document, anchors: HTMLElement[]): number {
	let left = Number.POSITIVE_INFINITY;
	for (const anchor of anchors) {
		const rect = anchor.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0 && rect.left > 0) left = Math.min(left, rect.left);
	}
	return Number.isFinite(left) ? left : Math.max(280, Math.round((doc.defaultView?.innerWidth || 1280) * 0.24));
}

function rightDetailsLeft(doc: Document): number {
	return rightDetailsLeftFromAnchors(doc, mainScrollAnchors(doc));
}

function findRelevantScrollTargetFromPath(doc: Document, path: EventTarget[]): HTMLElement | null {
	const view = doc.defaultView;
	const anchors = mainScrollAnchors(doc);
	for (const item of path) {
		if (!(item instanceof HTMLElement) || !item.isConnected) continue;
		const style = view?.getComputedStyle(item);
		const overflowY = style?.overflowY || '';
		const scrollable = item.scrollHeight > item.clientHeight + 8;
		const permitsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
		if (!scrollable || (!permitsScroll && item.scrollTop <= 0)) continue;
		if (anchors.some(anchor => item === anchor || item.contains(anchor))) return item;
	}
	return null;
}

function installInfoButtonScrollBehavior(
	doc: Document,
	nativeWrapperClass = '',
	ensureButtons?: () => void,
): void {
	// Steam rebuilds the sticky playbar while scrolling. Keep both the scroll
	// detector and our injected Info/Back-to-top control synchronized with the
	// live AppButtonsContainer instead of assuming the original node survives.
	infoScrollCleanups.get(doc)?.();
	const view = doc.defaultView;
	const knownScrollTargets = new Set<HTMLElement>();
	infoKnownScrollTargets.set(doc, knownScrollTargets);
	let frame = 0;
	let settleTimer = 0;
	let ensureTimer = 0;

	const ensureButtonNodes = (): void => {
		// A sticky-playbar rebuild can leave the old button connected in an
		// offscreen container while creating a new visible AppButtonsContainer.
		// Always resync the current containers; syncButtons() is idempotent.
		ensureButtons?.();
	};

	const applyMode = (active: boolean): void => {
		ensureButtonNodes();
		const topCapsule = doc.querySelector<HTMLElement>('[class*="TopCapsule"], [class*="topCapsule"], [class*="HeroContainer"], [class*="HeroAndLogo"]');
		const heroVisible = topCapsule && isRenderedElement(doc, topCapsule) && topCapsule.getBoundingClientRect().bottom > 40;

		for (const button of Array.from(doc.querySelectorAll<HTMLElement>('[data-gdl-game-info-button="1"]'))) {
			const playbar = button.closest<HTMLElement>('[class*="Container"], [class*="playbar"], [class*="PlayBar"]');
			const isButtonInPage = playbar ? (hasCssModuleClass(playbar, PLAYBAR_CLASSES().InPage) || playbar.getBoundingClientRect().top > 70) : true;

			// An in-page playbar that is visible while the hero is on screen MUST NEVER show the scroll-to-top arrow!
			const buttonActive = (!heroVisible && !isButtonInPage) ? active : false;
			if ((button.dataset.gdlScrollTopActive === '1') !== buttonActive) {
				setInfoButtonScrollMode(button, buttonActive, nativeWrapperClass);
			}
		}
	};

	const update = (): void => {
		frame = 0;
		for (const target of Array.from(knownScrollTargets)) {
			if (!target.isConnected) knownScrollTargets.delete(target);
		}
		const active = shouldShowScrollTopButton(doc, knownScrollTargets);
		applyMode(active);
	};
	const queueUpdate = (): void => {
		if (frame || !view) {
			if (!view) update();
			return;
		}
		frame = view.requestAnimationFrame(update);
	};
	const queueSettledUpdate = (): void => {
		queueUpdate();
		if (!view) return;
		if (settleTimer) view.clearTimeout(settleTimer);
		settleTimer = view.setTimeout(() => {
			settleTimer = 0;
			queueUpdate();
		}, 140);
	};
	const scheduleEnsureButtons = (): void => {
		if (!view || ensureTimer) return;
		ensureTimer = view.setTimeout(() => {
			ensureTimer = 0;
			ensureButtonNodes();
			queueUpdate();
		}, 0);
	};

	const onScroll = (rawEvent: Event): void => {
		const target = rawEvent.target;
		if (target instanceof HTMLElement) {
			const anchors = mainScrollAnchors(doc);
			const rect = target.getBoundingClientRect();
			const rightPaneScroller = target.scrollHeight > target.clientHeight + 8 && rect.right > rightDetailsLeft(doc) + 40;
			if (anchors.some(anchor => target === anchor || target.contains(anchor)) || rightPaneScroller) knownScrollTargets.add(target);
		}
		queueSettledUpdate();
	};

	const onWheel = (rawEvent: Event): void => {
		const event = rawEvent as WheelEvent;
		// Ignore the left library list. The sticky playbar belongs to the right
		// details pane, so a wheel gesture left of its content boundary must not
		// affect the Info/Back-to-top state.
		if (Number.isFinite(event.clientX) && event.clientX > 0 && event.clientX < rightDetailsLeft(doc) - 4) return;
		const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
		const target = findRelevantScrollTargetFromPath(doc, path);
		if (target) knownScrollTargets.add(target);
		queueSettledUpdate();
	};

	doc.addEventListener('scroll', onScroll, true);
	doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
	view?.addEventListener('resize', queueSettledUpdate, { passive: true });

	const MutationObserverCtor = view?.MutationObserver;
	const mutationObserver = typeof MutationObserverCtor === 'function'
		? new MutationObserverCtor((mutations) => {
			if (isPublicSteamLibraryRoute(doc)) {
				cleanup();
				removeNativeInfoButton(doc);
				removeNativeInfoPanel(doc);
				return;
			}
			const hasExternalMutations = mutations.some(m => {
				const target = m.target as HTMLElement | null;
				if (target?.closest?.('[data-gdl-game-info-button], #gdl-game-info-panel, [data-gdl-injected]')) return false;
				for (let i = 0; i < m.addedNodes.length; i++) {
					const node = m.addedNodes[i] as HTMLElement;
					if (node.nodeType === 1 && !node.closest?.('[data-gdl-game-info-button], #gdl-game-info-panel, [data-gdl-injected]')) {
						return true;
					}
				}
				for (let i = 0; i < m.removedNodes.length; i++) {
					const node = m.removedNodes[i] as HTMLElement;
					if (node.nodeType === 1 && !node.closest?.('[data-gdl-game-info-button], #gdl-game-info-panel, [data-gdl-injected]')) {
						return true;
					}
				}
				return false;
			});
			if (!hasExternalMutations) return;
			scheduleEnsureButtons();
			queueUpdate();
		})
		: null;
	if (mutationObserver && doc.body) mutationObserver.observe(doc.body, { childList: true, subtree: true });

	ensureButtonNodes();
	queueUpdate();
	const cleanup = (): void => {
		doc.removeEventListener('scroll', onScroll, true);
		doc.removeEventListener('wheel', onWheel, true);
		view?.removeEventListener('resize', queueSettledUpdate);
		mutationObserver?.disconnect();
		if (frame && view) view.cancelAnimationFrame(frame);
		if (settleTimer && view) view.clearTimeout(settleTimer);
		if (ensureTimer && view) view.clearTimeout(ensureTimer);
		infoKnownScrollTargets.delete(doc);
		infoScrollCleanups.delete(doc);
	};
	infoScrollCleanups.set(doc, cleanup);
}

function normalizeInformationButtonIcon(button: HTMLElement, nativeWrapperClass = ''): void {
	const existing = button.querySelector('svg');
	if (existing) {
		existing.outerHTML = informationSvgForButton(button);
		return;
	}
	// A validated native blueprint normally contains an SVG. Keep a defensive
	// fallback so a Steam markup change still produces the correct semantic icon.
	button.innerHTML = `<div class="${nativeWrapperClass}">${informationSvg()}</div>`;
}

function nativeFeatureSvg(feature: NativeGameFeature): string {
	switch (feature.kind) {
		case 'cloud':
			return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.2 19h10.4a5 5 0 0 0 .6-10 6.6 6.6 0 0 0-12.7-1.3A5.7 5.7 0 0 0 7.2 19Z"/></svg>`;
		case 'controller-full':
		case 'controller-partial':
		case 'steam-input':
			return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.1 7.2h9.8c2.1 0 3.5 1.5 4.1 4.1l.8 3.7c.5 2.4-2.3 3.8-3.8 2l-1.5-1.9h-9L6 17c-1.6 1.9-4.3.4-3.8-2l.8-3.7c.6-2.6 2-4.1 4.1-4.1Zm1.8 3H7.2v1.7H5.5v1.7h1.7v1.7h1.7v-1.7h1.7v-1.7H8.9v-1.7Zm6.4 1.1a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm2.6 2.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z"/></svg>`;
		case 'ps4':
			return `<svg viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M12.9 13.7c-.6 0-1.1-.5-1.1-1.1V8l-1.7 0L9.6 7.5c0 0-.1 0-.2 0-.1-.2-.2-.4-.4-.6-2.3-.4-3.8.2-4.3.5-.1 0-.1.1-.2.1C3.9 8 2.8 10.3 2.8 10.3c-.6 1.7-2.2 6.7-2.8 13.5 0 0-.6 5.1 3.4 5.6 3.5.4 4.6-4.1 5.2-6.5.2-.7.3-1.2.4-1.4.3-.3.7-.5.9-.5.6.7 1.5 1.1 2.5 1.1 1 0 1.9-.4 2.5-1.1H18v-7.3h-5.1zM36 23.8C35.4 17 33.8 12 33.2 10.3c0 0-1.1-2.2-1.7-2.8 0 0-.1-.1-.2-.1-.5-.3-2-.9-4.3-.5-.2.2-.3.4-.4.5-.1 0-.2 0-.2 0L25.9 8l-1.7 0v4.5c0 .6-.5 1.1-1.1 1.1H18V21h3.1c.6.7 1.5 1.1 2.5 1.1 1 0 1.9-.4 2.5-1.1.2 0 .6.2.9.5.1.2.2.7.4 1.4.6 2.4 1.7 6.9 5.2 6.5 4-.5 3.4-5.6 3.4-5.6z"/></svg>`;
		case 'ps5':
			return `<svg viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M4.7 25.2c.5-1.7 1.2-3.4 1.8-4.5.9-1.6 2.4-3.3 3.5-4.5.9-1 1.4-2.4 1.1-3.8l-.7-3.8c-.1-.4 0-.7.3-.9 0 0-.4 0-.8.1-1.1.1V7.3c0 0 0-.6-1.7-.6-1.3 0-2.6.7-3.1 1-.3.1-.4.3-.4.5v.6C4.3 8.9 4.1 8.9 3.9 9 2.8 9.6 0 18 0 23.1c0 2.7.5 4.6.9 5.8.2.6.7 1.1 1.2 1.4l.1 0c.5.2 1-.1 1.1-.6.4-1.1.8-2.8 1.4-4.5zM23.8 13.5l.6-2 .5-3c0-.2 0-.3-.1-.4-.1-.1-.4-.3-.7-.4-.1 0-.2-.1-.3-.1-1.7-.1-3.7-.2-5.9-.2v7.6h4c.9 0 1.7-.6 1.9-1.5z"/></svg>`;
		case 'achievements':
			return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 2 2.1 3.1 3.7-.8.3 3.8 3.5 1.5-1.7 3.4 2.5 2.9-3.1 2.2.7 3.7-3.8.2-1.5 3.5-3.4-1.7-2.9 2.5-2.2-3.1-3.7.7-.2-3.8-3.5-1.5 1.7-3.4-2.5-2.9 3.1-2.2-.7-3.7 3.8-.3L8.5 3.7 12 5.4 12 2Z"/></svg>`;
		case 'multiplayer':
		case 'coop':
		case 'family-sharing':
		case 'remote-play':
			return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.2 11a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Zm7.9.3a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2ZM8.2 12.5c-4 0-6.2 2-6.2 5V20h12.4v-2.5c0-3-2.2-5-6.2-5Zm8 .3c-.8 0-1.5.1-2.1.3 1.2 1.2 1.8 2.7 1.8 4.4V20H22v-2.1c0-3.1-2-5.1-5.8-5.1Z"/></svg>`;
		default:
			return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6ZM4.5 21v-2.2c0-4.1 2.8-6.5 7.5-6.5s7.5 2.4 7.5 6.5V21h-15Z"/></svg>`;
	}
}

function nativeInfoSignature(model: NativeGameInfo): string {
	return JSON.stringify(model);
}

function moduleClass(enabled: boolean, value?: string): string {
	return enabled ? String(value || '') : '';
}

function nativeInfoAssociation(classes: CssClasses, nativeLayout: boolean, label: string, value: string, release = false): string {
	if (!value) return '';
	const cleanLabel = label.trim().replace(/:$/, '') + ':';
	return `<div class="${moduleClass(nativeLayout, classes.Association)} ${release ? moduleClass(nativeLayout, classes.Release) : ''} gdl-info-row"><div class="${moduleClass(nativeLayout, classes.Label)} gdl-info-label">${escapeHtml(cleanLabel)}</div><div class="${release ? moduleClass(nativeLayout, classes.Date) : moduleClass(nativeLayout, classes.Name)} gdl-info-value">${escapeHtml(value)}</div></div>`;
}

function nativeInfoPanelHtml(model: NativeGameInfo, nativeLayout: boolean): string {
	const infoClasses = GAME_INFO_CLASS_MODULE().classes;
	const outerClasses = GAME_INFO_OUTER_CLASS_MODULE().classes;
	const stats = [
		nativeInfoAssociation(infoClasses, nativeLayout, loc('AppDetails_Developer', gdlText('developer', 'Developer')), model.developer),
		nativeInfoAssociation(infoClasses, nativeLayout, loc('AppDetails_Publisher', gdlText('publisher', 'Publisher')), model.publisher),
		nativeInfoAssociation(infoClasses, nativeLayout, loc('AppDetails_Franchise', gdlText('franchise', 'Franchise')), model.franchise),
		nativeInfoAssociation(infoClasses, nativeLayout, loc('AppDetails_ReleaseDate', gdlText('release_date', 'Release date')), model.release, true),
	].join('');
	const features = model.features.map(feature => `<div class="gdl-info-feature" data-gdl-feature="${escapeHtml(feature.kind)}">${nativeFeatureSvg(feature)}<span>${escapeHtml(feature.label)}</span></div>`).join('');
	const statsListClass = moduleClass(nativeLayout, infoClasses.AssociationList);
	return `
		<div class="${moduleClass(nativeLayout, infoClasses.Container)} gdl-game-info-container">
			<div class="${moduleClass(nativeLayout, infoClasses.InnerContainer)} gdl-game-info-grid">
				<div class="${moduleClass(nativeLayout, infoClasses.Portrait)} gdl-info-portrait">${model.portrait ? `<img class="${moduleClass(nativeLayout, infoClasses.BoxArt)}" src="${escapeHtml(model.portrait)}" alt="${escapeHtml(model.title)}">` : ''}</div>
				<div class="${moduleClass(nativeLayout, infoClasses.Description)} ${moduleClass(nativeLayout, infoClasses.SectionContainer)} gdl-info-description"><div class="${moduleClass(nativeLayout, infoClasses.GameDescription)} gdl-info-description-text">${escapeHtml(model.description || model.title)}</div></div>
				<div class="${moduleClass(nativeLayout, infoClasses.Stats)} ${moduleClass(nativeLayout, infoClasses.SectionContainer)} gdl-info-stats"><div class="${statsListClass} gdl-info-associations">${stats}</div></div>
				<div class="${moduleClass(nativeLayout, infoClasses.FeaturesList)} ${moduleClass(nativeLayout, infoClasses.SectionContainer)} gdl-info-features">${features}</div>
			</div>
		</div>
		${nativeLayout ? `<div class="${outerClasses.GameInfoShadow || ''}"></div>` : ''}`;
}

function updateNativeInfoPanelInPlace(doc: Document, panel: HTMLElement, model: NativeGameInfo, signature: string): void {
	const nativeLayout = panel.dataset.gdlNativeLayout === '1';
	const staging = doc.createElement('div');
	staging.innerHTML = nativeInfoPanelHtml(model, nativeLayout);
	for (const selector of ['.gdl-info-description-text', '.gdl-info-associations', '.gdl-info-features']) {
		const current = panel.querySelector<HTMLElement>(selector);
		const next = staging.querySelector<HTMLElement>(selector);
		if (current && next && current.innerHTML !== next.innerHTML) current.innerHTML = next.innerHTML;
	}
	panel.dataset.signature = signature;
	panel.dataset.gdlLegacy = model.isLegacy ? '1' : '0';

	const portrait = panel.querySelector<HTMLElement>('.gdl-info-portrait');
	const currentImage = portrait?.querySelector<HTMLImageElement>('img') || null;
	const nextImage = staging.querySelector<HTMLImageElement>('.gdl-info-portrait img');
	const desiredUrl = nextImage?.getAttribute('src') || '';
	if (!portrait || currentImage?.getAttribute('src') === desiredUrl) return;
	panel.dataset.gdlPendingPortrait = desiredUrl;
	if (!nextImage) {
		currentImage?.remove();
		return;
	}
	const commit = (): void => {
		if (!panel.isConnected || panel.dataset.gameKey !== model.key
			|| panel.dataset.gdlPendingPortrait !== desiredUrl) return;
		const livePortrait = panel.querySelector<HTMLElement>('.gdl-info-portrait');
		if (!livePortrait) return;
		livePortrait.replaceChildren(nextImage);
		resizeFallbackInfoPanel(panel);
	};
	if (nextImage.complete && nextImage.naturalWidth > 0) {
		commit();
		return;
	}
	if (typeof nextImage.decode === 'function') {
		void nextImage.decode().then(commit).catch(() => {});
	} else {
		nextImage.addEventListener('load', commit, { once: true });
	}
}

function nativeInfoPanelHeight(panel: HTMLElement): number {
	const content = panel.firstElementChild as HTMLElement | null;
	if (!content) return 1;
	const view = panel.ownerDocument?.defaultView;
	const contentStyle = view?.getComputedStyle(content);
	const panelStyle = view?.getComputedStyle(panel);
	const marginTop = parseFloat(contentStyle?.marginTop || '0') || 0;
	const marginBottom = parseFloat(contentStyle?.marginBottom || '0') || 0;
	const padTop = parseFloat(panelStyle?.paddingTop || '0') || 0;
	const padBottom = parseFloat(panelStyle?.paddingBottom || '0') || 0;
	const base = Math.max(content.scrollHeight, content.offsetHeight);
	return Math.max(1, Math.ceil(base + marginTop + marginBottom + padTop + padBottom));
}

let infoAnimationTimer: any = null;

function resizeFallbackInfoPanel(panel: HTMLElement): void {
	if (panel.dataset.expanded !== '1' || infoAnimationTimer) return;
	panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
}

function setNativeInfoExpanded(
	doc: Document,
	key: string,
	expanded: boolean,
	persist = false,
	animate = true,
): void {
	if (persist) {
		setPersistentInfoExpanded(expanded);
	}
	const panel = doc.getElementById('gdl-game-info-panel') as HTMLElement | null;
	const outerModule = GAME_INFO_OUTER_CLASS_MODULE();
	if (panel && panel.dataset.gameKey === key) {
		const nativeLayout = panel.dataset.gdlNativeLayout === '1' && outerModule.native;
		const isCurrentlyExpanded = panel.dataset.expanded === '1';

		if (expanded === isCurrentlyExpanded && panel.classList.contains(expanded ? 'gdl-info-expanded' : 'gdl-info-collapsed')) {
			if (expanded && !infoAnimationTimer) {
				panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
			}
			return;
		}

		panel.dataset.expanded = expanded ? '1' : '0';

		if (infoAnimationTimer) {
			clearTimeout(infoAnimationTimer);
			infoAnimationTimer = null;
		}

		if (!animate) {
			panel.classList.toggle('gdl-info-expanded', expanded);
			panel.classList.toggle('gdl-info-collapsed', !expanded);
			panel.classList.remove('gdl-info-collapsing');
			if (nativeLayout) {
				removeCssModuleClass(panel, expanded ? outerModule.classes.AppDetailsCollapsed : outerModule.classes.AppDetailsExpanded);
				addCssModuleClass(panel, expanded ? outerModule.classes.AppDetailsExpanded : outerModule.classes.AppDetailsCollapsed);
			}
			if (expanded) {
				panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
				panel.style.opacity = '1';
			} else {
				panel.style.height = '0px';
				panel.style.opacity = '0';
			}
			panel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
		} else if (expanded) {
			// Expansion: animate smoothly from current height to full content height
			panel.classList.remove('gdl-info-collapsed', 'gdl-info-collapsing');
			panel.classList.add('gdl-info-expanded');
			if (nativeLayout) {
				removeCssModuleClass(panel, outerModule.classes.AppDetailsCollapsed);
				addCssModuleClass(panel, outerModule.classes.AppDetailsExpanded);
			}
			panel.setAttribute('aria-hidden', 'false');

			const startHeight = Math.max(0, panel.getBoundingClientRect().height || 0);
			panel.style.height = `${startHeight}px`;
			panel.style.opacity = startHeight > 0 ? (panel.style.opacity || '0.5') : '0';

			const targetHeight = nativeInfoPanelHeight(panel);

			// Force reflow
			void panel.offsetHeight;

			panel.style.height = `${targetHeight}px`;
			panel.style.opacity = '1';

			infoAnimationTimer = setTimeout(() => {
				infoAnimationTimer = null;
				if (panel.isConnected && panel.dataset.expanded === '1') {
					panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
				}
			}, 320);
		} else {
			// Collapse: animate smoothly from current height down to 0px
			panel.classList.remove('gdl-info-expanded');
			panel.classList.add('gdl-info-collapsing');
			if (nativeLayout) {
				removeCssModuleClass(panel, outerModule.classes.AppDetailsExpanded);
				addCssModuleClass(panel, outerModule.classes.AppDetailsCollapsed);
			}

			const currentHeight = Math.max(1, panel.getBoundingClientRect().height || panel.offsetHeight || nativeInfoPanelHeight(panel));
			panel.style.height = `${currentHeight}px`;
			panel.style.opacity = '1';

			// Force reflow so browser commits starting height
			void panel.offsetHeight;

			panel.style.height = '0px';
			panel.style.opacity = '0';

			infoAnimationTimer = setTimeout(() => {
				infoAnimationTimer = null;
				if (panel.isConnected && panel.dataset.expanded === '0') {
					panel.classList.remove('gdl-info-collapsing');
					panel.classList.add('gdl-info-collapsed');
					panel.setAttribute('aria-hidden', 'true');
				}
			}, 320);
		}
	}
	for (const button of Array.from(doc.querySelectorAll<HTMLElement>('[data-gdl-game-info-button="1"]'))) {
		if (button.dataset.gameKey !== key) continue;
		const playbarModule = PLAYBAR_CLASS_MODULE();
		button.classList.toggle('gdl-info-active', expanded);
		if (playbarModule.native) {
			if (expanded) addCssModuleClass(button, playbarModule.classes.MenuActive);
			else removeCssModuleClass(button, playbarModule.classes.MenuActive);
		}
		button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
		const label = button.dataset.gdlScrollTopActive === '1'
			? scrollTopButtonLabel()
			: infoButtonLabel(expanded);
		button.setAttribute('aria-label', label);
		button.title = label;
	}
}

export function removeNativeInfoPanel(doc: Document, _preserveExpansion = false): void {
	if (infoAnimationTimer) {
		clearTimeout(infoAnimationTimer);
		infoAnimationTimer = null;
	}
	const panel = doc.getElementById('gdl-game-info-panel') as HTMLElement | null;
	if (!panel) return;
	nativeInfoResizeObservers.get(panel)?.disconnect();
	panel.remove();
}

export function ensureNativeInfoPanel(doc: Document, model: NativeGameInfo): HTMLElement | null {
	if (isPublicSteamLibraryRoute(doc)) {
		removeNativeInfoPanel(doc);
		return null;
	}
	let panel = doc.getElementById('gdl-game-info-panel') as HTMLElement | null;
	const signature = nativeInfoSignature(model);
	if (panel && panel.dataset.gameKey !== model.key) {
		removeNativeInfoPanel(doc, true);
		panel = null;
	} else if (panel && panel.dataset.signature !== signature) {
		updateNativeInfoPanelInPlace(doc, panel, model, signature);
	}
	if (!panel) {
		const infoModule = GAME_INFO_CLASS_MODULE();
		const outerModule = GAME_INFO_OUTER_CLASS_MODULE();
		const nativeLayout = infoModule.native && outerModule.native;
		panel = doc.createElement('div');
		panel.id = 'gdl-game-info-panel';
		panel.dataset.gdlNativeLayout = nativeLayout ? '1' : '0';
		panel.dataset.gdlLegacy = model.isLegacy ? '1' : '0';
		panel.className = nativeLayout
			? `${outerModule.classes.AppGameInfoContainer || ''} ${outerModule.classes.Glassy || ''}`.trim()
			: 'gdl-game-info-fallback';
		panel.innerHTML = nativeInfoPanelHtml(model, nativeLayout);
		panel.dataset.gameKey = model.key;
		panel.dataset.signature = signature;
		panel.setAttribute('role', 'region');
		panel.setAttribute('aria-label', loc('AppDetails_GameInfo', gdlText('game_information', 'Game information')));

		const linkBar = doc.getElementById('gdl-link-bar');
		if (linkBar?.parentElement) linkBar.parentElement.insertBefore(panel, linkBar);
		else return null;

		const ResizeObserverCtor = doc.defaultView?.ResizeObserver;
		const content = panel.firstElementChild as HTMLElement | null;
		if (typeof ResizeObserverCtor === 'function' && content) {
			const observer = new ResizeObserverCtor(() => {
				if (panel?.dataset.expanded === '1' && !infoAnimationTimer) {
					panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
				}
			});
			observer.observe(content);
			nativeInfoResizeObservers.set(panel, observer);
		}
		panel.querySelector('img')?.addEventListener('load', () => {
			if (panel?.dataset.expanded === '1' && !infoAnimationTimer) {
				panel.style.height = `${nativeInfoPanelHeight(panel)}px`;
			}
		});
	}
	const linkBar = doc.getElementById('gdl-link-bar');
	if (linkBar?.parentElement && panel.nextElementSibling !== linkBar) linkBar.parentElement.insertBefore(panel, linkBar);
	setNativeInfoExpanded(doc, model.key, false, false, false);
	return panel;
}

export function ensureNativeInfoButton(doc: Document, model: NativeGameInfo): void {
	if (isPublicSteamLibraryRoute(doc)) {
		removeNativeInfoButton(doc);
		return;
	}
	const playbarModule = PLAYBAR_CLASS_MODULE();
	const classes = playbarModule.classes;
	const syncButtons = (): void => {
		if (isPublicSteamLibraryRoute(doc)) {
			removeNativeInfoButton(doc);
			return;
		}
		const containers = elementsWithCssModuleClass(doc, classes.AppButtonsContainer).filter(container => container.isConnected);
		const viewportHeight = Math.max(0, doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0);
		const isViewportRendered = (container: HTMLElement): boolean => {
			if (!isRenderedElement(doc, container)) return false;
			const rect = container.getBoundingClientRect();
			return rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0;
		};
		const visibleContainers = containers.filter(isViewportRendered);
		const inPageCandidates = containers.filter(container => hasCssModuleClass(closestWithCssModuleClass(container, classes.Container), classes.InPage));
		const visibleInPage = inPageCandidates.filter(isViewportRendered);
		// Steam often leaves the old InPage playbar mounted but hidden while it
		// creates a visible sticky playbar during scroll. Never prefer a hidden
		// InPage container over the currently rendered button cluster.
		const targets = visibleInPage.length > 0
			? visibleInPage
			: (visibleContainers.length > 0 ? visibleContainers : inPageCandidates.length > 0 ? inPageCandidates : containers.slice(0, 1));
		for (const container of targets) {
			const existingGdlButton = container.querySelector<HTMLElement>('[data-gdl-game-info-button="1"]');
			const hasNativeInfo = Boolean(
				Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'))
					.some(b => !b.closest('[data-gdl-game-info-button]') && (
						Boolean(b.querySelector('.SVGIcon_Information, svg[class*="Information"]')) ||
						/details|informaci|detalles/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || '')
					))
			);
			if (hasNativeInfo) {
				if (existingGdlButton) existingGdlButton.remove();
				continue;
			}
			let button = existingGdlButton;
			if (!button) {
				button = buildNativeInfoButtonBlueprint(doc) || doc.createElement('button');
				const usesNativeBlueprint = button.dataset.gdlNativeBlueprint === '1';
				const capturedNativeIcon = usesNativeBlueprint
					? button.querySelector<SVGElement>('.SVGIcon_Information, svg[class*="Information"]')
					: null;
				if (capturedNativeIcon) button.dataset.gdlNativeInformationSvg = capturedNativeIcon.outerHTML;
				button.dataset.gdlGameInfoButton = '1';
				button.dataset.gameKey = model.key;
				button.hidden = false;
				button.removeAttribute('disabled');
				button.removeAttribute('aria-hidden');
				button.style.removeProperty('display');
				button.style.removeProperty('visibility');
				button.style.removeProperty('opacity');
				if (!button.className) button.className = playbarModule.native ? `${classes.MenuButton || ''}` : 'gdl-info-button-fallback';
				// Preserve Steam's native button structure/classes for hover lighting,
				// but never trust a captured SVG: sticky-playbar rebuilds may clone an
				// unrelated icon into this slot.
				if (!capturedNativeIcon) {
					if (!usesNativeBlueprint) button.innerHTML = `<div class="${playbarModule.native ? (classes.DotDotDot || '') : ''}">${informationSvg()}</div>`;
					normalizeInformationButtonIcon(button, playbarModule.native ? (classes.DotDotDot || '') : '');
				}
				button.setAttribute('type', 'button');
				button.setAttribute('aria-label', gdlText('show_game_details', 'Show game details'));
				button.addEventListener('click', event => {
					event.preventDefault();
					event.stopPropagation();
					if (button!.dataset.gdlScrollTopActive === '1') {
						scrollMainContentToTop(doc);
						return;
					}
					const key = button!.dataset.gameKey || '';
					const panel = doc.getElementById('gdl-game-info-panel') as HTMLElement | null;
					const isCurrentlyExpanded = panel ? panel.dataset.expanded === '1' : false;
					const nextState = !isCurrentlyExpanded;
					setNativeInfoExpanded(doc, key, nextState, false, true);
				});
				let favorite = elementsWithCssModuleClass(container, classes.FavoriteButton)[0] || null;
				while (favorite && favorite.parentElement !== container) favorite = favorite.parentElement;
				container.insertBefore(button, favorite);
			} else if (button.dataset.gdlScrollTopActive !== '1' && !button.querySelector('.SVGIcon_Information')) {
				normalizeInformationButtonIcon(button, playbarModule.native ? (classes.DotDotDot || '') : '');
			}
			button.dataset.gameKey = model.key;
		}
	};

	syncButtons();
	installInfoButtonScrollBehavior(doc, playbarModule.native ? (classes.DotDotDot || '') : '', syncButtons);
	setNativeInfoExpanded(doc, model.key, false, false, false);
}

export function removeNativeInfoButton(doc: Document): void {
	infoScrollCleanups.get(doc)?.();
	doc.querySelectorAll('[data-gdl-game-info-button="1"]').forEach(element => element.remove());
}

export function clearNativeInfoSessionState(): void {
	try {
		localStorage.removeItem(GDL_INFO_PANEL_EXPANDED_KEY);
	} catch {}
}
