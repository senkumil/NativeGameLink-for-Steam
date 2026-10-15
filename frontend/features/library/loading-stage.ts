import { restoreNativeLibraryStyles } from './layout';
import { ensureCloudStatus } from './cloud-status';
import { ensureNativeGameInfoStyles } from './styles';
import { clearLinkedFirstContent, paintLinkedFirstContent, stageLinkedFirstContent, type LinkedLoadingContext } from './first-content';
export { warmVisibleLinkedResources, cancelLinkedFirstContentPaint, syncEarlyLinkedFirstContent } from './first-content';

// Stable IDs keep old and current partial renders in the same cleanup path.
export const LINKED_LOADING_MAIN_ID = 'gdl-skeleton';
export const LINKED_LOADING_SIDEBAR_ID = 'gdl-sidebar-skeleton';

const loadingGenerations = new WeakMap<Document, number>();

/**
 * Show cached content or a neutral loading card in the committed columns.
 * This also adopts the lightweight content mounted before artwork readiness.
 */
export function stageLinkedShortcutLoading(doc: Document, notice: Element, generation: number, context?: LinkedLoadingContext): Promise<void> | void {
	loadingGenerations.set(doc, generation);
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	ensureNativeGameInfoStyles(doc);
	ensureCloudStatus(doc);
	if (context) { stageLinkedFirstContent(doc, notice, generation, context); return paintLinkedFirstContent(doc, generation); }
}

/** Cancel partial content and restore any old native visibility snapshot. */
export function cancelLinkedShortcutLoading(doc: Document, generation?: number): void {
	const current = loadingGenerations.get(doc);
	if (generation !== undefined && current !== generation) return;
	clearLinkedFirstContent(doc);
	doc.getElementById(LINKED_LOADING_MAIN_ID)?.remove();
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	restoreNativeLibraryStyles(doc);
	loadingGenerations.delete(doc);
}

/** Final rendering owns its own visibility state. */
export function completeLinkedShortcutLoading(doc: Document, generation?: number): void {
	if (generation !== undefined && loadingGenerations.get(doc) !== generation) return;
	clearLinkedFirstContent(doc);
	doc.getElementById(LINKED_LOADING_MAIN_ID)?.remove();
	doc.getElementById(LINKED_LOADING_SIDEBAR_ID)?.remove();
	loadingGenerations.delete(doc);
}
