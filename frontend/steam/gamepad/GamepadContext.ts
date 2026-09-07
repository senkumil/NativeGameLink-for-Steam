import { normalizeTitle } from '../../core/text';
import { getMappedShortcuts, getShortcutAppById, looseMatchTitle, toSignedShortcutAppId } from '../shortcuts';
import { findMappingForTitle, mappings, shortcutMappingKey } from '../../core/mappings';

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

function mappedShortcutIds(shortcut: MappedShortcut): number[] {
	const raw = Number(shortcut.id);
	const unsigned = raw >>> 0;
	const signed = toSignedShortcutAppId(unsigned);
	return Array.from(new Set([raw, unsigned, signed])).filter(Number.isFinite);
}

function linkedContext(shortcut: MappedShortcut): ActiveGameContext {
	const unsigned = Number(shortcut.id) >>> 0;
	const steamAppId = Number(shortcut.steamAppId);
	const app = getShortcutAppById(shortcut.id);
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

function contextForRawAppId(rawAppId: unknown, shortcuts: MappedShortcut[]): ActiveGameContext | null {
	const numeric = Number(rawAppId);
	if (!Number.isFinite(numeric) || numeric === 0) return null;
	const shortcut = shortcuts.find(item => mappedShortcutIds(item).includes(numeric));
	if (shortcut) return linkedContext(shortcut);
	const unsigned = numeric < 0 ? (numeric >>> 0) : numeric;
	if (unsigned > 0 && unsigned < 2147483648) return { type: 'steam', steamAppId: unsigned };
	return null;
}

function collectWindows(doc: Document): any[] {
	const result: any[] = [];
	const add = (value: any): void => {
		if (value && !result.includes(value)) result.push(value);
	};
	add(doc.defaultView);
	try {
		if (doc.defaultView?.parent && doc.defaultView.parent !== doc.defaultView) {
			add(doc.defaultView.parent);
		}
	} catch {}
	try {
		if (doc.defaultView?.top && doc.defaultView.top !== doc.defaultView) {
			add(doc.defaultView.top);
		}
	} catch {}
	for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe'))) {
		try { add(frame.contentWindow); } catch {}
	}
	if (result.length === 0 && typeof window !== 'undefined') {
		add(window);
	}
	return result;
}

function addCandidateValue(target: Set<string>, value: unknown): void {
	if (typeof value === 'string' || typeof value === 'number') target.add(String(value));
}

function readPath(root: any, path: string): unknown {
	try { return path.split('.').reduce((value, key) => value?.[key], root); }
	catch { return undefined; }
}

export const NON_DETAILS_ROUTE_PATTERN = /(?:\/routes\/library\/(?:all|collections|installed|shortcuts|nonsteam|controller|home|recent|shelves|filter)|\/routes\/(?:store|community|chat|settings|downloads|friends|media))/i;
export const APP_DETAILS_ROUTE_PATTERN = /(?:\/routes\/library\/app\/|\/library\/app\/|\/appdetails\/|\/details\/|\/game\/|[?&#]appid=)(-?\d+)/i;

export function collectActiveRouteValues(doc: Document): string[] {
	const values = new Set<string>();
	addCandidateValue(values, doc.URL);
	addCandidateValue(values, doc.baseURI);
	const paths = [
		'location.href', 'location.pathname', 'location.hash',
		'g_Router.history.location.pathname', 'g_Router.history.location.search', 'g_Router.history.location.hash',
		'g_Router.location.pathname', 'g_Router.m_history.location.pathname',
		'Router.history.location.pathname', 'router.history.location.pathname',
		'SteamUIStore.m_currentPath', 'SteamUIStore.m_strCurrentRoute',
	];
	for (const win of collectWindows(doc)) {
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
	}
	return Array.from(values).map(value => {
		try { return decodeURIComponent(value); } catch { return value; }
	});
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
		if (element.closest('#gdl-bp-detail-root, #gdl-bp-detail-shell, #gdl-bp-detail-fallback-panel, [id^="gdl-"], [data-gdl-big-picture-details], [class*="AllGames"], [class*="CollectionsHeader"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"], [class*="Carousel"], [role="tablist"]')) {
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
	const hasLibraryRoute = routeValues.some(v => NON_DETAILS_ROUTE_PATTERN.test(v));
	const hasAppRoute = routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v));
	if (hasLibraryRoute && !hasAppRoute) {
		return { type: 'none' };
	}

	const routePattern = /(?:\/routes\/library\/app\/|\/library\/app\/|\/appdetails\/|\/details\/|\/game\/|[?&#]appid=)(-?\d+)/ig;
	for (const value of routeValues) {
		routePattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = routePattern.exec(value))) {
			const context = contextForRawAppId(match[1], shortcuts);
			if (context?.type === 'shortcut-linked') return context;
			if (context?.type === 'steam') return context;
		}
	}

	if (doc.querySelector('[class*="AllGames"], [class*="CollectionsHeader"], [class*="LibraryHome"]')) {
		return { type: 'none' };
	}

	const stateIds = [...activeAppIdsFromStores(doc), ...appIdsFromReactOwners(doc)];
	for (const id of stateIds) {
		const context = contextForRawAppId(id, shortcuts);
		if (context?.type === 'shortcut-linked') return context;
	}
	const official = stateIds.find(id => id > 0 && id < 2147483648);
	return official ? { type: 'steam', steamAppId: official } : null;
}

function headingContext(doc: Document, shortcuts: MappedShortcut[]): ActiveGameContext | null {
	if (doc.querySelector('[class*="AllGames"], [class*="CollectionsHeader"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return null;
	}
	const routeValues = collectActiveRouteValues(doc);
	if (routeValues.some(v => NON_DETAILS_ROUTE_PATTERN.test(v)) && !routeValues.some(v => APP_DETAILS_ROUTE_PATTERN.test(v))) {
		return null;
	}
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
		if (shortcut) return linkedContext(shortcut);
	}
	return null;
}

export function resolveActiveGameContext(doc?: Document): ActiveGameContext {
	const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
	if (!targetDoc) return { type: 'none' };
	if (targetDoc.querySelector('[class*="AllGames"], [class*="CollectionsHeader"], [class*="LibraryHome"], [class*="AllCollections"]')) {
		return { type: 'none' };
	}
	const shortcuts = getMappedShortcuts();
	const activeMarker = targetDoc.querySelector<HTMLElement>('[data-gdl-active-shortcut-id]');
	if (activeMarker) {
		const marked = contextForRawAppId(activeMarker.getAttribute('data-gdl-active-shortcut-id'), shortcuts);
		if (marked) return marked;
		const rawAppId = Number(activeMarker.getAttribute('data-gdl-active-shortcut-id'));
		const app = getShortcutAppById(rawAppId);
		const title = String(app?.display_name || app?.m_strDisplayName || '').trim();
		const mappingKey = shortcutMappingKey(rawAppId);
		const mappedAppId = mappings[mappingKey] || (title ? findMappingForTitle(title) : null);
		if (mappedAppId && /^\d+$/.test(mappedAppId)) {
			return linkedContext({ id: rawAppId, title: title || `App ${rawAppId >>> 0}`, steamAppId: mappedAppId });
		}
		return { type: 'shortcut-unlinked', shortcutAppId: rawAppId >>> 0, title: title || `App ${rawAppId >>> 0}` };
	}

	const byHeading = headingContext(targetDoc, shortcuts);
	if (byHeading?.type === 'shortcut-linked') return byHeading;

	const identity = activeContextFromIdentity(targetDoc, shortcuts);
	if (identity?.type === 'shortcut-linked') return identity;
	if (identity?.type === 'steam') return identity;
	return identity || { type: 'none' };
}
