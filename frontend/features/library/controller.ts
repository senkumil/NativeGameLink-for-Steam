import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { getCachedGameData } from '../../core/game-data';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import { ensureControllerStyles } from './styles/controller';
import { buildNativeSidebarSection, type NativeLibraryLayout } from './layout';
import { getSteamStore } from '../../steam/modules/SteamModuleResolver';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { isLibrarySidebarNode } from '../../steam/library-sidebar';
import { isLibrarySidebarInteractionActive } from '../../steam/sidebar-interaction';
import { linkedAchievementTarget } from '../achievements/navigation';
import { committedHeaderAppId } from '../../steam/library-details';
import { getLinkedSidebarOrder, hasLinkedSidebarOrder, publishLinkedSidebarSection } from './sidebar-order';
import {
	NATIVE_SVG_XBOX,
	NATIVE_SVG_XBOX_PARTIAL,
	NATIVE_SVG_PS4,
	NATIVE_SVG_PS4_PARTIAL,
	NATIVE_SVG_PS5,
	NATIVE_SVG_PS5_PARTIAL,
	NATIVE_SVG_SWITCH,
} from './controller-svgs';

export type ControllerDeviceType = 'dualsense' | 'dualshock' | 'xbox' | 'switch' | 'generic';
export type ControllerType = ControllerDeviceType;

export type ControllerSupportState = 'supported' | 'unsupported' | 'unknown' | 'partial';

export interface ConnectedControllerInfo {
	connected: boolean;
	name: string;
	type: ControllerDeviceType;
}

export function isSteamControllerConnected(ctrl: any): boolean {
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
	if (typeof ctrl.nControllerIndex === 'number' || typeof ctrl.eControllerType === 'number') {
		return true;
	}
	return false;
}

const controllerStoreLookups = new WeakMap<Window, { runtime: unknown; checkedAt: number; store: any }>();

function getSteamControllerStore(doc?: Document): any {
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const candidates = [
			win,
			(win as any)?.opener,
			(win as any)?.top,
			(win as any)?.parent,
			typeof window !== 'undefined' ? window : null,
		];
		for (const w of candidates) {
			if (w?.ControllerStore) return w.ControllerStore;
			if (w?.controllerStore) return w.controllerStore;
		}
		// Most clients expose no controller store at all. Polling connection
		// state must not rescan every loaded Webpack module every 150 ms. Live
		// globals above remain immediate, including after a negative lookup.
		const runtime = steamWebpackRuntime.getRequire(doc);
		const cached = win ? controllerStoreLookups.get(win) : null;
		const checkedAt = Date.now();
		if (doc && isLibrarySidebarInteractionActive(doc)) return cached?.runtime === runtime ? cached.store : null;
		if (cached && cached.runtime === runtime && checkedAt - cached.checkedAt < (cached.store ? 5000 : 2000)) return cached.store;
		const remember = (store: any): any => {
			if (win) controllerStoreLookups.set(win, { runtime, checkedAt, store });
			return store;
		};
		const fromResolver = getSteamStore('ControllerStore') || getSteamStore('controllerStore');
		if (fromResolver) return remember(fromResolver);
		const mods = steamWebpackRuntime.getAllModules(doc);
		for (const m of mods) {
			const exp = m?.exports;
			if (!exp) continue;
			if (typeof exp.GetControllers === 'function') return remember(exp);
			if (typeof exp.sY?.GetControllers === 'function') return remember(exp.sY);
			if (typeof exp.default?.GetControllers === 'function') return remember(exp.default);
		}
		return remember(null);
	} catch {}
	return null;
}

function classifyGamepadId(rawId: string): ControllerDeviceType {
	const id = (rawId || '').toLowerCase();
	if (id.includes('dualsense') || id.includes('0ce6') || id.includes('0df2') || (id.includes('ps5') && !id.includes('xinput'))) {
		return 'dualsense';
	}
	if (id.includes('dualshock') || id.includes('05c4') || id.includes('09cc') || ((id.includes('ps4') || id.includes('ps3')) && !id.includes('xinput'))) {
		return 'dualshock';
	}
	if (id.includes('switch') || id.includes('nintendo') || id.includes('joy-con') || id.includes('057e') || id.includes('pro controller')) {
		return 'switch';
	}
	if (id.includes('xbox') || id.includes('xinput') || id.includes('045e') || id.includes('microsoft')) {
		return 'xbox';
	}
	return 'generic';
}

function classifySteamControllerType(eType: number, name: string): ControllerDeviceType {
	if (eType === 45 || eType === 48) return 'dualsense';
	if (eType === 33 || eType === 34 || eType === 47) return 'dualshock';
	if (eType === 38 || eType === 39 || eType === 40 || eType === 41 || eType === 42 || eType === 44 || eType === 51) return 'switch';
	if (eType === 31 || eType === 32 || eType === 46 || eType === 49 || eType === 50) return 'xbox';
	if (eType === 4 || eType === 100 || eType === 101 || eType === 102 || eType === 120 || eType === 130) return 'xbox';
	return classifyGamepadId(name);
}

const primaryControllers = new WeakMap<Window, { name: string; type: ControllerDeviceType }>();

function controllerWindow(doc?: Document): Window | null {
	return doc?.defaultView || (typeof window !== 'undefined' ? window : null);
}

/** Connection detection is synchronous. An asynchronous Input API is not an
 * authoritative empty list; let the next available native/browser source win. */
function controllerList(value: any): any[] | null {
	if (Array.isArray(value)) return value;
	if (value && typeof value.then === 'function' && typeof value.catch === 'function') value.catch(() => {});
	return null;
}

function getConnectedControllers(doc?: Document): Array<{ name: string; type: ControllerDeviceType }> {
	const result: Array<{ name: string; type: ControllerDeviceType }> = [];
	const seenTypes = new Set<ControllerDeviceType>();

	// 1. Official Steam ControllerStore (Steam's native source of truth)
	try {
		const store = getSteamControllerStore(doc);
		if (store) {
			const rawList = typeof store.GetControllers === 'function' ? store.GetControllers() : store.m_controllerList;
			const list = controllerList(rawList);
			if (list) {
				for (const ctrl of list) {
					if (!isSteamControllerConnected(ctrl)) continue;
					const eType = Number(ctrl?.eControllerType || 0);
					const type = classifySteamControllerType(eType, ctrl?.strName || '');
					if (!seenTypes.has(type)) {
						seenTypes.add(type);
						result.push({ name: ctrl?.strName || 'Controller', type });
					}
				}
				return result;
			}
		}
	} catch {}

	// 2. SteamClient.Input (Steam's internal controller service)
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const steamInput = (win as any)?.SteamClient?.Input || (typeof window !== 'undefined' ? (window as any).SteamClient?.Input : null);
		if (steamInput) {
			const rawList = (typeof steamInput.GetControllers === 'function' ? steamInput.GetControllers() : null)
				|| (typeof steamInput.GetConnectedControllers === 'function' ? steamInput.GetConnectedControllers() : null)
				|| steamInput.m_rgControllers
				|| steamInput.m_controllerList
				|| steamInput.m_controllers;
			const list = controllerList(rawList);
			if (list) {
				for (const ctrl of list) {
					if (!isSteamControllerConnected(ctrl)) continue;
					const eType = Number(ctrl?.eControllerType || 0);
					const type = classifySteamControllerType(eType, ctrl?.strName || '');
					if (!seenTypes.has(type)) {
						seenTypes.add(type);
						result.push({ name: ctrl?.strName || 'Controller', type });
					}
				}
				return result;
			}
		}
	} catch {}

	// 3. Web Gamepad API (direct Chromium fallback only when Steam services are unavailable)
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const navList = [
			win?.navigator,
			(win as any)?.opener?.navigator,
			(win as any)?.top?.navigator,
			typeof navigator !== 'undefined' ? navigator : null,
		].filter(Boolean);

		for (const nav of navList) {
			const gamepads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			for (let i = 0; i < gamepads.length; i++) {
				const gp = gamepads[i];
				if (!gp || gp.connected !== true) continue;
				// Filter out phantom/ghost Bluetooth gamepads in Chromium (inactive cached handles)
				const hasActivity = (typeof gp.timestamp === 'number' && gp.timestamp > 0)
					|| gp.buttons?.some((b: any) => b?.pressed || b?.value > 0)
					|| gp.axes?.some((a: any) => Math.abs(a) > 0.1);
				if (!hasActivity) continue;
				const type = classifyGamepadId(gp.id || '');
				if (!seenTypes.has(type)) {
					seenTypes.add(type);
					result.push({ name: gp.id || 'Controller', type });
				}
			}
		}
	} catch {}

	return result;
}

export function detectConnectedController(doc?: Document): ConnectedControllerInfo {
	const connectedList = getConnectedControllers(doc);
	const win = controllerWindow(doc);
	const primary = win ? primaryControllers.get(win) : undefined;

	if (connectedList.length === 0) {
		if (win) primaryControllers.delete(win);
		return { connected: false, name: '', type: 'generic' };
	}

	// In native Steam, the first connected controller detected remains selected.
	// It does NOT switch to another controller on button presses.
	// It ONLY switches when the active controller is disconnected or powered down.
	if (primary) {
		const stillConnected = connectedList.find(c => c.type === primary.type);
		if (stillConnected) {
			return {
				connected: true,
				name: stillConnected.name || primary.name,
				type: stillConnected.type,
			};
		}
		if (win) primaryControllers.delete(win);
	}

	const first = connectedList[0];
	if (win) primaryControllers.set(win, {
		name: first.name,
		type: first.type,
	});

	return {
		connected: true,
		name: first.name,
		type: first.type,
	};
}

export function subscribeControllerChanges(doc: Document, onChange: (info: ConnectedControllerInfo) => void): () => void {
	let lastState = detectConnectedController(doc);
	let disposed = false;
	const retryTimers = new Set<ReturnType<typeof setTimeout>>();
	const win = controllerWindow(doc);

	const check = () => {
		if (disposed || win?.closed) return;
		const current = detectConnectedController(doc);
		if (current.connected !== lastState.connected || current.type !== lastState.type || current.name !== lastState.name) {
			lastState = current;
			onChange(current);
		}
	};

	check();

	const recheck = () => {
		if (disposed) return;
		check();
		// Multiple native/browser events describe the same device transition.
		// Keep one bounded settling batch instead of retaining one per event.
		for (const timer of retryTimers) clearTimeout(timer);
		retryTimers.clear();
		for (const delay of [40, 120, 250]) {
			const timer = setTimeout(() => { retryTimers.delete(timer); check(); }, delay);
			retryTimers.add(timer);
		}
	};

	const onGamepadConnected = () => {
		recheck();
	};

	const onGamepadDisconnected = (e: any) => {
		if (disposed) return;
		const gp = e?.gamepad;
		const primary = win ? primaryControllers.get(win) : undefined;
		if (gp && primary && win) {
			const type = classifyGamepadId(gp.id || '');
			if (primary.type === type) {
				primaryControllers.delete(win);
			}
		}
		recheck();
	};

	const targets = [
		win,
		(win as any)?.parent,
		(win as any)?.top,
		(win as any)?.opener,
		typeof window !== 'undefined' ? window : null,
	].filter((w, idx, arr): w is Window => Boolean(w && arr.indexOf(w) === idx));

	for (const target of targets) {
		try {
			target.addEventListener('gamepadconnected', onGamepadConnected as EventListener);
			target.addEventListener('gamepaddisconnected', onGamepadDisconnected as EventListener);
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
				'RegisterForControllerInputMessages',
			];
			for (const method of registerMethods) {
				if (typeof steamInput[method] === 'function') {
					try {
						const reg = steamInput[method](() => {
							check();
						});
						if (typeof reg === 'function') {
							unregisters.push(() => { try { reg(); } catch {} });
						} else if (reg && typeof reg.unregister === 'function') {
							unregisters.push(() => {
								try { reg.unregister(); } catch {}
							});
						}
					} catch {}
				}
			}
		}
	} catch {}

	// Native events handle immediate changes; one watchdog also catches devices
	// that power down without delivering a browser connection event.
	const timer = setInterval(check, 250);

	return () => {
		if (disposed) return;
		disposed = true;
		for (const target of targets) {
			try {
				target.removeEventListener('gamepadconnected', onGamepadConnected as EventListener);
				target.removeEventListener('gamepaddisconnected', onGamepadDisconnected as EventListener);
			} catch {}
		}
		clearInterval(timer);
		for (const retry of retryTimers) clearTimeout(retry);
		retryTimers.clear();
		for (const unreg of unregisters) {
			unreg();
		}
	};
}

function getControllerSvg(device: ControllerDeviceType, state: ControllerSupportState): string {
	if (state === 'partial') {
		switch (device) {
			case 'dualsense': return NATIVE_SVG_PS5_PARTIAL;
			case 'dualshock': return NATIVE_SVG_PS4_PARTIAL;
			case 'xbox': return NATIVE_SVG_XBOX_PARTIAL;
			case 'switch': return NATIVE_SVG_SWITCH;
			default: return NATIVE_SVG_XBOX_PARTIAL;
		}
	}
	switch (device) {
		case 'dualsense': return NATIVE_SVG_PS5;
		case 'dualshock': return NATIVE_SVG_PS4;
		case 'xbox': return NATIVE_SVG_XBOX;
		case 'switch': return NATIVE_SVG_SWITCH;
		default: return NATIVE_SVG_XBOX;
	}
}

function controllerTitle(type: ControllerDeviceType, state: ControllerSupportState): string {
	if (state === 'unsupported') {
		return loc('AppDetailsControllerSection_Title_Unsupported', gdlText('controller_unsupported_title', 'Unsupported'));
	}
	if (state === 'unknown') {
		return loc('AppDetailsControllerSection_Title_Unknown', gdlText('controller_unknown_title', 'Unknown controller support'));
	}
	if (state === 'partial') {
		return loc('AppDetailsControllerSection_Title_Playable', gdlText('controller_playable_title', 'Playable'));
	}
	switch (type) {
		case 'dualsense':
			return loc('AppDetailsControllerSection_Title_Supported_Dualsense', gdlText('controller_supported_dualsense', 'Compatible with your DualSense controller'));
		case 'dualshock':
			return loc('AppDetailsControllerSection_Title_Supported_DualShock', gdlText('controller_supported_dualshock', 'Compatible with your DualShock controller'));
		case 'xbox':
			return loc('AppDetailsControllerSection_Title_Supported_Xbox', gdlText('controller_supported_xbox', 'Compatible with your Xbox controller'));
		case 'switch':
		case 'generic':
		default:
			return loc('AppDetailsControllerSection_Title_Supported_Generic', gdlText('controller_supported_generic', 'Compatible with your controller'));
	}
}

function controllerDesc(state: ControllerSupportState): string {
	if (state === 'unsupported') {
		return loc('AppDetailsControllerSection_NoSupport', gdlText('controller_unsupported_desc', 'This game was not designed for controller support.'));
	}
	if (state === 'unknown') {
		return loc('AppDetailsControllerSection_Unknown', gdlText('controller_unknown_desc', 'This game has not yet provided new controller support information and its compatibility with your device is unknown.'));
	}
	if (state === 'partial') {
		return gdlText('controller_partial_desc', 'This game has partial controller support. Some actions may require a keyboard or mouse.');
	}
	return loc('AppDetailsControllerSection_DevSupported', gdlText('controller_supported_desc', 'This game should work very well with your controller'));
}

export function controllerSectionHeader(): string {
	return loc('AppDetails_SectionTitle_Controller', gdlText('controller_section_title', 'Controller'));
}

function controllerLinkText(): string {
	return loc('AppControllerConfiguration_Link', gdlText('controller_settings_link', 'Controller settings'));
}

export function renderControllerSidebarHtml(info: ConnectedControllerInfo, state: ControllerSupportState = 'supported'): string {
	const title = escapeHtml(controllerTitle(info.type, state));
	const desc = escapeHtml(controllerDesc(state));
	const link = escapeHtml(controllerLinkText());
	const svg = getControllerSvg(info.type, state);
	const isUnknown = state === 'unknown';
	const isUnsupported = state === 'unsupported';

	const strokeHtml = isUnsupported
		? '<div class="_29FYex2d6Tntax9SEBTxkL gdl-controller-stroke"></div>'
		: '';

	const svgClasses = `_2A8NghNvAnMQQTHsudFu7H gdl-controller-status-svg${isUnknown ? ' _3vJM7qN0DSpUfz-bhkewEQ gdl-controller-unknown' : ''}`;

	return `<div class="gdl-native-sidebar-panel gdl-controller-card" data-gdl-controller-state="${state}" data-gdl-controller-device="${info.type}">`
		+ strokeHtml
		+ `<div class="bG5F-o9ZUikaoNCIniMEa gdl-controller-body">`
		+ `<div class="Gs_qHIFwN4Z9JusWrfbfP gdl-controller-row">`
		+ `<div class="${svgClasses}">${svg}</div>`
		+ `<div class="_1vvIpx6zQ1mZiiY1y-PtlS gdl-controller-column">`
		+ `<div class="_2L06P_EWxoS_20kC2eNCQl gdl-controller-header">${title}</div>`
		+ `<div class="_8tm4KhHFNHvzsiuuyHgld gdl-controller-desc">${desc}</div>`
		+ `</div></div>`
		+ `<div class="QO0udpE4qSEcDjkVg5IwH gdl-controller-button-container">`
		+ `<button type="button" class="DialogButton _3Cdin80d-hVsakHUZboheb _3nJyYxGQ3kdwwabPmxNnMe gdl-controller-link">${link}</button>`
		+ `</div></div></div>`;
}

export function openControllerConfig(steamAppId: string, shortcutAppId: string | null, doc?: Document): void {
	const targetId = Number(shortcutAppId || steamAppId);
	const view = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
	try {
		if ((view as any)?.SteamClient?.Apps?.ShowControllerConfigurator) {
			(view as any).SteamClient.Apps.ShowControllerConfigurator(targetId);
			return;
		}
		if ((view as any)?.SteamClient?.Input?.ShowControllerSettings) {
			(view as any).SteamClient.Input.ShowControllerSettings();
			return;
		}
	} catch (e) {
		backendLog('Error opening controller configurator: ' + String(e));
	}
}

export function getOwnedControllerSidebar(doc: Document, steamAppId: string, shortcutAppId: string | null): HTMLElement | null {
	const target = linkedAchievementTarget(doc);
	if (!shortcutAppId || target?.steamAppId !== steamAppId || target.shortcutAppId !== shortcutAppId) return null;
	const section = doc.getElementById('gdl-controller-section');
	return section?.isConnected && section.dataset.gdlSteamAppId === steamAppId
		&& section.dataset.gdlShortcutAppId === shortcutAppId ? section : null;
}

export function syncControllerSidebarSection(
	doc: Document,
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
): HTMLElement | null {
	const { sidebarColumn } = layout;
	if (!sidebarColumn || !sidebarColumn.isConnected) return null;
	const target = linkedAchievementTarget(doc);
	if (!shortcutAppId || target?.steamAppId !== steamAppId || target.shortcutAppId !== shortcutAppId) return null;
	for (const native of [sidebarColumn, layout.anchorRegion]) {
		const committed = native && committedHeaderAppId(native);
		if (committed != null && committed !== Number(shortcutAppId)) return null;
	}
	if (hasLinkedSidebarOrder(doc) && !getLinkedSidebarOrder(doc, layout, steamAppId, shortcutAppId)) return null;

	const controllerInfo = detectConnectedController(doc);
	let section = doc.getElementById('gdl-controller-section');
	if (section && (section !== getOwnedControllerSidebar(doc, steamAppId, shortcutAppId)
		|| section.parentElement !== sidebarColumn)) { section.remove(); section = null; }

	if (!controllerInfo.connected) {
		if (section) {
			section.remove();
		}
		doc.querySelectorAll('#gdl-controller-section').forEach(s => s.remove());
		return null;
	}

	const supportState = detectGameControllerSupportState(steamAppId, controllerInfo.type, doc);
	ensureControllerStyles(doc);

	if (section) {
		const inner = section.querySelector<HTMLElement>('#gdl-controller-content');
		if (inner && (inner.dataset.controllerType !== controllerInfo.type || inner.dataset.controllerState !== supportState)) {
			inner.dataset.controllerType = controllerInfo.type;
			inner.dataset.controllerState = supportState;
			inner.innerHTML = renderControllerSidebarHtml(controllerInfo, supportState);
		}
	} else {
		const node = buildNativeSidebarSection(doc, layout, {
			sectionId: 'gdl-controller-section',
			headerText: controllerSectionHeader(),
			innerId: 'gdl-controller-content',
			innerHtml: renderControllerSidebarHtml(controllerInfo, supportState),
			cloneInnerClass: false,
		});

		if (!node) return null;
		node.dataset.gdlSteamAppId = steamAppId;
		node.dataset.gdlShortcutAppId = shortcutAppId;

		const inner = node.querySelector('#gdl-controller-content') as HTMLElement | null;
		if (inner) {
			inner.dataset.controllerType = controllerInfo.type;
			inner.dataset.controllerState = supportState;
		}

		const clickHandler = (event: Event) => {
			if (getOwnedControllerSidebar(doc, steamAppId, shortcutAppId) !== node) return;
			event.preventDefault();
			event.stopPropagation();
			openControllerConfig(steamAppId, shortcutAppId, doc);
		};
		node.addEventListener('click', clickHandler);
		section = node;
	}

	if (getLinkedSidebarOrder(doc, layout, steamAppId, shortcutAppId)) {
		if (!publishLinkedSidebarSection(doc, layout, section, 'controller')) return null;
	} else {
		if (hasLinkedSidebarOrder(doc)) return null;
		// A standalone controller mount can precede the complete column owner.
		// The full renderer and early paint establish the shared order first.
		const firstTarget = [doc.getElementById('gdl-friends-section'), doc.getElementById('gdl-achievements-section')]
			.find(node => node?.parentElement === sidebarColumn) || null;
		if (firstTarget && section.nextElementSibling !== firstTarget) sidebarColumn.insertBefore(section, firstTarget);
		else if (section.parentElement !== sidebarColumn) sidebarColumn.insertBefore(section, sidebarColumn.firstChild);
	}

	return section;
}

const CONTROLLER_SCROLL_TRANSLUCENCY_THRESHOLD = 2;

function currentControllerScrollTop(doc: Document, section: HTMLElement | null): number {
	if (!section?.isConnected) return 0;
	const view = doc.defaultView;
	let top = Math.max(0, view?.scrollY || 0);
	const scrolling = doc.scrollingElement;
	if (scrolling instanceof HTMLElement) top = Math.max(top, Math.max(0, scrolling.scrollTop || 0));

	let current: HTMLElement | null = section;
	while (current && current !== doc.body && current !== doc.documentElement) {
		const style = view?.getComputedStyle(current);
		const overflowY = style?.overflowY || '';
		const scrollable = current.scrollHeight > current.clientHeight + 8
			&& (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' || current.scrollTop > 0);
		if (scrollable) top = Math.max(top, Math.max(0, current.scrollTop || 0));
		current = current.parentElement;
	}

	return top;
}

function updateControllerScrollState(doc: Document, section: HTMLElement | null): void {
	if (!section?.isConnected) return;
	const top = currentControllerScrollTop(doc, section);
	const wasScrolled = section.dataset.gdlControllerScrolled === '1';
	const scrolled = wasScrolled ? top > 0.25 : top >= CONTROLLER_SCROLL_TRANSLUCENCY_THRESHOLD;
	const value = scrolled ? '1' : '0';
	if (section.dataset.gdlControllerScrolled !== value) section.dataset.gdlControllerScrolled = value;
}

function setupControllerScrollTranslucencyWatcher(
	doc: Document,
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
	isCurrent: () => boolean,
	onSection?: (section: HTMLElement | null) => void,
): () => void {
	let frame = 0;
	let disconnected = false;

	const schedule = () => {
		if (disconnected || frame) return;
		const view = doc.defaultView;
		if (!view) return;
		frame = view.requestAnimationFrame(() => {
			frame = 0;
			if (disconnected || !isCurrent()) return;
			const section = syncControllerSidebarSection(doc, layout, steamAppId, shortcutAppId);
			onSection?.(section);
			updateControllerScrollState(doc, section);
		});
	};

	const onScroll = (event: Event) => { if (!isLibrarySidebarNode(event.target)) schedule(); };
	const onResize = () => schedule();
	const observer = new MutationObserver(records => {
		if (records.some(record => record.target === layout.sidebarColumn && Array.from(record.removedNodes)
			.some(node => node instanceof HTMLElement && node.id === 'gdl-controller-section'))) schedule();
	});
	try {
		if (layout.sidebarColumn) observer.observe(layout.sidebarColumn, { childList: true });
	} catch {}
	const view = doc.defaultView;
	view?.addEventListener('scroll', onScroll, true);
	view?.addEventListener('resize', onResize);
	schedule();

	return () => {
		disconnected = true;
		observer.disconnect();
		view?.removeEventListener('scroll', onScroll, true);
		view?.removeEventListener('resize', onResize);
		if (frame && doc.defaultView) doc.defaultView.cancelAnimationFrame(frame);
	};
}

const controllerSidebarOwners = new WeakMap<HTMLElement, object>();
const controllerSidebarWatchers = new WeakMap<Document, (preserveSection?: boolean) => void>();

export function disposeControllerSidebarWatcher(doc: Document, preserveSection = false): void {
	const dispose = controllerSidebarWatchers.get(doc);
	controllerSidebarWatchers.delete(doc);
	dispose?.(preserveSection);
}

export function setupControllerSidebarWatcher(
	doc: Document,
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
	isCurrent: () => boolean,
): () => void {
	disposeControllerSidebarWatcher(doc, true);
	let disposed = false, ownedSection: HTMLElement | null = null;
	const owner = {};
	const current = (): boolean => !disposed && isCurrent();
	const adopt = (section: HTMLElement | null): void => {
		ownedSection = section;
		if (section) controllerSidebarOwners.set(section, owner);
	};
	// Publish Controller and Achievements in their final order in this task,
	// before any browser frame or controller event can expose the sidebar.
	if (current()) {
		adopt(syncControllerSidebarSection(doc, layout, steamAppId, shortcutAppId));
		updateControllerScrollState(doc, ownedSection);
	}
	const scrollCleanup = setupControllerScrollTranslucencyWatcher(doc, layout, steamAppId, shortcutAppId, current, adopt);
	const unsubscribe = subscribeControllerChanges(doc, () => {
		if (!current()) return;
		const section = syncControllerSidebarSection(doc, layout, steamAppId, shortcutAppId);
		adopt(section);
		updateControllerScrollState(doc, section);
	});

	const dispose = (preserveSection = false): void => {
		if (disposed) return;
		disposed = true;
		scrollCleanup();
		unsubscribe();
		if (ownedSection && controllerSidebarOwners.get(ownedSection) === owner) {
			controllerSidebarOwners.delete(ownedSection);
			if (!preserveSection) ownedSection.remove();
		}
		ownedSection = null;
		if (controllerSidebarWatchers.get(doc) === dispose) controllerSidebarWatchers.delete(doc);
	};
	controllerSidebarWatchers.set(doc, dispose);
	return dispose;
}

export interface GameControllerSupport {
	xbox: boolean;
	ps4: boolean;
	ps5: boolean;
}

type ControllerSupportLevel = 0 | 1 | 2 | null;
interface ControllerSupportLevels {
	xbox: ControllerSupportLevel;
	ps4: ControllerSupportLevel;
	ps5: ControllerSupportLevel;
}

function supportLevel(value: unknown): ControllerSupportLevel {
	if (value === 'none') return 0;
	if (value === 'partial') return 1;
	if (value === 'full') return 2;
	return value === 0 || value === 1 || value === 2 ? value : null;
}

function scopedGameOverview(appid: number, doc?: Document): any {
	const view = doc?.defaultView as any;
	const store = view?.appStore || view?.AppStore;
	if (store) {
		if (typeof store.GetAppOverviewByAppID === 'function') return store.GetAppOverviewByAppID(appid);
		if (typeof store.m_mapApps?.get === 'function') return store.m_mapApps.get(appid);
		return null;
	}
	return AppStoreAdapter.getAppOverview(appid);
}

function gameControllerSupportLevels(steamAppId: string, doc?: Document): ControllerSupportLevels {
	const levels: ControllerSupportLevels = { xbox: null, ps4: null, ps5: null };
	const appid = Number(steamAppId);
	if (!Number.isInteger(appid) || appid <= 0) return levels;
	try {
		const overview = scopedGameOverview(appid, doc);
		if (overview) {
			levels.xbox = supportLevel(overview.xbox_controller_support ?? overview.controller_support);
			levels.ps4 = supportLevel(overview.ps4_controller_support);
			levels.ps5 = supportLevel(overview.ps5_controller_support);
		}
	} catch {}
	try {
		const cached = getCachedGameData(String(appid), steamLanguageSync() || 'english')?.data;
		if (cached) {
			const categories = new Set((cached.categories || []).map(category => Number(category.id)));
			const declared = supportLevel(cached.controller_support);
			const metadata: ControllerSupportLevels = {
				xbox: categories.has(28) ? 2 : categories.has(18) ? 1 : declared,
				ps4: categories.has(55) ? 2 : categories.has(56) ? 1 : declared === 0 ? 0 : null,
				ps5: categories.has(57) ? 2 : categories.has(58) ? 1 : declared === 0 ? 0 : null,
			};
			for (const device of ['xbox', 'ps4', 'ps5'] as const) {
				if (levels[device] === null) levels[device] = metadata[device];
			}
		}
	} catch {}
	return levels;
}

export function detectGameControllerSupport(steamAppId: string, doc?: Document): GameControllerSupport {
	const levels = gameControllerSupportLevels(steamAppId, doc);
	return { xbox: Number(levels.xbox) > 0, ps4: Number(levels.ps4) > 0, ps5: Number(levels.ps5) > 0 };
}

export function detectGameControllerSupportState(
	steamAppId: string,
	controllerType: ControllerDeviceType = 'xbox',
	doc?: Document,
): ControllerSupportState {
	const levels = gameControllerSupportLevels(steamAppId, doc);
	const selected = controllerType === 'dualsense' ? levels.ps5
		: controllerType === 'dualshock' ? levels.ps4
			: controllerType === 'xbox' ? levels.xbox
				: Math.max(...Object.values(levels).map(level => level ?? -1));
	if (selected === 2) return 'supported';
	if (selected === 1) return 'partial';
	// Steam may document Xbox support while leaving PlayStation compatibility
	// unknown. Only an explicit absence for every device means unsupported.
	return Object.values(levels).every(level => level === 0) ? 'unsupported' : 'unknown';
}

