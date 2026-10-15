import { LIBRARY_SIDEBAR_CLASSES, LIBRARY_SIDEBAR_ENTRY_CLASSES } from './css';

const NAMED_SIDEBAR_SELECTOR = '[class*="gamelistbar_"], [class*="gamelistsection_"], [class*="gamelistentry_"], [class*="gameListRow"], [class*="GameListRow"], [class*="gameListEntry"], [class*="GameListEntry"]';

/** Steam's production DOM uses hashed CSS classes, not source module names. */
export function isLibrarySidebarNode(target: EventTarget | Node | null): boolean {
	const node = target as Node | null;
	const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
	if (!element) return false;
	if (element.closest(NAMED_SIDEBAR_SELECTOR)) return true;
	const rows = LIBRARY_SIDEBAR_ENTRY_CLASSES(element.ownerDocument);
	const sidebar = LIBRARY_SIDEBAR_CLASSES(element.ownerDocument);
	const classes = [rows.Container, rows.GameListEntryContainer, sidebar.Container].filter(Boolean);
	for (let current: Element | null = element; current; current = current.parentElement) {
		if (classes.some(value => value.split(/\s+/).filter(Boolean).every(token => current!.classList.contains(token)))) return true;
	}
	return false;
}

/** Recycling a virtual row or its icon cannot invalidate the selected game's details. */
function isLibrarySidebarRecord(record: MutationRecord): boolean {
	if (isLibrarySidebarNode(record.target) || isLibrarySidebarHoverNode(record.target)) return true;
	// Virtualizers can add/remove rows from an otherwise unclassified scroller.
	// Detached rows still carry their native CSS module identity.
	const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
	const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
	const portalContent = Boolean(target?.closest('[popover="manual"]'));
	return changed.length > 0 && changed.every(node => isLibrarySidebarNode(node) || isLibrarySidebarHoverNode(node, portalContent));
}

/** Steam mounts row hovers in a body-level native popover, outside the list.
 * Inspect only that small portal, never a page subtree or the virtual scroller. */
function isLibrarySidebarHoverNode(target: Node, detachedContent = false): boolean {
	const element = target.nodeType === 1 ? target as Element : target.parentElement;
	const portal = detachedContent ? element : element?.closest('[popover="manual"]');
	if (!portal) return false;
	const pending: Element[] = [portal];
	let remaining = 48;
	while (pending.length && remaining-- > 0) {
		const current = pending.pop()!;
		if (isLibrarySidebarNode(current)) return true;
		for (const child of Array.from(current.children)) {
			if (pending.length >= remaining) return false;
			pending.push(child);
		}
	}
	return false;
}

export function isLibrarySidebarMutation(records: readonly MutationRecord[]): boolean {
	return records.length > 0 && records.every(isLibrarySidebarRecord);
}

/** Steam batches list recycling with details hydration during navigation.
 * Remove list records individually so a mixed batch cannot reactivate them. */
export function withoutLibrarySidebarMutations(records: readonly MutationRecord[]): MutationRecord[] {
	return records.filter(record => !isLibrarySidebarRecord(record));
}
