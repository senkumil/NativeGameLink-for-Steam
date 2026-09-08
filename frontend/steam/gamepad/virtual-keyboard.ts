import { backendLog } from '../../api/backend';
import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';
import { loc } from '../localization';

export interface VirtualKeyboardHandle {
	ShowVirtualKeyboard?: (targetEl?: HTMLElement | null) => void;
	ShowModalKeyboard?: (targetEl?: HTMLElement | null) => void;
	HideVirtualKeyboard?: () => void;
}

interface CachedVirtualKeyboardHandle {
	runtimeIdentity: object | null;
	handle: VirtualKeyboardHandle;
}

const cachedHandles = new WeakMap<Window, CachedVirtualKeyboardHandle>();
const lastShowRequests = new WeakMap<Window, { target: HTMLElement | null; at: number }>();
const SHOW_DEBOUNCE_MS = 350;

function resolveTargetWindow(doc?: Document): Window | null {
	return doc?.defaultView || (typeof window !== 'undefined' ? window : null);
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
		HideVirtualKeyboard: () => {
			if (typeof vkm.SetVirtualKeyboardHidden === 'function') {
				vkm.SetVirtualKeyboardHidden();
				return;
			}
			if (typeof vkm.HideVirtualKeyboard === 'function') vkm.HideVirtualKeyboard();
		},
	};
}

export function resolveVirtualKeyboardHandle(doc?: Document): VirtualKeyboardHandle | null {
	const view = resolveTargetWindow(doc);
	try {
		steamWebpackRuntime.captureRuntime(doc);
		const runtimeIdentity = steamWebpackRuntime.getRuntimeIdentity(doc);
		if (view) {
			const cached = cachedHandles.get(view);
			if (cached && cached.runtimeIdentity === runtimeIdentity) return cached.handle;
		}

		const req = steamWebpackRuntime.getRequire(doc);
		if (req) {
			try {
				const m61236 = req(61236);
				let windowStore = m61236?.oy?.WindowStore;
				if (!windowStore) {
					for (const mod of steamWebpackRuntime.getAllModules(doc)) {
						const exp = mod.exports as any;
						if (exp?.oy?.WindowStore) {
							windowStore = exp.oy.WindowStore;
							break;
						}
					}
				}
				const inst = windowStore?.GetWindowInstanceFromWindow(view)
					|| windowStore?.GamepadUIMainWindowInstance
					|| windowStore?.MainWindowInstance;
				const handle = createManagerHandle(inst?.VirtualKeyboardManager);
				if (handle) {
					if (view) cachedHandles.set(view, { runtimeIdentity, handle });
					backendLog('[NGL][VirtualKeyboard] Resolved VirtualKeyboardManager from owning WindowStore');
					return handle;
				}
			} catch {}
		}

		for (const mod of steamWebpackRuntime.getAllModules(doc)) {
			const exp = mod.exports as any;
			if (!exp || typeof exp.ShowVirtualKeyboard !== 'function') continue;
			const handle = exp as VirtualKeyboardHandle;
			if (view) cachedHandles.set(view, { runtimeIdentity, handle });
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
		if (view) {
			const now = Date.now();
			const previous = lastShowRequests.get(view);
			if (previous && previous.target === (targetInput || null) && now - previous.at < SHOW_DEBOUNCE_MS) return true;
			lastShowRequests.set(view, { target: targetInput || null, at: now });
		}

		const handle = resolveVirtualKeyboardHandle(targetDoc);
		if (handle?.ShowVirtualKeyboard) {
			try {
				handle.ShowVirtualKeyboard(targetInput || null);
				backendLog('[NGL][VirtualKeyboard] Requested native keyboard through owning WindowStore');
				return true;
			} catch (error) {
				backendLog(`[NGL][VirtualKeyboard] WindowStore keyboard request failed: ${error}`);
			}
		}

		return postVirtualKeyboardMessage(view, 'ShowVirtualKeyboard');
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
