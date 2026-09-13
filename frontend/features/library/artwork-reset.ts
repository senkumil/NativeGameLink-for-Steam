import { backendLog, clearArtworkExceptIconBackend } from '../../api/backend';
import { clearSavedCommunityArtworkSelection } from './artwork-selection-storage';
import { spoofArtwork, supersedeArtworkApplications, type ArtworkApplyResult } from './artwork';

/** Remove a per-shortcut override and restore NativeGameLink's default artwork. */
export async function resetShortcutArtworkToDefault(
	shortcutAppId: number,
	steamAppId: string,
	gameTitle: string,
): Promise<ArtworkApplyResult> {
	if (!Number.isInteger(shortcutAppId) || shortcutAppId <= 0 || !/^\d+$/.test(steamAppId)) {
		return { complete: false, slots: [], missing: ['invalid_selection'], communitySlots: [] };
	}
	await supersedeArtworkApplications(shortcutAppId, true);
	clearSavedCommunityArtworkSelection(shortcutAppId);

	// Only clear visual artwork slots: 0 (portrait), 1 (hero), 2 (logo), 3 (wide).
	// Slot 4 is the application icon and must NEVER be cleared on reset.
	const apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.ClearCustomArtworkForApp === 'function') {
		const clearSlot = (slot: number): Promise<void> => new Promise(resolve => {
			const timer = setTimeout(resolve, 2500);
			try {
				Promise.resolve(apps.ClearCustomArtworkForApp(shortcutAppId, slot))
					.catch((error: unknown) => {
						backendLog(`Could not clear artwork slot ${slot} for ${shortcutAppId}: ${String(error)}`);
					})
					.finally(() => { clearTimeout(timer); resolve(); });
			} catch {
				clearTimeout(timer);
				resolve();
			}
		});
		await Promise.all([0, 1, 2, 3].map(clearSlot));
	}

	// For native Steam games, clearing custom artwork allows Steam to display its native artwork
	if (shortcutAppId < 2147483648) {
		try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId, steamAppId, user_action: true } })); } catch {}
		return { complete: true, slots: [0, 1, 2, 3], missing: [], communitySlots: [] };
	}

	// The backend endpoint preserves the shortcut icon, so resetting artwork
	// never causes an icon to disappear.
	await clearArtworkExceptIconBackend({ shortcut_app_id: String(shortcutAppId) }).catch(error => {
		backendLog(`Could not clear persisted artwork for ${shortcutAppId}: ${error}`);
	});
	const result = await spoofArtwork(shortcutAppId, steamAppId, gameTitle, true);
	if (result.slots.length) {
		try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId, steamAppId, user_action: true } })); } catch {}
	}
	return result;
}

