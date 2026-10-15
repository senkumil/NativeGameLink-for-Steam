import { PLAYBAR_CLASS_MODULE } from './css';
import { closestWithCssModuleClass, elementsWithCssModuleClass, hasNativeUiBlueprint, NATIVE_UI_BLUEPRINT_KEYS } from './native-dom';

interface PendingInfoSpace {
	value: string;
	priority: string;
	baseMargin: number;
}

const pendingInfoSpace = new WeakMap<HTMLElement, PendingInfoSpace>();
const MARGIN_PROPERTY = 'margin-inline-end';

function restoreInfoSpace(stat: HTMLElement): void {
	const original = pendingInfoSpace.get(stat);
	if (!original) return;
	if (original.value) stat.style.setProperty(MARGIN_PROPERTY, original.value, original.priority);
	else stat.style.removeProperty(MARGIN_PROPERTY);
	pendingInfoSpace.delete(stat);
}

function hasInformationControl(doc: Document, buttons: HTMLElement): boolean {
	return Array.from(buttons.querySelectorAll<HTMLElement>('button, [role="button"]'))
		.some(button => {
			if (!button.matches('[data-gdl-game-info-button="1"]')
				&& !button.querySelector('.SVGIcon_Information, svg[class*="Information"]')
				&& !/details|informaci|detalles/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || '')) return false;
			const style = doc.defaultView?.getComputedStyle(button);
			return !button.hidden && style?.display !== 'none';
		});
}

/** Steam wraps excess stats below its clipped first row. Account for our Info
 * control before metadata creates it, so achievements use their final width
 * from the first paint. Only the plugin's own stat receives this reservation. */
export function syncAchievementPlaybarSpace(doc: Document): void {
	const module = PLAYBAR_CLASS_MODULE(doc);
	const classes = module.classes;
	// The native MenuButton is 32px with a 10px trailing margin. The compatibility
	// Info control is 40px and has no native margin when class discovery fails.
	// Info also prefers a captured native button when class discovery falls back.
	const controlWidth = module.native || hasNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.infoButton) ? 42 : 40;
	for (const stat of doc.querySelectorAll<HTMLElement>('[data-gdl-playbar-achievements="1"]')) {
		const playbar = closestWithCssModuleClass(stat, classes.Container);
		const buttons = playbar && elementsWithCssModuleClass(playbar, classes.AppButtonsContainer)[0];
		if (!playbar || !buttons || hasInformationControl(doc, buttons)) {
			restoreInfoSpace(stat);
			continue;
		}
		let original = pendingInfoSpace.get(stat);
		if (!original) {
			const baseMargin = Number.parseFloat(doc.defaultView?.getComputedStyle(stat).marginInlineEnd || '0');
			original = {
				value: stat.style.getPropertyValue(MARGIN_PROPERTY),
				priority: stat.style.getPropertyPriority(MARGIN_PROPERTY),
				baseMargin: Number.isFinite(baseMargin) ? baseMargin : 0,
			};
			pendingInfoSpace.set(stat, original);
		}
		const reservedMargin = `${original.baseMargin + controlWidth}px`;
		if (stat.style.getPropertyValue(MARGIN_PROPERTY) !== reservedMargin
			|| stat.style.getPropertyPriority(MARGIN_PROPERTY) !== 'important') {
			stat.style.setProperty(MARGIN_PROPERTY, reservedMargin, 'important');
		}
	}
}
