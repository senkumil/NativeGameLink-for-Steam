import { backendLog, saveShortcutIconBackend } from '../../api/backend';
import { getPreferences } from '../../core/preferences';
import { steamLanguageSync } from '../../steam/localization';
import { getShortcutAppById, readShortcutOverviewField } from '../../steam/shortcuts';
import { getCommunityArtwork } from './artwork-community';
import { imageUrlToBase64 } from './artwork-image';
import { getModernLibraryAssets, getResolvedLibraryAssets } from './library-assets';
import { waitForSteamBridge } from './steam-bridge';

export const SHORTCUT_ICON_STORAGE_PREFIX = 'gdl_shortcut_icon5_';
const shortcutIconGenerations = new Map<number, number>();
const shortcutIconInFlight = new Map<string, Promise<boolean>>();

export function shortcutIconGeneration(shortcutAppId: number): number {
	return shortcutIconGenerations.get(shortcutAppId) ?? 0;
}

export function invalidateShortcutIconGeneration(shortcutAppId: number): void {
	shortcutIconGenerations.set(shortcutAppId, shortcutIconGeneration(shortcutAppId) + 1);
}

export function shortcutIconGenerationIsCurrent(shortcutAppId: number, generation: number): boolean {
	return shortcutIconGeneration(shortcutAppId) === generation;
}

function normalizeIconExtension(ext: string): string {
	const value = String(ext || '').toLowerCase().replace(/^\./, '');
	if (value === 'jpeg') return 'jpg';
	if (value === 'x-icon') return 'ico';
	return (value === 'png' || value === 'jpg' || value === 'ico' || value === 'tga') ? value : 'png';
}

function iconExtensionFromDataUrl(dataUrl: string, fallback: string): string {
	const mime = String(dataUrl.match(/^data:([^;,]+)/i)?.[1] || '').toLowerCase();
	if (mime.includes('png')) return 'png';
	if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
	if (mime.includes('icon') || mime.includes('ico')) return 'ico';
	if (mime.includes('tga')) return 'tga';
	return normalizeIconExtension(fallback);
}

async function imageDataUrlToPng(dataUrl: string): Promise<string | null> {
	return await new Promise(resolve => {
		const img = new Image();
		img.onload = () => {
			try {
				const width = Math.max(1, img.naturalWidth || img.width || 32);
				const height = Math.max(1, img.naturalHeight || img.height || 32);
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) { resolve(null); return; }
				ctx.clearRect(0, 0, width, height);
				ctx.drawImage(img, 0, 0, width, height);
				resolve(canvas.toDataURL('image/png'));
			} catch {
				resolve(null);
			}
		};
		img.onerror = () => resolve(null);
		img.src = dataUrl;
	});
}

function iconCandidatePriority(ext: string): number {
	const normalized = normalizeIconExtension(ext);
	if (normalized === 'png') return 0;
	if (normalized === 'jpg') return 1;
	if (normalized === 'ico') return 2;
	if (normalized === 'tga') return 3;
	return 4;
}

async function fetchOfficialShortcutIconPayload(candidates: { url?: string; extension?: string }[]): Promise<{ base64: string; extension: string; source: string } | null> {
	const ordered = candidates
		.filter(candidate => candidate?.url)
		.sort((a, b) => iconCandidatePriority(a.extension || '') - iconCandidatePriority(b.extension || ''));
	for (const candidate of ordered) {
		const source = String(candidate.url || '');
		const dataUrl = await imageUrlToBase64(source);
		if (!dataUrl) continue;
		const fallbackExt = normalizeIconExtension(candidate.extension || '');
		const detectedExt = iconExtensionFromDataUrl(dataUrl, fallbackExt);
		const pngDataUrl = detectedExt !== 'tga' ? await imageDataUrlToPng(dataUrl) : null;
		const finalDataUrl = pngDataUrl || (detectedExt !== 'tga' ? dataUrl : null);
		if (!finalDataUrl) continue;
		const commaIdx = finalDataUrl.indexOf(',');
		if (commaIdx < 0) continue;
		return {
			base64: finalDataUrl.substring(commaIdx + 1),
			extension: pngDataUrl ? 'png' : detectedExt,
			source,
		};
	}
	return null;
}

function shortcutIconMarkerMatches(shortcutAppId: number, steamAppId: string): boolean {
	try {
		const marker = JSON.parse(localStorage.getItem(SHORTCUT_ICON_STORAGE_PREFIX + shortcutAppId) || 'null');
		if (marker?.steamAppId !== steamAppId) return false;
		const app = getShortcutAppById(shortcutAppId);
		const currentPath = readShortcutOverviewField(app,
			'strShortcutIcon', 'm_strShortcutIcon', 'shortcut_icon', 'strIconPath');
		const normalizePath = (value: unknown): string => String(value || '').replace(/\\/g, '/').toLowerCase();
		return Boolean(currentPath && marker.path && normalizePath(currentPath) === normalizePath(marker.path));
	} catch { return false; }
}

function markShortcutIconApplied(shortcutAppId: number, steamAppId: string, path: string): void {
	try {
		localStorage.setItem(SHORTCUT_ICON_STORAGE_PREFIX + shortcutAppId, JSON.stringify({ steamAppId, path }));
	} catch {}
}

export function clearShortcutIconMarker(shortcutAppId: number): void {
	try {
		localStorage.removeItem(SHORTCUT_ICON_STORAGE_PREFIX + shortcutAppId);
	} catch {}
}

export function clearAllShortcutIconMarkers(): void {
	try {
		const keys = Object.keys(localStorage);
		for (const key of keys) {
			if (key.startsWith(SHORTCUT_ICON_STORAGE_PREFIX)) localStorage.removeItem(key);
		}
	} catch {}
}

export function getActiveShortcutIconPromises(shortcutAppId?: number): Promise<boolean>[] {
	const prefix = shortcutAppId !== undefined ? `${shortcutAppId}:` : undefined;
	return Array.from(shortcutIconInFlight.entries())
		.filter(([key]) => prefix ? key.startsWith(prefix) : true)
		.map(([, request]) => request);
}

export function clearShortcutIconInFlight(shortcutAppId?: number): void {
	const prefix = shortcutAppId !== undefined ? `${shortcutAppId}:` : undefined;
	for (const key of Array.from(shortcutIconInFlight.keys())) {
		if (!prefix || key.startsWith(prefix)) {
			shortcutIconInFlight.delete(key);
		}
	}
}

export async function applyOfficialShortcutIconOnce(shortcutAppId: number, steamAppId: string, force = false): Promise<boolean> {
	const generation = shortcutIconGeneration(shortcutAppId);
	try {
		if (!force && shortcutIconMarkerMatches(shortcutAppId, steamAppId)) return true;
		const apps = (window as any).SteamClient?.Apps;
		const applyIconPath = async (path: string): Promise<boolean> => {
			if (typeof apps?.SetShortcutIcon !== 'function') return false;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
				try {
					const accepted = await waitForSteamBridge(apps.SetShortcutIcon(shortcutAppId, path), 5000);
					if (accepted) {
						if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
						try { await waitForSteamBridge(apps.RequestIconDataForApp?.(shortcutAppId), 1500); } catch {}
						if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
						markShortcutIconApplied(shortcutAppId, steamAppId, path);
						setTimeout(() => {
							if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return;
							try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId, steamAppId, icon: true, automatic: true } })); } catch {}
						}, 0);
						backendLog('Official shortcut icon applied for ' + shortcutAppId + ': ' + path);
						return true;
					}
				} catch (error) {
					backendLog('Steam rejected shortcut icon for ' + shortcutAppId + ': ' + error);
				}
				if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
			}
			return false;
		};

		const assets = getResolvedLibraryAssets(steamAppId) || await getModernLibraryAssets(steamAppId);
		if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
		const candidates = Array.isArray(assets?.shortcut_icons) ? [...assets.shortcut_icons] : [];
		if (assets?.shortcut_icon) {
			candidates.push({ url: assets.shortcut_icon, extension: assets.shortcut_icon_extension || '' });
		}
		const payload = await fetchOfficialShortcutIconPayload(candidates);
		if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
		if (payload) {
			const saved = JSON.parse(await saveShortcutIconBackend({
				request_json: JSON.stringify({
					shortcut_app_id: String(shortcutAppId),
					steam_app_id: steamAppId,
					language: steamLanguageSync() || 'english',
					icon_base64: payload.base64,
					extension: payload.extension,
					source: payload.source,
				}),
			}));
			if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
			if (saved?.saved && saved?.path) {
				if (await applyIconPath(String(saved.path))) return true;
			}
		}

		const response = JSON.parse(await saveShortcutIconBackend({
			request_json: JSON.stringify({
				shortcut_app_id: String(shortcutAppId),
				steam_app_id: steamAppId,
				language: steamLanguageSync() || 'english',
			}),
		}));
		if (response?.saved && response?.path) {
			return await applyIconPath(String(response.path));
		}

		// Fallback: If Steam official icon was absent or probe failed, try recommended community icon
		const preferences = getPreferences();
		if (preferences.autoCommunityArtwork && preferences.steamGridDbApiKey) {
			const community = await getCommunityArtwork(steamAppId);
			if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
			if (community?.icon) {
				let commSaved: { saved?: boolean; path?: string } | null = null;
				const dataUrl = await imageUrlToBase64(community.icon);
				if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
				if (dataUrl) {
					const commaIdx = dataUrl.indexOf(',');
					const base64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl;
					const raw = await saveShortcutIconBackend({
						request_json: JSON.stringify({
							shortcut_app_id: String(shortcutAppId),
							steam_app_id: steamAppId,
							icon_base64: base64,
							extension: 'png',
							source: 'steamgriddb',
						}),
					});
					try { commSaved = JSON.parse(raw); } catch {}
				}
				if (!commSaved?.saved && community.icon) {
					const raw = await saveShortcutIconBackend({
						request_json: JSON.stringify({
							shortcut_app_id: String(shortcutAppId),
							steam_app_id: steamAppId,
							url: community.icon,
							source: 'steamgriddb',
						}),
					});
					try { commSaved = JSON.parse(raw); } catch {}
				}
				if (!shortcutIconGenerationIsCurrent(shortcutAppId, generation)) return false;
				if (commSaved?.saved && commSaved?.path) {
					return await applyIconPath(String(commSaved.path));
				}
			}
		}
		return false;
	} catch (e) {
		backendLog('Official shortcut icon failed for ' + shortcutAppId + ': ' + e);
		return false;
	}
}

/** Download Steam's official client icon and assign it through Steam's native API. */
export function applyOfficialShortcutIcon(shortcutAppId: number, steamAppId: string, force = false): Promise<boolean> {
	const key = `${shortcutAppId}:${steamAppId}`;
	const active = shortcutIconInFlight.get(key);
	if (active) return active;
	let request!: Promise<boolean>;
	request = applyOfficialShortcutIconOnce(shortcutAppId, steamAppId, force)
		.finally(() => {
			if (shortcutIconInFlight.get(key) === request) shortcutIconInFlight.delete(key);
		});
	shortcutIconInFlight.set(key, request);
	return request;
}
