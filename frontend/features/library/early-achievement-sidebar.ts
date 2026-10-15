import { getSynchronousGameData } from '../../core/game-data';
import { committedHeaderAppId, isPaintedLibraryElement, paintedNativePlaybar } from '../../steam/library-details';
import { containsNativeLibraryHeader, findNativeLibraryHeader, getNativeLibraryArtworkSelectors } from '../../steam/library-header';
import { loc } from '../../steam/localization';
import { getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import {
	adoptEarlyAchievementSidebarOwner,
	linkedAchievementTarget,
	makeLinkedAchievementsClickable,
	ownsAchievementSidebar,
	registerEarlyAchievementSidebarOwner,
} from '../achievements/navigation';
import { renderLocalAchievementSidebar, renderPendingAchievementSidebarHtml } from '../achievements/sidebar';
import { ensureAchievementSidebarStyles } from '../achievements/styles/sidebar';
import { buildNativeSidebarSection, discoverNativeLibraryLayout } from './layout';
import { syncControllerSidebarSection } from './controller';
import { ensureLinkedSidebarOrder } from './sidebar-order';

/** Only the current shortcut's own section can survive a later full-page mount. */
export function getOwnedAchievementSidebar(doc: Document, steamAppId: string, shortcutAppId: string | null): HTMLElement | null {
	if (!shortcutAppId) return null;
	const target = linkedAchievementTarget(doc);
	if (target?.steamAppId !== steamAppId || target.shortcutAppId !== shortcutAppId) return null;
	const section = doc.getElementById('gdl-achievements-section') as HTMLElement | null;
	return section?.isConnected && section.dataset.gdlSteamAppId === steamAppId
		&& section.dataset.gdlShortcutAppId === shortcutAppId
		&& ownsAchievementSidebar(doc, { steamAppId, shortcutAppId }) ? section : null;
}

/** The complete renderer now owns this same node through its exact linked root. */
export function adoptEarlyAchievementSidebar(section: HTMLElement): void {
	adoptEarlyAchievementSidebarOwner(section);
}

/** Paint confirmed local achievements as soon as Steam's own sidebar exists.
 * This path has no Store/network wait, main-column dependency or image preload.
 * Unknown progress uses a neutral box only when a cached total is available. */
export function syncEarlyAchievementSidebar(
	doc: Document, notice: Element, steamAppId: string, shortcutAppId: string | null,
	generation: number, isCurrent: () => boolean,
): void {
	const target = linkedAchievementTarget(doc);
	if (!target || target.steamAppId !== steamAppId || target.shortcutAppId !== shortcutAppId
		|| !isCurrent() || doc.hidden || doc.defaultView?.closed || notice.ownerDocument !== doc || !notice.isConnected) return;
	const native = findNativeLibraryHeader(doc);
	const ownsHeader = (element: HTMLElement): boolean => committedHeaderAppId(element) === Number(shortcutAppId)
		&& isPaintedLibraryElement(doc, element) && !element.closest('[id^="gdl-"]');
	const header = native && ownsHeader(native) ? native
		: Array.from(doc.querySelectorAll<HTMLElement>(getNativeLibraryArtworkSelectors().header)).find(ownsHeader)
			|| paintedNativePlaybar(doc, Number(shortcutAppId));
	if (!header) return;
	const layout = discoverNativeLibraryLayout(doc, notice);
	if (!layout.anchorRegion?.isConnected || !layout.sidebarColumn?.isConnected
		|| containsNativeLibraryHeader(layout.sidebarColumn)) return;
	const anchorAppId = committedHeaderAppId(layout.anchorRegion);
	if (anchorAppId !== null && anchorAppId !== Number(shortcutAppId)) return;
	const order = ensureLinkedSidebarOrder(doc, layout, { steamAppId, shortcutAppId, generation, isCurrent });
	if (!order) return;
	syncControllerSidebarSection(doc, layout, steamAppId, shortcutAppId);
	const cached = getCachedLocalAchievementsForShortcut(steamAppId, shortcutAppId);
	const confirmed = cached?.found && Array.isArray(cached.achievements) && cached.total > 0 ? cached : null;
	const total = confirmed?.total || getSynchronousGameData(steamAppId)?.achievements?.total || 0;
	if (!(total > 0) || !isCurrent()) return;
	ensureAchievementSidebarStyles(doc);
	let section = getOwnedAchievementSidebar(doc, steamAppId, shortcutAppId);
	if (!section) {
		// A previous game's node may still be present during the native commit.
		// It has no authority for this destination and must never be reused.
		doc.getElementById('gdl-achievements-section')?.remove();
		section = buildNativeSidebarSection(doc, layout, {
			sectionId: 'gdl-achievements-section',
			headerText: loc('AppDetails_SectionTitle_Achievements', 'Achievements'),
			innerId: 'gdl-achievements-content',
			innerHtml: confirmed ? '' : renderPendingAchievementSidebarHtml(total),
			cloneInnerClass: false,
		});
		if (!section) return;
		section.dataset.gdlSteamAppId = steamAppId;
		section.dataset.gdlShortcutAppId = target.shortcutAppId;
		if (!order.publish(section, 'achievements')) return;
	}
	else if (!order.publish(section, 'achievements')) return;
	if (section.dataset.gdlAchievementGeneration !== String(generation)) section.dataset.gdlAchievementGeneration = String(generation);
	registerEarlyAchievementSidebarOwner(doc, section, target, header,
		() => isCurrent() && committedHeaderAppId(header) === Number(target.shortcutAppId));
	if (confirmed) renderLocalAchievementSidebar(doc, confirmed);
	else {
		section.dataset.gdlAchievementsPending = '1';
		if (!section.querySelector('.gdl-la-summary')) {
			const content = doc.getElementById('gdl-achievements-content');
			if (content) content.innerHTML = renderPendingAchievementSidebarHtml(total);
		}
		const identity = `${steamAppId}:${shortcutAppId}`;
		if (section.dataset.gdlAchievementClickableTarget !== identity) {
			makeLinkedAchievementsClickable(doc, section, steamAppId);
			section.dataset.gdlAchievementClickableTarget = identity;
		}
	}
}
