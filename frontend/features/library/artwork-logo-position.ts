import { backendLog, readCustomLogoPositionBackend, saveCustomLogoPositionBackend } from '../../api/backend';
import { readLogoLayout, prepareAutomaticLogo, layoutFingerprint } from './logo-layout';
import { waitForSteamBridge } from './steam-bridge';

export type SteamLogoPinPosition = 'BottomLeft' | 'UpperLeft' | 'CenterCenter' | 'UpperCenter' | 'BottomCenter';
export interface SteamLogoPosition {
	pinnedPosition: SteamLogoPinPosition;
	nWidthPct: number;
	nHeightPct: number;
}

const STORAGE_PREFIX = 'gdl_logo_position4_';
const PREVIOUS_PREFIXES = ['gdl_logo_position1_', 'gdl_logo_position2_', 'gdl_logo_position3_'];
const PES_2013_POSITION: SteamLogoPosition = { pinnedPosition: 'BottomCenter', nWidthPct: 50, nHeightPct: 50 };
const MKK_POSITION: SteamLogoPosition = { pinnedPosition: 'CenterCenter', nWidthPct: 58, nHeightPct: 58 };

function profileRevision(_steamAppId: string): number {
	// return 5;
	return 7;
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
	if (steamAppId === '221430') return PES_2013_POSITION;
	if (steamAppId === '237110') return MKK_POSITION;
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
		return marker?.steamAppId === steamAppId && marker?.version === 4 && marker?.verified === true
			&& marker?.profileRevision === profileRevision(steamAppId);
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
		const same = (a: any, b: any): boolean => !!a && !!b && a.pinnedPosition === b.pinnedPosition
			&& Math.abs(Number(a.nWidthPct) - Number(b.nWidthPct)) < 1.5 && Math.abs(Number(a.nHeightPct) - Number(b.nHeightPct)) < 1.5;
		const isStaleBuggyBox = (pos: any): boolean => {
			if (!pos) return false;
			const w = Number(pos.nWidthPct ?? pos.width_pct);
			const h = Number(pos.nHeightPct ?? pos.height_pct);
			return w === 100 && (Math.abs(h - 65) < 2 || pos.pinnedPosition === 'BottomLeft');
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
		if (source !== 'manual' && validManual) position = validManual;
		else if (source === 'manual') position = normalize(rawPosition, fallbackPin);
		else if (!rawPosition && layout?.logo) {
			const prepared = await prepareAutomaticLogo(layout.logo);
			if (!isCurrent()) return false;
			if (prepared.logo !== layout.logo) {
				if (typeof apps.SetCustomArtworkForApp === 'function') {
					const saved = await waitForSteamBridge(apps.SetCustomArtworkForApp(shortcutAppId, prepared.logo.split(',')[1], '.png', 2), 5000);
					if (saved && isCurrent()) pairKey = layoutFingerprint(prepared.logo, layout.hero);
				}
			}
			position = (!resetAutomatic && getLogoAdjustment(shortcutAppId, steamAppId, pairKey))
				|| (steamAppId === '221430' || steamAppId === '237110' ? targetPosition(steamAppId, null, fallbackPin)
					: { pinnedPosition: fallbackPin, nWidthPct: prepared.nWidthPct, nHeightPct: prepared.nHeightPct });
		} else {
			position = targetPosition(steamAppId, rawPosition, fallbackPin);
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
