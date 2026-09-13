import type { NativeGameInfo, SteamGameData } from '../../domain/types';
import type { SteamLibraryAssets } from './artwork';
import { backendLog } from '../../api/backend';
import { ensureCloudStatus, removeCloudStatus } from './cloud-status';
import { clearNativeInfoSessionState, ensureNativeInfoButton, ensureNativeInfoPanel, removeNativeInfoButton, removeNativeInfoPanel } from './info-panel';
import { steamNativeGameInfo as buildSteamNativeGameInfo } from './native-game-model';
import { ensureNativeGameInfoStyles } from './styles';
import { restoreLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { isPublicSteamLibraryRoute } from './native-route';

let currentNativeGameInfo: NativeGameInfo | null = null;

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
	currentNativeGameInfo = model;
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

export function removeNativeGameChrome(doc: Document, clearModel = false): void {
	restoreLinkedPlaybarVisibility(doc);
	removeCloudStatus(doc);
	removeNativeInfoButton(doc);
	removeNativeInfoPanel(doc);
	doc.querySelectorAll('[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements').forEach(element => element.remove());
	if (clearModel) clearNativeGameChromeState();
}

/** Clear only NativeGameLink's in-memory linked-game model. No Steam DOM or React
 * state is inspected or modified. */
export function clearNativeGameChromeState(): void {
	currentNativeGameInfo = null;
	clearNativeInfoSessionState();
}

export function getCurrentNativeGameInfo(): NativeGameInfo | null {
	return currentNativeGameInfo;
}
