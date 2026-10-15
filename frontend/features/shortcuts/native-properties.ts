import {
	detectGameCandidatesBackend,
	fetchLocalAchievementsBackend,
	fetchSteamAccountAchievementsBackend,
	getSteamCardFarmingStatusBackend,
	startSteamCardFarmingBackend,
	stopSteamCardFarmingBackend,
	syncSteamAccountAchievementsBackend,
} from '../../api/backend';
import type { LocalAchievementData } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText } from '../../steam/localization';
import { findNativeSteamAppIdByName, SHORTCUT_THRESHOLD } from '../../steam/shortcuts';
import { openAchievementPickerModal } from './achievement-picker-modal';
import { steamSyncFailureMessage } from './achievement-sync-errors';

const GDL_NATIVE_PROP = 'gdl-native-properties-injected';

function parseIpcObject<T>(raw: unknown): T | null {
	try {
		let value: unknown = raw;
		for (let i = 0; i < 3 && typeof value === 'string'; i++) {
			const text = value.trim();
			if (!text) return null;
			value = JSON.parse(text);
		}
		return value && typeof value === 'object' ? value as T : null;
	} catch {
		return null;
	}
}

export async function resolveNativeGameAppId(doc: Document, gameTitle: string): Promise<string | null> {
	// 1. Direct search by name in Steam's loaded app store
	if (gameTitle) {
		const byStore = findNativeSteamAppIdByName(gameTitle);
		if (byStore) return byStore;
	}

	// 2. Check window/document location URLs
	const urls = [
		String(doc.defaultView?.location?.href || ''),
		String(doc.location?.href || ''),
		typeof window !== 'undefined' ? String(window.location?.href || '') : '',
	];
	for (const url of urls) {
		const match = url.match(/(?:properties|app|details)\/(\d+)/i) || url.match(/[?&]appid=(\d+)/i);
		if (match && Number(match[1]) > 0 && Number(match[1]) < SHORTCUT_THRESHOLD) {
			return match[1];
		}
	}

	// 3. Inspect React Fiber props on main container
	try {
		const root = doc.querySelector('.DialogContent') || doc.querySelector('[class*="properties_"]') || doc.body;
		if (root) {
			const keys = Object.keys(root);
			const fiberKey = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
			if (fiberKey) {
				let fiber = (root as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null;
				let depth = 0;
				while (fiber && depth < 30) {
					const props = (fiber.memoizedProps || fiber.pendingProps) as Record<string, unknown> | null;
					if (props) {
						const overview = props.overview as Record<string, unknown> | undefined;
						const candidate = props.appid || props.appId || props.nAppId || overview?.appid;
						if (candidate && Number(candidate) > 0 && Number(candidate) < SHORTCUT_THRESHOLD) {
							return String(candidate);
						}
					}
					fiber = (fiber.return || fiber.parent) as Record<string, unknown> | null;
					depth++;
				}
			}
		}
	} catch {}

	// 4. Query candidates by game title
	if (gameTitle) {
		try {
			const raw = await detectGameCandidatesBackend({
				request_json: JSON.stringify({ game_title: gameTitle }),
			});
			const parsed = parseIpcObject<{ candidates?: Array<{ steam_app_id?: string | number; name?: string }> }>(raw);
			if (parsed?.candidates && parsed.candidates.length > 0) {
				const cleanTitle = gameTitle.toLowerCase().trim();
				const match = parsed.candidates.find(c => (c.name || '').toLowerCase().trim() === cleanTitle) || parsed.candidates[0];
				if (match?.steam_app_id) return String(match.steam_app_id);
			}
		} catch {}
	}

	return null;
}

function formatElapsedMinutes(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	if (mins < 1) return '< 1 min';
	if (mins < 60) return `${mins} min`;
	const hours = Math.floor(mins / 60);
	const remMins = mins % 60;
	return `${hours}h ${remMins}m`;
}

function trophySvg(): string {
	return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" style="flex-shrink:0;"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H8v2h8v-2h-3v-3.1c1.9-.4 3.39-1.93 3.61-3.96 2.47-.31 4.39-2.39 4.39-4.94V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>`;
}

function cardsSvg(): string {
	return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true" style="flex-shrink:0;"><path d="M4 4h10v16H4V4zm2 2v12h6V6H6zm10 2h4v12h-4V8zm2 2v8h0V10z"/></svg>`;
}

export function tryInjectNativePropertiesField(doc: Document, gameTitle: string, container: Element): void {
	if (!doc || !container || container.querySelector(`.${GDL_NATIVE_PROP}`)) return;

	const section = doc.createElement('div');
	section.className = GDL_NATIVE_PROP;
	section.style.cssText = 'padding: 0; margin-top: 24px; font-family: inherit;';

	section.innerHTML = `
		<div style="padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08);">
			<div style="font-size: 13px; font-weight: 500; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
				${escapeHtml(gdlText('native_steam_achievements_title', 'Steam Achievements'))}
			</div>
			<div style="font-size: 13px; color: #8f98a0; line-height: 19px; margin-bottom: 12px;">
				${escapeHtml(gdlText('native_steam_achievements_desc', 'Manage, customize, and sync the official achievements for this game directly with your Steam account.'))}
			</div>
			<div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
				<button class="gdl-native-open-picker-btn DialogButton _DialogButton" type="button" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; height: 32px; background: #3d4450; border: none; border-radius: 2px; color: #dfe3e6; font-size: 13px; font-weight: 400; cursor: pointer; transition: background 0.15s ease, color 0.15s ease;">
					${trophySvg()}
					<span>${escapeHtml(gdlText('native_steam_achievements_manage_btn', 'Manage & sync achievements'))}</span>
				</button>
				<div class="gdl-native-status" style="font-size: 12px; color: #8f98a0;"></div>
			</div>
		</div>

		<div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.08);">
			<div style="font-size: 13px; font-weight: 500; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
				${escapeHtml(gdlText('native_steam_card_farming_title', 'Steam Trading Cards'))}
			</div>
			<div style="font-size: 13px; color: #8f98a0; line-height: 19px; margin-bottom: 12px;">
				${escapeHtml(gdlText('native_steam_card_farming_desc', 'Simulate running the game in the background so Valve drops official trading cards directly into your Steam Inventory.'))}
			</div>
			<div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
				<button class="gdl-native-farm-cards-btn DialogButton _DialogButton" type="button" style="display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; height: 32px; background: #3d4450; border: none; border-radius: 2px; color: #dfe3e6; font-size: 13px; font-weight: 400; cursor: pointer; transition: background 0.15s ease, color 0.15s ease;">
					${cardsSvg()}
					<span>${escapeHtml(gdlText('native_steam_card_farming_start_btn', 'Start card farming'))}</span>
				</button>
				<div class="gdl-native-farm-status" style="font-size: 12px; color: #8f98a0;"></div>
			</div>
		</div>
	`;

	container.appendChild(section);

	const btn = section.querySelector('.gdl-native-open-picker-btn') as HTMLButtonElement;
	const statusEl = section.querySelector('.gdl-native-status') as HTMLElement;
	const farmBtn = section.querySelector('.gdl-native-farm-cards-btn') as HTMLButtonElement;
	const farmStatusEl = section.querySelector('.gdl-native-farm-status') as HTMLElement;

	btn.addEventListener('mouseenter', () => { btn.style.background = '#4c5565'; btn.style.color = '#fff'; });
	btn.addEventListener('mouseleave', () => { btn.style.background = '#3d4450'; btn.style.color = '#dfe3e6'; });

	let isFarming = false;
	let farmingInterval: number | null = null;
	let farmingStartTime = 0;

	const stopFarmingTimer = () => {
		if (farmingInterval !== null) {
			window.clearInterval(farmingInterval);
			farmingInterval = null;
		}
	};

	const startFarmingTimer = () => {
		stopFarmingTimer();
		farmingInterval = window.setInterval(() => {
			if (!section.isConnected) {
				stopFarmingTimer();
				return;
			}
			const curSec = Math.max(0, Math.floor((Date.now() - farmingStartTime) / 1000));
			farmStatusEl.textContent = gdlText('native_steam_card_farming_active_status', '🟢 Farming cards ({elapsed} elapsed)...', {
				elapsed: formatElapsedMinutes(curSec),
			});
		}, 5000);
	};

	const updateFarmingUI = (active: boolean, elapsedSec = 0) => {
		isFarming = active;
		if (active) {
			farmBtn.style.background = '#8a2323';
			farmBtn.style.color = '#fff';
			farmBtn.innerHTML = `${cardsSvg()}<span>${escapeHtml(gdlText('native_steam_card_farming_stop_btn', 'Stop card farming'))}</span>`;
			farmStatusEl.textContent = gdlText('native_steam_card_farming_active_status', '🟢 Farming cards ({elapsed} elapsed)...', {
				elapsed: formatElapsedMinutes(elapsedSec),
			});
			farmStatusEl.style.color = '#59bf40';
		} else {
			stopFarmingTimer();
			farmBtn.style.background = '#3d4450';
			farmBtn.style.color = '#dfe3e6';
			farmBtn.innerHTML = `${cardsSvg()}<span>${escapeHtml(gdlText('native_steam_card_farming_start_btn', 'Start card farming'))}</span>`;
			farmStatusEl.textContent = '';
		}
	};

	farmBtn.addEventListener('mouseenter', () => {
		if (isFarming) {
			farmBtn.style.background = '#a32c2c';
		} else {
			farmBtn.style.background = '#4c5565';
			farmBtn.style.color = '#fff';
		}
	});
	farmBtn.addEventListener('mouseleave', () => {
		if (isFarming) {
			farmBtn.style.background = '#8a2323';
		} else {
			farmBtn.style.background = '#3d4450';
			farmBtn.style.color = '#dfe3e6';
		}
	});

	// Check current farming status
	void (async () => {
		try {
			const resolvedAppId = await resolveNativeGameAppId(doc, gameTitle);
			const raw = await getSteamCardFarmingStatusBackend();
			const status = parseIpcObject<{ ok?: boolean; active?: boolean; steam_app_id?: string; elapsed_seconds?: number; started_at?: number }>(raw);
			if (status?.active && status.steam_app_id === resolvedAppId) {
				farmingStartTime = status.started_at ? status.started_at * 1000 : Date.now() - ((status.elapsed_seconds || 0) * 1000);
				updateFarmingUI(true, status.elapsed_seconds || 0);
				startFarmingTimer();
			}
		} catch {}
	})();

	farmBtn?.addEventListener('click', async () => {
		farmBtn.disabled = true;
		try {
			if (isFarming) {
				await stopSteamCardFarmingBackend();
				updateFarmingUI(false);
				farmStatusEl.textContent = gdlText('native_steam_card_farming_stopped', 'Card farming stopped.');
				farmStatusEl.style.color = '#8f98a0';
			} else {
				const steamAppId = await resolveNativeGameAppId(doc, gameTitle);
				if (!steamAppId) {
					farmStatusEl.textContent = gdlText('no_match_found', 'No reliable match found. Enter AppID manually.');
					farmStatusEl.style.color = '#d6b24c';
					farmBtn.disabled = false;
					return;
				}
				const raw = await startSteamCardFarmingBackend({
					request_json: JSON.stringify({ steam_app_id: steamAppId, game_title: gameTitle }),
				});
				const res = parseIpcObject<{ ok?: boolean; active?: boolean; error?: string }>(raw);
				if (!res || !res.ok) {
					throw new Error(res?.error || 'launch_failed');
				}
				farmingStartTime = Date.now();
				updateFarmingUI(true, 0);
				startFarmingTimer();
			}
		} catch {
			farmStatusEl.textContent = gdlText('native_steam_card_farming_failed', 'Could not start card farming.');
			farmStatusEl.style.color = '#d94126';
		} finally {
			farmBtn.disabled = false;
		}
	});

	btn?.addEventListener('click', async () => {
		btn.disabled = true;
		statusEl.textContent = gdlText('native_steam_achievements_loading', 'Loading Steam achievements...');
		statusEl.style.color = '#8f98a0';

		try {
			const steamAppId = await resolveNativeGameAppId(doc, gameTitle);
			if (!steamAppId) {
				statusEl.textContent = gdlText('no_match_found', 'No reliable match found. Enter AppID manually.');
				statusEl.style.color = '#d6b24c';
				btn.disabled = false;
				return;
			}

			const rawData = await fetchLocalAchievementsBackend({
				request_json: JSON.stringify({ steam_app_id: steamAppId, non_steam_id: steamAppId }),
			});
			const data = parseIpcObject<LocalAchievementData>(rawData);
			if (!data || !Array.isArray(data.achievements) || data.achievements.length === 0) {
				statusEl.textContent = gdlText('native_steam_achievements_no_achievements', 'This game has no achievements on Steam.');
				statusEl.style.color = '#d6b24c';
				btn.disabled = false;
				return;
			}
			// Schema inspection needs no Steam game session. Do not simulate running
			// an uninstalled game just to offer changes its permissions prohibit.
			if (data.achievements.every(item => item.client_writable === false)) {
				statusEl.textContent = steamSyncFailureMessage('achievement_protected');
				statusEl.style.color = '#d6b24c';
				btn.disabled = false;
				return;
			}
			const rawStatus = await fetchSteamAccountAchievementsBackend({ steam_app_id: steamAppId });

			const statusData = parseIpcObject<{ ok?: boolean; appid?: string | number; achievements?: Record<string, { achieved?: boolean }> }>(rawStatus);
			if (statusData?.ok !== true || String(statusData.appid) !== String(steamAppId)
				|| !statusData.achievements || data.achievements.some(item =>
				typeof statusData.achievements![item.name]?.achieved !== 'boolean')) {
				throw new Error('game_stats_not_owned_or_unavailable');
			}
			for (const item of data.achievements) item.earned = statusData.achievements[item.name].achieved!;

			statusEl.textContent = '';
			btn.disabled = false;

			const currentSelected = data.achievements.filter(a => a.earned).map(a => a.name);
			const hasOnlineAchievements = data.achievements.some(a => a.is_online);

			openAchievementPickerModal({
				doc: section.ownerDocument || document,
				gameTitle: gameTitle || steamAppId,
				items: data.achievements,
				initialSelectedNames: currentSelected,
				hasOnlineAchievements,
				titleOverride: gdlText('native_steam_achievements_picker_title', 'Steam achievement selector'),
				descriptionOverride: gdlText('native_steam_achievements_picker_desc', 'Select the achievements to synchronize with your official Steam account. Steam will confirm any saved changes.'),
				onSyncSteam: async (selectedNames) => {
					statusEl.textContent = gdlText('game_achievement_picker_syncing', 'Syncing with Steam servers...');
					statusEl.style.color = '#8f98a0';
					try {
						const selectedSet = new Set(selectedNames);
						const unlockList: string[] = [];
						const lockList: string[] = [];
						for (const item of data.achievements) {
							if (selectedSet.has(item.name)) {
								unlockList.push(item.name);
							} else {
								lockList.push(item.name);
							}
						}
						const rawSync = await syncSteamAccountAchievementsBackend({
							request_json: JSON.stringify({
								steam_app_id: steamAppId,
								unlock: unlockList,
								lock: lockList,
							}),
						});
						const res = parseIpcObject<{ ok?: boolean; noop?: boolean; unlocked_count?: number; locked_count?: number; error?: string }>(rawSync);
						if (!res || !res.ok) {
							throw new Error(res?.error || 'sync_failed');
						}
						statusEl.textContent = res.noop
							? gdlText('game_achievement_picker_sync_no_changes', 'The selection already matches your Steam account. No changes were needed.')
							: gdlText('game_achievement_picker_sync_success', 'Achievements synced successfully with your Steam account.');
						statusEl.style.color = '#66c0f4';
					} catch (err) {
						statusEl.textContent = steamSyncFailureMessage(err instanceof Error ? err.message : undefined);
						statusEl.style.color = '#d94126';
						throw err;
					}
				},
			});
		} catch (err) {
			statusEl.textContent = steamSyncFailureMessage(err instanceof Error ? err.message : undefined);
			statusEl.style.color = '#d94126';
			btn.disabled = false;
		}
	});
}
