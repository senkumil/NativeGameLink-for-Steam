import { backendLog, clearAllLinkedArtworksBackend, clearArtworkBackend, clearArtworkExceptIconBackend, restoreSteamAppIdFileBackend } from '../../api/backend';
import { removeShortcutMappingsChecked, shortcutMappingKey, updateMappingsChecked } from '../../core/mappings';
import { normalizeTitle } from '../../core/text';
import { getShortcutAppById, readShortcutOverviewField } from '../../steam/shortcuts';
import { hasManagedArtworkSaved, supersedeArtworkApplications } from '../library/artwork';
import { pauseLinkedGamePrefetch, resumeLinkedGamePrefetch } from '../library/prefetch';
import { dismissShortcut, undismissShortcut } from './dismissed';
import { shortcutRuntimeHost } from './host';
import { cancelAllPendingLinkJobs, cancelPendingLinkJobs, pausePendingLinkJobs, resumePendingLinkJobs } from './link-job-queue';
import { findMappingForShortcut, getAllShortcutRecords, normalizedShortcutAppId } from './registry';
import { forgetOriginalShortcutTitle, forgetShortcutSteamAppId, getOriginalShortcutTitle } from './link-history';
import { runShortcutMutations, shortcutMutationKeys } from './operation-lock';
import { clearShortcutManifest, clearAllShortcutManifests } from './transaction';
import { clearShortcutEdition } from './editions';
import { purgeShortcutStorage, purgeShortcutCachesAndArtwork } from './purge';
export { purgeShortcutStorage, purgeShortcutCachesAndArtwork };

export interface ShortcutUnlinkOptions {
	doc?: Document | null;
	shortcutAppId: string | number;
	title: string;
	steamAppId?: string | null;
	exePath?: string | null;
	preserveLinkHistory?: boolean;
	clearIcon?: boolean;
}

export interface ShortcutUnlinkResult {
	ok: boolean;
	shortcutAppId?: number;
	steamAppId?: string;
	error?: string;
}

/**
 * Fully unlink one non-Steam shortcut. A link writes several recovery aliases
 * (shortcut ID, title, executable and executable stem), so unlinking only the
 * exact shortcut key is insufficient and can cause a later partial relink.
 */
async function unlinkShortcutFromSteamUnlocked(options: ShortcutUnlinkOptions): Promise<ShortcutUnlinkResult> {
	const shortcutAppId = normalizedShortcutAppId(options.shortcutAppId);
	if (!shortcutAppId) return { ok: false, error: 'invalid_shortcut_id' };

	const app = getShortcutAppById(shortcutAppId);
	const exePath = String(options.exePath || readShortcutOverviewField(
		app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
	) || '').trim();
	const steamAppId = String(options.steamAppId
		|| findMappingForShortcut(shortcutAppId, options.title, exePath)
		|| '').trim();

	// Cancel durable retries first. Otherwise a queued link could finish after
	// the user explicitly unlinked the shortcut and recreate the mapping.
	cancelPendingLinkJobs(shortcutAppId, options.title);

	// Suppress the automatic modal while the transactional removal is in flight.
	// A later explicit Link/Save clears this state centrally in linking.ts.
	dismissShortcut(shortcutAppId);
	const removed = await removeShortcutMappingsChecked({
		shortcutAppId,
		title: options.title,
		exePath,
		steamAppId,
	});
	if (!removed) {
		undismissShortcut(shortcutAppId);
		return { ok: false, shortcutAppId, steamAppId, error: 'mapping_remove_failed' };
	}

	clearShortcutManifest(shortcutAppId);
	clearShortcutEdition(shortcutAppId);
	const supersedePromise = supersedeArtworkApplications(shortcutAppId, !options.clearIcon);
	let supersedeSettled = false;
	await Promise.race([
		supersedePromise.then(() => { supersedeSettled = true; }).catch(error => {
			backendLog(`Artwork supersede warning for ${shortcutAppId}: ${error}`);
			supersedeSettled = true;
		}),
		new Promise<void>(resolve => setTimeout(resolve, 1200)),
	]);
	if (!supersedeSettled) {
		backendLog(`Unlink ${shortcutAppId}: artwork bridge is still settling; continuing logical unlink and scheduling a final cleanup pass.`);
	}
	try {
		const apps = (window as any).SteamClient?.Apps;
		if (typeof apps?.ClearCustomArtworkForApp === 'function') {
			for (let slot = 0; slot < 5; slot += 1) {
				try { apps.ClearCustomArtworkForApp(shortcutAppId, slot); } catch {}
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (options.clearIcon) {
			if (typeof apps?.SetShortcutIcon === 'function') {
				try { void apps.SetShortcutIcon(shortcutAppId, ''); } catch {}
			}
		}
		purgeShortcutStorage(shortcutAppId);
		const originalTitle = getOriginalShortcutTitle(shortcutAppId);
		if (originalTitle && typeof apps?.SetShortcutName === 'function') {
			try {
				void apps.SetShortcutName(shortcutAppId, originalTitle);
				backendLog(`Restored original shortcut name "${originalTitle}" for shortcut ${shortcutAppId}.`);
			} catch (error) {
				backendLog(`Unlink shortcut rename restore failed for ${shortcutAppId}: ${error}`);
			}
		}
		forgetOriginalShortcutTitle(shortcutAppId);
		if (!options.preserveLinkHistory) forgetShortcutSteamAppId(shortcutAppId);
		if (options.clearIcon) {
			void clearArtworkBackend({ shortcut_app_id: String(shortcutAppId) }).catch((_error: unknown): void => {});
		} else {
			void clearArtworkExceptIconBackend({ shortcut_app_id: String(shortcutAppId) }).catch((_error: unknown): void => {});
		}
		const startDir = String(readShortcutOverviewField(app, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir', 'strStartDir') || '').trim();
		void restoreSteamAppIdFileBackend({
			request_json: JSON.stringify({ exe_path: exePath, start_dir: startDir }),
		}).catch(error => backendLog('Restore steam_appid.txt skipped: ' + error));
	} catch (error) {
		backendLog(`Unlink artwork cleanup failed for ${shortcutAppId}: ${error}`);
	}

	if (!supersedeSettled) {
		void supersedePromise.then(async () => {
			try {
				const apps = (window as any).SteamClient?.Apps;
				if (typeof apps?.ClearCustomArtworkForApp === 'function') {
					for (let slot = 0; slot < 5; slot += 1) {
						try { apps.ClearCustomArtworkForApp(shortcutAppId, slot); } catch {}
					}
				}
				if (options.clearIcon && typeof apps?.SetShortcutIcon === 'function') {
					try { void apps.SetShortcutIcon(shortcutAppId, ''); } catch {}
				}
				if (options.clearIcon) await clearArtworkBackend({ shortcut_app_id: String(shortcutAppId) });
				else await clearArtworkExceptIconBackend({ shortcut_app_id: String(shortcutAppId) });
				shortcutRuntimeHost().refreshLibraryArtwork?.(shortcutAppId);
			} catch (error) {
				backendLog(`Deferred unlink cleanup failed for ${shortcutAppId}: ${error}`);
			}
		}).catch(() => {});
	}

	try { shortcutRuntimeHost().resetLibraryInjection?.(true, options.doc || undefined); } catch {}
	backendLog(`Shortcut ${shortcutAppId} fully unlinked from Steam AppID ${steamAppId || 'unknown'}.`);
	return { ok: true, shortcutAppId, steamAppId };
}

export function unlinkShortcutFromSteam(options: ShortcutUnlinkOptions): Promise<ShortcutUnlinkResult> {
	const shortcutAppId = normalizedShortcutAppId(options.shortcutAppId);
	const app = shortcutAppId ? getShortcutAppById(shortcutAppId) : null;
	const currentExePath = String(readShortcutOverviewField(
		app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
	) || '').trim();
	return runShortcutMutations(shortcutMutationKeys({
		shortcutAppId: options.shortcutAppId,
		title: options.title,
		exePath: options.exePath,
		exePaths: [currentExePath],
	}), () => unlinkShortcutFromSteamUnlocked(options));
}

export interface BulkUnlinkResult {
	ok: boolean;
	total: number;
	unlinked: number;
	failed: number;
}

/** Explicit global reset from Settings. Every current shortcut is dismissed so
 * startup/autodetection cannot resurrect it; only shortcuts that actually have
 * a NativeGameLink mapping have their managed artwork removed. */
export async function unlinkAllShortcutsFromSteam(doc?: Document | null, queuesAlreadyPaused = false): Promise<BulkUnlinkResult> {
	if (!queuesAlreadyPaused) {
		pauseLinkedGamePrefetch();
		await pausePendingLinkJobs(1800);
	}
	try {
	cancelAllPendingLinkJobs();
	const records = getAllShortcutRecords();
	for (const record of records) dismissShortcut(record.id);
	const targets = records.map(record => ({
		record,
		steamAppId: String(findMappingForShortcut(record.id, record.title) || '').trim(),
		hasManagedArtwork: hasManagedArtworkSaved(record.id),
	})).filter(item => /^\d+$/.test(item.steamAppId) || item.hasManagedArtwork);
	if (targets.length === 0) return { ok: true, total: 0, unlinked: 0, failed: 0 };

	const allKeysToRemove = new Set<string>();
	for (const { record } of targets) {
		allKeysToRemove.add(shortcutMappingKey(record.id));
		if (record.title) {
			allKeysToRemove.add(record.title);
			const normalized = normalizeTitle(record.title);
			if (normalized) allKeysToRemove.add(normalized);
		}
	}
	try {
		await updateMappingsChecked({ remove: Array.from(allKeysToRemove) });
	} catch (error) {
		backendLog('Bulk unlink mapping pre-clear warning: ' + String(error));
	}

	let unlinked = 0;
	let failed = 0;
	const unlinkWithBudget = async (record: { id: number; title: string }, steamAppId: string): Promise<ShortcutUnlinkResult> => {
		const hasMapping = /^\d+$/.test(steamAppId);
		const operation = unlinkShortcutFromSteam({
			doc,
			shortcutAppId: record.id,
			title: record.title,
			steamAppId: hasMapping ? steamAppId : '',
			preserveLinkHistory: true,
			clearIcon: true,
		});
		return await Promise.race([
			operation,
			new Promise<ShortcutUnlinkResult>(resolve => setTimeout(() => resolve({
				ok: false, shortcutAppId: record.id, steamAppId, error: 'unlink_timeout',
			}), 5000)),
		]);
	};
	const results = await Promise.all(targets.map(({ record, steamAppId }) => unlinkWithBudget(record, steamAppId)));

	void clearAllLinkedArtworksBackend().catch(() => {});
	clearAllShortcutManifests();
	const apps = (window as any).SteamClient?.Apps;
	for (const { record } of targets) {
		purgeShortcutStorage(record.id);
		if (typeof apps?.SetShortcutIcon === 'function') {
			try { void apps.SetShortcutIcon(record.id, ''); } catch {}
		}
	}

	for (const result of results) {
		if (result.ok) unlinked += 1;
		else {
			failed += 1;
			if (result.shortcutAppId) dismissShortcut(result.shortcutAppId);
		}
	}
	return { ok: failed === 0, total: targets.length, unlinked, failed };
	} finally {
		if (!queuesAlreadyPaused) {
			resumePendingLinkJobs();
			resumeLinkedGamePrefetch();
		}
	}
}

export function cleanAllArtworkAndRestoreNames(): void {
	try {
		const apps = (window as any).SteamClient?.Apps;
		const records = getAllShortcutRecords();
		for (const record of records) {
			if (typeof apps?.ClearCustomArtworkForApp === 'function') {
				for (let slot = 0; slot < 5; slot += 1) {
					try { apps.ClearCustomArtworkForApp(record.id, slot); } catch {}
				}
			}
			if (typeof apps?.SetShortcutIcon === 'function') {
				try { void apps.SetShortcutIcon(record.id, ''); } catch {}
			}
			try { localStorage.removeItem(`gdl_shortcut_icon_${record.id}`); } catch {}
			const originalTitle = getOriginalShortcutTitle(record.id);
			if (originalTitle && typeof apps?.SetShortcutName === 'function') {
				try { apps.SetShortcutName(record.id, originalTitle); } catch {}
			}
		}
		void clearAllLinkedArtworksBackend().catch(() => {});
	} catch {}
}
