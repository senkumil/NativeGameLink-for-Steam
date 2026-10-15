import React from 'react';
import type { FriendPlayInfo, NewsItem } from '../../domain/types';
import { gdlText, loc, steamIntlLocale } from '../../steam/localization';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { eventTypeLabel, newsExcerpt } from '../library/news';
import { getCurrentSteamUser, loadLocalActivityPosts, saveLocalActivityPost, type LocalActivityPost } from '../library/social/feed';
import { getCachedPersona } from '../library/social/personas';
import { getDocumentReact } from '../../steam/gamepad/document-ui-runtime';
import { NativeFocusable, NativeButton, NativeIcons } from './document-primitives';
import { showBigPictureModal } from './owned-modals';
import { isBigPictureActionCurrent, type BigPictureActionOwner } from './detail-target';
import { EXIT_TEXT_EDITOR_EVENT } from './editable-target';
import { showSteamVirtualKeyboard, hideSteamVirtualKeyboard } from '../../steam/gamepad/virtual-keyboard';
import type { BigPictureDetailData, MappedShortcut } from './types';



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

function decodeNewsEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'");
}

function cleanNewsModalText(contents: string): string {
	return decodeNewsEntities(String(contents || ''))
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<\/p\s*>/gi, '\n\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\[\*\]/g, '\n• ')
		.replace(/\[\/\*\]/g, '')
		.replace(/\[(?:list|olist|ul|ol)(?:=[^\]]+)?\]/gi, '\n')
		.replace(/\[\/(?:list|olist|ul|ol)\]/gi, '\n')
		.replace(/\[url(?:=[^\]]+)?\]/gi, '')
		.replace(/\[\/url\]/gi, '')
		.replace(/\[img(?:=[^\]]+)?\][\s\S]*?\[\/img\]/gi, '')
		.replace(/\[\/?(?:b|i|u|s|h1|h2|h3|quote|code|spoiler|center|left|right|table|tr|td|th)(?:=[^\]]+)?\]/gi, '')
		.replace(/\[[^\]]+\]/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function newsModalParagraphs(contents: string): string[] {
	const clean = cleanNewsModalText(contents);
	if (!clean) return [];
	return clean
		.split(/\n{2,}/)
		.map(block => block.trim())
		.filter(Boolean)
		.slice(0, 36);
}

function showNativeNewsModal(owner: BigPictureActionOwner, item: NewsItem, imageUrl: string | undefined, _classes: NativeAppDetailsClasses): void {
	if (!isBigPictureActionCurrent(owner)) return;
	const doc = owner.document;
	const title = item.title || loc('AppDetails_SectionTitle_News', 'Noticias');
	const type = item.event_type ? eventTypeLabel(Number(item.event_type)) : (item.feedlabel || gdlText('feed_news', 'News'));
	const date = newsDate(item);
	const paragraphs = newsModalParagraphs(item.contents || '');

	const shown = showBigPictureModal(doc, 'gdl-bp-news-modal', title, close => (
				<div className="gdl-bp-news-modal-shell">
					<div className="gdl-bp-news-modal-window">
						{imageUrl ? (
							<div className="gdl-bp-news-modal-hero">
								<img src={imageUrl} alt="" />
							</div>
						) : null}
						<div className="gdl-bp-news-modal-content">
							<div className="gdl-bp-news-modal-meta">{type}{date ? <><span>•</span>{date}</> : null}</div>
							<div className="gdl-bp-news-modal-title">{title}</div>
							<div className="gdl-bp-news-modal-body">
								{paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
									<p key={`${item.gid || item.title}-${index}`} className={paragraph.startsWith('• ') ? 'gdl-bp-news-modal-bullet' : undefined}>
										{paragraph}
									</p>
								)) : <p>{loc('AppDetails_Activity_NoDescription', 'No hay más detalles disponibles.')}</p>}
							</div>
						</div>
						<div className="gdl-bp-news-modal-footer">
							{item.url ? (
								<NativeButton
									className="gdl-bp-news-modal-open"
									{...clickProps(() => { if (!isBigPictureActionCurrent(owner)) return; close(); openSteamNavigationUrl(doc, item.url); })}
								>
									{loc('AppDetails_ViewNewsOnline', 'Ver en Steam')}
								</NativeButton>
							) : null}
							<NativeButton className="gdl-bp-news-modal-close gdl-bp-news-modal-close-btn" {...clickProps(close)}>
								{loc('Button_Close', 'Cerrar')}
							</NativeButton>
						</div>
					</div>
				</div>
	));
	if (!shown && item.url) openSteamNavigationUrl(doc, item.url);
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
	generation,
}: {
	item: NewsItem;
	shortcut: MappedShortcut;
	data: BigPictureDetailData;
	classes: NativeAppDetailsClasses;
	document: Document;
	generation?: number;
}): React.ReactElement {
	const event = classes.ActivityEvent;
	const type = item.event_type ? eventTypeLabel(Number(item.event_type)) : (item.feedlabel || gdlText('feed_news', 'News'));
	const description = newsExcerpt(item.contents || '', 260) || loc('AppActivity_RecommendedGame_ReadMore', 'Read more');
	const imageUrl = item.image
		|| data.game?.header_image
		|| `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${shortcut.steamAppId}/header.jpg`;
	const activate = () => showNativeNewsModal({ document, shortcut, generation }, item, imageUrl, classes);

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
	generation,
}: {
	steamAppId: string;
	shortcutAppId: string;
	classes: NativeAppDetailsClasses;
	onPostAdded: () => void;
	document?: Document;
	generation?: number;
}): React.ReactElement | null {
	const postClasses = classes.PostTextEntry;
	const eventClasses = classes.ActivityEvent;
	const document = targetDoc;
	if (!document) return null;
	const React = getDocumentReact(document);
	if (!React) return null;
	const owner = { document, shortcut: { id: Number(shortcutAppId), steamAppId, title: '' }, generation };
	const [active, setActive] = React.useState(false);
	const [text, setText] = React.useState('');
	const composerRef = React.useRef<HTMLElement | null>(null);
	const textareaRef = React.useRef<HTMLElement | null>(null);
	const user = React.useMemo(() => getCurrentSteamUser(document || window.document), [document]);
	const placeholder = loc('AppActivity_StatusUpdate_Post', 'Diles algo sobre este juego a tus amigos...');

	const resolveKeyboardTarget = React.useCallback((candidate?: unknown): HTMLElement | null => {
		const direct = candidate && typeof candidate === 'object' && typeof (candidate as any).matches === 'function'
			? candidate as HTMLElement
			: textareaRef.current;
		if (direct?.matches?.('textarea, input, [contenteditable="true"], [role="textbox"]')) return direct;
		const nested = direct?.querySelector?.<HTMLElement>('textarea, input, [contenteditable="true"], [role="textbox"]');
		if (nested) return nested;
		return composerRef.current?.querySelector<HTMLElement>('textarea, input, [contenteditable="true"], [role="textbox"]') || null;
	}, []);

	const requestKeyboard = React.useCallback(() => {
		if (!document) return;
		const target = resolveKeyboardTarget();
		if (target) showSteamVirtualKeyboard(document, target);
	}, [document, resolveKeyboardTarget]);

	const handlePublish = () => {
		if (!isBigPictureActionCurrent(owner)) return;
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

	const activateComposer = () => { if (isBigPictureActionCurrent(owner)) setActive(true); };

	React.useEffect(() => {
		if (!document || !active) return undefined;
		const exitEditor = () => {
			setActive(false);
			hideSteamVirtualKeyboard(document);
		};
		document.addEventListener(EXIT_TEXT_EDITOR_EVENT, exitEditor);
		return () => document.removeEventListener(EXIT_TEXT_EDITOR_EVENT, exitEditor);
	}, [active, document]);

	React.useEffect(() => {
		if (!active || !document) return undefined;
		const view = document.defaultView;
		let cancelled = false;
		const focusAndOpen = () => {
			if (cancelled) return;
			const target = resolveKeyboardTarget();
			if (!target) return;
			try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch {} }
			requestKeyboard();
		};
		if (view?.requestAnimationFrame) {
			const frame = view.requestAnimationFrame(focusAndOpen);
			return () => { cancelled = true; view.cancelAnimationFrame(frame); };
		}
		const timer = setTimeout(focusAndOpen, 0);
		return () => { cancelled = true; clearTimeout(timer); };
	}, [active, document, requestKeyboard, resolveKeyboardTarget]);

	if (!active) {
		return (
			<NativeFocusable
				focusable
				onActivate={activateComposer}
				{...clickProps(activateComposer)}
				data-gdl-suppress-focus-ring="1"
				className={nativeClasses(eventClasses?.StatusText, 'gdl-bp-native-status-entry-idle')}
			>
				<span className="gdl-bp-native-status-placeholder">{placeholder}</span>
			</NativeFocusable>
		);
	}

	return (
		<div
			ref={composerRef as any}
			className="gdl-bp-post-entry-active"
		>
			<textarea
				ref={textareaRef as any}
				rows={1}
				value={text}
				onChange={(e: any) => setText(e.target?.value ?? '')}
				placeholder={placeholder}
				className={nativeClasses(postClasses?.PostTextEntryArea, 'gdl-bp-native-status-textarea')}
				onKeyDown={(e: any) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						e.stopPropagation();
						handlePublish();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						setActive(false);
						hideSteamVirtualKeyboard(document);
					}
				}}

			/>
		</div>
	);
}

export function FriendsSection(props: {
	data: BigPictureDetailData;
	shortcut: MappedShortcut;
	classes: NativeAppDetailsClasses;
	SectionComponent: React.ComponentType<any>;
	document?: Document;
	generation?: number;
}): React.ReactElement | null {
	const played = [...(props.data.friends?.recentlyPlayed || []), ...(props.data.friends?.previouslyPlayed || [])];
	const wishlisted = props.data.friends?.wishlisted || [];
	if (played.length === 0 && wishlisted.length === 0) return null;
	const native = props.classes.Friends;
	const Section = props.SectionComponent;
	const doc = props.document || (typeof window !== 'undefined' ? window.document : undefined);

	const renderSubsection = (friends: FriendPlayInfo[], title: string) => (
		<div
			className={nativeClasses(native?.Subsection, native?.FriendsPlayingHalfSection, 'gdl-bp-friends-column-parity')}
		>
			<div className={nativeClasses(native?.SubsectionHeader, native?.FriendsSectionSubHeading, 'gdl-bp-friends-subheading-parity')}>
				{title}
			</div>
			<div
				className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlayingAvatarGrid, 'gdl-bp-friends-list-parity')}
			>
				{friends.slice(0, 8).map(friend => {
					const persona = getCachedPersona(friend.steamid);
					const openProfile = () => {
						if (doc && isBigPictureActionCurrent({ document: doc, shortcut: props.shortcut, generation: props.generation })) openSteamNavigationUrl(doc, `https://steamcommunity.com/profiles/${friend.steamid}`);
					};
					return (
						<NativeFocusable
							key={friend.steamid}
							focusable
							role="button"
							onActivate={openProfile}
							{...clickProps(openProfile)}
							className={nativeClasses(native?.GamepadFriendSectionItem, native?.GamepadFriendSectionItemLong, 'gdl-bp-friend-card-parity')}
						>
							<div className={nativeClasses(native?.AvatarAndLabel, 'gdl-bp-friend-card-inner-parity')}>
								{persona?.avatar ? (
									<img
										src={persona.avatar}
										alt=""
										className={nativeClasses(native?.Avatar, 'gdl-bp-friend-avatar-parity')}
									/>
								) : null}
								<div className={nativeClasses(native?.LabelHolder, 'gdl-bp-friend-name-parity')}>
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
		<Section classes={props.classes} label={loc('AppDetails_Friends_Title', 'Amigos')} className={nativeClasses(native?.FriendsSection, 'gdl-bp-friends-section-parity')}>
			<div
				className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlaying, 'gdl-bp-friends-grid-parity')}
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
	generation?: number;
	SectionComponent: React.ComponentType<any>;
	LoadingComponent: React.ComponentType<any>;
}): React.ReactElement | null {
	const React = getDocumentReact(props.document);
	if (!React) return null;
	const activity = props.classes.Activity;
	const shortcutIdStr = String(props.shortcut.id);
	const [posts, setPosts] = React.useState<LocalActivityPost[]>(() => loadLocalActivityPosts(props.shortcut.steamAppId, shortcutIdStr));
	const [limit, setLimit] = React.useState(12);

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
				generation={props.generation}
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
								generation={props.generation}
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
