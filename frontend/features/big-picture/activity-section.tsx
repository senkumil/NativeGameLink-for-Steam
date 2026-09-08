import React, { useState } from 'react';
import { DialogButton, Focusable, IconsModule, ModalRoot, showModal } from '@steambrew/client';
import type { FriendPlayInfo, NewsItem } from '../../domain/types';
import { gdlText, loc, steamIntlLocale } from '../../steam/localization';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { eventTypeLabel, newsExcerpt } from '../library/news';
import { getCurrentSteamUser, loadLocalActivityPosts, saveLocalActivityPost, type LocalActivityPost } from '../library/social/feed';
import { getCachedPersona } from '../library/social/personas';
import { dismissBigPictureFocusRing } from './gamepad-nav';
import { showSteamVirtualKeyboard, hideSteamVirtualKeyboard } from '../../steam/gamepad/virtual-keyboard';
import { resolveNativePostTextEntryComponent, resolveNativeFocusableTextarea } from '../../steam/gamepad/components/AppDetailsNativeComponents';
import type { BigPictureDetailData, MappedShortcut } from './types';

const NativeFocusable = Focusable as React.ComponentType<any>;
const NativeButton = DialogButton as React.ComponentType<any>;
const NativeIcons = IconsModule as Record<string, React.ComponentType<any>>;

function nativeClasses(...values: Array<string | null | false | undefined>): string | undefined {
	const value = values.filter(Boolean).join(' ');
	return value || undefined;
}

function newsDate(item: NewsItem): string {
	return Number(item.date || 0) > 0 ? new Date(Number(item.date) * 1000).toLocaleDateString(steamIntlLocale()) : '';
}

function newsDayKey(item: NewsItem): string {
	const timestamp = Number(item.date || 0);
	if (timestamp <= 0) return 'unknown';
	const date = new Date(timestamp * 1000);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function newsDayLabel(item: NewsItem): string {
	const timestamp = Number(item.date || 0);
	if (timestamp <= 0) return loc('AppDetails_Activity_Recent', 'Reciente');
	try {
		const date = new Date(timestamp * 1000);
		return new Intl.DateTimeFormat(steamIntlLocale(), {
			day: 'numeric',
			month: 'long',
			...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }),
		}).format(date);
	} catch {
		return newsDate(item);
	}
}

function showNativeNewsModal(doc: Document, item: NewsItem, imageUrl: string | undefined, classes: NativeAppDetailsClasses): void {
	dismissBigPictureFocusRing(doc);
	let handle: { Close(): void } | undefined;
	const close = () => {
		dismissBigPictureFocusRing(doc);
		handle?.Close();
	};
	const title = item.title || loc('AppDetails_SectionTitle_News', 'Noticias');
	const type = item.event_type ? eventTypeLabel(Number(item.event_type)) : (item.feedlabel || gdlText('feed_news', 'News'));
	const date = newsDate(item);
	const text = newsExcerpt(item.contents || '', 2000);
	const event = classes.ActivityEvent;

	try {
		handle = showModal(
			<ModalRoot onCancel={close} closeModal={close} bAllowFullSize>
				<div className={nativeClasses(event?.Event, event?.PartnerEvent, event?.PartnerEventMediumImage)}>
					{imageUrl ? (
						<div className={nativeClasses(event?.MediumImageContainer, classes.Media?.ScreenshotModal)}>
							<img className={event?.PartnerEventMediumImage_Image} src={imageUrl} alt="" width="100%" />
						</div>
					) : null}
					<div className={event?.PartnerEventType}>{type} {date ? `• ${date}` : ''}</div>
					<div className={event?.PartnerEventMediumImage_Title}>{title}</div>
					<div className={event?.PartnerEventMediumImage_Summary}>{text}</div>
					<div className={classes.PostTextEntry?.Controls}>
						{item.url ? (
							<NativeButton {...clickProps(() => { close(); openSteamNavigationUrl(doc, item.url); })}>
								{loc('AppDetails_ViewNewsOnline', 'Ver en Steam')}
							</NativeButton>
						) : null}
						<NativeButton {...clickProps(close)}>
							{loc('Button_Close', 'Cerrar')}
						</NativeButton>
					</div>
				</div>
			</ModalRoot>,
			(doc.defaultView || doc.body) as EventTarget,
			{ strTitle: title, bNeverPopOut: true, bHideMainWindowForPopouts: false },
		);
	} catch {
		if (item.url) openSteamNavigationUrl(doc, item.url);
	}
}

function clickProps(action: () => void): { onClick: () => void } {
	return { onClick: action };
}

function ActivityEventCard({
	item,
	shortcut,
	data,
	classes,
	document,
}: {
	item: NewsItem;
	shortcut: MappedShortcut;
	data: BigPictureDetailData;
	classes: NativeAppDetailsClasses;
	document: Document;
}): React.ReactElement {
	const event = classes.ActivityEvent;
	const type = item.event_type ? eventTypeLabel(Number(item.event_type)) : (item.feedlabel || gdlText('feed_news', 'News'));
	const description = newsExcerpt(item.contents || '', 260);
	const imageUrl = item.image
		|| data.game?.header_image
		|| `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${shortcut.steamAppId}/header.jpg`;
	const activate = () => showNativeNewsModal(document, item, imageUrl, classes);

	if (imageUrl) {
		return (
			<div className={nativeClasses(event?.Event, event?.PartnerEvent, event?.PartnerEventMediumImage)}>
				<NativeFocusable focusable onActivate={activate} {...clickProps(activate)} className={event?.PartnerEventMediumImage_Container}>
					<div className={event?.PartnerEventMediumImage_Contents}>
						<div className={event?.MediumImageContainer}><img className={event?.PartnerEventMediumImage_Image} src={imageUrl} alt="" /></div>
						<div className={event?.PartnerEventMediumImage_TextColumn}>
							<div className={event?.PartnerEventType}>{type}</div>
							<div className={event?.PartnerEventMediumImage_Title}>{item.title}</div>
							{description ? <div className={event?.PartnerEventMediumImage_Summary}>{description}</div> : null}
						</div>
					</div>
				</NativeFocusable>
			</div>
		);
	}
	return (
		<div className={nativeClasses(event?.Event, event?.PartnerEvent, event?.PartnerEventTextOnly)}>
			<NativeFocusable focusable onActivate={activate} {...clickProps(activate)} className={event?.PartnerEventTextOnly_Container}>
				<div className={event?.PartnerEventTextOnly_Icon}>{NativeIcons.Patch ? <NativeIcons.Patch /> : null}</div>
				<div className={event?.PartnerEventTextOnly_TextColumn}>
					<div className={event?.PartnerEventType}>{type}</div>
					<div className={event?.PartnerEventTextOnly_Title}>{item.title}</div>
					{description ? <div className={event?.PartnerEventTextOnly_LimitedSummary}><span className={event?.PartnerEventTextOnly_Summary}>{description}</span></div> : null}
				</div>
			</NativeFocusable>
		</div>
	);
}

function PostTextEntry({
	steamAppId,
	shortcutAppId,
	classes,
	onPostAdded,
	document: targetDoc,
}: {
	steamAppId: string;
	shortcutAppId: string;
	classes: NativeAppDetailsClasses;
	onPostAdded: () => void;
	document?: Document;
}): React.ReactElement {
	const postClasses = classes.PostTextEntry;
	const eventClasses = classes.ActivityEvent;
	const document = targetDoc || (typeof window !== 'undefined' ? window.document : undefined);

	const NativePostEntry = resolveNativePostTextEntryComponent(document);
	void NativePostEntry;
	const NativeFocusableArea = resolveNativeFocusableTextarea(document);
	const InputArea = NativeFocusableArea || 'textarea';

	const [active, setActive] = useState(false);
	const [text, setText] = useState('');
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const user = React.useMemo(() => getCurrentSteamUser(document || window.document), [document]);
	const placeholder = loc('AppActivity_StatusUpdate_Post', 'Diles algo sobre este juego a tus amigos...');

	const handlePublish = () => {
		const trimmed = text.trim();
		if (!trimmed) return;
		const newPost: LocalActivityPost = {
			id: `post-${Date.now()}`,
			text: trimmed,
			timestamp: Math.floor(Date.now() / 1000),
			user_name: user.name || loc('AppActivity_StatusUpdate_CurrentUser', 'Tú'),
			user_avatar: user.avatar || '',
		};
		saveLocalActivityPost(steamAppId, newPost, shortcutAppId);
		setText('');
		setActive(false);
		hideSteamVirtualKeyboard(document);
		onPostAdded();
	};

	const activateComposer = () => {
		setActive(true);
		showSteamVirtualKeyboard(document, textareaRef.current);
		setTimeout(() => {
			if (textareaRef.current) {
				textareaRef.current.focus();
				showSteamVirtualKeyboard(document, textareaRef.current);
			}
		}, 30);
	};

	return (
		<NativeFocusable
			focusable
			onActivate={activateComposer}
			{...clickProps(activateComposer)}
			className={nativeClasses(postClasses?.PostTextEntry, 'gdl-bp-post-entry-bar')}
			style={{
				width: '100%',
				minHeight: '44px',
				display: 'flex',
				alignItems: 'center',
				padding: '6px 14px',
				borderRadius: '4px',
				cursor: 'text',
				boxSizing: 'border-box',
				marginBottom: '8px',
				gap: '12px',
			}}
		>
			{user.avatar ? (
				<img
					src={user.avatar}
					alt=""
					style={{
						width: '28px',
						height: '28px',
						borderRadius: '50%',
						flexShrink: 0,
						objectFit: 'cover',
					}}
				/>
			) : null}
			{active ? (
				<InputArea
					ref={textareaRef}
					autoFocus
					rows={1}
					value={text}
					onChange={(e: any) => setText(e.target?.value ?? '')}
					placeholder={placeholder}
					className={postClasses?.PostTextEntryArea}
					onFocus={() => showSteamVirtualKeyboard(document, textareaRef.current)}
					onClick={() => showSteamVirtualKeyboard(document, textareaRef.current)}
					onBlur={() => {
						if (!text.trim()) {
							setActive(false);
							hideSteamVirtualKeyboard(document);
						}
					}}
					onKeyDown={(e: any) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							handlePublish();
						} else if (e.key === 'Escape') {
							setActive(false);
							hideSteamVirtualKeyboard(document);
						}
					}}
					style={{
						flex: 1,
						background: 'transparent',
						border: 'none',
						outline: 'none',
						color: '#ffffff',
						fontSize: '14px',
						fontFamily: 'inherit',
						padding: 0,
						margin: 0,
						boxShadow: 'none',
						resize: 'none',
					}}
				/>
			) : (
				<div
					className={nativeClasses(eventClasses?.StatusText, postClasses?.Label)}
					style={{
						fontStyle: 'italic',
						fontSize: '14px',
						color: 'rgba(148, 161, 166, 0.7)',
						userSelect: 'none',
						flex: 1,
					}}
				>
					{placeholder}
				</div>
			)}
		</NativeFocusable>
	);
}


export function FriendsSection(props: {
	data: BigPictureDetailData;
	shortcut: MappedShortcut;
	classes: NativeAppDetailsClasses;
	SectionComponent: React.ComponentType<any>;
	document?: Document;
}): React.ReactElement | null {
	const played = [...(props.data.friends?.recentlyPlayed || []), ...(props.data.friends?.previouslyPlayed || [])];
	const wishlisted = props.data.friends?.wishlisted || [];
	if (played.length === 0 && wishlisted.length === 0) return null;
	const native = props.classes.Friends;
	const Section = props.SectionComponent;
	const doc = props.document || (typeof window !== 'undefined' ? window.document : undefined);

	const renderSubsection = (friends: FriendPlayInfo[], title: string) => (
		<div
			className={nativeClasses(native?.Subsection, native?.FriendsPlayingHalfSection)}
			style={{ flex: 1, minWidth: 0 }}
		>
			<div
				className={nativeClasses(native?.SubsectionHeader, native?.FriendsSectionSubHeading)}
				style={{
					fontSize: '11px',
					fontWeight: 700,
					color: '#8f98a0',
					textTransform: 'uppercase',
					letterSpacing: '0.5px',
					marginBottom: '10px',
				}}
			>
				{title}
			</div>
			<div
				className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlayingAvatarGrid)}
				style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
			>
				{friends.slice(0, 8).map(friend => {
					const persona = getCachedPersona(friend.steamid);
					const openProfile = () => {
						if (doc) openSteamNavigationUrl(doc, `https://steamcommunity.com/profiles/${friend.steamid}`);
					};
					return (
						<NativeFocusable
							key={friend.steamid}
							focusable
							role="button"
							onActivate={openProfile}
							{...clickProps(openProfile)}
							className={nativeClasses(native?.GamepadFriendSectionItem, native?.GamepadFriendSectionItemLong, 'gdl-bp-friend-card')}
							style={{
								display: 'flex',
								alignItems: 'center',
								height: '52px',
								padding: '0 8px',
								background: 'rgba(255, 255, 255, 0.06)',
								borderRadius: '4px',
								cursor: 'pointer',
								boxSizing: 'border-box',
							}}
						>
							<div
								className={nativeClasses(native?.AvatarAndLabel)}
								style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}
							>
								{persona?.avatar ? (
									<img
										src={persona.avatar}
										alt=""
										style={{
											width: '40px',
											height: '40px',
											borderRadius: '4px',
											flexShrink: 0,
											objectFit: 'cover',
										}}
									/>
								) : null}
								<div
									className={nativeClasses(native?.LabelHolder)}
									style={{
										fontSize: '14px',
										fontWeight: 500,
										color: '#e1e7ec',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{persona?.name || friend.steamid}
								</div>
							</div>
						</NativeFocusable>
					);
				})}
			</div>
		</div>
	);

	return (
		<Section classes={props.classes} label={loc('AppDetails_Friends_Title', 'Amigos')} className={native?.FriendsSection}>
			<div
				className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlaying)}
				style={{
					display: 'flex',
					flexDirection: 'row',
					gap: '24px',
					width: '100%',
					boxSizing: 'border-box',
					marginBottom: '24px',
				}}
			>
				{played.length > 0 ? renderSubsection(played, loc('AppDetails_Friends_PlayedPreviously_Header', 'Jugado(s) anteriormente')) : null}
				{wishlisted.length > 0 ? renderSubsection(wishlisted, loc('AppDetails_Friends_OnWishlist', 'En su lista de deseados')) : null}
			</div>
		</Section>
	);
}

export function FallbackActivitySection(props: {
	data: BigPictureDetailData;
	shortcut: MappedShortcut;
	classes: NativeAppDetailsClasses;
	hydrating: boolean;
	document: Document;
	SectionComponent: React.ComponentType<any>;
	LoadingComponent: React.ComponentType<any>;
}): React.ReactElement {
	const activity = props.classes.Activity;
	const shortcutIdStr = String(props.shortcut.id);
	const [posts, setPosts] = useState<LocalActivityPost[]>(() => loadLocalActivityPosts(props.shortcut.steamAppId, shortcutIdStr));
	const [limit, setLimit] = useState(12);

	React.useEffect(() => {
		setPosts(loadLocalActivityPosts(props.shortcut.steamAppId, shortcutIdStr));
		setLimit(12);
	}, [props.shortcut.id, props.shortcut.steamAppId, shortcutIdStr]);

	const news = [...props.data.news].filter(item => item?.title).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
	const visibleNews = news.slice(0, limit);
	const dayGroups = visibleNews.reduce<Array<{ key: string; label: string; items: NewsItem[] }>>((groups, item) => {
		const key = newsDayKey(item);
		const current = groups[groups.length - 1];
		if (current?.key === key) current.items.push(item);
		else groups.push({ key, label: newsDayLabel(item), items: [item] });
		return groups;
	}, []);
	const event = props.classes.ActivityEvent;
	const Section = props.SectionComponent;
	const LoadingContent = props.LoadingComponent;

	return (
		<Section classes={props.classes} label={loc('AppDetails_SectionTitle_Activity', 'Actividad')} className={activity?.ActivityFeedContainer} bodyClassName={activity?.InnerContainer}>
			<PostTextEntry
				steamAppId={props.shortcut.steamAppId}
				shortcutAppId={shortcutIdStr}
				classes={props.classes}
				document={props.document}
				onPostAdded={() => setPosts(loadLocalActivityPosts(props.shortcut.steamAppId, shortcutIdStr))}
			/>
			<div
				className={event?.Headline}
				style={{
					display: 'flex',
					justifyContent: 'flex-end',
					marginTop: '4px',
					marginBottom: '16px',
				}}
			>
				<NativeFocusable
					focusable
					role="link"
					onActivate={() => openSteamNavigationUrl(props.document, `https://steamcommunity.com/app/${props.shortcut.steamAppId}/allnews/`)}
					{...clickProps(() => openSteamNavigationUrl(props.document, `https://steamcommunity.com/app/${props.shortcut.steamAppId}/allnews/`))}
					style={{
						fontSize: '13px',
						color: '#8f98a0',
						cursor: 'pointer',
						textDecoration: 'none',
					}}
				>
					<span>{loc('AppActivity_ViewLatestNews', 'Ver las últimas novedades')}</span>
				</NativeFocusable>
			</div>
			{posts.slice(0, 4).map(post => (
				<div key={post.id} className={props.classes.ActivityEvent?.Event} style={{ marginBottom: '16px' }}>
					<NativeFocusable
						focusable
						className={props.classes.ActivityEvent?.UserStatus}
						style={{
							background: 'rgba(255, 255, 255, 0.05)',
							borderRadius: '4px',
							padding: '12px 16px',
						}}
					>
						<div
							className={props.classes.ActivityEvent?.EventHeadline}
							style={{ fontSize: '14px', fontWeight: 600, color: '#e1e7ec', marginBottom: '4px' }}
						>
							{post.user_name || gdlText('user_status', 'Status post')}
						</div>
						<div
							className={props.classes.ActivityEvent?.StatusText}
							style={{ fontSize: '13px', color: '#acb2b8' }}
						>
							{post.text}
						</div>
					</NativeFocusable>
				</div>
			))}
			{dayGroups.map(group => (
				<div key={group.key} className={event?.AppActivityDay} role="region" style={{ marginBottom: '24px' }}>
					<div
						className={event?.AppActivityDate}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '12px',
							fontSize: '13px',
							fontWeight: 600,
							color: '#8f98a0',
							textTransform: 'uppercase',
							marginBottom: '16px',
						}}
					>
						<span style={{ whiteSpace: 'nowrap' }}>{group.label}</span>
						<div
							className={event?.Rule}
							style={{
								flex: 1,
								height: '1px',
								background: 'rgba(255, 255, 255, 0.1)',
							}}
						/>
					</div>
					<div className={event?.AppDayContents}>
						{group.items.map(item => (
							<ActivityEventCard
								key={item.gid || item.url || item.title}
								item={item}
								shortcut={props.shortcut}
								data={props.data}
								classes={props.classes}
								document={props.document}
							/>
						))}
					</div>
				</div>
			))}
			{limit < news.length ? (
				<div className={activity?.FetchMoreContainer} style={{ marginTop: '16px', marginBottom: '24px' }}>
					<NativeButton onActivate={() => setLimit(value => value + 12)} {...clickProps(() => setLimit(value => value + 12))}>
						{loc('AppDetails_Activity_LoadMore', 'Cargar más actividad')}
					</NativeButton>
				</div>
			) : null}
			{posts.length === 0 && news.length === 0 ? (
				<LoadingContent hydrating={props.hydrating} className={activity?.NoActivity} empty={gdlText('no_recent_activity', 'No recent activity.')} />
			) : null}
		</Section>
	);
}
