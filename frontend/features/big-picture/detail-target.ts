import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import type { MappedShortcut } from './types';

export interface BigPictureActionOwner { document: Document; shortcut: MappedShortcut; generation?: number }

export function isBigPictureActionCurrent(owner: BigPictureActionOwner): boolean {
	const { document: doc, shortcut } = owner;
	const root = doc.getElementById('gdl-bp-detail-root');
	return Boolean(root?.isConnected && root.ownerDocument === doc
		&& root.dataset.gdlShortcutAppId === String(shortcut.id >>> 0)
		&& root.dataset.gdlSteamAppId === String(shortcut.steamAppId)
		&& (owner.generation === undefined || root.dataset.gdlBpGeneration === String(owner.generation))
		&& steamUIModeService.isGamepadUI(doc) && isCurrentLinkedGamepadTarget(doc, shortcut.id, shortcut.steamAppId));
}
