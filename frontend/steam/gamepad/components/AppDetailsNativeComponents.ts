import type { ComponentType } from 'react';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';

export interface NativeFriendsProps {
	details: { unAppID: number };
}

export interface NativeActivityFeedProps {
	appid: number;
	showTextBox?: boolean;
}

export interface NativeCommunityProps {
	appid: number;
}

let cachedFriendsComponent: ComponentType<NativeFriendsProps> | null | undefined;
let cachedActivityComponent: ComponentType<NativeActivityFeedProps> | null | undefined;
let cachedCommunityComponent: ComponentType<NativeCommunityProps> | null | undefined;

export function resolveNativeFriendsComponent(doc?: Document): ComponentType<NativeFriendsProps> | null {
	if (cachedFriendsComponent !== undefined) return cachedFriendsComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.w4 === 'function' && typeof exp.gr === 'function' && typeof exp.oG === 'function') {
			cachedFriendsComponent = exp.w4 as ComponentType<NativeFriendsProps>;
			backendLog(`[NGL][Gamepad] Resolved native Friends component from module ${module.id}`);
			return cachedFriendsComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(2326);
			if (exp && typeof exp.w4 === 'function' && typeof exp.gr === 'function') {
				cachedFriendsComponent = exp.w4 as ComponentType<NativeFriendsProps>;
				backendLog(`[NGL][Gamepad] Resolved native Friends component by requiring module 2326`);
				return cachedFriendsComponent;
			}
		} catch {}
	}
	cachedFriendsComponent = null;
	return null;
}

export function resolveNativeActivityComponent(doc?: Document): ComponentType<NativeActivityFeedProps> | null {
	if (cachedActivityComponent !== undefined) return cachedActivityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.W === 'function' && typeof exp.M === 'function' && Object.keys(exp).length === 2) {
			cachedActivityComponent = exp.W as ComponentType<NativeActivityFeedProps>;
			backendLog(`[NGL][Gamepad] Resolved native Activity component from module ${module.id}`);
			return cachedActivityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(80478);
			if (exp && typeof exp.W === 'function' && typeof exp.M === 'function') {
				cachedActivityComponent = exp.W as ComponentType<NativeActivityFeedProps>;
				backendLog(`[NGL][Gamepad] Resolved native Activity component by requiring module 80478`);
				return cachedActivityComponent;
			}
		} catch {}
	}
	cachedActivityComponent = null;
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

let cachedPostTextEntryComponent: ComponentType<NativePostTextEntryProps> | null | undefined;
let cachedFocusableTextarea: ComponentType<any> | null | undefined;

export function resolveNativePostTextEntryComponent(doc?: Document): ComponentType<NativePostTextEntryProps> | null {
	if (cachedPostTextEntryComponent !== undefined) return cachedPostTextEntryComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.K === 'function' && exp.K.prototype?.OnPostClicked && exp.K.prototype?.InsertEmoticon) {
			cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
			backendLog(`[NGL][Gamepad] Resolved native PostTextEntry component from module ${module.id}`);
			return cachedPostTextEntryComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(12975);
			if (exp && typeof exp.K === 'function' && exp.K.prototype?.OnPostClicked) {
				cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
				backendLog(`[NGL][Gamepad] Resolved native PostTextEntry component by requiring module 12975`);
				return cachedPostTextEntryComponent;
			}
		} catch {}
		if (typeof req.e === 'function') {
			req.e(8732).then(() => {
				try {
					const exp = req(12975);
					if (exp && typeof exp.K === 'function') {
						cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
						backendLog('[NGL][Gamepad] Asynchronously loaded native PostTextEntry component from chunk 8732');
					}
				} catch {}
			}).catch(() => {});
		}
	}
	cachedPostTextEntryComponent = null;
	return null;
}

export function resolveNativeFocusableTextarea(doc?: Document): ComponentType<any> | null {
	if (cachedFocusableTextarea !== undefined) return cachedFocusableTextarea;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.dO === 'function' && typeof exp.BA === 'function') {
			cachedFocusableTextarea = exp.dO;
			backendLog(`[NGL][Gamepad] Resolved native Focusable textarea from module ${module.id}`);
			return cachedFocusableTextarea;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(90242);
			if (exp && typeof exp.dO === 'function') {
				cachedFocusableTextarea = exp.dO;
				backendLog('[NGL][Gamepad] Resolved native Focusable textarea by requiring module 90242');
				return cachedFocusableTextarea;
			}
		} catch {}
	}
	cachedFocusableTextarea = null;
	return null;
}

export function resolveNativeCommunityComponent(doc?: Document): ComponentType<NativeCommunityProps> | null {
	if (cachedCommunityComponent !== undefined) return cachedCommunityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.wb === 'function' && typeof exp.kB === 'function' && Object.keys(exp).length === 2) {
			cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
			backendLog(`[NGL][Gamepad] Resolved native Community component from module ${module.id}`);
			return cachedCommunityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(77163);
			if (exp && typeof exp.wb === 'function' && typeof exp.kB === 'function') {
				cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
				backendLog(`[NGL][Gamepad] Resolved native Community component by requiring module 77163`);
				return cachedCommunityComponent;
			}
		} catch {}
		if (req.m) {
			for (const id of Object.keys(req.m)) {
				try {
					const fnStr = req.m[id]?.toString?.() || '';
					if (fnStr.includes('wb:') && fnStr.includes('kB:') && (fnStr.includes('CommunityContentContainer') || fnStr.includes('PlayVideo'))) {
						const exp = req(id);
						if (exp && typeof exp.wb === 'function') {
							cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
							backendLog(`[NGL][Gamepad] Resolved native Community component from factory ${id}`);
							return cachedCommunityComponent;
						}
					}
				} catch {}
			}
		}
	}
	cachedCommunityComponent = null;
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

let cachedTradingCardComponent: ComponentType<NativeTradingCardProps> | null | undefined;

export function resolveNativeTradingCardComponent(doc?: Document): ComponentType<NativeTradingCardProps> | null {
	if (cachedTradingCardComponent !== undefined) return cachedTradingCardComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const candidates = [module.exports, module.exports?.default, ...(module.exports && typeof module.exports === 'object' ? Object.values(module.exports) : [])];
		for (const exp of candidates) {
			if (exp && typeof exp === 'object' && typeof exp.dI === 'function' && typeof exp.LB === 'function' && typeof exp.on === 'function') {
				cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
				backendLog(`[NGL][Gamepad] Resolved native TradingCard component from module ${module.id}`);
				return cachedTradingCardComponent;
			}
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(22165);
			if (exp && typeof exp.dI === 'function') {
				cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
				backendLog(`[NGL][Gamepad] Resolved native TradingCard component by requiring module 22165`);
				return cachedTradingCardComponent;
			}
		} catch {}
		if (req.m) {
			for (const id of Object.keys(req.m)) {
				try {
					const fnStr = req.m[id]?.toString?.() || '';
					if (fnStr.includes('dI:') && fnStr.includes('LB:') && fnStr.includes('on:')) {
						const exp = req(id);
						if (exp && typeof exp.dI === 'function') {
							cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
							backendLog(`[NGL][Gamepad] Resolved native TradingCard component from factory ${id}`);
							return cachedTradingCardComponent;
						}
					}
				} catch {}
			}
		}
	}
	cachedTradingCardComponent = null;
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

export interface NativeReviewProps {
	details: any;
	overview: any;
}

export interface NativeNotesProps {
	overview: any;
	details: any;
}

export interface NativeWorkshopProps {
	details: any;
}

let cachedDLCComponent: ComponentType<NativeDLCProps> | null | undefined;
let cachedScreenshotsComponent: ComponentType<NativeScreenshotsProps> | null | undefined;
let cachedReviewComponent: ComponentType<NativeReviewProps> | null | undefined;
let cachedNotesComponent: ComponentType<NativeNotesProps> | null | undefined;
let cachedWorkshopComponent: ComponentType<NativeWorkshopProps> | null | undefined;

export function resolveNativeDLCComponent(doc?: Document): ComponentType<NativeDLCProps> | null {
	if (cachedDLCComponent !== undefined) return cachedDLCComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(3651);
			if (exp && typeof exp.Kf === 'function') {
				cachedDLCComponent = exp.Kf as ComponentType<NativeDLCProps>;
				return cachedDLCComponent;
			}
		} catch {}
	}
	cachedDLCComponent = null;
	return null;
}

export function resolveNativeScreenshotsComponent(doc?: Document): ComponentType<NativeScreenshotsProps> | null {
	if (cachedScreenshotsComponent !== undefined) return cachedScreenshotsComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(57150);
			if (exp && typeof exp.E === 'function') {
				cachedScreenshotsComponent = exp.E as ComponentType<NativeScreenshotsProps>;
				return cachedScreenshotsComponent;
			}
		} catch {}
	}
	cachedScreenshotsComponent = null;
	return null;
}

export function resolveNativeReviewComponent(doc?: Document): ComponentType<NativeReviewProps> | null {
	if (cachedReviewComponent !== undefined) return cachedReviewComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(71333);
			if (exp && typeof exp.h === 'function') {
				cachedReviewComponent = exp.h as ComponentType<NativeReviewProps>;
				return cachedReviewComponent;
			}
		} catch {}
	}
	cachedReviewComponent = null;
	return null;
}

export function resolveNativeNotesComponent(doc?: Document): ComponentType<NativeNotesProps> | null {
	if (cachedNotesComponent !== undefined) return cachedNotesComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(9066);
			if (exp && typeof exp.E === 'function') {
				cachedNotesComponent = exp.E as ComponentType<NativeNotesProps>;
				return cachedNotesComponent;
			}
		} catch {}
	}
	cachedNotesComponent = null;
	return null;
}

export function resolveNativeWorkshopComponent(doc?: Document): ComponentType<NativeWorkshopProps> | null {
	if (cachedWorkshopComponent !== undefined) return cachedWorkshopComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(81452);
			if (exp && typeof exp.y === 'function') {
				cachedWorkshopComponent = exp.y as ComponentType<NativeWorkshopProps>;
				return cachedWorkshopComponent;
			}
		} catch {}
	}
	cachedWorkshopComponent = null;
	return null;
}

export function resolveNativeAppDetails(doc?: Document, appid?: number): any | null {
	if (!appid) return null;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(78057);
			if (exp?.H && typeof exp.H.GetAppDetails === 'function') {
				return exp.H.GetAppDetails(appid);
			}
		} catch {}
	}
	return null;
}

export function openNativeAchievementsScreen(doc: Document, steamAppId: number | string): void {
	steamWebpackRuntime.captureRuntime(doc);
	const appid = Number(steamAppId);
	if (!appid) return;
	const view = (doc.defaultView as any) || (typeof window !== 'undefined' ? (window as any) : null);

	// 1. Native Webpack WindowStore Navigator
	try {
		const req = steamWebpackRuntime.getRequire();
		if (req) {
			const m61236 = req(61236);
			const windowStore = m61236?.oy?.WindowStore;
			const inst = windowStore?.GetWindowInstanceFromWindow(view)
				|| windowStore?.MainWindowInstance
				|| windowStore?.GamepadUIMainWindowInstance;
			if (typeof inst?.Navigator?.MyAchievements === 'function') {
				inst.Navigator.MyAchievements(appid);
				backendLog(`[NGL][Gamepad] Opened native achievements screen via Navigator for app ${appid}`);
				return;
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
		(window as any)?.g_Router?.history,
		(window as any)?.g_History,
		(window as any)?.g_AppHistory,
	]) {
		if (typeof candidate?.push === 'function') {
			try {
				candidate.push(route);
				backendLog(`[NGL][Gamepad] Opened native achievements screen via Router for app ${appid}`);
				return;
			} catch (e) {
				backendLog(`[NGL][Gamepad] Router history push failed: ${e}`);
			}
		}
	}

	// 3. Fallback: hash navigation
	try {
		if (view?.location) {
			view.location.hash = `#${route}`;
			return;
		}
	} catch {}
}

let navContext: any = null;
export function getNavContext(doc?: Document): any {
	if (navContext !== null) return navContext;
	try {
		steamWebpackRuntime.captureRuntime(doc);
		const req = steamWebpackRuntime.getRequire();
		if (req) {
			try {
				const m28869 = req(28869);
				if (m28869?.TJ) {
					navContext = m28869.TJ;
					return navContext;
				}
			} catch {}
		}
		const entry = steamWebpackRuntime.getAllModules().find(m => m.exports && (m.exports.TJ || m.exports.default?.TJ));
		const exp = entry?.exports?.TJ ? entry.exports : entry?.exports?.default;
		if (exp?.TJ) navContext = exp.TJ;
	} catch {}
	return navContext;
}

export function resolveSteamNav(doc: Document): { navNode: any; navContext: any } | null {
	const candidates: Array<Element | null | undefined> = [
		doc.getElementById('gdl-bp-detail-root')?.parentElement,
		doc.querySelector('[role="tablist"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"]'),
		doc.querySelector('[role="tab"][aria-selected="true"]'),
		doc.querySelector('.gpfocus'),
		doc.querySelector('[class*="Focusable"]'),
	];

	for (const el of candidates) {
		if (!el) continue;
		const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
		if (!key) continue;
		let curr = (el as any)[key];
		while (curr) {
			const val = curr.memoizedProps?.value;
			if (val && val.Tree && typeof val.Tree.CreateNode === 'function') {
				const ctx = curr.type?._context || curr.type;
				return { navNode: val, navContext: ctx };
			}
			curr = curr.return;
		}
	}
	return null;
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

let cachedControllerIcons: NativeControllerIcons | null | undefined;
let cachedControllerFeatureComponent: ComponentType<any> | null | undefined;

export function resolveNativeControllerIcons(doc?: Document): NativeControllerIcons | null {
	if (cachedControllerIcons !== undefined) return cachedControllerIcons;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.ControllerStatus === 'function' && typeof exp.ControllerType === 'function') {
			cachedControllerIcons = {
				ControllerStatus: exp.ControllerStatus,
				ControllerType: exp.ControllerType,
				Controller: exp.Controller,
				XboxOneControllerFrontOutline: exp.XboxOneControllerFrontOutline,
				PS4ControllerFrontOutline: exp.PS4ControllerFrontOutline,
				PS5ControllerFrontOutline: exp.PS5ControllerFrontOutline,
				FrankenController: exp.FrankenController,
			};
			backendLog(`[NGL][Gamepad] Resolved native controller icons from module ${module.id}`);
			return cachedControllerIcons;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(35488);
			if (exp && typeof exp.ControllerStatus === 'function' && typeof exp.ControllerType === 'function') {
				cachedControllerIcons = {
					ControllerStatus: exp.ControllerStatus,
					ControllerType: exp.ControllerType,
					Controller: exp.Controller,
					XboxOneControllerFrontOutline: exp.XboxOneControllerFrontOutline,
					PS4ControllerFrontOutline: exp.PS4ControllerFrontOutline,
					PS5ControllerFrontOutline: exp.PS5ControllerFrontOutline,
					FrankenController: exp.FrankenController,
				};
				backendLog(`[NGL][Gamepad] Resolved native controller icons by requiring module 35488`);
				return cachedControllerIcons;
			}
		} catch {}
	}
	cachedControllerIcons = null;
	return null;
}

export function resolveNativeControllerFeatureComponent(doc?: Document): ComponentType<any> | null {
	if (cachedControllerFeatureComponent !== undefined) return cachedControllerFeatureComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && typeof exp.n$ === 'function' && typeof exp.zX === 'function') {
			cachedControllerFeatureComponent = exp.n$;
			backendLog(`[NGL][Gamepad] Resolved native controller feature component (n$) from module ${module.id}`);
			return cachedControllerFeatureComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(28346);
			if (exp && typeof exp.n$ === 'function') {
				cachedControllerFeatureComponent = exp.n$;
				backendLog(`[NGL][Gamepad] Resolved native controller feature component (n$) by requiring module 28346`);
				return cachedControllerFeatureComponent;
			}
		} catch {}
	}
	cachedControllerFeatureComponent = null;
	return null;
}

export interface NativeAchievementsSectionProps {
	details: { unAppID: number };
}

export function ensureAppDetailsStoreGuarded(store: any): void {
	if (!store || store.__ngl_achievements_guarded) return;
	try {
		const origGetAchievements = store.GetAchievements;
		if (typeof origGetAchievements === 'function') {
			store.GetAchievements = function (appId: number) {
				try {
					const appData = this.GetAppData(appId);
					if (appData) {
						if (!appData.details) {
							appData.details = { unAppID: appId };
						}
						if (!appData.details.achievements) {
							appData.details.achievements = {
								nTotal: 0,
								nAchieved: 0,
								vecHighlight: [],
								vecUnachieved: [],
								vecAchievedHidden: [],
							};
						}
					}
				} catch {}
				return origGetAchievements.call(this, appId);
			};
			store.__ngl_achievements_guarded = true;
			backendLog('[NGL][Gamepad] Guarded native AppDetailsStore.GetAchievements to prevent undefined crash');
		}
	} catch (e) {
		backendLog(`[NGL][Gamepad] Failed to guard AppDetailsStore: ${e}`);
	}
}

let cachedAchievementsSectionComponent: ComponentType<NativeAchievementsSectionProps> | null | undefined;
let cachedAppDetailsStore: any | null | undefined;
let cachedAchievementStore: any | null | undefined;

export function resolveNativeAchievementsSectionComponent(doc?: Document): ComponentType<NativeAchievementsSectionProps> | null {
	if (cachedAchievementsSectionComponent) return cachedAchievementsSectionComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(57665);
			if (exp && exp.Jq && (typeof exp.Jq === 'function' || typeof exp.Jq === 'object')) {
				cachedAchievementsSectionComponent = exp.Jq as ComponentType<NativeAchievementsSectionProps>;
				backendLog(`[NGL][Gamepad] Resolved native AchievementsSection component (Jq) by requiring module 57665`);
				return cachedAchievementsSectionComponent;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && exp.Jq && (typeof exp.Jq === 'function' || typeof exp.Jq === 'object') && exp.hs && exp.Tv) {
			cachedAchievementsSectionComponent = exp.Jq as ComponentType<NativeAchievementsSectionProps>;
			backendLog(`[NGL][Gamepad] Resolved native AchievementsSection component (Jq) from module ${module.id}`);
			return cachedAchievementsSectionComponent;
		}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858).catch(() => {});
	}
	return null;
}

export function resolveNativeAppDetailsStore(doc?: Document): any | null {
	if (cachedAppDetailsStore) return cachedAppDetailsStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(78057);
			if (exp && exp.H && typeof exp.H.GetAppData === 'function') {
				cachedAppDetailsStore = exp.H;
				ensureAppDetailsStoreGuarded(cachedAppDetailsStore);
				backendLog(`[NGL][Gamepad] Resolved native AppDetailsStore by requiring module 78057`);
				return cachedAppDetailsStore;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && exp.H && typeof exp.H.GetAppData === 'function' && typeof exp.H.GetAchievements === 'function') {
			cachedAppDetailsStore = exp.H;
			ensureAppDetailsStoreGuarded(cachedAppDetailsStore);
			backendLog(`[NGL][Gamepad] Resolved native AppDetailsStore from module ${module.id}`);
			return cachedAppDetailsStore;
		}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858).catch(() => {});
	}
	return null;
}

export function resolveNativeAchievementStore(doc?: Document): any | null {
	if (cachedAchievementStore) return cachedAchievementStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(32179);
			if (exp && exp.p6 && typeof exp.p6.GetMyAchievements === 'function') {
				cachedAchievementStore = exp.p6;
				return cachedAchievementStore;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && exp.p6 && typeof exp.p6.GetMyAchievements === 'function') {
			cachedAchievementStore = exp.p6;
			return cachedAchievementStore;
		}
	}
	return null;
}

let cachedConfigContext: any | null | undefined;

export function resolveNativeConfigContext(doc?: Document): any | null {
	if (cachedConfigContext !== undefined) return cachedConfigContext;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire();
	if (req) {
		try {
			const exp = req(72476);
			if (exp && exp.QO) {
				cachedConfigContext = exp.QO;
				return cachedConfigContext;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules()) {
		const exp = module.exports as any;
		if (exp && exp.QO && exp.ss && exp.Qn) {
			cachedConfigContext = exp.QO;
			return cachedConfigContext;
		}
	}
	cachedConfigContext = null;
	return null;
}

export function clearNativeComponentsCache(): void {
	cachedFriendsComponent = undefined;
	cachedActivityComponent = undefined;
	cachedPostTextEntryComponent = undefined;
	cachedFocusableTextarea = undefined;
	cachedCommunityComponent = undefined;
	cachedTradingCardComponent = undefined;
	cachedDLCComponent = undefined;
	cachedScreenshotsComponent = undefined;
	cachedReviewComponent = undefined;
	cachedNotesComponent = undefined;
	cachedWorkshopComponent = undefined;
	cachedControllerIcons = undefined;
	cachedControllerFeatureComponent = undefined;
	cachedAchievementsSectionComponent = undefined;
	cachedAppDetailsStore = undefined;
	cachedAchievementStore = undefined;
	cachedConfigContext = undefined;
	navContext = null;
}


