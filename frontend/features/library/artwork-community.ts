import { backendLog, fetchCommunityArtworkBackend, fetchCommunityArtworkCandidatesBackend } from '../../api/backend';
import { getPreferences, steamGridDbApiKeyCandidates } from '../../core/preferences';
import { RetryingRequestCache } from '../../core/request-cache';
import { isLegacyGame } from './legacy-games';
import { readAssetWithDeadline } from './asset-deadline';

export interface CommunityArtworkAssets {
	found?: boolean;
	portrait?: string;
	hero?: string;
	logo?: string;
	wide?: string;
	icon?: string;
	curated?: boolean;
	transient_error?: boolean;
	source?: string;
	provenance?: Partial<Record<'portrait' | 'hero' | 'logo' | 'wide' | 'icon', {
		id?: number | string;
		provider?: string;
		width?: number;
		height?: number;
		language?: string;
		style?: string;
		transparent?: boolean;
	}>>;
	defaults?: Partial<Record<'portrait' | 'hero' | 'logo' | 'wide' | 'icon', string | number>>;
	slots?: Partial<Record<'portrait' | 'hero' | 'logo' | 'wide' | 'icon', unknown[]>>;
}

const retiredPreferenceRequests = new RetryingRequestCache<boolean>({
	ttlMs: 10 * 60 * 1000,
	retries: 1,
	baseDelayMs: 200,
});
const communityArtworkRequests = new RetryingRequestCache<CommunityArtworkAssets>({
	ttlMs: 10 * 60 * 1000,
	retries: 1,
	baseDelayMs: 250,
	isCacheable: (value): value is CommunityArtworkAssets => Boolean(value && value.transient_error !== true),
});

function apiKeyFingerprint(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

export async function retiredCommunityArtworkPreferred(steamAppId: string): Promise<boolean> {
	if (isLegacyGame(steamAppId)) return true;
	try {
		return await retiredPreferenceRequests.get(steamAppId, async () => {
			const raw = await readAssetWithDeadline(fetchCommunityArtworkCandidatesBackend({ request_json: JSON.stringify({
				steam_app_id: steamAppId, eligibility_only: true,
			}) }), 4_000);
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			return parsed && typeof parsed === 'object' ? parsed.eligible === true : null;
		}) ?? false;
	} catch (error) {
		// A transport failure is deliberately not cached as a negative answer.
		backendLog('Retired artwork eligibility failed for ' + steamAppId + ': ' + String(error));
		return false;
	}
}

export async function getCommunityArtwork(steamAppId: string): Promise<CommunityArtworkAssets | null> {
	const preferences = getPreferences();
	if (!preferences.autoCommunityArtwork || !preferences.steamGridDbApiKey) return null;
	const key = `${steamAppId}:${apiKeyFingerprint(preferences.steamGridDbApiKey)}`;
	try {
		const result = await communityArtworkRequests.get(key, async () => {
			const raw = await readAssetWithDeadline(fetchCommunityArtworkBackend({ request_json: JSON.stringify({
				steam_app_id: steamAppId,
				api_key: preferences.steamGridDbApiKey,
				api_keys: steamGridDbApiKeyCandidates(preferences.steamGridDbApiKey),
			}) }), 8_000);
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			return parsed && typeof parsed === 'object' && !parsed.error
				? parsed as CommunityArtworkAssets : null;
		});
		return result?.found ? result : null;
	} catch (error) {
		backendLog('Community artwork lookup failed for ' + steamAppId + ': ' + String(error));
		return null;
	}
}

export function clearCommunityArtworkCaches(appIds?: Iterable<string | number>): void {
	if (!appIds) {
		retiredPreferenceRequests.clear();
		communityArtworkRequests.clear();
		return;
	}
	const ids = new Set(Array.from(appIds, value => String(value)));
	for (const appId of ids) retiredPreferenceRequests.invalidate(appId);
	communityArtworkRequests.invalidateMatching(key => ids.has(key.split(':', 1)[0]));
}
