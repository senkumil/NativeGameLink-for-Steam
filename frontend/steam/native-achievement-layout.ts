import { resolveSteamClassModule } from './class-module-cache';
import { LIBRARY_SIDEBAR_CLASSES } from './css';
import { steamUIModeService } from './ui/SteamUIModeService';

const STYLE_ID = 'ngl-native-achievement-layout-style';
const DESKTOP_ATTRIBUTE = 'data-ngl-native-achievement-layout';
const COMPLETED_ACHIEVEMENT_CLASSES = {
	AllAchieved: '_2YS0EBJmY2Rvs07zZ90UIJ',
	HighlightDiv: '_2xTb6N-jUUQ-mIkMB6OVMm',
};
const installed = new WeakMap<Document, () => void>();
const AUXILIARY_WINDOW = /shared\s*js\s*context|popup|menu|tooltip|login|overlay|SP BPM|big\s*picture|gamepad/i;

function isDesktopLibraryDocument(doc: Document): boolean {
	const view = doc.defaultView;
	if (!view || view.closed || view.document !== doc || !doc.body) return false;
	if (AUXILIARY_WINDOW.test(view.name || '')) return false;
	const sidebar = LIBRARY_SIDEBAR_CLASSES(doc).Container;
	const sidebarSelector = sidebar.split(/\s+/).filter(Boolean).map(token => '.' + view.CSS.escape(token)).join('');
	const selector = '[class*="libraryroot" i], [class*="libraryhome" i], [class*="appdetailsview" i], '
		+ '[class*="steamdesktop" i], [class*="supernav" i]' + (sidebarSelector ? ', ' + sidebarSelector : '');
	return Array.from(doc.querySelectorAll(selector)).some(root => !root.closest('[id^="gdl-"]'));
}

function nativeRibbonReservation(doc: Document, completedSelector: string): number {
	let reservation = 46;
	const inspect = (rules: CSSRuleList): void => {
		for (const rule of Array.from(rules)) {
			const styled = rule as CSSStyleRule;
			if (styled.selectorText?.trim() === completedSelector) {
				const value = styled.style.getPropertyValue('padding-inline-start').trim();
				if (/^\d+(?:\.\d+)?px$/.test(value)) reservation = Math.max(reservation, Number.parseFloat(value));
			}
			const group = rule as CSSGroupingRule;
			if (group.cssRules) inspect(group.cssRules);
		}
	};
	for (const sheet of Array.from(doc.styleSheets)) {
		const owner = sheet.ownerNode as HTMLElement | null;
		if (sheet.disabled || owner?.id?.startsWith('gdl-') || owner?.id?.startsWith('ngl-')) continue;
		try { inspect(sheet.cssRules); } catch {}
	}
	return reservation;
}

/** Steam's later Highlight padding overrides the 46px reservation made by its
 * AllAchieved rule. Restore that reservation only for completed native Desktop
 * cards. This stylesheet is session-owned and never changes Steam's files. */
export function installNativeAchievementLayout(doc: Document): () => void {
	const previous = installed.get(doc);
	if (previous) return previous;
	const view = doc.defaultView;
	// Millennium can create SP Desktop before React mounts the library or even
	// before its body exists. A missing library root is pending validation, not
	// proof this is an auxiliary document. No stylesheet is installed until sync
	// positively identifies native Desktop chrome.
	if (!view || view.closed || view.document !== doc || !doc.documentElement
		|| AUXILIARY_WINDOW.test(view.name || '')) return () => {};
	const originalAttribute = doc.documentElement.getAttribute(DESKTOP_ATTRIBUTE);
	let style: HTMLStyleElement | null = null;
	let disposed = false;
	let observedBody: HTMLElement | null = null;
	const timers = new Set<number>();
	const observeSurface = (): void => {
		if (observedBody === doc.body) return;
		observedBody = doc.body;
		observer.disconnect();
		// Observe only the surface classes and a direct body replacement. Steam's
		// achievement rows are never observed, so a notification burst cannot
		// trigger repeated scans or a stylesheet feedback loop.
		observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'], childList: true });
		if (observedBody) observer.observe(observedBody, { attributes: true, attributeFilter: ['class'] });
	};
	const sync = (): boolean => {
		if (disposed) return false;
		observeSurface();
		if (!isDesktopLibraryDocument(doc)
			|| steamUIModeService.isGamepadUI(doc)
			|| doc.documentElement.classList.contains('BasicUI') || doc.body?.classList.contains('BasicUI')) {
			style?.remove(); style = null;
			doc.documentElement.removeAttribute(DESKTOP_ATTRIBUTE);
			return false;
		}
		const resolved = resolveSteamClassModule(
			module => typeof module.AllAchieved === 'string' && !!module.AllAchieved.trim()
				&& typeof module.HighlightDiv === 'string' && !!module.HighlightDiv.trim(),
			COMPLETED_ACHIEVEMENT_CLASSES,
			doc,
		);
		const classSelector = (value: string): string => value.split(/\s+/).filter(Boolean)
			.map(token => '.' + view.CSS.escape(token)).join('');
		const completed = classSelector(resolved.classes.AllAchieved);
		const card = completed + classSelector(resolved.classes.HighlightDiv);
		// Retain a larger reservation supplied by Steam or a theme. The known
		// 46px reservation is only a fallback when a stylesheet is unreadable.
		const reservation = nativeRibbonReservation(doc, completed);
		const css = `html[${DESKTOP_ATTRIBUTE}="desktop"] ${card}`
			+ ':not([id^="gdl-"]):not([id^="gdl-"] *)'
			+ ':not(.BasicUI):not(.BasicUI *):not(.GamepadUI):not(.GamepadUI *):not(.gamepadui):not(.gamepadui *)'
			+ `{padding-inline-start:${reservation}px;}`;
		if (!style) {
			style = doc.createElement('style'); style.id = STYLE_ID;
			(doc.head || doc.documentElement).appendChild(style);
		}
		if (style.textContent !== css) style.textContent = css;
		if (doc.documentElement.getAttribute(DESKTOP_ATTRIBUTE) !== 'desktop') {
			doc.documentElement.setAttribute(DESKTOP_ATTRIBUTE, 'desktop');
		}
		return resolved.native;
	};
	const observer = new view.MutationObserver(() => { sync(); });
	observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'], childList: true });
	const unsubscribe = steamUIModeService.subscribe(() => { sync(); });
	const onReady = (): void => { sync(); };
	doc.addEventListener('DOMContentLoaded', onReady, { once: true });
	// Native exports can resolve before React or Steam's stylesheets. Keep all
	// three bounded startup checks even then; class resolution alone must not
	// cancel DOM validation or detection of a later, larger ribbon reservation.
	for (const delay of [1000, 2000, 4000]) {
		const timer = view.setTimeout(() => { timers.delete(timer); sync(); }, delay);
		timers.add(timer);
	}
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		observer.disconnect(); unsubscribe();
		doc.removeEventListener('DOMContentLoaded', onReady);
		for (const timer of timers) view.clearTimeout(timer);
		timers.clear(); style?.remove(); style = null;
		if (originalAttribute === null) doc.documentElement.removeAttribute(DESKTOP_ATTRIBUTE);
		else doc.documentElement.setAttribute(DESKTOP_ATTRIBUTE, originalAttribute);
		installed.delete(doc);
	};
	installed.set(doc, dispose);
	return dispose;
}
