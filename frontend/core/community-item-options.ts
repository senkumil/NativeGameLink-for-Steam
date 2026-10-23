import { getGameCommunityItemOptionsBackend, setGameCommunityItemOptionsBackend } from '../api/backend';

export interface CommunityItemOptions {
	enabled: boolean;
	card_border: 'normal' | 'foil';
	card_ids: string[];
	badge_id: string | null;
	/** Default for an uncustomized link; resolves against progressive definitions. */
	auto_foil?: true;
}
interface Entry {
	confirmed: CommunityItemOptions | null;
	persisted: CommunityItemOptions | null;
	load: Promise<CommunityItemOptions> | null;
	tail: Promise<void>;
	revision: number;
	intent: number;
	pending: number;
}
interface Envelope {
	version: 1;
	shortcut_app_id: string;
	steam_app_id: string;
	options: CommunityItemOptions;
}
const STORAGE_PREFIX = 'gdl:community_item_options_v1:';
const CHANGE_EVENT = 'gdl:community-item-options-changed';
const MAX_ENTRIES = 64;
const SETTINGS_READ_TIMEOUT_MS = 8000;
let documents = new WeakMap<Document, Map<string, Entry>>();
let generation = 0;
const defaults = (): CommunityItemOptions => ({ enabled: true, card_border: 'foil', card_ids: [], badge_id: null, auto_foil: true });
const copy = (value: CommunityItemOptions): CommunityItemOptions => ({ ...value, card_ids: [...value.card_ids] });
const signature = (value: CommunityItemOptions | null): string => JSON.stringify(value);

/** A lost CEF reply must not pin the shared read forever. Only the bounded
 * promise may confirm a read, so a reply after its deadline cannot undo a retry. */
function readWithDeadline<T>(doc: Document, request: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const view = doc.defaultView;
		const finish = (done: () => void): void => {
			if (settled) return;
			settled = true; clearTimeout(timer); view?.removeEventListener('pagehide', retired); done();
		};
		const retired = () => finish(() => reject(new Error('Community item settings document was replaced')));
		const timer = setTimeout(() => finish(() => reject(new Error('Community item settings read timed out'))), SETTINGS_READ_TIMEOUT_MS);
		view?.addEventListener('pagehide', retired);
		request.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
	});
}

function canonicalAssetPath(path: string): string {
	// Steam serves the same community item hash through these two official
	// routes. Keep the legacy identity so cached selections survive SDK data.
	return path.replace(/^\/community_assets\/images\/items\/(?=\d+\/)/, '/steamcommunity/public/images/items/');
}
function canonicalItemId(id: string): string {
	return id.replace(/^((?:badge:(?:normal|foil):\d+|card:(?:normal|foil)):)(\/.*)$/, (_, prefix, path) => prefix + canonicalAssetPath(path))
		.replace(/^badge:foil:\d+:/, 'badge:foil:0:');
}
function assetPath(image: string): string {
	try {
		const url = new URL(image);
		if (!['https:', 'http:'].includes(url.protocol)) return '';
		return canonicalAssetPath(url.pathname).replace(/\/(?:\d+fx\d+f|\d+x\d+)\/?$/i, '');
	} catch { return ''; }
}
/** CDN hosts and thumbnail resolutions are not item identity. */
export function communityCardId(card: { image: string; foil?: boolean }): string {
	const path = assetPath(card.image);
	return path ? `card:${card.foil ? 'foil' : 'normal'}:${path}` : '';
}
export function communityBadgeId(badge: { image: string; foil?: boolean; level?: number }): string {
	const path = assetPath(badge.image), rawLevel = Number(badge.level);
	// The single foil level is encoded as 0 by native definitions and as 1 by
	// some public badge pages. Switching sources must not lose a saved badge.
	const level = badge.foil ? 0 : Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 0;
	return path ? `badge:${badge.foil ? 'foil' : 'normal'}:${level}:${path}` : '';
}
function scope(shortcut: string, steam: string): string {
	if (!/^[1-9]\d{0,19}$/.test(shortcut) || !/^[1-9]\d{0,19}$/.test(steam)) throw new Error('Invalid community item settings scope');
	return `${shortcut}:${steam}`;
}
function validItemId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
}
function normalize(raw: unknown): CommunityItemOptions {
	const value = raw as Partial<CommunityItemOptions> | null;
	if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean'
		|| (value.card_border !== 'normal' && value.card_border !== 'foil') || !Array.isArray(value.card_ids)
		|| value.card_ids.length > 512 || !value.card_ids.every(validItemId)
		|| !(value.badge_id === null || validItemId(value.badge_id))) {
		throw new Error('Invalid community item settings');
	}
	if (value.auto_foil !== undefined && typeof value.auto_foil !== 'boolean'
		|| value.auto_foil === true && (!value.enabled || value.card_border !== 'foil')) {
		throw new Error('Invalid automatic foil settings');
	}
	return { enabled: value.enabled, card_border: value.card_border as 'normal' | 'foil',
		card_ids: [...new Set(value.card_ids.map(canonicalItemId))], badge_id: value.badge_id === null ? null : canonicalItemId(value.badge_id),
		...(value.auto_foil === true ? { auto_foil: true as const } : {}) };
}
function response(raw: unknown): CommunityItemOptions {
	let value: any = raw;
	for (let depth = 0; depth < 2 && typeof value === 'string'; depth++) value = JSON.parse(value);
	if (!value || value.ok !== true || value.error) throw new Error(String(value?.error || 'Community item settings request failed'));
	// Lua encodes an empty table as {}, and omits nil fields. These are the
	// only alternate wire shapes accepted; nonempty objects remain invalid.
	const ids = value.card_ids && typeof value.card_ids === 'object' && !Array.isArray(value.card_ids)
		&& Object.keys(value.card_ids).length === 0 ? [] : value.card_ids;
	return normalize({ ...value, card_ids: ids, badge_id: value.badge_id === undefined ? null : value.badge_id });
}
function envelope(raw: unknown, shortcut: string, steam: string): CommunityItemOptions | null {
	try {
		const value: Envelope = typeof raw === 'string' ? JSON.parse(raw) : raw as Envelope;
		if (value?.version !== 1 || value.shortcut_app_id !== shortcut || value.steam_app_id !== steam) return null;
		return normalize(value.options);
	} catch { return null; }
}
function live(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc);
}
function storageSnapshot(doc: Document, key: string): string | null | undefined {
	try { return doc.defaultView!.localStorage.getItem(STORAGE_PREFIX + key); } catch { return undefined; }
}
function entryFor(doc: Document, shortcut: string, steam: string): Entry {
	const key = scope(shortcut, steam);
	if (!live(doc)) throw new Error('Community item settings document was replaced');
	let entries = documents.get(doc);
	if (!entries) { entries = new Map(); documents.set(doc, entries); }
	const existing = entries.get(key);
	if (existing) { entries.delete(key); entries.set(key, existing); return existing; }
	while (entries.size >= MAX_ENTRIES) {
		const idle = [...entries].find(([, entry]) => entry.pending === 0 && !entry.load);
		if (!idle) throw new Error('Too many pending community item settings requests');
		entries.delete(idle[0]);
	}
	let stored: CommunityItemOptions | null = null;
	try { stored = envelope(doc.defaultView!.localStorage.getItem(STORAGE_PREFIX + key), shortcut, steam); } catch {}
	const entry: Entry = { confirmed: stored, persisted: stored, load: null, tail: Promise.resolve(), revision: 0, intent: 0, pending: 0 };
	entries.set(key, entry);
	return entry;
}
function current(doc: Document, key: string, entry: Entry, epoch: number): boolean {
	return generation === epoch && live(doc) && documents.get(doc)?.get(key) === entry;
}
function commit(doc: Document, shortcut: string, steam: string, entry: Entry, value: CommunityItemOptions): void {
	const changed = signature(entry.confirmed) !== signature(value);
	entry.confirmed = copy(value);
	entry.persisted = copy(value);
	if (!changed) return;
	const payload: Envelope = { version: 1, shortcut_app_id: shortcut, steam_app_id: steam, options: copy(value) };
	try { doc.defaultView!.localStorage.setItem(STORAGE_PREFIX + scope(shortcut, steam), JSON.stringify(payload)); } catch {}
	const EventClass = (doc.defaultView as any)?.CustomEvent;
	if (typeof EventClass === 'function') doc.defaultView!.dispatchEvent(new EventClass(CHANGE_EVENT, { detail: payload }));
}
export function getCachedCommunityItemOptions(doc: Document, shortcut: string, steam: string): CommunityItemOptions | null {
	try { const value = entryFor(doc, shortcut, steam).confirmed; return value ? copy(value) : null; } catch { return null; }
}
export async function getCommunityItemOptions(doc: Document, shortcut: string, steam: string): Promise<CommunityItemOptions> {
	const key = scope(shortcut, steam), entry = entryFor(doc, shortcut, steam), epoch = generation;
	if (entry.pending) { while (entry.pending) await readWithDeadline(doc, entry.tail); return copy(entry.confirmed || defaults()); }
	if (entry.load) return entry.load;
	const revision = entry.revision, storedBefore = storageSnapshot(doc, key);
	const task = readWithDeadline(doc, Promise.resolve().then(() => getGameCommunityItemOptionsBackend({ request_json: JSON.stringify({ shortcut_app_id: shortcut, steam_app_id: steam }) })))
		.then(async raw => {
			if (!current(doc, key, entry, epoch)) return defaults();
			if (entry.revision !== revision) { while (entry.pending) await readWithDeadline(doc, entry.tail); return copy(entry.confirmed || defaults()); }
			// Another CEF can confirm a save before this window receives its queued
			// storage event. A reply from a read started earlier must not republish
			// its old snapshot over that newer confirmed selection.
			const storedNow = storageSnapshot(doc, key);
			if (storedBefore !== undefined && storedNow !== undefined && storedNow !== storedBefore) {
				const latest = storedNow === null ? defaults() : envelope(storedNow, shortcut, steam);
				if (latest) { commit(doc, shortcut, steam, entry, latest); return copy(latest); }
			}
			const value = response(raw);
			commit(doc, shortcut, steam, entry, value);
			return copy(value);
		}).finally(() => { if (entry.load === task) entry.load = null; });
	entry.load = task;
	return task;
}
export async function setCommunityItemOptions(doc: Document, shortcut: string, steam: string, raw: CommunityItemOptions): Promise<CommunityItemOptions> {
	const value = normalize(raw), key = scope(shortcut, steam), entry = entryFor(doc, shortcut, steam), epoch = generation;
	const intent = ++entry.intent;
	entry.revision++;
	entry.pending++;
	const task = entry.tail.then(async () => {
		if (!current(doc, key, entry, epoch)) throw new Error('Community item settings request was retired');
		try {
			const saved = response(await setGameCommunityItemOptionsBackend({ request_json: JSON.stringify({ shortcut_app_id: shortcut, steam_app_id: steam, ...value }) }));
			if (current(doc, key, entry, epoch)) {
				entry.persisted = copy(saved);
				if (intent === entry.intent) commit(doc, shortcut, steam, entry, saved);
			}
			return copy(saved);
		} catch (error) {
			if (current(doc, key, entry, epoch) && intent === entry.intent && entry.persisted) commit(doc, shortcut, steam, entry, entry.persisted);
			throw error;
		}
	}).finally(() => { entry.pending--; });
	entry.tail = task.then(() => {}, () => {});
	return task;
}
/** Events contain only backend-confirmed local preferences, scoped to one link. */
export function subscribeCommunityItemOptions(doc: Document, shortcut: string, steam: string,
	listener: (options: CommunityItemOptions) => void): () => void {
	const key = scope(shortcut, steam), view = doc.defaultView;
	entryFor(doc, shortcut, steam);
	if (!view) return () => {};
	let disposed = false, previous = signature(getCachedCommunityItemOptions(doc, shortcut, steam));
	const receive = (raw: unknown) => {
		if (disposed || !live(doc)) return;
		const options = envelope(raw, shortcut, steam);
		if (!options) return;
		const entry = entryFor(doc, shortcut, steam);
		if (entry.pending && signature(entry.confirmed) !== signature(options)) return;
		entry.revision++;
		entry.confirmed = copy(options);
		entry.persisted = copy(options);
		const next = signature(options);
		if (previous === next) return;
		previous = next;
		listener(copy(options));
	};
	const custom = (event: Event) => receive((event as CustomEvent).detail);
	const storage = (event: StorageEvent) => {
		if (event.key !== null && event.key !== STORAGE_PREFIX + key) return;
		// Storage events are queued across CEF windows. A previous read or save
		// can arrive after a newer confirmed choice has already replaced it.
		try { if (view.localStorage.getItem(STORAGE_PREFIX + key) !== event.newValue) return; } catch {}
		receive(event.newValue || { version: 1, shortcut_app_id: shortcut, steam_app_id: steam, options: defaults() });
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		view.removeEventListener(CHANGE_EVENT, custom);
		view.removeEventListener('storage', storage);
		view.removeEventListener('pagehide', dispose);
	};
	view.addEventListener(CHANGE_EVENT, custom);
	view.addEventListener('storage', storage);
	view.addEventListener('pagehide', dispose);
	return dispose;
}
/** Retire pending reads and queued writes when the plugin's settings reset. */
export function clearCommunityItemOptions(): void { generation++; documents = new WeakMap(); }
