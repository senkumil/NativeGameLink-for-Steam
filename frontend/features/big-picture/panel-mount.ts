import { loc } from '../../steam/localization';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { resolveActiveGameContext, isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { NativeVisibilityLeases } from './visibility-lease';
import { detectConnectedController, detectGameControllerSupport, type GameControllerSupport } from '../library/controller';
import { disposePlaybarControllerIcons, mountPlaybarControllerIcons } from './PlaybarControllerIcons';
import { ensureBigPictureDetailStyles } from './details-styles';

export type BigPicturePanelTab = 'activity' | 'stuff' | 'community' | 'info';

export interface BigPictureNativeTabs {
	strip: HTMLElement;
	controls: Map<BigPicturePanelTab, HTMLElement>;
}

interface PlaybarControllerMountState {
	steamAppId: string;
	support: GameControllerSupport;
}

const playbarControllerStates = new WeakMap<Document, PlaybarControllerMountState>();
const playbarControllerObservers = new WeakMap<Document, MutationObserver>();
const playbarControllerObserverTargets = new WeakMap<Document, HTMLElement>();
const playbarControllerRepairTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
const playbarControllerIconCleanups = new WeakMap<Document, { container: HTMLElement; cleanup: () => void }>();

interface CloudDividerScrollState {
	strip: HTMLElement;
	divider: HTMLElement;
	initialStripTop: number;
	onScroll: () => void;
}

const cloudDividerScrollStates = new WeakMap<Document, CloudDividerScrollState>();
const MIN_CLOUD_SCROLL_BEFORE_COLLAPSE = 96;

function detailVerticalScrollOffset(doc: Document, strip: HTMLElement): number {
	let offset = Number((doc.scrollingElement as HTMLElement | null)?.scrollTop || 0);
	for (let current = strip.parentElement; current && current !== doc.body; current = current.parentElement) {
		offset = Math.max(offset, Number(current.scrollTop || 0));
	}
	return offset;
}

function isPlaybarStillVisible(doc: Document): boolean {
	const playbar = PLAYBAR_CLASSES();
	const stats = doc.querySelector<HTMLElement>(
		`[class*="${playbar.GameStatsSection || 'GameStatsSection'}"], [class*="GameStatsSection"], [class*="gameStatsSection"]`
	);
	if (!stats || !isRenderedElement(doc, stats)) return false;
	const rect = stats.getBoundingClientRect();
	return rect.bottom > 8 && rect.top < (doc.defaultView?.innerHeight || 1080);
}

function syncCloudDividerScrollVisibility(doc: Document, state: CloudDividerScrollState): void {
	const { strip, divider } = state;
	const offset = detailVerticalScrollOffset(doc, strip);
	const stripTop = strip.getBoundingClientRect().top;
	const upwardTravel = Math.max(0, state.initialStripTop - stripTop);
	const playbarVisible = isPlaybarStillVisible(doc);
	const viewportHeight = doc.defaultView?.innerHeight || 1080;
	const stickyBandTop = Math.max(88, Math.min(144, Math.round(viewportHeight * 0.13)));
	const headerCollapsed = !playbarVisible
		&& offset >= MIN_CLOUD_SCROLL_BEFORE_COLLAPSE
		&& (upwardTravel >= MIN_CLOUD_SCROLL_BEFORE_COLLAPSE || stripTop <= stickyBandTop);

	divider.dataset.gdlCloudScrolled = headerCollapsed ? '1' : '0';
	if (headerCollapsed) {
		divider.hidden = true;
		divider.setAttribute('aria-hidden', 'true');
		divider.style.setProperty('display', 'none', 'important');
	} else {
		divider.hidden = false;
		divider.removeAttribute('aria-hidden');
		divider.style.removeProperty('display');
	}
}

function unbindCloudDividerScroll(doc: Document): void {
	const state = cloudDividerScrollStates.get(doc);
	if (!state) return;
	doc.removeEventListener('scroll', state.onScroll, true);
	doc.defaultView?.removeEventListener('scroll', state.onScroll);
	cloudDividerScrollStates.delete(doc);
}

function bindCloudDividerScroll(doc: Document, strip: HTMLElement, divider: HTMLElement): void {
	const existing = cloudDividerScrollStates.get(doc);
	if (existing?.strip === strip && existing.divider === divider) {
		existing.initialStripTop = Math.max(existing.initialStripTop, strip.getBoundingClientRect().top);
		syncCloudDividerScrollVisibility(doc, existing);
		return;
	}
	unbindCloudDividerScroll(doc);
	const state: CloudDividerScrollState = {
		strip,
		divider,
		initialStripTop: strip.getBoundingClientRect().top,
		onScroll: () => {
			const live = cloudDividerScrollStates.get(doc);
			if (!live || !live.strip.isConnected || !live.divider.isConnected) return;
			syncCloudDividerScrollVisibility(doc, live);
		},
	};
	cloudDividerScrollStates.set(doc, state);
	doc.addEventListener('scroll', state.onScroll, { capture: true, passive: true });
	doc.defaultView?.addEventListener('scroll', state.onScroll, { passive: true });
	syncCloudDividerScrollVisibility(doc, state);
}

function bindPlaybarControllerRepair(doc: Document, statsSection: HTMLElement): void {
	const target = statsSection.parentElement || statsSection;
	if (playbarControllerObservers.has(doc) && playbarControllerObserverTargets.get(doc) === target) return;
	playbarControllerObservers.get(doc)?.disconnect();
	const observer = new MutationObserver(() => {
		const state = playbarControllerStates.get(doc);
		if (!state || !target.isConnected || doc.getElementById('gdl-bp-playbar-controller')) return;
		if (playbarControllerRepairTimers.has(doc)) return;
		const timer = setTimeout(() => {
			playbarControllerRepairTimers.delete(doc);
			const liveState = playbarControllerStates.get(doc);
			if (!liveState || !target.isConnected || doc.getElementById('gdl-bp-playbar-controller')) return;
			ensurePlaybarControllerStat(doc, liveState.support);
		}, 80);
		playbarControllerRepairTimers.set(doc, timer);
	});
	observer.observe(target, { childList: true, subtree: true });
	playbarControllerObservers.set(doc, observer);
	playbarControllerObserverTargets.set(doc, target);
}

function isRenderedElement(doc: Document, element: HTMLElement | null): element is HTMLElement {
	if (!element?.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
	if (element.dataset.gdlBpHiddenNotice === '1') return false;
	const style = doc.defaultView?.getComputedStyle(element);
	if (style?.display === 'none' || style?.visibility === 'hidden') return false;
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

interface PanelChildVisibility {
	panel: HTMLElement;
	owner: HTMLElement;
	hidden: boolean;
	hiddenAttribute: string | null;
	installedHiddenAttribute: string | null;
	display: string;
	displayPriority: string;
	ariaHidden: string | null;
	marker: string | null;
}

const PANEL_SIBLING_MARKER = 'data-gdl-bp-panel-sibling-hidden';
const panelVisibilitySnapshots = new WeakMap<HTMLElement, Map<HTMLElement, PanelChildVisibility>>();
const childVisibilityOwners = new WeakMap<HTMLElement, PanelChildVisibility>();
const ownedPanelsByDocument = new WeakMap<Document, Set<HTMLElement>>();

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

function forgetEmptyPanel(panel: HTMLElement): void {
	if (panelVisibilitySnapshots.get(panel)?.size) return;
	panelVisibilitySnapshots.delete(panel);
	const panels = ownedPanelsByDocument.get(panel.ownerDocument);
	panels?.delete(panel);
	if (panels?.size === 0) ownedPanelsByDocument.delete(panel.ownerDocument);
}

function restorePanelChild(element: HTMLElement, snapshot: PanelChildVisibility): void {
	// Restore each property only while it still contains our installed value.
	// A later Steam update owns any property it has replaced in the meantime.
	if (element.hidden === true && element.getAttribute('hidden') === snapshot.installedHiddenAttribute) {
		element.hidden = snapshot.hidden;
		restoreAttribute(element, 'hidden', snapshot.hiddenAttribute);
	}
	if (element.style.getPropertyValue('display') === 'none' && element.style.getPropertyPriority('display') === 'important') {
		if (snapshot.display) element.style.setProperty('display', snapshot.display, snapshot.displayPriority);
		else element.style.removeProperty('display');
	}
	if (element.getAttribute('aria-hidden') === 'true') restoreAttribute(element, 'aria-hidden', snapshot.ariaHidden);
	if (element.getAttribute(PANEL_SIBLING_MARKER) === '1') restoreAttribute(element, PANEL_SIBLING_MARKER, snapshot.marker);
}

export function restoreNativePanelChildren(panel: HTMLElement | null, owner?: HTMLElement): void {
	if (!panel) return;
	const snapshots = panelVisibilitySnapshots.get(panel);
	if (!snapshots) return;
	for (const [element, snapshot] of snapshots) {
		if (owner && snapshot.owner !== owner) continue;
		restorePanelChild(element, snapshot);
		snapshots.delete(element);
		if (childVisibilityOwners.get(element) === snapshot) childVisibilityOwners.delete(element);
	}
	forgetEmptyPanel(panel);
}

/** Retire only snapshots created by this runtime, including detached panels.
 * An existing marker alone is never evidence that we own a native node. */
export function restoreAllNativePanelChildren(doc: Document): void {
	for (const panel of [...(ownedPanelsByDocument.get(doc) || [])]) restoreNativePanelChildren(panel);
}

export function commitNativePanelRoot(panel: HTMLElement, root: HTMLElement): void {
	let snapshots = panelVisibilitySnapshots.get(panel);
	if (!snapshots) panelVisibilitySnapshots.set(panel, snapshots = new Map());
	let panels = ownedPanelsByDocument.get(panel.ownerDocument);
	if (!panels) ownedPanelsByDocument.set(panel.ownerDocument, panels = new Set());
	panels.add(panel);
	for (const [element, snapshot] of snapshots) {
		if (element.parentElement === panel) continue;
		restorePanelChild(element, snapshot);
		snapshots.delete(element);
		if (childVisibilityOwners.get(element) === snapshot) childVisibilityOwners.delete(element);
	}
	for (const child of Array.from(panel.children)) {
		if (child === root || child.id === 'gdl-bp-detail-root') continue;
		const element = child as HTMLElement;
		let snapshot = childVisibilityOwners.get(element);
		if (snapshot) {
			// A replacement linked root can adopt the same native child. Transfer
			// the original snapshot so an old owner cannot later reveal it.
			if (snapshot.panel !== panel) {
				panelVisibilitySnapshots.get(snapshot.panel)?.delete(element);
				forgetEmptyPanel(snapshot.panel);
				snapshot.panel = panel;
			}
			if (element.hidden !== true || element.getAttribute('hidden') !== snapshot.installedHiddenAttribute) {
				snapshot.hidden = element.hidden;
				snapshot.hiddenAttribute = element.getAttribute('hidden');
			}
			if (element.style.getPropertyValue('display') !== 'none' || element.style.getPropertyPriority('display') !== 'important') {
				snapshot.display = element.style.getPropertyValue('display');
				snapshot.displayPriority = element.style.getPropertyPriority('display');
			}
			if (element.getAttribute('aria-hidden') !== 'true') snapshot.ariaHidden = element.getAttribute('aria-hidden');
			if (element.getAttribute(PANEL_SIBLING_MARKER) !== '1') snapshot.marker = element.getAttribute(PANEL_SIBLING_MARKER);
			snapshot.owner = root;
		} else {
			snapshot = { panel, owner: root, hidden: element.hidden, hiddenAttribute: element.getAttribute('hidden'),
				installedHiddenAttribute: null, display: element.style.getPropertyValue('display'),
				displayPriority: element.style.getPropertyPriority('display'), ariaHidden: element.getAttribute('aria-hidden'),
				marker: element.getAttribute(PANEL_SIBLING_MARKER) };
			childVisibilityOwners.set(element, snapshot);
		}
		snapshots.set(element, snapshot);
		element.hidden = true;
		snapshot.installedHiddenAttribute = element.getAttribute('hidden');
		element.style.setProperty('display', 'none', 'important');
		element.setAttribute('aria-hidden', 'true');
		element.setAttribute(PANEL_SIBLING_MARKER, '1');
	}
	forgetEmptyPanel(panel);
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
	if (root.parentElement && root.parentElement !== panel) restoreNativePanelChildren(root.parentElement);
	if (root.parentElement !== panel) panel.appendChild(root);
	if (panel.firstChild !== root) panel.insertBefore(root, panel.firstChild);
	const fallback = doc.getElementById('gdl-bp-detail-fallback-panel');
	if (nativePanel && fallback && fallback !== panel) fallback.remove();
	return { panel, root };
}

export function removeBigPictureFallbackPanel(doc: Document): void {
	doc.getElementById('gdl-bp-detail-fallback-panel')?.remove();
}

const noticeVisibility = new NativeVisibilityLeases();
const controllerVisibility = new NativeVisibilityLeases();
const FOREIGN_NATIVE_SURFACE = '[role="dialog"], [aria-modal="true"], .ModalDialogPopup, [class*="ModalPosition"], [class*="QuickAccess"], [class*="MainMenu"], [class*="Settings"], [class*="settings"]';
function linkedDetailOwner(doc: Document): HTMLElement | null {
 const root = doc.getElementById('gdl-bp-detail-root');
 return root?.isConnected && !root.closest(FOREIGN_NATIVE_SURFACE) && steamUIModeService.isGamepadUI(doc)
  && isCurrentLinkedGamepadTarget(doc, root.dataset.gdlShortcutAppId, root.dataset.gdlSteamAppId) ? root : null;
}
function ownedNativeElement(doc: Document, root: HTMLElement, scope: HTMLElement, element: HTMLElement): boolean {
 if (element.ownerDocument !== doc || !element.isConnected || !scope.contains(element) || element === root || element.contains(root)
  || element.closest(FOREIGN_NATIVE_SURFACE) || element.querySelector(FOREIGN_NATIVE_SURFACE)
  || element.closest('#gdl-bp-detail-root, [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"], [class*="Grid"]')) return false;
 const identity = element.closest('[data-appid], [data-app-id], [data-app-id-value]');
 const rawId = identity?.getAttribute('data-appid') || identity?.getAttribute('data-app-id') || identity?.getAttribute('data-app-id-value');
 return !rawId || (Number(rawId) >>> 0) === (Number(root.dataset.gdlShortcutAppId) >>> 0);
}

export function hideBigPictureNonSteamNotices(doc: Document): void {
 const root = linkedDetailOwner(doc), scope = root?.parentElement;
 if (!root || !scope || scope === doc.body || scope === doc.documentElement) { noticeVisibility.restore(doc); return; }
 const anchors = ['no es un juego de steam', 'no es un juego o mod', 'no está disponible porque no es un juego',
  'non-steam game', 'nicht von steam', "n'est pas un jeu steam", 'não é um jogo steam', 'не из steam',
  'steam controla el inicio', 'steam controls the start', 'se encuentra en estas colecciones', 'in these collections', 'dans ces collections'];
 const semantic = '[class*="NonSteamGameNotice"], [class*="GameInfoCollections"], [class*="gameInfoCollections"], [class*="nonSteam"], [class*="nonSteamGameNotice"]';
 const candidates = new Set<HTMLElement>();
 const hasNoticeText = (element: Element) => anchors.some(anchor => (element.textContent || '').trim().toLowerCase().includes(anchor));
 for (const element of Array.from(scope.querySelectorAll<HTMLElement>(semantic))) if (ownedNativeElement(doc, root, scope, element)) candidates.add(element);
 const textSelector = 'div, p, section, [class*="Notice"], [class*="Description"]';
 for (const element of Array.from(scope.querySelectorAll<HTMLElement>(textSelector))) {
  if (!ownedNativeElement(doc, root, scope, element) || !hasNoticeText(element)) continue;
  if (Array.from(element.children).some(child => child.matches(textSelector) && hasNoticeText(child))) continue;
  const target = element.closest<HTMLElement>(semantic) || element;
  if (ownedNativeElement(doc, root, scope, target)) candidates.add(target);
 }
 noticeVisibility.retain(doc, root, candidates);
 for (const element of candidates) noticeVisibility.hide(element, root, { 'data-gdl-bp-hidden-notice': '1' });
}

export function restoreBigPictureNonSteamNotices(doc: Document): void { noticeVisibility.restore(doc); }

export function ensureCloudDivider(doc: Document, strip: HTMLElement): HTMLElement | null {
	const context = resolveActiveGameContext(doc);
	const linkedDetailRoot = doc.getElementById('gdl-bp-detail-root')?.dataset.gdlSteamAppId;
	// Steam can briefly expose an incomplete route/context while GamepadUI is
	// replacing the active details tree. Do not tear down a valid linked-game
	// cloud row during that transition; true detail teardown removes it.
	if (context.type !== 'shortcut-linked' && !linkedDetailRoot) {
		unbindCloudDividerScroll(doc);
		doc.getElementById('gdl-bp-cloud-divider')?.remove();
		return null;
	}

	const tabContainer = strip.closest<HTMLElement>(
		'[class*="TabsContainer"], [class*="tabsContainer"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"], [class*="tabsStrip"], [role="tablist"]'
	) || strip;
	const parent = tabContainer.parentElement;
	if (!parent) return null;
	const cloudScope = parent.parentElement || parent;
	const cloudHost = cloudScope;
	const cloudAnchor = cloudHost === parent ? tabContainer : parent;
	const stripRect = strip.getBoundingClientRect();
	const hasNativeCloud = Array.from(cloudScope.querySelectorAll<HTMLElement>(
		'[class*="CloudStatus"], [class*="cloudStatus"], [class*="CloudSync"], [class*="cloudSync"]'
	)).some(element => {
		if (element.id === 'gdl-bp-cloud-divider' || element.closest('#gdl-bp-cloud-divider')) return false;
		if (!isRenderedElement(doc, element)) return false;
		const rect = element.getBoundingClientRect();
		return rect.bottom >= stripRect.top - 180 && rect.top <= stripRect.bottom + 80;
	});
	if (hasNativeCloud) {
		unbindCloudDividerScroll(doc);
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
		divider.dataset.gdlCloudOutsideTabs = cloudHost === parent ? '0' : '1';
		cloudHost.insertBefore(divider, cloudAnchor);
	} else {
		divider.dataset.gdlCloudOutsideTabs = cloudHost === parent ? '0' : '1';
		if (divider.parentElement !== cloudHost || divider.nextElementSibling !== cloudAnchor) {
			cloudHost.insertBefore(divider, cloudAnchor);
		}
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
	bindCloudDividerScroll(doc, strip, divider);
	return divider;
}

export function removeCloudDivider(doc: Document): void {
	unbindCloudDividerScroll(doc);
	doc.getElementById('gdl-bp-cloud-divider')?.remove();
}

export function ensurePlaybarControllerStat(doc: Document, supportOverride?: GameControllerSupport): HTMLElement | null {
	const owner = linkedDetailOwner(doc);
	if (!owner) { removePlaybarControllerStat(doc, true); return null; }
	const controllerInfo = detectConnectedController(doc);
	if (!controllerInfo.connected) {
		removePlaybarControllerStat(doc);
		return null;
	}
	const playbar = PLAYBAR_CLASSES();
	const statsSelector = `[class*="${playbar.GameStatsSection || 'GameStatsSection'}"], [class*="GameStatsSection"], [class*="gameStatsSection"]`;
 let statsSection: HTMLElement | null = null;
 for (let scope = owner.parentElement, depth = 0; scope && scope !== doc.body && scope !== doc.documentElement && depth < 8; scope = scope.parentElement, depth++) {
  statsSection = Array.from(scope.querySelectorAll<HTMLElement>(statsSelector)).find(element => ownedNativeElement(doc, owner, scope!, element)) || null;
  if (statsSection) break;
 }
	const previousState = playbarControllerStates.get(doc);
	const explicitSteamAppId = String(owner.dataset.gdlSteamAppId || '');
	if (!statsSection) { removePlaybarControllerStat(doc, true); return null; }

	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();
	ensureBigPictureDetailStyles(doc);

	const nativeControllerClass = playbar.ControllerSupportInfo || '';
 const nativeRows = new Set<HTMLElement>();
 for (const child of Array.from(statsSection.children)) {
  const element = child as HTMLElement;
  if (element.id !== 'gdl-bp-playbar-controller' && nativeControllerClass && element.classList.contains(nativeControllerClass)
   && ownedNativeElement(doc, owner, statsSection, element)) nativeRows.add(element);
 }
 controllerVisibility.retain(doc, owner, nativeRows);
 for (const element of nativeRows) controllerVisibility.hide(element, owner, {
  'data-gdl-bp-native-controller-hidden': '1',
  'data-gdl-bp-native-controller-display': element.getAttribute('data-gdl-bp-native-controller-display') || element.style.getPropertyValue('display'),
 });

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
	if (!support) support = previousState?.support || { xbox: false, ps4: false, ps5: false };
	playbarControllerStates.set(doc, { steamAppId: explicitSteamAppId, support });
	stat.dataset.gdlSteamAppId = explicitSteamAppId;
	bindPlaybarControllerRepair(doc, statsSection);

	const previousIcons = playbarControllerIconCleanups.get(doc);
	if (previousIcons && previousIcons.container !== row) previousIcons.cleanup();
	playbarControllerIconCleanups.set(doc, { container: row, cleanup: mountPlaybarControllerIcons(row, doc, support) });
	return stat;
}

export function removePlaybarControllerStat(doc: Document, restoreNative = true): void {
	playbarControllerIconCleanups.get(doc)?.cleanup();
	playbarControllerIconCleanups.delete(doc);
	disposePlaybarControllerIcons(doc);
	playbarControllerObservers.get(doc)?.disconnect();
	playbarControllerObservers.delete(doc);
	playbarControllerObserverTargets.delete(doc);
	const repairTimer = playbarControllerRepairTimers.get(doc);
	if (repairTimer) clearTimeout(repairTimer);
	playbarControllerRepairTimers.delete(doc);
	playbarControllerStates.delete(doc);
	doc.getElementById('gdl-bp-playbar-controller-styles')?.remove();
	const stat = doc.getElementById('gdl-bp-playbar-controller');
	stat?.remove();
	if (restoreNative) {
		restoreNativePlaybarController(doc);
	}
}

export function restoreNativePlaybarController(doc: Document): void { controllerVisibility.restore(doc); }
