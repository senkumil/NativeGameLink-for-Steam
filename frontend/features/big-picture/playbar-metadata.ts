import { PLAYBAR_CLASSES } from '../../steam/css';
import { loc, steamIntlLocale, isSpanishLanguage } from '../../steam/localization';
import { getNativeWindowInstance } from '../../steam/native-window-store';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { readPureClassFactory } from '../../steam/gamepad/components/pure-class-factory';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { isCurrentLinkedGamepadTarget } from '../../steam/gamepad/GamepadContext';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { formatLastPlayedDate, formatPlaytimeMinutes } from '../playtime/format';
import { fetchPlaytimeStats, getInstantPlaytimeStats, type PlaytimeStats } from '../playtime/service';
import { isShortcutPlaytimeTrackingEnabled } from '../playtime/playtime-settings';
import type { MappedShortcut } from './types';

const FOREIGN = '[role="dialog"], [aria-modal="true"], [class*="QuickAccess"], [class*="MainMenu"], [class*="Settings"], [class*="AllGames"], [class*="LibraryHome"], [class*="Shelf"]';
const states = new Map<Document, MetadataState>();
const storeStates = new WeakMap<Document, { identity: object; checkedAt: number; app: any; details: any }>();
const classStates = new WeakMap<Document, { identity: object; count: number; classes: Readonly<Record<string, string>> }>();

function playbarClasses(doc: Document): Readonly<Record<string, string>> {
	const fallback = PLAYBAR_CLASSES(doc), identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	if (!identity) return fallback;
	const count = steamWebpackRuntime.getModuleFactoryCount(doc), cached = classStates.get(doc);
	if (cached?.identity === identity && cached.count === count) return cached.classes;
	let classes: Readonly<Record<string, string>> = fallback;
	// Scriptless Big Picture popups share a private require cache. Read the
	// current CSS literal without executing any factory or loading native stores.
	let shell: Readonly<Record<string, string>> | null = null;
	for (const { factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		const literal = readPureClassFactory(factory);
		if (literal?.PlaySection && literal.ActionRow && literal.AppDetailsRoot) shell = literal;
		if (literal && ['PlayBar', 'GameStatsSection', 'LastPlayedInfo', 'CloudStatusRow', 'CloudStatusIcon', 'CloudStatusLabel']
			.every(key => typeof literal[key] === 'string')) classes = literal;
		if (shell && classes !== fallback) break;
	}
	if (shell) classes = { ...classes, PlaySection: shell.PlaySection };
	classStates.set(doc, { identity, count, classes });
	return classes;
}
interface MetadataState {
	doc: Document; root: HTMLElement; stats: HTMLElement; shortcut: MappedShortcut; identity: object;
	nodes: Map<string, HTMLElement>; observer: MutationObserver | null; timer: number; frame: number;
	request: Promise<PlaytimeStats | null> | null; fetchedAt: number; confirmed: PlaytimeStats | null;
	disposeEvents: () => void;
}

function current(state: MetadataState): boolean {
	const { doc, root, shortcut } = state;
	return states.get(doc) === state && root.isConnected && root.ownerDocument === doc
		&& doc.getElementById('gdl-bp-detail-root') === root && root.dataset.gdlShortcutAppId === String(shortcut.id)
		&& root.dataset.gdlSteamAppId === shortcut.steamAppId && !root.closest(FOREIGN)
		&& steamUIModeService.isGamepadUI(doc) && isCurrentLinkedGamepadTarget(doc, shortcut.id, shortcut.steamAppId)
		&& steamWebpackRuntime.getRuntimeIdentity(doc) === state.identity;
}

function belongsToShortcut(element: HTMLElement, doc: Document, id: number): boolean {
	if (!element.isConnected || element.ownerDocument !== doc || element.closest(FOREIGN)
		|| element.closest('#gdl-bp-detail-root')) return false;
	const explicit = element.closest('[data-appid], [data-app-id]');
	const raw = explicit?.getAttribute('data-appid') || explicit?.getAttribute('data-app-id');
	if (raw && (Number(raw) >>> 0) !== id) return false;
	for (let parent: HTMLElement | null = element; parent && parent !== doc.body; parent = parent.parentElement) {
		const style = doc.defaultView?.getComputedStyle(parent);
		if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style?.display === 'none'
			|| style?.visibility === 'hidden' || style?.opacity === '0') return false;
	}
	return true;
}

function classSelector(value: string): string {
	return value.trim().split(/\s+/).filter(Boolean).map(token => `.${CSS.escape(token)}`).join('');
}
function hasClasses(node: Element, value: string): boolean { return Boolean(value) && node.matches(classSelector(value)); }

function findStats(doc: Document, root: HTMLElement, id: number): HTMLElement | null {
	const key = playbarClasses(doc).GameStatsSection;
	for (let scope = root.parentElement, depth = 0; scope && scope !== doc.body && scope !== doc.documentElement && depth < 8; scope = scope.parentElement, depth++) {
		const candidates = scope.querySelectorAll<HTMLElement>(key ? `${classSelector(key)}, [class*="GameStatsSection"]` : '[class*="GameStatsSection"]');
		for (const candidate of candidates) if (belongsToShortcut(candidate, doc, id)) return candidate;
	}
	return null;
}

/** Read only already loaded stores after the exact native WindowStore proves
 * this popup's shared CEF owner. No public AppID or store factory is consulted. */
function shortcutNativeData(state: MetadataState): { overview: any; details: any } {
	const { doc, shortcut, identity } = state;
	let cached = storeStates.get(doc);
	if ((!cached || cached.identity !== identity || ((!cached.app || !cached.details) && Date.now() - cached.checkedAt > 2000))
		&& getNativeWindowInstance(doc)) {
		cached = { identity, checkedAt: Date.now(), app: null, details: null };
		for (const module of steamWebpackRuntime.getAllModules(doc)) {
			try {
				const exp = module.exports;
				for (const value of [exp, exp?.default, ...(exp && typeof exp === 'object' ? Object.values(exp) : [])]) {
					if (!value || typeof value !== 'object') continue;
					if (!cached.app && typeof value.GetAppOverviewByAppID === 'function') cached.app = value;
					if (!cached.details && typeof value.GetAppDetails === 'function') cached.details = value;
				}
			} catch {}
			if (cached.app && cached.details) break;
		}
		storeStates.set(doc, cached);
	}
	let overview: any = null, details: any = null;
	try { overview = AppStoreAdapter.getAppOverview(shortcut.id, doc) || cached?.app?.GetAppOverviewByAppID(shortcut.id); } catch {}
	try { details = cached?.details?.GetAppDetails(shortcut.id); } catch {}
	if ((Number(overview?.appid) >>> 0) !== shortcut.id) overview = null;
	if ((Number(details?.unAppID) >>> 0) !== shortcut.id) details = null;
	return { overview, details };
}

function nativeStats(overview: any, details: any): PlaytimeStats | null {
	const rawMinutes = details?.nPlaytimeForever ?? overview?.minutes_playtime_forever;
	const rawLast = details?.rtLastTimePlayed ?? overview?.rt_last_time_played;
	if (rawMinutes === undefined && rawLast === undefined) return null;
	const minutes = Math.max(0, Number(rawMinutes) || 0), last = Number(rawLast);
	return { minutesForever: minutes, minutesLastTwoWeeks: 0, lastPlayedAt: Number.isFinite(last) && last > 0 ? last : null };
}

function updateText(node: HTMLElement, text: string): void { if (node.textContent !== text) node.textContent = text; }
function setClasses(node: HTMLElement, ...values: (string | undefined)[]): void {
	const next = values.filter(Boolean).join(' '); if (node.className !== next) node.className = next;
}

function statNode(state: MetadataState, kind: string, title: string, value: string): HTMLElement {
	let node = state.nodes.get(kind);
	const c = playbarClasses(state.doc);
	if (!node) {
		node = state.doc.createElement('div');
		node.dataset.gdlBpPlaybarMetadata = kind;
		node.dataset.gdlShortcutAppId = String(state.shortcut.id);
		const right = state.doc.createElement('div'), label = state.doc.createElement('div'), detail = state.doc.createElement('div');
		right.append(label, detail); node.append(right); state.nodes.set(kind, node);
	}
	const isTime = kind === 'playtime', right = node.firstElementChild as HTMLElement;
	setClasses(node, c.GameStat, isTime ? c.Playtime : c.LastPlayed);
	setClasses(right, c.GameStatRight, isTime ? c.PlaytimeRight : c.LastPlayedRight);
	setClasses(right.children[0] as HTMLElement, c.PlayBarLabel, isTime ? c.PlaytimeLabel : c.LastPlayedLabel);
	setClasses(right.children[1] as HTMLElement, c.PlayBarDetailLabel, isTime ? c.PlaytimeInfo : c.LastPlayedInfo);
	updateText(right.children[0] as HTMLElement, title); updateText(right.children[1] as HTMLElement, value);
	return node;
}

function removeNode(state: MetadataState, kind: string): void { state.nodes.get(kind)?.remove(); state.nodes.delete(kind); }

// Steam's Big Picture playbar uses Played_Minutes below two hours, then
// Played_Hours with one localized decimal (installed native formatter 73530).
function formatNativePlaytime(minutes: number): string {
	if (minutes < 1) return formatPlaytimeMinutes(0);
	const hours = minutes >= 120;
	const count = hours ? Math.round(minutes / 6) / 10 : Math.floor(minutes);
	const value = count.toLocaleString(steamIntlLocale(), { maximumFractionDigits: hours ? 1 : 0 });
	return loc(hours ? 'Played_Hours' : 'Played_Minutes', isSpanishLanguage() ? hours ? '%s horas' : '%s minutos' : hours ? '%s hours' : '%s minutes')
		.replace(/%\d*\$?[sd]|\{0\}/, value);
}

function paint(state: MetadataState): void {
	if (!current(state)) { if (states.get(state.doc) === state) disposeBigPicturePlaybarMetadata(state.doc); return; }
	const c = playbarClasses(state.doc), { overview, details } = shortcutNativeData(state);
	const tracked = isShortcutPlaytimeTrackingEnabled(state.shortcut.id);
	const stats = (tracked && (getInstantPlaytimeStats(state.shortcut.id, state.shortcut.steamAppId) || state.confirmed)) || nativeStats(overview, details);
	const seconds = stats?.totalSeconds, minutes = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, seconds) / 60 : Number(stats?.minutesForever) || 0;
	const last = stats?.lastPlayedAt ? formatLastPlayedDate(stats.lastPlayedAt) : '';
	const nativeChildren = Array.from(state.stats.children).filter(child => !child.hasAttribute('data-gdl-bp-playbar-metadata')) as HTMLElement[];
	const lastLabels = new Set([loc('AppDetails_SectionTitle_LastPlayed', 'Last played'), loc('AppDetails_SectionTitle_LastLaunched', 'Last launched')].map(value => value.trim().toLocaleLowerCase()));
	const nativeLast = nativeChildren.some(child => {
		const label = c.PlayBarLabel && child.querySelector<HTMLElement>(classSelector(c.PlayBarLabel))?.textContent?.trim().toLocaleLowerCase();
		return label && lastLabels.has(label);
	});
	const nativeTime = nativeChildren.some(child => c.Playtime && hasClasses(child, c.Playtime));
	const controller = nativeChildren.find(child => child.id === 'gdl-bp-playbar-controller' || (c.ControllerSupportInfo && hasClasses(child, c.ControllerSupportInfo))) || null;
	const desired: HTMLElement[] = [];
	if (last && !nativeLast) desired.push(statNode(state, 'last-played', loc('AppDetails_SectionTitle_LastPlayed', 'Last played'), last));
	else removeNode(state, 'last-played');
	if (minutes > 0 && !nativeTime) desired.push(statNode(state, 'playtime', loc('AppDetails_SectionTitle_PlayTime', 'Play time'), formatNativePlaytime(minutes)));
	else removeNode(state, 'playtime');
	for (let index = desired.length - 1, anchor = controller; index >= 0; index--) {
		const node = desired[index];
		if (node.parentElement !== state.stats || node.nextElementSibling !== anchor) state.stats.insertBefore(node, anchor);
		anchor = node;
	}
	paintCloud(state);
}

// Linked-game presentation is intentionally fixed; it does not write Cloud
// flags, synchronize files, or change Steam's native games/account state.
function paintCloud(state: MetadataState): void {
	const c = playbarClasses(state.doc);
	// Big Picture places Cloud beside PlaySection under AppDetailsRoot; its
	// ActionRow reuses desktop stat classes but has no desktop PlayBar ancestor.
	const playbar = c.PlaySection ? state.stats.closest<HTMLElement>(classSelector(c.PlaySection)) : null;
	const host = playbar?.parentElement;
	const nativeCloud = host && c.CloudStatusRow && Array.from(host.querySelectorAll<HTMLElement>(classSelector(c.CloudStatusRow)))
		.some(node => !node.hasAttribute('data-gdl-bp-playbar-metadata') && belongsToShortcut(node, state.doc, state.shortcut.id));
	if (!host || !c.CloudStatusRow || nativeCloud) { removeNode(state, 'cloud'); return; }
	let row = state.nodes.get('cloud');
	if (!row) {
		row = state.doc.createElement('div'); row.dataset.gdlBpPlaybarMetadata = 'cloud'; row.setAttribute('role', 'status');
		const icon = state.doc.createElement('span'), label = state.doc.createElement('span');
		icon.className = c.CloudStatusIcon || ''; label.className = c.CloudStatusLabel || '';
		const svg = state.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 36 36'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', c.CloudIconSVG || '');
		const path = state.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-rule', 'evenodd'); path.setAttribute('clip-rule', 'evenodd');
		path.setAttribute('d', 'M25.2377 7.0939C26.902 8.83356 27.8828 11.1153 28 13.52C29.998 14.2303 31.6809 15.6232 32.7522 17.4532C33.8234 19.2831 34.2142 21.4325 33.8555 23.5224C33.4968 25.6122 32.4118 27.5084 30.7917 28.8764C29.1716 30.2444 27.1205 30.9965 25 31H11C8.87962 30.9965 6.82852 30.2444 5.20842 28.8764C3.58833 27.5084 2.50327 25.6122 2.1446 23.5224C1.78593 21.4325 2.17666 19.2831 3.24792 17.4532C4.31917 15.6232 6.00213 14.2303 8.00005 13.52C8.11845 11.109 9.10495 8.82222 10.7775 7.08168C12.45 5.34114 14.6957 4.26433 17.1 4.04999H18.0201H18.9401C21.3372 4.27345 23.5733 5.35425 25.2377 7.0939ZM10 19.6L15.41 25L25.03 15.38L22.64 13L15.41 20.23L12.39 17.21L10 19.6Z');
		svg.append(path); icon.append(svg); row.append(icon, label); state.nodes.set('cloud', row);
	}
	setClasses(row, 'Panel', c.CloudStatusRow);
	updateText(row.lastElementChild as HTMLElement, `${loc('AppProperties_SteamCloudSection', 'Steam Cloud')}: ${loc('AppDetails_CloudStatus_Synchronized', isSpanishLanguage() ? 'Actualizado' : 'Up to date')}`);
	if (row.parentElement !== host || row.previousElementSibling !== playbar) host.insertBefore(row, playbar!.nextSibling);
}

function refresh(state: MetadataState): void {
	paint(state);
	if (!current(state) || state.request || !isShortcutPlaytimeTrackingEnabled(state.shortcut.id) || Date.now() - state.fetchedAt < 5000) return;
	state.fetchedAt = Date.now();
	const request = fetchPlaytimeStats(state.shortcut.id, state.shortcut.title, state.shortcut.steamAppId);
	state.request = request;
	void request.then(data => {
		if (!current(state) || state.request !== request) return;
		state.confirmed = data || state.confirmed; paint(state);
	}).catch(() => {}).finally(() => { if (state.request === request) state.request = null; });
}

export function syncBigPicturePlaybarMetadata(doc: Document, shortcut: MappedShortcut): void {
	const root = doc.getElementById('gdl-bp-detail-root');
	if (!root || !steamUIModeService.isGamepadUI(doc) || !isCurrentLinkedGamepadTarget(doc, shortcut.id, shortcut.steamAppId)
		|| root.dataset.gdlShortcutAppId !== String(shortcut.id) || root.dataset.gdlSteamAppId !== shortcut.steamAppId || root.closest(FOREIGN)) {
		disposeBigPicturePlaybarMetadata(doc); return;
	}
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc), stats = findStats(doc, root, shortcut.id);
	if (!identity || !stats) { disposeBigPicturePlaybarMetadata(doc); return; }
	let state = states.get(doc);
	if (state && (state.root !== root || state.stats !== stats || state.identity !== identity || state.shortcut.id !== shortcut.id || state.shortcut.steamAppId !== shortcut.steamAppId)) {
		disposeBigPicturePlaybarMetadata(doc); state = undefined;
	}
	if (!state) {
		const view = doc.defaultView!;
		state = { doc, root, stats, shortcut: { ...shortcut }, identity, nodes: new Map(), observer: null, timer: 0, frame: 0,
			request: null, fetchedAt: -Infinity, confirmed: null, disposeEvents: () => {} };
		states.set(doc, state);
		const owned = state;
		const changed = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if ((!detail || Number(detail.shortcutAppId ?? detail.shortcutId) === shortcut.id)
				&& (!detail?.steamAppId || String(detail.steamAppId) === shortcut.steamAppId)) { owned.fetchedAt = -Infinity; refresh(owned); }
		};
		const unload = () => disposeBigPicturePlaybarMetadata(doc);
		const windows = new Set([view, ...(typeof window !== 'undefined' ? [window] : [])]);
		for (const target of windows) { target.addEventListener('gdl:playtime-changed', changed); target.addEventListener('gdl:playtime-settings-changed', changed); }
		view.addEventListener('unload', unload);
		state.disposeEvents = () => {
			for (const target of windows) { target.removeEventListener('gdl:playtime-changed', changed); target.removeEventListener('gdl:playtime-settings-changed', changed); }
			view.removeEventListener('unload', unload);
		};
		state.timer = view.setInterval(() => { if (!doc.hidden) refresh(owned); }, 10000);
		state.observer = new view.MutationObserver(() => {
			if (owned.frame) return;
			owned.frame = view.requestAnimationFrame(() => {
				owned.frame = 0;
				if (states.get(doc) === owned) syncBigPicturePlaybarMetadata(doc, owned.shortcut);
			});
		});
		state.observer.observe(stats, { childList: true });
		if (stats.parentElement) state.observer.observe(stats.parentElement, { childList: true });
	}
	refresh(state);
}

export function disposeBigPicturePlaybarMetadata(doc: Document): void {
	const state = states.get(doc); if (!state) return;
	states.delete(doc); state.observer?.disconnect(); state.disposeEvents();
	const view = doc.defaultView; if (state.timer) view?.clearInterval(state.timer); if (state.frame) view?.cancelAnimationFrame(state.frame);
	for (const node of state.nodes.values()) node.remove(); state.nodes.clear();
}
export function disposeAllBigPicturePlaybarMetadata(): void {
	for (const doc of Array.from(states.keys())) disposeBigPicturePlaybarMetadata(doc);
}
