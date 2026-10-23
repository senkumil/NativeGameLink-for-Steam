import type { SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import { backendLog, fetchCommunityItemsCatalogBackend, parseCommunityItemsCatalogResponse } from '../../api/backend';
import { CACHE_RETENTION, CACHE_TTL, cacheDeleteMatching, cacheRead, cacheSet } from '../../core/cache';
import { steamLanguageSync } from '../../steam/localization';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { getImmediateNativeCommunityItemDefinitions, loadNativeCommunityItemDefinitions, subscribeNativeCommunityItemDefinitions } from '../../steam/desktop/community-item-definitions';

export function getCachedOfficialCommunityItems(steamAppId: string, language: string):
	{ data: SteamCommunityItemsCatalog; fresh: boolean } | null {
	const entry = cacheRead<SteamCommunityItemsCatalog>(`community_items_v11_${language}_${steamAppId}`,
		CACHE_TTL.communityItems, CACHE_RETENTION.communityItems);
	const data = cleanCommunityItemsCatalog(entry?.data || null);
	return data && (!data.appid || String(data.appid) === steamAppId) ? { data, fresh: Boolean(entry?.fresh) } : null;
}

export function normalizeCommunityAssetUrl(raw: unknown): string {
	let value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return '';
	if (value.startsWith('//')) value = 'https:' + value;
	else if (value.startsWith('/')) value = 'https://steamcommunity.com' + value;
	else if (value.startsWith('http://')) value = 'https://' + value.slice(7);
	else if (value.startsWith('economy/image/')) value = 'https://community.cloudflare.steamstatic.com/' + value;
	else if (/^[-_a-zA-Z0-9]{30,}$/.test(value)) value = 'https://community.cloudflare.steamstatic.com/economy/image/' + value;
	if (!value.startsWith('https://')) return '';
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		if (!host.endsWith('steamstatic.com')
			&& !host.endsWith('steamusercontent.com')
			&& !host.endsWith('steamcommunity.com')
			&& !host.endsWith('akamaihd.net')) return '';
		// Steam appends paths such as /100x100 in low-bandwidth mode.  Keeping
		// that suffix made the card visibly pixelated when its native hover
		// animation enlarged it.  The unsuffixed CDN URL returns the original.
		url.pathname = url.pathname.replace(/\/(?:\d+fx\d+f|\d+x\d+)\/?$/i, '');
		for (const key of ['w', 'h', 'width', 'height']) url.searchParams.delete(key);
		return url.toString();
	} catch { return ''; }
}

function cleanCards(input: SteamCommunityCardAsset[]): SteamCommunityCardAsset[] {
	const seenCards = new Set<string>();
	return (Array.isArray(input) ? input : []).map(card => ({
		title: String(card?.title || '').trim(),
		image: normalizeCommunityAssetUrl(card?.image),
		artwork: normalizeCommunityAssetUrl(card?.artwork),
		foil: card?.foil === true,
	})).filter(card => {
		const key = JSON.stringify([card.title, card.image, card.artwork, card.foil]);
		if (!card.image || seenCards.has(key)) return false;
		seenCards.add(key);
		return true;
	});
}

function cleanCommunityItemsCatalog(raw: SteamCommunityItemsCatalog | null): SteamCommunityItemsCatalog | null {
	if (!raw) return null;
	const cards = cleanCards(raw.cards);
	const foilCards = cleanCards([...(Array.isArray(raw.foil_cards) ? raw.foil_cards : []), ...cards.filter(card => card.foil)]);
	const seenBadges = new Set<string>();
	const badges = (Array.isArray(raw.badges) ? raw.badges : []).map(badge => ({
		title: String(badge?.title || '').trim(),
		image: normalizeCommunityAssetUrl(badge?.image),
		foil: badge?.foil === true,
		level: Number.isFinite(Number(badge?.level)) ? Number(badge?.level) : 0,
	})).filter(badge => {
		const key = badge.image.toLowerCase();
		if (!key || seenBadges.has(key)) return false;
		seenBadges.add(key);
		return true;
	});
	const requestedFoil = raw.foil_badge;
	const foilImage = normalizeCommunityAssetUrl(requestedFoil?.image);
	const foilBadge = foilImage ? {
		title: String(requestedFoil?.title || '').trim(),
		image: foilImage,
		foil: true,
		level: Number.isFinite(Number(requestedFoil?.level)) ? Number(requestedFoil?.level) : 0,
	} : badges.find(badge => badge.foil) || null;
	return {
		appid: Number(raw.appid) || undefined,
		cards,
		foil_cards: foilCards,
		badges,
		foil_badge: foilBadge,
		source: raw.source,
		error: raw.error,
		transient_error: raw.transient_error === true,
		cards_complete: raw.cards_complete === true,
		badges_complete: raw.badges_complete === true,
		loading: raw.loading === true,
	};
}

/** Steam renders its badge response as one set. Never append Market variants
 * to that response: a foil version is a separate badge set, not a missing row.
 * A public catalogue is used only when no account set is available. */
export function mergeCommunityCards(native: SteamCommunityCardAsset[], indexed: SteamCommunityCardAsset[]): SteamCommunityCardAsset[] {
	if (native.length > 0) return [...native];
	const normal = indexed.filter(card => card.foil !== true);
	const selected = normal.length > 0 ? normal : indexed;
	const seen = new Set<string>();
	return selected.filter(card => {
		const key = card.title.trim().toLowerCase() || normalizeCommunityAssetUrl(card.image);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

const nativeSteamBadgeStores = new DocumentRuntimeCache(() => ({ count: -1, require: null as any, nextDiscoveryAt: 0, store: null as any }));

function getNativeSteamBadgeStore(doc: Document): any | null {
	const view = doc.defaultView as any;
	if (!view || view.closed || view.document !== doc) return null;
	const state = nativeSteamBadgeStores.get(doc);
	if (typeof view.badgeStore?.GetBadgeData === 'function') return state.store = view.badgeStore;
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return null;
	const count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (state.count === count && state.require === req && (state.store || state.nextDiscoveryAt > Date.now())) return state.store;
	state.count = count; state.require = req; state.nextDiscoveryAt = Date.now() + 1_000;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		if (req.m?.[id] !== factory || !['m_mapBadgeData', 'GetBadgeData(', 'SteamIDBadgeInfo'].every(token => String(factory).includes(token))) continue;
		try {
			for (const candidate of Object.values(req(Number(id)) || {})) {
				if (typeof (candidate as any)?.GetBadgeData !== 'function') continue;
				return state.store = candidate;
			}
		} catch (error) {
			backendLog('Steam badge-store discovery failed: ' + error);
		}
	}
	return null;
}

/** Read the owner's existing native card model without waiting for HTTP. */
function readNativeSteamCommunityItems(doc: Document, steamAppId: string): SteamCommunityItemsCatalog | null {
	const appid = Number(steamAppId);
	if (!Number.isSafeInteger(appid) || appid <= 0) return null;
	try {
		const badgeData = getNativeSteamBadgeStore(doc)?.GetBadgeData(appid);
		const nativeCards = Array.isArray(badgeData?.rgCards) ? badgeData.rgCards : [];
		if (!nativeCards.length) return null;
		const cards = nativeCards.map((card: any) => ({
			title: String(card?.strTitle || card?.strName || '').trim(),
			image: normalizeCommunityAssetUrl(card?.strImgURL), artwork: normalizeCommunityAssetUrl(card?.strArtworkURL),
			foil: card?.bFoil === true || card?.bIsFoil === true
				|| Number(card?.nCardBorder ?? card?.nBorderColor ?? card?.nBorder ?? 0) === 1
				|| /\bfoil\b/i.test(String(card?.strType || ''))
				|| /\(\s*foil\s*\)\s*$/i.test(String(card?.strMarketHashName || card?.strMarketHash || '')),
		})).filter((card: SteamCommunityCardAsset) => !!card.image);
		const icon = normalizeCommunityAssetUrl(badgeData?.strIconURL);
		return cleanCommunityItemsCatalog({ appid, cards, badges: icon ? [{
			title: String(badgeData?.strName || '').trim(), image: icon, level: Number(badgeData?.nLevel) || 0,
		}] : [], source: 'steam-client-badge-store' });
	} catch (error) { backendLog('Native community items unavailable for ' + steamAppId + ': ' + error); return null; }
}

type CatalogListener = (catalog: SteamCommunityItemsCatalog) => void;
interface CatalogEntry {
	appid: string;
	language: string;
	snapshot: SteamCommunityItemsCatalog | null;
	native: SteamCommunityItemsCatalog | null;
	definitions: SteamCommunityItemsCatalog | null;
	indexed: SteamCommunityItemsCatalog | null;
	listeners: Set<CatalogListener>;
	consumers: number;
	request: Promise<SteamCommunityItemsCatalog | null> | null;
	first: Promise<SteamCommunityItemsCatalog | null> | null;
	expiresAt: number;
	nextAttemptAt: number;
	failed: boolean;
	loading: boolean;
	generation: number;
	epoch: number;
	revision: number;
	cancel: (() => void) | null;
	stopDefinitions: (() => void) | null;
	nativeReady: (() => void) | null;
}
interface CatalogState { identity: object | null; entries: Map<string, CatalogEntry>; closed: boolean }
// A Webpack generation changes native stores, not a mounted consumer's identity.
// Keep subscribers in their document while replacing only the source requests.
const catalogueStates = new WeakMap<Document, CatalogState>();
const retiredDocuments = new WeakSet<Document>();
const activeCatalogues = new Map<CatalogEntry, Document>();
const catalogueRevisions = new Map<string, number>();
let catalogueEpoch = 0;
const REMOTE_DEADLINE_MS = 10_000;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const RETRY_COOLDOWN_MS = 15_000;
function languageName(requested?: string): string {
	return String(requested || (typeof steamLanguageSync === 'function' ? steamLanguageSync() : '') || 'english').toLowerCase();
}
function liveDocument(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc);
}
function hasAssets(value: SteamCommunityItemsCatalog | null): boolean {
	return Boolean(value && (value.cards.length || value.foil_cards?.length || value.badges?.length || value.foil_badge));
}
function completeCatalog(value: SteamCommunityItemsCatalog | null): boolean {
	return Boolean(value?.cards_complete && value.badges_complete && !value.error && !value.transient_error);
}
function cancelEnrichment(entry: CatalogEntry): void {
	entry.generation++;
	const cancel = entry.cancel;
	entry.cancel = null; entry.request = null; entry.first = null; entry.nativeReady = null;
	entry.loading = false; entry.expiresAt = 0; entry.nextAttemptAt = 0;
	cancel?.();
}
function keepObserved(doc: Document, entry: CatalogEntry): void {
	if (!liveDocument(doc) || retiredDocuments.has(doc)) {
		const state = catalogueStates.get(doc); if (state) retireCatalogState(doc, state);
		return;
	}
	if (!entry.consumers && !entry.request) {
		activeCatalogues.delete(entry); entry.stopDefinitions?.(); entry.stopDefinitions = null; return;
	}
	activeCatalogues.set(entry, doc);
	if (!entry.stopDefinitions && typeof subscribeNativeCommunityItemDefinitions === 'function') {
		entry.stopDefinitions = subscribeNativeCommunityItemDefinitions(doc, entry.appid, value => {
			const state = catalogueStates.get(doc);
			if (!state || state.closed || !liveDocument(doc)
				|| state.identity !== steamWebpackRuntime.getRuntimeIdentity(doc)) return;
			const ready = cleanCommunityItemsCatalog(value);
			if (!ready || (ready.appid && String(ready.appid) !== entry.appid)) return;
			entry.definitions = ready;
			if (completeCatalog(ready)) {
				entry.failed = false; entry.nextAttemptAt = 0; entry.expiresAt = Date.now() + CATALOG_TTL_MS; entry.nativeReady?.();
			}
			publish(entry);
			if (completeCatalog(ready) && !entry.request) cacheSet('community_items_v11_' + entry.language + '_' + entry.appid, entry.snapshot);
		}, entry.language);
	}
}
function retireCatalogState(doc: Document, state: CatalogState): void {
	if (state.closed) return;
	state.closed = true; retiredDocuments.add(doc);
	for (const entry of state.entries.values()) {
		cancelEnrichment(entry); entry.stopDefinitions?.(); entry.stopDefinitions = null;
		entry.listeners.clear(); entry.consumers = 0; activeCatalogues.delete(entry);
	}
	state.entries.clear();
}
function stateFor(doc: Document): CatalogState {
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	let state = catalogueStates.get(doc);
	if (!state) {
		state = { identity, entries: new Map(), closed: false };
		catalogueStates.set(doc, state);
		const created = state;
		doc.defaultView?.addEventListener('pagehide', () => {
			retireCatalogState(doc, created);
		}, { once: true });
	} else if (state.identity !== identity) {
		state.identity = identity;
		for (const entry of state.entries.values()) {
			cancelEnrichment(entry); entry.stopDefinitions?.(); entry.stopDefinitions = null;
			entry.native = null; entry.definitions = null;
			// Published definitions remain useful during native-store replacement.
			entry.indexed = entry.snapshot || entry.indexed;
			if (entry.consumers) void Promise.resolve().then(() => {
				if (!state!.closed && entry.consumers) { keepObserved(doc, entry); void startEnrichment(doc, entry, true); }
			});
		}
	}
	return state;
}
function entryFor(doc: Document, appid: string, language: string): CatalogEntry | null {
	if (retiredDocuments.has(doc) || !liveDocument(doc)) {
		const state = catalogueStates.get(doc); if (state) retireCatalogState(doc, state);
		return null;
	}
	if (!/^[1-9]\d*$/.test(appid)) return null;
	const state = stateFor(doc), key = appid + ':' + language;
	const prior = state.entries.get(key);
	if (prior) {
		if (prior.epoch !== catalogueEpoch || prior.revision !== (catalogueRevisions.get(appid) || 0)) {
			cancelEnrichment(prior); prior.epoch = catalogueEpoch; prior.revision = catalogueRevisions.get(appid) || 0;
		}
		state.entries.delete(key); state.entries.set(key, prior); return prior;
	}
	if (state.entries.size >= 64) {
		const idle = [...state.entries].find(([, entry]) => !entry.request && !entry.consumers);
		if (!idle) return null;
		state.entries.delete(idle[0]);
	}
	const cached = getCachedOfficialCommunityItems(appid, language);
	const cachedComplete = completeCatalog(cached?.data || null);
	const entry: CatalogEntry = { appid, language, snapshot: cached?.data || null, native: null, definitions: null,
		indexed: cached?.data || null,
		listeners: new Set(), consumers: 0, request: null, first: null, loading: false,
		generation: 0, epoch: catalogueEpoch, revision: catalogueRevisions.get(appid) || 0, cancel: null, stopDefinitions: null, nativeReady: null,
		expiresAt: cached?.fresh && cachedComplete ? Date.now() + CATALOG_TTL_MS : 0, nextAttemptAt: 0, failed: false };
	state.entries.set(key, entry);
	return entry;
}
function mergeSnapshot(entry: CatalogEntry): SteamCommunityItemsCatalog | null {
	const native = entry.native, definitions = entry.definitions, fallback = entry.indexed;
	const indexed = definitions ? {
		...definitions,
		cards: definitions.cards_complete ? definitions.cards : cleanCards([...(fallback?.cards || []), ...definitions.cards]),
		foil_cards: definitions.cards_complete ? definitions.foil_cards : cleanCards([...(fallback?.foil_cards || []), ...(definitions.foil_cards || [])]),
		badges: definitions.badges_complete ? definitions.badges : [...(fallback?.badges || []), ...(definitions.badges || [])],
		foil_badge: definitions.foil_badge || (definitions.badges_complete ? null : fallback?.foil_badge),
		cards_complete: definitions.cards_complete || fallback?.cards_complete,
		badges_complete: definitions.badges_complete || fallback?.badges_complete,
	} : fallback;
	if (!native && !indexed) return null;
	return cleanCommunityItemsCatalog({ appid: Number(entry.appid),
		cards: mergeCommunityCards(native?.cards || [], indexed?.cards || []),
		foil_cards: indexed?.foil_cards?.length ? indexed.foil_cards : native?.foil_cards || [],
		badges: indexed?.badges?.length ? indexed.badges : native?.badges || [],
		foil_badge: indexed?.foil_badge || native?.foil_badge || null,
		source: native?.cards.length ? 'steam-client+steam-community-assets' : indexed?.source,
		transient_error: entry.failed && !completeCatalog(entry.definitions),
		cards_complete: indexed?.cards_complete,
		badges_complete: indexed?.badges_complete,
		loading: entry.loading,
	});
}
function publish(entry: CatalogEntry): void {
	const snapshot = mergeSnapshot(entry);
	if (!snapshot || JSON.stringify(snapshot) === JSON.stringify(entry.snapshot)) return;
	entry.snapshot = snapshot;
	for (const listener of [...entry.listeners]) {
		try { listener(snapshot); } catch (error) { backendLog('Community catalogue subscriber failed: ' + error); }
	}
}
/** Synchronous cache/native snapshot. Remote definitions never delay a native mount. */
export function getImmediateOfficialCommunityItems(doc: Document, appid: string,
	requestedLanguage?: string): SteamCommunityItemsCatalog | null {
	const entry = entryFor(doc, String(appid), languageName(requestedLanguage));
	if (!entry) return null;
	entry.native = readNativeSteamCommunityItems(doc, String(appid)) || entry.native;
	if (typeof getImmediateNativeCommunityItemDefinitions === 'function') {
		entry.definitions = cleanCommunityItemsCatalog(getImmediateNativeCommunityItemDefinitions(doc, String(appid), entry.language)) || entry.definitions;
	}
	publish(entry);
	return entry.snapshot;
}
/** Subscribe before requesting to receive later badge/foil enrichment. */
export function subscribeOfficialCommunityItems(doc: Document, appid: string, listener: CatalogListener,
	requestedLanguage?: string): () => void {
	const entry = entryFor(doc, String(appid), languageName(requestedLanguage));
	if (!entry) return () => {};
	entry.listeners.add(listener);
	entry.consumers++;
	keepObserved(doc, entry);
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true; entry.listeners.delete(listener);
		entry.consumers = Math.max(0, entry.consumers - 1);
		keepObserved(doc, entry);
		doc.defaultView?.removeEventListener('pagehide', dispose);
	};
	doc.defaultView?.addEventListener('pagehide', dispose);
	return dispose;
}
function startEnrichment(doc: Document, entry: CatalogEntry, refresh: boolean): Promise<SteamCommunityItemsCatalog | null> {
	if (entry.request) return entry.first || entry.request;
	// Foreground renders may retry missing startup sources, but DOM mutations
	// must not create a network loop. Explicit Retry/invalidation bypass this.
	if (!refresh && entry.nextAttemptAt > Date.now() && !completeCatalog(entry.definitions)) return Promise.resolve(entry.snapshot);
	const freshHttpCache = !refresh && entry.expiresAt > Date.now();
	if (freshHttpCache && (completeCatalog(entry.definitions) || typeof loadNativeCommunityItemDefinitions !== 'function')) return Promise.resolve(entry.snapshot);
	const originalExpiry = entry.expiresAt;
	let fetchedRemote = false;
	const state = catalogueStates.get(doc), generation = entry.generation;
	let cancelled = false;
	entry.loading = true; publish(entry);
	const current = () => !cancelled && generation === entry.generation && !state?.closed && liveDocument(doc)
		&& state?.identity === steamWebpackRuntime.getRuntimeIdentity(doc) && catalogueStates.get(doc) === state
		&& state.entries.get(entry.appid + ':' + entry.language) === entry;
	let finishFirst!: (value: SteamCommunityItemsCatalog | null) => void;
	const first = new Promise<SteamCommunityItemsCatalog | null>(resolve => { finishFirst = resolve; });
	entry.first = first;
	const onSnapshot = (value: SteamCommunityItemsCatalog) => { if (hasAssets(value)) finishFirst(value); };
	entry.listeners.add(onSnapshot);
	const native = (async () => {
		if (!getNativeSteamBadgeStore(doc)) return;
		for (let attempt = 0; attempt < 12 && current() && !entry.definitions; attempt++) {
			entry.native = readNativeSteamCommunityItems(doc, entry.appid) || entry.native;
			if (entry.native) { publish(entry); return; }
			await new Promise(resolve => setTimeout(resolve, 75));
		}
	})();
	let cancelRemote!: (value: null) => void;
	const cancelledRequest = new Promise<null>(resolve => { cancelRemote = resolve; });
	const onPageHide = () => { cancelled = true; cancelRemote(null); };
	entry.cancel = () => { onPageHide(); finishFirst(null); };
	entry.nativeReady = () => cancelRemote(null);
	doc.defaultView?.addEventListener('pagehide', onPageHide, { once: true });
	const failedParts = new Set<string>();
	const definitions = typeof loadNativeCommunityItemDefinitions === 'function'
		? Promise.race([cancelledRequest, Promise.resolve().then(() =>
			completeCatalog(entry.definitions) ? entry.definitions : loadNativeCommunityItemDefinitions(doc, entry.appid, entry.language))]).then(value => {
			if (!current()) return;
			const ready = cleanCommunityItemsCatalog(value || null);
			if (!ready?.cards_complete || !ready.badges_complete) return;
			entry.definitions = ready; entry.failed = false; entry.expiresAt = Date.now() + CATALOG_TTL_MS;
			// Native definitions include both borders and every badge. Pending
			// Market/index replies are optional and cannot replace this source.
			cancelRemote(null); publish(entry); finishFirst(entry.snapshot);
		}).catch(error => backendLog('Native community definitions unavailable for ' + entry.appid + ': ' + error))
		: null;
	const loadPart = (part: 'cards' | 'badges') => {
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let active = true;
		const fail = () => {
			if (!current()) return;
			failedParts.add(part); entry.failed = !completeCatalog(entry.definitions); entry.expiresAt = 0; publish(entry);
		};
		const load = async () => {
			let start = 0;
			const retainedCards = entry.indexed?.cards || [];
			const retainedFoil = entry.indexed?.foil_cards || [];
			let loadedCards: SteamCommunityCardAsset[] = [], loadedFoil: SteamCommunityCardAsset[] = [];
			for (let page = 0; page < 16 && active && current(); page++) {
				const raw = await fetchCommunityItemsCatalogBackend({ steam_app_id: entry.appid,
					language: entry.language, catalog_part: part, catalog_start: start });
				if (!active || !current()) return;
				const response = parseCommunityItemsCatalogResponse(raw) as (SteamCommunityItemsCatalog & { next_start?: unknown }) | null;
				const indexed = cleanCommunityItemsCatalog(response);
				const prior = entry.indexed;
				const emptyReplacement = Boolean(indexed && (part === 'cards'
					? response?.next_start == null && !loadedCards.length && !loadedFoil.length && !indexed.cards.length && !indexed.foil_cards?.length
						&& (retainedCards.length || retainedFoil.length)
					: !indexed.badges?.length && !indexed.foil_badge && (prior?.badges?.length || prior?.foil_badge)));
				const failed = !indexed || Boolean(indexed.error || indexed.transient_error) || emptyReplacement
					|| Boolean(indexed.appid && String(indexed.appid) !== entry.appid)
					|| (part === 'cards' ? response?.cards_complete === false && response?.next_start == null : response?.badges_complete === false);
				if (failed) failedParts.add(part);
				entry.failed = failedParts.size > 0 && !completeCatalog(entry.definitions); entry.expiresAt = 0;
				if (indexed && !indexed.error && (!indexed.appid || String(indexed.appid) === entry.appid)) {
					loadedCards = cleanCards([...loadedCards, ...indexed.cards]);
					loadedFoil = cleanCards([...loadedFoil, ...(indexed.foil_cards || [])]);
					const complete = !failed && response?.next_start == null;
					// A refresh may start from a complete set. Keep those known
					// definitions until the replacement finishes every page; a
					// partial page or timeout must never hide selected foil cards.
					entry.indexed = cleanCommunityItemsCatalog({ appid: Number(entry.appid),
						cards: part === 'cards' ? complete ? loadedCards : [...retainedCards, ...loadedCards] : prior?.cards || [],
						foil_cards: part === 'cards' ? complete ? loadedFoil : [...retainedFoil, ...loadedFoil] : prior?.foil_cards || [],
						badges: part === 'badges' ? failed ? [...(prior?.badges || []), ...(indexed.badges || [])] : indexed.badges : prior?.badges || [],
						foil_badge: part === 'badges' && (!failed || indexed.foil_badge) ? indexed.foil_badge : prior?.foil_badge,
						source: part === 'cards' ? indexed.source : prior?.source || indexed.source,
						cards_complete: part === 'cards' ? complete || prior?.cards_complete : prior?.cards_complete,
						badges_complete: part === 'badges' ? !failed || prior?.badges_complete : prior?.badges_complete,
					});
				}
				// Market may return ten rows even when count=100. Publish each
				// page before continuing so the first cards never wait on extras.
				publish(entry);
				if (failed || part !== 'cards' || response?.next_start == null) return;
				const next = Number(response.next_start);
				if (!Number.isSafeInteger(next) || next <= start || next > 512 || page === 15) { fail(); return; }
				start = next;
			}
		};
		return Promise.race([
			cancelledRequest.then(() => 'cancelled'),
			Promise.resolve().then(load).then(() => 'done'),
			new Promise<string>(resolve => { deadline = setTimeout(() => { active = false; resolve('timeout'); }, REMOTE_DEADLINE_MS); }),
		]).then(outcome => {
			if (outcome === 'timeout') fail();
		}).catch(error => {
			if (!current()) return;
			fail();
			backendLog('Community item ' + part + ' catalogue failed for ' + entry.appid + ': ' + error);
		}).finally(() => { active = false; if (deadline) clearTimeout(deadline); });
	};
	// Steam's own cached/CM definitions are primary and do not require owning
	// a card. Give that local path a brief lead before public HTTP fallbacks.
	const remote = (async () => {
		if (definitions) {
			let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([definitions, cancelledRequest, new Promise(resolve => {
				fallbackTimer = setTimeout(resolve, 200);
			})]);
			if (fallbackTimer) clearTimeout(fallbackTimer);
		}
		if (!current() || completeCatalog(entry.definitions) || freshHttpCache) return;
		// Queue cards before optional badge artwork. Neither waits on the other.
		fetchedRemote = true;
		await Promise.allSettled([loadPart('cards'), loadPart('badges')]);
	})().then(() => {
		if (!current()) return;
		entry.failed = failedParts.size > 0 && !completeCatalog(entry.definitions);
		if (completeCatalog(entry.definitions) || fetchedRemote) entry.expiresAt = entry.failed ? 0 : Date.now() + CATALOG_TTL_MS;
		else entry.expiresAt = originalExpiry;
		publish(entry);
	});
	entry.request = Promise.allSettled([native, remote, definitions]).then(() => {
		if (!current()) return null;
		entry.nextAttemptAt = entry.failed || !completeCatalog(entry.definitions) ? Date.now() + RETRY_COOLDOWN_MS : 0;
		entry.loading = false; publish(entry);
		if (!entry.failed && entry.snapshot?.cards_complete && entry.snapshot.badges_complete) {
			if (entry.definitions || fetchedRemote) cacheSet('community_items_v11_' + entry.language + '_' + entry.appid, entry.snapshot);
		}
		return entry.snapshot;
	}).finally(() => {
		doc.defaultView?.removeEventListener('pagehide', onPageHide);
		entry.listeners.delete(onSnapshot);
		finishFirst(current() ? entry.snapshot : null);
		if (generation === entry.generation) { entry.request = null; entry.first = null; entry.cancel = null; entry.nativeReady = null; }
		keepObserved(doc, entry);
	});
	keepObserved(doc, entry);
	return first;
}
/** First available native/cache data returns immediately; definitions hydrate in
 * the background and publish to subscribers. An explicit retry keeps subscribers. */
export async function getOfficialCommunityItems(doc: Document, appid: string, requestedLanguage?: string,
	options: { refresh?: boolean } = {}): Promise<SteamCommunityItemsCatalog | null> {
	const entry = entryFor(doc, String(appid), languageName(requestedLanguage));
	if (!entry) return null;
	const immediate = getImmediateOfficialCommunityItems(doc, String(appid), entry.language);
	const pending = startEnrichment(doc, entry, options.refresh === true);
	if (options.refresh === true) return entry.request || pending;
	return hasAssets(immediate) || entry.expiresAt > Date.now() ? immediate : pending;
}

export function clearCommunityItemCaches(): void {
	catalogueEpoch++; nativeSteamBadgeStores.clear();
	restartActiveCatalogues();
}
export function invalidateCommunityItemCaches(appIds: Iterable<string | number>): void {
	const ids = new Set(Array.from(appIds, value => String(value)).filter(value => /^\d+$/.test(value)));
	if (!ids.size) return;
	for (const id of ids) catalogueRevisions.set(id, (catalogueRevisions.get(id) || 0) + 1);
	cacheDeleteMatching(key => {
		const appId = key.match(/^community_items_v\d+_.+_(\d+)$/)?.[1];
		return Boolean(appId && ids.has(appId));
	});
	restartActiveCatalogues(ids);
}
function restartActiveCatalogues(ids?: Set<string>): void {
	for (const [entry, doc] of [...activeCatalogues]) {
		if (ids && !ids.has(entry.appid)) continue;
		cancelEnrichment(entry); entry.epoch = catalogueEpoch; entry.revision = catalogueRevisions.get(entry.appid) || 0;
		entry.failed = false;
		if (liveDocument(doc) && !retiredDocuments.has(doc) && entry.consumers) {
			getImmediateOfficialCommunityItems(doc, entry.appid, entry.language);
			void startEnrichment(doc, entry, true);
		} else keepObserved(doc, entry);
	}
}
