export interface GdlPreferences {
	autoDetectShortcuts: boolean;
	simulateAchievements: boolean;
	unlockOnlineAchievements: boolean;
	trackNonSteamPlaytime: boolean;
	autoCommunityArtwork: boolean;
	steamGridDbApiKey: string;
}

const STORAGE_KEY = 'gdl_preferences_v1';
const EVENT_NAME = 'gdl:preferences-changed';
// Shared distribution credential. Desktop bundles cannot keep embedded API
// credentials secret, so this value is intentionally treated as public and
// remains replaceable through Settings.
const DEFAULT_STEAMGRIDDB_API_KEY = '98d8ef4a6f4112f3184e3ce796fd75e5';
const FALLBACK_STEAMGRIDDB_API_KEY = 'a64e814def2dc7a2ad3218e952d66922';

export function defaultSteamGridDbApiKey(): string {
	return DEFAULT_STEAMGRIDDB_API_KEY;
}

export function steamGridDbApiKeyCandidates(preferredKey: string): string[] {
	return [...new Set([
		preferredKey.trim(),
		DEFAULT_STEAMGRIDDB_API_KEY,
		FALLBACK_STEAMGRIDDB_API_KEY,
	].filter(key => key.length >= 16 && key.length <= 160))];
}

export const DEFAULT_PREFERENCES: GdlPreferences = {
	autoDetectShortcuts: true,
	simulateAchievements: false,
	unlockOnlineAchievements: false,
	trackNonSteamPlaytime: true,
	autoCommunityArtwork: true,
	steamGridDbApiKey: DEFAULT_STEAMGRIDDB_API_KEY,
};

function sanitizePreferences(value: unknown): GdlPreferences {
	const record = value && typeof value === 'object' ? value as Partial<GdlPreferences> : {};
	return {
		autoDetectShortcuts: record.autoDetectShortcuts !== false,
		// This remains disabled by default, but no longer depends on a separate
		// developer-mode switch that did not provide any independent behavior.
		simulateAchievements: record.simulateAchievements === true,
		unlockOnlineAchievements: record.unlockOnlineAchievements === true,
		trackNonSteamPlaytime: record.trackNonSteamPlaytime !== false,
		autoCommunityArtwork: record.autoCommunityArtwork !== false,
		// Stored locally only. It is never logged or included in diagnostics.
		steamGridDbApiKey: typeof record.steamGridDbApiKey === 'string' && record.steamGridDbApiKey.trim()
			? record.steamGridDbApiKey.trim().slice(0, 160) : DEFAULT_STEAMGRIDDB_API_KEY,
	};
}

export function getPreferences(): GdlPreferences {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? sanitizePreferences(JSON.parse(raw)) : { ...DEFAULT_PREFERENCES };
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

export function setPreferences(patch: Partial<GdlPreferences>): GdlPreferences {
	const current = getPreferences();
	const next = sanitizePreferences({ ...current, ...patch });
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
	try { window.dispatchEvent(new CustomEvent<GdlPreferences>(EVENT_NAME, { detail: next })); } catch {}
	return next;
}

export function subscribePreferences(listener: (preferences: GdlPreferences) => void): () => void {
	const handler = (event: Event): void => {
		const detail = (event as CustomEvent<GdlPreferences>).detail;
		listener(detail ? sanitizePreferences(detail) : getPreferences());
	};
	window.addEventListener(EVENT_NAME, handler);
	return () => window.removeEventListener(EVENT_NAME, handler);
}

export function simulatedAchievementsEnabled(): boolean {
	return getPreferences().simulateAchievements;
}
