import { escapeHtml } from '../../core/text';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { loc, steamLanguageSync } from '../../steam/localization';
import {
	applyNativePlaybarTypography,
	buildNativeCloudBlueprint,
	closestWithCssModuleClass,
	elementsWithCssModuleClass,
	findVisibleCloudStatusStat,
	isRenderedElement,
	NATIVE_UI_BLUEPRINT_KEYS,
} from '../../steam/native-dom';
import { preserveLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { routedSteamAppId } from './native-route';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { paintedNativePlaybar, paintedNativeStats } from '../../steam/library-details';
import { ensureNativeGameInfoStyles } from './styles';

const cachedCloudStatus = new WeakMap<Document, { wrapper: HTMLElement; language: string }>();

function isPaintedCloudElement(doc: Document, element: HTMLElement): boolean {
	if (!isRenderedElement(doc, element)) return false;
	const view = doc.defaultView;
	if (!view?.getComputedStyle) return true;
	// Steam mounts both sticky and in-page playbars. The sticky stats can keep
	// their geometry while opacity:0 conceals the whole row or an ancestor.
	for (let current: HTMLElement | null = element; current; current = current.parentElement) {
		const style = view.getComputedStyle(current);
		if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
	}
	return true;
}

function cloudSynchronizedSvg(extraClass = ''): string {
	return `<svg class="gdl-cloud-icon ${extraClass}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" aria-hidden="true" style="display:block;width:100%;height:100%;"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M25.2377 7.0939C26.902 8.83356 27.8828 11.1153 28 13.52C29.998 14.2303 31.6809 15.6232 32.7522 17.4532C33.8234 19.2831 34.2142 21.4325 33.8555 23.5224C33.4968 25.6122 32.4118 27.5084 30.7917 28.8764C29.1716 30.2444 27.1205 30.9965 25 31H11C8.87962 30.9965 6.82852 30.2444 5.20842 28.8764C3.58833 27.5083 2.50327 25.6122 2.1446 23.5224C1.78593 21.4325 2.17666 19.2831 3.24792 17.4532C4.31917 15.6232 6.00213 14.2303 8.00005 13.52C8.11845 11.109 9.10495 8.82222 10.7775 7.08168C12.45 5.34114 14.6957 4.26433 17.1 4.04999H18.0201H18.9401C21.3372 4.27345 23.5733 5.35425 25.2377 7.0939ZM10 19.6L15.41 25L25.03 15.38L22.64 13L15.41 20.23L12.39 17.21L10 19.6Z"/></svg>`;
}

/** Repair old hidden blueprints in place, keeping the same mounted widget. */
function restoreOwnedCloudStatus(wrapper: HTMLElement): void {
	const classes = PLAYBAR_CLASSES();
	if (!findVisibleCloudStatusStat(wrapper)) {
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
		const cloudGraphic = wrapper.querySelector<HTMLElement>('.gdl-cloud-icon, svg, img');
		if (cloudGraphic?.parentElement) cloudGraphic.parentElement.dataset.gdlUiIconHost = 'cloud';
		applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus);
	}
	// Route retirement can conceal a node while it is still connected, as well
	// as before it is cached. Restore either case without rewriting its contents.
	for (const element of [wrapper, findVisibleCloudStatusStat(wrapper)]) {
		if (!element) continue;
		if (element.style.display === 'none') element.style.removeProperty('display');
		if (element.style.visibility === 'hidden') element.style.removeProperty('visibility');
		if (element.style.pointerEvents === 'none') element.style.removeProperty('pointer-events');
	}
}

function ensureOwnedCloudStats(doc: Document, playbar: HTMLElement): HTMLElement {
	const existing = playbar.querySelector<HTMLElement>('[data-gdl-cloud-stats="1"]');
	if (existing) return existing;
	const classes = PLAYBAR_CLASSES();
	const stats = doc.createElement('div');
	stats.className = classes.GameStatsSection || '';
	stats.dataset.gdlCloudStats = '1';
	stats.style.setProperty('display', 'flex', 'important');
	let buttons = elementsWithCssModuleClass(playbar, classes.AppButtonsContainer)[0] || null;
	while (buttons && buttons.parentElement !== playbar) buttons = buttons.parentElement;
	playbar.insertBefore(stats, buttons);
	return stats;
}

export function ensureCloudStatus(doc: Document): void {
	const shortcutId = routedSteamAppId(doc);
	if (!shortcutId || shortcutId < 2147483648 || isShortcutDismissed(shortcutId)
		|| !getCommittedShortcutSteamAppId(shortcutId)) return;
	const playbar = paintedNativePlaybar(doc, shortcutId);
	let statsSections = paintedNativeStats(doc, shortcutId);
	if (!playbar && !statsSections.length) return;
	ensureNativeGameInfoStyles(doc);
	const classes = PLAYBAR_CLASSES();
	const language = steamLanguageSync() || 'english';
	const cached = cachedCloudStatus.get(doc);
	if (cached && cached.language !== language) { cached.wrapper.remove(); cachedCloudStatus.delete(doc); }
	const nativeSections = statsSections.filter(section => section.dataset.gdlCloudStats !== '1');
	if (nativeSections.some(section => isPaintedCloudElement(doc, section))) statsSections = nativeSections;
	let visibleFallback: HTMLElement | undefined;
	if (!statsSections.some(section => isPaintedCloudElement(doc, section)) && playbar) {
		// Steam can hydrate the hidden sticky row before the visible in-page
		// playbar. Its presence must not suppress that playbar's temporary slot.
		if (!elementsWithCssModuleClass(playbar, classes.GameStatsSection).some(section => section.dataset.gdlCloudStats !== '1')) {
			const fallback = ensureOwnedCloudStats(doc, playbar);
			if (!statsSections.includes(fallback)) statsSections.push(fallback);
			// A newly created row has no height until Cloud is inserted. Its
			// painted native parent, rather than its empty geometry, selects it.
			visibleFallback = fallback;
		}
	}
	const cachedParent = cachedCloudStatus.get(doc)?.wrapper.parentElement;
	const liveStats = visibleFallback || statsSections.find(section => section === cachedParent && isPaintedCloudElement(doc, section))
		|| statsSections.find(section => isPaintedCloudElement(doc, section)) || statsSections[0];
	for (const stats of liveStats ? [liveStats] : []) {
		const ownedClouds = Array.from(stats.querySelectorAll<HTMLElement>('[data-gdl-cloud-status="1"]'));
		const cloudWrappers = elementsWithCssModuleClass(stats, classes.PlayBarCloudStatusContainer)
			.filter(element => closestWithCssModuleClass(element, classes.GameStatsSection) === stats);
		const nativeCloud = cloudWrappers.find(element => {
			if (element.dataset.gdlCloudStatus === '1') return false;
			const stat = findVisibleCloudStatusStat(element);
			return Boolean(stat && isPaintedCloudElement(doc, stat));
		});
		if (nativeCloud) {
			// If Steam has hydrated its own cloud control, it is authoritative. A
			// previously injected fallback must not remain alongside it.
			for (const owned of ownedClouds) owned.remove();
			continue;
		}
		if (ownedClouds.length > 0) {
			// A valid widget stays static on scroll, focus and metadata updates.
			// Repair only a hidden or invalid widget left by an earlier mount.
			for (const duplicate of ownedClouds.slice(1)) duplicate.remove();
			restoreOwnedCloudStatus(ownedClouds[0]);
			cachedCloudStatus.set(doc, { wrapper: ownedClouds[0], language });
			continue;
		}
		let reference = stats.querySelector<HTMLElement>(
			'[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements, [class*="MiniAchievements"], [data-gdl-playtime="1"], [class*="LastPlayed"]:not([data-gdl-cloud-status]), [class*="lastPlayed"]:not([data-gdl-cloud-status]), [class*="Playtime"]:not([data-gdl-cloud-status]), [class*="playtime"]:not([data-gdl-cloud-status])'
		) || null;
		while (reference && reference.parentElement !== stats) reference = reference.parentElement;

		const cachedWrapper = cachedCloudStatus.get(doc)?.wrapper;
		let wrapper = cachedWrapper;
		if (!wrapper) wrapper = buildNativeCloudBlueprint(doc) || undefined;
		if (!wrapper) wrapper = doc.createElement('div');
		restoreOwnedCloudStatus(wrapper);
		const cloudGraphic = wrapper.querySelector<HTMLElement>('.gdl-cloud-icon, svg, img');
		if (cloudGraphic?.parentElement && cloudGraphic.parentElement.dataset.gdlUiIconHost !== 'cloud') {
			cloudGraphic.parentElement.dataset.gdlUiIconHost = 'cloud';
		}
		if (!cachedWrapper) applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus);
		const targetReference = (reference && reference !== wrapper) ? reference : stats.firstChild;
		if (wrapper.parentElement !== stats || (wrapper.nextSibling !== targetReference && wrapper !== targetReference)) {
			stats.insertBefore(wrapper, targetReference);
		}
		cachedCloudStatus.set(doc, { wrapper, language });
	}
	// Retire only unused temporary rows. Hidden native rows elsewhere in the
	// document are not evidence that this visible fallback has been replaced.
	doc.querySelectorAll('[data-gdl-cloud-stats="1"]').forEach(element => {
		if (element !== liveStats) element.remove();
	});
	preserveLinkedPlaybarVisibility(doc);
}

export function syncEarlyLinkedCloudStatus(doc: Document): void {
	ensureCloudStatus(doc);
}

export function removeCloudStatus(doc: Document): void {
	doc.querySelectorAll('[data-gdl-cloud-status="1"]').forEach(element => element.remove());
	doc.querySelectorAll('[data-gdl-cloud-stats="1"]').forEach(element => element.remove());
}
