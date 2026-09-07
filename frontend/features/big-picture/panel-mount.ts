import { loc } from '../../steam/localization';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { detectGameControllerSupport, type GameControllerSupport } from '../library/controller';

export type BigPicturePanelTab = 'activity' | 'stuff' | 'community' | 'info';

export interface BigPictureNativeTabs {
	strip: HTMLElement;
	controls: Map<BigPicturePanelTab, HTMLElement>;
}

function panelFromControl(doc: Document, control: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = control;
	for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
		const controlledIds = String(current.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
		for (const controlledId of controlledIds) {
			const controlled = doc.getElementById(controlledId) as HTMLElement | null;
			// Recent Steam builds no longer consistently expose role=tabpanel on
			// this node. aria-controls is already the stronger ownership signal.
			if (controlled) return controlled;
		}
		const id = current.id;
		if (id) {
			const labelled = Array.from(doc.querySelectorAll<HTMLElement>('[aria-labelledby]'))
				.find(panel => String(panel.getAttribute('aria-labelledby') || '').split(/\s+/).includes(id));
			if (labelled) return labelled;
		}
	}
	return null;
}

function usableNativePanel(
	doc: Document,
	panel: HTMLElement | null,
	strip: HTMLElement,
): panel is HTMLElement {
	if (!panel || !panel.isConnected || panel === doc.body || panel === doc.documentElement) return false;
	if (panel.contains(strip) || panel.closest('#gdl-bp-detail-root')) return false;
	if (panel.hidden || panel.getAttribute('aria-hidden') === 'true') return false;
	const style = doc.defaultView?.getComputedStyle(panel);
	if (style?.display === 'none' || style?.visibility === 'hidden') return false;
	const rect = panel.getBoundingClientRect();
	return rect.width >= 280;
}

function addPanelCandidate(candidates: Set<HTMLElement>, element: Element | null): void {
	// Elements belong to Steam's popup realm, so the main window's HTMLElement
	// constructor is not a reliable instanceof boundary here.
	if (element?.nodeType === 1) candidates.add(element as HTMLElement);
}

function commonPanelAncestor(elements: HTMLElement[]): HTMLElement | null {
	if (elements.length === 0) return null;
	let current: HTMLElement | null = elements[0];
	while (current) {
		if (elements.every(element => current === element || current!.contains(element))) return current;
		current = current.parentElement;
	}
	return null;
}

function findNativeTabPanel(
	doc: Document,
	tabs: BigPictureNativeTabs,
	tab: BigPicturePanelTab,
): HTMLElement | null {
	const explicit = panelFromControl(doc, tabs.controls.get(tab) || tabs.controls.get('activity')!);
	if (usableNativePanel(doc, explicit, tabs.strip)) return explicit;

	// Steam has shipped both ARIA tabpanels and anonymous CSS-module content
	// hosts. Collect both forms, plus nearby siblings, and rank them relative to
	// the visible native tab strip instead of relying on one unstable class name.
	const candidates = new Set<HTMLElement>();
	for (const panel of Array.from(doc.querySelectorAll<HTMLElement>(
		'[role="tabpanel"], [class*="TabPanel"], [class*="TabContent"], [class*="DetailsContent"], [class*="DetailContent"]'
	))) addPanelCandidate(candidates, panel);
	let branch: HTMLElement | null = tabs.strip;
	for (let depth = 0; branch && depth < 4; depth += 1) {
		addPanelCandidate(candidates, branch.nextElementSibling);
		branch = branch.parentElement;
	}

	const stripRect = tabs.strip.getBoundingClientRect();
	let best: { panel: HTMLElement; score: number } | null = null;
	for (const panel of candidates) {
		if (!usableNativePanel(doc, panel, tabs.strip)) continue;
		const rect = panel.getBoundingClientRect();
		const horizontalOverlap = Math.max(0,
			Math.min(rect.right, stripRect.right) - Math.max(rect.left, stripRect.left));
		const overlapRatio = horizontalOverlap / Math.max(1, Math.min(rect.width, stripRect.width));
		const verticalGap = rect.top - stripRect.bottom;
		const semanticPanel = panel.matches(
			'[role="tabpanel"], [class*="TabPanel"], [class*="TabContent"], [class*="DetailsContent"], [class*="DetailContent"]'
		);
		// A play bar or hero is also a nearby sibling in several Steam layouts.
		// Anonymous candidates must begin below the tabs and close to them; this
		// prevents us from ever adopting (and hiding) those native regions.
		if (!semanticPanel && (verticalGap < -36 || verticalGap > 300)) continue;
		if (semanticPanel && !panel.matches('[role="tabpanel"]') && verticalGap < -72) continue;
		let score = rect.height > 0 ? 30 : 12;
		if (panel.matches('[role="tabpanel"]')) score += 70;
		if (verticalGap >= -28 && verticalGap <= 260) score += 55;
		else if (rect.bottom < stripRect.top - 20) score -= 120;
		if (overlapRatio >= 0.55) score += 35;
		if (panel.parentElement === tabs.strip.parentElement) score += 45;
		if (tabs.strip.parentElement?.contains(panel)) score += 35;
		const common = commonPanelAncestor([tabs.strip, panel]);
		if (common && common !== doc.body) score += 20;
		if (/panel|content/i.test(`${panel.id} ${String(panel.className || '')}`)) score += 12;
		if (!best || score > best.score) best = { panel, score };
	}
	return best && best.score >= 25 ? best.panel : null;
}

function findFallbackMount(
	doc: Document,
	strip: HTMLElement,
): { parent: HTMLElement; anchor: HTMLElement } | null {
	let anchor = strip;
	for (let depth = 0; depth < 6; depth += 1) {
		const parent = anchor.parentElement;
		if (!parent || parent === doc.body || parent === doc.documentElement) break;
		const style = doc.defaultView?.getComputedStyle(parent);
		const horizontalNoWrap = style?.display.includes('flex')
			&& style.flexDirection.startsWith('row')
			&& style.flexWrap === 'nowrap';
		const clippedBand = /hidden|clip/.test(String(style?.overflowY || style?.overflow || ''))
			&& parent.getBoundingClientRect().height <= strip.getBoundingClientRect().height + 48;
		if (!horizontalNoWrap && !clippedBand) return { parent, anchor };
		anchor = parent;
	}
	const parent = strip.parentElement;
	return parent && parent !== doc.body ? { parent, anchor: strip } : null;
}

function ensureFallbackPanel(doc: Document, strip: HTMLElement): HTMLElement | null {
	let panel = doc.getElementById('gdl-bp-detail-fallback-panel') as HTMLElement | null;
	if (panel?.isConnected) return panel;
	panel?.remove();
	const mount = findFallbackMount(doc, strip);
	if (!mount) return null;
	panel = doc.createElement('section');
	panel.id = 'gdl-bp-detail-fallback-panel';
	panel.dataset.gdlBpFallbackPanel = '1';
	panel.setAttribute('aria-live', 'polite');
	mount.parent.insertBefore(panel, mount.anchor.nextSibling);
	return panel;
}

/** Mount inside Steam's own active tabpanel or directly adjacent fallback region. */
export function ensureNativePanelRoot(
	doc: Document,
	tabs: BigPictureNativeTabs,
	tab: BigPicturePanelTab,
): { panel: HTMLElement; root: HTMLElement } | null {
	const nativePanel = findNativeTabPanel(doc, tabs, tab);
	const panel = nativePanel || ensureFallbackPanel(doc, tabs.strip);
	if (!panel) return null;
	let root = doc.getElementById('gdl-bp-detail-root') as HTMLElement | null;
	if (!root) {
		root = doc.createElement('div');
		root.id = 'gdl-bp-detail-root';
		root.dataset.gdlBigPictureDetails = '1';
	}
	root.setAttribute('flow-children', 'column');
	root.setAttribute('focusable', 'false');
	panel.dataset.gdlBpNativePanel = '1';
	if (root.parentElement !== panel) panel.appendChild(root);
	if (panel.firstChild !== root) panel.insertBefore(root, panel.firstChild);
	Array.from(panel.children).forEach(child => {
		if (child !== root && child.id !== 'gdl-bp-detail-root') {
			(child as HTMLElement).hidden = true;
			(child as HTMLElement).style.setProperty('display', 'none', 'important');
			(child as HTMLElement).dataset.gdlBpHiddenNotice = '1';
		}
	});
	const fallback = doc.getElementById('gdl-bp-detail-fallback-panel');
	if (nativePanel && fallback && fallback !== panel) fallback.remove();
	return { panel, root };
}

export function removeBigPictureFallbackPanel(doc: Document): void {
	doc.getElementById('gdl-bp-detail-fallback-panel')?.remove();
}

export function hideBigPictureNonSteamNotices(doc: Document): void {
	if (!doc.body) return;
	const anchors = [
		'no es un juego de steam', 'no es un juego o mod', 'no está disponible porque no es un juego',
		'non-steam game', 'nicht von steam', "n'est pas un jeu steam", 'não é um juego steam',
		'não é um jogo steam', 'не из steam', 'steam controla el inicio', 'steam controls the start',
	];
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('div, p, section, [class*="Notice"], [class*="Description"]'))) {
		if (el.closest('#gdl-bp-detail-root, #gdl-bp-cloud-divider, [class*="Collection"], [class*="Shelf"], [class*="Grid"], [class*="CollectionsHeader"]')) continue;
		const text = (el.textContent || '').trim().toLowerCase();
		if (text && anchors.some(anchor => text.includes(anchor))) {
			const container = (el.closest('[class*="Section"], [class*="Container"], [class*="Panel"]') as HTMLElement) || el;
			if (container.closest('#gdl-bp-detail-root, [class*="Collection"], [class*="Shelf"], [class*="Grid"], [class*="CollectionsHeader"]')) continue;
			if (!container.contains(doc.getElementById('gdl-bp-detail-root')!)) {
				container.hidden = true;
				container.dataset.gdlBpHiddenNotice = '1';
				container.setAttribute('aria-hidden', 'true');
			}
		}
	}
}

export function restoreBigPictureNonSteamNotices(doc: Document): void {
	for (const element of Array.from(doc.querySelectorAll<HTMLElement>('[data-gdl-bp-hidden-notice="1"]'))) {
		element.hidden = false;
		delete element.dataset.gdlBpHiddenNotice;
		element.removeAttribute('aria-hidden');
	}
}

export function ensureCloudDivider(doc: Document, strip: HTMLElement): HTMLElement | null {
	const tabContainer = strip.closest<HTMLElement>(
		'[class*="TabsContainer"], [class*="tabsContainer"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"], [class*="tabsStrip"], [role="tablist"]'
	) || strip;
	const parent = tabContainer.parentElement;
	if (!parent) return null;
	const hasNativeCloud = Boolean(
		Array.from(parent.querySelectorAll<HTMLElement>(
			'[class*="CloudStatus"], [class*="cloudStatus"], [class*="CloudSync"], [class*="cloudSync"]'
		)).find(el => el.id !== 'gdl-bp-cloud-divider' && !el.closest('#gdl-bp-cloud-divider'))
	);
	if (hasNativeCloud) {
		doc.getElementById('gdl-bp-cloud-divider')?.remove();
		return null;
	}
	let divider = doc.getElementById('gdl-bp-cloud-divider');
	if (!divider) {
		divider = doc.createElement('div');
		divider.id = 'gdl-bp-cloud-divider';
		divider.dataset.gdlCloudDivider = '1';
		divider.setAttribute('role', 'status');
		divider.setAttribute('aria-label', 'Steam Cloud');
		parent.insertBefore(divider, tabContainer);
	} else if (divider.parentElement !== parent || divider.nextElementSibling !== tabContainer) {
		parent.insertBefore(divider, tabContainer);
	}
	const playbar = PLAYBAR_CLASSES();
	divider.className = playbar.CloudStatusRow || '';

	let iconSpan = divider.querySelector<HTMLSpanElement>(':scope > span:first-child');
	if (!iconSpan) {
		iconSpan = doc.createElement('span');
		divider.appendChild(iconSpan);
	}
	iconSpan.className = playbar.CloudStatusIcon || '';
	if (!iconSpan.querySelector('svg')) {
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 36 36');
		svg.setAttribute('fill', 'none');
		const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('fill', 'currentColor');
		path.setAttribute('fill-rule', 'evenodd');
		path.setAttribute('clip-rule', 'evenodd');
		path.setAttribute('d', 'M25.2377 7.0939C26.902 8.83356 27.8828 11.1153 28 13.52C29.998 14.2303 31.6809 15.6232 32.7522 17.4532C33.8234 19.2831 34.2142 21.4325 33.8555 23.5224C33.4968 25.6122 32.4118 27.5084 30.7917 28.8764C29.1716 30.2444 27.1205 30.9965 25 31H11C8.87962 30.9965 6.82852 30.2444 5.20842 28.8764C3.58833 27.5084 2.50327 25.6122 2.1446 23.5224C1.78593 21.4325 2.17666 19.2831 3.24792 17.4532C4.31917 15.6232 6.00213 14.2303 8.00005 13.52C8.11845 11.109 9.10495 8.82222 10.7775 7.08168C12.45 5.34114 14.6957 4.26433 17.1 4.04999H18.0201H18.9401C21.3372 4.27345 23.5733 5.35425 25.2377 7.0939ZM10 19.6L15.41 25L25.03 15.38L22.64 13L15.41 20.23L12.39 17.21L10 19.6Z');
		svg.appendChild(path);
		iconSpan.appendChild(svg);
	}

	let labelSpan = divider.querySelector<HTMLSpanElement>(':scope > span:last-child');
	if (!labelSpan || labelSpan === iconSpan) {
		labelSpan = doc.createElement('span');
		divider.appendChild(labelSpan);
	}
	labelSpan.className = playbar.CloudStatusLabel || '';
	labelSpan.textContent = `STEAM CLOUD: ${loc('AppDetails_CloudStatus_Synchronized', 'ACTUALIZADO').toUpperCase()}`;
	return divider;
}

export function removeCloudDivider(doc: Document): void {
	doc.getElementById('gdl-bp-cloud-divider')?.remove();
}

const XBOX_PATH =
	'M11.25 5.625C11.909 5.625 12.182 5.81802 12.4081 5.97792C12.568 6.09099 12.7045 6.1875 12.9375 6.1875H23.0625C23.2955 6.1875 23.432 6.09099 23.5919 5.97792C23.818 5.81802 24.091 5.625 24.75 5.625C25.875 5.625 29.25 6.75 29.8125 7.3125C30.375 7.875 30.375 8.4375 30.375 8.4375V8.5803C30.8163 8.91923 31.1986 9.26106 31.5 9.5625C32.625 10.6875 36 20.25 36 25.3125C36 30.375 32.625 30.9375 32.625 30.9375C31.7178 30.9375 30.323 29.1494 28.9649 27.4083C27.7966 25.9106 26.6553 24.4476 25.875 24.1875C24.1875 23.625 11.8125 23.625 10.125 24.1875C9.34465 24.4476 8.20344 25.9106 7.03512 27.4083C5.67696 29.1494 4.28215 30.9375 3.375 30.9375C3.375 30.9375 0 30.375 0 25.3125C0 20.25 3.375 10.6875 4.5 9.5625C4.80144 9.26106 5.18366 8.91923 5.625 8.5803V8.4375C5.625 8.4375 5.625 7.875 6.1875 7.3125C6.75 6.75 10.125 5.625 11.25 5.625ZM27.5625 8.71875C28.3392 8.71875 28.9688 9.34835 28.9688 10.125C28.9688 10.9017 28.3392 11.5312 27.5625 11.5312C26.7858 11.5312 26.1562 10.9017 26.1562 10.125C26.1562 9.34835 26.7858 8.71875 27.5625 8.71875ZM8.4375 14.625C9.68014 14.625 10.6875 13.6176 10.6875 12.375C10.6875 11.1324 9.68014 10.125 8.4375 10.125C7.19486 10.125 6.1875 11.1324 6.1875 12.375C6.1875 13.6176 7.19486 14.625 8.4375 14.625ZM23.0625 20.25C24.3051 20.25 25.3125 19.2426 25.3125 18C25.3125 16.7574 24.3051 15.75 23.0625 15.75C21.8199 15.75 20.8125 16.7574 20.8125 18C20.8125 19.2426 21.8199 20.25 23.0625 20.25ZM12.0938 17.1562V16.3125C12.0938 16.0018 12.3456 15.75 12.6562 15.75H13.7812C14.0919 15.75 14.3438 16.0018 14.3438 16.3125V17.1562H15.1875C15.4982 17.1562 15.75 17.4081 15.75 17.7188V18.8438C15.1875 19.1544 15.4982 19.4062 15.1875 19.4062H14.3438V20.25C14.3438 20.5607 14.0919 20.8125 13.7812 20.8125H12.6562C12.3456 20.8125 12.0938 20.5607 12.0938 20.25V19.4062H11.25C10.9393 19.4062 10.6875 19.1544 10.6875 18.8438V17.7188C10.6875 17.4081 10.9393 17.1562 11.25 17.1562H12.0938ZM25.0312 14.0625C25.8079 14.0625 26.4375 13.4329 26.4375 12.6562C26.4375 11.8796 25.8079 11.25 25.0312 11.25C24.2546 11.25 23.625 11.8796 23.625 12.6562C23.625 13.4329 24.2546 14.0625 25.0312 14.0625ZM31.5 12.6562C31.5 13.4329 30.8704 14.0625 30.0938 14.0625C29.3171 14.0625 28.6875 13.4329 28.6875 12.6562C28.6875 11.8796 29.3171 11.25 30.0938 11.25C30.8704 11.25 31.5 11.8796 31.5 12.6562ZM28.9688 15.1875C28.9688 14.4108 28.3392 13.7812 27.5625 13.7812C26.7858 13.7812 26.1562 14.4108 26.1562 15.1875C26.1562 15.9642 26.7858 16.5938 27.5625 16.5938C28.3392 16.5938 28.9688 15.9642 28.9688 15.1875Z';

const PS_PATH =
	'M4.49995 7.47C3.93745 8.0325 2.81244 10.2825 2.81244 10.2825C2.24993 11.97 0.562445 17.0325 -5.43911e-05 23.7825C-5.43911e-05 23.7825 -0.562553 28.845 3.37495 29.4075C6.832 29.8396 7.9652 25.2921 8.55982 22.9059C8.73921 22.186 8.86958 21.6629 8.99995 21.5325C9.33789 21.1945 9.67584 21.0596 9.89181 21.0058C10.5086 21.6754 11.3928 22.095 12.3749 22.095C13.3745 22.095 14.2726 21.6605 14.8906 20.97H21.1093C21.7273 21.6605 22.6254 22.095 23.6249 22.095C24.6071 22.095 25.4913 21.6754 26.1081 21.0058C26.3241 21.0596 26.662 21.1945 27 21.5325C27.1303 21.6629 27.2607 22.186 27.4401 22.9059C28.0347 25.2921 29.1679 29.8396 32.625 29.4075C36.5625 28.845 36 23.7825 36 23.7825C35.4375 17.0325 33.75 11.97 33.1875 10.2825C33.1875 10.2825 32.0625 8.03251 31.4999 7.47C31.4575 7.42758 31.3927 7.39155 31.3091 7.36121C30.794 7.09333 29.2603 6.45543 26.9999 6.9075C26.8121 7.09539 26.6869 7.28328 26.6036 7.45021C26.4971 7.46255 26.4375 7.47001 26.4375 7.47001L25.875 8.0325L24.1874 8.03251V12.5325C24.1874 13.1538 23.6838 13.6575 23.0624 13.6575H12.9374C12.3161 13.6575 11.8124 13.1538 11.8124 12.5325V8.03251L10.1249 8.03249L9.56245 7.47C9.56245 7.47 9.50277 7.46254 9.39629 7.4502C9.31296 7.28328 9.18783 7.09539 8.99995 6.9075C6.73958 6.45543 5.20586 7.09333 4.6908 7.36121C4.60721 7.39155 4.54237 7.42759 4.49995 7.47ZM14.3999 18.1575C14.3999 19.4002 13.3926 20.4075 12.1499 20.4075C10.9073 20.4075 9.89995 19.4002 9.89995 18.1575C9.89995 16.9149 10.9073 15.9075 12.1499 15.9075C13.3926 15.9075 14.3999 16.9149 14.3999 18.1575ZM23.6249 20.4075C24.8676 20.4075 25.8749 19.4002 25.8749 18.1575C25.8749 16.9149 24.8676 15.9075 23.6249 15.9075C22.3823 15.9075 21.3749 16.9149 21.3749 18.1575C21.3749 19.4002 22.3823 20.4075 23.6249 20.4075ZM30.3749 10.845C30.3749 11.4663 29.8713 11.97 29.2499 11.97C28.6286 11.97 28.1249 11.4663 28.1249 10.845C28.1249 10.2237 28.6286 9.72001 29.2499 9.72001C29.8713 9.72001 30.3749 10.2237 30.3749 10.845ZM29.2499 17.0325C29.8713 17.0325 30.3749 16.5288 30.3749 15.9075C30.3749 15.2862 29.8713 14.7825 29.2499 14.7825C28.6286 14.7825 28.1249 15.2862 28.1249 15.9075C28.1249 16.5288 28.6286 17.0325 29.2499 17.0325ZM26.7187 12.2513C27.34 12.2513 27.8437 12.7549 27.8437 13.3763C27.8437 13.9976 27.34 14.5013 26.7187 14.5013C26.0974 14.5013 25.5937 13.9976 25.5937 13.3763C25.5937 12.7549 26.0974 12.2513 26.7187 12.2513ZM32.9062 13.3763C32.9062 12.7549 32.4025 12.2513 31.7812 12.2513C31.1599 12.2513 30.6562 12.7549 30.6562 13.3763C30.6562 13.9976 31.1599 14.5013 31.7812 14.5013C32.4025 14.5013 32.9062 13.9976 32.9062 13.3763ZM5.62495 10.7825C5.62495 10.5064 5.8488 10.2825 6.12495 10.2825H7.37495C7.65109 10.2825 7.87495 10.5064 7.87495 10.7825V11.7629C7.87495 11.8955 7.82227 12.0227 7.7285 12.1165L7.1035 12.7415C6.90824 12.9367 6.59166 12.9367 6.39639 12.7415L5.77139 12.1165C5.67763 12.0227 5.62495 11.8955 5.62495 11.7629V10.7825ZM6.12495 16.47C5.8488 16.47 5.62495 16.2462 5.62495 15.97V14.9896C5.62495 14.857 5.67763 14.7298 5.77139 14.6361L6.39639 14.0111C6.59166 13.8158 6.90824 13.8158 7.1035 14.0111L7.7285 14.6361C7.82227 14.7298 7.87495 14.857 7.87495 14.9896V15.97C7.87495 16.2462 7.65109 16.47 7.37495 16.47H6.12495ZM4.1562 14.5013C3.88006 14.5013 3.6562 14.2774 3.6562 14.0013V12.7513C3.6562 12.4751 3.88006 12.2513 4.1562 12.2513H5.13659C5.2692 12.2513 5.39638 12.3039 5.49014 12.3977L6.11514 13.0227C6.31041 13.218 6.31041 13.5346 6.11514 13.7298L5.49014 14.3548C5.39638 14.4486 5.2692 14.5013 5.13659 14.5013H4.1562ZM9.8437 14.0013C9.8437 14.2774 9.61984 14.5013 9.3437 14.5013H8.36331C8.2307 14.5013 8.10352 14.4486 8.00975 14.3548L7.38475 13.7298C7.18949 13.5346 7.18949 13.218 7.38475 13.0227L8.00975 12.3977C8.10352 12.3039 8.2307 12.2513 8.36331 12.2513H9.3437C9.61984 12.2513 9.8437 12.4751 9.8437 12.7513V14.0013ZM23.0624 8.03251L12.9374 8.03251V12.5325H23.0624V8.03251Z';

const PS5_PATH_1 =
	'M4.5 8.77962V8.17604C4.5 7.98797 4.59324 7.8129 4.75606 7.71875C5.29052 7.40971 6.58276 6.75 7.875 6.75C9.5625 6.75 9.5625 7.3125 9.5625 7.3125V7.79346C9.92732 7.74841 10.3079 7.7053 10.7038 7.66469L10.7001 7.66881C10.4768 7.91891 10.3639 8.22982 10.4289 8.58762L11.114 12.3555C11.3614 13.7163 10.9231 15.1154 9.99052 16.155C8.88458 17.3878 7.44481 19.1078 6.50883 20.6678C5.85918 21.7505 5.21964 23.4605 4.67636 25.1549C4.13086 26.8562 3.67463 28.5672 3.3961 29.6673C3.27268 30.1547 2.76181 30.4366 2.2902 30.2794L2.14425 30.2308C1.59878 29.9208 1.15999 29.4611 0.929107 28.8508C0.480791 27.6656 0 25.7647 0 23.0625C0 18 2.8125 9.5625 3.9375 9C4.07055 8.93348 4.25867 8.85908 4.5 8.77962ZM5.625 11.25C5.625 10.9393 5.87684 10.6875 6.1875 10.6875H7.3125C7.62316 10.6875 7.875 10.9393 7.875 11.25V12.142C7.875 12.2912 7.81574 12.4343 7.71025 12.5398L7.14775 13.1023C6.92808 13.3219 6.57192 13.3219 6.35225 13.1023L5.78975 12.5398C5.68426 12.4343 5.625 12.2912 5.625 12.142V11.25ZM5.625 16.3125C5.625 16.6232 5.87684 16.875 6.1875 16.875H7.3125C7.62316 16.875 7.875 16.6232 7.875 16.3125V15.4205C7.875 15.2713 7.81574 15.1282 7.71025 15.0227L7.14775 14.4602C6.92808 14.2406 6.57192 14.2406 6.35225 14.4602L5.78975 15.0227C5.68426 15.1282 5.625 15.2713 5.625 15.4205V16.3125ZM9.84375 14.3438C9.84375 14.6544 9.59191 14.9062 9.28125 14.9062H8.38924C8.24006 14.9062 8.09699 14.847 7.9915 14.7415L7.429 14.179C7.20933 13.9593 7.20933 13.6032 7.429 13.3835L7.9915 12.821C8.09699 12.7155 8.24006 12.6562 8.38925 12.6562H9.28125C9.59191 12.6562 9.84375 12.9081 9.84375 13.2188V14.3438ZM4.21875 14.9062C3.90809 14.9062 3.65625 14.6544 3.65625 14.3438V13.2188C3.65625 12.9081 3.90809 12.6562 4.21875 12.6562H5.11076C5.25994 12.6562 5.40301 12.7155 5.5085 12.821L6.071 13.3835C6.29067 13.6032 6.29067 13.9593 6.071 14.179L5.5085 14.7415C5.40301 14.847 5.25994 14.9062 5.11076 14.9062H4.21875ZM9.0297 9.05937C9.30756 8.92044 9.64544 9.03307 9.78437 9.31093L10.0656 9.87343C10.2046 10.1513 10.0919 10.4892 9.81406 10.6281C9.5362 10.767 9.19832 10.6544 9.05939 10.3765L8.77814 9.81404C8.63921 9.53618 8.75183 9.1983 9.0297 9.05937Z';

const PS5_PATH_2 =
	'M18 7.3125C15.7603 7.3125 13.748 7.4035 11.9892 7.54668C11.9209 7.57082 11.8551 7.59586 11.7919 7.62185C11.4768 7.75142 11.2526 7.89452 11.1197 8.04343C10.9961 8.18189 10.9523 8.32182 10.9824 8.48699L11.5138 11.4097L12.1573 13.5129C12.4103 14.3408 13.1744 14.9062 14.0401 14.9062H21.9642C22.8281 14.9062 23.591 14.3431 23.8456 13.5176L24.4729 11.483L25.0176 8.48699C25.0463 8.32909 25.0039 8.1935 24.8798 8.05684C24.7463 7.90988 24.5214 7.76808 24.2057 7.6392C24.1215 7.60486 24.0327 7.57213 23.9398 7.54094C22.1978 7.40107 20.2096 7.3125 18 7.3125Z';

const PS5_PATH_3 =
	'M3.37124 30.6556L3.34019 30.6503C3.62833 30.4606 3.84996 30.1665 3.94139 29.8054C4.2185 28.7109 4.67149 27.0124 5.212 25.3266C5.75474 23.6339 6.37801 21.9791 6.99117 20.9572C7.89825 19.4454 9.30802 17.7581 10.4092 16.5306C11.085 15.7773 11.5326 14.8493 11.6859 13.8677C12.0647 14.8275 12.9948 15.4687 14.0401 15.4687H21.9642C23.0065 15.4687 23.9345 14.8312 24.3153 13.8755C24.4698 14.8543 24.9168 15.7794 25.5908 16.5306C26.692 17.7581 28.1017 19.4454 29.0088 20.9572C29.622 21.9791 30.2453 23.6339 30.788 25.3266C31.3285 27.0124 31.7815 28.7109 32.0586 29.8054C32.15 30.1664 32.3717 30.4606 32.6598 30.6503L32.6288 30.6556C31.6413 30.8202 30.6725 30.275 30.3007 29.3455L28.4111 24.6216C27.8986 23.3402 26.6576 22.5 25.2775 22.5H10.7225C9.34243 22.5 8.10142 23.3402 7.58888 24.6216L5.69928 29.3455C5.3275 30.275 4.35868 30.8202 3.37124 30.6556ZM25.875 19.125C25.875 20.3676 24.8676 21.375 23.625 21.375C22.3824 21.375 21.375 20.3676 21.375 19.125C21.375 17.8824 22.3824 16.875 23.625 16.875C24.8676 16.875 25.875 17.8824 25.875 19.125ZM12.375 21.375C13.6176 21.375 14.625 20.3676 14.625 19.125C14.625 17.8824 13.6176 16.875 12.375 16.875C11.1324 16.875 10.125 17.8824 10.125 19.125C10.125 20.3676 11.1324 21.375 12.375 21.375Z';

const PS5_PATH_4 =
	'M33.7098 30.2794L33.8557 30.2308C34.4012 29.9208 34.84 29.4611 35.0709 28.8508C35.5192 27.6656 36 25.7647 36 23.0625C36 18 33.1875 9.5625 32.0625 9C31.9295 8.93348 31.7413 8.85908 31.5 8.77962V8.17604C31.5 7.98797 31.4068 7.8129 31.2439 7.71875C30.7095 7.40971 29.4172 6.75 28.125 6.75C26.4375 6.75 26.4375 7.3125 26.4375 7.3125V7.79346C26.0683 7.74787 25.683 7.70427 25.282 7.66324L25.2962 7.67864C25.52 7.92502 25.6356 8.23268 25.5711 8.58762L25.0274 11.5776L25.0319 11.579L25.0203 11.6166L24.886 12.3555C24.6386 13.7163 25.0769 15.1154 26.0095 16.155C27.1154 17.3878 28.5552 19.1078 29.4912 20.6678C30.1408 21.7505 30.7804 23.4605 31.3236 25.1549C31.8691 26.8562 32.3254 28.5672 32.6039 29.6673C32.7273 30.1547 33.2382 30.4366 33.7098 30.2794ZM26.2156 9.31093C26.3546 9.03307 26.6924 8.92044 26.9703 9.05937C27.2482 9.1983 27.3608 9.53618 27.2219 9.81404L26.9406 10.3765C26.8017 10.6544 26.4638 10.767 26.1859 10.6281C25.9081 10.4892 25.7954 10.1513 25.9344 9.87343L26.2156 9.31093ZM30.375 15.75C30.375 16.3713 29.8713 16.875 29.25 16.875C28.6287 16.875 28.125 16.3713 28.125 15.75C28.125 15.1287 28.6287 14.625 29.25 14.625C29.8713 14.625 30.375 15.1287 30.375 15.75ZM31.5 14.625C32.1213 14.625 32.625 14.1213 32.625 13.5C32.625 12.8787 32.1213 12.375 31.5 12.375C30.8787 12.375 30.375 12.8787 30.375 13.5C30.375 14.1213 30.8787 14.625 31.5 14.625ZM30.375 11.25C30.375 11.8713 29.8713 12.375 29.25 12.375C28.6287 12.375 28.125 11.8713 28.125 11.25C28.125 10.6287 28.6287 10.125 29.25 10.125C29.8713 10.125 30.375 10.6287 30.375 11.25ZM27 14.625C27.6213 14.625 28.125 14.1213 28.125 13.5C28.125 12.8787 27.6213 12.375 27 12.375C26.3787 12.375 25.875 12.8787 25.875 13.5C25.875 14.1213 26.3787 14.625 27 14.625Z';

function createOfficialXboxSvg(doc: Document): SVGSVGElement {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('width', '22');
	svg.setAttribute('height', '16');
	svg.style.width = '22px';
	svg.style.height = '16px';
	svg.style.flexShrink = '0';
	svg.style.display = 'block';
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', XBOX_PATH);
	path.setAttribute('fill', 'currentColor');
	path.setAttribute('fill-rule', 'evenodd');
	path.setAttribute('clip-rule', 'evenodd');
	svg.appendChild(path);
	return svg;
}

function createOfficialPsSvg(doc: Document): SVGSVGElement {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('width', '22');
	svg.setAttribute('height', '16');
	svg.style.width = '22px';
	svg.style.height = '16px';
	svg.style.flexShrink = '0';
	svg.style.display = 'block';
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', PS_PATH);
	path.setAttribute('fill', 'currentColor');
	path.setAttribute('fill-rule', 'evenodd');
	path.setAttribute('clip-rule', 'evenodd');
	svg.appendChild(path);
	return svg;
}

function createOfficialPs5Svg(doc: Document): SVGSVGElement {
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 36 36');
	svg.setAttribute('width', '22');
	svg.setAttribute('height', '16');
	svg.style.width = '22px';
	svg.style.height = '16px';
	svg.style.flexShrink = '0';
	svg.style.display = 'block';
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	const paths = [
		{ d: PS5_PATH_1, evenodd: true },
		{ d: PS5_PATH_2, evenodd: false },
		{ d: PS5_PATH_3, evenodd: true },
		{ d: PS5_PATH_4, evenodd: true },
	];
	for (const p of paths) {
		const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', p.d);
		path.setAttribute('fill', 'currentColor');
		if (p.evenodd) {
			path.setAttribute('fill-rule', 'evenodd');
			path.setAttribute('clip-rule', 'evenodd');
		}
		svg.appendChild(path);
	}
	return svg;
}

function renderOfficialControllerSvgs(row: HTMLElement, doc: Document, support?: GameControllerSupport): void {
	while (row.firstChild) row.removeChild(row.firstChild);
	const s = support || { xbox: true, ps4: false, ps5: false };
	if (s.xbox) row.appendChild(createOfficialXboxSvg(doc));
	if (s.ps4) row.appendChild(createOfficialPsSvg(doc));
	if (s.ps5) row.appendChild(createOfficialPs5Svg(doc));
	if (!row.firstChild) {
		row.appendChild(createOfficialXboxSvg(doc));
	}
}

export function ensurePlaybarControllerStat(doc: Document, supportOverride?: GameControllerSupport): HTMLElement | null {
	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();

	const playbar = PLAYBAR_CLASSES();
	const statsSection = doc.querySelector<HTMLElement>(
		`[class*="${playbar.GameStatsSection || 'GameStatsSection'}"], [class*="GameStatsSection"], [class*="gameStatsSection"]`
	);
	if (!statsSection) return null;

	let stat = doc.getElementById('gdl-bp-playbar-controller');
	if (!stat) {
		stat = doc.createElement('div');
		stat.id = 'gdl-bp-playbar-controller';
		stat.dataset.gdlPlaybarController = '1';
	}

	statsSection.querySelectorAll<HTMLElement>('[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements').forEach(el => el.remove());
	if (stat.parentElement !== statsSection) {
		statsSection.appendChild(stat);
	}

	stat.className = [playbar.GameStat, playbar.HideWhenNarrow, 'gdl-controller-stat'].filter(Boolean).join(' ');

	let content = stat.querySelector<HTMLElement>(`[class*="${playbar.GameStatRight || 'GameStatRight'}"]`) || stat.querySelector<HTMLElement>('.gdl-controller-content');
	if (!content) {
		while (stat.firstChild) stat.removeChild(stat.firstChild);
		content = doc.createElement('div');
		content.className = [playbar.HideWhenNarrow, playbar.GameStatRight, 'gdl-controller-content'].filter(Boolean).join(' ');
		stat.appendChild(content);
	}

	let label = content.querySelector<HTMLElement>(':scope > div:first-child');
	if (!label) {
		label = doc.createElement('div');
		content.appendChild(label);
	}
	label.className = [playbar.PlayBarLabel, playbar.AchievementLabel].filter(Boolean).join(' ');
	label.textContent = loc('AppDetails_SectionTitle_Controller', 'CONTROL').toUpperCase();

	let row = content.querySelector<HTMLElement>(':scope > div:last-child');
	if (!row || row === label) {
		row = doc.createElement('div');
		content.appendChild(row);
	}
	row.className = [playbar.ControllerSupportRow, 'gdl-controller-support-row'].filter(Boolean).join(' ');
	row.style.display = 'flex';
	row.style.flexDirection = 'row';
	row.style.alignItems = 'center';
	row.style.gap = '6px';
	row.style.marginTop = '2px';
	row.style.color = '#ffffff';

	let support = supportOverride;
	if (!support) {
		const root = doc.getElementById('gdl-bp-detail-root');
		const steamAppId = root?.dataset.gdlSteamAppId || doc.querySelector<HTMLElement>('[data-gdl-steam-app-id]')?.dataset.gdlSteamAppId;
		if (steamAppId) {
			support = detectGameControllerSupport(steamAppId, doc);
		}
	}

	renderOfficialControllerSvgs(row, doc, support);
	return stat;
}

export function removePlaybarControllerStat(doc: Document): void {
	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();
	const stat = doc.getElementById('gdl-bp-playbar-controller');
	stat?.remove();
}
