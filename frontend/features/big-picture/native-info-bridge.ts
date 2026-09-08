import type { SteamGameData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getShortcutAppById, toSignedShortcutAppId } from '../../steam/shortcuts';
import { resolveNativeAppDetailsStore } from '../../steam/gamepad/components/AppDetailsNativeComponents';
import type { MappedShortcut } from './types';

type PropertySnapshot = PropertyDescriptor | null;

type ActiveNativeInfoTarget = {
	shortcut: MappedShortcut;
	game: SteamGameData | null;
	signature: string;
};

type AppClassificationState = {
	app: any;
	modShortcutMethod: PropertySnapshot;
};

type StoreBridgeState = {
	store: any;
	originalGetAppData: Function;
	wrapper?: Function;
	originalDescriptor: PropertySnapshot;
	proxyCache: Map<string, { base: any; value: any }>;
};

const activeTargets = new WeakMap<Window, ActiveNativeInfoTarget>();
const classificationStates = new WeakMap<Document, AppClassificationState>();
const storeBridgeByWindow = new WeakMap<Window, StoreBridgeState>();
const rerenderTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();

function ownDescriptor(target: any, key: string): PropertySnapshot {
	try { return Object.getOwnPropertyDescriptor(target, key) || null; } catch { return null; }
}

function restoreOwnDescriptor(target: any, key: string, snapshot: PropertySnapshot): void {
	try {
		if (snapshot) Object.defineProperty(target, key, snapshot);
		else delete target[key];
	} catch {}
}

function setTemporaryValue(target: any, key: string, value: unknown): void {
	try {
		const current = Object.getOwnPropertyDescriptor(target, key);
		if (current && current.configurable === false && current.writable === false) return;
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: current?.enumerable ?? true,
			writable: true,
			value,
		});
	} catch {
		try { target[key] = value; } catch {}
	}
}

function patchActiveShortcutClassification(doc: Document, shortcut: MappedShortcut): void {
	const previous = classificationStates.get(doc);
	const app = getShortcutAppById(shortcut.id, doc);
	if (previous?.app === app) return;
	if (previous) restoreActiveShortcutClassification(doc);
	if (!app) return;
	const state: AppClassificationState = {
		app,
		modShortcutMethod: ownDescriptor(app, 'BIsModOrShortcut'),
	};
	classificationStates.set(doc, state);
	// Do not change app_type or BIsShortcut: artwork and launch routing depend on them.
	if (typeof app.BIsModOrShortcut === 'function' || state.modShortcutMethod) {
		setTemporaryValue(app, 'BIsModOrShortcut', function (): boolean { return false; });
	}
}

function restoreActiveShortcutClassification(doc: Document): void {
	const state = classificationStates.get(doc);
	if (!state) return;
	classificationStates.delete(doc);

	restoreOwnDescriptor(state.app, 'BIsModOrShortcut', state.modShortcutMethod);
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
	const details = { ...(base || {}) };
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
	return details;
}

function installStoreBridge(doc: Document): void {
	const win = doc.defaultView;
	if (!win || storeBridgeByWindow.has(win)) return;
	const store = resolveNativeAppDetailsStore(doc);
	if (!store || typeof store.GetAppData !== 'function') return;
	const originalGetAppData = store.GetAppData;
	const bridge: StoreBridgeState = { store, originalGetAppData, originalDescriptor: ownDescriptor(store, 'GetAppData'), proxyCache: new Map() };
	storeBridgeByWindow.set(win, bridge);
	store.GetAppData = function (appId: number): any {
		const target = activeTargets.get(win);
		if (!target) return originalGetAppData.call(this, appId);
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
		Object.defineProperties(metadata, {
			details: { configurable: true, writable: true, value: buildSyntheticDetails(base.details, target) },
			descriptionsData: { configurable: true, writable: true, value: { ...base.descriptionsData,
				strSnippet: base.descriptionsData?.strSnippet || target.game.short_description || '', strFullDescription: base.descriptionsData?.strFullDescription || target.game.about_the_game || target.game.detailed_description || '',
			} },
			associationData: { configurable: true, writable: true, value: { ...base.associationData,
				rgDevelopers: base.associationData?.rgDevelopers?.length ? base.associationData.rgDevelopers : (target.game.developers || []).map(strName => ({ strName, strURL: 'https://store.steampowered.com/search/?developer=' + encodeURIComponent(strName) })),
				rgPublishers: base.associationData?.rgPublishers?.length ? base.associationData.rgPublishers : (target.game.publishers || []).map(strName => ({ strName, strURL: 'https://store.steampowered.com/search/?publisher=' + encodeURIComponent(strName) })),
				rgFranchises: base.associationData?.rgFranchises?.length ? base.associationData.rgFranchises : (target.game.franchises || []).map(strName => ({ strName, strURL: 'https://store.steampowered.com/search/?term=' + encodeURIComponent(strName) })),
			} },
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
	const existing = rerenderTimers.get(doc);
	if (existing) clearTimeout(existing);
	const timer = setTimeout(() => {
		rerenderTimers.delete(doc);
		const win = doc.defaultView as any;
		try { win?.MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
		try { if (win !== window) (window as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
	}, 40);
	rerenderTimers.set(doc, timer);
}

export function activateNativeGameInfoBridge(doc: Document, shortcut: MappedShortcut, game: SteamGameData | null): void {
	const win = doc.defaultView;
	if (!win) return;
	installStoreBridge(doc);
	patchActiveShortcutClassification(doc, shortcut);
	const signature = gameSignature(shortcut, game);
	const previous = activeTargets.get(win);
	activeTargets.set(win, { shortcut, game, signature });
	if (previous?.signature !== signature) requestNativeInfoRerender(doc);
}

export function deactivateNativeGameInfoBridge(doc: Document): void {
	const win = doc.defaultView;
	if (win) {
		activeTargets.delete(win);
		const bridge = storeBridgeByWindow.get(win);
		if (bridge?.store.GetAppData === bridge?.wrapper && bridge) restoreOwnDescriptor(bridge.store, 'GetAppData', bridge.originalDescriptor);
		storeBridgeByWindow.delete(win);
	}
	restoreActiveShortcutClassification(doc);
	const timer = rerenderTimers.get(doc);
	if (timer) clearTimeout(timer);
	rerenderTimers.delete(doc);
}
