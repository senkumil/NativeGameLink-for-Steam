import { backendLog, saveShortcutArtworkBackend } from '../../api/backend';
import { findShortcutAppIdsByName, getShortcutAppById, readShortcutOverviewField, shortcutExecutableIdentity } from '../../steam/shortcuts';
import { clearSavedCommunityArtworkSelection, getSavedCommunityArtworkSelection, isTrustedSteamGridDbImageUrl, type CommunityArtworkSelection } from './artwork-selection-storage';
import { imageUrlToBase64, imageUrlKnownMissing, normalizeCommunityArtworkDataUrl } from './artwork-image';
import { automaticArtworkMeetsSlotQuality } from './artwork-quality';
import { getCommunityArtwork, retiredCommunityArtworkPreferred, type CommunityArtworkAssets } from './artwork-community';
import { isLegacyGame } from './legacy-games';
import {
	clearLibraryAssetDataCaches, getModernLibraryAssets,
	invalidateLibraryAssetDataCaches, type SteamLibraryAssets,
} from './library-assets';
import { waitForSteamBridge } from './steam-bridge';
import { applyLogoPosition, invalidateLogoPosition, clearLogoPositionSaved, isLogoPositionStorageKey, type SteamLogoPinPosition } from './artwork-logo-position';
import {
	buildHeroCandidateUrls,
	classifyHeroVariant,
	determineHeroSelectionReason,
	isHero2xUrl,
	logHeroResolutionDiagnostics,
} from './artwork-hero';
import {
	applyOfficialShortcutIconOnce,
	clearShortcutIconMarker,
	SHORTCUT_ICON_STORAGE_PREFIX,
} from './shortcut-icon';
export { getCachedLibraryAssets, getModernLibraryAssets, getResolvedLibraryAssets, refreshModernLibraryAssets } from './library-assets';
export type { SteamLibraryAssets } from './library-assets';
export { imageUrlToBase64, normalizeCommunityArtworkDataUrl, normalizeCommunityLogoDataUrl } from './artwork-image';
export async function resolveShortcutIdAfterRename(
	officialName: string,
	previousId: number,
	idsBeforeMutation: Set<number> = new Set<number>(),
	expectedExecutable = '',
): Promise<number> {
	const waits = [0, 50, 100, 180, 300, 500, 800];
	const expectedIdentity = shortcutExecutableIdentity(expectedExecutable);
	const requiresFreshIdentity = idsBeforeMutation.size > 0;
	let stableCandidate = 0;
	let stableSamples = 0;
	for (const wait of waits) {
		if (wait) await new Promise(resolve => setTimeout(resolve, wait));
		const matches = findShortcutAppIdsByName(officialName);
		if (matches.includes(previousId)) {
			if (!expectedIdentity || shortcutExecutableIdentity(readShortcutOverviewField(
				getShortcutAppById(previousId), 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
			)) === expectedIdentity) return previousId;
		}
		const freshMatches = matches.filter(id => !idsBeforeMutation.has(id));
		let candidate = 0;
		if (expectedIdentity) {
			candidate = freshMatches.find(id => shortcutExecutableIdentity(readShortcutOverviewField(
				getShortcutAppById(id), 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
			)) === expectedIdentity) || 0;
		}
		if (!candidate && !expectedIdentity && freshMatches.length === 1) candidate = freshMatches[0];
		if (!candidate && matches.includes(previousId)) {
			if (!expectedIdentity || shortcutExecutableIdentity(readShortcutOverviewField(
				getShortcutAppById(previousId), 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
			)) === expectedIdentity) {
				candidate = previousId;
			}
		}
		if (candidate) {
			if (candidate === stableCandidate) stableSamples += 1;
			else { stableCandidate = candidate; stableSamples = 1; }
			if (stableSamples >= 2) return candidate;
		} else { stableCandidate = 0; stableSamples = 0; }
		if (!requiresFreshIdentity && matches.includes(previousId)) return previousId;
	}
	if (getShortcutAppById(previousId)) return previousId;
	throw new Error('shortcut_rename_pending');
}
const artworkGenerations = new Map<number, number>();
const shortcutIconInFlight = new Map<string, Promise<boolean>>();
function artworkGeneration(shortcutAppId: number): number { return artworkGenerations.get(shortcutAppId) ?? 0; }
function artworkGenerationIsCurrent(shortcutAppId: number, generation: number): boolean {
	return artworkGeneration(shortcutAppId) === generation;
}
/** Download Steam's official client icon and assign it through Steam's native API.
 * Identical callers share the same bridge operation so a timed-out foreground
 * link and its durable repair cannot write the shortcut icon concurrently. */
export function applyOfficialShortcutIcon(shortcutAppId: number, steamAppId: string, force = false): Promise<boolean> {
	const reservedTarget = artworkTargetReservations.get(shortcutAppId);
	if (reservedTarget && reservedTarget !== steamAppId) return Promise.resolve(false);
	const key = `${shortcutAppId}:${steamAppId}`;
	const active = shortcutIconInFlight.get(key);
	if (active) return active;
	let request!: Promise<boolean>;
	request = applyOfficialShortcutIconOnce(shortcutAppId, steamAppId, force)
		.finally(() => {
			if (shortcutIconInFlight.get(key) === request) shortcutIconInFlight.delete(key);
		});
	shortcutIconInFlight.set(key, request);
	return request;
}
/** Artwork persistence marker.  A shortcut is complete only when all four
 * library slots were written.  Earlier markers accepted a logo by itself,
 * which permanently prevented a later retry for games with partial artwork
 * metadata (notably older Steam catalogue entries). */
// Bump the marker when the slot canvas/normalization policy changes so games
// linked by an older build receive the corrected native-sized assets once.
const ART_STORAGE_PREFIX = 'gdl_artwork18_';
const LEGACY_ART_STORAGE_PREFIX = 'gdl_artwork4_';
const PREVIOUS_ART_STORAGE_PREFIXES = ['gdl_artwork5_', 'gdl_artwork6_', 'gdl_artwork7_', 'gdl_artwork8_', 'gdl_artwork9_', 'gdl_artwork10_', 'gdl_artwork11_', 'gdl_artwork12_', 'gdl_artwork13_', 'gdl_artwork14_', 'gdl_artwork15_', 'gdl_artwork16_', 'gdl_artwork17_'];
const NATIVE_ARTWORK_OVERRIDE_PREFIX = 'gdl_native_artwork_override1_';
interface ArtworkStorageMarker {
	steamAppId: string;
	slots: number[];
	retrySlots?: number[];
	profileRevision?: number;
	needsCommunityArtwork?: boolean;
	provenance?: Record<string, unknown>;
	sourceUrls?: Partial<Record<'portrait' | 'hero' | 'logo' | 'wide', string>>;
}
function isTrustedArtworkSourceUrl(value: unknown): value is string {
	const raw = String(value || '').trim();
	if (!/^https:\/\//i.test(raw)) return false;
	if (isTrustedSteamGridDbImageUrl(raw)) return true;
	try {
		const host = new URL(raw).hostname.toLowerCase();
		return host === 'steamstatic.com' || host.endsWith('.steamstatic.com')
			|| host === 'steampowered.com' || host.endsWith('.steampowered.com');
	} catch { return false; }
}
/** Increment only the reviewed title whose curated artwork changed. This
 * refreshes that shortcut without repainting artwork for every linked game. */
function curatedArtworkProfileRevision(steamAppId: string): number {
	if (steamAppId === '221430') return 6;
	if (steamAppId === '237110') return 5;
	return 0;
}
function readArtworkMarker(shortcutAppId: number, steamAppId: string): ArtworkStorageMarker | null {
	try {
		const marker = JSON.parse(localStorage.getItem(ART_STORAGE_PREFIX + shortcutAppId) || 'null');
		if (marker?.steamAppId !== steamAppId || !Array.isArray(marker?.slots)) return null;
		const profileRevision = curatedArtworkProfileRevision(steamAppId);
		if (profileRevision > 0 && marker?.profileRevision !== profileRevision) return null;
		return {
			steamAppId,
			slots: Array.from(new Set(marker.slots.map(Number).filter((slot: number) => [0, 1, 2, 3].includes(slot)))),
			retrySlots: Array.isArray(marker.retrySlots)
				? Array.from(new Set(marker.retrySlots.map(Number).filter((slot: number) => [0, 1, 2, 3].includes(slot))))
				: undefined,
			profileRevision: Number(marker.profileRevision) || undefined,
			needsCommunityArtwork: Boolean(marker.needsCommunityArtwork),
			provenance: marker.provenance && typeof marker.provenance === 'object' ? marker.provenance : undefined,
			sourceUrls: marker.sourceUrls && typeof marker.sourceUrls === 'object'
				? Object.fromEntries(Object.entries(marker.sourceUrls).filter(([slot, url]) =>
					['portrait', 'hero', 'logo', 'wide'].includes(slot) && isTrustedArtworkSourceUrl(url))) as ArtworkStorageMarker['sourceUrls']
				: undefined,
		};
	} catch { return null; }
}
function nativeArtworkCustomizationActive(shortcutAppId: number, steamAppId: string): boolean {
	try {
		const marker = JSON.parse(localStorage.getItem(NATIVE_ARTWORK_OVERRIDE_PREFIX + shortcutAppId) || 'null');
		return marker?.steamAppId === steamAppId && marker?.userManaged === true;
	} catch { return false; }
}

/** Steam's native Personalización controls are authoritative once the user uses
 * them. Automatic repair must never repaint those choices on navigation. */
export function markNativeArtworkCustomization(shortcutAppId: number, steamAppId: string): void {
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < 2147483648 || !/^\d+$/.test(steamAppId)) return;
	try {
		artworkGenerations.set(shortcutAppId, artworkGeneration(shortcutAppId) + 1);
		localStorage.setItem(NATIVE_ARTWORK_OVERRIDE_PREFIX + shortcutAppId, JSON.stringify({
			steamAppId,
			userManaged: true,
			updatedAt: Date.now(),
		}));
		artworkSpoofed.add(shortcutAppId + ':' + steamAppId);
	} catch {}
}

export function clearNativeArtworkCustomization(shortcutAppId: number | string): void {
	try {
		const id = Number(shortcutAppId);
		if (!Number.isFinite(id)) return;
		localStorage.removeItem(NATIVE_ARTWORK_OVERRIDE_PREFIX + id);
	} catch {}
}

export function linkedShortcutPortrait(shortcutAppId: number | string, steamAppId: string, officialFallback = ''): string {
	const shortcutId = Number(shortcutAppId);
	if (!Number.isFinite(shortcutId)) return officialFallback;
	const explicit = getSavedCommunityArtworkSelection(shortcutId, steamAppId)?.portrait?.url || '';
	if (explicit) return explicit;
	const marker = readArtworkMarker(shortcutId, steamAppId);
	const applied = (marker?.provenance?.portrait as { url?: unknown } | undefined)?.url;
	if (isTrustedSteamGridDbImageUrl(applied)) return applied;
	const source = marker?.sourceUrls?.portrait;
	if (isTrustedArtworkSourceUrl(source)) return source;
	if (officialFallback) return officialFallback;
	if (/^\d+$/.test(steamAppId)) {
		return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_600x900_2x.jpg`;
	}
	return '';
}
export function artworkAlreadySaved(shortcutAppId: number, steamAppId: string): boolean {
	if (nativeArtworkCustomizationActive(shortcutAppId, steamAppId)) return true;
	const marker = readArtworkMarker(shortcutAppId, steamAppId);
	if (!marker) return false;
	const hasPendingRetries = Array.isArray(marker.retrySlots) && marker.retrySlots.length > 0;
	if (hasPendingRetries) return false;
	const hasValidPortrait = isTrustedArtworkSourceUrl(marker.sourceUrls?.portrait
		|| (marker.provenance?.portrait as { url?: unknown } | undefined)?.url);
	const slots = new Set(marker.slots || []);
	if (!(slots.has(0) && slots.has(1) && slots.has(2) && slots.has(3) && hasValidPortrait)) {
		return false;
	}
	const heroSource = marker.sourceUrls?.hero || (marker.provenance?.hero as any)?.url || '';
	const heroProv = marker.provenance?.hero as any;
	const is2xHero = isHero2xUrl(heroSource) || heroProv?.variant === '2x';
	const heroPolicyEvaluated = Boolean(heroProv?.heroPolicyVersion && heroProv.heroPolicyVersion >= 2);
	if (is2xHero && !heroPolicyEvaluated) {
		return false;
	}
	return true;
}
function markArtworkSaved(shortcutAppId: number, steamAppId: string, slots: number[], needsCommunityArtwork = false,
	provenance?: Record<string, unknown>, retrySlots: number[] = [],
	sourceUrls: Partial<Record<'portrait' | 'hero' | 'logo' | 'wide', string>> = {}): void {
	try {
		const normalizedRetrySlots = Array.from(new Set(retrySlots)).filter(slot => [0, 1, 2, 3].includes(slot));
		localStorage.setItem(ART_STORAGE_PREFIX + shortcutAppId, JSON.stringify({
			steamAppId,
			slots: Array.from(new Set(slots)).sort((a, b) => a - b),
			retrySlots: normalizedRetrySlots.length ? normalizedRetrySlots.sort((a, b) => a - b) : undefined,
			profileRevision: curatedArtworkProfileRevision(steamAppId) || undefined,
			needsCommunityArtwork,
			provenance,
			sourceUrls: Object.fromEntries(Object.entries(sourceUrls).filter(([, url]) => isTrustedArtworkSourceUrl(url))),
		}));
	} catch {}
}
/** True when this Steam shortcut still has artwork ownership state written by
 * NativeGameLink. These markers live in Steam's web UI storage, so they can survive
 * replacing the plugin folder with a clean ZIP even when mappings.json is gone. */
export function hasManagedArtworkSaved(shortcutAppId: number): boolean {
	try {
		if (localStorage.getItem(NATIVE_ARTWORK_OVERRIDE_PREFIX + shortcutAppId)) return true;
		if (localStorage.getItem(ART_STORAGE_PREFIX + shortcutAppId)) return true;
		if (localStorage.getItem(LEGACY_ART_STORAGE_PREFIX + shortcutAppId)) return true;
		if (PREVIOUS_ART_STORAGE_PREFIXES.some(prefix => localStorage.getItem(prefix + shortcutAppId))) return true;
		return false;
	} catch { return false; }
}
/** Clear saved artwork marker (when mapping is removed) */
export function clearArtworkSaved(shortcutAppId: number | string, preserveIcon = false): void {
	try {
		const id = Number(shortcutAppId);
		if (!Number.isFinite(id)) return;
		artworkGenerations.set(id, artworkGeneration(id) + 1);
		localStorage.removeItem(NATIVE_ARTWORK_OVERRIDE_PREFIX + id);
		localStorage.removeItem(ART_STORAGE_PREFIX + id);
		localStorage.removeItem(LEGACY_ART_STORAGE_PREFIX + id);
		for (const prefix of PREVIOUS_ART_STORAGE_PREFIXES) localStorage.removeItem(prefix + id);
		clearLogoPositionSaved(id);
		localStorage.removeItem('gdl_legacy_info_portrait1_' + id);
		clearSavedCommunityArtworkSelection(id);
		if (!preserveIcon) clearShortcutIconMarker(id);
		for (const key of Array.from(artworkSpoofed)) {
			if (key.startsWith(`${id}:`)) artworkSpoofed.delete(key);
		}
		for (const key of Array.from(artworkInFlight.keys())) {
			if (key.startsWith(`${id}:`)) artworkInFlight.delete(key);
		}
		for (const key of Array.from(shortcutIconInFlight.keys())) {
			if (key.startsWith(`${id}:`)) shortcutIconInFlight.delete(key);
		}
	} catch {}
}
export function clearAllManagedArtworkMarkers(): number {
	let cleared = 0;
	try {
		const keys = Object.keys(localStorage);
		for (const key of keys) {
			if (
				key.startsWith(NATIVE_ARTWORK_OVERRIDE_PREFIX) ||
				key.startsWith(ART_STORAGE_PREFIX) ||
				key.startsWith(LEGACY_ART_STORAGE_PREFIX) ||
				isLogoPositionStorageKey(key) ||
				key.startsWith('gdl_legacy_info_portrait1_') ||
				key.startsWith(SHORTCUT_ICON_STORAGE_PREFIX) ||
				key.startsWith('gdl_art_') ||
				key.startsWith('gdl_artwork_') ||
				key.startsWith('gdl-artwork-')
			) {
				localStorage.removeItem(key);
				cleared += 1;
			}
		}
		artworkSpoofed.clear();
		artworkInFlight.clear();
		artworkTargetReservations.clear();
		artworkGenerations.clear();
		shortcutIconInFlight.clear();
	} catch {}
	return cleared;
}
/** Cancel obsolete downloads, wait for the bounded active bridge call, then let
 * unlink/relink clear Steam's slots without a late operation restoring them. */
export async function supersedeArtworkApplications(shortcutAppId: number, preserveIcon = false): Promise<void> {
	const activeArtwork = Array.from(artworkInFlight.entries())
		.filter(([key]) => key.startsWith(`${shortcutAppId}:`))
		.map(([, request]) => request);
	const activeIcons = Array.from(shortcutIconInFlight.entries())
		.filter(([key]) => key.startsWith(`${shortcutAppId}:`))
		.map(([, request]) => request);
	const active = Array.from(new Set<Promise<unknown>>([...activeArtwork, ...activeIcons]));
	clearArtworkSaved(shortcutAppId, preserveIcon);
	if (active.length === 0) return;
	await Promise.race([
		Promise.allSettled(active).then((): void => {}),
		new Promise<void>(resolve => setTimeout(resolve, 7000)),
	]);
}
export { isLogoPositionVerified } from './artwork-logo-position';
async function applyOfficialLogoPosition(
	shortcutAppId: number, steamAppId: string, rawPosition: unknown, force = false,
	fallbackPin: SteamLogoPinPosition = 'BottomLeft', source = 'none',
): Promise<boolean> {
	const generation = artworkGeneration(shortcutAppId);
	return applyLogoPosition(shortcutAppId, steamAppId, rawPosition, force, fallbackPin, source,
		() => artworkGenerationIsCurrent(shortcutAppId, generation));
}
/** Set ALL artwork for a shortcut using SetCustomArtworkForApp.
 *  Signature: SteamClient.Apps.SetCustomArtworkForApp(appId, base64Data, fileExtension, imageType)
 *  The extension param is a FILE EXTENSION like ".jpg" or ".png" (not a MIME type).
 *  IMPORTANT: Must call directly on the SteamClient.Apps object - extracting the function
 *  breaks Steam's IPC proxy and produces "Unknown method" errors. */
const artworkSpoofed = new Set<string>();
const artworkInFlight = new Map<string, Promise<ArtworkApplyResult>>();
const artworkTargetReservations = new Map<number, string>();
export interface ArtworkApplyResult {
	complete: boolean;
	slots: number[];
	missing: string[];
	communitySlots: string[];
}

/** Hold one shortcut on the AppID currently being linked. Route observers can
 * still see the previous mapping until commit, but their repair requests must
 * not overwrite the replacement artwork in that window. */
export function reserveShortcutArtworkTarget(shortcutAppId: number, steamAppId: string): () => void {
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < 2147483648 || !/^\d+$/.test(steamAppId)) return (): void => {};
	artworkTargetReservations.set(shortcutAppId, steamAppId);
	return (): void => {
		if (artworkTargetReservations.get(shortcutAppId) === steamAppId) artworkTargetReservations.delete(shortcutAppId);
	};
}
const ARTWORK_SLOT_NAMES: Record<number, string> = {
	0: 'portrait', 1: 'hero', 2: 'logo', 3: 'header',
};
export function recordUserArtworkApplication(shortcutAppId: number, steamAppId: string, slots: number[], selection: CommunityArtworkSelection): void {
	clearNativeArtworkCustomization(shortcutAppId);
	invalidateLogoPosition(shortcutAppId);
	const existingMarker = readArtworkMarker(shortcutAppId, steamAppId);
	const existingSlots = existingMarker?.slots || [];
	markArtworkSaved(shortcutAppId, steamAppId, [...existingSlots, ...slots], false, Object.fromEntries(
		Object.entries(selection).map(([slot, item]) => [slot, { ...item, provider: 'steamgriddb', selection: 'user_choice' }]),
	), [], {
		...(existingMarker?.sourceUrls || {}),
		...Object.fromEntries(Object.entries(selection).map(([slot, item]) => [slot, item.url])),
	});
	artworkSpoofed.add(shortcutAppId + ':' + steamAppId);
}
async function spoofArtworkOnce(shortcutAppId: number, steamAppId: string, _gameTitle: string, force = false, legacyPortraitOnly = false): Promise<ArtworkApplyResult> {
	const key = shortcutAppId + ':' + steamAppId;
	const generation = artworkGeneration(shortcutAppId);
	const isCurrent = (): boolean => artworkGenerationIsCurrent(shortcutAppId, generation);
	const existingMarker = !force ? readArtworkMarker(shortcutAppId, steamAppId) : null;
	if (!force && nativeArtworkCustomizationActive(shortcutAppId, steamAppId)) {
		backendLog('Native Steam artwork is user-managed for ' + shortcutAppId + ' -> ' + steamAppId + '; skipping automatic repaint.');
		return { complete: true, slots: existingMarker?.slots?.length ? existingMarker.slots : [0, 1, 2, 3], missing: [], communitySlots: [] };
	}
	// Old markers only recorded a global "needs community" bit. Revalidate all
	// of those once; new markers remember the exact provisional/missing slots so
	// every later repair can retain valid artwork and fetch only what is absent.
	const persistedRetrySlots = new Set<number>(existingMarker?.needsCommunityArtwork
		? (existingMarker.retrySlots?.length ? existingMarker.retrySlots : [0, 1, 2, 3])
		: []);
	const retainedSlots = new Set<number>(existingMarker?.slots || []);
	const sourceUrls = { ...(existingMarker?.sourceUrls || {}) } as Partial<Record<'portrait' | 'hero' | 'logo' | 'wide', string>>;
	const hasReusableSource = (slot: number): boolean => {
		const slotName = ARTWORK_SLOT_NAMES[slot] as keyof typeof sourceUrls;
		const provenanceUrl = (existingMarker?.provenance?.[slotName] as { url?: unknown } | undefined)?.url;
		return isTrustedArtworkSourceUrl(sourceUrls[slotName] || provenanceUrl);
	};
	const heroProv = existingMarker?.provenance?.hero as any;
	const existingHeroUrl = sourceUrls.hero || (heroProv?.url as string | undefined) || '';
	const heroNeedsUpgrade = (isHero2xUrl(existingHeroUrl) || heroProv?.variant === '2x') && !(heroProv?.heroPolicyVersion >= 2);
	const reusableSlots = new Set<number>(Array.from(retainedSlots)
		.filter(slot => !persistedRetrySlots.has(slot) && hasReusableSource(slot) && !(slot === 1 && heroNeedsUpgrade)));

	// Skip if artwork was already downloaded and saved for this exact pairing
	if (!force && artworkAlreadySaved(shortcutAppId, steamAppId)) {
		artworkSpoofed.add(key);
		backendLog('Artwork already saved for ' + shortcutAppId + ' -> ' + steamAppId);
		const modern = await getModernLibraryAssets(steamAppId);
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };
		await applyOfficialLogoPosition(shortcutAppId, steamAppId, sourceUrls.logo === modern?.logo && (sourceUrls.hero === modern?.hero || sourceUrls.hero === modern?.hero2x) ? modern?.logo_position : null, false, 'BottomLeft', modern?.logo_position_source || 'none');
		return { complete: true, slots: [0, 1, 2, 3], missing: [], communitySlots: [] };
	}

	const sc = (window as any).SteamClient;
	const canUseSteamArtworkApi = typeof sc?.Apps?.SetCustomArtworkForApp === 'function';
	if (!canUseSteamArtworkApi) {
		backendLog('SetCustomArtworkForApp not available; continuing with backend grid-file fallback');
	}

	{
		const userCommunity = getSavedCommunityArtworkSelection(shortcutAppId, steamAppId);
		const modernPromise = getModernLibraryAssets(steamAppId);
		const legacy = legacyPortraitOnly || isLegacyGame(steamAppId);
		const preferredCommunityPromise = legacy
			? getCommunityArtwork(steamAppId)
			: retiredCommunityArtworkPreferred(steamAppId).then(preferred => preferred ? getCommunityArtwork(steamAppId) : null);
		const communityDeadline = Date.now() + (legacy ? 6_500 : 9_000);
		const communityWithinBudget = async (): Promise<CommunityArtworkAssets | null> => {
			const remaining = communityDeadline - Date.now();
			if (remaining <= 0) return null;
			return await Promise.race<CommunityArtworkAssets | null>([
				preferredCommunityPromise,
				new Promise<null>(resolve => setTimeout(() => resolve(null), remaining)),
			]);
		};
		// Removed/delisted AppIDs are slower because their modern Steam CDN/AppInfo
		// paths often time out or 404. Resolve Steam metadata and SteamGridDB in
		// parallel, and give known legacy titles only a short metadata wait budget.
		const [modern, initialCommunity] = await Promise.all([
			Promise.race<SteamLibraryAssets | null>([
				modernPromise,
				new Promise<null>(resolve => setTimeout(() => resolve(null), legacy ? 2500 : 12000)),
			]),
			communityWithinBudget(),
		]);
		let preferredCommunity = initialCommunity;
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };
		const communityUrlSet = new Set([
			userCommunity?.portrait?.url, userCommunity?.hero?.url,
			userCommunity?.logo?.url, userCommunity?.wide?.url,
			preferredCommunity?.portrait, preferredCommunity?.hero,
			preferredCommunity?.logo, preferredCommunity?.wide,
		].filter((value): value is string => Boolean(value)));
		const explicitUserUrlSet = new Set([
			userCommunity?.portrait?.url, userCommunity?.hero?.url,
			userCommunity?.logo?.url, userCommunity?.wide?.url,
		].filter((value): value is string => Boolean(value)));
		const sharedBase = `https://shared.steamstatic.com/store_item_assets/steam/apps/${steamAppId}`;
		const cdnBase = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}`;
		const cfBase = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}`;
		const cfCdnBase = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}`;
		const fastlyBase = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamAppId}`;
		const legacyCommunityFirst = legacy && Boolean(preferredCommunity);
		const communityAroundProbes = (communityUrl: string, probes: string[]): string[] =>
			legacyCommunityFirst ? [communityUrl, ...probes] : [...probes, communityUrl];

		// Critical library identity first: Hero + Logo + Portrait. The wide capsule
		// is intentionally resolved only after those three have been written, so a
		// slow/404 secondary asset cannot delay the visible game-detail surface.
		const sources: { urls: string[]; imageType: number; label: string }[] = [
			{
				urls: buildHeroCandidateUrls({
					steamAppId,
					modern,
					communityHero: preferredCommunity?.hero || '',
					userHero: userCommunity?.hero?.url || '',
					preferCommunityBeforeDirectProbes: legacyCommunityFirst,
				}),
				imageType: 1,
				label: 'Hero',
			},
			{
				urls: [
					userCommunity?.logo?.url || '',
					modern?.logo || '',
					...communityAroundProbes(preferredCommunity?.logo || '', [
						`${sharedBase}/logo.png`,
						`${fastlyBase}/logo.png`,
						`${cfBase}/logo.png`,
						`${cfCdnBase}/logo.png`,
						`${cdnBase}/logo.png`,
					]),
				],
				imageType: 2,
				label: 'Logo',
			},
			{
				urls: [
					userCommunity?.portrait?.url || '',
					modern?.portrait || '',
					...communityAroundProbes(preferredCommunity?.portrait || '', [
						`${sharedBase}/library_600x900_2x.jpg`,
						`${sharedBase}/library_600x900.jpg`,
						`${fastlyBase}/library_600x900_2x.jpg`,
						`${fastlyBase}/library_600x900.jpg`,
						`${cfBase}/library_600x900.jpg`,
						`${cfCdnBase}/library_600x900.jpg`,
						`${cdnBase}/library_600x900.jpg`,
					]),
				],
				imageType: 0,
				label: 'Portrait Grid',
			},
			{
				urls: [
					userCommunity?.wide?.url || '',
					modern?.wide || '',
					modern?.legacy_header || '',
					...communityAroundProbes(preferredCommunity?.wide || '', [
						`${sharedBase}/header.jpg`,
						`${fastlyBase}/header.jpg`,
						`${cfBase}/header.jpg`,
						`${cfCdnBase}/header.jpg`,
						`${cdnBase}/header.jpg`,
						`${sharedBase}/capsule_616x353.jpg`,
						`${fastlyBase}/capsule_616x353.jpg`,
					]),
				],
				imageType: 3,
				label: 'Wide Capsule',
			},
		];
		const portraitSource = sources.find(s => s.imageType === 0);
		if (legacyPortraitOnly && portraitSource) portraitSource.urls = portraitSource.urls.filter(url => !url.includes('library_600x900'));
		const pendingSources = sources.filter(source => !reusableSlots.has(source.imageType));

		interface ArtworkDownloadCandidate {
			url: string;
			dataUrl: string | null;
			imageType: number;
			label: string;
			community: boolean;
		}
		const resolveSource = async ({ urls, imageType, label }: { urls: string[]; imageType: number; label: string }): Promise<ArtworkDownloadCandidate> => {
			const candidateList = Array.from(new Set(urls.filter(Boolean)));
			const fallbackCandidateUrl = candidateList[0] || '';
			for (const url of candidateList) {
				if (!isCurrent()) break;
				try {
					const dataUrl = await imageUrlToBase64(url);
					if (dataUrl && (explicitUserUrlSet.has(url) || await automaticArtworkMeetsSlotQuality(dataUrl, imageType))) {
						return { url, dataUrl, imageType, label, community: communityUrlSet.has(url) };
					}
				} catch {}
			}
			return { url: fallbackCandidateUrl, dataUrl: null, imageType, label, community: communityUrlSet.has(fallbackCandidateUrl) };
		};

		const communitySlots: string[] = [];
		const communityProvenance: Record<string, unknown> = {};
		const isLowResHeader = (url: string): boolean => /\/header\.jpg(?:$|[?#])/i.test(url);
		const isAuthoritativeSteamMetadataUrl = (url: string, imageType: number): boolean => {
			if (!url || !modern) return false;
			if (imageType === 0) return url === modern.portrait;
			if (imageType === 1) return url === modern.hero || url === modern.hero2x || url === modern.legacy_header;
			if (imageType === 2) return url === modern.logo || url === modern.legacy_logo;
			if (imageType === 3) return url === modern.wide || url === modern.legacy_header;
			return false;
		};
		const needsCommunityArtwork = (item: ArtworkDownloadCandidate): boolean => {
			if (explicitUserUrlSet.has(item.url)) return false;
			if (!item.dataUrl && isAuthoritativeSteamMetadataUrl(item.url, item.imageType) && !imageUrlKnownMissing(item.url)) return false;
			return !item.dataUrl || (item.imageType === 3 && isLowResHeader(item.url) && !modern?.wide);
		};
		const enrichWithCommunity = async (items: ArtworkDownloadCandidate[]): Promise<void> => {
			if (!items.some(needsCommunityArtwork)) return;
			const community = preferredCommunity || await communityWithinBudget();
			if (!community) return;
			preferredCommunity = community;
			const communityUrlByType: Record<number, string> = {
				0: community.portrait || '', 1: community.hero || '',
				2: community.logo || '', 3: community.wide || '',
			};
			for (const item of items) {
				if (!isCurrent()) break;
				if (!needsCommunityArtwork(item)) continue;
				const url = communityUrlByType[item.imageType];
				if (!url) continue;
				const dataUrl = await imageUrlToBase64(url);
				if (!isCurrent()) break;
				if (dataUrl && await automaticArtworkMeetsSlotQuality(dataUrl, item.imageType)) {
					item.url = url;
					item.dataUrl = dataUrl;
					item.community = true;
					const slotName = ARTWORK_SLOT_NAMES[item.imageType];
					if (slotName && !communitySlots.includes(slotName)) communitySlots.push(slotName);
					const sourceName = item.imageType === 0 ? 'portrait' : item.imageType === 1 ? 'hero' : item.imageType === 2 ? 'logo' : 'wide';
					if (slotName && community.provenance?.[sourceName]) communityProvenance[slotName] = community.provenance[sourceName];
				} else if (!item.dataUrl) {
					item.url = url;
					item.community = true;
				}
			}
		};
		const recordResolvedProvenance = (items: ArtworkDownloadCandidate[]): void => {
			for (const item of items) {
				if (!item.url) continue;
				const slotName = ARTWORK_SLOT_NAMES[item.imageType];
				if (!slotName) continue;
				if (item.imageType === 1) {
					const isUser = explicitUserUrlSet.has(item.url);
					const variant = classifyHeroVariant(item.url, modern, isUser);
					const reason = determineHeroSelectionReason(variant);
					const provider = item.community ? 'steamgriddb' : isUser ? 'user' : variant === 'legacy' ? 'steam-legacy' : 'steam';
					communityProvenance[slotName] = { url: item.url, provider, variant, selectionReason: reason, heroPolicyVersion: 2 };
					logHeroResolutionDiagnostics(steamAppId, { selectedUrl: item.url, variant, reason }, backendLog);
				} else if (item.community) {
					if (communityProvenance[slotName]) continue;
					const sourceName = item.imageType === 0 ? 'portrait' : item.imageType === 2 ? 'logo' : 'wide';
					const explicit = userCommunity?.[sourceName];
					communityProvenance[slotName] = explicit
						? { ...explicit, provider: 'user', selection: 'user_choice' }
						: preferredCommunity?.provenance?.[sourceName] || { url: item.url, provider: 'steamgriddb' };
				} else {
					const isLegacy = /\/header\.jpg(?:$|[?#])/i.test(item.url) && item.imageType === 0;
					communityProvenance[slotName] = { url: item.url, provider: isLegacy ? 'steam-legacy' : 'steam' };
				}
			}
		};

		const defaultLogoPin: SteamLogoPinPosition = 'BottomLeft';
		const successfulSlots: number[] = Array.from(reusableSlots);
		const appliedSlots: number[] = [];
		const allDownloads: ArtworkDownloadCandidate[] = [];
		const applyResolvedDownload = async (download: ArtworkDownloadCandidate): Promise<void> => {
			if (!isCurrent()) return;
			const { dataUrl, imageType, label } = download;
			let { community, url } = download;
			let slotApplied = false;
			let preparedDataUrl: string | null = dataUrl;
			if (dataUrl && community) {
				try { preparedDataUrl = await normalizeCommunityArtworkDataUrl(dataUrl, imageType) || dataUrl; }
				catch (e) { preparedDataUrl = dataUrl; backendLog('Artwork normalization fallback (' + label + '): ' + e); }
			}

			// Write the grid file first. Unlike four sequential Steam bridge calls,
			// these local atomic writes do not make the visible Hero/Logo component
			// tear down and rebuild once per slot. The bridge remains a fallback for
			// environments where the backend grid directory is unavailable.
			if (preparedDataUrl) {
				try {
					const commaIdx = preparedDataUrl.indexOf(',');
					const base64Data = commaIdx >= 0 ? preparedDataUrl.substring(commaIdx + 1) : preparedDataUrl;
					const mime = preparedDataUrl.match(/^data:image\/(png|jpe?g)/i)?.[1]?.toLowerCase();
					const ext = mime === 'png' ? 'png' : 'jpg';
					const raw = await saveShortcutArtworkBackend({ request_json: JSON.stringify({
						shortcut_app_id: shortcutAppId, steam_app_id: steamAppId, image_type: imageType,
						data_base64: base64Data, extension: ext,
					}) });
					let response: any = raw;
					for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt += 1) response = JSON.parse(response);
					if (response?.ok === true || response?.saved === true) slotApplied = true;
				} catch (e) { backendLog('Backend grid save error (prepared base64) (' + label + '): ' + e); }
			}
			if (!slotApplied && preparedDataUrl && canUseSteamArtworkApi) {
				try {
					const commaIdx = preparedDataUrl.indexOf(',');
					const base64Data = commaIdx >= 0 ? preparedDataUrl.substring(commaIdx + 1) : preparedDataUrl;
					const mime = preparedDataUrl.match(/^data:image\/(png|jpe?g)/i)?.[1]?.toLowerCase();
					const ext = mime === 'png' ? 'png' : 'jpg';
					const result = await waitForSteamBridge(sc.Apps.SetCustomArtworkForApp(shortcutAppId, base64Data, ext, imageType), 5000);
					if (result) { slotApplied = true; backendLog('Artwork set through Steam fallback: ' + label + ' (type ' + imageType + ') for ' + shortcutAppId); }
				} catch (e) { backendLog('Artwork Steam fallback error (' + label + '): ' + e); }
			}
			// resolveSource already used the backend and validated dimensions.
			// Do not download exhausted candidates again or bypass that validation.

			if (slotApplied) {
				download.url = url;
				download.community = community;
				const appliedSlotName = ARTWORK_SLOT_NAMES[imageType];
				if (appliedSlotName && url) {
					if (imageType === 1) {
						const isUser = explicitUserUrlSet.has(url);
						const variant = classifyHeroVariant(url, modern, isUser);
						communityProvenance[appliedSlotName] = {
							url,
							provider: isUser ? 'user' : community ? 'steamgriddb' : variant === 'legacy' ? 'steam-legacy' : 'steam',
							variant,
							selectionReason: determineHeroSelectionReason(variant),
							heroPolicyVersion: 2,
						};
					} else if (community) {
						const sourceName = imageType === 0 ? 'portrait' : imageType === 2 ? 'logo' : 'wide';
						communityProvenance[appliedSlotName] = explicitUserUrlSet.has(url)
							? { url, provider: 'user', selection: 'user_choice' }
							: preferredCommunity?.provenance?.[sourceName] || { url, provider: 'steamgriddb', selection: 'automatic_recommended' };
					} else communityProvenance[appliedSlotName] = { url, provider: 'steam' };
				}
				successfulSlots.push(imageType);
				appliedSlots.push(imageType);
			} else if (!dataUrl && !url) backendLog('Artwork not available: ' + label + ' for ' + steamAppId);
		};
		const applyResolvedDownloads = async (items: ArtworkDownloadCandidate[]): Promise<void> => {
			// Each slot has an independent target file. Launch the writes together so
			// Steam observes one compact artwork transaction instead of a visible
			// Hero -> Logo -> Portrait sequence.
			await Promise.all(items.map(applyResolvedDownload));
		};

		const prioritySources = pendingSources.filter(source => source.imageType === 1 || source.imageType === 2 || source.imageType === 0);
		const secondarySources = pendingSources.filter(source => source.imageType !== 1 && source.imageType !== 2 && source.imageType !== 0);
		const priorityDownloads = await Promise.all(prioritySources.map(resolveSource));
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };
		await enrichWithCommunity(priorityDownloads);
		recordResolvedProvenance(priorityDownloads);
		allDownloads.push(...priorityDownloads);
		await applyResolvedDownloads(priorityDownloads);
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };

		// Only now resolve secondary artwork (currently the wide capsule). This is
		// deliberately sequenced after Hero/Logo/Portrait to avoid making the user
		// wait for a non-critical carousel asset before the game page looks native.
		const secondaryDownloads = await Promise.all(secondarySources.map(resolveSource));
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };
		await enrichWithCommunity(secondaryDownloads);
		recordResolvedProvenance(secondaryDownloads);
		allDownloads.push(...secondaryDownloads);
		await applyResolvedDownloads(secondaryDownloads);
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };

		const heroDownload = allDownloads.find(item => item.imageType === 1);
		const heroUsesLegacyFallback = Boolean(heroDownload?.dataUrl
			&& !/\/library_hero(?:_2x)?\.jpg(?:$|[?#])/i.test(String(heroDownload.url || ''))
			&& String(heroDownload.url || '') !== String(modern?.hero || ''));
		if (heroUsesLegacyFallback) backendLog('Hero uses fallback composition for ' + shortcutAppId);

		const successfulSlotSet = new Set(successfulSlots);
		for (const item of allDownloads) {
			if ((item.dataUrl || appliedSlots.includes(item.imageType)) && item.url && isTrustedArtworkSourceUrl(item.url)) {
				sourceUrls[ARTWORK_SLOT_NAMES[item.imageType] as keyof typeof sourceUrls] = item.url;
			}
		}
		const retrySlots = new Set(persistedRetrySlots);
		for (const item of allDownloads) {
			const applied = appliedSlots.includes(item.imageType);
			if (applied) retrySlots.delete(item.imageType);
			else if (!successfulSlotSet.has(item.imageType)) retrySlots.add(item.imageType);
		}
		for (const slot of [0, 1, 2, 3]) if (!successfulSlotSet.has(slot)) retrySlots.add(slot);
		for (const item of allDownloads) {
			if ((item.imageType === 0 || item.imageType === 1) && /\/header\.jpg(?:$|[?#])/i.test(item.url)) retrySlots.add(item.imageType);
		}
		const missing = Array.from(retrySlots).sort((a, b) => a - b).map(slot => ARTWORK_SLOT_NAMES[slot]);
		const logoApplied = successfulSlotSet.has(2);
		const allSlotsApplied = [0, 1, 2, 3].every(slot => successfulSlotSet.has(slot));
		const needsCommunityUpgrade = retrySlots.size > 0;
		const complete = allSlotsApplied && missing.length === 0;
		if (logoApplied) await applyOfficialLogoPosition(shortcutAppId, steamAppId, sourceUrls.logo === modern?.logo && (sourceUrls.hero === modern?.hero || sourceUrls.hero === modern?.hero2x) ? modern?.logo_position : null, force, defaultLogoPin, modern?.logo_position_source || 'none');
		if (!isCurrent()) return { complete: false, slots: [], missing: ['superseded'], communitySlots: [] };
		if (successfulSlots.length > 0) {
			markArtworkSaved(shortcutAppId, steamAppId, Array.from(successfulSlotSet), needsCommunityUpgrade,
				{ ...(existingMarker?.provenance || {}), ...communityProvenance }, Array.from(retrySlots), sourceUrls);
		}
		if (complete) artworkSpoofed.add(key);
		if (appliedSlots.length) {
			setTimeout(() => {
				if (!isCurrent()) return;
				try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId, steamAppId, automatic: true, batch_complete: true } })); } catch {}
			}, 0);
		}
		backendLog('Applied ' + successfulSlotSet.size + '/4 artwork images for ' + steamAppId
			+ ' (priority hero/logo/portrait first, logo=' + (logoApplied ? 'yes' : 'no') + ')');
		return { complete, slots: Array.from(successfulSlotSet), missing, communitySlots };
	}
}

export function spoofArtwork(shortcutAppId: number, steamAppId: string, gameTitle: string, force = false,
	legacyPortraitOnly = false): Promise<ArtworkApplyResult> {
	const reservedTarget = artworkTargetReservations.get(shortcutAppId);
	if (reservedTarget && reservedTarget !== steamAppId) {
		return Promise.resolve({ complete: false, slots: [], missing: ['superseded'], communitySlots: [] });
	}
	const key = shortcutAppId + ':' + steamAppId;
	const active = artworkInFlight.get(key);
	if (active) return active;
	const request = spoofArtworkOnce(shortcutAppId, steamAppId, gameTitle, force, legacyPortraitOnly)
		.finally(() => {
			if (artworkInFlight.get(key) === request) artworkInFlight.delete(key);
		});
	artworkInFlight.set(key, request);
	return request;
}
/** Drop resource snapshots so changes are visible in the current Steam session. */
export function clearLibraryAssetCaches(): void {
	clearLibraryAssetDataCaches();
	artworkSpoofed.clear();
}

/** Refresh selected identities while retaining hot data for every other game. */
export function invalidateLibraryAssetCaches(appIds: Iterable<string | number>): void {
	const ids = invalidateLibraryAssetDataCaches(appIds);
	if (ids.size === 0) return;
	for (const key of Array.from(artworkSpoofed)) {
		if (ids.has(key.split(':').pop() || '')) artworkSpoofed.delete(key);
	}
}
