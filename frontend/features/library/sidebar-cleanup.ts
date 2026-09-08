import { findShortcutIdForMappedSteamAppId } from '../../core/mappings';
import { navigateToLibraryShortcut } from '../../steam/navigation';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { routedSteamAppId } from './native-route';


/**
 * Preserve all legitimate library games and mapped shortcuts in the sidebar,
 * unhiding any virtual rows that were previously suppressed with display: none.
 */
export function cleanupGhostSidebarEntries(doc: Document): void {
	try {
		if (!doc?.body) return;
		const rows = doc.querySelectorAll<HTMLElement>(
			'[class*="gamelistentry_"], [class*="gameListRow"], [class*="GameListRow"], [class*="gameListEntry"], [class*="GameListEntry"], [role="treeitem"], [role="listitem"]'
		);
		for (const row of Array.from(rows)) {
			if (row.style.display === 'none') {
				row.style.removeProperty('display');
			}
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

const NON_STEAM_COLLECTION_REGEX = /(?:^|\b)(?:no\s+de\s+steam|non-?steam|nicht-?steam|jeux\s+non-?steam|giochi\s+non-?steam|não\s+(?:são\s+do\s+)?steam|не\s+из\s+steam|非\s*steam|비\s*steam)(?:\b|$)/i;

/**
 * Permanently hide "Non-Steam" collection headers, filter pills, and category tabs
 * across all views so shortcuts seamlessly integrate into standard game collections.
 */
export function cleanupNonSteamPillsAndHeaders(doc: Document): void {
	try {
		if (!doc?.body) return;
		const candidates = doc.querySelectorAll<HTMLElement>(
			'[class*="FilterOption"], [class*="filterOption"], [class*="SavedFilter"], [class*="savedFilter"], [class*="CollectionHeader"], [class*="collectionHeader"], [class*="SectionHeader"], [class*="sectionHeader"], [class*="Collections"], [class*="collections"], [class*="allcollections_"], [class*="libraryhome_"], [class*="Filter"], [class*="filter"], [class*="Pill"], [class*="pill"], [role="tab"], [role="button"]'
		);
		for (const el of Array.from(candidates)) {
			const text = el.textContent?.trim() || '';
			if (!text || text.length > 45) continue;
			if (NON_STEAM_COLLECTION_REGEX.test(text)) {
				const target = (el.closest('[class*="FilterOption"], [class*="SavedFilter"], [class*="CollectionHeader"], [class*="SectionHeader"], [class*="Pill"], [class*="pill"], [role="tab"]') as HTMLElement) || el;
				if (target.style.display !== 'none') {
					target.style.setProperty('display', 'none', 'important');
					target.style.setProperty('visibility', 'hidden', 'important');
					target.style.setProperty('pointer-events', 'none', 'important');
					target.dataset.gdlNonsteam = '1';
				}
			}
		}
	} catch {}
}

export function installGhostSidebarCleanup(doc: Document): () => void {
	cleanupGhostSidebarEntries(doc);
	cleanupNonSteamPillsAndHeaders(doc);
	const Observer = doc.defaultView?.MutationObserver;
	if (!Observer) return () => {};
	const observer = new Observer(() => {
		cleanupGhostSidebarEntries(doc);
		cleanupNonSteamPillsAndHeaders(doc);
	});
	try {
		if (doc.body) {
			observer.observe(doc.body, { childList: true, subtree: true });
		}
	} catch {}
	return () => observer.disconnect();
}
