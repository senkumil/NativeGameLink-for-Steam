const STORAGE_PLAYTIME_DISABLED = 'gdl_playtime_disabled_shortcuts';
const EVENT_PLAYTIME_SETTINGS = 'gdl:playtime-settings-changed';

function getDisabledPlaytimeSet(): Set<string> {
	try {
		if (typeof localStorage === 'undefined') return new Set<string>();
		const raw = localStorage.getItem(STORAGE_PLAYTIME_DISABLED);
		if (!raw) return new Set<string>();
		const list = JSON.parse(raw);
		return new Set<string>(Array.isArray(list) ? list.map(String) : []);
	} catch {
		return new Set<string>();
	}
}

function saveDisabledPlaytimeSet(set: Set<string>): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_PLAYTIME_DISABLED, JSON.stringify([...set]));
	} catch {}
}

export function isShortcutPlaytimeTrackingEnabled(shortcutId: number | string | undefined | null): boolean {
	if (!shortcutId) return true;
	const id = String(shortcutId).trim();
	if (!id || id === '0') return true;
	return !getDisabledPlaytimeSet().has(id);
}

export function setShortcutPlaytimeTrackingEnabled(shortcutId: number | string, enabled: boolean): void {
	if (!shortcutId) return;
	const id = String(shortcutId).trim();
	if (!id || id === '0') return;

	const set = getDisabledPlaytimeSet();
	if (enabled) {
		set.delete(id);
	} else {
		set.add(id);
	}
	saveDisabledPlaytimeSet(set);

	try {
		window.dispatchEvent(new CustomEvent(EVENT_PLAYTIME_SETTINGS, {
			detail: { shortcutId: id, enabled: Boolean(enabled) },
		}));
	} catch {}
}

export function subscribePlaytimeSettings(listener: (detail: { shortcutId: string; enabled: boolean }) => void): () => void {
	const handler = (event: Event): void => {
		const detail = (event as CustomEvent<{ shortcutId: string; enabled: boolean }>).detail;
		if (detail) listener(detail);
	};
	window.addEventListener(EVENT_PLAYTIME_SETTINGS, handler);
	return () => window.removeEventListener(EVENT_PLAYTIME_SETTINGS, handler);
}
