const protectedWindows = new WeakSet<Window>();
const protectedDocuments = new WeakSet<Document>();
const cleanupCallbacks = new Set<() => void>();

function isSaveOrBrowserAccelerator(event: KeyboardEvent): boolean {
	if (!event.ctrlKey && !event.metaKey) return false;
	if (event.altKey) return false;

	const key = String(event.key || '').toLowerCase();
	const code = Number(event.keyCode || event.which || 0);

	// Ctrl+S / Cmd+S: Save Page As (triggers Windows "Guardar como" and freezes Steam)
	if (key === 's' || code === 83) return true;

	// Ctrl+P / Cmd+P: Print dialog
	if (key === 'p' || code === 80) return true;

	// Ctrl+O / Cmd+O: Open file dialog
	if (key === 'o' || code === 79) return true;

	return false;
}

function blockAcceleratorHandler(event: KeyboardEvent): void {
	if (isSaveOrBrowserAccelerator(event)) {
		event.preventDefault();
		event.stopPropagation();
		if (typeof event.stopImmediatePropagation === 'function') {
			event.stopImmediatePropagation();
		}
	}
}

function blockDownloadClicks(event: MouseEvent): void {
	const target = event.target as Element | null;
	if (!target) return;
	const anchor = target.closest<HTMLAnchorElement>('a[download]');
	if (anchor) {
		const href = String(anchor.getAttribute('href') || '');
		if (href.includes('steamloopback.host') || href.startsWith('/') || href.startsWith('steam:')) {
			event.preventDefault();
			event.stopPropagation();
			if (typeof event.stopImmediatePropagation === 'function') {
				event.stopImmediatePropagation();
			}
		}
	}
}

/**
 * Attaches capture-phase keyboard interceptors to prevent Chromium from invoking
 * native browser accelerators (e.g. Save Page As, Print, Open File) which spawn modal
 * Win32 file dialogs that deadlock the CEF message loop and block Steam from restarting.
 */
export function installBrowserProtection(win: Window | null | undefined, doc: Document | null | undefined): () => void {
	const cleanups: (() => void)[] = [];

	if (win && !protectedWindows.has(win)) {
		try {
			protectedWindows.add(win);
			win.addEventListener('keydown', blockAcceleratorHandler, true);
			cleanups.push(() => {
				try { win.removeEventListener('keydown', blockAcceleratorHandler, true); } catch {}
				protectedWindows.delete(win);
			});
		} catch {}
	}

	if (doc && !protectedDocuments.has(doc)) {
		try {
			protectedDocuments.add(doc);
			doc.addEventListener('keydown', blockAcceleratorHandler, true);
			doc.addEventListener('click', blockDownloadClicks, true);
			cleanups.push(() => {
				try {
					doc.removeEventListener('keydown', blockAcceleratorHandler, true);
					doc.removeEventListener('click', blockDownloadClicks, true);
				} catch {}
				protectedDocuments.delete(doc);
			});
		} catch {}
	}

	const combinedCleanup = () => {
		for (const fn of cleanups) {
			try { fn(); } catch {}
		}
		cleanupCallbacks.delete(combinedCleanup);
	};

	cleanupCallbacks.add(combinedCleanup);
	return combinedCleanup;
}

/**
 * Dismounts all active protection listeners across all Steam documents and windows.
 */
export function disposeAllBrowserProtection(): void {
	for (const cleanup of Array.from(cleanupCallbacks)) {
		try { cleanup(); } catch {}
	}
	cleanupCallbacks.clear();
}
