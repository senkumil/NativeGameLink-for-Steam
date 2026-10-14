import type { ComponentType } from 'react';
import { backendLog, fetchPartnerEventsBackend } from '../../../api/backend';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { isMappingSnapshotVerified, mappings, shortcutMappingKey } from '../../../core/mappings';

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
let cachedRuntimeIdentity: object | null = null;

function ensureNativeComponentsRuntime(doc?: Document): void {
	steamWebpackRuntime.captureRuntime(doc);
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	if (identity && cachedRuntimeIdentity === identity) return;
	clearNativeComponentsCache();
	cachedRuntimeIdentity = identity;
}

export function resolveNativeFriendsComponent(doc?: Document): ComponentType<NativeFriendsProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedFriendsComponent !== undefined) return cachedFriendsComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.w4 === 'function' && typeof exp.gr === 'function' && typeof exp.oG === 'function') {
			cachedFriendsComponent = exp.w4 as ComponentType<NativeFriendsProps>;
			backendLog(`[NGL][Gamepad] Resolved native Friends component from module ${module.id}`);
			return cachedFriendsComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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
	ensureNativeComponentsRuntime(doc);
	if (cachedActivityComponent !== undefined) return cachedActivityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.W === 'function' && typeof exp.M === 'function' && Object.keys(exp).length === 2) {
			cachedActivityComponent = exp.W as ComponentType<NativeActivityFeedProps>;
			backendLog(`[NGL][Gamepad] Resolved native Activity component from module ${module.id}`);
			return cachedActivityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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
	ensureNativeComponentsRuntime(doc);
	if (cachedPostTextEntryComponent !== undefined) return cachedPostTextEntryComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.K === 'function' && exp.K.prototype?.OnPostClicked && exp.K.prototype?.InsertEmoticon) {
			cachedPostTextEntryComponent = exp.K as ComponentType<NativePostTextEntryProps>;
			backendLog(`[NGL][Gamepad] Resolved native PostTextEntry component from module ${module.id}`);
			return cachedPostTextEntryComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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
	ensureNativeComponentsRuntime(doc);
	if (cachedFocusableTextarea !== undefined) return cachedFocusableTextarea;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.dO === 'function' && typeof exp.BA === 'function') {
			cachedFocusableTextarea = exp.dO;
			backendLog(`[NGL][Gamepad] Resolved native Focusable textarea from module ${module.id}`);
			return cachedFocusableTextarea;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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
	ensureNativeComponentsRuntime(doc);
	if (cachedCommunityComponent !== undefined) return cachedCommunityComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.wb === 'function' && typeof exp.kB === 'function' && Object.keys(exp).length === 2) {
			cachedCommunityComponent = exp.wb as ComponentType<NativeCommunityProps>;
			backendLog(`[NGL][Gamepad] Resolved native Community component from module ${module.id}`);
			return cachedCommunityComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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
	ensureNativeComponentsRuntime(doc);
	if (cachedTradingCardComponent !== undefined) return cachedTradingCardComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidates = [module.exports, module.exports?.default, ...(module.exports && typeof module.exports === 'object' ? Object.values(module.exports) : [])];
		for (const exp of candidates) {
			if (exp && typeof exp === 'object' && typeof exp.dI === 'function' && typeof exp.LB === 'function' && typeof exp.on === 'function') {
				cachedTradingCardComponent = exp.dI as ComponentType<NativeTradingCardProps>;
				backendLog(`[NGL][Gamepad] Resolved native TradingCard component from module ${module.id}`);
				return cachedTradingCardComponent;
			}
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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

function moduleFactorySource(req: any, id: string | number): string {
	try { return String(req?.m?.[id] || ''); } catch { return ''; }
}

/**
 * Finds a Steam section component by its export key plus localization keys
 * from its module source. Webpack ids and single-letter export names change
 * between Steam builds, and a lone export name is too common to match alone.
 */
function resolveSectionByFingerprint<T>(doc: Document | undefined, exportKey: string, fingerprints: string[], label: string): ComponentType<T> | null {
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	const matches = (source: string): boolean => fingerprints.every(fingerprint => source.includes(fingerprint));
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (!exp || typeof exp[exportKey] !== 'function' || !matches(moduleFactorySource(req, module.id))) continue;
		backendLog(`[NGL][Gamepad] Resolved native ${label} component from module ${module.id}`);
		return exp[exportKey] as ComponentType<T>;
	}
	for (const id of Object.keys(req?.m || {})) {
		const source = moduleFactorySource(req, id);
		if (!source.includes(`${exportKey}:()=>`) || !matches(source)) continue;
		try {
			const exp = req(id);
			if (typeof exp?.[exportKey] !== 'function') continue;
			backendLog(`[NGL][Gamepad] Resolved native ${label} component from factory ${id}`);
			return exp[exportKey] as ComponentType<T>;
		} catch {}
	}
	backendLog(`[NGL][Gamepad] Native ${label} component not found`);
	return null;
}

export function resolveNativeDLCComponent(doc?: Document): ComponentType<NativeDLCProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedDLCComponent === undefined) cachedDLCComponent = resolveSectionByFingerprint<NativeDLCProps>(doc, 'Kf', ['#AppDetails_SectionTitle_DLC', '#AppDetails_ManageDLC'], 'DLC');
	return cachedDLCComponent;
}

export function resolveNativeScreenshotsComponent(doc?: Document): ComponentType<NativeScreenshotsProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedScreenshotsComponent === undefined) cachedScreenshotsComponent = resolveSectionByFingerprint<NativeScreenshotsProps>(doc, 'E', ['#AppDetails_SectionTitle_Screenshots', '#AppDetails_NoScreenshots'], 'Screenshots');
	return cachedScreenshotsComponent;
}

export function resolveNativeReviewComponent(doc?: Document): ComponentType<NativeReviewProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedReviewComponent === undefined) cachedReviewComponent = resolveSectionByFingerprint<NativeReviewProps>(doc, 'h', ['#AppDetails_Review_YourReview', '#AppDetails_Review_PlayedForTime'], 'Review');
	return cachedReviewComponent;
}

export function resolveNativeNotesComponent(doc?: Document): ComponentType<NativeNotesProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedNotesComponent === undefined) cachedNotesComponent = resolveSectionByFingerprint<NativeNotesProps>(doc, 'E', ['#AppDetails_SectionTitle_GameNotes', '#AppDetails_NewNote'], 'Notes');
	return cachedNotesComponent;
}

export function resolveNativeWorkshopComponent(doc?: Document): ComponentType<NativeWorkshopProps> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedWorkshopComponent === undefined) cachedWorkshopComponent = resolveSectionByFingerprint<NativeWorkshopProps>(doc, 'y', ['#AppDetails_SectionTitle_Workshop', '#AppDetails_WorkshopVisit'], 'Workshop');
	return cachedWorkshopComponent;
}

export function openNativeAchievementsScreen(doc: Document, steamAppId: number | string): void {
	steamWebpackRuntime.captureRuntime(doc);
	const appid = Number(steamAppId);
	if (!appid) return;
	const view = (doc.defaultView as any) || (typeof window !== 'undefined' ? (window as any) : null);

	// 1. Native Webpack WindowStore Navigator
	try {
		const req = steamWebpackRuntime.getRequire(doc);
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

function isRouterHistory(value: any): boolean {
	return Boolean(value && typeof value.push === 'function' && typeof value.listen === 'function' && value.location?.pathname);
}

/** Router history of the current GamepadUI page, read from React context
 *  because webpack module ids change between Steam builds. */
function resolveGamepadRouterHistory(doc: Document): any | null {
	const start = doc.getElementById('gdl-bp-detail-root') || doc.querySelector('[role="tablist"]');
	const key = start ? Object.keys(start).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')) : undefined;
	for (let fiber = key ? (start as any)[key] : null; fiber; fiber = fiber.return) {
		const value = fiber.memoizedProps?.value;
		if (isRouterHistory(value?.history)) return value.history;
		if (isRouterHistory(value?.navigator)) return value.navigator;
		if (isRouterHistory(fiber.memoizedProps?.history)) return fiber.memoizedProps.history;
	}
	steamWebpackRuntime.captureRuntime(doc);
	const view = (doc.defaultView as any) || null;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const windowStore = (module.exports as any)?.oy?.WindowStore;
		if (!windowStore) continue;
		const inst = windowStore.GetWindowInstanceFromWindow?.(view) || windowStore.GamepadUIMainWindowInstance;
		if (isRouterHistory(inst?.History)) return inst.History;
	}
	return null;
}

/** Opens Steam's partner-event overlay on the current app page through its
 *  `event_to_show` route state. */
export function openNativePartnerEvent(doc: Document, steamAppId: number | string, eventGid: string): boolean {
	const appid = Number(steamAppId);
	if (!appid || !/^\d+$/.test(eventGid)) return false;
	try {
		const history = resolveGamepadRouterHistory(doc);
		const location = history?.location;
		if (typeof history?.replace !== 'function' || !location?.pathname) {
			backendLog(`[NGL][Gamepad] Native partner event overlay unavailable: history=${Boolean(history)} path=${location?.pathname || ''}`);
			return false;
		}
		const state = location.state && typeof location.state === 'object' ? location.state : {};
		// Replace, not push: closing replaces the entry, so a push left a duplicate.
		history.replace(location.pathname, { ...state, event_to_show: { appid, eventid: eventGid } });
		backendLog(`[NGL][Gamepad] Opened native partner event ${eventGid} for app ${appid}`);
		return true;
	} catch (e) {
		backendLog(`[NGL][Gamepad] Native partner event overlay failed: ${e}`);
		return false;
	}
}

const partnerEventIndex = new Map<string, Promise<Array<{ gid: string; title: string; date: number }>>>();

function normalizedEventTitle(value: unknown): string {
	return String(value || '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Partner-event id for a news item: from its store URL, else matched
 *  against the app's partner events by title or post date. */
export async function resolvePartnerEventGid(steamAppId: number | string, item: { url?: string; title?: string; date?: number }): Promise<string> {
	const fromUrl = /\/news\/app\/\d+\/view\/(\d+)/.exec(String(item.url || ''))?.[1];
	if (fromUrl) return fromUrl;
	const appKey = String(steamAppId);
	if (!/^\d+$/.test(appKey)) return '';
	let index = partnerEventIndex.get(appKey);
	if (!index) {
		index = fetchPartnerEventsBackend({ steam_app_id: appKey, language: 'english' })
			.then(raw => (JSON.parse(raw)?.items || [])
				.map((e: any) => ({ gid: String(e.gid || ''), title: normalizedEventTitle(e.title), date: Number(e.date || 0) }))
				.filter((e: { gid: string }) => /^\d+$/.test(e.gid)))
			.catch((): Array<{ gid: string; title: string; date: number }> => []);
		partnerEventIndex.set(appKey, index);
	}
	const events = await index;
	if (events.length === 0) partnerEventIndex.delete(appKey);
	const title = normalizedEventTitle(item.title);
	const date = Number(item.date || 0);
	const match = events.find(e => title && e.title === title)
		|| events.find(e => date > 0 && Math.abs(e.date - date) < 6 * 60 * 60);
	backendLog(`[NGL][Gamepad] Partner event for "${title.slice(0, 40)}" in app ${appKey}: ${match?.gid || 'none'} (${events.length} events)`);
	return match?.gid || '';
}

let navContext: any = null;
export function getNavContext(doc?: Document): any {
	ensureNativeComponentsRuntime(doc);
	if (navContext !== null) return navContext;
	try {
		steamWebpackRuntime.captureRuntime(doc);
		const req = steamWebpackRuntime.getRequire(doc);
		if (req) {
			try {
				const m28869 = req(28869);
				if (m28869?.TJ) {
					navContext = m28869.TJ;
					return navContext;
				}
			} catch {}
		}
		const entry = steamWebpackRuntime.getAllModules(doc).find(m => m.exports && (m.exports.TJ || m.exports.default?.TJ));
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
let cachedControllerIconsMissAt = 0;
let cachedControllerFeatureComponent: ComponentType<any> | null | undefined;

export function resolveNativeControllerIcons(doc?: Document): NativeControllerIcons | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedControllerIcons && cachedControllerIcons !== null) return cachedControllerIcons;
	if (cachedControllerIcons === null && Date.now() - cachedControllerIconsMissAt < 1200) return null;
	steamWebpackRuntime.captureRuntime(doc);

	const assign = (exp: any, source: string): NativeControllerIcons | null => {
		if (!exp || typeof exp.ControllerType !== 'function') return null;
		cachedControllerIcons = {
			ControllerStatus: exp.ControllerStatus,
			ControllerType: exp.ControllerType,
			Controller: exp.Controller,
			XboxOneControllerFrontOutline: exp.XboxOneControllerFrontOutline,
			PS4ControllerFrontOutline: exp.PS4ControllerFrontOutline,
			PS5ControllerFrontOutline: exp.PS5ControllerFrontOutline,
			FrankenController: exp.FrankenController,
		};
		backendLog(`[NGL][Gamepad] Resolved native controller icons ${source}`);
		return cachedControllerIcons;
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
	cachedControllerIcons = null;
	cachedControllerIconsMissAt = Date.now();
	return null;
}

export function resolveNativeControllerFeatureComponent(doc?: Document): ComponentType<any> | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedControllerFeatureComponent !== undefined) return cachedControllerFeatureComponent;
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && typeof exp.n$ === 'function' && typeof exp.zX === 'function') {
			cachedControllerFeatureComponent = exp.n$;
			backendLog(`[NGL][Gamepad] Resolved native controller feature component (n$) from module ${module.id}`);
			return cachedControllerFeatureComponent;
		}
	}
	const req = steamWebpackRuntime.getRequire(doc);
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

const appDetailsGuardRestores = new Map<any, () => void>();

export function ensureAppDetailsStoreGuarded(store: any): void {
	if (!store || store.__ngl_achievements_guarded) return;
	try {
		const origGetAchievements = store.GetAchievements;
		if (typeof origGetAchievements === 'function') {
			const descriptor = Object.getOwnPropertyDescriptor(store, 'GetAchievements');
			const marker = Object.getOwnPropertyDescriptor(store, '__ngl_achievements_guarded');
			store.GetAchievements = function (appId: number, ...args: any[]) {
				const rawId = Number(appId), shortcutId = rawId >>> 0;
				// Steam's public achievements must retain the original method, data
				// identity and lazy RequestAchievements path, including missing data.
				if (!Number.isInteger(rawId) || rawId < -2147483648 || rawId > 4294967295
					|| shortcutId < 2147483648 || !isMappingSnapshotVerified()
					|| !/^\d+$/.test(String(mappings[shortcutMappingKey(shortcutId)] || ''))) {
					return origGetAchievements.call(this, appId, ...args);
				}
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
				return origGetAchievements.call(this, appId, ...args);
			};
			const wrapper = store.GetAchievements;
			store.__ngl_achievements_guarded = true;
			appDetailsGuardRestores.set(store, () => {
				if (store.GetAchievements !== wrapper) return;
				if (descriptor) Object.defineProperty(store, 'GetAchievements', descriptor);
				else delete store.GetAchievements;
				if (marker) Object.defineProperty(store, '__ngl_achievements_guarded', marker);
				else delete store.__ngl_achievements_guarded;
			});
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
	ensureNativeComponentsRuntime(doc);
	if (cachedAchievementsSectionComponent) return cachedAchievementsSectionComponent;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
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
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.Jq && (typeof exp.Jq === 'function' || typeof exp.Jq === 'object') && exp.hs && exp.Tv) {
			cachedAchievementsSectionComponent = exp.Jq as ComponentType<NativeAchievementsSectionProps>;
			backendLog(`[NGL][Gamepad] Resolved native AchievementsSection component (Jq) from module ${module.id}`);
			return cachedAchievementsSectionComponent;
		}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858, doc).catch(() => {});
	}
	return null;
}

export function resolveNativeAppDetailsStore(doc?: Document): any | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedAppDetailsStore) return cachedAppDetailsStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
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
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const exp = module.exports as any;
		if (exp && exp.H && typeof exp.H.GetAppData === 'function' && typeof exp.H.GetAchievements === 'function') {
			cachedAppDetailsStore = exp.H;
			ensureAppDetailsStoreGuarded(cachedAppDetailsStore);
			backendLog(`[NGL][Gamepad] Resolved native AppDetailsStore from module ${module.id}`);
			return cachedAppDetailsStore;
		}
	}
	if (req && typeof req.e === 'function') {
		steamWebpackRuntime.ensureChunk(9858, doc).catch(() => {});
	}
	return null;
}

export function resolveNativeAchievementStore(doc?: Document): any | null {
	ensureNativeComponentsRuntime(doc);
	if (cachedAchievementStore) return cachedAchievementStore;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(32179);
			if (exp && exp.p6 && typeof exp.p6.GetMyAchievements === 'function') {
				cachedAchievementStore = exp.p6;
				return cachedAchievementStore;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
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
	ensureNativeComponentsRuntime(doc);
	if (cachedConfigContext !== undefined) return cachedConfigContext;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (req) {
		try {
			const exp = req(72476);
			if (exp && exp.QO) {
				cachedConfigContext = exp.QO;
				return cachedConfigContext;
			}
		} catch {}
	}
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
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
	for (const restore of appDetailsGuardRestores.values()) try { restore(); } catch {}
	appDetailsGuardRestores.clear();
	cachedRuntimeIdentity = null;
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
	cachedControllerIconsMissAt = 0;
	cachedControllerFeatureComponent = undefined;
	cachedAchievementsSectionComponent = undefined;
	cachedAppDetailsStore = undefined;
	cachedAchievementStore = undefined;
	cachedConfigContext = undefined;
	navContext = null;
}


