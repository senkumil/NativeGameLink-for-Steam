/** Read only the live owner document; another popup's store is a different realm. */
export function getDocumentSteamStore(names: readonly string[], doc?: Document): any | null {
	const owner = doc || (typeof document !== 'undefined' ? document : null);
	if (!owner) return null;
	try {
		const win = owner.defaultView as any;
		if (!win || win.closed || win.document !== owner) return null;
		for (const name of names) if (win[name]) return win[name];
		const aliases = new Set(names.map(name => name.toLowerCase()));
		for (const key of Object.keys(win)) {
			if (aliases.has(key.toLowerCase()) && win[key] && typeof win[key] === 'object') return win[key];
		}
	} catch {}
	return null;
}

export class AppStoreAdapter {
	public static getStore(doc?: Document): any | null {
		return getDocumentSteamStore(['appStore', 'AppStore'], doc);
	}

	public static getAppOverview(appid: number, doc?: Document): any | null {
		const store = this.getStore(doc);
		if (!store) return null;
		if (typeof store.GetAppOverviewByAppID === 'function') {
			return store.GetAppOverviewByAppID(appid);
		}
		if (typeof store.m_mapApps?.get === 'function') {
			return store.m_mapApps.get(appid);
		}
		return null;
	}
}
