export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export interface SpatialTarget {
	element: HTMLElement;
	rect: DOMRect;
	centerX: number;
	centerY: number;
}

export const BIG_PICTURE_FOCUSABLE_SELECTOR = [
	'[focusable]:not([focusable="false"])',
	'[data-focusable]:not([data-focusable="false"])',
	'[class*="Focusable"]:not([focusable="false"])',
	'[role="button"]', '[role="link"]', '[role="gridcell"]', '[role="tab"]',
	'[role="menuitem"]', '[role="checkbox"]', 'button', 'a[href]',
	'input:not([type="hidden"])', 'textarea', 'select', '[tabindex]:not([tabindex="-1"])',
	'[class*="CarouselItem"]', '[class*="CommunityItem"]', '[class*="Thumbnail"]',
	'[class*="PostTextEntryArea"]', '[class*="FriendSectionItem"]',
	'[class*="Card"][class*="Clickable"]', '[class*="Anchor"]', '[class*="PartnerEvent"]',
	'.gdl-bp-friend-card', '.gdl-bp-post-entry-bar', '.gdl-bp-trading-card',
	'.gdl-bp-badge-action', '.gdl-bp-view-all-achievements', '.gdl-bp-community-item',
].join(', ');

function isLeafFocusable(element: HTMLElement): boolean {
	return element.matches(
		'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="gridcell"], [role="menuitem"], [role="checkbox"]'
	) || element.getAttribute('focusable') === 'true' || element.getAttribute('data-focusable') === 'true';
}

export function collectFocusableLayout(root: HTMLElement): SpatialTarget[] {
	if (!root?.isConnected) return [];
	const view = root.ownerDocument.defaultView;
	const candidates: SpatialTarget[] = [];
	for (const element of Array.from(root.querySelectorAll<HTMLElement>(BIG_PICTURE_FOCUSABLE_SELECTOR))) {
		if (element.hidden || element.getAttribute('aria-hidden') === 'true') continue;
		if (element.getAttribute('focusable') === 'false' || element.getAttribute('data-focusable') === 'false') continue;
		if (element.id === 'gdl-bp-detail-root' || element.id === 'gdl-bp-detail-shell' || element.id === 'gdl-bp-focus-ring-root' || element.id === 'gdl-bp-focus-ring') continue;
		if (element.hasAttribute('flow-children') && element.querySelector(BIG_PICTURE_FOCUSABLE_SELECTOR)) continue;
		const style = view?.getComputedStyle(element);
		if (style?.display === 'none' || style?.visibility === 'hidden') continue;
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) continue;
		candidates.push({ element, rect, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 });
	}

	// Prefer the actual interactive descendant over wrapper Focusables without
	// the previous O(n²) contains()/some() pass.
	const candidateElements = new Set(candidates.map(candidate => candidate.element));
	const ancestorsToDrop = new Set<HTMLElement>();
	for (const candidate of candidates) {
		if (!isLeafFocusable(candidate.element)) continue;
		let parent = candidate.element.parentElement;
		while (parent && parent !== root) {
			if (candidateElements.has(parent)) ancestorsToDrop.add(parent);
			parent = parent.parentElement;
		}
	}
	return candidates.filter(candidate => !ancestorsToDrop.has(candidate.element));
}

export function firstSpatialTarget(layout: SpatialTarget[]): HTMLElement | null {
	if (!layout.length) return null;
	let best = layout[0];
	for (let index = 1; index < layout.length; index += 1) {
		const candidate = layout[index];
		if (candidate.rect.top < best.rect.top - 6
			|| (Math.abs(candidate.rect.top - best.rect.top) <= 6 && candidate.rect.left < best.rect.left)) {
			best = candidate;
		}
	}
	return best.element;
}

function axisOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
	return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function chooseSpatialTarget(
	layout: SpatialTarget[],
	current: HTMLElement,
	direction: SpatialDirection,
): HTMLElement | null {
	if (!layout.length || !current?.isConnected) return null;
	const known = layout.find(candidate => candidate.element === current);
	const currentRect = known?.rect || current.getBoundingClientRect();
	if (currentRect.width <= 0 || currentRect.height <= 0) return null;
	const currentCenterX = currentRect.left + currentRect.width / 2;
	const currentCenterY = currentRect.top + currentRect.height / 2;
	const horizontal = direction === 'left' || direction === 'right';
	const forward = direction === 'right' || direction === 'down';
	const directional: Array<{ target: SpatialTarget; score: number; aligned: boolean }> = [];

	for (const candidate of layout) {
		if (candidate.element === current) continue;
		const rect = candidate.rect;
		const mainDelta = horizontal
			? (candidate.centerX - currentCenterX)
			: (candidate.centerY - currentCenterY);
		const sameAxisThreshold = Math.max(10, Math.min(
			horizontal ? currentRect.width : currentRect.height,
			horizontal ? rect.width : rect.height,
		) * 0.18);
		if (forward ? mainDelta <= sameAxisThreshold : mainDelta >= -sameAxisThreshold) continue;

		const primaryGap = horizontal
			? (forward ? Math.max(0, rect.left - currentRect.right) : Math.max(0, currentRect.left - rect.right))
			: (forward ? Math.max(0, rect.top - currentRect.bottom) : Math.max(0, currentRect.top - rect.bottom));
		const crossDelta = horizontal
			? Math.abs(candidate.centerY - currentCenterY)
			: Math.abs(candidate.centerX - currentCenterX);
		const overlap = horizontal
			? axisOverlap(currentRect.top, currentRect.bottom, rect.top, rect.bottom)
			: axisOverlap(currentRect.left, currentRect.right, rect.left, rect.right);
		const crossExtent = horizontal
			? Math.max(currentRect.height, rect.height)
			: Math.max(currentRect.width, rect.width);
		const aligned = overlap > 0 || crossDelta <= crossExtent * 0.55;
		const crossPenalty = aligned ? crossDelta * 0.55 : crossDelta * 2.2 + 180;
		const overlapBonus = overlap > 0 ? Math.min(overlap, crossExtent) * 0.5 : 0;
		const score = primaryGap * 12 + Math.abs(mainDelta) * 0.8 + crossPenalty - overlapBonus;
		directional.push({ target: candidate, score, aligned });
	}

	if (!directional.length) return null;
	// If a target exists in the same visual row/column, never jump diagonally to
	// another row just because its bounding boxes happen to be a few pixels
	// closer. Only use diagonal candidates to escape a real dead end.
	const aligned = directional.filter(candidate => candidate.aligned);
	const pool = aligned.length ? aligned : directional;
	pool.sort((a, b) => a.score - b.score);
	return pool[0]?.target.element || null;
}
