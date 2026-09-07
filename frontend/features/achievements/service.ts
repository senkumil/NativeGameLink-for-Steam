import { fetchLocalAchievementsBackend } from '../../api/backend';
import { getPreferences, simulatedAchievementsEnabled } from '../../core/preferences';
import type { LocalAchievementData } from '../../domain/types';
import { steamLanguageSync } from '../../steam/localization';
import { syncNativeAchievementProgressCache } from './progress';

export interface LocalAchievementRequestOptions {
	stateAppId?: string | number | null;
	allowSimulated?: boolean;
	/** Reuse a recent backend result. Zero still joins an identical request that
	 * is already in flight, but always checks the progress file again afterward. */
	maxAgeMs?: number;
}

export interface LocalAchievementUpdate {
	steamAppId: string;
	stateAppId: string;
	data: LocalAchievementData | null;
}

interface AchievementRequestCacheEntry {
	steamAppId: string;
	stateAppId: string;
	updatedAt: number;
	value: LocalAchievementData | null;
	inFlight: Promise<LocalAchievementData | null> | null;
}

const requestCache = new Map<string, AchievementRequestCacheEntry>();
const updateListeners = new Set<(update: LocalAchievementUpdate) => void>();
const DEFAULT_MAX_AGE_MS = 1250;
const MAX_REQUEST_CACHE_ENTRIES = 32;
let requestGeneration = 0;

function trimRequestCache(): void {
	if (requestCache.size <= MAX_REQUEST_CACHE_ENTRIES) return;
	const removable = Array.from(requestCache.entries())
		.filter(([, entry]) => !entry.inFlight)
		.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
	for (const [key] of removable) {
		if (requestCache.size <= MAX_REQUEST_CACHE_ENTRIES) break;
		requestCache.delete(key);
	}
}

function publishAchievementUpdate(update: LocalAchievementUpdate): void {
	if (update.data && typeof update.data.total === 'number') {
		syncNativeAchievementProgressCache(update.steamAppId, update.data.unlocked, update.data.total);
		if (update.stateAppId) {
			syncNativeAchievementProgressCache(update.stateAppId, update.data.unlocked, update.data.total);
		}
	}
	for (const listener of Array.from(updateListeners)) {
		try { listener(update); } catch {}
	}
}

export function subscribeLocalAchievementData(listener: (update: LocalAchievementUpdate) => void): () => void {
	updateListeners.add(listener);
	return () => updateListeners.delete(listener);
}

export function clearLocalAchievementRequestCache(): void {
	// Removing Map entries alone is not enough: a request that started before a
	// policy toggle still owns its Promise and could publish stale progress after
	// the new result. Advancing the generation makes those completions inert.
	requestGeneration += 1;
	requestCache.clear();
}

/** Invalidate only requests whose linked identity changed. Entry ownership is
 * checked again on completion, so deleted in-flight requests cannot publish. */
export function invalidateLocalAchievementRequests(
	steamAppIds: Iterable<string | number>,
	stateAppIds: Iterable<string | number> = [],
): void {
	const steamIds = new Set(Array.from(steamAppIds, value => String(value)).filter(Boolean));
	const stateIds = new Set(Array.from(stateAppIds, value => String(value)).filter(Boolean));
	if (steamIds.size === 0 && stateIds.size === 0) return;
	for (const [key, entry] of requestCache) {
		if (steamIds.has(entry.steamAppId) || stateIds.has(entry.stateAppId)) requestCache.delete(key);
	}
}

export function localAchievementRequestJson(
	steamAppId: string | number,
	options: LocalAchievementRequestOptions = {},
): string {
	const preferences = getPreferences();
	return JSON.stringify({
		steam_app_id: String(steamAppId),
		language: steamLanguageSync() || 'english',
		state_app_id: options.stateAppId == null ? '' : String(options.stateAppId),
		// Never enable the test fallback implicitly. It is enabled only when the
		// user has enabled both developer mode and simulated progress; callers may
		// still explicitly disable it for a particular request.
		allow_simulated: options.allowSimulated === true || (options.allowSimulated !== false && simulatedAchievementsEnabled()),
		// Full completion is intentionally per-game only.
		simulate_unlock_all: false,
		unlock_online: preferences.unlockOnlineAchievements,
	});
}

export async function fetchLocalAchievementData(
	steamAppId: string | number,
	options: LocalAchievementRequestOptions = {},
): Promise<LocalAchievementData | null> {
	const requestJson = localAchievementRequestJson(steamAppId, options);
	const now = Date.now();
	const maxAgeMs = Math.max(0, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
	const normalizedSteamAppId = String(steamAppId);
	const stateAppId = options.stateAppId == null ? '' : String(options.stateAppId);
	let entry = requestCache.get(requestJson);
	if (entry?.inFlight) return entry.inFlight;
	if (entry && now - entry.updatedAt <= maxAgeMs) return entry.value;
	if (!entry) {
		entry = { steamAppId: normalizedSteamAppId, stateAppId, updatedAt: 0, value: null, inFlight: null };
		requestCache.set(requestJson, entry);
	}
	const generation = requestGeneration;
	entry.inFlight = (async (): Promise<LocalAchievementData | null> => {
		let value: LocalAchievementData | null = null;
		try {
			const raw = await fetchLocalAchievementsBackend({ request_json: requestJson });
			const parsed = JSON.parse(raw) as LocalAchievementData;
			value = parsed && typeof parsed === 'object' ? parsed : null;
		} catch {}
		// A cache clear means a path, AppID or achievement policy changed while
		// this IPC was running. Its original caller must not repaint with that
		// obsolete response either.
		if (generation !== requestGeneration || requestCache.get(requestJson) !== entry) return null;
		entry!.value = value;
		entry!.updatedAt = Date.now();
		entry!.inFlight = null;
		publishAchievementUpdate({ steamAppId: normalizedSteamAppId, stateAppId, data: value });
		trimRequestCache();
		return value;
	})();
	return entry.inFlight;
}
