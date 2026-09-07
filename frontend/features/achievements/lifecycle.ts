import type { LocalAchievementData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { cacheLocalAchievements, clearLocalAchievementCache, localAchievementDataSignature } from './cache';
import { achievementRuntimeHost, clearAchievementRuntimeHost } from './context';
import { openLocalAchievementsModal } from './modal';
import { detectLinkedSteamAppId } from './navigation';
import { disposeAchievementNotifications } from './notifications';
import { ensureLocalPlaybarStat } from './playbar';
import { clearLocalAchievementRequestCache, fetchLocalAchievementData, subscribeLocalAchievementData } from './service';
import { renderLocalAchievementSidebar } from './sidebar';
import { ensureLocalAchievementStyles } from './styles';
import { clearLocalAchievementGameInfoCache } from './game-info';

interface LocalAchievementDocumentState {
	timer: number | null;
	initialTimer: number | null;
	syncTimer: number | null;
	observer: MutationObserver | null;
	inFlight: boolean;
	pendingRefresh: boolean;
	signature: string;
	data: LocalAchievementData | null;
	refreshNow: () => void;
	cleanup: () => void;
}

export interface LocalAchievementRefreshTarget {
	steamAppId: string | number;
	stateAppId?: string | number | null;
}

const localAchievementDocState = new WeakMap<Document, LocalAchievementDocumentState>();
const localAchievementDocuments = new Set<Document>();
export const ACHIEVEMENT_REFRESH_STORAGE_KEY = 'gdl_achievement_refresh_v1';
let achievementRefreshStorageInstalled = false;

interface AchievementRefreshMessage {
	steamAppId?: string;
	stateAppId?: string;
	nonce?: string;
}

function parseAchievementRefreshMessage(value: string | null): LocalAchievementRefreshTarget | undefined {
	if (!value) return undefined;
	try {
		const message = JSON.parse(value) as AchievementRefreshMessage;
		return message && /^\d+$/.test(String(message.steamAppId || ''))
			? { steamAppId: String(message.steamAppId), stateAppId: String(message.stateAppId || '') }
			: undefined;
	} catch { return undefined; }
}

function currentDocShortcutAppId(doc: Document): string | null {
	const current = achievementRuntimeHost().getCurrentInjectedShortcutAppId();
	if (current && /^\d+$/.test(current)) return current;
	const bpRoot = doc.getElementById('gdl-bp-detail-root') as HTMLElement | null;
	if (bpRoot?.dataset?.gdlShortcutAppId && /^\d+$/.test(bpRoot.dataset.gdlShortcutAppId)) {
		return bpRoot.dataset.gdlShortcutAppId;
	}
	return null;
}

function isShortcutRunning(shortcutAppId: string | number | null): boolean {
	const target = Number(shortcutAppId);
	if (!Number.isFinite(target) || target <= 0) return false;
	const runningApps = (window as any).SteamUIStore?.RunningApps as Set<any> | undefined;
	if (!runningApps || typeof runningApps[Symbol.iterator] !== 'function') return false;
	for (const app of runningApps) {
		const raw = Number(app?.appid ?? app?.m_unAppID);
		const normalized = raw < 0 ? (raw >>> 0) : raw;
		if (normalized === target) return true;
	}
	return false;
}

export function disposeLocalAchievementUI(doc: Document): void {
	const state = localAchievementDocState.get(doc);
	if (!state) return;
	localAchievementDocState.delete(doc);
	localAchievementDocuments.delete(doc);
	state.cleanup();
}

export function installLocalAchievementUI(doc: Document): void {
	if (localAchievementDocState.has(doc)) return;
	installAchievementRefreshStorageListener();
	ensureLocalAchievementStyles(doc);

	let disposed = false;
	const state: LocalAchievementDocumentState = {
		timer: null,
		initialTimer: null,
		syncTimer: null,
		observer: null,
		inFlight: false,
		pendingRefresh: false,
		signature: '',
		data: null,
		refreshNow: () => {},
		cleanup: () => {},
	};

	const stopPolling = (): void => {
		if (state.timer !== null) window.clearInterval(state.timer);
		state.timer = null;
	};
	const applyData = (appid: string, data: LocalAchievementData | null): void => {
		if (disposed || !data?.found || !Array.isArray(data.achievements) || data.total <= 0) {
			if (data && state.signature !== `unavailable:${appid}`) {
				backendLog(`Local achievements bridge returned no data for ${appid}`);
				state.signature = `unavailable:${appid}`;
			}
			return;
		}
		const shortcutAppId = currentDocShortcutAppId(doc);
		cacheLocalAchievements(data, appid, shortcutAppId);
		state.data = data;
		const signature = localAchievementDataSignature(data);
		const host = doc.querySelector('#gdl-achievements-content [data-gdl-local-ach="1"]');
		// A persisted snapshot may already have painted the exact current result
		// before the backend round trip finishes. Keep that DOM intact so icons do
		// not disappear/reappear when validation returns identical data.
		if (!host || host.getAttribute('data-gdl-achievement-signature') !== signature) {
			renderLocalAchievementSidebar(doc, data);
		}
		state.signature = signature;
		ensureLocalPlaybarStat(doc, data);
	};

	const refresh = async (force = false): Promise<void> => {
		if (disposed || (!force && doc.hidden) || !doc.body || doc.defaultView?.closed) return;
		if (state.inFlight) { state.pendingRefresh = true; return; }
		const appid = detectLinkedSteamAppId(doc);
		if (!appid) {
			state.signature = '';
			state.data = null;
			stopPolling();
			return;
		}
		state.inFlight = true;
		try {
			const data = await fetchLocalAchievementData(appid, {
				stateAppId: currentDocShortcutAppId(doc),
			});
			if (disposed || detectLinkedSteamAppId(doc) !== appid) return;
			applyData(appid, data);
		} catch (error) {
			if (!disposed) backendLog('Local achievements bridge error: ' + String(error));
		} finally {
			state.inFlight = false;
			if (state.pendingRefresh && !disposed) {
				state.pendingRefresh = false;
				void refresh(true);
			}
		}
	};

	state.refreshNow = () => {
		state.signature = '';
		void refresh(true);
	};

	const syncPolling = (): void => {
		if (disposed || doc.hidden || !doc.body || doc.defaultView?.closed || !detectLinkedSteamAppId(doc)) {
			stopPolling();
			return;
		}
		// The launch watcher owns the 2 s live-progress read while the shortcut is
		// running. This document receives the same result through the service bus.
		if (isShortcutRunning(currentDocShortcutAppId(doc))) {
			stopPolling();
			return;
		}
		if (state.timer === null) state.timer = window.setInterval(() => { void refresh(); }, 5000);
		void refresh();
	};
	const schedulePollingSync = (): void => {
		if (disposed || state.syncTimer !== null) return;
		state.syncTimer = window.setTimeout(() => {
			state.syncTimer = null;
			syncPolling();
		}, 180);
	};

	const intercept = (event: Event): void => {
		const target = event.target as Element | null;
		if (!target?.closest?.('#gdl-achievements-section') || !state.data) return;
		if (state.data.appid !== detectLinkedSteamAppId(doc)) return;
		event.preventDefault();
		event.stopPropagation();
		(event as any).stopImmediatePropagation?.();
		void openLocalAchievementsModal(doc, state.data).catch(error => backendLog('Achievements modal error: ' + error));
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if ((event.key === 'Enter' || event.key === ' ') && (event.target as Element | null)?.closest?.('#gdl-achievements-section')) intercept(event);
	};

	doc.addEventListener('click', intercept, true);
	doc.addEventListener('keydown', onKeyDown, true);
	doc.addEventListener('visibilitychange', syncPolling);
	state.observer = new MutationObserver(mutations => {
		const isExternalMutation = mutations.some(m => {
			const target = m.target as HTMLElement | null;
			if (target?.closest?.('[data-gdl-playbar-achievements], #gdl-library-injected, #gdl-achievements-content, #gdl-playbar-achievements')) {
				return false;
			}
			return true;
		});
		if (isExternalMutation) schedulePollingSync();
	});
	state.observer.observe(doc.body, { childList: true, subtree: true });
	const unsubscribeData = subscribeLocalAchievementData(update => {
		const appid = detectLinkedSteamAppId(doc);
		if (!appid || appid !== update.steamAppId) return;
		const shortcutAppId = currentDocShortcutAppId(doc);
		if (update.stateAppId && shortcutAppId && update.stateAppId !== String(shortcutAppId)) return;
		applyData(appid, update.data);
	});
	syncPolling();
	state.cleanup = () => {
		if (disposed) return;
		disposed = true;
		stopPolling();
		if (state.syncTimer !== null) window.clearTimeout(state.syncTimer);
		state.syncTimer = null;
		state.observer?.disconnect();
		state.observer = null;
		unsubscribeData();
		doc.removeEventListener('click', intercept, true);
		doc.removeEventListener('keydown', onKeyDown, true);
		doc.removeEventListener('visibilitychange', syncPolling);
	};
	localAchievementDocState.set(doc, state);
	localAchievementDocuments.add(doc);
}

/** Refresh every active Steam surface after a global or per-game policy change.
 * A per-game caller can also provide the exact identities so the shared result
 * is published immediately, even when Steam's Properties window is a separate
 * document from the Library surface. */
function performLocalAchievementRefresh(target?: LocalAchievementRefreshTarget): void {
	clearLocalAchievementCache();
	clearLocalAchievementRequestCache();
	for (const doc of Array.from(localAchievementDocuments)) localAchievementDocState.get(doc)?.refreshNow();
	const steamAppId = String(target?.steamAppId ?? '');
	if (/^\d+$/.test(steamAppId)) {
		void fetchLocalAchievementData(steamAppId, {
			stateAppId: target?.stateAppId,
			maxAgeMs: 0,
		}).catch(error => backendLog('Targeted achievement refresh error: ' + String(error)));
	}
}

function installAchievementRefreshStorageListener(): void {
	if (achievementRefreshStorageInstalled) return;
	achievementRefreshStorageInstalled = true;
	window.addEventListener('storage', event => {
		if (event.key !== ACHIEVEMENT_REFRESH_STORAGE_KEY) return;
		performLocalAchievementRefresh(parseAchievementRefreshMessage(event.newValue));
	});
}

function broadcastLocalAchievementRefresh(target?: LocalAchievementRefreshTarget): void {
	try {
		localStorage.setItem(ACHIEVEMENT_REFRESH_STORAGE_KEY, JSON.stringify({
			steamAppId: target?.steamAppId == null ? '' : String(target.steamAppId),
			stateAppId: target?.stateAppId == null ? '' : String(target.stateAppId),
			nonce: `${Date.now()}:${Math.random()}`,
		} satisfies AchievementRefreshMessage));
	} catch {}
}

/** Apply a policy change locally and notify other Steam web windows. Properties
 * and plugin Settings can live in a different CEF context from the Library, so
 * a module-local cache clear alone is not an observable hot update. */
export function refreshLocalAchievementUI(target?: LocalAchievementRefreshTarget): void {
	performLocalAchievementRefresh(target);
	broadcastLocalAchievementRefresh(target);
}

export function disposeAchievementRuntime(): void {
	for (const doc of Array.from(localAchievementDocuments)) disposeLocalAchievementUI(doc);
	disposeAchievementNotifications();
	// A Steam restart should retain the last confirmed snapshot for immediate
	// stale-while-revalidate painting. Explicit policy/path/language changes use
	// the default persistent clear through performLocalAchievementRefresh().
	clearLocalAchievementCache(false);
	clearLocalAchievementRequestCache();
	clearLocalAchievementGameInfoCache();
	clearAchievementRuntimeHost();
}
