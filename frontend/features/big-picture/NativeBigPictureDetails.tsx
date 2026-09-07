import React, { Component, type ReactNode } from 'react';
import { DialogButton, Focusable, IconsModule, ModalRoot, ProgressBar, Spinner, showModal } from '@steambrew/client';
import { backendLog } from '../../api/backend';
import { steamGameMainPageUrl } from '../../core/steam-links';
import type { CommunityContentItem, LocalAchievementItem } from '../../domain/types';
import { gdlText, loc } from '../../steam/localization';
import {
	resolveNativeAppDetailsClasses,
	resolveNativeSummaryCarousel,
	type NativeAppDetailsClasses,
	type NativeClassModule,
} from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import {
	compareEarnedAchievementsForDisplay,
	compareLockedAchievementsForDisplay,
	highlightedAchievementNames,
} from '../achievements/rarity';
import { steamNativeGameInfo } from '../library/native-game-model';
import { getResolvedLibraryAssets } from '../library/library-assets';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import {
	resolveNativeTradingCardComponent,
	resolveNativeDLCComponent,
	resolveNativeScreenshotsComponent,
	resolveNativeReviewComponent,
	resolveNativeNotesComponent,
	resolveNativeWorkshopComponent,
	resolveNativeAppDetails,
	openNativeAchievementsScreen,
	getNavContext,
	resolveSteamNav,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import { FriendsSection, FallbackActivitySection } from './activity-section';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { installBigPictureGamepadNavigation, disposeBigPictureGamepadNavigation } from './gamepad-nav';
import { findBigPictureTabStrip } from './tabs';
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
	let handle: { Close(): void } | undefined;
	const close = () => handle?.Close();
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
	const classes = resolveNativeAppDetailsClasses();
	const event = classes.ActivityEvent;
	void (
		event?.PartnerEventMediumImage_Container,
		event?.AppActivityDay,
		event?.AppActivityDate,
		event?.PartnerEventTextOnly_Icon
	);
	const friendsNode = (
		<NativeDetailsBoundary name="friends" fallback={null}>
			<FriendsSection data={props.data} shortcut={props.shortcut} classes={classes} SectionComponent={Section} />
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
	return <>{friendsNode}{activityNode}</>;
}

function AchievementCarousel({
	items,
	classes,
	name,
	highlightedNames,
	onSelect,
}: {
	items: LocalAchievementItem[];
	classes: NativeAppDetailsClasses;
	name: string;
	highlightedNames?: Set<string>;
	onSelect?: (item: LocalAchievementItem) => void;
}): React.ReactElement | null {
	const [focused, setFocused] = React.useState(0);
	const achievement = classes.Achievement;
	if (items.length === 0) return null;
	return (
		<NativeStrip name={name} className={achievement?.SummaryCarouselContainer}>
			{items.slice(0, 32).map((item, index) => {
				const isHighlighted = highlightedNames ? highlightedNames.has(String(item.name)) : false;
				return (
					<NativeFocusable
						key={item.name}
						focusable
						onFocus={() => setFocused(index)}
						onActivate={onSelect ? () => onSelect(item) : undefined}
						className={nativeClasses(achievement?.AchievementCarouselItem, focused === index && achievement?.Detailed)}
					>
						<img
							className={nativeClasses(
								achievement?.CarouselIcon,
								(index === focused || isHighlighted) && achievement?.Prioritized,
								item.earned ? achievement?.Achieved : achievement?.NotAchieved,
							)}
							src={item.earned ? item.icon : (item.icon_gray || item.icon)}
							alt={focused === index ? '' : (item.display_name || item.name)}
						/>
						{focused === index ? (
							<div className={achievement?.AchivementCarouselItemDetails}>
								<div className={achievement?.Name}>{item.display_name || item.name}</div>
								<div className={achievement?.Description}>{item.description}</div>
								{Number.isFinite(item.global_percent) ? (
									<div className={achievement?.Achieved}>
										{loc('AppDetails_PctUnlocked', `${item.global_percent!.toFixed(1)}% de los jugadores tienen este logro`).replace('%1$s', `${item.global_percent!.toFixed(1)}%`)}
									</div>
								) : null}
							</div>
						) : null}
					</NativeFocusable>
				);
			})}
		</NativeStrip>
	);
}

function AchievementsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses; hideIfEmpty?: boolean }): React.ReactElement | null {
	const achievements = props.data.achievements;
	const total = Math.max(0, Number(achievements?.total || props.data.game?.achievements?.total || 0));
	const unlocked = Math.max(0, Math.min(total, Number(achievements?.unlocked || 0)));
	const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
	const native = props.classes.Achievement;
	const items = achievements?.achievements || [];
	if (props.hideIfEmpty && items.length === 0 && !props.hydrating) return null;

	const earned = items.filter(item => item.earned).sort(compareEarnedAchievementsForDisplay);
	const locked = items.filter(item => !item.earned).sort(compareLockedAchievementsForDisplay);
	const highlightedNames = highlightedAchievementNames(earned);
	const carouselItems = earned.length > 0 ? earned : locked.slice(0, 12);
	const onOpenAchievements = () => openNativeAchievementsScreen(props.document, props.shortcut.steamAppId);
	const highlight = total > 0 ? (
		<div className={nativeClasses(native?.HighlightDiv, percent === 100 && native?.AllAchieved)}>
			{percent === 100 && NativeIcons.Achievement ? <NativeIcons.Achievement className={native?.Ribbon} /> : null}
			<div className={native?.UnlockedLabel}>
				<span>{gdlText('achievements_unlocked', '{unlocked} of {total} achievements unlocked', { unlocked, total })}</span>
				<span className={native?.UnlockedLabelPercent}> ({percent}%)</span>
			</div>
			<div className={native?.AchievementProgressContainer}><NativeProgress nProgress={percent / 100} /></div>
		</div>
	) : null;
	return (
		<Section classes={props.classes} label={loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements'))} highlight={highlight} className={native?.BasicAppDetailsAchievementsSection} bodyClassName={native?.BasicAppDetailsAchievementsSectionBody} rightColumn>
			<AchievementCarousel
				items={carouselItems}
				classes={props.classes}
				name="NativeGameLink Achievements"
				highlightedNames={highlightedNames}
				onSelect={onOpenAchievements}
			/>
			{earned.length > 0 && locked.length > 0 ? (
				<div className={native?.UnachievedSection}>
					<div className={native?.LockedAchievementsLabel}>{loc('AppDetails_Achievements_Locked', 'Logros bloqueados')}</div>
					<AchievementCarousel
						items={locked}
						classes={props.classes}
						name="NativeGameLink Locked Achievements"
						onSelect={onOpenAchievements}
					/>
				</div>
			) : null}
			{items.length > 0 ? (
				<div className={native?.ButtonsGroup}>
					<NativeButton {...clickProps(onOpenAchievements)}>
						{loc('AppDetails_ViewAllAchievements', gdlText('view_all_achievements', 'View all achievements'))}
					</NativeButton>
				</div>
			) : null}
			{items.length === 0 ? <LoadingContent hydrating={props.hydrating} empty={gdlText('no_achievements', 'No achievements found.')} /> : null}
		</Section>
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
			<div className={native?.BadgeSection}>
				<div className={native?.Badge}>
					{badgeImage ? <img className={nativeClasses(native?.BadgeImage, native?.CardImage)} src={badgeImage} alt={badgeTitle} /> : null}
				</div>
				<div className={native?.BadgeInfo}>
					<div className={native?.BadgeName}>{badgeTitle}</div>
					<div className={native?.BadgeLevel}>{badgeLevelLabel}</div>
				</div>
			</div>
			<div className={native?.CardsSection}>
				<div className={nativeClasses(native?.CardsLeft, native?.BadgeMaxed)}>
					{loc('AppDetails_TradingCardsMaxed', 'INSIGNIA DE NIVEL MÁXIMO')}
				</div>
				<NativeStrip name="NativeGameLink Trading Cards" className={native?.SummaryCarouselContainer}>
					{cards.slice(0, 18).map((card, index) => {
						if (NativeTradingCard) {
							return (
								<div
									key={`${card.title}-${index}`}
									className={nativeClasses(native?.TradingCardCarouselItem, native?.Owned)}
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
								</div>
							);
						}
						const openCard = (): void => showNativeImageModal(props.document, card.title, card.artwork || card.image, props.classes);
						return (
							<NativeFocusable
								key={`${card.title}-${index}`}
								focusable
								onActivate={openCard}
								{...clickProps(openCard)}
								className={nativeClasses(native?.TradingCardCarouselItem, native?.Clickable, native?.Owned)}
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

	const onActivate = (): void => {
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
			<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`guide-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium)}>
				<div className={native?.ChildItem}>
					<div className={native?.Guide}>
						<div className={native?.Header}>{loc('AppDetails_Community_Guide', 'Guía de la comunidad')}</div>
						<div className={native?.TopSection}><div className={native?.TopSectionInner}>
							{item.image ? <div className={native?.PreviewContainer}><img className={native?.Preview} src={item.image} alt="" width="360" height="160" /></div> : null}
							<div className={native?.GuideTitle}>{title}</div>
						</div></div>
						{item.description ? <div className={native?.Body}><div className={native?.Description}>{plainText(item.description, 180)}</div></div> : null}
					</div>
				</div>
				{author}
			</NativeFocusable>
		);
	}
	if (item.type === 'video') {
		return (
			<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`video-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium)}>
				<div className={native?.ChildItem}>
					<div className={native?.ArtItem}>
						<div className={native?.PreviewContainer}>
							{item.image ? <img className={native?.Preview} src={item.image} alt={title} width="360" height="160" /> : null}
							{NativeIcons.Play ? <NativeIcons.Play className={nativeClasses(classes.Feature?.Icon, native?.VideoPlayButton)} /> : null}
						</div>
						<div className={native?.BottomSection}><div className={native?.DescriptionRow}>{title}</div></div>
					</div>
				</div>
				{author}
			</NativeFocusable>
		);
	}
	return (
		<NativeFocusable focusable role="gridcell" data-size="Medium" data-id={`${item.type}-${index}`} onActivate={onActivate} {...clickProps(onActivate)} className={nativeClasses(native?.CommunityItem, native?.Medium)}>
			<div className={native?.ChildItem}>
				<div className={native?.ArtItem}>
					<div className={native?.PreviewContainer}>{item.image ? <img className={native?.Preview} src={item.image} alt={title} width="360" height="160" /> : null}</div>
					<div className={native?.BottomSection}><div className={native?.DescriptionRow}>{title}</div></div>
				</div>
			</div>
			{author}
		</NativeFocusable>
	);
}

function rowsOf<T>(values: T[], size: number): T[][] {
	const rows: T[][] = [];
	for (let index = 0; index < values.length; index += size) rows.push(values.slice(index, index + size));
	return rows;
}

function CommunityGrid({ items, classes, document }: { items: CommunityContentItem[]; classes: NativeAppDetailsClasses; document: Document }): React.ReactElement {
	const native = classes.Community;
	return (
		<NativeFocusable role="grid" aria-readonly flow-children="geometric" className={native?.InnerContainer}>
			{rowsOf(items.slice(0, 24), 3).map((row, rowIndex) => (
				<div key={rowIndex} role="row" className={nativeClasses(native?.AppOverviewRow, row.length === 3 ? native?.AnyThree : row.length === 2 ? native?.AnyTwo : native?.Singles)}>
					{row.map((item, index) => <CommunityCard key={`${item.type}-${item.title}-${index}`} item={item} index={rowIndex * 3 + index} classes={classes} document={document} />)}
				</div>
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
	const classes = resolveNativeAppDetailsClasses();
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
	return (
		<Section classes={classes} label={loc('AppDetails_SectionTitle_Community', gdlText('community_content', 'Community content'))} className={classes.Community?.CommunityContentContainer} headerClassName={classes.Community?.HeaderStyles}>
			{items.length > 0 ? <CommunityGrid items={items} classes={classes} document={props.document} /> : <LoadingContent hydrating={props.hydrating} className={classes.Community?.NoContent} empty={loc('AppDetails_Community_NoContent', 'No hay contenido de la comunidad disponible.')} />}
		</Section>
	);
}

function CommunityTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses();
	return <FallbackCommunitySection props={props} classes={classes} />;
}

function AssociationRow({ native, label, values }: { native: NativeClassModule | null; label: string; values: string[] }): React.ReactElement | null {
	if (values.length === 0) return null;
	return <div className={native?.AssociationList}><div className={native?.Label}>{label}</div><div className={native?.Association}>{values.map(value => <span className={native?.Name} key={value}>{value}</span>)}</div></div>;
}

function NativeFeature({ kind, label, classes }: { kind: string; label: string; classes: NativeAppDetailsClasses }): React.ReactElement {
	const native = classes.Feature;
	if (kind === 'achievements') {
		const Icon = NativeIcons.Achievement;
		return <div className={native?.Container}>{Icon ? <Icon className={native?.Icon} /> : null}<div className={native?.Label}>{label}</div></div>;
	}
	if (kind === 'ps4') {
		const PS4Icon = NativeIcons.ControllerType
			? <NativeIcons.ControllerType className={native?.Icon} controllerType={34} />
			: (NativeIcons.Controller ? <NativeIcons.Controller className={native?.Icon} type="ps4" /> : (NativeIcons.ControllerStatus ? <NativeIcons.ControllerStatus className={native?.Icon} /> : null));
		return <div className={native?.Container}>{PS4Icon}<div className={native?.Label}>{label}</div></div>;
	}
	if (kind === 'ps5') {
		const PS5Icon = NativeIcons.ControllerType
			? <NativeIcons.ControllerType className={native?.Icon} controllerType={45} />
			: (NativeIcons.Controller ? <NativeIcons.Controller className={native?.Icon} type="ps5" /> : (NativeIcons.ControllerStatus ? <NativeIcons.ControllerStatus className={native?.Icon} /> : null));
		return <div className={native?.Container}>{PS5Icon}<div className={native?.Label}>{label}</div></div>;
	}
	if (kind === 'controller-partial') {
		const PartialIcon = NativeIcons.ControllerStatus
			? <NativeIcons.ControllerStatus className={native?.Icon} partial={true} />
			: (NativeIcons.Controller ? <NativeIcons.Controller className={native?.Icon} type="xbox" partial={true} /> : null);
		return <div className={native?.Container}>{PartialIcon}<div className={native?.Label}>{label}</div></div>;
	}
	if (kind === 'controller-full') {
		const FullIcon = NativeIcons.ControllerStatus
			? <NativeIcons.ControllerStatus className={native?.Icon} partial={false} />
			: (NativeIcons.Controller ? <NativeIcons.Controller className={native?.Icon} type="xbox" /> : null);
		return <div className={native?.Container}>{FullIcon}<div className={native?.Label}>{label}</div></div>;
	}
	if (kind === 'steam-input' && NativeIcons.FrankenController) {
		return <div className={native?.Container}><NativeIcons.FrankenController className={native?.Icon} /><div className={native?.Label}>{label}</div></div>;
	}

	const iconNames: Record<string, string[]> = {
		'single-player': ['SinglePlayer', 'User'],
		multiplayer: ['MultiPlayer', 'Friends'],
		coop: ['Coop', 'MultiPlayer'],
		cloud: ['CloudSync', 'Cloud'],
		workshop: ['Workshop'],
		'remote-play': ['RemotePlayTogether'],
		'family-sharing': ['FamilySharing'],
	};
	const Icon = (iconNames[kind] || ['Information']).map(name => NativeIcons[name]).find(Boolean);
	return <div className={native?.Container}>{Icon ? <Icon className={native?.Icon} /> : null}<div className={native?.Label}>{label}</div></div>;
}

function InfoTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses();
	const game = props.data.game;
	const native = classes.GameInfo;
	const frame = classes.GameInfoFrame;
	const appid = props.shortcut.steamAppId;
	const modern = getResolvedLibraryAssets(appid);
	const model = game ? steamNativeGameInfo(game, appid, modern) : null;
	const overview = AppStoreAdapter.getAppOverview(Number(appid));
	const franchise = model?.franchise || (Array.isArray(overview?.rgFranchises) ? overview.rgFranchises.join(', ') : '') || modern?.franchise || '';
	const linkClasses = classes.Links;
	const cover = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`;
	const links: Array<[string, string]> = [
		[loc('AppDetails_Links_Store', gdlText('store_page', 'Store page')), steamGameMainPageUrl(appid, game?.is_delisted === true)],
		[loc('AppDetails_Links_Community', gdlText('community_hub', 'Community hub')), `https://steamcommunity.com/app/${appid}`],
		[loc('AppDetails_Links_PointsShop', gdlText('points_shop', 'Points shop')), `https://store.steampowered.com/points/shop/app/${appid}`],
		[loc('AppDetails_Link_Discussions', gdlText('discussions', 'Discussions')), `https://steamcommunity.com/app/${appid}/discussions/`],
		[loc('AppDetails_Link_Guides', gdlText('guides', 'Guides')), `https://steamcommunity.com/app/${appid}/guides/`],
		[loc('AppDetails_Link_Support', gdlText('support', 'Support')), `https://help.steampowered.com/en/wizard/HelpWithGame/?appid=${appid}`],
	];
	return (
		<Section
			classes={classes}
			className={nativeClasses(classes.QuickLinks?.AppDetailsContent, classes.QuickLinks?.GameInfoContainer)}
		>
			<div className={nativeClasses(frame?.AppGameInfoContainer, frame?.AppDetailsExpanded, frame?.SuppressTransition, frame?.Glassy)}>
				<div className={native?.Container}>
					<div className={native?.InnerContainer}>
						<div className={native?.Portrait}><img className={native?.BoxArt} width="100%" src={cover} alt={game?.name || props.shortcut.title} /></div>
						<div className={nativeClasses(native?.Description, native?.SectionContainer)}><div className={native?.GameDescription}>{plainText(model?.description || loc('Loading', 'Cargando…'), 720)}</div></div>
						<div className={nativeClasses(native?.Stats, native?.SectionContainer)}>
							<AssociationRow native={native} label={gdlText('developer', 'Developer')} values={model?.developer ? [model.developer] : []} />
							<AssociationRow native={native} label={gdlText('publisher', 'Publisher')} values={model?.publisher ? [model.publisher] : []} />
							<AssociationRow native={native} label={gdlText('franchise', 'Franchise')} values={franchise ? [franchise] : []} />
							{model?.release ? <div className={native?.Release}><div className={native?.Label}>{gdlText('release_date', 'Release date')}</div><div className={native?.Date}>{model.release}</div></div> : null}
						</div>
						<div className={nativeClasses(native?.FeaturesList, native?.SectionContainer)}>
							{(model?.features || []).map((feature: any) => <NativeFeature key={feature.key} kind={feature.kind} label={feature.label} classes={classes} />)}
						</div>
					</div>
				</div>
				<div className={frame?.GameInfoShadow} />
			</div>
			<NativeFocusable focusable flow-children="row" className={nativeClasses(classes.QuickLinks?.GameInfoQuickLinks || '_2GqvVM-UeNGM7ptNftUVn_')}>
				{links.map(([label, url]) => (
					<NativeFocusable key={label} role="link" className={nativeClasses(linkClasses?.Anchor)} onActivate={() => openSteamNavigationUrl(props.document, url)} {...clickProps(() => openSteamNavigationUrl(props.document, url))} focusable>
						<div className={nativeClasses(linkClasses?.Link)}><span className={nativeClasses(linkClasses?.Text)}>{label}</span></div>
					</NativeFocusable>
				))}
			</NativeFocusable>
		</Section>
	);
}

function SafeTabFallback(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses();
	return <Section classes={classes} label={props.shortcut.title}><LoadingContent hydrating={props.hydrating} empty={loc('Loading', 'Cargando…')} /></Section>;
}

export function NativeBigPictureDetails(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses();

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
		case 'info': content = <InfoTab {...props} />; break;
		default: content = <ActivityTab {...props} />; break;
	}

	const nav = React.useMemo(() => resolveSteamNav(props.document), [props.document]);
	const NavContext = nav?.navContext || getNavContext(props.document);
	const parentNavNode = nav?.navNode;

	const rootElement = (
		<NativeDetailsBoundary key={`${props.tab}-${props.shortcut.id}-${props.shortcut.steamAppId}`} name={props.tab} fallback={<SafeTabFallback {...props} />}>
			<NativeFocusable flow-children="column" focusable={false} className={nativeClasses(classes.Section?.AppDetailsSectionContainer)}>
				{content}
			</NativeFocusable>
		</NativeDetailsBoundary>
	);

	if (NavContext && parentNavNode) {
		return <NavContext.Provider value={parentNavNode}>{rootElement}</NavContext.Provider>;
	}
	return rootElement;
}

export interface ReactRootHandle {
	render(node: ReactNode): void;
	unmount(): void;
}

const nativeRoots = new WeakMap<HTMLElement, ReactRootHandle>();

export function findReactDom(doc: Document): any | null {
	const docWindow = doc.defaultView as any;
	for (const candidate of [docWindow?.SP_REACTDOM, (window as any)?.SP_REACTDOM, docWindow?.ReactDOM, (window as any)?.ReactDOM]) {
		if (candidate && (typeof candidate.createRoot === 'function' || (typeof candidate.render === 'function' && typeof candidate.unmountComponentAtNode === 'function'))) return candidate;
	}
	steamWebpackRuntime.captureRuntime(doc);
	for (const module of steamWebpackRuntime.getAllModules()) {
		const candidates = [module.exports, module.exports?.default, ...Object.values(module.exports || {})];
		for (const candidate of candidates) {
			if (candidate && (typeof (candidate as any).createRoot === 'function' || (typeof (candidate as any).render === 'function' && typeof (candidate as any).unmountComponentAtNode === 'function'))) return candidate;
		}
	}
	return null;
}

export function mountNativeBigPictureDetails(container: HTMLElement, props: NativeDetailsProps): boolean {
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
