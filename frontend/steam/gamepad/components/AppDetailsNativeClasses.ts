import type { ComponentType } from 'react';
import { backendLog } from '../../../api/backend';
import { steamWebpackRuntime, type WebpackModuleEntry } from '../../modules/SteamWebpackRuntime';

export type NativeClassModule = Readonly<Record<string, string>>;

export interface NativeAppDetailsClasses {
	Section: NativeClassModule | null;
	SectionHeader: NativeClassModule | null;
	Activity: NativeClassModule | null;
	ActivityEvent: NativeClassModule | null;
	Achievement: NativeClassModule | null;
	Community: NativeClassModule | null;
	TradingCard: NativeClassModule | null;
	GameInfo: NativeClassModule | null;
	GameInfoFrame: NativeClassModule | null;
	Friends: NativeClassModule | null;
	Media: NativeClassModule | null;
	Feature: NativeClassModule | null;
	Links: NativeClassModule | null;
	Review: NativeClassModule | null;
	Notes: NativeClassModule | null;
	QuickLinks: NativeClassModule | null;
	FocusRing: NativeClassModule | null;
	PostTextEntry: NativeClassModule | null;
}

type NativeClassFamily = keyof NativeAppDetailsClasses;

const signatures: Record<NativeClassFamily, readonly string[]> = {
	Section: ['AppDetailsSection', 'AppDetailsSectionContainer', 'RightColumnSection', 'Body', 'Highlight'],
	SectionHeader: ['SectionHeader', 'PadLeft', 'Label', 'LabelText'],
	Activity: ['ActivityFeedContainer', 'InnerContainer', 'NoActivity', 'EndofFeed', 'EndRule'],
	ActivityEvent: ['Event', 'PartnerEvent', 'PartnerEventMediumImage_Container', 'PartnerEventTextOnly_Container', 'PartnerEventType'],
	Achievement: ['AchievementCarouselItem', 'CarouselIcon', 'AchivementCarouselItemDetails', 'BasicAppDetailsAchievementsSectionBody'],
	Community: ['CommunityContentContainer', 'AppOverviewRow', 'CommunityItem', 'PreviewContainer', 'ChildItem'],
	TradingCard: ['TradingCardCarouselItem', 'CardWrapper', 'Card', 'CardImage', 'Title', 'EmptyCircle'],
	GameInfo: ['Container', 'InnerContainer', 'SectionContainer', 'FeaturesList', 'Description', 'GameDescription', 'Stats', 'AssociationList', 'Release', 'Portrait', 'BoxArt'],
	GameInfoFrame: ['AppGameInfoContainer', 'GameInfoShadow', 'Glassy', 'SuppressTransition'],
	Friends: ['FriendsSection', 'FriendsContainer', 'GamepadFriendSectionItem', 'AvatarAndLabel'],
	Media: ['ScreenshotsSection', 'Screenshots', 'Thumbnail', 'NoRecent'],
	Feature: ['Container', 'Icon', 'ExtraMargin', 'Label'],
	Links: ['LinksSection', 'LinksSectionBody', 'Links', 'Anchor', 'Link', 'Text'],
	Review: ['ReviewMetadata', 'ReviewDescription', 'ReviewPresentGroup', 'ButtonsGroup'],
	Notes: ['NoteLink', 'Untitled', 'ViewAllLink'],
	QuickLinks: ['GameInfoQuickLinks', 'GameInfoCollections', 'AppDetailsContent', 'GameInfoContainer'],
	FocusRing: ['FocusRingRoot', 'FocusRing', 'blinker', 'growOutline', 'fadeOutline', 'flash'],
	PostTextEntry: ['PostTextEntry', 'PostTextEntryArea', 'Controls', 'PostButton'],
};

const cache = new Map<NativeClassFamily, NativeClassModule | null>();
let scanned = false;
let summaryCarousel: ComponentType<any> | null | undefined;

function classModuleCandidates(module: WebpackModuleEntry): NativeClassModule[] {
	const exports = module.exports as any;
	const candidates = [exports, exports?.default, ...(exports && typeof exports === 'object' ? Object.values(exports) : [])];
	const result: NativeClassModule[] = [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || result.includes(candidate)) continue;
		result.push(candidate as NativeClassModule);
	}
	return result;
}

function matches(module: NativeClassModule, keys: readonly string[]): boolean {
	return keys.every(key => typeof module[key] === 'string' && module[key].length > 0);
}

function scanNativeAppDetailsClasses(): void {
	if (scanned) return;
	const modules = steamWebpackRuntime.getAllModules();
	if (modules.length === 0) return;
	const unresolved = new Set<NativeClassFamily>(Object.keys(signatures) as NativeClassFamily[]);
	for (const module of modules) {
		const candidates = classModuleCandidates(module);
		for (const family of [...unresolved]) {
			const candidate = candidates.find(value => matches(value, signatures[family]));
			if (!candidate) continue;
			cache.set(family, candidate);
			unresolved.delete(family);
			backendLog(`[NGL][Gamepad][AppDetails] Resolved native ${family} classes from module ${module.id}`);
		}
		if (unresolved.size === 0) break;
	}
	for (const family of unresolved) cache.set(family, null);
	scanned = true;
}

export function resolveNativeAppDetailsClasses(): NativeAppDetailsClasses {
	scanNativeAppDetailsClasses();
	return {
		Section: cache.get('Section') || null,
		SectionHeader: cache.get('SectionHeader') || null,
		Activity: cache.get('Activity') || null,
		ActivityEvent: cache.get('ActivityEvent') || null,
		Achievement: cache.get('Achievement') || null,
		Community: cache.get('Community') || null,
		TradingCard: cache.get('TradingCard') || null,
		GameInfo: cache.get('GameInfo') || null,
		GameInfoFrame: cache.get('GameInfoFrame') || null,
		Friends: cache.get('Friends') || null,
		Media: cache.get('Media') || null,
		Feature: cache.get('Feature') || null,
		Links: cache.get('Links') || null,
		Review: cache.get('Review') || null,
		Notes: cache.get('Notes') || null,
		QuickLinks: cache.get('QuickLinks') || null,
		PostTextEntry: cache.get('PostTextEntry') || null,
		FocusRing: cache.get('FocusRing') || null,
	};
}

export const FALLBACK_FOCUS_RING_CLASSES: Readonly<{
	FocusRingRoot: string;
	FocusRing: string;
	flash: string;
	growOutline: string;
	fadeOutline: string;
	blinker: string;
}> = {
	FocusRingRoot: '_3FIjYetykQsFYR08l1v7Ls',
	FocusRing: '_1wPplsegQqCoe06wXPhzKT',
	flash: '_1RqM3Kl3-lPbdsdw6xcEm9',
	growOutline: '_2o99ScTho-Rc-AQV-VR68h',
	fadeOutline: 'zn08hWW7ylBIurz-os7CM',
	blinker: '_1aef_iRVYLxUpMGfUnxIdh',
};

/** Steam's AppDetails carousel is not the public Millennium Carousel. */
export function resolveNativeSummaryCarousel(): ComponentType<any> | null {
	if (summaryCarousel !== undefined) return summaryCarousel;
	const modules = steamWebpackRuntime.getAllModules();
	if (modules.length === 0) return null;
	for (const module of modules) {
		const exports = module.exports as any;
		const candidates = [exports, exports?.default, ...(exports && typeof exports === 'object' ? Object.values(exports) : [])];
		for (const candidate of candidates) {
			const prototype = typeof candidate === 'function' ? candidate.prototype : null;
			if (!prototype || typeof prototype.ScrollToElement !== 'function' || typeof prototype.UpdateScrollArrows !== 'function') continue;
			summaryCarousel = candidate as ComponentType<any>;
			backendLog(`[NGL][Gamepad][AppDetails] Resolved native BoxCarousel from module ${module.id}`);
			return summaryCarousel;
		}
	}
	summaryCarousel = null;
	return null;
}

export function clearNativeAppDetailsClassCache(): void {
	cache.clear();
	scanned = false;
	summaryCarousel = undefined;
}
