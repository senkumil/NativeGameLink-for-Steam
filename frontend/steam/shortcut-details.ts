const SHORTCUT_APP_ID_MIN = 2147483648;
const SHORTCUT_APP_ID_LIMIT = 4294967296;

function normalizedShortcutId(value: unknown): number | null {
	const raw = Number(value);
	if (!Number.isInteger(raw)) return null;
	const id = raw < 0 ? raw + SHORTCUT_APP_ID_LIMIT : raw;
	return id >= SHORTCUT_APP_ID_MIN && id < SHORTCUT_APP_ID_LIMIT ? id : null;
}

function shortcutDetailsWindow(doc?: Document | null): any | null {
	if (doc != null) return doc.defaultView || null;
	return typeof window !== 'undefined' ? window : null;
}

function matchesDetails(details: any, shortcutId: number, requireId: boolean): boolean {
	if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
	if (details.unAppID == null) return !requireId;
	return normalizedShortcutId(details.unAppID) === shortcutId;
}

function hasLaunchExecutable(details: any): boolean {
	return ['strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath']
		.some(key => typeof details?.[key] === 'string' && details[key].trim().length > 0);
}

/** Steam's overview contains its library row, while the separate details store
 * owns strShortcutExe and strShortcutStartDir. Never copy fields into an
 * observable overview or substitute another window's launch definition. */
export function readShortcutLaunchDetails(shortcutAppId: number, doc?: Document | null): any | null {
	const id = normalizedShortcutId(shortcutAppId);
	if (id == null) return null;
	try {
		const store = shortcutDetailsWindow(doc)?.appDetailsStore;
		const details = typeof store?.GetAppDetails === 'function' ? store.GetAppDetails(id) : null;
		return matchesDetails(details, id, false) ? details : null;
	} catch { return null; }
}

/** Subscribe to Steam's native details contract only while its launch data is
 * missing. GetCachedAppDetails is a serialized cache of unrelated detail
 * sections, so it cannot establish an executable's identity. */
export function readFreshShortcutLaunchDetails(
	shortcutAppId: number, doc?: Document | null, timeoutMs = 1200,
): Promise<any | null> {
	const id = normalizedShortcutId(shortcutAppId);
	if (id == null) return Promise.resolve(null);
	const existing = readShortcutLaunchDetails(id, doc);
	if (hasLaunchExecutable(existing)) return Promise.resolve(existing);
	const apps = shortcutDetailsWindow(doc)?.SteamClient?.Apps;
	if (typeof apps?.RegisterForAppDetails !== 'function') return Promise.resolve(null);
	const budget = Number.isFinite(timeoutMs) ? Math.min(5000, Math.max(1, timeoutMs)) : 1200;
	return new Promise(resolve => {
		let settled = false;
		let subscription: { unregister?: () => void } | null = null;
		const unregister = (): void => {
			const active = subscription;
			subscription = null;
			try { active?.unregister?.(); } catch {}
		};
		const finish = (details: any | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unregister();
			resolve(details);
		};
		const timer = setTimeout(() => finish(null), budget);
		try {
			subscription = apps.RegisterForAppDetails(id, (details: any) => {
				if (matchesDetails(details, id, true) && hasLaunchExecutable(details)) finish(details);
			}) || null;
			// Native fixtures and already-cached subscriptions may call back before
			// RegisterForAppDetails returns its handle.
			if (settled) unregister();
		} catch { finish(null); }
	});
}
