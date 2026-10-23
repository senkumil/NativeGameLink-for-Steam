import type { SteamCommunityBadgeAsset, SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { steamWebpackRuntime } from '../modules/SteamWebpackRuntime';

type Listener = (value: SteamCommunityItemsCatalog) => void;
type Reaction = (read: () => unknown, changed: () => void) => () => void;
interface Entry {
	appid: number;
	language: string;
	snapshot: SteamCommunityItemsCatalog | null;
	listeners: Set<Listener>;
	request: Promise<SteamCommunityItemsCatalog | null> | null;
	cancel: (() => void) | null;
	observe: (() => void) | null;
	confirmedEmpty: boolean;
}
interface State {
	identity: object | null;
	count: number;
	discoveryRequire: unknown;
	nextDiscoveryAt: number;
	store: any;
	reaction: Reaction | null;
	entries: Map<string, Entry>;
	closed: boolean;
	dispose: () => void;
}
const states = new WeakMap<Document, State>();
const retiredDocuments = new WeakSet<Document>();
const DEADLINE_MS = 8_000;
const MAX_ENTRIES = 64;
const ITEM_CDN = 'https://shared.fastly.steamstatic.com/community_assets/images/items/';
const ECONOMY_CDN = 'https://community.cloudflare.steamstatic.com/economy/image/';

function live(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc);
}
function imageUrl(raw: unknown, appid: number, economy = false): string {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return '';
	if (/^(?:https?:)?\/\//i.test(value)) {
		try {
			const url = new URL(value.startsWith('//') ? 'https:' + value : value);
			if (!['steamstatic.com', 'steamcommunity.com', 'steamusercontent.com', 'akamaihd.net']
				.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
			url.protocol = 'https:';
			return url.toString();
		} catch { return ''; }
	}
	if (economy) return /^[A-Za-z0-9_-]+$/.test(value) ? ECONOMY_CDN + value : '';
	return /^[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..') ? ITEM_CDN + appid + '/' + value : '';
}
function translated(value: unknown, language: string, fallback: string): string {
	if (typeof value === 'string') return value.trim() || fallback;
	if (value && typeof value === 'object') {
		const names = value as Record<string, unknown>;
		for (const candidate of [names[language], names.english, ...Object.values(names)]) {
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
	}
	return fallback;
}

/** Quest definitions contain both composed card borders and every badge level,
 * independently of ownership. This does not read or alter Steam inventory. */
export function communityItemDefinitionsCatalog(appid: number, definitions: unknown, language = 'english'): SteamCommunityItemsCatalog | null {
	if (!Number.isSafeInteger(appid) || appid <= 0 || !Array.isArray(definitions)) return null;
	const cards: SteamCommunityCardAsset[] = [], foil: SteamCommunityCardAsset[] = [], badges: SteamCommunityBadgeAsset[] = [];
	const seen = new Set<string>();
	for (const item of definitions) {
		if (!item || typeof item !== 'object' || item.deleted === true || item.active === false
			|| (item.appid != null && Number(item.appid) !== appid)) continue;
		const title = String(item.item_title || item.item_name || item.item_internal_name || '').trim();
		if (Number(item.item_class) === 2) {
			const artwork = imageUrl(item.item_image_large, appid);
			for (const [isFoil, raw] of [[false, item.item_image_composed], [true, item.item_image_composed_foil]] as const) {
				const image = imageUrl(raw, appid, true), key = `${isFoil}:${image}`;
				if (!image || seen.has(key)) continue;
				seen.add(key);
				(isFoil ? foil : cards).push({ title, image, artwork: artwork || undefined, foil: isFoil });
			}
		} else if (Number(item.item_class) === 1) {
			let values: any = item.item_key_values;
			try { if (typeof values === 'string') values = JSON.parse(values); } catch { continue; }
			if (!values || typeof values !== 'object' || !values.level_images || typeof values.level_images !== 'object') continue;
			for (const [key, raw] of Object.entries(values.level_images)) {
				const isFoil = key.toLowerCase() === 'foil', level = isFoil ? 0 : Number(key);
				if (!isFoil && (!Number.isSafeInteger(level) || level < 1)) continue;
				const image = imageUrl(raw, appid), id = `badge:${isFoil}:${level}:${image}`;
				if (!image || seen.has(id)) continue;
				seen.add(id);
				badges.push({ title: translated(values.level_names?.[key], language, title), image, foil: isFoil, level });
			}
		}
	}
	return { appid, cards, foil_cards: foil, badges, foil_badge: badges.find(badge => badge.foil) || null,
		source: 'steam-client-community-definitions', cards_complete: true, badges_complete: true };
}

function retire(state: State): void {
	if (state.closed) return;
	state.closed = true;
	for (const entry of state.entries.values()) {
		entry.cancel?.(); entry.observe?.(); entry.observe = null; entry.listeners.clear();
	}
	state.entries.clear();
	state.dispose();
}
function ownerState(doc: Document): State | null {
	if (retiredDocuments.has(doc)) return null;
	if (!live(doc)) { const old = states.get(doc); if (old) retire(old); return null; }
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	let state = states.get(doc);
	if (state && state.identity === identity && !state.closed) return state;
	if (state) retire(state);
	state = { identity, count: -1, discoveryRequire: null, nextDiscoveryAt: 0,
		store: null, reaction: null, entries: new Map(), closed: false, dispose: () => {} };
	const created = state, view = doc.defaultView!;
	const close = () => { retiredDocuments.add(doc); retire(created); };
	view.addEventListener('pagehide', close, { once: true });
	state.dispose = () => view.removeEventListener('pagehide', close);
	states.set(doc, state);
	return state;
}
function current(doc: Document, state: State): boolean {
	if (!state.closed && live(doc) && states.get(doc) === state
		&& steamWebpackRuntime.getRuntimeIdentity(doc) === state.identity) return true;
	retire(state); return false;
}
function discover(doc: Document, state: State): any | null {
	const globalStore = (doc.defaultView as any)?.badgeStore;
	if (typeof globalStore?.GetCommunityItemDefinitions === 'function' && state.store !== globalStore) {
		state.store = globalStore; state.nextDiscoveryAt = 0;
	}
	const count = steamWebpackRuntime.getModuleFactoryCount(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	// A factory count can be visible before require/store initialization. Cache
	// successes and briefly cache misses; a new require/count/global bypasses
	// the cooldown immediately without rescanning every factory per mutation.
	if (state.count === count && state.discoveryRequire === req
		&& ((state.store && state.reaction) || state.nextDiscoveryAt > Date.now())) return state.store;
	state.count = count; state.discoveryRequire = req; state.nextDiscoveryAt = Date.now() + 1_000;
	if (!req) return state.store;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		if (req.m?.[id] !== factory) continue;
		const source = String(factory);
		try {
			if (!state.store && ['m_mapCommunityItemDefs', 'GetCommunityItemDefinitions(', 'SteamIDBadgeInfo'].every(token => source.includes(token))) {
				state.store = Object.values(req(Number(id)) || {}).find((value: any) => typeof value?.GetCommunityItemDefinitions === 'function') || null;
			}
			if (!state.reaction && ['enforceActions', 'compareStructural', 'fireImmediately'].every(token => source.includes(token))) {
				state.reaction = Object.values(req(Number(id)) || {}).find(value => typeof value === 'function'
					&& ['compareStructural', 'fireImmediately'].every(token => String(value).includes(token))) as Reaction || null;
			}
		} catch (error) { backendLog('Native community definitions discovery failed: ' + error); }
		if (state.store && state.reaction) break;
	}
	return state.store;
}
function getEntry(doc: Document, appid: string, language: string): { state: State; entry: Entry; store: any } | null {
	if (!/^[1-9]\d*$/.test(appid) || !Number.isSafeInteger(Number(appid))) return null;
	const state = ownerState(doc);
	if (!state) return null;
	const store = discover(doc, state), key = appid + ':' + language;
	let entry = state.entries.get(key);
	if (entry) { state.entries.delete(key); state.entries.set(key, entry); }
	else {
		while (state.entries.size >= MAX_ENTRIES) {
			const idle = [...state.entries].find(([, value]) => !value.request && !value.listeners.size);
			if (!idle) return null;
			idle[1].observe?.(); state.entries.delete(idle[0]);
		}
		entry = { appid: Number(appid), language, snapshot: null, listeners: new Set(), request: null,
			cancel: null, observe: null, confirmedEmpty: false };
		state.entries.set(key, entry);
	}
	// A subscriber may have arrived before the native store/MobX was ready.
	// A later foreground read must attach its previously unavailable observer.
	if (entry.listeners.size || entry.request) observe(doc, state, entry, store);
	return { state, entry, store };
}
function snapshot(doc: Document, state: State, entry: Entry, store: any): SteamCommunityItemsCatalog | null {
	if (!current(doc, state)) return null;
	const definitions = store?.m_mapCommunityItemDefs?.get?.(entry.appid);
	// Steam installs [] before its asynchronous load. Absence and that pending
	// sentinel are not proof that a game has no cards or badge definitions.
	if (!Array.isArray(definitions) || (!definitions.length && !entry.confirmedEmpty)) return entry.snapshot;
	if (definitions.length) entry.confirmedEmpty = false;
	const value = communityItemDefinitionsCatalog(entry.appid, definitions, entry.language);
	if (JSON.stringify(value) === JSON.stringify(entry.snapshot)) return entry.snapshot;
	entry.snapshot = value;
	if (value) for (const listener of [...entry.listeners]) {
		try { listener(value); } catch (error) { backendLog('Native community definitions subscriber failed: ' + error); }
	}
	return value;
}
function observe(doc: Document, state: State, entry: Entry, store: any): void {
	if (entry.observe || !state.reaction || !store?.m_mapCommunityItemDefs?.get) return;
	entry.observe = state.reaction(() => store.m_mapCommunityItemDefs.get(entry.appid), () => {
		if (current(doc, state)) {
			snapshot(doc, state, entry, store);
		}
	});
}
function releaseObservation(entry: Entry): void {
	if (!entry.request && !entry.listeners.size) { entry.observe?.(); entry.observe = null; }
}

export function getImmediateNativeCommunityItemDefinitions(doc: Document, appid: string, language = 'english'): SteamCommunityItemsCatalog | null {
	const context = getEntry(doc, appid, language);
	return context ? snapshot(doc, context.state, context.entry, context.store) : null;
}
export function subscribeNativeCommunityItemDefinitions(doc: Document, appid: string, listener: Listener, language = 'english'): () => void {
	const context = getEntry(doc, appid, language);
	if (!context) return () => {};
	const { state, entry, store } = context;
	entry.listeners.add(listener);
	observe(doc, state, entry, store);
	return () => { entry.listeners.delete(listener); releaseObservation(entry); };
}
export function loadNativeCommunityItemDefinitions(doc: Document, appid: string, language = 'english'): Promise<SteamCommunityItemsCatalog | null> {
	const context = getEntry(doc, appid, language);
	if (!context) return Promise.resolve(null);
	const { state, entry, store } = context;
	const immediate = snapshot(doc, state, entry, store);
	if (immediate) return Promise.resolve(immediate);
	if (entry.request) return entry.request;
	if (typeof store?.FetchCommunityItemDefinitions !== 'function') return Promise.resolve(null);
	observe(doc, state, entry, store);
	const before = store.m_mapCommunityItemDefs?.get?.(entry.appid);
	let finish!: (value: SteamCommunityItemsCatalog | null) => void;
	const task = new Promise<SteamCommunityItemsCatalog | null>(resolve => { finish = resolve; });
	entry.request = task;
	let settled = false;
	const timer = setTimeout(() => done(null), DEADLINE_MS);
	const done = (value: SteamCommunityItemsCatalog | null) => {
		if (settled) return;
		settled = true; clearTimeout(timer); entry.cancel = null;
		entry.listeners.delete(firstReady);
		if (entry.request === task) entry.request = null;
		releaseObservation(entry); finish(value);
	};
	const firstReady: Listener = value => done(value);
	entry.listeners.add(firstReady);
	entry.cancel = () => done(null);
	void Promise.resolve().then(() => store.FetchCommunityItemDefinitions(entry.appid)).then(() => {
		if (!current(doc, state)) return done(null);
		const definitions = store.m_mapCommunityItemDefs?.get?.(entry.appid);
		if (Array.isArray(definitions) && definitions !== before) entry.confirmedEmpty = definitions.length === 0;
		done(snapshot(doc, state, entry, store));
	}).catch(error => {
		if (current(doc, state)) backendLog('Native community definitions fetch failed: ' + error);
		done(null);
	});
	return task;
}
