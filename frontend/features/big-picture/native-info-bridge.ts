import type { SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { toSignedShortcutAppId } from '../../steam/shortcuts';
import { resolveNativeAppDetailsStore } from '../../steam/gamepad/components/AppDetailsNativeComponents';
import type { MappedShortcut } from './types';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';

type PropertySnapshot = PropertyDescriptor | null;

type ActiveNativeInfoTarget = {
	document: Document;
	shortcut: MappedShortcut;
	game: SteamGameData | null;
	signature: string;
	generation: number;
};

type StoreBridgeState = {
	document: Document;
	store: any;
	originalGetAppData: Function;
	wrapper?: Function;
	originalDescriptor: PropertySnapshot;
	proxyCache: Map<string, { base: any; value: any }>;
};

const activeTargets = new WeakMap<Window, ActiveNativeInfoTarget>();
const storeBridgeByWindow = new WeakMap<Window, StoreBridgeState>();
const rerenderTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
let targetGeneration = 0;

function isCurrentInfoTarget(doc: Document, shortcut: MappedShortcut): boolean {
	try {
		const view = doc.defaultView, raw = Number(shortcut.id), id = raw < 0 ? raw >>> 0 : raw;
		return Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected && !doc.hidden
			&& steamUIModeService.isGamepadUI(doc) && Number.isInteger(raw) && raw >= -2147483648 && raw <= 4294967295
			&& id >= 2147483648 && isCurrentLinkedGamepadTarget(doc, id, shortcut.steamAppId)
			&& getCommittedShortcutSteamAppId(id) === String(shortcut.steamAppId));
	} catch { return false; }
}

function ownDescriptor(target: any, key: string): PropertySnapshot {
	try { return Object.getOwnPropertyDescriptor(target, key) || null; } catch { return null; }
}

function restoreOwnDescriptor(target: any, key: string, snapshot: PropertySnapshot): void {
	try {
		if (snapshot) Object.defineProperty(target, key, snapshot);
		else delete target[key];
	} catch {}
}

function gameSignature(shortcut: MappedShortcut, game: SteamGameData | null): string {
	return [
		shortcut.id,
		shortcut.steamAppId,
		game?.name || '',
		game?.short_description || '', game?.about_the_game || '', game?.detailed_description || '',
		(game?.franchises || []).join('|'),
		(game?.developers || []).join('|'),
		(game?.publishers || []).join('|'),
		game?.release_date?.date || '',
		(game?.categories || []).map(item => item.id).join(','),
	].join('::');
}

function buildSyntheticDetails(base: any, target: ActiveNativeInfoTarget): any {
	const game = target.game;
	if (!game) return base;
	const details: Record<string, any> = {};
	const developers = Array.isArray(game.developers) ? game.developers.join(', ') : '';
	const publishers = Array.isArray(game.publishers) ? game.publishers.join(', ') : '';
	const franchise = Array.isArray(game.franchises) ? game.franchises.join(', ') : '';
	const releaseDate = game.release_date?.date || '';
	const description = game.short_description || game.about_the_game || game.detailed_description || '';
	const categories = Array.isArray(game.categories) ? game.categories : [];
	const genres = Array.isArray(game.genres) ? game.genres : [];
	Object.assign(details, {
		unAppID: base?.unAppID ?? target.shortcut.id,
		strDeveloper: developers,
		strPublisher: publishers,
		strFranchise: franchise,
		strReleaseDate: releaseDate,
		strDescription: description,
		strShortDescription: description,
		rgCategories: categories,
		rgGenres: genres,
	});
	if (!Array.isArray(details.vecStoreCategories)) {
		details.vecStoreCategories = categories.map(category => ({
			unCategoryID: Number(category.id),
			strName: String(category.description || ''),
		}));
	}
	if (!Array.isArray(details.vecAssociations)) {
		const associations: any[] = [];
		if (developers) associations.push({ eType: 1, strName: developers });
		if (publishers) associations.push({ eType: 2, strName: publishers });
		if (franchise) associations.push({ eType: 3, strName: franchise });
		details.vecAssociations = associations;
	}
	return new Proxy(base || {}, {
		get: (native, key) => {
			const value = Reflect.get(native, key, native);
			if (value != null && (typeof value !== 'string' || value !== '')) return value;
			return details[key as string];
		},
		set: (native, key, value) => Reflect.set(native, key, value, native),
	});
}

function installStoreBridge(doc: Document): void {
	const win = doc.defaultView;
	if (!win) return;
	const store = resolveNativeAppDetailsStore(doc);
	if (!store || typeof store.GetAppData !== 'function') return;
	const existing = storeBridgeByWindow.get(win);
	if (existing?.document === doc && existing.store === store && existing.store.GetAppData === existing.wrapper) return;
	if (existing) deactivateNativeGameInfoBridge(existing.document);
	const originalGetAppData = store.GetAppData;
	const bridge: StoreBridgeState = { document: doc, store, originalGetAppData, originalDescriptor: ownDescriptor(store, 'GetAppData'), proxyCache: new Map() };
	storeBridgeByWindow.set(win, bridge);
	store.GetAppData = function (appId: number): any {
		const target = activeTargets.get(win);
		if (!target || !isCurrentInfoTarget(doc, target.shortcut)) return originalGetAppData.call(this, appId);
		const requested = Number(appId);
		const unsigned = target.shortcut.id < 0 ? (target.shortcut.id >>> 0) : target.shortcut.id;
		const signed = toSignedShortcutAppId(unsigned);
		if (requested !== unsigned && requested !== signed) return originalGetAppData.call(this, appId);
		const base = originalGetAppData.call(this, appId);
		if (!base || typeof base !== 'object' || !target.game) return base;
		const cacheKey = `${target.signature}|${requested}`;
		const cached = bridge.proxyCache.get(cacheKey);
		if (cached?.base === base) return cached.value;
		const metadata: Record<string, any> = {};
		const liveViews = new Map<string, { native: any; value: any }>();
		const liveView = (key: string, build: (native: any) => any): any => {
			const native = base[key], cached = liveViews.get(key);
			if (cached && cached.native === native) return cached.value;
			const value = build(native);
			liveViews.set(key, { native, value });
			return value;
		};
		Object.defineProperties(metadata, {
			details: { configurable: true, get: () => liveView('details', native => buildSyntheticDetails(native, target)) },
			descriptionsData: { configurable: true, get: () => liveView('descriptionsData', native => new Proxy(native || {}, {
				get: (object, key) => key === 'strSnippet' ? object.strSnippet || target.game!.short_description || ''
					: key === 'strFullDescription' ? object.strFullDescription || target.game!.about_the_game || target.game!.detailed_description || '' : Reflect.get(object, key, object),
				set: (object, key, value) => Reflect.set(object, key, value, object),
			})) },
			associationData: { configurable: true, get: () => liveView('associationData', native => new Proxy(native || {}, {
				get: (object, key) => {
					const value = Reflect.get(object, key, object);
					if (value?.length) return value;
					const association = key === 'rgDevelopers' ? 'developer' : key === 'rgPublishers' ? 'publisher' : key === 'rgFranchises' ? 'franchise' : null;
					if (!association) return value;
					const names = association === 'developer' ? target.game!.developers : association === 'publisher' ? target.game!.publishers : target.game!.franchises;
					return (names || []).map(strName => ({ strName, strURL: 'https://store.steampowered.com/search/?' + (association === 'franchise' ? 'term' : association) + '=' + encodeURIComponent(strName) }));
				},
				set: (object, key, value) => Reflect.set(object, key, value, object),
			})) },
		});
		const proxy = new Proxy(base, {
			get: (object, key) => Object.prototype.hasOwnProperty.call(metadata, key) ? metadata[key as string] : Reflect.get(object, key, object),
			set: (object, key, value) => Reflect.set(object, key, value, object),
		});
		if (bridge.proxyCache.size >= 4) bridge.proxyCache.delete(bridge.proxyCache.keys().next().value);
		bridge.proxyCache.set(cacheKey, { base, value: proxy });
		return proxy;
	};
	bridge.wrapper = store.GetAppData;
	backendLog('[NGL][Gamepad] Installed linked AppDetailsStore bridge for native Game Information');
}

function requestNativeInfoRerender(doc: Document): void {
	const view = doc.defaultView;
	const target = view && activeTargets.get(view);
	if (!view || !target || !isCurrentInfoTarget(doc, target.shortcut)) return;
	const existing = rerenderTimers.get(doc);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		rerenderTimers.delete(doc);
		const current = activeTargets.get(view);
		if (current?.generation !== target.generation || current.signature !== target.signature
			|| !isCurrentInfoTarget(doc, current.shortcut)) return;
		try { (view as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
	}, 40);
	rerenderTimers.set(doc, timer);
}

function isNativeInfoSurfaceActive(doc: Document): boolean {
	if (!doc.body) return true;
	const root = doc.getElementById('gdl-bp-detail-root');
	if (root && (root.hidden || root.style.display === 'none')) {
		return true;
	}
	const activeTab = doc.querySelector('[role="tab"][aria-selected="true"], [class*="Tab"][class*="Active"]');
	const text = (activeTab?.textContent || '').toLowerCase();
	return text.includes('info') || text.includes('información') || text.includes('informacion');
}

export function activateNativeGameInfoBridge(doc: Document, shortcut: MappedShortcut, game: SteamGameData | null): void {
	const win = doc.defaultView;
	if (!win) return;
	if (!isCurrentInfoTarget(doc, shortcut)) { deactivateNativeGameInfoBridge(doc); return; }
	installStoreBridge(doc);
	// Keep enrichment inside GetAppData's metadata view. Steam's real overview
	// uses BIsModOrShortcut to request and preserve icon_data across replacements.
	// Reclassifying that shared object makes sidebar icons disappear on recycling.
	const signature = gameSignature(shortcut, game);
	const previous = activeTargets.get(win);
	const generation = previous?.shortcut.id === shortcut.id && previous.shortcut.steamAppId === shortcut.steamAppId
		? previous.generation : ++targetGeneration;
	activeTargets.set(win, { document: doc, shortcut, game, signature, generation });
	if (game && previous && previous.signature !== signature && isNativeInfoSurfaceActive(doc)) {
		requestNativeInfoRerender(doc);
	}
}

export function deactivateNativeGameInfoBridge(doc: Document): void {
	const win = doc.defaultView;
	if (win) {
		if (activeTargets.get(win)?.document === doc) activeTargets.delete(win);
		const bridge = storeBridgeByWindow.get(win);
		if (bridge?.document === doc) {
			if (bridge.store.GetAppData === bridge.wrapper) restoreOwnDescriptor(bridge.store, 'GetAppData', bridge.originalDescriptor);
			storeBridgeByWindow.delete(win);
		}
	}
	const timer = rerenderTimers.get(doc);
	if (timer) clearTimeout(timer);
	rerenderTimers.delete(doc);
}
