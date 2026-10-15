import { gdlText } from '../../steam/localization';

export function steamSyncFailureMessage(error?: unknown): string {
	const code = typeof error === 'string' ? error
		: error && typeof (error as Error).message === 'string' ? (error as Error).message : 'sync_failed';
	if (code === 'achievement_protected') return gdlText('game_achievement_sync_protected',
		'Steam protects these achievements and does not allow changes from the client. They must be earned in the game.');
	if (code === 'achievement_update_failed') return gdlText('game_achievement_sync_rejected',
		'Steam rejected one or more achievement changes. The rejected achievements were not synchronized.');
	if (code === 'store_stats_not_confirmed') return gdlText('game_achievement_sync_unconfirmed',
		'Steam did not confirm that the changes were saved. Reload the achievement list before trying again.');
	const detail = ({
		steam_not_running: 'Steam is not running.',
		steam_user_not_logged_in: 'No Steam user is logged in.',
		steam_client_dll_not_found: 'Steam client files were not found.',
		steam_userstats_unavailable: 'Steam User Stats is unavailable.',
		request_current_stats_failed: 'Steam rejected the stats request for this AppID.',
		game_stats_not_owned_or_unavailable: 'Steam could not load stats for this game. Verify that this account owns the exact AppID.',
		helper_not_found: 'The NativeGameLink Steam sync helper is missing.',
		empty_output: 'The NativeGameLink Steam sync helper returned no result.',
	} as Record<string, string>)[code] || code;
	return `${gdlText('game_achievement_picker_sync_failed', 'Failed to sync achievements with your Steam account (ensure the game is owned and Steam is running).')} ${detail}`;
}
