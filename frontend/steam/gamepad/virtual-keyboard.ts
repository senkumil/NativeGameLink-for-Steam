import { backendLog } from '../../api/backend';
import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';

export interface VirtualKeyboardHandle {
	ShowVirtualKeyboard?: () => void;
	ShowModalKeyboard?: () => void;
	HideVirtualKeyboard?: () => void;
}

let cachedVkRef: VirtualKeyboardHandle | null = null;

export function resolveVirtualKeyboardHandle(doc?: Document): VirtualKeyboardHandle | null {
	if (cachedVkRef) return cachedVkRef;

	try {
		steamWebpackRuntime.captureRuntime(doc);
		const req = steamWebpackRuntime.getRequire();
		if (req) {
			try {
				const m61236 = req(61236);
				let windowStore = m61236?.oy?.WindowStore;
				if (!windowStore) {
					for (const mod of steamWebpackRuntime.getAllModules()) {
						const exp = mod.exports as any;
						if (exp?.oy?.WindowStore) {
							windowStore = exp.oy.WindowStore;
							break;
						}
					}
				}
				const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
				const inst = windowStore?.GetWindowInstanceFromWindow(view)
					|| windowStore?.MainWindowInstance
					|| windowStore?.GamepadUIMainWindowInstance;
				const vkm = inst?.VirtualKeyboardManager;
				if (vkm) {
					if (vkm.m_KeyboardOwners && vkm.m_KeyboardOwners.size === 0) {
						if (typeof vkm.AddVirtualKeyboardOwner === 'function') {
							try { vkm.AddVirtualKeyboardOwner('ngl_vk_owner'); } catch {}
						} else {
							try { vkm.m_KeyboardOwners.add('ngl_vk_owner'); } catch {}
						}
					}
					cachedVkRef = {
						ShowVirtualKeyboard: (targetEl?: any) => {
							if (vkm.m_KeyboardOwners && vkm.m_KeyboardOwners.size === 0) {
								if (typeof vkm.AddVirtualKeyboardOwner === 'function') {
									try { vkm.AddVirtualKeyboardOwner('ngl_vk_owner'); } catch {}
								} else {
									try { vkm.m_KeyboardOwners.add('ngl_vk_owner'); } catch {}
								}
							}
							if (typeof vkm.ShowVirtualKeyboard === 'function') {
								try { vkm.ShowVirtualKeyboard(targetEl || null, { strEnterKeyLabel: 'Publicar' }, false); } catch {}
							}
							if (typeof vkm.SetVirtualKeyboardVisible === 'function') {
								try { vkm.SetVirtualKeyboardVisible(); } catch {}
							}
							try { vkm.m_bIsInlineVirtualKeyboardOpen?.Set?.(true); } catch {}
							try { vkm.UpdateIsShowingVirtualKeyboard?.(); } catch {}
						},
						ShowModalKeyboard: (targetEl?: any) => {
							if (typeof vkm.ShowVirtualKeyboard === 'function') {
								try { vkm.ShowVirtualKeyboard(targetEl || null, { strEnterKeyLabel: 'Publicar' }, true); } catch {}
							}
							if (typeof vkm.SetVirtualKeyboardVisible === 'function') {
								try { vkm.SetVirtualKeyboardVisible(); } catch {}
							}
						},
						HideVirtualKeyboard: () => {
							if (typeof vkm.SetVirtualKeyboardHidden === 'function') {
								try { vkm.SetVirtualKeyboardHidden(); } catch {}
							}
							try { vkm.m_bIsInlineVirtualKeyboardOpen?.Set?.(false); } catch {}
							try { vkm.UpdateIsShowingVirtualKeyboard?.(); } catch {}
						},
					};
					backendLog('[NGL][VirtualKeyboard] Resolved VirtualKeyboardManager from WindowStore');
					return cachedVkRef;
				}
			} catch {}
		}

		for (const mod of steamWebpackRuntime.getAllModules()) {
			const exp = mod.exports as any;
			if (!exp) continue;
			if (typeof exp.ShowVirtualKeyboard === 'function') {
				cachedVkRef = exp;
				backendLog(`[NGL][VirtualKeyboard] Found ShowVirtualKeyboard in module ${mod.id}`);
				return cachedVkRef;
			}
		}
	} catch (e) {
		backendLog(`[NGL][VirtualKeyboard] Resolution error: ${e}`);
	}

	return null;
}

/**
 * Invokes Steam native on-screen virtual keyboard across all available layers:
 * 1. Webpack VirtualKeyboardManager / hook ref
 * 2. SteamClient direct native methods (BrowserView, Input, OpenVR)
 * 3. Window PostMessage protocol (used by Steam GamepadUI host)
 * 4. Synthetic DOM focus & click events on target input
 */
export function showSteamVirtualKeyboard(doc?: Document, targetInput?: HTMLElement | null): boolean {
	try {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
		const view = targetDoc?.defaultView || (typeof window !== 'undefined' ? window : null);
		let invoked = false;

		// 1. Webpack native handle
		const handle = resolveVirtualKeyboardHandle(targetDoc || undefined);
		if (handle && typeof handle.ShowVirtualKeyboard === 'function') {
			try {
				(handle.ShowVirtualKeyboard as any)(targetInput);
				invoked = true;
				backendLog('[NGL][VirtualKeyboard] Invoked ShowVirtualKeyboard via Webpack handle');
			} catch (e) {
				backendLog(`[NGL][VirtualKeyboard] Webpack handle invocation failed: ${e}`);
			}
		}

		// 2. SteamClient direct native methods
		const steamClient = (view as any)?.SteamClient || (typeof window !== 'undefined' ? (window as any)?.SteamClient : null);
		if (steamClient) {
			if (typeof steamClient.BrowserView?.PostMessageToParent === 'function') {
				try {
					steamClient.BrowserView.PostMessageToParent(
						'VirtualKeyboardMessage',
						JSON.stringify({ type: 'VirtualKeyboardMessage', message: 'ShowVirtualKeyboard' })
					);
					invoked = true;
				} catch {}
			}
			if (typeof steamClient.Input?.ShowVirtualKeyboard === 'function') {
				try { steamClient.Input.ShowVirtualKeyboard(); invoked = true; } catch {}
			}
			if (typeof steamClient.Input?.ShowGamepadTextInput === 'function') {
				try { steamClient.Input.ShowGamepadTextInput(); invoked = true; } catch {}
			}
			if (typeof steamClient.Input?.ShowFloatingGamepadTextInput === 'function') {
				try { steamClient.Input.ShowFloatingGamepadTextInput(); invoked = true; } catch {}
			}
			if (typeof (steamClient as any).GamepadUI?.ShowVirtualKeyboard === 'function') {
				try { (steamClient as any).GamepadUI.ShowVirtualKeyboard(); invoked = true; } catch {}
			}
			if (typeof (steamClient as any).UI?.ShowVirtualKeyboard === 'function') {
				try { (steamClient as any).UI.ShowVirtualKeyboard(); invoked = true; } catch {}
			}
			if (typeof steamClient.OpenVR?.Keyboard?.Show === 'function') {
				try { steamClient.OpenVR.Keyboard.Show(); invoked = true; } catch {}
			}
		}

		// 3. Window PostMessage protocol (Steam GamepadUI parent window listener)
		const msg = { type: 'VirtualKeyboardMessage', message: 'ShowVirtualKeyboard' };
		try { view?.postMessage(msg, '*'); invoked = true; } catch {}
		try { if (view?.parent && view.parent !== view) { view.parent.postMessage(msg, '*'); invoked = true; } } catch {}
		try { if (view?.top && view.top !== view) { view.top.postMessage(msg, '*'); invoked = true; } } catch {}

		// 4. Focus target input/textarea and dispatch DOM events
		if (targetInput) {
			try {
				targetInput.focus();
				targetInput.dispatchEvent(new Event('focus', { bubbles: true }));
				targetInput.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			} catch {}
		}

		return invoked;
	} catch (err) {
		backendLog(`[NGL][VirtualKeyboard] showSteamVirtualKeyboard error: ${err}`);
		return false;
	}
}

/**
 * Dismisses Steam native on-screen virtual keyboard when editing is finished or cancelled.
 */
export function hideSteamVirtualKeyboard(doc?: Document): boolean {
	try {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
		const view = targetDoc?.defaultView || (typeof window !== 'undefined' ? window : null);
		let invoked = false;

		const handle = resolveVirtualKeyboardHandle(targetDoc || undefined);
		if (handle && typeof handle.HideVirtualKeyboard === 'function') {
			try {
				handle.HideVirtualKeyboard();
				invoked = true;
			} catch {}
		}

		const steamClient = (view as any)?.SteamClient || (typeof window !== 'undefined' ? (window as any)?.SteamClient : null);
		if (typeof steamClient?.BrowserView?.PostMessageToParent === 'function') {
			try {
				steamClient.BrowserView.PostMessageToParent(
					'VirtualKeyboardMessage',
					JSON.stringify({ type: 'VirtualKeyboardMessage', message: 'HideVirtualKeyboard' })
				);
				invoked = true;
			} catch {}
		}
		if (typeof (steamClient as any)?.GamepadUI?.HideVirtualKeyboard === 'function') {
			try { (steamClient as any).GamepadUI.HideVirtualKeyboard(); invoked = true; } catch {}
		}
		if (typeof (steamClient as any)?.UI?.HideVirtualKeyboard === 'function') {
			try { (steamClient as any).UI.HideVirtualKeyboard(); invoked = true; } catch {}
		}

		const msg = { type: 'VirtualKeyboardMessage', message: 'HideVirtualKeyboard' };
		try { view?.postMessage(msg, '*'); invoked = true; } catch {}
		try { if (view?.parent && view.parent !== view) { view.parent.postMessage(msg, '*'); invoked = true; } } catch {}
		try { if (view?.top && view.top !== view) { view.top.postMessage(msg, '*'); invoked = true; } } catch {}

		return invoked;
	} catch {
		return false;
	}
}
