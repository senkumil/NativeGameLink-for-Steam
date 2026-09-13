import type { ShortcutDetectionCandidate } from '../../domain/types';

export interface GameEdition {
	appId: string;
	name: string;
	edition: string;
	bundleId?: number;
	assets?: {
		hero?: string;
		portrait?: string;
		logo?: string;
		wide?: string;
		icon?: string;
	};
}

const SHORTCUT_EDITION_STORAGE_PREFIX = 'gdl_shortcut_edition1_';

/**
 * Curated high-fidelity catalog of popular game editions that share their base
 * game AppID on Steam, along with their official Steam CDN assets.
 */
const KNOWN_EDITIONS: Record<string, GameEdition[]> = {
	'1091500': [
		{
			appId: '1091500',
			name: 'Cyberpunk 2077: Ultimate Edition',
			edition: 'Ultimate Edition',
			bundleId: 32470,
			assets: {
				hero: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/bundles/32470/5htp7gjbzhjufq5c/717c868afde87b39ba93116e6416fcc8c3cdaa3b/page_bg_raw.jpg?t=1746520128',
				wide: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/bundles/32470/5htp7gjbzhjufq5c/bf9c2437bb3ebafdeb49867c1b331d02d42e3452/header.jpg?t=1746520128',
			},
		},
	],
	'292030': [
		{
			appId: '292030',
			name: 'The Witcher 3: Wild Hunt - Complete Edition',
			edition: 'Complete Edition',
			assets: {
				wide: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/292030/header.jpg',
			},
		},
	],
	'1174180': [
		{
			appId: '1174180',
			name: 'Red Dead Redemption 2: Ultimate Edition',
			edition: 'Ultimate Edition',
			assets: {
				wide: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1174180/header.jpg',
			},
		},
	],
	'239140': [
		{
			appId: '239140',
			name: 'Dying Light: Definitive Edition',
			edition: 'Definitive Edition',
		},
	],
	'2050650': [
		{
			appId: '2050650',
			name: 'Resident Evil 4: Gold Edition',
			edition: 'Gold Edition',
		},
	],
	'397540': [
		{
			appId: '397540',
			name: 'Borderlands 3: Ultimate Edition',
			edition: 'Ultimate Edition',
		},
	],
	'310950': [
		{
			appId: '310950',
			name: 'Street Fighter V: Champion Edition',
			edition: 'Champion Edition',
		},
	],
	'1551360': [
		{
			appId: '1551360',
			name: 'Forza Horizon 5: Premium Edition',
			edition: 'Premium Edition',
		},
	],
	'990080': [
		{
			appId: '990080',
			name: 'Hogwarts Legacy: Digital Deluxe Edition',
			edition: 'Deluxe Edition',
		},
	],
};

export function getKnownEditionsForAppId(appId: string): GameEdition[] {
	return KNOWN_EDITIONS[appId] || [];
}

/**
 * Expand a list of candidates to include known game editions for any matched AppID.
 * Editions are placed immediately after their base game candidate so the user can
 * choose the exact edition they want in the dropdown.
 */
export function expandCandidatesWithEditions(candidates: ShortcutDetectionCandidate[]): ShortcutDetectionCandidate[] {
	if (!Array.isArray(candidates) || candidates.length === 0) return candidates;
	const result: ShortcutDetectionCandidate[] = [];
	const seenKeys = new Set<string>();

	for (const candidate of candidates) {
		const baseKey = candidate.candidate_key || candidate.appid;
		if (!seenKeys.has(baseKey)) {
			seenKeys.add(baseKey);
			result.push({
				...candidate,
				candidate_key: baseKey,
			});
		}

		// Inject editions for this AppID
		const editions = getKnownEditionsForAppId(candidate.appid);
		for (const ed of editions) {
			const edKey = `${candidate.appid}:edition:${ed.edition.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
			if (!seenKeys.has(edKey)) {
				seenKeys.add(edKey);
				result.push({
					appid: candidate.appid,
					candidate_key: edKey,
					name: ed.name,
					image: ed.assets?.wide || ed.assets?.hero || candidate.image,
					score: candidate.score,
					confidence: candidate.confidence,
					reasons: [...(candidate.reasons || []), 'game_edition'],
					executable_match: candidate.executable_match,
					is_edition: true,
					edition: ed.edition,
					edition_assets: ed.assets,
					bundle_id: ed.bundleId,
				});
			}
		}
	}
	return result;
}

export function saveShortcutEdition(shortcutAppId: number, edition: {
	edition: string;
	name: string;
	appId: string;
	assets?: GameEdition['assets'];
	bundleId?: number;
}): void {
	if (!shortcutAppId) return;
	try {
		localStorage.setItem(SHORTCUT_EDITION_STORAGE_PREFIX + shortcutAppId, JSON.stringify(edition));
	} catch {}
}

export function getShortcutEdition(shortcutAppId: number): {
	edition: string;
	name: string;
	appId: string;
	assets?: GameEdition['assets'];
	bundleId?: number;
} | null {
	if (!shortcutAppId) return null;
	try {
		const raw = localStorage.getItem(SHORTCUT_EDITION_STORAGE_PREFIX + shortcutAppId);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

export function clearShortcutEdition(shortcutAppId: number): void {
	if (!shortcutAppId) return;
	try {
		localStorage.removeItem(SHORTCUT_EDITION_STORAGE_PREFIX + shortcutAppId);
	} catch {}
}
