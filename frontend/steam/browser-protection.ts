const acceleratorWindows = new WeakSet<Window>();
const acceleratorDocuments = new WeakSet<Document>();
const transientProtectedDocuments = new WeakSet<Document>();
const cleanupCallbacks = new Set<() => void>();
const WINDOW_ACCELERATOR_GUARD_KEY = Symbol.for('NativeGameLink.browserProtection.windowAcceleratorGuard.v1');
const DOCUMENT_ACCELERATOR_GUARD_KEY = Symbol.for('NativeGameLink.browserProtection.documentAcceleratorGuard.v1');

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

	// Ctrl+J / Cmd+J: Downloads page
	if (key === 'j' || code === 74) return true;

	// Ctrl+U / Cmd+U: View page source
	if (key === 'u' || code === 85) return true;

	return false;
}

function blockAcceleratorHandler(event: KeyboardEvent): void {
	if (!isSaveOrBrowserAccelerator(event)) return;
	event.preventDefault();
	event.stopPropagation();
	if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
}

function installStickyWindowAcceleratorGuard(win: Window): void {
	if (acceleratorWindows.has(win)) return;
	try {
		if ((win as any)[WINDOW_ACCELERATOR_GUARD_KEY]) {
			acceleratorWindows.add(win);
			return;
		}
		Object.defineProperty(win, WINDOW_ACCELERATOR_GUARD_KEY, { value: true, configurable: false });
	} catch {}
	acceleratorWindows.add(win);
	try {
		win.addEventListener('keydown', blockAcceleratorHandler, true);
		win.addEventListener('keyup', blockAcceleratorHandler, true);
		// Do not remove this guard when the plugin is hot-disabled. A CEF renderer
		// can still deliver a queued Ctrl+S while Steam is tearing the window down,
		// which opens a Win32 "Guardar como <AppID>" dialog. The window owns this
		// safety guard for the full lifetime of the realm. WeakSet membership and
		// DOM listeners disappear with the destroyed CEF window, so no explicit
		// beforeunload removal can open a shutdown race.
	} catch {}
}

function installStickyDocumentAcceleratorGuard(doc: Document): void {
	if (acceleratorDocuments.has(doc)) return;
	try {
		if ((doc as any)[DOCUMENT_ACCELERATOR_GUARD_KEY]) {
			acceleratorDocuments.add(doc);
			return;
		}
		Object.defineProperty(doc, DOCUMENT_ACCELERATOR_GUARD_KEY, { value: true, configurable: false });
	} catch {}
	acceleratorDocuments.add(doc);
	try {
		doc.addEventListener('keydown', blockAcceleratorHandler, true);
		doc.addEventListener('keyup', blockAcceleratorHandler, true);
	} catch {}
}

function blockContextMenu(event: MouseEvent): void {
	const target = event.target as HTMLElement | null;
	const isEditable = target && (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.isContentEditable
	);
	if (!isEditable) event.preventDefault();
}

function blockDragDrop(event: DragEvent): void {
	event.preventDefault();
}

function blockDownloadClicks(event: MouseEvent): void {
	const target = event.target as Element | null;
	if (!target) return;
	const anchor = target.closest<HTMLAnchorElement>('a[download]');
	if (!anchor) return;
	const href = String(anchor.getAttribute('href') || '');
	if (href.includes('steamloopback.host') || href.startsWith('/') || href.startsWith('steam:')) {
		event.preventDefault();
		event.stopPropagation();
		if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
	}
}

/**
 * Installs a lifetime accelerator guard plus disposable interaction guards.
 * The accelerator layer intentionally survives plugin hot-disable until the CEF
 * window unloads so queued Chromium shortcuts cannot escape during restart.
 */
export function installBrowserProtection(win: Window | null | undefined, doc: Document | null | undefined): () => void {
	if (win) installStickyWindowAcceleratorGuard(win);
	if (doc) installStickyDocumentAcceleratorGuard(doc);

	const cleanups: (() => void)[] = [];
	if (doc && !transientProtectedDocuments.has(doc)) {
		try {
			transientProtectedDocuments.add(doc);
			doc.addEventListener('click', blockDownloadClicks, true);
			doc.addEventListener('contextmenu', blockContextMenu, false);
			doc.addEventListener('dragover', blockDragDrop, false);
			doc.addEventListener('drop', blockDragDrop, false);
			cleanups.push(() => {
				try {
					doc.removeEventListener('click', blockDownloadClicks, true);
					doc.removeEventListener('contextmenu', blockContextMenu, false);
					doc.removeEventListener('dragover', blockDragDrop, false);
					doc.removeEventListener('drop', blockDragDrop, false);
				} catch {}
				transientProtectedDocuments.delete(doc);
			});
		} catch {}
	}

	if (cleanups.length === 0) return () => {};
	const combinedCleanup = () => {
		for (const fn of cleanups) {
			try { fn(); } catch {}
		}
		cleanupCallbacks.delete(combinedCleanup);
	};
	cleanupCallbacks.add(combinedCleanup);
	return combinedCleanup;
}

/** Removes disposable interaction guards. Accelerator guards remain until realm destruction. */
export function disposeAllBrowserProtection(): void {
	for (const cleanup of Array.from(cleanupCallbacks)) {
		try { cleanup(); } catch {}
	}
	cleanupCallbacks.clear();
}
