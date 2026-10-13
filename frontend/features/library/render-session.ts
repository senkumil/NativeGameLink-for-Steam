import { paintedNativePlaybar } from '../../steam/library-details';
import { findMappingForShortcut } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { isPublicSteamLibraryRoute, routedSteamAppId } from './native-route';

/** The live route invalidates promises before navigation observers run. */
export function isCurrentLinkedRenderDestination(doc: Document, shortcutAppId: string | null, steamAppId: string): boolean {
	const expectedId = Number(shortcutAppId);
	if (!Number.isInteger(expectedId) || expectedId < 2147483648 || isShortcutDismissed(expectedId)
		|| findMappingForShortcut(String(expectedId), '') !== steamAppId) return false;
	const routeId = routedSteamAppId(doc);
	return routeId === null
		? !isPublicSteamLibraryRoute(doc) && Boolean(paintedNativePlaybar(doc, expectedId))
		: routeId >= 2147483648 && routeId === expectedId;
}

/** An early header bar remains independent of metadata-column readiness. */
export function ownsCurrentLinkedPrimaryLinks(doc: Document): boolean {
	const bar = doc.getElementById('gdl-link-bar');
	const routeId = routedSteamAppId(doc);
	return Boolean(bar?.isConnected && routeId && routeId >= 2147483648
		&& !isShortcutDismissed(routeId) && bar.dataset.gdlShortcutAppId === String(routeId)
		&& bar.dataset.gdlSteamAppId === findMappingForShortcut(String(routeId), ''));
}
