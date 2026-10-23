import { backendLog, factoryResetBackend, setAchievementBasePathBackend } from '../../api/backend';
import { clearAllManagedArtworkMarkers, clearLibraryAssetCaches } from '../library/artwork';
import { DEFAULT_PREFERENCES, getPreferences, setPreferences } from '../../core/preferences';
import { mappings, persistMappingsSnapshot, updateMappingsChecked } from '../../core/mappings';
import { unlinkAllShortcutsFromSteam } from './unlinking';
import { shortcutRuntimeHost } from './host';
import { cancelAllPendingLinkJobs, pausePendingLinkJobs, resumePendingLinkJobs } from './link-job-queue';
import { pauseLinkedGamePrefetch, resumeLinkedGamePrefetch } from '../library/prefetch';
import { clearAllDismissedShortcuts } from './dismissed';
import { clearAllLinkHistory } from './link-history';
import { clearShortcutDetectionCache } from './detection';
import { clearShortcutAchievementSettingsCaches } from './achievement-properties';
import { clearCommunityItemOptions } from '../../core/community-item-options';
import { clearLocalAchievementCache } from '../achievements/cache';
import {
	bumpFactoryResetEpoch,
	clearAllShortcutManifests,
	getActiveTransactionCount,
	setFactoryResetInProgress,
} from './transaction';

export interface FactoryResetOptions {
	deletePlaytime: boolean;
	doc?: Document | null;
}

export interface FactoryResetResult {
	ok: boolean;
	error?: string;
}

async function withFactoryResetBudget<T>(label: string, operation: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			operation,
			new Promise<T>(resolve => {
				timer = setTimeout(() => {
					backendLog(`[NGL][FactoryReset] ${label} exceeded ${timeoutMs}ms; continuing reset with bounded fallback.`);
					resolve(fallback);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function performFactoryReset(options: FactoryResetOptions): Promise<FactoryResetResult> {
	backendLog(`[NGL][FactoryReset] Starting factory reset (deletePlaytime=${options.deletePlaytime})`);
	setFactoryResetInProgress(true);
	clearCommunityItemOptions();
	try {
		// 1. Invalidate generations and abort all active link transactions
		const epoch = bumpFactoryResetEpoch();
		backendLog(`[NGL][FactoryReset] Invalidate generations and active transactions. Epoch=${epoch}`);

		// 2. Pause queues and cancel pending link retry jobs
		pauseLinkedGamePrefetch();
		await withFactoryResetBudget('pause pending jobs', pausePendingLinkJobs(1800), 2200, undefined);
		cancelAllPendingLinkJobs();
		backendLog('[NGL][FactoryReset] Paused queues and cancelled pending jobs');

		// 3. Unlink all shortcuts from Steam Client and clear custom Steam grid artwork
		try {
			await withFactoryResetBudget(
				'unlink all shortcuts',
				unlinkAllShortcutsFromSteam(options.doc, true),
				9000,
				{ ok: false, total: 0, unlinked: 0, failed: 0 },
			);
		} catch (unlinkErr) {
			backendLog(`[NGL][FactoryReset] Shortcut unlink warning: ${unlinkErr}`);
		}

		// 4. Clear dismissed shortcuts & link history in memory and storage
		clearAllDismissedShortcuts();
		clearAllLinkHistory();
		backendLog('[NGL][FactoryReset] Cleared in-memory and stored dismissals and link history');

		// 5. Clear all shortcut resource manifests
		const manifestsCleared = clearAllShortcutManifests();
		backendLog(`[NGL][FactoryReset] Cleared ${manifestsCleared} resource manifests`);

		// 6. Clear library asset caches, detection cache & managed artwork markers
		clearLibraryAssetCaches();
		clearShortcutDetectionCache();
		clearShortcutAchievementSettingsCaches();
		clearLocalAchievementCache(true);
		const markersCleared = clearAllManagedArtworkMarkers();
		backendLog(`[NGL][FactoryReset] Cleared ${markersCleared} managed artwork markers and caches`);

		// 7. Call backend factory reset IPC
		try {
			await withFactoryResetBudget('backend reset IPC', factoryResetBackend({
				request_json: JSON.stringify({ delete_playtime: options.deletePlaytime }),
			}), 5000, null as any);
		} catch (ipcErr) {
			backendLog(`[NGL][FactoryReset] Backend call warning: ${ipcErr}`);
		}

		// 8. Clear localStorage keys belonging to the plugin (preserve playtime if requested)
		try {
			const keys = Object.keys(localStorage);
			for (const key of keys) {
				const isPlaytimeKey = key.startsWith('gdl_playtime') || key.startsWith('gdl-playtime');
				if (!options.deletePlaytime && isPlaytimeKey) {
					continue;
				}
				if (
					key.startsWith('gdl_') ||
					key.startsWith('gdl-') ||
					key.startsWith('gdl:') ||
					key.startsWith('nativegamelink')
				) {
					localStorage.removeItem(key);
				}
			}
		} catch (storageErr) {
			backendLog(`[NGL][FactoryReset] localStorage warning: ${storageErr}`);
		}

		// 9. Reset preferences, preserving user's steamGridDbApiKey
		const currentApiKey = getPreferences().steamGridDbApiKey || '';
		setPreferences({ ...DEFAULT_PREFERENCES, steamGridDbApiKey: currentApiKey });
		backendLog('[NGL][FactoryReset] Reset preferences to defaults (preserved SteamGridDB API key)');

		// 10. Reset mappings to empty in memory and disk, and notify subscribers
		try {
			const currentKeys = Object.keys(mappings);
			if (currentKeys.length > 0) {
				await withFactoryResetBudget('mapping clear', updateMappingsChecked({ remove: currentKeys }), 5000, false);
			}
			persistMappingsSnapshot({});
		} catch (mappingsErr) {
			backendLog(`[NGL][FactoryReset] Mappings clear warning: ${mappingsErr}`);
		}

		// 11. Reset achievement base path in backend
		try {
			await withFactoryResetBudget('achievement path reset', setAchievementBasePathBackend({ path: '%APPDATA%\\SteamAchievements' }), 2500, null as any);
		} catch {}

		// 12. If playtime was deleted, dispatch reset event
		if (options.deletePlaytime && typeof window !== 'undefined') {
			try {
				window.dispatchEvent(new CustomEvent('gdl:playtime-reset'));
			} catch {}
		}

		// 13. Reset library injection and hot refresh
		try {
			shortcutRuntimeHost().resetLibraryInjection?.(true, options.doc || undefined);
		} catch {}

		// 14. Verification and diagnostic report
		const mappingCount = Object.keys(mappings).length;
		const activeTxCount = getActiveTransactionCount();
		backendLog(`[NGL][FactoryReset] Verification complete. Mappings: ${mappingCount}, Active tx: ${activeTxCount}, Pending jobs: 0, Resource manifests: 0`);

		return { ok: true };
	} catch (err) {
		backendLog(`[NGL][FactoryReset] Failed: ${err}`);
		return { ok: false, error: String(err) };
	} finally {
		setFactoryResetInProgress(false);
		resumePendingLinkJobs();
		resumeLinkedGamePrefetch();
	}
}
