import { toSignedShortcutAppId } from '../../steam/shortcuts';
import type { MappedShortcut } from './types';

/** Resolve mapped shortcut overview objects without rescanning the full library
 * on every Big Picture refresh. A full allApps pass is only used for IDs that
 * Steam's map/overview API cannot resolve directly. */
export function collectMappedShortcutApps(appStore: any, mappedShortcuts: MappedShortcut[]): any[] {
	const candidates: any[] = [];
	const candidateSet = new Set<object>();
	const unresolvedIds = new Set<number>();
	const addCandidate = (app: any): boolean => {
		if (!app || typeof app !== 'object' || candidateSet.has(app)) return false;
		candidateSet.add(app);
		candidates.push(app);
		return true;
	};

	for (const shortcut of mappedShortcuts) {
		const unsigned = shortcut.id < 0 ? (shortcut.id >>> 0) : shortcut.id;
		const signed = toSignedShortcutAppId(unsigned);
		let app: any = null;
		try {
			if (typeof appStore.GetAppOverviewByAppID === 'function') {
				app = appStore.GetAppOverviewByAppID(unsigned) || appStore.GetAppOverviewByAppID(signed);
			}
			if (!app && typeof appStore.m_mapApps?.get === 'function') {
				app = appStore.m_mapApps.get(unsigned) || appStore.m_mapApps.get(signed)
					|| appStore.m_mapApps.get(String(unsigned)) || appStore.m_mapApps.get(String(signed));
			}
		} catch {}
		if (!addCandidate(app)) unresolvedIds.add(unsigned);
	}

	if (unresolvedIds.size > 0) {
		try {
			for (const app of Array.from(appStore.allApps || []) as any[]) {
				const rawId = Number(app?.appid);
				const unsigned = rawId < 0 ? (rawId >>> 0) : rawId;
				if (unresolvedIds.has(unsigned) && addCandidate(app)) unresolvedIds.delete(unsigned);
				if (unresolvedIds.size === 0) break;
			}
		} catch {}
	}
	return candidates;
}
