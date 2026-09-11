import { gdlText } from '../../steam/localization';
import { escapeHtml } from '../../core/text';
import {
	isShortcutPlaytimeTrackingEnabled,
	setShortcutPlaytimeTrackingEnabled,
} from '../playtime/playtime-settings';

export function shortcutPlaytimePropertiesHtml(): string {
	return `
		<label class="gdl-playtime-tracking gdl-native-option">
			<input class="gdl-playtime-tracking-input" type="checkbox" checked />
			<span><strong>${escapeHtml(gdlText('playtime_tracking_title', 'Playtime tracking (Fallback)'))}</strong><br />${escapeHtml(gdlText('playtime_tracking_properties_desc', 'Tracks and displays hours played for this game if your Steam client does not include native tracking.'))}</span>
		</label>
	`;
}

export function bindShortcutPlaytimeProperties(options: {
	section: HTMLElement;
	getShortcutAppId: () => string | number;
}): { sync: (shortcutAppId?: string | number) => void } {
	const { section, getShortcutAppId } = options;
	const checkbox = section.querySelector('.gdl-playtime-tracking-input') as HTMLInputElement | null;

	const sync = (overrideId?: string | number): void => {
		if (!checkbox) return;
		const id = overrideId ?? getShortcutAppId();
		checkbox.checked = isShortcutPlaytimeTrackingEnabled(id);
	};

	if (checkbox) {
		sync();
		checkbox.addEventListener('change', () => {
			const id = getShortcutAppId();
			if (id) {
				setShortcutPlaytimeTrackingEnabled(id, checkbox.checked);
			}
		});
	}

	return { sync };
}
