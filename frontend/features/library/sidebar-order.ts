import { committedHeaderAppId } from '../../steam/library-details';
import { loc } from '../../steam/localization';
import type { NativeLibraryLayout } from './layout';
import { isCurrentLinkedRenderDestination } from './render-session';

// Steam Desktop's AppDetails composition (installed sp.js, module 43257).
// Recordings and screenshots share the native Media/screenshots section.
export const LINKED_SIDEBAR_ORDER = [
	'historical-info', 'controller', 'mastersubincluded', 'friends', 'additionalcontent',
	'achievements', 'external-achievements', 'notes', 'cards', 'dlc', 'workshop', 'screenshots', 'review',
] as const;
export type LinkedSidebarKind = typeof LINKED_SIDEBAR_ORDER[number];

const injectedKinds: Readonly<Record<string, LinkedSidebarKind>> = {
	'gdl-historical-info-section': 'historical-info', 'gdl-controller-section': 'controller',
	'gdl-friends-section': 'friends', 'gdl-achievements-section': 'achievements',
	'gdl-external-achievements-section': 'external-achievements', 'gdl-trading-cards-section': 'cards',
	'gdl-dlc-section': 'dlc', 'gdl-workshop-section': 'workshop',
};
const foreignSurface = '[role="dialog"], [aria-modal="true"], [role="menu"], #gdl-bp-detail-root';
const kinds = new Set<string>(LINKED_SIDEBAR_ORDER);

export interface LinkedSidebarOwner {
	steamAppId: string;
	shortcutAppId: string | null;
	isCurrent: () => boolean;
	generation?: number | string;
}

export interface LinkedSidebarOrder {
	readonly steamAppId: string;
	readonly shortcutAppId: string;
	readonly column: HTMLElement;
	isCurrent(): boolean;
	publish(node: HTMLElement, kind: LinkedSidebarKind): boolean;
	reconcile(): void;
	dispose(): void;
}

interface SidebarState extends LinkedSidebarOrder {
	readonly document: Document;
	readonly generation: number | string | undefined;
	renew(isCurrent: () => boolean): void;
}
const states = new WeakMap<Document, SidebarState>();

/** Distinguish a retired owner from a standalone mount with no coordinator. */
export function hasLinkedSidebarOrder(doc: Document, layout?: NativeLibraryLayout): boolean {
	const state = states.get(doc);
	return Boolean(state && (!layout || state.column === layout.sidebarColumn));
}

function nativeKind(node: HTMLElement): LinkedSidebarKind | null {
	if (node.id.startsWith('gdl-') || node.closest(foreignSurface)) return null;
	// SeekTarget's committed name is independent of the client's language. Only
	// follow this native direct child's own fiber, never search another section.
	const key = Object.getOwnPropertyNames(node).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
	let fiber = key && (node as any)[key];
	const seen = new Set<any>();
	for (let depth = 0; fiber && depth < 24 && !seen.has(fiber); depth += 1, fiber = fiber.return) {
		seen.add(fiber);
		const name = fiber.memoizedProps?.name;
		if (typeof name === 'string' && kinds.has(name)) return name as LinkedSidebarKind;
		if (fiber.stateNode === node.parentElement) break;
	}
	// Steam can publish a section's DOM before its SeekTarget fiber. Match exact
	// localized headings; an unknown/new section remains intact in native order.
	const heading = Array.from(node.querySelectorAll('h2, [role="heading"]')).find(value => !value.closest(foreignSurface));
	const text = heading?.textContent?.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
	if (!text) return null;
	const labels: Array<[LinkedSidebarKind, string, string]> = [
		['controller', 'Controller', 'Controller'], ['controller', 'Hardware', 'Hardware'],
		['mastersubincluded', 'IncludedWith', 'Included with'], ['friends', 'Friends', 'Friends who play'],
		['additionalcontent', 'AdditionalContent', 'Additional Content'], ['achievements', 'Achievements', 'Achievements'],
		['notes', 'Notes', 'Notes'], ['cards', 'TradingCards', 'Trading Cards'], ['dlc', 'DLC', 'DLC'],
		['workshop', 'Workshop', 'Steam Workshop'], ['screenshots', 'Screenshots', 'Screenshots'],
		['screenshots', 'Media', 'Recordings & Screenshots'], ['review', 'Review', 'My Review'],
	];
	return labels.find(([, token, fallback]) => loc(`AppDetails_SectionTitle_${token}`, fallback)
		.replace(/\s+/g, ' ').trim().toLocaleLowerCase() === text)?.[0] || null;
}

/** Capture the current owner for an asynchronous producer. Replaced leases fail closed. */
export function getLinkedSidebarOrder(
	doc: Document, layout?: NativeLibraryLayout, steamAppId?: string, shortcutAppId?: string | null,
): LinkedSidebarOrder | null {
	const state = states.get(doc);
	return state && (!layout || layout.sidebarColumn === state.column)
		&& (!steamAppId || steamAppId === state.steamAppId)
		&& (shortcutAppId === undefined || shortcutAppId === state.shortcutAppId)
		&& state.isCurrent() ? state : null;
}

/** Keep native children untouched; merge only this shortcut's injected sections. */
export function ensureLinkedSidebarOrder(doc: Document, layout: NativeLibraryLayout, owner: LinkedSidebarOwner): LinkedSidebarOrder | null {
	const column = layout.sidebarColumn;
	const shortcutAppId = owner.shortcutAppId;
	if (!column || !shortcutAppId) return null;
	const view = doc.defaultView;
	let isOwnerCurrent = owner.isCurrent;
	const targetCurrent = (): boolean => {
		try {
			if (!view || view.closed || view.document !== doc || column.ownerDocument !== doc || !column.isConnected
				|| column.closest(foreignSurface) || !isOwnerCurrent()
				|| !isCurrentLinkedRenderDestination(doc, shortcutAppId, owner.steamAppId)) return false;
			for (const native of [column, layout.anchorRegion]) {
				if (!native || native.ownerDocument !== doc || !native.isConnected) return false;
				const committed = committedHeaderAppId(native);
				if (committed !== null && committed !== Number(shortcutAppId)) return false;
			}
			return true;
		} catch { return false; }
	};
	// A stale producer cannot retire the successor's still-current coordinator.
	if (!targetCurrent()) return null;
	const prior = states.get(doc);
	if (prior && prior.column === column && prior.steamAppId === owner.steamAppId && prior.shortcutAppId === shortcutAppId
		&& (owner.generation === undefined || prior.generation === owner.generation) && prior.isCurrent()) {
		prior.renew(owner.isCurrent);
		return prior;
	}
	prior?.dispose();
	let disposed = false;
	let frame = 0;
	let observer: MutationObserver | null = null;
	let pending: HTMLElement | null = null;
	const published = new Map<HTMLElement, LinkedSidebarKind>();
	const state: SidebarState = {
		document: doc, column, steamAppId: owner.steamAppId, shortcutAppId, generation: owner.generation,
		renew: guard => { isOwnerCurrent = guard; },
		isCurrent: () => !disposed && states.get(doc) === state && targetCurrent(),
		publish: (node, kind) => {
			if (!state.isCurrent() || node.ownerDocument !== doc || injectedKinds[node.id] !== kind
				|| (node.parentElement && node.parentElement !== column) || node.closest(foreignSurface)) return false;
			if ((node.dataset.gdlSteamAppId && node.dataset.gdlSteamAppId !== owner.steamAppId)
				|| (node.dataset.gdlShortcutAppId && node.dataset.gdlShortcutAppId !== shortcutAppId)) return false;
			node.dataset.gdlSteamAppId = owner.steamAppId;
			node.dataset.gdlShortcutAppId = shortcutAppId;
			published.set(node, kind);
			pending = node;
			state.reconcile();
			pending = null;
			return node.parentElement === column;
		},
		reconcile: () => {
			if (!state.isCurrent()) { state.dispose(); return; }
			for (const node of Array.from(column.children) as HTMLElement[]) {
				const kind = injectedKinds[node.id];
				if (kind && node.dataset.gdlSteamAppId === owner.steamAppId && node.dataset.gdlShortcutAppId === shortcutAppId) published.set(node, kind);
			}
			for (const node of published.keys()) if (node.parentElement !== column && node !== pending) published.delete(node);
			const owned = Array.from(published).filter(([node]) => node.ownerDocument === doc
				&& (node === pending || node.parentElement === column)
				&& node.dataset.gdlSteamAppId === owner.steamAppId && node.dataset.gdlShortcutAppId === shortcutAppId);
			owned.sort((a, b) => LINKED_SIDEBAR_ORDER.indexOf(a[1]) - LINKED_SIDEBAR_ORDER.indexOf(b[1]));
			const ownedNodes = new Set(owned.map(([node]) => node));
			const native = (Array.from(column.children) as HTMLElement[]).filter(node => !ownedNodes.has(node));
			const desired: HTMLElement[] = [];
			let index = 0;
			for (const node of native) {
				const kind = nativeKind(node);
				while (kind && index < owned.length && LINKED_SIDEBAR_ORDER.indexOf(owned[index][1]) < LINKED_SIDEBAR_ORDER.indexOf(kind)) desired.push(owned[index++][0]);
				desired.push(node);
			}
			while (index < owned.length) desired.push(owned[index++][0]);
			let next: HTMLElement | null = null;
			for (let i = desired.length - 1; i >= 0; i -= 1) {
				const node = desired[i];
				if (ownedNodes.has(node) && (node.parentElement !== column || node.nextElementSibling !== next)) column.insertBefore(node, next);
				next = node;
			}
			// Discard our own records; a stable column produces no second pass.
			observer?.takeRecords();
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			observer?.disconnect();
			if (frame) view?.cancelAnimationFrame(frame);
			frame = 0;
			published.clear();
			view?.removeEventListener('beforeunload', state.dispose);
			if (states.get(doc) === state) states.delete(doc);
		},
	};
	states.set(doc, state);
	if (!state.isCurrent()) { state.dispose(); return null; }
	const MutationObserverCtor = view?.MutationObserver;
	if (MutationObserverCtor) {
		observer = new MutationObserverCtor(records => {
			if (!state.isCurrent()) { state.dispose(); return; }
			if (frame || !records.some(record => {
				const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
				return record.target === column || Boolean(element && !element.closest('[id^="gdl-"], ' + foreignSurface));
			})) return;
			frame = view!.requestAnimationFrame(() => { frame = 0; state.reconcile(); });
		});
		observer.observe(column, { childList: true, characterData: true, subtree: true });
	}
	view?.addEventListener('beforeunload', state.dispose);
	state.reconcile();
	return state;
}

export function publishLinkedSidebarSection(doc: Document, layout: NativeLibraryLayout, node: HTMLElement, kind: LinkedSidebarKind): boolean {
	return getLinkedSidebarOrder(doc, layout)?.publish(node, kind) || false;
}

/** Stop column work without removing or rewriting any of Steam's own sections. */
export function disposeLinkedSidebarOrder(doc: Document): void { states.get(doc)?.dispose(); }
