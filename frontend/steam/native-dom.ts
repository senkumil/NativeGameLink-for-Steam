import { ACH_CLASSES, LINKS_BAR_CLASSES, PLAYBAR_CLASSES } from './css';
import { gdlText, loc, steamLanguageSync } from './localization';

export const NATIVE_UI_BLUEPRINT_KEYS = {
	playbarAchievements: 'playbar-achievements',
	playbarLastPlayed: 'playbar-last-played',
	playbarPlaytime: 'playbar-playtime',
	cloudStatus: 'cloud-status',
	infoButton: 'info-button',
	primaryLinks: 'primary-links',
} as const;

export type NativeUiBlueprintKey = typeof NATIVE_UI_BLUEPRINT_KEYS[keyof typeof NATIVE_UI_BLUEPRINT_KEYS];

/** Session-scoped only. Persisting private Steam DOM across client updates is unsafe. */
const nativeUiBlueprints = new Map<string, string>();
const nativeUiBlueprintTypography = new Map<string, NativePlaybarTypography>();
const nativePlaybarPairLanguages = new Set<string>();

type NativeTypographyValues = Record<string, string>;
interface NativePlaybarTypography {
	label?: NativeTypographyValues;
	detail?: NativeTypographyValues;
}

const NATIVE_TYPOGRAPHY_PROPERTIES = [
	'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
	'letter-spacing', 'text-transform', 'color', 'opacity',
] as const;

function blueprintKey(key: NativeUiBlueprintKey): string {
	return `${steamLanguageSync() || 'english'}:${key}`;
}

function hasNativeUiBlueprint(key: NativeUiBlueprintKey): boolean {
	return nativeUiBlueprints.has(blueprintKey(key));
}

export function clearNativeUiBlueprints(): void {
	nativeUiBlueprints.clear();
	nativeUiBlueprintTypography.clear();
	nativePlaybarPairLanguages.clear();
}

function computedTypography(element: HTMLElement): NativeTypographyValues | undefined {
	const view = element.ownerDocument.defaultView;
	if (!view) return undefined;
	try {
		const computed = view.getComputedStyle(element);
		const values: NativeTypographyValues = {};
		for (const property of NATIVE_TYPOGRAPHY_PROPERTIES) {
			const value = computed.getPropertyValue(property).trim();
			if (value) values[property] = value;
		}
		return Object.keys(values).length > 0 ? values : undefined;
	} catch {
		return undefined;
	}
}

function captureNativePlaybarTypography(element: HTMLElement): NativePlaybarTypography | undefined {
	const ps = PLAYBAR_CLASSES();
	const label = elementsWithCssModuleClass(element, ps.PlayBarLabel)[0];
	const detail = elementsWithCssModuleClass(element, ps.PlayBarDetailLabel)[0];
	const profile = {
		label: label ? computedTypography(label) : undefined,
		detail: detail ? computedTypography(detail) : undefined,
	};
	return profile.label || profile.detail ? profile : undefined;
}

function applyTypographyValues(element: HTMLElement, values?: NativeTypographyValues): void {
	if (!values) return;
	for (const [property, value] of Object.entries(values)) {
		element.style.setProperty(property, value, 'important');
	}
}

/** Apply the current Steam client's own computed play-bar typography. Exact
 * per-control profiles win; session/playtime is the semantic fallback for a
 * control that Steam has not mounted yet in this session. */
export function applyNativePlaybarTypography(
	root: HTMLElement,
	preferredKey: NativeUiBlueprintKey,
): void {
	const ps = PLAYBAR_CLASSES();
	const profile = nativeUiBlueprintTypography.get(blueprintKey(preferredKey))
		|| nativeUiBlueprintTypography.get(blueprintKey(NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime))
		|| nativeUiBlueprintTypography.get(blueprintKey(NATIVE_UI_BLUEPRINT_KEYS.playbarLastPlayed));
	if (!profile) return;
	const labels = new Set([
		...elementsWithCssModuleClass(root, ps.PlayBarLabel),
		...elementsWithCssModuleClass(root, ps.LastPlayedLabel),
	]);
	for (const label of labels) {
		applyTypographyValues(label, profile.label);
	}
	const details = new Set([
		...elementsWithCssModuleClass(root, ps.PlayBarDetailLabel),
		...elementsWithCssModuleClass(root, ps.LastPlayedInfo),
	]);
	for (const detail of details) {
		applyTypographyValues(detail, profile.detail);
	}
}

export function saveNativeUiBlueprint(key: NativeUiBlueprintKey, element: HTMLElement): void {
	const html = element.outerHTML;
	if (!html) return;
	const keyName = blueprintKey(key);
	nativeUiBlueprints.set(keyName, html);
	const typography = captureNativePlaybarTypography(element);
	if (typography) nativeUiBlueprintTypography.set(keyName, typography);
}

export function loadNativeUiBlueprint(doc: Document, key: NativeUiBlueprintKey): HTMLElement | null {
	const html = nativeUiBlueprints.get(blueprintKey(key));
	if (!html) return null;
	try {
		const template = doc.createElement('template');
		template.innerHTML = html.trim();
		const element = template.content.firstElementChild as HTMLElement | null;
		if (element) applyNativePlaybarTypography(element, key);
		return element;
	} catch {
		return null;
	}
}

export function cssModuleTokens(value?: string): string[] {
	return String(value || '').split(/\s+/).filter(Boolean);
}

export function hasCssModuleClass(element: Element | null, value?: string): boolean {
	if (!element) return false;
	const tokens = cssModuleTokens(value);
	return tokens.length > 0 && tokens.every(token => element.classList.contains(token));
}

export function addCssModuleClass(element: Element, value?: string): void {
	for (const token of cssModuleTokens(value)) element.classList.add(token);
}

export function removeCssModuleClass(element: Element, value?: string): void {
	for (const token of cssModuleTokens(value)) element.classList.remove(token);
}

export function elementsWithCssModuleClass(root: Document | Element, value?: string): HTMLElement[] {
	const tokens = cssModuleTokens(value);
	if (tokens.length === 0) return [];
	const result: HTMLElement[] = [];
	if ((root as Element).nodeType === 1 && tokens.every(token => (root as Element).classList.contains(token))) {
		result.push(root as HTMLElement);
	}
	const collection = root.getElementsByClassName(tokens[0]);
	for (const candidate of Array.from(collection)) {
		if (tokens.every(token => candidate.classList.contains(token))) result.push(candidate as HTMLElement);
	}
	return result;
}

export function closestWithCssModuleClass(element: Element | null, value?: string): HTMLElement | null {
	let current = element as HTMLElement | null;
	while (current) {
		if (hasCssModuleClass(current, value)) return current;
		current = current.parentElement;
	}
	return null;
}

export function normalizedUiText(value: string): string {
	return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function isRenderedElement(doc: Document, element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect?.();
	const style = doc.defaultView?.getComputedStyle?.(element);
	return Boolean(rect && rect.width > 0 && rect.height > 0
		&& style?.display !== 'none' && style?.visibility !== 'hidden');
}

export interface CaptureNativeUiBlueprintOptions {
	skip?: () => boolean;
}

/** Locate Steam's own information control semantically. Controller presence
 * changes the number and order of play-bar buttons, so position is never a
 * valid identity signal. */
export function findNativeInfoButton(doc: Document): HTMLElement | null {
	const ps = PLAYBAR_CLASSES();
	const showInfo = normalizedUiText(loc('GameAction_ViewDetails', gdlText('show_game_details', 'Show game details')));
	const hideInfo = normalizedUiText(loc('GameAction_ViewDetails_Collapse', gdlText('hide_game_details', 'Hide game details')));
	for (const buttons of elementsWithCssModuleClass(doc, ps.AppButtonsContainer)) {
		const candidates = Array.from(buttons.querySelectorAll<HTMLElement>('button,[role="button"]'))
			.filter(button => !button.closest('[data-gdl-game-info-button]') && isRenderedElement(doc, button));
		const labeled = candidates.find(button => {
			const text = normalizedUiText(button.getAttribute('aria-label') || button.getAttribute('title') || '');
			return !!text && (text === showInfo || text === hideInfo);
		});
		if (labeled) return labeled;
		// An information SVG is the only safe fallback while Steam temporarily
		// omits the localized accessibility text during a route rebuild.
		const iconMatched = candidates.find(button =>
			Boolean(button.querySelector('.SVGIcon_Information, svg[class*="Information"]')));
		if (iconMatched) return iconMatched;
	}
	return null;
}

/**
 * Learns only small, self-contained controls from the current Steam session.
 * Large structural containers are not persisted across sessions/client builds.
 */
export function captureNativeUiBlueprints(doc: Document, options: CaptureNativeUiBlueprintOptions = {}): void {
	if (!doc.body || options.skip?.()) return;
	const ps = PLAYBAR_CLASSES();
	const language = steamLanguageSync() || 'english';
	const playbarPairReady = nativePlaybarPairLanguages.has(language);
	if (Object.values(NATIVE_UI_BLUEPRINT_KEYS).every(hasNativeUiBlueprint) && playbarPairReady) return;

	if (!hasNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements)) try {
		const nativeAchStat = elementsWithCssModuleClass(doc, ps.GameStatsSection)
			.flatMap(section => elementsWithCssModuleClass(section, ps.GameStat))
			.find(stat => hasCssModuleClass(stat, ps.MiniAchievements)
				&& !stat.closest('[data-gdl-playbar-achievements]') && isRenderedElement(doc, stat));
		if (nativeAchStat) saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements, nativeAchStat);
	} catch {}

	// Capture both native statistics from the same game and same row. Capturing
	// them independently allowed route transitions to mix two Steam layouts;
	// worse, our cloud fallback shares LastPlayed's geometry class and could be
	// mistaken for the session statistic. Labels provide the semantic identity.
	if (!playbarPairReady) try {
		const lastPlayedLabel = normalizedUiText(loc('AppDetails_SectionTitle_LastPlayed', 'Last played'));
		const playtimeLabel = normalizedUiText(loc('AppDetails_SectionTitle_PlayTime', 'Playtime'));
		for (const section of elementsWithCssModuleClass(doc, ps.GameStatsSection)) {
			const nativeStats = elementsWithCssModuleClass(section, ps.GameStat).filter(item =>
				!item.closest('[data-gdl-playtime], [data-gdl-cloud-status], [data-gdl-playbar-achievements]')
				&& !closestWithCssModuleClass(item, ps.PlayBarCloudStatusContainer)
				&& isRenderedElement(doc, item));
			const statLabel = (item: HTMLElement): string => normalizedUiText(
				elementsWithCssModuleClass(item, ps.PlayBarLabel)[0]?.textContent || '');
			const lastPlayed = nativeStats.find(item => hasCssModuleClass(item, ps.LastPlayed)
				&& statLabel(item) === lastPlayedLabel);
			const playtime = nativeStats.find(item => hasCssModuleClass(item, ps.Playtime)
				&& statLabel(item) === playtimeLabel);
			if (!lastPlayed || !playtime) continue;
			saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.playbarLastPlayed, lastPlayed);
			saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime, playtime);
			nativePlaybarPairLanguages.add(language);
			break;
		}
	} catch {}

	if (!hasNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.cloudStatus)) try {
		const nativeCloud = elementsWithCssModuleClass(doc, ps.PlayBarCloudStatusContainer)
			.find(el => !el.closest('[data-gdl-cloud-status]') && isRenderedElement(doc, el));
		if (nativeCloud) saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.cloudStatus, nativeCloud);
	} catch {}

	if (!hasNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.infoButton)) try {
		const nativeInfoButton = findNativeInfoButton(doc);
		if (nativeInfoButton) saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.infoButton, nativeInfoButton);
	} catch {}

	if (!hasNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.primaryLinks)) try {
		const ls = LINKS_BAR_CLASSES();
		const nativeLinksBar = elementsWithCssModuleClass(doc, ls.LinksSection)
			.find(el => !el.closest('#gdl-library-injected') && !el.id?.startsWith('gdl-') && isRenderedElement(doc, el));
		if (nativeLinksBar) saveNativeUiBlueprint(NATIVE_UI_BLUEPRINT_KEYS.primaryLinks, nativeLinksBar);
	} catch {}
}

export function buildNativeAchievementPlaybarBlueprint(
	doc: Document,
	unlocked: number,
	total: number,
	onClick: (event: Event) => void,
): HTMLElement | null {
	const stat = loadNativeUiBlueprint(doc, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
	if (!stat) return null;
	const ps = PLAYBAR_CLASSES();
	const c = ACH_CLASSES();
	if (ps.GameStat && !hasCssModuleClass(stat, ps.GameStat)) return null;
	const pct = total > 0 ? Math.round((100 * unlocked) / total) : 0;
	stat.removeAttribute('id');
	stat.id = 'gdl-playbar-achievements';
	stat.dataset.gdlPlaybarAchievements = '1';
	stat.dataset.gdlNativeBlueprint = '1';
	stat.classList.add('gdl-local-playbar');
	stat.style.cursor = 'pointer';
	stat.title = gdlText('view_linked_achievements', 'View achievements for this linked game');

	const label = elementsWithCssModuleClass(stat, ps.PlayBarLabel)[0];
	if (label) label.textContent = loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements'));
	let count = elementsWithCssModuleClass(stat, ps.AchievementCountLabel)[0] || null;
	if (!count) count = Array.from(stat.querySelectorAll<HTMLElement>('div,span')).find(el => /^\s*\d+\s*\/\s*\d+\s*$/.test(el.textContent || '')) || null;
	if (count) count.textContent = `${unlocked}/${total}`;
	const fill = elementsWithCssModuleClass(stat, ps.DetailsProgressBar)[0]
		|| elementsWithCssModuleClass(stat, c.AchievementProgress)[0] || null;
	if (fill) fill.style.width = `${pct}%`;
	stat.addEventListener('click', onClick);
	return stat;
}

/** Clone Steam's own session/playtime stat, captured from a native game such
 * as Sparking! ZERO, so shortcut fallback stats use identical markup and CSS. */
export function buildNativePlaybarStatBlueprint(
	doc: Document,
	type: 'lastPlayed' | 'playtime',
	labelText: string,
	detailText: string,
): HTMLElement | null {
	const key = type === 'lastPlayed' ? NATIVE_UI_BLUEPRINT_KEYS.playbarLastPlayed : NATIVE_UI_BLUEPRINT_KEYS.playbarPlaytime;
	const stat = loadNativeUiBlueprint(doc, key);
	const ps = PLAYBAR_CLASSES();
	if (!stat || (ps.GameStat && !hasCssModuleClass(stat, ps.GameStat))) return null;
	if (type === 'lastPlayed') {
		// Native Last Played has no leading icon. Reject any stale blueprint that
		// came from Cloud Status instead of ever reproducing a second cloud icon.
		if (!hasCssModuleClass(stat, ps.LastPlayed)
			|| elementsWithCssModuleClass(stat, ps.GameStatIconForced).length > 0
			|| elementsWithCssModuleClass(stat, ps.CloudStatusIcon).length > 0
			|| elementsWithCssModuleClass(stat, ps.CloudIconSVG).length > 0
			|| Boolean(stat.querySelector('.gdl-cloud-icon, .SVGIcon_Cloud'))) return null;
	} else if (!hasCssModuleClass(stat, ps.Playtime)
		|| elementsWithCssModuleClass(stat, ps.GameStatIconForced).length === 0) return null;
	stat.removeAttribute('id');
	for (const attribute of Array.from(stat.attributes)) if (attribute.name.startsWith('data-')) stat.removeAttribute(attribute.name);
	const label = elementsWithCssModuleClass(stat, ps.PlayBarLabel)[0];
	const detail = elementsWithCssModuleClass(stat, ps.PlayBarDetailLabel)[0];
	if (!label || !detail) return null;
	label.textContent = labelText;
	detail.textContent = detailText;
	return stat;
}

export function buildNativeCloudBlueprint(doc: Document): HTMLElement | null {
	const wrapper = loadNativeUiBlueprint(doc, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus);
	if (!wrapper) return null;
	const ps = PLAYBAR_CLASSES();
	if (ps.PlayBarCloudStatusContainer && !hasCssModuleClass(wrapper, ps.PlayBarCloudStatusContainer)) return null;
	wrapper.removeAttribute('id');
	wrapper.dataset.gdlCloudStatus = '1';
	wrapper.dataset.gdlNativeBlueprint = '1';
	wrapper.title = loc('AppDetails_CloudStatus_Tooltip_Synchronized', 'Your Steam Cloud files are synchronized for this app.');
	const label = elementsWithCssModuleClass(wrapper, ps.PlayBarLabel)[0];
	const detail = elementsWithCssModuleClass(wrapper, ps.PlayBarDetailLabel)[0];
	if (label) label.textContent = loc('AppDetails_SectionTitle_CloudStatus', 'Cloud status');
	if (detail) detail.textContent = loc('AppDetails_CloudStatus_Synchronized', 'Up to date');
	return wrapper;
}

export function buildNativeInfoButtonBlueprint(doc: Document): HTMLElement | null {
	const button = loadNativeUiBlueprint(doc, NATIVE_UI_BLUEPRINT_KEYS.infoButton);
	if (!button) return null;
	const ps = PLAYBAR_CLASSES();
	if (ps.MenuButton && !hasCssModuleClass(button, ps.MenuButton)) return null;
	button.removeAttribute('id');
	button.removeAttribute('onclick');
	button.dataset.gdlGameInfoButton = '1';
	button.dataset.gdlNativeBlueprint = '1';
	removeCssModuleClass(button, ps.MenuActive);
	return button;
}
