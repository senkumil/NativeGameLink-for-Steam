export type ResourceSlot =
	| 'portrait'
	| 'hero'
	| 'logo'
	| 'wide'
	| 'icon'
	| 'logoPosition'
	| 'metadata'
	| 'news'
	| 'community'
	| 'achievements'
	| 'friends'
	| 'gameInfo';

export type ResourceStatus =
	| 'PENDING'
	| 'LOADING'
	| 'READY'
	| 'READY_DEGRADED'
	| 'FAILED'
	| 'UNAVAILABLE';

export type SteamAppLifecycle =
	| 'active'
	| 'delisted'
	| 'removed_historical'
	| 'unknown';

export type ResourceCapability = 'available' | 'probe_on_demand' | 'unavailable';

export interface SteamAppCapabilities {
	store: ResourceCapability;
	portrait: ResourceCapability;
	hero: ResourceCapability;
	logo: ResourceCapability;
	wide: ResourceCapability;
	news: ResourceCapability;
	community: ResourceCapability;
	achievements: ResourceCapability;
}

export interface ResourceManifestItem {
	slot: ResourceSlot;
	status: ResourceStatus;
	sourceUrl?: string;
	origin?: 'steam_cdn' | 'steamgriddb' | 'user_choice' | 'fallback';
	error?: string;
	appliedAt?: number;
	width?: number;
	height?: number;
}

export interface LinkResourceManifest {
	schemaVersion: 2;
	shortcutAppId: number;
	steamAppId: string;
	revision: number;
	generation: number;
	createdAt: number;
	updatedAt: number;
	portrait: ResourceManifestItem;
	hero: ResourceManifestItem;
	logo: ResourceManifestItem;
	wide: ResourceManifestItem;
	icon: ResourceManifestItem;
	logoPosition: ResourceManifestItem;
	metadata?: ResourceManifestItem;
	news?: ResourceManifestItem;
	community?: ResourceManifestItem;
	achievements?: ResourceManifestItem;
	friends?: ResourceManifestItem;
	gameInfo?: ResourceManifestItem;
}

export type LinkPhase =
	| 'idle'
	| 'resolving_identity'
	| 'validating'
	| 'mutating_identity'
	| 'committing_mapping'
	| 'applying_assets'
	| 'verifying'
	| 'completed'
	| 'failed'
	| 'aborted';

export interface LinkTransaction {
	readonly transactionId: string;
	readonly initialShortcutAppId: number;
	resolvedShortcutAppId: number;
	readonly targetSteamAppId: string;
	readonly generation: number;
	readonly epoch: number;
	phase: LinkPhase;
	readonly startedAt: number;
	completedAt?: number;
	error?: string;
	aborted: boolean;
	abortReason?: string;
	isCurrent: () => boolean;
	abort: (reason?: string) => void;
	manifest: LinkResourceManifest;
}

const MANIFEST_STORAGE_PREFIX = 'gdl-resource-manifest-v2-';
const LEGACY_MANIFEST_STORAGE_PREFIX = 'gdl-resource-manifest-v1-';

let globalResetEpoch = 1;
let factoryResetInProgress = false;

export function getFactoryResetEpoch(): number {
	return globalResetEpoch;
}

export function isFactoryResetInProgress(): boolean {
	return factoryResetInProgress;
}

export function setFactoryResetInProgress(inProgress: boolean): void {
	factoryResetInProgress = Boolean(inProgress);
}

export function isFactoryEpochCurrent(epoch: number): boolean {
	return epoch === globalResetEpoch && !factoryResetInProgress;
}

export function bumpFactoryResetEpoch(): number {
	globalResetEpoch += 1;
	abortAllActiveTransactions('factory_reset');
	activeGenerations.clear();
	return globalResetEpoch;
}

export function createInitialManifest(
	shortcutAppId = 0,
	steamAppId = '',
	generation = 0,
): LinkResourceManifest {
	const now = Date.now();
	return {
		schemaVersion: 2,
		shortcutAppId,
		steamAppId,
		revision: 1,
		generation,
		createdAt: now,
		updatedAt: now,
		portrait: { slot: 'portrait', status: 'PENDING' },
		hero: { slot: 'hero', status: 'PENDING' },
		logo: { slot: 'logo', status: 'PENDING' },
		wide: { slot: 'wide', status: 'PENDING' },
		icon: { slot: 'icon', status: 'PENDING' },
		logoPosition: { slot: 'logoPosition', status: 'PENDING' },
	};
}

export function readShortcutManifest(
	shortcutAppId: number,
	expectedSteamAppId?: string,
): LinkResourceManifest | null {
	try {
		const raw = localStorage.getItem(MANIFEST_STORAGE_PREFIX + shortcutAppId)
			|| localStorage.getItem(LEGACY_MANIFEST_STORAGE_PREFIX + shortcutAppId);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<LinkResourceManifest>;
		if (!parsed || typeof parsed !== 'object') return null;

		if (expectedSteamAppId && parsed.steamAppId && parsed.steamAppId !== expectedSteamAppId) {
			return null;
		}

		if (parsed.schemaVersion === 2 && parsed.portrait && parsed.hero && parsed.logo && parsed.wide && parsed.icon) {
			return parsed as LinkResourceManifest;
		}

		// Migrate v1 manifest
		if (parsed.portrait && parsed.hero && parsed.logo && parsed.wide && parsed.icon) {
			const migrated: LinkResourceManifest = {
				schemaVersion: 2,
				shortcutAppId,
				steamAppId: expectedSteamAppId || parsed.steamAppId || '',
				revision: 1,
				generation: 0,
				createdAt: parsed.createdAt || Date.now(),
				updatedAt: Date.now(),
				portrait: parsed.portrait,
				hero: parsed.hero,
				logo: parsed.logo,
				wide: parsed.wide,
				icon: parsed.icon,
				logoPosition: parsed.logoPosition || { slot: 'logoPosition', status: 'PENDING' },
				metadata: parsed.metadata,
				news: parsed.news,
				community: parsed.community,
				achievements: parsed.achievements,
				friends: parsed.friends,
				gameInfo: parsed.gameInfo,
			};
			return migrated;
		}
		return null;
	} catch {
		return null;
	}
}

export function saveShortcutManifest(shortcutAppId: number, manifest: LinkResourceManifest): void {
	try {
		manifest.updatedAt = Date.now();
		manifest.shortcutAppId = shortcutAppId;
		localStorage.setItem(MANIFEST_STORAGE_PREFIX + shortcutAppId, JSON.stringify(manifest));
		localStorage.removeItem(LEGACY_MANIFEST_STORAGE_PREFIX + shortcutAppId);
	} catch {}
}

export function clearShortcutManifest(shortcutAppId: number): void {
	try {
		localStorage.removeItem(MANIFEST_STORAGE_PREFIX + shortcutAppId);
		localStorage.removeItem(LEGACY_MANIFEST_STORAGE_PREFIX + shortcutAppId);
	} catch {}
}

export function clearAllShortcutManifests(): number {
	let cleared = 0;
	try {
		const keys = Object.keys(localStorage);
		for (const key of keys) {
			if (key.startsWith('gdl-resource-manifest-')) {
				localStorage.removeItem(key);
				cleared += 1;
			}
		}
	} catch {}
	return cleared;
}

const activeGenerations = new Map<number, number>();
const activeTransactions = new Map<number, LinkTransaction>();

export function getShortcutGeneration(shortcutAppId: number): number {
	return activeGenerations.get(shortcutAppId) || 0;
}

export function bumpShortcutGeneration(shortcutAppId: number): number {
	const next = (activeGenerations.get(shortcutAppId) || 0) + 1;
	activeGenerations.set(shortcutAppId, next);
	return next;
}

export function getActiveTransactionCount(): number {
	let count = 0;
	for (const tx of activeTransactions.values()) {
		if (tx.isCurrent() && !tx.completedAt && !tx.aborted) {
			count += 1;
		}
	}
	return count;
}

export function abortAllActiveTransactions(reason = 'aborted'): number {
	let count = 0;
	for (const tx of activeTransactions.values()) {
		if (!tx.completedAt && !tx.aborted) {
			tx.abort(reason);
			count += 1;
		}
	}
	activeTransactions.clear();
	return count;
}

let transactionSequence = 0;

export function createLinkTransaction(
	initialShortcutAppId: number,
	targetSteamAppId: string,
): LinkTransaction {
	// Cancel any existing transaction on this physical shortcut
	const previousTx = activeTransactions.get(initialShortcutAppId);
	if (previousTx && !previousTx.completedAt && !previousTx.aborted) {
		previousTx.abort('superseded_by_new_transaction');
	}

	const generation = bumpShortcutGeneration(initialShortcutAppId);
	const epoch = getFactoryResetEpoch();
	transactionSequence += 1;
	const transactionId = `tx_${Date.now()}_${transactionSequence}_${initialShortcutAppId}_${targetSteamAppId}`;

	let aborted = false;

	const existingManifest = readShortcutManifest(initialShortcutAppId, targetSteamAppId);
	const manifest = existingManifest || createInitialManifest(initialShortcutAppId, targetSteamAppId, generation);

	const tx: LinkTransaction = {
		transactionId,
		initialShortcutAppId,
		resolvedShortcutAppId: initialShortcutAppId,
		targetSteamAppId,
		generation,
		epoch,
		phase: 'idle',
		startedAt: Date.now(),
		aborted: false,
		isCurrent(): boolean {
			if (aborted) return false;
			if (!isFactoryEpochCurrent(epoch)) return false;
			return activeGenerations.get(initialShortcutAppId) === generation;
		},
		abort(reason = 'aborted'): void {
			aborted = true;
			tx.aborted = true;
			tx.abortReason = reason;
			tx.phase = 'aborted';
			tx.completedAt = Date.now();
		},
		manifest,
	};

	activeTransactions.set(initialShortcutAppId, tx);
	return tx;
}

export function getActiveTransaction(shortcutAppId: number): LinkTransaction | null {
	const tx = activeTransactions.get(shortcutAppId);
	if (tx && tx.isCurrent() && !tx.completedAt) return tx;
	return null;
}

export function clearActiveTransaction(shortcutAppId: number, reason = 'explicit_clear'): void {
	const tx = activeTransactions.get(shortcutAppId);
	if (tx) {
		tx.abort(reason);
		activeTransactions.delete(shortcutAppId);
	}
}
