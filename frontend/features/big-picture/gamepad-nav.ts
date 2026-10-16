import type { BigPictureTab as BigPicturePanelTab } from './types';
import { resolveNativeAppDetailsClasses, FALLBACK_FOCUS_RING_CLASSES } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { isEditableTextTarget } from './editable-target';
import { collectFocusableLayout, chooseSpatialTarget, firstSpatialTarget, isGamepadFocusableElement } from './spatial-navigation';
import { activeNavInstances, currentNavInstance, ownedModal, foreignModalVisible, isNonSteamActive, returnBigPictureFocusToTabs, performBigPictureSemanticAction, switchBigPictureOwnedModalTab, type NavInstance, type BigPictureNavigationOptions } from './navigation-session';
import { closeRegisteredBigPictureModal } from './modal-actions';
import { getMountedBigPictureNavNode } from './native-focus';
export { isNonSteamActive, getBigPictureNavigationAuthority, returnBigPictureFocusToTabs, performBigPictureSemanticAction, switchBigPictureOwnedModalTab, switchBigPictureNativeTab, captureBigPictureReturnFocus, type BigPictureNavigationAuthority, type BigPictureNavigationOptions } from './navigation-session';


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

function playSteamNavSound(doc: Document, soundId: number): void {
	try {
		const sc = (doc.defaultView as any)?.SteamClient?.Sounds;
		if (typeof sc?.PlaySoundEffect === 'function') sc.PlaySoundEffect(soundId);
		else if (typeof sc?.PlaySound === 'function') sc.PlaySound(soundId);
	} catch {}
}

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
	options: BigPictureNavigationOptions = {},
): () => void {
	const requested = options.authority || 'fallback';
	const nativeNode = requested === 'native' ? getMountedBigPictureNavNode(doc, root, options.nativeNavNode, options.nativeNavHandle) : null;
	const authority = requested === 'native' && !nativeNode ? 'none' : requested;
	const generation = options.generation || 0, panel = options.panel || root.parentElement;
	if (!isNonSteamActive(doc) || doc.getElementById('gdl-bp-detail-root') !== root || root.ownerDocument !== doc
		|| strip.ownerDocument !== doc || !strip.isConnected || panel?.ownerDocument !== doc || !panel?.isConnected || !panel.contains(root)) {
		disposeBigPictureGamepadNavigation(doc);
		return () => {};
	}
	const identity = `${root.dataset.gdlShortcutAppId}:${root.dataset.gdlSteamAppId}`;
	const existing = activeNavInstances.get(doc);
	if (existing && existing.root === root && existing.strip === strip && existing.identity === identity
		&& existing.authority === authority && existing.generation === generation && existing.panel === panel
		&& existing.nativeNavNode === options.nativeNavNode && existing.nativeNavHandle === options.nativeNavHandle
		&& (authority === 'native' || existing.isPolling())
		&& existing.controls.size === controls.size
		&& Array.from(controls).every(([tab, control]) => existing.controls.get(tab) === control)) {
		return () => { if (activeNavInstances.get(doc) === existing) disposeBigPictureGamepadNavigation(doc); };
	}

	if (existing) {
		existing.cleanup();
		activeNavInstances.delete(doc);
	}

	const win = doc.defaultView || window;
	root.dataset.gdlBpNavigationAuthority = authority;
	if (authority === 'none') return () => { if (root.dataset.gdlBpNavigationAuthority === 'none') delete root.dataset.gdlBpNavigationAuthority; };
	const focusFrames = new Set<number>();
	if (authority === 'native') {
		// Steam owns directional input. Only bridge the native tabs into the
		// registered content node; never run a second controller polling loop.
		const enterContent = (event: Event): void => {
			const input = event as CustomEvent;
			if (currentNavInstance(doc) !== instance || event.defaultPrevented
				|| input.detail?.is_repeat || foreignModalVisible(doc) || ownedModal(doc)
				|| isEditableTextTarget(doc.activeElement) || !strip.contains(event.target as Node)) return;
			const button = input.detail?.button;
			if ((event.type === 'vgp_ondirection' && button !== 10) || (event.type === 'vgp_onok' && button !== 1)) return;
			const selected = Array.from(controls.values()).find(control => control.getAttribute('aria-selected') === 'true');
			if (!selected?.contains(event.target as Node)) return;
			const node = getMountedBigPictureNavNode(doc, root, options.nativeNavNode, options.nativeNavHandle);
			if (!node || node.Tree.BIsEnabled?.() === false) return;
			if (node.BTakeFocus(0, 10) === true) { event.preventDefault(); event.stopPropagation(); }
		};
		const instance: NavInstance = { doc, root, strip, controls, identity, authority, generation, panel,
			nativeNavNode: options.nativeNavNode, nativeNavHandle: options.nativeNavHandle,
			focusFrames, isPolling: () => false, hideRing: () => {},
			cleanup: () => { for (const frame of focusFrames) win.cancelAnimationFrame(frame); focusFrames.clear();
				strip.removeEventListener('vgp_ondirection', enterContent, true);
				strip.removeEventListener('vgp_onok', enterContent, true);
				if (root.dataset.gdlBpNavigationAuthority === 'native') delete root.dataset.gdlBpNavigationAuthority; } };
		activeNavInstances.set(doc, instance);
		strip.addEventListener('vgp_ondirection', enterContent, true);
		strip.addEventListener('vgp_onok', enterContent, true);
		return () => { if (activeNavInstances.get(doc) === instance) disposeBigPictureGamepadNavigation(doc); };
	}
	let disposed = false;
	const isActive = (): boolean => !disposed && isNonSteamActive(doc)
		&& doc.getElementById('gdl-bp-detail-root') === root
		&& `${root.dataset.gdlShortcutAppId}:${root.dataset.gdlSteamAppId}` === identity
		&& strip.isConnected && panel?.isConnected && panel.contains(root)
		&& (root.dataset.gdlBpGeneration === undefined || root.dataset.gdlBpGeneration === String(generation));

	let activeFocusRingEl: HTMLElement | null = null;
	let activeFocusRingRoot: HTMLElement | null = null;
	let currentRingTarget: HTMLElement | null = null;
	let ringResizeObserver: ResizeObserver | null = null;

	const getActiveModal = (): HTMLElement | null => ownedModal(doc);
	const hasForeignModal = (): boolean => foreignModalVisible(doc);
	const closeOwnedModal = (modal: HTMLElement): boolean => {
		if (closeRegisteredBigPictureModal(modal)) return true;
		const button = modal.querySelector<HTMLElement>('.gdl-bp-news-modal-close, .gdl-bp-news-modal-close-btn, .gdl-bp-ach-close-trigger, .gdl-bp-fullscreen-card-close-btn');
		if (!button) return false;
		button.click();
		return true;
	};

	const hideFocusRing = (): void => {
		ringResizeObserver?.disconnect(); ringResizeObserver = null;
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
		const scaleX = ringRoot.offsetWidth > 0 ? rootRect.width / ringRoot.offsetWidth : 1;
		const scaleY = ringRoot.offsetHeight > 0 ? rootRect.height / ringRoot.offsetHeight : 1;
		const left = (targetRect.left - rootRect.left) / (scaleX || 1);
		const top = (targetRect.top - rootRect.top) / (scaleY || 1);
		const width = targetRect.width / (scaleX || 1);
		const height = targetRect.height / (scaleY || 1);
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
		if (!target || !target.isConnected || target.dataset.gdlSuppressFocusRing === '1' || !isActive() || getActiveModal() || hasForeignModal() || isEditableTextTarget(target)) {
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
			Object.assign(activeFocusRingRoot.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
			if (activeFocusRingRoot.parentElement !== doc.body) doc.body.appendChild(activeFocusRingRoot);
		}
		activeFocusRingRoot.style.display = '';

		if (!isSameTarget) {
			activeFocusRingEl?.remove();
			activeFocusRingEl = doc.createElement('div');
			activeFocusRingEl.id = 'gdl-bp-focus-ring';
			activeFocusRingEl.className = focusClasses.FocusRing;
			activeFocusRingEl.style.pointerEvents = 'none';
			activeFocusRingEl.style.position = 'absolute';
			activeFocusRingRoot.appendChild(activeFocusRingEl);
			ringResizeObserver?.disconnect();
			if (win.ResizeObserver) {
				ringResizeObserver = new win.ResizeObserver(() => {
					if (currentRingTarget && activeFocusRingEl && activeFocusRingRoot) updateFocusRingPosition(currentRingTarget, activeFocusRingEl, activeFocusRingRoot);
				});
				ringResizeObserver.observe(target);
			}
		}
		if (activeFocusRingEl) updateFocusRingPosition(target, activeFocusRingEl, activeFocusRingRoot);
	};

	const getActiveTab = (): HTMLElement | null => {
		const selected = strip.querySelector<HTMLElement>('[aria-selected="true"], [class*="Selected"], [class*="active"]')
			|| strip.querySelector<HTMLElement>('[tabindex="0"]');
		return isGamepadFocusableElement(selected, strip) ? selected
			: Array.from(controls.values()).find(control => isGamepadFocusableElement(control, strip)) || null;
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
		if (!isActive() || hasForeignModal()) return false;
		if (getActiveModal()) return switchBigPictureOwnedModalTab(doc, offset);
		const now = Date.now();
		const navState = getDocNavState(doc);
		if (now - navState.lastTabSwitchTime < TAB_SWITCH_COOLDOWN_MS) {
			return false;
		}

		const currentKey = getCurrentTabKey();
		const available = TAB_ORDER.filter(tab => isGamepadFocusableElement(controls.get(tab) || null, strip));
		const currentIdx = available.indexOf(currentKey);
		const startIdx = currentIdx === -1 ? 0 : currentIdx;
		const nextIdx = Math.max(0, Math.min(available.length - 1, startIdx + offset));
		if (nextIdx === startIdx) {
			return false;
		}

		navState.lastTabSwitchTime = now;
		navState.lastNavTime = now;
		navState.lastFocusedElement = null;
		hideFocusRing();

		const nextKey = available[nextIdx];
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
		if (!isGamepadFocusableElement(target, scope) || !isActive() || hasForeignModal()) return;
		if (scope === root) getDocNavState(doc).lastFocusedElement = target;
		try {
			playSteamNavSound(doc, 1);
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
		if (!isActive() || hasForeignModal()) return false;

		const modal = getActiveModal();

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
				playSteamNavSound(doc, 4);
				return closeOwnedModal(modal);
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
			if (isGamepadFocusableElement(current, currentScope)) {
				if (isEditableTextTarget(current)) {
					current.focus();
					return true;
				}
				playSteamNavSound(doc, 3);
				current.click();
				return true;
			}
			return false;
		}

		if (direction === 'back') {
			playSteamNavSound(doc, 4);
			hideFocusRing();
			if (modal) {
				return closeOwnedModal(modal);
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
					playSteamNavSound(doc, 1); clearStripFocus(); tab.classList.add('gpfocus'); tab.dataset.focus = 'true'; tab.focus();
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
		if (!isActive() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		if (hasForeignModal()) { hideFocusRing(); return; }

		const key = event.key;
		if (isEditableTextTarget(doc.activeElement)) {
			if (key === 'Escape') { returnBigPictureFocusToTabs(doc); event.preventDefault(); event.stopPropagation(); }
			return;
		}
		if ((key === 'x' || key === 'X' || key === 'y' || key === 'Y') && performBigPictureSemanticAction(doc, key.toLowerCase() as 'x' | 'y')) {
			event.preventDefault(); event.stopPropagation(); return;
		}
		if (getActiveModal()) {
			if (key === 'PageUp' || key === 'PageDown' || key === 'q' || key === 'Q' || key === 'e' || key === 'E') {
				switchBigPictureOwnedModalTab(doc, key === 'q' || key === 'Q' || key === 'PageUp' ? -1 : 1);
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
		// Steam owns launch activation, including immediately after leaving our
		// panel. Never let the fallback cooldown swallow Play's Enter/Space.
		if (!getActiveModal() && isInsidePlaybar() && dir !== 'down') return;
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
		if (!isActive()) return;
		if (hasForeignModal()) { hideFocusRing(); return; }
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
		if (!isActive() || hasForeignModal()) { hideFocusRing(); return; }
		const related = event.relatedTarget as HTMLElement | null;
		const modal = getActiveModal();
		if (related && (root.contains(related) || (modal && modal.contains(related)))) return;

		const frame = win.requestAnimationFrame(() => {
			focusFrames.delete(frame);
			if (!isActive() || hasForeignModal()) { hideFocusRing(); return; }
			const active = doc.activeElement as HTMLElement | null;
			const currentModal = getActiveModal();
			const activeInScope = active && (root.contains(active) || (currentModal && currentModal.contains(active)));
			if (!activeInScope && !strip.contains(active)) {
				const marked = root.querySelector<HTMLElement>('.gpfocus, [data-focus="true"]');
				if (!marked) hideFocusRing();
			}
		});
		focusFrames.add(frame);
	};

	let gamepadPollTimer: number | null = null;
	const prevBtn = new Map<number, boolean>();
	const lastDirTime = new Map<string, number>();
	const dirHoldTime = new Map<string, number>();

	const pollGamepads = () => {
		if (!root.isConnected || !doc.body?.isConnected || !isActive()) {
			if (gamepadPollTimer != null) { win.clearTimeout(gamepadPollTimer); gamepadPollTimer = null; }
			return;
		}
		if (hasForeignModal()) {
			hideFocusRing();
			// Steam owns this modal. Observe button state without acting, so a
			// held A/B/bumper cannot become a delayed action after it closes.
			const nav = win.navigator || window.navigator;
			const pads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			const pad = Array.from(pads).find(candidate => candidate && candidate.connected);
			for (const index of [0, 1, 2, 3, 4, 5]) prevBtn.set(index, Boolean(pad?.buttons[index]?.pressed));
			dirHoldTime.clear(); lastDirTime.clear();
			gamepadPollTimer = win.setTimeout(pollGamepads, 250);
			return;
		}
		if (doc.hidden) {
			gamepadPollTimer = win.setTimeout(pollGamepads, 250);
			return;
		}
		if (isEditableTextTarget(doc.activeElement)) {
			const nav = win.navigator || window.navigator;
			const pads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			const activePad = Array.from(pads).find(g => g && g.connected);
			const backPressed = Boolean(activePad?.buttons[1]?.pressed);
			if (backPressed && !prevBtn.get(1)) {
				returnBigPictureFocusToTabs(doc);
			}
			prevBtn.set(1, backPressed);
			gamepadPollTimer = win.setTimeout(pollGamepads, 100);
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
			for (const [index, action] of [[2, 'x'], [3, 'y']] as const) {
				const pressed = Boolean(gp.buttons[index]?.pressed);
				if (!keyboardOwnsNavigation && pressed && !prevBtn.get(index)) performBigPictureSemanticAction(doc, action);
				prevBtn.set(index, pressed);
			}

			const btnLB = Boolean(gp.buttons[4]?.pressed);
			if (!keyboardOwnsNavigation && btnLB && !prevBtn.get(4)) switchTabByOffset(-1);
			prevBtn.set(4, btnLB);

			const btnRB = Boolean(gp.buttons[5]?.pressed);
			if (!keyboardOwnsNavigation && btnRB && !prevBtn.get(5)) switchTabByOffset(1);
			prevBtn.set(5, btnRB);

			const rY = gp.axes[3];
			if (rY != null && Math.abs(rY) > 0.25 && (getActiveModal() || isInsidePanel())) {
				const modal = getActiveModal();
				const target = modal ? (modal.querySelector('.gdl-bp-news-modal-window, .gdl-bp-ach-screen-list') || modal) : (doc.scrollingElement || doc.documentElement);
				target?.scrollBy({ top: rY * 16, behavior: 'auto' });
			}
		}

		gamepadPollTimer = win.setTimeout(pollGamepads, 50);
	};

	const onScrollOrResize = () => {
		if (!isActive() || hasForeignModal()) return;
		if (activeFocusRingEl && activeFocusRingRoot && currentRingTarget && currentRingTarget.isConnected) {
			updateFocusRingPosition(currentRingTarget, activeFocusRingEl, activeFocusRingRoot);
		}
	};

	for (const [t, e, c] of [[doc, 'keydown', onGlobalKeyDown], [doc, 'focusin', onFocusIn], [doc, 'focusout', onFocusOut], [win, 'scroll', onScrollOrResize], [doc, 'scroll', onScrollOrResize], [win, 'resize', onScrollOrResize]] as const) {
		t.addEventListener(e, c as any, true);
	}

	gamepadPollTimer = win.setTimeout(pollGamepads, 50);

	activeNavInstances.set(doc, {
		doc,
		root,
		strip,
		controls,
		identity,
		authority,
		generation,
		panel,
		focusFrames,
		isPolling: () => gamepadPollTimer !== null,
		hideRing: hideFocusRing,
		cleanup: () => {
			if (disposed) return;
			disposed = true;
			if (gamepadPollTimer != null) {
				win.clearTimeout(gamepadPollTimer);
				gamepadPollTimer = null;
			}
			for (const frame of focusFrames) win.cancelAnimationFrame(frame);
			focusFrames.clear();
			if (root.dataset.gdlBpNavigationAuthority === 'fallback') delete root.dataset.gdlBpNavigationAuthority;
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
	const instance = activeNavInstances.get(doc);
	return () => { if (activeNavInstances.get(doc) === instance) disposeBigPictureGamepadNavigation(doc); };
}

