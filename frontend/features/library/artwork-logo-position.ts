import { backendLog, readCustomLogoPositionBackend, saveCustomLogoPositionBackend } from '../../api/backend';
import { readLogoLayout, prepareAutomaticLogo, layoutFingerprint, detectHeroEmptySpace, type SteamLogoPinPosition } from './logo-layout';
import { waitForSteamBridge } from './steam-bridge';

export type { SteamLogoPinPosition };

export interface SteamLogoPosition {
	pinnedPosition: SteamLogoPinPosition;
	nWidthPct: number;
	nHeightPct: number;
}

const STORAGE_PREFIX = 'gdl_logo_position4_';
const PREVIOUS_PREFIXES = ['gdl_logo_position1_', 'gdl_logo_position2_', 'gdl_logo_position3_'];
const PES_2013_POSITION: SteamLogoPosition = { pinnedPosition: 'BottomCenter', nWidthPct: 50, nHeightPct: 50 };
const MKK_POSITION: SteamLogoPosition = { pinnedPosition: 'CenterCenter', nWidthPct: 58, nHeightPct: 58 };

const CURATED_POSITIONS: Record<string, SteamLogoPosition> = {
	'221430': PES_2013_POSITION,
	'237110': MKK_POSITION,
};

function profileRevision(steamAppId: string): number {
	if (steamAppId === '221430') return 11;
	if (steamAppId === '237110') return 8;
	return 5;
}

function normalize(raw: any, fallbackPin: SteamLogoPinPosition): SteamLogoPosition {
	const rawPin = String(raw?.pinnedPosition ?? raw?.pinned_position ?? '').replace(/[^a-z]/gi, '').toLowerCase();
	const pins: Record<string, SteamLogoPinPosition> = {
		bottomleft: 'BottomLeft', upperleft: 'UpperLeft', centercenter: 'CenterCenter',
		uppercenter: 'UpperCenter', bottomcenter: 'BottomCenter',
	};
	const num = (value: unknown, fallback: number): number => {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 5 && parsed <= 100 ? parsed : fallback;
	};
	return {
		pinnedPosition: pins[rawPin] || fallbackPin,
		nWidthPct: num(raw?.nWidthPct ?? raw?.width_pct ?? raw?.widthPct, 50),
		nHeightPct: num(raw?.nHeightPct ?? raw?.height_pct ?? raw?.heightPct, 50),
	};
}

function targetPosition(steamAppId: string, raw: unknown, fallbackPin: SteamLogoPinPosition): SteamLogoPosition {
	if (raw) return normalize(raw, fallbackPin);
	if (CURATED_POSITIONS[steamAppId]) return CURATED_POSITIONS[steamAppId];
	return normalize(raw, fallbackPin);
}

function markSaved(shortcutAppId: number, steamAppId: string, expected: SteamLogoPosition, source: string,
	verifiedPosition?: SteamLogoPosition, pairKey = ''): void {
	try {
		localStorage.setItem(STORAGE_PREFIX + shortcutAppId, JSON.stringify({
			steamAppId, version: 4, profileRevision: profileRevision(steamAppId), source,
			pairKey, expectedPosition: expected, verifiedPosition, verified: true, verifiedAt: Date.now(),
		}));
	} catch {}
}

export function isLogoPositionVerified(shortcutAppId: number, steamAppId: string): boolean {
	try {
		const marker = JSON.parse(localStorage.getItem(STORAGE_PREFIX + shortcutAppId) || 'null');
		return marker?.steamAppId === steamAppId && marker?.verified === true
			&& (Number(marker?.profileRevision) || 0) === profileRevision(steamAppId);
	} catch { return false; }
}

export function clearLogoPositionSaved(shortcutAppId: number): void {
	try {
		localStorage.removeItem(STORAGE_PREFIX + shortcutAppId);
		for (const prefix of PREVIOUS_PREFIXES) localStorage.removeItem(prefix + shortcutAppId);
	} catch {}
}

export function invalidateLogoPosition(shortcutAppId: number): void {
	try {
		const key = STORAGE_PREFIX + shortcutAppId;
		const marker = JSON.parse(localStorage.getItem(key) || 'null');
		if (marker) localStorage.setItem(key, JSON.stringify({ ...marker, verified: false }));
	} catch {}
}

export function isLogoPositionStorageKey(key: string): boolean {
	return key.startsWith('gdl_logo_adjustments1_') || key.startsWith(STORAGE_PREFIX) || PREVIOUS_PREFIXES.some(prefix => key.startsWith(prefix));
}

export async function applyLogoPosition(
	shortcutAppId: number,
	steamAppId: string,
	rawPosition: unknown,
	force: boolean,
	fallbackPin: SteamLogoPinPosition,
	source: string,
	isCurrent: () => boolean,
): Promise<boolean> {
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < 2147483648) return false;
	if (!force && isLogoPositionVerified(shortcutAppId, steamAppId)) return true;
	const apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.SetCustomLogoPositionForApp !== 'function') return false;
	let position = targetPosition(steamAppId, rawPosition, fallbackPin);
	try {
		let layout: { logo: string; hero: string; key: string } | null = null;
		try {
			layout = await readLogoLayout(shortcutAppId);
		} catch (e) {
			backendLog(`Layout images not available for ${shortcutAppId} (${e}), using target position`);
		}
		let pairKey = layout?.key || `${shortcutAppId}_pos`;
		const raw = await readCustomLogoPositionBackend({ shortcut_app_id: String(shortcutAppId) });
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!isCurrent()) return false;
		const actual = parsed?.ok && parsed?.exists ? parsed.logo_position : null;
		const previous = JSON.parse(localStorage.getItem(STORAGE_PREFIX + shortcutAppId) || 'null');
		const needsProfileUpgrade = (Number(previous?.profileRevision) || 0) !== profileRevision(steamAppId);
		if (previous?.verified && previous?.steamAppId === steamAppId && !force && !needsProfileUpgrade) {
			markSaved(shortcutAppId, steamAppId, previous.expectedPosition || position, source, previous.verifiedPosition || position, pairKey);
			return true;
		}
		const same = (a: any, b: any): boolean => !!a && !!b && a.pinnedPosition === b.pinnedPosition
			&& Math.abs(Number(a.nWidthPct) - Number(b.nWidthPct)) < 1.5 && Math.abs(Number(a.nHeightPct) - Number(b.nHeightPct)) < 1.5;
		const isStaleBuggyBox = (pos: any): boolean => {
			if (!pos) return false;
			const w = Number(pos.nWidthPct ?? pos.width_pct);
			const h = Number(pos.nHeightPct ?? pos.height_pct);
			return (w === 100 && (Math.abs(h - 65) < 2 || pos.pinnedPosition === 'BottomLeft'))
				|| (w === 40 && h === 32)
				|| (w === 38 && h === 40)
				|| (w === 30 && h === 45)
				|| (h === 32 && (Math.abs(w - 31.63) < 0.2 || Math.abs(w - 34.84) < 0.2 || Math.abs(w - 36.97) < 0.2 || Math.abs(w - 30.55) < 0.2 || Math.abs(w - 40) < 0.2));
		};
		const oldDefault = (actual?.pinnedPosition === fallbackPin && [50, 70].includes(Number(actual.nWidthPct)) && Number(actual.nWidthPct) === Number(actual.nHeightPct))
			|| isStaleBuggyBox(actual);
		if (!force && actual && !same(actual, previous?.expectedPosition)
			&& !(previous?.source !== 'preserved_native_adjustment' && !previous?.pairKey && oldDefault)) {
			rememberLogoAdjustment(shortcutAppId, steamAppId, previous?.pairKey || pairKey, normalize(actual, fallbackPin));
		}
		const resetAutomatic = source === 'automatic_reset';
		const manual = resetAutomatic ? null : getLogoAdjustment(shortcutAppId, steamAppId, pairKey);
		const validManual = manual && !isStaleBuggyBox(manual) ? manual : null;
		if (source !== 'manual' && validManual) {
			position = validManual;
		} else if (source === 'manual') {
			position = normalize(rawPosition, fallbackPin);
		} else if (CURATED_POSITIONS[steamAppId]) {
			position = CURATED_POSITIONS[steamAppId];
		} else if (rawPosition) {
			position = normalize(rawPosition, fallbackPin);
		} else if (layout?.logo) {
			const prepared = await prepareAutomaticLogo(layout.logo);
			if (!isCurrent()) return false;
			pairKey = layoutFingerprint(prepared.logo, layout.hero);
			if (!resetAutomatic && getLogoAdjustment(shortcutAppId, steamAppId, pairKey)) {
				position = getLogoAdjustment(shortcutAppId, steamAppId, pairKey)!;
			} else {
				const emptyPin = (typeof detectHeroEmptySpace === 'function' && layout.hero)
					? await detectHeroEmptySpace(layout.hero)
					: null;
				position = { pinnedPosition: emptyPin || fallbackPin, nWidthPct: prepared.nWidthPct, nHeightPct: prepared.nHeightPct };
			}
		} else {
			position = targetPosition(steamAppId, rawPosition, fallbackPin);
		}
		if (actual && same(actual, position) && (previous?.verified || previous?.expectedPosition)) {
			markSaved(shortcutAppId, steamAppId, position, source, position, pairKey);
			backendLog(`Logo position already verified and matching on disk for ${shortcutAppId}: ${JSON.stringify(position)}`);
			return true;
		}
		if (typeof saveCustomLogoPositionBackend === 'function') {
			try { await saveCustomLogoPositionBackend({ request_json: JSON.stringify({ shortcut_app_id: String(shortcutAppId), logo_position: position }) }); }
			catch (e) { backendLog(`Disk logo position save error for ${shortcutAppId}: ${e}`); }
		}
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			if (!isCurrent()) return false;
			const accepted = await waitForSteamBridge(apps.SetCustomLogoPositionForApp(shortcutAppId, JSON.stringify({
				nVersion: 1, logoPosition: position,
			})), 5000);
			if (!accepted) {
				if (attempt < 3) { await new Promise(resolve => setTimeout(resolve, 200)); continue; }
				return false;
			}
			markSaved(shortcutAppId, steamAppId, position, source, position, pairKey);
			backendLog(`Applied and verified logo position for ${shortcutAppId} -> ${steamAppId}: ${JSON.stringify(position)}`);
			return true;
		}
		markSaved(shortcutAppId, steamAppId, position, source, undefined, pairKey);
		return true;
	} catch (error) {
		backendLog(`Could not apply logo position for ${shortcutAppId}: ${String(error)}`);
		return false;
	}
}

const ADJUSTMENTS = 'gdl_logo_adjustments1_';
export function getLogoAdjustment(id: number, appId: string, pair: string): SteamLogoPosition | null {
 try { return JSON.parse(localStorage.getItem(ADJUSTMENTS + id) || '{}')[appId + ':' + pair] || null; } catch { return null; }
}
export function rememberLogoAdjustment(id: number, appId: string, pair: string, position: SteamLogoPosition): void {
 const key = ADJUSTMENTS + id;
 const saved = JSON.parse(localStorage.getItem(key) || '{}');
 const item = appId + ':' + pair;
 delete saved[item]; saved[item] = position;
 while (Object.keys(saved).length > 16) delete saved[Object.keys(saved)[0]];
 localStorage.setItem(key, JSON.stringify(saved));
}
