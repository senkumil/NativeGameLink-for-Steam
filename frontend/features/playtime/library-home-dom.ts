import { APP_PORTRAIT_CLASS_MODULE } from '../../steam/css';
import {
	closestWithCssModuleClass,
	elementsWithCssModuleClass,
	isRenderedElement,
} from '../../steam/native-dom';
import { loc, steamIntlLocale } from '../../steam/localization';
import { isLibrarySidebarNode } from '../../steam/library-sidebar';

function isHomeCardElement(element: Element): boolean {
	return !isLibrarySidebarNode(element) && !element.closest('[popover="manual"]');
}

export interface DesktopPlaytimeDomSnapshot {
	shortcutAppId: number;
	title: string;
	minutesForever: number;
	minutesRecent: number;
	lastPlayedAt?: number;
}

/** Cheap observer gate: only scan the full document when Steam mounted or
 * rewrote a Library Home playtime leaf. This keeps unrelated activity-feed and
 * navigation mutations from triggering repeated card walks. */
export function mutationMayContainDesktopPlaytime(roots: Iterable<Node>): boolean {
	const classes = APP_PORTRAIT_CLASS_MODULE().classes;
	for (const root of roots) {
		const element = root.nodeType === Node.ELEMENT_NODE
			? root as Element
			: root.parentElement;
		if (!element || !isHomeCardElement(element)) continue;
		if (elementsWithCssModuleClass(element, classes.PlayedRecent).some(isHomeCardElement)
			|| elementsWithCssModuleClass(element, classes.PlayedTotal).some(isHomeCardElement)) return true;
	}
	return false;
}

function normalizedIdentityText(value: unknown): string {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/gi, ' ')
		.trim()
		.toLocaleLowerCase();
}

function shortcutIdTokens(shortcutAppId: number): string[] {
	const unsigned = Number(shortcutAppId) >>> 0;
	return Array.from(new Set([String(unsigned), String(unsigned | 0)]));
}

function valueContainsIdentity(value: string, snapshot: DesktopPlaytimeDomSnapshot): boolean {
	const normalizedValue = normalizedIdentityText(value);
	const normalizedTitle = normalizedIdentityText(snapshot.title);
	if (normalizedTitle.length >= 4 && normalizedValue.includes(normalizedTitle)) return true;
	return shortcutIdTokens(snapshot.shortcutAppId).some(id =>
		new RegExp(`(^|[^0-9])${id.replace('-', '\\-')}([^0-9]|$)`).test(value));
}

/** Steam does not expose a stable public selector for a Library Home portrait.
 * Match only within the native card and its nearby focus wrapper, using the
 * shortcut AppID, asset URL or accessible title. */
function cardMatchesShortcut(card: HTMLElement, snapshot: DesktopPlaytimeDomSnapshot): boolean {
	let scope: HTMLElement | null = card;
	for (let depth = 0; scope && depth < 2; depth++, scope = scope.parentElement) {
		for (const name of ['data-appid', 'data-app-id', 'data-gameid', 'href', 'aria-label', 'title', 'style']) {
			const value = scope.getAttribute(name);
			if (value && valueContainsIdentity(value, snapshot)) return true;
		}
		for (const id of String(scope.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
			const label = card.ownerDocument.getElementById(id);
			if (label && valueContainsIdentity(label.textContent || '', snapshot)) return true;
		}
		if (valueContainsIdentity(scope.textContent || '', snapshot)) return true;
		for (const child of Array.from(scope.querySelectorAll<HTMLElement>(
			'[data-appid],[data-app-id],[data-gameid],[href],[src],[aria-label],[title],[style]',
		))) {
			for (const name of ['data-appid', 'data-app-id', 'data-gameid', 'href', 'src', 'aria-label', 'title', 'style']) {
				const value = child.getAttribute(name);
				if (value && valueContainsIdentity(value, snapshot)) return true;
			}
		}
	}
	return false;
}

function localizedDecimal(value: number): string {
	try {
		return new Intl.NumberFormat(steamIntlLocale(), { maximumFractionDigits: 1 }).format(value);
	} catch {
		return String(value).replace(/\.0$/, '');
	}
}

function formatNativePlaytimeLine(kind: 'Recent' | 'Total', minutes: number): string {
	const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
	const isHours = safeMinutes >= 60;
	const amount = isHours
		? localizedDecimal(Math.round((safeMinutes / 60) * 10) / 10)
		: localizedDecimal(safeMinutes);
	const token = `AppBox_${kind}PlayTime_${isHours ? 'Hours' : 'Minutes'}`;
	const fallback = kind === 'Recent'
		? `Last two weeks: %1$s ${isHours ? 'h' : 'min'}`
		: `Total: %1$s ${isHours ? 'h' : 'min'}`;
	return loc(token, fallback)
		.replace(/%1\$s|%s|\{count\}/g, amount);
}

function candidateCard(value: HTMLElement, cardClass: string): HTMLElement | null {
	const exact = closestWithCssModuleClass(value, cardClass);
	if (exact) return exact;
	let current = value.parentElement;
	for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
		if (current.querySelectorAll('[class]').length > 2) return current;
	}
	return null;
}

/** Synchronize only the two text leaves of already-mounted native cards. A
 * global React rerender is deliberately avoided: Steam may be reconciling the
 * same container and external rerenders can produce removeChild failures. */
export function patchDesktopLibraryHomePlaytimeCards(
	doc: Document,
	snapshots: readonly DesktopPlaytimeDomSnapshot[],
): void {
	if (!doc.body || snapshots.length === 0) return;
	const classes = APP_PORTRAIT_CLASS_MODULE().classes;
	const recentValues = elementsWithCssModuleClass(doc, classes.PlayedRecent)
		.filter(value => isHomeCardElement(value) && isRenderedElement(doc, value));
	for (const recentValue of recentValues) {
		const card = candidateCard(recentValue, classes.LibraryItemBox);
		if (!card || !isHomeCardElement(card) || card.closest('[id^="gdl-"]')) continue;
		const snapshot = snapshots.find(candidate =>
			candidate.minutesForever > 0 && cardMatchesShortcut(card, candidate));
		if (!snapshot) continue;
		// Steam applies PlaytimeDetails to the container and to each individual
		// line. Searching from the recent line therefore cannot see its Total
		// sibling; keep the lookup bounded to the already-identified card.
		const totalValue = elementsWithCssModuleClass(card, classes.PlayedTotal)[0] || null;
		const recentText = formatNativePlaytimeLine('Recent', snapshot.minutesRecent);
		const totalText = formatNativePlaytimeLine('Total', snapshot.minutesForever);
		if (recentValue.textContent !== recentText) recentValue.textContent = recentText;
		if (totalValue && totalValue.textContent !== totalText) totalValue.textContent = totalText;
	}
}
