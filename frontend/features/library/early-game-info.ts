import { getSynchronousGameData } from '../../core/game-data';
import type { NativeGameInfo } from '../../domain/types';
import { paintedNativePlaybar, paintedNativeStats } from '../../steam/library-details';
import { getShortcutAppById } from '../../steam/shortcuts';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { getResolvedLibraryAssets } from './library-assets';
import { removeNativeInfoButton, removeNativeInfoPanel } from './info-panel';
import { ensureNativeGameChrome, forgetNativeGameInfoDocument, getCurrentNativeGameInfoForDocument, steamNativeGameInfo } from './native-chrome';
import { routedSteamAppId } from './native-route';

/** Info is part of the first native-header commit, rather than an incidental
 * result of constructing Activity after metadata IPC. Only available facts are
 * used in a cold model; later metadata enriches the same button and panel. */
export function syncEarlyLinkedGameInfo(doc: Document): void {
	const shortcutId = routedSteamAppId(doc);
	if (!shortcutId || shortcutId < 2147483648 || isShortcutDismissed(shortcutId)) {
		disposeEarlyLinkedGameInfo(doc);
		return;
	}
	const steamAppId = getCommittedShortcutSteamAppId(shortcutId);
	if (!steamAppId) { disposeEarlyLinkedGameInfo(doc); return; }
	if (!paintedNativePlaybar(doc, shortcutId) && !paintedNativeStats(doc, shortcutId).length) return;
	let model = getCurrentNativeGameInfoForDocument(doc, shortcutId);
	if (!model) {
		const data = getSynchronousGameData(steamAppId);
		if (data) model = steamNativeGameInfo(data, steamAppId, getResolvedLibraryAssets(steamAppId));
		else {
			const app = getShortcutAppById(shortcutId);
			model = {
				key: steamAppId, isLegacy: false, title: String(app?.display_name || app?.m_strDisplayName || ''),
				portrait: '', description: '', developer: '', publisher: '', franchise: '', release: '',
				features: [], hasCloud: false,
			} satisfies NativeGameInfo;
		}
	}
	ensureNativeGameChrome(doc, model);
}

export function disposeEarlyLinkedGameInfo(doc: Document): void {
	forgetNativeGameInfoDocument(doc);
	removeNativeInfoButton(doc);
	removeNativeInfoPanel(doc);
}
