import { findShortcutIdForMappedSteamAppId } from '../../core/mappings';
import { navigateToLibraryShortcut } from '../../steam/navigation';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { routedSteamAppId } from './native-route';
export { isLibrarySidebarMutation } from '../../steam/library-sidebar';
const SIDEBAR_ROW_SELECTOR = '[class*="gamelistentry_"], [class*="gameListRow"], [class*="GameListRow"], [class*="gameListEntry"], [class*="GameListEntry"], [role="treeitem"], [role="listitem"]';

/** Restore only rows explicitly hidden by this plugin. Steam owns every other
 * display value, including temporary visibility used by its virtual list. */
export function cleanupGhostSidebarEntries(root: Document | Element): void {
	try {
		const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-gdl-hidden="1"]'));
		if (root.nodeType === 1 && (root as Element).matches('[data-gdl-hidden="1"]')) rows.unshift(root as HTMLElement);
		for (const row of rows) {
			if (!row.matches(SIDEBAR_ROW_SELECTOR)) continue;
			if (row.style.display === 'none') {
				row.style.removeProperty('display');
			}
			row.removeAttribute('data-gdl-hidden');
		}
	} catch {}
}

export function tryRedirectUnownedMappedGame(doc: Document): boolean {
	try {
		const appId = routedSteamAppId(doc);
		if (appId !== null && appId > 0 && appId < 2147483648) {
			const mappedShortcutId = findShortcutIdForMappedSteamAppId(appId);
			if (mappedShortcutId) {
				const overview = AppStoreAdapter.getAppOverview(appId);
				const isSubscribed = overview?.m_bIsSubscribed
					?? overview?.is_subscribed
					?? overview?.bIsSubscribed;
				const isOwned = Boolean(overview && (isSubscribed === true || overview.m_bIsSharedLicense || overview.is_free));
				if (!isOwned) {
					return navigateToLibraryShortcut(doc, mappedShortcutId);
				}
			}
		}
	} catch {}
	return false;
}

/** One-time recovery of controls changed by older versions. Ordinary Steam
 * filters, collections and names are never selected or rewritten here. */
function restoreLegacySidebarLabels(root: Document | Element): void {
	try {
		for (const element of root.querySelectorAll<HTMLElement>('[data-gdl-nonsteam="1"]')) {
			for (const [property, value] of [['display', 'none'], ['visibility', 'hidden'], ['pointer-events', 'none']]) {
				if (element.style.getPropertyValue(property) === value && element.style.getPropertyPriority(property) === 'important') {
					element.style.removeProperty(property);
				}
			}
			element.removeAttribute('data-gdl-nonsteam');
		}
		for (const label of root.querySelectorAll<HTMLElement>('[data-gdl-running-alias="1"]')) {
			const original = label.dataset.gdlRunningOriginalText;
			// A recycled React row may already display another game. Restore text
			// only if the old plugin's exact alias remains on that same element.
			const aliasUnchanged = original !== undefined && label.textContent === `${original} - En ejecución`;
			if (aliasUnchanged) label.textContent = original;
			if (aliasUnchanged && (label.style.getPropertyValue('color') === 'rgb(161, 205, 68)' || label.style.getPropertyValue('color') === '#a1cd44')) {
				const color = label.dataset.gdlRunningOriginalColor;
				if (color) label.style.setProperty('color', color); else label.style.removeProperty('color');
			}
			label.removeAttribute('data-gdl-running-alias');
			label.removeAttribute('data-gdl-running-original-text');
			label.removeAttribute('data-gdl-running-original-color');
		}
	} catch {}
}

const sidebarCleanupLifecycles = new WeakMap<Document, () => void>();

export function disposeGhostSidebarCleanup(doc: Document): void {
	sidebarCleanupLifecycles.get(doc)?.();
}

export function installGhostSidebarCleanup(doc: Document): () => void {
	const existing = sidebarCleanupLifecycles.get(doc);
	if (existing) return existing;
	if (!doc.body) return () => {};
	cleanupGhostSidebarEntries(doc);
	restoreLegacySidebarLabels(doc);
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		sidebarCleanupLifecycles.delete(doc);
	};
	sidebarCleanupLifecycles.set(doc, dispose);
	return dispose;
}
