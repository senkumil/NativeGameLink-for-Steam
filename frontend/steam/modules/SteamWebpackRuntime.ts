import { backendLog } from '../../api/backend';
import { modules as millenniumWebpackModules } from '@steambrew/client';

export interface WebpackModuleEntry {
	id: string | number;
	exports: any;
}
export interface WebpackModuleFactory {
	id: string;
	factory: (...args: any[]) => any;
}

type RuntimeSource = 'none' | 'window' | 'millennium' | 'shared';

interface SharedRuntimeAuthorization {
	ownerDocument: Document;
	verify: () => boolean;
}

interface SharedRuntimeLease {
	authorization: SharedRuntimeAuthorization;
	ownerState: SteamWebpackRuntimeState;
	ownerIdentity: object;
	copiedModuleCount: number;
	copiedFactoryCount: number;
}

interface SteamWebpackRuntimeState {
	document: Document | null;
	disposeListener: () => void;
	requireFn: any | null;
	rawRequire: any | null;
	factorySource: any | null;
	loadedFactories: Map<string, any>;
	moduleCache: Map<string | number, any>;
	inspected: boolean;
	lastProbeTime: number;
	lastWindowProbeSource: any | null;
	source: RuntimeSource;
	identity: object;
	shared: SharedRuntimeLease | null;
}

/**
 * Steam can host Desktop, Big Picture and overlays in different CEF windows.
 * Webpack exports, React contexts and stores are realm-bound, so a runtime
 * captured from one window must never silently become the runtime of another.
 */
class SteamWebpackRuntime {
	private states = new WeakMap<Window, SteamWebpackRuntimeState>();
	private activeWindow: Window | null = null;
	private fallbackState = this.createState();
	private registryWindow: Window | null = typeof window !== 'undefined' ? window : null;
	private registryDocument: Document | null = this.registryWindow?.document || null;
	private sharedDocuments = new WeakMap<Document, SharedRuntimeAuthorization>();
	private retiredDocuments = new WeakSet<Document>();

	/**
	 * A native WindowStore can explicitly prove that a popup is rendered by the
	 * owner's shared CEF runtime. Merely being a popup, sibling or opener is never
	 * permission to use that runtime. The proof remains live for every access.
	 */
	public authorizeSharedDocumentRuntime(doc: Document, ownerDoc: Document, verify: () => boolean): boolean {
		if (doc === ownerDoc || !this.isLiveDocument(doc) || !this.isLiveDocument(ownerDoc) || typeof verify !== 'function') return false;
		const authorization = { ownerDocument: ownerDoc, verify };
		if (!this.verifySharedAuthorization(doc, authorization)) return false;
		const win = doc.defaultView!;
		let state = this.getOrCreateState(win, doc);
		// An independently bootstrapped CEF document always keeps its own runtime.
		if (state.source === 'window' && state.requireFn) return false;
		if (this.probeAvailableWindowRuntime(win, state)) return false;
		const ownerState = this.resolveSharedOwnerState(authorization);
		if (!ownerState || !this.verifySharedAuthorization(doc, authorization)) return false;
		const previous = this.sharedDocuments.get(doc);
		if (state.shared && previous?.ownerDocument === ownerDoc && this.isSharedLeaseCurrent(win, state)) {
			// Refresh the current native proof without retiring a still-current React
			// lease merely because its caller created another equivalent closure.
			previous.verify = verify;
			this.activeWindow = win;
			return true;
		}
		if (state.shared) {
			this.invalidateWindow(win, state);
			state = this.getOrCreateState(win, doc);
		}
		this.sharedDocuments.set(doc, authorization);
		this.adoptSharedRuntime(win, state, authorization, ownerState);
		this.activeWindow = win;
		return true;
	}

	public captureRuntime(doc?: Document): boolean {
		if (doc && !this.isLiveDocument(doc)) return false;
		const targetWindows = this.collectTargetWindows(doc);
		if (targetWindows.length === 0) return !doc && this.captureMillenniumFallback(this.fallbackState);

		for (const targetWin of targetWindows) {
			if (!targetWin || targetWin.closed) continue;
			let state = this.getOrCreateState(targetWin, doc || targetWin.document || null);
			this.activeWindow = targetWin;
			if (state.shared) {
				const authorization = state.shared.authorization;
				// A popup can acquire an independent bootstrap later. Prefer it over
				// the shared lease immediately, without treating the proof as a hint.
				if (this.probeAvailableWindowRuntime(targetWin, state)) return true;
				this.resolveSharedOwnerState(authorization);
				if (this.isSharedLeaseCurrent(targetWin, state)) {
					this.syncSharedCache(state);
					return true;
				}
				this.invalidateWindow(targetWin, state);
				state = this.getOrCreateState(targetWin, doc || targetWin.document || null);
			}

			// A locally captured require() is authoritative for this CEF realm.
			if (state.inspected && state.requireFn) {
				this.syncRequireCache(state);
				return true;
			}

			const now = Date.now();
			if (now - state.lastProbeTime < 500) return this.captureAuthorizedSharedRuntime(targetWin, state) || state.inspected;
			state.lastProbeTime = now;

			if (this.captureWindowRuntime(targetWin, state)) return true;
			// Millennium's registry belongs to the plugin's own Window. It is not
			// evidence that an explicitly requested CEF document shares that realm.
			if (typeof window !== 'undefined' && targetWin === window && this.captureMillenniumFallback(state)) {
				this.bindWindowUnload(targetWin, state);
				return true;
			}
			if (this.captureAuthorizedSharedRuntime(targetWin, state)) return true;

			// When an explicit document was supplied, never fall through and borrow
			// another popup's Webpack require. The caller can retry this realm later.
			if (doc?.defaultView === targetWin) return false;
		}
		return false;
	}

	/** Invalidate only the active/requested CEF realm, not every Steam window. */
	public invalidate(doc?: Document): void {
		const win = doc?.defaultView || this.activeWindow;
		if (win) {
			const state = this.states.get(win);
			if (!doc || state?.document === doc) this.invalidateWindow(win, state);
			return;
		}
		this.fallbackState = this.createState();
		backendLog('[NGL][Webpack] Fallback runtime cache invalidated');
	}

	public getAllModules(doc?: Document): WebpackModuleEntry[] {
		const state = this.resolveState(doc);
		if (!state) return [];
		if (state.shared) this.syncSharedCache(state);
		else if (state.requireFn) this.syncRequireCache(state);
		else if (state.source === 'millennium') this.captureMillenniumFallback(state);
		const result: WebpackModuleEntry[] = [];
		for (const [id, exports] of state.moduleCache) result.push({ id, exports });
		return result;
	}

	public getRequire(doc?: Document): any | null {
		return this.resolveState(doc)?.requireFn ?? null;
	}

	/** Inspect available code without instantiating stores or every module. */
	public getModuleFactories(doc?: Document): WebpackModuleFactory[] {
		const state = this.resolveState(doc), factories = state?.rawRequire?.m;
		if (!factories || typeof factories !== 'object') return [];
		return Object.keys(factories).filter(id => typeof factories[id] === 'function')
			.map(id => ({ id, factory: factories[id] }));
	}
	public getModuleFactoryCount(doc?: Document): number {
		const factories = this.resolveState(doc)?.rawRequire?.m;
		return factories && typeof factories === 'object' ? Object.keys(factories).length : 0;
	}

	/** Unique token for the currently selected realm/runtime generation. */
	public getRuntimeIdentity(doc?: Document): object | null {
		const state = this.resolveState(doc);
		if (!state) return null;
		if (state.shared) this.syncSharedCache(state);
		else if (state.requireFn) this.syncRequireCache(state);
		else if (state.source === 'millennium') this.captureMillenniumFallback(state);
		return state.identity;
	}

	public async ensureChunk(chunkId: number | string, doc?: Document): Promise<boolean> {
		const req = this.getRequire(doc);
		if (req && typeof req.e === 'function') {
			try {
				const state = this.resolveState(doc);
				const previousSize = state?.moduleCache.size || 0;
				const previousFactories = Object.keys(state?.rawRequire?.m || {}).length;
				await req.e(chunkId);
				if (!state || this.resolveState(doc) !== state || this.getRequire(doc) !== req) return false;
				if (state) {
					this.syncRequireCache(state);
					if (state.moduleCache.size !== previousSize || Object.keys(state.rawRequire?.m || {}).length !== previousFactories) state.identity = {};
				}
				return true;
			} catch (err) {
				backendLog(`[NGL][Webpack] Failed to load chunk ${chunkId}: ${err}`);
			}
		}
		return false;
	}

	private createState(): SteamWebpackRuntimeState {
		return {
			document: null,
			disposeListener: () => {},
			requireFn: null,
			rawRequire: null,
			factorySource: null,
			loadedFactories: new Map(),
			moduleCache: new Map<string | number, any>(),
			inspected: false,
			lastProbeTime: 0,
			lastWindowProbeSource: null,
			source: 'none',
			identity: {},
			shared: null,
		};
	}

	private getOrCreateState(win: Window, doc: Document | null): SteamWebpackRuntimeState {
		let state = this.states.get(win);
		if (state && state.document !== doc) {
			this.invalidateWindow(win, state);
			state = undefined;
		}
		if (!state) {
			state = this.createState();
			state.document = doc;
			this.states.set(win, state);
		}
		return state;
	}

	private resolveState(doc?: Document): SteamWebpackRuntimeState | null {
		if (doc && !this.isLiveDocument(doc)) return null;
		const requestedWindow = doc?.defaultView || null;
		if (requestedWindow) {
			this.activeWindow = requestedWindow;
			let state = this.getOrCreateState(requestedWindow, doc!);
			if (state.shared || !state?.inspected || !state.requireFn) {
				this.captureRuntime(doc);
				state = this.states.get(requestedWindow)!;
			}
			return state?.inspected ? state : null;
		}

		if (this.activeWindow && !this.activeWindow.closed) {
			const activeState = this.states.get(this.activeWindow);
			if (activeState?.shared && activeState.document) return this.resolveState(activeState.document);
			if (activeState?.inspected && activeState.document === (this.activeWindow.document || null)) return activeState;
		}

		if (typeof window !== 'undefined') {
			const globalState = this.states.get(window);
			if (globalState?.inspected && globalState.document === (window.document || null)) {
				this.activeWindow = window;
				return globalState;
			}
		}

		if (!this.captureRuntime()) return this.fallbackState.inspected ? this.fallbackState : null;
		if (this.activeWindow) return this.states.get(this.activeWindow) || null;
		return this.fallbackState.inspected ? this.fallbackState : null;
	}

	private captureWindowRuntime(targetWin: any, state: SteamWebpackRuntimeState): boolean {
		const chunkArray = targetWin.webpackChunksteamui || targetWin.webpackChunk || targetWin.webpackJsonp;
		if (!chunkArray || typeof chunkArray.push !== 'function') return false;
		state.lastWindowProbeSource = chunkArray;
		state.lastProbeTime = Date.now();

		try {
			let capturedRequire: any = null;
			const probeId = Symbol('ngl_webpack_runtime_probe');
			chunkArray.push([
				[probeId],
				{},
				(req: any) => {
					capturedRequire = req;
				},
			]);

			const exposedCache = capturedRequire?.c && typeof capturedRequire.c === 'object';
			const privateCache = typeof capturedRequire === 'function' && capturedRequire.m && typeof capturedRequire.m === 'object';
			if (exposedCache || privateCache) {
				state.shared = null;
				state.rawRequire = capturedRequire;
				state.factorySource = capturedRequire.m || null;
				state.requireFn = privateCache && !exposedCache ? this.ownedRequire(targetWin, state, capturedRequire) : capturedRequire;
				state.moduleCache.clear();
				state.loadedFactories.clear();
				this.syncRequireCache(state);
				if (privateCache && !exposedCache && this.ownsPluginRegistry(targetWin, state.document)) {
					for (const [id, exports] of millenniumWebpackModules) {
						const key = String(id), factory = capturedRequire.m[key];
						if (exports === undefined || typeof factory !== 'function') continue;
						state.moduleCache.set(key, exports); state.loadedFactories.set(key, factory);
					}
				}
				state.inspected = true;
				state.source = 'window';
				state.identity = {};
				this.bindWindowUnload(targetWin, state);
				backendLog(`[NGL][Webpack] Runtime captured for CEF window with ${state.moduleCache.size} loaded modules${privateCache && !exposedCache ? ' and private cache; factory exports resolve on demand' : ''}`);
				return true;
			}
		} catch (error) {
			backendLog(`[NGL][Webpack] Error during window-scoped Webpack probe: ${error}`);
		}
		return false;
	}

	private ownedRequire(win: Window, state: SteamWebpackRuntimeState, raw: any): any {
		const shared = state.shared;
		const current = () => this.states.get(win) === state && !win.closed && win.document === state.document &&
			state.rawRequire === raw && state.shared === shared && (!shared || this.isSharedLeaseCurrent(win, state));
		const validate = () => { if (!current()) throw new Error('The requested Steam runtime Document was retired'); };
		const methods = new Map<PropertyKey, { original: Function; owned: Function }>();
		const proxy = new Proxy(raw, {
			apply: (target, receiver, args) => {
				validate();
				const value = Reflect.apply(target, receiver, args);
				validate();
				if (typeof args[0] === 'string' || typeof args[0] === 'number') {
					const id = String(args[0]), previous = state.moduleCache.get(id);
					// Acquiring a new lazy export is not a new renderer lease. In the
					// private-cache bootstrap, doing so would invalidate its first render.
					if (previous !== undefined && previous !== value) state.identity = {};
					if (value !== undefined) state.moduleCache.set(id, value);
					state.loadedFactories.set(id, raw.m?.[id]);
					if (shared && value !== undefined) {
						const ownerPrevious = shared.ownerState.moduleCache.get(id);
						if (ownerPrevious !== undefined && ownerPrevious !== value) shared.ownerState.identity = {};
						shared.ownerState.moduleCache.set(id, value);
						shared.ownerState.loadedFactories.set(id, raw.m?.[id]);
					}
				}
				return value;
			},
			get: (target, key) => {
				validate();
				const value = Reflect.get(target, key, target);
				const descriptor = Object.getOwnPropertyDescriptor(target, key);
				if (descriptor && !descriptor.configurable && descriptor.writable === false) {
					// A Proxy cannot substitute a guarded wrapper for a frozen function
					// property. Do not lend an unguarded native method to a shared popup.
					if (shared && typeof value === 'function' && key !== 'prototype') throw new Error('The shared Steam runtime method cannot be safely leased');
					return value;
				}
				if (typeof value !== 'function' || key === 'prototype') return value;
				const cached = methods.get(key);
				if (cached?.original === value) return cached.owned;
				const owned = (...args: any[]) => {
					validate();
					// Function.prototype call/apply/bind must keep the owned Proxy as
					// receiver. Binding the raw native require would escape revocation.
					const receiver = shared && (key === 'call' || key === 'apply' || key === 'bind') ? proxy : target;
					const result: any = Reflect.apply(value, receiver, args);
					validate();
					if (shared && result && typeof result.then === 'function') return Promise.resolve(result).then(value => { validate(); return value; });
					return result;
				};
				methods.set(key, { original: value, owned });
				return owned;
			},
		});
		return proxy;
	}

	private syncRequireCache(state: SteamWebpackRuntimeState): void {
		if (state.shared) { this.syncSharedCache(state); return; }
		const raw = state.rawRequire || state.requireFn, cache = raw?.c;
		if (!cache || typeof cache !== 'object') {
			const factories = raw?.m || null;
			if (state.factorySource !== factories) {
				state.factorySource = factories;
				state.moduleCache.clear(); state.loadedFactories.clear(); state.identity = {};
			}
			for (const [id, factory] of state.loadedFactories) if (factories?.[id] !== factory) {
				state.moduleCache.delete(id); state.loadedFactories.delete(id); state.identity = {};
			}
			return;
		}
		let changed = false;
		const liveIds = new Set(Object.keys(cache));
		for (const key of state.moduleCache.keys()) {
			if (!liveIds.has(String(key))) { state.moduleCache.delete(key); changed = true; }
		}
		for (const key of liveIds) {
			const mod = cache[key]?.exports;
			if (mod === undefined) {
				if (state.moduleCache.delete(key)) changed = true;
			} else if (state.moduleCache.get(key) !== mod) {
				state.moduleCache.set(key, mod); changed = true;
			}
		}
		if (changed) state.identity = {};
	}

	private captureMillenniumFallback(state: SteamWebpackRuntimeState): boolean {
		if (state.document && !this.ownsPluginRegistry(state.document.defaultView, state.document)) return false;
		try {
			const next = new Map<string | number, any>();
			for (const [id, exports] of millenniumWebpackModules) {
				if (exports) next.set(id, exports);
			}
			const changed = next.size !== state.moduleCache.size || Array.from(next).some(([id, value]) => state.moduleCache.get(id) !== value);
			state.moduleCache = next;
			if (changed) state.identity = {};
			if (state.moduleCache.size > 0) {
				state.requireFn = null;
				state.rawRequire = null;
				state.inspected = true;
				if (state.source !== 'millennium') backendLog(`[NGL][Webpack] Reused Millennium module registry with ${state.moduleCache.size} native modules`);
				state.source = 'millennium';
				return true;
			}
		} catch (error) {
			backendLog(`[NGL][Webpack] Millennium module registry unavailable: ${error}`);
		}
		return false;
	}

	private probeAvailableWindowRuntime(win: Window, state: SteamWebpackRuntimeState): boolean {
		try {
			const target = win as any, chunks = target.webpackChunksteamui || target.webpackChunk || target.webpackJsonp;
			if (!chunks || typeof chunks.push !== 'function') return false;
			// New bootstrap arrays are checked immediately. A not-yet-initialized
			// existing array retries at most twice a second, even under route/paint
			// and repeated equivalent-authorization calls.
			if (chunks === state.lastWindowProbeSource && Date.now() - state.lastProbeTime < 500) return false;
			return this.captureWindowRuntime(win, state);
		} catch { return false; }
	}

	private verifySharedAuthorization(doc: Document, authorization: SharedRuntimeAuthorization): boolean {
		if (!this.isLiveDocument(doc) || !this.isLiveDocument(authorization.ownerDocument)) return false;
		try { return authorization.verify() === true; }
		catch { return false; }
	}

	private resolveSharedOwnerState(authorization: SharedRuntimeAuthorization): SteamWebpackRuntimeState | null {
		const doc = authorization.ownerDocument;
		if (!this.isLiveDocument(doc)) return null;
		const state = this.resolveState(doc);
		// One explicit native ownership edge is sufficient; accepting chains would
		// let unrelated popup registrations transitively lend another CEF runtime.
		if (!state || state.shared) return null;
		if (state.requireFn) this.syncRequireCache(state);
		else if (state.source === 'millennium') this.captureMillenniumFallback(state);
		return state;
	}

	private isSharedLeaseCurrent(win: Window, state: SteamWebpackRuntimeState): boolean {
		const lease = state.shared, doc = state.document;
		if (!lease || !doc || this.states.get(win) !== state || !this.verifySharedAuthorization(doc, lease.authorization)) return false;
		const ownerDoc = lease.authorization.ownerDocument, ownerWin = ownerDoc.defaultView;
		if (!ownerWin || this.states.get(ownerWin) !== lease.ownerState || lease.ownerState.document !== ownerDoc || lease.ownerState.shared) return false;
		if (lease.ownerState.requireFn) this.syncRequireCache(lease.ownerState);
		else if (lease.ownerState.source === 'millennium') this.captureMillenniumFallback(lease.ownerState);
		return lease.ownerState.identity === lease.ownerIdentity && lease.ownerState.rawRequire === state.rawRequire;
	}

	private syncSharedCache(state: SteamWebpackRuntimeState): void {
		const win = state.document?.defaultView;
		if (!win || !this.isSharedLeaseCurrent(win, state)) return;
		const lease = state.shared!, ownerState = lease.ownerState;
		// Source replacements/removals revoke this lease through ownerIdentity.
		// Lazy presentation exports can grow it without requiring a new lease.
		// Reuse both maps on the hot route/paint path instead of allocating every
		// already loaded Steam export again for each ownership lookup.
		if (lease.copiedModuleCount !== ownerState.moduleCache.size) {
			state.moduleCache = new Map(ownerState.moduleCache);
			lease.copiedModuleCount = ownerState.moduleCache.size;
		}
		if (lease.copiedFactoryCount !== ownerState.loadedFactories.size) {
			state.loadedFactories = new Map(ownerState.loadedFactories);
			lease.copiedFactoryCount = ownerState.loadedFactories.size;
		}
		state.factorySource = ownerState.factorySource;
	}

	private captureAuthorizedSharedRuntime(win: Window, state: SteamWebpackRuntimeState): boolean {
		const doc = state.document, authorization = doc && this.sharedDocuments.get(doc);
		if (!doc || !authorization || !this.verifySharedAuthorization(doc, authorization)) return false;
		const ownerState = this.resolveSharedOwnerState(authorization);
		if (!ownerState || !this.verifySharedAuthorization(doc, authorization)) return false;
		this.adoptSharedRuntime(win, state, authorization, ownerState);
		this.activeWindow = win;
		return true;
	}

	private adoptSharedRuntime(win: Window, state: SteamWebpackRuntimeState, authorization: SharedRuntimeAuthorization, ownerState: SteamWebpackRuntimeState): void {
		state.shared = { authorization, ownerState, ownerIdentity: ownerState.identity, copiedModuleCount: -1, copiedFactoryCount: -1 };
		state.rawRequire = ownerState.rawRequire;
		state.requireFn = typeof ownerState.rawRequire === 'function' ? this.ownedRequire(win, state, ownerState.rawRequire) : null;
		state.source = 'shared';
		state.inspected = true;
		state.identity = {};
		this.syncSharedCache(state);
		this.bindWindowUnload(win, state);
		backendLog(`[NGL][Webpack] Native-owned shared CEF runtime authorized with ${state.moduleCache.size} loaded modules`);
	}

	private ownsPluginRegistry(win: Window | null, doc: Document | null): boolean {
		if (typeof window === 'undefined' || win !== window || !doc || window.document !== doc) return false;
		// Some headless fixtures create their Window after importing the module.
		// A real CEF binds its registry owner at construction and never transfers it.
		if (!this.registryWindow && !this.registryDocument) { this.registryWindow = window; this.registryDocument = doc; }
		return this.registryWindow === win && this.registryDocument === doc;
	}

	private bindWindowUnload(win: Window, state: SteamWebpackRuntimeState): void {
		state.disposeListener();
		const unload = (event?: Event) => {
			if (this.states.get(win) !== state) return;
			// Steam Desktop can emit beforeunload while retaining its Document.
			// Preserve its local-runtime recovery; only a shared popup or an actual
			// unload permanently retires the Document ownership authorization.
			if (state.document && (state.shared || event?.type === 'unload')) this.retiredDocuments.add(state.document);
			backendLog('[NGL][Webpack] CEF window unloading, invalidating only its Webpack runtime');
			this.invalidateWindow(win, state);
		};
		win.addEventListener?.('beforeunload', unload);
		win.addEventListener?.('unload', unload);
		state.disposeListener = () => { win.removeEventListener?.('beforeunload', unload); win.removeEventListener?.('unload', unload); };
	}

	private invalidateWindow(win: Window, expected?: SteamWebpackRuntimeState): void {
		const current = this.states.get(win);
		if (expected && current !== expected) return;
		current?.disposeListener();
		this.states.delete(win);
		if (this.activeWindow === win) this.activeWindow = null;
		backendLog('[NGL][Webpack] Window-scoped runtime cache invalidated');
	}

	private isLiveDocument(doc: Document): boolean {
		try { return Boolean(!this.retiredDocuments.has(doc) && doc.defaultView && !doc.defaultView.closed && doc.defaultView.document === doc); }
		catch { return false; }
	}

	private collectTargetWindows(doc?: Document): Window[] {
		if (doc?.defaultView) return [doc.defaultView];
		const windows: Window[] = [];
		if (this.activeWindow && !this.activeWindow.closed) windows.push(this.activeWindow);
		if (typeof window !== 'undefined' && !windows.includes(window)) windows.push(window);
		const pm = typeof window !== 'undefined' ? (window as any)?.g_PopupManager : null;
		if (pm) {
			try {
				for (const name of ['SP BPM_uid0', 'SP BPM', 'SP Desktop_uid0', 'SP Desktop']) {
					const popup = pm.GetExistingPopup?.(name) || pm.m_mapPopups?.get?.(name);
					const pWin = popup?.m_popup?.window || popup?.window || popup?.m_popup;
					if (pWin && !pWin.closed && !windows.includes(pWin)) windows.push(pWin);
				}
			} catch {}
		}
		return windows;
	}
}

export const steamWebpackRuntime = new SteamWebpackRuntime();
