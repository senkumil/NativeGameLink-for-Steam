import { LINKS_BAR_CLASSES, PLAYBAR_CLASSES } from '../../steam/css';
import { elementsWithCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import { findMappingForShortcut } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { committedHeaderAppId, isPaintedLibraryElement } from '../../steam/library-details';
import { GDL_INJECTED } from './constants';
import { findNonSteamNotice } from './notice';

function normalizedRouteAppId(value: unknown): number | null {
	const raw = Number(value);
	if (!Number.isInteger(raw) || raw === 0 || raw < -2147483648 || raw > 4294967295) return null;
	return raw < 0 ? raw >>> 0 : raw;
}

function isPaintedNativeHeader(doc: Document, element: HTMLElement): boolean {
	if (!isPaintedLibraryElement(doc, element)
		|| element.closest('[id^="gdl-"], [data-gdl-cloud-stats], [data-gdl-cloud-status], [data-gdl-playtime]')) return false;
	return true;
}

function nativeDetailsHeaderAppId(doc: Document): number | null {
	const classes = PLAYBAR_CLASSES();
	const ids = new Set<number>();
	for (const value of [classes.Container, classes.GameStatsSection]) {
		for (const element of elementsWithCssModuleClass(doc, value)) {
			try {
				if (!isPaintedNativeHeader(doc, element)) continue;
				const appId = committedHeaderAppId(element);
				if (appId !== null) ids.add(appId);
			} catch {}
		}
	}
	return ids.size === 1 ? ids.values().next().value! : null;
}

export function routedSteamAppId(doc: Document): number | null {
	const routePattern = /(?:games\/details|library\/app|routes\/library\/app|library\/collection\/[^/?#]+|appdetails|app|game)\/(-?\d+)(?=[/?#]|$)|[?&#]appid=(-?\d+)/i;
	const fromPath = (path: unknown): number | null => {
		const match = String(path || '').match(routePattern);
		return match ? normalizedRouteAppId(match[1] || match[2]) : null;
	};
	const localView = doc.defaultView as any;
	const rootView = typeof window !== 'undefined' ? window as any : null;
	const views = Array.from(new Set([localView, rootView].filter(Boolean)));
	const selectionCandidates: unknown[] = [];
	// SP Desktop's browser URL often has no AppID. Steam publishes the real
	// in-memory route on its active window instance, independently of metadata.
	for (const view of views) {
		const uiStore = view.uiStore;
		if (!uiStore) continue;
		try {
			const path = String(uiStore.GetActiveWindowInstance?.()?.LocationPathName || '');
			const appId = fromPath(path);
			if (appId !== null) return appId;
			// The saved selection survives Home/collection navigation. A concrete
			// non-details Library destination must not reuse that stale identity.
			if (/^\/?library(?:\/|$)/i.test(path)) return null;
		} catch {}
		try {
			const selection = uiStore.currentGameListSelection || uiStore.m_gameListSelection;
			selectionCandidates.push(selection?.nAppId);
		} catch {}
	}
	for (const url of [String(doc.defaultView?.location?.href || ''), String(doc.location?.href || '')]) {
		const appId = fromPath(url);
		if (appId !== null) return appId;
	}
	try {
		for (const view of views) {
			const history = view.g_History || view.g_AppHistory;
			for (const path of [history?.location?.pathname, history?.location?.hash]) {
				const appId = fromPath(path);
				if (appId !== null) return appId;
			}
		}
	} catch {}
	// A selection may advance before React replaces the previous game's header.
	// Without a concrete route, require the displayed header to agree with it.
	const headerAppId = selectionCandidates.length > 0 ? nativeDetailsHeaderAppId(doc) : null;
	if (headerAppId !== null) {
		for (const selection of selectionCandidates) {
			const appId = normalizedRouteAppId(selection);
			if (appId !== null) {
				if (appId === headerAppId) return appId;
				break;
			}
		}
	}
	try {
		const selected = doc.querySelectorAll<HTMLElement>(
			'[class*="gameListRow"][class*="Selected"], [class*="GameListEntry"][class*="Selected"], [class*="gamelistentry_"][class*="selected_"]'
		);
		for (const el of Array.from(selected)) {
			const id = el.getAttribute('data-appid') || el.getAttribute('data-app-id');
			const appId = id && /^-?\d+$/.test(id) ? normalizedRouteAppId(id) : null;
			if (appId !== null) return appId;
		}
	} catch {}
	try {
		const detailContainers = Array.from(doc.querySelectorAll<HTMLElement>(
			'[class*="AppDetailsContainer"], [class*="appdetails_Container"], [class*="appdetails_AppDetails"]'
		));
		for (const el of detailContainers) {
			if (el.closest('[id^="gdl-"]')) continue;
			const id = el.getAttribute('data-appid') || el.getAttribute('data-app-id');
			const appId = id && /^-?\d+$/.test(id) ? normalizedRouteAppId(id) : null;
			if (appId !== null) return appId;
		}
	} catch {}
	return null;
}

/** Stable identity for a Library destination. Query/hash churn inside the same
 * game must not invalidate a mounted page or restart its asynchronous work. */
export function libraryRouteIdentity(doc: Document): string {
	const appId = routedSteamAppId(doc);
	if (appId !== null) return `app:${appId}`;
	const raw = String(doc.defaultView?.location?.href || doc.location?.href || '');
	try {
		const url = new URL(raw);
		return `${url.origin}${url.pathname}`;
	} catch { return raw.split(/[?#]/, 1)[0]; }
}

/** Detect Steam's own links bar without counting the NativeGameLink replacement. */
export function hasVisibleNativeLinksBar(doc: Document): boolean {
	try {
		const linksSection = LINKS_BAR_CLASSES().LinksSection;
		const cssModuleBar = elementsWithCssModuleClass(doc, linksSection).some(element =>
			!element.closest('#gdl-library-injected')
			&& !element.id?.startsWith('gdl-')
			&& isRenderedElement(doc, element));
		if (cssModuleBar) return true;
		// Steam occasionally changes the hashed LinksSection class while keeping
		// the native links themselves. Do not leave a linked-game info panel over
		// a real Steam page merely because that private class changed.
		const nativeLinkCandidates = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(anchor => {
			if (anchor.closest('[id^="gdl-"]')) return false;
			const href = String(anchor.getAttribute('href') || '');
			if (!/store\.steampowered\.com|steamcommunity\.com|steam:\/\/openurl/i.test(href)
				|| !isRenderedElement(doc, anchor)) return false;
			// Exclude Steam's global top navigation; library links live below the
			// app header and are the evidence needed for route cleanup.
			return anchor.getBoundingClientRect().top > 100;
		});
		// The fallback is intentionally structural: a single Store link can occur
		// on Library Home, in news or in the activity feed. A real details links
		// row contains several sibling links inside one short horizontal surface.
		return nativeLinkCandidates.some(anchor => {
			let container = anchor.parentElement;
			for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
				const rect = container.getBoundingClientRect();
				const count = nativeLinkCandidates.filter(candidate => container?.contains(candidate)).length;
				if (count >= 3 && rect.width >= 300 && rect.height > 0 && rect.height <= 120) return true;
			}
			return false;
		});
	} catch { return false; }
}

/**
 * A public Store AppID or Steam's own Library links row is an ownership
 * boundary: the visible page belongs to Steam, not to NativeGameLink.
 *
 * Keep this predicate read-only. Callers use it before running any Library
 * DOM synchronization so native game pages are never used as injection hosts.
 */
export function isPublicSteamLibraryRoute(doc: Document): boolean {
	const appId = routedSteamAppId(doc);
	if (appId !== null && appId > 0 && appId < 2147483648) return true;
	if (appId !== null && appId >= 2147483648) return false;
	if (findNonSteamNotice(doc)) return false;
	if (hasVisibleNativeLinksBar(doc)) return true;
	return false;
}

export interface LibraryNavigationState {
	currentInjectedAppId: string | null;
	currentInjectedShortcutAppId: string | null;
	clearCurrentInjection: (doc: Document) => void;
	scheduleCleanup: (doc: Document) => void;
}

/** Invalidate linked-game state and defer DOM cleanup when Steam changes route. */
export function reconcileLibraryNavigation(doc: Document, state: LibraryNavigationState): void {
	try {
		if (!doc?.body || !doc.documentElement?.isConnected || !doc.defaultView || doc.defaultView.closed) return;
	} catch { return; }
	const hasGdlChrome = Boolean(doc.getElementById(GDL_INJECTED)
		|| doc.getElementById('gdl-playbar-achievements')
		|| doc.getElementById('gdl-link-bar')
		|| doc.getElementById('gdl-game-info-panel'));
	if (!hasGdlChrome) return;
	const routeId = routedSteamAppId(doc);
	// Native Library routes are deliberately outside this reconciler. The
	// runtime's route boundary retires only NativeGameLink-owned nodes before this
	// function is called and does not inspect or alter Steam's page state.
	if (isPublicSteamLibraryRoute(doc)) return;
	if (routeId === null) return;
	const routeShortcutDismissed = routeId >= 2147483648 && isShortcutDismissed(routeId);
	const routeMapping = routeId >= 2147483648 && !routeShortcutDismissed
		? findMappingForShortcut(String(routeId), '')
		: null;
	const sameLinkedGame = !routeShortcutDismissed && routeId >= 2147483648
		&& (String(routeId) === state.currentInjectedShortcutAppId || routeMapping === state.currentInjectedAppId);
	if (!sameLinkedGame) {
		state.clearCurrentInjection(doc);
		state.scheduleCleanup(doc);
	}
}
