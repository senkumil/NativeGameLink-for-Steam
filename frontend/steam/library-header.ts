import { findClassModule } from '@steambrew/client';
import { PLAYBAR_CLASSES, type CssClasses } from './css';
import { elementsWithCssModuleClass, hasCssModuleClass } from './native-dom';

// Steam Desktop's current AppDetails/header modules. Keep these fallbacks for
// the early route commit, before its webpack CSS exports become available.
const HEADER_FALLBACK: CssClasses = { Header: '_2gZXhRmKUk68pA28-5ZmGQ', HeaderLoaded: 'tXlLvuTxOVL1w3aVPX4bm' };
const HERO_FALLBACK: CssClasses = {
	TopCapsule: 'NZMJ6g2iVnFsOOp-lDmIP',
	HeaderBackgroundImage: '_1IX7FPSY9Jb82KhBVBSkZa',
	TitleLogo: '_3NBxSLAZLbbbnul8KfDFjw',
	ImgContainer: 'QlR9EFwTdUNm_J5vx54_Z',
};
const DESCRIPTIVE_SURFACES = '[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"], [class*="TopCapsule"], [class*="HeroContainer"], [class*="HeroAndLogo"], [class*="PlayBar"], [class*="playbar"], [class*="PlayButton"], [class*="playButton"], [class*="GameStatsSection"]';
let headerClasses = HEADER_FALLBACK, heroClasses = HERO_FALLBACK, nextResolveAt = 0;

function protectedClassNames(): string[] {
	if (Date.now() >= nextResolveAt) {
		nextResolveAt = Date.now() + 5000;
		try {
			headerClasses = findClassModule((module: CssClasses) => Boolean(module.Header && module.HeaderLoaded && module.ShowPlayBar && module.AppDetailsOverviewPanel)) || HEADER_FALLBACK;
			heroClasses = findClassModule((module: CssClasses) => Boolean(module.TopCapsule && module.HeaderBackgroundImage && module.TitleLogo)) || HERO_FALLBACK;
		} catch {}
	}
	const playbar = PLAYBAR_CLASSES();
	return [HEADER_FALLBACK.Header, ...Object.values(HERO_FALLBACK), headerClasses.Header, heroClasses.TopCapsule, heroClasses.HeaderBackgroundImage, heroClasses.TitleLogo,
		playbar.Container, playbar.GameStatsSection].filter(Boolean);
}

function isOwned(element: Element): boolean {
	return Boolean(element.closest('[id^="gdl-"], [data-gdl-playtime], [data-gdl-cloud-status]'));
}

/** Header/artwork is always owned by Steam, including a partially mounted
 * header whose descriptive CSS names were replaced by webpack hashes. */
export function containsNativeLibraryHeader(element: HTMLElement): boolean {
	if (isOwned(element)) return false;
	for (const css of protectedClassNames()) {
		if (elementsWithCssModuleClass(element, css).some(candidate => !isOwned(candidate))) return true;
	}
	return Boolean((element.matches(DESCRIPTIVE_SURFACES) || element.querySelector(DESCRIPTIVE_SURFACES)));
}

export function isInsideNativeLibraryHeader(element: HTMLElement): boolean {
	const classes = protectedClassNames();
	for (let current: HTMLElement | null = element; current && current !== element.ownerDocument.body; current = current.parentElement) {
		if (!isOwned(current) && (classes.some(css => hasCssModuleClass(current, css)) || current.matches(DESCRIPTIVE_SURFACES))) return true;
	}
	return false;
}

export function findNativeLibraryHeader(doc: Document): HTMLElement | null {
	protectedClassNames();
	for (const css of [headerClasses.Header, HEADER_FALLBACK.Header, heroClasses.TopCapsule, HERO_FALLBACK.TopCapsule]) {
		const header = elementsWithCssModuleClass(doc, css).find(element => !isOwned(element));
		if (header) return header;
	}
	return doc.querySelector<HTMLElement>('[class*="AppDetailsHeader"], [class*="appdetailsheader"], [class*="HeaderContainer"]');
}

/** Artwork readiness reads the same native CSS exports as layout protection. */
export function getNativeLibraryArtworkSelectors(): { header: string; loaded: string; hero: string; logo: string } {
	protectedClassNames();
	const classes = (...values: unknown[]): string => Array.from(new Set(values
		.map(value => String(value || '').split(/\s+/).filter(Boolean))
		.filter(tokens => tokens.length && tokens.every(token => /^[-_a-zA-Z0-9]+$/.test(token)))
		.map(tokens => tokens.map(token => `.${token}`).join('')))).join(',');
	const backgrounds = classes(heroClasses.HeaderBackgroundImage, HERO_FALLBACK.HeaderBackgroundImage).split(',');
	const containers = classes(heroClasses.ImgContainer, HERO_FALLBACK.ImgContainer).split(',');
	return {
		header: `${classes(headerClasses.Header, HEADER_FALLBACK.Header, heroClasses.TopCapsule, HERO_FALLBACK.TopCapsule)},[class*="AppDetailsHeader"],[class*="appdetailsheader"],[class*="HeaderContainer"]`,
		loaded: `${classes(headerClasses.HeaderLoaded, HEADER_FALLBACK.HeaderLoaded)},[class*="HeaderLoaded"]`,
		hero: backgrounds.flatMap(background => containers.map(container => `${background} ${container} img`)).join(','),
		logo: classes(heroClasses.TitleLogo, HERO_FALLBACK.TitleLogo).split(',').map(selector => `img${selector}`).join(','),
	};
}
