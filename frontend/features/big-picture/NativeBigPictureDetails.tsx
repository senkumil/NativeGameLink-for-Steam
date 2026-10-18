import React, { Component, type ReactNode } from 'react';
import { backendLog } from '../../api/backend';
import type { CommunityContentItem } from '../../domain/types';
import { gdlText, loc } from '../../steam/localization';
import {
	resolveNativeAppDetailsClasses,
	type NativeAppDetailsClasses,
} from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { getNativeWindowInstance } from '../../steam/native-window-store';
import {
	resolveNativeAppDetails,
	resolveNativeConfigContext,
	getNavContext,
	resolveSteamNav,
	resolveNativeCommunityComponent,
} from '../../steam/gamepad/components/AppDetailsNativeComponents';
import { FriendsSection, FallbackActivitySection } from './activity-section';
import { NativeBigPictureAchievements } from './NativeBigPictureAchievements';
import { getCachedLocalAchievementsForShortcut } from '../achievements/cache';
import { getInstantPlaytimeStats } from '../playtime/service';
import { isShortcutPlaytimeTrackingEnabled } from '../playtime/playtime-settings';
import { NativeBigPictureCarousel } from './NativeBigPictureCarousel';
import { NativeBigPictureTradingCards } from './NativeBigPictureTradingCards';
import { openSteamNavigationUrl, extractCommunityYoutubeId } from '../../steam/navigation';
import { installBigPictureGamepadNavigation, returnBigPictureFocusToTabs, performBigPictureSemanticAction, switchBigPictureNativeTab } from './gamepad-nav';
import { findBigPictureTabStrip } from './tabs';
import { ensureBigPictureDetailStyles } from './details-styles';
import type { BigPictureDetailData, BigPictureTab, MappedShortcut } from './types';
import { showNativeImageModal, showNativeVideoModal } from './media-modals';
import { isBigPictureActionCurrent } from './detail-target';
import { createBigPictureDetailViews } from './detail-views';
import { InformationTab } from './information-tab';
import { NativeFocusable, NativeButton, NativeProgress, NativeSpinner, NativeIcons, BigPictureUIProvider } from './document-primitives';
import { getDocumentReact, getDocumentRenderer, resolveNativeFocusable } from '../../steam/gamepad/document-ui-runtime';
import { getMountedBigPictureNavNode } from './native-focus';
import { resolveNativeStuffComponents } from '../../steam/gamepad/components/NativeStuffComponents';

export interface NativeDetailsProps {
	tab: BigPictureTab;
	shortcut: MappedShortcut;
	data: BigPictureDetailData;
	hydrating: boolean;
	document: Document;
	generation?: number;
	panel?: HTMLElement | null;
	onCommitted?: () => void;
	onRuntimeInvalidated?: () => void;
	renderSession?: NativeDetailsRenderSession;
}

interface NativeDetailsRenderSession {
	react: typeof React;
	isCurrent(): boolean;
	invalidate(): void;
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

interface SectionProps {
	classes: NativeAppDetailsClasses;
	label?: ReactNode;
	children: ReactNode;
	highlight?: ReactNode;
	className?: string;
	bodyClassName?: string;
	headerClassName?: string;
	rightColumn?: boolean;
}
let sectionSequence = 0;
class Section extends React.Component<SectionProps> {
	private labelId = `gdl-bp-section-${++sectionSequence}`;
	render(): React.ReactElement {
	const { classes, label, children, highlight, className, bodyClassName, headerClassName, rightColumn = false } = this.props;
	const labelId = this.labelId;
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
				focusable={false}
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
}

function NativeStrip({ name, children, className, document }: { name: string; children: ReactNode; className?: string; document?: Document }): React.ReactElement {
	const fallback = <NativeFocusable focusable={false} flow-children="row" className={className}>{children}</NativeFocusable>;
	if (!document) return fallback;
	return (
		<NativeDetailsBoundary name={`${name} carousel`} fallback={fallback}>
			<NativeBigPictureCarousel document={document} name={name} className={className}>{children}</NativeBigPictureCarousel>
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
			<FriendsSection data={props.data} shortcut={props.shortcut} classes={classes} SectionComponent={Section} document={props.document} generation={props.generation} />
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
				generation={props.generation}
				SectionComponent={Section}
				LoadingComponent={LoadingContent}
			/>
		</NativeDetailsBoundary>
	);
	return <div className={nativeClasses('gdl-bp-activity-tab-content')}>{friendsNode}{activityNode}</div>;
}

function AchievementsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses; hideIfEmpty?: boolean }): React.ReactElement | null {
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
		/>
	);
}

function TradingCardsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement | null {
	return <NativeBigPictureTradingCards document={props.document} steamAppId={props.shortcut.steamAppId}
		catalog={props.data.cards} hydrating={props.hydrating} classes={props.classes} Section={Section} Strip={NativeStrip}
		isCurrent={() => isBigPictureActionCurrent(props)}
		onOpenCard={card => showNativeImageModal(props, card.title, card.artwork || card.image, props.classes, true)}
		onOpenBadge={() => openSteamNavigationUrl(props.document, `https://steamcommunity.com/my/gamecards/${props.shortcut.steamAppId}`)} />;
}

function communityItems(data: BigPictureDetailData): CommunityContentItem[] {
	const raw = data.community.length > 0 ? data.community : (data.game?.screenshots || []).map((shot, index) => ({ type: 'screenshot', image: shot.path_full || shot.path_thumbnail, title: `${loc('AppDetails_Community_Screenshot', 'Captura')} ${index + 1}` }));
	return raw.filter(item => Boolean(item && item.image));
}

function CommunityCard({ item, index, classes, owner }: { item: CommunityContentItem; index: number; classes: NativeAppDetailsClasses; owner: NativeDetailsProps }): React.ReactElement {
	const document = owner.document;
	const native = classes.Community;
	const title = item.title || item.label || loc('AppDetails_Community_Screenshot', 'Contenido de la comunidad');
	const author = item.author_name ? <div className={native?.AuthorSection}>{item.author_avatar ? <img className={native?.Avatar} src={item.author_avatar} alt="" /> : null}<div className={native?.AuthorName}>{item.author_name}</div></div> : null;
	const youtubeId = extractCommunityYoutubeId(item);

	const onActivate = (): void => {
		if (!isBigPictureActionCurrent(owner)) return;
		if (item.type === 'video' || youtubeId) {
			if (youtubeId) {
				showNativeVideoModal(owner, title, youtubeId);
				return;
			}
		}
		if (item.type === 'screenshot' && item.image) {
			showNativeImageModal(owner, title, item.image, classes);
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

function CommunityGrid({ items, classes, owner }: { items: CommunityContentItem[]; classes: NativeAppDetailsClasses; owner: NativeDetailsProps }): React.ReactElement {
	const native = classes.Community;
	return (
		<NativeFocusable role="grid" aria-readonly flow-children="geometric" className={nativeClasses(native?.InnerContainer, 'gdl-bp-community-grid')}>
			{items.slice(0, 24).map((item, index) => (
				<CommunityCard key={`${item.type}-${item.title}-${index}`} item={item} index={index} classes={classes} owner={owner} />
			))}
		</NativeFocusable>
	);
}

function ScreenshotsSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement | null {
	// Store promotional images are public metadata, not the user's captures.
	const screenshots = (props.document.defaultView as any)?.SteamClient?.Screenshots;
	const { overview } = createBigPictureDetailViews(props.document, props.shortcut, props.data.game);
	const gameid = String(overview.gameid || '');
	if (typeof screenshots?.ShowScreenshotsOnDisk !== 'function' || !/^\d+$/.test(gameid)) return null;
	return <Section classes={props.classes} label={loc('AppDetails_SectionTitle_Screenshots', 'Capturas y archivos multimedia')} rightColumn>
		<NativeButton {...clickProps(() => {
			if (isBigPictureActionCurrent(props)) screenshots.ShowScreenshotsOnDisk(gameid);
		})}>{loc('ScreenshotManager_ShowOnDisk', 'Mostrar en disco')}</NativeButton>
	</Section>;
}

function NotesSection(props: NativeDetailsProps & { classes: NativeAppDetailsClasses }): React.ReactElement {
	const view = props.document.defaultView as any;
	const instance = getNativeWindowInstance(props.document);
	const inheritedHistory = resolveSteamNav(props.document)?.providers.find(provider => provider.kind === 'router-history')?.value;
	const history = [inheritedHistory, instance?.History, instance?.m_history, view?.tempNavStore?.m_history,
		view?.g_Router?.history, view?.g_Router?.m_history].find(value => typeof value?.push === 'function');
	const openNotes = (): void => {
		if (!isBigPictureActionCurrent(props)) return;
		try {
			// This is Steam's AppNotes route, also used by its native BP section.
			// That page resolves the shortcut's real name for the notes parent.
			history?.push(`/notes/app/${props.shortcut.id >>> 0}/`);
		} catch {}
	};

	return (
		<Section
			classes={props.classes}
			label={loc('AppDetails_SectionTitle_GameNotes', 'Notas')}
			rightColumn
		>
			<NativeButton disabled={!history} {...clickProps(openNotes)}>
				{loc('AppDetails_GameNotes_Open', 'Abrir notas del juego')}
			</NativeButton>
		</Section>
	);
}

function StuffTab(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	const { overview, details } = createBigPictureDetailViews(props.document, props.shortcut, props.data.game);
	const publicDetails = resolveNativeAppDetails(props.document, Number(props.shortcut.steamAppId));

	const sections = resolveNativeStuffComponents(props.document);
	const NativeScreenshots = sections.Media;
	const NativeNotes = sections.Notes;
	const NativeReview = sections.Review;
	const publicView = createBigPictureDetailViews(props.document, { ...props.shortcut, id: Number(props.shortcut.steamAppId) }, props.data.game);
	const NativeDLC = sections.DLC;
	const NativeWorkshop = sections.Workshop;
	// Review actions retain the public AppID, while the displayed duration is
	// this shortcut's measured playtime. These views never replace Steam records.
	const measured = isShortcutPlaytimeTrackingEnabled(props.shortcut.id) ? getInstantPlaytimeStats(props.shortcut.id, props.shortcut.steamAppId) : null;
	const minutes = Math.max(0, measured ? (measured.totalSeconds > 0 ? measured.totalSeconds / 60 : measured.minutesForever)
		: Number(overview.minutes_playtime_forever ?? details.nPlaytimeForever) || 0);
	const reviewOverview = new Proxy(publicView.overview, { get: (target, key) => key === 'minutes_playtime_forever' ? minutes : target[key] });
	const reviewDetails = { ...publicDetails, unAppID: Number(props.shortcut.steamAppId), nPlaytimeForever: minutes };
	const duration = loc(minutes >= 60 ? 'Played_Hours' : 'Played_Minutes', minutes >= 60 ? '%s horas' : '%s minutos')
		.replace(/%\d*\$?[sd]/, minutes >= 60 ? (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(Math.round(minutes)));
	const reviewFallback = minutes < 10 ? null : <Section classes={classes} label={loc('AppDetails_Review_YourReview', 'Mi reseña')} rightColumn>
		<div className={classes.Review?.ReviewMetadata}>{loc('AppDetails_Review_PlayedForTime', 'Has jugado durante %1$s').replace(/%\d*\$?[s]/, duration)}</div>
		<NativeButton {...clickProps(() => {
			if (isBigPictureActionCurrent(props)) openSteamNavigationUrl(props.document, 'https://steamcommunity.com/my/recommended/');
		})}>{loc('AppDetails_Review_ViewAllReviews', 'Ver todas mis reseñas')}</NativeButton>
	</Section>;

	return (
		<>
			<AchievementsSection {...props} classes={classes} />
			<TradingCardsSection {...props} classes={classes} />
			{NativeDLC && publicDetails && props.data.game?.dlc?.length ? (
				<NativeDetailsBoundary name="dlc" fallback={null}>
					<NativeDLC details={publicDetails} showRemainder />
				</NativeDetailsBoundary>
			) : props.data.game?.dlc?.length ? <Section classes={classes} label={loc('AppDetails_SectionTitle_DLC', 'Contenido descargable')}><NativeButton {...clickProps(() => { if (isBigPictureActionCurrent(props)) openSteamNavigationUrl(props.document, `https://store.steampowered.com/dlc/${props.shortcut.steamAppId}/`); })}>{loc('AppDetails_ViewAllDLC', 'Ver contenido descargable')}</NativeButton></Section> : null}
			{NativeWorkshop && publicDetails && props.data.game?.categories?.some(category => category.id === 30) ? (
				<NativeDetailsBoundary name="workshop" fallback={null}>
					<NativeWorkshop details={publicDetails} />
				</NativeDetailsBoundary>
			) : null}
			{NativeScreenshots ? (
				<NativeDetailsBoundary name="screenshots" fallback={<ScreenshotsSection {...props} classes={classes} />}>
					<NativeScreenshots overview={overview} details={details} />
				</NativeDetailsBoundary>
			) : (
				<ScreenshotsSection {...props} classes={classes} />
			)}
			{NativeReview && publicDetails ? <NativeDetailsBoundary name="review" fallback={reviewFallback}>
				<NativeReview overview={reviewOverview} details={reviewDetails} />
			</NativeDetailsBoundary> : reviewFallback}
			{NativeNotes ? (
				<NativeDetailsBoundary name="notes" fallback={<NotesSection {...props} classes={classes} />}>
					<NativeNotes overview={overview} details={details} />
				</NativeDetailsBoundary>
			) : (
				<NotesSection {...props} classes={classes} />
			)}

		</>
	);
}

function FallbackCommunitySection({ props, classes }: { props: NativeDetailsProps; classes: NativeAppDetailsClasses }): React.ReactElement {
	const items = communityItems(props.data).filter(item => item.title || item.image);
	const hubUrl = `https://steamcommunity.com/app/${props.shortcut.steamAppId}`;
	return (
		<Section classes={classes} label={loc('AppDetails_SectionTitle_Community', gdlText('community_content', 'Community content'))} className={classes.Community?.CommunityContentContainer} headerClassName={classes.Community?.HeaderStyles}>
			{items.length > 0 ? (
				<CommunityGrid items={items} classes={classes} owner={props} />
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
	const NativeCommunity = resolveNativeCommunityComponent(props.document);
	const fallback = <FallbackCommunitySection props={props} classes={classes} />;
	return NativeCommunity ? <NativeDetailsBoundary name="community" fallback={fallback}><NativeCommunity appid={Number(props.shortcut.steamAppId)} /></NativeDetailsBoundary> : fallback;
}

function SafeTabFallback(props: NativeDetailsProps): React.ReactElement {
	const classes = resolveNativeAppDetailsClasses(props.document);
	return <Section classes={classes} label={props.shortcut.title}><LoadingContent hydrating={props.hydrating} empty={loc('Loading', 'Cargando…')} /></Section>;
}

export function NativeBigPictureDetails(props: NativeDetailsProps): React.ReactElement | null {
	// A self-update can occur after Steam replaces its runtime. Its hooks must
	// still use the React instance paired with the renderer that owns this root.
	const React = props.renderSession?.react || getDocumentReact(props.document);
	if (!React) return null;
	const runtimeCurrent = props.renderSession?.isCurrent() !== false;
	const classes = runtimeCurrent ? resolveNativeAppDetailsClasses(props.document) : null;
	const [, refreshNavigation] = React.useState(0);
	const [nativeNavHandle, setNativeNavHandle] = React.useState<any>(null);
	const receiveNativeNavHandle = React.useCallback((handle: any) => setNativeNavHandle(handle), []);
	// Providers and navigation nodes belong to a live Steam tree, not merely to
	// its document. Re-resolve after a panel/runtime/session replacement.
	const runtimeIdentity = steamWebpackRuntime.getRuntimeIdentity(props.document);
	const nav = runtimeCurrent ? resolveSteamNav(props.document) : null;
	const NavContext = nav?.navContext || (runtimeCurrent ? getNavContext(props.document) : null);
	const parentNavNode = nav?.navNode;
	const ConfigContext = runtimeCurrent ? resolveNativeConfigContext(props.document) : null;
	const NativeNavigationFocusable = runtimeCurrent ? resolveNativeFocusable(props.document) : null;
	const canRegisterNativeNavigation = Boolean(NavContext?.Provider && typeof parentNavNode?.Tree?.CreateNode === 'function' && NativeNavigationFocusable);
	const NavigationFocusable = (canRegisterNativeNavigation ? NativeNavigationFocusable! : 'div') as React.ElementType<any>;
	const panel = props.panel || props.document.getElementById('gdl-bp-detail-root')?.parentElement || null;
	const panelConnected = Boolean(panel?.isConnected);
	const tabs = findBigPictureTabStrip(props.document);
	const strip = tabs?.strip || props.document.querySelector<HTMLElement>('[role="tablist"], [class*="TabsRow"], [class*="tabsRow"], [class*="TabsStrip"]');
	const controls = tabs?.controls || new Map<BigPictureTab, HTMLElement>();
	const detailRoot = props.document.getElementById('gdl-bp-detail-root');
	const nativeNavigation = Boolean(canRegisterNativeNavigation && detailRoot
		&& getMountedBigPictureNavNode(props.document, detailRoot, parentNavNode, nativeNavHandle));

	React.useLayoutEffect(() => {
		const doc = props.document;
		const root = doc.getElementById('gdl-bp-detail-root');
		if (!runtimeCurrent || !root || !strip) return undefined;
		backendLog(`[NGL][Gamepad][FocusMount] candidate=${canRegisterNativeNavigation} handle=${Boolean(nativeNavHandle)} ready=${nativeNavigation} tab=${props.tab}`);
		return installBigPictureGamepadNavigation(doc, root, strip, controls, {
			authority: panelConnected ? nativeNavigation ? 'native' : canRegisterNativeNavigation ? 'none' : 'fallback' : 'none',
			generation: props.generation, panel, nativeNavNode: parentNavNode, nativeNavHandle,
		});
	}, [props.document, props.tab, props.shortcut.id, props.shortcut.steamAppId, props.generation, panel, panelConnected,
			runtimeIdentity, runtimeCurrent, parentNavNode, NavContext, nativeNavigation, canRegisterNativeNavigation, nativeNavHandle, strip,
		controls.get('activity'), controls.get('stuff'), controls.get('community'), controls.get('info')]);
	React.useLayoutEffect(() => {
		if (!runtimeCurrent) props.renderSession?.invalidate();
		else props.onCommitted?.();
	});
	React.useEffect(() => {
		const view = props.document.defaultView, tree = parentNavNode?.Tree;
		if (!view || !tree || !runtimeCurrent) return undefined;
		let frame = 0, disposed = false;
		const refresh = (): void => {
			if (disposed || frame) return;
			frame = view.requestAnimationFrame(() => { frame = 0; if (!disposed) refreshNavigation(value => value + 1); });
		};
		const registration = tree.OnActiveStateChangedCallbacks?.Register?.(refresh);
		const source = tree.Controller?.NavigationSourceSupportsFocus?.Subscribe?.(refresh);
		return () => {
			disposed = true; if (frame) view.cancelAnimationFrame(frame);
			registration?.Unregister?.();
			if (typeof source === 'function') source(); else if (source?.Unsubscribe) source.Unsubscribe(); else source?.Unregister?.();
		};
	}, [props.document, parentNavNode?.Tree, runtimeCurrent]);

	React.useEffect(() => {
		const doc = props.document, view = doc.defaultView;
		if (!view || !runtimeCurrent) return undefined;
		let disposed = false;
		const probe = (): void => {
			if (disposed || view.closed) return;
			if (props.renderSession && !props.renderSession.isCurrent()) { props.renderSession.invalidate(); return; }
			refreshNavigation(value => value + 1);
		};
		const timers = [80, 250, 750].map(delay => view.setTimeout(probe, delay));
		const observer = new view.MutationObserver(records => {
			if (records.some(record => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
				.some(node => node.nodeType === 1 && !(node as HTMLElement).id?.startsWith('gdl-')))) probe();
		});
		if (panel) observer.observe(panel, { childList: true });
		if (panel?.parentElement) observer.observe(panel.parentElement, { childList: true });
		if (strip) observer.observe(strip, { childList: true, subtree: true });
		if (strip?.parentElement) observer.observe(strip.parentElement, { childList: true });
		return () => { disposed = true; for (const timer of timers) view.clearTimeout(timer); observer.disconnect(); };
	}, [props.document, panel, strip, props.generation, props.shortcut.id, props.shortcut.steamAppId, runtimeCurrent]);
	// Navigation registration/probes update this shell several times. Preserve
	// its content element while data is unchanged instead of rebuilding every
	// achievement, card and native section during each focus registration.
	const achievementSnapshot = getCachedLocalAchievementsForShortcut(props.shortcut.steamAppId, String(props.shortcut.id));
	const content = React.useMemo(() => {
		switch (props.tab) {
			case 'stuff': return <StuffTab {...props} />;
			case 'community': return <CommunityTab {...props} />;
			case 'info': return <InformationTab {...props} Boundary={NativeDetailsBoundary} />;
			default: return <ActivityTab {...props} />;
		}
	}, [props.tab, props.shortcut, props.data, props.hydrating, props.document, props.generation, props.panel, runtimeIdentity, achievementSnapshot]);
	if (!runtimeCurrent) return null;

	const nativeAction = (action: 'back' | 'x' | 'y', event: any): boolean => {
		if (!nativeNavigation || !isBigPictureActionCurrent(props) || event?.defaultPrevented || event?.detail?.is_repeat) return false;
		const handled = action === 'back' ? returnBigPictureFocusToTabs(props.document) : performBigPictureSemanticAction(props.document, action);
		if (handled) { event?.preventDefault?.(); event?.stopPropagation?.(); }
		return handled;
	};
	const nativeInputProps = nativeNavigation ? {
		onCancelButton: (event: any) => nativeAction('back', event),
		onSecondaryButton: (event: any) => nativeAction('x', event),
		onOptionsButton: (event: any) => nativeAction('y', event),
		onButtonDown: (event: any) => {
			if (!isBigPictureActionCurrent(props) || event.defaultPrevented || event.detail?.is_repeat) return;
			if ((event.detail?.button === 5 || event.detail?.button === 6)
				&& switchBigPictureNativeTab(props.document, event.detail.button === 5 ? -1 : 1)) {
				event.preventDefault?.(); event.stopPropagation?.();
			}
		},
	} : {};

	const rootElement = (
		<NativeDetailsBoundary key={`${props.tab}-${props.shortcut.id}-${props.shortcut.steamAppId}`} name={props.tab} fallback={<SafeTabFallback {...props} />}>
			<NavigationFocusable flow-children="column" focusable={false} navRef={canRegisterNativeNavigation ? receiveNativeNavHandle : undefined}
				className={nativeClasses(classes?.Section?.AppDetailsSectionContainer)}
				{...nativeInputProps}>
				{content}
			</NavigationFocusable>
		</NativeDetailsBoundary>
	);

	let element = rootElement;
	if (canRegisterNativeNavigation && NavContext && parentNavNode) {
		element = <NavContext.Provider value={parentNavNode}>{element}</NavContext.Provider>;
	}
	for (const provider of nav?.providers || []) {
		element = <provider.context.Provider value={provider.value}>{element}</provider.context.Provider>;
	}
	if (ConfigContext) {
		element = <ConfigContext.Provider value={{ IN_GAMEPADUI: true }}>{element}</ConfigContext.Provider>;
	}
	return <BigPictureUIProvider document={props.document}>{element}</BigPictureUIProvider>;
}

export interface ReactRootHandle {
	render(node: ReactNode): void;
	unmount(): void;
}

type NativeRootState = { handle: ReactRootHandle; reactDom: any; react: unknown; runtime: object | null;
	owner?: NativeDetailsProps; committedOwner?: NativeDetailsProps; session: NativeDetailsRenderSession;
	invalidated: boolean; remountTimer: number | null; release: () => void };
const nativeRoots = new WeakMap<HTMLElement, NativeRootState>();
const rendererReactOwners = new WeakMap<object, typeof React>();

function isOwnerRenderer(candidate: any, react: typeof React | null): boolean {
	if (!candidate || !react || (typeof candidate !== 'object' && typeof candidate !== 'function')) return false;
	const owner = rendererReactOwners.get(candidate);
	return (!owner || owner === react) && (typeof candidate.createRoot === 'function'
		|| (typeof candidate.render === 'function' && typeof candidate.unmountComponentAtNode === 'function'));
}

export function isNativeBigPictureDetailsRuntimeCurrent(container: HTMLElement): boolean {
	return nativeRoots.get(container)?.session.isCurrent() === true;
}

export function findReactDom(doc: Document): any | null {
	const ownerReact = getDocumentReact(doc);
	const renderer = getDocumentRenderer(doc);
	return isOwnerRenderer(renderer, ownerReact) ? renderer : null;
}

export function mountNativeBigPictureDetails(container: HTMLElement, props: NativeDetailsProps): boolean {
	if (container.ownerDocument !== props.document || !isBigPictureActionCurrent(props)) return false;
	ensureBigPictureDetailStyles(container.ownerDocument);
	const reactDom = findReactDom(props.document), react = getDocumentReact(props.document);
	const runtime = steamWebpackRuntime.getRuntimeIdentity(props.document);
	let state = nativeRoots.get(container);
	if (!reactDom || !react) { if (state) unmountNativeBigPictureDetails(container); return false; }
	if (state && (state.invalidated || state.reactDom !== reactDom || state.react !== react || state.runtime !== runtime)) {
		unmountNativeBigPictureDetails(container); state = undefined;
	}
	if (!state) {
		rendererReactOwners.set(reactDom, react);
		const handle: ReactRootHandle = typeof reactDom.createRoot === 'function' ? reactDom.createRoot(container)
			: { render: node => reactDom.render(node, container), unmount: () => reactDom.unmountComponentAtNode?.(container) };
		const guard = (event: Event) => {
			const live = nativeRoots.get(container);
			if (live?.owner && live.committedOwner === live.owner && live.session.isCurrent()) return;
			if (live?.owner && !live.session.isCurrent()) live.session.invalidate();
			event.preventDefault(); event.stopImmediatePropagation();
		};
		const inputs = ['click', 'keydown', 'vgp_onbuttondown', 'vgp_onbuttonup', 'vgp_oncancel'];
		for (const type of inputs) container.addEventListener(type, guard, true);
		const mounted: NativeRootState = { handle, reactDom, react, runtime, invalidated: false, remountTimer: null,
			session: { react, isCurrent: () => false, invalidate: () => {} }, release: () => {
			for (const type of inputs) container.removeEventListener(type, guard, true);
			if (mounted.remountTimer !== null) props.document.defaultView?.clearTimeout(mounted.remountTimer);
			mounted.remountTimer = null;
		} };
		mounted.session = {
			react,
			isCurrent: () => !mounted.invalidated && nativeRoots.get(container) === mounted && Boolean(mounted.owner && isBigPictureActionCurrent(mounted.owner))
				&& getDocumentReact(props.document) === react && findReactDom(props.document) === reactDom
				&& steamWebpackRuntime.getRuntimeIdentity(props.document) === runtime,
			invalidate: () => {
				if (mounted.invalidated || nativeRoots.get(container) !== mounted) return;
				mounted.invalidated = true;
				mounted.owner?.onRuntimeInvalidated?.();
				const view = props.document.defaultView;
				if (!view || view.closed || view.document !== props.document) return;
				// Never unmount synchronously inside the old renderer's commit.
				mounted.remountTimer = view.setTimeout(() => {
					mounted.remountTimer = null;
					if (nativeRoots.get(container) !== mounted) return;
					const owner = mounted.owner;
					if (owner && isBigPictureActionCurrent(owner)) mountNativeBigPictureDetails(container, owner);
					else unmountNativeBigPictureDetails(container);
				}, 0);
			},
		};
		state = mounted; nativeRoots.set(container, state);
	}
	const changingPanel = Boolean(state.committedOwner && (state.committedOwner.tab !== props.tab
		|| state.committedOwner.panel !== props.panel || state.committedOwner.shortcut.id !== props.shortcut.id
		|| state.committedOwner.shortcut.steamAppId !== props.shortcut.steamAppId || state.committedOwner.generation !== props.generation));
	state.owner = props;
	const expected = state;
	container.hidden = false;
	const render = () => state!.handle.render(react.createElement(NativeBigPictureDetails, { ...props, renderSession: state!.session, onCommitted: () => {
		if (nativeRoots.get(container) !== expected || expected.owner !== props || !expected.session.isCurrent()) return;
		expected.committedOwner = props;
		props.onCommitted?.();
	} }));
	// A native tab can already be selected while a concurrent root still shows
	// its previous tab. Commit the replacement before the browser paints it.
	if (changingPanel && typeof reactDom.flushSync === 'function') reactDom.flushSync(render);
	else render();
	return true;
}

export function unmountNativeBigPictureDetails(container: HTMLElement | null): void {
	if (!container) return;
	const root = nativeRoots.get(container);
	if (!root) return;
	nativeRoots.delete(container);
	root.release();
	try { root.handle.unmount(); } catch {}
}
