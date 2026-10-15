import type { LocalAchievementData } from '../../domain/types';

const localAchievementMemoryCache = new Map<string, LocalAchievementData>();
const MAX_LOCAL_ACHIEVEMENT_ALIASES = 192;
// Older snapshots could be aliased to the next shortcut by an in-flight
// navigation. Ignore that renderer cache; the underlying progress files remain.
const LOCAL_ACHIEVEMENT_SNAPSHOT_STORAGE_KEY = 'gdl_local_achievement_snapshots_v4';
const MAX_PERSISTED_ACHIEVEMENT_SNAPSHOTS = 64;
const PERSISTED_ACHIEVEMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface PersistedAchievementSnapshot {
	updatedAt: number;
	aliases: string[];
	signature: string;
	data: LocalAchievementData;
}

let persistedSnapshotsLoaded = false;
let persistedSnapshots: PersistedAchievementSnapshot[] = [];

/** Compact identity for both render deduplication and persistent-cache writes. */
export function localAchievementDataSignature(data: LocalAchievementData): string {
	const source = [
		data.appid, data.state_appid || '', data.unlocked, data.total,
		data.simulation_enabled ? 1 : 0, Number(data.simulate_count ?? data.simulate_percent ?? 0),
		Number(data.simulate_online_count ?? data.simulate_online_percent ?? 0), data.unlock_online ? 1 : 0, data.zero_progress ? 1 : 0,
		...data.achievements.map(item => [
			item.name, item.display_name, item.description, item.icon, item.icon_gray,
			item.earned ? 1 : 0, item.earned_time, item.progress, item.max_progress,
			item.is_online ? 1 : 0, item.hidden ? 1 : 0, item.global_percent ?? '', item.global_percent_known === false ? 0 : 1,
		].join(':')),
	].join('|');
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${data.appid}:${data.state_appid || ''}:${data.unlocked}:${data.total}:${(hash >>> 0).toString(16)}`;
}

function validPersistentData(value: unknown): value is LocalAchievementData {
	const data = value as Partial<LocalAchievementData> | null;
	return Boolean(data && data.found && /^\d+$/.test(String(data.appid || ''))
		&& Number(data.total) > 0 && Array.isArray(data.achievements));
}

function loadPersistedSnapshots(): void {
	if (persistedSnapshotsLoaded) return;
	persistedSnapshotsLoaded = true;
	try {
		const raw = localStorage.getItem(LOCAL_ACHIEVEMENT_SNAPSHOT_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) as { version?: number; entries?: unknown[] } : null;
		if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return;
		const cutoff = Date.now() - PERSISTED_ACHIEVEMENT_MAX_AGE_MS;
		persistedSnapshots = parsed.entries.flatMap(rawEntry => {
			const entry = rawEntry as Partial<PersistedAchievementSnapshot>;
			if (!validPersistentData(entry.data) || Number(entry.updatedAt || 0) < cutoff) return [];
			return [{
				updatedAt: Number(entry.updatedAt),
				aliases: Array.from(new Set((Array.isArray(entry.aliases) ? entry.aliases : [])
					.map(String).filter(Boolean))),
				signature: String(entry.signature || localAchievementDataSignature(entry.data)),
				data: entry.data,
			}];
		}).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PERSISTED_ACHIEVEMENT_SNAPSHOTS);
	} catch { persistedSnapshots = []; }
}

function persistSnapshots(): void {
	try {
		localStorage.setItem(LOCAL_ACHIEVEMENT_SNAPSHOT_STORAGE_KEY, JSON.stringify({
			version: 1,
			entries: persistedSnapshots.slice(0, MAX_PERSISTED_ACHIEVEMENT_SNAPSHOTS),
		}));
	} catch {}
}

function memoryCache(data: LocalAchievementData, aliases: string[]): void {
	for (const alias of aliases) {
		localAchievementMemoryCache.delete(alias);
		localAchievementMemoryCache.set(alias, data);
	}
	trimLocalAchievementCache();
}

function trimLocalAchievementCache(): void {
	while (localAchievementMemoryCache.size > MAX_LOCAL_ACHIEVEMENT_ALIASES) {
		const oldest = localAchievementMemoryCache.keys().next().value as string | undefined;
		if (!oldest) break;
		localAchievementMemoryCache.delete(oldest);
	}
}

export function getCachedLocalAchievements(...keys: Array<string | null | undefined>): LocalAchievementData | null {
	for (const key of keys) {
		if (!key) continue;
		const value = localAchievementMemoryCache.get(key);
		if (value) {
			localAchievementMemoryCache.delete(key);
			localAchievementMemoryCache.set(key, value);
			return value;
		}
	}
	loadPersistedSnapshots();
	for (const key of keys.map(value => String(value || '')).filter(Boolean)) {
		const snapshot = persistedSnapshots.find(entry => entry.aliases.includes(key));
		if (!snapshot) continue;
		snapshot.updatedAt = Date.now();
		memoryCache(snapshot.data, snapshot.aliases);
		return snapshot.data;
	}
	return null;
}

/** Resolve a snapshot for one linked Steam game without trusting a shortcut
 * alias by itself. A shortcut can keep the same local ID after it is relinked,
 * so an alias left by the previous Steam AppID must never seed the new page. */
export function getCachedLocalAchievementsForGame(
	steamAppId: string | number | null | undefined,
	...aliases: Array<string | number | null | undefined>
): LocalAchievementData | null {
	const expectedAppId = String(steamAppId || '');
	if (!/^\d+$/.test(expectedAppId)) return null;
	const keys = Array.from(new Set([expectedAppId, ...aliases.map(value => String(value || ''))].filter(Boolean)));
	const belongsToGame = (data: LocalAchievementData): boolean =>
		String(data.metadata_appid || data.appid || '') === expectedAppId;
	for (const key of keys) {
		const value = localAchievementMemoryCache.get(key);
		if (!value || !belongsToGame(value)) continue;
		localAchievementMemoryCache.delete(key);
		localAchievementMemoryCache.set(key, value);
		return value;
	}
	loadPersistedSnapshots();
	for (const key of keys) {
		const snapshot = persistedSnapshots.find(entry =>
			entry.aliases.includes(key) && belongsToGame(entry.data));
		if (!snapshot) continue;
		snapshot.updatedAt = Date.now();
		memoryCache(snapshot.data, snapshot.aliases);
		return snapshot.data;
	}
	return null;
}

function achievementSnapshotIdentity(data: LocalAchievementData): string {
	return JSON.stringify([
		String(data.metadata_appid || data.appid || ''),
		String(data.state_appid || ''),
		String(data.path || ''),
		String(data.root || ''),
	]);
}

function findCachedAchievementSnapshot(
	keys: string[],
	matches: (data: LocalAchievementData) => boolean,
): LocalAchievementData | null {
	for (const key of keys) {
		const value = localAchievementMemoryCache.get(key);
		if (value && matches(value)) {
			localAchievementMemoryCache.delete(key);
			localAchievementMemoryCache.set(key, value);
			return value;
		}
		loadPersistedSnapshots();
		const snapshot = persistedSnapshots.find(entry =>
			entry.aliases.includes(key) && matches(entry.data));
		if (!snapshot) continue;
		snapshot.updatedAt = Date.now();
		memoryCache(snapshot.data, snapshot.aliases);
		return snapshot.data;
	}
	return null;
}

/** Early rendering needs this shortcut's own snapshot. A shared Steam AppID
 * alias can belong to another installation, and state_appid is backend
 * provenance rather than proof that a snapshot belongs to this shortcut. */
export function getCachedLocalAchievementsForShortcut(
	steamAppId: string | number | null | undefined,
	shortcutId: string | number | null | undefined,
): LocalAchievementData | null {
	const expectedAppId = String(steamAppId || '');
	const shortcutAlias = String(shortcutId || '');
	if (!/^\d+$/.test(expectedAppId) || !/^\d+$/.test(shortcutAlias)) return null;
	return findCachedAchievementSnapshot([shortcutAlias], data =>
		String(data.metadata_appid || data.appid || '') === expectedAppId);
}

/** Reuse a newer cached result only when it describes the same local source. */
export function pickCachedLocalAchievementSnapshot(data: LocalAchievementData): LocalAchievementData {
	const identity = achievementSnapshotIdentity(data);
	const keys = Array.from(new Set([data.state_appid, data.appid, data.metadata_appid]
		.map(value => String(value || '')).filter(Boolean)));
	return findCachedAchievementSnapshot(keys, cached =>
		achievementSnapshotIdentity(cached) === identity) || data;
}

export function hasCachedLocalAchievements(key: string): boolean {
	return Boolean(getCachedLocalAchievements(key));
}

export function cacheLocalAchievements(data: LocalAchievementData, ...aliases: Array<string | null | undefined>): void {
	if (!validPersistentData(data)) return;
	// state_appid identifies the backend progress file, which can be shared by
	// installations. Only the caller's explicit alias proves shortcut ownership.
	const allAliases = Array.from(new Set([data.metadata_appid || data.appid, ...aliases]
		.map(value => String(value || '')).filter(Boolean)));
	memoryCache(data, allAliases);
	loadPersistedSnapshots();
	const signature = localAchievementDataSignature(data);
	const identity = achievementSnapshotIdentity(data);
	const existingIndex = persistedSnapshots.findIndex(entry =>
		achievementSnapshotIdentity(entry.data) === identity);
	const existing = existingIndex >= 0 ? persistedSnapshots[existingIndex] : null;
	if (existing?.signature === signature
		&& allAliases.every(alias => existing.aliases.includes(alias))) return;
	const next: PersistedAchievementSnapshot = {
		updatedAt: Date.now(),
		aliases: Array.from(new Set([...(existing?.aliases || []), ...allAliases])),
		signature,
		data,
	};
	if (existingIndex >= 0) persistedSnapshots.splice(existingIndex, 1);
	persistedSnapshots.unshift(next);
	persistedSnapshots = persistedSnapshots.slice(0, MAX_PERSISTED_ACHIEVEMENT_SNAPSHOTS);
	persistSnapshots();
}

export function clearLocalAchievementCache(clearPersistent = true): void {
	localAchievementMemoryCache.clear();
	if (!clearPersistent) return;
	persistedSnapshotsLoaded = true;
	persistedSnapshots = [];
	try { localStorage.removeItem(LOCAL_ACHIEVEMENT_SNAPSHOT_STORAGE_KEY); } catch {}
}

/** Remove shortcut-scoped aliases after relinking while preserving the same
 * achievement data under its real Steam AppID for future offline use. */
export function invalidateLocalAchievementAliases(aliases: Iterable<string | number>): void {
	const targets = new Set(Array.from(aliases, value => String(value)).filter(Boolean));
	if (targets.size === 0) return;
	for (const alias of targets) localAchievementMemoryCache.delete(alias);
	loadPersistedSnapshots();
	let changed = false;
	for (const snapshot of persistedSnapshots) {
		const nextAliases = snapshot.aliases.filter(alias => !targets.has(alias));
		if (nextAliases.length === snapshot.aliases.length) continue;
		snapshot.aliases = nextAliases;
		changed = true;
	}
	if (changed) {
		persistedSnapshots = persistedSnapshots.filter(snapshot => snapshot.aliases.length > 0);
		persistSnapshots();
	}
}
