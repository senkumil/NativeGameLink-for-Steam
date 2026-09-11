import { callable } from '@steambrew/client';
import type { AchievementBasePathResponse, SteamCommunityItemsCatalog } from '../domain/types';

export const saveMappingBackend   = callable<[{ non_steam_id: string; steam_id: string }], string>('save_mapping');

export const removeMappingBackend = callable<[{ non_steam_id: string }], string>('remove_mapping');

export const updateMappingsBackend = callable<[{ request_json: string }], string>('update_mappings');

export const getAllMappings        = callable<[], string>('get_all_mappings');

export const fetchGameData         = callable<[{ steam_app_id: string; language: string }], string>('fetch_game_data');

export const fetchFriendPersonasBackend = callable<[{ steam_ids_csv: string }], string>('fetch_friend_personas');
export const fetchCommunityActivityBackend = callable<[{ steam_app_id: string; steam_id64?: string }], string>('fetch_community_activity');

export const fetchCommunityContentBackend = callable<[{ steam_app_id: string; language: string }], string>('fetch_community_content');

export const fetchCommunityItemsCatalogBackend = callable<[{ steam_app_id: string; language: string }], string>('fetch_community_items_catalog');

export const feLogBackend         = callable<[{ msg: string }], string>('fe_log');

export const fetchLibraryAssetsBackend = callable<[{ request_json: string }], string>('fetch_library_assets');

export const fetchCommunityArtworkBackend = callable<[{ request_json: string }], string>('fetch_community_artwork');

export const fetchCommunityArtworkCandidatesBackend = callable<[{ request_json: string }], string>('fetch_community_artwork_candidates');

export const validateSteamGridDbApiKeyBackend = callable<[{ request_json: string }], string>('validate_steamgriddb_api_key');

export const saveShortcutIconBackend = callable<[{ request_json: string }], string>('save_shortcut_icon');
export const saveShortcutArtworkBackend = callable<[{ request_json: string }], string>('save_shortcut_artwork');

export const clearArtworkBackend  = callable<[{ shortcut_app_id: string }], string>('clear_artwork');
export const clearArtworkExceptIconBackend = callable<[{ shortcut_app_id: string }], string>('clear_artwork_except_icon');
export const clearArtworkSlotsBackend = callable<[{ request_json: string }], string>('clear_artwork_slots');
export const clearAllLinkedArtworksBackend = callable<[], string>('clear_all_linked_artworks');

export const detectGameCandidatesBackend = callable<[{ request_json: string }], string>('detect_game_candidates');
export const detectGameCandidatesLocalBackend = callable<[{ request_json: string }], string>('detect_game_candidates_local');

export const getShortcutDetailsBackend = callable<[{ shortcut_app_id: string; title?: string }], string>('get_shortcut_details');
export const listShortcutsBackend = callable<[], string>('list_shortcuts');
export const fetchArtworkImageBackend = callable<[{ request_json: string }], string>('fetch_artwork_image');
export const readLocalArtworkImageBackend = callable<[{ request_json: string }], string>('read_local_artwork_image');

export const getAchievementBasePathBackend = callable<[], string>('get_achievement_base_path');

export const setAchievementBasePathBackend = callable<[{ path: string }], string>('set_achievement_base_path');

export const getGameAchievementPathBackend = callable<[{ request_json: string }], string>('get_game_achievement_path');

export const setGameAchievementPathBackend = callable<[{ request_json: string }], string>('set_game_achievement_path');

export const getGameAchievementOptionsBackend = callable<[{ request_json: string }], string>('get_game_achievement_options');

export const setGameAchievementOptionsBackend = callable<[{ request_json: string }], string>('set_game_achievement_options');

export const getGameAchievementCapabilitiesBackend = callable<[{ request_json: string }], string>('get_game_achievement_capabilities');

export const exportAchievementsJsonBackend = callable<[{ request_json: string }], string>('export_achievements_json');

const recentBackendLogs = new Map<string, number>();
const BACKEND_LOG_DEDUP_MS = 5000;

export function backendLog(msg: string): void {
	const normalized = String(msg);
	const now = Date.now();
	const previous = recentBackendLogs.get(normalized) || 0;
	if (now - previous < BACKEND_LOG_DEDUP_MS) return;
	recentBackendLogs.delete(normalized);
	recentBackendLogs.set(normalized, now);
	while (recentBackendLogs.size > 64) {
		const oldest = recentBackendLogs.keys().next().value as string | undefined;
		if (!oldest) break;
		recentBackendLogs.delete(oldest);
	}
	console.log('[GDL]', msg);
	feLogBackend({ msg: normalized }).catch(() => {});
}

export function backendResultStatus(raw: unknown): string {
	if (raw === true) return 'ok';
	if (raw == null) return '';
	let value: any = raw;
	for (let i = 0; i < 2 && typeof value === 'string'; i++) {
		const text = value.trim();
		if (!text) return '';
		try {
			const parsed = JSON.parse(text);
			value = parsed;
			continue;
		} catch {
			return text.replace(/^"|"$/g, '').toLowerCase();
		}
	}
	if (value === true) return 'ok';
	if (typeof value === 'string') return value.trim().replace(/^"|"$/g, '').toLowerCase();
	if (value && typeof value === 'object') {
		if (value.ok === true || value.success === true) return 'ok';
		if (typeof value.status === 'string') return value.status.toLowerCase();
		if (typeof value.result === 'string') return value.result.toLowerCase();
	}
	return '';
}

export function parseMappingsResponse(raw: unknown): Record<string, string> | null {
	try {
		const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return value && typeof value === 'object' ? value as Record<string, string> : null;
	} catch { return null; }
}

export function parseAchievementBasePathResponse(raw: unknown): AchievementBasePathResponse | null {
	try {
		let value: unknown = raw;
		for (let i = 0; i < 3 && typeof value === 'string'; i++) {
			const text = value.trim();
			if (!text) return null;
			value = JSON.parse(text);
		}
		return value && typeof value === 'object' ? value as AchievementBasePathResponse : null;
	} catch { return null; }
}

export function parseCommunityItemsCatalogResponse(raw: unknown): SteamCommunityItemsCatalog | null {
	try {
		let value: unknown = raw;
		for (let i = 0; i < 3 && typeof value === 'string'; i++) {
			const text = value.trim();
			if (!text) return null;
			value = JSON.parse(text);
		}
		return value && typeof value === 'object' ? value as SteamCommunityItemsCatalog : null;
	} catch { return null; }
}

export const fetchNewsBackend = callable<[{ steam_app_id: string; language: string }], string>('fetch_news');
export const fetchPartnerEventsBackend = callable<[{ steam_app_id: string; language: string }], string>('fetch_partner_events');

export const fetchPublishedPreviewsBackend = callable<[{ file_ids_csv: string }], string>('fetch_published_file_previews');

export const fetchFriendReviewBackend = callable<[{ steam_id64: string; steam_app_id: string }], string>('fetch_friend_review');

export const fetchLocalAchievementsBackend = callable<[{ request_json: string }], string>('fetch_local_achievement_data');

export const startPlaytimeSessionBackend = callable<[{ request_json: string }], string>('start_playtime_session');

export const pingPlaytimeSessionBackend = callable<[{ request_json: string }], string>('ping_playtime_session');

export const stopPlaytimeSessionBackend = callable<[{ request_json: string }], string>('stop_playtime_session');

export const getPlaytimeDataBackend = callable<[{ request_json: string }], string>('get_playtime_data');

export const getAllPlaytimeDataBackend = callable<[{ request_json: string }], string>('get_all_playtime_data');

export const setPlaytimeDataBackend = callable<[{ request_json: string }], string>('set_playtime_data');

export const fetchSteamAccountAchievementsBackend = callable<[{ steam_app_id: string }], string>('fetch_steam_account_achievements');

export const syncSteamAccountAchievementsBackend = callable<[{ request_json: string }], string>('sync_steam_account_achievements');

export const startSteamCardFarmingBackend = callable<[{ request_json: string }], string>('start_steam_card_farming');

export const stopSteamCardFarmingBackend = callable<[], string>('stop_steam_card_farming');

export const getSteamCardFarmingStatusBackend = callable<[], string>('get_steam_card_farming_status');

export const neutralizeSteamAppIdFileBackend = callable<[{ request_json: string }], string>('neutralize_steam_appid_file');

export const restoreSteamAppIdFileBackend = callable<[{ request_json: string }], string>('restore_steam_appid_file');

export const suppressAdminPromptBackend = callable<[{ exe_path: string }], boolean>('suppress_admin_prompt');

export const factoryResetBackend = callable<[{ request_json: string }], string>('factory_reset');

export const readCustomLogoPositionBackend = callable<[{ shortcut_app_id: string }], string>('read_custom_logo_position');
export const saveCustomLogoPositionBackend = callable<[{ request_json: string }], string>('save_custom_logo_position');
export const readLogoLayoutImagesBackend = callable<[{ shortcut_app_id: string }], string>('read_logo_layout_images');
