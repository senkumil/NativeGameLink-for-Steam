import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { getCachedGameData } from '../../core/game-data';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { gdlText, loc, steamLanguageSync } from '../../steam/localization';
import { ensureControllerStyles } from './styles/controller';
import { buildNativeSidebarSection, type NativeLibraryLayout } from './layout';
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

function getSteamControllerStore(doc?: Document): any {
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const candidates = [
			typeof window !== 'undefined' ? window : null,
			win,
			(win as any)?.opener,
			(win as any)?.top,
			(win as any)?.parent,
		];
		for (const w of candidates) {
			if (w?.ControllerStore) return w.ControllerStore;
			if (w?.controllerStore) return w.controllerStore;
		}
	} catch {}
	return null;
}

function getSteamUIStore(doc?: Document): any {
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const candidates = [
			typeof window !== 'undefined' ? window : null,
			win,
			(win as any)?.opener,
			(win as any)?.top,
			(win as any)?.parent,
		];
		for (const w of candidates) {
			if (w?.SteamUIStore) return w.SteamUIStore;
			if (w?.steamUIStore) return w.steamUIStore;
		}
	} catch {}
	return null;
}

function classifyGamepadId(rawId: string): ControllerDeviceType {
	const id = (rawId || '').toLowerCase();
	if (id.includes('dualsense') || id.includes('0ce6') || id.includes('0df2') || (id.includes('ps5') && !id.includes('xinput'))) {
		return 'dualsense';
	}
	if (id.includes('dualshock') || id.includes('05c4') || id.includes('09cc') || (id.includes('ps4') && !id.includes('xinput'))) {
		return 'dualshock';
	}
	if (id.includes('playstation') || id.includes('sony') || id.includes('054c')) {
		return 'dualsense';
	}
	if (id.includes('switch') || id.includes('nintendo') || id.includes('joy-con') || id.includes('057e') || id.includes('pro controller')) {
		return 'switch';
	}
	if (id.includes('xbox') || id.includes('xinput') || id.includes('045e') || id.includes('microsoft')) {
		return 'xbox';
	}
	return 'xbox';
}

function classifySteamControllerType(eType: number, name: string): ControllerDeviceType {
	if (eType === 45 || eType === 48) return 'dualsense';
	if (eType === 33 || eType === 34 || eType === 47) return 'dualshock';
	if (eType === 38 || eType === 39 || eType === 40 || eType === 41 || eType === 42 || eType === 44 || eType === 51) return 'switch';
	if (eType === 31 || eType === 32 || eType === 46 || eType === 49 || eType === 50) return 'xbox';
	if (eType === 4 || eType === 100 || eType === 101 || eType === 102 || eType === 120 || eType === 130) return 'xbox';
	return classifyGamepadId(name);
}

interface ActiveControllerTracker {
	type: ControllerDeviceType;
	name: string;
	timestamp: number;
}

let g_lastActiveController: ActiveControllerTracker | null = null;
let g_knownGamepadIds = new Set<string>();

interface ScoredCandidate {
	connected: boolean;
	name: string;
	type: ControllerDeviceType;
	score: number;
	hasInput: boolean;
	timestamp: number;
}

function getWebGamepadCandidates(doc?: Document): ScoredCandidate[] {
	const candidates: ScoredCandidate[] = [];
	try {
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const navList = [
			typeof navigator !== 'undefined' ? navigator : null,
			win?.navigator,
			(win as any)?.opener?.navigator,
			(win as any)?.top?.navigator,
		].filter(Boolean);

		const seenPads = new Set<string>();

		for (const nav of navList) {
			const gamepads = typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
			for (let i = 0; i < gamepads.length; i++) {
				const gp = gamepads[i];
				if (!gp || gp.connected !== true) continue;

				const key = `${i}_${gp.id}`;
				if (seenPads.has(key)) continue;
				seenPads.add(key);

				const buttons = gp.buttons || [];
				const hasButtonPressed = buttons.some((b: any) => b && (b.pressed || (typeof b.value === 'number' && b.value > 0.25)));
				const axes = gp.axes || [];
				const hasAxisMoved = axes.some((a: any) => typeof a === 'number' && Math.abs(a) > 0.25);
				const hasInput = hasButtonPressed || hasAxisMoved;

				const type = classifyGamepadId(gp.id || '');
				const timestamp = typeof gp.timestamp === 'number' ? gp.timestamp : 0;

				let score = timestamp;
				if (hasInput) {
					score += 1_000_000_000;
				}

				candidates.push({
					connected: true,
					name: gp.id || 'Controller',
					type,
					score,
					hasInput,
					timestamp,
				});
			}
		}
	} catch {}
	return candidates;
}

function getSteamCandidates(doc?: Document): ScoredCandidate[] {
	const candidates: ScoredCandidate[] = [];
	try {
		const uiStore = getSteamUIStore(doc);
		const ctrlStore = getSteamControllerStore(doc);

		const mostRecent = uiStore?.MostRecentlyActiveController;
		if (mostRecent && isSteamControllerConnected(mostRecent)) {
			const eType = Number(mostRecent.eControllerType || 0);
			const type = classifySteamControllerType(eType, mostRecent.strName || '');
			candidates.push({
				connected: true,
				name: mostRecent.strName || 'Controller',
				type,
				score: 500_000_000,
				hasInput: true,
				timestamp: 0,
			});
		}

		const activeIdx = uiStore?.MostRecentlyActiveControllerIndex
			?? uiStore?.ActiveControllerIndex
			?? ctrlStore?.m_nLastValidActiveControllerIndex
			?? -1;

		if (typeof activeIdx === 'number' && activeIdx >= 0 && ctrlStore?.GetController) {
			const ctrl = ctrlStore.GetController(activeIdx);
			if (ctrl && isSteamControllerConnected(ctrl)) {
				const eType = Number(ctrl.eControllerType || 0);
				const type = classifySteamControllerType(eType, ctrl.strName || '');
				candidates.push({
					connected: true,
					name: ctrl.strName || 'Controller',
					type,
					score: 400_000_000,
					hasInput: true,
					timestamp: 0,
				});
			}
		}

		if (ctrlStore) {
			const list = typeof ctrlStore.GetControllers === 'function' ? ctrlStore.GetControllers() : ctrlStore.m_controllerList;
			if (Array.isArray(list)) {
				const candidate = list.find(isSteamControllerConnected);
				if (candidate) {
					const eType = Number(candidate.eControllerType || 0);
					const type = classifySteamControllerType(eType, candidate.strName || '');
					candidates.push({
						connected: true,
						name: candidate.strName || 'Controller',
						type,
						score: 200_000_000,
						hasInput: Boolean(candidate.bActive || candidate.m_bActive),
						timestamp: 0,
					});
				}
				for (const ctrl of list) {
					if (!isSteamControllerConnected(ctrl)) continue;
					const eType = Number(ctrl.eControllerType || 0);
					const type = classifySteamControllerType(eType, ctrl.strName || '');
					const isActive = Boolean(ctrl.bActive || ctrl.m_bActive);
					candidates.push({
						connected: true,
						name: ctrl.strName || 'Controller',
						type,
						score: isActive ? 300_000_000 : 100_000,
						hasInput: isActive,
						timestamp: 0,
					});
				}
			}
		}

		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const steamInput = (win as any)?.SteamClient?.Input || (typeof window !== 'undefined' ? (window as any).SteamClient?.Input : null);
		if (steamInput) {
			const list = (typeof steamInput.GetControllers === 'function' ? steamInput.GetControllers() : null)
				|| (typeof steamInput.GetConnectedControllers === 'function' ? steamInput.GetConnectedControllers() : null)
				|| steamInput.m_rgControllers
				|| steamInput.m_controllerList
				|| steamInput.m_controllers;
			if (Array.isArray(list)) {
				for (const ctrl of list) {
					if (!isSteamControllerConnected(ctrl)) continue;
					const eType = Number(ctrl.eControllerType || 0);
					const type = classifySteamControllerType(eType, ctrl.strName || '');
					candidates.push({
						connected: true,
						name: ctrl.strName || 'Controller',
						type,
						score: 50_000,
						hasInput: false,
						timestamp: 0,
					});
				}
			}
		}
	} catch {}
	return candidates;
}

export function detectConnectedController(doc?: Document): ConnectedControllerInfo {
	const webCandidates = getWebGamepadCandidates(doc);
	const steamCandidates = getSteamCandidates(doc);

	// 1. Check for active physical button/axis input right now (highest priority)
	const activeWeb = webCandidates.find(c => c.hasInput);
	if (activeWeb) {
		g_lastActiveController = {
			type: activeWeb.type,
			name: activeWeb.name,
			timestamp: activeWeb.timestamp,
		};
		return { connected: true, name: activeWeb.name, type: activeWeb.type };
	}

	// 2. Check Steam's most recently active controller
	const activeSteam = steamCandidates.find(c => c.hasInput);
	if (activeSteam) {
		const stillConnected = webCandidates.some(c => c.type === activeSteam.type)
			|| steamCandidates.some(c => c.type === activeSteam.type);
		if (stillConnected) {
			g_lastActiveController = {
				type: activeSteam.type,
				name: activeSteam.name,
				timestamp: Date.now(),
			};
			return { connected: true, name: activeSteam.name, type: activeSteam.type };
		}
	}

	// 3. If we had a previously active controller and it is STILL CONNECTED, preserve it across idle moments
	if (g_lastActiveController) {
		const isStillInWeb = webCandidates.some(c => c.type === g_lastActiveController?.type);
		const isStillInSteam = steamCandidates.some(c => c.type === g_lastActiveController?.type);
		if (isStillInWeb || isStillInSteam) {
			return {
				connected: true,
				name: g_lastActiveController.name,
				type: g_lastActiveController.type,
			};
		}
		g_lastActiveController = null;
	}

	// 4. If Web Gamepads are connected, pick the one with highest score/timestamp
	if (webCandidates.length > 0) {
		webCandidates.sort((a, b) => b.score - a.score);
		const best = webCandidates[0];
		g_lastActiveController = {
			type: best.type,
			name: best.name,
			timestamp: best.timestamp,
		};
		return { connected: true, name: best.name, type: best.type };
	}

	// 5. If Steam has connected controllers, pick the best candidate
	if (steamCandidates.length > 0) {
		steamCandidates.sort((a, b) => b.score - a.score);
		const best = steamCandidates[0];
		g_lastActiveController = {
			type: best.type,
			name: best.name,
			timestamp: Date.now(),
		};
		return { connected: true, name: best.name, type: best.type };
	}

	// 6. Generic Steam fallback indicators
	try {
		const store = getSteamControllerStore(doc);
		if (typeof store?.BHasExternalGamepadConnected === 'function' && store.BHasExternalGamepadConnected()) {
			return { connected: true, name: 'Controller', type: 'xbox' };
		}
		const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
		const steamInput = (win as any)?.SteamClient?.Input || (typeof window !== 'undefined' ? (window as any).SteamClient?.Input : null);
		if (steamInput) {
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
		const webCandidates = getWebGamepadCandidates(doc);

		// If a new controller was just plugged in or powered on, prioritize it
		for (const cand of webCandidates) {
			const idKey = `${cand.name}_${cand.type}`;
			if (!g_knownGamepadIds.has(idKey)) {
				g_lastActiveController = {
					type: cand.type,
					name: cand.name,
					timestamp: cand.timestamp,
				};
				break;
			}
		}
		g_knownGamepadIds = new Set(webCandidates.map(c => `${c.name}_${c.type}`));

		const current = detectConnectedController(doc);
		if (current.connected !== lastState.connected || current.type !== lastState.type || current.name !== lastState.name) {
			lastState = current;
			onChange(current);
		}
	};

	check();

	const onGamepadConnected = (e: any) => {
		const gp = e?.gamepad;
		if (gp && gp.connected !== false) {
			const type = classifyGamepadId(gp.id || '');
			g_lastActiveController = {
				type,
				name: gp.id || 'Controller',
				timestamp: typeof gp.timestamp === 'number' ? gp.timestamp : Date.now(),
			};
		}
		check();
		setTimeout(check, 30);
		setTimeout(check, 100);
		setTimeout(check, 250);
	};

	const onGamepadDisconnected = (e: any) => {
		const gp = e?.gamepad;
		if (gp && g_lastActiveController) {
			const type = classifyGamepadId(gp.id || '');
			if (g_lastActiveController.type === type) {
				g_lastActiveController = null;
			}
		}
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

	let fastTimer: any = null;
	// Fast polling (120ms) ensures instant real-time response when switching between controllers
	fastTimer = setInterval(check, 120);
	timer = setInterval(check, 1000);

	return () => {
		for (const target of targets) {
			try {
				target.removeEventListener('gamepadconnected', onGamepadConnected as EventListener);
				target.removeEventListener('gamepaddisconnected', onGamepadDisconnected as EventListener);
			} catch {}
		}
		if (fastTimer) clearInterval(fastTimer);
		if (timer) clearInterval(timer);
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
		return loc('AppDetailsControllerSection_SteamInput', gdlText('controller_steam_input_desc', 'Steam Input is enabled for this device.'));
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
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
): HTMLElement | null {
	const { sidebarColumn } = layout;
	if (!sidebarColumn || !sidebarColumn.isConnected) return null;

	const controllerInfo = detectConnectedController(doc);
	let section = doc.getElementById('gdl-controller-section');

	if (!controllerInfo.connected) {
		if (section) {
			section.remove();
		}
		return null;
	}

	const supportState = detectGameControllerSupportState(steamAppId, controllerInfo.type, doc);
	ensureControllerStyles(doc);

	if (section) {
		const inner = doc.getElementById('gdl-controller-content');
		if (inner && (inner.dataset.controllerType !== controllerInfo.type || inner.dataset.controllerState !== supportState)) {
			inner.dataset.controllerType = controllerInfo.type;
			inner.dataset.controllerState = supportState;
			inner.innerHTML = renderControllerSidebarHtml(controllerInfo, supportState);
		}
		return section;
	}

	const node = buildNativeSidebarSection(doc, layout, {
		sectionId: 'gdl-controller-section',
		headerText: controllerSectionHeader(),
		innerId: 'gdl-controller-content',
		innerHtml: renderControllerSidebarHtml(controllerInfo, supportState),
		cloneInnerClass: false,
	});

	if (!node) return null;

	const inner = node.querySelector('#gdl-controller-content') as HTMLElement | null;
	if (inner) {
		inner.dataset.controllerType = controllerInfo.type;
		inner.dataset.controllerState = supportState;
	}

	const clickHandler = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		openControllerConfig(steamAppId, shortcutAppId);
	};
	node.addEventListener('click', clickHandler);

	const firstTarget = doc.getElementById('gdl-friends-section')
		|| doc.getElementById('gdl-achievements-section')
		|| sidebarColumn.firstChild;

	if (firstTarget && firstTarget !== node) {
		sidebarColumn.insertBefore(node, firstTarget);
	} else {
		sidebarColumn.appendChild(node);
	}

	return node;
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
	section.dataset.gdlControllerScrolled = scrolled ? '1' : '0';
}

function setupControllerScrollTranslucencyWatcher(
	doc: Document,
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
	isCurrent: () => boolean,
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
			updateControllerScrollState(doc, section);
		});
	};

	const onScroll = () => schedule();
	const onResize = () => schedule();
	const observer = new MutationObserver(() => schedule());
	try {
		if (doc.body) observer.observe(doc.body, { childList: true, subtree: true });
	} catch {}
	window.addEventListener('scroll', onScroll, true);
	window.addEventListener('resize', onResize);
	schedule();

	return () => {
		disconnected = true;
		observer.disconnect();
		window.removeEventListener('scroll', onScroll, true);
		window.removeEventListener('resize', onResize);
		if (frame && doc.defaultView) doc.defaultView.cancelAnimationFrame(frame);
	};
}

export function setupControllerSidebarWatcher(
	doc: Document,
	layout: NativeLibraryLayout,
	steamAppId: string,
	shortcutAppId: string | null,
	isCurrent: () => boolean,
): () => void {
	const scrollCleanup = setupControllerScrollTranslucencyWatcher(doc, layout, steamAppId, shortcutAppId, isCurrent);
	const unsubscribe = subscribeControllerChanges(doc, () => {
		if (!isCurrent()) return;
		const section = syncControllerSidebarSection(doc, layout, steamAppId, shortcutAppId);
		updateControllerScrollState(doc, section);
	});

	return () => {
		scrollCleanup();
		unsubscribe();
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

export function detectGameControllerSupportState(
	steamAppId: string,
	controllerType: ControllerDeviceType = 'xbox',
	doc?: Document,
): ControllerSupportState {
	const numId = Number(steamAppId);
	if (!Number.isFinite(numId) || numId <= 0) return 'unknown';

	const support = detectGameControllerSupport(steamAppId, doc);

	try {
		const overview = AppStoreAdapter.getAppOverview(numId);
		if (overview) {
			const xSupport = Number(overview.xbox_controller_support ?? (overview.controller_support === 'none' ? 0 : -1));
			if (xSupport === 0 && !support.xbox && !support.ps4 && !support.ps5) {
				return 'unsupported';
			}
		}
	} catch {}

	try {
		const lang = steamLanguageSync() || 'english';
		const cached = getCachedGameData(String(numId), lang)?.data;
		if (cached && cached.categories && cached.categories.length > 0) {
			const catIds = new Set((cached.categories || []).map(c => Number(c.id)));
			const hasAnyControllerCat = catIds.has(28) || catIds.has(18) || catIds.has(55) || catIds.has(56) || catIds.has(57) || catIds.has(58);
			if (!hasAnyControllerCat && (cached.controller_support === 'none' || !cached.controller_support)) {
				return 'unsupported';
			}
		}
	} catch {}

	if (controllerType === 'dualsense') {
		if (support.ps5) return 'supported';
		return 'unknown';
	}

	if (controllerType === 'dualshock') {
		if (support.ps4) return 'supported';
		return 'unknown';
	}

	if (controllerType === 'xbox') {
		if (support.xbox) return 'supported';
		return 'unknown';
	}

	if (support.xbox || support.ps4 || support.ps5) {
		return 'supported';
	}

	return 'unknown';
}

