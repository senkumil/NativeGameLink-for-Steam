import { getSynchronousGameData } from '../../core/game-data';
import { paintedNativePlaybar } from '../../steam/library-details';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from './native-route';
import { createPrimaryLinksBar, disposePrimaryLinksBar, insertPrimaryLinksBar } from './primary-links';

/** Static destinations depend on the verified mapping, not Store IPC or the
 * Notes/Media columns. Publish them with the exact committed native header. */
export function syncEarlyLinkedPrimaryLinks(doc: Document): HTMLElement | null {
	const id = routedSteamAppId(doc);
	const steamAppId = id && id >= 2147483648 && !isShortcutDismissed(id) ? getCommittedShortcutSteamAppId(id) : null;
	if (!steamAppId) { disposePrimaryLinksBar(doc); return null; }
	if (!paintedNativePlaybar(doc, id!)) return null;
	const data = getSynchronousGameData(steamAppId);
	const bar = createPrimaryLinksBar(doc, null, {
		steamAppId,
		shortcutAppId: String(id),
		isDelisted: data?.is_delisted === true,
		hasWorkshop: Boolean(data?.categories?.some(category => category.id === 30)),
		hasDlc: Boolean(data?.dlc?.length),
	});
	insertPrimaryLinksBar(bar);
	return bar.isConnected ? bar : null;
}

export function disposeLinkedPrimaryLinks(doc: Document): void { disposePrimaryLinksBar(doc); }
