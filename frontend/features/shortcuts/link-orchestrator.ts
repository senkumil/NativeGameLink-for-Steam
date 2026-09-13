import type { ShortcutLinkResult, SteamGameData } from '../../domain/types';
import { backendLog, neutralizeSteamAppIdFileBackend } from '../../api/backend';
import { getCanonicalGameData, getGameData } from '../../core/game-data';
import { shortcutMappingKey, updateMappingsChecked } from '../../core/mappings';
import { gdlText } from '../../steam/localization';
import { getShortcutAppById, readShortcutOverviewField, shortcutExecutableIdentity } from '../../steam/shortcuts';
import {
	applyOfficialShortcutIcon, getModernLibraryAssets, invalidateLibraryAssetCaches,
	refreshModernLibraryAssets, reserveShortcutArtworkTarget, resolveShortcutIdAfterRename, spoofArtwork, type ArtworkApplyResult,
} from '../library/artwork';
import {
	clearShortcutArtworkForAppIdChange,
	clearUnreplacedShortcutArtwork,
	prepareShortcutArtworkForAppIdChange,
} from '../library/artwork-relink-cleanup';
import { isLegacyGame } from '../library/legacy-games';
import { getNews } from '../library/news';
import { invalidateLinkedGameResourceCaches } from '../library/resource-cache';
import { clearLinkedGameNote } from './linked-notes';
import { isShortcutDismissed, undismissShortcut } from './dismissed';
import { findMappingForShortcut, getAllShortcutRecords, refreshShortcutRecordsFromBackend } from './registry';
import { rememberOriginalShortcutTitle, rememberShortcutSteamAppId } from './link-history';
import { getOptimalLauncherSkipArg, hasNoLauncherOption, removeIncompatibleLauncherBypass, shouldAutoApplyNoLauncher } from './launcher-bypass';
import {
	type LinkTransaction, type LinkResourceManifest, type ResourceStatus,
	saveShortcutManifest, clearShortcutManifest, createLinkTransaction,
} from './transaction';
import { getShortcutEdition, saveShortcutEdition } from './editions';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
		promise.then(
			value => { clearTimeout(timer); resolve(value); },
			error => { clearTimeout(timer); reject(error); },
		);
	});
}

export interface OrchestratorLinkOptions {
	doc?: Document | null;
	title: string;
	shortcutAppId?: number | null;
	steamAppId: string;
	skipLauncher?: boolean;
	existingLaunchOptions?: string;
	trackingExecutable?: string;
	trackingStartDir?: string;
	shortcutExecutable?: string;
	onStatus?: (message: string, color?: string) => void;
	onPhase?: (phase: 'identity' | 'assets') => void;
	refreshLibrary?: boolean;
	repairResources?: boolean;
	assetTimeoutMs?: number;
	deferAssetSync?: boolean;
	metadataTimeoutMs?: number;
	canonicalNameHint?: string;
	clearStaleArtwork?: boolean;
}

export class LinkOrchestrator {
	/**
	 * Step 1: Resolve the concrete Steam non-Steam Shortcut ID.
	 * Handles newly added shortcuts, post-rename regeneration, and executable identity matching.
	 */
	static async resolveIdentity(
		tx: LinkTransaction,
		options: OrchestratorLinkOptions,
		canonicalName: string,
	): Promise<number> {
		tx.phase = 'resolving_identity';
		const title = options.title;
		const initialId = options.shortcutAppId || 0;
		const executableHint = options.shortcutExecutable || options.trackingExecutable || '';

		const waits = [0, 100, 250, 500, 900, 1500, 2500];
		await refreshShortcutRecordsFromBackend().catch((): void => {});
		const expectedExecutable = shortcutExecutableIdentity(executableHint);

		for (const wait of waits) {
			if (!tx.isCurrent()) throw new Error('transaction_aborted');
			if (wait) await new Promise(resolve => setTimeout(resolve, wait));
			if (wait >= 900) await refreshShortcutRecordsFromBackend().catch((): void => {});
			if (initialId) {
				const exact = Number(initialId);
				if (Number.isFinite(exact) && exact >= 2147483648 && getShortcutAppById(exact)) {
					tx.resolvedShortcutAppId = exact;
					return exact;
				}
			}
			const records = getAllShortcutRecords().filter(record => record.id >= 2147483648);
			if (expectedExecutable) {
				const matches = records.filter(record => shortcutExecutableIdentity(readShortcutOverviewField(
					record.app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
				)) === expectedExecutable);
				if (matches.length > 1) throw new Error('shortcut_identity_ambiguous');
				if (matches.length === 1) {
					tx.resolvedShortcutAppId = matches[0].id;
					return matches[0].id;
				}
				continue; // Never substitute a different executable just because the title matches.
			}
			const names = new Set([title, canonicalName].map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
			const matches = records.filter(record => names.has(String(record.title || '').trim().toLowerCase()));
			if (matches.length > 1) throw new Error('shortcut_identity_ambiguous');
			if (matches.length === 1) {
				tx.resolvedShortcutAppId = matches[0].id;
				return matches[0].id;
			}
		}

		throw new Error('shortcut_not_ready');
	}

	/**
	 * Step 2: Validate the target candidate against Steam metadata.
	 * Legacy/delisted AppIDs fall back gracefully without blocking the pipeline.
	 */
	static async validateCandidate(
		tx: LinkTransaction,
		options: OrchestratorLinkOptions,
	): Promise<{ data: SteamGameData; canonicalName: string; localizedData: SteamGameData | null }> {
		tx.phase = 'validating';
		const steamAppId = tx.targetSteamAppId;
		const title = options.title;

		const metadataTimeoutMs = Math.min(6000, Math.max(1200, Number(options.metadataTimeoutMs) || 6000));
		const [localizedData, canonicalData] = await Promise.all([
			withTimeout(getGameData(steamAppId), metadataTimeoutMs, 'game_data_timeout').catch((): null => null),
			withTimeout(getCanonicalGameData(steamAppId), metadataTimeoutMs, 'canonical_data_timeout').catch((): null => null),
		]);

		let data = localizedData;
		if (!data) {
			data = {
				steam_appid: Number(steamAppId),
				name: canonicalData?.name || options.canonicalNameHint || title,
				header_image: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`,
				short_description: '',
				is_delisted: canonicalData?.is_delisted === true,
			};
		}
		const edition = options.shortcutAppId ? getShortcutEdition(options.shortcutAppId) : null;
		const canonicalName = String(edition?.name || options.canonicalNameHint || canonicalData?.name || data?.name || title).trim();
		return { data, canonicalName, localizedData };
	}

	/**
	 * Step 3: Mutate shortcut identity in Steam Client.
	 * Applies tracking executable/start dir, launcher bypass, and renames with regeneration guard.
	 */
	static async mutateShortcutIdentity(
		tx: LinkTransaction,
		options: OrchestratorLinkOptions,
		data: SteamGameData,
		canonicalName: string,
	): Promise<{
		resolvedShortcutId: number;
		officialName: string;
		nameReady: boolean;
		trackingApplied: boolean;
		noLauncherConfigured: boolean;
		staleIds: Set<number>;
	}> {
		tx.phase = 'mutating_identity';
		let shortcutAppId = tx.resolvedShortcutAppId;
		const originalShortcutId = tx.initialShortcutAppId;
		const staleIds = new Set<number>([originalShortcutId, shortcutAppId]);
		const officialName = String(canonicalName || data.name || options.title).trim();

		const apps = (window as any).SteamClient?.Apps;
		let trackingApplied = false;
		let noLauncherConfigured = false;
		let nameApplied = false;
		let nameReady = false;

		if (options.trackingExecutable && typeof apps?.SetShortcutExe === 'function') {
			try {
				await withTimeout(Promise.resolve(apps.SetShortcutExe(shortcutAppId, options.trackingExecutable)), 5000, 'shortcut_exe_timeout');
				trackingApplied = true;
			} catch (error) {
				backendLog(`Tracking executable application failed for ${shortcutAppId}: ${error}`);
			}
		}

		if (options.trackingStartDir && typeof apps?.SetShortcutStartDir === 'function') {
			try {
				await withTimeout(Promise.resolve(apps.SetShortcutStartDir(shortcutAppId, options.trackingStartDir)), 5000, 'shortcut_startdir_timeout');
			} catch {}
		}

		const skipArg = getOptimalLauncherSkipArg(tx.targetSteamAppId);
		if (typeof apps?.SetShortcutLaunchOptions === 'function') {
			try {
				const currentLaunch = (options.existingLaunchOptions || '').trim();
				if (skipArg) {
					if (!currentLaunch.includes(skipArg)) {
						const updatedLaunch = currentLaunch ? `${currentLaunch} ${skipArg}` : skipArg;
						await withTimeout(Promise.resolve(apps.SetShortcutLaunchOptions(shortcutAppId, updatedLaunch)), 5000, 'shortcut_launch_timeout');
						noLauncherConfigured = true;
					}
				} else if (hasNoLauncherOption(currentLaunch)) {
					const cleanedLaunch = removeIncompatibleLauncherBypass(currentLaunch, tx.targetSteamAppId);
					await withTimeout(Promise.resolve(apps.SetShortcutLaunchOptions(shortcutAppId, cleanedLaunch)), 5000, 'shortcut_launch_timeout');
				}
			} catch {}
		}

		const shortcutBeforeRename = getShortcutAppById(shortcutAppId);
		const currentName = String(shortcutBeforeRename?.display_name
			|| shortcutBeforeRename?.m_strDisplayName
			|| shortcutBeforeRename?.strDisplayName
			|| options.title
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
		} else if (typeof apps?.SetShortcutName === 'function') {
			const idsBeforeRename = new Set(getAllShortcutRecords().map(record => record.id));
			try {
				await withTimeout(Promise.resolve(apps.SetShortcutName(shortcutAppId, officialName)), 6000, 'shortcut_rename_pending');
				nameApplied = true;
				shortcutAppId = await resolveShortcutIdAfterRename(
					officialName, shortcutAppId, idsBeforeRename, expectedExecutable,
				);
				tx.resolvedShortcutAppId = shortcutAppId;
				staleIds.add(shortcutAppId);
				if (currentName) {
					rememberOriginalShortcutTitle(shortcutAppId, currentName);
				}
				if (originalShortcutId !== shortcutAppId) {
					const editionMeta = getShortcutEdition(originalShortcutId);
					if (editionMeta) {
						saveShortcutEdition(shortcutAppId, editionMeta);
					}
				}
				const renamedShortcut = getShortcutAppById(shortcutAppId);
				const renamedTitle = String(renamedShortcut?.display_name
					|| renamedShortcut?.m_strDisplayName
					|| renamedShortcut?.strDisplayName
					|| '').trim();
				nameReady = renamedTitle === officialName
					|| (nameApplied && Boolean(getShortcutAppById(shortcutAppId)));
			} catch (error) {
				backendLog('Official shortcut rename error: ' + error);
				if (getShortcutAppById(shortcutAppId)) {
					nameReady = true;
				} else if (String(error).includes('shortcut_rename_pending')) {
					throw error;
				}
			}
		} else {
			nameReady = true;
		}

		return {
			resolvedShortcutId: shortcutAppId,
			officialName,
			nameReady,
			trackingApplied,
			noLauncherConfigured,
			staleIds,
		};
	}

	/**
	 * Step 4: Commit mapping atomically to mappings.json.
	 * Keyed strictly by shortcutAppId to prevent merging duplicate games.
	 */
	static async commitMapping(
		tx: LinkTransaction,
		shortcutAppId: number,
		staleIds: Set<number>,
		options: OrchestratorLinkOptions,
	): Promise<void> {
		tx.phase = 'committing_mapping';
		if (isShortcutDismissed(shortcutAppId)) throw new Error('link_cancelled_by_unlink');

		const mappingSet: Record<string, string> = { [shortcutMappingKey(shortcutAppId)]: tx.targetSteamAppId };
		const mappingRemove = Array.from(staleIds)
			.filter(staleId => staleId !== shortcutAppId)
			.map(staleId => shortcutMappingKey(staleId));

		const mappingUpdated = await withTimeout(
			updateMappingsChecked({ set: mappingSet, remove: mappingRemove }),
			12000,
			'mapping_update_timeout',
		).catch((): boolean => false);

		if (!mappingUpdated) {
			throw new Error('mapping_identity_update_failed');
		}

		rememberShortcutSteamAppId(shortcutAppId, tx.targetSteamAppId);

		const shortcutObj = getShortcutAppById(shortcutAppId);
		const shortcutExe = readShortcutOverviewField(shortcutObj, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath') || options.trackingExecutable || '';
		const shortcutStartDir = readShortcutOverviewField(shortcutObj, 'strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir', 'strStartDir') || options.trackingStartDir || '';

		void neutralizeSteamAppIdFileBackend({
			request_json: JSON.stringify({
				exe_path: shortcutExe,
				start_dir: shortcutStartDir,
			}),
		}).catch((): void => {});
	}

	/**
	 * Step 5: Apply artwork, icon, and logo position, updating the resource manifest.
	 */
	static async applyArtworkAndIcons(
		tx: LinkTransaction,
		shortcutAppId: number,
		officialName: string,
		data: SteamGameData,
		options: OrchestratorLinkOptions,
	): Promise<{ artwork: ArtworkApplyResult; iconApplied: boolean }> {
		tx.phase = 'applying_assets';
		if (options.deferAssetSync) {
			return {
				artwork: { complete: false, slots: [], missing: ['deferred'], communitySlots: [] },
				iconApplied: false,
			};
		}

		options.onPhase?.('assets');
		const assetTimeoutMs = Math.min(30_000, Math.max(4_000, Number(options.assetTimeoutMs) || 7_000));
		const artworkRequest = withTimeout(
			spoofArtwork(shortcutAppId, tx.targetSteamAppId, officialName || options.title, Boolean(options.clearStaleArtwork), isLegacyGame(tx.targetSteamAppId, data)),
			assetTimeoutMs,
			'artwork_timeout',
		).catch((): ArtworkApplyResult => ({ complete: false, slots: [], missing: ['timeout'], communitySlots: [] }));
		const iconRequest = withTimeout(
			applyOfficialShortcutIcon(shortcutAppId, tx.targetSteamAppId, Boolean(options.clearStaleArtwork)),
			Math.min(assetTimeoutMs, 6_000),
			'icon_timeout',
		).catch((): boolean => false);
		// Artwork and icon touch different files/APIs. Running them together keeps
		// the foreground link bounded by the slower operation instead of the sum of
		// both timeouts; unfinished work is retained by the durable repair queue.
		const [artworkResult, iconResult] = await Promise.all([artworkRequest, iconRequest]);

		// Update resource manifest
		const manifest: LinkResourceManifest = tx.manifest;
		manifest.steamAppId = tx.targetSteamAppId;
		manifest.shortcutAppId = shortcutAppId;
		const slotsApplied = new Set(artworkResult.slots || []);
		const missing = new Set(artworkResult.missing || []);
		const isTimeout = missing.has('timeout');

		const resolveSlotStatus = (slot: number): ResourceStatus => {
			if (slotsApplied.has(slot)) return 'READY';
			if (isTimeout) return 'FAILED';
			return 'UNAVAILABLE';
		};

		manifest.portrait.status = resolveSlotStatus(0);
		manifest.hero.status = resolveSlotStatus(1);
		manifest.logo.status = resolveSlotStatus(2);
		manifest.wide.status = resolveSlotStatus(3);
		manifest.icon.status = iconResult ? 'READY' : (isTimeout ? 'FAILED' : 'UNAVAILABLE');
		manifest.logoPosition.status = slotsApplied.has(2) ? 'READY' : 'UNAVAILABLE';
		saveShortcutManifest(shortcutAppId, manifest);

		return { artwork: artworkResult, iconApplied: iconResult };
	}

	/**
	 * Main execution pipeline: runs the 7 deterministic steps within a LinkTransaction.
	 */
	static async execute(
		options: OrchestratorLinkOptions,
	): Promise<ShortcutLinkResult> {
		const steamAppId = String(options.steamAppId || '').trim();
		const title = String(options.title || '').trim();
		if (!/^\d+$/.test(steamAppId) || Number(steamAppId) <= 0 || Number(steamAppId) >= 2147483648) return { ok: false, error: 'invalid_appid' };
		if (options.shortcutAppId != null && Number(options.shortcutAppId) > 0 && Number(options.shortcutAppId) < 2147483648) return { ok: false, error: 'refusing_to_modify_native_steam_app' };

		const initialId = Number(options.shortcutAppId || 0);
		const tx = createLinkTransaction(initialId >= 2147483648 ? initialId : 2147483648, steamAppId);
		const onStatus = options.onStatus || ((): void => {});
		let releaseArtworkReservation = (): void => {};

		try {
			onStatus(gdlText('verifying_steam', 'Verifying on Steam...'), '#8f98a0');

			const previousSteamAppId = initialId ? findMappingForShortcut(initialId) : null;
			const appIdChanged = Boolean(previousSteamAppId && previousSteamAppId !== steamAppId);
			const replacingArtwork = Boolean(options.clearStaleArtwork || appIdChanged);
			if (appIdChanged) {
				invalidateLinkedGameResourceCaches(
					[steamAppId, previousSteamAppId || ''],
					initialId ? [initialId] : [],
				);
			}

			const assetWarmup = options.deferAssetSync
				? Promise.resolve(null)
				: (appIdChanged ? refreshModernLibraryAssets(steamAppId) : getModernLibraryAssets(steamAppId));
			void assetWarmup.catch((): void => {});

			// Step 2: Validate candidate
			const { data, canonicalName } = await this.validateCandidate(tx, options);
			if (!tx.isCurrent()) throw new Error('transaction_aborted');
			void getNews(steamAppId, undefined, data).catch((): null => null);

			// Step 1: Resolve identity
			await this.resolveIdentity(tx, options, canonicalName);
			if (!tx.isCurrent()) throw new Error('transaction_aborted');

			onStatus(gdlText('linked_updating', '✓ Match verified for "{name}". Applying name, icon and artwork...', { name: canonicalName || title }), '#5ba32b');
			options.onPhase?.('identity');

			// Step 3: Mutate identity
			const identityResult = await this.mutateShortcutIdentity(tx, options, data, canonicalName);
			if (!tx.isCurrent()) throw new Error('transaction_aborted');

			const finalShortcutId = identityResult.resolvedShortcutId;
			const complete = Boolean(identityResult.nameReady || data.is_delisted === true);

			if (!complete) {
				onStatus(gdlText('link_incomplete_retrying', 'The link is not complete yet. NativeGameLink will retry until name, icon and artwork are ready.'), '#e5ad37');
				tx.phase = 'failed';
				return {
					ok: false,
					data,
					shortcutAppId: finalShortcutId,
					aliases: [shortcutMappingKey(finalShortcutId)],
					error: 'setup_incomplete',
					setup: {
						nameReady: identityResult.nameReady,
						iconApplied: false,
						artworkComplete: false,
						missingArtwork: ['not_attempted'],
						communityArtwork: [],
					},
				};
			}
			releaseArtworkReservation = reserveShortcutArtworkTarget(finalShortcutId, steamAppId);

			if (replacingArtwork) {
				clearShortcutManifest(initialId);
				// A rename can regenerate Steam's shortcut ID. Fully clear abandoned
				// rows, but keep the final row's current images mounted until their
				// replacements have been staged.
				for (const staleId of identityResult.staleIds) {
					clearShortcutManifest(staleId);
					if (staleId !== finalShortcutId) await clearShortcutArtworkForAppIdChange(staleId);
				}
				await prepareShortcutArtworkForAppIdChange(finalShortcutId);
				invalidateLibraryAssetCaches([steamAppId]);
			}

			// Step 4: Stage artwork and icons while the old/unlinked library page is
			// still authoritative. Publishing the mapping only after this bounded
			// batch prevents Steam from rendering the linked page between individual
			// Hero/Logo writes.
			const assetResult = await this.applyArtworkAndIcons(tx, finalShortcutId, identityResult.officialName, data, {
				...options,
				clearStaleArtwork: replacingArtwork,
			});
			if (!tx.isCurrent()) throw new Error('transaction_aborted');
			if (replacingArtwork && !options.deferAssetSync) {
				await clearUnreplacedShortcutArtwork(finalShortcutId, assetResult.artwork.slots, assetResult.iconApplied);
			}

			// Step 5: Publish the stable shortcut -> Steam mapping atomically. The
			// mapping subscriber owns the one visible Library refresh for a new or
			// changed AppID.
			await this.commitMapping(tx, finalShortcutId, identityResult.staleIds, options);
			if (!tx.isCurrent()) throw new Error('transaction_aborted');
			releaseArtworkReservation();
			releaseArtworkReservation = (): void => {};

			// Step 6: Verify & undismiss
			undismissShortcut(finalShortcutId);
			void clearLinkedGameNote(identityResult.officialName || title).catch((): void => {});

			// Step 7: Publish state
			let finalMessage = !assetResult.artwork.complete || !assetResult.iconApplied
				? gdlText('linked_resources_pending', 'Linked to “{name}”. Some images or the icon are still pending.', { name: identityResult.officialName })
				: gdlText('linked_official', '✓ Linked to "{name}". Official name, icon and artwork updated.', { name: identityResult.officialName });
			if (identityResult.trackingApplied) finalMessage += gdlText('tracking_executable_updated', ' Steam will now launch the long-running game executable so playtime can be tracked.');
			if (shouldAutoApplyNoLauncher(steamAppId) && identityResult.noLauncherConfigured) finalMessage += ' -nolauncher.';
			onStatus(finalMessage, '#5ba32b');

			// There is intentionally no second forced refresh here. For new/relinked
			// games commitMapping emits the mapping change; for same-AppID repairs the
			// single batch_complete artwork event refreshes the active page. A late
			// metadata request is already awaited by the Library hydration itself.

			tx.phase = 'completed';
			tx.completedAt = Date.now();

			return {
				ok: true,
				data,
				shortcutAppId: finalShortcutId,
				aliases: [shortcutMappingKey(finalShortcutId)],
				setup: {
					nameReady: identityResult.nameReady,
					iconApplied: assetResult.iconApplied,
					artworkComplete: assetResult.artwork.complete,
					missingArtwork: assetResult.artwork.missing,
					communityArtwork: assetResult.artwork.communitySlots,
				},
			};
		} catch (e) {
			tx.phase = 'failed';
			tx.error = String(e);
			backendLog('LinkOrchestrator error: ' + e);
			const error = e instanceof Error ? e.message : String(e).replace(/^Error:\s*/, '');
			onStatus(error === 'shortcut_rename_pending'
				? gdlText('shortcut_rename_pending', 'Steam is updating the shortcut identity. NativeGameLink will finish the link in the background without using the previous entry.')
				: gdlText('save_failed', 'Could not complete the link. It remains unlinked and can be retried.'),
				error === 'shortcut_rename_pending' ? '#e5ad37' : '#ff6b6b');
			return { ok: false, error };
		} finally {
			releaseArtworkReservation();
		}
	}
}
