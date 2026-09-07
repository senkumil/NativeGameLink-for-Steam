import { findClassModule } from '@steambrew/client';

export type CssClasses = { [name: string]: string };

export const FEED_CLASSES_FALLBACK: CssClasses = {
	ActivityFeedContainer: '_3yTl3RiWfo-Itg-xp967wP',
	FetchMoreContainer: '_39ZurKJQex6v69aXzvc_nj',
	ViewLastNews: '_1EC1xjjUGqI7fqX6PVzJA3',
	AddToFeed: '_2bqRppbRWGNAZV5lfubW7-',
	PostTextEntry: 'YFAtL5H6txGXk5T_IhpUF',
	StatusInputBox: '_3NofiExBJn85uwEhca2dy7',
	StatusInputTextArea: '_10oyYsgiC5Hvnoieb7sHLI',
	StatusControlsRow: '_1HHZQHn8xe900jZYphjUlF',
	StatusControlsActive: '_3UJUKf-LVdVvYTGS51dmj',
	FormattingSpacer: '_3RowZ5DsqhGgvCelRGSZf2',
	FormattingButton: '_2Whi7Nrn2fmTSPtrf9jNFV',
};

export const EVENT_CLASSES_FALLBACK: CssClasses = {
	AppActivityDay: 'S2Fu9HxHCA5MaCLGrN2ib',
	AppActivityDate: '_19LfMT7PFWg2xHOqNjR99q',
	Rule: '_3pcPRPvuGH7hEM33zLknZO',
	Event: 'UVeN0kaD3zv1feMj_mMw5',
	EventBody: 'NEMXhMlqXOCJwfgWlHXhT',
	UserStatus: 'Yo3XX_JHkn0gKBlBhDvyg',
	EventHeadline: 'QCKBqF2k_sRLcXJ5qQIEl',
	EventActorAvatar: '_1gVy5n_zNp3tXpwU2aV9k8',
	SpanEvent: '_3Nxqyyt2ilotu5ci553y82',
	ActorName: '_1t1iyV4uBG9M9tTM7rCFNu',
	HeadlineGameName: 'Gy1Y7lb4Y47vK8odzSru2',
	ActivityAchievementUnlocked: 'yJLy7HDLJT44C1fcm6lPI',
	PrimaryAchievement: '_26QliGU0MSP6WN4r-RtI5q',
	OneAchievementRow: '_3XupbOaQR2IshnGoougLm2',
	TwoAchievementRow: '_2pdPx3x3zdBcv4K2Wx9AlT',
	PartnerEvent: '_1AYE16384J_ecLpN0sEYc5',
	PartnerEventLargeUpdate: '_39Zk32AvV5cr6g-83IVRVS',
	LeftSideMajorUpdateBar: '_3oMUSjOFNB0E9LWcL2sE7',
	PartnerEventMediumImage_Container: '_1HZy7BvOZuPT8feUwadL4W',
	MediumImageContainer: 'ddB5GVHCwLezhshXUMCNL',
	PartnerEventMediumImage_Image: 'VytJzt3Z_t6332-n24Yrc',
	PartnerEventMediumImage_Contents: '_2gv3EsHSu5dMQyMqaz-W9t',
	PartnerEventMediumImage_TextColumn: '_3dJ4Bq6Msivz5-UIHzSEQu',
	PartnerEventMediumImage_Title: '_1gljEIuhbsQpFCWuVhdKTJ',
	PartnerEventMediumImage_Summary: 'Ru7OBQzSxqIo3jIsbtV9g',
	PartnerEventType: '_1ujzuoxGhLunHZQqHAqRgg',
	PartnerEventFeatured: '_3xi-HLpFVHaakihoqhQ_6C',
	PartnerEventLargeImage_Container: 'LibriMVXcLl1HB60ZUp78',
	PartnerEventLargeImage_Contents: '_2tDv0EeJIdDmZLyfUE63t1',
	ImageContainer: '_1XpBItdUymdlwPZzvvOnyW',
	PartnerEventLargeImage_Image: 'fGDsmh9vz8h0RMEoRoAvF',
	Blur: '_3cX_vEKsN9S9EmR0O5w1Ol',
	PartnerEventLargeImage_Title: '_3fsjzvni7TQ1NphLHM_5r3',
	PartnerEventLargeImage_Summary: '_3zwBRDW1egliiT4pKYIXap',
	PartnerEventLargeImage_TextColumn: '_2HzKE96Sc4z6KHN68gr4DS',
	PartnerEventLargeUpdate_Contents: '_2Dbxm-Lv_YU2jN88HErlMS',
};

export const POST_CLASSES_FALLBACK: CssClasses = {
	PostTextEntry: '_3x31AgESSlUqX3D4MTHv2m',
	PostTextEntryArea: '_1JlC29Ic6L-QvL-39X_d-X',
	Controls: '_37e7DrDNmf1FmsMGA5y0A0',
	Active: '_1_KMhJX-BZ-bohjsJ7i3w3',
	FormattingSpacer: '_33rj8CoAI3J6C0dO_aOwIS',
	EmoticonButton: 'bACIuqv-b_9TztCczFK19',
	PostButton: '_2JSyABqFEh-v_dwaTnBydR',
	Label: '_3jvEkfXhmZjvEbkpEv5EsH',
	Enabled: 'bGfjajFo4DI-ULSQxw1KY',
};

export const ACH_CLASSES_FALLBACK: CssClasses = {
	AchievementHoverContainer: '_2CK1m9x0gtA_oSAQa2FpS3',
	Icon: 'zcasgBSVIteabq-j_3g1m',
	TextSection: '_1s_9cSxUjb4609MSH0EjWH',
	Name: '_39Y01uSRcLiDg5DneTTR0m',
	Desc: '_2gLHbXukQBdrIKhqEYVvOe',
	Featured: '_1j_gja8bHXjiS-BeSQk8hb',
	Achieved: 'MGoYUyIslJerluzgnU7z9',
	HighlightDiv: '_2xTb6N-jUUQ-mIkMB6OVMm',
	UnlockedLabel: '_3jC8om-5Sci_dkUB-6VYiU',
	UnlockedLabelPercent: '_14kZVEyaz7WX57N47z4Yr1',
	AchievementProgressContainer: '_3ns9185LizH61StaAXuAp6',
	AchievementProgress: '_3Rm36_oeAhvIg6ZYP9l1Jj',
	SingleAchievementProgressBar: '_1OIatPEED_bSmd_CNyMv7C',
};

export const PLAYBAR_CLASSES_FALLBACK: CssClasses = {
	Container: '_3Yf8b2v5oOD8Wqsxu04ar',
	InPage: '_1U7LKpx70kEsz3jJwAFOi-',
	GameStatsSection: '_1mDAVT4sTzFRwJtlKCw2Ws',
	GameStat: '_1kiZKVbDe-9Ikootk57kpA',
	GameStatIconForced: '_3bkqc-SsCg0b3FTEuewlK8',
	PlaytimeIconForced: '_1UXbBdCvbg9tyZhc4owO4W',
	GameStatRight: '_3m_zjRTQBqcfzCjXLXUHcR',
	HideWhenNarrow: '_2YTg3hVVde1EN1A4QVkvAE',
	PlayBarLabel: '_34lrt5-Fc3usZU6trA1P0-',
	PlayBarDetailLabel: '_2TYVGoD27ZMfjRirKQNLfk',
	LastPlayed: '_3pS8kMrtScuY1Qf-W8tmRV',
	LastPlayedInfo: '_1nfJNsQjTOXSQQyFahGnRi',
	Playtime: '_1aKegVl9_lSdNAyWYZQlr9',
	PlayBarCloudStatusContainer: '_2cRYms-zZc4misk9tj3bt8',
	CloudIconSVG: 'MbTRimZpGCATmn39ae8RT',
	CloudStatusIcon: '_1PrjvpmQ3CUjn45PN1Ed6V',
	CloudStatusLabel: 'fUTblKw-DF3ph-FUGHA1d',
	CloudStatusRow: 'QvHky2-yJGOkPJG16qeRL',
	ControllerSupportInfo: '_38kosHRlxdvgwsxUEc7ubJ',
	ControllerSupportRow: '_1h2AI3i3iFENH0XlK_2eS0',
	DetailsProgressContainer: '_25YVDTaClw6Y2COPsU0UaV',
	DetailsProgressBar: '_1FnTqlsi2_-TJf1d5apoS6',
	AppButtonsContainer: 'lO1IF132jJ1gc9yz2HYvV',
	MenuButton: '_3qDWQGB0rtwM3qpXTb11Q-',
	MenuActive: 'fyJia4DC2A-H5pIR9DD87',
	DotDotDot: 'zvLq1GUCH3yLuqv_TXBJ1',
	FavoriteButton: '_21hXW2oDD7zvNsoOaW7Yob',
	ControllerConfigButton: 'ControllerConfigButton',
	SuperimposedGridItems: '_1nxYsdQLxAV_i8JIm-f64w',
	Visible: '_2sKVnd_AUg44QSdoAp8Lne',
	// Native achievement play-bar classes (Steam's current desktop UI).
	MiniAchievements: 'UAhWiMg9Q2VPsQQBj_ikT',
	AchievementSVG: 'k-QNT9kzOEOvG0U_kGmwr',
	GameStatIcon: '_1tIg-QIrwMNtCm7NcYADyi',
	AchievementProgressRow: '_16quGbk-i_9yE-tFyyOK8G',
	AchievementCountLabel: '_2muiKHUkOiTvX-6arqnQUC',
	AchievementRight: '',
	AchievementLabel: '',
};

export const GAME_INFO_OUTER_CLASSES_FALLBACK: CssClasses = {
	AppGameInfoContainer: '_25oBZpa3dUcMw8QAsa2u67',
	AppDetailsExpanded: '_3s6_6sN8LyrlTHc_z6VfNU',
	AppDetailsCollapsed: '_3yfoeR7q8sXXS2UyFcIK1K',
	Glassy: '_2QAgOXmzdXYGH8vI6S2sHw',
	GameInfoShadow: '_1FXWy2UilVZIppT-PetDWw',
};

/** Library Home portrait/card classes. These are resolved dynamically; the
 * fallback only covers the Steam client build against which this release was
 * verified. Keeping this small avoids depending on the complete card layout. */
export const APP_PORTRAIT_CLASSES_FALLBACK: CssClasses = {
	LibraryItemBox: 'WYgDg9NyCcMIVuMyZ_NBC',
	PlaytimeDetails: '_3bkuozxKIatrWG3aeisthc',
	PlayedRecent: '_3JWBBEulYkYmDLJr485oex',
	PlayedTotal: 'ma8y_VgPze1mscYhW6-oS',
};

export const GAME_INFO_CLASSES_FALLBACK: CssClasses = {
	Container: '_2jPMy2QZr8bWi6yrk5ZzHA',
	InnerContainer: '_37mmOlZM_8n5yJAG5CHiW7',
	SectionContainer: '_1uS70KI6ZbUE94jUB27ioB',
	Portrait: '_1Id6ZFEUVa5PKEMIvSg4nE',
	BoxArt: '_3JzkHhrsBKThuVrwsu3Q7T',
	Description: '_2AMl0koRXkR77BaY7Sa3Ie',
	GameDescription: '_3GkV1NVDKuXYTLyRt2Uirz',
	Stats: '_3cntzF30xAuwn1ARWJjvCb',
	AssociationList: '_2ZcNQxY8YknnhNa4ZvIoU4',
	Association: '_-9icu8LqT7inRSJISgnkh',
	Name: '_2j8Xh4pPOOgF4MF6FVUI28',
	Release: '_1OWQ9x11PhUMMRAfAu4d_4',
	Label: '_1vYL2q-91QLy-FBzntE7E5',
	Date: 'izVv8jajo7mehdAkZozAK',
	FeaturesList: 'nkIX48cHLbjc0eaP5CNmM',
};

export const LINKS_BAR_CLASSES_FALLBACK: CssClasses = {
	LinksSection: '_3-V8vjmrwuJM6Ws3tsjFJj',
	LinksSectionBody: '_25f0fX6qbgdB7O_lMrbhCN',
	InnerContainer: '_1Ak5Eixho9KoGUXjyp1zKD',
	Links: 'DgVQapkBmhAW6oPY5rPZo',
	LinkInner: '_7k4qmaN8SUMvv6u-L81uk',
	Anchor: 'DY4_wSF8h9T5o46hO5I9V',
	Link: '_1b6LYWVijW-9E4YV0keDWZ',
	Label: '_2yAhdnguMvrNm_iD64JHDU',
	MenuButton: '_1bIMOmWaxKrMdVMWU21ku',
};

export interface ResolvedCssClasses {
	classes: CssClasses;
	native: boolean;
}

export function resolveClassModule(predicate: (m: any) => boolean, fallback: CssClasses): ResolvedCssClasses {
	try {
		const module = findClassModule(predicate) as CssClasses | undefined;
		if (module) return { classes: module, native: true };
	} catch {}
	return { classes: fallback, native: false };
}

/**
 * Compatibility helper for modules that only need the resolved class map.
 * New native-UI code should prefer the explicit `*_CLASS_MODULE()` accessors
 * so it can distinguish a live Steam module from a stale hash fallback.
 */
export function resolveClasses(predicate: (m: any) => boolean, fallback: CssClasses): CssClasses {
	return resolveClassModule(predicate, fallback).classes;
}

let _feedClassModule: ResolvedCssClasses | null = null;
let _eventClassModule: ResolvedCssClasses | null = null;
let _achClassModule: ResolvedCssClasses | null = null;
let _postClassModule: ResolvedCssClasses | null = null;
let _playbarClassModule: ResolvedCssClasses | null = null;
let _gameInfoOuterClassModule: ResolvedCssClasses | null = null;
let _appPortraitClassModule: ResolvedCssClasses | null = null;
let _gameInfoClassModule: ResolvedCssClasses | null = null;
let _linksBarClassModule: ResolvedCssClasses | null = null;

export const FEED_CLASS_MODULE = (): ResolvedCssClasses =>
	(_feedClassModule ||= resolveClassModule(
		module => module.ActivityFeedContainer && module.FetchMoreContainer && module.ViewLastNews,
		FEED_CLASSES_FALLBACK,
	));

export const EVENT_CLASS_MODULE = (): ResolvedCssClasses =>
	(_eventClassModule ||= resolveClassModule(
		module => module.AppActivityDay && module.EventHeadline && module.ActivityAchievementUnlocked,
		EVENT_CLASSES_FALLBACK,
	));

export const ACH_CLASS_MODULE = (): ResolvedCssClasses =>
	(_achClassModule ||= resolveClassModule(
		module => module.AchievementHoverContainer && module.UnlockedLabel && module.SingleAchievementProgressBar,
		ACH_CLASSES_FALLBACK,
	));

export const POST_CLASS_MODULE = (): ResolvedCssClasses =>
	(_postClassModule ||= resolveClassModule(
		module => module.PostTextEntryArea && module.EmoticonButton && module.PostButton,
		POST_CLASSES_FALLBACK,
	));

export const PLAYBAR_CLASS_MODULE = (): ResolvedCssClasses =>
	(_playbarClassModule ||= resolveClassModule(
		module => module.PlayBarDetailLabel
			&& module.GameStatsSection
			&& module.PlayBarCloudStatusContainer
			&& module.AppButtonsContainer
			&& module.InPage
			&& module.MenuButton,
		PLAYBAR_CLASSES_FALLBACK,
	));

export const GAME_INFO_OUTER_CLASS_MODULE = (): ResolvedCssClasses =>
	(_gameInfoOuterClassModule ||= resolveClassModule(
		module => module.AppGameInfoContainer
			&& module.AppDetailsExpanded
			&& module.AppDetailsCollapsed
			&& module.GameInfoShadow,
		GAME_INFO_OUTER_CLASSES_FALLBACK,
	));

export const APP_PORTRAIT_CLASS_MODULE = (): ResolvedCssClasses =>
	(_appPortraitClassModule ||= resolveClassModule(
		module => module.LibraryItemBox
			&& module.PlaytimeDetails
			&& module.PlayedRecent
			&& module.PlayedTotal,
		APP_PORTRAIT_CLASSES_FALLBACK,
	));

export const GAME_INFO_CLASS_MODULE = (): ResolvedCssClasses =>
	(_gameInfoClassModule ||= resolveClassModule(
		module => module.InnerContainer
			&& module.SectionContainer
			&& module.GameDescription
			&& module.Portrait
			&& module.FeaturesList
			&& module.AssociationList,
		GAME_INFO_CLASSES_FALLBACK,
	));

export const LINKS_BAR_CLASS_MODULE = (): ResolvedCssClasses =>
	(_linksBarClassModule ||= resolveClassModule(
		module => module.LinksSection && module.Link && module.Links && module.LinkInner,
		LINKS_BAR_CLASSES_FALLBACK,
	));

export const FEED_CLASSES = (): CssClasses => FEED_CLASS_MODULE().classes;
export const EVENT_CLASSES = (): CssClasses => EVENT_CLASS_MODULE().classes;
export const ACH_CLASSES = (): CssClasses => ACH_CLASS_MODULE().classes;
export const POST_CLASSES = (): CssClasses => POST_CLASS_MODULE().classes;
export const PLAYBAR_CLASSES = (): CssClasses => PLAYBAR_CLASS_MODULE().classes;
export const GAME_INFO_OUTER_CLASSES = (): CssClasses => GAME_INFO_OUTER_CLASS_MODULE().classes;
export const APP_PORTRAIT_CLASSES = (): CssClasses => APP_PORTRAIT_CLASS_MODULE().classes;
export const GAME_INFO_CLASSES = (): CssClasses => GAME_INFO_CLASS_MODULE().classes;
export const LINKS_BAR_CLASSES = (): CssClasses => LINKS_BAR_CLASS_MODULE().classes;

/**
 * Clear resolved module caches after a Steam UI context reset. This is useful
 * when the client recreates its shared JS context after an update/reload.
 */
export function resetResolvedCssClassModules(): void {
	_feedClassModule = null;
	_eventClassModule = null;
	_achClassModule = null;
	_postClassModule = null;
	_playbarClassModule = null;
	_gameInfoOuterClassModule = null;
	_appPortraitClassModule = null;
	_gameInfoClassModule = null;
	_linksBarClassModule = null;
}
