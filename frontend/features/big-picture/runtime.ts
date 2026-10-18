import { backendLog } from '../../api/backend';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { fetchPlaytimeStatsBatch } from '../playtime/service';
import { disposeBigPictureShortcutDetails, refreshBigPictureShortcutDetails } from './details';
import { getBigPictureMappedShortcuts, invalidateBigPictureMappedShortcuts } from './mapped-shortcuts-cache';
import { subscribePreferences } from '../../core/preferences';
import { installBrowserProtection } from '../../steam/browser-protection';
import { GamepadRerenderScheduler } from './rerender-scheduler';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { committedHeaderAppId } from '../../steam/library-details';
import { APP_DETAILS_ROUTE_PATTERN, NON_DETAILS_ROUTE_PATTERN, collectActiveRouteValues, normalizeGamepadAppId } from '../../steam/gamepad/GamepadContext';
import { restoreBigPictureOverviewState, setBigPicturePlaytimeField, setBigPicturePlaytimeLabel, type BigPicturePlaytimeKey } from './overview-state';
import { bigPictureHomeText, formatBigPictureHomePlaytime } from './home-playtime';
import { cancelBigPictureHomePlaytimeProbes, readBigPictureShortcutPlaytime } from './home-playtime-probes';

function isLiveGamepadDocument(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected && steamUIModeService.isGamepadUI(doc));
}
function normalizedDomText(value: unknown): string {
	return String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}
/** Desktop's route helper may read the shared context's other active window.
 * Big Picture refresh gating must use only this Document's exact live owner. */
export function shouldSkipBigPictureRefresh(doc: Document): boolean {
	if (doc.getElementById('gdl-bp-detail-root') || doc.getElementById('gdl-bp-playbar-controller')) return false;
	for (const route of typeof collectActiveRouteValues === 'function' ? collectActiveRouteValues(doc) : []) {
		const rootDetails = /^(?:https?:\/\/[^/?#]+)?(?:\/routes)?\/library\/app\/(-?\d+)(?=[/?&#]|$)/i.exec(route);
		if (!rootDetails && (NON_DETAILS_ROUTE_PATTERN.test(route) || /\/(?:routes\/)?home(?=[/?#]|$)/i.test(route))) return false;
		const details = rootDetails || APP_DETAILS_ROUTE_PATTERN.exec(route);
		if (details) { const id = normalizeGamepadAppId(details[1]); return id !== null && id < 2147483648; }
	}
	return false;
}
function isBigPictureGameDetailSurface(doc: Document): boolean {
	// Steam retains and preloads details behind Home. The owning window's live
	// history must outrank those nodes and any older router/browser pathname.
	for (const route of typeof collectActiveRouteValues === 'function' ? collectActiveRouteValues(doc) : []) {
		if (/^(?:https?:\/\/[^/?#]+)?(?:\/routes)?\/library\/app\/-?\d+(?=[/?&#]|$)/i.test(route)) return true;
		if (NON_DETAILS_ROUTE_PATTERN.test(route) || /\/(?:routes\/)?home(?=[/?#]|$)/i.test(route)) return false;
		if (APP_DETAILS_ROUTE_PATTERN.test(route)) return true;
	}
	const painted = (element: HTMLElement | null): element is HTMLElement => {
		if (!element?.isConnected) return false;
		for (let current: HTMLElement | null = element; current; current = current.parentElement) {
			const style = doc.defaultView?.getComputedStyle(current);
			if (current.hidden || current.getAttribute('aria-hidden') === 'true' || style?.display === 'none'
				|| style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
		}
		const bounds = element.getBoundingClientRect();
		return bounds.width > 0 && bounds.height > 0;
	};
	if (painted(doc.getElementById('gdl-bp-detail-root')) || painted(doc.getElementById('gdl-bp-detail-shell'))) return true;
	if (Array.from(doc.querySelectorAll?.<HTMLElement>('[class*="PlayBar"], [class*="playbar"], [class*="PlayButton"], [class*="playButton"], [class*="AppDetailsHeader"], [class*="appDetailsHeader"]') || []).some(painted)) return true;
	const detail = doc.querySelector<HTMLElement>('[class*="AppDetails"], [class*="GameDetails"]');
	if (painted(detail)) {
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
const homePlaytimeReports = new WeakMap<Document, Map<string, string>>();
function reportHomePlaytime(doc: Document, reason: string, phase = 'result'): void {
	const route = (typeof collectActiveRouteValues === 'function' ? collectActiveRouteValues(doc)[0] : '') || '';
	const path = route.split(/[?#]/, 1)[0].replace(/^https?:\/\/[^/]+/i, '').replace(/-?\d{5,}/g, ':id').slice(0, 120);
	const report = `${reason}; path=${path || 'unknown'}`;
	let reports = homePlaytimeReports.get(doc);
	if (!reports) homePlaytimeReports.set(doc, reports = new Map());
	if (reports.get(phase) === report) return;
	reports.set(phase, report);
	backendLog(`[NGL][Gamepad][HomePlaytime] ${phase}: ${report}`);
}
// Big Picture renders the "recently played" cards in a separate window from
// the desktop library. Steam already knows the playtime for shortcut AppIDs,
// but this view can still render its empty-state label while the shortcut's
// detail page shows the real value. Keep the bridge small and DOM-based so it
// survives Steam's React updates without replacing any native components.
function bigPictureNoPlaytimeLabels(doc: Document): Set<string> {
	return new Set(['no playtime', 'no playtime yet',
		// Scriptless CEF popups need not publish LocalizationManager. These are
		// the exact installed Spanish/LATAM strings, still gated by card identity.
		'sin tiempo de juego', 'aún no hay tiempo de juego',
		normalizedDomText(bigPictureHomeText(doc, 'AppBox_NoPlayTimeYet', 'No playtime yet'))]);
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
	if (shortcuts.length === 0) { reportHomePlaytime(doc, 'no linked shortcuts'); return; }
	reportHomePlaytime(doc, `linked=${shortcuts.length}; waiting for canonical history`, 'start');

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
	reportHomePlaytime(doc, `records=${fallbacks.size} positive=${[...fallbacks.values()].filter(value => Number(value?.minutesForever) > 0).length}`, 'canonical');
	const unknown: MappedShortcut[] = [];
	for (const shortcut of shortcuts) {
		const app = AppStoreAdapter.getAppOverview(shortcut.id, doc);
		const fallback = fallbacks.get(shortcut.id) ?? null;
		const forever = Math.max(
			0,
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
		if (forever <= 0) unknown.push(shortcut);
		if (applyShortcutPlaytimeToOverview(doc, shortcut.id, forever, recent, lastPlayed)) overviewChanged = true;
	}
	if (overviewChanged && !isBigPictureGameDetailSurface(doc)) {
		requestBigPictureRerender(doc);
	}
	// Publish confirmed data before optional native probes. One unresponsive
	// shortcut must never hold every visible, already-confirmed Home card.
	applyBigPictureHomePlaytimeLabels(doc, shortcuts, resolved);
	if (!unknown.length) return;
	reportHomePlaytime(doc, `unknown=${unknown.length}; probing at most 4 shortcuts with 800ms deadline`, 'native');
	await Promise.all(unknown.map(async shortcut => {
		if (!isCurrent()) return;
		const native = await readBigPictureShortcutPlaytime(doc, shortcut.id);
		if (!isCurrent() || !native) return;
		const previous = resolved.get(shortcut.id)!;
		resolved.set(shortcut.id, { ...previous, forever: native });
		applyShortcutPlaytimeToOverview(doc, shortcut.id, native, previous.recent);
	}));
	if (!isCurrent()) return;
	reportHomePlaytime(doc, `completed=${unknown.length}`, 'native-complete');
	applyBigPictureHomePlaytimeLabels(doc, shortcuts, resolved);
}
function applyBigPictureHomePlaytimeLabels(doc: Document, shortcuts: MappedShortcut[], resolved: Map<number, { forever: number; recent: number }>): void {
	if (isBigPictureGameDetailSurface(doc)) { reportHomePlaytime(doc, 'skipped details surface'); return; }

	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
	const emptyLabels = bigPictureNoPlaytimeLabels(doc);
	const placeholders: HTMLElement[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const element = node.parentElement as HTMLElement | null;
		if (element && emptyLabels.has(normalizedDomText(node.textContent))) placeholders.push(element);
	}

	let matched = 0, patched = 0;
	for (const placeholder of placeholders) {
		if (!placeholder.isConnected || placeholder.dataset.gdlBpPlaytime === '1') continue;
		let scope: Element | null = placeholder.parentElement;
		let match: MappedShortcut | null = null;
		for (let depth = 0; scope && depth < 9 && scope !== doc.body; depth++, scope = scope.parentElement) {
			match = findMappedTitleInScope(scope, shortcuts);
			if (match) break;
		}
		if (!match) continue;
		matched++;
		const playtime = resolved.get(match.id);
		if (!playtime || playtime.forever <= 0) continue;
		setBigPicturePlaytimeLabel(doc, placeholder, formatBigPictureHomePlaytime(doc, playtime.forever, playtime.recent));
		patched++;
	}
	reportHomePlaytime(doc, `linked=${shortcuts.length} positive=${[...resolved.values()].filter(value => value.forever > 0).length} placeholders=${placeholders.length} matched=${matched} patched=${patched}`);
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
		cancelBigPictureHomePlaytimeProbes(gdlBigPictureDoc);
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
	cancelBigPictureHomePlaytimeProbes(gdlBigPictureDoc);
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
		} else reportHomePlaytime(doc, 'skipped details surface');
		await detailRefresh;
	};
	const refreshPromise = run().finally(() => {
		if (activeRefreshPromises.get(doc) === refreshPromise) activeRefreshPromises.delete(doc);
		lastRefreshCompletedAt.set(doc, Date.now());
	});
	activeRefreshPromises.set(doc, refreshPromise);
	return refreshPromise;
}
