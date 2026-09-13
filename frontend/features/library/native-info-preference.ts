import { GAME_INFO_OUTER_CLASS_MODULE, PLAYBAR_CLASS_MODULE } from '../../steam/css';
import { elementsWithCssModuleClass, findNativeInfoButton, hasCssModuleClass, normalizedUiText } from '../../steam/native-dom';
import { gdlText, loc } from '../../steam/localization';
import { isPublicSteamLibraryRoute, libraryRouteIdentity } from './native-route';

const NATIVE_INFO_PREFERENCE_KEY = 'gdl_native_info_panel_expanded';
const MAX_SAMPLE_ATTEMPTS = 12;
const MAX_NATIVE_TOGGLES_PER_ROUTE = 3;
const RETRY_DELAYS_MS = [70, 90, 120, 160, 220, 300, 420, 560, 720, 900];

interface NativeInfoPreferenceState {
	route: string;
	routeChangedAt: number;
	generation: number;
	timer: ReturnType<typeof setTimeout> | null;
	attempts: number;
	toggles: number;
	applying: boolean;
	candidateButton: HTMLElement | null;
	candidatePanel: HTMLElement | null;
	candidateExpanded: boolean | null;
	stableSamples: number;
	lastClickedButton: HTMLElement | null;
	lastClickAt: number;
	appliedButton: HTMLElement | null;
	onClick: (event: Event) => void;
}

const nativeInfoPreferenceStates = new WeakMap<Document, NativeInfoPreferenceState>();

function readNativeInfoPreference(): boolean | null {
	// Info panel must always return to collapsed state when switching or leaving games.
	return false;
}

function writeNativeInfoPreference(_expanded: boolean): void {
	try { localStorage.setItem(NATIVE_INFO_PREFERENCE_KEY, '0'); }
	catch {}
}

function nativeInfoPanel(doc: Document): HTMLElement | null {
	const outer = GAME_INFO_OUTER_CLASS_MODULE();
	const panels = elementsWithCssModuleClass(doc, outer.classes.AppGameInfoContainer).filter(panel =>
		panel.id !== 'gdl-game-info-panel'
		&& !panel.closest('[id^="gdl-"], [data-gdl-game-info-button]'));
	// During a React route commit Steam can briefly retain both games. Acting
	// only after one native panel remains prevents toggling the outgoing route.
	return panels.length === 1 ? panels[0] : null;
}

function nativeInfoExpanded(button: HTMLElement, panel: HTMLElement): boolean | null {
	const outer = GAME_INFO_OUTER_CLASS_MODULE();
	const expanded = hasCssModuleClass(panel, outer.classes.AppDetailsExpanded);
	const collapsed = hasCssModuleClass(panel, outer.classes.AppDetailsCollapsed);
	if (expanded !== collapsed) return expanded;

	const ariaExpanded = button.getAttribute('aria-expanded');
	if (ariaExpanded === 'true' || ariaExpanded === 'false') return ariaExpanded === 'true';
	const ariaPressed = button.getAttribute('aria-pressed');
	if (ariaPressed === 'true' || ariaPressed === 'false') return ariaPressed === 'true';
	const playbar = PLAYBAR_CLASS_MODULE();
	if (playbar.classes.MenuActive && hasCssModuleClass(button, playbar.classes.MenuActive)) return true;

	const label = normalizedUiText(button.getAttribute('aria-label') || button.getAttribute('title') || '');
	const show = normalizedUiText(loc('GameAction_ViewDetails', gdlText('show_game_details', 'Show game details')));
	const hide = normalizedUiText(loc('GameAction_ViewDetails_Collapse', gdlText('hide_game_details', 'Hide game details')));
	if (label && label === hide) return true;
	if (label && label === show) return false;
	return null;
}

function resetCandidate(state: NativeInfoPreferenceState): void {
	state.candidateButton = null;
	state.candidatePanel = null;
	state.candidateExpanded = null;
	state.stableSamples = 0;
}

function resetRoute(state: NativeInfoPreferenceState, route: string): void {
	if (state.timer) clearTimeout(state.timer);
	state.timer = null;
	state.route = route;
	state.routeChangedAt = Date.now();
	state.generation += 1;
	state.attempts = 0;
	state.toggles = 0;
	state.lastClickedButton = null;
	state.lastClickAt = 0;
	state.appliedButton = null;
	resetCandidate(state);
}

function retryDelay(attempt: number): number {
	return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function scheduleAttempt(doc: Document, state: NativeInfoPreferenceState, delay: number): void {
	if (state.timer) return;
	const generation = state.generation;
	state.timer = setTimeout(() => {
		state.timer = null;
		if (state.generation !== generation) return;
		attemptPreferenceReconcile(doc, state);
	}, delay);
}

function retryPreferenceReconcile(doc: Document, state: NativeInfoPreferenceState): void {
	state.attempts += 1;
	if (state.attempts >= MAX_SAMPLE_ATTEMPTS) return;
	scheduleAttempt(doc, state, retryDelay(state.attempts));
}

function attemptPreferenceReconcile(doc: Document, state: NativeInfoPreferenceState): void {
	if (!doc.body || doc.hidden || !isPublicSteamLibraryRoute(doc)) return;
	const route = libraryRouteIdentity(doc);
	if (!route || route !== state.route) {
		resetRoute(state, route);
		scheduleAttempt(doc, state, retryDelay(0));
		return;
	}
	// Steam updates the URL before replacing the old AppDetails component. Give
	// that split commit time to finish, then require two identical DOM samples.
	if (Date.now() - state.routeChangedAt < 240) {
		retryPreferenceReconcile(doc, state);
		return;
	}

	const button = findNativeInfoButton(doc);
	const panel = nativeInfoPanel(doc);
	if (!button || !panel) {
		resetCandidate(state);
		retryPreferenceReconcile(doc, state);
		return;
	}
	const actual = nativeInfoExpanded(button, panel);
	if (actual === null) {
		resetCandidate(state);
		retryPreferenceReconcile(doc, state);
		return;
	}

	if (state.candidateButton !== button || state.candidatePanel !== panel || state.candidateExpanded !== actual) {
		state.attempts = 0;
		state.candidateButton = button;
		state.candidatePanel = panel;
		state.candidateExpanded = actual;
		state.stableSamples = 1;
		retryPreferenceReconcile(doc, state);
		return;
	}
	state.stableSamples += 1;
	if (state.stableSamples < 2) {
		retryPreferenceReconcile(doc, state);
		return;
	}

	let preferred = readNativeInfoPreference();
	if (preferred === null) {
		// First run: adopt the settled state currently chosen by the user. Future
		// native routes then share one explicit global preference without changing
		// the already-correct behavior of non-Steam games.
		writeNativeInfoPreference(actual);
		preferred = actual;
	}
	if (actual === preferred) {
		state.appliedButton = button;
		state.attempts = 0;
		return;
	}
	if (state.toggles >= MAX_NATIVE_TOGGLES_PER_ROUTE) return;
	if (state.lastClickedButton === button && Date.now() - state.lastClickAt < 350) {
		retryPreferenceReconcile(doc, state);
		return;
	}

	// Let Steam update its own component and private per-AppID set. We never
	// mutate React-owned classes, heights or content; one native click is the
	// same path used by the user and survives client markup changes better.
	state.applying = true;
	try { button.click(); }
	finally { state.applying = false; }
	state.toggles += 1;
	state.lastClickedButton = button;
	state.lastClickAt = Date.now();
	state.appliedButton = null;
	resetCandidate(state);
	retryPreferenceReconcile(doc, state);
}

function clickedNativeInfoButton(doc: Document, event: Event, state: NativeInfoPreferenceState): void {
	if (state.applying || !isPublicSteamLibraryRoute(doc)) return;
	const target = event.target as Element | null;
	if (!target || typeof target.closest !== 'function') return;
	const button = findNativeInfoButton(doc);
	if (!button || (target !== button && !button.contains(target))) return;
	const panel = nativeInfoPanel(doc);
	if (!panel) return;
	const before = nativeInfoExpanded(button, panel);
	if (before === null) return;

	// Do not propagate expansion to other games. Next route always returns to collapsed.
	writeNativeInfoPreference(false);
	resetRoute(state, libraryRouteIdentity(doc));
}

function ensurePreferenceState(doc: Document): NativeInfoPreferenceState {
	const existing = nativeInfoPreferenceStates.get(doc);
	if (existing) return existing;
	const state: NativeInfoPreferenceState = {
		route: '', routeChangedAt: 0, generation: 0, timer: null, attempts: 0, toggles: 0, applying: false,
		candidateButton: null, candidatePanel: null, candidateExpanded: null, stableSamples: 0,
		lastClickedButton: null, lastClickAt: 0, appliedButton: null,
		onClick: () => {},
	};
	state.onClick = event => clickedNativeInfoButton(doc, event, state);
	doc.addEventListener('click', state.onClick, true);
	nativeInfoPreferenceStates.set(doc, state);
	return state;
}

/** Reconcile only the native information toggle. All metadata, layout and DOM
 * ownership remain with Steam; linked/non-Steam routes never enter this path. */
export function reconcileNativeInfoPreference(doc: Document): void {
	if (!doc.body || !isPublicSteamLibraryRoute(doc)) return;
	const state = ensurePreferenceState(doc);
	const route = libraryRouteIdentity(doc);
	if (!route) return;
	if (state.route !== route) resetRoute(state, route);
	if (state.appliedButton?.isConnected && state.route === route && !state.timer) return;

	const preferred = readNativeInfoPreference();
	const button = findNativeInfoButton(doc);
	const panel = button ? nativeInfoPanel(doc) : null;
	const actual = button && panel ? nativeInfoExpanded(button, panel) : null;
	if (preferred !== null && actual === preferred && state.appliedButton === button) return;
	scheduleAttempt(doc, state, retryDelay(0));
}

export function disposeNativeInfoPreference(doc: Document): void {
	const state = nativeInfoPreferenceStates.get(doc);
	if (!state) return;
	if (state.timer) clearTimeout(state.timer);
	doc.removeEventListener('click', state.onClick, true);
	nativeInfoPreferenceStates.delete(doc);
}
