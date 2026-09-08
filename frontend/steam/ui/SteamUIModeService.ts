import { backendLog } from '../../api/backend';

export type SteamUIModeType = 'desktop' | 'gamepad';

export interface SteamUIModeState {
	mode: SteamUIModeType;
	isGamepadUI: boolean;
	isDesktop: boolean;
	modeNumber: number;
}

type UIModeListener = (state: SteamUIModeState) => void;

class SteamUIModeService {
	private currentMode: SteamUIModeType = 'desktop';
	private currentModeNumber: number = 7;
	private listeners = new Set<UIModeListener>();
	private unregisterNative: (() => void) | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private nativeModeListenerRegistered = false;
	private initialized = false;

	public initialize(): void {
		if (this.initialized) return;
		const win = typeof window !== 'undefined' ? (window as any) : null;
		if (win && win.__GDL_STEAM_UI_MODE_SERVICE__ && win.__GDL_STEAM_UI_MODE_SERVICE__ !== this) {
			try { win.__GDL_STEAM_UI_MODE_SERVICE__.dispose(); } catch {}
		}
		if (win) win.__GDL_STEAM_UI_MODE_SERVICE__ = this;
		this.initialized = true;

		// 1. Native SteamClient.UI API (preferred)
		try {
			const steamUi = (window as unknown as { SteamClient?: { UI?: { GetUIMode?: () => Promise<number>; RegisterForUIModeChanged?: (cb: (mode: number) => void) => () => void } } })?.SteamClient?.UI;
			if (typeof steamUi?.GetUIMode === 'function') {
				void steamUi.GetUIMode().then((mode: number | undefined) => {
					if (mode !== undefined) {
						this.handleModeNumberChange(Number(mode));
					}
				}).catch(() => {});
			}
			if (typeof steamUi?.RegisterForUIModeChanged === 'function') {
				const unregister = steamUi.RegisterForUIModeChanged((mode: number) => {
					this.handleModeNumberChange(Number(mode));
				});
				if (typeof unregister === 'function') {
					this.unregisterNative = unregister;
					this.nativeModeListenerRegistered = true;
				}
			}
		} catch (error) {
			backendLog(`[NGL][SteamUI] Failed to register SteamClient.UI listener: ${error}`);
		}

		// 2. Initial surface check
		this.detectFromEnvironment();

		// 3. Periodic fallback poll to detect mode transitions when native callbacks miss
		if (!this.pollTimer) {
			// Native callbacks are authoritative. Keep only a low-frequency safety
			// poll when they are available; older Steam builds without callbacks
			// still get a modest fallback cadence.
			const pollMs = this.nativeModeListenerRegistered ? 5000 : 2500;
			this.pollTimer = setInterval(() => {
				this.checkCurrentMode();
			}, pollMs);
		}
	}

	public dispose(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.unregisterNative) {
			try { this.unregisterNative(); } catch {}
			this.unregisterNative = null;
		}
		this.nativeModeListenerRegistered = false;
		this.listeners.clear();
		this.initialized = false;
	}

	public getState(): SteamUIModeState {
		return {
			mode: this.currentMode,
			isGamepadUI: this.currentMode === 'gamepad',
			isDesktop: this.currentMode === 'desktop',
			modeNumber: this.currentModeNumber,
		};
	}

	public isGamepadUI(doc?: Document | null): boolean {
		if (doc) return this.isDocumentGamepadSurface(doc);
		return this.currentMode === 'gamepad';
	}

	public isDesktop(doc?: Document | null): boolean {
		return !this.isGamepadUI(doc);
	}

	public subscribe(listener: UIModeListener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => this.listeners.delete(listener);
	}

	public isDocumentGamepadSurface(doc: Document): boolean {
		if (!doc) return false;
		const view = doc.defaultView as any;
		const href = String(view?.location?.href || doc.location?.href || '');
		if (/(?:gamepadui|bigpicture|tenfoot)/i.test(href)) return true;
		if (doc.title && /Big Picture/i.test(doc.title)) return true;
		if (doc.documentElement && (doc.documentElement.classList.contains('GamepadUI') || doc.documentElement.classList.contains('gamepadui'))) return true;
		if (doc.body) {
			if (doc.body.classList.contains('GamepadUI') || doc.body.classList.contains('gamepadui')) return true;
		}
		if (typeof doc.querySelector === 'function') {
			if (doc.querySelector('.GamepadUI, .gamepadui, [class*="GamepadUI"], [class*="gamepadui"]')) return true;
		}
		return false;
	}

	private handleModeNumberChange(modeNumber: number): void {
		this.currentModeNumber = modeNumber;
		// Steam UI Modes: 4 = GamepadUI (Big Picture), 7 = Desktop, 0/1 = Standard
		const newMode: SteamUIModeType = modeNumber === 4 ? 'gamepad' : 'desktop';
		if (newMode !== this.currentMode) {
			this.currentMode = newMode;
			backendLog(`[NGL][SteamUI] UI Mode changed to: ${newMode.toUpperCase()} (modeNumber=${modeNumber})`);
			this.notify();
		}
	}

	public checkCurrentMode(): void {
		try {
			const steamUi = (window as any).SteamClient?.UI;
			if (typeof steamUi?.GetUIMode === 'function') {
				void steamUi.GetUIMode().then((mode: number | undefined) => {
					if (mode !== undefined) {
						this.handleModeNumberChange(Number(mode));
					}
				}).catch(() => {
					this.detectFromEnvironment();
				});
			} else {
				this.detectFromEnvironment();
			}
		} catch {
			this.detectFromEnvironment();
		}
	}

	private detectFromEnvironment(): void {
		if (typeof document !== 'undefined') {
			const isGamepad = this.isDocumentGamepadSurface(document);
			if (isGamepad && this.currentMode !== 'gamepad') {
				this.handleModeNumberChange(4);
			} else if (!isGamepad && this.currentMode !== 'desktop') {
				this.handleModeNumberChange(7);
			}
		}
	}

	private notify(): void {
		const state = this.getState();
		for (const listener of Array.from(this.listeners)) {
			try { listener(state); } catch (error) {
				backendLog(`[NGL][SteamUI] Error in UI mode listener: ${error}`);
			}
		}
	}
}

export const steamUIModeService = new SteamUIModeService();
