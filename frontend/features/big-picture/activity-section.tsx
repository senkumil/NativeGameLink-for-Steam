import React, { useState } from 'react';
import { DialogButton, Focusable, IconsModule } from '@steambrew/client';
import type { FriendPlayInfo, NewsItem } from '../../domain/types';
import { gdlText, loc, steamIntlLocale } from '../../steam/localization';
import type { NativeAppDetailsClasses } from '../../steam/gamepad/components/AppDetailsNativeClasses';
import { eventTypeLabel, newsExcerpt } from '../library/news';
import { loadLocalActivityPosts, saveLocalActivityPost, type LocalActivityPost } from '../library/social/feed';
import { getCachedPersona } from '../library/social/personas';
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

function openExternal(doc: Document, url: string): void {
	if (!url) return;
	try {
		const win = doc.defaultView as any;
		const system = win?.SteamClient?.System || (window as any)?.SteamClient?.System;
		if (typeof system?.OpenInSystemBrowser === 'function') {
			system.OpenInSystemBrowser(url);
			return;
		}
		doc.defaultView?.open(url, '_blank');
	} catch {}
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
	const activate = item.url ? () => openExternal(document, item.url) : undefined;
	const type = item.event_type ? eventTypeLabel(Number(item.event_type)) : (item.feedlabel || gdlText('feed_news', 'News'));
	const description = newsExcerpt(item.contents || '', 260);
	const imageUrl = item.image
		|| data.game?.header_image
		|| `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${shortcut.steamAppId}/header.jpg`;

	if (imageUrl) {
		return (
			<div className={nativeClasses(event?.Event, event?.PartnerEvent, event?.PartnerEventMediumImage)}>
				<NativeFocusable focusable onActivate={activate} className={event?.PartnerEventMediumImage_Container}>
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
			<NativeFocusable focusable onActivate={activate} className={event?.PartnerEventTextOnly_Container}>
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
}: {
	steamAppId: string;
	shortcutAppId: string;
	classes: NativeAppDetailsClasses;
	onPostAdded: () => void;
}): React.ReactElement {
	const [active, setActive] = useState(false);
	const [text, setText] = useState('');
	const postClasses = classes.PostTextEntry;
	const eventClasses = classes.ActivityEvent;

	const handlePublish = () => {
		const trimmed = text.trim();
		if (!trimmed) return;
		const newPost: LocalActivityPost = {
			id: `post-${Date.now()}`,
			text: trimmed,
			timestamp: Math.floor(Date.now() / 1000),
			user_name: loc('AppActivity_StatusUpdate_CurrentUser', 'Tú'),
			user_avatar: '',
		};
		saveLocalActivityPost(steamAppId, newPost, shortcutAppId);
		setText('');
		setActive(false);
		onPostAdded();
	};

	if (!active) {
		return (
			<NativeFocusable
				focusable
				onActivate={() => setActive(true)}
				className={nativeClasses(eventClasses?.UserStatus, postClasses?.PostTextEntry)}
			>
				<div className={nativeClasses(eventClasses?.StatusText, postClasses?.Label)}>
					{loc('AppActivity_StatusUpdate_Post', 'Diles algo sobre este juego a tus amigos...')}
				</div>
			</NativeFocusable>
		);
	}

	return (
		<NativeFocusable flow-children="column" className={nativeClasses(eventClasses?.UserStatus, postClasses?.PostTextEntry, postClasses?.Active)}>
			<div className={postClasses?.PostTextEntryArea}>
				<textarea
					autoFocus
					value={text}
					onChange={e => setText(e.target.value)}
					placeholder={loc('AppActivity_StatusUpdate_Post', 'Diles algo sobre este juego a tus amigos...')}
					className={postClasses?.PostTextEntryArea}
					onKeyDown={e => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							handlePublish();
						}
					}}
				/>
			</div>
			<div className={nativeClasses(postClasses?.Controls)}>
				<NativeButton onActivate={() => { setActive(false); setText(''); }} {...clickProps(() => { setActive(false); setText(''); })}>
					{loc('Button_Cancel', 'Cancelar')}
				</NativeButton>
				<NativeButton disabled={!text.trim()} onActivate={handlePublish} {...clickProps(handlePublish)}>
					{loc('AppActivity_StatusUpdate_Publish', 'Publicar')}
				</NativeButton>
			</div>
		</NativeFocusable>
	);
}

export function FriendsSection(props: {
	data: BigPictureDetailData;
	shortcut: MappedShortcut;
	classes: NativeAppDetailsClasses;
	SectionComponent: React.ComponentType<any>;
}): React.ReactElement | null {
	const played = [...(props.data.friends?.recentlyPlayed || []), ...(props.data.friends?.previouslyPlayed || [])];
	const wishlisted = props.data.friends?.wishlisted || [];
	if (played.length === 0 && wishlisted.length === 0) return null;
	const native = props.classes.Friends;
	const Section = props.SectionComponent;

	const renderSubsection = (friends: FriendPlayInfo[], title: string) => (
		<div className={nativeClasses(native?.Subsection, native?.FriendsPlayingHalfSection)}>
			<div className={nativeClasses(native?.SubsectionHeader, native?.FriendsSectionSubHeading)}>{title}</div>
			<div className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlayingAvatarGrid)}>
				{friends.slice(0, 12).map(friend => {
					const persona = getCachedPersona(friend.steamid);
					return (
						<NativeFocusable key={friend.steamid} focusable className={nativeClasses(native?.GamepadFriendSectionItem, native?.GamepadFriendSectionItemLong)}>
							<div className={nativeClasses(native?.AvatarAndLabel)}>
								{persona?.avatar ? <img src={persona.avatar} alt="" /> : null}
								<div className={nativeClasses(native?.LabelHolder)}>{persona?.name || friend.steamid}</div>
							</div>
						</NativeFocusable>
					);
				})}
			</div>
		</div>
	);

	return (
		<Section classes={props.classes} label={loc('AppDetails_Friends_Title', 'Amigos')} className={native?.FriendsSection}>
			<div className={nativeClasses(native?.FriendsContainer, native?.Friends, native?.FriendsPlaying)}>
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
	const news = [...props.data.news].filter(item => item?.title).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
	const [limit, setLimit] = useState(12);
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
				onPostAdded={() => setPosts(loadLocalActivityPosts(props.shortcut.steamAppId, shortcutIdStr))}
			/>
			<div className={event?.Headline}>
				<NativeFocusable focusable role="link" onActivate={() => openExternal(props.document, `https://steamcommunity.com/app/${props.shortcut.steamAppId}/allnews/`)}>
					<span>{loc('AppActivity_ViewLatestNews', 'Ver las últimas novedades')}</span>
				</NativeFocusable>
			</div>
			{posts.slice(0, 4).map(post => (
				<div key={post.id} className={props.classes.ActivityEvent?.Event}>
					<NativeFocusable focusable className={props.classes.ActivityEvent?.UserStatus}>
						<div className={props.classes.ActivityEvent?.EventHeadline}>{post.user_name || gdlText('user_status', 'Status post')}</div>
						<div className={props.classes.ActivityEvent?.StatusText}>{post.text}</div>
					</NativeFocusable>
				</div>
			))}
			{dayGroups.map(group => (
				<div key={group.key} className={event?.AppActivityDay} role="region">
					<div className={event?.AppActivityDate}>{group.label}<div className={event?.Rule} /></div>
					<div className={event?.AppDayContents}>{group.items.map(item => (
						<ActivityEventCard key={item.gid || item.url || item.title} item={item} shortcut={props.shortcut} data={props.data} classes={props.classes} document={props.document} />
					))}</div>
				</div>
			))}
			{limit < news.length ? <div className={activity?.FetchMoreContainer}><NativeButton onActivate={() => setLimit(value => value + 12)} {...clickProps(() => setLimit(value => value + 12))}>{loc('AppDetails_Activity_LoadMore', 'Cargar más actividad')}</NativeButton></div> : null}
			{posts.length === 0 && news.length === 0 ? <LoadingContent hydrating={props.hydrating} className={activity?.NoActivity} empty={gdlText('no_recent_activity', 'No recent activity.')} /> : null}
		</Section>
	);
}
