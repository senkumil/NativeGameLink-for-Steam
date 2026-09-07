import { LINKS_BAR_CLASSES } from '../../steam/css';
import { elementsWithCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import { findMappingForShortcut, isShortcutDismissed } from '../shortcuts/runtime';
import { GDL_INJECTED } from './constants';
import { findNonSteamNotice } from './notice';

export function routedSteamAppId(doc: Document): number | null {
	for (const url of [String(doc.defaultView?.location?.href || ''), String(doc.location?.href || '')]) {
		const match = url.match(/(?:games\/details|library\/app|app)\/(\d+)/i);
		if (match) return Number(match[1]);
	}
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
