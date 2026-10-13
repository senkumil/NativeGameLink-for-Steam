import type { CssClasses } from '../../steam/css';
import { committedHeaderAppId } from '../../steam/library-details';
import { closestWithCssModuleClass, elementsWithCssModuleClass } from '../../steam/native-dom';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isPublicSteamLibraryRoute, routedSteamAppId } from './native-route';

export function isCurrentInfoShortcut(doc: Document, shortcutId: number, steamAppId: string): boolean {
	return shortcutId >= 2147483648 && routedSteamAppId(doc) === shortcutId
		&& !isPublicSteamLibraryRoute(doc) && getCommittedShortcutSteamAppId(shortcutId) === steamAppId;
}

/** Retained headers can coexist during a route commit. Select only this
 * shortcut's native clusters, without changing any Steam button. */
export function nativeInfoButtonContainers(doc: Document, classes: CssClasses, shortcutId: number): HTMLElement[] {
	return elementsWithCssModuleClass(doc, classes.AppButtonsContainer).filter(container => {
		if (!container.isConnected || container.closest('[id^="gdl-"]')) return false;
		const playbar = closestWithCssModuleClass(container, classes.Container);
		const ownerId = committedHeaderAppId(container) ?? (playbar ? committedHeaderAppId(playbar) : null);
		return ownerId === shortcutId;
	});
}
