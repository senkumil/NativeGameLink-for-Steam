import { backendLog } from '../../api/backend';
import type { FriendCategories, SteamGameData } from '../../domain/types';
import { loc } from '../../steam/localization';
import {
	getCachedLocalAchievementsForGame,
	getCachedLocalAchievementsForShortcut,
	makeLinkedAchievementsClickable,
	openLocalAchievementsModal,
	renderLocalAchievementSidebarHtml,
	ensureLocalAchievementSidebarResponsiveGrid,
	ensureAchievementSidebarStyles,
	ensureAchievementModalStyles,
} from '../achievements/runtime';
import type { NativeLibraryLayout } from './layout';
import { buildNativeSidebarSection } from './layout';
import { buildHistoricalSidebarSections } from './historical-sidebar';
import type { SteamLibraryAssets } from './artwork';
import { friendDataSignature, renderFriendsSection } from './social';
import { renderLocalAchievementSidebar, renderPendingAchievementSidebarHtml } from '../achievements/sidebar';
import { adoptEarlyAchievementSidebar, getOwnedAchievementSidebar } from './early-achievement-sidebar';
import { syncControllerSidebarSection } from './controller';
import { ensureLinkedSidebarOrder, getLinkedSidebarOrder, type LinkedSidebarOrder } from './sidebar-order';

export interface LinkedSidebarOptions {
	steamAppId: string;
	shortcutAppId: string | null;
	data: SteamGameData;
	friendResult: FriendCategories | null | undefined;
	modern?: SteamLibraryAssets | null;
	isCurrent?: () => boolean;
	generation?: number;
}

const renderedBodies = new WeakMap<HTMLElement, string>();

function ownedSection(doc: Document, order: LinkedSidebarOrder, id: string): HTMLElement | null {
	const node = doc.getElementById(id);
	return node?.parentElement === order.column && node.dataset.gdlSteamAppId === order.steamAppId
		&& node.dataset.gdlShortcutAppId === order.shortcutAppId ? node : null;
}

function insertHistoricalSections(doc: Document, layout: NativeLibraryLayout, data: SteamGameData, steamAppId: string, modern?: SteamLibraryAssets | null): void {
	const order = getLinkedSidebarOrder(doc, layout, steamAppId);
	if (!order) return;
	const present = new Set<string>();
	for (const candidate of buildHistoricalSidebarSections(doc, layout, data, steamAppId, modern)) {
		present.add(candidate.id);
		const node = ownedSection(doc, order, candidate.id) || candidate;
		if (node !== candidate && renderedBodies.get(node) !== candidate.innerHTML) node.innerHTML = candidate.innerHTML;
		renderedBodies.set(node, candidate.innerHTML);
		order.publish(node, candidate.id === 'gdl-historical-info-section' ? 'historical-info' : 'external-achievements');
	}
	for (const id of ['gdl-historical-info-section', 'gdl-external-achievements-section']) {
		if (!present.has(id)) ownedSection(doc, order, id)?.remove();
	}
}

export function refreshHistoricalSidebarSections(doc: Document, layout: NativeLibraryLayout, data: SteamGameData, steamAppId: string, modern?: SteamLibraryAssets | null): void {
	insertHistoricalSections(doc, layout, data, steamAppId, modern);
}

/** Render the stable native-order sidebar core: Friends followed by Achievements. */
export function renderLinkedSidebarCore(
	doc: Document,
	layout: NativeLibraryLayout,
	options: LinkedSidebarOptions,
): void {
	const { anchorRegion, sidebarColumn } = layout;
	if (!anchorRegion || !sidebarColumn) return;
	const order = ensureLinkedSidebarOrder(doc, layout, { steamAppId: options.steamAppId, shortcutAppId: options.shortcutAppId,
		isCurrent: options.isCurrent || (() => true), generation: options.generation });
	if (!order) return;
	insertHistoricalSections(doc, layout, options.data, options.steamAppId, options.modern);
	const controller = syncControllerSidebarSection(doc, layout, options.steamAppId, options.shortcutAppId);
	if (controller) order.publish(controller, 'controller');

	if (options.friendResult && options.friendResult.totalCount > 0) {
		const friendsHtml = renderFriendsSection(options.friendResult, options.steamAppId, options.data.name);
		const signature = `${friendDataSignature(options.friendResult)}:${options.data.name}:${loc('AppDetails_SectionTitle_Friends', 'Friends who play')}`;
		if (friendsHtml) {
			const existing = ownedSection(doc, order, 'gdl-friends-section');
			const node = existing || buildNativeSidebarSection(doc, layout, {
				sectionId: 'gdl-friends-section',
				headerText: loc('AppDetails_SectionTitle_Friends', 'Friends who play'),
				innerId: 'gdl-friends-content',
				innerHtml: friendsHtml,
				cloneInnerClass: false,
			});
			if (node) {
				const content = node.querySelector<HTMLElement>('#gdl-friends-content');
				if (existing && content && node.dataset.gdlFriendDataSignature !== signature) content.innerHTML = friendsHtml;
				renderedBodies.set(node, friendsHtml);
				node.dataset.gdlFriendDataSignature = signature;
				order.publish(node, 'friends');
			}
		} else ownedSection(doc, order, 'gdl-friends-section')?.remove();
	} else if (options.friendResult && options.friendResult.totalCount === 0) ownedSection(doc, order, 'gdl-friends-section')?.remove();

	const cachedAchievements = options.shortcutAppId
		? getCachedLocalAchievementsForShortcut(options.steamAppId, options.shortcutAppId)
		: getCachedLocalAchievementsForGame(options.steamAppId);
	// A confirmed local snapshot knows its real total even when Store metadata
	// is absent, stale or no longer advertises achievements for this game.
	const total = cachedAchievements?.total || options.data.achievements?.total || 0;
	if (total <= 0) { ownedSection(doc, order, 'gdl-achievements-section')?.remove(); return; }
	ensureAchievementSidebarStyles(doc);
	ensureAchievementModalStyles(doc);
	const early = getOwnedAchievementSidebar(doc, options.steamAppId, options.shortcutAppId)
		|| ownedSection(doc, order, 'gdl-achievements-section');
	if (early) {
		order.publish(early, 'achievements');
		adoptEarlyAchievementSidebar(early);
		if (cachedAchievements) renderLocalAchievementSidebar(doc, cachedAchievements);
		return;
	}
	const initialBody = cachedAchievements
		? renderLocalAchievementSidebarHtml(cachedAchievements)
		: renderPendingAchievementSidebarHtml(total);
	const node = buildNativeSidebarSection(doc, layout, {
		sectionId: 'gdl-achievements-section',
		headerText: loc('AppDetails_SectionTitle_Achievements', 'Achievements'),
		innerId: 'gdl-achievements-content',
		innerHtml: initialBody,
		cloneInnerClass: false,
	});
	if (!node) return;
	node.dataset.gdlSteamAppId = options.steamAppId;
	if (options.shortcutAppId) node.dataset.gdlShortcutAppId = options.shortcutAppId;
	if (!cachedAchievements) node.dataset.gdlAchievementsPending = '1';

	const initialSummary = node.querySelector<HTMLElement>('.gdl-la-summary');
	if (initialSummary && cachedAchievements) ensureLocalAchievementSidebarResponsiveGrid(initialSummary, cachedAchievements);

	if (cachedAchievements) {
		initialSummary?.addEventListener('click', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			openLocalAchievementsModal(doc, cachedAchievements!).catch(error => backendLog('Achievements modal error: ' + String(error)));
		});
	} else {
		makeLinkedAchievementsClickable(doc, node, options.steamAppId);
	}
	order.publish(node, 'achievements');
}
