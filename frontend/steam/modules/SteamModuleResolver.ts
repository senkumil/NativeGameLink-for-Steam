import { backendLog } from '../../api/backend';
import { steamWebpackRuntime } from './SteamWebpackRuntime';

export interface SteamModuleResolverCache {
	stores: Map<string, any>;
	components: Map<string, any>;
}

const cache: SteamModuleResolverCache = {
	stores: new Map(),
	components: new Map(),
};

/** Find a Steam Store from the global window or PopupManager */
export function getSteamStore<T = any>(storeName: string): T | null {
	// Steam can replace stores when rebuilding a CEF surface. Re-resolve the
	// live owner instead of keeping a detached store across mode transitions.

	const win = typeof window !== 'undefined' ? (window as any) : null;
	if (!win) return null;

	// 1. Direct window stores
	if (win[storeName]) {
		return win[storeName];
	}

	// 2. Common casing variants (e.g. appStore vs AppStore)
	const lower = storeName.toLowerCase();
	for (const key of Object.keys(win)) {
		if (key.toLowerCase() === lower && typeof win[key] === 'object' && win[key] !== null) {
			return win[key];
		}
	}

	// 3. PopupManager window stores (Desktop and Big Picture popups)
	const pm = win.g_PopupManager;
	if (pm) {
		try {
			for (const popupName of ['SP Desktop_uid0', 'SP Desktop', 'SP BPM_uid0', 'SP BPM']) {
				const p = pm.GetExistingPopup?.(popupName) || pm.m_mapPopups?.get?.(popupName);
				const pWin = p?.m_popup?.window || p?.window || p?.m_popup || p;
				if (pWin && !pWin.closed && pWin[storeName]) {
					return pWin[storeName];
				}
			}
		} catch {}
	}

	return null;
}

/** Get Steam's primary AppStore */
export function getAppStore(): any | null {
	return getSteamStore('appStore') || getSteamStore('AppStore');
}

/** Resolve a Steam internal React component or controller using structural validator */
export function resolveSteamComponent<T = any>(
	name: string,
	validator: (candidate: any) => boolean,
	searchScope?: any[],
): T | null {
	if (cache.components.has(name)) return cache.components.get(name);

	// 1. Check Webpack runtime modules
	const modules = steamWebpackRuntime.getAllModules();
	for (const mod of modules) {
		const exp = mod.exports;
		if (!exp) continue;
		if (validator(exp)) {
			cache.components.set(name, exp);
			backendLog(`[NGL][SteamResolver] Resolved "${name}" from moduleId ${mod.id}`);
			return exp;
		}
		if (typeof exp === 'object') {
			for (const key of Object.keys(exp)) {
				if (validator(exp[key])) {
					cache.components.set(name, exp[key]);
					backendLog(`[NGL][SteamResolver] Resolved "${name}" from moduleId ${mod.id} [${key}]`);
					return exp[key];
				}
			}
		}
	}

	// 2. Search in provided scope
	if (Array.isArray(searchScope)) {
		for (const item of searchScope) {
			if (validator(item)) {
				cache.components.set(name, item);
				return item;
			}
		}
	}

	return null;
}

export function clearSteamModuleCache(): void {
	cache.stores.clear();
	cache.components.clear();
}
