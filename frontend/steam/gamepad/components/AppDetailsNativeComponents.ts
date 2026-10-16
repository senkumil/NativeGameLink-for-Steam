import type { ComponentType } from 'react';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { getNativeWindowInstance } from '../../native-window-store';
import { mappings, shortcutMappingKey } from '../../../core/mappings';
import { isCurrentLinkedGamepadTarget, normalizeGamepadAppId } from '../GamepadContext';
import { steamUIModeService } from '../../ui/SteamUIModeService';
import { clearAppDetailsGuards, ensureAppDetailsStoreGuarded, releaseAppDetailsGuards, restoreNativeAchievementState } from './NativeAchievementOwnership';
export { ensureAppDetailsStoreGuarded, registerNativeAchievementStateRestore, restoreNativeAchievementState } from './NativeAchievementOwnership';

export interface NativeFriendsProps { details: { unAppID: number } }

export interface NativeActivityFeedProps {
	appid: number;
	showTextBox?: boolean;
}

export interface NativeCommunityProps { appid: number }

interface NativeComponentsRuntimeState {
	document: Document | null;
	identity: object | null;
	valid: boolean;
	values: Record<string, any>;
	disposeListener: () => void;
}
const componentStates = new WeakMap<Document, NativeComponentsRuntimeState>();
const activeComponentStates = new Set<NativeComponentsRuntimeState>();
function disposeComponentState(state: NativeComponentsRuntimeState): void {
	if (!state.valid) return;
	state.valid = false;
	state.disposeListener();
	activeComponentStates.delete(state);
	if (state.document) {
		if (componentStates.get(state.document) === state) componentStates.delete(state.document);
		restoreNativeAchievementState(undefined, state.document);
		releaseAppDetailsGuards(state.document);
	}
	state.values = {};
}
function ensureNativeComponentsRuntime(doc?: Document): NativeComponentsRuntimeState {
	const target = doc || (typeof document !== 'undefined' ? document : null);
	const view = target?.defaultView;
	if (!target || !view || view.closed || view.document !== target || !target.body?.isConnected) {
		return { document: null, identity: null, valid: false, values: {}, disposeListener: () => {} };
	}
	steamWebpackRuntime.captureRuntime(target);
	const identity = steamWebpackRuntime.getRuntimeIdentity(target);
	for (const previous of Array.from(activeComponentStates)) {
		if (previous.document !== target && previous.document?.defaultView === view) disposeComponentState(previous);
	}
	let state = componentStates.get(target);
	if (state?.identity === identity && state.valid) return state;
	if (state) disposeComponentState(state);
	state = { document: target, identity, valid: true, values: { navContext: null, cachedControllerIconsMissAt: 0 }, disposeListener: () => {} };
	componentStates.set(target, state);
	activeComponentStates.add(state);
	const owned = state;
	const unload = () => disposeComponentState(owned);
	view.addEventListener?.('beforeunload', unload);
	state.disposeListener = () => view.removeEventListener?.('beforeunload', unload);
	return state;
}
function isCurrentComponentState(state: NativeComponentsRuntimeState): boolean {
	const doc = state.document, view = doc?.defaultView;
	return Boolean(state.valid && doc && view && !view.closed && view.document === doc && doc.body?.isConnected
		&& componentStates.get(doc) === state && steamWebpackRuntime.getRuntimeIdentity(doc) === state.identity);
}

export function resolveNativeFriendsComponent(doc?: Document): ComponentType<NativeFriendsProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedFriendsComponent !== undefined) return cache.cachedFriendsComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.w4 === 'function' && typeof exp.gr === 'function' && typeof exp.oG === 'function') {
			cache.cachedFriendsComponent = exp.w4 as ComponentType<NativeFriendsProps>;
			backendLog(`[NGL][Gamepad] Resolved native Friends component from module ${module.id}`);
			return cache.cachedFriendsComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(2326);
			if (exp && typeof exp.w4 === 'function' && typeof exp.gr === 'function') {
				cache.cachedFriendsComponent = exp.w4 as ComponentType<NativeFriendsProps>;
				backendLog(`[NGL][Gamepad] Resolved native Friends component by requiring module 2326`);
				return cache.cachedFriendsComponent;
			}
		} catch {}
	}
	cache.cachedFriendsComponent = null;
	return null;
}

export function resolveNativeActivityComponent(doc?: Document): ComponentType<NativeActivityFeedProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedActivityComponent !== undefined) return cache.cachedActivityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.W === 'function' && typeof exp.M === 'function' && Object.keys(exp).length === 2) {
			cache.cachedActivityComponent = exp.W as ComponentType<NativeActivityFeedProps>;
			backendLog(`[NGL][Gamepad] Resolved native Activity component from module ${module.id}`);
			return cache.cachedActivityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(80478);
			if (exp && typeof exp.W === 'function' && typeof exp.M === 'function') {
				cache.cachedActivityComponent = exp.W as ComponentType<NativeActivityFeedProps>;
				backendLog(`[NGL][Gamepad] Resolved native Activity component by requiring module 80478`);
				return cache.cachedActivityComponent;
			}
		} catch {}
	}
	cache.cachedActivityComponent = null;
	return null;
}

export interface NativePostTextEntryProps {
	className?: string;
	placeholder?: string;
	OnPostClicked?: (text: string) => void;
	onFocus?: (e: any) => void;
	onBlur?: (e: any) => void;
	[key: string]: any;
}

export function resolveNativePostTextEntryComponent(doc?: Document): ComponentType<NativePostTextEntryProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedPostTextEntryComponent !== undefined) return cache.cachedPostTextEntryComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.K === 'function' && exp.K.prototype?.OnPostClicked && exp.K.prototype?.InsertEmoticon) {
			cache.cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
			backendLog(`[NGL][Gamepad] Resolved native PostTextEntry component from module ${module.id}`);
			return cache.cachedPostTextEntryComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(12975);
			if (exp && typeof exp.K === 'function' && exp.K.prototype?.OnPostClicked) {
				cache.cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
				backendLog(`[NGL][Gamepad] Resolved native PostTextEntry component by requiring module 12975`);
				return cache.cachedPostTextEntryComponent;
			}
		} catch {}
		if (typeof req.e === 'function') {
			req.e(8732).then(() => {
				if (!isCurrentComponentState(state)) return;
				try {
					const exp = req(12975);
					if (exp && typeof exp.K === 'function') {
						cache.cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
						backendLog('[NGL][Gamepad] Asynchronously loaded native PostTextEntry component from chunk 8732');
					}
				} catch {}
			}).catch(() => {});
		}
	}
	cache.cachedPostTextEntryComponent = null;
	return null;
}

export function resolveNativeFocusableTextarea(doc?: Document): ComponentType<any> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedFocusableTextarea !== undefined) return cache.cachedFocusableTextarea;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.dO === 'function' && typeof exp.BA === 'function') {
			cache.cachedFocusableTextarea = exp.dO;
			backendLog(`[NGL][Gamepad] Resolved native Focusable textarea from module ${module.id}`);
			return cache.cachedFocusableTextarea;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(90242);
			if (exp && typeof exp.dO === 'function') {
				cache.cachedFocusableTextarea = exp.dO;
				backendLog('[NGL][Gamepad] Resolved native Focusable textarea by requiring module 90242');
				return cache.cachedFocusableTextarea;
			}
		} catch {}
	}
	cache.cachedFocusableTextarea = null;
	return null;
}

export function resolveNativeCommunityComponent(doc?: Document): ComponentType<NativeCommunityProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedCommunityComponent !== undefined) return cache.cachedCommunityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.wb === 'function' && typeof exp.kB === 'function' && Object.keys(exp).length === 2) {
			cache.cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
			backendLog(`[NGL][Gamepad] Resolved native Community component from module ${module.id}`);
			return cache.cachedCommunityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(77163);
			if (exp && typeof exp.wb === 'function' && typeof exp.kB === 'function') {
				cache.cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
				backendLog(`[NGL][Gamepad] Resolved native Community component by requiring module 77163`);
				return cache.cachedCommunityComponent;
			}
		} catch {}
		if (req.m) {
			for (const id of Object.keys(req.m)) {
				try {
					const fnStr = req.m[id]?.toString?.() || '';
					if (fnStr.includes('wb:') && fnStr.includes('kB:') && (fnStr.includes('CommunityContentContainer') || fnStr.includes('PlayVideo'))) {
						const exp = req(id);
						if (exp && typeof exp.wb === 'function') {
							cache.cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
							backendLog(`[NGL][Gamepad] Resolved native Community component from factory ${id}`);
							return cache.cachedCommunityComponent;
						}
					}
				} catch {}
			}
		}
	}
	cache.cachedCommunityComponent = null;
	return null;
}

export interface NativeTradingCardProps {
	data: {
		strTitle: string;
		strImgURL: string;
		strArtworkURL?: string;
		nOwned?: number;
		strMarketHash?: string;
	};
	bMaxed?: boolean;
	bClickable?: boolean;
	animateHover?: boolean;
	cardScale?: number;
	className?: string;
}

export function resolveNativeTradingCardComponent(doc?: Document): ComponentType<NativeTradingCardProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedTradingCardComponent !== undefined) return cache.cachedTradingCardComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidates = [module.exports, module.exports?.default, ...(module.exports && typeof module.exports === 'object' ? Object.values(module.exports) : [])];
		for (const exp of candidates) {
			if (exp && typeof exp === 'object' && typeof exp.dI === 'function' && typeof exp.LB === 'function' && typeof exp.on === 'function') {
				cache.cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
				backendLog(`[NGL][Gamepad] Resolved native TradingCard component from module ${module.id}`);
				return cache.cachedTradingCardComponent;
			}
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(22165);
			if (exp && typeof exp.dI === 'function') {
				cache.cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
				backendLog(`[NGL][Gamepad] Resolved native TradingCard component by requiring module 22165`);
				return cache.cachedTradingCardComponent;
			}
		} catch {}
		if (req.m) {
			for (const id of Object.keys(req.m)) {
				try {
					const fnStr = req.m[id]?.toString?.() || '';
					if (fnStr.includes('dI:') && fnStr.includes('LB:') && fnStr.includes('on:')) {
						const exp = req(id);
						if (exp && typeof exp.dI === 'function') {
							cache.cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
							backendLog(`[NGL][Gamepad] Resolved native TradingCard component from factory ${id}`);
							return cache.cachedTradingCardComponent;
						}
					}
				} catch {}
			}
		}
	}
	cache.cachedTradingCardComponent = null;
	return null;
}

export interface NativeDLCProps {
	details: any;
	showRemainder?: boolean;
}

export interface NativeScreenshotsProps {
	overview: any;
	details: any;
}

export interface NativeReviewProps { details: any; overview: any }

export interface NativeNotesProps { overview: any; details: any }

export interface NativeWorkshopProps { details: any }

export function resolveNativeDLCComponent(doc?: Document): ComponentType<NativeDLCProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedDLCComponent !== undefined) return cache.cachedDLCComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(3651);
			if (exp && typeof exp.Kf === 'function') {
				cache.cachedDLCComponent = exp.Kf as ComponentType<NativeDLCProps>;
				return cache.cachedDLCComponent;
			}
		} catch {}
	}
	cache.cachedDLCComponent = null;
	return null;
}

export function resolveNativeScreenshotsComponent(doc?: Document): ComponentType<NativeScreenshotsProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedScreenshotsComponent !== undefined) return cache.cachedScreenshotsComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(57150);
			if (exp && typeof exp.E === 'function') {
				cache.cachedScreenshotsComponent = exp.E as ComponentType<NativeScreenshotsProps>;
				return cache.cachedScreenshotsComponent;
			}
		} catch {}
	}
	cache.cachedScreenshotsComponent = null;
	return null;
}

export function resolveNativeReviewComponent(doc?: Document): ComponentType<NativeReviewProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedReviewComponent !== undefined) return cache.cachedReviewComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(71333);
			if (exp && typeof exp.h === 'function') {
				cache.cachedReviewComponent = exp.h as ComponentType<NativeReviewProps>;
				return cache.cachedReviewComponent;
			}
		} catch {}
	}
	cache.cachedReviewComponent = null;
	return null;
}

export function resolveNativeNotesComponent(doc?: Document): ComponentType<NativeNotesProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedNotesComponent !== undefined) return cache.cachedNotesComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(9066);
			if (exp && typeof exp.E === 'function') {
				cache.cachedNotesComponent = exp.E as ComponentType<NativeNotesProps>;
				return cache.cachedNotesComponent;
			}
		} catch {}
	}
	cache.cachedNotesComponent = null;
	return null;
}

export function resolveNativeWorkshopComponent(doc?: Document): ComponentType<NativeWorkshopProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedWorkshopComponent !== undefined) return cache.cachedWorkshopComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(81452);
			if (exp && typeof exp.y === 'function') {
				cache.cachedWorkshopComponent = exp.y as ComponentType<NativeWorkshopProps>;
				return cache.cachedWorkshopComponent;
			}
		} catch {}
	}
	cache.cachedWorkshopComponent = null;
	return null;
}

export function resolveNativeAppDetails(doc?: Document, appid?: number): any | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!appid || !state.valid) return null;
	doc = state.document!;
	const req = steamWebpackRuntime.getRequire(doc);
	try {
		const store = req?.(78057)?.H;
		if (typeof store?.GetAppDetails === 'function') return store.GetAppDetails(appid);
	} catch {}
	try { return resolveNativeAppDetailsStore(doc)?.GetAppDetails?.(appid) || null; } catch { return null; }
}
/** Steam's collapsible Game Information surface, with caller-owned overview/details. */
export function resolveNativeGameInfoComponent(doc?: Document): ComponentType<any> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedGameInfoComponent !== undefined) return cache.cachedGameInfoComponent;
	const matches = (candidate: any): boolean => {
		const prototype = candidate?.prototype;
		return Boolean(prototype && typeof prototype.render === 'function' && typeof prototype.OnImageLoad === 'function'
			&& typeof prototype.onCollapseStarted === 'function' && typeof prototype.onCollapseComplete === 'function');
	};
	const req = steamWebpackRuntime.getRequire(doc);
	try {
		const candidate = req?.(15448)?.b;
		if (matches(candidate)) return cache.cachedGameInfoComponent = candidate;
	} catch {}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidate = module.exports?.b;
		if (matches(candidate)) return cache.cachedGameInfoComponent = candidate;
	}
	if (req) for (const { id, factory } of steamWebpackRuntime.getModuleFactories?.(doc) || []) {
		const source = String(factory);
		if (!['OnImageLoad', 'onCollapseStarted', 'onCollapseComplete', 'AppGameInfoContainer', 'GetAssociations'].every(key => source.includes(key))) continue;
		try {
			if (req.m?.[id] !== factory) continue;
			const candidate = req(id)?.b;
			if (matches(candidate)) return cache.cachedGameInfoComponent = candidate;
		} catch {}
	}
	cache.cachedGameInfoComponent = null;
	return null;
}

export function openNativeAchievementsScreen(doc: Document, shortcutAppId: number | string): boolean {
	const appid = normalizeGamepadAppId(shortcutAppId);
	if (appid === null || appid < 2147483648 || !steamUIModeService.isGamepadUI(doc)
		|| !isCurrentLinkedGamepadTarget(doc, appid, mappings[shortcutMappingKey(appid)])) return false;
	steamWebpackRuntime.captureRuntime(doc);
	const view = doc.defaultView as any;

	// 1. Native Webpack WindowStore Navigator
	try {
		const inst = getNativeWindowInstance(doc);
		if (inst) {
			if (typeof inst?.Navigator?.MyAchievements === 'function') {
				inst.Navigator.MyAchievements(appid);
				backendLog(`[NGL][Gamepad] Opened native achievements screen via Navigator for app ${appid}`);
				return true;
			}
		}
	} catch (e) {
		backendLog(`[NGL][Gamepad] WindowStore Navigator failed: ${e}`);
	}

	// 2. React Router / Steam History push
	const route = `/library/app/${appid}/achievements/my/individual`;
	for (const candidate of [
		view?.g_Router?.history,
		view?.g_History,
		view?.g_AppHistory,
	]) {
		if (typeof candidate?.push === 'function') {
			try {
				candidate.push(route);
				backendLog(`[NGL][Gamepad] Opened native achievements screen via Router for app ${appid}`);
				return true;
			} catch (e) {
				backendLog(`[NGL][Gamepad] Router history push failed: ${e}`);
			}
		}
	}

	// 3. Fallback: hash navigation
	try {
		if (view?.location) {
			view.location.hash = `#${route}`;
			return true;
		}
	} catch {}
	return false;
}

function nativeNavContext(exports: any): any | null {
	const context = exports?.TJ, hook = typeof exports?.qp === 'function' ? String(exports.qp) : '', props = typeof exports?.sl === 'function' ? String(exports.sl) : '';
	return context?.$$typeof === Symbol.for('react.context') && context.Provider
		&& hook.includes('navRef') && hook.includes('.RegisterNavigationItem(')
		&& props.includes('navOptions') && props.includes('gamepadEvents') ? context : null;
}
export function getNavContext(doc?: Document): any {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.navContext) return cache.navContext;
	const assign = (exp: any): any => { const nav = nativeNavContext(exp); if (nav) { cache.navContext = nav; cache.focusRingContext = exp.sQ; } return nav; };
	try {
		for (const module of steamWebpackRuntime.getAllModules(doc)) {
			const context = assign(module.exports) || assign(module.exports?.default);
			if (context) return cache.navContext = context;
		}
		const req = steamWebpackRuntime.getRequire(doc), count = steamWebpackRuntime.getModuleFactoryCount(doc);
		if (!req || cache.navFactoryCount === count) return null;
		cache.navFactoryCount = count;
		const seen: Map<string, Function> = cache.navFactories ||= new Map();
		for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
			if (seen.get(id) === factory) continue;
			const source = String(factory);
			if (!/\bTJ\s*:\s*\(\)\s*=>/.test(source) || !source.includes('createContext(null)')
				|| !source.includes('.Tree.CreateNode(') || !source.includes('.RegisterNavigationItem(') || !source.includes('navRef')) {
				seen.set(id, factory); continue;
			}
			try {
				if (req.m?.[id] !== factory) continue;
				const context = assign(req(id)); seen.set(id, factory);
				if (context) return cache.navContext = context;
			} catch {} // A matching module can retry when its dependency chunk arrives.
		}
	} catch {}
	return null;
}
/** Resolve React's committed branch before reading a Provider's memoized value. */
function committedNavFiber(fiber: any): any | null {
	let remaining = 4096;
	const mounted = (value: any): any | null => {
		let node = value, nearest = value;
		while (node && remaining-- > 0) {
			if (!value.alternate && (node.flags & 4098)) nearest = node.return;
			if (!node.return) return node.tag === 3 && node.stateNode?.current ? nearest : null;
			node = node.return;
		} return null;
	};
	const alternate = fiber?.alternate;
	if (!alternate) return mounted(fiber) === fiber ? fiber : null;
	let a = fiber, b = alternate;
	while (a && remaining-- > 0) {
		const parentA = a.return;
		if (!parentA) return a.tag === 3 ? a.stateNode?.current === a ? fiber : a.stateNode?.current === a.alternate ? alternate : null : null;
		const parentB = parentA.alternate;
		if (!parentB) { if (!parentA.return) return null; a = b = parentA.return; continue; }
		if (parentA.child === parentB.child) {
			for (let child = parentA.child; child && remaining-- > 0; child = child.sibling)
				if (child === a || child === b) return mounted(parentA) === parentA ? child === a ? fiber : alternate : null;
			return null;
		}
		if (a.return !== b.return) { a = parentA; b = parentB; }
		else {
			let found = false;
			for (const parent of [parentA, parentB]) {
				for (let child = parent.child; child && remaining-- > 0; child = child.sibling) if (child === a || child === b) {
					const other = parent === parentA ? parentB : parentA;
					if (child === a) { a = parent; b = other; } else { b = parent; a = other; } found = true; break;
				} if (found) break;
			} if (!found) return null;
		} if (a.alternate !== b) return null;
	} return null;
}
export interface NativeNavigationProvider { kind: 'active-tree' | 'manager' | 'focus-window' | 'window-instance' | 'focus-ring' | 'query-client' | 'router-history' | 'service-transport' | 'active-account'; context: any; value: any }
function inheritedNavKind(value: any, tree: any, instance: any, context: any, ring: any): NativeNavigationProvider['kind'] | null {
	if (!value || typeof value !== 'object') return null;
	if (context === ring && ['OnFocus', 'OnBlur', 'OnFocusChange', 'OnForceMeasureFocusRing'].every(key => typeof value[key] === 'function')) return 'focus-ring';
	if (value === tree.Controller && ['NewGamepadNavigationTree', 'CreateContext', 'RegisterGamepadNavigationTree', 'FindContextForRootWindow']
		.every(key => typeof value[key] === 'function')) return 'manager';
	if (value === instance && value.BrowserWindow === tree.Window) return 'window-instance';
	if (value.focusNavWindow === tree.WindowContext && typeof value.bSupportsFocus === 'boolean') return 'focus-window';
	// Native notes/media must reuse the owner's committed QueryClient; another
	// client would split account caches and duplicate subscriptions.
	if (['getQueryCache', 'getMutationCache', 'defaultQueryOptions', 'mount', 'unmount']
		.every(key => typeof value[key] === 'function')) return 'query-client';
	// useHistory also needs the proven owner's exact committed Provider.
	if (typeof value.location?.pathname === 'string'
		&& ['push', 'replace', 'go', 'goBack', 'goForward', 'listen', 'createHref']
			.every(key => typeof value[key] === 'function')) return 'router-history';
	// Native media hooks also consume the owner's service/account Providers.
	if (typeof value.useActiveSteamInterface === 'function' && 'useActiveCMInterface' in value && 'useStorage' in value
		&& ['useActiveCMInterface', 'useStorage'].every(key => value[key] === undefined || typeof value[key] === 'function')) return 'service-transport';
	if (typeof value.useActiveAccount === 'function') return 'active-account';
	return ['bActiveTree', 'bActiveTreeWithinContext', 'bDisableFocusClasses', 'bIsMounted'].every(key => typeof value[key] === 'boolean') ? 'active-tree' : null;
}
export function resolveSteamNav(doc: Document): { navNode: any; navContext: any; providers: NativeNavigationProvider[] } | null {
	const state = ensureNativeComponentsRuntime(doc); if (!state.valid) return null;
	const report = (message: string): void => { if (state.values.navReport !== message) { state.values.navReport = message; backendLog(`[NGL][Gamepad][FocusOwner] ${message}`); } };
	const root = doc.getElementById('gdl-bp-detail-root'), panel = root?.parentElement, context = getNavContext(doc);
	if (!root || !panel?.isConnected || !context
		|| !isCurrentLinkedGamepadTarget(doc, root.dataset.gdlShortcutAppId, root.dataset.gdlSteamAppId)) { if (root && panel?.isConnected) report(`context=${Boolean(context)} linked=${isCurrentLinkedGamepadTarget(doc, root.dataset.gdlShortcutAppId, root.dataset.gdlSteamAppId)}`); return null; }
	const foreign = '[role="dialog"], [aria-modal="true"], .ModalDialogPopup, [class*="ModalPosition"], [class*="QuickAccess"], [class*="MainMenu"]';
	if (panel.closest(foreign)) return null;
	const excluded = '[id^="gdl-"], ' + foreign;
	const candidates = [panel, doc.querySelector('[role="tablist"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"]'), doc.querySelector('[role="tab"][aria-selected="true"]')];
	const diagnostics: string[] = [];
	for (const element of candidates) {
		if (!element || element.ownerDocument !== doc || !element.isConnected || element.closest(excluded)) continue;
		const key = Object.getOwnPropertyNames(element).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
		let fiber = key && committedNavFiber((element as any)[key]), depth = 0, navNode: any = null;
		diagnostics.push(`fiber=${Boolean(fiber)} key=${Boolean(key)}`);
		const inherited: Array<{ context: any; value: any }> = [];
		const seen = new Set<any>();
		while (fiber && depth++ < 384 && !seen.has(fiber)) {
			seen.add(fiber);
			const provider = fiber.type?._context || fiber.type, node = fiber.memoizedProps?.value, tree = node?.Tree;
			if (tree && typeof tree.CreateNode === 'function') diagnostics.push(`ctx=${provider === context} window=${tree.Window === doc.defaultView} rootWindow=${tree.WindowContext?.RootWindow === doc.defaultView} mounted=${tree.SubscribableIsMounted?.Value} owner=${Boolean(node.Element?.contains?.(panel))} native=${!node.Element?.closest?.(excluded)}`);
			if (provider?.$$typeof === Symbol.for('react.context') && provider !== context) inherited.push({ context: provider, value: node });
			if (!navNode && provider === context && tree && typeof tree.CreateNode === 'function' && typeof tree.RegisterNavigationItem === 'function') {
				const owner = node.Element, treeRoot = tree.Root?.Element;
				if (tree.Window === doc.defaultView && tree.WindowContext?.RootWindow === doc.defaultView && tree.SubscribableIsMounted?.Value === true
					&& owner?.ownerDocument === doc && owner.isConnected && !owner.closest(excluded) && owner.contains(panel)
					&& treeRoot?.ownerDocument === doc && treeRoot.isConnected && treeRoot.contains(owner)) navNode = node;
			}
			fiber = committedNavFiber(fiber.return);
		}
		if (navNode) {
			const instance = getNativeWindowInstance(doc), contexts = new Set<any>(), providers: NativeNavigationProvider[] = [];
			for (const entry of inherited) {
				const kind = inheritedNavKind(entry.value, navNode.Tree, instance, entry.context, state.values.focusRingContext);
				if (kind && !contexts.has(entry.context)) { contexts.add(entry.context); providers.push({ ...entry, kind }); }
			} report(`ready providers=${providers.map(entry => entry.kind).join(',')}`); return { navNode, navContext: context, providers };
		}
	} report(`not-ready ${diagnostics.join(';')}`); return null;
}

export interface NativeControllerIcons {
	ControllerStatus?: ComponentType<any>;
	ControllerType?: ComponentType<any>;
	Controller?: ComponentType<any>;
	XboxOneControllerFrontOutline?: ComponentType<any>;
	PS4ControllerFrontOutline?: ComponentType<any>;
	PS5ControllerFrontOutline?: ComponentType<any>;
	FrankenController?: ComponentType<any>;
}

export function resolveNativeControllerIcons(doc?: Document): NativeControllerIcons | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedControllerIcons && cache.cachedControllerIcons !== null) return cache.cachedControllerIcons;
	if (cache.cachedControllerIcons === null && Date.now() - cache.cachedControllerIconsMissAt < 1200) return null;
	steamWebpackRuntime.captureRuntime(doc);

	const assign = (exp: any, source: string): NativeControllerIcons | null => {
		if (!exp || typeof exp.ControllerType !== 'function') return null;
		cache.cachedControllerIcons = {
			ControllerStatus: exp.ControllerStatus,
			ControllerType: exp.ControllerType,
			Controller: exp.Controller,
			XboxOneControllerFrontOutline: exp.XboxOneControllerFrontOutline,
			PS4ControllerFrontOutline: exp.PS4ControllerFrontOutline,
			PS5ControllerFrontOutline: exp.PS5ControllerFrontOutline,
			FrankenController: exp.FrankenController,
		};
		backendLog(`[NGL][Gamepad] Resolved native controller icons ${source}`);
		return cache.cachedControllerIcons;
	};

	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const direct = assign(req(35488), 'from module 35488');
			if (direct) return direct;
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const resolved = assign(module.exports as any, `from module ${module.id}`);
		if (resolved) return resolved;
	}
	cache.cachedControllerIcons = null;
	cache.cachedControllerIconsMissAt = Date.now();
	return null;
}

export function resolveNativeControllerFeatureComponent(doc?: Document): ComponentType<any> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedControllerFeatureComponent !== undefined) return cache.cachedControllerFeatureComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.n$ === 'function' && typeof exp.zX === 'function') {
			cache.cachedControllerFeatureComponent = exp.n$;
			backendLog(`[NGL][Gamepad] Resolved native controller feature component (n$) from module ${module.id}`);
			return cache.cachedControllerFeatureComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(28346);
			if (exp && typeof exp.n$ === 'function') {
				cache.cachedControllerFeatureComponent = exp.n$;
				backendLog(`[NGL][Gamepad] Resolved native controller feature component (n$) by requiring module 28346`);
				return cache.cachedControllerFeatureComponent;
			}
		} catch {}
	}
	cache.cachedControllerFeatureComponent = null;
	return null;
}

export interface NativeAchievementsSectionProps {
	details: { unAppID: number };
}

export function resolveNativeAchievementsSectionComponent(doc?: Document): ComponentType<NativeAchievementsSectionProps> | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedAchievementsSectionComponent) return cache.cachedAchievementsSectionComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(57665);
			if (exp && exp.Jq && (typeof exp.Jq === 'function' || typeof exp.Jq === 'object')) {
				cache.cachedAchievementsSectionComponent = exp.Jq as ComponentType<NativeAchievementsSectionProps>;
				backendLog(`[NGL][Gamepad] Resolved native AchievementsSection component (Jq) by requiring module 57665`);
				return cache.cachedAchievementsSectionComponent;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.Jq && (typeof exp.Jq === 'function' || typeof exp.Jq === 'object') && exp.hs && exp.Tv) {
			cache.cachedAchievementsSectionComponent = exp.Jq as ComponentType<NativeAchievementsSectionProps>;
			backendLog(`[NGL][Gamepad] Resolved native AchievementsSection component (Jq) from module ${module.id}`);
			return cache.cachedAchievementsSectionComponent;
		}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858, doc).catch(() => {});
	}
	return null;
}

export function resolveNativeAppDetailsStore(doc?: Document): any | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedAppDetailsStore) return cache.cachedAppDetailsStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(78057);
			if (exp && exp.H && typeof exp.H.GetAppData === 'function') {
				cache.cachedAppDetailsStore = exp.H;
				ensureAppDetailsStoreGuarded(cache.cachedAppDetailsStore, state.document!);
				backendLog(`[NGL][Gamepad] Resolved native AppDetailsStore by requiring module 78057`);
				return cache.cachedAppDetailsStore;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.H && typeof exp.H.GetAppData === 'function' && typeof exp.H.GetAchievements === 'function') {
			cache.cachedAppDetailsStore = exp.H;
			ensureAppDetailsStoreGuarded(cache.cachedAppDetailsStore, state.document!);
			backendLog(`[NGL][Gamepad] Resolved native AppDetailsStore from module ${module.id}`);
			return cache.cachedAppDetailsStore;
		}
	}
	if (req) for (const { id, factory } of steamWebpackRuntime.getModuleFactories?.(doc) || []) {
		const source = String(factory);
		if (!['GetAppData(', 'GetAssociations(', 'GetDescriptions(', 'RequestDescriptionsData(', 'GetAchievements('].every(key => source.includes(key))) continue;
		try {
			if (req.m?.[id] !== factory) continue;
			const store = req(id)?.H;
			if (typeof store?.GetAppData !== 'function' || typeof store?.GetAchievements !== 'function') continue;
			cache.cachedAppDetailsStore = store;
			ensureAppDetailsStoreGuarded(store, state.document!);
			return store;
		} catch {}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858, doc).catch(() => {});
	}
	return null;
}

export function resolveNativeAchievementStore(doc?: Document): any | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedAchievementStore) return cache.cachedAchievementStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(32179);
			if (exp && exp.p6 && typeof exp.p6.GetMyAchievements === 'function') {
				cache.cachedAchievementStore = exp.p6;
				return cache.cachedAchievementStore;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.p6 && typeof exp.p6.GetMyAchievements === 'function') {
			cache.cachedAchievementStore = exp.p6;
			return cache.cachedAchievementStore;
		}
	}
	return null;
}

export function resolveNativeConfigContext(doc?: Document): any | null {
	const state = ensureNativeComponentsRuntime(doc);
	if (!state.valid) return null;
	doc = state.document!;
	const cache = state.values;
	if (cache.cachedConfigContext !== undefined) return cache.cachedConfigContext;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(72476);
			if (exp && exp.QO) {
				cache.cachedConfigContext = exp.QO;
				return cache.cachedConfigContext;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.QO && exp.ss && exp.Qn) {
			cache.cachedConfigContext = exp.QO;
			return cache.cachedConfigContext;
		}
	}
	cache.cachedConfigContext = null;
	return null;
}

export function clearNativeComponentsCache(doc?: Document): void {
	if (doc) {
		const state = componentStates.get(doc);
		if (state) disposeComponentState(state);
		else { restoreNativeAchievementState(undefined, doc); releaseAppDetailsGuards(doc); }
		return;
	}
	for (const state of Array.from(activeComponentStates)) disposeComponentState(state);
	restoreNativeAchievementState();
	clearAppDetailsGuards();
}
