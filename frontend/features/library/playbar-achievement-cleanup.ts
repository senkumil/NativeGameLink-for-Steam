import { findMappingForTitle } from '../../core/mappings';
import { paintedNativeStats } from '../../steam/library-details';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from './native-route';

/** Preserve an early stat only while its exact shortcut still owns its native
 * host. Metadata rendering must not tear down an already-correct playbar. */
export function removeObsoletePlaybarAchievements(doc: Document, preserveCurrent = false): boolean {
	const shortcutId = preserveCurrent ? routedSteamAppId(doc) : null;
	const steamId = shortcutId && shortcutId >= 2147483648 && !isShortcutDismissed(shortcutId)
		? findMappingForTitle('', String(shortcutId)) : null;
	const hosts = steamId && shortcutId ? paintedNativeStats(doc, shortcutId) : [];
	let preserved = false;
	for (const stat of doc.querySelectorAll<HTMLElement>('[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements')) {
		if (!preserved && steamId && stat.dataset.gdlAchievementIdentity === `${steamId}:${shortcutId}`
			&& stat.parentElement && hosts.includes(stat.parentElement)) {
			preserved = true;
		} else stat.remove();
	}
	if (!preserved) doc.getElementById('gdl-achievement-playbar-style')?.remove();
	return preserved;
}
