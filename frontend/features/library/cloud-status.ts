import { escapeHtml } from '../../core/text';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { loc } from '../../steam/localization';
import {
	applyNativePlaybarTypography,
	buildNativeCloudBlueprint,
	closestWithCssModuleClass,
	elementsWithCssModuleClass,
	NATIVE_UI_BLUEPRINT_KEYS,
} from '../../steam/native-dom';
import { preserveLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { isPublicSteamLibraryRoute, routedSteamAppId } from './native-route';
import { findMappingForShortcut, isShortcutDismissed } from '../shortcuts/runtime';
import { ensureNativeGameInfoStyles } from './styles';

function cloudSynchronizedSvg(extraClass = ''): string {
	return `<svg class="gdl-cloud-icon ${extraClass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M25.2377 7.0939C26.902 8.83356 27.8828 11.1153 28 13.52C29.998 14.2303 31.6809 15.6232 32.7522 17.4532C33.8234 19.2831 34.2142 21.4325 33.8555 23.5224C33.4968 25.6122 32.4118 27.5084 30.7917 28.8764C29.1716 30.2444 27.1205 30.9965 25 31H11C8.87962 30.9965 6.82852 30.2444 5.20842 28.8764C3.58833 27.5083 2.50327 25.6122 2.1446 23.5224C1.78593 21.4325 2.17666 19.2831 3.24792 17.4532C4.31917 15.6232 6.00213 14.2303 8.00005 13.52C8.11845 11.109 9.10495 8.82222 10.7775 7.08168C12.45 5.34114 14.6957 4.26433 17.1 4.04999H18.0201H18.9401C21.3372 4.27345 23.5733 5.35425 25.2377 7.0939ZM10 19.6L15.41 25L25.03 15.38L22.64 13L15.41 20.23L12.39 17.21L10 19.6Z"/></svg>`;
}

export function ensureCloudStatus(doc: Document): void {
	ensureNativeGameInfoStyles(doc);
	const classes = PLAYBAR_CLASSES();
	let statsSections = elementsWithCssModuleClass(doc, classes.GameStatsSection).filter(section => section.isConnected);
	// Steam uses more than one play-bar structure. If its CSS module class is
	// absent or not yet hydrated, locate the row via existing stats or achievement anchors.
	// This keeps the simulated cloud state available to every linked shortcut from 0ms.
	if (statsSections.length === 0) {
		const statItem = doc.querySelector<HTMLElement>(
			'[class*="LastPlayed"], [class*="lastPlayed"], [class*="Playtime"], [class*="playtime"], [data-gdl-playtime="1"], .SVGIcon_PlayTime'
		);
		if (statItem) {
			const candidate = statItem.closest<HTMLElement>(
				'[class*="GameStatsSection"], [class*="gameStatsSection"], [class*="PlayBarStats"], [class*="playBarStats"]'
			) || (statItem.parentElement && statItem.parentElement !== doc.body ? statItem.parentElement : null);
			if (candidate) statsSections.push(candidate);
		}
		if (statsSections.length === 0) {
			const fallback = doc.querySelector<HTMLElement>(
				'[class*="GameStatsSection"], [class*="gameStatsSection"], [class*="PlayBarStats"], [class*="playBarStats"]'
			);
			if (fallback) statsSections.push(fallback);
		}
		if (statsSections.length === 0) {
			const achievement = doc.querySelector<HTMLElement>('[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements');
			if (achievement?.parentElement?.isConnected) statsSections.push(achievement.parentElement);
		}
	}
	for (const stats of statsSections) {
		const cloudWrappers = elementsWithCssModuleClass(stats, classes.PlayBarCloudStatusContainer)
			.filter(element => closestWithCssModuleClass(element, classes.GameStatsSection) === stats);
		const nativeCloud = cloudWrappers.find(element => element.dataset.gdlCloudStatus !== '1');
		const ownedClouds = Array.from(stats.querySelectorAll<HTMLElement>('[data-gdl-cloud-status="1"]'));
		if (nativeCloud) {
			// If Steam has hydrated its own cloud control, it is authoritative. A
			// previously injected fallback must not remain alongside it.
			for (const owned of ownedClouds) owned.remove();
			continue;
		}
		let reference = elementsWithCssModuleClass(stats, classes.LastPlayed).find(element => !element.closest('[data-gdl-cloud-status]'))
			|| elementsWithCssModuleClass(stats, classes.Playtime).find(element => !element.closest('[data-gdl-cloud-status]'))
			|| stats.querySelector<HTMLElement>('[data-gdl-playtime="1"]')
			|| stats.querySelector<HTMLElement>('[class*="LastPlayed"]:not([data-gdl-cloud-status]), [class*="lastPlayed"]:not([data-gdl-cloud-status])')
			|| stats.querySelector<HTMLElement>('[class*="Playtime"]:not([data-gdl-cloud-status]), [class*="playtime"]:not([data-gdl-cloud-status])')
			|| null;
		while (reference && reference.parentElement !== stats) reference = reference.parentElement;

		if (ownedClouds.length > 0) {
			for (const duplicate of ownedClouds.slice(1)) duplicate.remove();
			let wrapper = ownedClouds[0];
			// A manual fallback can be mounted before Steam exposes a native cloud
			// blueprint. Upgrade it in place as soon as that blueprint is captured.
			if (wrapper.dataset.gdlNativeBlueprint !== '1') {
				const upgraded = buildNativeCloudBlueprint(doc);
				if (upgraded) {
					wrapper.replaceWith(upgraded);
					wrapper = upgraded;
				}
			}
			applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus);
			const targetReference = reference || stats.firstChild;
			if (wrapper.nextSibling !== targetReference && wrapper !== targetReference) {
				stats.insertBefore(wrapper, targetReference);
			}
			continue;
		}

		let wrapper = buildNativeCloudBlueprint(doc);
		if (!wrapper) {
			wrapper = doc.createElement('div');
			wrapper.dataset.gdlCloudStatus = '1';
			wrapper.dataset.gdlNativeBlueprint = '0';
			wrapper.className = classes.PlayBarCloudStatusContainer || '';
			wrapper.title = loc('AppDetails_CloudStatus_Tooltip_Synchronized', 'Your Steam Cloud files are synchronized for this app.');
			wrapper.innerHTML = `
				<div class="${classes.GameStat || ''} ${classes.LastPlayed || ''} ${classes.SuperimposedGridItems || ''} ${classes.Visible || ''}">
					<div class="${classes.GameStatIconForced || ''} ${classes.PlaytimeIconForced || ''}">${cloudSynchronizedSvg(classes.CloudIconSVG || '')}</div>
					<div class="${classes.HideWhenNarrow || ''} ${classes.GameStatRight || ''} ${classes.LastPlayedRight || ''}">
						<div class="${classes.PlayBarLabel || ''} ${classes.LastPlayedLabel || ''}">${escapeHtml(loc('AppDetails_SectionTitle_CloudStatus', 'Cloud status'))}</div>
						<div class="${classes.PlayBarDetailLabel || ''} ${classes.LastPlayedInfo || ''}">${escapeHtml(loc('AppDetails_CloudStatus_Synchronized', 'Up to date'))}</div>
					</div>
				</div>`;
		}
		const cloudGraphic = wrapper.querySelector<HTMLElement>('.gdl-cloud-icon, svg, img');
		if (cloudGraphic?.parentElement) cloudGraphic.parentElement.dataset.gdlUiIconHost = 'cloud';
		applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus);
		const targetReference = reference || stats.firstChild;
		if (wrapper.nextSibling !== targetReference && wrapper !== targetReference) {
			stats.insertBefore(wrapper, targetReference);
		}
	}
	preserveLinkedPlaybarVisibility(doc);
}

export function syncEarlyLinkedCloudStatus(doc: Document): void {
	if (isPublicSteamLibraryRoute(doc)) return;
	const routeId = routedSteamAppId(doc);
	if (!routeId || routeId < 2147483648 || isShortcutDismissed(routeId)) return;
	if (!findMappingForShortcut(String(routeId), '')) return;
	ensureCloudStatus(doc);
}

export function removeCloudStatus(doc: Document): void {
	doc.querySelectorAll('[data-gdl-cloud-status="1"]').forEach(element => element.remove());
}
