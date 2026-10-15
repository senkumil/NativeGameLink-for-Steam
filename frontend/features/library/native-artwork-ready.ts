import { committedHeaderAppId } from '../../steam/library-details';
import { findNativeLibraryHeader, getNativeLibraryArtworkSelectors } from '../../steam/library-header';
import { routedSteamAppId } from './native-route';

const MAX_ARTWORK_WAIT_MS = 1500;

/** Yield to the actual native artwork load, rather than assuming two RAFs mean
 * Steam has finished its hero. Only existing DOM images are read; Steam owns
 * their requests, decoded pixels, fallback order and visibility throughout. */
export function waitForNativeArtwork(doc: Document, ready: () => void, onNativeShell?: () => void): () => void {
	const view = doc.defaultView;
	const expectedAppId = routedSteamAppId(doc);
	if (!view || view.closed || doc.hidden || !doc.body) return () => {};
	// The shared runtime also schedules work on Home/non-library surfaces.
	// There is no destination artwork to prioritize when no AppID is routed.
	if (expectedAppId === null) { ready(); return () => {}; }
	const selectors = getNativeLibraryArtworkSelectors();
	let disposed = false;
	let header: HTMLElement | null = null;
	let timer: ReturnType<Window['setTimeout']> | undefined;
	let headerObserver: MutationObserver | null = null;
	let mountObserver: MutationObserver | null = null;
	let discovering = false;
	const isCurrent = (): boolean => !disposed && !doc.hidden && !view.closed && routedSteamAppId(doc) === expectedAppId;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (timer !== undefined) view.clearTimeout(timer);
		timer = undefined;
		headerObserver?.disconnect(); mountObserver?.disconnect();
		header?.removeEventListener('load', check, true);
		header?.removeEventListener('error', check, true);
		doc.removeEventListener('visibilitychange', check);
		view.removeEventListener('pagehide', dispose);
		view.removeEventListener('popstate', check);
		view.removeEventListener('hashchange', check);
		header = null;
	};
	const finish = (): void => {
		if (!isCurrent()) { dispose(); return; }
		dispose();
		ready();
	};
	const isDestinationHeader = (element: HTMLElement | null): element is HTMLElement => Boolean(element?.isConnected
		&& !element.closest('[id^="gdl-"]') && committedHeaderAppId(element) === expectedAppId);
	const bindHeader = (next: HTMLElement | null): void => {
		if (header === next && (next ? !discovering : discovering)) return;
		header?.removeEventListener('load', check, true);
		header?.removeEventListener('error', check, true);
		headerObserver?.disconnect(); mountObserver?.disconnect();
		header = next;
		discovering = !next;
		if (next) {
			next.addEventListener('load', check, true);
			next.addEventListener('error', check, true);
			headerObserver?.observe(next, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'srcset', 'style'] });
			// Direct child lists along this small mount path detect a replaced
			// header/ancestor, without observing the sidebar or whole page subtree.
			for (let parent = next.parentElement; parent; parent = parent.parentElement) {
				mountObserver?.observe(parent, { childList: true });
				if (parent === doc.body) break;
			}
		} else {
			mountObserver?.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] });
		}
	};
	function check(): void {
		if (!isCurrent()) { dispose(); return; }
		if (!isDestinationHeader(header)) {
			const first = findNativeLibraryHeader(doc);
			const next = isDestinationHeader(first) ? first : Array.from(doc.querySelectorAll<HTMLElement>(selectors.header)).find(isDestinationHeader) || null;
			bindHeader(next);
		}
		// The small current-game columns do not depend on decoded hero pixels.
		// Reuse this scoped native observer for split commits without another
		// body observer or polling, while the heavy callback still waits below.
		onNativeShell?.();
		if (!header) return;
		const heroes = Array.from(header.querySelectorAll<HTMLImageElement>(selectors.hero));
		const logos = Array.from(header.querySelectorAll<HTMLImageElement>(selectors.logo));
		const loaded = (image: HTMLImageElement): boolean => image.complete && image.naturalWidth > 0;
		const nativeLoaded = header.matches(selectors.loaded) || Boolean(header.closest(selectors.loaded));
		// HeaderLoaded is Steam's own hero readiness signal. Checking the actual
		// images also avoids starting between a failed JPG and its PNG fallback,
		// or while a mounted logo is still pending after the hero has loaded.
		if (nativeLoaded && heroes.every(loaded) && logos.every(loaded)) finish();
	}
	if (view.MutationObserver) {
		headerObserver = new view.MutationObserver(check);
		mountObserver = new view.MutationObserver(records => {
			if (!isCurrent()) { dispose(); return; }
			const relevant = records.some(record => {
				if (header) return Array.from(record.removedNodes).some(node => node === header || node.contains(header));
				const target = record.target as Element;
				if (target.nodeType === 1 && (target.matches(selectors.header) || target.closest(selectors.header))) return true;
				return Array.from(record.addedNodes).some(node => node.nodeType === 1
					&& ((node as Element).matches(selectors.header) || (node as Element).querySelector(selectors.header)));
			});
			if (relevant) check();
		});
	}
	doc.addEventListener('visibilitychange', check);
	view.addEventListener('pagehide', dispose);
	view.addEventListener('popstate', check);
	view.addEventListener('hashchange', check);
	timer = view.setTimeout(finish, MAX_ARTWORK_WAIT_MS);
	// Install discovery even when the first route signal precedes React's header.
	bindHeader(null);
	check();
	return dispose;
}
