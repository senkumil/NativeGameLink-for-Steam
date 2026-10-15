import type { BigPictureTab as BigPicturePanelTab } from './types';
import { EXIT_TEXT_EDITOR_EVENT, isEditableTextTarget } from './editable-target';
import { isGamepadFocusableElement } from './spatial-navigation';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { hideSteamVirtualKeyboard } from '../../steam/gamepad/virtual-keyboard';
import { focusBigPictureNativeElement } from './native-focus';

export type BigPictureNavigationAuthority = 'native' | 'fallback' | 'none';
export interface BigPictureNavigationOptions {
	authority?: BigPictureNavigationAuthority;
	generation?: number;
	panel?: HTMLElement | null;
	nativeNavNode?: any;
	nativeNavHandle?: any;
}

export function isNonSteamActive(doc: Document | null): boolean {
	try {
		const view = doc?.defaultView;
		if (!doc || !view || view.closed || view.document !== doc || !doc.body?.isConnected) return false;
		if (typeof steamUIModeService.isGamepadUI === 'function' && !steamUIModeService.isGamepadUI(doc)) return false;
		const root = doc.getElementById('gdl-bp-detail-root');
		if (!root?.isConnected || root.ownerDocument !== doc || root.hidden) return false;
		return isCurrentLinkedGamepadTarget(doc, root.dataset.gdlShortcutAppId, root.dataset.gdlSteamAppId);
	} catch { return false; }
}

const TAB_ORDER: BigPicturePanelTab[] = ['activity', 'stuff', 'community', 'info'];

export interface NavInstance {
	doc: Document;
	root: HTMLElement;
	strip: HTMLElement;
	controls: Map<BigPicturePanelTab, HTMLElement>;
	identity: string;
	authority: BigPictureNavigationAuthority;
	generation: number;
	panel: HTMLElement | null;
	nativeNavNode?: any;
	nativeNavHandle?: any;
	focusFrames: Set<number>;
	isPolling: () => boolean;
	hideRing: () => void;
	cleanup: () => void;
}

export const activeNavInstances = new WeakMap<Document, NavInstance>();

export function currentNavInstance(doc: Document): NavInstance | null {
	const instance = activeNavInstances.get(doc);
	if (!instance || !isNonSteamActive(doc) || doc.getElementById('gdl-bp-detail-root') !== instance.root
		|| `${instance.root.dataset.gdlShortcutAppId}:${instance.root.dataset.gdlSteamAppId}` !== instance.identity
		|| !instance.strip.isConnected || !instance.panel?.isConnected || !instance.panel.contains(instance.root)
		|| (instance.root.dataset.gdlBpGeneration !== undefined && instance.root.dataset.gdlBpGeneration !== String(instance.generation))) return null;
	return instance;
}

export function getBigPictureNavigationAuthority(doc: Document): BigPictureNavigationAuthority {
	return currentNavInstance(doc)?.authority || 'none';
}

export function ownedModal(doc: Document): HTMLElement | null {
	for (const id of ['gdl-bp-achievements-screen', 'gdl-bp-card-modal', 'gdl-bp-news-modal', 'gdl-bp-community-modal']) {
		const modal = doc.getElementById(id);
		if (modal?.isConnected && !modal.hidden && modal.style.display !== 'none' && modal.getAttribute('aria-hidden') !== 'true') return modal;
	}
	return null;
}

export function foreignModalVisible(doc: Document): boolean {
	const own = ownedModal(doc), view = doc.defaultView;
	for (const modal of Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"], [class*="ModalPosition"], [class*="ModalOverlay"], [class*="DialogModal"], .ModalPosition_Content'))) {
		if (!modal.isConnected || (own && (modal === own || own.contains(modal) || modal.contains(own)))) continue;
		let visible = true;
		for (let node: HTMLElement | null = modal; node; node = node.parentElement) {
			const style = view?.getComputedStyle(node);
			if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') { visible = false; break; }
		}
		if (visible) return true;
	}
	return false;
}

/** X/Y have no invented defaults: only an explicitly marked owned action runs. */
export function performBigPictureSemanticAction(doc: Document, action: 'x' | 'y'): boolean {
	const instance = currentNavInstance(doc);
	if (!instance || foreignModalVisible(doc) || isEditableTextTarget(doc.activeElement)) return false;
	const scope = ownedModal(doc) || instance.root;
	const active = doc.activeElement as HTMLElement | null;
	const group = active && scope.contains(active) ? active.closest<HTMLElement>('[data-gdl-gamepad-actions]') : null;
	const actionScope = group && scope.contains(group) ? group : scope;
	const target = actionScope.querySelector<HTMLElement>(`[data-gdl-gamepad-action="${action}"]`);
	if (!isGamepadFocusableElement(target, actionScope)) return false;
	target.click(); return true;
}

export function switchBigPictureOwnedModalTab(doc: Document, offset: number): boolean {
	const modal = ownedModal(doc);
	if (!modal || !currentNavInstance(doc) || foreignModalVisible(doc) || isEditableTextTarget(doc.activeElement)) return false;
	const tabs = Array.from(modal.querySelectorAll<HTMLElement>('[data-gdl-achievement-tab]'))
		.filter(tab => isGamepadFocusableElement(tab, modal));
	if (!tabs.length) return false;
	const selected = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
	const next = Math.max(0, Math.min(tabs.length - 1, selected + offset));
	if (next !== selected) tabs[next].click();
	return true;
}

export function switchBigPictureNativeTab(doc: Document, offset: number): boolean {
	const instance = currentNavInstance(doc);
	if (!instance || foreignModalVisible(doc) || isEditableTextTarget(doc.activeElement)) return false;
	if (ownedModal(doc)) return switchBigPictureOwnedModalTab(doc, offset);
	const available = TAB_ORDER.filter(tab => isGamepadFocusableElement(instance.controls.get(tab) || null, instance.strip));
	const selected = Math.max(0, available.findIndex(tab => instance.controls.get(tab)?.getAttribute('aria-selected') === 'true'));
	const next = Math.max(0, Math.min(available.length - 1, selected + offset));
	if (next === selected) return false;
	instance.controls.get(available[next])?.click(); return true;
}

export function returnBigPictureFocusToTabs(doc: Document): boolean {
	const instance = currentNavInstance(doc);
	if (!instance || foreignModalVisible(doc)) return false;
	if (isEditableTextTarget(doc.activeElement)) {
		hideSteamVirtualKeyboard(doc);
		doc.dispatchEvent(new (doc.defaultView || window).CustomEvent(EXIT_TEXT_EDITOR_EVENT));
		return true;
	}
	if (ownedModal(doc)) return false;
	const available = Array.from(instance.controls.values()).filter(control => isGamepadFocusableElement(control, instance.strip));
	const target = available.find(control => control.getAttribute('aria-selected') === 'true') || available[0];
	if (!target) return false;
	if (!focusBigPictureNativeElement(doc, target)) target.focus({ preventScroll: true });
	target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	return true;
}

/** Modal close callbacks restore the captured owned target only in this session. */
export function captureBigPictureReturnFocus(doc: Document, trigger?: HTMLElement | null): () => void {
	const instance = currentNavInstance(doc);
	const target = trigger || doc.activeElement as HTMLElement | null;
	const key = target?.dataset.gdlFocusKey;
	let used = false;
	return () => {
		if (used || !instance || !isNonSteamActive(doc)) return;
		const live = currentNavInstance(doc);
		if (!live || live.root !== instance.root || live.identity !== instance.identity || live.generation !== instance.generation) return;
		used = true;
		const view = doc.defaultView;
		if (!view) return;
		const frame = view.requestAnimationFrame(() => {
			live.focusFrames.delete(frame);
			const current = currentNavInstance(doc);
			if (!current || current.root !== instance.root || current.identity !== instance.identity
				|| current.generation !== instance.generation || !isNonSteamActive(doc) || foreignModalVisible(doc)) return;
			let next = target?.isConnected && (current.root.contains(target) || current.strip.contains(target)) ? target : null;
			if (!next && key) next = Array.from(current.root.querySelectorAll<HTMLElement>('[data-gdl-focus-key]')).find(item => item.dataset.gdlFocusKey === key) || null;
			if (next && isGamepadFocusableElement(next)) {
				if (!focusBigPictureNativeElement(doc, next)) next.focus({ preventScroll: true });
			}
			else returnBigPictureFocusToTabs(doc);
		});
		live.focusFrames.add(frame);
	};
}

