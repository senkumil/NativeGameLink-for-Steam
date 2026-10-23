import { backendLog, clearAllLinkedArtworksBackend, clearArtworkBackend, clearArtworkSlotsBackend } from '../../api/backend';
import { removeShortcutMappingsChecked, shortcutMappingKey, updateMappingsChecked } from '../../core/mappings';
import { normalizeTitle } from '../../core/text';
import { hasManagedArtworkSaved, supersedeArtworkApplications } from '../library/artwork';
import { pauseLinkedGamePrefetch, resumeLinkedGamePrefetch } from '../library/prefetch';
import { dismissShortcut, isShortcutDismissed, undismissShortcut } from './dismissed';
import { shortcutRuntimeHost } from './host';
import { cancelAllPendingLinkJobs, cancelPendingLinkJobs, pausePendingLinkJobs, resumePendingLinkJobs } from './link-job-queue';
import { findMappingForShortcut, getAllShortcutRecords, normalizedShortcutAppId } from './registry';
import { forgetOriginalShortcutTitle, forgetShortcutSteamAppId, getOriginalShortcutTitle } from './link-history';
import { runShortcutMutations, shortcutMutationKeys } from './operation-lock';
import { clearShortcutManifest, clearActiveTransaction } from './transaction';
import { clearShortcutEdition } from './editions';
import { purgeShortcutStorage, purgeShortcutCachesAndArtwork } from './purge';
import { shortcutAppIdFileTarget, updateShortcutAppIdFile } from './steam-appid-file';
import { writeAssetWithDeadline } from '../library/asset-write';
import { writeNativeAsset, getPendingNativeAssetWrites } from '../library/native-asset-write';
import { shortcutExecutableIdentity, readShortcutOverviewField } from '../../steam/shortcuts';
import { getPendingShortcutIdentityWrites } from './link-orchestrator';
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

function unlinkDocument(doc?: Document | null): Document | null {
	if ((doc?.defaultView as any)?.SteamClient?.Apps) return doc;
	try { return shortcutRuntimeHost().getMainWindowDoc() || doc || null; }
	catch { return doc || null; }
}

/** Both native IPC and disk deletion are fenced. A relink must never be erased
 * by a slow, fire-and-forget cleanup from the previous unlink. */
async function clearUnlinkedArtwork(shortcutAppId: number, clearIcon: boolean, doc: Document | null): Promise<void> {
	const isCurrent = (): boolean => isShortcutDismissed(shortcutAppId);
	if (!isCurrent()) return;
	await writeAssetWithDeadline(guard => clearIcon
		? clearArtworkBackend({ shortcut_app_id: String(shortcutAppId), ...guard })
		: clearArtworkSlotsBackend({ request_json: JSON.stringify({ shortcut_app_id: shortcutAppId,
			slots: [0, 1, 2, 3], ...guard }) }), isCurrent, Date.now() + 2500);
	const apps = (doc?.defaultView as any)?.SteamClient?.Apps;
	if (typeof apps?.ClearCustomArtworkForApp !== 'function' || !isCurrent()) return;
	const cleared = await writeNativeAsset(shortcutAppId, 'unlink-clear', async () => {
		const results = await Promise.all(Array.from({ length: clearIcon ? 5 : 4 }, (_, slot) =>
			Promise.resolve(apps.ClearCustomArtworkForApp(shortcutAppId, slot))));
		if (clearIcon && typeof apps.SetShortcutIcon === 'function') await apps.SetShortcutIcon(shortcutAppId, '');
		return results.every(result => result !== false);
	}, isCurrent, 1200);
	// Steam can acknowledge IPC just before publishing its artwork cache clear.
	if (cleared) await new Promise(resolve => setTimeout(resolve, 100));
}

function resolveUnlinkedShortcutId(shortcutAppId: number, exePath: string, doc: Document | null): number {
	const records = getAllShortcutRecords(doc);
	if (records.some(record => record.id === shortcutAppId)) return shortcutAppId;
	const identity = shortcutExecutableIdentity(exePath);
	const matches = records.filter(record => identity && shortcutExecutableIdentity(readShortcutOverviewField(record.app,
		'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath')) === identity);
	return matches.length === 1 ? matches[0].id : shortcutAppId;
}

async function restoreUnlinkedName(shortcutAppId: number, exePath: string, doc: Document | null): Promise<number> {
	const originalTitle = getOriginalShortcutTitle(shortcutAppId);
	const apps = (doc?.defaultView as any)?.SteamClient?.Apps;
	if (!originalTitle || typeof apps?.SetShortcutName !== 'function' || !isShortcutDismissed(shortcutAppId)) return shortcutAppId;
	try {
		const targetId = resolveUnlinkedShortcutId(shortcutAppId, exePath, doc);
		const restored = await writeNativeAsset(targetId, 'rename',
			() => apps.SetShortcutName(targetId, originalTitle), () => isShortcutDismissed(shortcutAppId), 1500);
		if (!restored) return shortcutAppId;
		const identity = shortcutExecutableIdentity(exePath);
		const matches = getAllShortcutRecords(doc).filter(record => record.title === originalTitle
			&& identity && shortcutExecutableIdentity(readShortcutOverviewField(record.app,
				'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath')) === identity);
		const finalId = matches.length === 1 ? matches[0].id : shortcutAppId;
		if (finalId !== shortcutAppId) dismissShortcut(finalId);
		forgetOriginalShortcutTitle(shortcutAppId);
		backendLog(`Restored original shortcut name "${originalTitle}" for shortcut ${shortcutAppId}.`);
		return finalId;
	} catch (error) {
		backendLog(`Unlink shortcut rename restore failed for ${shortcutAppId}: ${error}`);
		return shortcutAppId;
	}
}

/**
 * Fully unlink one non-Steam shortcut. A link writes several recovery aliases
 * (shortcut ID, title, executable and executable stem), so unlinking only the
 * exact shortcut key is insufficient and can cause a later partial relink.
 */
async function unlinkShortcutFromSteamUnlocked(options: ShortcutUnlinkOptions): Promise<ShortcutUnlinkResult> {
	const shortcutAppId = normalizedShortcutAppId(options.shortcutAppId);
	if (!shortcutAppId) return { ok: false, error: 'invalid_shortcut_id' };

	const doc = unlinkDocument(options.doc);
	const appIdFileTarget = shortcutAppIdFileTarget(shortcutAppId, doc, options.exePath || '');
	const exePath = appIdFileTarget.exe_path;
	const steamAppId = String(options.steamAppId
		|| findMappingForShortcut(shortcutAppId, options.title, exePath)
		|| '').trim();

	// Cancellation was recorded synchronously at entry, before taking the lock.
	// Do not overwrite a newer explicit relink that is already waiting behind us.
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
	const pendingIdentity = getPendingShortcutIdentityWrites(shortcutAppId, exePath);
	const pendingNative = getPendingNativeAssetWrites(shortcutAppId);
	const supersedePromise = supersedeArtworkApplications(shortcutAppId, !options.clearIcon);
	const drained = Promise.allSettled([supersedePromise, ...pendingIdentity, ...pendingNative]);
	let supersedeSettled = false;
	await Promise.race([
		drained.then(() => { supersedeSettled = true; }),
		new Promise<void>(resolve => setTimeout(resolve, 1200)),
	]);
	if (!supersedeSettled) {
		backendLog(`Unlink ${shortcutAppId}: artwork bridge is still settling; continuing logical unlink and scheduling a final cleanup pass.`);
	}
	try {
		await clearUnlinkedArtwork(shortcutAppId, Boolean(options.clearIcon), doc);
	} catch (error) {
		backendLog(`Unlink artwork cleanup failed for ${shortcutAppId}: ${error}`);
	}
	purgeShortcutStorage(shortcutAppId);
	const finalShortcutAppId = supersedeSettled ? await restoreUnlinkedName(shortcutAppId, exePath, doc) : shortcutAppId;
	if (!options.preserveLinkHistory) forgetShortcutSteamAppId(shortcutAppId);
	const appIdFileRestored = await updateShortcutAppIdFile('restore', appIdFileTarget);

	if (!supersedeSettled) {
		void drained.then(() => runShortcutMutations(shortcutMutationKeys({
			shortcutAppId, exePath,
		}), async () => {
			// Explicit relink clears the dismissal. Recheck only after obtaining
			// its same identity locks so a late cleanup cannot erase new resources.
			if (!isShortcutDismissed(shortcutAppId)) return;
			await clearUnlinkedArtwork(shortcutAppId, Boolean(options.clearIcon), doc);
			const currentId = resolveUnlinkedShortcutId(shortcutAppId, exePath, doc);
			if (currentId !== shortcutAppId) {
				dismissShortcut(currentId);
				await clearUnlinkedArtwork(currentId, Boolean(options.clearIcon), doc);
			}
			await restoreUnlinkedName(shortcutAppId, exePath, doc);
			shortcutRuntimeHost().refreshLibraryArtwork?.(shortcutAppId);
		})).catch(error => backendLog(`Deferred unlink cleanup failed for ${shortcutAppId}: ${error}`));
	}
	try { shortcutRuntimeHost().resetLibraryInjection?.(true, options.doc || undefined); } catch {}
	backendLog(`Shortcut ${shortcutAppId} unlinked from Steam AppID ${steamAppId || 'unknown'}; steam_appid.txt restore=${appIdFileRestored}.`);
	return { ok: appIdFileRestored, shortcutAppId: finalShortcutAppId, steamAppId, ...(!appIdFileRestored ? { error: 'steam_appid_file_restore_failed' } : {}) };
}

export function unlinkShortcutFromSteam(options: ShortcutUnlinkOptions): Promise<ShortcutUnlinkResult> {
	const shortcutAppId = normalizedShortcutAppId(options.shortcutAppId);
	if (!shortcutAppId) return Promise.resolve({ ok: false, error: 'invalid_shortcut_id' });
	// Record cancellation before waiting behind the active link transaction.
	// Otherwise it can commit/requeue while the user is waiting to unlink it.
	cancelPendingLinkJobs(shortcutAppId, options.title);
	dismissShortcut(shortcutAppId);
	clearActiveTransaction(shortcutAppId, 'unlink');
	const currentExePath = shortcutAppId ? shortcutAppIdFileTarget(shortcutAppId, options.doc, options.exePath || '').exe_path : '';
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
	const records = getAllShortcutRecords(unlinkDocument(doc));
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

	// Each target already performs guarded cleanup under its mutation locks.
	// A global fire-and-forget sweep here could erase an immediate relink.

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
