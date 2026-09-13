import type { ShortcutLinkResult, SteamGameData } from '../../domain/types';
import { backendLog, neutralizeSteamAppIdFileBackend } from '../../api/backend';
import { getCanonicalGameData, getGameData } from '../../core/game-data';
import { shortcutMappingKey, updateMappingsChecked } from '../../core/mappings';
import { findActiveShortcutAppId, findShortcutAppIdByName, getShortcutAppById, readShortcutOverviewField, shortcutExecutableIdentity } from '../../steam/shortcuts';
import { applyOfficialShortcutIcon, getModernLibraryAssets, invalidateLibraryAssetCaches, refreshModernLibraryAssets, resolveShortcutIdAfterRename, spoofArtwork, type ArtworkApplyResult } from '../library/artwork';
import { clearShortcutArtworkForAppIdChange } from '../library/artwork-relink-cleanup';
import { isLegacyGame } from '../library/legacy-games';
import { getNews } from '../library/news';
import { invalidateLinkedGameResourceCaches } from '../library/resource-cache';
import { shortcutRuntimeHost } from './host';
import { isShortcutDismissed } from './dismissed';
import { findMappingForShortcut, getAllShortcutRecords, refreshShortcutRecordsFromBackend } from './registry';
import { rememberOriginalShortcutTitle, rememberShortcutSteamAppId } from './link-history';
import { runShortcutMutations, shortcutMutationKeys } from './operation-lock';
import { LinkOrchestrator } from './link-orchestrator';
import { fetchPlaytimeStatsBatch, setInstantPlaytimeStats } from '../playtime/service';

let shortcutIdentityMutationDepth = 0;

/** Steam's SetShortcutName can occasionally return a never-settling promise
 * even after the rename was applied. Keep the UI responsive and let the
 * durable retry queue reconcile the identity on the next attempt. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
		promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
	});
}

export function isShortcutIdentityMutationInProgress(): boolean {
	return shortcutIdentityMutationDepth > 0;
}

export type ShortcutLinkStatus = (message: string, color?: string) => void;
export type ShortcutLinkPhase = 'identity' | 'assets';

/**
 * Steam adds shortcuts picked from its "Add a Non-Steam Game" list
 * asynchronously. The confirmation dialog can be accepted before that entry
 * is visible through appStore, so resolve it over a short bounded window. A
 * stale pre-rename ID must fall through to title/executable recovery.
 */
export async function resolveShortcutForLink(
	doc: Document | null | undefined,
	title: string,
	initialId?: number | null,
	executableHint = '',
	canonicalName = '',
): Promise<number | null> {
	const waits = [0, 100, 250, 500, 900, 1500, 2500];
	await refreshShortcutRecordsFromBackend().catch(() => {});
	const expectedExecutable = shortcutExecutableIdentity(executableHint);
	for (const wait of waits) {
		if (wait) await new Promise(resolve => setTimeout(resolve, wait));
		if (wait >= 900) await refreshShortcutRecordsFromBackend().catch(() => {});
		if (initialId) {
			const exact = Number(initialId);
			if (Number.isFinite(exact) && exact >= 2147483648 && getShortcutAppById(exact)) return exact;
		}
		const routed = doc ? Number(findActiveShortcutAppId(doc, title) || 0) : 0;
		if (routed >= 2147483648 && getShortcutAppById(routed)) return routed;
		if (expectedExecutable) {
			const executableMatches = getAllShortcutRecords().filter(record => shortcutExecutableIdentity(readShortcutOverviewField(
				record.app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
			)) === expectedExecutable);
			if (executableMatches.length === 1) return executableMatches[0].id;
			// During a rename Steam can briefly expose the old and regenerated rows
			// together. Prefer the regenerated ID only when it also carries the exact
			// canonical title; never let the queued retry fall back to the stale ID.
			const regenerated = executableMatches.find(record => record.id !== Number(initialId || 0)
				&& String(record.title || '').trim() === canonicalName);
			if (regenerated) return regenerated.id;
			if (executableMatches.length > 0) return executableMatches[0].id;
		}
		const byName = findShortcutAppIdByName(title);
		if (byName && getShortcutAppById(byName)) return byName;
	}
	if (initialId) {
		const exact = Number(initialId);
		if (Number.isFinite(exact) && exact >= 2147483648) return exact;
	}
	const routedFallback = doc ? Number(findActiveShortcutAppId(doc, title) || 0) : 0;
	if (routedFallback >= 2147483648) return routedFallback;
	const byNameFallback = findShortcutAppIdByName(title);
	if (byNameFallback && byNameFallback >= 2147483648) return byNameFallback;
	return null;
}

const LAUNCHER_BYPASS_APP_IDS = new Set<string>([
	'1817070', '1817190', '2651280', '1895840', '2215430', '2420110', '1151640',
	'1088850', '391220', '750920', '203160', '337000', '238010', '1086940',
	'435150', '1091500', '292030', '49520', '261640', '397540', '1286680',
	'409710', '409720', '8870', '1030840', '1055820', '360430', '268500',
	'368260', '1158310', '394360', '281990', '236850', '255710', '1142710',
	'594570', '364360', '779340',
]);

export function getOptimalLauncherSkipArg(steamAppId: string): string | null {
	const id = String(steamAppId || '').trim();
	if (!id) return null;
	if (id === '1091500' || id === '292030') return '--launcher-skip';
	if (id === '1086940' || id === '435150') return '--skip-launcher';
	if (LAUNCHER_BYPASS_APP_IDS.has(id)) return '-nolauncher';
	return null;
}

export function removeIncompatibleLauncherBypass(existing: string, steamAppId: string): string {
	if (shouldAutoApplyNoLauncher(steamAppId)) return existing;
	return String(existing || '')
		.replace(/(^|\s)-nolauncher(?=\s|$)/gi, ' ')
		.replace(/(^|\s)--launcher-skip(?=\s|$)/gi, ' ')
		.replace(/(^|\s)--skip-launcher(?=\s|$)/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function mergeNoLauncherOption(existing: string, steamAppId = ''): string {
	const current = String(existing || '').trim();
	const arg = getOptimalLauncherSkipArg(steamAppId);
	if (!arg) return current;
	if (current.includes(arg)) return current;
	return current ? `${current} ${arg}` : arg;
}

export function hasNoLauncherOption(value: string): boolean {
	const text = String(value || '').trim();
	return /(^|\s)(-nolauncher|--launcher-skip|--skip-launcher)(?=\s|$)/i.test(text);
}

export function shouldAutoApplyNoLauncher(steamAppId: string): boolean {
	return Boolean(getOptimalLauncherSkipArg(steamAppId));
}

/** Warm every read-only dependency while bulk detection continues. Identity
 * mutations remain serialized, but they no longer pay the network latency of
 * the next game's metadata and artwork lookup. */
export async function warmShortcutLinkResources(steamAppId: string): Promise<void> {
	const appId = String(steamAppId || '').trim();
	if (!/^\d+$/.test(appId)) return;
	await Promise.allSettled([
		getGameData(appId),
		getCanonicalGameData(appId),
		getModernLibraryAssets(appId),
	]);
}

export function applyNoLauncherOption(shortcutAppId: number, fallbackOptions = '', _automatic = false): boolean {
	const apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.SetShortcutLaunchOptions !== 'function') return false;
	const current = String(fallbackOptions || '').trim();
	const arg = '-nolauncher';
	if (current.includes(arg)) return true;
	const updated = current ? `${current} ${arg}` : arg;
	try {
		void apps.SetShortcutLaunchOptions(shortcutAppId, updated);
		return true;
	} catch {
		return false;
	}
}

export interface ShortcutIdentitySyncResult {
	shortcutAppId: number;
	officialName: string;
	nameApplied: boolean;
	nameReady: boolean;
	iconApplied: boolean;
	trackingApplied: boolean;
	noLauncherConfigured: boolean;
	artwork: ArtworkApplyResult;
	complete: boolean;
}

/** Apply the official display name before assets and mapping are committed.
 *
 * Steam may regenerate its local non-Steam AppID after SetShortcutName. The
 * executable/start directory/launch options are deliberately left untouched;
 * the renamed shortcut is re-resolved by exact executable identity before any
 * artwork or mapping is written.
 */
export async function synchronizeShortcutOfficialIdentity(options: {
	shortcutAppId: number;
	currentTitle: string;
	steamAppId: string;
	data?: SteamGameData | null;
	canonicalName?: string;
	trackingExecutable?: string;
	trackingStartDir?: string;
	skipLauncher?: boolean;
	existingLaunchOptions?: string;
	onIdentityResolved?: (shortcutAppId: number, officialName: string, relatedShortcutAppIds: number[]) => void;
	onPhase?: (phase: ShortcutLinkPhase) => void;
	refreshLibrary?: boolean;
	clearStaleArtwork?: boolean;
	assetTimeoutMs?: number;
	deferAssetSync?: boolean;
}): Promise<ShortcutIdentitySyncResult> {
	const originalShortcutId = options.shortcutAppId;
	if (!Number.isFinite(originalShortcutId) || originalShortcutId < 2147483648) {
		throw new Error('refusing_to_modify_native_steam_app');
	}
	let shortcutAppId = originalShortcutId;
	const data = options.data || await getGameData(options.steamAppId);
	const officialName = String(options.canonicalName || data?.name || options.currentTitle).trim();
	shortcutIdentityMutationDepth += 1;
	try {
		const staleIds = new Set<number>([originalShortcutId]);
		let trackingApplied = false;
		let noLauncherConfigured = false;
		let nameApplied = false;
		let nameReady = false;

		const apps = (window as any).SteamClient?.Apps;
		if (options.trackingExecutable && typeof apps?.SetShortcutExe === 'function') {
			try {
				await withTimeout(Promise.resolve(apps.SetShortcutExe(shortcutAppId, options.trackingExecutable)), 5000, 'shortcut_exe_timeout');
				trackingApplied = true;
				backendLog(`Tracking executable applied to ${shortcutAppId}: ${options.trackingExecutable}`);
			} catch (error) {
				backendLog(`Applying tracking executable failed for ${shortcutAppId}: ${error}`);
			}
		}
		if (options.trackingStartDir && typeof apps?.SetShortcutStartDir === 'function') {
			try {
				await withTimeout(Promise.resolve(apps.SetShortcutStartDir(shortcutAppId, options.trackingStartDir)), 5000, 'shortcut_startdir_timeout');
			} catch {}
		}
		const skipArg = getOptimalLauncherSkipArg(options.steamAppId);
		if (typeof apps?.SetShortcutLaunchOptions === 'function') {
			try {
				const currentLaunch = (options.existingLaunchOptions || '').trim();
				if (skipArg) {
					if (!currentLaunch.includes(skipArg)) {
						const updatedLaunch = currentLaunch ? `${currentLaunch} ${skipArg}` : skipArg;
						await withTimeout(Promise.resolve(apps.SetShortcutLaunchOptions(shortcutAppId, updatedLaunch)), 5000, 'shortcut_launch_timeout');
						noLauncherConfigured = true;
						backendLog(`Applied launcher bypass "${skipArg}" to shortcut ${shortcutAppId}`);
					}
				} else if (hasNoLauncherOption(currentLaunch)) {
					const cleanedLaunch = removeIncompatibleLauncherBypass(currentLaunch, options.steamAppId);
					await withTimeout(Promise.resolve(apps.SetShortcutLaunchOptions(shortcutAppId, cleanedLaunch)), 5000, 'shortcut_launch_timeout');
					backendLog(`Removed incompatible launcher bypass from shortcut ${shortcutAppId}: "${cleanedLaunch}"`);
				}
			} catch {}
		}

		const shortcutBeforeRename = getShortcutAppById(shortcutAppId);
		const currentName = String(shortcutBeforeRename?.display_name
			|| shortcutBeforeRename?.m_strDisplayName
			|| shortcutBeforeRename?.strDisplayName
			|| options.currentTitle
			|| '').trim();
		if (currentName) {
			rememberOriginalShortcutTitle(originalShortcutId, currentName);
		}
		const expectedExecutable = readShortcutOverviewField(
			shortcutBeforeRename, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
		);
		const nameNeedsUpdate = Boolean(officialName && officialName !== currentName);
		if (!nameNeedsUpdate) {
			nameReady = Boolean(officialName);
		} else {
			if (typeof apps?.SetShortcutName === 'function') {
				const idsBeforeRename = new Set(getAllShortcutRecords().map(record => record.id));
				try {
					await withTimeout(Promise.resolve(apps.SetShortcutName(shortcutAppId, officialName)), 6000, 'shortcut_rename_pending');
					nameApplied = true;
					shortcutAppId = await resolveShortcutIdAfterRename(
						officialName, shortcutAppId, idsBeforeRename, expectedExecutable,
					);
					staleIds.add(shortcutAppId);
					if (currentName) {
						rememberOriginalShortcutTitle(shortcutAppId, currentName);
					}
					const renamedShortcut = getShortcutAppById(shortcutAppId);
					const renamedTitle = String(renamedShortcut?.display_name
						|| renamedShortcut?.m_strDisplayName
						|| renamedShortcut?.strDisplayName
						|| '').trim();
					// Steam can acknowledge SetShortcutName one render before appStore
					// publishes the new display_name. A resolved concrete shortcut is
					// sufficient to commit its AppID mapping; the durable resource pass
					// will observe/reconcile the visible title moments later.
					nameReady = renamedTitle === officialName
						|| (nameApplied && Boolean(getShortcutAppById(shortcutAppId)));
					backendLog(`Shortcut ${originalShortcutId} rename ${nameReady ? 'confirmed' : 'pending'} as "${officialName}" (resolved ID ${shortcutAppId}).`);
				} catch (error) {
					backendLog('Official shortcut rename failed: ' + error);
					// Renaming is cosmetic enrichment, not a prerequisite for a
					// valid link. Keep the concrete shortcut identity and let the
					// durable reconciler retry the visible name later.
					if (getShortcutAppById(shortcutAppId)) {
						nameReady = true;
						backendLog(`Continuing link for ${shortcutAppId}; Steam rename will be retried asynchronously.`);
					} else if (String(error).includes('shortcut_rename_pending')) {
						throw error;
					}
				}
			} else {
				// SetShortcutName is not guaranteed in every Steam CEF context.
				nameReady = true;
				backendLog(`SetShortcutName unavailable for ${shortcutAppId}; linking by stable shortcut identity.`);
			}
		}

		if (options.clearStaleArtwork) {
			// Clear the original row before artwork work starts. If Steam regenerated
			// the shortcut during rename, the final row is cleared below as well.
			await clearShortcutArtworkForAppIdChange(originalShortcutId);
			if (shortcutAppId !== originalShortcutId) {
				await clearShortcutArtworkForAppIdChange(shortcutAppId);
			}
			invalidateLibraryAssetCaches([options.steamAppId]);
		}

		let artwork: ArtworkApplyResult = { complete: false, slots: [], missing: ['not_attempted'], communitySlots: [] };
		let iconApplied = false;
		// Asset downloads are best-effort and retried by the durable queue. Doing
		// several full foreground passes made the confirmation dialog appear stuck
		// on step 2, especially for delisted AppIDs whose CDN assets return 404s.
		const maxAssetAttempts = 1;
		if (!options.deferAssetSync) options.onPhase?.('assets');
		for (let attempt = 0; !options.deferAssetSync && attempt < maxAssetAttempts; attempt++) {
			if (attempt > 0) {
				invalidateLibraryAssetCaches([options.steamAppId]);
				await new Promise(resolve => setTimeout(resolve, 250 * attempt));
			}
			const assetTimeoutMs = Math.min(45_000, Math.max(8_000, Number(options.assetTimeoutMs) || 12_000));
			// Prioritize the visible identity artwork before spending bridge/network
			// time on the shortcut icon. spoofArtwork itself writes Hero/Logo/Portrait
			// before secondary artwork, so these three become visible first.
			const artworkResult = await withTimeout(
				spoofArtwork(shortcutAppId, options.steamAppId, officialName || options.currentTitle, Boolean(options.clearStaleArtwork),
					isLegacyGame(options.steamAppId, data)),
				assetTimeoutMs,
				'artwork_timeout',
			).catch(error => {
				backendLog(`Artwork setup timed out for ${shortcutAppId}: ${String(error)}`);
				return { complete: false, slots: [], missing: ['timeout'], communitySlots: [] } as ArtworkApplyResult;
			});
			const iconResult = await withTimeout(
				applyOfficialShortcutIcon(shortcutAppId, options.steamAppId, Boolean(options.clearStaleArtwork)),
				Math.min(assetTimeoutMs, 8000),
				'icon_timeout',
			).catch(error => {
				backendLog(`Icon setup timed out for ${shortcutAppId}: ${String(error)}`);
				return false;
			});
			artwork = artworkResult;
			iconApplied = iconResult;
			if (artwork.complete && iconApplied) break;
			backendLog(`Incomplete link resources for ${shortcutAppId}; retry ${attempt + 1}/${maxAssetAttempts} (artwork=${artwork.complete}, icon=${iconApplied})`);
		}

		// Delisted AppIDs often have authoritative identity/community data but no
		// complete set of Steam CDN library assets. The link is still valid once
		// Steam confirms the official name; missing visuals remain optional and
		// can be selected later from SteamGridDB.
		const complete = Boolean(nameReady || data?.is_delisted === true);
		if (complete) {
			// An explicit unlink wins over any link job that was already running.
			// Manual link entry points clear the dismissal before starting; therefore
			// seeing it here means the user cancelled/unlinked during this operation.
			if (isShortcutDismissed(shortcutAppId)) throw new Error('link_cancelled_by_unlink');
			// A concrete shortcut owns exactly one source-of-truth mapping. Title,
			// executable and launch-fingerprint aliases are deliberately not written:
			// two different library entries may share any of those values.
			const mappingSet: Record<string, string> = { [shortcutMappingKey(shortcutAppId)]: options.steamAppId };
			const mappingRemove = Array.from(staleIds)
				.filter(staleId => staleId !== shortcutAppId)
				.map(staleId => shortcutMappingKey(staleId));
			const mappingUpdated = await withTimeout(
				updateMappingsChecked({ set: mappingSet, remove: mappingRemove }),
				12000,
				'mapping_update_timeout',
			).catch(error => {
				backendLog(`Mapping update timed out for ${shortcutAppId}: ${String(error)}`);
				return false;
			});
			if (!mappingUpdated) {
				throw new Error('mapping_identity_update_failed');
			}
			rememberShortcutSteamAppId(shortcutAppId, options.steamAppId);
			// Automatically synchronize with any preserved playtime history for this game
			void fetchPlaytimeStatsBatch([{
				shortcutAppId,
				title: officialName,
				steamAppId: options.steamAppId,
			}]).then(statsMap => {
				const stats = statsMap.get(shortcutAppId);
				if (stats) {
					setInstantPlaytimeStats(shortcutAppId, stats);
					window.dispatchEvent(new CustomEvent('gdl:playtime-changed', {
						detail: { shortcutAppId, title: officialName, steamAppId: options.steamAppId },
					}));
					backendLog(`Synchronized playtime on link for ${shortcutAppId}: ${stats.minutesForever} mins`);
				}
			}).catch(err => {
				backendLog(`Playtime sync warning on link for ${shortcutAppId}: ${err}`);
			});
			const shortcutObj = getShortcutAppById(shortcutAppId);
			const shortcutExe = readShortcutOverviewField(shortcutObj, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath') || options.trackingExecutable || '';
			const shortcutStartDir = readShortcutOverviewField(shortcutObj, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir', 'strStartDir') || options.trackingStartDir || '';
			void neutralizeSteamAppIdFileBackend({
				request_json: JSON.stringify({
					exe_path: shortcutExe,
					start_dir: shortcutStartDir,
				}),
			}).catch(error => backendLog('Neutralize steam_appid.txt skipped: ' + error));
			try { options.onIdentityResolved?.(shortcutAppId, officialName, Array.from(staleIds)); }
			catch (error) { backendLog('Post-link library handoff failed: ' + error); }
		}

		// A partial transaction must remain visually quiet. Refreshing while Steam
		// still exposes both pre/post-rename identities is what promoted the stale
		// row into a visible BUY-page ghost until the next client restart.
		if (complete && options.refreshLibrary !== false) shortcutRuntimeHost().refreshLibraryArtwork?.(shortcutAppId);
		return {
			shortcutAppId, officialName, nameApplied, nameReady, iconApplied,
			trackingApplied, noLauncherConfigured, artwork, complete,
		};
	} finally {
		shortcutIdentityMutationDepth = Math.max(0, shortcutIdentityMutationDepth - 1);
	}
}

interface ShortcutLinkOptions {
	doc?: Document | null;
	title: string;
	shortcutAppId?: number | null;
	steamAppId: string;
	skipLauncher?: boolean;
	existingLaunchOptions?: string;
	trackingExecutable?: string;
	trackingStartDir?: string;
	shortcutExecutable?: string;
	onStatus?: ShortcutLinkStatus;
	onPhase?: (phase: ShortcutLinkPhase) => void;
	refreshLibrary?: boolean;
	repairResources?: boolean;
	assetTimeoutMs?: number;
	deferAssetSync?: boolean;
	metadataTimeoutMs?: number;
	canonicalNameHint?: string;
}

async function linkShortcutToSteamUnlocked(options: ShortcutLinkOptions): Promise<ShortcutLinkResult> {
	const steamAppId = String(options.steamAppId || '').trim();
	if (!/^\d+$/.test(steamAppId)) return { ok: false, error: 'invalid_appid' };
	shortcutIdentityMutationDepth += 1;
	try {
		const previousSteamAppId = options.shortcutAppId
			? findMappingForShortcut(options.shortcutAppId)
			: null;
		const appIdChanged = Boolean(previousSteamAppId && previousSteamAppId !== steamAppId);
		if (appIdChanged) {
			invalidateLinkedGameResourceCaches(
				[steamAppId, previousSteamAppId || ''],
				options.shortcutAppId ? [options.shortcutAppId] : [],
			);
		}
		const assetWarmup = options.deferAssetSync
			? Promise.resolve(null)
			: (appIdChanged ? refreshModernLibraryAssets(steamAppId) : getModernLibraryAssets(steamAppId));
		void assetWarmup.catch(error =>
			backendLog(`Library asset prefetch failed for ${steamAppId}: ${String(error)}`));
		void getNews(steamAppId).catch((): null => null);

		return await LinkOrchestrator.execute({
			...options,
			clearStaleArtwork: appIdChanged,
		});
	} finally {
		shortcutIdentityMutationDepth = Math.max(0, shortcutIdentityMutationDepth - 1);
	}
}


export function linkShortcutToSteam(options: ShortcutLinkOptions): Promise<ShortcutLinkResult> {
	return runShortcutMutations(shortcutMutationKeys({
		shortcutAppId: options.shortcutAppId,
		title: options.title,
		exePath: options.shortcutExecutable,
		exePaths: [options.trackingExecutable],
	}), () => linkShortcutToSteamUnlocked(options));
}
