import { getMappedShortcuts, getShortcutAppById, getShortcutPlaytimeMinutes } from '../../steam/shortcuts';
import { fetchPlaytimeStatsBatch, type PlaytimeStats } from './service';
import { formatPlaytimeMinutes } from './format';
import { isShortcutPlaytimeTrackingEnabled } from './playtime-settings';
import { APP_PORTRAIT_CLASS_MODULE } from '../../steam/css';
import { elementsWithCssModuleClass, isRenderedElement } from '../../steam/native-dom';
import { isLibrarySidebarNode } from '../../steam/library-sidebar';
import { runWhenLibrarySidebarIdle } from '../../steam/sidebar-interaction';
import { isPublicSteamLibraryRoute, routedSteamAppId } from '../library/native-route';
import {
	patchDesktopLibraryHomePlaytimeCards,
	type DesktopPlaytimeDomSnapshot,
} from './library-home-dom';

interface DesktopPlaytimeRefreshResult {
	shortcutAppId: number;
	title: string;
	minutesForever: number;
	minutesRecent: number;
	lastPlayedAt: number;
}

const DESKTOP_PLAYTIME_SNAPSHOT_STORAGE_KEY = 'gdl_desktop_playtime_snapshots_v1';
const MAX_DESKTOP_PLAYTIME_SNAPSHOTS = 96;
const desktopPlaytimeRefreshes = new Map<number, Promise<DesktopPlaytimeRefreshResult>>();

function readDesktopPlaytimeSnapshots(): Map<number, DesktopPlaytimeDomSnapshot> {
	const snapshots = new Map<number, DesktopPlaytimeDomSnapshot>();
	try {
		const raw = localStorage.getItem(DESKTOP_PLAYTIME_SNAPSHOT_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) as { version?: number; values?: unknown[] } : null;
		if (parsed?.version !== 1 || !Array.isArray(parsed.values)) return snapshots;
		for (const value of parsed.values.slice(-MAX_DESKTOP_PLAYTIME_SNAPSHOTS)) {
			const item = value as Partial<DesktopPlaytimeDomSnapshot>;
			const shortcutAppId = Number(item.shortcutAppId);
			const minutesForever = normalizedWholeNumber(item.minutesForever);
			if (!Number.isFinite(shortcutAppId) || shortcutAppId <= 0 || minutesForever <= 0) continue;
			const minutesRecent = normalizedWholeNumber(item.minutesRecent);
			const lastPlayedAt = normalizedWholeNumber(item.lastPlayedAt);
			snapshots.set(shortcutAppId, {
				shortcutAppId,
				title: String(item.title || ''),
				minutesForever,
				minutesRecent,
				lastPlayedAt,
			});
		}
	} catch {}
	return snapshots;
}

function persistDesktopPlaytimeSnapshots(): void {
	try {
		const values = Array.from(desktopPlaytimeSnapshots.values())
			.slice(-MAX_DESKTOP_PLAYTIME_SNAPSHOTS);
		localStorage.setItem(DESKTOP_PLAYTIME_SNAPSHOT_STORAGE_KEY, JSON.stringify({ version: 1, values }));
	} catch {}
}

const desktopPlaytimeSnapshots = readDesktopPlaytimeSnapshots();
/** Shelf text can use local snapshots; the shared AppOverview remains owned
 * by Steam because changing it also invalidates the virtual sidebar list. */
export function isDesktopLibraryHomePlaytimeVisible(doc: Document): boolean {
	if (!doc.body || doc.hidden || doc.defaultView?.closed || routedSteamAppId(doc) !== null
		|| isPublicSteamLibraryRoute(doc)) return false;
	const classes = APP_PORTRAIT_CLASS_MODULE().classes;
	return [classes.LibraryItemBox, classes.PlayedRecent].some(css =>
		elementsWithCssModuleClass(doc, css).some(element => !element.closest('[id^="gdl-"]')
			&& !isLibrarySidebarNode(element) && isRenderedElement(doc, element)));
}

function isCurrentHomeShortcut(doc: Document, shortcut: { id: number; steamAppId: string }, app: unknown): boolean {
	return isDesktopLibraryHomePlaytimeVisible(doc) && getShortcutAppById(shortcut.id) === app
		&& getMappedShortcuts().some(current => current.id === shortcut.id && current.steamAppId === shortcut.steamAppId);
}

function normalizedWholeNumber(value: unknown): number {
	const number = Number(value || 0);
	return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

async function refreshDesktopShortcutPlaytime(
	doc: Document,
	shortcut: { id: number; title: string; steamAppId: string },
	fallback: PlaytimeStats | null,
): Promise<DesktopPlaytimeRefreshResult> {
	if (!isShortcutPlaytimeTrackingEnabled(shortcut.id)) fallback = null;
	const existing = desktopPlaytimeRefreshes.get(shortcut.id);
	if (existing) return existing;

	const refresh = (async (): Promise<DesktopPlaytimeRefreshResult> => {
		const app = getShortcutAppById(shortcut.id);
		if (!app || !isCurrentHomeShortcut(doc, shortcut, app)) return {
			shortcutAppId: shortcut.id,
			title: shortcut.title,
			minutesForever: 0,
			minutesRecent: 0,
			lastPlayedAt: 0,
		};
		const knownNativeMinutes = normalizedWholeNumber(app.minutes_playtime_forever);
		const nativeMinutes = knownNativeMinutes > 0
			? knownNativeMinutes
			: await getShortcutPlaytimeMinutes(shortcut.id);
		if (!isCurrentHomeShortcut(doc, shortcut, app)) return {
			shortcutAppId: shortcut.id, title: shortcut.title,
			minutesForever: 0, minutesRecent: 0, lastPlayedAt: 0,
		};
		if (!fallback && !nativeMinutes) return {
			shortcutAppId: shortcut.id,
			title: shortcut.title,
			minutesForever: 0,
			minutesRecent: 0,
			lastPlayedAt: 0,
		};

		// Merge native values into our snapshot without writing to the shared
		// observable that also supplies every icon and row in the game list.
		const forever = Math.max(
			normalizedWholeNumber(app.minutes_playtime_forever),
			normalizedWholeNumber(nativeMinutes),
			normalizedWholeNumber(fallback?.minutesForever),
		);
		const recent = Math.max(
			normalizedWholeNumber(app.minutes_playtime_last_two_weeks),
			normalizedWholeNumber(fallback?.minutesLastTwoWeeks),
		);
		const lastPlayedAt = Math.max(
			normalizedWholeNumber(app.rt_last_time_played),
			normalizedWholeNumber(fallback?.lastPlayedAt),
		);

		return {
			shortcutAppId: shortcut.id,
			title: shortcut.title,
			minutesForever: forever,
			minutesRecent: recent,
			lastPlayedAt,
		};
	})();

	desktopPlaytimeRefreshes.set(shortcut.id, refresh);
	try {
		return await refresh;
	} finally {
		if (desktopPlaytimeRefreshes.get(shortcut.id) === refresh) desktopPlaytimeRefreshes.delete(shortcut.id);
	}
}

/** Reapply the last resolved values to cards Steam mounted after the async
 * startup read completed. This is synchronous and performs no backend I/O. */
export function syncDesktopLibraryHomePlaytimeDom(doc: Document): void {
	if (!isDesktopLibraryHomePlaytimeVisible(doc)) return;
	void runWhenLibrarySidebarIdle(doc, 'desktop-playtime-snapshots', () => syncHomePlaytimeSnapshots(doc)).catch(() => {});
}

function syncHomePlaytimeSnapshots(doc: Document): void {
	if (!isDesktopLibraryHomePlaytimeVisible(doc)) return;
	const mappedIds = new Set(getMappedShortcuts().map(shortcut => shortcut.id));
	const snapshots = Array.from(desktopPlaytimeSnapshots.values()).filter(snapshot =>
		mappedIds.has(snapshot.shortcutAppId) && snapshot.minutesForever > 0);
	patchDesktopLibraryHomePlaytimeCards(doc, snapshots);
}

/** Refresh exact Home-card text without modifying Steam's AppOverview models. */
export async function patchDesktopLibraryHomePlaytime(doc: Document): Promise<void> {
	if (!isDesktopLibraryHomePlaytimeVisible(doc)) return;
	const shortcuts = getMappedShortcuts();
	if (shortcuts.length === 0) return;
	// Paint the last backend-confirmed values before the first IPC round trip.
	// The async refresh below only advances this snapshot; it never regresses a
	// visible card to Steam's temporary startup value of zero.
	syncDesktopLibraryHomePlaytimeDom(doc);
	const fallbacks = await fetchPlaytimeStatsBatch(shortcuts.map(shortcut => ({
		shortcutAppId: shortcut.id,
		title: shortcut.title,
		steamAppId: shortcut.steamAppId,
	})));
	if (!isDesktopLibraryHomePlaytimeVisible(doc)) return;
	const results = await Promise.all(shortcuts.map(shortcut =>
		refreshDesktopShortcutPlaytime(doc, shortcut, fallbacks.get(shortcut.id) ?? null)));
	if (!isDesktopLibraryHomePlaytimeVisible(doc) || !results.some(result => result.minutesForever > 0)) return;
	for (const result of results) {
		if (result.minutesForever <= 0) continue;
			desktopPlaytimeSnapshots.set(result.shortcutAppId, {
			shortcutAppId: result.shortcutAppId,
			title: result.title,
				minutesForever: result.minutesForever,
				minutesRecent: result.minutesRecent,
				lastPlayedAt: result.lastPlayedAt,
			});
	}
	persistDesktopPlaytimeSnapshots();
	await runWhenLibrarySidebarIdle(doc, 'desktop-playtime-cards', () => {
		if (isDesktopLibraryHomePlaytimeVisible(doc)) {
			patchDesktopLibraryHomePlaytimeCards(doc, Array.from(desktopPlaytimeSnapshots.values()));
		}
	});
	if (!isDesktopLibraryHomePlaytimeVisible(doc)) return;

	// The detail-page fallback is NativeGameLink-owned DOM. Keep it aligned with the
	// same resolved value used by Library Home.
	for (const result of results) {
		if (result.minutesForever <= 0) continue;
		const selector = `[data-gdl-playtime="1"][data-gdl-playtime-shortcut-id="${result.shortcutAppId}"] [data-gdl-playtime-value="1"]`;
		for (const value of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
			value.textContent = formatPlaytimeMinutes(result.minutesForever);
		}
	}
}
