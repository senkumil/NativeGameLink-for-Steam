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

function resetRuntimeBoundCaches(doc?: Document): void {
	achievementsResolver.invalidate(doc);
	activityResolver.invalidate(doc);
	friendsResolver.invalidate(doc);
	gameDetailsResolver.invalidate(doc);
	gameInfoResolver.invalidate(doc);
	heroResolver.invalidate(doc);
	newsResolver.invalidate(doc);
	playbarResolver.invalidate(doc);
	clearNativeAppDetailsClassCache(doc);
	clearNativeComponentsCache(doc);
	gamepadCapabilities.resetCircuitBreakers(doc);
}

class GamepadRuntime {
	private initializedDocuments = new WeakSet<Document>();
	private activeDocument: Document | null = null;
	private reloadBindings = new Map<Document, { window: Window; listener: () => void }>();

	public initialize(doc?: Document): boolean {
		const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
		if (!targetDoc || !targetDoc.defaultView || targetDoc.defaultView.closed || targetDoc.defaultView.document !== targetDoc) return false;
		if (this.initializedDocuments.has(targetDoc)) { this.activeDocument = targetDoc; return true; }

		for (const previous of Array.from(this.reloadBindings.keys())) {
			if (previous !== targetDoc && previous.defaultView === targetDoc.defaultView) this.invalidate(previous);
		}
		this.activeDocument = targetDoc;

		backendLog('[NGL][Gamepad][Runtime] Probing window-scoped Webpack Runtime for Gamepad UI...');
		const captured = steamWebpackRuntime.captureRuntime(targetDoc);

		if (captured) {
			this.initializedDocuments.add(targetDoc);
			const targetWindow = targetDoc.defaultView as any;
			gamepadCapabilities.setAvailable('appStore', Boolean(targetWindow?.appStore || targetWindow?.AppStore), targetDoc);
			this.bindReloadDetection(targetDoc);
			backendLog('[NGL][Gamepad][Runtime] Gamepad Runtime captured and initialized successfully');
			return true;
		}

		this.initializedDocuments.delete(targetDoc);
		backendLog('[NGL][Gamepad][Runtime] Gamepad Webpack Runtime not yet available, will retry on next interaction');
		return false;
	}

	public getModules(doc?: Document): WebpackModuleEntry[] {
		const target = doc || this.activeDocument || undefined;
		if (!target || !this.initializedDocuments.has(target)) this.initialize(target);
		return steamWebpackRuntime.getAllModules(target);
	}

	public getRequire(doc?: Document): any | null {
		const target = doc || this.activeDocument || undefined;
		if (!target || !this.initializedDocuments.has(target)) this.initialize(target);
		return steamWebpackRuntime.getRequire(target);
	}

	public isReady(doc?: Document): boolean {
		const target = doc || this.activeDocument;
		return Boolean(target && this.initializedDocuments.has(target));
	}

	public invalidate(doc?: Document): void {
		if (doc) {
			if (!this.initializedDocuments.has(doc) && !this.reloadBindings.has(doc)) return;
			this.initializedDocuments.delete(doc);
			this.unbindReloadDetection(doc);
			if (this.activeDocument === doc) this.activeDocument = null;
			resetRuntimeBoundCaches(doc);
			return;
		}
		for (const target of Array.from(this.reloadBindings.keys())) this.unbindReloadDetection(target);
		this.initializedDocuments = new WeakSet();
		this.activeDocument = null;
		resetRuntimeBoundCaches();
		backendLog('[NGL][Gamepad][Runtime] Runtime invalidated and realm-bound caches reset');
	}

	private bindReloadDetection(doc: Document): void {
		const win = doc.defaultView;
		if (!win || this.reloadBindings.has(doc)) return;
		const binding = { window: win, listener: () => {
			if (this.reloadBindings.get(doc) !== binding) return;
			backendLog('[NGL][Gamepad][Runtime] Steam Gamepad UI unloading, invalidating its document runtime state');
			this.invalidate(doc);
		} };
		this.reloadBindings.set(doc, binding);
		win.addEventListener('beforeunload', binding.listener);
	}

	private unbindReloadDetection(doc: Document): void {
		const binding = this.reloadBindings.get(doc);
		this.reloadBindings.delete(doc);
		if (binding) {
			try { binding.window.removeEventListener('beforeunload', binding.listener); } catch {}
		}
	}
}

export const gamepadRuntime = new GamepadRuntime();
