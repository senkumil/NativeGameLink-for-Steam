import React, { Component, type ReactNode } from 'react';
import { DialogButton, Focusable, IconsModule, ModalRoot, ProgressBar, Spinner, showModal } from '@steambrew/client';
import { backendLog } from '../../api/backend';
import type { CommunityContentItem } from '../../domain/types';
import { gdlText, loc } from '../../steam/localization';
import {
	resolveNativeAppDetailsClasses,
	resolveNativeSummaryCarousel,
	type NativeAppDetailsClasses,
} from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import {
	resolveNativeTradingCardComponent,
	resolveNativeDLCComponent,
	resolveNativeScreenshotsComponent,
	resolveNativeReviewComponent,
	resolveNativeNotesComponent,
	resolveNativeWorkshopComponent,
	resolveNativeAppDetails,
	resolveNativeConfigContext,
	getNavContext,
	resolveSteamNav,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import { FriendsSection, FallbackActivitySection } from './activity-section';
import { NativeBigPictureAchievements } from './NativeBigPictureAchievements';
import { openSteamNavigationUrl, extractCommunityYoutubeId } from '../../steam/navigation';
import { installBigPictureGamepadNavigation, disposeBigPictureGamepadNavigation, dismissBigPictureFocusRing } from './gamepad-nav';
import { findBigPictureTabStrip } from './tabs';
import { ensureBigPictureDetailStyles } from './details-styles';
import type { BigPictureDetailData, BigPictureTab, MappedShortcut } from './types';

type NativeComponent = React.ComponentType<any>;

const NativeFocusable = Focusable as NativeComponent;
const NativeButton = DialogButton as NativeComponent;
const NativeProgress = ProgressBar as NativeComponent;
const NativeSpinner = Spinner as NativeComponent;
const NativeIcons = IconsModule as Record<string, NativeComponent>;

interface NativeDetailsProps {
	tab: BigPictureTab;
	shortcut: MappedShortcut;
	data: BigPictureDetailData;
	hydrating: boolean;
	document: Document;
}

interface BoundaryState {
	failed: boolean;
}

class NativeDetailsBoundary extends Component<{ children: ReactNode; fallback: ReactNode; name?: string }, BoundaryState> {
	state: BoundaryState = { failed: false };

	static getDerivedStateFromError(): BoundaryState {
		return { failed: true };
	}

	componentDidCatch(error: Error): void {
		backendLog(`[NGL][Gamepad] Native Big Picture ${this.props.name || 'section'} failed: ${error.message}`);
	}

	componentDidUpdate(prevProps: { children: ReactNode; fallback: ReactNode; name?: string }): void {
		if (this.state.failed && prevProps.children !== this.props.children) {
			this.setState({ failed: false });
		}
	}

	render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function nativeClasses(...values: Array<string | null | false | undefined>): string | undefined {
	const value = values.filter(Boolean).join(' ');
	return value || undefined;
}

function plainText(value: unknown, maxLength = 360): string {
	const text = String(value || '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\[[^\]]+\]/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function clickProps(action: () => void): { onClick: () => void } {
	return { onClick: action };
}

function showNativeImageModal(doc: Document, title: string, imageUrl: string, classes: NativeAppDetailsClasses): void {
	if (!imageUrl) return;
	dismissBigPictureFocusRing(doc);
	let handle: { Close(): void } | undefined;
	const close = () => {
		dismissBigPictureFocusRing(doc);
		handle?.Close();
	};
	try {
		handle = showModal(
			<ModalRoot onCancel={close} closeModal={close} bAllowFullSize bDisableBackgroundDismiss>
				<img className={classes.Media?.ScreenshotModal} width="100%" src={imageUrl} alt={title} />
				<NativeButton {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton>
			</ModalRoot>,
			(doc.defaultView || doc.body) as EventTarget,
			{ strTitle: title, bNeverPopOut: true, bHideMainWindowForPopouts: false },
		);
	} catch {
		openSteamNavigationUrl(doc, imageUrl);
	}
}

function showNativeVideoModal(doc: Document, title: string, youtubeId: string, _classes: NativeAppDetailsClasses): void {
	if (!youtubeId) return;
	dismissBigPictureFocusRing(doc);
	let handle: { Close(): void } | undefined;
	const close = () => {
		dismissBigPictureFocusRing(doc);
		handle?.Close();
	};
	try {
		handle = showModal(
			<ModalRoot onCancel={close} closeModal={close} bAllowFullSize bDisableBackgroundDismiss>
				<div className={nativeClasses('gdl-bp-video-modal-wrap')}>
					<iframe
						src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&enablejsapi=1&rel=0`}
						className={nativeClasses('gdl-bp-video-modal-frame')}
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
						allowFullScreen
					/>
				</div>
				<div className={nativeClasses('gdl-bp-video-modal-footer')}>
					<NativeButton {...clickProps(close)}>{loc('Button_Close', 'Cerrar')}</NativeButton>
				</div>
			</ModalRoot>,
			(doc.defaultView || doc.body) as EventTarget,
			{ strTitle: title, bNeverPopOut: true, bHideMainWindowForPopouts: false },
		);
	} catch {
		openSteamNavigationUrl(doc, `https://www.youtube.com/watch?v=${youtubeId}`);
	}
}


function Section({ classes, label, children, highlight, className, bodyClassName, headerClassName, rightColumn = false }: {
	classes: NativeAppDetailsClasses;
	label?: ReactNode;
	children: ReactNode;
	highlight?: ReactNode;
	className?: string;
	bodyClassName?: string;
	headerClassName?: string;
	rightColumn?: boolean;
}): React.ReactElement {
	const labelId = React.useId();
	const section = classes.Section;
	const header = classes.SectionHeader;
	return (
		<div role="region" aria-labelledby={label ? labelId : undefined} className={nativeClasses(section?.AppDetailsSection, className)}>
			{label ? (
				<div className={nativeClasses(header?.SectionHeader, header?.PadLeft, headerClassName)}>
					<div id={labelId} className={header?.Label}><div className={header?.LabelText}>{label}</div></div>
				</div>
			) : null}
			<NativeFocusable
				flow-children="column"
				className={nativeClasses(section?.AppDetailsSectionContainer, Boolean(label) && section?.AppDetailsSectionHasLabel, rightColumn && section?.RightColumnSection)}
				scrollIntoViewWhenChildFocused
			>
				{highlight ? <div className={section?.Highlight}>{highlight}</div> : null}
				<div className={nativeClasses(section?.Body, bodyClassName)}>{children}</div>
			</NativeFocusable>
		</div>
	);
}

function NativeStrip({ name, children, className }: { name: string; children: ReactNode; className?: string }): React.ReactElement {
	const NativeCarousel = resolveNativeSummaryCarousel();
	const fallback = <NativeFocusable flow-children="row" className={className}>{children}</NativeFocusable>;
	if (!NativeCarousel) return fallback;
	return (
		<NativeDetailsBoundary name={`${name} carousel`} fallback={fallback}>
			<NativeCarousel aria-label={name} className={className} leftMargin={32} edgeMask="none" fnUpdateArrows={() => {}}>
				{children}
				<div data-carousel="ignore" />
			</NativeCarousel>
		</NativeDetailsBoundary>
	);
}

function LoadingContent({ hydrating, empty, className }: { hydrating: boolean; empty: string; className?: string }): React.ReactElement {
	if (hydrating && NativeSpinner) {
		return (
			<div className={className}>
				<NativeSpinner width="36" height="36" />
			</div>
		);
	}
	return <div className={className}>{empty}</div>;
}

function ActivityTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	const event = classes.ActivityEvent;
	void (
		event?.PartnerEventMediumImage_Container,
		event?.AppActivityDay,
		event?.AppActivityDate,
		event?.PartnerEventTextOnly_Icon
	);
	const friendsNode = (
		<NativeDetailsBoundary name="friends" fallback={null}>
			<FriendsSection data={props.data} shortcut={props.shortcut} classes={classes} SectionComponent={Section} document={props.document} />
		</NativeDetailsBoundary>
	);
	const activityNode = (
		<NativeDetailsBoundary name="activity" fallback={null}>
			<FallbackActivitySection
				key={`${props.shortcut.id}-${props.shortcut.steamAppId}`}
				data={props.data}
				shortcut={props.shortcut}
				classes={classes}
				hydrating={props.hydrating}
				document={props.document}
				SectionComponent={Section}
				LoadingComponent={LoadingContent}
			/>
		</NativeDetailsBoundary>
	);
	return <div className={nativeClasses('gdl-bp-activity-tab-content')}>{friendsNode}{activityNode}</div>;
}

function AchievementsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses; hideIfEmpty?: boolean }): React.ReactElement | null {
	const NativeCarousel = resolveNativeSummaryCarousel(props.document);
	const _achievementItem = props.classes.Achievement?.AchievementCarouselItem;
	return (
		<NativeBigPictureAchievements
			{...props}
			SectionComponent={Section}
			LoadingComponent={LoadingContent}
			NativeButton={NativeButton}
			NativeFocusable={NativeFocusable}
			NativeProgress={NativeProgress}
			NativeIcons={NativeIcons}
			NativeStrip={NativeStrip}
			NativeDetailsBoundary={NativeDetailsBoundary}
			NativeCarousel={NativeCarousel}
			carouselItemClassName={_achievementItem}
		/>
	);
}

function TradingCardsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement | null {
	const catalog = props.data.cards;
	const cards = catalog?.cards || [];
	if (cards.length === 0) return null;

	const badge = catalog?.foil_badge
		|| catalog?.badges?.find(b => b.foil)
		|| (catalog?.badges && catalog.badges.length > 0 ? catalog.badges[catalog.badges.length - 1] : null);
	const badgeImage = badge?.image || cards[0]?.image || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${props.shortcut.steamAppId}/library_600x900.jpg`;
	const badgeTitle = badge?.title || gdlText('cards_found', 'Cards found');
	const maxLevel = badge?.level || (catalog?.badges && catalog.badges.length > 0 ? Math.max(...catalog.badges.map(b => Number(b.level || 0))) : 5);
	const lvl = maxLevel || 5;
	const xp = lvl * 100;
	const badgeLevelLabel = loc('AppDetails_BadgeLevel', `Nivel ${lvl} (${xp} EXP)`).replace('%1$s', String(lvl)).replace('%2$s', String(xp));
	const native = props.classes.TradingCard;
	const NativeTradingCard = resolveNativeTradingCardComponent(props.document);

	return (
		<Section classes={props.classes} label={loc('AppDetails_SectionTitle_TradingCards', gdlText('trading_cards', 'Trading cards'))} bodyClassName={native?.Container} rightColumn>
			<NativeFocusable
				focusable
				role="button"
				className={nativeClasses(native?.BadgeSection, 'gdl-bp-badge-action')}
				onActivate={() => openSteamNavigationUrl(props.document, `https://steamcommunity.com/my/gamecards/${props.shortcut.steamAppId}`)}
				{...clickProps(() => openSteamNavigationUrl(props.document, `https://steamcommunity.com/my/gamecards/${props.shortcut.steamAppId}`))}
			>
				<div className={native?.Badge}>
					{badgeImage ? <img className={nativeClasses(native?.BadgeImage, native?.CardImage)} src={badgeImage} alt={badgeTitle} /> : null}
				</div>
				<div className={native?.BadgeInfo}>
					<div className={native?.BadgeName}>{badgeTitle}</div>
					<div className={native?.BadgeLevel}>{badgeLevelLabel}</div>
				</div>
			</NativeFocusable>
			<div className={native?.CardsSection}>
				<div className={nativeClasses(native?.CardsLeft, native?.BadgeMaxed)}>
					{loc('AppDetails_TradingCardsMaxed', 'INSIGNIA DE NIVEL MÁXIMO')}
				</div>
				<NativeStrip name="NativeGameLink Trading Cards" className={native?.SummaryCarouselContainer}>
					{cards.slice(0, 18).map((card, index) => {
						const openCard = (): void => showNativeImageModal(props.document, card.title, card.artwork || card.image, props.classes);
						if (NativeTradingCard) {
							return (
								<NativeFocusable
									key={`${card.title}-${index}`}
									focusable
									role="button"
									onActivate={openCard}
									{...clickProps(openCard)}
									className={nativeClasses(native?.TradingCardCarouselItem, native?.Owned, native?.Clickable, 'gdl-bp-trading-card')}
								>
									<NativeTradingCard
										data={{
											strTitle: card.title,
											strImgURL: card.image,
											strArtworkURL: card.artwork || card.image,
											nOwned: 1,
											strMarketHash: card.title,
										}}
										bMaxed
										bClickable
										animateHover
										cardScale={1.0}
									/>
								</NativeFocusable>
							);
						}
						return (
							<NativeFocusable
								key={`${card.title}-${index}`}
								focusable
								onActivate={openCard}
								{...clickProps(openCard)}
								className={nativeClasses(native?.TradingCardCarouselItem, native?.Clickable, native?.Owned, 'gdl-bp-trading-card')}
							>
								<div className={nativeClasses(native?.CardWrapper, native?.Owned)}>
									<div className={nativeClasses(native?.Card, native?.Owned, native?.Clickable)}>
										<div className={native?.CardContainer}>
											<img className={nativeClasses(native?.CardImage, native?.Loaded)} src={card.image} alt={card.title} width="100" height="130" />
										</div>
										<div className={native?.Title}>{card.title}</div>
									</div>
								</div>
							</NativeFocusable>
						);
					})}
				</NativeStrip>
			</div>
		</Section>
	);
}

function communityItems(data: BigPictureDetailData): CommunityContentItem[] {
	const raw = data.community.length > 0 ? data.community : (data.game?.screenshots || []).map((shot, index) => ({ type: 'screenshot', image: shot.path_full || shot.path_thumbnail, title: `${loc('AppDetails_Community_Screenshot', 'Captura')} ${index + 1}` }));
	return raw.filter(item => Boolean(item && item.image));
}

function CommunityCard({ item, index, classes, document }: { item: CommunityContentItem; index: number; classes: NativeAppDetailsClasses; document: Document }): React.ReactElement {
	const native = classes.Community;
	const title = item.title || item.label || loc('AppDetails_Community_Screenshot', 'Contenido de la comunidad');
	const author = item.author_name ? <div className={native?.AuthorSection}>{item.author_avatar ? <img className={native?.Avatar} src={item.author_avatar} alt="" /> : null}<div className={native?.AuthorName}>{item.author_name}</div></div> : null;
	const youtubeId = extractCommunityYoutubeId(item);

	const onActivate = (): void => {
		if (item.type === 'video' || youtubeId) {
			if (youtubeId) {
				showNativeVideoModal(document, title, youtubeId, classes);
				return;
			}
		}
		if (item.type === 'screenshot' && item.image) {
			showNativeImageModal(document, title, item.image, classes);
			return;
		}
		if (item.link) {
			openSteamNavigationUrl(document, item.link);
		}
	};

	if (item.type === 'guide') {
		return (
			<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`guide-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium, 'gdl-bp-community-item')}>
				<div className={native?.ChildItem}>
					<div className={native?.Guide}>
						<div className={native?.Header}>{loc('AppDetails_Community_Guide', 'Guía de la comunidad')}</div>
						<div className={native?.TopSection}><div className={native?.TopSectionInner}>
							{item.image ? <div className={nativeClasses(native?.PreviewContainer, 'gdl-bp-community-preview-wrap')}><img className={nativeClasses(native?.Preview, 'gdl-bp-community-preview-img')} src={item.image} alt="" width="360" height="160" /></div> : null}
							<div className={nativeClasses(native?.GuideTitle, 'gdl-bp-community-title')}>{title}</div>
						</div></div>
						{item.description ? <div className={native?.Body}><div className={native?.Description}>{plainText(item.description, 180)}</div></div> : null}
					</div>
				</div>
				{author}
			</NativeFocusable>
		);
	}
	if (item.type === 'video' || youtubeId) {
		const PlayIcon = NativeIcons.Play;
		return (
			<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`video-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium, 'gdl-bp-community-item')}>
				<div className={native?.ChildItem}>
					<div className={native?.ArtItem}>
						<div className={nativeClasses(native?.PreviewContainer, 'gdl-bp-community-preview-wrap')}>
							{item.image ? <img className={nativeClasses(native?.Preview, 'gdl-bp-community-preview-img')} src={item.image} alt={title} width="360" height="160" /> : null}
							{PlayIcon ? (
								<PlayIcon className={nativeClasses(classes.Feature?.Icon, native?.VideoPlayButton, 'gdl-bp-video-play-btn')} />
							) : (
								<svg viewBox="0 0 24 24" className={nativeClasses('gdl-bp-video-play-btn')}><path d="M8 5v14l11-7z" /></svg>
							)}
						</div>
						<div className={native?.BottomSection}><div className={nativeClasses(native?.DescriptionRow, 'gdl-bp-community-title')}>{title}</div></div>
					</div>
				</div>
				{author}
			</NativeFocusable>
		);
	}
	return (
		<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`${item.type}-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium, 'gdl-bp-community-item')}>
			<div className={native?.ChildItem}>
				<div className={native?.ArtItem}>
					<div className={nativeClasses(native?.PreviewContainer, 'gdl-bp-community-preview-wrap')}>{item.image ? <img className={nativeClasses(native?.Preview, 'gdl-bp-community-preview-img')} src={item.image} alt={title} width="360" height="160" /> : null}</div>
					<div className={native?.BottomSection}><div className={nativeClasses(native?.DescriptionRow, 'gdl-bp-community-title')}>{title}</div></div>
				</div>
			</div>
			{author}
		</NativeFocusable>
	);
}

function CommunityGrid({ items, classes, document }: { items: CommunityContentItem[]; classes: NativeAppDetailsClasses; document: Document }): React.ReactElement {
	const native = classes.Community;
	return (
		<NativeFocusable role="grid" aria-readonly flow-children="geometric" className={nativeClasses(native?.InnerContainer, 'gdl-bp-community-grid')}>
			{items.slice(0, 24).map((item, index) => (
				<CommunityCard key={`${item.type}-${item.title}-${index}`} item={item} index={index} classes={classes} document={document} />
			))}
		</NativeFocusable>
	);
}

function ScreenshotsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement | null {
	const screenshots = props.data.game?.screenshots || [];
	if (screenshots.length === 0) return null;
	const mediaClasses = props.classes.Media;

	return (
		<Section
			classes={props.classes}
			label={loc('AppDetails_SectionTitle_Screenshots', 'Capturas y archivos multimedia')}
			rightColumn
		>
			<NativeStrip name="Screenshots" className={mediaClasses?.Screenshots}>
				{screenshots.slice(0, 12).map((shot, index) => {
					const imgUrl = shot.path_full || shot.path_thumbnail;
					const title = `${loc('AppDetails_Community_Screenshot', 'Captura')} ${index + 1}`;
					const open = (): void => showNativeImageModal(props.document, title, imgUrl, props.classes);
					return (
						<NativeFocusable
							key={index}
							focusable
							onActivate={open}
							{...clickProps(open)}
							className={nativeClasses(mediaClasses?.Thumbnail)}
						>
							<img className={nativeClasses(mediaClasses?.Thumbnail)} src={imgUrl} alt={title} width="280" height="160" />
						</NativeFocusable>
					);
				})}
			</NativeStrip>
		</Section>
	);
}

function NotesSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement {
	const openNotes = (): void => {
		try {
			const client = (window as any).SteamClient;
			if (client?.GameNotes?.OpenGameNotes) {
				client.GameNotes.OpenGameNotes(props.shortcut.id);
			}
		} catch {}
	};

	return (
		<Section
			classes={props.classes}
			label={loc('AppDetails_SectionTitle_GameNotes', 'Notas')}
			rightColumn
		>
			<NativeButton {...clickProps(openNotes)}>
				{loc('AppDetails_GameNotes_Open', 'Abrir notas del juego')}
			</NativeButton>
		</Section>
	);
}

function StuffTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	const appid = Number(props.shortcut.steamAppId || 0);
	const overview = AppStoreAdapter.getAppOverview(appid) || { appid, display_name: props.shortcut.title };
	const details = React.useMemo(() => resolveNativeAppDetails(props.document, appid) || { unAppID: appid, vecDLC: [] }, [props.document, appid]);

	const NativeDLC = appid > 0 ? resolveNativeDLCComponent(props.document) : null;
	const NativeScreenshots = appid > 0 ? resolveNativeScreenshotsComponent(props.document) : null;
	const NativeReview = appid > 0 ? resolveNativeReviewComponent(props.document) : null;
	const NativeNotes = appid > 0 ? resolveNativeNotesComponent(props.document) : null;
	const NativeWorkshop = appid > 0 ? resolveNativeWorkshopComponent(props.document) : null;

	return (
		<>
			<AchievementsSection {...props} classes={classes} />
			<TradingCardsSection {...props} classes={classes} />
			{NativeScreenshots ? (
				<NativeDetailsBoundary name="screenshots" fallback={<ScreenshotsSection {...props} classes={classes} />}>
					<NativeScreenshots overview={overview} details={details} />
				</NativeDetailsBoundary>
			) : (
				<ScreenshotsSection {...props} classes={classes} />
			)}
			{NativeNotes ? (
				<NativeDetailsBoundary name="notes" fallback={<NotesSection {...props} classes={classes} />}>
					<NativeNotes overview={overview} details={details} />
				</NativeDetailsBoundary>
			) : (
				<NotesSection {...props} classes={classes} />
			)}
			{NativeDLC ? (
				<NativeDetailsBoundary name="dlc" fallback={null}>
					<NativeDLC details={details} showRemainder />
				</NativeDetailsBoundary>
			) : null}
			{NativeWorkshop ? (
				<NativeDetailsBoundary name="workshop" fallback={null}>
					<NativeWorkshop details={details} />
				</NativeDetailsBoundary>
			) : null}
			{NativeReview ? (
				<NativeDetailsBoundary name="review" fallback={null}>
					<NativeReview details={details} overview={overview} />
				</NativeDetailsBoundary>
			) : null}
		</>
	);
}

function FallbackCommunitySection({ props, classes }: { props: NativeDetailsProps; classes: NativeAppDetailsClasses }): React.ReactElement {
	const items = communityItems(props.data).filter(item => item.title || item.image);
	const hubUrl = `https://steamcommunity.com/app/${props.shortcut.steamAppId}`;
	return (
		<Section classes={classes} label={loc('AppDetails_SectionTitle_Community', gdlText('community_content', 'Community content'))} className={classes.Community?.CommunityContentContainer} headerClassName={classes.Community?.HeaderStyles}>
			{items.length > 0 ? (
				<CommunityGrid items={items} classes={classes} document={props.document} />
			) : (
				<div className={nativeClasses(classes.Community?.NoContent, 'gdl-bp-community-empty')}>
					<LoadingContent hydrating={props.hydrating} empty={loc('AppDetails_Community_NoContent', 'No hay contenido de la comunidad disponible.')} />
					<NativeButton {...clickProps(() => openSteamNavigationUrl(props.document, hubUrl))}>
						{loc('AppDetails_Community_Hub', 'Ir al punto de encuentro')}
					</NativeButton>
				</div>
			)}
		</Section>
	);
}

function CommunityTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	return <FallbackCommunitySection props={props} classes={classes} />;
}

function SafeTabFallback(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	return <Section classes={classes} label={props.shortcut.title}><LoadingContent hydrating={props.hydrating} empty={loc('Loading', 'Cargando…')} /></Section>;
}

export function NativeBigPictureDetails(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);

	React.useEffect(() => {
		const doc = props.document;
		return () => {
			disposeBigPictureGamepadNavigation(doc);
		};
	}, [props.document, props.shortcut.id]);

	React.useEffect(() => {
		const doc = props.document;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const setup = () => {
			const root = doc.getElementById('gdl-bp-detail-root');
			const tabStrip = findBigPictureTabStrip(doc);
			const strip = tabStrip?.strip || doc.querySelector<HTMLElement>(
				'[role="tablist"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"]'
			);
			if (root && strip) {
				installBigPictureGamepadNavigation(doc, root, strip, tabStrip?.controls || new Map());
				return true;
			}
			return false;
		};
		if (!setup()) {
			timer = setTimeout(setup, 80);
		}
		return () => {
			if (timer != null) clearTimeout(timer);
		};
	}, [props.document, props.tab, props.shortcut.id]);

	let content: React.ReactElement;
	switch (props.tab) {
		case 'stuff': content = <StuffTab {...props} />; break;
		case 'community': content = <CommunityTab {...props} />; break;
		case 'info': content = <SafeTabFallback {...props} />; break;
		default: content = <ActivityTab {...props} />; break;
	}

	const nav = React.useMemo(() => resolveSteamNav(props.document), [props.document]);
	const NavContext = nav?.navContext || getNavContext(props.document);
	const parentNavNode = nav?.navNode;
	const ConfigContext = React.useMemo(() => resolveNativeConfigContext(props.document), [props.document]);

	const rootElement = (
		<NativeDetailsBoundary key={`${props.tab}-${props.shortcut.id}-${props.shortcut.steamAppId}`} name={props.tab} fallback={<SafeTabFallback {...props} />}>
			<NativeFocusable flow-children="column" focusable={false} className={nativeClasses(classes.Section?.AppDetailsSectionContainer)}>
				{content}
			</NativeFocusable>
		</NativeDetailsBoundary>
	);

	let element = rootElement;
	if (NavContext && parentNavNode) {
		element = <NavContext.Provider value={parentNavNode}>{element}</NavContext.Provider>;
	}
	if (ConfigContext) {
		element = <ConfigContext.Provider value={{ IN_GAMEPADUI: true }}>{element}</ConfigContext.Provider>;
	}
	return element;
}

export interface ReactRootHandle {
	render(node: ReactNode): void;
	unmount(): void;
}

const nativeRoots = new WeakMap<HTMLElement, ReactRootHandle>();

export function findReactDom(doc: Document): any | null {
	const docWindow = doc.defaultView as any;
	const globalWindow = typeof window !== 'undefined' ? (window as any) : null;
	const candidates = [docWindow?.SP_REACTDOM, docWindow?.ReactDOM];
	if (globalWindow === docWindow) candidates.push(globalWindow?.SP_REACTDOM, globalWindow?.ReactDOM);
	for (const candidate of candidates) {
		if (candidate && (typeof candidate.createRoot === 'function' || (typeof candidate.render === 'function' && typeof candidate.unmountComponentAtNode === 'function'))) return candidate;
	}
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidates = [module.exports, module.exports?.default, ...Object.values(module.exports || {})];
		for (const candidate of candidates) {
			if (candidate && (typeof (candidate as any).createRoot === 'function' || (typeof (candidate as any).render === 'function' && typeof (candidate as any).unmountComponentAtNode === 'function'))) return candidate;
		}
	}
	return null;
}

export function mountNativeBigPictureDetails(container: HTMLElement, props: NativeDetailsProps): boolean {
	ensureBigPictureDetailStyles(container.ownerDocument);
	let root = nativeRoots.get(container);
	if (!root) {
		const reactDom = findReactDom(container.ownerDocument);
		if (!reactDom) return false;
		if (typeof reactDom.createRoot === 'function') root = reactDom.createRoot(container) as ReactRootHandle;
		else root = { render: node => reactDom.render(node, container), unmount: () => reactDom.unmountComponentAtNode?.(container) };
		nativeRoots.set(container, root);
	}
	root.render(<NativeBigPictureDetails {...props} />);
	return true;
}

export function unmountNativeBigPictureDetails(container: HTMLElement | null): void {
	if (!container) return;
	const root = nativeRoots.get(container);
	if (!root) return;
	try { root.unmount(); } catch {}
	nativeRoots.delete(container);
}
