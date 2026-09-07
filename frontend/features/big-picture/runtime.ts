import { backendLog } from '../../api/backend';
import { normalizeTitle } from '../../core/text';
import { loc, officialSteamText, steamIntlLocale } from '../../steam/localization';
import { findMappingForTitle, loadMappings } from '../../core/mappings';
import { getMappedShortcuts, getShortcutAppById, getShortcutPlaytimeMinutes, toSignedShortcutAppId } from '../../steam/shortcuts';
import { fetchPlaytimeStatsBatch } from '../playtime/service';
import { disposeBigPictureShortcutDetails, refreshBigPictureShortcutDetails } from './details';
import { syncMissingArtworkForMappedShortcuts } from '../library/artwork-sync';
import { defaultBigPictureModeEnabled, subscribePreferences } from '../../core/preferences';

function normalizedDomText(value: unknown): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function isBigPictureGameDetailSurface(doc: Document): boolean {
	if (doc.getElementById('gdl-bp-detail-root') || doc.getElementById('gdl-bp-detail-shell')) return true;
	const detail = doc.querySelector<HTMLElement>('[class*="AppDetails"], [class*="GameDetails"]');
	if (detail && detail.isConnected && detail.offsetParent !== null && !detail.hasAttribute('hidden') && detail.getAttribute('aria-hidden') !== 'true') {
		const rect = detail.getBoundingClientRect();
		if (rect.width >= 400 && rect.height >= 300) {
			const homeOrLibrary = doc.querySelector('[class*="RecentGames"], [class*="HomeScreen"], [class*="AllGames"], [class*="LibraryHome"]');
			if (!homeOrLibrary || homeOrLibrary.getBoundingClientRect().height < 50) {
				return true;
			}
		}
	}
	return false;
}

let gdlBigPictureActive = false;
let gdlBigPictureDoc: Document | null = null;
const gdlBigPictureMappedShortcutIds = new Set<number>();
type BigPicturePlaytimeKey =
	| 'minutes_playtime_forever'
	| 'minutes_playtime_last_two_weeks'
	| 'rt_last_time_played'
	| 'm_rtimeLastPlayed'
	| 'rtime_last_played'
	| 'rt_recent_activity_time';

const bigPictureShortcutState = new Map<object, {
	canonicalAppType: unknown;
	installed: unknown[];
	controllerSupport: unknown;
	xboxControllerSupport: unknown;
	gamepadPreferred: unknown;
	compatPacked: unknown;
	playtimeForever: unknown;
	playtimeLastTwoWeeks: unknown;
	lastPlayedAt?: unknown;
	playtimeOwnDescriptors?: Partial<Record<BigPicturePlaytimeKey, PropertyDescriptor | null>>;
	shortcutMethod?: Function;
	deckVerifiedMethod?: Function;
}>();

// Big Picture renders the "recently played" cards in a separate window from
// the desktop library. Steam already knows the playtime for shortcut AppIDs,
// but this view can still render its empty-state label while the shortcut's
// detail page shows the real value. Keep the bridge small and DOM-based so it
// survives Steam's React updates without replacing any native components.
const BIG_PICTURE_NO_PLAYTIME_ENGLISH = 'no playtime';

function isBigPictureNoPlaytime(text: string): boolean {
	const normalized = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
	return normalized === BIG_PICTURE_NO_PLAYTIME_ENGLISH
		|| normalized === normalizedDomText(officialSteamText('No playtime'));
}

function formatBigPicturePlaytime(minutes: number): string {
	const wholeMinutes = Math.max(0, Math.floor(minutes));
	const label = loc('AppDetails_SectionTitle_PlayTime', 'Playtime').toLocaleUpperCase(steamIntlLocale());
	if (wholeMinutes >= 60) {
		const hours = Math.floor(wholeMinutes / 60);
		const unit = officialSteamText(hours === 1 ? 'hour' : 'hours');
		return `${label}: ${hours} ${unit}`;
	}
	const unit = officialSteamText(wholeMinutes === 1 ? 'minute' : 'minutes');
	return `${label}: ${wholeMinutes} ${unit}`;
}

function applyShortcutPlaytimeToOverview(
	shortcutAppId: number,
	minutesForever: number,
	minutesLastTwoWeeks: number,
	lastPlayedAt?: number,
): boolean {
	const app = getShortcutAppById(shortcutAppId);
	if (!app) return false;
	let changed = false;
	const forever = Math.max(0, Math.floor(minutesForever));
	const recent = Math.max(0, Math.floor(minutesLastTwoWeeks));
	const lastPlayed = Math.max(0, Math.floor(lastPlayedAt || 0));
	const currentForever = Number(app.minutes_playtime_forever || 0);
	if (forever !== currentForever && setBigPicturePlaytimeField(app, 'minutes_playtime_forever', forever)) changed = true;
	if (recent !== Number(app.minutes_playtime_last_two_weeks || 0)
		&& setBigPicturePlaytimeField(app, 'minutes_playtime_last_two_weeks', recent)) changed = true;
	if (lastPlayed > 0 && lastPlayed !== Number(app.rt_last_time_played || 0)) {
		const keys: BigPicturePlaytimeKey[] = ['rt_last_time_played', 'm_rtimeLastPlayed', 'rtime_last_played', 'rt_recent_activity_time'];
		for (const key of keys) {
			if (setBigPicturePlaytimeField(app, key, lastPlayed)) changed = true;
		}
	}
	return changed;
}

type MappedShortcut = { id: number; title: string; steamAppId: string };

function findMappedTitleInScope(scope: Element, shortcuts: MappedShortcut[]): MappedShortcut | null {
	// If the card scope belongs to an official native Steam game (< 2147483648), do not patch
	for (const element of Array.from(scope.querySelectorAll('[data-appid],[data-app-id],[data-app-id-value],a[href*="/app/"]'))) {
		const raw = element.getAttribute('data-appid') || element.getAttribute('data-app-id') || element.getAttribute('data-app-id-value') || element.getAttribute('href')?.match(/\/app\/(\d+)/)?.[1];
		const num = Number(raw);
		if (Number.isFinite(num) && num > 0 && num < 2147483648) return null;
	}
	const candidates = Array.from(scope.querySelectorAll('*')) as HTMLElement[];
	for (const element of candidates) {
		const text = element.childElementCount === 0 ? (element.textContent || '').replace(/\s+/g, ' ').trim() : '';
		if (!text) continue;
		const match = shortcuts.find(shortcut => normalizeTitle(shortcut.title) === normalizeTitle(text));
		if (match) return match;
	}
	return null;
}

export async function patchBigPictureHomePlaytime(doc: Document): Promise<void> {
	if (!doc.body) return;
	const shortcuts = getMappedShortcuts();
	if (shortcuts.length === 0) return;

	// SteamClient.GetPlaytime commonly returns no data for non-Steam shortcuts.
	// Merge it with NativeGameLink's canonical session store instead of treating that
	// empty native response as authoritative. Both lifetime and two-week values
	// feed the native recently-played card.
	const resolved = new Map<number, { forever: number; recent: number }>();
	let overviewChanged = false;
	const fallbacks = await fetchPlaytimeStatsBatch(shortcuts.map(shortcut => ({
		shortcutAppId: shortcut.id,
		title: shortcut.title,
		steamAppId: shortcut.steamAppId,
	})));
	await Promise.all(shortcuts.map(async (shortcut) => {
		const app = getShortcutAppById(shortcut.id);
		const knownNativeMinutes = Number(app?.minutes_playtime_forever || 0);
		const nativeMinutes = knownNativeMinutes > 0
			? knownNativeMinutes
			: await getShortcutPlaytimeMinutes(shortcut.id);
		const fallback = fallbacks.get(shortcut.id) ?? null;
		const forever = Math.max(
			0,
			Number(nativeMinutes || 0),
			Number(fallback?.minutesForever || 0),
			Number(app?.minutes_playtime_forever || 0),
		);
		const recent = Math.max(
			0,
			Number(fallback?.minutesLastTwoWeeks || 0),
			Number(app?.minutes_playtime_last_two_weeks || 0),
		);
		const lastPlayed = Math.max(
			0,
			Number(app?.rt_last_time_played || 0),
			Number(fallback?.lastPlayedAt || 0),
		);
		resolved.set(shortcut.id, { forever, recent });
		if (applyShortcutPlaytimeToOverview(shortcut.id, forever, recent, lastPlayed)) overviewChanged = true;
	}));
	if (overviewChanged && !isBigPictureGameDetailSurface(doc)) {
		try { (window as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
	}
	if (isBigPictureGameDetailSurface(doc)) return;

	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
	const placeholders: HTMLElement[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const element = node.parentElement as HTMLElement | null;
		if (element && isBigPictureNoPlaytime(node.textContent || '')) placeholders.push(element);
	}

	for (const placeholder of placeholders) {
		if (!placeholder.isConnected || placeholder.dataset.gdlBpPlaytime === '1') continue;
		let scope: Element | null = placeholder.parentElement;
		let match: MappedShortcut | null = null;
		for (let depth = 0; scope && depth < 9 && scope !== doc.body; depth++, scope = scope.parentElement) {
			match = findMappedTitleInScope(scope, shortcuts);
			if (match) break;
		}
		if (!match) continue;
		const minutes = resolved.get(match.id)?.forever || 0;
		if (minutes <= 0) continue;
		placeholder.textContent = formatBigPicturePlaytime(minutes);
		placeholder.dataset.gdlBpPlaytime = '1';
		backendLog(`Big Picture playtime shown for "${match.title}": ${minutes} minutes`);
	}
}

// Big Picture normally keeps shortcuts in a separate "Non-Steam" tab and
// excludes them from All Games, Installed and controller-focused lists. Steam
// rebuilds these overview objects while navigating, so use both the store's
// map and its computed allApps list, then re-apply the presentation shim.
// The original shortcut classification is restored when Big Picture closes.
function isBigPictureShortcutObject(app: any): boolean {
	if (!app || typeof app !== 'object') return false;
	const rawId = Number(app.appid);
	const unsignedId = rawId < 0 ? (rawId >>> 0) : rawId;
	const appType = Number(app.app_type || 0);
	return appType === 1073741824 || unsignedId >= 2147483648;
}

function isManagedBigPictureShortcutObject(app: any): boolean {
	if (!app || typeof app !== 'object') return false;
	const rawId = Number(app?.appid);
	const shortcutId = rawId < 0 ? (rawId >>> 0) : rawId;
	if (shortcutId < 2147483648 && Number(app?.app_type || 0) !== 1073741824) return false;
	if (Number.isFinite(shortcutId) && gdlBigPictureMappedShortcutIds.has(shortcutId)) return true;
	if (Number.isFinite(rawId) && gdlBigPictureMappedShortcutIds.has(rawId)) return true;
	const title = String(app?.display_name || app?.m_strDisplayName || app?.name || '').trim();
	if (title && findMappingForTitle(title, shortcutId)) return true;
	return false;
}

function installBigPicturePrototypeShim(app: any): void {
	const prototype = Object.getPrototypeOf(app) as any;
	if (!prototype) return;
	installBigPictureReadonlyField(app, 'controller_support', 2);
	installBigPictureReadonlyField(app, 'xbox_controller_support', 2);
	installBigPictureReadonlyField(app, 'ps4_controller_support', 2);
	installBigPictureReadonlyField(app, 'ps5_controller_support', 2);
	installBigPictureReadonlyField(app, 'gamepad_preferred', true);
	installBigPictureReadonlyField(app, 'steam_deck_compat_category', 3);
	if (typeof prototype.BIsShortcut === 'function' && !prototype.BIsShortcut.__gdlBigPicturePrototypeWrapped) {
		const original = prototype.BIsShortcut;
		const wrapped = function (this: any): boolean {
			return gdlBigPictureActive && !defaultBigPictureModeEnabled() && isManagedBigPictureShortcutObject(this) ? false : original.call(this);
		};
		(wrapped as any).__gdlBigPicturePrototypeWrapped = true;
		try { prototype.BIsShortcut = wrapped; } catch {}
	}
	if (typeof prototype.BIsSteamDeckVerified === 'function' && !prototype.BIsSteamDeckVerified.__gdlBigPicturePrototypeWrapped) {
		const original = prototype.BIsSteamDeckVerified;
		const wrapped = function (this: any): boolean {
			return gdlBigPictureActive && !defaultBigPictureModeEnabled() && isManagedBigPictureShortcutObject(this) ? true : original.call(this);
		};
		(wrapped as any).__gdlBigPicturePrototypeWrapped = true;
		try { prototype.BIsSteamDeckVerified = wrapped; } catch {}
	}
}

/** Wrap getter-only AppOverview fields that Big Picture uses for the
 * controller-compatible filter. Steam changed these fields to read-only on
 * some clients, so assigning them directly no longer updates that category. */
function installBigPictureReadonlyField(app: any, key: string, forcedValue: unknown): void {
	let owner: any = app;
	for (let depth = 0; owner && depth < 5; depth++, owner = Object.getPrototypeOf(owner)) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key) as PropertyDescriptor | undefined;
		if (!descriptor) continue;
		if (!descriptor.get || descriptor.set || !descriptor.configurable) return;
		if ((descriptor.get as any).__gdlBigPictureReadonlyShim) return;
		const originalGet = descriptor.get;
		const wrappedGet = function (this: any): unknown {
			if (gdlBigPictureActive && isManagedBigPictureShortcutObject(this)) return forcedValue;
			return originalGet.call(this);
		};
		(wrappedGet as any).__gdlBigPictureReadonlyShim = true;
		try {
			Object.defineProperty(owner, key, {
				configurable: descriptor.configurable,
				enumerable: descriptor.enumerable,
				get: wrappedGet,
			});
		} catch {}
		return;
	}
}

/** Steam has changed several AppOverview fields from writable values to
 * getter-only properties. A protected field must not prevent the playtime
 * patch from reaching the rest of the Big Picture cards. */
function setBigPictureField(target: any, key: string, value: unknown): boolean {
	try {
		if (target[key] === value) return false;
		target[key] = value;
		return target[key] === value;
	} catch {
		return false;
	}
}

/** Some Steam clients expose playtime through a getter-only prototype field.
 * Prefer ordinary assignment, then install a reversible instance value only
 * for the active Big Picture session. The original descriptor is restored on
 * exit so the desktop library never inherits this presentation shim. */
function setBigPicturePlaytimeField(target: any, key: BigPicturePlaytimeKey, value: number): boolean {
	if (setBigPictureField(target, key, value)) return true;
	let state = bigPictureShortcutState.get(target);
	if (!state) {
		state = {
			canonicalAppType: target.canonicalAppType,
			installed: [],
			controllerSupport: target.controller_support,
			xboxControllerSupport: target.xbox_controller_support,
			gamepadPreferred: target.gamepad_preferred,
			compatPacked: target.steam_hw_compat_category_packed,
			playtimeForever: target.minutes_playtime_forever,
			playtimeLastTwoWeeks: target.minutes_playtime_last_two_weeks,
		};
		bigPictureShortcutState.set(target, state);
	}
	state.playtimeOwnDescriptors ||= {};
	if (!Object.prototype.hasOwnProperty.call(state.playtimeOwnDescriptors, key)) {
		state.playtimeOwnDescriptors[key] = Object.getOwnPropertyDescriptor(target, key) || null;
	}
	try {
		const original = state.playtimeOwnDescriptors[key];
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: original?.enumerable ?? true,
			writable: true,
			value,
		});
		return Number(target[key]) === value;
	} catch {
		return false;
	}
}

export function mergeShortcutsIntoBigPictureLibrary(_doc: Document): void {
	const appStore = (window as any).appStore;
	if (!appStore?.m_mapApps) return;
	const mappedShortcuts = getMappedShortcuts();
	gdlBigPictureMappedShortcutIds.clear();
	for (const shortcut of mappedShortcuts) {
		gdlBigPictureMappedShortcutIds.add(shortcut.id);
		const signed = toSignedShortcutAppId(shortcut.id);
		if (Number.isFinite(signed)) gdlBigPictureMappedShortcutIds.add(signed);
		const unsigned = shortcut.id < 0 ? (shortcut.id >>> 0) : shortcut.id;
		gdlBigPictureMappedShortcutIds.add(unsigned);
	}
	gdlBigPictureActive = true;

	const candidates: any[] = [];
	try { for (const app of appStore.m_mapApps.values()) candidates.push(app); } catch {}
	try { candidates.push(...Array.from(appStore.allApps || [])); } catch {}
	const seen = new Set<object>();
	let changed = false;

	for (const app of candidates) {
		if (!app || typeof app !== 'object' || seen.has(app)) continue;
		seen.add(app);
		const rawId = Number(app.appid);
		const shortcutId = rawId < 0 ? (rawId >>> 0) : rawId;
		const title = String(app.display_name || app.m_strDisplayName || app.name || '').trim();
		const isMapped = gdlBigPictureMappedShortcutIds.has(shortcutId)
			|| gdlBigPictureMappedShortcutIds.has(rawId)
			|| (title && Boolean(findMappingForTitle(title, shortcutId)));
		if (!isMapped) continue;
		gdlBigPictureMappedShortcutIds.add(shortcutId);
		gdlBigPictureMappedShortcutIds.add(rawId);
		const isShortcut = isBigPictureShortcutObject(app);
		if (!isShortcut) continue;
		installBigPicturePrototypeShim(app);

		let state = bigPictureShortcutState.get(app);
		if (!state) {
			const clientData = [app.local_per_client_data, app.most_available_per_client_data, app.selected_per_client_data].filter(Boolean);
			state = {
				canonicalAppType: app.canonicalAppType,
				installed: clientData.map((data: any) => data.installed),
				controllerSupport: app.controller_support,
				xboxControllerSupport: app.xbox_controller_support,
				gamepadPreferred: app.gamepad_preferred,
				compatPacked: app.steam_hw_compat_category_packed,
				playtimeForever: app.minutes_playtime_forever,
				playtimeLastTwoWeeks: app.minutes_playtime_last_two_weeks,
				shortcutMethod: typeof app.BIsShortcut === 'function' ? app.BIsShortcut : undefined,
				deckVerifiedMethod: typeof app.BIsSteamDeckVerified === 'function' ? app.BIsSteamDeckVerified : undefined,
			};
			bigPictureShortcutState.set(app, state);
		}

		const isDefaultMode = defaultBigPictureModeEnabled();
		const targetCanonicalType = isDefaultMode ? state.canonicalAppType : 1;
		if (app.canonicalAppType !== targetCanonicalType && setBigPictureField(app, 'canonicalAppType', targetCanonicalType)) changed = true;
		if (Number(app.controller_support || 0) !== 2 && setBigPictureField(app, 'controller_support', 2)) changed = true;
		// Big Picture's controller tab is backed by the native Xbox collection,
		// which filters this field (not the generic controller_support value).
		if (Number(app.xbox_controller_support || 0) !== 2 && setBigPictureField(app, 'xbox_controller_support', 2)) changed = true;
		if (app.gamepad_preferred !== true && setBigPictureField(app, 'gamepad_preferred', true)) changed = true;

		if (!isDefaultMode) {
			const packed = Number(app.steam_hw_compat_category_packed || 0);
			if ((packed & 3) !== 3 && setBigPictureField(app, 'steam_hw_compat_category_packed', (packed & ~3) | 3)) changed = true;
			for (const clientData of [app.local_per_client_data, app.most_available_per_client_data, app.selected_per_client_data]) {
				if (clientData && clientData.installed !== true && setBigPictureField(clientData, 'installed', true)) changed = true;
			}
		}

		if (state.shortcutMethod && !(app.BIsShortcut as any).__gdlBigPictureWrapped) {
			const original = state.shortcutMethod;
			const wrapped = function (this: any): boolean {
				return gdlBigPictureActive && !defaultBigPictureModeEnabled() && isManagedBigPictureShortcutObject(this) ? false : original.call(this);
			};
			(wrapped as any).__gdlBigPictureWrapped = true;
			if (setBigPictureField(app, 'BIsShortcut', wrapped)) changed = true;
		}
		if (state.deckVerifiedMethod && !(app.BIsSteamDeckVerified as any).__gdlBigPictureWrapped) {
			const original = state.deckVerifiedMethod;
			const wrapped = function (this: any): boolean {
				return gdlBigPictureActive && !defaultBigPictureModeEnabled() && isManagedBigPictureShortcutObject(this) ? true : original.call(this);
			};
			(wrapped as any).__gdlBigPictureWrapped = true;
			if (setBigPictureField(app, 'BIsSteamDeckVerified', wrapped)) changed = true;
		}
	}

	if (changed && !isBigPictureGameDetailSurface(_doc)) {
		try { (window as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
	}
	void syncMissingArtworkForMappedShortcuts();
}

export function restoreBigPictureShortcutState(): void {
	for (const [app, state] of bigPictureShortcutState) {
		setBigPictureField(app, 'canonicalAppType', state.canonicalAppType);
		setBigPictureField(app, 'controller_support', state.controllerSupport);
		setBigPictureField(app, 'xbox_controller_support', state.xboxControllerSupport);
		setBigPictureField(app, 'gamepad_preferred', state.gamepadPreferred);
		setBigPictureField(app, 'steam_hw_compat_category_packed', state.compatPacked);
		const playtimeKeys: BigPicturePlaytimeKey[] = [
			'minutes_playtime_forever',
			'minutes_playtime_last_two_weeks',
			'rt_last_time_played',
			'm_rtimeLastPlayed',
			'rtime_last_played',
			'rt_recent_activity_time',
		];
		for (const key of playtimeKeys) {
			const descriptors = state.playtimeOwnDescriptors;
			if (descriptors && Object.prototype.hasOwnProperty.call(descriptors, key)) {
				const original = descriptors[key];
				try {
					if (original) Object.defineProperty(app, key, original);
					else delete (app as any)[key];
				} catch {}
			} else if (key === 'minutes_playtime_forever') {
				setBigPictureField(app, key, state.playtimeForever);
			} else if (key === 'minutes_playtime_last_two_weeks') {
				setBigPictureField(app, key, state.playtimeLastTwoWeeks);
			}
		}
		const clientData = [(app as any).local_per_client_data, (app as any).most_available_per_client_data, (app as any).selected_per_client_data].filter(Boolean);
		clientData.forEach((data: any, index: number) => { setBigPictureField(data, 'installed', state.installed[index]); });
		if (state.shortcutMethod) setBigPictureField(app, 'BIsShortcut', state.shortcutMethod);
		if (state.deckVerifiedMethod) setBigPictureField(app, 'BIsSteamDeckVerified', state.deckVerifiedMethod);
	}
	bigPictureShortcutState.clear();
	gdlBigPictureMappedShortcutIds.clear();
	try { (window as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
}

export function activateBigPicture(doc: Document): void {
	gdlBigPictureActive = true;
	gdlBigPictureDoc = doc;
	void loadMappings().catch(() => {});
}

export function deactivateBigPicture(): void {
	disposeBigPictureShortcutDetails(gdlBigPictureDoc);
	gdlBigPictureActive = false;
	gdlBigPictureDoc = null;
	restoreBigPictureShortcutState();
}

export function getBigPictureDocument(): Document | null {
	return gdlBigPictureDoc;
}

export function isBigPictureActive(): boolean {
	return gdlBigPictureActive;
}

export async function refreshBigPicture(doc: Document | null = gdlBigPictureDoc): Promise<void> {
	if (!doc) return;
	activateBigPicture(doc);
	// Establish/retire the route-owned native tabpanel content before unrelated
	// batch work. Playtime covers the whole shelf and must never hold the selected
	// game's first render (or leave the previous game's content visible) hostage.
	const detailRefresh = refreshBigPictureShortcutDetails(doc);
	mergeShortcutsIntoBigPictureLibrary(doc);
	if (!isBigPictureGameDetailSurface(doc)) {
		void patchBigPictureHomePlaytime(doc)
			.catch(error => backendLog('Big Picture playtime refresh failed: ' + error));
	}
	await detailRefresh;
}

subscribePreferences(() => {
	if (gdlBigPictureActive && gdlBigPictureDoc) void refreshBigPicture(gdlBigPictureDoc);
});
