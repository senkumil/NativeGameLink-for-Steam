import type { NativeGameInfo, SteamGameData } from '../../domain/types';
import type { SteamLibraryAssets } from './artwork';
import { backendLog } from '../../api/backend';
import { ensureCloudStatus, removeCloudStatus } from './cloud-status';
import { clearNativeInfoSessionState, ensureNativeInfoButton, ensureNativeInfoPanel, removeNativeInfoButton, removeNativeInfoPanel } from './info-panel';
import { steamNativeGameInfo as buildSteamNativeGameInfo } from './native-game-model';
import { ensureNativeGameInfoStyles } from './styles';
import { restoreLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { isPublicSteamLibraryRoute, routedSteamAppId } from './native-route';
import { paintedNativePlaybar, paintedNativeStats } from '../../steam/library-details';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { removeObsoletePlaybarAchievements } from './playbar-achievement-cleanup';

let currentNativeGameInfo: NativeGameInfo | null = null;
const documentInfo = new WeakMap<Document, { shortcutId: number; model: NativeGameInfo }>();

/** A model from another shortcut, including one linked to the same Store AppID,
 * must never seed the currently committed header. */
export function getCurrentNativeGameInfoForDocument(doc: Document, shortcutId: number): NativeGameInfo | null {
	const current = documentInfo.get(doc);
	return current?.shortcutId === shortcutId && current.model.key === getCommittedShortcutSteamAppId(shortcutId)
		? current.model : null;
}

/**
 * Build the language-independent semantic model used by Steam-native library chrome.
 * Kept as a re-export here so callers do not need to know the internal module split.
 */
export function steamNativeGameInfo(data: SteamGameData, steamAppId: string, modern?: SteamLibraryAssets | null): NativeGameInfo {
	return buildSteamNativeGameInfo(data, steamAppId, modern);
}

/**
 * Coordinate the small pieces that augment Steam's existing play bar and game-info area.
 * This module intentionally contains no markup or CSS; each surface owns its own implementation.
 */
export function ensureNativeGameChrome(doc: Document, model: NativeGameInfo): void {
	if (isPublicSteamLibraryRoute(doc)) {
		removeNativeGameChrome(doc, true);
		return;
	}
	const shortcutId = routedSteamAppId(doc);
	if (!shortcutId || shortcutId < 2147483648 || getCommittedShortcutSteamAppId(shortcutId) !== model.key
		|| (!paintedNativePlaybar(doc, shortcutId) && !paintedNativeStats(doc, shortcutId).length)) return;
	currentNativeGameInfo = model;
	documentInfo.set(doc, { shortcutId, model });
	ensureNativeGameInfoStyles(doc);

	try {
		// A linked shortcut is not the Store AppID that Steam uses to decide
		// whether to render its own cloud widget.  Always provide our clearly
		// simulated, synchronized status for linked games so older titles (for
		// example GTA IV) do not lose this play-bar slot merely because their
		// Store metadata has no Steam Cloud category.
		ensureCloudStatus(doc);
	} catch (error) {
		backendLog('Cloud status injection error: ' + error);
	}

	try { ensureNativeInfoPanel(doc, model); }
	catch (error) { backendLog('Game info panel injection error: ' + error); }

	try { ensureNativeInfoButton(doc, model); }
	catch (error) { backendLog('Game info button injection error: ' + error); }

}

export function removeNativeGameChrome(doc: Document, clearModel = false, preserveCloudStatus = false, preserveAchievements = false, preserveInfo = false): void {
	const shortcutId = routedSteamAppId(doc);
	const keepInfo = Boolean(preserveInfo && shortcutId && shortcutId >= 2147483648
		&& getCurrentNativeGameInfoForDocument(doc, shortcutId)
		&& (paintedNativePlaybar(doc, shortcutId) || paintedNativeStats(doc, shortcutId).length));
	const keptAchievements = removeObsoletePlaybarAchievements(doc, preserveAchievements);
	if (!keptAchievements) restoreLinkedPlaybarVisibility(doc);
	try {
		doc.getElementById('gdl-library-style-sentinel')?.remove();
	} catch {}
	if (!preserveCloudStatus) removeCloudStatus(doc);
	if (!keepInfo) { removeNativeInfoButton(doc); removeNativeInfoPanel(doc); }
	if (!keepInfo) documentInfo.delete(doc);
	if (clearModel && !keepInfo) clearNativeGameChromeState();
}

/** Clear only NativeGameLink's in-memory linked-game model. No Steam DOM or React
 * state is inspected or modified. */
export function clearNativeGameChromeState(): void {
	currentNativeGameInfo = null;
	clearNativeInfoSessionState();
}

export function forgetNativeGameInfoDocument(doc: Document): void { documentInfo.delete(doc); }

export function getCurrentNativeGameInfo(): NativeGameInfo | null {
	return currentNativeGameInfo;
}
