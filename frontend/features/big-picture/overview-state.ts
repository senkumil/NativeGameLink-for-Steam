import { normalizeGamepadAppId } from '../../steam/gamepad/GamepadContext';
import { AppStoreAdapter } from '../../steam/gamepad/stores/AppStoreAdapter';
import { steamUIModeService } from '../../steam/ui/SteamUIModeService';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';

export type BigPicturePlaytimeKey = 'minutes_playtime_forever' | 'minutes_playtime_last_two_weeks'
	| 'rt_last_time_played' | 'm_rtimeLastPlayed' | 'rtime_last_played' | 'rt_recent_activity_time';
type Snapshot = { original?: PropertyDescriptor; installed: PropertyDescriptor };
const ownedFields = new Map<Document, Map<object, Map<BigPicturePlaytimeKey, Snapshot>>>();
const fieldOwners = new WeakMap<object, Map<BigPicturePlaytimeKey, Document>>();
const playtimeKeys = new Set<string>(['minutes_playtime_forever', 'minutes_playtime_last_two_weeks',
	'rt_last_time_played', 'm_rtimeLastPlayed', 'rtime_last_played', 'rt_recent_activity_time']);
const ownedLabels = new Map<Document, Map<HTMLElement, { original: string; installed: string; marker: string | null }>>();

function liveGamepadDocument(doc: Document): boolean {
	const view = doc.defaultView;
	return Boolean(view && !view.closed && view.document === doc && doc.body?.isConnected && steamUIModeService.isGamepadUI(doc));
}

export function setBigPicturePlaytimeLabel(doc: Document, element: HTMLElement, value: string): void {
	if (!liveGamepadDocument(doc) || element.ownerDocument !== doc || !element.isConnected) return;
	let labels = ownedLabels.get(doc);
	if (!labels) ownedLabels.set(doc, labels = new Map());
	const prior = labels.get(element);
	const original = prior && element.textContent === prior.installed ? prior.original : element.textContent || '';
	const marker = prior && element.getAttribute('data-gdl-bp-playtime') === '1' ? prior.marker : element.getAttribute('data-gdl-bp-playtime');
	labels.set(element, { original, installed: value, marker });
	element.textContent = value;
	element.dataset.gdlBpPlaytime = '1';
}

function sameValue(a?: PropertyDescriptor, b?: PropertyDescriptor): boolean {
	return Boolean(a && b && a.value === b.value && a.get === b.get && a.set === b.set
		&& a.configurable === b.configurable && a.enumerable === b.enumerable && a.writable === b.writable);
}

/** Project measured shortcut playtime only. Execution, installation and
 * controller/Deck classification always stay owned by Steam. */
export function setBigPicturePlaytimeField(doc: Document, target: any, key: BigPicturePlaytimeKey, value: number): boolean {
	const id = normalizeGamepadAppId(target?.appid);
	if (!playtimeKeys.has(key) || !liveGamepadDocument(doc)
		|| id === null || id < 2147483648 || !getCommittedShortcutSteamAppId(id)
		|| AppStoreAdapter.getAppOverview(id, doc) !== target
		|| !Number.isFinite(value) || value < 0 || Number(target[key]) === value) return false;
	const previousOwner = fieldOwners.get(target)?.get(key);
	if (previousOwner && previousOwner !== doc) return false;
	const current = Object.getOwnPropertyDescriptor(target, key);
	let objects = ownedFields.get(doc);
	if (!objects) ownedFields.set(doc, objects = new Map());
	let fields = objects.get(target);
	if (!fields) objects.set(target, fields = new Map());
	const prior = fields.get(key);
	const original = prior && sameValue(current, prior.installed) ? prior.original : current;
	try {
		Object.defineProperty(target, key, { configurable: true, enumerable: current?.enumerable ?? true, writable: true, value });
		fields.set(key, { original, installed: Object.getOwnPropertyDescriptor(target, key)! });
		let owners = fieldOwners.get(target);
		if (!owners) fieldOwners.set(target, owners = new Map());
		owners.set(key, doc);
		return true;
	} catch {
		if (!fields.size) objects.delete(target);
		if (!objects.size) ownedFields.delete(doc);
		return false;
	}
}

export function restoreBigPictureOverviewState(doc?: Document): void {
	for (const [owner, labels] of ownedLabels) {
		if (doc && owner !== doc) continue;
		for (const [element, state] of labels) {
			if (element.textContent === state.installed) element.textContent = state.original;
			if (element.getAttribute('data-gdl-bp-playtime') === '1') {
				if (state.marker === null) element.removeAttribute('data-gdl-bp-playtime'); else element.setAttribute('data-gdl-bp-playtime', state.marker);
			}
		}
		ownedLabels.delete(owner);
	}
	for (const [owner, objects] of ownedFields) {
		if (doc && owner !== doc) continue;
		for (const [target, fields] of objects) for (const [key, snapshot] of fields) {
			if (sameValue(Object.getOwnPropertyDescriptor(target, key), snapshot.installed)) try {
				if (snapshot.original) Object.defineProperty(target, key, snapshot.original); else Reflect.deleteProperty(target, key);
			} catch {}
			const owners = fieldOwners.get(target);
			if (owners?.get(key) === owner) owners.delete(key);
			if (!owners?.size) fieldOwners.delete(target);
		}
		ownedFields.delete(owner);
	}
}
