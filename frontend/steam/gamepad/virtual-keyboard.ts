import { backendLog } from '../../api/backend';
import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';
import { loc } from '../localization';
import { getNativeWindowInstance } from '../native-window-store';

export interface VirtualKeyboardHandle {
	ShowVirtualKeyboard?: (targetEl?: HTMLElement | null) => void;
	ShowModalKeyboard?: (targetEl?: HTMLElement | null) => void;
	HideVirtualKeyboard?: () => void;
}

interface CachedVirtualKeyboardHandle {
	document: Document;
	runtimeIdentity: object | null;
	manager: object | null;
	handle: VirtualKeyboardHandle;
}

const cachedHandles = new WeakMap<Window, CachedVirtualKeyboardHandle>();
const lastShowRequests = new WeakMap<Window, { document: Document; handle: VirtualKeyboardHandle | null; target: HTMLElement | null; at: number }>();
const SHOW_DEBOUNCE_MS = 350;

function resolveTargetWindow(doc?: Document): Window | null {
	const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
	return view && !view.closed && (!doc || view.document === doc) ? view : null;
}

function createManagerHandle(vkm: any): VirtualKeyboardHandle | null {
	if (!vkm) return null;
	if (typeof vkm.ShowVirtualKeyboard !== 'function' && typeof vkm.SetVirtualKeyboardVisible !== 'function') return null;

	return {
		ShowVirtualKeyboard: (targetEl?: HTMLElement | null) => {
			if (typeof vkm.ShowVirtualKeyboard === 'function') {
				vkm.ShowVirtualKeyboard(targetEl || null, { strEnterKeyLabel: loc('AppActivity_PostStatusUpdate', 'Publicar') }, false);
				return;
			}
			vkm.SetVirtualKeyboardVisible?.();
		},
		ShowModalKeyboard: (targetEl?: HTMLElement | null) => {
			if (typeof vkm.ShowVirtualKeyboard === 'function') {
				vkm.ShowVirtualKeyboard(targetEl || null, { strEnterKeyLabel: loc('AppActivity_PostStatusUpdate', 'Publicar') }, true);
				return;
			}
			vkm.SetVirtualKeyboardVisible?.();
		},
		...(typeof vkm.SetVirtualKeyboardHidden === 'function' || typeof vkm.HideVirtualKeyboard === 'function' ? { HideVirtualKeyboard: () => {
			if (typeof vkm.SetVirtualKeyboardHidden === 'function') {
				vkm.SetVirtualKeyboardHidden();
				return;
			}
			if (typeof vkm.HideVirtualKeyboard === 'function') vkm.HideVirtualKeyboard();
		} } : {}),
	};
}

export function resolveVirtualKeyboardHandle(doc?: Document): VirtualKeyboardHandle | null {
	const view = resolveTargetWindow(doc);
	if (!view) return null;
	const targetDoc = doc || view.document;
	try {
		steamWebpackRuntime.captureRuntime(targetDoc);
		const runtimeIdentity = steamWebpackRuntime.getRuntimeIdentity(targetDoc);
		// Steam can replace or revoke its manager without replacing the runtime.
		// Revalidate the owner before using a cached closure over that manager.
		const manager = getNativeWindowInstance(targetDoc)?.VirtualKeyboardManager || null;
		const cached = cachedHandles.get(view);
		if (cached && cached.document === targetDoc && cached.runtimeIdentity === runtimeIdentity && cached.manager === manager) return cached.handle;
		cachedHandles.delete(view);

		if (view?.document) {
			try {
				const handle = createManagerHandle(manager);
				if (handle) {
					cachedHandles.set(view, { document: targetDoc, runtimeIdentity, manager, handle });
					backendLog('[NGL][VirtualKeyboard] Resolved VirtualKeyboardManager from owning WindowStore');
					return handle;
				}
			} catch {}
		}

		for (const mod of steamWebpackRuntime.getAllModules(targetDoc)) {
			const exp = mod.exports as any;
			if (!exp || typeof exp.ShowVirtualKeyboard !== 'function') continue;
			const handle = exp as VirtualKeyboardHandle;
			cachedHandles.set(view, { document: targetDoc, runtimeIdentity, manager, handle });
			backendLog(`[NGL][VirtualKeyboard] Found ShowVirtualKeyboard in module ${mod.id}`);
			return handle;
		}
	} catch (e) {
		backendLog(`[NGL][VirtualKeyboard] Resolution error: ${e}`);
	}
	return null;
}

function postVirtualKeyboardMessage(view: Window | null, message: 'ShowVirtualKeyboard' | 'HideVirtualKeyboard'): boolean {
	if (!view) return false;
	const payload = { type: 'VirtualKeyboardMessage', message };
	const steamClient = (view as any)?.SteamClient;
	if (typeof steamClient?.BrowserView?.PostMessageToParent === 'function') {
		try {
			steamClient.BrowserView.PostMessageToParent('VirtualKeyboardMessage', JSON.stringify(payload));
			return true;
		} catch {}
	}
	try {
		view.postMessage(payload, '*');
		return true;
	} catch {}
	return false;
}

/**
 * Requests Steam's native GamepadUI keyboard exactly once for the owning CEF
 * window. This function deliberately never focuses the target or dispatches
 * synthetic focus/click events: callers own focus, which prevents recursive
 * focus -> keyboard -> focus loops inside steamwebhelper.
 */
export function showSteamVirtualKeyboard(doc?: Document, targetInput?: HTMLElement | null): boolean {
	try {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
		const view = resolveTargetWindow(targetDoc);
		if (!view || !targetDoc) return false;
		const handle = resolveVirtualKeyboardHandle(targetDoc);
		const now = Date.now(), previous = lastShowRequests.get(view);
		if (previous && previous.document === targetDoc && previous.handle === handle
			&& previous.target === (targetInput || null) && now - previous.at < SHOW_DEBOUNCE_MS) return true;
		const request = { document: targetDoc, handle, target: targetInput || null, at: now };
		// The manager can synchronously notify focus handlers. Coalesce that
		// reentry, but retire the provisional record if every delivery fails.
		lastShowRequests.set(view, request);
		if (handle?.ShowVirtualKeyboard) {
			try {
				handle.ShowVirtualKeyboard(targetInput || null);
				backendLog('[NGL][VirtualKeyboard] Requested native keyboard through owning WindowStore');
				return true;
			} catch (error) {
				backendLog(`[NGL][VirtualKeyboard] WindowStore keyboard request failed: ${error}`);
			}
		}

		const posted = postVirtualKeyboardMessage(view, 'ShowVirtualKeyboard');
		if (!posted && lastShowRequests.get(view) === request) lastShowRequests.delete(view);
		return posted;
	} catch (err) {
		backendLog(`[NGL][VirtualKeyboard] showSteamVirtualKeyboard error: ${err}`);
		return false;
	}
}

/** Dismisses the native keyboard without mutating Steam's private keyboard state. */
export function hideSteamVirtualKeyboard(doc?: Document): boolean {
	try {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
		const view = resolveTargetWindow(targetDoc);
		if (!view) return false;
		lastShowRequests.delete(view);
		const handle = resolveVirtualKeyboardHandle(targetDoc);
		if (handle?.HideVirtualKeyboard) {
			try {
				handle.HideVirtualKeyboard();
				return true;
			} catch (error) {
				backendLog(`[NGL][VirtualKeyboard] WindowStore hide request failed: ${error}`);
			}
		}
		return postVirtualKeyboardMessage(view, 'HideVirtualKeyboard');
	} catch (err) {
		backendLog(`[NGL][VirtualKeyboard] hideSteamVirtualKeyboard error: ${err}`);
		return false;
	}
}
