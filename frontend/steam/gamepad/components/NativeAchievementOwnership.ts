import { backendLog } from '../../../api/backend';
import { isMappingSnapshotVerified, mappings, shortcutMappingKey } from '../../../core/mappings';

interface AppDetailsGuardState { owners: Set<Document>; legacy: boolean; restore: () => void }
const appDetailsGuardRestores = new Map<any, AppDetailsGuardState>();
const achievementStateRestores = new Map<() => void, { id: number; owners: Set<Document>; legacy: boolean }>();
function isOwnerSet(value: Document | Set<Document> | undefined): value is Set<Document> {
	return Boolean(value && typeof (value as Set<Document>).add === 'function' && typeof (value as Set<Document>).has === 'function'
		&& typeof (value as Set<Document>).delete === 'function' && typeof (value as Set<Document>).values === 'function');
}

/** Restore only shortcut state still owned by an installed projection. */
export function registerNativeAchievementStateRestore(shortcutAppId: number, restore: () => void, owner?: Document | Set<Document>): () => void {
	const id = shortcutAppId >>> 0;
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < -2147483648 || shortcutAppId > 4294967295 || id < 2147483648) return () => {};
	const existing = achievementStateRestores.get(restore);
	if (existing) {
		if (isOwnerSet(owner)) for (const doc of owner) existing.owners.add(doc);
		else if (owner) existing.owners.add(owner);
		else existing.legacy = true;
	} else achievementStateRestores.set(restore, { id, owners: isOwnerSet(owner) ? owner : new Set(owner ? [owner] : []), legacy: !owner });
	return () => achievementStateRestores.delete(restore);
}

export function restoreNativeAchievementState(shortcutAppId?: number, owner?: Document): void {
	const id = shortcutAppId === undefined ? undefined : shortcutAppId >>> 0;
	// A projection may have replaced an earlier compatibility fallback. Unwind
	// in reverse order so each owner can restore the object it originally saw.
	for (const [restore, state] of Array.from(achievementStateRestores).reverse()) {
		if (id !== undefined && state.id !== id) continue;
		if (owner) {
			if (!state.owners.has(owner)) continue;
			state.owners.delete(owner);
			if (state.owners.size > 0 || state.legacy) continue;
		}
		achievementStateRestores.delete(restore);
		try { restore(); } catch {}
	}
}

export function releaseAppDetailsGuards(owner: Document): void {
	for (const state of Array.from(appDetailsGuardRestores.values())) {
		state.owners.delete(owner);
		if (!state.legacy && state.owners.size === 0) state.restore();
	}
}

export function ensureAppDetailsStoreGuarded(store: any, owner?: Document): void {
	if (!store) return;
	const existing = appDetailsGuardRestores.get(store);
	if (existing) { if (owner) existing.owners.add(owner); else existing.legacy = true; return; }
	if (store.__ngl_achievements_guarded) return;
	try {
		const origGetAchievements = store.GetAchievements;
		if (typeof origGetAchievements === 'function') {
			const descriptor = Object.getOwnPropertyDescriptor(store, 'GetAchievements');
			const marker = Object.getOwnPropertyDescriptor(store, '__ngl_achievements_guarded');
			const state: AppDetailsGuardState = { owners: new Set(owner ? [owner] : []), legacy: !owner, restore: () => {} };
			store.GetAchievements = function (appId: number, ...args: any[]) {
				const rawId = Number(appId), shortcutId = rawId >>> 0;
				// Steam's public achievements must retain the original method, data
				// identity and lazy RequestAchievements path, including missing data.
				if (!Number.isInteger(rawId) || rawId < -2147483648 || rawId > 4294967295
					|| shortcutId < 2147483648 || !isMappingSnapshotVerified()
					|| !/^\d+$/.test(String(mappings[shortcutMappingKey(shortcutId)] || ''))) {
					return origGetAchievements.call(this, appId, ...args);
				}
				try {
					const appData = this.GetAppData(appId);
					if (appData) {
						if (!appData.details?.achievements) {
							const original = appData.details;
							const installed = { ...(original || {}), unAppID: appId, achievements: {
								nTotal: 0,
								nAchieved: 0,
								vecHighlight: [],
								vecUnachieved: [],
								vecAchievedHidden: [],
							} };
							appData.details = installed;
							registerNativeAchievementStateRestore(shortcutId, () => {
								if (appData.details === installed) appData.details = original;
							}, state.legacy ? undefined : state.owners);
						}
					}
				} catch {}
				return origGetAchievements.call(this, appId, ...args);
			};
			const wrapper = store.GetAchievements;
			store.__ngl_achievements_guarded = true;
			state.restore = () => {
				appDetailsGuardRestores.delete(store);
				if (store.GetAchievements === wrapper) {
					if (descriptor) Object.defineProperty(store, 'GetAchievements', descriptor); else delete store.GetAchievements;
				}
				if (store.__ngl_achievements_guarded === true) {
					if (marker) Object.defineProperty(store, '__ngl_achievements_guarded', marker); else delete store.__ngl_achievements_guarded;
				}
			};
			appDetailsGuardRestores.set(store, state);
			backendLog('[NGL][Gamepad] Guarded native AppDetailsStore.GetAchievements to prevent undefined crash');
		}
	} catch (e) {
		backendLog(`[NGL][Gamepad] Failed to guard AppDetailsStore: ${e}`);
	}
}


export function clearAppDetailsGuards(): void {
	for (const state of Array.from(appDetailsGuardRestores.values())) state.restore();
}
