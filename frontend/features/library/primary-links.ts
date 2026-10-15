import { gdlText } from '../../steam/localization';
import { steamGameMainPageUrl } from '../../core/steam-links';
import { escapeHtml } from '../../core/text';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { closestWithCssModuleClass, elementsWithCssModuleClass, hasCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import { committedHeaderAppId, isPaintedLibraryElement, paintedNativePlaybar } from '../../steam/library-details';
import { findNativeLibraryHeader } from '../../steam/library-header';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from './native-route';
import type { NativeLibraryLayout } from './layout';
import { ensurePrimaryLinksStyles } from './styles/primary-links';

export interface PrimaryLinksOptions {
	steamAppId: string;
	shortcutAppId?: string;
	isDelisted?: boolean;
	hasWorkshop: boolean;
	hasDlc?: boolean;
}

type ResponsiveLayout = { update: () => void; dispose: () => void };
const responsiveLayouts = new WeakMap<HTMLElement, ResponsiveLayout>();

function linkedGameDestinations({ steamAppId, isDelisted, hasWorkshop, hasDlc }: PrimaryLinksOptions): Array<[string, string]> {
	const links: Array<[string, string]> = [[gdlText('store_page', 'Store page'), steamGameMainPageUrl(steamAppId, isDelisted)]];
	if (hasDlc) links.push([gdlText('dlc_links', 'DLC'), `https://store.steampowered.com/dlc/${steamAppId}/`]);
	links.push(
		[gdlText('community_hub', 'Community hub'), `https://steamcommunity.com/app/${steamAppId}`],
		[gdlText('points_shop', 'Points shop'), `https://store.steampowered.com/points/shop/app/${steamAppId}`],
		[gdlText('discussions', 'Discussions'), `https://steamcommunity.com/app/${steamAppId}/discussions/`],
		[gdlText('guides', 'Guides'), `https://steamcommunity.com/app/${steamAppId}/guides/`],
	);
	if (hasWorkshop) links.push([gdlText('workshop', 'Workshop'), `https://steamcommunity.com/app/${steamAppId}/workshop/`]);
	links.push([gdlText('support', 'Support'), `https://help.steampowered.com/wizard/HelpWithGame/?appid=${steamAppId}`]);
	return links;
}

function currentShortcut(doc: Document, steamAppId: string, shortcutAppId?: string): number | null {
	const id = routedSteamAppId(doc);
	return id && id >= 2147483648 && !isShortcutDismissed(id) && (!shortcutAppId || String(id) === shortcutAppId)
		&& getCommittedShortcutSteamAppId(id) === steamAppId && paintedNativePlaybar(doc, id) ? id : null;
}

function disposeBar(bar: HTMLElement): void {
	responsiveLayouts.get(bar)?.dispose();
	responsiveLayouts.delete(bar);
	(bar as any).__gdlResizeObserver?.disconnect();
	(bar as any).__gdlParentObserver?.disconnect();
	bar.remove();
}

export function disposePrimaryLinksBar(doc: Document): void {
	for (const bar of doc.querySelectorAll<HTMLElement>('#gdl-link-bar, .gdl-link-bar-inner')) disposeBar(bar);
}

function installPrimaryLinksResponsiveLayout(inner: HTMLElement): void {
	responsiveLayouts.get(inner)?.dispose();
	const primary = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-link'));
	const overflow = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-overflow-link'));
	const more = inner.querySelector<HTMLElement>('.gdl-primary-more');
	const win = inner.ownerDocument.defaultView;
	if (!primary.length || !more || !win) return;
	let frame = 0, lastWidth = -1;
	const update = (): void => {
		frame = 0;
		if (!inner.isConnected || inner.clientWidth === lastWidth) return;
		lastWidth = inner.clientWidth;
		for (const link of primary) link.style.removeProperty('display');
		more.style.setProperty('display', 'none', 'important');
		for (const item of overflow) item.style.setProperty('display', 'none', 'important');
		const computed = win.getComputedStyle(inner);
		const available = Math.max(0, inner.clientWidth - (parseFloat(computed.paddingLeft) || 0) - (parseFloat(computed.paddingRight) || 0));
		const gap = parseFloat(computed.columnGap || computed.gap) || 0;
		const widths = primary.map(link => link.getBoundingClientRect().width);
		if (widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * gap <= available) return;
		let count = Math.max(1, primary.length - 1);
		while (count > 1 && widths.slice(0, count).reduce((sum, width) => sum + width, 0) + count * gap + 34 > available) count--;
		primary.forEach((link, index) => { if (index >= count) link.style.setProperty('display', 'none', 'important'); });
		overflow.forEach((link, index) => link.style.setProperty('display', index >= count ? 'block' : 'none', 'important'));
		more.style.setProperty('display', 'block', 'important');
	};
	const queue = (): void => { if (!frame) frame = win.requestAnimationFrame(update); };
	const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(queue) : null;
	observer?.observe(inner);
	if (!observer) win.addEventListener('resize', queue, { passive: true });
	responsiveLayouts.set(inner, { update, dispose: () => {
		observer?.disconnect();
		if (frame) win.cancelAnimationFrame(frame);
		if (!observer) win.removeEventListener('resize', queue);
	} });
}

/** The verified shortcut owns this stable host; metadata only enriches its links. */
export function createPrimaryLinksBar(doc: Document, _layout: NativeLibraryLayout | null, options: PrimaryLinksOptions): HTMLElement {
	const shortcutId = currentShortcut(doc, options.steamAppId, options.shortcutAppId);
	if (!shortcutId) return doc.createElement('div');
	ensurePrimaryLinksStyles(doc);
	const existing = doc.getElementById('gdl-link-bar');
	const bar = existing || doc.createElement('div');
	if (!existing) {
		bar.id = 'gdl-link-bar';
		bar.className = 'gdl-link-bar-inner';
		bar.dataset.gdlLinksSettled = '0';
	}
	for (const duplicate of doc.querySelectorAll<HTMLElement>('#gdl-link-bar, .gdl-link-bar-inner')) if (duplicate !== bar) disposeBar(duplicate);
	if (bar.dataset.gdlSteamAppId !== options.steamAppId || bar.dataset.gdlShortcutAppId !== String(shortcutId)) {
		bar.style.removeProperty('--gdl-native-links-bottom-gap');
	}
	if (bar.dataset.gdlSteamAppId !== options.steamAppId) bar.dataset.gdlSteamAppId = options.steamAppId;
	if (bar.dataset.gdlShortcutAppId !== String(shortcutId)) bar.dataset.gdlShortcutAppId = String(shortcutId);
	const links = linkedGameDestinations(options);
	const signature = JSON.stringify(links);
	if (bar.dataset.gdlLinksSignature !== signature) {
		const primary = links.map(([label, url], index) => `<a class="gdl-primary-link" data-gdl-primary-index="${index}" href="${escapeHtml(url)}" data-gdl-open-url="${escapeHtml(url)}">${escapeHtml(label)}</a>`).join('');
		const overflow = links.map(([label, url], index) => `<a class="gdl-primary-overflow-link" data-gdl-primary-index="${index}" href="${escapeHtml(url)}" data-gdl-open-url="${escapeHtml(url)}">${escapeHtml(label)}</a>`).join('');
		bar.innerHTML = `${primary}<details class="gdl-primary-more"><summary aria-label="${escapeHtml(gdlText('more_links', 'More links'))}">•••</summary><div class="gdl-primary-more-menu">${overflow}</div></details>`;
		bar.dataset.gdlLinksSignature = signature;
		installPrimaryLinksResponsiveLayout(bar);
	}
	return bar;
}

export function findNativePlayButton(doc: Document): HTMLElement | null {
	const playButtons = Array.from(doc.querySelectorAll<HTMLElement>('button[class*="Play"], [class*="PlayButton"], [class*="playButton"], button[class*="Stop"], [class*="StopButton"]'))
		.filter(element => {
			if (element.closest('#gdl-link-bar, #gdl-library-injected, [id^="gdl-"]')) return false;
			const rect = element.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && rect.top > 60 && rect.top < 700;
		});
	playButtons.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
	return playButtons[0] || null;
}

export function findNativePlaybar(doc: Document): HTMLElement | null {
	const classes = PLAYBAR_CLASSES();
	const id = routedSteamAppId(doc);
	if (id) return paintedNativePlaybar(doc, id);
	const button = findNativePlayButton(doc);
	return (button && closestWithCssModuleClass(button, classes.Container))
		|| elementsWithCssModuleClass(doc, classes.Container).find(element => !element.closest('[id^="gdl-"]') && isRenderedElement(doc, element)) || null;
}

/** Links belong to the scrolling page. Moving them below the sticky copy
 * changes the scroll viewport's height and shifts Steam's parallax origin. */
function findPrimaryLinksPlaybar(doc: Document, shortcutId: number): HTMLElement | null {
	const classes = PLAYBAR_CLASSES();
	return elementsWithCssModuleClass(doc, classes.Container).find(element =>
		hasCssModuleClass(element, classes.InPage) && !element.closest('[id^="gdl-"]')
		&& committedHeaderAppId(element) === shortcutId && isPaintedLibraryElement(doc, element)) || null;
}

function syncNativeLinksBottomGap(bar: HTMLElement, layout?: NativeLibraryLayout | null): void {
	const region = layout?.anchorRegion;
	const view = bar.ownerDocument.defaultView;
	if (!region?.isConnected || region.ownerDocument !== bar.ownerDocument || !view) return;
	const body = Array.from(region.children).find(child => child.tagName === 'DIV');
	if (!body) return;
	const bodyMargin = parseFloat(view.getComputedStyle(body).marginBottom);
	const sectionMargin = parseFloat(view.getComputedStyle(region).marginBottom);
	if (!Number.isFinite(bodyMargin) || !Number.isFinite(sectionMargin)) return;
	// Our bar is the visible surface. Steam's visible LinksSectionContainer is
	// followed by both the body's gutter and its enclosing section's margin.
	// Installed CSS computes 10 + 26px; ColumnContainer then adds its live 10px
	// above BOTH columns. Keep that native padding and its responsive behavior.
	const gap = `${bodyMargin + sectionMargin}px`;
	if (bar.style.getPropertyValue('--gdl-native-links-bottom-gap') !== gap) {
		bar.style.setProperty('--gdl-native-links-bottom-gap', gap);
	}
}

export function isBarProperlyPositionedBelowPlaybar(doc: Document, bar: HTMLElement): boolean {
	const id = currentShortcut(doc, bar.dataset.gdlSteamAppId || '', bar.dataset.gdlShortcutAppId);
	const playbar = id ? findPrimaryLinksPlaybar(doc, id) : null;
	if (!playbar || !bar.isConnected || playbar.contains(bar)
		|| (bar.compareDocumentPosition(playbar) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
	const barRect = bar.getBoundingClientRect(), playbarRect = playbar.getBoundingClientRect();
	return barRect.width > 0 && barRect.height > 0 && barRect.top >= playbarRect.bottom - 4;
}

/** Insert and reveal in one JavaScript turn, without a timed settlement phase. */
export function insertPrimaryLinksBar(bar: HTMLElement, layout?: NativeLibraryLayout | null, _activityWrapper?: HTMLElement): void {
	const doc = bar.ownerDocument;
	const id = currentShortcut(doc, bar.dataset.gdlSteamAppId || '', bar.dataset.gdlShortcutAppId);
	const playbar = id ? findPrimaryLinksPlaybar(doc, id) : null;
	if (!playbar || bar.id !== 'gdl-link-bar') return;
	let anchor = playbar;
	const header = findNativeLibraryHeader(doc);
	if (header?.contains(playbar)) anchor = header;
	const scroll = layout?.twoColumnRow?.parentElement;
	if (scroll?.contains(playbar)) {
		let outer = playbar;
		while (outer.parentElement && outer.parentElement !== scroll) outer = outer.parentElement;
		if (outer.parentElement === scroll) anchor = outer;
	}
	let parent = anchor.parentElement;
	if (!parent || parent === doc.body || parent === doc.documentElement) return;
	const info = doc.getElementById('gdl-game-info-panel');
	if (info?.parentElement === parent && info.dataset.gameKey === bar.dataset.gdlSteamAppId
		&& info.dataset.gdlShortcutAppId === String(id)
		&& (anchor.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING)) anchor = info;
	parent = anchor.parentElement!;
	if (anchor.nextElementSibling !== bar) parent.insertBefore(bar, anchor.nextSibling);
	syncNativeLinksBottomGap(bar, layout);
	responsiveLayouts.get(bar)?.update();
	if (!isBarProperlyPositionedBelowPlaybar(doc, bar)) return;
	if (bar.dataset.gdlLinksSettled !== '1') bar.dataset.gdlLinksSettled = '1';
	for (const property of ['visibility', 'opacity', 'pointer-events', 'display']) if (bar.style.getPropertyValue(property)) bar.style.removeProperty(property);
}
