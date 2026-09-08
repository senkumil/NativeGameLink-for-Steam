export function resolveSteamWindowContext(context: any): {
	popupWin: Window | undefined;
	popupDoc: Document | undefined;
	popupName: string;
	popupTitle: string;
} {
	const popupWin: Window | undefined = context?.window
		|| context?.m_popup?.window
		|| context?.BrowserWindow
		|| context?.m_popup?.BrowserWindow
		|| (context?.document ? context : (typeof window !== 'undefined' ? window : undefined));
	const popupDoc = popupWin?.document;
	return {
		popupWin,
		popupDoc,
		popupName: context?.m_strName || context?.m_popup?.m_strName || popupWin?.name || '',
		popupTitle: context?.m_strTitle || context?.m_popup?.m_strTitle || popupDoc?.title || '',
	};
}

export function isRealSteamUiWindow(win: Window | undefined): boolean {
	if (!win) return false;
	try {
		const doc = win.document;
		if (!doc || !doc.body) return false;
		if (win.name && /SP Desktop|SP BPM|Steam|Gamepad/i.test(win.name)) return true;
		const href = String(win.location?.href || '');
		if (href.includes('steamloopback.host') || href.includes('routes/library') || href.includes('gamepadui')) return true;
		if (doc.querySelector?.('.libraryhomeshowcases, [class*="libraryhome"], [class*="FullModalOverlay"], [class*="GamepadUI"], .GamepadUI, #root')) return true;
	} catch {}
	return false;
}

export function getCanonicalDesktopPopup(manager?: any): any {
	const pm = manager || (typeof window !== 'undefined' ? (window as any).g_PopupManager : null);
	if (!pm) return null;
	for (const name of ['SP Desktop_uid0', 'SP Desktop']) {
		try {
			const popup = pm.GetExistingPopup?.(name) || pm.m_mapPopups?.get?.(name);
			if (popup) return popup;
		} catch {}
	}
	return null;
}

/**
 * Adopt Steam windows that predate a plugin frontend.
 *
 * Millennium normally calls AddWindowCreateHook for existing popups too, but
 * its hot-enable/reload path has used different wrapper shapes across releases.
 * Enumerating the popup manager directly makes first activation and a normal
 * cold start follow the same path.
 */
export function adoptExistingSteamWindows(onWindowCreated: (context: any) => void): void {
	const manager = (window as any).g_PopupManager;
	const contexts: any[] = [];
	const seen = new Set<any>();
	const add = (candidate: any) => {
		if (!candidate || seen.has(candidate)) return;
		seen.add(candidate);
		contexts.push(candidate);
	};

	try {
		const popups = manager?.GetPopups?.();
		if (popups && typeof popups[Symbol.iterator] === 'function') {
			for (const popup of popups) add(popup);
		}
	} catch {}

	try {
		const popupMap = manager?.m_mapPopups;
		if (popupMap && typeof popupMap.values === 'function') {
			for (const popup of popupMap.values()) add(popup);
		} else if (popupMap?.data_ && typeof popupMap.data_[Symbol.iterator] === 'function') {
			for (const popup of popupMap.data_) add(Array.isArray(popup) ? popup[1] : popup);
		}
	} catch {}

	for (const name of ['SP Desktop_uid0', 'SP Desktop', 'SP BPM_uid0', 'SP BPM']) {
		try { add(manager?.GetExistingPopup?.(name)); } catch {}
	}

	for (const context of contexts) onWindowCreated(context);
	if (contexts.length === 0 && isRealSteamUiWindow(typeof window !== 'undefined' ? window : undefined)) {
		onWindowCreated(window);
	}
}
