import type { SteamGameData } from '../../domain/types';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { resolveNativeAppDetails } from '../../steam/gamepad/components/AppDetailsNativeComponents';
import type { MappedShortcut } from './types';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { getNativeWindowInstance } from '../../steam/native-window-store';

const stores = new WeakMap<Document, { identity: object; store: any }>();
function overviewFor(doc: Document, id: number): any {
	const local = AppStoreAdapter.getAppOverview(id, doc);
	if (local) return local;
	if (!getNativeWindowInstance(doc)) return null;
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	if (!identity) return null;
	let cached = stores.get(doc);
	if (cached?.identity !== identity) {
		for (const module of steamWebpackRuntime.getAllModules(doc)) {
			const exp = module.exports;
			for (const value of [exp, ...(exp && typeof exp === 'object' ? Object.values(exp) : [])]) {
				if (typeof (value as any)?.GetAppOverviewByAppID !== 'function') continue;
				cached = { identity, store: value }; stores.set(doc, cached); break;
			}
			if (cached?.identity === identity) break;
		}
	}
	try { return cached?.identity === identity ? cached.store.GetAppOverviewByAppID(id) : null; } catch { return null; }
}

/** Component-local presentation view. Never install these fields on an
 * AppOverview, prototype or public Steam game's store record. */
export function createBigPictureDetailViews(doc: Document, shortcut: MappedShortcut, game: SteamGameData | null, information = false): { overview: any; details: any } {
	const id = shortcut.id >>> 0;
	const base = overviewFor(doc, id);
	const metadata = information ? overviewFor(doc, Number(shortcut.steamAppId)) : null;
	const getRelease = () => {
		try { const native = metadata?.GetCanonicalReleaseDate?.(); if (native) return native; } catch {}
		const date = Date.parse(game?.release_date?.date || '');
		return Number.isFinite(date) ? Math.floor(date / 1000) : 0;
	};
	const own: Record<string, any> = { appid: id, display_name: game?.name || base?.display_name || shortcut.title };
	if (information) Object.assign(own, {
		// Only the information component sees metadata presentation semantics.
		// The real overview still identifies and launches a non-Steam shortcut.
		BIsModOrShortcut: () => false, BIsShortcut: () => false, GetCanonicalReleaseDate: getRelease,
		BHasStoreCategory: (category: number) => Boolean(game?.categories?.some(item => Number(item.id) === Number(category))
			|| (category === 28 && game?.controller_support === 'full') || metadata?.BHasStoreCategory?.(category)),
		controller_support: game?.controller_support === 'full' ? 2 : game?.controller_support === 'partial' ? 1 : base?.controller_support ?? 0,
		steam_deck_compat_category: metadata?.steam_deck_compat_category ?? 0,
		steam_os_compat_category: metadata?.steam_os_compat_category ?? 0,
	});
	const functions = new Map<PropertyKey, { value: Function; bound: Function }>();
	const overview = new Proxy(Object.create(null), {
		get: (_target, key) => {
			if (Object.prototype.hasOwnProperty.call(own, key)) return own[key as string];
			const value = base?.[key];
			if (typeof value !== 'function') return value;
			const cached = functions.get(key);
			if (cached?.value === value) return cached.bound;
			const bound = value.bind(base); functions.set(key, { value, bound }); return bound;
		},
		has: (_target, key) => Object.prototype.hasOwnProperty.call(own, key) || Boolean(base && key in base),
		set: () => false,
	});
	const native = resolveNativeAppDetails(doc, id);
	const details = { vecDLC: [], vecDeckCompatTestResults: [], vecSteamOSCompatTestResults: [], ...(native || {}), unAppID: id };
	return { overview, details };
}
