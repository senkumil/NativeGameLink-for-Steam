import type { NativeGameFeature, NativeGameFeatureKind, NativeGameInfo, SteamGameData } from '../../domain/types';
import type { SteamLibraryAssets } from './artwork';
import { gdlText, loc, steamIntlLocale } from '../../steam/localization';
import { stripTags } from './news';
import { isLegacyGame, legacyGameRecord } from './legacy-games';
import { steamStringList } from '../../core/steam-game-data';

function nativeFeature(key: string, kind: NativeGameFeatureKind, label: string, categoryId?: number): NativeGameFeature {
	return { key, kind, label, categoryId };
}

/** Map language-independent Store category IDs to semantic native-library features. */
function mapNativeFeature(categoryId?: number): NativeGameFeature | null {
	switch (Number(categoryId)) {
		case 2: return nativeFeature('category:2', 'single-player', loc('AppDetails_Feature_SinglePlayer', gdlText('single_player', 'Single-player')), 2);
		case 1: return nativeFeature('category:1', 'multiplayer', loc('AppDetails_Feature_MultiPlayer', gdlText('multi_player', 'Multi-player')), 1);
		case 9:
		case 38: return nativeFeature(`category:${categoryId}`, 'coop', loc('AppDetails_Feature_CoOp', gdlText('cooperative', 'Co-op')), categoryId);
		case 22: return nativeFeature('category:22', 'achievements', loc('AppDetails_Feature_SteamAchievements', gdlText('achievements_label', 'Achievements')), 22);
		case 23: return nativeFeature('category:23', 'cloud', loc('AppDetails_Feature_SteamCloud', gdlText('cloud_saves', 'Cloud saves')), 23);
		case 28: return nativeFeature('category:28', 'controller-full', loc('AppDetails_Feature_FullController', gdlText('full_controller', 'Full controller support')), 28);
		case 18: return nativeFeature('category:18', 'controller-partial', loc('AppDetails_Feature_PartialController', gdlText('partial_controller', 'Partial controller support')), 18);
		case 30: return nativeFeature('category:30', 'workshop', loc('AppDetails_Feature_SteamWorkshop', 'Steam Workshop'), 30);
		case 44: return nativeFeature('category:44', 'remote-play', loc('AppDetails_Feature_RemotePlayTogether', 'Remote Play Together'), 44);
		case 55:
		case 56: return nativeFeature(`category:${categoryId}`, 'ps4', loc('AppDetails_Feature_PS4', gdlText('controller_ps4', 'Compatibilidad con DUALSHOCK')), categoryId);
		case 57:
		case 58: return nativeFeature(`category:${categoryId}`, 'ps5', loc('AppDetails_Feature_PS5', gdlText('controller_ps5', 'Compatibilidad con DualSense')), categoryId);
		case 62: return nativeFeature('category:62', 'family-sharing', loc('AppDetails_Feature_FamilySharing', gdlText('family_sharing', 'Family Sharing')), 62);
		default: return null;
	}
}

const FEATURE_ORDER: Record<string, number> = {
	'single-player': 10,
	multiplayer: 20,
	coop: 30,
	achievements: 40,
	cloud: 50,
	'family-sharing': 60,
	workshop: 70,
	'remote-play': 80,
	'controller-full': 90,
	'controller-partial': 95,
	ps4: 100,
	ps5: 110,
};

function uniqueNativeFeatures(values: NativeGameFeature[], _legacy = false): NativeGameFeature[] {
	const seen = new Set<string>();
	const filtered = values.filter(feature => {
		const key = feature.kind || feature.key;
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return Boolean(feature.label);
	});
	return filtered.sort((a, b) => {
		const orderA = FEATURE_ORDER[a.kind] ?? 999;
		const orderB = FEATURE_ORDER[b.kind] ?? 999;
		return orderA - orderB;
	}).slice(0, 10);
}

function formatNativeRelease(value: string): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	try {
		const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (match) {
			const localDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
			return new Intl.DateTimeFormat(steamIntlLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(localDate);
		}
	} catch {}
	// Store appdetails already localizes non-ISO release strings using Steam language.
	// Clean up comma formatting e.g. "4 Sep, 2025" -> "4 Sep 2025"
	return raw.replace(/,\s*(\d{4})/g, ' $1');
}

export function steamNativeGameInfo(data: SteamGameData, steamAppId: string, modern?: SteamLibraryAssets | null): NativeGameInfo {
	const legacy = legacyGameRecord(steamAppId, data);
	const isLegacy = isLegacyGame(steamAppId, data);
	const categoryIds = [
		...(Array.isArray(data.categories) ? data.categories : []).map(category => Number(category.id)),
		...(isLegacy ? steamStringList(modern?.category_ids).map(Number) : []),
	];
	const features = categoryIds
		.map(categoryId => mapNativeFeature(categoryId))
		.filter((feature): feature is NativeGameFeature => Boolean(feature));
	for (const feature of legacy?.features || []) {
		const mapped = mapNativeFeature(feature.categoryId);
		if (mapped) features.push({ ...mapped, key: feature.key, kind: feature.kind });
	}
	const hasCloud = categoryIds.some(categoryId => categoryId === 23);
	if ((data.achievements?.total || 0) > 0 && !features.some(feature => feature.kind === 'achievements')) {
		features.push(nativeFeature('derived:achievements', 'achievements', loc('AppDetails_Feature_SteamAchievements', gdlText('achievements_label', 'Achievements'))));
	}
	if (hasCloud && !features.some(feature => feature.kind === 'cloud')) {
		features.push(nativeFeature('derived:cloud', 'cloud', loc('AppDetails_Feature_SteamCloud', gdlText('cloud_saves', 'Cloud saves'))));
	}
	if (data.controller_support === 'full' && !features.some(feature => feature.kind === 'controller-full')) {
		features.push(nativeFeature('derived:controller-full', 'controller-full', loc('AppDetails_Feature_FullController', gdlText('full_controller', 'Full controller support'))));
	} else if (data.controller_support === 'partial' && !features.some(feature => feature.kind === 'controller-partial')) {
		features.push(nativeFeature('derived:controller-partial', 'controller-partial', loc('AppDetails_Feature_PartialController', gdlText('partial_controller', 'Partial controller support'))));
	}
	const developer = steamStringList(data.developers).join(', ') || legacy?.developer
		|| (data.is_delisted === true ? steamStringList(modern?.developers).join(', ') : '') || '';
	const publisher = steamStringList(data.publishers).join(', ') || legacy?.publisher
		|| (data.is_delisted === true ? steamStringList(modern?.publishers).join(', ') : '') || '';
	const genre = legacy?.genre() || (Array.isArray(data.genres) ? data.genres : []).map(item => item.description).filter(Boolean).join(', ');
	const sourceDescription = data.short_description || data.about_the_game || data.detailed_description || '';
	const description = legacy?.description?.()
		|| stripTags(sourceDescription).replace(/\s+/g, ' ').trim()
		|| (developer && genre ? gdlText('legacy_description_developer_genre', '{name} is a {genre} title developed by {developer}.', { name: data.name, genre, developer }) : '')
		|| (developer ? gdlText('legacy_description_developer', '{name} was developed by {developer}.', { name: data.name, developer }) : '');
	return {
		key: steamAppId,
		isLegacy,
		title: data.name || '',
		// Store capsules and headers are horizontal; using either as box art
		// stretches them in the information panel. Only accept a real 2:3 asset.
		portrait: modern?.portrait || '',
		description,
		developer,
		publisher,
		franchise: steamStringList(modern?.franchise).join(', ') || steamStringList(data.franchises).join(', ') || legacy?.franchise || '',
		release: formatNativeRelease(data.release_date?.date || legacy?.steamRelease
			|| (data.is_delisted === true ? modern?.release_date : '') || ''),
		features: uniqueNativeFeatures(features, isLegacy),
		hasCloud,
	};
}
