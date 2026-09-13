import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { getCachedGameData } from '../../core/game-data';
import { ACH_CLASSES } from '../../steam/css';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import type { NativeLibraryLayout } from './layout';

export type ControllerType = 'xbox' | 'playstation' | 'switch' | 'generic';

export interface ConnectedControllerInfo {
	connected: boolean;
	name: string;
	type: ControllerType;
}

function isSteamControllerConnected(ctrl: any): boolean {
	if (!ctrl || typeof ctrl !== 'object') return false;
	if (ctrl.bConnected === false || ctrl.connected === false || ctrl.bIsConnected === false || ctrl.m_bConnected === false || ctrl.is_connected === false) {
		return false;
	}
	if (ctrl.bActive === false || ctrl.m_bActive === false) {
		return false;
	}
	if (ctrl.bConnected === true || ctrl.connected === true || ctrl.bIsConnected === true || ctrl.m_bConnected === true || ctrl.is_connected === true) {
		return true;
	}
	if (ctrl.bActive === true || ctrl.m_bActive === true) {
		return true;
	}
	return false;
}

function getSteamControllerStore(doc?: Document): any {
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		if (win) {
			if ((win as any).ControllerStore) return (win as any).ControllerStore;
			if ((win as any).controllerStore) return (win as any).controllerStore;
			if ((win as any).opener && ((win as any).opener.ControllerStore || (win as any).opener.controllerStore)) {
				return (win as any).opener.ControllerStore || (win as any).opener.controllerStore;
			}
			if ((win as any).parent && ((win as any).parent.ControllerStore || (win as any).parent.controllerStore)) {
				return (win as any).parent.ControllerStore || (win as any).parent.controllerStore;
			}
			if ((win as any).top && ((win as any).top.ControllerStore || (win as any).top.controllerStore)) {
				return (win as any).top.ControllerStore || (win as any).top.controllerStore;
			}
		}
	} catch {}
	return null;
}

export function detectConnectedController(doc?: Document): ConnectedControllerInfo {
	// 1. Check Web Gamepad API (direct Chromium / hardware detection)
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const navList = [win?.navigator, typeof navigator !== 'undefined' ? navigator : null].filter(Boolean);
		for (const nav of navList) {
			const gamepads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			for (let i = 0; i < gamepads.length; i++) {
				const gp = gamepads[i];
				if (gp && gp.connected !== false && (gp.connected === true || (gp.buttons && gp.buttons.length > 0) || (gp.axes && gp.axes.length > 0))) {
					const id = (gp.id || '').toLowerCase();
					let type: ControllerType = 'xbox';
					if (id.includes('dualsense') || id.includes('dualshock') || id.includes('playstation') || id.includes('sony') || id.includes('ps4') || id.includes('ps5') || id.includes('054c')) {
						type = 'playstation';
					} else if (id.includes('switch') || id.includes('nintendo') || id.includes('joy-con') || id.includes('057e')) {
						type = 'switch';
					} else {
						type = 'xbox';
					}
					return { connected: true, name: gp.id || 'Controller', type };
				}
			}
		}
	} catch {}

	// 2. Check official Steam ControllerStore (instantaneous & accurate)
	try {
		const store = getSteamControllerStore(doc);
		if (store) {
			const list = typeof store.GetControllers === 'function' ? store.GetControllers() : store.m_controllerList;
			if (Array.isArray(list) && list.length > 0) {
				const candidate = list.find(isSteamControllerConnected);
				if (candidate) {
					const eType = Number(candidate?.eControllerType || 0);
					let type: ControllerType = 'xbox';
					if (eType === 33 || eType === 34 || eType === 45 || eType === 47 || eType === 48) type = 'playstation';
					else if (eType === 38 || eType === 39 || eType === 40 || eType === 41 || eType === 42 || eType === 44 || eType === 51) type = 'switch';
					return { connected: true, name: candidate?.strName || 'Controller', type };
				}
			}
			if (typeof store.BHasExternalGamepadConnected === 'function' && store.BHasExternalGamepadConnected()) {
				return { connected: true, name: 'Controller', type: 'xbox' };
			}
		}
	} catch {}

	// 3. Check SteamClient.Input (Steam's internal controller service)
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const steamInput = (win as any)?.SteamClient?.Input || (typeof window !== 'undefined' ? (window as any).SteamClient?.Input : null);
		if (steamInput) {
			const list = (typeof steamInput.GetControllers === 'function' ? steamInput.GetControllers() : null)
				|| (typeof steamInput.GetConnectedControllers === 'function' ? steamInput.GetConnectedControllers() : null)
				|| steamInput.m_rgControllers
				|| steamInput.m_controllerList
				|| steamInput.m_controllers;
			if (Array.isArray(list) && list.length > 0) {
				const candidate = list.find(isSteamControllerConnected);
				if (candidate) {
					const eType = Number(candidate?.eControllerType || 0);
					let type: ControllerType = 'xbox';
					if (eType === 33 || eType === 34 || eType === 45 || eType === 47 || eType === 48) type = 'playstation';
					else if (eType === 38 || eType === 39 || eType === 40 || eType === 41 || eType === 42 || eType === 44 || eType === 51) type = 'switch';
					return { connected: true, name: candidate?.strName || 'Controller', type };
				}
			}
			if (typeof steamInput.GetConnectedGamepadCount === 'function' && steamInput.GetConnectedGamepadCount() > 0) {
				return { connected: true, name: 'Controller', type: 'xbox' };
			}
			if (typeof steamInput.BHasGamepad === 'function' && steamInput.BHasGamepad()) {
				return { connected: true, name: 'Controller', type: 'xbox' };
			}
			if (typeof steamInput.BHasController === 'function' && steamInput.BHasController()) {
				return { connected: true, name: 'Controller', type: 'xbox' };
			}
		}
	} catch {}

	return { connected: false, name: '', type: 'generic' };
}

export function subscribeControllerChanges(doc: Document, onChange: (info: ConnectedControllerInfo) => void): () => void {
	let lastState = detectConnectedController(doc);
	let timer: any = null;

	const check = () => {
		const current = detectConnectedController(doc);
		if (current.connected !== lastState.connected || current.type !== lastState.type) {
			lastState = current;
			onChange(current);
		}
	};

	check();

	const onGamepadEvent = () => {
		check();
		setTimeout(check, 30);
		setTimeout(check, 100);
		setTimeout(check, 250);
	};

	const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
	const targets = [
		typeof window !== 'undefined' ? window : null,
		win,
		(win as any)?.parent,
		(win as any)?.top,
		(win as any)?.opener,
	].filter((w, idx, arr): w is Window => Boolean(w && arr.indexOf(w) === idx));

	for (const target of targets) {
		try {
			target.addEventListener('gamepadconnected', onGamepadEvent);
			target.addEventListener('gamepaddisconnected', onGamepadEvent);
		} catch {}
	}

	const unregisters: (() => void)[] = [];
	try {
		const steamInput = (win as any)?.SteamClient?.Input || (typeof window !== 'undefined' ? (window as any).SteamClient?.Input : null);
		if (steamInput) {
			const registerMethods = [
				'RegisterForControllerListChanges',
				'RegisterForControllerStateChanges',
				'RegisterForActiveControllerChanges',
				'RegisterForUnboundControllerListChanges',
				'RegisterForGamepadActivityChanges',
			];
			for (const method of registerMethods) {
				if (typeof steamInput[method] === 'function') {
					try {
						const reg = steamInput[method](() => onGamepadEvent());
						if (reg && typeof reg.unregister === 'function') {
							unregisters.push(() => {
								try { reg.unregister(); } catch {}
							});
						}
					} catch {}
				}
			}
		}
	} catch {}

	timer = setInterval(check, 1000);

	return () => {
		for (const target of targets) {
			try {
				target.removeEventListener('gamepadconnected', onGamepadEvent);
				target.removeEventListener('gamepaddisconnected', onGamepadEvent);
			} catch {}
		}
		if (timer) clearInterval(timer);
		for (const unreg of unregisters) {
			unreg();
		}
	};
}

function controllerTitle(type: ControllerType): string {
	switch (type) {
		case 'xbox':
			return loc('AppDetailsControllerSection_Title_Supported_Xbox', gdlText('controller_supported_xbox', 'Compatible with your Xbox controller'));
		case 'playstation':
			return loc('AppDetailsControllerSection_Title_Supported_DualShock', gdlText('controller_supported_dualshock', 'Compatible with your DualShock controller'));
		case 'switch':
			return loc('AppDetailsControllerSection_Title_Supported_Generic', gdlText('controller_supported_generic', 'Compatible with your controller'));
		default:
			return loc('AppDetailsControllerSection_Title_Supported_Xbox', gdlText('controller_supported_xbox', 'Compatible with your Xbox controller'));
	}
}

function controllerDesc(): string {
	return loc('AppDetailsControllerSection_DevSupported', gdlText('controller_supported_desc', 'This game should work very well with your controller'));
}

function controllerLinkText(): string {
	return loc('AppControllerConfiguration_Link', gdlText('controller_settings_link', 'View controller settings'));
}

export function controllerSectionHeader(): string {
	return loc('AppDetails_SectionTitle_Controller', gdlText('controller_section_title', 'Controller'));
}

function controllerIconSvg(): string {
	return `<img class="gdl-controller-icon-art" alt="" aria-hidden="true" src="data:image/png;base64,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" />`;
}

export function renderControllerSidebarHtml(info: ConnectedControllerInfo): string {
	const title = escapeHtml(controllerTitle(info.type));
	const desc = escapeHtml(controllerDesc());
	const link = escapeHtml(controllerLinkText());
	const icon = controllerIconSvg();

	return `<div class="${ACH_CLASSES().HighlightDiv} gdl-native-sidebar-panel gdl-controller-card"><div class="gdl-controller-main"><div class="gdl-controller-icon">${icon}</div><div class="gdl-controller-copy"><div class="gdl-controller-title">${title}</div><div class="gdl-controller-desc">${desc}</div></div></div><div class="gdl-controller-link-wrap"><span class="gdl-controller-link">${link}</span></div></div>`;
}

export function openControllerConfig(steamAppId: string, shortcutAppId: string | null): void {
	const targetId = Number(shortcutAppId || steamAppId);
	try {
		if ((window as any).SteamClient?.Apps?.ShowControllerConfigurator) {
			(window as any).SteamClient.Apps.ShowControllerConfigurator(targetId);
			return;
		}
		if ((window as any).SteamClient?.Input?.ShowControllerSettings) {
			(window as any).SteamClient.Input.ShowControllerSettings();
			return;
		}
	} catch (e) {
		backendLog('Error opening controller configurator: ' + String(e));
	}
}

export function syncControllerSidebarSection(
	doc: Document,
	_layout: NativeLibraryLayout,
	_steamAppId: string,
	_shortcutAppId: string | null,
): HTMLElement | null {
	doc.getElementById('gdl-controller-section')?.remove();
	return null;
}

export function setupControllerSidebarWatcher(
	doc: Document,
	_layout: NativeLibraryLayout,
	_steamAppId: string,
	_shortcutAppId: string | null,
	_isCurrent: () => boolean,
): () => void {
	doc.getElementById('gdl-controller-section')?.remove();
	return () => {
		doc.getElementById('gdl-controller-section')?.remove();
	};
}

export interface GameControllerSupport {
	xbox: boolean;
	ps4: boolean;
	ps5: boolean;
}

export function detectGameControllerSupport(steamAppId: string, _doc?: Document): GameControllerSupport {
	const numId = Number(steamAppId);
	if (Number.isFinite(numId) && numId > 0) {
		try {
			const overview = AppStoreAdapter.getAppOverview(numId);
			if (overview) {
				const xbox = Number(overview.xbox_controller_support ?? overview.controller_support ?? 0) > 0;
				const ps4 = Number(overview.ps4_controller_support ?? 0) > 0;
				const ps5 = Number(overview.ps5_controller_support ?? 0) > 0;
				if (xbox || ps4 || ps5) {
					return { xbox: xbox || (!ps4 && !ps5), ps4, ps5 };
				}
			}
		} catch {}

		try {
			const lang = steamLanguageSync() || 'english';
			const cached = getCachedGameData(String(numId), lang)?.data;
			if (cached) {
				const catIds = new Set((cached.categories || []).map(c => Number(c.id)));
				const catDescs = (cached.categories || []).map(c => String(c.description || '').toLowerCase());
				const hasDualShock = catIds.has(55) || catIds.has(56) || catDescs.some(d => d.includes('dualshock') || d.includes('ps4'));
				const hasDualSense = catIds.has(57) || catIds.has(58) || catDescs.some(d => d.includes('dualsense') || d.includes('ps5'));
				const hasXbox = catIds.has(28) || catIds.has(18) || cached.controller_support === 'full' || cached.controller_support === 'partial' || catDescs.some(d => d.includes('controller') || d.includes('mando') || d.includes('control'));
				if (hasXbox || hasDualShock || hasDualSense) {
					return {
						xbox: hasXbox || (!hasDualShock && !hasDualSense),
						ps4: hasDualShock,
						ps5: hasDualSense,
					};
				}
			}
		} catch {}

		if (numId === 49520) {
			return { xbox: true, ps4: false, ps5: false };
		}
		if (numId === 1030300) {
			return { xbox: true, ps4: true, ps5: true };
		}
	}
	return { xbox: true, ps4: false, ps5: false };
}

