import { officialSteamText, steamLanguageSync } from '../steam/localization';

const MAX_LABEL_LENGTH = 96;
const MAX_NODES_PER_SLICE = 256;
const MAX_SLICE_MS = 2;
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

function hideFeedback(element: HTMLElement, doc: Document): void {
	if (element.closest(INTERACTIVE_SELECTOR)) return;
	let target = element;
	for (let depth = 0; depth < 3; depth++) {
		const parent = target.parentElement;
		if (!parent || parent === doc.body || !isCandidate(parent)
			|| parent.matches(INTERACTIVE_SELECTOR) || !containsOnlyChild(parent, target)) break;
		target = parent;
	}
	for (const [name, value] of [
		['display', 'none'], ['visibility', 'hidden'], ['opacity', '0'], ['pointer-events', 'none'],
	]) {
		if (target.style.getPropertyValue(name) !== value || target.style.getPropertyPriority(name) !== 'important') {
			target.style.setProperty(name, value, 'important');
		}
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
				if (text && labels.has(text)) hideFeedback(element, doc);
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

/** Defer tooltip cleanup until after a paint. Mutation callers supply only
 * added roots; an empty image insertion never launches a document-wide walk. */
export function scheduleCopiedFeedbackCleanup(doc: Document, roots?: Iterable<Node>): void {
	if (!doc.body || !doc.defaultView || doc.defaultView.closed) return;
	let state = states.get(doc);
	if (!state) {
		state = { initialScheduled: false, queue: [], queuedRoots: new Set(), frame: null,
			timer: null, language: '', labels: new Set(), disposed: false };
		states.set(doc, state);
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
	const view = doc.defaultView;
	if (state.frame !== null) view?.cancelAnimationFrame(state.frame);
	if (state.timer !== null) view?.clearTimeout(state.timer);
	state.queue.length = 0;
	state.queuedRoots.clear();
	states.delete(doc);
}
