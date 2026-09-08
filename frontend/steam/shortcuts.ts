import { backendLog } from '../api/backend';
import { findMappingForTitle, mappings, shortcutMappingKey } from '../core/mappings';
import { normalizeTitle } from '../core/text';

export const SHORTCUT_THRESHOLD = 2147483648;
const shortcutPlaytimeRequests = new Map<number, Promise<number | null>>();

const fallbackShortcutApps = new Map<number, any>();

/** Backend-derived shortcut overviews used only while Steam's appStore is
 * unavailable or still hydrating. This keeps clean-start detection independent
 * from private appStore timing without replacing richer live Steam objects. */
export function replaceFallbackShortcutApps(records: Array<{ id: number; app: any }>): void {
	fallbackShortcutApps.clear();
	for (const record of records) {
		const id = Number(record?.id);
		if (Number.isFinite(id) && id >= SHORTCUT_THRESHOLD && record.app) fallbackShortcutApps.set(id, record.app);
	}
}

function isUsableAppStore(store: any): boolean {
	return Boolean(store && (store.m_mapApps || store.allApps || store.m_rgApps || typeof store.GetAppOverviewByAppID === 'function'));
}

function collectStoreEntries(store: any): Array<[unknown, any]> {
	const entries: Array<[unknown, any]> = [];
	if (!store) return entries;
	try {
		if (store.m_mapApps instanceof Map || typeof store.m_mapApps?.[Symbol.iterator] === 'function') {
			for (const [id, app] of store.m_mapApps) entries.push([id, app]);
		} else if (store.m_mapApps && typeof store.m_mapApps === 'object') {
			for (const [id, app] of Object.entries(store.m_mapApps)) entries.push([id, app]);
		}
	} catch {}
	try { for (const app of Array.from(store.allApps || []) as any[]) entries.push([app?.appid, app]); } catch {}
	try { for (const app of Array.from(store.m_rgApps || []) as any[]) entries.push([app?.appid, app]); } catch {}
	return entries;
}


export function cleanShortcutPath(value: unknown): string {
	const text = String(value ?? '').trim();
	const quoted = text.match(/^"(.*)"$/);
	return (quoted?.[1] || text).trim();
}

export function shortcutPathBasename(value: string): string {
	return cleanShortcutPath(value).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

export function shortcutPathDirectory(value: string): string {
	const clean = cleanShortcutPath(value);
	const index = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'));
	return index > 0 ? clean.slice(0, index) : '';
}

export function readShortcutOverviewField(app: any, ...keys: string[]): string {
	const containers = [app, app?.app_overview, app?.m_appOverview, app?.overview];
	for (const container of containers) {
		if (!container) continue;
		for (const key of keys) {
			const value = container[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
	}
	return '';
}

export function shortcutExecutableIdentity(value: string): string {
	return cleanShortcutPath(value).replace(/\//g, '\\').replace(/\\+/g, '\\').toLocaleLowerCase();
}

/** Language-independent identity for the concrete launch definition. Steam's
 * non-Steam AppID can change when its display name changes, so persistent
 * decisions must never rely on AppID/title alone. */
export function shortcutStableIdentity(app: any): string {
	if (!app) return '';
	const executable = shortcutExecutableIdentity(readShortcutOverviewField(
		app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
	));
	if (!executable) return '';
	const startDir = shortcutExecutableIdentity(readShortcutOverviewField(
		app, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir',
	));
	const launchOptions = readShortcutOverviewField(
		app, 'strShortcutLaunchOptions', 'm_strShortcutLaunchOptions', 'shortcut_launch_options', 'strArguments',
	).replace(/\s+/g, ' ').trim().toLocaleLowerCase();
	return `${executable}|${startDir}|${launchOptions}`;
}

export function shortcutStableIdentityById(shortcutAppId: number): string {
	return shortcutStableIdentity(getShortcutAppById(shortcutAppId));
}

export function toSignedShortcutAppId(shortcutAppId: number): number {
	return shortcutAppId >= SHORTCUT_THRESHOLD ? shortcutAppId - 4294967296 : shortcutAppId;
}

export function canonicalizeGameTitle(value: string): string {
	let text = normalizeTitle(value)
		.replace(/\.(?:exe|com|bat|cmd|lnk|appimage)$/i, '')
		.replace(/\[[^\]]*\]/g, ' ')
		.replace(/\([^)]*(?:v\d|build|multi)[^)]*\)/gi, ' ')
		.replace(/\bv\d+(?:\.\d+)*\b/gi, ' ')
		.replace(/\b(?:edition|deluxe|ultimate|complete|remastered|goty|gog)\b/gi, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

	// Replace Roman numerals as standalone words
	text = text
		.replace(/\bviii\b/g, '8')
		.replace(/\bvii\b/g, '7')
		.replace(/\bvi\b/g, '6')
		.replace(/\biv\b/g, '4')
		.replace(/\bv\b/g, '5')
		.replace(/\biii\b/g, '3')
		.replace(/\bii\b/g, '2')
		.replace(/\bix\b/g, '9')
		.replace(/\bx\b/g, '10');

	return text.replace(/\s+/g, '');
}

/** Identity-safe display-title comparison.
 *
 * Never use substring matching here. Franchise titles such as "God of War"
 * and "God of War Ragnarök" must remain distinct shortcuts even though one
 * normalized title is a prefix of the other. The canonical fallback only
 * removes packaging/noise tokens and still requires full equality. */
export function looseMatchTitle(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (normalizeTitle(a) === normalizeTitle(b)) return true;
	const cleanA = canonicalizeGameTitle(a);
	const cleanB = canonicalizeGameTitle(b);
	return cleanA !== '' && cleanA === cleanB;
}

export function getSteamAppStore(doc?: Document): any | null {
	const windows: any[] = [];
	const seen = new Set<any>();
	const enqueue = (candidate: any): void => {
		if (!candidate || seen.has(candidate)) return;
		seen.add(candidate);
		windows.push(candidate);
	};
	try { enqueue(doc?.defaultView); } catch {}
	try { enqueue(window); } catch {}
	try { enqueue(document?.defaultView); } catch {}

	for (let index = 0; index < windows.length && index < 32; index += 1) {
		const win = windows[index];
		try { if (isUsableAppStore(win?.appStore)) return win.appStore; } catch {}
		try { if (isUsableAppStore(win?.AppStore)) return win.AppStore; } catch {}
		try { enqueue(win?.parent); enqueue(win?.top); enqueue(win?.opener); } catch {}
		try { for (let frame = 0; frame < Number(win?.frames?.length || 0); frame += 1) enqueue(win.frames[frame]); } catch {}
		try {
			const pm = win?.g_PopupManager;
			for (const name of ['SP Desktop_uid0', 'SP Desktop', 'SP BPM_uid0', 'SP BPM']) {
				const popup = pm?.GetExistingPopup?.(name) || pm?.m_mapPopups?.get?.(name);
				enqueue(popup?.m_popup?.window || popup?.window || popup?.m_popup || popup);
			}
			const popups = pm?.m_mapPopups instanceof Map ? Array.from(pm.m_mapPopups.values()) : Object.values(pm?.m_mapPopups || {});
			for (const popup of popups as any[]) enqueue(popup?.m_popup?.window || popup?.window);
		} catch {}
	}
	return null;
}

/** Find a non-Steam shortcut's internal AppID by its display name.
 * Exact normalized equality wins. Canonical equality is allowed only when it
 * identifies a single shortcut; ambiguous franchise/name matches return null. */
export function findShortcutAppIdByName(title: string): number | null {
	const normalizedTarget = normalizeTitle(title);
	const canonicalTarget = canonicalizeGameTitle(title);
	const exact: number[] = [];
	const canonical: number[] = [];
	const seen = new Set<number>();
	const entries = collectStoreEntries(getSteamAppStore());
	for (const [id, app] of fallbackShortcutApps) entries.push([id, app]);
	for (const [id, app] of entries) {
		const rawId = Number(id ?? app?.appid);
		if (!Number.isFinite(rawId)) continue;
		const numId = rawId < 0 ? (rawId >>> 0) : rawId;
		if (numId < SHORTCUT_THRESHOLD || seen.has(numId)) continue;
		seen.add(numId);
		const name = String(app?.display_name || app?.m_strDisplayName || app?.strDisplayName || app?.strAppName || app?.name || '').trim();
		if (!name) continue;
		if (normalizedTarget && normalizeTitle(name) === normalizedTarget) exact.push(numId);
		else if (canonicalTarget && canonicalizeGameTitle(name) === canonicalTarget) canonical.push(numId);
	}
	if (exact.length === 1) return exact[0];
	if (exact.length > 1) return exact[0];
	if (canonical.length === 1) return canonical[0];
	return null;
}

/** Resolve the shortcut ID represented by a Steam library document. */
export function findActiveShortcutAppId(doc: Document, title: string): string | null {
	const trimmedTitle = (title || '').trim();
	const localUrls = [
		String(doc.defaultView?.location?.href || ''),
		String(doc.location?.href || ''),
	].filter(Boolean);
	const urls = localUrls.length > 0 ? localUrls : [
		...(typeof document !== 'undefined' ? [String((window as any).location?.href || ''), String(document.location?.href || '')] : []),
	].filter(Boolean);
	for (const url of urls) {
		const match = url.match(/(?:games\/details|library\/app|app)\/(\d+)/i);
		if (match && Number(match[1]) >= SHORTCUT_THRESHOLD) {
			const candidateId = Number(match[1]);
			if (trimmedTitle) {
				const ids = findShortcutAppIdsByName(trimmedTitle);
				if (ids.includes(candidateId)) return String(candidateId);
				const app = getShortcutAppById(candidateId);
				const name = String(app?.display_name || app?.m_strDisplayName || '').trim();
				if (name && (looseMatchTitle(name, trimmedTitle) || normalizeTitle(name) === normalizeTitle(trimmedTitle))) {
					return String(candidateId);
				}
				// Candidate belongs to another game: skip this stale route URL
				continue;
			}
			if (getShortcutAppById(candidateId)) return String(candidateId);
			return match[1];
		}
	}
	const docsToInspect: Document[] = [doc];
	if (typeof document !== 'undefined' && !docsToInspect.includes(document)) docsToInspect.push(document);
	try {
		const idPattern = /(?:^|[^0-9])(\d{7,})(?:$|[^0-9])/g;
		for (const targetDoc of docsToInspect) {
			const selected = Array.from(targetDoc.querySelectorAll<HTMLElement>(
				'[aria-current="page"], [aria-selected="true"], [class*="selected"], [class*="Selected"], [class*="active"], [class*="Active"], [class*="focused"], [class*="Focused"], [class*="gameListRow"]',
			));
			for (const element of selected) {
				const values = [
					element.getAttribute('data-appid'), element.getAttribute('data-app-id'),
					element.getAttribute('data-ds-appid'), element.getAttribute('data-panel'),
					element.getAttribute('href'), element.id,
				].filter(Boolean).join(' ');
				for (const match of values.matchAll(idPattern)) {
					const candidateId = Number(match[1]);
					if (candidateId < SHORTCUT_THRESHOLD) continue;
					const signed = candidateId > 2147483647 ? candidateId - 4294967296 : candidateId;
					const app = getShortcutAppById(candidateId);
					if (!app) {
						// On Steam startup, appStore.m_mapApps may still be hydrating.
						// If this candidateId already exists in our saved mappings, resolve it immediately.
						const isKnown = Boolean(
							mappings[shortcutMappingKey(candidateId)]
							|| mappings[shortcutMappingKey(signed)]
							|| (trimmedTitle && findMappingForTitle(trimmedTitle, candidateId))
						);
						if (isKnown) return String(candidateId);
						continue;
					}
					const name = String(app?.display_name || app?.m_strDisplayName || '').trim();
					if (!trimmedTitle || !name || looseMatchTitle(name, trimmedTitle) || normalizeTitle(name) === normalizeTitle(trimmedTitle)) {
						return String(candidateId);
					}
				}
			}
		}
	} catch {}
	if (trimmedTitle) {
		const byName = findShortcutAppIdByName(trimmedTitle);
		if (byName) return String(byName);
	}
	return null;
}

/** Find every shortcut matching a display name; useful while Steam is rebuilding an ID after rename. */
export function findShortcutAppIdsByName(title: string): number[] {
	const normalized = normalizeTitle(title);
	const result: number[] = [];
	const entries = collectStoreEntries(getSteamAppStore());
	for (const [id, app] of fallbackShortcutApps) entries.push([id, app]);
	for (const [id, app] of entries) {
		const rawId = Number(id ?? app?.appid);
		const numId = rawId < 0 ? (rawId >>> 0) : rawId;
		if (!Number.isFinite(numId) || numId < SHORTCUT_THRESHOLD) continue;
		const name = app?.display_name || app?.m_strDisplayName || app?.strDisplayName || app?.strAppName || app?.name || '';
		if (name && normalizeTitle(name) === normalized && !result.includes(numId)) result.push(numId);
	}
	return result;
}

/** Find native Steam AppID by game display name from Steam's loaded app store. */
export function findNativeSteamAppIdByName(title: string): string | null {
	const appStore = getSteamAppStore();
	if (!appStore) return null;
	const normalized = normalizeTitle(title);
	for (const [id, app] of collectStoreEntries(appStore)) {
		const rawId = Number(id);
		const numId = rawId < 0 ? (rawId >>> 0) : rawId;
		if (!Number.isFinite(numId) || numId >= SHORTCUT_THRESHOLD || numId === 0) continue;
		const name = app?.display_name || app?.m_strDisplayName || app?.name || '';
		if (name && (normalizeTitle(name) === normalized || looseMatchTitle(name, title))) {
			return String(numId);
		}
	}
	return null;
}

export function getShortcutAppById(shortcutAppId: number, doc?: Document): any | null {
	const appStore = getSteamAppStore(doc);
	if (!appStore) return fallbackShortcutApps.get(shortcutAppId) || null;
	const signedId = toSignedShortcutAppId(shortcutAppId);
	if (typeof appStore.GetAppOverviewByAppID === 'function') {
		try {
			const app = appStore.GetAppOverviewByAppID(shortcutAppId)
				|| appStore.GetAppOverviewByAppID(signedId);
			if (app) return app;
		} catch {}
	}
	if (!appStore.m_mapApps) return null;
	try {
		if (typeof appStore.m_mapApps.get === 'function') {
			const direct = appStore.m_mapApps.get(shortcutAppId)
				|| appStore.m_mapApps.get(signedId)
				|| appStore.m_mapApps.get(String(shortcutAppId))
				|| appStore.m_mapApps.get(String(signedId));
			if (direct) return direct;
		} else if (typeof appStore.m_mapApps === 'object') {
			const direct = appStore.m_mapApps[shortcutAppId]
				|| appStore.m_mapApps[signedId]
				|| appStore.m_mapApps[String(shortcutAppId)]
				|| appStore.m_mapApps[String(signedId)];
			if (direct) return direct;
		}
	} catch {}
	const ids = new Set([shortcutAppId, signedId]);
	try {
		if (appStore.m_mapApps instanceof Map || typeof appStore.m_mapApps?.[Symbol.iterator] === 'function') {
			for (const [id, app] of appStore.m_mapApps) {
				const rawId = Number(id);
				const normalizedId = rawId < 0 ? (rawId >>> 0) : rawId;
				if (ids.has(rawId) || ids.has(normalizedId) || ids.has(Number(app?.appid))) return app;
			}
		} else if (typeof appStore.m_mapApps === 'object') {
			for (const [id, app] of Object.entries(appStore.m_mapApps)) {
				const rawId = Number(id);
				const normalizedId = rawId < 0 ? (rawId >>> 0) : rawId;
				if (ids.has(rawId) || ids.has(normalizedId) || ids.has(Number((app as any)?.appid))) return app;
			}
		}
	} catch {}
	try {
		for (const app of Array.from(appStore.allApps || []) as any[]) {
			const rawId = Number(app?.appid);
			const normalizedId = rawId < 0 ? (rawId >>> 0) : rawId;
			if (ids.has(rawId) || ids.has(normalizedId)) return app;
		}
	} catch {}
	return fallbackShortcutApps.get(shortcutAppId) || null;
}

/** Get shortcut lifetime playtime from Steam without permanently caching transient empty startup values. */
export async function getShortcutPlaytimeMinutes(shortcutAppId: number): Promise<number | null> {
	const existing = shortcutPlaytimeRequests.get(shortcutAppId);
	if (existing) return existing;
	const request = (async () => {
		try {
			const appsApi = (window as any).SteamClient?.Apps;
			if (typeof appsApi?.GetPlaytime !== 'function') return null;
			const ids = [shortcutAppId, toSignedShortcutAppId(shortcutAppId)];
			let best = 0;
			for (const id of ids) {
				try {
					const playtime = await appsApi.GetPlaytime(id);
					const minutes = Number(playtime?.nPlaytimeForever ?? playtime?.minutes_playtime_forever ?? 0);
					if (Number.isFinite(minutes) && minutes > best) best = minutes;
				} catch {}
			}
			return best > 0 ? best : null;
		} catch (error) {
			backendLog(`Shortcut playtime lookup failed for ${shortcutAppId}: ${error}`);
			return null;
		}
	})();
	const retryable = request.then((minutes) => {
		if (minutes === null) shortcutPlaytimeRequests.delete(shortcutAppId);
		else setTimeout(() => {
			if (shortcutPlaytimeRequests.get(shortcutAppId) === retryable) shortcutPlaytimeRequests.delete(shortcutAppId);
		}, 15000);
		return minutes;
	});
	shortcutPlaytimeRequests.set(shortcutAppId, retryable);
	return retryable;
}

export function getMappedShortcuts(doc?: Document): Array<{ id: number; title: string; steamAppId: string }> {
	const appStore = getSteamAppStore(doc);
	const result: Array<{ id: number; title: string; steamAppId: string }> = [];
	const seen = new Set<number>();
	const entries: Array<[unknown, any]> = [];
	try {
		if (appStore?.m_mapApps instanceof Map || typeof appStore?.m_mapApps?.[Symbol.iterator] === 'function') {
			for (const [id, app] of appStore.m_mapApps) entries.push([id, app]);
		} else if (appStore?.m_mapApps && typeof appStore.m_mapApps === 'object') {
			for (const [id, app] of Object.entries(appStore.m_mapApps)) entries.push([id, app]);
		}
	} catch {}
	try { for (const app of Array.from(appStore?.allApps || []) as any[]) entries.push([app?.appid, app]); } catch {}
	for (const [id, app] of entries) {
		const rawId = Number(id);
		const shortcutId = rawId < 0 ? (rawId >>> 0) : rawId;
		const title = String(app?.display_name || app?.m_strDisplayName || '').trim();
		if (!Number.isFinite(shortcutId) || shortcutId < SHORTCUT_THRESHOLD || !title) continue;
		const steamAppId = findMappingForTitle(title, shortcutId);
		if (/^\d+$/.test(String(steamAppId || '')) && !seen.has(shortcutId)) {
			result.push({ id: shortcutId, title, steamAppId: String(steamAppId) });
			seen.add(shortcutId);
		}
	}
	for (const [key, steamAppId] of Object.entries(mappings)) {
		if (!key.startsWith('shortcut:') || !/^\d+$/.test(steamAppId)) continue;
		const shortcutId = Number(key.slice('shortcut:'.length));
		if (!Number.isFinite(shortcutId) || shortcutId < SHORTCUT_THRESHOLD || seen.has(shortcutId)) continue;
		const app = getShortcutAppById(shortcutId, doc);
		const title = String(app?.display_name || app?.m_strDisplayName || app?.name || '').trim();
		result.push({ id: shortcutId, title: title || `Shortcut ${shortcutId}`, steamAppId });
		seen.add(shortcutId);
	}
	return result;
}

export function clearShortcutRuntimeCaches(): void {
	shortcutPlaytimeRequests.clear();
}

/** Check if the Steam Library tab or UI view is currently active in the client. */
export function isSteamLibraryActive(doc?: Document | null): boolean {
	const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
	if (!targetDoc || !targetDoc.body) return false;

	const urls = [
		String(targetDoc.defaultView?.location?.href || ''),
		String(targetDoc.location?.href || ''),
		String((window as any).location?.href || ''),
	];
	for (const url of urls) {
		if (/store\.steampowered\.com|steamcommunity\.com|help\.steampowered\.com|steampowered\.com/i.test(url)) {
			return false;
		}
		if (/(?:games\/details|library|libraryroot|steamloopback\.host)/i.test(url)) {
			return true;
		}
	}

	try {
		const activeNav = targetDoc.querySelector(
			'[class*="supernav"] [class*="active"], [class*="supernav"] [class*="selected"], [class*="supernav"] [aria-current="page"], [class*="tab_active"], [class*="activeTab"], [class*="active_tab"]'
		);
		if (activeNav) {
			const text = (activeNav.textContent || '').toLowerCase();
			const href = (activeNav.getAttribute('href') || '').toLowerCase();
			if (/store|tienda|loja|magasin|boutique|shop|магазин|магазине|商店|商店|스토어|comunidad|comunidade|community|communauté|сообщество|社区|chat|amigos|friends|друзья/i.test(text)
				|| /store|community|comunidade|сообще|社区/i.test(href)) {
				return false;
			}
			if (/biblioteca|library|bibliothèque|bibliothek|biblioteka|bibliotheek|biblioteka|games|jeux|spiele|gioco|игр|библиотек|kolekcja|图书馆|游戏|ライブラリ|라이브러리/i.test(text)
				|| /games|library|bibliot|игр|библиотек|游戏/i.test(href)) {
				return true;
			}
		}
	} catch {}

	try {
		const libraryContainer = targetDoc.querySelector(
			'[class*="libraryroot"], [class*="libraryhome"], [class*="appdetails"], [class*="gamepadappoverview"], [class*="gamelistsection"]'
		);
		if (libraryContainer instanceof HTMLElement) {
			const style = targetDoc.defaultView?.getComputedStyle(libraryContainer);
			const rect = libraryContainer.getBoundingClientRect();
			if (rect.width > 200 && rect.height > 200 && style?.display !== 'none' && style?.visibility !== 'hidden') {
				return true;
			}
		}
	} catch {}

	return false;
}
