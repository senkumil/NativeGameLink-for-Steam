import { installBrowserProtection } from './browser-protection';

const EARLY_SWEEP_DELAYS_MS = [0, 25, 75, 150, 300, 600, 1200, 2000] as const;

function resolveCandidateWindow(candidate: any): Window | null {
	const values = [
		candidate?.window,
		candidate?.m_popup?.window,
		candidate?.BrowserWindow,
		candidate?.m_popup?.BrowserWindow,
		candidate?.m_window,
		candidate,
	];
	for (const value of values) {
		try {
			if (value?.document && typeof value.addEventListener === 'function') return value as Window;
		} catch {}
	}
	return null;
}

function protectCandidate(candidate: any): void {
	const win = resolveCandidateWindow(candidate);
	if (!win) return;
	try { installBrowserProtection(win, win.document); } catch {}
}

function protectKnownSteamWindows(): void {
	if (typeof window === 'undefined') return;
	protectCandidate(window);
	let manager: any = null;
	try { manager = (window as any).g_PopupManager; } catch {}
	if (!manager) return;

	const candidates = new Set<any>();
	const add = (value: any): void => { if (value) candidates.add(value); };
	try {
		const popups = manager.GetPopups?.();
		if (popups && typeof popups[Symbol.iterator] === 'function') {
			for (const popup of popups) add(popup);
		}
	} catch {}
	try {
		const popupMap = manager.m_mapPopups;
		if (popupMap && typeof popupMap.values === 'function') {
			for (const popup of popupMap.values()) add(popup);
		} else if (popupMap?.data_ && typeof popupMap.data_[Symbol.iterator] === 'function') {
			for (const entry of popupMap.data_) add(Array.isArray(entry) ? entry[1] : entry);
		}
	} catch {}
	for (const name of ['SP Desktop_uid0', 'SP Desktop', 'SP BPM_uid0', 'SP BPM']) {
		try { add(manager.GetExistingPopup?.(name)); } catch {}
	}
	for (const candidate of candidates) protectCandidate(candidate);
}

// This side effect is deliberately in the entry bootstrap, before runtime/app is
// evaluated. Hot-enabling a Millennium plugin can replay a queued Chromium
// accelerator while Steam is still on routes such as /home. Protect the current
// realm immediately, then cover native popups that appear during the short
// enable/reload window before the normal AddWindowCreateHook is registered.
protectKnownSteamWindows();
for (const delay of EARLY_SWEEP_DELAYS_MS) {
	setTimeout(protectKnownSteamWindows, delay);
}
