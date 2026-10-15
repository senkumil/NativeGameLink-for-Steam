import { findModuleExport } from '@steambrew/client';
import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { getLocalAchievementGameInfo, clearLocalAchievementGameInfoCache } from './game-info';
import { gdlText } from '../../steam/localization';

interface LocalAchievementToastBaseline {
	version: 1;
	observed_at: number;
	earned: string[];
}

interface QueuedLocalAchievementToast {
	appid: string;
	achievement: LocalAchievementItem;
	shortcutAppId?: string;
}

interface ActiveNativeAchievementToast {
	store: any;
	notificationId: number;
	notification?: any;
	presentationElement?: HTMLElement;
	stopPresentationObserver?: () => void;
}

export type NativeAchievementToastWindowKind = 'overlay' | 'bigpicture' | 'desktop';

interface NativeAchievementToastWindow {
	window: Window;
	kind: NativeAchievementToastWindowKind;
	label: string;
	registeredAt: number;
}

const LOCAL_ACHIEVEMENT_TOAST_STATE_PREFIX = 'gdl:achievement-toast:v1:';
// v2 supersedes the eager RunningApps-only marker. Games whose v1 replay was
// consumed before their window opened get one clean attempt with readiness gating.
const FIRST_LAUNCH_REPLAY_PREFIX = 'gdl:achievement-first-launch-replay:v2:';
const EVERY_LAUNCH_REPLAY_PREFIX = 'gdl:achievement-every-launch-replay:v1:';
const ACHIEVEMENT_REPLAY_PREFERENCES_EVENT = 'gdl:achievement-replay-preferences-changed';
const STEAM_ACHIEVEMENT_NOTIFICATION_TYPE = 5;
const STEAM_ACHIEVEMENT_TOAST_DURATION_MS = 5000;
const STEAM_ACHIEVEMENT_TOAST_GAP_MS = 5000;
const NATIVE_ACHIEVEMENT_TOAST_STYLE_ID = 'gdl-native-achievement-toast-style';
const NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS = 'gdl-native-achievement-toast-card';
const NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS = 'gdl-native-achievement-toast-title';
const NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS = 'gdl-native-achievement-toast-description';
const localAchievementToastBaselines = new Map<string, { observedAt: number; earned: Set<string> }>();
const localAchievementSessionToastedNames = new Map<string, Set<string>>();
const localAchievementToastQueue: QueuedLocalAchievementToast[] = [];
const nativeAchievementToastWindows = new Map<Window, NativeAchievementToastWindow>();
const MAX_ACHIEVEMENT_STATE_ENTRIES = 64;

function trimAchievementStateMaps(): void {
	for (const cache of [localAchievementToastBaselines, localAchievementSessionToastedNames]) {
		while (cache.size > MAX_ACHIEVEMENT_STATE_ENTRIES) {
			const oldest = cache.keys().next().value as string | undefined;
			if (!oldest) break;
			cache.delete(oldest);
		}
	}
}
let localAchievementToastTimer: ReturnType<typeof setTimeout> | null = null;
let localAchievementToastProcessing = false;
let localAchievementToastGeneration = 0;
let activeQueuedLocalAchievementToast: QueuedLocalAchievementToast | null = null;
let activeNativeAchievementToast: ActiveNativeAchievementToast | null = null;
let activeNativeAchievementToastTimer: number | null = null;
let activeFallbackAchievementToast: { dismiss: () => void } | null = null;
let nativeAchievementNotificationProto: any = null;
let nextSyntheticNotificationId = -1;

function syntheticNotificationId(store: any): number {
	const used = new Set<number>([
		...store.m_rgNotificationToasts.map((notification: any) => Number(notification.notificationID)),
		...store.m_rgNotificationTray.flatMap((group: any) => (group.notifications || []).map((notification: any) => Number(notification.notificationID))),
	]);
	while (used.has(nextSyntheticNotificationId)) nextSyntheticNotificationId--;
	return nextSyntheticNotificationId--;
}

/** Native OnNotification creates a tray record before considering toast
 * preferences. Retire only the exact synthetic object immediately; never call
 * account/server notification deletion APIs or remove a real notification. */
function retireSyntheticTrayNotification(store: any, notificationId: number, ownUnreadIncrement: number): void {
	let removed = false;
	for (const group of Array.from(store.m_rgNotificationTray) as any[]) {
		const notifications = group?.notifications;
		if (!Array.isArray(notifications)) continue;
		const own = notifications.find((notification: any) => notification.notificationID === notificationId
			&& notification.eType === STEAM_ACHIEVEMENT_NOTIFICATION_TYPE && notification.eSource === 1);
		if (!own) continue;
		if (notifications.length === 1) {
			try { store.RemoveGroupFromTray(group); } catch {}
			// The public local method can be unavailable on a future client. The
			// exact array/object identity remains sufficient for local retirement.
			const remaining = store.m_rgNotificationTray.indexOf(group);
			if (remaining >= 0) store.m_rgNotificationTray.splice(remaining, 1);
		} else notifications.splice(notifications.indexOf(own), 1);
		removed = true;
	}
	if (!removed) return;
	// The native callback reports our own increment. Other notifications may
	// arrive through synchronous observers; retain their increments and read state.
	if (ownUnreadIncrement > 0 && Number(store.m_nUnviewedNotifications) > 0) {
		store.m_nUnviewedNotifications = Math.max(0, Number(store.m_nUnviewedNotifications) - ownUnreadIncrement);
	}
	try { store.m_cbkNotificationTray.Dispatch(store.m_rgNotificationTray); } catch {}
}

function expireOwnedNativeAchievementToast(active: ActiveNativeAchievementToast): void {
	try {
		const notifications = active.store.m_rgNotificationToasts;
		if (active.notification && Array.isArray(notifications) && notifications.includes(active.notification)) {
			active.store.ExpireToast(active.notification);
		}
	} catch {}
}

export function registerNativeAchievementToastWindow(
	popupWin: Window,
	kind: NativeAchievementToastWindowKind,
	label: string,
): void {
	nativeAchievementToastWindows.set(popupWin, { window: popupWin, kind, label, registeredAt: Date.now() });
}

export function unregisterNativeAchievementToastWindow(popupWin: Window): void {
	const target = nativeAchievementToastWindows.get(popupWin);
	nativeAchievementToastWindows.delete(popupWin);
	// The game overlay lifetime is a stronger stop signal than RunningApps,
	// which may remain stale briefly after Alt+F4. Stop replay immediately.
	if (target?.kind === 'overlay') cancelAllQueuedAchievementToasts('game overlay closed');
}

/**
 * Return the newest ready native notification surface for a window kind.
 * The registration timestamp doubles as a launch-session identity: a newly
 * created game overlay remains distinguishable even when Steam's RunningApps
 * store never exposed the brief stopped state between two launches.
 */
export function latestNativeAchievementToastWindowRegistration(
	kind: NativeAchievementToastWindowKind,
	registeredAfter = 0,
): number {
	let latest = 0;
	for (const [popupWin, target] of nativeAchievementToastWindows) {
		if (popupWin.closed) {
			nativeAchievementToastWindows.delete(popupWin);
			continue;
		}
		const store = (target.window as any).NotificationStore;
		if (target.kind === kind && target.registeredAt >= registeredAfter
			&& typeof store?.OnNotification === 'function') latest = Math.max(latest, target.registeredAt);
	}
	return latest;
}

function getNativeAchievementToastWindows(): NativeAchievementToastWindow[] {
	const priority: Record<NativeAchievementToastWindowKind, number> = {
		overlay: 3,
		bigpicture: 2,
		desktop: 1,
	};
	const targets: NativeAchievementToastWindow[] = [];
	for (const [popupWin, target] of nativeAchievementToastWindows) {
		if (popupWin.closed) {
			nativeAchievementToastWindows.delete(popupWin);
			continue;
		}
		targets.push(target);
	}
	if (!targets.some(target => target.window === window)) {
		targets.push({ window, kind: 'desktop', label: 'plugin window', registeredAt: 0 });
	}
	return targets.sort((a, b) => priority[b.kind] - priority[a.kind]);
}

function ensureNativeAchievementToastStyles(doc: Document): void {
	if (doc.getElementById(NATIVE_ACHIEVEMENT_TOAST_STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = NATIVE_ACHIEVEMENT_TOAST_STYLE_ID;
	style.textContent = `
		.${NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS} {
			min-width: 380px !important;
			min-height: 70px !important;
			height: 70px !important;
			padding: 10px 14px !important;
			box-sizing: border-box !important;
		}
		.${NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS} img {
			width: 54px !important;
			height: 54px !important;
			max-width: 54px !important;
			max-height: 54px !important;
			flex: 0 0 54px !important;
		}
		.${NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS} {
			font-size: 14px !important;
			line-height: 18px !important;
		}
		.${NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS} {
			font-size: 12px !important;
			line-height: 16px !important;
		}
	`;
	(doc.head || doc.documentElement).appendChild(style);
}

function comparableImageUrl(value: string, doc: Document): string {
	try {
		const parsed = new URL(value, doc.defaultView?.location.href || window.location.href);
		parsed.hash = '';
		return parsed.href;
	} catch {
		return String(value || '').split('#')[0];
	}
}

/** Enlarge only the achievement toast emitted by this plugin, never Steam's other notifications. */
function applyNativeAchievementToastPresentation(
	target: NativeAchievementToastWindow,
	notificationId: number,
	achievement: LocalAchievementItem,
): void {
	const doc = target.window.document;
	const expectedImage = comparableImageUrl(String(achievement.icon || achievement.icon_gray || ''), doc);
	if (!expectedImage || !doc.documentElement) return;
	ensureNativeAchievementToastStyles(doc);
	const title = String(achievement.display_name || achievement.name || '').trim();
	const description = String(achievement.description || '').trim();
	let templateClasses: any;
	try { templateClasses = findModuleExport((candidate: any) => candidate?.ShortTemplate && candidate?.StandardLogoDimensions); } catch {}
	const toastClasses = [templateClasses?.ShortTemplate, templateClasses?.StandardTemplate, templateClasses?.StandardTemplateContainer]
		.flatMap(value => String(value || '').split(/\s+/)).filter(Boolean);
	if (!toastClasses.length) return;
	let observer: MutationObserver | null = null;
	let observerTimer: number | null = null;

	const mark = (): boolean => {
		if (activeNativeAchievementToast?.notificationId !== notificationId) return true;
		const active = activeNativeAchievementToast;
		if (typeof active.store.GetCurrentToastNotification !== 'function') return true;
		if (active.store.GetCurrentToastNotification() !== active.notification) return false;
		const image = Array.from(doc.images).find(candidate => {
			const source = candidate.currentSrc || candidate.src || candidate.getAttribute('src') || '';
			if (comparableImageUrl(source, doc) !== expectedImage) return false;
			let parent = candidate.parentElement;
			while (parent && parent !== doc.body) {
				if (toastClasses.some(css => parent!.classList.contains(css))) return true;
				parent = parent.parentElement;
			}
			return false;
		});
		if (!image) return false;
		let card: HTMLElement | null = null;
		let current = image.parentElement;
		for (let depth = 0; current && current !== doc.body && depth < 8; depth += 1) {
			const rect = current.getBoundingClientRect();
			if (rect.width >= 240 && rect.width <= 650 && rect.height >= 40 && rect.height <= 160) card = current;
			current = current.parentElement;
		}
		if (!card) return false;
		card.classList.add(NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS);
		for (const element of Array.from(card.querySelectorAll<HTMLElement>('div, span'))) {
			if (element.childElementCount > 0) continue;
			const text = String(element.textContent || '').trim();
			if (title && text === title) element.classList.add(NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS);
			if (description && text === description) element.classList.add(NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS);
		}
		if (activeNativeAchievementToast?.notificationId === notificationId) {
			activeNativeAchievementToast.presentationElement = card;
		}
		return true;
	};

	if (mark()) return;
	const NativeMutationObserver = (target.window as any).MutationObserver as typeof MutationObserver | undefined;
	if (!NativeMutationObserver) return;
	const active = activeNativeAchievementToast;
	if (!active || active.notificationId !== notificationId) return;
	const stop = (): void => {
		observer?.disconnect();
		observer = null;
		if (observerTimer !== null) target.window.clearTimeout(observerTimer);
		observerTimer = null;
		if (active.stopPresentationObserver === stop) delete active.stopPresentationObserver;
	};
	active.stopPresentationObserver = stop;
	observer = new NativeMutationObserver(() => {
		if (!mark()) return;
		stop();
	});
	observer.observe(doc.documentElement, { childList: true, subtree: true });
	observerTimer = target.window.setTimeout(stop, 1500);
}

function clearNativeAchievementToastPresentation(active: ActiveNativeAchievementToast | null): void {
	active?.stopPresentationObserver?.();
	const card = active?.presentationElement;
	if (!card) return;
	card.classList.remove(NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS);
	for (const element of Array.from(card.querySelectorAll<HTMLElement>(
		`.${NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS}, .${NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS}`,
	))) {
		element.classList.remove(NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS, NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS);
	}
}

function localAchievementToastStateKey(data: LocalAchievementData): string {
	return `${LOCAL_ACHIEVEMENT_TOAST_STATE_PREFIX}${localAchievementIdentity(data)}`;
}

function localAchievementIdentity(data: LocalAchievementData): string {
	const metadataAppId = String(data.metadata_appid || data.appid || '');
	const stateAppId = String(data.state_appid || metadataAppId);
	return `${metadataAppId}:${stateAppId}`;
}

function achievementReplayIdentity(metadataAppId: string | number, stateAppId: string | number): string {
	const metadata = String(metadataAppId || '');
	return `${metadata}:${String(stateAppId || metadata)}`;
}

function replayStorageKey(prefix: string, metadataAppId: string | number, stateAppId: string | number): string {
	return `${prefix}${achievementReplayIdentity(metadataAppId, stateAppId)}`;
}

function notifyAchievementReplayPreferencesChanged(): void {
	try { window.dispatchEvent(new Event(ACHIEVEMENT_REPLAY_PREFERENCES_EVENT)); } catch {}
}

export function subscribeAchievementReplayPreferences(listener: () => void): () => void {
	window.addEventListener(ACHIEVEMENT_REPLAY_PREFERENCES_EVENT, listener);
	return () => window.removeEventListener(ACHIEVEMENT_REPLAY_PREFERENCES_EVENT, listener);
}

export function isNextLaunchAchievementReplayEnabled(metadataAppId: string | number, stateAppId: string | number): boolean {
	try { return localStorage.getItem(replayStorageKey(FIRST_LAUNCH_REPLAY_PREFIX, metadataAppId, stateAppId)) !== '1'; }
	catch { return false; }
}

export function setNextLaunchAchievementReplayEnabled(metadataAppId: string | number, stateAppId: string | number, enabled: boolean): void {
	try {
		const key = replayStorageKey(FIRST_LAUNCH_REPLAY_PREFIX, metadataAppId, stateAppId);
		if (enabled) localStorage.removeItem(key);
		else localStorage.setItem(key, '1');
	} catch {}
	notifyAchievementReplayPreferencesChanged();
}

export function resetLocalAchievementToastBaseline(metadataAppId: string | number, stateAppId?: string | number): void {
	const metadata = String(metadataAppId || '');
	const state = String(stateAppId || metadata);
	const stateKey = `${LOCAL_ACHIEVEMENT_TOAST_STATE_PREFIX}${metadata}:${state}`;
	localAchievementToastBaselines.delete(stateKey);
	localAchievementSessionToastedNames.delete(state);
	try { localStorage.removeItem(stateKey); } catch {}
}

export function isEveryLaunchAchievementReplayEnabled(metadataAppId: string | number, stateAppId: string | number): boolean {
	try { return localStorage.getItem(replayStorageKey(EVERY_LAUNCH_REPLAY_PREFIX, metadataAppId, stateAppId)) === '1'; }
	catch { return false; }
}

export function setEveryLaunchAchievementReplayEnabled(metadataAppId: string | number, stateAppId: string | number, enabled: boolean): void {
	try {
		const key = replayStorageKey(EVERY_LAUNCH_REPLAY_PREFIX, metadataAppId, stateAppId);
		if (enabled) localStorage.setItem(key, '1');
		else localStorage.removeItem(key);
	} catch {}
	notifyAchievementReplayPreferencesChanged();
}

function persistLocalAchievementToastBaseline(key: string, baseline: { observedAt: number; earned: Set<string> }): void {
	try {
		const payload: LocalAchievementToastBaseline = {
			version: 1,
			observed_at: baseline.observedAt,
			earned: Array.from(baseline.earned),
		};
		localStorage.setItem(key, JSON.stringify(payload));
	} catch {}
}

/**
 * Return only genuine locked -> unlocked transitions. The initial state is
 * persisted silently so installing/reloading the plugin cannot replay old unlocks.
 */
function sessionToastedNames(shortcutAppId?: string | number): Set<string> | null {
	const key = shortcutAppId == null ? '' : String(shortcutAppId);
	if (!key) return null;
	let names = localAchievementSessionToastedNames.get(key);
	if (!names) {
		names = new Set<string>();
		localAchievementSessionToastedNames.set(key, names);
		trimAchievementStateMaps();
	}
	return names;
}

function detectNewLocalAchievementUnlocks(
	data: LocalAchievementData,
	shortcutAppId?: string | number,
	sessionStartedAtSeconds?: number,
): LocalAchievementItem[] {
	const key = localAchievementToastStateKey(data);
	const now = Math.floor(Date.now() / 1000);
	const toastedThisSession = sessionToastedNames(shortcutAppId);
	let baseline = localAchievementToastBaselines.get(key) || null;
	if (!baseline) {
		try {
			const raw = localStorage.getItem(key);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<LocalAchievementToastBaseline>;
				if (parsed.version === 1 && Array.isArray(parsed.earned)) {
					baseline = {
						observedAt: Number(parsed.observed_at || 0),
						earned: new Set(parsed.earned.map(String)),
					};
				}
			}
		} catch {}
	}

	const currentlyEarned = data.achievements.filter(achievement => achievement.earned);
	let newlyUnlocked: LocalAchievementItem[] = [];
	if (!baseline) {
		baseline = { observedAt: now, earned: new Set(currentlyEarned.map(achievement => String(achievement.name))) };
		localAchievementToastBaselines.set(key, baseline);
		trimAchievementStateMaps();
		persistLocalAchievementToastBaseline(key, baseline);
		backendLog(`Achievement notification baseline created for ${data.appid}: ${baseline.earned.size} already unlocked`);
	} else {
		// The persisted earned-name set is the authoritative transition signal.
		// Local JSON timestamps are optional and frequently use stale or
		// incompatible clocks, so they must not suppress a real locked -> earned
		// change observed between two polls.
		newlyUnlocked = currentlyEarned.filter(achievement => !baseline!.earned.has(String(achievement.name)));
		for (const achievement of currentlyEarned) baseline.earned.add(String(achievement.name));
		baseline.observedAt = now;
		localAchievementToastBaselines.set(key, baseline);
		trimAchievementStateMaps();
		persistLocalAchievementToastBaseline(key, baseline);
	}

	// A new achievement file can be created with its first achievement already
	// earned before the overlay's six-second readiness window ends. In that case
	// no locked snapshot ever reaches the normal transition detector. Recover
	// achievements timestamped within this running session as a positive signal;
	// ordinary transitions above remain timestamp-independent. The per-session
	// set prevents the recovery path from repeating on later two-second polls.
	const sessionStart = Number(sessionStartedAtSeconds || 0);
	if (sessionStart > 0 && toastedThisSession) {
		const selected = new Set(newlyUnlocked.map(achievement => String(achievement.name)));
		for (const achievement of currentlyEarned) {
			const name = String(achievement.name);
			const earnedAt = Number(achievement.earned_time || 0);
			if (!selected.has(name) && !toastedThisSession.has(name)
				&& earnedAt >= sessionStart - 5 && earnedAt <= now + 300) {
				newlyUnlocked.push(achievement);
				selected.add(name);
			}
		}
	}
	if (toastedThisSession) {
		for (const achievement of newlyUnlocked) toastedThisSession.add(String(achievement.name));
	}
	return newlyUnlocked;
}

function getNativeAchievementNotificationProto(): any | null {
	if (nativeAchievementNotificationProto) return nativeAchievementNotificationProto;
	try {
		nativeAchievementNotificationProto = findModuleExport((candidate: any) => {
			if (typeof candidate?.fromObject !== 'function' || typeof candidate?.prototype?.getClassName !== 'function') return false;
			try {
				return candidate.prototype.getClassName.call(candidate.prototype) === 'CClientNotificationAchievement';
			} catch {
				return candidate.prototype.getClassName.toString().includes('CClientNotificationAchievement');
			}
		});
	} catch (error) {
		backendLog('Native achievement notification protobuf lookup failed: ' + String(error));
	}
	return nativeAchievementNotificationProto || null;
}

function dismissActiveAchievementToast(): void {
	if (activeNativeAchievementToastTimer) {
		window.clearTimeout(activeNativeAchievementToastTimer);
		activeNativeAchievementToastTimer = null;
	}
	if (activeNativeAchievementToast) {
		clearNativeAchievementToastPresentation(activeNativeAchievementToast);
		expireOwnedNativeAchievementToast(activeNativeAchievementToast);
		activeNativeAchievementToast = null;
	}
	if (activeFallbackAchievementToast) {
		try { activeFallbackAchievementToast.dismiss(); } catch {}
		activeFallbackAchievementToast = null;
	}
}

function showNativeAchievementToast(appid: string, achievement: LocalAchievementItem): boolean {
	try {
		const proto = getNativeAchievementNotificationProto();
		if (!proto?.fromObject) return false;
		const message = proto.fromObject({
			achievement_id: String(achievement.name || ''),
			appid: Number(appid),
			name: String(achievement.display_name || achievement.name || ''),
			description: String(achievement.description || ''),
			image_url: String(achievement.icon || achievement.icon_gray || ''),
			achieved: true,
			rtime_unlocked: Number(achievement.earned_time || Math.floor(Date.now() / 1000)),
			min_progress: 0,
			current_progress: Number(achievement.progress || achievement.max_progress || 0),
			max_progress: Number(achievement.max_progress || 0),
			global_achieved_pct: Number(achievement.global_percent || 0),
		});
		const binary = message?.serializeBinary?.();
		if (!binary) return false;
		for (const target of getNativeAchievementToastWindows()) {
			const store = (target.window as any).NotificationStore;
			if (typeof store?.OnNotification !== 'function' || typeof store.RemoveGroupFromTray !== 'function'
				|| typeof store.OnNewNotificationReceived !== 'function'
				|| typeof store.ExpireToast !== 'function' || typeof store.m_cbkNotificationTray?.Dispatch !== 'function'
				|| !Array.isArray(store.m_rgNotificationTray) || !Array.isArray(store.m_rgNotificationToasts)
				|| !Number.isFinite(store.m_nUnviewedNotifications)) continue;
			dismissActiveAchievementToast();
			const notificationId = syntheticNotificationId(store);
			const originalUnread = store.OnNewNotificationReceived;
			const unreadDescriptor = Object.getOwnPropertyDescriptor(store, 'OnNewNotificationReceived');
			let ownUnreadIncrement = 0;
			const captureUnread = function (this: any, notification: any, ...args: any[]): any {
				const before = Number(this.m_nUnviewedNotifications);
				try { return originalUnread.call(this, notification, ...args); }
				finally {
					if (notification.notificationID === notificationId && notification.eSource === 1
						&& notification.eType === STEAM_ACHIEVEMENT_NOTIFICATION_TYPE) {
						ownUnreadIncrement = Math.min(1, Math.max(0, Number(this.m_nUnviewedNotifications) - before));
					}
				}
			};
			try { Object.defineProperty(store, 'OnNewNotificationReceived', { configurable: true, writable: true, value: captureUnread }); }
			catch { continue; }
			let failed = false;
			try { store.OnNotification(notificationId, STEAM_ACHIEVEMENT_NOTIFICATION_TYPE, binary); }
			catch { failed = true; }
			finally {
				try {
					if (store.OnNewNotificationReceived === captureUnread) {
						if (unreadDescriptor) Object.defineProperty(store, 'OnNewNotificationReceived', unreadDescriptor);
						else delete store.OnNewNotificationReceived;
					}
				} catch {}
				retireSyntheticTrayNotification(store, notificationId, ownUnreadIncrement);
			}
			const notification = store.m_rgNotificationToasts.find((value: any) => value.notificationID === notificationId);
			if (failed) {
				if (notification) expireOwnedNativeAchievementToast({ store, notificationId, notification });
				continue;
			}
			activeNativeAchievementToast = { store, notificationId, notification };
			if (notification) applyNativeAchievementToastPresentation(target, notificationId, achievement);
			if (activeNativeAchievementToastTimer) window.clearTimeout(activeNativeAchievementToastTimer);
			activeNativeAchievementToastTimer = window.setTimeout(() => {
				if (activeNativeAchievementToast?.notificationId === notificationId) {
					expireOwnedNativeAchievementToast(activeNativeAchievementToast);
					clearNativeAchievementToastPresentation(activeNativeAchievementToast);
					activeNativeAchievementToast = null;
				}
				activeNativeAchievementToastTimer = null;
			}, STEAM_ACHIEVEMENT_TOAST_DURATION_MS);
			backendLog(`Native achievement target: ${target.kind} (${target.label})`);
			return true;
		}
		return false;
	} catch (error) {
		backendLog('Native achievement toast failed: ' + String(error));
		return false;
	}
}

function playAchievementSound(): void {
	try {
		const steamClient = (window as any).SteamClient;
		if (typeof steamClient?.Sounds?.PlaySound === 'function') {
			steamClient.Sounds.PlaySound(5);
			return;
		}
		if (typeof steamClient?.Sounds?.PlayNavSound === 'function') {
			steamClient.Sounds.PlayNavSound(5);
			return;
		}
		if (typeof steamClient?.Sounds?.PlaySoundEffect === 'function') {
			steamClient.Sounds.PlaySoundEffect(5);
			return;
		}
	} catch {}
}

export async function showAchievementToast(
	appid: string,
	achievement: LocalAchievementItem,
	expectedGeneration?: number,
): Promise<void> {
	const generation = expectedGeneration ?? localAchievementToastGeneration;
	if (generation !== localAchievementToastGeneration) return;
	if (showNativeAchievementToast(appid, achievement)) {
		backendLog(`Native achievement notification shown: ${appid}/${achievement.name}`);
		return;
	}
	playAchievementSound();

	const info = await getLocalAchievementGameInfo(appid);
	if (generation !== localAchievementToastGeneration) return;
	const target = getNativeAchievementToastWindows()[0]?.window || window;
	const doc = target.document;
	if (!doc.body || target.closed) return;
	dismissActiveAchievementToast();
	ensureNativeAchievementToastStyles(doc);
	let classes: any = {};
	try { classes = findModuleExport((candidate: any) => candidate?.ShortTemplate && candidate?.StandardLogoDimensions) || {}; } catch {}
	const card = doc.createElement('div');
	card.className = `${classes.ShortTemplate || ''} ${NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS}`;
	card.setAttribute('role', 'status');
	card.setAttribute('data-gdl-transient-achievement-toast', '1');
	card.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483600;display:flex;align-items:center;gap:12px;background:#2c3035;color:#dcdedf;box-shadow:0 4px 16px #0008;pointer-events:none;font-family:inherit;';
	card.style.setProperty('--toast-duration', `${STEAM_ACHIEVEMENT_TOAST_DURATION_MS}ms`);
	if (achievement.icon || achievement.icon_gray) {
		const image = doc.createElement('img');
		image.src = achievement.icon || achievement.icon_gray;
		image.alt = '';
		card.appendChild(image);
	}
	const content = doc.createElement('div'); content.className = classes.Content || '';
	const title = doc.createElement('div'); title.className = `${classes.Title || ''} ${NATIVE_ACHIEVEMENT_TOAST_TITLE_CLASS}`;
	title.textContent = achievement.display_name || achievement.name;
	const description = doc.createElement('div'); description.className = `${classes.Body || ''} ${NATIVE_ACHIEVEMENT_TOAST_DESCRIPTION_CLASS}`;
	description.textContent = `${gdlText('achievement_unlocked_toast', 'Achievement unlocked')} · ${info.name}`;
	content.appendChild(title); content.appendChild(description); card.appendChild(content); doc.body.appendChild(card);
	let timer: number | null = null;
	const active = { dismiss: () => {
		if (timer !== null) target.clearTimeout(timer);
		timer = null; card.remove();
		if (activeFallbackAchievementToast === active) activeFallbackAchievementToast = null;
	} };
	activeFallbackAchievementToast = active;
	timer = target.setTimeout(active.dismiss, STEAM_ACHIEVEMENT_TOAST_DURATION_MS);
	backendLog(`Fallback achievement notification shown: ${appid}/${achievement.name}`);
}

function drainLocalAchievementToastQueue(): void {
	if (localAchievementToastTimer || localAchievementToastProcessing || localAchievementToastQueue.length === 0) return;
	const next = localAchievementToastQueue.shift()!;
	const generation = localAchievementToastGeneration;
	localAchievementToastProcessing = true;
	activeQueuedLocalAchievementToast = next;
	void (async () => {
		try {
			// The fallback path may need asynchronous game metadata. Do not advance
			// the queue while that request is pending or several delayed toasts can
			// resolve together and appear as a burst.
			await showAchievementToast(next.appid, next.achievement, generation);
		} catch (error) {
			backendLog('Achievement toast error: ' + String(error));
		} finally {
			if (generation !== localAchievementToastGeneration) return;
			localAchievementToastTimer = setTimeout(() => {
				localAchievementToastTimer = null;
				localAchievementToastProcessing = false;
				activeQueuedLocalAchievementToast = null;
				drainLocalAchievementToastQueue();
			}, STEAM_ACHIEVEMENT_TOAST_GAP_MS);
		}
	})();
}

export function enqueueLocalAchievementToasts(
	data: LocalAchievementData,
	shortcutAppId?: string | number,
	sessionStartedAtSeconds?: number,
): void {
	const unlocked = detectNewLocalAchievementUnlocks(data, shortcutAppId, sessionStartedAtSeconds);
	if (unlocked.length > 0) {
		const normalizedShortcutAppId = shortcutAppId == null ? undefined : String(shortcutAppId);
		// Genuine in-game unlocks take precedence over an optional replay of old
		// achievements, while retaining their order within the newly detected set.
		localAchievementToastQueue.unshift(...unlocked.map(achievement => ({
			appid: String(data.metadata_appid || data.appid),
			achievement,
			shortcutAppId: normalizedShortcutAppId,
		})));
		backendLog(`Queued ${unlocked.length} new achievement notification(s) for ${data.appid}`);
		drainLocalAchievementToastQueue();
	}
}

/**
 * Replay the achievements already earned when NativeGameLink observes this linked
 * shortcut running for the first time. The persistent marker is separate from
 * the normal transition baseline: merely browsing the Library may create that
 * baseline, but must never consume the one-time launch replay.
 */
export function enqueueFirstLaunchAchievementToasts(
	data: LocalAchievementData,
	replayStateAppId?: string | number,
): number {
	// Zero-progress is an explicit temporary view policy. It must neither emit
	// notifications nor consume a pending one-time replay of the real progress.
	if (data.zero_progress === true) return 0;
	const metadataAppId = String(data.metadata_appid || data.appid);
	// Preference identity follows the launched shortcut, not whichever AppID
	// directory happened to contain the progress file. Properties stores this
	// same stable metadata+shortcut pair.
	const preferenceStateAppId = String(replayStateAppId || data.state_appid || metadataAppId);
	const replayKey = replayStorageKey(FIRST_LAUNCH_REPLAY_PREFIX, metadataAppId, preferenceStateAppId);
	try {
		if (localStorage.getItem(replayKey) === '1') return 0;
	} catch {}

	const earned = data.achievements
		// The backend normally materializes this policy into `earned`. Keep the
		// explicit online condition here as a defensive guarantee for older local
		// state files whose online achievements were absent from progress data.
		.filter(achievement => achievement.earned || (data.unlock_online === true && achievement.is_online === true))
		.sort((a, b) => Number(a.earned_time || 0) - Number(b.earned_time || 0));
	const toastedThisSession = sessionToastedNames(preferenceStateAppId);
	if (toastedThisSession) {
		for (const achievement of earned) toastedThisSession.add(String(achievement.name));
	}
	const now = Math.floor(Date.now() / 1000);
	const baseline = { observedAt: now, earned: new Set(earned.map(achievement => String(achievement.name))) };
	const baselineKey = localAchievementToastStateKey(data);
	localAchievementToastBaselines.set(baselineKey, baseline);
	trimAchievementStateMaps();
	persistLocalAchievementToastBaseline(baselineKey, baseline);

	// Persist and notify before draining so another Steam surface cannot enqueue
	// duplicates and an open Properties panel immediately turns off the one-shot
	// switch. Every-launch remains visibly enabled through its separate marker.
	setNextLaunchAchievementReplayEnabled(
		metadataAppId,
		preferenceStateAppId,
		false,
	);
	for (const achievement of earned) {
		localAchievementToastQueue.push({
			appid: String(data.metadata_appid || data.appid),
			achievement,
			shortcutAppId: preferenceStateAppId,
		});
	}
	const onlineEarned = earned.filter(achievement => achievement.is_online === true).length;
	backendLog(`First-launch achievement replay queued for ${data.appid}: ${earned.length} notification(s), ${onlineEarned} online`);
	drainLocalAchievementToastQueue();
	return earned.length;
}

function cancelQueuedAchievementToasts(
	predicate: (item: QueuedLocalAchievementToast) => boolean,
	reason: string,
): void {
	let removed = 0;
	for (let index = localAchievementToastQueue.length - 1; index >= 0; index -= 1) {
		if (!predicate(localAchievementToastQueue[index])) continue;
		localAchievementToastQueue.splice(index, 1);
		removed += 1;
	}
	const cancelActive = !!activeQueuedLocalAchievementToast && predicate(activeQueuedLocalAchievementToast);
	if (cancelActive) {
		localAchievementToastGeneration += 1;
		if (localAchievementToastTimer) clearTimeout(localAchievementToastTimer);
		localAchievementToastTimer = null;
		localAchievementToastProcessing = false;
		activeQueuedLocalAchievementToast = null;
		dismissActiveAchievementToast();
		removed += 1;
	}
	if (removed > 0) backendLog(`Cancelled ${removed} achievement notification(s): ${reason}`);
	if (!localAchievementToastProcessing && !localAchievementToastTimer) drainLocalAchievementToastQueue();
}

export function cancelQueuedAchievementToastsForShortcut(shortcutAppId: string | number): void {
	const normalized = String(shortcutAppId || '');
	if (!normalized) return;
	cancelQueuedAchievementToasts(item => item.shortcutAppId === normalized, `shortcut ${normalized} stopped`);
	localAchievementSessionToastedNames.delete(normalized);
}

function cancelAllQueuedAchievementToasts(reason: string): void {
	cancelQueuedAchievementToasts(() => true, reason);
}

export function disposeAchievementNotifications(): void {
	localAchievementToastGeneration += 1;
	if (localAchievementToastTimer) {
		clearTimeout(localAchievementToastTimer);
		localAchievementToastTimer = null;
	}
	localAchievementToastProcessing = false;
	activeQueuedLocalAchievementToast = null;
	dismissActiveAchievementToast();
	localAchievementToastQueue.length = 0;
	nativeAchievementToastWindows.clear();
	localAchievementToastBaselines.clear();
	localAchievementSessionToastedNames.clear();
	clearLocalAchievementGameInfoCache();
	nativeAchievementNotificationProto = null;
}
