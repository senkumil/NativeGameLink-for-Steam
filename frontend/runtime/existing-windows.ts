import { findSP } from '@steambrew/client';

export function resolveSteamWindowContext(context: any): {
	popupWin: Window | undefined;
	popupDoc: Document | undefined;
	popupName: string;
	popupTitle: string;
} {
	const popupWin: Window | undefined = context?.window
		|| context?.m_popup?.m_baseWindow?.m_window
		|| context?.m_baseWindow?.m_window
		|| context?.m_popup?.window
		|| context?.BrowserWindow
		|| context?.m_popup?.BrowserWindow
		|| (context?.document ? context : undefined);
	const popupDoc = popupWin?.document;
	return {
		popupWin,
		popupDoc,
		popupName: context?.m_strName || context?.name || context?.m_popup?.m_strName || popupWin?.name || '',
		popupTitle: context?.m_strTitle || context?.title || context?.m_popup?.m_strTitle || popupDoc?.title || '',
	};
}

export function isRealSteamUiWindow(win: Window | undefined): boolean {
	if (!win || win.closed) return false;
	try {
		const name = String(win.name || '');
		if (/shared\s*js\s*context/i.test(name)) return false;
		if (/SP Desktop|SP BPM|Steam|Gamepad/i.test(name)) return true;
		const doc = win.document;
		if (!doc || !doc.body) return false;
		const title = String(doc.title || '');
		if (title === 'Steam' || /Steam|Biblioteca|Library/i.test(title)) return true;
		const href = String(win.location?.href || '');
		if (/(?:routes\/library|\/library(?:[/?#]|$)|gamepadui|bigpicture)/i.test(href)) return true;
		if (href.includes('steamloopback.host')) {
			if (doc.querySelector?.(
				'.libraryhomeshowcases, [class*="libraryhome"], [class*="libraryroot"], [class*="appdetails"], [class*="steamdesktop"], [class*="supernav"], [class*="GamepadUI"], .GamepadUI, [class*="nonsteamgame"], [class*="nonSteamGame"]'
			)) return true;
		}
		return Boolean(doc.querySelector?.(
			'.libraryhomeshowcases, [class*="libraryhome"], [class*="libraryroot"], [class*="appdetails"], [class*="steamdesktop"], [class*="supernav"], [class*="GamepadUI"], .GamepadUI, [class*="nonsteamgame"], [class*="nonSteamGame"]'
		));
	} catch { return false; }
}

export function getCanonicalDesktopPopup(manager?: any): any {
	const pm = manager || (typeof window !== 'undefined' ? (window as any).g_PopupManager : null);
	if (pm) {
		for (const name of ['SP Desktop_uid0', 'SP Desktop']) {
			try {
				const popup = pm.GetExistingPopup?.(name) || pm.m_mapPopups?.get?.(name);
				if (popup) return popup;
			} catch {}
		}
	}
	// Current Millennium/Steam builds can expose the real SP render target
	// before g_PopupManager publishes its named entry. This helper resolves the
	// ownerDocument of Steam's root navigation tree and never points at the
	// background realm where plugins themselves are evaluated.
	try {
		const sp = findSP();
		if (sp?.document?.body && !sp.closed && isRealSteamUiWindow(sp)) {
			return { window: sp, m_strName: sp.name || 'SP Desktop', m_strTitle: sp.document.title || '' };
		}
	} catch {}
	return null;
}

/**
 * Adopt Steam windows that predate a plugin frontend.
 *
 * Never adopt the Millennium evaluation/background realm as SP Desktop. On a
 * clean start that realm often has a generic #root before g_PopupManager is
 * populated; treating it as Library permanently points runtime hosts at the
 * wrong Document and suppresses both the manual Link button and auto-detection.
 */
export function adoptExistingSteamWindows(onWindowCreated: (context: any) => void): void {
	const manager = typeof window !== 'undefined' ? (window as any).g_PopupManager : null;
	const contexts: any[] = [];
	const seenWindows = new Set<Window>();
	const add = (candidate: any): void => {
		if (!candidate) return;
		const { popupWin } = resolveSteamWindowContext(candidate);
		if (!popupWin || seenWindows.has(popupWin)) return;
		seenWindows.add(popupWin);
		contexts.push(candidate);
	};

	add(getCanonicalDesktopPopup(manager));
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
}
