import { PLAYBAR_CLASSES } from './css';
import { elementsWithCssModuleClass } from './native-dom';

/** Steam's responsive CSS owns stat visibility. Retire only the legacy inline
 * override on plugin copies, so NarrowRightPanel can conceal Cloud text while
 * retaining its icon, and ordinary playtime text follows its native classes. */
export function preserveLinkedPlaybarVisibility(doc: Document): void {
	const classes = PLAYBAR_CLASSES(doc);
	const sections = elementsWithCssModuleClass(doc, classes.GameStatsSection)
		.filter(section => section.isConnected);
	for (const section of sections) {
		for (const copy of elementsWithCssModuleClass(section, classes.HideWhenNarrow)) {
			if (copy.closest('[data-gdl-cloud-status], [data-gdl-playtime]')
				&& copy.style.getPropertyValue('display') === 'flex' && copy.style.getPropertyPriority('display') === 'important') {
				copy.style.removeProperty('display');
			}
		}
	}
}

/** Also clean any retained legacy copy when the linked route retires. */
export function restoreLinkedPlaybarVisibility(doc: Document): void {
	preserveLinkedPlaybarVisibility(doc);
}
