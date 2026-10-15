import { backendLog } from '../../api/backend';
import { loc, officialSteamText, steamIntlLocale } from '../../steam/localization';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { fetchPlaytimeStatsBatch } from '../playtime/service';
import { disposeBigPictureShortcutDetails, refreshBigPictureShortcutDetails } from './details';
import { getBigPictureMappedShortcuts, invalidateBigPictureMappedShortcuts } from './mapped-shortcuts-cache';
import { subscribePreferences } from '../../core/preferences';
import { installBrowserProtection } from '../../steam/browser-protection';
import { GamepadRerenderScheduler } from './rerender-scheduler';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { committedHeaderAppId } from '../../steam/library-details';
import { normalizeGamepadAppId } from '../../steam/gamepad/GamepadContext';
import { restoreBigPictureOverviewState, setBigPicturePlaytimeField, setBigPicturePlaytimeLabel, type BigPicturePlaytimeKey } from './overview-state';

function isLiveGamepadDocument(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected && steamUIModeService.isGamepadUI(doc));
}
function normalizedDomText(value: unknown): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}
function isBigPictureGameDetailSurface(doc: Document): boolean {
	if (doc.getElementById('gdl-bp-detail-root') || doc.getElementById('gdl-bp-detail-shell')) return true;
	if (doc.querySelector('[class*="PlayBar"], [class*="playbar"], [class*="PlayButton"], [class*="playButton"], [class*="AppDetailsHeader"], [class*="appDetailsHeader"]')) {
		return true;
	}
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
let bigPictureGeneration = 0;
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
	doc: Document,
	shortcutAppId: number,
	minutesForever: number,
	minutesLastTwoWeeks: number,
	lastPlayedAt?: number,
): boolean {
	const app = AppStoreAdapter.getAppOverview(shortcutAppId, doc);
	if (!app) return false;
	let changed = false;
	const forever = Math.max(0, Math.floor(minutesForever), Number(app.minutes_playtime_forever || 0));
	const recent = Math.max(0, Math.floor(minutesLastTwoWeeks), Number(app.minutes_playtime_last_two_weeks || 0));
	const lastPlayed = Math.max(0, Math.floor(lastPlayedAt || 0), Number(app.rt_last_time_played || 0));
	const currentForever = Number(app.minutes_playtime_forever || 0);
	if (forever !== currentForever && setBigPicturePlaytimeField(doc, app, 'minutes_playtime_forever', forever)) changed = true;
	if (recent !== Number(app.minutes_playtime_last_two_weeks || 0)
		&& setBigPicturePlaytimeField(doc, app, 'minutes_playtime_last_two_weeks', recent)) changed = true;
	if (lastPlayed > 0 && lastPlayed !== Number(app.rt_last_time_played || 0)) {
		const keys: BigPicturePlaytimeKey[] = ['rt_last_time_played', 'm_rtimeLastPlayed', 'rtime_last_played', 'rt_recent_activity_time'];
		for (const key of keys) {
			if (setBigPicturePlaytimeField(doc, app, key, lastPlayed)) changed = true;
		}
	}
	return changed;
}
type MappedShortcut = { id: number; title: string; steamAppId: string };
function findMappedTitleInScope(scope: Element, shortcuts: MappedShortcut[]): MappedShortcut | null {
	// Titles can be identical between Steam games and several installations.
	// Only a shortcut identity carried by this actual card authorizes a patch.
	const ids = new Set<number>();
	for (const element of [scope, ...Array.from(scope.querySelectorAll('[data-appid],[data-app-id],[data-app-id-value],a[href*="/app/"]'))]) {
		const raw = element.getAttribute('data-appid') || element.getAttribute('data-app-id') || element.getAttribute('data-app-id-value') || element.getAttribute('href')?.match(/\/app\/(\d+)/)?.[1];
		const num = normalizeGamepadAppId(raw);
		if (num !== null) ids.add(num);
	}
	const owner = committedHeaderAppId(scope as HTMLElement);
	if (owner !== null) ids.add(owner);
	if ([...ids].some(id => id < 2147483648) || ids.size !== 1) return null;
	return shortcuts.find(shortcut => normalizeGamepadAppId(shortcut.id) === [...ids][0]) || null;
}
const bigPictureHomePlaytimeInFlight = new WeakSet<Document>();
const bigPictureHomePlaytimeLastRun = new WeakMap<Document, number>();
const BIG_PICTURE_HOME_PLAYTIME_MIN_INTERVAL_MS = 1500;
async function readBigPictureShortcutPlaytime(doc: Document, id: number): Promise<number | null> {
	const apps = (doc.defaultView as any)?.SteamClient?.Apps;
	if (typeof apps?.GetPlaytime !== 'function') return null;
	let best = 0;
	for (const value of [id, id | 0]) {
		if (!isLiveGamepadDocument(doc)) return null;
		try {
			const data = await apps.GetPlaytime(value);
			const minutes = Number(data?.nPlaytimeForever ?? data?.minutes_playtime_forever ?? 0);
			if (Number.isFinite(minutes)) best = Math.max(best, minutes);
		} catch {}
	}
	return best > 0 ? best : null;
}
export async function patchBigPictureHomePlaytime(doc: Document): Promise<void> {
	if (!isLiveGamepadDocument(doc)) return;
	if (bigPictureHomePlaytimeInFlight.has(doc)) return;
	const lastRun = bigPictureHomePlaytimeLastRun.get(doc) || 0;
	if (Date.now() - lastRun < BIG_PICTURE_HOME_PLAYTIME_MIN_INTERVAL_MS) return;
	bigPictureHomePlaytimeInFlight.add(doc);
	try {
		await patchBigPictureHomePlaytimePass(doc);
	} finally {
		bigPictureHomePlaytimeInFlight.delete(doc);
		bigPictureHomePlaytimeLastRun.set(doc, Date.now());
	}
}
async function patchBigPictureHomePlaytimePass(doc: Document): Promise<void> {
	if (!doc.body) return;
	const generation = bigPictureGeneration;
	const isCurrent = (): boolean => gdlBigPictureActive && gdlBigPictureDoc === doc && bigPictureGeneration === generation && isLiveGamepadDocument(doc);
	if (!isCurrent()) return;
	const shortcuts = getBigPictureMappedShortcuts(doc);
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
	if (!isCurrent()) return;
	await Promise.all(shortcuts.map(async (shortcut) => {
		const app = AppStoreAdapter.getAppOverview(shortcut.id, doc);
		const knownNativeMinutes = Number(app?.minutes_playtime_forever || 0);
		const nativeMinutes = knownNativeMinutes > 0
			? knownNativeMinutes
			: await readBigPictureShortcutPlaytime(doc, shortcut.id);
		if (!isCurrent()) return;
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
		if (applyShortcutPlaytimeToOverview(doc, shortcut.id, forever, recent, lastPlayed)) overviewChanged = true;
	}));
	if (!isCurrent()) return;
	if (overviewChanged && !isBigPictureGameDetailSurface(doc)) {
		requestBigPictureRerender(doc);
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
		setBigPicturePlaytimeLabel(doc, placeholder, formatBigPicturePlaytime(minutes));
		backendLog(`Big Picture playtime shown for "${match.title}": ${minutes} minutes`);
	}
}
const rerenderScheduler = new GamepadRerenderScheduler();
function requestBigPictureRerender(doc: Document | null = gdlBigPictureDoc): void {
 const generation = bigPictureGeneration;
 rerenderScheduler.request(doc, () => gdlBigPictureActive && gdlBigPictureDoc === doc && bigPictureGeneration === generation);
}

/** Prime the linked registry without changing Steam's app classification,
 * install state, control support, certification or shared prototypes. */
export function mergeShortcutsIntoBigPictureLibrary(doc: Document): void {
 if (isLiveGamepadDocument(doc)) getBigPictureMappedShortcuts(doc);
}
export function restoreBigPictureShortcutState(): void {
 restoreBigPictureOverviewState();
}

let cleanupBigPictureBrowserProtection: (() => void) | null = null;
let cleanupBigPicturePreferences: (() => void) | null = null;

export function activateBigPicture(doc: Document): void {
	if (!isLiveGamepadDocument(doc)) return;
	const sameDocument = gdlBigPictureActive && gdlBigPictureDoc === doc;
	if (!sameDocument && gdlBigPictureDoc) {
		disposeBigPictureShortcutDetails(gdlBigPictureDoc);
		restoreBigPictureOverviewState(gdlBigPictureDoc);
		invalidateBigPictureMappedShortcuts(gdlBigPictureDoc);
	}
	gdlBigPictureActive = true;
	gdlBigPictureDoc = doc;
	if (sameDocument) return;
	const generation = ++bigPictureGeneration;
	cleanupBigPicturePreferences?.();
	cleanupBigPicturePreferences = subscribePreferences(() => {
		if (gdlBigPictureActive && gdlBigPictureDoc === doc && bigPictureGeneration === generation
			&& isLiveGamepadDocument(doc)) void refreshBigPicture(doc);
	});
	rerenderScheduler.cancel();
	cleanupBigPictureBrowserProtection?.();
	cleanupBigPictureBrowserProtection = installBrowserProtection(doc.defaultView, doc);
}

export function deactivateBigPicture(): void {
	cleanupBigPicturePreferences?.();
	cleanupBigPicturePreferences = null;
	bigPictureGeneration += 1;

	rerenderScheduler.cancel();
	cleanupBigPictureBrowserProtection?.();
	cleanupBigPictureBrowserProtection = null;
	invalidateBigPictureMappedShortcuts(gdlBigPictureDoc);
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

const activeRefreshPromises = new WeakMap<Document, Promise<void>>();
const lastRefreshCompletedAt = new WeakMap<Document, number>();

export async function refreshBigPicture(doc: Document | null = gdlBigPictureDoc): Promise<void> {
	if (!doc || !isLiveGamepadDocument(doc)) return;
	activateBigPicture(doc);
	const activeRefreshPromise = activeRefreshPromises.get(doc);
	if (activeRefreshPromise) return activeRefreshPromise;
	const lastCompletedAt = lastRefreshCompletedAt.get(doc) || 0;
	if (Date.now() - lastCompletedAt < 250) return;
	const run = async () => {
		if (!isLiveGamepadDocument(doc)) return;
		const detailRefresh = refreshBigPictureShortcutDetails(doc);
		mergeShortcutsIntoBigPictureLibrary(doc);
		if (!isBigPictureGameDetailSurface(doc)) {
			void patchBigPictureHomePlaytime(doc)
				.catch(error => backendLog('Big Picture playtime refresh failed: ' + error));
		}
		await detailRefresh;
	};
	const refreshPromise = run().finally(() => {
		if (activeRefreshPromises.get(doc) === refreshPromise) activeRefreshPromises.delete(doc);
		lastRefreshCompletedAt.set(doc, Date.now());
	});
	activeRefreshPromises.set(doc, refreshPromise);
	return refreshPromise;
}
