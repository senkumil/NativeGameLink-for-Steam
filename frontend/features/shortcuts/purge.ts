import { backendLog, clearArtworkBackend, clearArtworkExceptIconBackend } from '../../api/backend';
import { clearShortcutEdition } from './editions';
import { clearShortcutManifest } from './transaction';
import { forgetOriginalShortcutTitle, forgetShortcutSteamAppId } from './link-history';
import { undismissShortcut } from './dismissed';
import { invalidateLinkedGameResourceCaches } from '../library/resource-cache';

/**
 * Fully purge all localStorage keys belonging to a shortcut.
 * CRITICAL: Never touches playtime keys (gdl_playtime* or gdl-playtime*) to preserve playtime history.
 */
export function purgeShortcutStorage(shortcutAppId: number | string): void {
	const sid = String(shortcutAppId);
	try {
		const keys = Object.keys(localStorage);
		for (const key of keys) {
			if (key.startsWith('gdl_playtime') || key.startsWith('gdl-playtime')) {
				continue;
			}
			if (
				key === `gdl_shortcut_icon_${sid}` ||
				key === `gdl_edition_${sid}` ||
				key === `gdl_manifest_${sid}` ||
				key === `gdl_ach_opt_${sid}` ||
				key === `gdl_ach_caps_${sid}` ||
				key === `gdl_ach_path_${sid}` ||
				key === `gdl_link_history_${sid}` ||
				(key.startsWith('gdl_artwork') && key.endsWith(`_${sid}`)) ||
				(key.startsWith('gdl_logo_position') && key.endsWith(`_${sid}`)) ||
				(key.startsWith('gdl_logo_adjustments') && key.endsWith(`_${sid}`)) ||
				(key.startsWith('gdl_native_artwork_override') && key.endsWith(`_${sid}`)) ||
				(key.startsWith('gdl_legacy_info_portrait') && key.endsWith(`_${sid}`)) ||
				(key.startsWith('gdl_user_artwork_sel') && key.endsWith(`_${sid}`)) ||
				(key.includes(`_${sid}`) && (key.startsWith('gdl_') || key.startsWith('gdl-') || key.startsWith('gdl:')))
			) {
				localStorage.removeItem(key);
			}
		}
	} catch {}
}

/**
 * Fully purge all caches, artworks on disk, and localStorage for a removed or unlinked shortcut,
 * strictly preserving accumulated playtime and session history.
 */
export async function purgeShortcutCachesAndArtwork(
	shortcutAppId: number,
	steamAppId?: string,
	clearIcon = true,
): Promise<void> {
	purgeShortcutStorage(shortcutAppId);
	clearShortcutManifest(shortcutAppId);
	clearShortcutEdition(shortcutAppId);
	forgetOriginalShortcutTitle(shortcutAppId);
	forgetShortcutSteamAppId(shortcutAppId);
	undismissShortcut(shortcutAppId);

	try {
		const apps = (window as any).SteamClient?.Apps;
		if (typeof apps?.ClearCustomArtworkForApp === 'function') {
			for (let slot = 0; slot < 5; slot += 1) {
				try { apps.ClearCustomArtworkForApp(shortcutAppId, slot); } catch {}
			}
		}
		if (clearIcon && typeof apps?.SetShortcutIcon === 'function') {
			try { void apps.SetShortcutIcon(shortcutAppId, ''); } catch {}
		}
	} catch {}

	try {
		if (clearIcon) {
			await clearArtworkBackend({ shortcut_app_id: String(shortcutAppId) });
		} else {
			await clearArtworkExceptIconBackend({ shortcut_app_id: String(shortcutAppId) });
		}
	} catch {}

	if (steamAppId && /^\d+$/.test(steamAppId)) {
		invalidateLinkedGameResourceCaches([steamAppId], [shortcutAppId]);
	} else {
		invalidateLinkedGameResourceCaches([], [shortcutAppId]);
	}
	backendLog(`Fully purged caches and artworks for deleted/unlinked shortcut ${shortcutAppId}${steamAppId ? ` (Steam AppID ${steamAppId})` : ''} (playtime preserved).`);
}
