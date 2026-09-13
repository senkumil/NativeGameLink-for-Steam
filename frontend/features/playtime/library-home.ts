import { getMappedShortcuts, getShortcutAppById, getShortcutPlaytimeMinutes } from '../../steam/shortcuts';
import { fetchPlaytimeStatsBatch, type PlaytimeStats, setInstantPlaytimeStats } from './service';
import { formatPlaytimeMinutes } from './format';
import { isShortcutPlaytimeTrackingEnabled } from './playtime-settings';
import {
	patchDesktopLibraryHomePlaytimeCards,
	type DesktopPlaytimeDomSnapshot,
} from './library-home-dom';

type DesktopPlaytimeKey =
	| 'minutes_playtime_forever'
	| 'minutes_playtime_last_two_weeks'
	| 'rt_last_time_played'
	| 'rt_recent_activity_time';

interface DesktopPlaytimeRefreshResult {
	changed: boolean;
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
			setInstantPlaytimeStats(shortcutAppId, {
				minutesForever,
				minutesLastTwoWeeks: minutesRecent,
				lastPlayedAt: lastPlayedAt || null,
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
const desktopPlaytimeHydratedApps = new WeakSet<object>();

/** Distinguish a value supplied by NativeGameLink from playtime Steam already
 * provided. The detail fallback must not mistake our AppOverview hydration for
 * an independent native source and then remove its own synchronized widget. */
export function isDesktopLibraryPlaytimeHydrated(app: unknown): boolean {
	return Boolean(app && typeof app === 'object' && desktopPlaytimeHydratedApps.has(app as object));
}

function normalizedWholeNumber(value: unknown): number {
	const number = Number(value || 0);
	return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function setDesktopPlaytimeField(target: any, key: DesktopPlaytimeKey, value: number): boolean {
	const current = normalizedWholeNumber(target?.[key]);
	if (value <= current) return false;
	let changed = false;
	const keysToUpdate: string[] = [key];
	if (key === 'minutes_playtime_forever') keysToUpdate.push('m_nPlaytimeForever', 'nPlaytimeForever');
	else if (key === 'minutes_playtime_last_two_weeks') keysToUpdate.push('m_nPlaytime2Weeks');
	else if (key === 'rt_last_time_played') keysToUpdate.push('m_rtimeLastPlayed', 'rtime_last_played');
	else if (key === 'rt_recent_activity_time') keysToUpdate.push('m_rtimeRecentActivity');

	for (const k of keysToUpdate) {
		try {
			target[k] = value;
			if (normalizedWholeNumber(target[k]) >= value) changed = true;
		} catch {}

		try {
			const ownDescriptor = Object.getOwnPropertyDescriptor(target, k);
			Object.defineProperty(target, k, {
				configurable: true,
				enumerable: ownDescriptor?.enumerable ?? true,
				writable: true,
				value,
			});
			if (normalizedWholeNumber(target[k]) >= value) changed = true;
		} catch {}
	}
	return changed;
}

async function refreshDesktopShortcutPlaytime(
	shortcut: { id: number; title: string; steamAppId: string },
	fallback: PlaytimeStats | null,
): Promise<DesktopPlaytimeRefreshResult> {
	if (!isShortcutPlaytimeTrackingEnabled(shortcut.id)) fallback = null;
	const existing = desktopPlaytimeRefreshes.get(shortcut.id);
	if (existing) return existing;

	const refresh = (async (): Promise<DesktopPlaytimeRefreshResult> => {
		const app = getShortcutAppById(shortcut.id);
		if (!app) return {
			changed: false,
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
		if (!fallback && !nativeMinutes) return {
			changed: false,
			shortcutAppId: shortcut.id,
			title: shortcut.title,
			minutesForever: 0,
			minutesRecent: 0,
			lastPlayedAt: 0,
		};
		if (Number(fallback?.minutesForever || 0) > 0) desktopPlaytimeHydratedApps.add(app);

		// Never reduce a value Steam already knows. The canonical NativeGameLink
		// sessions fill only the zero/older shortcut values that Steam leaves on
		// desktop Library Home cards.
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

		let changed = false;
		if (setDesktopPlaytimeField(app, 'minutes_playtime_forever', forever)) changed = true;
		if (setDesktopPlaytimeField(app, 'minutes_playtime_last_two_weeks', recent)) changed = true;
		if (lastPlayedAt > 0) {
			if (setDesktopPlaytimeField(app, 'rt_last_time_played', lastPlayedAt)) changed = true;
			if (setDesktopPlaytimeField(app, 'rt_recent_activity_time', lastPlayedAt)) changed = true;
		}
		return {
			changed,
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
	const snapshots = Array.from(desktopPlaytimeSnapshots.values());
	for (const snapshot of snapshots) {
		const app = getShortcutAppById(snapshot.shortcutAppId);
		if (!app) continue;
		try { (app as any).canonicalAppType = 1; } catch {}
		try { (app as any).controller_support = 2; } catch {}
		try { (app as any).xbox_controller_support = 2; } catch {}
		try { (app as any).gamepad_preferred = true; } catch {}
		try {
			const proto = Object.getPrototypeOf(app);
			if (proto && typeof proto.BIsShortcut === 'function' && !proto.BIsShortcut.__gdlDesktopWrapped) {
				const orig = proto.BIsShortcut;
				const wrapped = function (this: any) {
					if (this && (Number(this.appid) >= 2147483648 || Number(this.app_type) === 1073741824)) {
						return false;
					}
					return orig.call(this);
				};
				(wrapped as any).__gdlDesktopWrapped = true;
				try {
					Object.defineProperty(proto, 'BIsShortcut', {
						configurable: true,
						writable: true,
						value: wrapped,
					});
				} catch {
					try {
						Object.defineProperty(app, 'BIsShortcut', {
							configurable: true,
							writable: true,
							value: wrapped,
						});
					} catch {}
				}
			}
		} catch {}
		if (snapshot.minutesForever <= 0) continue;
		desktopPlaytimeHydratedApps.add(app);
		setDesktopPlaytimeField(app, 'minutes_playtime_forever', snapshot.minutesForever);
		setDesktopPlaytimeField(app, 'minutes_playtime_last_two_weeks', snapshot.minutesRecent);
		if (Number(snapshot.lastPlayedAt || 0) > 0) {
			setDesktopPlaytimeField(app, 'rt_last_time_played', Number(snapshot.lastPlayedAt));
			setDesktopPlaytimeField(app, 'rt_recent_activity_time', Number(snapshot.lastPlayedAt));
		}
	}
	patchDesktopLibraryHomePlaytimeCards(doc, snapshots);
}

/** Hydrate Steam Desktop's native AppOverview model for linked non-Steam
 * shortcuts. Library Home renders both "Total" and "Last two weeks" directly
 * from these fields; updating only the detail-page DOM cannot affect the shelf. */
export async function patchDesktopLibraryHomePlaytime(doc: Document): Promise<void> {
	if (!doc.body || doc.hidden) return;
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
	const results = await Promise.all(shortcuts.map(shortcut =>
		refreshDesktopShortcutPlaytime(shortcut, fallbacks.get(shortcut.id) ?? null)));
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
	syncDesktopLibraryHomePlaytimeDom(doc);

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
