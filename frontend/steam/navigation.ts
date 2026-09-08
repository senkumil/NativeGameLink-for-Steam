import { backendLog } from '../api/backend';
import { installBrowserProtection } from './browser-protection';

const installedDocuments = new WeakMap<Document, () => void>();

export function normalizeSteamNavigationUrl(raw: string): string | null {
	const value = String(raw || '').trim();
	if (!value) return null;
	try {
		const parsed = new URL(value);
		if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'steam:') return parsed.toString();
	} catch {
		if (/^steam:\/\//i.test(value)) return value;
	}
	return null;
}

/** Open a URL through Steam's own navigation surface whenever possible. */
export function openSteamNavigationUrl(doc: Document, raw: string): boolean {
	const url = normalizeSteamNavigationUrl(raw);
	if (!url) {
		backendLog('Blocked unsupported navigation URL: ' + String(raw || ''));
		return false;
	}
	try {
		const view = doc.defaultView as any;
		const steamClient = view?.SteamClient || (window as any).SteamClient;
		if (/^steam:\/\//i.test(url) && typeof steamClient?.URL?.ExecuteSteamURL === 'function') {
			steamClient.URL.ExecuteSteamURL(url);
			return true;
		}
		const manager = view?.MainWindowBrowserManager || (window as any).MainWindowBrowserManager;
		if (typeof manager?.ShowURL === 'function') {
			manager.ShowURL(url);
			return true;
		}
		if (typeof steamClient?.URL?.ExecuteSteamURL === 'function') {
			steamClient.URL.ExecuteSteamURL('steam://openurl/' + url);
			return true;
		}
		doc.defaultView?.open('steam://openurl/' + url);
		return true;
	} catch (error) {
		backendLog('Steam navigation failed: ' + String(error));
		return false;
	}
}

export function extractCommunityYoutubeId(item?: { youtube_id?: string; image?: string; link?: string; video_url?: string } | null): string | null {
	if (!item) return null;
	if (item.youtube_id && item.youtube_id.length >= 6) return item.youtube_id;
	const sources = [item.image, item.link, item.video_url].filter(Boolean) as string[];
	for (const src of sources) {
		const m = src.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|img\.youtube\.com\/vi\/|i[0-9]?\.ytimg\.com\/vi\/)([a-zA-Z0-9_-]{11})/i);
		if (m && m[1]) return m[1];
	}
	return null;
}

function handleDelegatedClick(doc: Document, event: MouseEvent): void {
	const target = event.target as Element | null;
	if (!target) return;

	const videoCard = target.closest<HTMLElement>('[data-gdl-youtube-id], .gdl-community-card-video');
	if (videoCard) {
		if (videoCard.classList.contains('gdl-video-playing')) {
			return;
		}
		let ytId = videoCard.dataset.gdlYoutubeId;
		if (!ytId) {
			const img = videoCard.querySelector<HTMLImageElement>('img');
			const openUrl = videoCard.dataset.gdlOpenUrl;
			ytId = extractCommunityYoutubeId({ image: img?.src, link: openUrl }) || undefined;
		}
		if (ytId) {
			event.preventDefault();
			event.stopPropagation();
			const thumb = videoCard.querySelector<HTMLElement>('.gdl-community-video-thumb');
			if (thumb) {
				videoCard.classList.add('gdl-video-playing');
				thumb.innerHTML = `<iframe
					src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?autoplay=1&enablejsapi=1&rel=0"
					style="width:100%;height:100%;border:none;display:block;aspect-ratio:16/9;"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					allowfullscreen></iframe>`;
			}
			return;
		}
	}

	const open = target.closest<HTMLElement>('[data-gdl-open-url]');
	if (open) {
		const url = open.dataset.gdlOpenUrl || '';
		if (url) {
			event.preventDefault();
			event.stopPropagation();
			openSteamNavigationUrl(doc, url);
		}
		return;
	}

	const toggle = target.closest<HTMLElement>('[data-gdl-toggle-target]');
	if (toggle) {
		const selector = toggle.dataset.gdlToggleTarget || '';
		if (!selector) return;
		const destination = doc.querySelector<HTMLElement>(selector);
		if (!destination) return;
		event.preventDefault();
		destination.style.display = '';
		if (toggle.dataset.gdlHideSelf === '1') toggle.style.display = 'none';
		return;
	}

	const scroll = target.closest<HTMLElement>('[data-gdl-scroll-target]');
	if (scroll) {
		const selector = scroll.dataset.gdlScrollTarget || '';
		const destination = selector ? doc.querySelector<HTMLElement>(selector) : null;
		if (!destination) return;
		event.preventDefault();
		try { destination.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
		catch { destination.scrollIntoView(); }
		return;
	}

	const swap = target.closest<HTMLElement>('[data-gdl-swap-main]');
	if (swap) {
		const mainId = swap.dataset.gdlSwapMain || '';
		const linkId = swap.dataset.gdlSwapLink || '';
		const src = swap.getAttribute('src') || '';
		const url = swap.dataset.gdlSwapUrl || '';
		const main = mainId ? doc.getElementById(mainId) as HTMLImageElement | null : null;
		const link = linkId ? doc.getElementById(linkId) as HTMLAnchorElement | null : null;
		if (!main) return;
		event.preventDefault();
		event.stopPropagation();
		const previousSrc = main.src;
		const previousUrl = link?.dataset.gdlOpenUrl || link?.href || '';
		main.src = src;
		if (link && url) {
			link.dataset.gdlOpenUrl = url;
			link.href = url;
		}
		if (swap instanceof HTMLImageElement) swap.src = previousSrc;
		if (previousUrl) swap.dataset.gdlSwapUrl = previousUrl;
	}
}

function handleDelegatedImageError(event: Event): void {
	const image = event.target as HTMLImageElement | null;
	if (!(image instanceof HTMLImageElement)) return;
	const fallback = image.dataset.gdlFallbackSrc;
	if (fallback && image.src !== fallback) {
		image.src = fallback;
		return;
	}
	if (image.dataset.gdlHideOnError === '1') image.style.display = 'none';
	if (image.dataset.gdlInvisibleOnError === '1') image.style.visibility = 'hidden';
}

/** Install one delegated behavior layer per Steam document. */
export function installSteamNavigation(doc: Document): () => void {
	const existing = installedDocuments.get(doc);
	if (existing) return existing;
	const click = (event: Event) => handleDelegatedClick(doc, event as MouseEvent);
	const error = (event: Event) => handleDelegatedImageError(event);
	const cleanupProtection = installBrowserProtection(doc.defaultView, doc);
	doc.addEventListener('click', click, true);
	doc.addEventListener('error', error, true);
	const cleanup = (): void => {
		doc.removeEventListener('click', click, true);
		doc.removeEventListener('error', error, true);
		cleanupProtection();
		installedDocuments.delete(doc);
	};
	installedDocuments.set(doc, cleanup);
	return cleanup;
}

export function disposeSteamNavigation(doc: Document): void {
	installedDocuments.get(doc)?.();
}

/** Safely navigate Steam's library to a Non-Steam shortcut without triggering browser reloads. */
export function navigateToLibraryShortcut(doc: Document, shortcutAppId: string | number): boolean {
	const id = Number(shortcutAppId);
	if (!Number.isFinite(id) || id <= 0) return false;
	const signedId = id < 0 ? id : (id > 2147483647 ? (id - 4294967296) : id);
	const unsignedId = id < 0 ? (id >>> 0) : id;

	// 1. Dispatch click on the matching row in the library sidebar
	const rows = doc.querySelectorAll<HTMLElement>(
		`[data-appid="${unsignedId}"], [data-appid="${signedId}"], a[href*="/app/${unsignedId}"], a[href*="/details/${unsignedId}"], a[href*="/app/${signedId}"], a[href*="/details/${signedId}"]`
	);
	for (const row of Array.from(rows)) {
		const target = row.tagName === 'A' ? row : (row.querySelector<HTMLElement>('a') || row);
		target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView || window }));
		return true;
	}

	// 2. React fiber traversal across sidebar entries
	const allRows = doc.querySelectorAll<HTMLElement>(
		'[class*="gamelistentry_"], [class*="gamelistsection_"], [class*="gameListRow"], [class*="GameListRow"], [class*="gameListEntry"], [class*="GameListEntry"], [role="treeitem"], [role="listitem"]'
	);
	for (const row of Array.from(allRows)) {
		for (const key of Object.keys(row)) {
			if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
				let fiber = (row as any)[key];
				for (let depth = 0; fiber && depth < 10; depth += 1, fiber = fiber.return) {
					const props = fiber.memoizedProps || fiber.pendingProps;
					const item = props?.item || props?.overview || props?.app;
					const rowId = Number(item?.appid ?? item?.m_unAppID ?? props?.appid);
					if (rowId === unsignedId || rowId === signedId) {
						const target = row.querySelector<HTMLElement>('a') || row;
						target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView || window }));
						return true;
					}
				}
			}
		}
	}

	// 3. React Router History (g_AppHistory / g_History)
	const view = (doc.defaultView as any) || (window as any);
	const history = view?.g_History || view?.g_AppHistory || (window as any).g_History || (window as any).g_AppHistory;
	if (typeof history?.push === 'function') {
		try {
			history.push(`/library/app/${unsignedId}`);
			return true;
		} catch {}
	}

	// 4. Steam Client Apps
	const steamClient = view?.SteamClient || (window as any).SteamClient;
	if (typeof steamClient?.Apps?.ShowApp === 'function') {
		try {
			steamClient.Apps.ShowApp(unsignedId);
			return true;
		} catch {}
	}

	return false;
}

