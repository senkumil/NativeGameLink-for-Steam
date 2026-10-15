import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { DisposableRegistry } from '../../core/disposables';
import { ACH_CLASSES } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import { getOfficialCommunityItems, normalizeCommunityAssetUrl } from './community-items';
import { GDL_INJECTED } from './constants';
import type { NativeLibraryLayout } from './layout';
import { buildNativeSidebarSection } from './layout';
import { clearTradingCardPreloads, getTradingCardPreload, preloadTradingCardImage } from './trading-card-preload';
import { disposeNativeCardPreview, tryOpenNativeCardPreview } from './native-card-preview';
import { getLinkedSidebarOrder } from './sidebar-order';

const tradingCardPreviewCleanup = new WeakMap<Document, () => void>();
const responsiveGridCleanups = new Map<HTMLElement, () => void>();
const tiltLifecycles = new WeakMap<Document, Map<HTMLElement, DisposableRegistry>>();
const catalogSignatures = new WeakMap<HTMLElement, string>();
const helpCleanups = new WeakMap<Document, Map<HTMLElement, () => void>>();

function disposeTradingCardHelp(doc: Document, section?: HTMLElement): void {
	for (const [button, cleanup] of Array.from(helpCleanups.get(doc) || [])) {
		if (!section || section.contains(button)) cleanup();
	}
}

function removeTradingCardSection(section: HTMLElement): void {
	disposeTradingCardHelp(section.ownerDocument, section);
	responsiveGridCleanups.get(section)?.();
	tiltLifecycles.get(section.ownerDocument)?.get(section)?.dispose();
	catalogSignatures.delete(section);
	section.remove();
}

export function disposeTradingCardUI(doc: Document): void {
	disposeTradingCardPreview(doc);
	disposeResponsiveTradingCardGrids(doc);
	for (const lifecycle of Array.from(tiltLifecycles.get(doc)?.values() || [])) lifecycle.dispose();
	tiltLifecycles.delete(doc);
	clearTradingCardPreloads(doc);
	disposeTradingCardHelp(doc);
}

export function disposeTradingCardPreview(doc: Document): void {
	tradingCardPreviewCleanup.get(doc)?.();
	disposeNativeCardPreview(doc);
}

export function resetTradingCardTilts(doc: Document): void {
	for (const card of Array.from(doc.querySelectorAll<HTMLElement>('.gdl-trading-card.gdl-card-tilt-active'))) {
		card.classList.remove('gdl-card-tilt-active');
		const surface = card.querySelector<HTMLElement>('.gdl-trading-card-surface');
		const hitbox = card.querySelector<HTMLElement>('.gdl-trading-card-hitbox');
		if (surface) {
			for (const property of ['left', 'top', 'width', 'height', 'transform']) surface.style.removeProperty(property);
		}
		if (hitbox) {
			for (const property of ['left', 'top', 'width', 'height']) hitbox.style.removeProperty(property);
		}
		card.style.removeProperty('--gdl-card-angle');
		card.style.removeProperty('--gdl-sheen-pos');
		card.style.removeProperty('--gdl-sheen-alpha');
		card.style.removeProperty('--gdl-sheen-brightness');
		card.style.removeProperty('--gdl-holo-x');
		card.style.removeProperty('--gdl-holo-y');
		card.style.removeProperty('--gdl-card-pointer-x');
		card.style.removeProperty('--gdl-card-pointer-y');
		card.style.removeProperty('--gdl-cursor-glow-alpha');
	}
}

export function disposeResponsiveTradingCardGrids(doc: Document): void {
	for (const [section, cleanup] of Array.from(responsiveGridCleanups)) {
		if (section.ownerDocument === doc) cleanup();
	}
}

function openTradingCardPreview(doc: Document, imageUrl: string, gameName: string, fallbackUrl?: string): void {
	if (!doc.body || (!imageUrl && !fallbackUrl)) return;
	tradingCardPreviewCleanup.get(doc)?.();
	resetTradingCardTilts(doc);
	const initialUrl = imageUrl || fallbackUrl || '';
	// Use the same measured image viewer as Steam's own trading cards. Steam
	// owns the popup frame, image limits, typography and both close controls.
	if (tryOpenNativeCardPreview(doc, initialUrl, gameName, fallbackUrl)) return;
	disposeNativeCardPreview(doc);

	const cachedPreload = getTradingCardPreload(doc, initialUrl);
	const initialWidth = (cachedPreload && cachedPreload.complete && cachedPreload.naturalWidth > 0)
		? cachedPreload.naturalWidth
		: 1920;
	const initialHeight = (cachedPreload && cachedPreload.complete && cachedPreload.naturalHeight > 0)
		? cachedPreload.naturalHeight
		: 1080;

	const overlay = doc.createElement('div');
	overlay.id = 'gdl-trading-card-preview';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', gameName || gdlText('trading_cards', 'Trading Cards'));
	overlay.innerHTML = `
		<div class="gdl-trading-card-preview-panel">
			<button type="button" class="gdl-trading-card-preview-x" aria-label="${escapeHtml(gdlText('close', 'Close'))}">×</button>
			<img class="gdl-trading-card-preview-image" src="${escapeHtml(initialUrl)}" alt="${escapeHtml(gameName)}" decoding="async" />
			<button type="button" class="gdl-trading-card-preview-close">${escapeHtml(gdlText('close', 'Close'))}</button>
		</div>`;

	const panel = overlay.querySelector<HTMLElement>('.gdl-trading-card-preview-panel');
	const image = overlay.querySelector<HTMLImageElement>('.gdl-trading-card-preview-image');
	let closed = false;
	let triedFallback = false;

	if (image && fallbackUrl && fallbackUrl !== initialUrl && (!cachedPreload || !cachedPreload.complete)) {
		image.style.backgroundImage = `url("${fallbackUrl}")`;
	}

	const fitPreviewToImage = (naturalW?: number, naturalH?: number): void => {
		if (!panel || !image) return;
		const nw = naturalW || image.naturalWidth || initialWidth;
		const nh = naturalH || image.naturalHeight || initialHeight;
		if (nw <= 0 || nh <= 0) return;
		const view = doc.defaultView;
		const viewportWidth = Math.max(320, view?.innerWidth || doc.documentElement.clientWidth || 1280);
		const viewportHeight = Math.max(240, view?.innerHeight || doc.documentElement.clientHeight || 720);
		const maxPanelWidth = Math.max(240, viewportWidth - 30);
		const maxImageWidth = Math.max(120, Math.min(1500, maxPanelWidth - 32));
		const maxImageHeight = Math.max(120, viewportHeight - 114);
		const scale = Math.min(maxImageWidth / nw, maxImageHeight / nh, 1);
		const imageWidth = Math.max(1, Math.round(nw * scale));
		const imageHeight = Math.max(1, Math.round(nh * scale));

		panel.style.width = `${imageWidth + 32}px`;
		panel.style.maxWidth = `${maxPanelWidth}px`;
		image.style.width = `${imageWidth}px`;
		image.style.height = `${imageHeight}px`;
		image.style.maxHeight = 'none';
		const closeButton = overlay.querySelector<HTMLElement>('.gdl-trading-card-preview-close');
		if (closeButton) closeButton.style.width = `${Math.max(1, Math.min(780, Math.round(imageWidth * .5)))}px`;
	};

	const onImageLoad = (): void => {
		if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
			image.style.backgroundImage = 'none';
			fitPreviewToImage(image.naturalWidth, image.naturalHeight);
		} else {
			onImageError();
		}
	};
	const onImageError = (): void => {
		if (!triedFallback && fallbackUrl && image && image.src !== fallbackUrl) {
			triedFallback = true;
			image.src = fallbackUrl;
			return;
		}
		dismiss();
	};
	image?.addEventListener('load', onImageLoad);
	image?.addEventListener('error', onImageError);
	const onWindowResize = (): void => fitPreviewToImage();
	doc.defaultView?.addEventListener('resize', onWindowResize);
	const isInsideButton = (event: MouseEvent | PointerEvent, selector: string): boolean => {
		const button = overlay.querySelector<HTMLElement>(selector);
		if (!button) return false;
		const rect = button.getBoundingClientRect();
		return event.clientX >= rect.left && event.clientX <= rect.right
			&& event.clientY >= rect.top && event.clientY <= rect.bottom;
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') dismiss();
	};
	const dismiss = (): void => {
		if (closed) return;
		closed = true;
		doc.removeEventListener('keydown', onKeyDown, true);
		overlay.removeEventListener('pointerup', onPreviewPointerUp, true);
		overlay.removeEventListener('dblclick', onPreviewDoubleClick, true);
		image?.removeEventListener('load', onImageLoad);
		image?.removeEventListener('error', onImageError);
		doc.defaultView?.removeEventListener('resize', onWindowResize);
		overlay.remove();
		tradingCardPreviewCleanup.delete(doc);
		resetTradingCardTilts(doc);
	};
	const onPreviewPointerUp = (event: PointerEvent): void => {
		const target = event.target instanceof Element
			? event.target.closest<HTMLButtonElement>('.gdl-trading-card-preview-close, .gdl-trading-card-preview-x')
			: null;
		const hitCloseButton = target && overlay.contains(target)
			|| isInsideButton(event, '.gdl-trading-card-preview-close')
			|| isInsideButton(event, '.gdl-trading-card-preview-x');
		if (!hitCloseButton) return;
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	};
	const onPreviewDoubleClick = (event: MouseEvent): void => {
		const target = event.target instanceof Element
			? event.target.closest<HTMLButtonElement>('.gdl-trading-card-preview-close, .gdl-trading-card-preview-x')
			: null;
		const hitCloseButton = Boolean(target && overlay.contains(target))
			|| isInsideButton(event, '.gdl-trading-card-preview-close')
			|| isInsideButton(event, '.gdl-trading-card-preview-x');
		if (!hitCloseButton) return;
		event.preventDefault();
		event.stopPropagation();
	};
	tradingCardPreviewCleanup.set(doc, dismiss);
	overlay.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', dismiss));
	overlay.addEventListener('pointerup', onPreviewPointerUp, true);
	overlay.addEventListener('dblclick', onPreviewDoubleClick, true);
	overlay.addEventListener('click', event => {
		if (event.target === overlay) dismiss();
	});
	doc.addEventListener('keydown', onKeyDown, true);

	fitPreviewToImage(cachedPreload?.naturalWidth, cachedPreload?.naturalHeight);
	doc.body.appendChild(overlay);

	const view = doc.defaultView;
	if (view) view.requestAnimationFrame(() => overlay.classList.add('is-visible'));
	else overlay.classList.add('is-visible');

	if (image?.complete) {
		if (image.naturalWidth > 0 && image.naturalHeight > 0) onImageLoad();
		else onImageError();
	}
	setTimeout(() => overlay.querySelector<HTMLButtonElement>('.gdl-trading-card-preview-close')?.focus(), 0);
}

/** Steam-like foil-card motion with bounded, per-card listeners. */
export function setupTradingCardTilt(root: HTMLElement): void {
	const doc = root.ownerDocument;
	let lifecycles = tiltLifecycles.get(doc);
	if (!lifecycles) { lifecycles = new Map(); tiltLifecycles.set(doc, lifecycles); }
	lifecycles.get(root)?.dispose();
	const ownedLifecycles = lifecycles;
	const lifecycle = new DisposableRegistry(() => ownedLifecycles.delete(root));
	ownedLifecycles.set(root, lifecycle);
	let activeReset: (() => void) | null = null;
	let activeContainsPoint: ((clientX: number, clientY: number) => boolean) | null = null;
	let lastClientX = 0;
	let lastClientY = 0;
	const activators = new Map<HTMLElement, (clientX: number, clientY: number) => void>();
	const trackDocumentPointer = (event: PointerEvent): void => {
		lastClientX = event.clientX;
		lastClientY = event.clientY;
		if (!root.isConnected) {
			lifecycle.dispose();
		}
	};
	const onPointerLeaveOrScroll = (): void => {
		if (activeReset) activeReset();
	};
	// The pointer may leave the whole sidebar before the delayed leave check
	// runs. Track it at document level so that check never uses stale in-panel
	// coordinates and leaves a card expanded after the cursor moved away.
	lifecycle.listen(doc, 'pointermove', trackDocumentPointer, { capture: true, passive: true });
	lifecycle.listen(doc, 'pointerleave', onPointerLeaveOrScroll, { passive: true });
	if (doc.defaultView) {
		lifecycle.listen(doc.defaultView, 'scroll', onPointerLeaveOrScroll, { passive: true, capture: true });
		lifecycle.listen(doc.defaultView, 'blur', onPointerLeaveOrScroll);
	}
	lifecycle.listen(doc, 'visibilitychange', onPointerLeaveOrScroll);

	// CEF does not always emit a fresh pointerenter after an expanded card is
	// removed from beneath the cursor. Pointer movement therefore also acts as
	// a recovery path for the unexpanded card currently under the pointer.
	lifecycle.listen(root, 'pointermove', (event: PointerEvent) => {
		lastClientX = event.clientX;
		lastClientY = event.clientY;
		if (activeReset) return;
		const target = event.target instanceof Element
			? event.target.closest<HTMLElement>('.gdl-trading-card')
			: null;
		if (target && root.contains(target)) activators.get(target)?.(event.clientX, event.clientY);
	}, { passive: true });

	for (const card of Array.from(root.querySelectorAll<HTMLElement>('.gdl-trading-card'))) {
		if (card.dataset.gdlTiltReady === '1') continue;
		const surface = card.querySelector<HTMLElement>('.gdl-trading-card-surface');
		if (!surface) continue;
		const hitbox = card.ownerDocument.createElement('div');
		hitbox.className = 'gdl-trading-card-hitbox';
		hitbox.setAttribute('aria-hidden', 'true');
		card.appendChild(hitbox);
		card.dataset.gdlTiltReady = '1';
		let frame = 0;
		let recoveryFrame = 0;
		let pointerX = .5;
		let pointerY = .5;
		let baseRect: DOMRect | null = null;
		let leaveTimer = 0;
		let tiltEnabledAt = 0;
		const view = card.ownerDocument.defaultView;

		const render = (): void => {
			frame = 0;
			if (!card.classList.contains('gdl-card-tilt-active')) return;
			const dx = pointerX - 0.5;
			const dy = pointerY - 0.5;
			// Refined physical tilt: natural 22-26 deg max with smooth perspective
			const rotateY = dx * 26;
			const rotateX = -dy * 22;
			const translateX = dx * 8;
			const translateY = dy * 6;
			const lightAngle = Math.round(125 + dx * 50 + dy * 35);
			// Linear specular sheen position shifts smoothly across the card surface
			const sheenPos = Math.round(50 + (dx * 60 - dy * 40));
			const sheenAlpha = Math.max(0.10, Math.min(0.35, 0.22 - dy * 0.22)).toFixed(3);
			const sheenBrightness = Math.max(0.94, Math.min(1.08, 1.0 - dy * 0.14)).toFixed(2);
			const holoX = Math.round(50 + dx * 70);
			const holoY = Math.round(50 + dy * 70);

			card.style.setProperty('--gdl-card-angle', `${lightAngle}deg`);
			card.style.setProperty('--gdl-sheen-pos', `${sheenPos}%`);
			card.style.setProperty('--gdl-sheen-alpha', sheenAlpha);
			card.style.setProperty('--gdl-sheen-brightness', sheenBrightness);
			card.style.setProperty('--gdl-holo-x', `${holoX}%`);
			card.style.setProperty('--gdl-holo-y', `${holoY}%`);
			surface.style.transform = `perspective(650px) translate3d(${translateX.toFixed(2)}px,${translateY.toFixed(2)}px,0) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
		};

		const queueRender = (): void => {
			if (frame) return;
			frame = view?.requestAnimationFrame(render) || 0;
			if (!frame) render();
		};

		const reset = (): void => {
			if (leaveTimer) view?.clearTimeout(leaveTimer);
			leaveTimer = 0;
			if (frame && view) view.cancelAnimationFrame(frame);
			frame = 0;
			pointerX = .5;
			pointerY = .5;
			baseRect = null;
			tiltEnabledAt = 0;
			card.classList.remove('gdl-card-tilt-active');
			for (const property of ['left', 'top', 'width', 'height', 'transform']) surface.style.removeProperty(property);
			for (const property of ['left', 'top', 'width', 'height']) hitbox.style.removeProperty(property);
			card.style.removeProperty('--gdl-card-angle');
			card.style.removeProperty('--gdl-sheen-pos');
			card.style.removeProperty('--gdl-sheen-alpha');
			card.style.removeProperty('--gdl-sheen-brightness');
			card.style.removeProperty('--gdl-holo-x');
			card.style.removeProperty('--gdl-holo-y');
			card.style.removeProperty('--gdl-card-pointer-x');
			card.style.removeProperty('--gdl-card-pointer-y');
			card.style.removeProperty('--gdl-cursor-glow-alpha');
			if (activeReset === reset) {
				activeReset = null;
				activeContainsPoint = null;
			}
		};
		lifecycle.add(() => {
			reset();
			if (recoveryFrame) view?.cancelAnimationFrame(recoveryFrame);
			hitbox.remove();
			delete card.dataset.gdlTiltReady;
		});

		const onSurfacePointerMove = (event: PointerEvent): void => {
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			if (leaveTimer) view?.clearTimeout(leaveTimer);
			leaveTimer = 0;
			if (!card.classList.contains('gdl-card-tilt-active')) return;
			const now = view?.performance?.now() ?? Date.now();
			if (now < tiltEnabledAt) {
				pointerX = .5;
				pointerY = .5;
				queueRender();
				return;
			}
			const rect = surface.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			pointerX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
			pointerY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
			queueRender();
		};

		const activate = (clientX: number, clientY: number): void => {
			if (card.classList.contains('gdl-card-tilt-active')) return;
			// An expanded card intentionally overlaps neighboring grid cells. Do
			// not let their native pointerenter steal focus while the pointer is
			// still inside the active card's enlarged interaction margin.
			if (activeReset && activeReset !== reset && activeContainsPoint?.(clientX, clientY)) return;
			if (leaveTimer) view?.clearTimeout(leaveTimer);
			leaveTimer = 0;
			if (activeReset && activeReset !== reset) {
				activeReset();
			}
			activeReset = reset;

			baseRect = card.getBoundingClientRect();
			// 1.75 is a 20% increase over the previous 1.46x native-like preview.
			const width = baseRect.width * 1.75;
			const height = width * 261 / 224;
			let left = -(width - baseRect.width) / 2;
			let top = -(height - baseRect.height) / 2;

			// Steam lets the preview leave its sidebar panel while keeping it
			// centered over the original card. Only protect the actual viewport
			// edges; clamping to the panel made edge cards expand off-center.
			const viewportWidth = view?.innerWidth || card.ownerDocument.documentElement.clientWidth;
			const viewportHeight = view?.innerHeight || card.ownerDocument.documentElement.clientHeight;
			const viewportMargin = 8;
			const absoluteLeft = baseRect.left + left;
			const absoluteRight = absoluteLeft + width;
			if (absoluteLeft < viewportMargin) left += viewportMargin - absoluteLeft;
			else if (absoluteRight > viewportWidth - viewportMargin) left -= absoluteRight - (viewportWidth - viewportMargin);
			const absoluteTop = baseRect.top + top;
			const absoluteBottom = absoluteTop + height;
			if (absoluteTop < viewportMargin) top += viewportMargin - absoluteTop;
			else if (absoluteBottom > viewportHeight - viewportMargin) top -= absoluteBottom - (viewportHeight - viewportMargin);

			surface.style.left = `${left.toFixed(2)}px`;
			surface.style.top = `${top.toFixed(2)}px`;
			surface.style.width = `${width.toFixed(2)}px`;
			surface.style.height = `${height.toFixed(2)}px`;
			// Perspective plus the upward translation consumes part of the nominal
			// top margin when the pointer raises the card. Compensate that visual
			// displacement so the usable clearance feels equal on every edge.
			const hitboxPadding = 18;
			const hitboxTopPadding = 28;
			hitbox.style.left = `${(left - hitboxPadding).toFixed(2)}px`;
			hitbox.style.top = `${(top - hitboxTopPadding).toFixed(2)}px`;
			hitbox.style.width = `${(width + hitboxPadding * 2).toFixed(2)}px`;
			hitbox.style.height = `${(height + hitboxTopPadding + hitboxPadding).toFixed(2)}px`;
			card.classList.add('gdl-card-tilt-active');
			tiltEnabledAt = (view?.performance?.now() ?? Date.now()) + 180;
			activeContainsPoint = (x: number, y: number): boolean => {
				const rect = hitbox.getBoundingClientRect();
				return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
			};

			// Begin the lift upright. Pointer movement after the short lift-in
			// period enables the 3D tilt, matching Steam's centered expansion.
			pointerX = .5;
			pointerY = .5;

			queueRender();
		};
		activators.set(card, activate);
		let pointerDownX = 0;
		let pointerDownY = 0;
		let pointerDownTime = 0;
		let lastPreviewOpenedTime = 0;

		lifecycle.listen(card, 'pointerenter', (event: PointerEvent) => {
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			activate(event.clientX, event.clientY);
			const fullArtworkUrl = card.dataset.gdlFullImage;
			if (fullArtworkUrl) preloadTradingCardImage(doc, fullArtworkUrl);
		});

		// The local hitbox follows the expanded card with equal space on all sides.
		// Leaving either the visible surface or its margin must reset the card.
		// Otherwise a surface can remain above a neighboring card and prevent that
		// card from receiving its next pointer-enter event.
		const resetWhenLeavingCard = (event: PointerEvent): void => {
			const next = event.relatedTarget;
			if (next instanceof Node && card.contains(next)) return;
			if (leaveTimer) view?.clearTimeout(leaveTimer);
			leaveTimer = view?.setTimeout(() => {
				leaveTimer = 0;
				const marginRect = hitbox.getBoundingClientRect();
				const stillInside = lastClientX >= marginRect.left && lastClientX <= marginRect.right
					&& lastClientY >= marginRect.top && lastClientY <= marginRect.bottom;
				if (stillInside) return;
				reset();

				// Re-evaluate after the expanded surface disappears. This repairs the
				// missing pointerenter event when another card is now under the cursor.
				if (recoveryFrame) view?.cancelAnimationFrame(recoveryFrame);
				recoveryFrame = view?.requestAnimationFrame(() => {
					recoveryFrame = 0;
					const element = card.ownerDocument.elementFromPoint(lastClientX, lastClientY);
					const hovered = element?.closest<HTMLElement>('.gdl-trading-card') || null;
					if (hovered && root.contains(hovered)) activators.get(hovered)?.(lastClientX, lastClientY);
				}) || 0;
			}, 110) || 0;
		};
		lifecycle.listen(surface, 'pointermove', onSurfacePointerMove, { passive: true });
		lifecycle.listen(hitbox, 'pointermove', onSurfacePointerMove, { passive: true });
		lifecycle.listen(surface, 'pointerout', resetWhenLeavingCard);
		lifecycle.listen(hitbox, 'pointerout', resetWhenLeavingCard);

		lifecycle.listen(card, 'pointercancel', reset);
		const openPreview = (): void => {
			const now = Date.now();
			if (now - lastPreviewOpenedTime < 350) return;
			lastPreviewOpenedTime = now;
			reset();
			resetTradingCardTilts(card.ownerDocument);
			const image = card.querySelector<HTMLImageElement>('img');
			const thumbnailUrl = image?.currentSrc || image?.src || '';
			const fullArtworkUrl = card.dataset.gdlFullImage || '';
			const cardTitle = card.getAttribute('aria-label') || root.querySelector<HTMLElement>('.gdl-trading-badge')?.title || '';
			const preferredUrl = fullArtworkUrl || thumbnailUrl;
			openTradingCardPreview(card.ownerDocument, preferredUrl, cardTitle, thumbnailUrl);
		};

		const onCardPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			pointerDownX = event.clientX;
			pointerDownY = event.clientY;
			pointerDownTime = Date.now();
			const fullArtworkUrl = card.dataset.gdlFullImage;
			if (fullArtworkUrl) preloadTradingCardImage(doc, fullArtworkUrl);
		};

		const onCardPointerUp = (event: PointerEvent): void => {
			if (event.button !== 0 || !pointerDownTime) return;
			const dt = Date.now() - pointerDownTime;
			pointerDownTime = 0;
			const dx = Math.abs(event.clientX - pointerDownX);
			const dy = Math.abs(event.clientY - pointerDownY);
			if (dx < 16 && dy < 16 && dt < 650) {
				event.preventDefault();
				event.stopPropagation();
				openPreview();
			}
		};

		lifecycle.listen(card, 'pointerdown', onCardPointerDown, { passive: true });
		lifecycle.listen(surface, 'pointerdown', onCardPointerDown, { passive: true });
		lifecycle.listen(hitbox, 'pointerdown', onCardPointerDown, { passive: true });

		lifecycle.listen(card, 'pointerup', onCardPointerUp);
		lifecycle.listen(surface, 'pointerup', onCardPointerUp);
		lifecycle.listen(hitbox, 'pointerup', onCardPointerUp);

		lifecycle.listen(card, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			openPreview();
		});
		lifecycle.listen(card, 'keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			openPreview();
		});
	}
}

export interface TradingCardRenderOptions {
	steamAppId: string;
	shortcutAppId: string | null;
	gameName: string;
	isCurrent: () => boolean;
}

function setupTradingCardsHelpTooltip(doc: Document, button: HTMLElement): void {
	let popup: HTMLElement | null = null;

	const show = (): void => {
		if (popup || !button.isConnected) return;
		popup = doc.createElement('div');
		popup.className = 'gdl-trading-cards-help-popup';
		popup.innerHTML = `
			<div style="margin-bottom:10px;">${escapeHtml(gdlText('trading_cards_help_p1', "Find cards while playing. You can trade them with friends (or on the Steam Community Market) for cards you haven't been able to find."))}</div>
			<div>${escapeHtml(gdlText('trading_cards_help_p2', 'Complete the full set and turn it into a badge. Badges increase your Steam level and unlock benefits for your account and profile.'))}</div>
		`;
		doc.body.appendChild(popup);

		const rect = button.getBoundingClientRect();
		const popupWidth = Math.min(310, (doc.defaultView?.innerWidth || doc.documentElement.clientWidth || 400) - 24);

		// Position to the left of the ? button matching native Steam UI
		let left = rect.left - popupWidth - 6;
		if (left < 12) {
			left = Math.max(12, rect.right - popupWidth);
		}
		let top = rect.top - 12;
		if (top < 12) top = 12;

		popup.style.position = 'fixed';
		popup.style.left = `${Math.round(left)}px`;
		popup.style.top = `${Math.round(top)}px`;
		popup.style.width = `${popupWidth}px`;
		popup.style.zIndex = '2147483600';
	};

	const hide = (): void => {
		if (popup) {
			popup.remove();
			popup = null;
		}
	};

	button.addEventListener('mouseenter', show);
	button.addEventListener('mouseleave', hide);
	button.addEventListener('focus', show);
	button.addEventListener('blur', hide);
	let cleanups = helpCleanups.get(doc);
	if (!cleanups) { cleanups = new Map(); helpCleanups.set(doc, cleanups); }
	const ownedCleanups = cleanups;
	ownedCleanups.set(button, () => {
		hide();
		button.removeEventListener('mouseenter', show);
		button.removeEventListener('mouseleave', hide);
		button.removeEventListener('focus', show);
		button.removeEventListener('blur', hide);
		ownedCleanups.delete(button);
	});
}

/** Steam reflows cards into fewer columns before it reduces their visual size. */
function installResponsiveTradingCardGrid(section: HTMLElement): void {
	responsiveGridCleanups.get(section)?.();
	const body = section.querySelector<HTMLElement>('.gdl-trading-cards-body');
	const grid = section.querySelector<HTMLElement>('.gdl-trading-card-grid');
	if (!body || !grid) return;
	const update = (): void => {
		const width = body.clientWidth;
		const columns = width < 340 ? 3 : width < 440 ? 4 : 5;
		grid.style.setProperty('grid-template-columns', `repeat(${columns}, minmax(0, 1fr))`, 'important');
	};
	update();
	const ResizeObserverCtor = section.ownerDocument.defaultView?.ResizeObserver;
	if (typeof ResizeObserverCtor !== 'function') return;
	const observer = new ResizeObserverCtor(update);
	observer.observe(body);
	const cleanup = (): void => {
		observer.disconnect();
		responsiveGridCleanups.delete(section);
	};
	responsiveGridCleanups.set(section, cleanup);
}

export async function renderOfficialTradingCards(
	doc: Document,
	layout: NativeLibraryLayout,
	options: TradingCardRenderOptions,
): Promise<void> {
	const { steamAppId, gameName } = options;
	if (!options.shortcutAppId) return;
	const { anchorRegion, sidebarColumn } = layout;
	const order = getLinkedSidebarOrder(doc, layout, steamAppId, options.shortcutAppId);
	if (!order || !options.isCurrent()) return;
	const catalog = await getOfficialCommunityItems(doc, steamAppId);
	if (!catalog || !options.isCurrent() || !order.isCurrent()
		|| !doc.getElementById(GDL_INJECTED) || !anchorRegion || !sidebarColumn) return;
	const previous = doc.getElementById('gdl-trading-cards-section');
	const existing = previous?.parentElement === sidebarColumn && previous.dataset.gdlSteamAppId === steamAppId
		&& previous.dataset.gdlShortcutAppId === order.shortcutAppId ? previous : null;
	if (catalog.cards.length === 0) { if (existing) removeTradingCardSection(existing); return; }
	const signature = JSON.stringify([gameName, catalog.cards, catalog.foil_badge, catalog.badges]);
	if (existing && catalogSignatures.get(existing) === signature) return;

	const cards = catalog.cards.map((card, index) => {
		const image = normalizeCommunityAssetUrl(card.image);
		if (!image) return '';
		const artwork = normalizeCommunityAssetUrl(card.artwork) || image;
		const title = card.title || gameName;
		const foilClass = card.foil ? ' gdl-foil-card' : '';
		return `<div class="gdl-trading-card gdl-official-card${foilClass}" data-gdl-card-index="${index}" data-gdl-full-image="${escapeHtml(artwork)}" role="button" tabindex="0" aria-label="${escapeHtml(title)}"><div class="gdl-trading-card-surface"><img src="${escapeHtml(image)}" alt="" /><span class="gdl-card-hologram" aria-hidden="true"></span></div></div>`;
	}).filter(Boolean).join('');
	if (!cards) return;

	const officialPortrait = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_600x900.jpg`;
	const badgeAsset = catalog.foil_badge || catalog.badges?.find(badge => badge.foil) || catalog.badges?.[catalog.badges.length - 1];
	const cardFallback = catalog.cards?.[0]?.image || '';
	const badgeSource = normalizeCommunityAssetUrl(badgeAsset?.image) || cardFallback || officialPortrait;
	const badgeTitle = badgeAsset?.title || catalog.badges?.[0]?.title || gdlText('cards_found', 'Cards found');
	const candidate = buildNativeSidebarSection(doc, layout, {
		sectionId: 'gdl-trading-cards-section',
		headerText: loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading Cards')),
		innerId: 'gdl-trading-cards-content',
		innerHtml: `<div class="${ACH_CLASSES().HighlightDiv} gdl-native-sidebar-panel" style="padding:0 !important;box-sizing:border-box;overflow:visible;"><div class="gdl-trading-cards-badge-header"><div class="gdl-trading-badge" title="${escapeHtml(badgeTitle)}"><img class="gdl-trading-badge-image" src="${escapeHtml(badgeSource)}" alt="${escapeHtml(badgeTitle)}" /></div><div style="min-width:0;"><div class="gdl-trading-badge-title" style="font-size:16px;line-height:1.25;color:#fff;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(badgeTitle)}</div><div class="gdl-trading-badge-xp" style="font-size:13px;color:#8f98a0;margin-top:2px;">${escapeHtml(gdlText('experience_points', '100 XP'))}</div></div></div><div class="gdl-trading-cards-body" style="padding:12px 10px 14px;"><div class="gdl-trading-card-remaining" style="font-size:13px;color:#9da4ab;margin-bottom:10px;">${escapeHtml(gdlText('cards_remaining', '{count} cards remaining', { count: 0 }))}</div><div class="gdl-trading-card-grid">${cards}</div><a class="gdl-trading-cards-view-link" href="https://steamcommunity.com/my/gamecards/${steamAppId}/" data-gdl-open-url="https://steamcommunity.com/my/gamecards/${steamAppId}/" style="display:block;text-align:right;margin-top:14px;color:#9da4ab;text-decoration:none;font-size:13px;">${escapeHtml(gdlText('view_my_cards', 'View my cards'))}</a></div></div>`,
		cloneInnerClass: false,
	});
	if (!candidate || !options.isCurrent() || !order.isCurrent()) return;
	const section = existing || candidate;
	if (existing) {
		disposeTradingCardHelp(doc, existing);
		responsiveGridCleanups.get(existing)?.();
		tiltLifecycles.get(doc)?.get(existing)?.dispose();
		section.innerHTML = candidate.innerHTML;
	}
	catalogSignatures.set(section, signature);

	const badgeImg = section.querySelector<HTMLImageElement>('.gdl-trading-badge-image');
	badgeImg?.addEventListener('error', () => { badgeImg.style.visibility = 'hidden'; });

	const heading = section.querySelector('h2');
	if (heading) {
		const text = (heading.querySelector('div div') || heading.querySelector('div') || heading) as HTMLElement;
		text.textContent = loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading Cards'));
		const help = doc.createElement('button');
		help.type = 'button';
		help.className = 'gdl-trading-cards-help-btn';
		help.textContent = '?';
		help.setAttribute('aria-label', gdlText('trading_cards', 'Trading Cards'));
		text.appendChild(help);
		setupTradingCardsHelpTooltip(doc, help);

		const headingChildren = Array.from(heading.children) as HTMLElement[];
		const textRoot = headingChildren.find(child => child === text || child.contains(text)) || null;
		for (const child of headingChildren) {
			if (child === textRoot) continue;
			child.style.display = 'none';
		}
	}

	if (!order.publish(section, 'cards')) return;

	setupTradingCardTilt(section);
	installResponsiveTradingCardGrid(section);
	for (const image of Array.from(section.querySelectorAll<HTMLImageElement>('.gdl-trading-card img'))) {
		image.addEventListener('error', () => {
			image.closest('.gdl-trading-card')?.remove();
			if (!section.querySelector('.gdl-trading-card')) removeTradingCardSection(section);
		});
	}
	backendLog(`Official Steam cards applied for ${steamAppId}: ${catalog.cards.length} card(s), foil=${String(!!catalog.foil_badge)}`);
}
