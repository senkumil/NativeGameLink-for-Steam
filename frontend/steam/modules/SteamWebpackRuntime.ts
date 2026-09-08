import { backendLog } from '../../api/backend';
import { modules as millenniumWebpackModules } from '@steambrew/client';

export interface WebpackModuleEntry {
	id: string | number;
	exports: any;
}

type RuntimeSource = 'none' | 'window' | 'millennium';

interface SteamWebpackRuntimeState {
	requireFn: any | null;
	moduleCache: Map<string | number, any>;
	inspected: boolean;
	lastProbeTime: number;
	source: RuntimeSource;
	identity: object;
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
	private boundWindows = new WeakSet<Window>();

	public captureRuntime(doc?: Document): boolean {
		const targetWindows = this.collectTargetWindows(doc);
		if (targetWindows.length === 0) return this.captureMillenniumFallback(this.fallbackState);

		for (const targetWin of targetWindows) {
			if (!targetWin || targetWin.closed) continue;
			const state = this.getOrCreateState(targetWin);
			this.activeWindow = targetWin;

			// A locally captured require() is authoritative for this CEF realm.
			if (state.inspected && state.requireFn) {
				this.syncRequireCache(state);
				return true;
			}

			const now = Date.now();
			if (now - state.lastProbeTime < 500) return state.inspected;
			state.lastProbeTime = now;

			if (this.captureWindowRuntime(targetWin, state)) return true;
			if (this.captureMillenniumFallback(state)) {
				this.bindWindowUnload(targetWin);
				return true;
			}

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
			this.invalidateWindow(win);
			return;
		}
		this.fallbackState = this.createState();
		backendLog('[NGL][Webpack] Fallback runtime cache invalidated');
	}

	public getAllModules(doc?: Document): WebpackModuleEntry[] {
		const state = this.resolveState(doc);
		if (!state) return [];
		if (state.requireFn) this.syncRequireCache(state);
		else this.captureMillenniumFallback(state);
		const result: WebpackModuleEntry[] = [];
		for (const [id, exports] of state.moduleCache) result.push({ id, exports });
		return result;
	}

	public getRequire(doc?: Document): any | null {
		return this.resolveState(doc)?.requireFn ?? null;
	}

	/** Unique token for the currently selected realm/runtime generation. */
	public getRuntimeIdentity(doc?: Document): object | null {
		this.getAllModules(doc);
		return this.resolveState(doc)?.identity ?? null;
	}

	public async ensureChunk(chunkId: number | string, doc?: Document): Promise<boolean> {
		const req = this.getRequire(doc);
		if (req && typeof req.e === 'function') {
			try {
				const state = this.resolveState(doc);
				const previousSize = state?.moduleCache.size || 0;
				await req.e(chunkId);
				if (state) {
					this.syncRequireCache(state);
					if (state.moduleCache.size !== previousSize) state.identity = {};
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
			requireFn: null,
			moduleCache: new Map<string | number, any>(),
			inspected: false,
			lastProbeTime: 0,
			source: 'none',
			identity: {},
		};
	}

	private getOrCreateState(win: Window): SteamWebpackRuntimeState {
		let state = this.states.get(win);
		if (!state) {
			state = this.createState();
			this.states.set(win, state);
		}
		return state;
	}

	private resolveState(doc?: Document): SteamWebpackRuntimeState | null {
		const requestedWindow = doc?.defaultView || null;
		if (requestedWindow) {
			this.activeWindow = requestedWindow;
			let state = this.states.get(requestedWindow);
			if (!state?.inspected) {
				this.captureRuntime(doc);
				state = this.states.get(requestedWindow);
			}
			return state?.inspected ? state : null;
		}

		if (this.activeWindow && !this.activeWindow.closed) {
			const activeState = this.states.get(this.activeWindow);
			if (activeState?.inspected) return activeState;
		}

		if (typeof window !== 'undefined') {
			const globalState = this.states.get(window);
			if (globalState?.inspected) {
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

			if (capturedRequire && typeof capturedRequire.c === 'object') {
				state.requireFn = capturedRequire;
				state.moduleCache.clear();
				this.syncRequireCache(state);
				state.inspected = true;
				state.source = 'window';
				state.identity = {};
				this.bindWindowUnload(targetWin);
				backendLog(`[NGL][Webpack] Runtime captured for CEF window with ${state.moduleCache.size} loaded modules`);
				return true;
			}
		} catch (error) {
			backendLog(`[NGL][Webpack] Error during window-scoped Webpack probe: ${error}`);
		}
		return false;
	}

	private syncRequireCache(state: SteamWebpackRuntimeState): void {
		const cache = state.requireFn?.c;
		if (!cache || typeof cache !== 'object') return;
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

	private bindWindowUnload(win: Window): void {
		if (this.boundWindows.has(win)) return;
		this.boundWindows.add(win);
		win.addEventListener('beforeunload', () => {
			backendLog('[NGL][Webpack] CEF window unloading, invalidating only its Webpack runtime');
			this.invalidateWindow(win);
		});
	}

	private invalidateWindow(win: Window): void {
		this.states.delete(win);
		if (this.activeWindow === win) this.activeWindow = null;
		backendLog('[NGL][Webpack] Window-scoped runtime cache invalidated');
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
