import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { DisposableRegistry } from '../../core/disposables';
import { communityCardId, getCachedCommunityItemOptions, getCommunityItemOptions,
	subscribeCommunityItemOptions, type CommunityItemOptions } from '../../core/community-item-options';
import { resolveClassModule } from '../../steam/css';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import { getImmediateOfficialCommunityItems, getOfficialCommunityItems, normalizeCommunityAssetUrl,
	subscribeOfficialCommunityItems } from './community-items';
import { GDL_INJECTED } from './constants';
import { disposeTradingCardHelp, setupTradingCardsHelpTooltip } from './trading-card-help';
import type { NativeLibraryLayout } from './layout';
import { buildNativeSidebarSection } from './layout';
import { clearTradingCardPreloads, getTradingCardPreload, preloadTradingCardImage } from './trading-card-preload';
import { disposeNativeCardPreview, tryOpenNativeCardPreview } from './native-card-preview';
import { ensureLinkedSidebarOrder, getLinkedSidebarOrder, type LinkedSidebarOrder, type LinkedSidebarOwner } from './sidebar-order';
import { linkedCardPresentation } from './linked-card-presentation';
import type { SteamCommunityItemsCatalog } from '../../domain/types';

const tradingCardPreviewCleanup = new WeakMap<Document, () => void>();
const responsiveGridCleanups = new Map<HTMLElement, () => void>();
const tiltLifecycles = new WeakMap<Document, Map<HTMLElement, DisposableRegistry>>();
const catalogSignatures = new WeakMap<HTMLElement, string>();
interface TradingCardBinding {
	doc: Document;
	layout: NativeLibraryLayout;
	options: TradingCardRenderOptions;
	order: LinkedSidebarOrder;
	catalog: SteamCommunityItemsCatalog | null;
	selection: CommunityItemOptions | null;
	selectionLoading: boolean;
	selectionFailed: boolean;
	language: string;
	section: HTMLElement | null;
	cleanup: () => void;
}
const bindings = new WeakMap<Document, TradingCardBinding>();

function cardLanguage(): string {
	return String(typeof steamLanguageSync === 'function' && steamLanguageSync() || 'english').toLowerCase();
}

function currentCardBinding(binding: TradingCardBinding): boolean {
	const { doc } = binding, view = doc.defaultView;
	return bindings.get(doc) === binding && binding.options.isCurrent() && binding.order.isCurrent()
		&& Boolean(view && !view.closed && view.document === doc);
}

function removeTradingCardSection(section: HTMLElement): void {
	disposeTradingCardHelp(section.ownerDocument, section);
	responsiveGridCleanups.get(section)?.();
	tiltLifecycles.get(section.ownerDocument)?.get(section)?.dispose();
	catalogSignatures.delete(section);
	section.remove();
}

export function disposeTradingCardUI(doc: Document): void {
	const binding = bindings.get(doc);
	bindings.delete(doc);
	binding?.cleanup();
	if (binding?.section) removeTradingCardSection(binding.section);
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
		const reset = (card as HTMLElement & { __gdlResetTradingCardTilt?: () => void }).__gdlResetTradingCardTilt;
		if (reset) { reset(); continue; }
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
		const viewportWidth = overlay.clientWidth || view?.innerWidth || doc.documentElement.clientWidth || 1280;
		const viewportHeight = overlay.clientHeight || view?.innerHeight || doc.documentElement.clientHeight || 720;
		const maxPanelWidth = Math.max(1, viewportWidth - 30);
		const maxImageWidth = Math.max(1, Math.min(1500, maxPanelWidth - 34));
		const maxImageHeight = Math.max(1, viewportHeight - 114);
		const scale = Math.min(maxImageWidth / nw, maxImageHeight / nh, 1);
		const imageWidth = Math.max(1, Math.round(nw * scale));
		const imageHeight = Math.max(1, Math.round(nh * scale));

		panel.style.width = `${imageWidth + 34}px`;
		panel.style.maxWidth = `${maxPanelWidth}px`;
		panel.style.maxHeight = `${Math.max(1, viewportHeight - 24)}px`;
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

	doc.body.appendChild(overlay);
	fitPreviewToImage(cachedPreload?.naturalWidth, cachedPreload?.naturalHeight);

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
		lifecycle.listen(doc.defaultView, 'resize', onPointerLeaveOrScroll, { passive: true });
	}
	lifecycle.listen(doc, 'visibilitychange', onPointerLeaveOrScroll);

	// CEF does not always emit a fresh pointerenter after an expanded card is
	// removed from beneath the cursor. Pointer movement therefore also acts as
	// a recovery path for the unexpanded card currently under the pointer.
	lifecycle.listen(root, 'pointermove', (event: PointerEvent) => {
		lastClientX = event.clientX;
		lastClientY = event.clientY;
		if (activeReset) return;
		const element = event.target as HTMLElement | null;
		const target = element?.ownerDocument === doc && typeof element.closest === 'function'
			? element.closest<HTMLElement>('.gdl-trading-card') : null;
		if (target && root.contains(target)) activators.get(target)?.(event.clientX, event.clientY);
	}, { passive: true });

	for (const card of Array.from(root.querySelectorAll<HTMLElement>('.gdl-trading-card'))) {
		if (card.dataset.gdlTiltReady === '1') continue;
		const surface = card.querySelector<HTMLElement>('.gdl-trading-card-surface');
		if (!surface) continue;
		const motion = doc.createElement('div');
		motion.className = 'gdl-trading-card-motion';
		for (const child of Array.from(surface.children)) motion.appendChild(child);
		surface.appendChild(motion);
		const masks = ['w', 'e', 's'].map(edge => {
			const mask = doc.createElement('div'); mask.className = 'gdl-card-paper-mask'; mask.dataset.edge = edge;
			const shine = doc.createElement('div'); shine.className = 'gdl-card-paper-shine'; mask.appendChild(shine);
			motion.appendChild(mask); return mask;
		});
		const hitbox = card.ownerDocument.createElement('div');
		hitbox.className = 'gdl-trading-card-hitbox';
		hitbox.setAttribute('aria-hidden', 'true');
		card.appendChild(hitbox);
		card.dataset.gdlTiltReady = '1';
		let frame = 0;
		let recoveryFrame = 0;
		let pointerX = .5;
		let pointerY = .5;
		let expandedWidth = 1, expandedHeight = 1;
		let baseRect: DOMRect | null = null;
		let leaveTimer = 0;
		const view = card.ownerDocument.defaultView;

		const render = (): void => {
			frame = 0;
			if (!card.classList.contains('gdl-card-tilt-active')) return;
			// Steam's Q hook maps offsets through this logistic curve, then maps
			// rotation into brightness and its three paper-mask light sources.
			const angle = (value: number) => 90 / (1 + Math.exp(-value)) - 45;
			const rotateY = angle(pointerX * 2 - 1), rotateX = angle(1 - pointerY * 2);
			motion.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
			card.style.setProperty('--gdl-native-brightness', String(1 + rotateX / 45));
			card.style.setProperty('--gdl-paper-left', `${-rotateY * 2}px`);
			card.style.setProperty('--gdl-paper-top', `${rotateX * 2}px`);
			[rotateY / 45, -rotateY / 45, rotateX / 45].forEach((opacity, index) =>
				masks[index].style.setProperty('--gdl-paper-opacity', String(opacity)));
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
			card.classList.remove('gdl-card-tilt-active');
			for (const property of ['left', 'top', 'width', 'height', 'transform']) surface.style.removeProperty(property);
			motion.style.removeProperty('transform');
			for (const property of ['--gdl-native-brightness', '--gdl-paper-left', '--gdl-paper-top']) card.style.removeProperty(property);
			for (const mask of masks) mask.style.removeProperty('--gdl-paper-opacity');
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
		(card as HTMLElement & { __gdlResetTradingCardTilt?: () => void }).__gdlResetTradingCardTilt = reset;
		lifecycle.add(() => {
			reset();
			if (recoveryFrame) view?.cancelAnimationFrame(recoveryFrame);
			hitbox.remove();
			for (const mask of masks) mask.remove();
			for (const child of Array.from(motion.children)) surface.insertBefore(child, motion);
			motion.remove();
			delete (card as HTMLElement & { __gdlResetTradingCardTilt?: () => void }).__gdlResetTradingCardTilt;
			delete card.dataset.gdlTiltReady;
		});

		const onSurfacePointerMove = (event: PointerEvent): void => {
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			if (leaveTimer) view?.clearTimeout(leaveTimer);
			leaveTimer = 0;
			if (!card.classList.contains('gdl-card-tilt-active')) return;
			const rect = surface.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			const target = event.target as Node | null;
			const imageTarget = target?.ownerDocument === doc && motion.contains(target);
			pointerX = imageTarget ? event.offsetX / expandedWidth : (event.clientX - rect.left) / rect.width;
			pointerY = imageTarget ? event.offsetY / expandedHeight : (event.clientY - rect.top) / rect.height;
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
			const logicalWidth = Number.parseFloat(view?.getComputedStyle(card).width || '') || card.offsetWidth || baseRect.width;
			const scale = logicalWidth > 0 ? baseRect.width / logicalWidth : 1;
			const logicalHeight = baseRect.height / scale;
			const enlargement = card.dataset.owned === 'true' ? 2.5 : 1.5;
			const width = logicalWidth * enlargement;
			const height = width * 261 / 224;
			const left = -(width - logicalWidth) / 2;
			const top = -(height - logicalHeight) / 2;
			expandedWidth = width; expandedHeight = height;

			// Native cards stay centered and only shift left when the expanded
			// right edge would cross the viewport's 30px clearance.
			const viewportWidth = view?.innerWidth || card.ownerDocument.documentElement.clientWidth;
			const absoluteRight = baseRect.left + baseRect.width / 2 + baseRect.width * enlargement / 2;
			const shift = absoluteRight > viewportWidth - 30 ? viewportWidth - absoluteRight - 30 : 0;

			surface.style.left = `${left.toFixed(2)}px`;
			surface.style.top = `${top.toFixed(2)}px`;
			surface.style.width = `${width.toFixed(2)}px`;
			surface.style.height = `${height.toFixed(2)}px`;
			surface.style.transform = `${shift ? `translateX(${shift}px) ` : ''}scale(1)`;
			hitbox.style.left = `${(left + shift).toFixed(2)}px`;
			hitbox.style.top = `${top.toFixed(2)}px`;
			hitbox.style.width = `${width.toFixed(2)}px`;
			hitbox.style.height = `${height.toFixed(2)}px`;
			card.classList.add('gdl-card-tilt-active');
			activeContainsPoint = (x: number, y: number): boolean => {
				const rect = hitbox.getBoundingClientRect();
				return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
			};

			// Steam enters upright and enables tilt on the next pointer movement.
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
			if (fullArtworkUrl && card.dataset.gdlPreviewAllowed !== 'false') preloadTradingCardImage(doc, fullArtworkUrl);
		});

		// Match the native expanded card's bounds and immediate mouse-leave.
		const resetWhenLeavingCard = (event: PointerEvent): void => {
			const next = event.relatedTarget as Node | null;
			if (next?.ownerDocument === doc && card.contains(next)) return;
			reset();
			if (recoveryFrame) view?.cancelAnimationFrame(recoveryFrame);
			recoveryFrame = view?.requestAnimationFrame(() => {
				recoveryFrame = 0;
				const element = card.ownerDocument.elementFromPoint(lastClientX, lastClientY);
				const hovered = element?.closest<HTMLElement>('.gdl-trading-card') || null;
				if (hovered && root.contains(hovered)) activators.get(hovered)?.(lastClientX, lastClientY);
			}) || 0;
		};
		lifecycle.listen(surface, 'pointermove', onSurfacePointerMove, { passive: true });
		lifecycle.listen(hitbox, 'pointermove', onSurfacePointerMove, { passive: true });
		lifecycle.listen(surface, 'pointerout', resetWhenLeavingCard);
		lifecycle.listen(hitbox, 'pointerout', resetWhenLeavingCard);

		lifecycle.listen(card, 'pointercancel', reset);
		const openPreview = (): void => {
			if (card.dataset.gdlPreviewAllowed === 'false') return;
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
			if (fullArtworkUrl && card.dataset.gdlPreviewAllowed !== 'false') preloadTradingCardImage(doc, fullArtworkUrl);
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

/** Steam chooses percentages from the full details pane, then flex-wraps its
 * min/max-constrained cards. The sidebar's width alone cannot select this mode. */
function installResponsiveTradingCardGrid(section: HTMLElement, layout: NativeLibraryLayout): void {
	responsiveGridCleanups.get(section)?.();
	const body = section.querySelector<HTMLElement>('.gdl-trading-cards-body');
	const grid = section.querySelector<HTMLElement>('.gdl-trading-card-grid');
	if (!body || !grid) return;
	const doc = section.ownerDocument, view = doc.defaultView;
	let pane = layout.twoColumnRow || layout.sidebarColumn?.parentElement || body;
	const panelClasses = resolveClassModule(module => Boolean(module.MainPanel && module.AppDetailsMain
		&& module.AppDetailsTransitionGroup), {}, doc).classes;
	const panelTokens = String(panelClasses.MainPanel || '').split(/\s+/).filter(Boolean);
	if (panelTokens.length) {
		for (let node: HTMLElement | null = pane; node; node = node.parentElement) {
			if (panelTokens.every(token => node!.classList.contains(token))) { pane = node; break; }
		}
	}
	const classes = resolveClassModule(module => Boolean(module.CardsSection && module.CardWrapper
		&& module.SlightlyLargerThanNarrow && module.BetweenNarrowAndMedium),
		{ RightBreakNarrow: '884px', RightBreakWide: '1500px' }, doc).classes;
	const narrow = Number.parseFloat(classes.RightBreakNarrow) || 884;
	const wide = Number.parseFloat(classes.RightBreakWide) || 1500;
	const update = (): void => {
		// The native responsive owner publishes this exact logical clientWidth
		// to rightPanelWidth before choosing its card section classes.
		const width = pane.clientWidth;
		const percentage = width <= narrow ? 30 : width >= narrow + 242 ? 18 : width >= narrow + 42 ? 23 : 31;
		for (const [property, value] of [['--gdl-trading-card-width', `${percentage}%`],
			['--gdl-trading-card-max-width', width >= wide ? '110px' : '85px']]) {
			if (grid.style.getPropertyValue(property) !== value) grid.style.setProperty(property, value);
		}
	};
	update();
	const ResizeObserverCtor = view?.ResizeObserver;
	const observer = typeof ResizeObserverCtor === 'function' ? new ResizeObserverCtor(update) : null;
	observer?.observe(body);
	if (pane !== body) observer?.observe(pane);
	view?.addEventListener('resize', update, { passive: true });
	const cleanup = (): void => {
		observer?.disconnect();
		view?.removeEventListener('resize', update);
		responsiveGridCleanups.delete(section);
	};
	responsiveGridCleanups.set(section, cleanup);
}

export async function renderOfficialTradingCards(
	doc: Document,
	layout: NativeLibraryLayout,
	options: TradingCardRenderOptions,
): Promise<void> {
	const { steamAppId } = options;
	if (!options.shortcutAppId) return;
	const order = getLinkedSidebarOrder(doc, layout, steamAppId, options.shortcutAppId);
	if (!order || !options.isCurrent()) return;
	const language = cardLanguage();
	const previous = bindings.get(doc);
	if (previous && previous.options.steamAppId === steamAppId && previous.options.shortcutAppId === options.shortcutAppId
		&& previous.layout.sidebarColumn === layout.sidebarColumn && previous.language === language) {
		previous.options = options; previous.layout = layout; previous.order = order;
		paintTradingCards(previous); refreshTradingCardSelection(previous);
		await getOfficialCommunityItems(doc, steamAppId, language).then(catalog => {
			if (!catalog || !currentCardBinding(previous) || previous.language !== cardLanguage()) return;
			previous.catalog = getImmediateOfficialCommunityItems(doc, steamAppId, language) || catalog;
			paintTradingCards(previous);
		}).catch(error => backendLog(`Steam card foreground recovery failed for ${steamAppId}: ${String(error)}`));
		return;
	}
	disposeTradingCardUI(doc);
	doc.getElementById('gdl-trading-cards-section')?.remove();
	const binding: TradingCardBinding = { doc, layout, options, order, language, section: null, selectionLoading: false,
		selectionFailed: false, cleanup: () => {}, catalog: getImmediateOfficialCommunityItems(doc, steamAppId, language),
		selection: getCachedCommunityItemOptions(doc, options.shortcutAppId, steamAppId) };
	bindings.set(doc, binding);
	const current = () => currentCardBinding(binding) && binding.language === cardLanguage();
	const applyCatalog = (catalog: SteamCommunityItemsCatalog | null) => {
		if (!catalog || !current()) return;
		binding.catalog = getImmediateOfficialCommunityItems(doc, steamAppId, language) || catalog;
		paintTradingCards(binding); refreshTradingCardSelection(binding);
	};
	const applySelection = (selection: CommunityItemOptions) => {
		if (!current()) return;
		binding.selection = selection; binding.selectionFailed = false; paintTradingCards(binding);
	};
	const stopCatalog = subscribeOfficialCommunityItems(doc, steamAppId, applyCatalog, language);
	const stopSelection = subscribeCommunityItemOptions(doc, options.shortcutAppId, steamAppId, applySelection);
	const close = () => { if (bindings.get(doc) === binding) disposeTradingCardUI(doc); };
	const view = doc.defaultView;
	let frame = 0;
	// Steam can replace direct sidebar children while keeping the detail owner.
	// Restore only this binding's node; retired routes and unlinked games fail closed.
	const observer = view?.MutationObserver && layout.sidebarColumn ? new view.MutationObserver(() => {
		if (frame || !currentCardBinding(binding)) return;
		const section = binding.section;
		if (language === cardLanguage() && (!section || section.parentElement === binding.layout.sidebarColumn
			&& section.querySelector('.gdl-trading-card-grid, .gdl-trading-cards-status'))) return;
		frame = view.requestAnimationFrame(() => {
			frame = 0;
			if (!currentCardBinding(binding)) return;
			if (binding.language !== cardLanguage()) {
				void renderOfficialTradingCards(doc, binding.layout, binding.options);
			} else paintTradingCards(binding);
		});
	}) : null;
	observer?.observe(layout.sidebarColumn!, { childList: true, subtree: true });
	view?.addEventListener('pagehide', close);
	binding.cleanup = () => {
		stopCatalog(); stopSelection(); observer?.disconnect();
		if (frame) view?.cancelAnimationFrame(frame);
		frame = 0; view?.removeEventListener('pagehide', close);
	};
	paintTradingCards(binding);
	refreshTradingCardSelection(binding, true);
	await getOfficialCommunityItems(doc, steamAppId, language).then(applyCatalog)
		.catch(error => backendLog(`Steam card enrichment failed for ${steamAppId}: ${String(error)}`));
}

/** Renew a mounted sidebar without rebuilding its activity feed. A replaced
 * native column or retired lease requires the caller to rediscover the layout. */
export function refreshTradingCardUI(doc: Document, owner?: LinkedSidebarOwner): boolean {
	const binding = bindings.get(doc);
	if (!binding) return false;
	let options = binding.options;
	if (owner) {
		if (owner.steamAppId !== options.steamAppId || owner.shortcutAppId !== options.shortcutAppId
			|| !binding.layout.sidebarColumn?.isConnected || !binding.layout.anchorRegion?.isConnected
			|| !owner.isCurrent() || !ensureLinkedSidebarOrder(doc, binding.layout, owner)) return false;
		options = { ...options, isCurrent: owner.isCurrent };
	} else if (!currentCardBinding(binding)) return false;
	void renderOfficialTradingCards(doc, binding.layout, options)
		.catch(error => backendLog(`Steam card refresh failed: ${String(error)}`));
	return true;
}

function refreshTradingCardSelection(binding: TradingCardBinding, revalidate = false): void {
	if (binding.selectionLoading || binding.selection && !revalidate || bindings.get(binding.doc) !== binding) return;
	binding.selectionLoading = true; binding.selectionFailed = false;
	paintTradingCards(binding);
	const { doc, options } = binding;
	void getCommunityItemOptions(doc, options.shortcutAppId!, options.steamAppId).then(selection => {
		if (bindings.get(doc) !== binding || !binding.options.isCurrent() || !binding.order.isCurrent()
			|| !doc.defaultView || doc.defaultView.closed || doc.defaultView.document !== doc) return;
		binding.selection = selection; binding.selectionFailed = false; paintTradingCards(binding);
	}).catch(error => {
		if (currentCardBinding(binding)) binding.selectionFailed = true;
		backendLog(`Steam card selection load failed for ${options.steamAppId}: ${String(error)}`);
	}).finally(() => { binding.selectionLoading = false; if (currentCardBinding(binding)) paintTradingCards(binding); });
}

function paintTradingCardStatus(binding: TradingCardBinding, existing: HTMLElement | null, message: string, retry = false): void {
	const { doc, layout, order } = binding;
	const candidate = buildNativeSidebarSection(doc, layout, {
		sectionId: 'gdl-trading-cards-section',
		headerText: loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading Cards')),
		innerId: 'gdl-trading-cards-content', cloneInnerClass: false,
		innerHtml: `<div class="gdl-native-sidebar-panel gdl-trading-cards-body gdl-trading-cards-status" role="status"><div>${escapeHtml(message)}</div>${retry
			? `<button type="button" class="DialogButton gdl-trading-cards-retry">${escapeHtml(gdlText('community_retry', 'Retry'))}</button>` : ''}</div>`,
	});
	if (!candidate || !currentCardBinding(binding)) return;
	const signature = JSON.stringify(['status', binding.language, message, retry]);
	if (existing && catalogSignatures.get(existing) === signature && existing.querySelector('.gdl-trading-cards-status')) {
		if (existing.parentElement !== order.column) order.publish(existing, 'cards');
		binding.section = existing; return;
	}
	const section = existing || candidate;
	if (existing) {
		disposeTradingCardHelp(doc, existing); responsiveGridCleanups.get(existing)?.();
		tiltLifecycles.get(doc)?.get(existing)?.dispose(); section.innerHTML = candidate.innerHTML;
	}
	catalogSignatures.set(section, signature);
	section.querySelector('.gdl-trading-cards-retry')?.addEventListener('click', () => {
		if (!currentCardBinding(binding)) return;
		if (!binding.selection) refreshTradingCardSelection(binding, true);
		void getOfficialCommunityItems(doc, binding.options.steamAppId, binding.language, { refresh: true }).then(catalog => {
			if (!currentCardBinding(binding) || !catalog) return;
			binding.catalog = catalog; paintTradingCards(binding);
		}).catch(error => backendLog(`Steam card retry failed: ${String(error)}`));
	});
	if (order.publish(section, 'cards')) binding.section = section;
}

function paintTradingCards(binding: TradingCardBinding): void {
	const { doc, layout, options, order, catalog, selection } = binding;
	const { steamAppId, gameName } = options;
	const { anchorRegion, sidebarColumn } = layout;
	if (!currentCardBinding(binding) || binding.language !== cardLanguage()
		|| !doc.getElementById(GDL_INJECTED) || !anchorRegion || !sidebarColumn) return;
	const previous = doc.getElementById('gdl-trading-cards-section');
	const owned = (section: HTMLElement | null): section is HTMLElement => Boolean(section && section.ownerDocument === doc
		&& (!section.parentElement || section.parentElement === sidebarColumn) && section.dataset.gdlSteamAppId === steamAppId
		&& section.dataset.gdlShortcutAppId === order.shortcutAppId);
	const existing = owned(previous) ? previous : owned(binding.section) ? binding.section : null;
	if (!selection) {
		paintTradingCardStatus(binding, existing, binding.selectionFailed
			? gdlText('community_settings_load_failed', 'Could not load the saved selection. Retry before changing cards or badges.')
			: gdlText('community_settings_loading', 'Loading saved card and badge settings...'), binding.selectionFailed);
		return;
	}
	if (!catalog) {
		paintTradingCardStatus(binding, existing, gdlText('community_options_loading', 'Loading cards and badges...')); return;
	}
	const presentation = linkedCardPresentation(catalog, selection);
	if (presentation.cards.length === 0 && !presentation.badge) {
		const complete = catalog.cards_complete === true && catalog.badges_complete === true && !catalog.error && !catalog.transient_error;
		if (!complete) {
			if (existing?.querySelector('.gdl-trading-card-grid') && existing.dataset.gdlCardBorder === (presentation.foil ? 'foil' : 'normal')) {
				if (existing.parentElement !== sidebarColumn) order.publish(existing, 'cards');
				return;
			}
			paintTradingCardStatus(binding, existing, gdlText(catalog.loading ? 'community_cards_set_loading' : 'community_cards_set_unavailable',
				catalog.loading ? 'The selected card set is still loading. Your saved selection is kept.'
					: 'The selected card set has not loaded. Retry to complete it. Your saved selection is kept.'), !catalog.loading);
			return;
		}
		if (existing) removeTradingCardSection(existing);
		binding.section = null; return;
	}
	const signature = JSON.stringify([gameName, presentation.cards, presentation.badge, presentation.nextBadge,
		presentation.nextLevelXP, presentation.level, presentation.maxed, presentation.foil, presentation.xp, presentation.remaining]);
	if (existing && catalogSignatures.get(existing) === signature && existing.querySelector('.gdl-trading-card-grid')) {
		if (existing.parentElement !== sidebarColumn) order.publish(existing, 'cards');
		binding.section = existing; return;
	}

	const cards = presentation.cards.map((card, index) => {
		const image = normalizeCommunityAssetUrl(card.image);
		if (!image) return '';
		const artwork = normalizeCommunityAssetUrl(card.artwork) || image;
		const title = card.title || gameName;
		const foilClass = card.foil ? ' gdl-foil-card' : '';
		const ownershipClass = card.owned ? '' : ' gdl-trading-card-unowned';
		return `<div class="gdl-trading-card gdl-official-card${foilClass}${ownershipClass}" data-owned="${card.owned}" data-gdl-preview-allowed="${card.owned || presentation.level > 0}" data-gdl-community-card-id="${escapeHtml(communityCardId(card))}" data-gdl-card-index="${index}" data-gdl-full-image="${escapeHtml(artwork)}" role="button" tabindex="0" aria-label="${escapeHtml(title)}"><div class="gdl-trading-card-surface"><img src="${escapeHtml(image)}" alt="" /><div class="gdl-trading-card-title">${escapeHtml(title)}</div><span class="gdl-card-hologram" aria-hidden="true"></span></div></div>`;
	}).filter(Boolean).join('');
	if (!cards && !presentation.badge) return;

	const badgeAsset = presentation.badge;
	const badgeSource = normalizeCommunityAssetUrl(badgeAsset?.image);
	const badgeTitle = badgeAsset?.title || presentation.nextBadge?.title || gdlText('community_badge_none', 'No local badge');
	const xpLabel = badgeAsset ? loc('AppDetails_BadgeLevel', 'Level %1$s, %2$s XP')
		.replace('%1$s', String(presentation.level)).replace('%2$s', String(presentation.xp))
		: loc('AppDetails_UnearnedBadgeXP', '%1$s XP').replace('%1$s', String(presentation.nextLevelXP));
	const url = `https://steamcommunity.com/my/gamecards/${steamAppId}/${presentation.foil ? '?border=1' : ''}`;
	const sectionCss = resolveClassModule(module => Boolean(module.AppDetailsSectionContainer && module.RightColumnSection
		&& module.Highlight && module.Body), {}, doc).classes;
	const cardCss = resolveClassModule(module => Boolean(module.BadgeSection && module.BadgeInfo && module.CardsSection), {}, doc).classes;
	const actionCss = resolveClassModule(module => Boolean(module.AppDetailsButton && module.BottomRight), {}, doc).classes;
	const badgeImage = badgeSource
		? `<a class="gdl-trading-badge ${cardCss.Badge || ''}" href="${url}" data-gdl-open-url="${url}" title="${escapeHtml(loc('AppDetails_ViewBadgePage', 'View badge page'))}"><img class="gdl-trading-badge-image" src="${escapeHtml(badgeSource)}" alt="${escapeHtml(badgeTitle)}" /></a>`
		: `<div class="gdl-trading-badge gdl-trading-badge-empty ${cardCss.Badge || ''} ${cardCss.EmptyCircle || ''}" aria-hidden="true"></div>`;
	const remainingLabel = presentation.remaining > 0 ? loc(presentation.remaining === 1 ? 'AppDetails_TradingCardsLeft' : 'AppDetails_TradingCardsLeft_Plural',
		gdlText('cards_remaining', '{count} cards remaining', { count: presentation.remaining })).replace('%1$s', String(presentation.remaining))
		: presentation.maxed ? loc('AppDetails_TradingCardsMaxed', 'Congratulations! You have reached the maximum badge level!')
			: loc('AppDetails_TradingCardsLevelUp', 'You have enough cards to level up!');
	const remainingState = presentation.maxed ? ' gdl-trading-card-maxed' : presentation.remaining === 0 ? ' gdl-trading-card-ready' : '';
	const remaining = presentation.cards.length ? presentation.remaining === 0 && !presentation.maxed
		? `<a class="gdl-trading-card-remaining${remainingState}" href="${url}" data-gdl-open-url="${url}">${escapeHtml(remainingLabel)}</a>`
		: `<div class="gdl-trading-card-remaining${remainingState}">${escapeHtml(remainingLabel)}</div>` : '';
	const candidate = buildNativeSidebarSection(doc, layout, {
		sectionId: 'gdl-trading-cards-section',
		headerText: loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading Cards')),
		innerId: 'gdl-trading-cards-content',
		innerHtml: `<div class="gdl-native-sidebar-panel">
			<div class="gdl-trading-cards-badge-header ${sectionCss.Highlight || 'gdl-card-highlight-fallback'} ${cardCss.BadgeSection || ''}">
				${badgeImage}<div class="gdl-trading-badge-info ${cardCss.BadgeInfo || ''}">
					<div class="gdl-trading-badge-title ${cardCss.BadgeName || ''}">${escapeHtml(badgeTitle)}</div>
					<div class="gdl-trading-badge-xp ${cardCss.BadgeLevel || ''}">${escapeHtml(xpLabel)}</div>
				</div>
			</div>
			<div class="gdl-trading-cards-body">${remaining}<div class="gdl-trading-card-grid" role="list">${cards}</div>
				<button type="button" class="gdl-trading-cards-view-link DialogButton ${actionCss.AppDetailsButton || ''} ${actionCss.BottomRight || ''}" data-gdl-open-url="${url}">${escapeHtml(loc('AppDetails_ViewTradingCards', gdlText('view_my_cards', 'View my cards')))}</button>
			</div>
		</div>`,
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
	section.dataset.gdlCardBorder = presentation.foil ? 'foil' : 'normal';

	const badgeImg = section.querySelector<HTMLImageElement>('.gdl-trading-badge-image');
	badgeImg?.addEventListener('error', () => { badgeImg.style.visibility = 'hidden'; });

	const heading = section.querySelector('h2');
	if (heading) {
		const text = (heading.querySelector('div div') || heading.querySelector('div') || heading) as HTMLElement;
		text.textContent = loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading Cards'));
		const help = doc.createElement('button');
		help.type = 'button';
		help.className = 'gdl-trading-cards-help-btn';
		help.innerHTML = '<span aria-hidden="true">?</span>';
		help.setAttribute('aria-label', gdlText('trading_cards', 'Trading Cards'));
		const headingChildren = Array.from(heading.children) as HTMLElement[];
		const textRoot = headingChildren.find(child => child === text || child.contains(text)) || null;
		if (textRoot && textRoot !== text) {
			for (const child of Array.from(textRoot.children)) {
				if (child !== text && !child.contains(text)) child.remove();
			}
		}
		(textRoot || heading).appendChild(help);
		setupTradingCardsHelpTooltip(doc, help);
		for (const child of headingChildren) {
			if (child === textRoot) continue;
			child.style.display = 'none';
		}
	}

	if (!order.publish(section, 'cards')) { removeTradingCardSection(section); return; }
	binding.section = section;

	setupTradingCardTilt(section);
	installResponsiveTradingCardGrid(section, layout);
	for (const image of Array.from(section.querySelectorAll<HTMLImageElement>('.gdl-trading-card img'))) {
		const failed = () => image.closest('.gdl-trading-card')?.classList.add('gdl-card-image-failed');
		image.addEventListener('error', failed, { once: true });
		if (image.complete && !image.naturalWidth) failed();
	}
	backendLog(`Official Steam cards applied for ${steamAppId}: ${catalog.cards.length} card(s), foil=${String(!!catalog.foil_badge)}`);
}
