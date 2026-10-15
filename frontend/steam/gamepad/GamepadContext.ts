import { normalizeTitle } from '../../core/text';
import { getMappedShortcuts, getShortcutAppById, looseMatchTitle, toSignedShortcutAppId } from '../shortcuts';
import { findMappingForTitle, isMappingSnapshotVerified, mappings, shortcutMappingKey } from '../../core/mappings';
import { getNativeWindowInstance } from '../native-window-store';

export interface LinkedGameIdentity {
	shortcutAppId: number;
	steamAppId: number;
	executable?: string;
	startDir?: string;
	launchOptions?: string;
	canonicalId: string;
	title: string;
}

export interface ActiveGameContext {
	type: 'steam' | 'shortcut-unlinked' | 'shortcut-linked' | 'none';
	identity?: LinkedGameIdentity;
	shortcutAppId?: number;
	steamAppId?: number;
	title?: string;
}

type MappedShortcut = ReturnType<typeof getMappedShortcuts>[number];

/** Accept Steam's signed shortcut representation without wrapping invalid IDs. */
export function normalizeGamepadAppId(value: unknown): number | null {
	const raw = Number(value);
	if (!Number.isInteger(raw) || raw === 0 || raw < -2147483648 || raw > 4294967295) return null;
	return raw < 0 ? raw >>> 0 : raw;
}

function mappedShortcutIds(shortcut: MappedShortcut): number[] {
	const raw = Number(shortcut.id);
	const unsigned = normalizeGamepadAppId(raw);
	if (unsigned === null || unsigned < 2147483648) return [];
	const signed = toSignedShortcutAppId(unsigned);
	return Array.from(new Set([raw, unsigned, signed])).filter(Number.isFinite);
}

function linkedContext(shortcut: MappedShortcut, doc: Document): ActiveGameContext {
	const unsigned = normalizeGamepadAppId(shortcut.id)!;
	const steamAppId = Number(shortcut.steamAppId);
	if (!Number.isInteger(steamAppId) || steamAppId <= 0 || steamAppId >= 2147483648) {
		return { type: 'shortcut-unlinked', shortcutAppId: unsigned, title: shortcut.title };
	}
	const app = getShortcutAppById(unsigned, doc);
	return {
		type: 'shortcut-linked',
		shortcutAppId: unsigned,
		steamAppId,
		title: shortcut.title,
		identity: {
			shortcutAppId: unsigned,
			steamAppId,
			executable: app?.exe,
			startDir: app?.openvr_action_manifest_path,
			launchOptions: app?.LaunchOptions,
			canonicalId: `${unsigned}:${steamAppId}`,
			title: shortcut.title,
		},
	};
}

function contextForRawAppId(rawAppId: unknown, shortcuts: MappedShortcut[], doc: Document): ActiveGameContext | null {
	const numeric = Number(rawAppId);
	const unsigned = normalizeGamepadAppId(rawAppId);
	if (unsigned === null) return null;
	// A public AppID is always Steam-owned, even if a malformed mapping or stale
	// plugin marker happens to contain it.
	if (unsigned < 2147483648) return { type: 'steam', steamAppId: unsigned };
	const shortcut = shortcuts.find(item => mappedShortcutIds(item).includes(numeric));
	if (shortcut) return linkedContext(shortcut, doc);
	return { type: 'shortcut-unlinked', shortcutAppId: unsigned };
}

function collectWindows(doc: Document): any[] {
	// Parent/child browser windows can be displaying a different game. Their
	// route or selected app is never evidence of ownership of this Document.
	return doc.defaultView ? [doc.defaultView] : [];
}

function addCandidateValue(target: Set<string>, value: unknown): void {
	if (typeof value === 'string' || typeof value === 'number') target.add(String(value));
}

function readPath(root: any, path: string): unknown {
	try { return path.split('.').reduce((value, key) => value?.[key], root); }
	catch { return undefined; }
}

function owningWindowInstance(doc: Document): any | null {
	return getNativeWindowInstance(doc);
}

export const NON_DETAILS_ROUTE_PATTERN = /(?:\/(?:routes\/)?library(?:\/(?:all|collections?|installed|shortcuts|nonsteam|controller|home|recent|shelves|filter)(?=[/?#]|$)|(?=[?#]|$))|\/(?:routes\/)?(?:store|community|chat|settings|downloads|friends|media)(?=[/?#]|$))/i;
export const APP_DETAILS_ROUTE_PATTERN = /(?:\/routes\/library\/app\/|\/library\/app\/|\/appdetails\/|\/details\/|\/game\/|[?&#]appid=)(-?\d+)(?=[/?&#]|$)/i;
// A native AppDetails path can contain tab names such as /tab/Community.
// Only a root details path may outrank the non-details destination guard.
const ROOT_APP_DETAILS_ROUTE_PATTERN = /^(?:https?:\/\/[^/?#]+)?(?:\/routes)?\/library\/app\/(-?\d+)(?=[/?&#]|$)/i;
const DETAILS_ROUTE_PREFIX_PATTERN = /(?:\/routes\/library\/app\/|\/library\/app\/|\/appdetails\/|\/details\/|\/game\/|[?&#]appid=)/i;

export function collectActiveRouteValues(doc: Document): string[] {
	const values = new Set<string>();
	const nativeInstance = owningWindowInstance(doc);
	if (nativeInstance) {
		// Read live history before the pathname copied during React's effect.
		for (const path of ['History.location.pathname', 'm_history.location.pathname', 'm_history.location.search', 'm_history.location.hash']) {
			addCandidateValue(values, readPath(nativeInstance, path));
		}
		addCandidateValue(values, nativeInstance.LocationPathName);
	}
	const paths = [
		// Steam's Gamepad router publishes this local NavStore, independently
		// of WindowStore and g_Router. Its live history is the route source in
		// clients where the browser URL remains the /gamepadui shell.
		'tempNavStore.m_history.location.pathname', 'tempNavStore.m_history.location.search', 'tempNavStore.m_history.location.hash',
		'tempNavStore.m_locationPathname',
		'g_Router.history.location.pathname', 'g_Router.history.location.search', 'g_Router.history.location.hash',
		'g_Router.location.pathname', 'g_Router.m_history.location.pathname',
		'Router.history.location.pathname', 'router.history.location.pathname',
		'SteamUIStore.m_currentPath', 'SteamUIStore.m_strCurrentRoute',
	];
	for (const win of collectWindows(doc)) {
		if (!nativeInstance) try {
			const instance = win.uiStore?.GetActiveWindowInstance?.();
			if (!instance?.BrowserWindow || instance.BrowserWindow === win) addCandidateValue(values, instance?.LocationPathName);
		} catch {}
		for (const path of paths) addCandidateValue(values, readPath(win, path));
		for (const key of ['g_Router', 'Router', 'router']) {
			const router = readPath(win, key);
			if (!router || typeof router !== 'object') continue;
			for (const member of ['pathname', 'path', 'route', 'url', 'href', 'location', 'currentLocation']) {
				const value = readPath(router, member);
				if (value && typeof value === 'object') {
					for (const nested of ['pathname', 'path', 'route', 'url', 'href', 'search', 'hash']) addCandidateValue(values, readPath(value, nested));
				} else addCandidateValue(values, value);
			}
		}
		for (const path of ['location.hash', 'location.pathname', 'location.href']) addCandidateValue(values, readPath(win, path));
	}
	addCandidateValue(values, doc.URL);
	// baseURI can be Steam's shell or an old document base. It does not identify
	// the current game and cannot override the live router.
	return Array.from(values).map(value => {
		try { return decodeURIComponent(value); } catch { return value; }
	});
}

/** Compact local diagnostics; never log a shell URL's query or fragment. */
export function describeLinkedGamepadTarget(doc: Document, shortcutAppId: unknown, steamAppId: unknown): string {
	const shortcutId = normalizeGamepadAppId(shortcutAppId);
	const view = doc.defaultView;
	const live = Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected);
	const verified = isMappingSnapshotVerified();
	const mapped = shortcutId === null ? '' : String(mappings[shortcutMappingKey(shortcutId)] || '');
	const paths = collectActiveRouteValues(doc).map(value => value.split(/[?#]/, 1)[0]
		.replace(/^https?:\/\/[^/]+/i, '').replace(/[\r\n]/g, '').slice(0, 120));
	return `live=${Number(live)} verified=${Number(verified)} target=${shortcutId}:${Number(steamAppId)} mapping=${mapped || 'missing'} paths=${JSON.stringify([...new Set(paths)].slice(0, 6))}`;
}

function contextFromRoute(doc: Document, shortcuts: MappedShortcut[]): ActiveGameContext | null {
	for (const value of collectActiveRouteValues(doc)) {
		const rootDetails = ROOT_APP_DETAILS_ROUTE_PATTERN.exec(value);
		if (rootDetails) return contextForRawAppId(rootDetails[1], shortcuts, doc) || { type: 'none' };
		// A Store/Home destination may carry an AppID in its query or coexist
		// with an old history entry. Neither turns it into the details surface.
		if (NON_DETAILS_ROUTE_PATTERN.test(value)) return { type: 'none' };
		const match = APP_DETAILS_ROUTE_PATTERN.exec(value);
		if (match) return contextForRawAppId(match[1], shortcuts, doc) || { type: 'none' };
		if (DETAILS_ROUTE_PREFIX_PATTERN.test(value)) return { type: 'none' };
	}
	return null;
}

/** Mutation/input ownership requires a real route, never a heading or our DOM. */
export function isCurrentLinkedGamepadTarget(doc: Document, shortcutAppId: unknown, steamAppId: unknown): boolean {
	const view = doc.defaultView;
	if (!view || view.closed || view.document !== doc || !doc.body?.isConnected) return false;
	const shortcutId = normalizeGamepadAppId(shortcutAppId);
	if (shortcutId === null || shortcutId < 2147483648) return false;
	if (!isMappingSnapshotVerified()
		|| String(mappings[shortcutMappingKey(shortcutId)] || '') !== String(steamAppId)) return false;
	// This guard is also used on input ticks. The exact committed pair is
	// already known; do not enumerate the whole Steam library on each tick.
	const context = contextFromRoute(doc, [{ id: shortcutId, steamAppId: String(steamAppId), title: '' }]);
	return context?.type === 'shortcut-linked'
		&& context.identity?.shortcutAppId === shortcutId
		&& context.identity?.steamAppId === Number(steamAppId);
}

function activeAppIdsFromStores(doc: Document): number[] {
	const ids = new Set<number>();
	const activeKey = /(?:selected|current|active|focused|last).*(?:app|game)|(?:app|game).*(?:selected|current|active|focused|last)/i;
	const addValue = (value: any): void => {
		if (value == null) return;
		for (const raw of [value, value?.appid, value?.appId, value?.app_id, value?.m_unAppID, value?.m_nAppID, value?.overview?.appid, value?.appOverview?.appid]) {
			const num = Number(raw);
			if (Number.isFinite(num) && num !== 0) ids.add(num);
		}
	};
	for (const win of collectWindows(doc)) {
		for (const storeName of ['appStore', 'AppStore', 'libraryStore', 'LibraryStore', 'SteamUIStore']) {
			const store = readPath(win, storeName) as Record<string, any> | null;
			if (!store || typeof store !== 'object') continue;
			for (const key of Object.keys(store)) {
				if (!activeKey.test(key)) continue;
				try { addValue(store[key]); } catch {}
			}
			for (const method of ['GetSelectedApp', 'GetCurrentApp', 'GetActiveApp', 'GetFocusedApp']) {
				try { if (typeof store[method] === 'function') addValue(store[method]()); } catch {}
			}
		}
	}
	return Array.from(ids);
}

function appIdsFromReactOwners(doc: Document): number[] {
	const ids = new Set<number>();
	const selector = '[class*="AppDetails"], [class*="GameDetails"], [class*="PlayBar"], [class*="Hero"]';
	for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
		if (!element.isConnected || (element.offsetParent === null && element.offsetWidth === 0 && element.offsetHeight === 0)) {
			continue;
		}
		if (element.closest('#gdl-bp-detail-root, #gdl-bp-detail-shell, #gdl-bp-detail-fallback-panel, [id^="gdl-"], [data-gdl-big-picture-details], [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"], [class*="Carousel"], [role="tablist"]')) {
			continue;
		}
		let current: HTMLElement | null = element;
		for (let domDepth = 0; current && domDepth < 5; domDepth += 1, current = current.parentElement) {
			const ownerKey = Object.keys(current).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$') || key.startsWith('__reactProps$'));
			if (!ownerKey) continue;
			let fiber: any = (current as any)[ownerKey];
			for (let fiberDepth = 0; fiber && fiberDepth < 30; fiberDepth += 1, fiber = fiber.return) {
				const props = fiber.memoizedProps || fiber.pendingProps || fiber.props || fiber;
				for (const raw of [props?.appid, props?.appId, props?.nAppID, props?.overview?.appid, props?.appOverview?.appid, props?.game?.appid]) {
					const num = Number(raw);
					if (Number.isFinite(num) && num !== 0) ids.add(num);
				}
			}
		}
	}
	return Array.from(ids);
}

function activeContextFromIdentity(doc: Document, shortcuts: MappedShortcut[]): ActiveGameContext | null {
	const routeValues = collectActiveRouteValues(doc);
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	const routed = contextFromRoute(doc, shortcuts);
	if (routed) return routed;

	if (!hasAppRoute && doc.querySelector('[class*="AllGames"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return { type: 'none' };
	}

	const stateIds = [...activeAppIdsFromStores(doc), ...appIdsFromReactOwners(doc)];
	for (const id of stateIds) {
		const context = contextForRawAppId(id, shortcuts, doc);
		if (context) return context;
	}
	return null;
}

function headingContext(doc: Document, shortcuts: MappedShortcut[]): ActiveGameContext | null {
	const routeValues = collectActiveRouteValues(doc);
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (!hasAppRoute && doc.querySelector('[class*="AllGames"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return null;
	}
	if (routeValues.some(v => NON_DETAILS_ROUTE_PATTERN.test(v)) && !hasAppRoute) {
		return null;
	}
	for (const value of routeValues) {
		const match = APP_DETAILS_ROUTE_PATTERN.exec(value);
		if (match) {
			const id = Number(match[1]);
			const unsigned = id < 0 ? (id >>> 0) : id;
			if (unsigned > 0 && unsigned < 2147483648) {
				const isShortcut = shortcuts.some(item => mappedShortcutIds(item).includes(id));
				if (!isShortcut) return { type: 'steam', steamAppId: unsigned };
			}
		}
	}
	const stateIds = [...activeAppIdsFromStores(doc), ...appIdsFromReactOwners(doc)];
	const official = stateIds.find(id => id > 0 && id < 2147483648 && !shortcuts.some(item => mappedShortcutIds(item).includes(id)));
	if (official) return { type: 'steam', steamAppId: official };

	const byLongestTitle = [...shortcuts].sort((a, b) => b.title.length - a.title.length);
	const headings = Array.from(doc.querySelectorAll<HTMLElement>(
		'h1, h2, h3, [class*="logo" i] img[alt], [class*="Hero" i] img[alt], svg[aria-label], [class*="title" i], [class*="logo" i]'
	));
	for (const heading of headings) {
		if (heading.closest('#gdl-bp-detail-root, #gdl-bp-detail-fallback-panel, #gdl-bp-detail-shell, [id^="gdl-"], [class*="nav" i], [class*="footer" i], [class*="QuickAccess" i], [class*="MainMenu" i], [class*="Capsule" i], [class*="Grid" i], [class*="Shelf" i], [class*="Collection" i], [class*="AllGames" i], [class*="LibraryHome" i], [class*="RecentGames" i], [class*="Carousel" i], [class*="FriendsContainer" i], [class*="Social" i], [class*="Chat" i]')) continue;
		const rect = heading.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0 || rect.top > 500) continue;
		const text = normalizeTitle(heading.getAttribute('alt') || heading.getAttribute('aria-label') || heading.textContent || '');
		if (!text) continue;
		const shortcut = byLongestTitle.find(item => normalizeTitle(item.title) === text || looseMatchTitle(item.title, text));
		if (shortcut) return linkedContext(shortcut, doc);
	}
	return null;
}

export function resolveActiveGameContext(doc?: Document): ActiveGameContext {
	const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
	if (!targetDoc) return { type: 'none' };
	const view = targetDoc.defaultView;
	if (!view || view.closed || view.document !== targetDoc || !targetDoc.body?.isConnected) return { type: 'none' };
	const routeValues = collectActiveRouteValues(targetDoc);
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (!hasAppRoute && targetDoc.querySelector('[class*="AllGames"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return { type: 'none' };
	}
	const shortcuts = getMappedShortcuts(targetDoc);
	const identity = activeContextFromIdentity(targetDoc, shortcuts);
	// Route/store identity takes precedence over all plugin DOM. In particular,
	// keep a stale linked root from adopting a native or unlinked destination.
	if (identity) return identity;
	const activeMarker = targetDoc.querySelector<HTMLElement>('[data-gdl-active-shortcut-id]');
	if (activeMarker) {
		const rawAppId = normalizeGamepadAppId(activeMarker.getAttribute('data-gdl-active-shortcut-id'));
		if (rawAppId === null || rawAppId < 2147483648) return { type: 'none' };
		const marked = contextForRawAppId(rawAppId, shortcuts, targetDoc);
		if (marked?.type === 'shortcut-linked') return marked;
		const app = getShortcutAppById(rawAppId, targetDoc);
		const title = String(app?.display_name || app?.m_strDisplayName || '').trim();
		const mappingKey = shortcutMappingKey(rawAppId);
		const mappedAppId = mappings[mappingKey] || (title ? findMappingForTitle(title) : null);
		if (mappedAppId && /^\d+$/.test(mappedAppId)) {
			return linkedContext({ id: rawAppId, title: title || `App ${rawAppId}`, steamAppId: mappedAppId }, targetDoc);
		}
		return { type: 'shortcut-unlinked', shortcutAppId: rawAppId, title: title || `App ${rawAppId}` };
	}

	const byHeading = headingContext(targetDoc, shortcuts);
	if (byHeading?.type === 'shortcut-linked') return byHeading;
	if (byHeading?.type === 'steam') return byHeading;

	return { type: 'none' };
}
