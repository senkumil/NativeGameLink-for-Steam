import { backendLog } from '../../api/backend';
import { findMappingForShortcut, getAllShortcutRecords } from './registry';
import {
	createInitialManifest,
	getFactoryResetEpoch,
	isFactoryEpochCurrent,
	isFactoryResetInProgress,
	readShortcutManifest,
	saveShortcutManifest,
	type ResourceStatus,
} from './transaction';
import { spoofArtwork, applyOfficialShortcutIcon, isLogoPositionVerified, artworkAlreadySaved } from '../library/artwork';
import { shortcutIconMarkerMatches } from '../library/shortcut-icon';
import { shortcutRuntimeHost } from './host';
import { isLegacyGame } from '../library/legacy-games';
import { getGameData } from '../../core/game-data';
import { getPreferences } from '../../core/preferences';

let isReconciling = false;
let reconciliationTimer: ReturnType<typeof setTimeout> | null = null;
const reconcileCooldowns = new Map<number, number>();
const RECONCILE_COOLDOWN_MS = 5 * 60 * 1000;

export interface ReconciliationStatus {
	totalChecked: number;
	healthy: number;
	repaired: number;
	degraded: number;
	unavailable: number;
	failed: number;
	superseded: number;
}

function slotNeedsRepair(status: ResourceStatus): boolean {
	return status === 'PENDING' || status === 'LOADING' || status === 'FAILED' || status === 'READY_DEGRADED';
}

/**
 * Reconciles a single mapped shortcut. Checks if any slots are missing or degraded,
 * and repairs only those specific slots without disturbing existing valid artwork or identity.
 * Treats UNAVAILABLE as terminal to prevent infinite network retry loops.
 */
export async function reconcileShortcut(
	shortcutAppId: number,
	steamAppId: string,
): Promise<'healthy' | 'repaired' | 'degraded' | 'unavailable' | 'failed' | 'superseded'> {
	const epoch = getFactoryResetEpoch();
	if (isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) {
		return 'superseded';
	}

	if (!Number.isFinite(shortcutAppId) || shortcutAppId < 2147483648 || !/^\d+$/.test(steamAppId)) {
		return 'failed';
	}

	// Guard: Ensure shortcut is actually still mapped to this target
	if (findMappingForShortcut(shortcutAppId) !== steamAppId) {
		return 'superseded';
	}

	const isArtSaved = artworkAlreadySaved(shortcutAppId, steamAppId);
	const isIconSaved = shortcutIconMarkerMatches(shortcutAppId, steamAppId);
	const logoUnverified = !isLogoPositionVerified(shortcutAppId, steamAppId);
	if (isArtSaved && isIconSaved && !logoUnverified) {
		return 'healthy';
	}

	const manifest = readShortcutManifest(shortcutAppId, steamAppId)
		|| createInitialManifest(shortcutAppId, steamAppId);
	const hasMissingSlots =
		manifest.portrait.status !== 'READY' ||
		manifest.hero.status !== 'READY' ||
		manifest.logo.status !== 'READY' ||
		manifest.wide.status !== 'READY' ||
		manifest.icon.status !== 'READY';
	const autoCommunity = getPreferences().autoCommunityArtwork;
	const onCooldown = Date.now() - (reconcileCooldowns.get(shortcutAppId) || 0) < RECONCILE_COOLDOWN_MS;
	const communityEligible = hasMissingSlots && autoCommunity && !onCooldown;

	const needsRepair =
		logoUnverified ||
		slotNeedsRepair(manifest.portrait.status) ||
		slotNeedsRepair(manifest.hero.status) ||
		slotNeedsRepair(manifest.logo.status) ||
		slotNeedsRepair(manifest.wide.status) ||
		slotNeedsRepair(manifest.icon.status) ||
		communityEligible;

	if (!needsRepair) {
		const hasUnavailable =
			manifest.portrait.status === 'UNAVAILABLE' ||
			manifest.hero.status === 'UNAVAILABLE' ||
			manifest.logo.status === 'UNAVAILABLE' ||
			manifest.wide.status === 'UNAVAILABLE' ||
			manifest.icon.status === 'UNAVAILABLE';
		return hasUnavailable ? 'unavailable' : 'healthy';
	}

	backendLog(`[NGL][Reconciler] Healing shortcut ${shortcutAppId} -> ${steamAppId} (logoUnverified=${logoUnverified})`);

	try {
		const data = await getGameData(steamAppId).catch((): null => null);
		const legacy = isLegacyGame(steamAppId, data || undefined);

		if (isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch) || findMappingForShortcut(shortcutAppId) !== steamAppId) {
			return 'superseded';
		}

		const artResult = await spoofArtwork(shortcutAppId, steamAppId, data?.name || '', logoUnverified, legacy).catch((): null => null);
		const iconResult = await applyOfficialShortcutIcon(shortcutAppId, steamAppId, false).catch((): boolean => false);

		// Post-async guard: verify mapping still matches
		if (isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch) || findMappingForShortcut(shortcutAppId) !== steamAppId) {
			backendLog(`[NGL][Reconciler] Mapping changed or reset during healing of ${shortcutAppId}; discarding write`);
			return 'superseded';
		}

		if (artResult) {
			const slots = new Set(artResult.slots || []);
			manifest.portrait.status = slots.has(0) ? 'READY' : (manifest.portrait.status === 'PENDING' ? 'UNAVAILABLE' : manifest.portrait.status);
			manifest.hero.status = slots.has(1) ? 'READY' : (manifest.hero.status === 'PENDING' ? 'UNAVAILABLE' : manifest.hero.status);
			manifest.logo.status = slots.has(2) ? 'READY' : (manifest.logo.status === 'PENDING' ? 'UNAVAILABLE' : manifest.logo.status);
			manifest.wide.status = slots.has(3) ? 'READY' : (manifest.wide.status === 'PENDING' ? 'UNAVAILABLE' : manifest.wide.status);
		}
		if (iconResult) {
			manifest.icon.status = 'READY';
		} else if (manifest.icon.status === 'PENDING' || manifest.icon.status === 'LOADING') {
			manifest.icon.status = 'UNAVAILABLE';
		}

		saveShortcutManifest(shortcutAppId, manifest);

		const allReady =
			manifest.portrait.status === 'READY' &&
			manifest.hero.status === 'READY' &&
			manifest.logo.status === 'READY' &&
			manifest.wide.status === 'READY' &&
			manifest.icon.status === 'READY';

		if (allReady) {
			reconcileCooldowns.delete(shortcutAppId);
			return 'repaired';
		}
		reconcileCooldowns.set(shortcutAppId, Date.now());
		return 'degraded';
	} catch (error) {
		backendLog(`[NGL][Reconciler] Failed healing ${shortcutAppId}: ${error}`);
		return 'failed';
	}
}

/**
 * Performs a self-healing pass over all currently mapped shortcuts in the background.
 * Runs non-blockingly and throttles requests to avoid overloading Steam or network APIs.
 */
export async function runDurableReconciliation(): Promise<ReconciliationStatus> {
	const epoch = getFactoryResetEpoch();
	if (isReconciling || isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) {
		return { totalChecked: 0, healthy: 0, repaired: 0, degraded: 0, unavailable: 0, failed: 0, superseded: 0 };
	}

	isReconciling = true;
	const status: ReconciliationStatus = {
		totalChecked: 0,
		healthy: 0,
		repaired: 0,
		degraded: 0,
		unavailable: 0,
		failed: 0,
		superseded: 0,
	};

	try {
		const records = getAllShortcutRecords();
		const mappedShortcuts: { id: number; steamAppId: string }[] = [];

		for (const record of records) {
			const steamAppId = findMappingForShortcut(record.id);
			if (steamAppId) {
				mappedShortcuts.push({ id: record.id, steamAppId });
			}
		}

		status.totalChecked = mappedShortcuts.length;

		for (const item of mappedShortcuts) {
			if (isFactoryResetInProgress() || !isFactoryEpochCurrent(epoch)) {
				backendLog('[NGL][Reconciler] Factory reset detected during run; aborting pass');
				break;
			}

			const outcome = await reconcileShortcut(item.id, item.steamAppId);
			if (outcome in status) {
				status[outcome] += 1;
			}

			// Throttle between shortcuts to keep CEF thread responsive
			await new Promise(resolve => setTimeout(resolve, 300));
		}

		if (status.repaired > 0 || status.degraded > 0) {
			shortcutRuntimeHost().refreshLibraryArtwork?.(0);
		}
		backendLog(`[NGL][Reconciler] Pass complete. Checked: ${status.totalChecked}, Healthy: ${status.healthy}, Repaired: ${status.repaired}, Degraded: ${status.degraded}, Unavailable: ${status.unavailable}, Failed: ${status.failed}`);
	} catch (error) {
		backendLog('[NGL][Reconciler] Background reconciliation encountered error: ' + error);
	} finally {
		isReconciling = false;
	}

	return status;
}

/**
 * Schedules a self-healing run with a delay (e.g. 5 seconds after startup/navigation).
 */
export function scheduleReconciliation(delayMs = 5000): void {
	if (reconciliationTimer) {
		clearTimeout(reconciliationTimer);
	}
	reconciliationTimer = setTimeout(() => {
		reconciliationTimer = null;
		void runDurableReconciliation();
	}, delayMs);
}
