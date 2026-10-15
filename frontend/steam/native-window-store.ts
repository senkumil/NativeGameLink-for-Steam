import { steamWebpackRuntime } from './modules/SteamWebpackRuntime';

interface WindowStoreState {
	identity: object | null;
	stores: any[];
	moduleCount: number;
	factoryCount: number;
	seenFactories: Map<string, Function>;
}
const states = new WeakMap<Document, WindowStoreState>();
const MAX_STORE_CANDIDATES = 8;
// Steam creates its native popups with document.write and React portals. Those
// Documents have no Webpack of their own; the plugin's SharedJSContext holds
// the native WindowStore and renderer that own the portal.
const registryDocument = typeof document !== 'undefined' ? document : null;

function liveView(doc: Document): Window | null {
	const view = doc.defaultView;
	return view && !view.closed && view.document === doc ? view : null;
}

function asWindowStore(value: any): any | null {
	try { return typeof value?.GetWindowInstanceFromWindow === 'function' ? value : null; }
	catch { return null; }
}

function addExportStores(state: WindowStoreState, value: any): void {
	try {
		for (const candidate of [value?.oy?.WindowStore, value?.SteamUIStore?.WindowStore,
			value?.WindowStore, value?.default?.WindowStore, value]) {
			const store = asWindowStore(candidate);
			if (store && !state.stores.includes(store) && state.stores.length < MAX_STORE_CANDIDATES) state.stores.push(store);
		}
	} catch {}
}

function owningInstance(store: any, view: Window): any | null {
	try {
		const instance = store?.GetWindowInstanceFromWindow?.(view);
		return instance?.BrowserWindow === view ? instance : null;
	} catch { return null; }
}

function windowStoreFactory(source: string): boolean {
	// Identify Steam's UIStore export by its contract, rather than a module ID
	// that changes between builds. Never instantiate unrelated factories.
	return /(?:^|[,{])\s*["']?oy["']?\s*:\s*\(\)\s*=>/.test(source)
		&& source.includes('WindowStore') && source.includes('GetWindowInstanceFromWindow')
		&& source.includes('IsMainGamepadUIWindow');
}

function resolveFromRuntime(source: Document, view: Window): { store: any; instance: any } | null {
	const sourceView = liveView(source);
	if (!sourceView) return null;
	// A local global can publish before the document's Webpack capture. Its
	// lookup still has to prove the exact BrowserWindow on every action.
	try {
		const store = asWindowStore((sourceView as any).SteamUIStore?.WindowStore);
		const instance = owningInstance(store, view);
		if (instance) return { store, instance };
	} catch {}
	const identity = steamWebpackRuntime.getRuntimeIdentity(source);
	let state = states.get(source);
	if (!state || state.identity !== identity) {
		state = { identity, stores: [], moduleCount: -1, factoryCount: -1, seenFactories: new Map() };
		states.set(source, state);
	}
	for (const store of state.stores) {
		const instance = owningInstance(store, view);
		if (instance) return { store, instance };
	}
	const modules = steamWebpackRuntime.getAllModules(source);
	if (state.moduleCount !== modules.length) {
		state.moduleCount = modules.length;
		for (const module of modules) addExportStores(state, module.exports);
	}
	for (const store of state.stores) {
		const instance = owningInstance(store, view);
		if (instance) return { store, instance };
	}
	const req = steamWebpackRuntime.getRequire(source);
	const count = steamWebpackRuntime.getModuleFactoryCount(source);
	if (req && state.factoryCount !== count) {
		state.factoryCount = count;
		for (const { id, factory } of steamWebpackRuntime.getModuleFactories(source)) {
			if (state.seenFactories.get(id) === factory) continue;
			if (!windowStoreFactory(String(factory))) { state.seenFactories.set(id, factory); continue; }
			try {
				if (req.m?.[id] !== factory) continue;
				addExportStores(state, req(id));
				state.seenFactories.set(id, factory);
			} catch { continue; } // Retry a matching factory when a dependency chunk arrives.
			for (const store of state.stores) {
				const instance = owningInstance(store, view);
				if (instance) return { store, instance };
			}
		}
	}
	return null;
}

function resolveNativeWindowOwner(doc: Document): { store: any; instance: any } | null {
	const view = liveView(doc);
	if (!view) return null;
	const local = resolveFromRuntime(doc, view);
	if (local) return local;
	// This is a lookup by the requested BrowserWindow, never a route or active
	// window borrowed from the registry. Unregistered/other CEFs remain denied.
	if (!registryDocument || registryDocument === doc) return null;
	const shared = resolveFromRuntime(registryDocument, view);
	if (!shared) return null;
	steamWebpackRuntime.authorizeSharedDocumentRuntime(doc, registryDocument,
		() => Boolean(liveView(doc) === view && owningInstance(shared.store, view)));
	return shared;
}

/** The returned store has just proved ownership of this exact live Document. */
export function getNativeWindowStore(doc: Document): any | null {
	return resolveNativeWindowOwner(doc)?.store || null;
}

/** Native routes and UI mode belong to the requested Window, never its opener. */
export function getNativeWindowInstance(doc: Document): any | null {
	return resolveNativeWindowOwner(doc)?.instance || null;
}
