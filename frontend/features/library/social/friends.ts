import { findModuleExport } from '@steambrew/client';
import type { FriendCategories, FriendPersona, FriendPlayInfo } from '../../../domain/types';
import { CACHE_RETENTION, CACHE_TTL, cacheGet, cacheRead, cacheSet } from '../../../core/cache';
import { escapeHtml } from '../../../core/text';
import { gdlText, loc } from '../../../steam/localization';
import { backendLog, fetchFriendPersonasBackend } from '../../../api/backend';
import { extractSteamIdFromValue, fetchFriendsGameplayInfo } from '../../../steam/social';
import { cachePersona, getCachedPersona, hasCachedPersona } from './personas';
import { buildNativeSidebarSection, discoverNativeLibraryLayout } from '../layout';

const DEFAULT_AVATAR = 'https://avatars.cloudflare.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg';

const friendRequests = new Map<string, Promise<{ html: string; data: FriendCategories | null }>>();

function getSteamClient(): any {
	return (window as any).SteamClient
		|| (window as any).parent?.SteamClient
		|| (window as any).opener?.SteamClient
		|| (window as any).top?.SteamClient
		|| (findModuleExport((m: any) => typeof m?.Apps?.GetFriendsWhoPlay === 'function'));
}

export function getCachedFriendData(steamAppId: string): { data: FriendCategories; fresh: boolean } | null {
	const entry = cacheRead<FriendCategories>('friends_' + steamAppId, CACHE_TTL.friends, CACHE_RETENTION.friends);
	return entry ? { data: entry.data, fresh: entry.fresh } : null;
}

export function friendDataSignature(data: FriendCategories | null | undefined): string {
	if (!data) return '0';
	const encode = (prefix: string, values: FriendPlayInfo[]) => values.map(friend =>
		`${prefix}:${friend.steamid}:${friend.minutes_played_recently}:${friend.minutes_played}`).join('|');
	return `${data.totalCount}:` + [
		encode('recent', data.recentlyPlayed),
		encode('previous', data.previouslyPlayed),
		encode('wishlist', data.wishlisted || []),
	].filter(Boolean).join('|');
}

export async function getFriendData(steamAppId: string): Promise<{ html: string; data: FriendCategories | null }> {
	const cachedFriends = cacheGet<FriendCategories>('friends_' + steamAppId, CACHE_TTL.friends);
	if (cachedFriends) return { html: '', data: cachedFriends };
	const active = friendRequests.get(steamAppId);
	if (active) return active;
	const request = loadFriendData(steamAppId).finally(() => {
		if (friendRequests.get(steamAppId) === request) friendRequests.delete(steamAppId);
	});
	friendRequests.set(steamAppId, request);
	return request;
}

async function loadFriendData(steamAppId: string): Promise<{ html: string; data: FriendCategories | null }> {
	const appIdNum = parseInt(steamAppId, 10);
	if (!Number.isFinite(appIdNum) || appIdNum <= 0) return { html: '', data: null };
	const retained = cacheRead<FriendCategories>('friends_' + steamAppId, CACHE_TTL.friends, CACHE_RETENTION.friends)?.data || null;

	try {
		// 1. Fetch comprehensive friends gameplay info via Steam protobuf RPC & Store API
		const gameplayInfo = await fetchFriendsGameplayInfo(appIdNum);

		const recentlyPlayed: FriendPlayInfo[] = gameplayInfo?.recentlyPlayed ? [...gameplayInfo.recentlyPlayed] : [];
		const previouslyPlayed: FriendPlayInfo[] = gameplayInfo?.previouslyPlayed ? [...gameplayInfo.previouslyPlayed] : [];
		const wishlisted: FriendPlayInfo[] = gameplayInfo?.wishlisted ? [...gameplayInfo.wishlisted] : [];

		const seenSids = new Set<string>([
			...recentlyPlayed.map(f => f.steamid),
			...previouslyPlayed.map(f => f.steamid),
			...wishlisted.map(f => f.steamid),
		]);

		// 2. Query SteamClient native Apps.GetFriendsWhoPlay if available
		const steamClient = getSteamClient();
		if (steamClient?.Apps?.GetFriendsWhoPlay) {
			try {
				const result = await steamClient.Apps.GetFriendsWhoPlay(appIdNum);
				const parseFriends = (values: any[]): FriendPlayInfo[] => values.map((friend: any) => ({
					steamid: extractSteamIdFromValue(friend),
					minutes_played: Number(friend?.minutes_played || friend?.m_nMinutesPlayed || friend?.minutesPlayed || friend?.minutes_played_forever || 0),
					minutes_played_recently: Number(friend?.minutes_played_recently || friend?.m_nMinutesPlayedRecently || friend?.minutesPlayedRecently || 0),
				})).filter(f => Boolean(f.steamid && f.steamid !== '0'));

				let rawFriends: FriendPlayInfo[] = [];
				if (Array.isArray(result)) {
					rawFriends = result.length > 0 && typeof result[0] === 'object' && result[0] !== null
						? parseFriends(result)
						: result.map(value => ({ steamid: extractSteamIdFromValue(value), minutes_played: 0, minutes_played_recently: 0 })).filter(f => Boolean(f.steamid && f.steamid !== '0'));
				} else if (result && typeof result === 'object') {
					const candidates = (result as any).friends || (result as any).rgFriends || (result as any).m_rgFriends;
					rawFriends = Array.isArray(candidates)
						? parseFriends(candidates)
						: Object.values(result).filter(Boolean).map((value: any) => ({
							steamid: extractSteamIdFromValue(value),
							minutes_played: Number(value?.minutes_played || value?.m_nMinutesPlayed || 0),
							minutes_played_recently: Number(value?.minutes_played_recently || value?.m_nMinutesPlayedRecently || 0),
						})).filter(f => Boolean(f.steamid && f.steamid !== '0'));
				}

				for (const rf of rawFriends) {
					if (!rf.steamid || rf.steamid === '0') continue;
					if (rf.minutes_played_recently > 0) {
						const existing = recentlyPlayed.find(f => f.steamid === rf.steamid);
						if (existing) {
							existing.minutes_played_recently = Math.max(existing.minutes_played_recently, rf.minutes_played_recently);
							existing.minutes_played = Math.max(existing.minutes_played, rf.minutes_played);
						} else {
							const wIndex = wishlisted.findIndex(w => w.steamid === rf.steamid);
							if (wIndex >= 0) wishlisted.splice(wIndex, 1);
							const pIndex = previouslyPlayed.findIndex(p => p.steamid === rf.steamid);
							if (pIndex >= 0) previouslyPlayed.splice(pIndex, 1);
							recentlyPlayed.push(rf);
							seenSids.add(rf.steamid);
						}
					} else {
						if (!recentlyPlayed.some(f => f.steamid === rf.steamid) && !previouslyPlayed.some(f => f.steamid === rf.steamid)) {
							const wIndex = wishlisted.findIndex(w => w.steamid === rf.steamid);
							if (wIndex >= 0) wishlisted.splice(wIndex, 1);
							previouslyPlayed.push(rf);
							seenSids.add(rf.steamid);
						}
					}
				}
			} catch (err) {
				backendLog('GetFriendsWhoPlay fallback error: ' + err);
			}
		}

		// 3. Webpack friend store search fallback for wishlist
		if (wishlisted.length === 0) {
			try {
				const friendStore = findModuleExport((m: any) =>
					(m?.m_mapFriends instanceof Map || typeof m?.GetFriend === 'function' || Array.isArray(m?.m_rgFriends))
					&& (typeof m?.GetFriends === 'function' || typeof m?.GetFriendList === 'function' || m?.m_mapFriends)
				);
				if (friendStore) {
					const allFriends = friendStore.m_mapFriends instanceof Map
						? Array.from(friendStore.m_mapFriends.values())
						: (Array.isArray(friendStore.m_rgFriends) ? friendStore.m_rgFriends : []);
					for (const f of allFriends) {
						const sid = extractSteamIdFromValue(f);
						if (!sid || seenSids.has(sid)) continue;
						const wishlist = (f as any)?.m_rgWishlistApps || (f as any)?.m_setWishlistApps || (f as any)?.wishlist || (f as any)?.m_rgWishlist;
						if (wishlist instanceof Set && (wishlist.has(appIdNum) || wishlist.has(String(appIdNum)))) {
							wishlisted.push({ steamid: sid, minutes_played: 0, minutes_played_recently: 0 });
							seenSids.add(sid);
						} else if (Array.isArray(wishlist) && (wishlist.includes(appIdNum) || wishlist.includes(String(appIdNum)))) {
							wishlisted.push({ steamid: sid, minutes_played: 0, minutes_played_recently: 0 });
							seenSids.add(sid);
						}
					}
				}
			} catch {}
		}

		// Wishlist visibility is sourced from Steam RPC/store state that can be
		// transiently empty during client hydration. Do not let one partial
		// response erase a previously confirmed second column within retention.
		if (wishlisted.length === 0 && (retained?.wishlisted?.length || 0) > 0) {
			const occupied = new Set([...recentlyPlayed, ...previouslyPlayed].map(friend => friend.steamid));
			for (const friend of retained?.wishlisted || []) {
				if (!friend.steamid || occupied.has(friend.steamid) || wishlisted.some(item => item.steamid === friend.steamid)) continue;
				wishlisted.push({ ...friend });
			}
		}

		recentlyPlayed.sort((a, b) => b.minutes_played_recently - a.minutes_played_recently);

		const totalCount = recentlyPlayed.length + previouslyPlayed.length + wishlisted.length;
		const data: FriendCategories = { recentlyPlayed, previouslyPlayed, wishlisted, totalCount };
		if (totalCount > 0) cacheSet('friends_' + steamAppId, data);
		return { html: '', data };
	} catch (error) {
		backendLog('loadFriendData error: ' + error);
		return { html: '', data: null };
	}
}

function formatPlayTime(minutes: number): string {
	if (minutes >= 120) return gdlText('recent_playtime_hours', '{count} hours recently played', { count: (minutes / 60).toFixed(1) });
	if (minutes > 0) return gdlText('recent_playtime_minutes', '{count} minutes recently played', { count: minutes });
	return '';
}

function renderAvatarGrid(friends: FriendPlayInfo[], personas?: FriendPersona[]): string {
	return friends.map(friend => {
		const persona = personas?.find(candidate => candidate.steamid === friend.steamid) || getCachedPersona(friend.steamid);
		const avatar = persona?.avatar || DEFAULT_AVATAR;
		const name = persona?.name || friend.steamid;
		const profileUrl = 'steam://url/SteamIDPage/' + friend.steamid;
		return `<a href="${profileUrl}" data-gdl-open-url="${profileUrl}" style="display:block;width:38px;height:38px;overflow:hidden;flex-shrink:0;border-radius:2px;" title="${escapeHtml(name)}">`
			+ `<img src="${escapeHtml(avatar)}" style="width:100%;height:100%;display:block;object-fit:cover;border-radius:2px;" data-gdl-fallback-src="${DEFAULT_AVATAR}" alt="${escapeHtml(name)}" /></a>`;
	}).join('');
}

function renderFriendEntry(friend: FriendPlayInfo, personas?: FriendPersona[]): string {
	const persona = personas?.find(candidate => candidate.steamid === friend.steamid) || getCachedPersona(friend.steamid);
	const name = persona?.name || friend.steamid;
	const avatar = persona?.avatar || DEFAULT_AVATAR;
	const profileUrl = 'steam://url/SteamIDPage/' + friend.steamid;
	const playTime = formatPlayTime(friend.minutes_played_recently);
	return `<a href="${profileUrl}" data-gdl-open-url="${profileUrl}" style="display:flex;align-items:center;gap:10px;padding:3px 0;text-decoration:none;overflow:hidden;min-width:0;">
		<img src="${escapeHtml(avatar)}" style="width:38px;height:38px;flex-shrink:0;border-radius:2px;object-fit:cover;" data-gdl-fallback-src="${DEFAULT_AVATAR}" alt="${escapeHtml(name)}" />
		<div style="min-width:0;overflow:hidden;flex:1 1 auto;">
			<div style="font-size:13px;font-weight:500;color:#57cbde;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
			${playTime ? `<div style="font-size:12px;color:#8f98a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${escapeHtml(playTime)}</div>` : ''}
		</div>
	</a>`;
}

export function renderFriendsSection(friendResult: FriendCategories | null, steamAppId: string, gameName: string, personas?: FriendPersona[]): string {
	if (!friendResult || friendResult.totalCount === 0) return '';
	const { recentlyPlayed, previouslyPlayed, wishlisted } = friendResult;
	let html = '';

	if (recentlyPlayed.length > 0) {
		const visibleRecent = recentlyPlayed.slice(0, 8);
		const hiddenRecent = recentlyPlayed.slice(8);
		const recentHeader = recentlyPlayed.length === 1
			? gdlText('friends_recently_played_single', '1 friend played recently')
			: gdlText('friends_recently_played', '{count} friends recently played', { count: recentlyPlayed.length });
		html += `<div style="padding:14px 16px 8px;box-sizing:border-box;">`;
		html += `<div style="font-size:13px;font-weight:400;color:#dcdedf;line-height:1.4;margin-bottom:8px;">${escapeHtml(recentHeader)}</div>`;
		html += `<div style="display:flex;flex-direction:column;gap:4px;">${visibleRecent.map(friend => renderFriendEntry(friend, personas)).join('')}</div>`;
		if (hiddenRecent.length > 0) {
			html += `<div id="gdl-recent-extra" style="display:none;"><div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">${hiddenRecent.map(friend => renderFriendEntry(friend, personas)).join('')}</div></div>`;
			html += `<div id="gdl-recent-toggle" data-gdl-toggle-target="#gdl-recent-extra" data-gdl-hide-self="1" style="margin-top:6px;cursor:pointer;font-size:12px;color:#8f98a0;">${escapeHtml(gdlText('show_all_recently_played', 'Show all recently played ({count} more)', { count: hiddenRecent.length }))}</div>`;
		}
		html += `</div>`;
	}

	if (previouslyPlayed.length > 0) {
		const hasRecentSection = recentlyPlayed.length > 0;
		const visiblePrevious = previouslyPlayed.slice(0, 18);
		const hiddenPrevious = previouslyPlayed.slice(18);
		const previousHeader = previouslyPlayed.length === 1
			? gdlText('friends_previously_played_single', '1 friend has played previously')
			: (hasRecentSection
				? gdlText('friends_previously_played', '{count} friends played previously', { count: previouslyPlayed.length })
				: gdlText('friends_who_play', '{count} friends play this game', { count: previouslyPlayed.length }));
		html += `<div style="padding:${hasRecentSection ? '6px 16px 8px' : '14px 16px 8px'};box-sizing:border-box;">`;
		html += `<div style="font-size:13px;font-weight:400;color:#dcdedf;line-height:1.4;margin-bottom:8px;">${escapeHtml(previousHeader)}</div>`;
		html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">${renderAvatarGrid(visiblePrevious, personas)}</div>`;
		if (hiddenPrevious.length > 0) {
			html += `<div id="gdl-prev-extra" style="display:none;"><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${renderAvatarGrid(hiddenPrevious, personas)}</div></div>`;
			html += `<div id="gdl-prev-toggle" data-gdl-toggle-target="#gdl-prev-extra" data-gdl-hide-self="1" style="margin-top:6px;cursor:pointer;font-size:12px;color:#8f98a0;">${escapeHtml(gdlText('show_all_previously_played', 'Show all previously played ({count} more)', { count: hiddenPrevious.length }))}</div>`;
		}
		html += `</div>`;
	}

	if (wishlisted && wishlisted.length > 0) {
		const hasOtherSections = recentlyPlayed.length > 0 || previouslyPlayed.length > 0;
		const visibleWishlist = wishlisted.slice(0, 18);
		const hiddenWishlist = wishlisted.slice(18);
		const wishlistHeader = wishlisted.length === 1
			? gdlText('friends_wishlisted_single', '1 friend has {game} on their wishlist', { game: gameName || 'this game' })
			: gdlText('friends_wishlisted_plural', '{count} friends have {game} on their wishlist', { count: wishlisted.length, game: gameName || 'this game' });
		html += `<div style="padding:${hasOtherSections ? '6px 16px 8px' : '14px 16px 8px'};box-sizing:border-box;">`;
		html += `<div style="font-size:13px;font-weight:400;color:#dcdedf;line-height:1.4;margin-bottom:8px;">${escapeHtml(wishlistHeader)}</div>`;
		html += `<div style="display:flex;flex-wrap:wrap;gap:6px;">${renderAvatarGrid(visibleWishlist, personas)}</div>`;
		if (hiddenWishlist.length > 0) {
			html += `<div id="gdl-wishlist-extra" style="display:none;"><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${renderAvatarGrid(hiddenWishlist, personas)}</div></div>`;
			html += `<div id="gdl-wishlist-toggle" data-gdl-toggle-target="#gdl-wishlist-extra" data-gdl-hide-self="1" style="margin-top:6px;cursor:pointer;font-size:12px;color:#8f98a0;">${escapeHtml(gdlText('show_all_wishlisted', 'Show all wishlist ({count} more)', { count: hiddenWishlist.length }))}</div>`;
		}
		html += `</div>`;
	}

	const communityUrl = `https://steamcommunity.com/app/${steamAppId}`;
	html += `<div style="padding:14px 16px;text-align:center;">`
		+ `<a href="${communityUrl}" data-gdl-open-url="${communityUrl}" style="font-size:13px;color:#8f98a0;text-decoration:none;display:inline-block;transition:color 0.15s ease;">${escapeHtml(gdlText('view_all_friends', 'View all friends who play'))}</a>`
		+ `</div>`;

	return html;
}

export interface FriendHydrationGuard {
	isCurrent: () => boolean;
	shortcutAppId?: string | null;
}

export async function hydrateFriendPersonas(
	doc: Document,
	friendData: FriendCategories | null,
	steamAppId: string,
	gameName: string,
	guard: FriendHydrationGuard,
): Promise<void> {
	if (!guard.isCurrent()) return;

	if (!friendData || friendData.totalCount <= 0) {
		const section = doc.getElementById('gdl-friends-section');
		if (section && (section.dataset.gdlSteamAppId === steamAppId || !section.dataset.gdlSteamAppId)) {
			section.remove();
		}
		return;
	}

	const recentIds = friendData.recentlyPlayed.map(friend => friend.steamid);
	const previousIds = friendData.previouslyPlayed.map(friend => friend.steamid);
	const wishlistIds = (friendData.wishlisted || []).map(friend => friend.steamid);
	const visibleIds = [
		...recentIds.slice(0, 8),
		...previousIds.slice(0, 18),
		...wishlistIds.slice(0, 18),
	];
	const idsToFetch = [...new Set(visibleIds)].filter(id => !hasCachedPersona(id)).slice(0, 24);

	let personas: FriendPersona[] = [];
	if (idsToFetch.length > 0) {
		try {
			const raw = await fetchFriendPersonasBackend({ steam_ids_csv: idsToFetch.join(',') });
			personas = JSON.parse(raw) as FriendPersona[];
			for (const persona of personas) cachePersona(persona);
		} catch (error) {
			backendLog('Persona fetch error: ' + error);
		}
	}

	if (!guard.isCurrent()) return;

	const renderedHtml = renderFriendsSection(friendData, steamAppId, gameName, personas);
	let section = doc.getElementById('gdl-friends-section');
	let target = doc.getElementById('gdl-friends-content');
	const root = doc.getElementById('gdl-library-injected');

	if (!section) {
		const notice = root || doc.querySelector('[data-gdl-notice]') || doc.getElementById('gdl-main-content-stack');
		if (!notice) return;
		const layout = discoverNativeLibraryLayout(doc, notice);
		if (layout.sidebarColumn) {
			section = buildNativeSidebarSection(doc, layout, {
				sectionId: 'gdl-friends-section',
				headerText: loc('AppDetails_SectionTitle_Friends', 'Friends who play'),
				innerId: 'gdl-friends-content',
				innerHtml: renderedHtml,
				cloneInnerClass: false,
			});
			if (section) {
				section.dataset.gdlSteamAppId = steamAppId;
				const achievementsNode = doc.getElementById('gdl-achievements-section');
				const tradingCardsNode = doc.getElementById('gdl-trading-cards-section');
				const dlcNode = doc.getElementById('gdl-dlc-section');
				const nextNode = achievementsNode || tradingCardsNode || dlcNode;
				if (nextNode && nextNode.parentElement === layout.sidebarColumn) {
					layout.sidebarColumn.insertBefore(section, nextNode);
				} else {
					layout.sidebarColumn.insertBefore(section, layout.sidebarColumn.firstChild);
				}
				target = doc.getElementById('gdl-friends-content');
			}
		}
	}

	if (!target || !section || !root) return;
	if (section.dataset.gdlSteamAppId !== steamAppId || root.dataset.gdlSteamAppId !== steamAppId) return;
	if (guard.shortcutAppId && root.dataset.gdlShortcutAppId && root.dataset.gdlShortcutAppId !== guard.shortcutAppId) return;

	target.innerHTML = renderedHtml;
	section.style.display = '';
}
