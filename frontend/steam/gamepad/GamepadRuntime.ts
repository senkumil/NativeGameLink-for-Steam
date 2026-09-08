import { backendLog } from '../../api/backend';
import { steamWebpackRuntime, type WebpackModuleEntry } from '../modules/SteamWebpackRuntime';
import { gamepadCapabilities } from './GamepadCapabilities';
import { achievementsResolver } from './components/AchievementsResolver';
import { activityResolver } from './components/ActivityResolver';
import { friendsResolver } from './components/FriendsResolver';
import { gameDetailsResolver } from './components/GameDetailsResolver';
import { gameInfoResolver } from './components/GameInfoResolver';
import { heroResolver } from './components/HeroResolver';
import { newsResolver } from './components/NewsResolver';
import { playbarResolver } from './components/PlaybarResolver';
import { clearNativeAppDetailsClassCache } from './components/AppDetailsNativeClasses';
import { clearNativeComponentsCache } from './components/AppDetailsNativeComponents';

function resetRuntimeBoundCaches(): void {
	achievementsResolver.invalidate();
	activityResolver.invalidate();
	friendsResolver.invalidate();
	gameDetailsResolver.invalidate();
	gameInfoResolver.invalidate();
	heroResolver.invalidate();
	newsResolver.invalidate();
	playbarResolver.invalidate();
	clearNativeAppDetailsClassCache();
	clearNativeComponentsCache();
	gamepadCapabilities.resetCircuitBreakers();
}

class GamepadRuntime {
	private initialized = false;
	private activeDocument: Document | null = null;
	private reloadWindows = new WeakSet<Window>();

	public initialize(doc?: Document): boolean {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
		if (!targetDoc) return false;
		if (this.initialized && this.activeDocument === targetDoc) return true;

		if (this.activeDocument && this.activeDocument !== targetDoc) {
			backendLog('[NGL][Gamepad][Runtime] CEF document changed; clearing realm-bound native resolver caches');
			resetRuntimeBoundCaches();
		}
		this.activeDocument = targetDoc;

		backendLog('[NGL][Gamepad][Runtime] Probing window-scoped Webpack Runtime for Gamepad UI...');
		const captured = steamWebpackRuntime.captureRuntime(targetDoc);

		if (captured) {
			this.initialized = true;
			const targetWindow = targetDoc.defaultView as any;
			gamepadCapabilities.setAvailable('appStore', Boolean(targetWindow?.appStore || targetWindow?.AppStore || (window as any)?.appStore || (window as any)?.AppStore));
			this.bindReloadDetection(targetDoc);
			backendLog('[NGL][Gamepad][Runtime] Gamepad Runtime captured and initialized successfully');
			return true;
		}

		this.initialized = false;
		backendLog('[NGL][Gamepad][Runtime] Gamepad Webpack Runtime not yet available, will retry on next interaction');
		return false;
	}

	public getModules(): WebpackModuleEntry[] {
		if (!this.initialized) this.initialize(this.activeDocument || undefined);
		return steamWebpackRuntime.getAllModules(this.activeDocument || undefined);
	}

	public getRequire(): any | null {
		if (!this.initialized) this.initialize(this.activeDocument || undefined);
		return steamWebpackRuntime.getRequire(this.activeDocument || undefined);
	}

	public isReady(): boolean {
		return this.initialized;
	}

	public invalidate(doc?: Document): void {
		if (doc && this.activeDocument && doc !== this.activeDocument) return;
		this.initialized = false;
		this.activeDocument = null;
		resetRuntimeBoundCaches();
		backendLog('[NGL][Gamepad][Runtime] Runtime invalidated and realm-bound caches reset');
	}

	private bindReloadDetection(doc: Document): void {
		const win = doc.defaultView;
		if (!win || this.reloadWindows.has(win)) return;
		this.reloadWindows.add(win);
		win.addEventListener('beforeunload', () => {
			if (this.activeDocument !== doc) return;
			backendLog('[NGL][Gamepad][Runtime] Steam Gamepad UI unloading, invalidating active runtime state');
			this.invalidate(doc);
		});
	}
}

export const gamepadRuntime = new GamepadRuntime();
