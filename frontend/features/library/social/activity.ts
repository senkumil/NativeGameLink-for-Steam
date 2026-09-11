import { findModuleExport } from '@steambrew/client';
import type { FriendPersona, NewsItem } from '../../../domain/types';
import { backendLog, fetchCommunityActivityBackend, fetchFriendPersonasBackend, fetchFriendReviewBackend, fetchPublishedPreviewsBackend } from '../../../api/backend';
import { escapeHtml } from '../../../core/text';
import { ACH_CLASSES, EVENT_CLASSES } from '../../../steam/css';
import { gdlText, loc, steamIntlLocale } from '../../../steam/localization';
import { extractSteamIdFromValue, fetchAuthenticatedCommunityActivity } from '../../../steam/social';
import { cachePersona, getCachedPersona, hasCachedPersona } from './personas';
import { socialRuntimeHost } from './host';
import {
	applyUnifiedActivityFeed,
	hasFreshFriendActivitySnapshot,
	markFriendActivitySnapshotChecked,
	setupPostDeleteHandlers,
	type FriendActivityFeedItem,
} from './feed';

const DEFAULT_AVATAR = 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg';

function getAppActivityStore(): any {
	try {
		const win = window as any;
		if (win.appActivityStore && typeof win.appActivityStore.GetAppActivity === 'function') return win.appActivityStore;
		if (win.parent?.appActivityStore && typeof win.parent.appActivityStore.GetAppActivity === 'function') return win.parent.appActivityStore;
		if (win.top?.appActivityStore && typeof win.top.appActivityStore.GetAppActivity === 'function') return win.top.appActivityStore;
		if (win.AppActivityStore && typeof win.AppActivityStore.GetAppActivity === 'function') return win.AppActivityStore;
		const found = findModuleExport((m: any) =>
			typeof m?.GetAppActivity === 'function'
			|| typeof m?.GetAppActivityData === 'function'
			|| typeof m?.GetActivityForApp === 'function'
			|| typeof m?.RequestAppActivity === 'function'
			|| typeof m?.RequestActivityForApp === 'function'
		);
		if (found) return found;
	} catch {}
	return null;
}

async function getRealActivity(appid: number): Promise<any | null> {
	try {
		const store = getAppActivityStore();
		if (!store) {
			backendLog('No appActivityStore found');
			return null;
		}
		let activity = store.GetAppActivity ? store.GetAppActivity(appid) : (store.GetAppActivityData ? store.GetAppActivityData(appid) : store.GetActivityForApp?.(appid));
		if (!activity && store.m_mapAppActivity?.get) activity = store.m_mapAppActivity.get(appid);
		if (!activity && store.m_mapActivity?.get) activity = store.m_mapActivity.get(appid);

		if (activity) {
			if (typeof activity.RequestActivity === 'function') activity.RequestActivity();
			if (typeof activity.RequestMoreActivity === 'function') activity.RequestMoreActivity();
			if (typeof activity.LoadActivity === 'function') activity.LoadActivity();
			if (typeof activity.Fetch === 'function') activity.Fetch();
			if (typeof activity.FetchActivity === 'function') activity.FetchActivity();
			if (typeof activity.LoadMoreActivity === 'function') activity.LoadMoreActivity();
		}
		if (typeof store.RequestAppActivity === 'function') store.RequestAppActivity(appid);
		if (typeof store.RequestActivityForApp === 'function') store.RequestActivityForApp(appid);
		if (typeof store.LoadAppActivity === 'function') store.LoadAppActivity(appid);
		if (typeof store.FetchAppActivity === 'function') store.FetchAppActivity(appid);
		if (typeof store.FetchActivityForApp === 'function') store.FetchActivityForApp(appid);

		for (let i = 0; i < 20; i++) {
			if (activity) {
				const mapSize = activity.m_mapActivityByDay?.size
					|| (typeof activity.m_mapActivityByDay?.length === 'number' ? activity.m_mapActivityByDay.length : 0)
					|| (activity.m_mapActivityByDay && typeof activity.m_mapActivityByDay === 'object' ? Object.keys(activity.m_mapActivityByDay).length : 0);
				const eventsCount = activity.m_Events?.length || activity.events?.length || activity.m_rgEvents?.length || (Array.isArray(activity) ? activity.length : 0);
				const daysCount = activity.m_rgDays?.length || activity.days?.length || 0;
				if (mapSize > 0 || eventsCount > 0 || daysCount > 0 || activity.m_bLoaded) {
					break;
				}
			}
			await new Promise(r => setTimeout(r, 200));
			activity = store.GetAppActivity ? store.GetAppActivity(appid) : (store.GetAppActivityData ? store.GetAppActivityData(appid) : store.GetActivityForApp?.(appid));
			if (!activity && store.m_mapAppActivity?.get) activity = store.m_mapAppActivity.get(appid);
		}
		if (!activity) {
			backendLog('No activity object for appid ' + appid);
			return null;
		}
		return activity;
	} catch (e) {
		backendLog('Activity store error: ' + e);
		return null;
	}
}

/** Achievement icon URLs in activity events may be bare filenames */
function achievementIconUrl(icon: string, appid: string): string {
	if (!icon) return '';
	if (/^(https?:\/\/|data:)/.test(icon)) return icon;
	return `https://cdn.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}`;
}

/** One achievement card, using native classes (icon + optional name/description) */
function renderAchievementCard(a: any, featured: boolean, appid: string): string {
	if (!a) return '';
	const c = ACH_CLASSES();
	const icon = achievementIconUrl(a.strImage || a.m_strImage || a.image || a.icon || a.strIcon || '', appid);
	const name = a.strName || a.m_strName || a.name || a.strTitle || '';
	const desc = a.strDescription || a.m_strDescription || a.description || a.strDesc || '';
	return `<div class="${c.Achieved}${featured ? ' ' + c.Featured : ''}" style="display:flex;align-items:center;min-width:0;">
		<div class="${c.AchievementHoverContainer}" style="flex-shrink:0;">
			<img class="${c.Icon}" src="${escapeHtml(icon)}" style="display:block;width:64px;height:64px;" data-gdl-hide-on-error="1" />
		</div>
		${featured ? `<div class="${c.TextSection}">
			<div class="${c.Name}">${escapeHtml(name)}</div>
			<div class="${c.Desc}">${escapeHtml(desc)}</div>
		</div>` : ''}
	</div>`;
}

// EUserNewsType values (extracted from Steam's own enum)
const NEWS_TYPE = {
	AchievementUnlocked: 2,
	ReceivedNewGame: 3,
	AddedGameToWishlist: 9,
	RecommendedGame: 10,
	Screenshot: 13,
	Video: 14,
	UserStatus: 16,
	ScreenshotTagged: 21,
	Art: 22,
	PlayedGameFirstTime: 30,
};

const RENDERABLE_EVENT_TYPES = new Set(Object.values(NEWS_TYPE));

const SCREENSHOT_TYPES = new Set([NEWS_TYPE.Screenshot, NEWS_TYPE.ScreenshotTagged, NEWS_TYPE.Art]);

const REVIEW_THUMB_UP = 'https://community.akamai.steamstatic.com/public/shared/images/userreviews/icon_thumbsUp_v6.png';

const REVIEW_THUMB_DOWN = 'https://community.akamai.steamstatic.com/public/shared/images/userreviews/icon_thumbsDown_v6.png';

function eventActorId(event: any): string {
	try {
		return extractSteamIdFromValue(
			event?.steamIDActor || event?.m_steamidActor || event?.m_steamIDActor || event?.steamidActor ||
			event?.steamID || event?.m_steamID || event?.steamid || event?.steamidUser ||
			event?.m_ulSteamID || event?.actor_steamid || event?.m_unAccountID || event?.account_id || event?.accountid || event
		);
	} catch { return ''; }
}

function extractEventStatusText(e: any): string {
	if (!e) return '';
	if (typeof e.statusText === 'string' && e.statusText) return e.statusText;
	if (typeof e.strStatusText === 'string' && e.strStatusText) return e.strStatusText;
	if (typeof e.status_text === 'string' && e.status_text) return e.status_text;
	if (typeof e.strStatus === 'string' && e.strStatus) return e.strStatus;
	if (typeof e.m_strStatus === 'string' && e.m_strStatus) return e.m_strStatus;
	if (typeof e.m_strStatusText === 'string' && e.m_strStatusText) return e.m_strStatusText;
	if (typeof e.m_strStatusMessage === 'string' && e.m_strStatusMessage) return e.m_strStatusMessage;
	if (typeof e.status_message === 'string' && e.status_message) return e.status_message;
	if (typeof e.strMessage === 'string' && e.strMessage) return e.strMessage;
	if (typeof e.m_strMessage === 'string' && e.m_strMessage) return e.m_strMessage;
	if (typeof e.m_strText === 'string' && e.m_strText) return e.m_strText;
	if (typeof e.strText === 'string' && e.strText) return e.strText;
	if (typeof e.text === 'string' && e.text) return e.text;
	if (typeof e.m_text === 'string' && e.m_text) return e.m_text;
	if (typeof e.m_strBody === 'string' && e.m_strBody) return e.m_strBody;
	if (typeof e.body === 'string' && e.body) return e.body;
	if (typeof e.m_strContent === 'string' && e.m_strContent) return e.m_strContent;
	if (typeof e.content === 'string' && e.content) return e.content;
	if (Array.isArray(e.m_rgStrings) && typeof e.m_rgStrings[0] === 'string' && e.m_rgStrings[0]) return e.m_rgStrings[0];
	if (Array.isArray(e.rgStrings) && typeof e.rgStrings[0] === 'string' && e.rgStrings[0]) return e.rgStrings[0];
	if (Array.isArray(e.strings) && typeof e.strings[0] === 'string' && e.strings[0]) return e.strings[0];
	if (typeof e.post_text === 'string' && e.post_text) return e.post_text;
	return '';
}

function stableActivityDomId(event: any, values: string[]): string {
	const source = [event?.unUniqueID || event?.m_unUniqueID || event?.id, event?.eEventType || event?.m_eEventType || event?.type, event?.rtEventTime || event?.m_rtEventTime, eventActorId(event), ...values].join('|');
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `gdlss${(hash >>> 0).toString(16)}`;
}

/** Substitute %1$s with the game name wrapped in the native white game-name span */
function verbWithGameName(template: string, gameName: string): string {
	const parts = template.split('%1$s');
	if (parts.length < 2) return escapeHtml(template);
	return escapeHtml(parts[0])
		+ `<span class="${EVENT_CLASSES().HeadlineGameName}">${escapeHtml(gameName)}</span>`
		+ escapeHtml(parts.slice(1).join('%1$s'));
}

/** Common event frame: avatar + "<name> <verb>" headline, then the body */
function renderEventShell(event: any, verbHtml: string, bodyHtml: string): string {
	const ev = EVENT_CLASSES();
	const sid64 = eventActorId(event);
	const p = sid64 ? getCachedPersona(sid64) : undefined;
	const name = p?.name || gdlText('friend_generic_name', 'A friend');
	const avatar = p?.avatar || DEFAULT_AVATAR;
	return `<div class="${ev.Event}">
		<div class="${ev.EventHeadline}">
			<a href="steam://url/SteamIDPage/${sid64}"><img class="${ev.EventActorAvatar}" src="${escapeHtml(avatar)}" data-gdl-fallback-src="${DEFAULT_AVATAR}" /></a>
			<div class="${ev.SpanEvent}"><a class="${ev.ActorName}" href="steam://url/SteamIDPage/${sid64}" style="color:#fff;text-decoration:none;cursor:pointer;">${escapeHtml(name)}</a><span>${verbHtml}</span></div>
		</div>
		${bodyHtml}
	</div>`;
}

/** Achievement unlock event (featured card + extra icon cards) */
function renderAchievementEvent(event: any, appid: string): string {
	const achs: any[] = event.achievements || event.m_rgAchievements || event.m_achievements || event.m_vecAchievements || [];
	if (!Array.isArray(achs) || achs.length === 0) return '';
	const primary = renderAchievementCard(achs[0], true, appid);
	const rest = achs.slice(1, 7).map(a => renderAchievementCard(a, false, appid)).join('');
	const body = `<div class="${EVENT_CLASSES().EventBody}">
		<div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
			${primary}
			${rest ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${rest}</div>` : ''}
		</div>
	</div>`;
	return renderEventShell(event, escapeHtml(loc('AppActivity_Achieved', ' achieved')), body);
}

/** Shared screenshots/videos: large active image + swappable thumbnails */
function renderScreenshotEvent(event: any, previews: Map<string, string>, isVideo: boolean): string {
	const rawIds = event.publishedfileids || event.m_rgPublishedFileIDs || event.m_publishedfileids || event.m_rgPublishedFileIds || event.fileids || [];
	const ids: string[] = (Array.isArray(rawIds) ? rawIds : [rawIds]).map(String).filter(Boolean);
	const imgs = ids.map(id => ({ id, img: previews.get(id) || '' })).filter(x => x.img);
	if (imgs.length === 0) return '';

	const count = ids.length;
	const verb = isVideo
		? (count === 1
			? loc('AppActivity_PostedVideo', ' shared a video')
			: loc('AppActivity_PostedVideo_Plural', ' shared %1$s videos').replace('%1$s', String(count)))
		: (count === 1
			? loc('AppActivity_PostedScreenshot', ' shared a screenshot')
			: loc('AppActivity_PostedScreenshot_Plural', ' shared %1$s screenshots').replace('%1$s', String(count)));

	const uid = stableActivityDomId(event, ids);
	const fileUrl = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
	const main = imgs[0];
	const thumbs = imgs.slice(1, 5);
	const ts = event.rtEventTime || event.m_rtEventTime || event.time || 0;
	const uploaded = ts
		? 'Uploaded: ' + new Date(ts * 1000).toLocaleDateString(steamIntlLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
			+ ' at ' + new Date(ts * 1000).toLocaleTimeString(steamIntlLocale(), { hour: 'numeric', minute: '2-digit' })
		: '';

	const body = `<div class="${EVENT_CLASSES().EventBody}">
		<div style="padding:12px;">
			<div style="display:flex;gap:8px;align-items:flex-start;">
				<a id="${uid}-link" href="${fileUrl(main.id)}" data-gdl-open-url="${fileUrl(main.id)}" style="flex:0 1 ${thumbs.length ? '56%' : '80%'};min-width:0;">
					<img id="${uid}-main" src="${escapeHtml(main.img)}" style="width:100%;display:block;" data-gdl-hide-on-error="1" />
				</a>
				${thumbs.length ? `<div style="flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:8px;align-content:start;">
					${thumbs.map(t => `<img src="${escapeHtml(t.img)}" data-gdl-swap-main="${uid}-main" data-gdl-swap-link="${uid}-link" data-gdl-swap-url="${fileUrl(t.id)}" style="width:100%;display:block;cursor:pointer;" data-gdl-hide-on-error="1" />`).join('')}
				</div>` : ''}
			</div>
			${uploaded ? `<div style="color:hsla(0,0%,100%,0.33);margin-top:8px;font-size:12px;">${escapeHtml(uploaded)}</div>` : ''}
		</div>
	</div>`;
	return renderEventShell(event, escapeHtml(verb), body);
}

/** Game capsule body used by "now owns" / "played first time" / wishlist events.
 *  Native uses a 200x94 header-image carousel item. */
function renderCapsuleBody(appid: string, fallbackHeader: string): string {
	return `<div class="${EVENT_CLASSES().EventBody}"><div style="padding:12px;">
		<a href="https://store.steampowered.com/app/${appid}" data-gdl-open-url="https://store.steampowered.com/app/${appid}">
			<img src="https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg" style="display:block;width:200px;height:94px;object-fit:cover;" data-gdl-fallback-src="${escapeHtml(fallbackHeader)}" />
		</a>
	</div></div>`;
}

interface FriendReview {
	found: boolean;
	voted_up?: boolean;
	rating?: string;
	hours?: string;
	text?: string;
	url: string;
}

export interface ActivityHydrationGuard {
	isCurrent: () => boolean;
	shortcutAppId: string | null;
}

/** "reviewed this game" event with the scraped review content */
function renderReviewEvent(event: any, review: FriendReview | undefined, appid: string): string {
	const verb = escapeHtml(loc('AppActivity_RecommendedGame', ' reviewed this game'));
	const url = review?.url || `https://steamcommunity.com/profiles/${eventActorId(event)}/recommended/${appid}/`;
	const readMore = `<a href="${escapeHtml(url)}" data-gdl-open-url="${escapeHtml(url)}" style="display:inline-block;margin-top:8px;color:#8c9193;font-size:12px;text-decoration:none;">${escapeHtml(loc('AppActivity_RecommendedGame_ReadMore', 'Read more'))}</a>`;

	let inner: string;
	if (review && review.found) {
		inner = `<div style="padding:12px;display:flex;gap:12px;align-items:flex-start;">
			<img src="${review.voted_up ? REVIEW_THUMB_UP : REVIEW_THUMB_DOWN}" style="width:40px;height:40px;flex-shrink:0;" data-gdl-hide-on-error="1" />
			<div style="min-width:0;">
				<div style="color:#dcdedf;font-size:16px;">${escapeHtml(review.rating || '')}</div>
				${review.hours ? `<div style="color:#8f98a0;font-size:11px;margin-top:2px;">${escapeHtml(review.hours)}</div>` : ''}
				${review.text ? `<div style="color:#acb2b8;font-size:13px;line-height:1.5;margin-top:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;white-space:pre-line;">${escapeHtml(review.text)}</div>` : ''}
				${readMore}
			</div>
		</div>`;
	} else {
		inner = `<div style="padding:12px;">${readMore}</div>`;
	}
	return renderEventShell(event, verb, `<div class="${EVENT_CLASSES().EventBody}">${inner}</div>`);
}

function getCurrentSteamID64(): string {
	try {
		const win = window as any;
		const raw = win.SteamClient?.User?.GetSteamID?.()
			|| win.userStore?.m_steamid
			|| win.g_AccountInfo?.m_ulSteamID
			|| win.g_AccountInfo?.m_unAccountID
			|| win.g_FriendsUIApp?.m_CurrentUser?.m_steamid
			|| '';
		return extractSteamIdFromValue(raw);
	} catch {}
	return '';
}

async function fetchCommunityWebEvents(steamAppId: string, _gameName: string): Promise<any[]> {
	try {
		const currentSid = getCurrentSteamID64();

		// 1. Primary: Authenticated CEF fetch with user's active session cookies
		const webEvents = await fetchAuthenticatedCommunityActivity(steamAppId, currentSid);
		if (Array.isArray(webEvents) && webEvents.length > 0) {
			for (const item of webEvents) {
				const sid = eventActorId(item);
				if (sid && sid !== '0') {
					if (item.actorName || item.actorAvatar) {
						cachePersona({ steamid: sid, name: item.actorName || sid, avatar: item.actorAvatar || DEFAULT_AVATAR });
					}
				}
			}
			return webEvents;
		}

		// 2. Secondary fallback: backend scraping
		const raw = await fetchCommunityActivityBackend({ steam_app_id: steamAppId, steam_id64: currentSid });
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) return [];
		const events: any[] = [];
		parsed.forEach((item: any, index: number) => {
			const sid = String(item.steamid || '');
			const name = String(item.name || sid);
			const avatar = String(item.avatar || DEFAULT_AVATAR);
			if (sid && sid !== '0') {
				cachePersona({ steamid: sid, name, avatar });
			}
			events.push({
				eEventType: item.type || NEWS_TYPE.UserStatus,
				steamIDActor: { ConvertTo64BitString: () => sid },
				unUniqueID: `backend_activity_${sid}_${index}`,
				rtEventTime: item.time || (Math.floor(Date.now() / 1000) - index * 60),
				statusText: item.text || '',
			});
		});
		return events;
	} catch (e) {
		backendLog('fetchCommunityWebEvents backend error: ' + e);
		return [];
	}
}

/** Fetch real activity and render all supported friend events into the feed */
export async function populateActivityFeed(
	doc: Document,
	steamAppId: string,
	gameName: string,
	headerImage: string,
	newsItems: NewsItem[] = [],
	guard?: ActivityHydrationGuard,
): Promise<void> {
	if (!doc || !steamAppId) return;
	const isCurrent = (): boolean => {
		if (guard?.isCurrent()) return true;
		const currentAppId = socialRuntimeHost().getCurrentInjectedAppId();
		const docAppId = doc.getElementById('gdl-library-injected')?.dataset?.gdlSteamAppId;
		return (currentAppId === steamAppId || docAppId === steamAppId);
	};
	const shortcutAppId = guard?.shortcutAppId ?? socialRuntimeHost().getCurrentInjectedShortcutAppId();
	const numericAppId = Number.parseInt(steamAppId, 10);
	if (!Number.isFinite(numericAppId) || numericAppId <= 0) return;
	// The initial route paint already reused this snapshot. Re-querying Steam's
	// activity store here would wait up to 4.8 seconds and then replace identical
	// feed DOM on every visit.
	if (hasFreshFriendActivitySnapshot(steamAppId)) return;
	let activity: any = null;
	try {
		activity = await getRealActivity(numericAppId);
	} catch {}
	if (!isCurrent()) return;

	// Collect days (native store groups events per day, or array of events)
	const days: any[] = [];
	try {
		if (activity?.m_mapActivityByDay instanceof Map || typeof activity?.m_mapActivityByDay?.forEach === 'function') {
			activity.m_mapActivityByDay.forEach((d: any) => days.push(d));
		} else if (activity?.m_mapActivityByDay && typeof activity.m_mapActivityByDay === 'object') {
			for (const d of Object.values(activity.m_mapActivityByDay)) {
				if (d) days.push(d);
			}
		} else if (Array.isArray(activity?.m_rgDays)) {
			days.push(...activity.m_rgDays);
		} else if (Array.isArray(activity?.days)) {
			days.push(...activity.days);
		} else if (Array.isArray(activity?.m_Events) || Array.isArray(activity?.events) || Array.isArray(activity?.m_rgEvents)) {
			const evs = activity.m_Events || activity.events || activity.m_rgEvents;
			days.push({ day: { GetLatestEventTime: () => Math.floor(Date.now() / 1000) }, events: evs });
		} else if (Array.isArray(activity)) {
			days.push({ day: { GetLatestEventTime: () => Math.floor(Date.now() / 1000) }, events: activity });
		}
	} catch (e) {
		backendLog('Error collecting activity days: ' + e);
	}
	days.sort((a, b) => (b.GetLatestEventTime?.() || b.m_rtDay || b.rtEventTime || 0) - (a.GetLatestEventTime?.() || a.m_rtDay || a.rtEventTime || 0));

	// Gather renderable events per day + everything we need to prefetch
	const dayEvents: { day: any; events: any[] }[] = [];
	const actorIds = new Set<string>();
	const fileIds = new Set<string>();
	const reviewActors: string[] = [];
	for (const day of days) {
		let events: any[] = [];
		try {
			const rawEvents = day.events || day.m_Events || day.m_rgEvents || day.rgEvents || day.m_vecEvents || (Array.isArray(day) ? day : []);
			events = rawEvents.filter((e: any) => {
				const eventType = Number(e.eEventType || e.m_eEventType || e.type || e.event_type || e.nEventType || 0);
				if (!RENDERABLE_EVENT_TYPES.has(eventType)) return false;
				if (eventType === NEWS_TYPE.AchievementUnlocked) {
					const achs = e.achievements || e.m_rgAchievements || e.m_achievements || e.m_vecAchievements || [];
					return Array.isArray(achs) && achs.length > 0;
				}
				return true;
			}).slice(0, 10);
		} catch {}
		if (events.length === 0) continue;
		for (const e of events) {
			const eventType = Number(e.eEventType || e.m_eEventType || e.type || e.event_type || e.nEventType || 0);
			const sid = eventActorId(e);
			if (sid && !hasCachedPersona(sid)) actorIds.add(sid);
			if (SCREENSHOT_TYPES.has(eventType) || eventType === NEWS_TYPE.Video) {
				const fileList = e.publishedfileids || e.m_rgPublishedFileIDs || e.m_publishedfileids || e.m_rgPublishedFileIds || e.fileids || [];
				for (const id of (Array.isArray(fileList) ? fileList : [fileList]).slice(0, 5)) fileIds.add(String(id));
			}
			if (eventType === NEWS_TYPE.RecommendedGame && sid && reviewActors.length < 6) {
				reviewActors.push(sid);
			}
		}
		dayEvents.push({ day, events });
		if (dayEvents.length >= 12) break;
	}

	if (dayEvents.length === 0) {
		const webEvents = await fetchCommunityWebEvents(steamAppId, gameName);
		if (webEvents.length > 0) {
			const nowTs = Math.floor(Date.now() / 1000);
			dayEvents.push({
				day: { GetLatestEventTime: () => nowTs },
				events: webEvents,
			});
			for (const we of webEvents) {
				const sid = eventActorId(we);
				if (sid && !hasCachedPersona(sid)) actorIds.add(sid);
			}
		}
	}

	if (dayEvents.length === 0) {
		markFriendActivitySnapshotChecked(steamAppId, 5_000);
		backendLog('Activity: no renderable events for ' + steamAppId);
		return;
	}

	// Prefetch personas, screenshot previews, and reviews in parallel
	const previews = new Map<string, string>();
	const reviews = new Map<string, FriendReview>();
	const visibleActorIds = [...actorIds].filter(id => !hasCachedPersona(id)).slice(0, 32);
	await Promise.all([
		visibleActorIds.length > 0
			? fetchFriendPersonasBackend({ steam_ids_csv: visibleActorIds.join(',') })
				.then(json => { for (const persona of JSON.parse(json) as FriendPersona[]) cachePersona(persona); })
				.catch(e => backendLog('Activity persona fetch error: ' + e))
			: Promise.resolve(),
		fileIds.size > 0
			? fetchPublishedPreviewsBackend({ file_ids_csv: [...fileIds].join(',') })
				.then(json => { for (const f of JSON.parse(json) as { id: string; image: string }[]) if (f.image) previews.set(f.id, f.image); })
				.catch(e => backendLog('Preview fetch error: ' + e))
			: Promise.resolve(),
		...reviewActors.map(sid =>
			fetchFriendReviewBackend({ steam_id64: sid, steam_app_id: steamAppId })
				.then(json => { reviews.set(sid, JSON.parse(json) as FriendReview); })
				.catch(e => backendLog('Review fetch error: ' + e))
		),
	]);
	if (!isCurrent()) return;

	const renderEvent = (e: any, day: any): FriendActivityFeedItem | null => {
		const eventType = Number(e.eEventType || e.m_eEventType || e.type || e.event_type || e.nEventType || 0);
		const eventTime = Number(e.rtEventTime || e.m_rtEventTime || e.time || e.timestamp || day?.GetLatestEventTime?.() || day?.m_rtDay || day?.m_rtEventTime || day?.rtEventTime || day?.time || Math.floor(Date.now() / 1000));
		let eventHtml = '';

		switch (eventType) {
			case NEWS_TYPE.AchievementUnlocked:
				eventHtml = renderAchievementEvent(e, steamAppId);
				break;
			case NEWS_TYPE.Video:
				eventHtml = renderScreenshotEvent(e, previews, true);
				break;
			case NEWS_TYPE.ReceivedNewGame:
				eventHtml = renderEventShell(e,
					verbWithGameName(loc('AppActivity_ReceivedNewGameList', ' added %1$s to their library'), gameName),
					renderCapsuleBody(steamAppId, headerImage));
				break;
			case NEWS_TYPE.AddedGameToWishlist:
				eventHtml = renderEventShell(e,
					verbWithGameName(loc('AppActivity_AddedGameToWishlist', ' added %1$s to their %2$s.')
						.replace('%2$s', loc('AppActivity_Wishlist', 'wishlist')), gameName),
					renderCapsuleBody(steamAppId, headerImage));
				break;
			case NEWS_TYPE.PlayedGameFirstTime:
				eventHtml = renderEventShell(e,
					verbWithGameName(loc('AppActivity_PlayedGameFirstTime', ' played %1$s for the first time'), gameName),
					renderCapsuleBody(steamAppId, headerImage));
				break;
			case NEWS_TYPE.RecommendedGame:
				eventHtml = renderReviewEvent(e, reviews.get(eventActorId(e)), steamAppId);
				break;
			case NEWS_TYPE.UserStatus: {
				const text = extractEventStatusText(e);
				if (!text) {
					backendLog('UserStatus event fields: ' + Object.keys(e).slice(0, 40).join(','));
					return null;
				}
				const ev2 = EVENT_CLASSES();
				eventHtml = renderEventShell(e,
					escapeHtml(loc('AppActivity_UserStatus', ' posted a status update')),
					`<div class="${ev2.EventBody} ${ev2.UserStatus}"><div style="font-size:14px;color:#dcdedf;line-height:1.5;white-space:pre-line;word-break:break-word;">${escapeHtml(String(text))}</div></div>`);
				break;
			}
			default:
				if (SCREENSHOT_TYPES.has(eventType)) {
					eventHtml = renderScreenshotEvent(e, previews, false);
				}
				break;
		}

		if (!eventHtml) return null;
		const id = stableActivityDomId(e, [String(eventTime)]);
		return { id, date: eventTime, html: eventHtml };
	};

	const friendItems: FriendActivityFeedItem[] = [];
	for (const { day, events } of dayEvents) {
		for (const e of events) {
			const item = renderEvent(e, day);
			if (item) friendItems.push(item);
		}
	}

	const feedEl = doc.getElementById('gdl-activity-feed');
	const root = feedEl?.closest('#gdl-library-injected') as HTMLElement | null;
	if (feedEl && root?.dataset.gdlSteamAppId === steamAppId
		&& (!shortcutAppId || root.dataset.gdlShortcutAppId === shortcutAppId)
		&& isCurrent()) {
		applyUnifiedActivityFeed(
			feedEl,
			steamAppId,
			shortcutAppId,
			newsItems,
			headerImage,
			friendItems
		);
		markFriendActivitySnapshotChecked(steamAppId);
		setupPostDeleteHandlers(
			doc,
			steamAppId,
			shortcutAppId,
			newsItems,
			headerImage
		);
		backendLog('Activity feed rendered with friends & news: ' + friendItems.length + ' friend event(s)');
	}
}
