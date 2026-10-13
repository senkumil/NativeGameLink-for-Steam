import { isLibrarySidebarNode } from './library-sidebar';

const QUIET_MS = 180;
const MAX_PENDING_KEYS = 16;
type Work = () => void | Promise<void>;
type PendingWork = { task: Work; promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
type Interaction = {
	doc: Document; view: Window; until: number; timer: number | null;
	pending: Map<string, PendingWork>; disposed: boolean; dispose: () => void;
};
const interactions = new WeakMap<Document, Interaction>();
const primaryDocuments = new Set<Document>();

/** Background services run in Millennium's frame, while the list belongs to
 * SP Desktop. Resolve the adopted desktop document without scanning its DOM. */
export function findLibrarySidebarDocument(view?: Window): Document | null {
	const candidates = new Set<Window>();
	if (view) {
		candidates.add(view);
		try { if (view.parent) candidates.add(view.parent); if (view.top) candidates.add(view.top); } catch {}
	}
	for (const candidate of candidates) {
		try { if (primaryDocuments.has(candidate.document)) return candidate.document; } catch {}
	}
	const visible: Document[] = [];
	for (const doc of primaryDocuments) {
		if (!doc.defaultView || doc.defaultView.closed) { primaryDocuments.delete(doc); continue; }
		if (!doc.hidden) visible.push(doc);
	}
	return visible.length === 1 ? visible[0] : null;
}

export function isLibrarySidebarInteractionActive(doc: Document): boolean {
	const state = interactions.get(doc);
	return Boolean(state && !state.disposed && !state.view.closed && !doc.hidden && Date.now() < state.until);
}

function start(work: PendingWork): void {
	try { Promise.resolve(work.task()).then(work.resolve, work.reject); }
	catch (error) { work.reject(error); }
}

/** Keep optional content work out of Steam's virtual list scroll frames.
 * Native images and the synchronous playbar do not use this queue. */
export function installLibrarySidebarInteraction(doc: Document, primary = false): () => void {
	if (primary) {
		primaryDocuments.add(doc);
		while (primaryDocuments.size > 16) primaryDocuments.delete(primaryDocuments.values().next().value!);
	}
	const existing = interactions.get(doc);
	if (existing) return existing.dispose;
	const view = doc.defaultView;
	if (!view || view.closed) return () => {};
	const state: Interaction = { doc, view, until: 0, timer: null, pending: new Map(), disposed: false, dispose: () => {} };
	const flush = (): void => {
		state.timer = null;
		if (state.disposed) return;
		if (view.closed || doc.defaultView !== view || (view.document && view.document !== doc)) { state.dispose(); return; }
		if (doc.hidden) { cancelLibrarySidebarWork(doc); state.until = 0; return; }
		const remaining = state.until - Date.now();
		if (remaining > 0) { state.timer = view.setTimeout(flush, remaining); return; }
		const pending = Array.from(state.pending.values());
		state.pending.clear();
		for (const work of pending) start(work);
	};
	const touch = (event: Event): void => {
		if (state.disposed || !isLibrarySidebarNode(event.target)) return;
		state.until = Date.now() + QUIET_MS;
		if (state.timer !== null) view.clearTimeout(state.timer);
		state.timer = view.setTimeout(flush, QUIET_MS);
	};
	for (const event of ['wheel', 'scroll', 'touchmove']) doc.addEventListener(event, touch, { capture: true, passive: true });
	state.dispose = (): void => {
		if (state.disposed) return;
		state.disposed = true;
		if (state.timer !== null) view.clearTimeout(state.timer);
		state.timer = null;
		for (const event of ['wheel', 'scroll', 'touchmove']) doc.removeEventListener(event, touch, true);
		for (const work of state.pending.values()) work.resolve();
		state.pending.clear();
		interactions.delete(doc);
		primaryDocuments.delete(doc);
	};
	interactions.set(doc, state);
	return state.dispose;
}

/** Coalesce by surface, retaining one latest callback and one shared promise.
 * Without sidebar interaction, there is no artificial wait. */
export function runWhenLibrarySidebarIdle(doc: Document, key: string, task: Work): Promise<void> {
	if (doc.defaultView?.closed || doc.hidden) return Promise.resolve();
	installLibrarySidebarInteraction(doc);
	const state = interactions.get(doc);
	if (!state || state.disposed || Date.now() >= state.until) {
		try { return Promise.resolve(task()); } catch (error) { return Promise.reject(error); }
	}
	const previous = state.pending.get(key);
	if (previous) { previous.task = task; return previous.promise; }
	let resolve!: () => void, reject!: (error: unknown) => void;
	const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
	if (state.pending.size >= MAX_PENDING_KEYS) {
		const oldest = state.pending.keys().next().value!;
		state.pending.get(oldest)?.resolve(); state.pending.delete(oldest);
	}
	state.pending.set(key, { task, promise, resolve, reject });
	return promise;
}

/** Cancel queued work on navigation; scrolling itself can continue normally. */
export function cancelLibrarySidebarWork(doc: Document, key?: string): void {
	const state = interactions.get(doc);
	if (!state) return;
	for (const [id, work] of state.pending) {
		if (key !== undefined && id !== key) continue;
		state.pending.delete(id); work.resolve();
	}
}
