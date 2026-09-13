import { backendLog } from '../../api/backend';
import { getMappedShortcuts } from '../../steam/shortcuts';
import { applyOfficialLogoPosition, applyOfficialShortcutIcon, artworkAlreadySaved, isLogoPositionVerified, spoofArtwork } from './artwork';
import { prioritizePendingLinkJob } from '../shortcuts/link-job-queue';
import { setPriorityShortcut } from '../shortcuts/link-job-priority';

let syncArtworkInProgress = false;
let priorityShortcutId: number | null = null;
const priorityArtworkInFlight = new Set<string>();
const verifiedShortcuts = new Set<string>();

export function invalidateShortcutArtworkVerification(shortcutId?: number): void {
	if (shortcutId != null) {
		for (const key of Array.from(verifiedShortcuts)) {
			if (key.startsWith(`${shortcutId}:`)) verifiedShortcuts.delete(key);
		}
	} else {
		verifiedShortcuts.clear();
	}
}

export function prioritizeShortcutArtwork(shortcutId: number, steamAppId: string, title?: string): void {
	if (!shortcutId || !steamAppId || !/^\d+$/.test(steamAppId)) return;
	priorityShortcutId = shortcutId;
	const key = `${shortcutId}:${steamAppId}`;
	const isSaved = artworkAlreadySaved(shortcutId, steamAppId);
	if (verifiedShortcuts.has(key) && isSaved) return;
	if (priorityArtworkInFlight.has(key)) return;
	priorityArtworkInFlight.add(key);
	const artworkPromise = isSaved
		? (!isLogoPositionVerified(shortcutId, steamAppId)
			? applyOfficialLogoPosition(shortcutId, steamAppId, null, false, 'BottomLeft', 'sync')
			: Promise.resolve())
		: spoofArtwork(shortcutId, steamAppId, title || '', false);
	void Promise.allSettled([
		artworkPromise,
		applyOfficialShortcutIcon(shortcutId, steamAppId, false),
	]).then(results => {
		for (const [index, result] of results.entries()) {
			if (result.status === 'rejected') {
				backendLog(`Priority ${index === 0 ? 'artwork' : 'icon'} failed for ${shortcutId}: ${result.reason}`);
			}
		}
		if (artworkAlreadySaved(shortcutId, steamAppId) && isLogoPositionVerified(shortcutId, steamAppId)) {
			verifiedShortcuts.add(key);
		}
	}).finally(() => priorityArtworkInFlight.delete(key));
}

export function prioritizeShortcutLinkingAndArtwork(shortcutId: number | null | undefined, steamAppId = '', title = ''): void {
	if (shortcutId != null) {
		setPriorityShortcut(shortcutId, title);
		prioritizePendingLinkJob(shortcutId, title);
		if (steamAppId) prioritizeShortcutArtwork(shortcutId, steamAppId, title);
	}
}

/**
 * Automatically checks all currently mapped shortcuts and downloads/applies
 * missing covers and icons to Steam's native grid cache.
 */
export async function syncMissingArtworkForMappedShortcuts(): Promise<void> {
	if (syncArtworkInProgress) return;
	syncArtworkInProgress = true;
	try {
		const shortcuts = getMappedShortcuts();
		if (priorityShortcutId) {
			const priorityIndex = shortcuts.findIndex(s => s.id === priorityShortcutId);
			if (priorityIndex > 0) {
				const [item] = shortcuts.splice(priorityIndex, 1);
				shortcuts.unshift(item);
			}
		}
		for (const shortcut of shortcuts) {
			const steamAppId = String(shortcut.steamAppId || '').trim();
			if (!steamAppId || !/^\d+$/.test(steamAppId)) continue;
			if (!artworkAlreadySaved(shortcut.id, steamAppId)) {
				const title = shortcut.title || '';
				try {
					await spoofArtwork(shortcut.id, steamAppId, title, false);
				} catch (error) {
					backendLog(`Sync missing artwork failed for ${shortcut.id} (${title}): ${error}`);
				}
			} else if (!isLogoPositionVerified(shortcut.id, steamAppId)) {
				try {
					await applyOfficialLogoPosition(shortcut.id, steamAppId, null, false, 'BottomLeft', 'sync');
				} catch (error) {
					backendLog(`Sync missing logo position failed for ${shortcut.id}: ${error}`);
				}
			}
			try { await applyOfficialShortcutIcon(shortcut.id, steamAppId, false); }
			catch (error) { backendLog(`Sync missing icon failed for ${shortcut.id}: ${error}`); }
		}
	} finally {
		syncArtworkInProgress = false;
	}
}
