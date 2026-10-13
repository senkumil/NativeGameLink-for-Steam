import { backendLog, getAllPlaytimeDataBackend, getPlaytimeDataBackend } from '../../api/backend';

export interface PlaytimeStats {
	minutesForever: number;
	minutesLastTwoWeeks: number;
	totalSeconds?: number;
	lastPlayedAt: number | null;
}

const PLAYTIME_STATS_CACHE_MS = 5000;
interface PlaytimeRequestEntry {
	expiresAt: number;
	request: Promise<PlaytimeStats | null>;
}

const playtimeStatsRequests = new Map<string, PlaytimeRequestEntry>();
const MAX_PLAYTIME_CACHE_ENTRIES = 96;
let playtimeRequestGeneration = 0;

export interface PlaytimeLookup {
	shortcutAppId: number;
	title: string;
	steamAppId?: string;
}

function requestKey(shortcutAppId: number, title: string, steamAppId?: string): string {
	return `${shortcutAppId}|${steamAppId || ''}|${title || ''}`;
}

function parsePlaytimeStats(parsed: any): PlaytimeStats | null {
	if (!parsed || typeof parsed !== 'object' || !parsed.ok) return null;
	const nonnegative = (value: unknown): number => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
	const secondsForever = nonnegative(parsed.seconds_forever || parsed.total_seconds || 0);
	return {
		totalSeconds: secondsForever,
		minutesForever: nonnegative(parsed.minutes_forever || 0),
		minutesLastTwoWeeks: nonnegative(parsed.minutes_last_two_weeks || 0),
		lastPlayedAt: nonnegative(parsed.last_played_at) || null,
	};
}

function trimPlaytimeCache(): void {
	if (playtimeStatsRequests.size <= MAX_PLAYTIME_CACHE_ENTRIES) return;
	const ordered = Array.from(playtimeStatsRequests.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
	for (const [key] of ordered) {
		if (playtimeStatsRequests.size <= MAX_PLAYTIME_CACHE_ENTRIES) break;
		playtimeStatsRequests.delete(key);
	}
}

async function fetchSinglePlaytimeStats(lookup: PlaytimeLookup): Promise<PlaytimeStats | null> {
	try {
		const raw = await getPlaytimeDataBackend({
			request_json: JSON.stringify({
				shortcut_app_id: String(lookup.shortcutAppId),
				steam_app_id: lookup.steamAppId || '',
				title: lookup.title || '',
			}),
		});
		let parsed: any = raw;
		for (let i = 0; i < 2 && typeof parsed === 'string'; i++) parsed = JSON.parse(parsed);
		return parsePlaytimeStats(parsed);
	} catch (error) {
		backendLog(`Failed to fetch playtime stats for ${lookup.title} (${lookup.shortcutAppId}): ${error}`);
		return null;
	}
}

const PLAYTIME_SNAPSHOT_STORAGE_KEY = 'gdl_playtime_stats_snapshot_v1';
interface InstantPlaytimeSnapshot { steamAppId: string; stats: PlaytimeStats }
const instantPlaytimeStats = new Map<number, InstantPlaytimeSnapshot>();

// Only backend-confirmed sessions belong in this cache. Steam's temporary
// shortcut values and the Library Home maximum are not canonical session data.
try {
	const raw = localStorage.getItem(PLAYTIME_SNAPSHOT_STORAGE_KEY);
	const parsed = raw ? JSON.parse(raw) : null;
	if (parsed?.version === 1 && Array.isArray(parsed.values)) {
		for (const item of parsed.values.slice(-MAX_PLAYTIME_CACHE_ENTRIES)) {
			const id = Number(item.shortcutAppId);
			const stats = item.stats;
			if (!Number.isInteger(id) || id <= 0 || !stats || ![stats.minutesForever, stats.minutesLastTwoWeeks]
				.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) continue;
			if (stats.lastPlayedAt !== null && (!Number.isFinite(stats.lastPlayedAt) || stats.lastPlayedAt <= 0)) continue;
			instantPlaytimeStats.set(id, { steamAppId: String(item.steamAppId || ''), stats });
		}
	}
} catch {}

function persistInstantPlaytimeStats(): void {
	try {
		const values = Array.from(instantPlaytimeStats, ([shortcutAppId, snapshot]) => ({ shortcutAppId, ...snapshot }));
		localStorage.setItem(PLAYTIME_SNAPSHOT_STORAGE_KEY, JSON.stringify({ version: 1, values }));
	} catch {}
}

export function getInstantPlaytimeStats(shortcutAppId: number, steamAppId?: string): PlaytimeStats | null {
	const snapshot = instantPlaytimeStats.get(shortcutAppId);
	if (!snapshot || (steamAppId && snapshot.steamAppId !== steamAppId)) return null;
	return snapshot.stats;
}

export function setInstantPlaytimeStats(shortcutAppId: number, stats: PlaytimeStats, steamAppId = ''): void {
	const snapshot = { steamAppId, stats };
	if (JSON.stringify(instantPlaytimeStats.get(shortcutAppId)) === JSON.stringify(snapshot)) return;
	instantPlaytimeStats.delete(shortcutAppId);
	instantPlaytimeStats.set(shortcutAppId, snapshot);
	while (instantPlaytimeStats.size > MAX_PLAYTIME_CACHE_ENTRIES) {
		instantPlaytimeStats.delete(instantPlaytimeStats.keys().next().value!);
	}
	persistInstantPlaytimeStats();
}

/** Resolve a complete Library shelf through one backend IPC. The single-item
 * endpoint remains as a compatibility fallback for a backend hot-reload that
 * has not picked up the batch callable yet. */
export async function fetchPlaytimeStatsBatch(lookups: PlaytimeLookup[]): Promise<Map<number, PlaytimeStats | null>> {
	const unique = Array.from(new Map(lookups.map(item => [item.shortcutAppId, item])).values());
	const now = Date.now();
	const missing = unique.filter(item => {
		const cached = playtimeStatsRequests.get(requestKey(item.shortcutAppId, item.title, item.steamAppId));
		return !cached || cached.expiresAt <= now;
	});

	if (missing.length > 0) {
		const generation = playtimeRequestGeneration;
		const batch = (async (): Promise<Map<string, PlaytimeStats | null>> => {
			const resolved = new Map<string, PlaytimeStats | null>();
			try {
				const raw = await getAllPlaytimeDataBackend({
					request_json: JSON.stringify({ requests: missing.map(item => ({
						key: requestKey(item.shortcutAppId, item.title, item.steamAppId),
						shortcut_app_id: String(item.shortcutAppId),
						steam_app_id: item.steamAppId || '',
						title: item.title || '',
					})) }),
				});
				let parsed: any = raw;
				for (let i = 0; i < 2 && typeof parsed === 'string'; i++) parsed = JSON.parse(parsed);
				for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
					const stats = parsePlaytimeStats(item);
					resolved.set(String(item.key || ''), stats);
				}
				return resolved;
			} catch {
				await Promise.all(missing.map(async item => {
					const stats = await fetchSinglePlaytimeStats(item);
					resolved.set(requestKey(item.shortcutAppId, item.title, item.steamAppId), stats);
				}));
				return resolved;
			}
		})();
		for (const item of missing) {
			const key = requestKey(item.shortcutAppId, item.title, item.steamAppId);
			const entry: PlaytimeRequestEntry = {
				expiresAt: now + PLAYTIME_STATS_CACHE_MS,
				request: Promise.resolve(null),
			};
			entry.request = batch.then(values => {
				const stats = values.get(key) ?? null;
				if (generation === playtimeRequestGeneration && playtimeStatsRequests.get(key) === entry) {
					if (stats) setInstantPlaytimeStats(item.shortcutAppId, stats, item.steamAppId || '');
					return stats;
				}
				return null;
			});
			playtimeStatsRequests.set(key, entry);
		}
		trimPlaytimeCache();
	}

	const result = new Map<number, PlaytimeStats | null>();
	await Promise.all(unique.map(async item => {
		const key = requestKey(item.shortcutAppId, item.title, item.steamAppId);
		const cached = playtimeStatsRequests.get(key);
		result.set(item.shortcutAppId, cached ? await cached.request : null);
	}));
	return result;
}

/** Read NativeGameLink's canonical session store. The short cache prevents Big
 * Picture's mutation-driven refreshes from repeatedly reopening the same file,
 * while remaining below the tracker's ten-second heartbeat interval. */
export function fetchPlaytimeStats(shortcutAppId: number, title: string, steamAppId?: string): Promise<PlaytimeStats | null> {
	const key = requestKey(shortcutAppId, title, steamAppId);
	const cached = playtimeStatsRequests.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.request;
	return fetchPlaytimeStatsBatch([{ shortcutAppId, title, steamAppId }]).then(values => values.get(shortcutAppId) ?? null);
}

export function clearPlaytimeStatsCache(): void {
	playtimeRequestGeneration += 1;
	playtimeStatsRequests.clear();
}

/** Drop only playtime lookups whose shortcut or linked Steam identity changed. */
export function invalidatePlaytimeStatsCache(
	steamAppIds: Iterable<string | number>,
	shortcutAppIds: Iterable<string | number> = [],
): void {
	const steamIds = new Set(Array.from(steamAppIds, value => String(value)).filter(Boolean));
	const shortcutIds = new Set(Array.from(shortcutAppIds, value => String(value)).filter(Boolean));
	if (steamIds.size === 0 && shortcutIds.size === 0) return;
	for (const key of Array.from(playtimeStatsRequests.keys())) {
		const [shortcutAppId, steamAppId] = key.split('|', 3);
		if (shortcutIds.has(shortcutAppId) || steamIds.has(steamAppId)) playtimeStatsRequests.delete(key);
	}
	let changed = false;
	for (const [shortcutAppId, snapshot] of instantPlaytimeStats) {
		if (shortcutIds.has(String(shortcutAppId)) || steamIds.has(snapshot.steamAppId)) {
			instantPlaytimeStats.delete(shortcutAppId);
			changed = true;
		}
	}
	if (changed) persistInstantPlaytimeStats();
}
