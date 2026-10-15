import { officialSteamText, steamLanguageSync } from '../steam/localization';

const MAX_LABEL_LENGTH = 96;
const MAX_NODES_PER_SLICE = 256;
const MAX_SLICE_MS = 2;
const COPY_FEEDBACK_MS = 1200;
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"]';

interface ScanWork {
	root: HTMLElement;
	walker: TreeWalker | null;
	started: boolean;
}

interface CopiedFeedbackState {
	initialScheduled: boolean;
	queue: ScanWork[];
	queuedRoots: Set<HTMLElement>;
	frame: number | null;
	timer: number | null;
	language: string;
	labels: Set<string>;
	disposed: boolean;
	copyPendingUntil: number;
	confirmed: WeakMap<HTMLElement, number>;
	hiddenStyles: WeakMap<HTMLElement, Array<[string, string, string]>>;
	releaseCopyTracking: () => void;
}

const states = new WeakMap<Document, CopiedFeedbackState>();

function normalizedText(value: string): string {
	return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function isCandidate(element: HTMLElement): boolean {
	return /^(?:DIV|SPAN|P)$/.test(element.tagName)
		|| /tooltip|popup|toast|copied|badge|bubble/i.test(element.getAttribute('class') || '')
		|| element.getAttribute('role') === 'tooltip';
}

/** Read only a short leaf's own text. Ancestor textContent can concatenate
 * most of the Library, so it must never be part of this tooltip check. */
function shortLeafText(element: HTMLElement): string | null {
	if (element.childElementCount > 0) return null;
	let text = '';
	for (let node = element.firstChild; node; node = node.nextSibling) {
		if (node.nodeType !== 3) continue;
		const value = node.nodeValue || '';
		if (text.length + value.length > MAX_LABEL_LENGTH) return null;
		text += value;
	}
	return normalizedText(text);
}

function containsOnlyChild(parent: HTMLElement, child: HTMLElement): boolean {
	if (parent.childElementCount !== 1 || parent.firstElementChild !== child) return false;
	for (let node = parent.firstChild; node; node = node.nextSibling) {
		if (node === child) continue;
		if (node.nodeType !== 3 || (node.nodeValue || '').trim()) return false;
	}
	return true;
}

function hideFeedback(element: HTMLElement, doc: Document, state: CopiedFeedbackState): void {
	if (element.closest(INTERACTIVE_SELECTOR)) return;
	let target = element;
	for (let depth = 0; depth < 3; depth++) {
		const parent = target.parentElement;
		if (!parent || parent === doc.body || !isCandidate(parent)
			|| parent.matches(INTERACTIVE_SELECTOR) || !containsOnlyChild(parent, target)) break;
		target = parent;
	}
	const now = Date.now();
	if ((state.confirmed.get(target) || 0) > now || state.copyPendingUntil > now) {
		if ((state.confirmed.get(target) || 0) <= now) {
			state.copyPendingUntil = 0;
			state.confirmed.set(target, now + COPY_FEEDBACK_MS);
		}
		const previous = state.hiddenStyles.get(target);
		if (previous) {
			for (const [name, value, priority] of previous) {
				if (value) target.style.setProperty(name, value, priority);
				else target.style.removeProperty(name);
			}
			state.hiddenStyles.delete(target);
		}
		return;
	}
	if (!state.hiddenStyles.has(target)) state.hiddenStyles.set(target,
		['display', 'visibility', 'opacity', 'pointer-events'].map(name =>
			[name, target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]));
	for (const [name, value] of [
		['display', 'none'], ['visibility', 'hidden'], ['opacity', '0'], ['pointer-events', 'none'],
	]) {
		if (target.style.getPropertyValue(name) !== value || target.style.getPropertyPriority(name) !== 'important') {
			target.style.setProperty(name, value, 'important');
		}
	}
}

/** Observe actual copy requests without reading or writing the clipboard. A
 * single copy permits one confirmation; a rerender cannot replay that credit. */
function trackCopies(doc: Document, state: CopiedFeedbackState): () => void {
	const onCopy = (): void => { if (!state.disposed) state.copyPendingUntil = Date.now() + COPY_FEEDBACK_MS; };
	doc.addEventListener('copy', onCopy, true);
	let releaseClipboard = (): void => {};
	try {
		const clipboard = doc.defaultView?.navigator.clipboard;
		const original = clipboard?.writeText;
		if (clipboard && typeof original === 'function') {
			const descriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
			const wrapped: typeof original = function (this: Clipboard, ...args) {
				const result = original.apply(this, args);
				onCopy();
				return result;
			};
			Object.defineProperty(clipboard, 'writeText', { configurable: true, writable: true,
				enumerable: descriptor?.enumerable ?? false, value: wrapped });
			releaseClipboard = () => {
				if (clipboard.writeText !== wrapped) return;
				if (descriptor) Object.defineProperty(clipboard, 'writeText', descriptor);
				else delete (clipboard as Partial<Clipboard>).writeText;
			};
		}
	} catch {}
	return () => { doc.removeEventListener('copy', onCopy, true); try { releaseClipboard(); } catch {} };
}

/** Steam inserts the small confirmation portal directly into body. Process its
 * short single-child wrapper before paint, without walking the Library tree. */
function checkAddedFeedback(root: HTMLElement, doc: Document, state: CopiedFeedbackState): void {
	let element: HTMLElement | null = root;
	for (let depth = 0; element && depth < 4; depth++) {
		if (element.childElementCount === 0) {
			if (isCandidate(element)) {
				const text = shortLeafText(element);
				if (text && labelsFor(state).has(text)) hideFeedback(element, doc, state);
			}
			return;
		}
		element = element.childElementCount === 1 ? element.firstElementChild as HTMLElement : null;
	}
}

function labelsFor(state: CopiedFeedbackState): Set<string> {
	const language = steamLanguageSync() || 'english';
	if (state.language !== language || state.labels.size === 0) {
		state.language = language;
		state.labels = new Set([
			'copied!', 'copied', '¡copiado!', 'copiado!', 'copiado',
			officialSteamText('Copied!'), officialSteamText('Copied'),
		].map(normalizedText).filter(Boolean));
	}
	return state.labels;
}

function scheduleSlice(doc: Document, state: CopiedFeedbackState): void {
	const view = doc.defaultView;
	if (!view || view.closed || state.disposed || state.frame !== null || state.timer !== null || state.queue.length === 0) return;
	const run = (): void => {
		state.timer = null;
		if (state.disposed || view.closed) return;
		const labels = labelsFor(state);
		const startedAt = view.performance?.now() ?? Date.now();
		let visited = 0;
		while (state.queue.length > 0 && visited < MAX_NODES_PER_SLICE) {
			const work = state.queue[0];
			if (!work.root.isConnected) {
				state.queue.shift(); state.queuedRoots.delete(work.root);
				continue;
			}
			let element: HTMLElement | null;
			if (!work.started) {
				work.started = true;
				work.walker = doc.createTreeWalker(work.root, 1);
				element = work.root;
			} else element = work.walker?.nextNode() as HTMLElement | null;
			if (!element) {
				state.queue.shift(); state.queuedRoots.delete(work.root);
				continue;
			}
			visited++;
			if (isCandidate(element) && !element.closest(INTERACTIVE_SELECTOR)) {
				const text = shortLeafText(element);
				if (text && labels.has(text)) hideFeedback(element, doc, state);
			}
			if (visited % 16 === 0 && (view.performance?.now() ?? Date.now()) - startedAt >= MAX_SLICE_MS) break;
		}
		scheduleSlice(doc, state);
	};
	if (typeof view.requestAnimationFrame === 'function') {
		state.frame = view.requestAnimationFrame(() => {
			state.frame = null;
			if (!state.disposed) state.timer = view.setTimeout(run, 0);
		});
	} else state.timer = view.setTimeout(run, 0);
}

/** Handle small added feedback before paint; defer larger discovery in bounded
 * slices. An empty image insertion never launches a document-wide walk. */
export function scheduleCopiedFeedbackCleanup(doc: Document, roots?: Iterable<Node>): void {
	if (!doc.body || !doc.defaultView || doc.defaultView.closed) return;
	let state = states.get(doc);
	if (!state) {
		state = { initialScheduled: false, queue: [], queuedRoots: new Set(), frame: null,
			timer: null, language: '', labels: new Set(), disposed: false, copyPendingUntil: 0,
			confirmed: new WeakMap(), hiddenStyles: new WeakMap(), releaseCopyTracking: () => {} };
		states.set(doc, state);
		state.releaseCopyTracking = trackCopies(doc, state);
	}
	const initial = roots === undefined;
	if (initial) {
		if (state.initialScheduled) return;
		state.initialScheduled = true;
		roots = [doc.body];
	}
	for (const node of roots || []) {
		const element = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
		if (!element?.isConnected || element.ownerDocument !== doc || state.queuedRoots.has(element)) continue;
		if (element.childElementCount === 0 && !isCandidate(element)) continue;
		if (!initial) checkAddedFeedback(element, doc, state);
		state.queuedRoots.add(element);
		const work: ScanWork = { root: element, walker: null, started: false };
		if (initial) state.queue.push(work);
		else state.queue.unshift(work);
	}
	scheduleSlice(doc, state);
}

/** Release deferred scans when a Steam document is retired or the plugin unloads. */
export function disposeCopiedFeedbackCleanup(doc: Document): void {
	const state = states.get(doc);
	if (!state) return;
	state.disposed = true;
	state.releaseCopyTracking();
	const view = doc.defaultView;
	if (state.frame !== null) view?.cancelAnimationFrame(state.frame);
	if (state.timer !== null) view?.clearTimeout(state.timer);
	state.queue.length = 0;
	state.queuedRoots.clear();
	states.delete(doc);
}
