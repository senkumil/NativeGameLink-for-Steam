import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { getTradingCardPreload } from './trading-card-preload';

type NativePreviewApi = { open: (options: Record<string, unknown>) => unknown; manager: any; view: Window };
type PreviewRequest = {
	api: NativePreviewApi;
	url: string;
	title: string;
	fallback?: string;
	ownerToken: object;
	cancelled: boolean;
	everShown: boolean;
	ownedKeys: Set<string>;
	closedKeys: Set<string>;
	cancelPreflight?: () => void;
};
type PreviewChannel = { latest: PreviewRequest | null; running: PreviewRequest | null };
const channels = new WeakMap<Document, PreviewChannel>();

function resolvePreviewApi(doc: Document): NativePreviewApi | null {
	const view = doc.defaultView;
	if (!view || view.closed) return null;
	try {
		steamWebpackRuntime.captureRuntime(doc);
		const require = steamWebpackRuntime.getRequire(doc);
		const open = require?.(94715)?.N;
		const getManager = require?.(3673)?.tx;
		if (typeof open !== 'function' || typeof getManager !== 'function') return null;
		const manager = getManager(view);
		if (!manager) return null;
		return { open, manager, view };
	} catch { return null; }
}

function modelsIn(manager: any): any[] {
	const result: any[] = [];
	for (const property of ['modals', 'legacy_popup_modals']) {
		try {
			const collection = manager[property];
			if (collection && typeof collection[Symbol.iterator] === 'function') {
				const iterable = typeof collection.get === 'function' && typeof collection.values === 'function' ? collection.values() : collection;
				for (const model of iterable) result.push(model);
			}
		} catch {}
	}
	return result;
}

function modelKey(model: any): string | null {
	return typeof model?.key === 'string' || typeof model?.key === 'number' ? String(model.key) : null;
}

function closeOwned(request: PreviewRequest): void {
	for (const model of modelsIn(request.api.manager)) {
		const key = modelKey(model);
		if (key === null || !request.ownedKeys.has(key) || request.closedKeys.has(key)) continue;
		const props = model?.element?.props;
		if (props?.window !== request.api.view || props?.additionalFields !== request.ownerToken
			|| (props?.artworkURL !== request.url && props?.artworkURL !== request.fallback)) continue;
		const close = props.closeModal;
		if (typeof close !== 'function') continue;
		request.closedKeys.add(key);
		try { close(); } catch {}
	}
}

function cancelRequest(request: PreviewRequest): void {
	request.cancelled = true;
	request.cancelPreflight?.();
	closeOwned(request);
}

function validateImage(doc: Document, request: PreviewRequest, url: string): string | null | Promise<string | null> {
	if (request.cancelled) return null;
	const cached = getTradingCardPreload(doc, url);
	if (cached?.complete && cached.naturalWidth > 0) return url;
	return new Promise(resolve => {
		const image = doc.createElement('img');
		let finished = false;
		const finish = (valid: boolean): void => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			image.removeEventListener('load', loaded);
			image.removeEventListener('error', failed);
			image.removeAttribute('src');
			if (request.cancelPreflight === cancel) request.cancelPreflight = undefined;
			resolve(valid && !request.cancelled ? url : null);
		};
		const loaded = (): void => finish(image.naturalWidth > 0);
		const failed = (): void => finish(false);
		const cancel = (): void => finish(false);
		const timer = setTimeout(failed, 8_000);
		request.cancelPreflight = cancel;
		image.decoding = 'async';
		image.addEventListener('load', loaded);
		image.addEventListener('error', failed);
		image.src = url;
		if (image.complete) loaded();
	});
}

function subscribe(register: (() => unknown) | undefined, cleanups: Array<() => void>): void {
	try {
		const registration: any = register?.();
		if (typeof registration === 'function') cleanups.push(registration);
		else if (typeof registration?.Unregister === 'function') cleanups.push(() => registration.Unregister());
	} catch {}
}

async function openAttempt(request: PreviewRequest, url: string): Promise<void> {
	const { api } = request;
	const before = new Set(modelsIn(api.manager).map(modelKey).filter((key): key is string => key !== null));
	const cleanups: Array<() => void> = [];
	const capture = (): void => {
		for (const model of modelsIn(api.manager)) {
			const key = modelKey(model), props = model?.element?.props;
			if (key === null || before.has(key) || props?.artworkURL !== url || props?.window !== api.view || props?.additionalFields !== request.ownerToken) continue;
			request.ownedKeys.add(key);
			request.everShown = true;
		}
		// Steam dispatches its shown callback before assigning the new modal's
		// controller. Close on the next microtask so its closeModal can use it.
		if (request.cancelled && request.ownedKeys.size) void Promise.resolve().then(() => closeOwned(request));
	};
	subscribe(typeof api.manager.RegisterOnModalShownCallback === 'function'
		? () => api.manager.RegisterOnModalShownCallback(capture) : undefined, cleanups);
	subscribe(typeof api.manager.LegacyPopupModalCountChangedCallbacks?.Register === 'function'
		? () => api.manager.LegacyPopupModalCountChangedCallbacks.Register(capture) : undefined, cleanups);
	try {
		// The native viewer owns measurement, screen-relative fitting, its dialog
		// frame, popup selection, localization, buttons and keyboard handling.
		// Steam forwards additionalFields to the artwork element but renders it
		// only for file_details. Cards have none, so this token adds no UI.
		await api.open({ strURL: url, strTitle: request.title, windowOverride: api.view, additionalFields: request.ownerToken });
	} catch {
		// Steam's current implementation also catches image/render failures.
		// The missing owned model below determines whether to try the fallback.
	} finally {
		capture();
		for (const cleanup of cleanups) { try { cleanup(); } catch {} }
	}
	if (request.cancelled) closeOwned(request);
}

function pump(doc: Document, channel: PreviewChannel): void {
	if (channel.running || !channel.latest || channel.latest.cancelled) return;
	const request = channel.latest;
	channel.running = request;
	void (async () => {
		const primary = validateImage(doc, request, request.url);
		const primaryUrl = typeof primary === 'string' ? primary : await primary;
		if (!request.cancelled && primaryUrl) await openAttempt(request, primaryUrl);
		if (!request.cancelled && !request.everShown && request.fallback && request.fallback !== request.url) {
			const fallback = validateImage(doc, request, request.fallback);
			const fallbackUrl = typeof fallback === 'string' ? fallback : await fallback;
			if (!request.cancelled && fallbackUrl) await openAttempt(request, fallbackUrl);
		}
	})().catch(() => {}).finally(() => {
		if (request.cancelled) closeOwned(request);
		channel.running = null;
		if (channel.latest === request && request.cancelled) channel.latest = null;
		if (channel.latest && channel.latest !== request) pump(doc, channel);
		else if (!channel.latest) channels.delete(doc);
	});
}

/** Use Steam's own card-artwork viewer, with one pending native render per doc.
 * Only primitive modal keys are retained; React models and close closures are
 * looked up from Steam's live manager when cleanup is actually required. */
export function tryOpenNativeCardPreview(doc: Document, url: string, title: string, fallbackUrl?: string): boolean {
	if (!url) return false;
	const api = resolvePreviewApi(doc);
	if (!api) return false;
	let channel = channels.get(doc);
	if (!channel) { channel = { latest: null, running: null }; channels.set(doc, channel); }
	const previous = channel.latest;
	if (previous && !previous.cancelled && previous.url === url) {
		const stillOpen = modelsIn(previous.api.manager).some(model => {
			const key = modelKey(model), props = model?.element?.props;
			return key !== null && previous.ownedKeys.has(key) && props?.additionalFields === previous.ownerToken
				&& props?.window === previous.api.view && (props?.artworkURL === previous.url || props?.artworkURL === previous.fallback);
		});
		if (channel.running === previous || stillOpen) return true;
	}
	if (previous) cancelRequest(previous);
	channel.latest = {
		api, url, title, fallback: fallbackUrl, ownerToken: {}, cancelled: false, everShown: false,
		ownedKeys: new Set(), closedKeys: new Set(),
	};
	pump(doc, channel);
	return true;
}

export function disposeNativeCardPreview(doc: Document): void {
	const channel = channels.get(doc);
	if (!channel) return;
	if (channel.latest) { cancelRequest(channel.latest); channel.latest = null; }
	if (channel.running) cancelRequest(channel.running);
	else channels.delete(doc);
}
