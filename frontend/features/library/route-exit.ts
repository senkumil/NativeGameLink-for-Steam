import { GDL_INJECTED } from './constants';
import { isPublicSteamLibraryRoute } from './native-route';

// Steam reuses the same React-owned Library containers while it changes games.
// Removing our children during that commit can make React remove a node that is
// no longer under the parent it recorded. Keep ownership visible to the runtime,
// conceal only NativeGameLink nodes, and detach them after Steam's mutation burst.
const pendingExitGenerations = new WeakMap<Document, number>();

const OWNED_LIBRARY_SELECTORS = [
	'#gdl-main-content-stack',
	`#${GDL_INJECTED}`,
	'#gdl-skeleton',
	'#gdl-sidebar-skeleton',
	'#gdl-controller-section',
	'#gdl-friends-section',
	'#gdl-achievements-section',
	'#gdl-trading-cards-section',
	'#gdl-dlc-section',
	'#gdl-workshop-section',
	'#gdl-community-content',
	'#gdl-activity-feed',
	'#gdl-link-bar',
	'#gdl-playbar-achievements',
	'#gdl-game-info-panel',
	'#gdl-trading-card-preview',
	'.gdl-trading-cards-help-popup',
	'#gdl-manual-link-notice-button-row',
	'[data-gdl-cloud-status]',
	'[data-gdl-game-info-button="1"]',
	'[data-gdl-playtime="1"]',
].join(',');

export function hasOwnedLibraryChrome(doc: Document): boolean {
	try { return Boolean(doc.querySelector(OWNED_LIBRARY_SELECTORS)); }
	catch { return false; }
}

export function beginLibraryRouteExit(doc: Document, generation: number): void {
	pendingExitGenerations.set(doc, generation);
	try {
		const isNativeSteamRoute = isPublicSteamLibraryRoute(doc);
		doc.querySelectorAll<HTMLElement>(OWNED_LIBRARY_SELECTORS).forEach(element => {
			if (!isNativeSteamRoute && element.id === 'gdl-link-bar') return;
			// These nodes will be removed after the native route stabilizes, so no
			// Steam-owned inline style is changed or later guessed/restored here.
			element.style.setProperty('display', 'none', 'important');
			element.style.setProperty('visibility', 'hidden', 'important');
			element.style.setProperty('pointer-events', 'none', 'important');
		});
	} catch {}
}

export function isLibraryRouteExitPending(doc: Document, generation?: number): boolean {
	const pending = pendingExitGenerations.get(doc);
	return pending !== undefined && (generation === undefined || pending === generation);
}

export function finishLibraryRouteExit(doc: Document): void {
	pendingExitGenerations.delete(doc);
}

/** Detach only nodes created by NativeGameLink. This is safe after a route exit
 * because it never removes, clicks, reorders, styles or reads React state from
 * a Steam-owned element. */
export function removeOwnedLibraryChrome(doc: Document): void {
	try {
		const isNativeSteamRoute = isPublicSteamLibraryRoute(doc);
		doc.querySelectorAll(OWNED_LIBRARY_SELECTORS).forEach(element => {
			if (!isNativeSteamRoute && element.id === 'gdl-link-bar') return;
			element.remove();
		});
	} catch {}
}
