import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { isPublicSteamLibraryRoute, libraryRouteIdentity } from '../library/native-route';

/** Refresh only the live GamepadUI document that requested it. A pending
 * refresh loses authority when its route, document, mode or session changes. */
export class GamepadRerenderScheduler {
	private lastRerenderTime = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending: (() => void) | null = null;

	request(doc: Document | null, isActive: () => boolean): void {
		if (!doc) return;
		const view = doc.defaultView;
		let route: string;
		try { route = libraryRouteIdentity(doc); } catch { return; }
		const current = (): boolean => {
			try {
				return Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected && !doc.hidden
					&& isActive() && steamUIModeService.isGamepadUI(doc) && !isPublicSteamLibraryRoute(doc)
					&& libraryRouteIdentity(doc) === route);
			} catch { return false; }
		};
		if (!current()) return;
		const render = (): void => {
			if (!current()) return;
			this.lastRerenderTime = Date.now();
			try { (view as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(); } catch {}
		};
		const now = Date.now();
		if (now - this.lastRerenderTime < 1500) {
			this.pending = render;
			if (!this.timer) {
				this.timer = setTimeout(() => {
					this.timer = null;
					const latest = this.pending;
					this.pending = null;
					latest?.();
				}, 1500 - (now - this.lastRerenderTime));
			}
			return;
		}
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
		render();
	}

	cancel(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
		this.lastRerenderTime = 0;
	}
}
