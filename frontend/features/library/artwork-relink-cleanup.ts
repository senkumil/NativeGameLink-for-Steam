import { clearArtworkBackend, clearArtworkSlotsBackend, backendLog } from '../../api/backend';
import { supersedeArtworkApplications } from './artwork';
import { writeAssetWithDeadline } from './asset-write';
import { writeNativeAsset } from './native-asset-write';

function clearRelinkOwnershipStorage(shortcutAppId: number): void {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key && (key.startsWith(`gdl_art_${shortcutAppId}`) || key.startsWith(`gdl_logo_pos_${shortcutAppId}`) || key.startsWith(`gdl_comm_art_${shortcutAppId}`))) {
				localStorage.removeItem(key);
			}
		}
	} catch {}
}

/** Invalidate ownership/generations without blanking artwork that is currently
 * visible. The replacement batch can overwrite those slots in-place. */
export async function prepareShortcutArtworkForAppIdChange(shortcutAppId: number): Promise<void> {
	if (!Number.isFinite(shortcutAppId) || shortcutAppId < 2147483648) return;
	await supersedeArtworkApplications(shortcutAppId);
	clearRelinkOwnershipStorage(shortcutAppId);
}

/** Remove only slots that the replacement AppID could not supply. Successful
 * Hero/Logo files stay mounted throughout the relink, eliminating blank-frame
 * transitions while still preventing stale artwork from leaking across games. */
export async function clearUnreplacedShortcutArtwork(
	shortcutAppId: number,
	replacementSlots: Iterable<number>,
	iconApplied: boolean,
): Promise<void> {
	if (!Number.isFinite(shortcutAppId) || shortcutAppId < 2147483648) return;
	const replacements = new Set(Array.from(replacementSlots, Number));
	const staleSlots = [0, 1, 2, 3].filter(slot => !replacements.has(slot));
	if (!iconApplied) staleSlots.push(4);
	if (staleSlots.length === 0) return;
	try {
		const response = await writeAssetWithDeadline(guard => clearArtworkSlotsBackend({ request_json: JSON.stringify({
			shortcut_app_id: shortcutAppId, slots: staleSlots, ...guard,
		}) }), () => true);
		let result: any = response;
		for (let attempt = 0; attempt < 3 && typeof result === 'string'; attempt++) result = JSON.parse(result);
		if (result?.ok !== true) throw new Error('shortcut_artwork_cleanup_pending');
	} catch (error) {
		backendLog(`Backend stale-slot cleanup failed for ${shortcutAppId}: ${String(error)}`);
		throw error;
	}
	const apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.ClearCustomArtworkForApp !== 'function') return;
	const cleared = await writeNativeAsset(shortcutAppId, 'clear', () => Promise.all(staleSlots.map(slot =>
		Promise.resolve().then(() => apps.ClearCustomArtworkForApp(shortcutAppId, slot)),
	)).then(results => results.every(result => result !== false)), () => true, 4000);
	if (!cleared) throw new Error('shortcut_artwork_cleanup_pending');
}

/** Remove all managed Steam visuals before assigning a different AppID. */
export async function clearShortcutArtworkForAppIdChange(shortcutAppId: number): Promise<void> {
	if (!Number.isFinite(shortcutAppId) || shortcutAppId < 2147483648) return;
	await supersedeArtworkApplications(shortcutAppId);
	clearRelinkOwnershipStorage(shortcutAppId);
	try {
		// The backend checks the generation and deadline before deleting each
		// persisted resource. A late reply cannot erase a newer replacement.
		const response = await writeAssetWithDeadline(guard => clearArtworkBackend({
			shortcut_app_id: String(shortcutAppId), ...guard,
		}), () => true);
		let result: any = response;
		for (let attempt = 0; attempt < 3 && typeof result === 'string'; attempt++) result = JSON.parse(result);
		if (result?.ok !== true) throw new Error('shortcut_artwork_cleanup_pending');
	} catch (error) {
		backendLog(`Backend artwork cleanup failed for AppID change on ${shortcutAppId}: ${String(error)}`);
		throw error;
	}
	const apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.ClearCustomArtworkForApp !== 'function') return;
	const cleared = await writeNativeAsset(shortcutAppId, 'clear', () => Promise.all(Array.from({ length: 5 }, (_, slot) =>
		Promise.resolve().then(() => apps.ClearCustomArtworkForApp(shortcutAppId, slot)),
	)).then(results => results.every(result => result !== false)), () => true, 4000);
	if (!cleared) throw new Error('shortcut_artwork_cleanup_pending');
	// Steam can resolve the bridge promise just before its internal artwork cache
	// publishes the clear. Keep the shortcut lock across that tiny commit window.
	await new Promise(resolve => setTimeout(resolve, 100));
}
