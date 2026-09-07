import type { BigPictureTab as BigPicturePanelTab } from './types';
import { resolveNativeAppDetailsClasses, FALLBACK_FOCUS_RING_CLASSES } from '../../steam/gamepad/components/AppDetailsNativeClasses';

export function isNonSteamActive(doc: Document | null): boolean {
	if (!doc) return false;
	const root = doc.getElementById('gdl-bp-detail-root');
	return Boolean(root && root.isConnected);
}

const FOCUSABLE_SELECTOR = '[focusable]:not([focusable="false"]), [data-focusable]:not([data-focusable="false"]), [class*="Focusable"]:not([focusable="false"]), [role="button"], [role="link"], [role="gridcell"], [role="tab"], [role="menuitem"], [role="checkbox"], button, a[href], input:not([type="hidden"]), textarea, select, [tabindex]:not([tabindex="-1"]), [class*="CarouselItem"], [class*="CommunityItem"], [class*="Thumbnail"], [class*="PostTextEntryArea"], [class*="FriendSectionItem"], [class*="Card"][class*="Clickable"], [class*="Anchor"], [class*="PartnerEvent"], .gdl-bp-friend-card, .gdl-bp-post-entry-bar';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
	if (!root || !root.isConnected) return [];
	const raw = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => {
		if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
		if (el.getAttribute('focusable') === 'false' || el.getAttribute('data-focusable') === 'false') return false;
		if (el.id === 'gdl-bp-detail-root' || el.id === 'gdl-bp-detail-shell' || el.id === 'gdl-bp-focus-ring-root' || el.id === 'gdl-bp-focus-ring') return false;
		if (el.hasAttribute('flow-children') && el.querySelector(FOCUSABLE_SELECTOR)) return false;
		const style = el.ownerDocument.defaultView?.getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		return style?.display !== 'none' && style?.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
	});
	return raw.filter(el => !raw.some(other => other !== el && el.contains(other)));
}

interface DocNavState {
	lastNavTime: number;
	lastTabSwitchTime: number;
	lastFocusedElement: HTMLElement | null;
}

const docNavStates = new WeakMap<Document, DocNavState>();

function getDocNavState(doc: Document): DocNavState {
	let state = docNavStates.get(doc);
	if (!state) {
		state = { lastNavTime: 0, lastTabSwitchTime: 0, lastFocusedElement: null };
		docNavStates.set(doc, state);
	}
	return state;
}

const TAB_ORDER: BigPicturePanelTab[] = ['activity', 'stuff', 'community', 'info'];

function playSteamNavSound(soundId: number): void {
	try {
		const win = typeof window !== 'undefined' ? (window as any) : null;
		const steamClient = win?.SteamClient;
		if (typeof steamClient?.Sounds?.PlaySoundEffect === 'function') {
			steamClient.Sounds.PlaySoundEffect(soundId);
		} else if (typeof steamClient?.Sounds?.PlaySound === 'function') {
			steamClient.Sounds.PlaySound(soundId);
		}
	} catch {}
}

interface NavInstance {
	doc: Document;
	root: HTMLElement;
	strip: HTMLElement;
	controls: Map<BigPicturePanelTab, HTMLElement>;
	cleanup: () => void;
}

const activeNavInstances = new WeakMap<Document, NavInstance>();

export function disposeBigPictureGamepadNavigation(doc: Document | null): void {
	if (!doc) return;
	doc.getElementById('gdl-bp-focus-ring-root')?.remove();
	doc.getElementById('gdl-bp-focus-ring')?.remove();
	const inst = activeNavInstances.get(doc);
	if (inst) {
		inst.cleanup();
		activeNavInstances.delete(doc);
	}
}

export function installBigPictureGamepadNavigation(
	doc: Document,
	root: HTMLElement,
	strip: HTMLElement,
	controls: Map<BigPicturePanelTab, HTMLElement>,
): void {
	const existing = activeNavInstances.get(doc);
	if (existing && existing.root === root) {
		existing.strip = strip;
		existing.controls = controls;
		return;
	}

	if (existing) {
		existing.cleanup();
		activeNavInstances.delete(doc);
	}

	const win = doc.defaultView || window;

	let activeFocusRingEl: HTMLElement | null = null;
	let activeFocusRingRoot: HTMLElement | null = null;
	let focusRingRaf: number | null = null;
	let currentRingTarget: HTMLElement | null = null;

	const updateFocusRingPosition = (target: HTMLElement, ring: HTMLElement, ringRoot: HTMLElement): void => {
		if (!target.isConnected || !ring.isConnected || !ringRoot.isConnected) {
			hideFocusRing();
			return;
		}
		const targetRect = target.getBoundingClientRect();
		if (targetRect.width === 0 && targetRect.height === 0) {
			ring.style.display = 'none';
			return;
		}
		ring.style.display = '';

		const rootRect = ringRoot.getBoundingClientRect();
		const left = targetRect.left - rootRect.left;
		const top = targetRect.top - rootRect.top;
		const width = targetRect.width;
		const height = targetRect.height;
		ring.style.left = `${left}px`;
		ring.style.top = `${top}px`;
		ring.style.width = `${width}px`;
		ring.style.height = `${height}px`;

		const computed = doc.defaultView?.getComputedStyle(target);
		const parentComp = (!computed?.borderTopLeftRadius || computed.borderTopLeftRadius === '0px') && target.parentElement
			? doc.defaultView?.getComputedStyle(target.parentElement)
			: null;
		const styleSource = (parentComp && parentComp.borderTopLeftRadius !== '0px') ? parentComp : computed;
		if (styleSource) {
			ring.style.borderRadius = `${styleSource.borderTopLeftRadius || '0px'} ${styleSource.borderTopRightRadius || '0px'} ${styleSource.borderBottomRightRadius || '0px'} ${styleSource.borderBottomLeftRadius || '0px'}`;
		}
	};

	const hideFocusRing = (): void => {
		if (focusRingRaf != null) {
			cancelAnimationFrame(focusRingRaf);
			focusRingRaf = null;
		}
		currentRingTarget = null;
		if (activeFocusRingEl) {
			activeFocusRingEl.remove();
			activeFocusRingEl = null;
		}
	};

	const showFocusRing = (target: HTMLElement): void => {
		if (!target || !target.isConnected || !isNonSteamActive(doc)) {
			hideFocusRing();
			return;
		}
		const isSameTarget = (currentRingTarget === target && activeFocusRingEl && activeFocusRingEl.isConnected);
		currentRingTarget = target;
		const focusClasses = resolveNativeAppDetailsClasses().FocusRing || FALLBACK_FOCUS_RING_CLASSES;

		if (!activeFocusRingRoot || !activeFocusRingRoot.isConnected) {
			activeFocusRingRoot = doc.getElementById('gdl-bp-focus-ring-root') || doc.createElement('div');
			activeFocusRingRoot.id = 'gdl-bp-focus-ring-root';
			activeFocusRingRoot.className = focusClasses.FocusRingRoot;
			activeFocusRingRoot.style.zIndex = '99999';
			if (activeFocusRingRoot.parentElement !== doc.body) doc.body.appendChild(activeFocusRingRoot);
		}

		if (focusRingRaf != null) {
			cancelAnimationFrame(focusRingRaf);
			focusRingRaf = null;
		}

		if (!isSameTarget) {
			if (activeFocusRingEl) {
				activeFocusRingEl.remove();
				activeFocusRingEl = null;
			}

			activeFocusRingEl = doc.createElement('div');
			activeFocusRingEl.id = 'gdl-bp-focus-ring';
			activeFocusRingEl.className = focusClasses.FocusRing;
			activeFocusRingEl.style.pointerEvents = 'none';
			activeFocusRingRoot.appendChild(activeFocusRingEl);
		}

		if (activeFocusRingEl) {
			updateFocusRingPosition(target, activeFocusRingEl, activeFocusRingRoot);
		}

		const start = performance.now();
		const follow = () => {
			if (!activeFocusRingEl || !activeFocusRingRoot || currentRingTarget !== target) return;
			updateFocusRingPosition(target, activeFocusRingEl, activeFocusRingRoot);
			if (performance.now() - start < 500) {
				focusRingRaf = requestAnimationFrame(follow);
			} else {
				focusRingRaf = null;
			}
		};
		focusRingRaf = requestAnimationFrame(follow);
	};

	const getActiveTab = (): HTMLElement | null => {
		const selected = strip.querySelector<HTMLElement>('[aria-selected="true"], [class*="Selected"], [class*="active"]')
			|| strip.querySelector<HTMLElement>('[tabindex="0"]')
			|| Array.from(controls.values())[0]
			|| null;
		return selected;
	};

	const getCurrentTabKey = (): BigPicturePanelTab => {
		for (const [key, el] of controls.entries()) {
			if (el.getAttribute('aria-selected') === 'true' || el.classList.contains('gpfocus')) return key;
		}
		for (const [key, el] of controls.entries()) {
			if (el.matches('.active, .selected, [class*="Active"], [class*="Selected"]')) return key;
		}
		return 'activity';
	};

	const NAV_COOLDOWN_MS = 180;
	const TAB_SWITCH_COOLDOWN_MS = 350;

	const switchTabByOffset = (offset: number): boolean => {
		if (!isNonSteamActive(doc)) return false;
		const now = Date.now();
		const navState = getDocNavState(doc);
		if (now - navState.lastTabSwitchTime < TAB_SWITCH_COOLDOWN_MS) {
			return false;
		}

		const currentKey = getCurrentTabKey();
		const currentIdx = TAB_ORDER.indexOf(currentKey);
		const startIdx = currentIdx === -1 ? 0 : currentIdx;
		const nextIdx = Math.max(0, Math.min(TAB_ORDER.length - 1, startIdx + offset));
		if (nextIdx === startIdx) {
			return false;
		}

		navState.lastTabSwitchTime = now;
		navState.lastNavTime = now;
		navState.lastFocusedElement = null;
		hideFocusRing();

		const nextKey = TAB_ORDER[nextIdx];
		const targetControl = controls.get(nextKey);
		if (targetControl && targetControl.isConnected) {
			for (const c of controls.values()) {
				c.classList.remove('gpfocus');
				delete c.dataset.focus;
			}
			targetControl.classList.add('gpfocus');
			targetControl.dataset.focus = 'true';
			targetControl.click();
			return true;
		}
		return false;
	};

	const getActiveModal = (): HTMLElement | null => {
		const modal = doc.getElementById('gdl-bp-achievements-screen')
			|| doc.getElementById('gdl-bp-card-modal')
			|| doc.getElementById('gdl-bp-news-modal')
			|| doc.getElementById('gdl-bp-community-modal');
		return (modal && modal.isConnected) ? modal : null;
	};

	const isInsidePlaybar = (): boolean => {
		const active = doc.activeElement as HTMLElement | null;
		if (active && active.closest('[class*="PlayBar"], [class*="playbar"], [class*="PlayButton"], [class*="Header"], [class*="AppButtonsContainer"]')) {
			if (strip && (strip === active || strip.contains(active))) return false;
			if (root && (root === active || root.contains(active))) return false;
			return true;
		}
		const playBtn = doc.querySelector<HTMLElement>('[class*="PlayButton"], button[class*="Play"], .PlayButton');
		return Boolean(playBtn && (playBtn === active || playBtn.contains(active) || playBtn.matches(':focus, :focus-visible, .gpfocus, [data-focus="true"]')));
	};

	const isInsidePanel = (): boolean => {
		const active = doc.activeElement as HTMLElement | null;
		if (active && (root === active || root.contains(active))) return true;
		const marked = root.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
		if (marked && marked.isConnected && (!active || (!strip.contains(active) && !isInsidePlaybar()))) return true;
		const lastFocused = getDocNavState(doc).lastFocusedElement;
		return Boolean(lastFocused && lastFocused.isConnected && root.contains(lastFocused) && (!active || (!strip.contains(active) && !isInsidePlaybar())));
	};

	const isTabStripFocused = (): boolean => {
		const active = doc.activeElement as HTMLElement | null;
		if (active && (strip === active || strip.contains(active))) return true;
		for (const el of controls.values()) {
			if (el === active || el.contains(active)) return true;
		}
		if (strip.matches(':focus-within')) return true;
		if (strip.querySelector(':focus, :focus-visible, .gpfocus, [data-focus="true"]')) return true;
		for (const el of controls.values()) {
			if (el.matches(':focus, :focus-visible, .gpfocus, [data-focus="true"]')) return true;
		}
		if (active && (root === active || root.contains(active))) return false;
		const marked = root.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
		if (marked && marked.isConnected) return false;
		return false;
	};

	const clearStripFocus = (): void => {
		strip.querySelectorAll<HTMLElement>('.gpfocus').forEach(el => { el.classList.remove('gpfocus'); delete el.dataset.focus; });
		for (const c of controls.values()) { c.classList.remove('gpfocus'); delete c.dataset.focus; }
	};

	const setFocusedElement = (target: HTMLElement | null, scope: HTMLElement = root): void => {
		if (!target || !target.isConnected || !isNonSteamActive(doc)) return;
		if (scope === root) getDocNavState(doc).lastFocusedElement = target;
		try {
			playSteamNavSound(1);
			doc.querySelectorAll<HTMLElement>('.gpfocus').forEach(el => {
				if (el !== target) {
					el.classList.remove('gpfocus');
					delete el.dataset.focus;
				}
			});
			if (!target.hasAttribute('tabindex')) {
				target.setAttribute('tabindex', '0');
			}
			target.classList.add('gpfocus');
			target.dataset.focus = 'true';
			target.focus({ preventScroll: true });
			target.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });

			showFocusRing(target);

			const key = Object.keys(target).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
			if (key) {
				let curr = (target as any)[key];
				while (curr) {
					const node = curr.memoizedProps?.value || curr.memoizedState?.node;
					if (node && typeof node.BTakeFocus === 'function') {
						node.BTakeFocus();
						break;
					}
					curr = curr.return;
				}
			}
		} catch {}
	};

	const handleNavDirection = (direction: 'down' | 'up' | 'left' | 'right' | 'select' | 'back'): boolean => {
		if (!isNonSteamActive(doc)) return false;

		const modal = getActiveModal();
		const currentScope = modal || root;
		if (!currentScope.isConnected) return false;

		const focusables = getFocusableElements(currentScope);
		if (!focusables.length) {
			if (direction === 'back' && modal) {
				playSteamNavSound(4);
				const closeBtn = modal.querySelector<HTMLElement>('.gdl-bp-news-modal-close, .gdl-bp-ach-close-trigger, .gdl-bp-fullscreen-card-close-btn');
				if (closeBtn) closeBtn.click();
				else modal.remove();
				return true;
			}
			return false;
		}

		let current: HTMLElement | null = null;
		const marked = currentScope.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
		if (marked && marked.isConnected) {
			current = marked;
		} else {
			const active = doc.activeElement as HTMLElement | null;
			if (active && currentScope.contains(active)) {
				current = active;
			} else {
				const last = getDocNavState(doc).lastFocusedElement;
				if (last && last.isConnected && currentScope.contains(last)) {
					current = last;
				}
			}
		}

		if (direction === 'select') {
			if (current) {
				if (current instanceof HTMLInputElement) {
					current.focus();
					return true;
				}
				playSteamNavSound(3);
				current.click();
				try {
					current.dispatchEvent(new CustomEvent('activate', { bubbles: true, cancelable: true }));
				} catch {}
				return true;
			}
			return false;
		}

		if (direction === 'back') {
			playSteamNavSound(4);
			hideFocusRing();
			if (modal) {
				const closeBtn = modal.querySelector<HTMLElement>('.gdl-bp-news-modal-close, .gdl-bp-news-modal-close-btn, .gdl-bp-ach-close-trigger, .gdl-bp-fullscreen-card-close-btn');
				if (closeBtn) closeBtn.click();
				else modal.remove();
				return true;
			}

			if (current || isInsidePanel()) {
				if (current) {
					current.classList.remove('gpfocus');
					delete current.dataset.focus;
				}
				getDocNavState(doc).lastFocusedElement = null;
				const tab = getActiveTab();
				if (tab) {
					tab.focus();
					tab.classList.add('gpfocus');
					tab.dataset.focus = 'true';
					tab.scrollIntoView({ behavior: 'auto', block: 'nearest' });
				}
				return true;
			}
			return false;
		}

		if (direction === 'down') {
			// If focus is currently in play bar, move down to the active tab
			if (!modal && isInsidePlaybar()) {
				const tab = getActiveTab();
				if (tab) {
					tab.focus();
					tab.classList.add('gpfocus');
					tab.dataset.focus = 'true';
					tab.scrollIntoView({ behavior: 'auto', block: 'nearest' });
					return true;
				}
			}

			// If focus is currently on the tab strip, enter the panel at the first element
			if (!modal && isTabStripFocused()) {
				clearStripFocus();
				const target = focusables[0];
				if (target) {
					setFocusedElement(target, currentScope);
					return true;
				}
				return false;
			}

			if (!current) {
				const target = focusables[0];
				if (target) {
					setFocusedElement(target, currentScope);
					return true;
				}
				return false;
			}

			const currentRect = current.getBoundingClientRect();
			const candidates = focusables.filter(el => {
				if (el === current) return false;
				const r = el.getBoundingClientRect();
				return r.top >= currentRect.bottom - 8 || (r.top > currentRect.top + currentRect.height * 0.5 && r.bottom > currentRect.bottom + 8);
			});

			if (candidates.length > 0) {
				let minVert = Infinity;
				for (const el of candidates) {
					const r = el.getBoundingClientRect();
					const v = Math.max(0, r.top - currentRect.bottom);
					if (v < minVert) minVert = v;
				}

				const tier = candidates.filter(el => {
					const r = el.getBoundingClientRect();
					const v = Math.max(0, r.top - currentRect.bottom);
					return v <= minVert + 45;
				});

				let target: HTMLElement | null = null;
				let bestHoriz = Infinity;
				const currentCenterX = currentRect.left + currentRect.width / 2;
				for (const el of tier) {
					const r = el.getBoundingClientRect();
					const targetCenterX = r.left + r.width / 2;
					const overlap = Math.max(0, Math.min(currentRect.right, r.right) - Math.max(currentRect.left, r.left));
					const horiz = Math.abs(targetCenterX - currentCenterX) - (overlap > 0 ? 500 : 0);
					if (horiz < bestHoriz) {
						bestHoriz = horiz;
						target = el;
					}
				}

				if (target) {
					setFocusedElement(target, currentScope);
					return true;
				}
			}
			return false;
		}

		if (direction === 'up') {
			if (!modal && isTabStripFocused()) {
				// Move focus from tab strip back to play button
				const playBtn = doc.querySelector<HTMLElement>('[class*="PlayButton"], button[class*="Play"], .PlayButton');
				if (playBtn) {
					clearStripFocus();
					playBtn.focus();
					playBtn.classList.add('gpfocus');
					playBtn.dataset.focus = 'true';
					return true;
				}
				return false;
			}

			if (!current) {
				const last = getDocNavState(doc).lastFocusedElement;
				current = (last && last.isConnected && currentScope.contains(last)) ? last : null;
			}
			if (!current) return false;

			const currentRect = current.getBoundingClientRect();
			const candidates = focusables.filter(el => {
				if (el === current) return false;
				const r = el.getBoundingClientRect();
				return r.bottom <= currentRect.top + 8 || (r.bottom < currentRect.bottom - currentRect.height * 0.5 && r.top < currentRect.top - 8);
			});

			if (candidates.length > 0) {
				let minVert = Infinity;
				for (const el of candidates) {
					const r = el.getBoundingClientRect();
					const v = Math.max(0, currentRect.top - r.bottom);
					if (v < minVert) minVert = v;
				}

				const tier = candidates.filter(el => {
					const r = el.getBoundingClientRect();
					const v = Math.max(0, currentRect.top - r.bottom);
					return v <= minVert + 45;
				});

				let target: HTMLElement | null = null;
				let bestHoriz = Infinity;
				const currentCenterX = currentRect.left + currentRect.width / 2;
				for (const el of tier) {
					const r = el.getBoundingClientRect();
					const targetCenterX = r.left + r.width / 2;
					const overlap = Math.max(0, Math.min(currentRect.right, r.right) - Math.max(currentRect.left, r.left));
					const horiz = Math.abs(targetCenterX - currentCenterX) - (overlap > 0 ? 500 : 0);
					if (horiz < bestHoriz) {
						bestHoriz = horiz;
						target = el;
					}
				}

				if (target) {
					setFocusedElement(target, currentScope);
					return true;
				}
			} else if (!modal) {
				// At top edge of panel content: move focus cleanly up to the active tab in tab strip
				hideFocusRing();
				if (current) {
					current.classList.remove('gpfocus');
					delete current.dataset.focus;
				}
				getDocNavState(doc).lastFocusedElement = null;
				const tab = getActiveTab();
				if (tab) {
					playSteamNavSound(1);
					clearStripFocus();
					tab.classList.add('gpfocus');
					tab.dataset.focus = 'true';
					tab.focus();
					tab.scrollIntoView({ behavior: 'auto', block: 'nearest' });
					return true;
				}
				return false;
			}
			return false;
		}

		if (direction === 'right' || direction === 'left') {
			if (!current) return false;
			const cR = current.getBoundingClientRect();
			const cY = cR.top + cR.height / 2;
			const isRight = direction === 'right';
			const candidates = focusables.filter(el => {
				if (el === current) return false;
				const r = el.getBoundingClientRect();
				return isRight ? (r.left >= cR.left + 8 || r.left >= cR.right - 8) : (r.right <= cR.right - 8 || r.right <= cR.left + 8);
			});
			const sameRow = candidates.filter(el => {
				const r = el.getBoundingClientRect();
				const overlapY = Math.max(0, Math.min(cR.bottom, r.bottom) - Math.max(cR.top, r.top));
				return overlapY > 0 || Math.abs((r.top + r.height / 2) - cY) < 45;
			});
			let minH = Infinity, target: HTMLElement | null = null;
			for (const el of sameRow) {
				const r = el.getBoundingClientRect();
				const h = isRight ? (r.left - cR.left) : (cR.right - r.right);
				if (h > 0 && h < minH) { minH = h; target = el; }
			}
			if (target) { setFocusedElement(target, currentScope); return true; }
			return false;
		}

		return false;
	};

	const onGlobalKeyDown = (event: KeyboardEvent) => {
		if (!isNonSteamActive(doc)) return;

		const key = event.key;
		if (getActiveModal()) {
			if (key === 'PageUp' || key === 'PageDown' || key === 'q' || key === 'Q' || key === 'e' || key === 'E') {
				// Modal is open; protect modal context from background tab switching
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		} else if (!(doc.activeElement instanceof HTMLInputElement)) {
			if (key === 'q' || key === 'Q' || key === 'PageUp') {
				event.preventDefault();
				event.stopPropagation();
				switchTabByOffset(-1);
				return;
			} else if (key === 'e' || key === 'E' || key === 'PageDown') {
				event.preventDefault();
				event.stopPropagation();
				switchTabByOffset(1);
				return;
			}
		}

		let dir: 'down' | 'up' | 'left' | 'right' | 'select' | 'back' | null = null;
		if (key === 'ArrowDown' || key === 'Down' || event.keyCode === 40) dir = 'down';
		else if (key === 'ArrowUp' || key === 'Up' || event.keyCode === 38) dir = 'up';
		else if (key === 'ArrowLeft' || key === 'Left' || event.keyCode === 37) dir = 'left';
		else if (key === 'ArrowRight' || key === 'Right' || event.keyCode === 39) dir = 'right';
		else if (key === 'Enter' || key === ' ' || event.keyCode === 13) dir = 'select';
		else if (key === 'Escape' || key === 'Backspace' || event.keyCode === 27 || event.keyCode === 8) dir = 'back';
		else if (key === 'Tab') dir = event.shiftKey ? 'up' : 'down';

		if (!dir) return;

		// If user is inside an active text input typing, don't trap directional navigation
		if (doc.activeElement instanceof HTMLInputElement) {
			if (dir === 'down' || dir === 'up' || dir === 'right' || dir === 'back') {
				(doc.activeElement as HTMLElement).blur();
			} else if (dir === 'select') {
				return;
			}
		}

		if (!getActiveModal() && isTabStripFocused()) {
			if (dir === 'down') {
				// Leave tab strip, enter the content panel at the first element
				clearStripFocus();
				const focusables = getFocusableElements(root);
				if (focusables.length > 0) {
					event.preventDefault();
					event.stopPropagation();
					setFocusedElement(focusables[0], root);
					return;
				}
			} else if (dir === 'up') {
				// Move from tab strip back to play button
				const playBtn = doc.querySelector<HTMLElement>('[class*="PlayButton"], button[class*="Play"], .PlayButton');
				if (playBtn) {
					clearStripFocus();
					event.preventDefault();
					event.stopPropagation();
					playBtn.focus();
					playBtn.classList.add('gpfocus');
					playBtn.dataset.focus = 'true';
					return;
				}
			}
			// When tab strip has focus, Left/Right/Select/Back belong 100% to Steam's native tabstrip
			return;
		}

		const now = Date.now();
		const navState = getDocNavState(doc);
		if (now - navState.lastNavTime < NAV_COOLDOWN_MS) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		const handled = handleNavDirection(dir);
		if (handled) {
			navState.lastNavTime = now;
			event.preventDefault();
			event.stopPropagation();
		}
	};

	const onFocusIn = (event: FocusEvent) => {
		if (!isNonSteamActive(doc)) return;
		const target = event.target as HTMLElement | null;
		const modal = getActiveModal();
		if (target && (root.contains(target) || (modal && modal.contains(target)))) {
			getDocNavState(doc).lastFocusedElement = target;
			target.classList.add('gpfocus');
			target.dataset.focus = 'true';
			showFocusRing(target);
		} else if (target && (strip.contains(target) || isInsidePlaybar())) {
			hideFocusRing();
		}
	};

	const onFocusOut = (event: FocusEvent) => {
		if (!isNonSteamActive(doc)) {
			hideFocusRing();
			return;
		}
		const related = event.relatedTarget as HTMLElement | null;
		const modal = getActiveModal();
		const isStillInScope = related && (root.contains(related) || (modal && modal.contains(related)));
		if (isStillInScope) return;

		requestAnimationFrame(() => {
			if (!isNonSteamActive(doc)) {
				hideFocusRing();
				return;
			}
			const active = doc.activeElement as HTMLElement | null;
			const currentModal = getActiveModal();
			const activeInScope = active && (root.contains(active) || (currentModal && currentModal.contains(active)));
			if (!activeInScope && !strip.contains(active)) {
				const marked = root.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
				if (!marked) {
					hideFocusRing();
				}
			}
		});
	};

	// -------------------------------------------------------------
	// GAMEPAD POLLING (HTML5 Gamepad API)
	// Supports Xbox, PlayStation, Steam Deck & generic controllers
	// -------------------------------------------------------------
	let gamepadPollTimer: ReturnType<typeof setTimeout> | null = null;
	const prevBtn = new Map<number, boolean>();
	const lastDirTime = new Map<string, number>();
	const dirHoldTime = new Map<string, number>();

	const pollGamepads = () => {
		if (!root.isConnected || !doc.body?.isConnected || !isNonSteamActive(doc)) {
			if (gamepadPollTimer != null) { clearTimeout(gamepadPollTimer); gamepadPollTimer = null; }
			return;
		}
		const nav = win.navigator || window.navigator;
		const gamepads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : (typeof window.navigator?.getGamepads === 'function' ? window.navigator.getGamepads() : []);
		const gp = Array.from(gamepads).find(g => g && g.connected);

		if (gp) {
			const now = Date.now();
			const navState = getDocNavState(doc);

			const isUp = Boolean(gp.buttons[12]?.pressed || (gp.axes[1] != null && gp.axes[1] < -0.55));
			const isDown = Boolean(gp.buttons[13]?.pressed || (gp.axes[1] != null && gp.axes[1] > 0.55));
			const isLeft = Boolean(gp.buttons[14]?.pressed || (gp.axes[0] != null && gp.axes[0] < -0.55));
			const isRight = Boolean(gp.buttons[15]?.pressed || (gp.axes[0] != null && gp.axes[0] > 0.55));
			const dirs: Array<[string, boolean, 'up' | 'down' | 'left' | 'right']> = [
				['up', isUp, 'up'], ['down', isDown, 'down'], ['left', isLeft, 'left'], ['right', isRight, 'right'],
			];

			for (const [name, active, dir] of dirs) {
				if (active) {
					const hold = dirHoldTime.get(name) || 0;
					const last = lastDirTime.get(name) || 0;
					if (!hold) {
						dirHoldTime.set(name, now);
						if (now - navState.lastNavTime >= NAV_COOLDOWN_MS) {
							lastDirTime.set(name, now);
							navState.lastNavTime = now;
							handleNavDirection(dir);
						}
					} else if (now - hold > 320 && now - last > 140) {
						lastDirTime.set(name, now);
						navState.lastNavTime = now;
						handleNavDirection(dir);
					}
				} else {
					dirHoldTime.delete(name);
					lastDirTime.delete(name);
				}
			}

			const btnA = Boolean(gp.buttons[0]?.pressed);
			if (btnA && !prevBtn.get(0) && now - navState.lastNavTime >= NAV_COOLDOWN_MS) {
				navState.lastNavTime = now;
				handleNavDirection('select');
			}
			prevBtn.set(0, btnA);

			const btnB = Boolean(gp.buttons[1]?.pressed);
			if (btnB && !prevBtn.get(1) && now - navState.lastNavTime >= NAV_COOLDOWN_MS) {
				navState.lastNavTime = now;
				handleNavDirection('back');
			}
			prevBtn.set(1, btnB);

			const btnLB = Boolean(gp.buttons[4]?.pressed);
			if (btnLB && !prevBtn.get(4) && !getActiveModal()) switchTabByOffset(-1);
			prevBtn.set(4, btnLB);

			const btnRB = Boolean(gp.buttons[5]?.pressed);
			if (btnRB && !prevBtn.get(5) && !getActiveModal()) switchTabByOffset(1);
			prevBtn.set(5, btnRB);

			const rY = gp.axes[3];
			if (rY != null && Math.abs(rY) > 0.25) {
				const modal = getActiveModal();
				const target = modal ? (modal.querySelector('.gdl-bp-news-modal-window, .gdl-bp-ach-screen-list') || modal) : (doc.scrollingElement || doc.documentElement);
				target?.scrollBy({ top: rY * 16, behavior: 'auto' });
			}
		}

		gamepadPollTimer = setTimeout(pollGamepads, 20);
	};

	const onScrollOrResize = () => {
		if (!isNonSteamActive(doc)) return;
		if (activeFocusRingEl && activeFocusRingRoot && currentRingTarget && currentRingTarget.isConnected) {
			updateFocusRingPosition(currentRingTarget, activeFocusRingEl, activeFocusRingRoot);
		}
	};

	// Register only on doc to prevent duplicate capture-phase executions
	doc.addEventListener('keydown', onGlobalKeyDown, true);
	doc.addEventListener('focusin', onFocusIn, true);
	doc.addEventListener('focusout', onFocusOut, true);
	win.addEventListener('scroll', onScrollOrResize, true);
	doc.addEventListener('scroll', onScrollOrResize, true);
	win.addEventListener('resize', onScrollOrResize, true);

	gamepadPollTimer = setTimeout(pollGamepads, 50);

	activeNavInstances.set(doc, {
		doc,
		root,
		strip,
		controls,
		cleanup: () => {
			if (gamepadPollTimer != null) {
				clearTimeout(gamepadPollTimer);
				gamepadPollTimer = null;
			}
			hideFocusRing();
			if (activeFocusRingRoot) {
				activeFocusRingRoot.remove();
				activeFocusRingRoot = null;
			}
			doc.removeEventListener('keydown', onGlobalKeyDown, true);
			doc.removeEventListener('focusin', onFocusIn, true);
			doc.removeEventListener('focusout', onFocusOut, true);
			win.removeEventListener('scroll', onScrollOrResize, true);
			doc.removeEventListener('scroll', onScrollOrResize, true);
			win.removeEventListener('resize', onScrollOrResize, true);
			getDocNavState(doc).lastFocusedElement = null;
		},
	});
}

