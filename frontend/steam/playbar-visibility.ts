import { PLAYBAR_CLASSES } from './css';
import { elementsWithCssModuleClass } from './native-dom';

interface OriginalDisplay {
	value: string;
	priority: string;
}

const originalDisplays = new WeakMap<HTMLElement, OriginalDisplay>();
const forcedElementsByDocument = new WeakMap<Document, Set<HTMLElement>>();

function forceFlexDisplay(doc: Document, element: HTMLElement): void {
	if (!originalDisplays.has(element)) {
		originalDisplays.set(element, {
			value: element.style.getPropertyValue('display'),
			priority: element.style.getPropertyPriority('display'),
		});
	}
	let forced = forcedElementsByDocument.get(doc);
	if (!forced) {
		forced = new Set<HTMLElement>();
		forcedElementsByDocument.set(doc, forced);
	}
	forced.add(element);
	// Steam applies display:none!important through NarrowRightPanel. An inline
	// important declaration wins that fixed logical-pixel breakpoint without
	// changing the native component's layout or affecting ordinary Steam games.
	if (element.style.getPropertyValue('display') !== 'flex' || element.style.getPropertyPriority('display') !== 'important') {
		element.style.setProperty('display', 'flex', 'important');
	}
}

/** Keep the linked Cloud and playtime copy visible. Achievement visibility is
 * controlled entirely by Steam's responsive rules and available row space. */
export function preserveLinkedPlaybarVisibility(doc: Document): void {
	const classes = PLAYBAR_CLASSES(doc);
	const sections = elementsWithCssModuleClass(doc, classes.GameStatsSection)
		.filter(section => section.isConnected);
	for (const section of sections) {
		for (const copy of elementsWithCssModuleClass(section, classes.HideWhenNarrow)) {
			if (copy.closest('[data-gdl-cloud-status], [data-gdl-playtime]')) forceFlexDisplay(doc, copy);
		}
	}
}

/** Restore the owned copy's original display when the linked route retires. */
export function restoreLinkedPlaybarVisibility(doc: Document): void {
	const forced = forcedElementsByDocument.get(doc);
	if (!forced) return;
	for (const element of forced) {
		const original = originalDisplays.get(element);
		if (original?.value) element.style.setProperty('display', original.value, original.priority);
		else element.style.removeProperty('display');
		originalDisplays.delete(element);
	}
	forced.clear();
	forcedElementsByDocument.delete(doc);
}
