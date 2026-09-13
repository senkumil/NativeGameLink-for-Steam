import { restoreNativeLibraryStyles } from './layout';
import { ensureCloudStatus } from './cloud-status';
import { ensureNativeGameInfoStyles } from './styles';

// Kept as stable cleanup identifiers for pages injected by earlier plugin
// versions. New linked-game navigations deliberately do not render a loading
// UI: Steam's native shortcut page remains visible until the linked page is
// ready to replace it.
export const LINKED_LOADING_MAIN_ID = 'gdl-skeleton';
export const LINKED_LOADING_SIDEBAR_ID = 'gdl-sidebar-skeleton';

const loadingGenerations = new WeakMap<Document, number>();

/**
 * Retire a loading stage left by an older renderer, but never hide native
 * Steam content or mount skeletons. This avoids a blank intermediate page
 * whenever metadata is fetched or restored from cache.
 */
export function stageLinkedShortcutLoading(doc: Document, _notice: Element, generation: number): void {
	loadingGenerations.set(doc, generation);
	doc.getElementById(LINKED_LOADING_MAIN_ID)?.remove();
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	ensureNativeGameInfoStyles(doc);
	ensureCloudStatus(doc);
}

/** Cancel the no-op stage and restore any old native visibility snapshot. */
export function cancelLinkedShortcutLoading(doc: Document, generation?: number): void {
	const current = loadingGenerations.get(doc);
	if (generation !== undefined && current !== generation) return;
	doc.getElementById(LINKED_LOADING_MAIN_ID)?.remove();
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	restoreNativeLibraryStyles(doc);
	loadingGenerations.delete(doc);
}

/** Final rendering owns its own visibility state. */
export function completeLinkedShortcutLoading(doc: Document, generation?: number): void {
	if (generation !== undefined && loadingGenerations.get(doc) !== generation) return;
	doc.getElementById(LINKED_LOADING_MAIN_ID)?.remove();
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	loadingGenerations.delete(doc);
}
