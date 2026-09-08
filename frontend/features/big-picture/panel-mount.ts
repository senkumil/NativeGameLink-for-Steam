import { loc } from '../../steam/localization';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { resolveActiveGameContext } from '../../steam/gamepad/GamepadContext';
import { detectGameControllerSupport, type GameControllerSupport } from '../library/controller';
import { mountPlaybarControllerIcons } from './PlaybarControllerIcons';
import { ensureBigPictureDetailStyles } from './details-styles';

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
		'não é um juego steam', 'не из steam', 'steam controla el inicio', 'steam controls the start',
		'se encuentra en estas colecciones', 'in these collections', 'dans ces collections',
	];
	const root = doc.getElementById('gdl-bp-detail-root');
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('div, p, section, [class*="Notice"], [class*="Description"]'))) {
		if (el.closest('#gdl-bp-detail-root, #gdl-bp-cloud-divider, [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) continue;
		const text = (el.textContent || '').trim().toLowerCase();
		if (text && anchors.some(anchor => text.includes(anchor))) {
			const container = (el.closest('[class*="Section"], [class*="Container"], [class*="Panel"]') as HTMLElement) || el;
			if (container.closest('#gdl-bp-detail-root, [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) continue;
			const target = root && container.contains(root) ? el : container;
			target.hidden = true;
			target.style.setProperty('display', 'none', 'important');
			target.dataset.gdlBpHiddenNotice = '1';
			target.setAttribute('aria-hidden', 'true');
		}
	}
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[class*="NonSteamGameNotice"], [class*="GameInfoCollections"], [class*="gameInfoCollections"], [class*="nonSteam"], [class*="nonSteamGameNotice"]'))) {
		if (el.closest('#gdl-bp-detail-root, [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) continue;
		const target = root && el.contains(root) ? (el.firstElementChild as HTMLElement || el) : el;
		if (target !== root) {
			target.hidden = true;
			target.style.setProperty('display', 'none', 'important');
			target.dataset.gdlBpHiddenNotice = '1';
			target.setAttribute('aria-hidden', 'true');
		}
	}
}

export function restoreBigPictureNonSteamNotices(doc: Document): void {
	for (const element of Array.from(doc.querySelectorAll<HTMLElement>('[data-gdl-bp-hidden-notice="1"]'))) {
		element.hidden = false;
		element.style.removeProperty('display');
		delete element.dataset.gdlBpHiddenNotice;
		element.removeAttribute('aria-hidden');
	}
}

export function ensureCloudDivider(doc: Document, strip: HTMLElement): HTMLElement | null {
	const context = resolveActiveGameContext(doc);
	if (context.type !== 'shortcut-linked') {
		doc.getElementById('gdl-bp-cloud-divider')?.remove();
		return null;
	}

	const tabContainer = strip.closest<HTMLElement>(
		'[class*="TabsContainer"], [class*="tabsContainer"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"], [class*="tabsStrip"], [role="tablist"]'
	) || strip;
	const parent = tabContainer.parentElement;
	if (!parent) return null;
	const hasNativeCloud = Boolean(
		Array.from(doc.querySelectorAll<HTMLElement>(
			'[class*="CloudStatus"], [class*="cloudStatus"], [class*="CloudSync"], [class*="cloudSync"]'
		)).find(el => el.id !== 'gdl-bp-cloud-divider' && !el.closest('#gdl-bp-cloud-divider'))
		|| Array.from(doc.querySelectorAll<HTMLElement>('div, span, p')).find(el =>
			el.id !== 'gdl-bp-cloud-divider'
			&& !el.closest('#gdl-bp-cloud-divider')
			&& /steam\s*cloud/i.test(el.textContent || '')
		)
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

export function ensurePlaybarControllerStat(doc: Document, supportOverride?: GameControllerSupport): HTMLElement | null {
	const context = resolveActiveGameContext(doc);
	if (context.type !== 'shortcut-linked') {
		removePlaybarControllerStat(doc);
		return null;
	}

	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();
	ensureBigPictureDetailStyles(doc);

	const playbar = PLAYBAR_CLASSES();
	const statsSection = doc.querySelector<HTMLElement>(
		`[class*="${playbar.GameStatsSection || 'GameStatsSection'}"], [class*="GameStatsSection"], [class*="gameStatsSection"]`
	);
	if (!statsSection) return null;

	const nativeController = Array.from(statsSection.children).find(el =>
		el.id !== 'gdl-bp-playbar-controller'
		&& (el.className.includes('Controller') || /control|controller/i.test(el.textContent || ''))
	);
	if (nativeController) {
		removePlaybarControllerStat(doc);
		return null;
	}

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

	stat.className = [playbar.HideWhenNarrow, playbar.ControllerSupportInfo, 'gdl-controller-stat'].filter(Boolean).join(' ');

	let label = stat.querySelector<HTMLElement>(':scope > div:first-child');
	if (!label) {
		label = doc.createElement('div');
		stat.appendChild(label);
	}
	label.className = [playbar.PlayBarLabel, playbar.AchievementLabel].filter(Boolean).join(' ');
	label.textContent = loc('AppDetails_SectionTitle_Controller', 'CONTROL').toUpperCase();

	let row = stat.querySelector<HTMLElement>(':scope > div:last-child');
	if (!row || row === label) {
		row = doc.createElement('div');
		stat.appendChild(row);
	}
	row.className = [playbar.ControllerSupportRow, 'gdl-controller-support-row'].filter(Boolean).join(' ');

	let support = supportOverride;
	if (!support) {
		const root = doc.getElementById('gdl-bp-detail-root');
		const steamAppId = root?.dataset.gdlSteamAppId || doc.querySelector<HTMLElement>('[data-gdl-steam-app-id]')?.dataset.gdlSteamAppId;
		if (steamAppId) {
			support = detectGameControllerSupport(steamAppId, doc);
		}
	}

	mountPlaybarControllerIcons(row, doc, support);
	return stat;
}

export function removePlaybarControllerStat(doc: Document): void {
	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();
	const stat = doc.getElementById('gdl-bp-playbar-controller');
	stat?.remove();
}
