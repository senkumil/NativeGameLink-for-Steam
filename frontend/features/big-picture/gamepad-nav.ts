import type { BigPictureTab as BigPicturePanelTab } from './types';
import { resolveNativeAppDetailsClasses, FALLBACK_FOCUS_RING_CLASSES } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { EXIT_TEXT_EDITOR_EVENT, isEditableTextTarget } from './editable-target';
import { collectFocusableLayout, chooseSpatialTarget, firstSpatialTarget } from './spatial-navigation';

export function isNonSteamActive(doc: Document | null): boolean {
	if (!doc) return false;
	const root = doc.getElementById('gdl-bp-detail-root');
	return Boolean(root && root.isConnected);
}

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
	return collectFocusableLayout(root).map(candidate => candidate.element);
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
		const sc = (typeof window !== 'undefined' ? (window as any) : null)?.SteamClient?.Sounds;
		if (typeof sc?.PlaySoundEffect === 'function') sc.PlaySoundEffect(soundId);
		else if (typeof sc?.PlaySound === 'function') sc.PlaySound(soundId);
	} catch {}
}

interface NavInstance {
	doc: Document;
	root: HTMLElement;
	strip: HTMLElement;
	controls: Map<BigPicturePanelTab, HTMLElement>;
	hideRing: () => void;
	cleanup: () => void;
}

const activeNavInstances = new WeakMap<Document, NavInstance>();

export function dismissBigPictureFocusRing(doc: Document | null): void {
	if (!doc) return;
	const ring = doc.getElementById('gdl-bp-focus-ring');
	if (ring) ring.remove();
	const root = doc.getElementById('gdl-bp-focus-ring-root');
	if (root) {
		root.style.display = 'none';
		root.innerHTML = '';
	}
	activeNavInstances.get(doc)?.hideRing();
}

export function disposeBigPictureGamepadNavigation(doc: Document | null): void {
	if (!doc) return;
	dismissBigPictureFocusRing(doc);
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
	let currentRingTarget: HTMLElement | null = null;

	const getActiveModal = (): HTMLElement | null => {
		const modal = doc.getElementById('gdl-bp-achievements-screen')
			|| doc.getElementById('gdl-bp-card-modal')
			|| doc.getElementById('gdl-bp-news-modal')
			|| doc.getElementById('gdl-bp-community-modal')
			|| doc.querySelector<HTMLElement>('[role="dialog"], [class*="ModalPosition"], [class*="ModalOverlay"], [class*="DialogModal"], .ModalPosition_Content');
		if (!modal || !modal.isConnected || modal.style.display === 'none' || modal.getAttribute('aria-hidden') === 'true') return null;
		return modal;
	};

	const hideFocusRing = (): void => {
		currentRingTarget = null;
		if (activeFocusRingEl) {
			activeFocusRingEl.remove();
			activeFocusRingEl = null;
		}
		if (activeFocusRingRoot) {
			activeFocusRingRoot.style.display = 'none';
			activeFocusRingRoot.innerHTML = '';
		}
	};

	const updateFocusRingPosition = (target: HTMLElement, ring: HTMLElement, ringRoot: HTMLElement): void => {
		if (!target.isConnected || !ring.isConnected || !ringRoot.isConnected || getActiveModal()) {
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

	const showFocusRing = (target: HTMLElement): void => {
		if (!target || !target.isConnected || target.dataset.gdlSuppressFocusRing === '1' || !isNonSteamActive(doc) || getActiveModal() || isEditableTextTarget(target)) {
			hideFocusRing();
			return;
		}
		const isSameTarget = currentRingTarget === target && activeFocusRingEl?.isConnected;
		currentRingTarget = target;
		const focusClasses = resolveNativeAppDetailsClasses(doc).FocusRing || FALLBACK_FOCUS_RING_CLASSES;

		if (!activeFocusRingRoot || !activeFocusRingRoot.isConnected) {
			activeFocusRingRoot = doc.getElementById('gdl-bp-focus-ring-root') || doc.createElement('div');
			activeFocusRingRoot.id = 'gdl-bp-focus-ring-root';
			activeFocusRingRoot.className = focusClasses.FocusRingRoot;
			activeFocusRingRoot.style.zIndex = '50';
			if (activeFocusRingRoot.parentElement !== doc.body) doc.body.appendChild(activeFocusRingRoot);
		}
		activeFocusRingRoot.style.display = '';

		if (!isSameTarget) {
			activeFocusRingEl?.remove();
			activeFocusRingEl = doc.createElement('div');
			activeFocusRingEl.id = 'gdl-bp-focus-ring';
			activeFocusRingEl.className = focusClasses.FocusRing;
			activeFocusRingEl.style.pointerEvents = 'none';
			activeFocusRingRoot.appendChild(activeFocusRingEl);
		}
		if (activeFocusRingEl) updateFocusRingPosition(target, activeFocusRingEl, activeFocusRingRoot);
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

	const NAV_COOLDOWN_MS = 140;
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
			scope.querySelectorAll<HTMLElement>('.gpfocus').forEach(el => {
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

			// DOM focus is normally enough because injected controls use Steam's
			// Focusable. Only ask the native nav node to take focus when the DOM
			// focus did not stick; calling both on every move can double-advance.
			if (doc.activeElement !== target && !target.contains(doc.activeElement)) {
				const key = Object.keys(target).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
				if (key) {
					let curr = (target as any)[key];
					while (curr) {
						const node = curr.memoizedProps?.value || curr.memoizedState?.node;
						if (node && typeof node.BTakeFocus === 'function') { node.BTakeFocus(); break; }
						curr = curr.return;
					}
				}
			}
		} catch {}
	};

	const handleNavDirection = (direction: 'down' | 'up' | 'left' | 'right' | 'select' | 'back'): boolean => {
		if (!isNonSteamActive(doc)) return false;

		const modal = getActiveModal();
		if (modal && !modal.id?.startsWith('gdl-bp-')) {
			hideFocusRing();
			if (direction === 'back') {
				playSteamNavSound(4);
				const closeBtn = modal.querySelector<HTMLElement>('button[class*="Close"], button[class*="DialogButton"], [role="button"], [aria-label="Close"]');
				if (closeBtn) {
					closeBtn.click();
					return true;
				}
			}
			return false;
		}

		const currentScope = modal || root;
		if (!currentScope.isConnected) return false;

		if (!modal && isTabStripFocused()) {
			if (direction === 'down') {
				clearStripFocus();
				const target = firstSpatialTarget(collectFocusableLayout(root));
				if (target) { setFocusedElement(target, root); return true; }
			}
			if (direction === 'up') {
				const playBtn = doc.querySelector<HTMLElement>('[class*="PlayButton"], button[class*="Play"], .PlayButton');
				if (playBtn) { clearStripFocus(); playBtn.focus(); return true; }
			}
			return false;
		}
		if (!modal && isInsidePlaybar() && direction !== 'down') return false;

		const layout = collectFocusableLayout(currentScope);
		const focusables = layout.map(candidate => candidate.element);
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
		// The real DOM focus is authoritative. Steam can move focus itself and
		// leave an older gpfocus class behind for a frame; consulting that stale
		// marker first makes the next move start from the wrong card/row.
		const active = doc.activeElement as HTMLElement | null;
		if (active && active !== doc.body && currentScope.contains(active)) {
			current = active;
		} else {
			const ownedMarker = currentScope.querySelector<HTMLElement>('[data-focus="true"]');
			const nativeMarker = currentScope.querySelector<HTMLElement>('.gpfocus');
			const marked = ownedMarker || nativeMarker;
			if (marked && marked.isConnected) current = marked;
			else {
				const last = getDocNavState(doc).lastFocusedElement;
				if (last && last.isConnected && currentScope.contains(last)) current = last;
			}
		}

		if (direction === 'select') {
			if (current) {
				if (isEditableTextTarget(current)) {
					current.focus();
					return true;
				}
				playSteamNavSound(3);
				current.click();
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
			if (!modal && isInsidePlaybar()) {
				const tab = getActiveTab();
				if (tab) { tab.focus(); tab.classList.add('gpfocus'); tab.dataset.focus = 'true'; return true; }
			}
			if (!modal && isTabStripFocused()) {
				clearStripFocus();
				const target = firstSpatialTarget(layout);
				if (target) { setFocusedElement(target, currentScope); return true; }
				return false;
			}
			if (!current) {
				const target = firstSpatialTarget(layout);
				if (target) { setFocusedElement(target, currentScope); return true; }
				return false;
			}
			const target = chooseSpatialTarget(layout, current, 'down');
			if (target) { setFocusedElement(target, currentScope); return true; }
			return false;
		}

		if (direction === 'up') {
			if (!modal && isTabStripFocused()) {
				const playBtn = doc.querySelector<HTMLElement>('[class*="PlayButton"], button[class*="Play"], .PlayButton');
				if (playBtn) { clearStripFocus(); playBtn.focus(); playBtn.classList.add('gpfocus'); playBtn.dataset.focus = 'true'; return true; }
				return false;
			}
			if (!current) {
				const last = getDocNavState(doc).lastFocusedElement;
				current = last && last.isConnected && currentScope.contains(last) ? last : null;
			}
			if (!current) return false;
			const target = chooseSpatialTarget(layout, current, 'up');
			if (target) { setFocusedElement(target, currentScope); return true; }
			if (!modal) {
				hideFocusRing();
				current.classList.remove('gpfocus');
				delete current.dataset.focus;
				getDocNavState(doc).lastFocusedElement = null;
				const tab = getActiveTab();
				if (tab) {
					playSteamNavSound(1); clearStripFocus(); tab.classList.add('gpfocus'); tab.dataset.focus = 'true'; tab.focus();
					tab.scrollIntoView({ behavior: 'auto', block: 'nearest' });
					return true;
				}
			}
			return false;
		}

		if (direction === 'right' || direction === 'left') {
			if (!current) return false;
			const target = chooseSpatialTarget(layout, current, direction);
			if (target) { setFocusedElement(target, currentScope); return true; }
			return false;
		}

		return false;
	};

	let pollNavigationSuppressedUntil = 0;

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
		} else if (!isEditableTextTarget(doc.activeElement)) {
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
		pollNavigationSuppressedUntil = Date.now() + 500;

		// Native GamepadUI owns navigation while a text editor is active.
		if (isEditableTextTarget(doc.activeElement)) return;

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
			lastDirTime.set(dir, now);
			dirHoldTime.set(dir, now);
			event.preventDefault();
			event.stopPropagation();
		}
	};

	const onFocusIn = (event: FocusEvent) => {
		if (!isNonSteamActive(doc)) return;
		const target = event.target as HTMLElement | null;
		const modal = getActiveModal();
		if (modal && !modal.id?.startsWith('gdl-bp-')) {
			hideFocusRing();
			return;
		}
		if (target && (root.contains(target) || (modal && modal.contains(target)))) {
			getDocNavState(doc).lastFocusedElement = target;
			for (const stale of Array.from((modal || root).querySelectorAll<HTMLElement>('[data-focus="true"]'))) {
				if (stale === target) continue;
				stale.classList.remove('gpfocus');
				delete stale.dataset.focus;
			}
			if (isEditableTextTarget(target)) {
				hideFocusRing();
				return;
			}
			target.classList.add('gpfocus');
			target.dataset.focus = 'true';
			showFocusRing(target);
		} else if (target && (strip.contains(target) || isInsidePlaybar())) {
			hideFocusRing();
		}
	};

	const onFocusOut = (event: FocusEvent) => {
		if (!isNonSteamActive(doc)) { hideFocusRing(); return; }
		const related = event.relatedTarget as HTMLElement | null;
		const modal = getActiveModal();
		if (related && (root.contains(related) || (modal && modal.contains(related)))) return;

		requestAnimationFrame(() => {
			if (!isNonSteamActive(doc)) { hideFocusRing(); return; }
			const active = doc.activeElement as HTMLElement | null;
			const currentModal = getActiveModal();
			const activeInScope = active && (root.contains(active) || (currentModal && currentModal.contains(active)));
			if (!activeInScope && !strip.contains(active)) {
				const marked = root.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
				if (!marked) hideFocusRing();
			}
		});
	};

	let gamepadPollTimer: ReturnType<typeof setTimeout> | null = null;
	const prevBtn = new Map<number, boolean>();
	const lastDirTime = new Map<string, number>();
	const dirHoldTime = new Map<string, number>();

	const pollGamepads = () => {
		if (!root.isConnected || !doc.body?.isConnected || !isNonSteamActive(doc)) {
			if (gamepadPollTimer != null) { clearTimeout(gamepadPollTimer); gamepadPollTimer = null; }
			return;
		}
		if (doc.hidden) {
			gamepadPollTimer = setTimeout(pollGamepads, 250);
			return;
		}
		if (isEditableTextTarget(doc.activeElement)) {
			const nav = win.navigator || window.navigator;
			const pads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			const activePad = Array.from(pads).find(g => g && g.connected);
			const backPressed = Boolean(activePad?.buttons[1]?.pressed);
			if (backPressed && !prevBtn.get(1)) {
				doc.dispatchEvent(new CustomEvent(EXIT_TEXT_EDITOR_EVENT));
			}
			prevBtn.set(1, backPressed);
			gamepadPollTimer = setTimeout(pollGamepads, 100);
			return;
		}
		const nav = win.navigator || window.navigator;
		const gamepads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : (typeof window.navigator?.getGamepads === 'function' ? window.navigator.getGamepads() : []);
		const gp = Array.from(gamepads).find(g => g && g.connected);

		if (gp) {
			const now = Date.now();
			const navState = getDocNavState(doc);
			const keyboardOwnsNavigation = now < pollNavigationSuppressedUntil;

			const isUp = Boolean(gp.buttons[12]?.pressed || (gp.axes[1] != null && gp.axes[1] < -0.55));
			const isDown = Boolean(gp.buttons[13]?.pressed || (gp.axes[1] != null && gp.axes[1] > 0.55));
			const isLeft = Boolean(gp.buttons[14]?.pressed || (gp.axes[0] != null && gp.axes[0] < -0.55));
			const isRight = Boolean(gp.buttons[15]?.pressed || (gp.axes[0] != null && gp.axes[0] > 0.55));
			const dirs: Array<[string, boolean, 'up' | 'down' | 'left' | 'right']> = [
				['up', isUp, 'up'], ['down', isDown, 'down'], ['left', isLeft, 'left'], ['right', isRight, 'right'],
			];

			for (const [name, active, dir] of dirs) {
				if (!active) { dirHoldTime.delete(name); lastDirTime.delete(name); continue; }
				if (keyboardOwnsNavigation) { dirHoldTime.set(name, now); lastDirTime.set(name, now); continue; }
				const hold = dirHoldTime.get(name) || 0;
				const last = lastDirTime.get(name) || 0;
				if (!hold) {
					dirHoldTime.set(name, now);
					if (now - navState.lastNavTime >= NAV_COOLDOWN_MS) { lastDirTime.set(name, now); navState.lastNavTime = now; handleNavDirection(dir); }
				} else if (now - hold > 420 && now - last > 160 && now - navState.lastNavTime >= 160) {
					lastDirTime.set(name, now); navState.lastNavTime = now; handleNavDirection(dir);
				}
			}

			const btnA = Boolean(gp.buttons[0]?.pressed);
			if (!keyboardOwnsNavigation && btnA && !prevBtn.get(0) && now - navState.lastNavTime >= NAV_COOLDOWN_MS) {
				navState.lastNavTime = now;
				handleNavDirection('select');
			}
			prevBtn.set(0, btnA);

			const btnB = Boolean(gp.buttons[1]?.pressed);
			if (!keyboardOwnsNavigation && btnB && !prevBtn.get(1) && now - navState.lastNavTime >= NAV_COOLDOWN_MS) {
				navState.lastNavTime = now;
				handleNavDirection('back');
			}
			prevBtn.set(1, btnB);

			const btnLB = Boolean(gp.buttons[4]?.pressed);
			if (!keyboardOwnsNavigation && btnLB && !prevBtn.get(4) && !getActiveModal()) switchTabByOffset(-1);
			prevBtn.set(4, btnLB);

			const btnRB = Boolean(gp.buttons[5]?.pressed);
			if (!keyboardOwnsNavigation && btnRB && !prevBtn.get(5) && !getActiveModal()) switchTabByOffset(1);
			prevBtn.set(5, btnRB);

			const rY = gp.axes[3];
			if (rY != null && Math.abs(rY) > 0.25 && (getActiveModal() || isInsidePanel())) {
				const modal = getActiveModal();
				const target = modal ? (modal.querySelector('.gdl-bp-news-modal-window, .gdl-bp-ach-screen-list') || modal) : (doc.scrollingElement || doc.documentElement);
				target?.scrollBy({ top: rY * 16, behavior: 'auto' });
			}
		}

		gamepadPollTimer = setTimeout(pollGamepads, 50);
	};

	const onScrollOrResize = () => {
		if (!isNonSteamActive(doc)) return;
		if (activeFocusRingEl && activeFocusRingRoot && currentRingTarget && currentRingTarget.isConnected) {
			updateFocusRingPosition(currentRingTarget, activeFocusRingEl, activeFocusRingRoot);
		}
	};

	for (const [t, e, c] of [[doc, 'keydown', onGlobalKeyDown], [doc, 'focusin', onFocusIn], [doc, 'focusout', onFocusOut], [win, 'scroll', onScrollOrResize], [doc, 'scroll', onScrollOrResize], [win, 'resize', onScrollOrResize]] as const) {
		t.addEventListener(e, c as any, true);
	}

	gamepadPollTimer = setTimeout(pollGamepads, 50);

	activeNavInstances.set(doc, {
		doc,
		root,
		strip,
		controls,
		hideRing: hideFocusRing,
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
			for (const [t, e, c] of [[doc, 'keydown', onGlobalKeyDown], [doc, 'focusin', onFocusIn], [doc, 'focusout', onFocusOut], [win, 'scroll', onScrollOrResize], [doc, 'scroll', onScrollOrResize], [win, 'resize', onScrollOrResize]] as const) {
				t.removeEventListener(e, c as any, true);
			}
			getDocNavState(doc).lastFocusedElement = null;
		},
	});
}

