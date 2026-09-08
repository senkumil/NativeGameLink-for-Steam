import { mappings, subscribeMappings } from '../core/mappings';
import { setProtectedCacheAppIds } from '../core/cache';
import { restartLinkedGamePrefetch } from '../features/library/prefetch';
import { invalidateLinkedGameResourceCaches } from '../features/library/resource-cache';

interface MappingRefreshHost {
	getCurrentAppId: () => string | null;
	getCurrentShortcutAppId: () => string | null;
	resetLibrary: () => void;
	refreshBigPicture?: () => void;
}

/** Coalesce bulk mapping snapshots and refresh only identities that changed. */
export function installMappingRefresh(host: MappingRefreshHost): () => void {
	let observed = { ...mappings };
	const affectedAppIds = new Set<string>();
	const staleAppIds = new Set<string>();
	const shortcutAppIds = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let hasMappingChanges = false;
	const unsubscribe = subscribeMappings(value => {
		const previous = observed;
		observed = { ...value };
		setProtectedCacheAppIds(Object.values(value));
		for (const key of new Set([...Object.keys(previous), ...Object.keys(value)])) {
			if (previous[key] === value[key]) continue;
			hasMappingChanges = true;
			if (!key.startsWith('shortcut:')) continue;
			const shortcutId = key.slice('shortcut:'.length);
			if (shortcutId) shortcutAppIds.add(shortcutId);
			for (const appId of [previous[key], value[key]]) {
				if (/^\d+$/.test(String(appId || ''))) affectedAppIds.add(String(appId));
			}
			if (/^\d+$/.test(String(previous[key] || ''))) staleAppIds.add(String(previous[key]));
		}
		if (!hasMappingChanges) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			if (!hasMappingChanges) return;
			hasMappingChanges = false;
			const affected = Array.from(affectedAppIds);
			const stale = Array.from(staleAppIds);
			const shortcuts = Array.from(shortcutAppIds);
			affectedAppIds.clear(); staleAppIds.clear(); shortcutAppIds.clear();
			// Linking already force-refreshed the new AppID. Keep that result warm;
			// only the former identity and shortcut-scoped aliases are stale.
			if (stale.length || shortcuts.length) invalidateLinkedGameResourceCaches(stale, shortcuts);
			restartLinkedGamePrefetch(affected);
			if (affected.includes(String(host.getCurrentAppId() || ''))
				|| shortcuts.includes(String(host.getCurrentShortcutAppId() || ''))) host.resetLibrary();
			host.refreshBigPicture?.();
		}, 120);
	});
	return () => {
		if (timer) clearTimeout(timer);
		unsubscribe();
	};
}
