import { backendLog, readCustomLogoPositionBackend, saveCustomLogoPositionBackend } from '../../api/backend';
import { layoutFingerprint, readLogoLayout, STEAM_DEFAULT_LOGO_POSITION, type SteamLogoPinPosition } from './logo-layout';
import { saveNativeShortcutLogoPosition } from './native-logo-position';

export type { SteamLogoPinPosition };

export interface SteamLogoPosition {
	pinnedPosition: SteamLogoPinPosition;
	nWidthPct: number;
	nHeightPct: number;
}

type LogoLayout = { logo: string; hero: string; key: string };
type PositionRequest = { steamAppId: string; signature: string; official: boolean; manual: boolean; cancelled: boolean; layout?: LogoLayout; promise: Promise<boolean> };
const positionRequests = new Map<number, PositionRequest>();
const STORAGE_PREFIX = 'gdl_logo_position4_';
const PREVIOUS_PREFIXES = ['gdl_logo_position1_', 'gdl_logo_position2_', 'gdl_logo_position3_'];
const ADJUSTMENTS = 'gdl_logo_adjustments1_';
const PROFILE_REVISION = 6;

function stored(key: string): any {
	try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

// Steam TopCapsule's own default. Per-game appinfo percentages are retained
// unchanged; image aspect ratio and the native CSS determine the painted size.
function normalize(raw: any, fallbackPin: SteamLogoPinPosition = 'BottomLeft'): SteamLogoPosition {
	const rawPin = String(raw?.pinnedPosition ?? raw?.pinned_position ?? '').replace(/[^a-z]/gi, '').toLowerCase();
	const pins: Record<string, SteamLogoPinPosition> = {
		bottomleft: 'BottomLeft', upperleft: 'UpperLeft', centercenter: 'CenterCenter',
		uppercenter: 'UpperCenter', bottomcenter: 'BottomCenter',
	};
	const num = (value: unknown): number => {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 5 && parsed <= 100 ? parsed : STEAM_DEFAULT_LOGO_POSITION.nWidthPct;
	};
	const defaultPin = Object.values(pins).includes(fallbackPin) ? fallbackPin : STEAM_DEFAULT_LOGO_POSITION.pinnedPosition;
	return {
		pinnedPosition: pins[rawPin] || defaultPin,
		nWidthPct: num(raw?.nWidthPct ?? raw?.width_pct ?? raw?.widthPct),
		nHeightPct: num(raw?.nHeightPct ?? raw?.height_pct ?? raw?.heightPct),
	};
}

function same(a: any, b: any): boolean {
	return !!a && !!b && a.pinnedPosition === b.pinnedPosition
		&& Math.abs(Number(a.nWidthPct) - Number(b.nWidthPct)) < 0.001
		&& Math.abs(Number(a.nHeightPct) - Number(b.nHeightPct)) < 0.001;
}

function markSaved(shortcutAppId: number, steamAppId: string, expected: SteamLogoPosition, source: string, pairKey = ''): void {
	try {
		localStorage.setItem(STORAGE_PREFIX + shortcutAppId, JSON.stringify({
			steamAppId, version: 4, profileRevision: PROFILE_REVISION, source, pairKey,
			expectedPosition: expected, verifiedPosition: expected, verified: true, verifiedAt: Date.now(),
		}));
	} catch {}
}

export function isLogoPositionVerified(shortcutAppId: number, steamAppId: string): boolean {
	const marker = stored(STORAGE_PREFIX + shortcutAppId);
	return marker?.steamAppId === steamAppId && marker?.verified === true
		&& marker?.profileRevision === PROFILE_REVISION;
}

function cancelPositionRequest(shortcutAppId: number): void {
	const request = positionRequests.get(shortcutAppId);
	if (request) request.cancelled = true;
}

export function clearLogoPositionSaved(shortcutAppId: number): void {
	cancelPositionRequest(shortcutAppId);
	try {
		localStorage.removeItem(STORAGE_PREFIX + shortcutAppId);
		for (const prefix of PREVIOUS_PREFIXES) localStorage.removeItem(prefix + shortcutAppId);
	} catch {}
}

export function invalidateLogoPosition(shortcutAppId: number): void {
	cancelPositionRequest(shortcutAppId);
	try {
		const key = STORAGE_PREFIX + shortcutAppId;
		const marker = stored(key);
		if (marker) localStorage.setItem(key, JSON.stringify({ ...marker, verified: false }));
	} catch {}
}

export function isLogoPositionStorageKey(key: string): boolean {
	return key.startsWith(ADJUSTMENTS) || key.startsWith(STORAGE_PREFIX) || PREVIOUS_PREFIXES.some(prefix => key.startsWith(prefix));
}

function legacyAutomaticPosition(position: SteamLogoPosition): boolean {
	const w = Number(position.nWidthPct), h = Number(position.nHeightPct);
	return (w === 100 && (h === 45 || h === 65)) || (w === h && [50, 58, 70].includes(w))
		|| (w === 40 && h === 32) || (w === 38 && h === 40) || (w === 30 && h === 45);
}

async function applyPosition(
	shortcutAppId: number, steamAppId: string, rawPosition: unknown, force: boolean,
	fallbackPin: SteamLogoPinPosition, source: string, isCurrent: () => boolean, suppliedLayout?: LogoLayout,
): Promise<boolean> {
	if (!isCurrent()) return false;
	if (!force && isLogoPositionVerified(shortcutAppId, steamAppId)) return true;
	let position = normalize(rawPosition, rawPosition ? fallbackPin : 'BottomLeft');
	const previous = stored(STORAGE_PREFIX + shortcutAppId);
	const previousForGame = previous?.steamAppId === steamAppId ? previous : null;
	const reset = source === 'automatic_reset';
	const manual = source === 'manual';
	// Backend-only downloads have no prospective pair to verify. A new explicit
	// artwork choice must not borrow an adjustment from the previously installed logo.
	const unknownNewPair = force && !suppliedLayout && (source === 'community' || source === 'user_selection');
	try {
		let response: any = await readCustomLogoPositionBackend({ shortcut_app_id: String(shortcutAppId) });
		for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt++) response = JSON.parse(response);
		if (!isCurrent()) return false;
		const actual = response?.ok && response?.exists ? response.logo_position : null;
		const adjustments = stored(ADJUSTMENTS + shortcutAppId) || {};
		const hasAdjustment = Object.keys(adjustments).some(key => key.startsWith(steamAppId + ':'));
		const changedInSteam = actual && previousForGame?.expectedPosition && !same(actual, previousForGame.expectedPosition);
		let layout = suppliedLayout;
		if (!unknownNewPair && !layout?.key && (manual || reset || hasAdjustment || changedInSteam || previousForGame?.source === 'manual')) {
			try {
				const installed = await readLogoLayout(shortcutAppId);
				if (layout) {
					const logo = layout.logo || installed.logo, hero = layout.hero || installed.hero;
					layout = { logo, hero, key: layoutFingerprint(logo, hero) };
				} else layout = installed;
			}
			catch (error) { backendLog(`Logo layout pair unavailable for ${shortcutAppId}: ${String(error)}`); }
		}
		if (!isCurrent()) return false;
		const pairKey = unknownNewPair ? '' : layout?.key || previousForGame?.pairKey || '';
		const samePair = !layout || !previousForGame?.pairKey || previousForGame.pairKey === pairKey;
		const savedAdjustment = !reset && !unknownNewPair && pairKey ? getLogoAdjustment(shortcutAppId, steamAppId, pairKey) : null;
		const explicitPrevious = previousForGame?.source === 'manual' || previousForGame?.source === 'preserved_native_adjustment';
		const preserved = !force && actual && samePair && (changedInSteam || explicitPrevious
			|| (!previousForGame?.expectedPosition && !legacyAutomaticPosition(actual)));
		const explicitSaved = savedAdjustment && (explicitPrevious || (!same(savedAdjustment, previousForGame?.expectedPosition)
			&& !legacyAutomaticPosition(savedAdjustment)));
		if (!manual && !reset && (preserved || explicitSaved)) {
			position = normalize(preserved ? actual : savedAdjustment, fallbackPin);
			source = 'preserved_native_adjustment';
			if (pairKey) rememberLogoAdjustment(shortcutAppId, steamAppId, pairKey, position);
		} else if (manual) {
			position = normalize(rawPosition, fallbackPin);
		} else {
			source = rawPosition ? 'native_official' : 'native_default';
		}
		if (!isCurrent()) return false;
		// Keep disk and Steam's own custom-image cache on the same final position.
		// No image decoding, hero analysis or second automatic sizing pass occurs.
		if (!same(actual, position)) {
			try { await saveCustomLogoPositionBackend({ request_json: JSON.stringify({ shortcut_app_id: String(shortcutAppId), logo_position: position }) }); }
			catch (error) { backendLog(`Disk logo position save error for ${shortcutAppId}: ${String(error)}`); }
		}
		if (!isCurrent()) return false;
		for (let attempt = 0; attempt < 3; attempt++) {
			const accepted = await saveNativeShortcutLogoPosition(shortcutAppId, position, isCurrent);
			if (!isCurrent()) return false;
			if (accepted) {
				markSaved(shortcutAppId, steamAppId, position, source, pairKey);
				backendLog(`Native logo position settled for ${shortcutAppId} -> ${steamAppId}: ${JSON.stringify(position)}`);
				return true;
			}
			if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200));
			if (!isCurrent()) return false;
		}
	} catch (error) {
		backendLog(`Could not apply logo position for ${shortcutAppId}: ${String(error)}`);
	}
	return false;
}

export function applyLogoPosition(
	shortcutAppId: number, steamAppId: string, rawPosition: unknown, force: boolean,
	fallbackPin: SteamLogoPinPosition, source: string, isCurrent: () => boolean, layout?: LogoLayout,
): Promise<boolean> {
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < 2147483648 || shortcutAppId > 4294967295
		|| !/^\d+$/.test(steamAppId) || !isCurrent()) return Promise.resolve(false);
	const active = positionRequests.get(shortcutAppId);
	const signature = JSON.stringify([steamAppId, rawPosition, force, source, layout?.key]);
	const manual = source === 'manual' || source === 'automatic_reset';
	if (active && !active.cancelled && active.steamAppId === steamAppId && ((active.signature === signature && (!layout || layout.key || active.layout === layout))
		|| (!force && (active.official || !rawPosition || active.manual)))) return active.promise;
	// A newer intent supersedes pending work and waits for any already-sent native
	// bridge call, so an older completion can never become the final disk/cache write.
	const request: PositionRequest = { steamAppId, signature, official: Boolean(rawPosition), manual, cancelled: false, layout, promise: Promise.resolve(false) };
	positionRequests.set(shortcutAppId, request);
	const current = (): boolean => positionRequests.get(shortcutAppId) === request && !request.cancelled && isCurrent();
	request.promise = Promise.resolve(active?.promise).catch(() => false)
		.then(() => applyPosition(shortcutAppId, steamAppId, rawPosition, force, fallbackPin, source, current, layout))
		.finally(() => { if (positionRequests.get(shortcutAppId) === request) positionRequests.delete(shortcutAppId); });
	return request.promise;
}

export function getLogoAdjustment(id: number, appId: string, pair: string): SteamLogoPosition | null {
	return stored(ADJUSTMENTS + id)?.[appId + ':' + pair] || null;
}

export function rememberLogoAdjustment(id: number, appId: string, pair: string, position: SteamLogoPosition): void {
	const key = ADJUSTMENTS + id;
	const saved = stored(key) || {};
	const item = appId + ':' + pair;
	delete saved[item]; saved[item] = position;
	while (Object.keys(saved).length > 16) delete saved[Object.keys(saved)[0]];
	try { localStorage.setItem(key, JSON.stringify(saved)); } catch {}
}
