import { backendLog } from '../../api/backend';
import { modules as millenniumWebpackModules } from '@steambrew/client';

export interface WebpackModuleEntry {
	id: string | number;
	exports: any;
}

class SteamWebpackRuntime {
	private requireFn: any = null;
	private moduleCache = new Map<string | number, any>();
	private inspected = false;
	private lastProbeTime = 0;
	private boundWindows = new WeakSet<Window>();

	public captureRuntime(doc?: Document): boolean {
		if (this.inspected && (this.requireFn || this.moduleCache.size > 0)) return true;

		const now = Date.now();
		if (now - this.lastProbeTime < 500) {
			return this.inspected;
		}
		this.lastProbeTime = now;

		const targetWindows = this.collectTargetWindows(doc);
		for (const targetWin of targetWindows) {
			const chunkArray = targetWin.webpackChunksteamui || targetWin.webpackChunk || targetWin.webpackJsonp;
			if (!chunkArray || typeof chunkArray.push !== 'function') continue;

			try {
				const probeId = Symbol('ngl_webpack_runtime_probe');
				chunkArray.push([
					[probeId],
					{},
					(req: any) => {
						this.requireFn = req;
					},
				]);

				if (this.requireFn && typeof this.requireFn.c === 'object') {
					const cache = this.requireFn.c;
					const keys = Object.keys(cache);
					backendLog(`[NGL][Webpack] Runtime captured successfully from window, found ${keys.length} loaded modules in registry`);

					for (const key of keys) {
						const mod = cache[key]?.exports;
						if (mod) {
							this.moduleCache.set(key, mod);
						}
					}
					this.inspected = true;
					this.bindWindowUnload(targetWin);
					return true;
				}
			} catch (error) {
				backendLog(`[NGL][Webpack] Error during Webpack probe: ${error}`);
			}
		}

		// Millennium's client bridge captures Steam's Webpack registry before the
		// plugin starts. Big Picture popup windows do not always re-expose the
		// webpackChunksteamui global, but the already-captured native exports are
		// still valid and are the authoritative fallback for that window.
		try {
			for (const [id, exports] of millenniumWebpackModules) {
				if (exports) this.moduleCache.set(id, exports);
			}
			if (this.moduleCache.size > 0) {
				this.inspected = true;
				backendLog(`[NGL][Webpack] Reused Millennium module registry with ${this.moduleCache.size} native modules`);
				return true;
			}
		} catch (error) {
			backendLog(`[NGL][Webpack] Millennium module registry unavailable: ${error}`);
		}

		return false;
	}

	public invalidate(): void {
		this.requireFn = null;
		this.moduleCache.clear();
		this.inspected = false;
		this.lastProbeTime = 0;
		backendLog('[NGL][Webpack] Runtime cache invalidated');
	}

	public getAllModules(): WebpackModuleEntry[] {
		if (!this.inspected) this.captureRuntime();
		const result: WebpackModuleEntry[] = [];
		for (const [id, exports] of this.moduleCache) {
			result.push({ id, exports });
		}
		return result;
	}

	public getRequire(): any | null {
		if (!this.inspected) this.captureRuntime();
		return this.requireFn;
	}

	public async ensureChunk(chunkId: number | string): Promise<boolean> {
		const req = this.getRequire();
		if (req && typeof req.e === 'function') {
			try {
				await req.e(chunkId);
				this.captureRuntime();
				return true;
			} catch (err) {
				backendLog(`[NGL][Webpack] Failed to load chunk ${chunkId}: ${err}`);
			}
		}
		return false;
	}

	private bindWindowUnload(win: Window): void {
		if (this.boundWindows.has(win)) return;
		this.boundWindows.add(win);
		win.addEventListener('beforeunload', () => {
			backendLog('[NGL][Webpack] Window unloading, resetting captured Webpack runtime');
			this.invalidate();
		});
	}

	private collectTargetWindows(doc?: Document): any[] {
		const windows: any[] = [];
		if (doc?.defaultView) windows.push(doc.defaultView);
		if (typeof window !== 'undefined') windows.push(window);
		const pm = (window as any)?.g_PopupManager;
		if (pm) {
			try {
				for (const name of ['SP BPM_uid0', 'SP BPM', 'SP Desktop_uid0', 'SP Desktop']) {
					const popup = pm.GetExistingPopup?.(name) || pm.m_mapPopups?.get?.(name);
					const pWin = popup?.m_popup?.window || popup?.window || popup?.m_popup;
					if (pWin && !windows.includes(pWin)) windows.push(pWin);
				}
			} catch {}
		}
		return windows;
	}
}

export const steamWebpackRuntime = new SteamWebpackRuntime();
