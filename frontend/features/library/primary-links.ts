import { gdlText } from '../../steam/localization';
import { steamGameMainPageUrl } from '../../core/steam-links';
import { escapeHtml } from '../../core/text';
import { LINKS_BAR_CLASSES, PLAYBAR_CLASSES, resolveClassModule } from '../../steam/css';
import { closestWithCssModuleClass, elementsWithCssModuleClass, hasCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import { committedHeaderAppId, isPaintedLibraryElement, paintedNativePlaybar } from '../../steam/library-details';
import { findNativeLibraryHeader } from '../../steam/library-header';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from './native-route';
import type { NativeLibraryLayout } from './layout';
import { ensurePrimaryLinksStyles } from './styles/primary-links';
import { primaryLinkPositions } from './primary-links-layout';

export interface PrimaryLinksOptions {
	steamAppId: string;
	shortcutAppId?: string;
	isDelisted?: boolean;
	hasWorkshop: boolean;
	hasDlc?: boolean;
}

type ResponsiveLayout = { update: () => void; dispose: () => void };
const responsiveLayouts = new WeakMap<HTMLElement, ResponsiveLayout>();
const SECTION_FALLBACK = { AppDetailsSection: '_2r4TK4BAuU-J4FuF_O7v_5',
	AppDetailsSectionContainer: '_31ptFGGMZrSQc5BCX1e5lm', RightColumnSection: '_3KfxIwlXEvum7FCD_AM2_t', Body: '_5uvIN6jXDXzzck59F-nhv' };

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
	const slots = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-slot'));
	const host = inner.querySelector<HTMLElement>('.gdl-primary-links');
	const overflow = Array.from(inner.querySelectorAll<HTMLElement>('.gdl-primary-overflow-link'));
	const more = inner.querySelector<HTMLElement>('.gdl-primary-more');
	const win = inner.ownerDocument.defaultView;
	if (!primary.length || !host || !more || !win) return;
	const doc = inner.ownerDocument;
	const trigger = more.querySelector<HTMLElement>('summary');
	const menu = more.querySelector<HTMLElement>('.gdl-primary-more-menu');
	const closeMenu = (): void => {
		if (menu?.matches(':popover-open')) menu.hidePopover();
		if (more.hasAttribute('open')) more.removeAttribute('open');
		if (trigger?.getAttribute('aria-expanded') !== 'false') trigger?.setAttribute('aria-expanded', 'false');
	};
	const openMenu = (): void => {
		if (!menu || !trigger || !inner.isConnected) return;
		more.setAttribute('open', '');
		menu.showPopover();
		const anchor = trigger.getBoundingClientRect(), rect = menu.getBoundingClientRect();
		const scale = menu.offsetWidth > 0 ? rect.width / menu.offsetWidth : 1;
		menu.style.left = `${Math.max(4, Math.min(anchor.right - rect.width, win.innerWidth - rect.width - 4)) / (scale || 1)}px`;
		menu.style.top = `${Math.max(4, Math.min(anchor.bottom + 2, win.innerHeight - rect.height - 4)) / (scale || 1)}px`;
		trigger.setAttribute('aria-expanded', 'true');
	};
	const toggleMenu = (event: Event): void => {
		event.preventDefault();
		if (more.hasAttribute('open')) closeMenu(); else openMenu();
	};
	const outside = (event: Event): void => { if (!more.contains(event.target as Node)) closeMenu(); };
	const keyboard = (event: KeyboardEvent): void => {
		if (!more.hasAttribute('open')) return;
		const items = overflow.filter(item => item.style.display !== 'none');
		if (event.key === 'Escape') { closeMenu(); trigger?.focus(); }
		else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const index = items.indexOf(doc.activeElement as HTMLElement);
			items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
		} else return;
		event.preventDefault(); event.stopPropagation();
	};
	trigger?.addEventListener('click', toggleMenu);
	menu?.addEventListener('click', closeMenu);
	doc.addEventListener('pointerdown', outside, true);
	doc.addEventListener('keydown', keyboard, true);
	doc.addEventListener('scroll', closeMenu, true);
	let frame = 0, lastMetrics = '', intrinsicMetrics = '';
	let widths: number[] = [], rowHeight = 0;
	let moreBasis = 0, moreOuter = 0, moreShrink = 1, hostShrink = 1;
	const style = (element: HTMLElement, property: string, value: string, priority = ''): void => {
		if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== priority) {
			if (value) element.style.setProperty(property, value, priority); else element.style.removeProperty(property);
		}
	};
	const update = (): void => {
		if (frame) win.cancelAnimationFrame(frame);
		frame = 0;
		if (!inner.isConnected || !inner.clientWidth) return;
		const computed = win.getComputedStyle(slots[0]), font = win.getComputedStyle(primary[0]);
		const maxRows = win.innerHeight < 1200 ? 1 : 3;
		const intrinsic = [(inner as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom,
			computed.marginRight, computed.paddingLeft, computed.paddingRight, computed.paddingTop, computed.paddingBottom,
			font.fontFamily, font.fontSize, font.fontWeight, font.fontStyle, font.lineHeight, font.letterSpacing, font.wordSpacing, font.textTransform].join('|');
		const metrics = [inner.clientWidth, maxRows, intrinsic].join('|');
		if (metrics === lastMetrics) return;
		lastMetrics = metrics;
		closeMenu();
		const gap = parseFloat(computed.marginRight) || 0;
		if (intrinsic !== intrinsicMetrics) {
			intrinsicMetrics = intrinsic;
			widths = slots.map(slot => slot.clientWidth); rowHeight = slots[0].clientHeight;
		}
		const bodyStyle = win.getComputedStyle(host.parentElement!);
		const pixels = (value: string): number => parseFloat(value) || 0;
		const available = pixels(bodyStyle.width) - (bodyStyle.boxSizing === 'border-box'
			? pixels(bodyStyle.paddingLeft) + pixels(bodyStyle.paddingRight) + pixels(bodyStyle.borderLeftWidth) + pixels(bodyStyle.borderRightWidth) : 0);
		if (!moreOuter) {
			// Measure the native flex bases once, while More still has its initial
			// display:none. Its computed width then contains the unshrunk CSS width.
			const moreStyle = win.getComputedStyle(more), hostStyle = win.getComputedStyle(host);
			const padding = pixels(moreStyle.paddingLeft) + pixels(moreStyle.paddingRight);
			const border = pixels(moreStyle.borderLeftWidth) + pixels(moreStyle.borderRightWidth);
			moreBasis = pixels(moreStyle.width) - (moreStyle.boxSizing === 'border-box' ? padding + border : 0);
			moreOuter = moreBasis + padding + border + pixels(moreStyle.marginLeft) + pixels(moreStyle.marginRight);
			moreShrink = pixels(moreStyle.flexShrink); hostShrink = pixels(hostStyle.flexShrink);
		}
		// Steam's CalculateLinkPositions uses logical clientWidth for both the
		// host and links. Mixing zoomed DOMRect widths here changes overflow at
		// identical logical widths when the CEF surface uses CSS zoom.
		let positions = primaryLinkPositions(widths, Math.round(available), gap, rowHeight, maxRows);
		const overflowing = positions.some(position => position.x < 0);
		if (overflowing) {
			// Both native siblings shrink from their flex bases. Compute the same
			// available width without toggling More and forcing a second layout.
			const weight = available * hostShrink + moreBasis * moreShrink;
			const narrowed = available - (weight > 0 ? moreOuter * available * hostShrink / weight : moreOuter);
			positions = primaryLinkPositions(widths, Math.round(narrowed), gap, rowHeight, maxRows);
		}
		const rows = Math.max(1, ...positions.filter(position => position.x >= 0).map(position => 1 + position.y / rowHeight));
		style(more, 'display', overflowing ? 'flex' : 'none', 'important');
		style(host, 'height', `${rows * rowHeight}px`);
		slots.forEach((slot, index) => {
			const position = positions[index];
			const hidden = position.x < 0;
			style(slot, 'opacity', hidden ? '0' : ''); style(slot, 'pointer-events', hidden ? 'none' : ''); style(slot, 'z-index', hidden ? '-100' : '');
			if (primary[index].tabIndex !== (hidden ? -1 : 0)) primary[index].tabIndex = hidden ? -1 : 0;
			style(slot, 'left', hidden ? '' : `${position.x}px`); style(slot, 'top', hidden ? '' : `${position.y}px`);
		});
		overflow.forEach((link, index) => style(link, 'display', positions[index].x < 0 ? 'block' : 'none', 'important'));
	};
	const queue = (): void => { if (!frame) frame = win.requestAnimationFrame(update); };
	const fontLoaded = (): void => { lastMetrics = ''; intrinsicMetrics = ''; queue(); };
	const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(queue) : null;
	observer?.observe(inner);
	win.addEventListener('resize', queue, { passive: true });
	doc.fonts?.addEventListener('loadingdone', fontLoaded);
	responsiveLayouts.set(inner, { update, dispose: () => {
		closeMenu();
		trigger?.removeEventListener('click', toggleMenu);
		menu?.removeEventListener('click', closeMenu);
		doc.removeEventListener('pointerdown', outside, true);
		doc.removeEventListener('keydown', keyboard, true);
		doc.removeEventListener('scroll', closeMenu, true);
		observer?.disconnect();
		if (frame) win.cancelAnimationFrame(frame);
		win.removeEventListener('resize', queue);
		doc.fonts?.removeEventListener('loadingdone', fontLoaded);
	} });
}

/** The verified shortcut owns this stable host; metadata only enriches its links. */
export function createPrimaryLinksBar(doc: Document, _layout: NativeLibraryLayout | null, options: PrimaryLinksOptions): HTMLElement {
	const shortcutId = currentShortcut(doc, options.steamAppId, options.shortcutAppId);
	if (!shortcutId) return doc.createElement('div');
	ensurePrimaryLinksStyles(doc);
	const existing = doc.getElementById('gdl-link-bar');
	const bar = existing || doc.createElement('div');
	const css = LINKS_BAR_CLASSES(doc);
	const section = resolveClassModule(module => Boolean(module.AppDetailsSection && module.AppDetailsSectionContainer
		&& module.RightColumnSection && module.Body), SECTION_FALLBACK, doc).classes;
	if (!existing) {
		bar.id = 'gdl-link-bar';
		bar.dataset.gdlLinksSettled = '0';
	}
	const className = `gdl-link-bar-inner ${section.AppDetailsSection} ${css.LinksSection}`;
	if (bar.className !== className) bar.className = className;
	for (const duplicate of doc.querySelectorAll<HTMLElement>('#gdl-link-bar, .gdl-link-bar-inner')) if (duplicate !== bar) disposeBar(duplicate);
	if (bar.dataset.gdlSteamAppId !== options.steamAppId || bar.dataset.gdlShortcutAppId !== String(shortcutId)) {
		bar.style.removeProperty('--gdl-native-links-bottom-gap');
	}
	if (bar.dataset.gdlSteamAppId !== options.steamAppId) bar.dataset.gdlSteamAppId = options.steamAppId;
	if (bar.dataset.gdlShortcutAppId !== String(shortcutId)) bar.dataset.gdlShortcutAppId = String(shortcutId);
	const links = linkedGameDestinations(options);
	const signature = JSON.stringify([links, css, section]);
	if (bar.dataset.gdlLinksSignature !== signature) {
		const primary = links.map(([label, url], index) => `<div class="gdl-primary-slot ${css.LinkInner}"><a class="gdl-primary-link ${css.Anchor}" data-gdl-primary-index="${index}" href="${escapeHtml(url)}" data-gdl-open-url="${escapeHtml(url)}"><div class="${css.Link}"><span class="${css.Text}">${escapeHtml(label)}</span></div></a></div>`).join('');
		const overflow = links.map(([label, url], index) => `<a class="gdl-primary-overflow-link" data-gdl-primary-index="${index}" href="${escapeHtml(url)}" data-gdl-open-url="${escapeHtml(url)}">${escapeHtml(label)}</a>`).join('');
		responsiveLayouts.get(bar)?.dispose();
		bar.innerHTML = `<div class="${section.AppDetailsSectionContainer} ${section.RightColumnSection}"><div class="${section.Body} ${css.LinksSectionBody}"><div class="gdl-primary-links ${css.Links}">${primary}</div><details class="gdl-primary-more ${css.MenuButton}"><summary aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(gdlText('more_links', 'More links'))}"><svg viewBox="0 0 256 256" aria-hidden="true"><circle cx="126" cy="134" r="20.6"/><circle cx="189.4" cy="134" r="20.6"/><circle cx="62.6" cy="134" r="20.6"/></svg></summary><div class="gdl-primary-more-menu" popover="manual" role="menu">${overflow}</div></details></div></div>`;
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
	responsiveLayouts.get(bar)?.update();
	if (!isBarProperlyPositionedBelowPlaybar(doc, bar)) return;
	if (bar.dataset.gdlLinksSettled !== '1') bar.dataset.gdlLinksSettled = '1';
	for (const property of ['visibility', 'opacity', 'pointer-events', 'display']) if (bar.style.getPropertyValue(property)) bar.style.removeProperty(property);
}
