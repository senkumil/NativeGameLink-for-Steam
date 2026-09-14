import {
	getGameAchievementOptionsBackend,
	getGameAchievementCapabilitiesBackend,
	getGameAchievementPathBackend,
	fetchLocalAchievementsBackend,
	setGameAchievementOptionsBackend,
	setGameAchievementPathBackend,
	exportAchievementsJsonBackend,
	syncSteamAccountAchievementsBackend,
} from '../../api/backend';
import type { LocalAchievementData } from '../../domain/types';
import { getCachedGameData } from '../../core/game-data';
import { getPreferences } from '../../core/preferences';
import { escapeHtml } from '../../core/text';
import {
	broadcastOptimisticAchievementUpdate,
	cacheLocalAchievements,
	ensureLocalPlaybarStat,
	getCachedLocalAchievementsForGame,
	refreshLocalAchievementUI,
	resetLocalAchievementToastBaseline,
	setNextLaunchAchievementReplayEnabled,
	syncNativeAchievementProgressCache,
} from '../achievements/runtime';
import { gdlText, steamLanguageSync } from '../../steam/localization';
import { openAchievementPickerModal } from './achievement-picker-modal';

const achievementOptionsMemoryCache = new Map<string, GameAchievementOptions>();
const achievementPathMemoryCache = new Map<string, { configured?: boolean; path?: string; usable?: boolean }>();
const achievementCapabilitiesMemoryCache = new Map<string, GameAchievementCapabilities & { total?: number }>();

const STORAGE_ACH_OPTIONS = 'gdl:ach_options_v1:';
const STORAGE_ACH_CAPS = 'gdl:ach_caps_v1:';
const STORAGE_ACH_PATH = 'gdl:ach_path_v1:';

/** Clear in-memory achievement settings snapshots. Factory Reset already clears
 * localStorage/backend files; these Maps must be cleared too or the Properties
 * slider can resurrect stale simulated progress until the user touches it. */
export function clearShortcutAchievementSettingsCaches(): void {
	achievementOptionsMemoryCache.clear();
	achievementPathMemoryCache.clear();
	achievementCapabilitiesMemoryCache.clear();
}

function getStoredOptions(appId: string): GameAchievementOptions | null {
	if (!appId) return null;
	const mem = achievementOptionsMemoryCache.get(appId);
	if (mem) return mem;
	try {
		const raw = localStorage.getItem(STORAGE_ACH_OPTIONS + appId);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				achievementOptionsMemoryCache.set(appId, parsed);
				return parsed;
			}
		}
	} catch {}
	return null;
}

function storeOptions(appId: string, value: GameAchievementOptions): void {
	if (!appId) return;
	achievementOptionsMemoryCache.set(appId, value);
	try {
		localStorage.setItem(STORAGE_ACH_OPTIONS + appId, JSON.stringify(value));
	} catch {}
}

function getStoredCaps(appId: string): (GameAchievementCapabilities & { total?: number }) | null {
	if (!appId) return null;
	const mem = achievementCapabilitiesMemoryCache.get(appId);
	if (mem) return mem;
	try {
		const raw = localStorage.getItem(STORAGE_ACH_CAPS + appId);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				achievementCapabilitiesMemoryCache.set(appId, parsed);
				return parsed;
			}
		}
	} catch {}
	return null;
}

function storeCaps(appId: string, value: GameAchievementCapabilities & { total?: number }): void {
	if (!appId) return;
	achievementCapabilitiesMemoryCache.set(appId, value);
	try {
		localStorage.setItem(STORAGE_ACH_CAPS + appId, JSON.stringify(value));
	} catch {}
}

function getStoredPath(appId: string): { configured?: boolean; path?: string; usable?: boolean } | null {
	if (!appId) return null;
	const mem = achievementPathMemoryCache.get(appId);
	if (mem) return mem;
	try {
		const raw = localStorage.getItem(STORAGE_ACH_PATH + appId);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') {
				achievementPathMemoryCache.set(appId, parsed);
				return parsed;
			}
		}
	} catch {}
	return null;
}

function storePath(appId: string, value: { configured?: boolean; path?: string; usable?: boolean }): void {
	if (!appId) return;
	achievementPathMemoryCache.set(appId, value);
	try {
		localStorage.setItem(STORAGE_ACH_PATH + appId, JSON.stringify(value));
	} catch {}
}

export interface ShortcutAchievementSettingsContext {
	section: HTMLElement;
	shortcutAppId: () => string;
	steamAppId: () => string;
	gameTitle?: () => string;
}

interface GameAchievementOptions {
	ok?: boolean;
	configured?: boolean;
	simulate?: boolean;
	simulate_count?: number;
	simulate_online_count?: number;
	simulate_percent?: number;
	simulate_online_percent?: number;
	unlock_online?: boolean;
	unlocked_names?: string[];
	zero_progress?: boolean;
	error?: string;
}

interface GameAchievementCapabilities {
	ok?: boolean;
	has_online?: boolean;
	online_count?: number;
}

function parseIpcObject<T extends object>(raw: unknown): T | null {
	if (raw && typeof raw === 'object') return raw as T;
	if (typeof raw !== 'string' || !raw.trim()) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null;
	} catch { return null; }
}

export function shortcutAchievementSettingsHtml(): string {
	return `<div class="gdl-game-achievement-source gdl-native-section">
		<div class="gdl-native-section-heading">${escapeHtml(gdlText('game_achievement_options_title', 'Achievement progress options'))}</div>
		<div class="gdl-native-section-description">${escapeHtml(gdlText('game_simulated_achievements_description', 'Show progress using the real Steam names and icons.'))}</div>
		<div class="gdl-game-achievement-options">
			<div class="gdl-game-achievement-slider-row gdl-native-setting-row gdl-achievement-setting-row">
				<div class="gdl-native-setting-copy">
					<div class="gdl-game-achievement-slider-title gdl-native-setting-title">${escapeHtml(gdlText('game_simulate_count_title', 'Simulated achievements'))}</div>
					<div class="gdl-game-achievement-slider-desc gdl-native-setting-description">${escapeHtml(gdlText('game_simulate_count_desc', 'Select how many achievements to simulate for this game (0 for real achievements).'))}</div>
				</div>
				<div class="gdl-achievement-control">
					<div class="gdl-game-achievement-count-display gdl-game-achievement-percent-display gdl-achievement-count">0 logros</div>
					<input type="range" class="gdl-game-achievement-slider gdl-game-achievement-count-slider gdl-game-achievement-percent-slider" min="0" max="0" step="1" value="0" />
				</div>
			</div>
			<div class="gdl-game-achievement-online-row gdl-native-setting-row gdl-achievement-setting-row" style="display:none;">
				<div class="gdl-native-setting-copy">
					<div class="gdl-game-achievement-online-title gdl-native-setting-title">${escapeHtml(gdlText('game_simulate_online_count_title', 'Simulated online achievements'))}</div>
					<div class="gdl-game-achievement-online-desc gdl-native-setting-description">${escapeHtml(gdlText('game_simulate_online_count_desc', 'Select how many online achievements to simulate for this game.'))}</div>
				</div>
				<div class="gdl-achievement-control">
					<div class="gdl-game-achievement-online-count-display gdl-game-achievement-online-percent-display gdl-achievement-count">0 logros online</div>
					<input type="range" class="gdl-game-achievement-slider gdl-game-achievement-online-count-slider gdl-game-achievement-online-percent-slider" min="0" max="0" step="1" value="0" />
				</div>
			</div>
		</div>
		<div class="gdl-achievement-actions">
			<button class="gdl-game-achievement-picker-btn gdl-native-button" type="button"><span aria-hidden="true">★</span> ${escapeHtml(gdlText('game_achievement_picker_btn', 'Customize achievements individually'))}</button>
			<button class="gdl-game-achievement-reset gdl-native-button" type="button">${escapeHtml(gdlText('game_achievement_options_use_real', 'Use real achievements'))}</button>
			<span class="gdl-game-achievement-options-status gdl-native-status" aria-live="polite"></span>
		</div>
		<details class="gdl-achievement-path-disclosure gdl-native-disclosure">
			<summary>
				<span>${escapeHtml(gdlText('game_achievement_path_title', 'Achievement progress file'))}</span>
				<span class="gdl-native-disclosure-chevron" aria-hidden="true">⌄</span>
			</summary>
			<div class="gdl-native-disclosure-body">
				<div class="gdl-native-setting-description" style="margin:0 0 10px;">${escapeHtml(gdlText('game_achievement_path_description', 'Optional. Paste this game\'s achievements JSON file, or a folder that contains achievements.json. This source is checked before the global AppID folders.'))}</div>
				<div class="gdl-achievement-path-controls">
					<input class="gdl-game-achievement-path-input gdl-native-input" type="text" placeholder="${escapeHtml(gdlText('game_achievement_path_placeholder', 'Example: D:\\Game\\achievements.json'))}" />
					<button class="gdl-game-achievement-path-save gdl-native-button gdl-native-button-primary" type="button">${escapeHtml(gdlText('game_achievement_path_save', 'Save path'))}</button>
					<button class="gdl-game-achievement-path-clear gdl-native-button" type="button">${escapeHtml(gdlText('game_achievement_path_clear', 'Use automatic'))}</button>
				</div>
				<div class="gdl-game-achievement-path-status gdl-native-status" aria-live="polite"></div>
				<div class="gdl-achievement-hint">${escapeHtml(gdlText('game_achievement_real_priority_hint', 'When using real achievements, this game\'s custom path is checked first, followed by the plugin\'s automatic folders.'))}</div>
			</div>
		</details>
	</div>`;
}

export function bindShortcutAchievementSettings(context: ShortcutAchievementSettingsContext): { sync: (appId?: string) => void } {
	const { section } = context;
	const achievementSection = section.querySelector<HTMLElement>('.gdl-game-achievement-source');
	const pathInput = section.querySelector<HTMLInputElement>('.gdl-game-achievement-path-input');
	const pathSave = section.querySelector<HTMLButtonElement>('.gdl-game-achievement-path-save');
	const pathClear = section.querySelector<HTMLButtonElement>('.gdl-game-achievement-path-clear');
	const pathStatus = section.querySelector<HTMLElement>('.gdl-game-achievement-path-status');
	const pathDisclosure = section.querySelector<HTMLDetailsElement>('.gdl-achievement-path-disclosure');
	const sliderTitle = section.querySelector<HTMLElement>('.gdl-game-achievement-slider-title');
	const sliderDesc = section.querySelector<HTMLElement>('.gdl-game-achievement-slider-desc');
	const countSlider = section.querySelector<HTMLInputElement>('.gdl-game-achievement-count-slider');
	const countDisplay = section.querySelector<HTMLElement>('.gdl-game-achievement-count-display');
	const onlineRow = section.querySelector<HTMLElement>('.gdl-game-achievement-online-row');
	const onlineCountSlider = section.querySelector<HTMLInputElement>('.gdl-game-achievement-online-count-slider');
	const onlineCountDisplay = section.querySelector<HTMLElement>('.gdl-game-achievement-online-count-display');
	const pickerBtn = section.querySelector<HTMLButtonElement>('.gdl-game-achievement-picker-btn');
	const resetButton = section.querySelector<HTMLButtonElement>('.gdl-game-achievement-reset');
	const optionsStatus = section.querySelector<HTMLElement>('.gdl-game-achievement-options-status');
	if (!achievementSection || !pathInput || !pathSave || !pathClear || !pathStatus || !optionsStatus) {
		return { sync: () => {} };
	}

	let options: Required<Pick<GameAchievementOptions, 'configured' | 'simulate' | 'simulate_count' | 'simulate_online_count' | 'simulate_percent' | 'simulate_online_percent' | 'unlock_online'>> & { unlocked_names?: string[] } = {
		configured: false, simulate: false, simulate_count: 0, simulate_online_count: 0, simulate_percent: 0, simulate_online_percent: 0, unlock_online: false, unlocked_names: undefined,
	};
	let loading = false;
	let saving = false;
	let hasOnlineAchievements = false;
	let capabilitiesLoaded = false;
	let capabilitiesConfirmed = false;
	let customPathConfigured = false;
	let totalAchievements = 0;
	let onlineAchievementsCount = 0;
	let offlineAchievementsCount = 0;
	let isSlidingOffline = false;
	let isSlidingOnline = false;
	let lastLoadedOptions: GameAchievementOptions | null = null;
	const replayIdentity = (): [string, string] => [context.steamAppId(), context.shortcutAppId() || context.steamAppId()];

	const updateSectionVisibility = (): void => {
		const targetAppId = context.steamAppId();
		if (!targetAppId || !/^\d+$/.test(targetAppId)) {
			achievementSection.style.display = 'none';
			return;
		}
		const hasCustomSimulation = options.simulate && (
			options.simulate_count > 0
			|| options.simulate_online_count > 0
			|| Boolean(options.unlocked_names?.length)
		);
		const hasAchievements = !capabilitiesConfirmed || totalAchievements > 0 || customPathConfigured || hasCustomSimulation;
		achievementSection.style.display = hasAchievements ? 'block' : 'none';
	};

	const request = (extra: Record<string, unknown> = {}): string => {
		const global = getPreferences();
		return JSON.stringify({
			shortcut_app_id: context.shortcutAppId(),
			steam_app_id: context.steamAppId(),
			global_simulate: global.simulateAchievements,
			global_simulate_percent: 0,
			global_simulate_online_percent: global.unlockOnlineAchievements ? 100 : 0,
			global_unlock_online: global.unlockOnlineAchievements,
			language: steamLanguageSync() || 'english',
			...extra,
		});
	};
	const refreshCurrentGame = (): void => {
		refreshLocalAchievementUI({
			steamAppId: context.steamAppId(),
			stateAppId: context.shortcutAppId() || context.steamAppId(),
		});
	};

	const formatCountText = (count: number): string => {
		if (capabilitiesLoaded && offlineAchievementsCount > 0) {
			const clamped = Math.max(0, Math.min(offlineAchievementsCount, count));
			if (hasOnlineAchievements) {
				return `${clamped} / ${offlineAchievementsCount} logros offline`;
			}
			return `${clamped} / ${offlineAchievementsCount} logros`;
		}
		return `${count} logros`;
	};

	const formatOnlineCountText = (count: number): string => {
		if (capabilitiesLoaded && onlineAchievementsCount > 0) {
			const clamped = Math.max(0, Math.min(onlineAchievementsCount, count));
			return `${clamped} / ${onlineAchievementsCount} logros online`;
		}
		return `${count} logros online`;
	};

	const updateSliderFill = (slider: HTMLInputElement | null): void => {
		if (!slider) return;
		const min = Number(slider.min) || 0;
		const max = Number(slider.max) || 100;
		const val = Number(slider.value) || 0;
		if (max <= min || val <= min) {
			slider.style.background = '#1e2837';
			return;
		}
		if (val >= max) {
			slider.style.background = '#1a9fff';
			return;
		}
		const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
		slider.style.background = `linear-gradient(to right, #1a9fff 0%, #1a9fff ${pct}%, #1e2837 ${pct}%, #1e2837 100%) no-repeat`;
	};

	const render = (): void => {
		const activeEl = section.ownerDocument?.activeElement;
		if (sliderTitle) {
			sliderTitle.textContent = hasOnlineAchievements
				? gdlText('game_simulate_count_offline_title', 'Simulated offline achievements')
				: gdlText('game_simulate_count_title', 'Simulated achievements');
		}
		if (sliderDesc) {
			sliderDesc.textContent = hasOnlineAchievements
				? gdlText('game_simulate_count_offline_desc', 'Select how many offline achievements to simulate for this game (online achievements are controlled separately).')
				: gdlText('game_simulate_count_desc', 'Select how many achievements to simulate for this game (0 for real achievements).');
		}
		if (countSlider) {
			countSlider.max = String(offlineAchievementsCount || 100);
			if (activeEl !== countSlider && !isSlidingOffline) {
				countSlider.value = String(options.simulate_count);
			}
			countSlider.disabled = loading;
			updateSliderFill(countSlider);
		}
		if (countDisplay) {
			countDisplay.textContent = formatCountText(options.simulate_count);
		}
		if (onlineRow) onlineRow.style.display = hasOnlineAchievements ? 'flex' : 'none';
		if (onlineCountSlider) {
			onlineCountSlider.max = String(onlineAchievementsCount || 100);
			if (activeEl !== onlineCountSlider && !isSlidingOnline) {
				onlineCountSlider.value = String(options.simulate_online_count);
			}
			onlineCountSlider.disabled = loading;
			updateSliderFill(onlineCountSlider);
		}
		if (onlineCountDisplay) {
			onlineCountDisplay.textContent = formatOnlineCountText(options.simulate_online_count);
		}
		if (pickerBtn) pickerBtn.disabled = loading;
		for (const control of [pathInput, pathSave, pathClear]) {
			control.disabled = loading || options.simulate;
			control.style.opacity = loading || options.simulate ? '.45' : '1';
		}
		if (resetButton) resetButton.disabled = loading;
		optionsStatus.textContent = '';
		if (options.simulate) {
			optionsStatus.style.color = '#66c0f4';
			optionsStatus.textContent = gdlText('game_achievement_options_local', 'Using saved simulation options for this game.');
			pathStatus.textContent = gdlText('game_achievement_path_simulation_blocked', 'Simulated achievements are active; a custom progress path cannot be used at the same time.');
			pathStatus.style.color = '#8f98a0';
		} else {
			if (pathInput.value.trim()) {
				optionsStatus.style.color = '#66c0f4';
				optionsStatus.textContent = gdlText('game_achievement_options_real_per_game', 'Using custom achievement path for this game.');
			} else {
				optionsStatus.style.color = '#8f98a0';
				optionsStatus.textContent = gdlText('game_achievement_options_real_global', 'Using real achievements from the plugin automatic folders.');
				pathStatus.textContent = gdlText('game_achievement_path_automatic', 'Using automatic AppID folders from the global plugin setting.');
				pathStatus.style.color = '#8f98a0';
			}
		}
	};

	const applyOptions = (value: GameAchievementOptions): void => {
		lastLoadedOptions = value;
		let count = typeof value.simulate_count === 'number' ? Math.max(0, value.simulate_count) : null;
		let onlineCount = typeof value.simulate_online_count === 'number' ? Math.max(0, value.simulate_online_count) : null;
		if (count === null && typeof value.simulate_percent === 'number' && offlineAchievementsCount > 0) {
			count = Math.round(offlineAchievementsCount * (value.simulate_percent / 100));
		}
		if (onlineCount === null && typeof value.simulate_online_percent === 'number' && onlineAchievementsCount > 0) {
			onlineCount = Math.round(onlineAchievementsCount * (value.simulate_online_percent / 100));
		}
		const hasNames = Array.isArray(value.unlocked_names) && value.unlocked_names.length > 0;
		const isSimulate = value.simulate === true || (count !== null && count > 0) || (onlineCount !== null && onlineCount > 0) || hasNames;
		options = {
			configured: value.configured === true,
			simulate: isSimulate,
			simulate_count: isSimulate ? (count ?? 0) : 0,
			simulate_online_count: isSimulate ? (onlineCount ?? 0) : 0,
			simulate_percent: typeof value.simulate_percent === 'number' ? value.simulate_percent : 0,
			simulate_online_percent: typeof value.simulate_online_percent === 'number' ? value.simulate_online_percent : 0,
			unlock_online: (onlineCount ?? 0) > 0 || value.unlock_online === true,
			unlocked_names: Array.isArray(value.unlocked_names) ? value.unlocked_names : undefined,
		};
		render();
	};

	const optimisticSyncAchievements = (offlineCount: number, onlineCount: number): void => {
		const targetSteamAppId = context.steamAppId();
		if (!targetSteamAppId || !/^\d+$/.test(targetSteamAppId)) return;
		const targetShortcutAppId = context.shortcutAppId() || targetSteamAppId;
		const totalUnlocked = Math.max(0, offlineCount) + Math.max(0, onlineCount);
		const base = getCachedLocalAchievementsForGame(targetSteamAppId, targetShortcutAppId);
		const total = base?.total || totalAchievements || (offlineAchievementsCount + onlineAchievementsCount) || 1;

		let offEarned = 0;
		let onEarned = 0;
		const items = (base?.achievements && base.achievements.length > 0)
			? base.achievements.map(item => {
				const isOnline = Boolean(item.is_online);
				let earned = false;
				if (isOnline) {
					earned = onEarned < onlineCount;
					if (earned) onEarned++;
				} else {
					earned = offEarned < offlineCount;
					if (earned) offEarned++;
				}
				return { ...item, earned };
			})
			: [];

		const nextData: LocalAchievementData = {
			...(base || {}),
			found: true,
			appid: targetSteamAppId,
			state_appid: targetShortcutAppId || undefined,
			simulation_enabled: totalUnlocked > 0,
			simulate_count: offlineCount,
			simulate_online_count: onlineCount,
			unlocked: Math.min(total, totalUnlocked),
			total,
			achievements: items.length > 0 ? items : (base?.achievements || []),
		};

		cacheLocalAchievements(nextData, targetSteamAppId, targetShortcutAppId);
		syncNativeAchievementProgressCache(targetSteamAppId, nextData.unlocked, nextData.total, section.ownerDocument);
		if (targetShortcutAppId && targetShortcutAppId !== targetSteamAppId) {
			syncNativeAchievementProgressCache(targetShortcutAppId, nextData.unlocked, nextData.total, section.ownerDocument);
		}
		broadcastOptimisticAchievementUpdate({
			steamAppId: targetSteamAppId,
			stateAppId: targetShortcutAppId,
			data: nextData,
		});

		const targetDocs = new Set<Document>();
		if (section.ownerDocument) targetDocs.add(section.ownerDocument);
		try { if (window.top?.document) targetDocs.add(window.top.document); } catch {}
		try { if (window.opener?.document) targetDocs.add(window.opener.document); } catch {}
		for (const doc of targetDocs) {
			ensureLocalPlaybarStat(doc, nextData);
		}
	};

	let pendingSave: { next: Partial<typeof options>; reset: boolean } | null = null;
	let debounceSaveTimer: number | null = null;

	const queueSaveOptions = (next: Partial<typeof options>, delayMs = 0, reset = false): void => {
		if (debounceSaveTimer !== null) {
			window.clearTimeout(debounceSaveTimer);
			debounceSaveTimer = null;
		}
		if (delayMs > 0) {
			debounceSaveTimer = window.setTimeout(() => {
				debounceSaveTimer = null;
				void executeSave(next, reset);
			}, delayMs);
		} else {
			void executeSave(next, reset);
		}
	};

	const executeSave = async (next: Partial<typeof options>, reset = false): Promise<void> => {
		if (saving) {
			pendingSave = { next, reset };
			return;
		}
		await saveOptions(next, reset);
		if (pendingSave) {
			const queued = pendingSave;
			pendingSave = null;
			void executeSave(queued.next, queued.reset);
		}
	};

	const saveOptions = async (next: Partial<typeof options>, reset = false): Promise<void> => {
		if (loading || saving) return;
		const candidate = { ...options, ...next };
		const hasNames = Array.isArray(candidate.unlocked_names) && candidate.unlocked_names.length > 0;
		const isSimulate = candidate.simulate !== false && ((candidate.simulate_count ?? 0) > 0 || (candidate.simulate_online_count ?? 0) > 0 || candidate.simulate === true || hasNames);
		candidate.simulate = isSimulate;
		if (!isSimulate) {
			candidate.simulate_count = 0;
			candidate.simulate_online_count = 0;
			candidate.unlocked_names = undefined;
		}
		const pct = offlineAchievementsCount > 0 && typeof candidate.simulate_count === 'number'
			? Math.round((candidate.simulate_count / offlineAchievementsCount) * 100)
			: candidate.simulate_percent;
		const onlinePct = onlineAchievementsCount > 0 && typeof candidate.simulate_online_count === 'number'
			? Math.round((candidate.simulate_online_count / onlineAchievementsCount) * 100)
			: candidate.simulate_online_percent;
		saving = true;
		try {
			const raw = await setGameAchievementOptionsBackend({ request_json: request({
				reset,
				simulate: candidate.simulate,
				simulate_count: candidate.simulate_count,
				simulate_online_count: candidate.simulate_online_count,
				simulate_percent: pct,
				simulate_online_percent: onlinePct,
				unlock_online: (candidate.simulate_online_count ?? 0) > 0,
				unlocked_names: candidate.unlocked_names,
			}) });
			const result = parseIpcObject<GameAchievementOptions>(raw) || {};
			if (!result.ok) throw new Error(result.error || 'save_failed');
			const targetAppId = context.steamAppId();
			if (targetAppId) storeOptions(targetAppId, result);
			saving = false;
			const previousSimulate = options.simulate;
			const previousCount = options.simulate_count;
			const previousOnlineCount = options.simulate_online_count;
			applyOptions(result);
			optionsStatus.textContent = '';
			if (options.simulate) pathInput.value = '';
			if ((options.simulate && !previousSimulate)
				|| (options.simulate && options.simulate_count !== previousCount)
				|| (options.simulate && options.simulate_online_count !== previousOnlineCount)) {
				const [sAppId, scAppId] = replayIdentity();
				setNextLaunchAchievementReplayEnabled(sAppId, scAppId, true);
				resetLocalAchievementToastBaseline(sAppId, scAppId);
			}
			refreshCurrentGame();
		} catch {
			saving = false;
			render();
			optionsStatus.textContent = gdlText('game_achievement_options_failed', 'Achievement options could not be saved.');
			optionsStatus.style.color = '#d94126';
		} finally {
			saving = false;
		}
	};

	countSlider?.addEventListener('pointerdown', () => { isSlidingOffline = true; });
	countSlider?.addEventListener('pointerup', () => { isSlidingOffline = false; });
	countSlider?.addEventListener('input', () => {
		const val = Number(countSlider.value);
		options.simulate_count = val;
		if (countDisplay) {
			countDisplay.textContent = formatCountText(val);
		}
		updateSliderFill(countSlider);
		optimisticSyncAchievements(val, options.simulate_online_count);
		queueSaveOptions({ simulate_count: val, simulate: val > 0 || options.simulate_online_count > 0, unlocked_names: undefined }, 250);
	});
	countSlider?.addEventListener('change', () => {
		isSlidingOffline = false;
		const val = Number(countSlider.value);
		updateSliderFill(countSlider);
		optimisticSyncAchievements(val, options.simulate_online_count);
		queueSaveOptions({ simulate_count: val, simulate: val > 0 || options.simulate_online_count > 0, unlocked_names: undefined }, 0);
	});
	onlineCountSlider?.addEventListener('pointerdown', () => { isSlidingOnline = true; });
	onlineCountSlider?.addEventListener('pointerup', () => { isSlidingOnline = false; });
	onlineCountSlider?.addEventListener('input', () => {
		const val = Number(onlineCountSlider.value);
		options.simulate_online_count = val;
		if (onlineCountDisplay) {
			onlineCountDisplay.textContent = formatOnlineCountText(val);
		}
		updateSliderFill(onlineCountSlider);
		optimisticSyncAchievements(options.simulate_count, val);
		queueSaveOptions({ simulate_online_count: val, simulate: val > 0 || options.simulate_count > 0, unlock_online: val > 0, unlocked_names: undefined }, 250);
	});
	onlineCountSlider?.addEventListener('change', () => {
		isSlidingOnline = false;
		const val = Number(onlineCountSlider.value);
		updateSliderFill(onlineCountSlider);
		optimisticSyncAchievements(options.simulate_count, val);
		queueSaveOptions({ simulate_online_count: val, simulate: val > 0 || options.simulate_count > 0, unlock_online: val > 0, unlocked_names: undefined }, 0);
	});
	pickerBtn?.addEventListener('click', async () => {
		if (loading || saving) return;
		try {
			const rawData = await fetchLocalAchievementsBackend({ request_json: request() });
			const data = parseIpcObject<LocalAchievementData>(rawData);
			if (!data || !Array.isArray(data.achievements) || data.achievements.length === 0) {
				optionsStatus.textContent = gdlText('game_achievement_picker_no_results', 'No matching achievements found.');
				optionsStatus.style.color = '#d6b24c';
				return;
			}
			optionsStatus.textContent = '';
			const currentSelected = options.unlocked_names || data.achievements.filter(a => a.earned).map(a => a.name);
			const title = (context.gameTitle ? context.gameTitle() : '') || context.steamAppId();
			openAchievementPickerModal({
				doc: section.ownerDocument || document,
				gameTitle: title,
				items: data.achievements,
				initialSelectedNames: currentSelected,
				hasOnlineAchievements,
				initialExportPath: pathInput.value.trim() || undefined,
				onSave: async (selectedNames) => {
					const selectedSet = new Set(selectedNames);
					let offCount = 0;
					let onCount = 0;
					for (const item of data.achievements) {
						if (selectedSet.has(item.name)) {
							if (item.is_online) onCount++;
							else offCount++;
						}
					}
					await saveOptions({
						simulate: selectedNames.length > 0,
						simulate_count: offCount,
						simulate_online_count: onCount,
						unlocked_names: selectedNames,
						unlock_online: onCount > 0,
					});
				},
				onExport: async (selectedNames, targetPath) => {
					optionsStatus.textContent = gdlText('game_achievement_picker_exporting', 'Exporting and merging achievements...');
					optionsStatus.style.color = '#8f98a0';
					try {
						const rawExport = await exportAchievementsJsonBackend({
							request_json: request({
								unlocked_names: selectedNames,
								target_path: targetPath || undefined,
							}),
						});
						const res = parseIpcObject<{ ok?: boolean; path?: string; merged_count?: number; error?: string }>(rawExport);
						if (!res || !res.ok) {
							throw new Error(res?.error || 'export_failed');
						}
						if (res.path) {
							pathInput.value = res.path;
						}
						options.simulate = false;
						options.simulate_count = 0;
						options.simulate_online_count = 0;
						options.unlocked_names = undefined;
						render();
						optionsStatus.textContent = gdlText('game_achievement_picker_export_success', 'Achievements exported and merged successfully to {path}. Using real achievements.', {
							path: res.path || 'achievements.json',
						});
						optionsStatus.style.color = '#66c0f4';
						refreshCurrentGame();
					} catch {
						optionsStatus.textContent = gdlText('game_achievement_picker_export_failed', 'Could not export achievements file.');
						optionsStatus.style.color = '#d94126';
					}
				},
				onSyncSteam: async (selectedNames) => {
					optionsStatus.textContent = gdlText('game_achievement_picker_syncing', 'Syncing with Steam servers...');
					optionsStatus.style.color = '#8f98a0';
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
								steam_app_id: context.steamAppId(),
								unlock: unlockList,
								lock: lockList,
							}),
						});
						const res = parseIpcObject<{ ok?: boolean; unlocked_count?: number; locked_count?: number; error?: string }>(rawSync);
						if (!res || !res.ok) {
							throw new Error(res?.error || 'sync_failed');
						}
						optionsStatus.textContent = gdlText('game_achievement_picker_sync_success', 'Achievements synced successfully with your Steam account.');
						optionsStatus.style.color = '#66c0f4';
						refreshCurrentGame();
					} catch {
						optionsStatus.textContent = gdlText('game_achievement_picker_sync_failed', 'Failed to sync achievements with your Steam account (ensure the game is owned and Steam is running).');
						optionsStatus.style.color = '#d94126';
					}
				},
			});
		} catch {
			optionsStatus.textContent = gdlText('game_achievement_options_failed', 'Achievement options could not be saved.');
			optionsStatus.style.color = '#d94126';
		}
	});
	resetButton?.addEventListener('click', () => {
		void saveOptions({ simulate: false, simulate_count: 0, simulate_online_count: 0, unlocked_names: undefined });
	});

	pathInput.addEventListener('keydown', event => {
		if (event.key === 'Enter') { event.preventDefault(); pathSave.click(); }
	});
	pathSave.addEventListener('click', async () => {
		const path = pathInput.value.trim();
		if (!path) {
			pathStatus.textContent = gdlText('game_achievement_path_enter', 'Enter a JSON file or folder path.');
			pathStatus.style.color = '#d6b24c';
			return;
		}
		try {
			const raw = await setGameAchievementPathBackend({ request_json: request({ path, unlock_online: options.unlock_online }) });
			const result = parseIpcObject<{ ok?: boolean; usable?: boolean; error?: string }>(raw) || {};
			if (!result.ok) throw new Error(result.error || 'save_failed');
			const targetAppId = context.steamAppId();
			if (targetAppId) storePath(targetAppId, { configured: true, path, usable: result.usable });
			customPathConfigured = true;
			options.simulate = false; options.configured = true;
			render();
			updateSectionVisibility();
			pathStatus.textContent = result.usable
				? gdlText('game_achievement_path_saved', 'Achievement source saved for this game.')
				: gdlText('game_achievement_path_saved_missing', 'The path is saved, but no readable achievements JSON was found there.');
			pathStatus.style.color = result.usable ? '#66c0f4' : '#d6b24c';
			refreshCurrentGame();
		} catch {
			pathStatus.textContent = gdlText('game_achievement_path_failed', 'The achievement source could not be saved.');
			pathStatus.style.color = '#d94126';
		}
	});
	pathClear.addEventListener('click', async () => {
		try {
			const raw = await setGameAchievementPathBackend({ request_json: request({ path: '' }) });
			const result = parseIpcObject<{ ok?: boolean; error?: string }>(raw) || {};
			if (!result.ok) throw new Error(result.error || 'clear_failed');
			const targetAppId = context.steamAppId();
			if (targetAppId) storePath(targetAppId, { configured: false, path: '', usable: false });
			customPathConfigured = false;
			pathInput.value = '';
			pathStatus.textContent = gdlText('game_achievement_path_cleared', 'Custom source removed; automatic AppID folders will be used.');
			pathStatus.style.color = '#8f98a0';
			refreshCurrentGame();
			updateSectionVisibility();
		} catch {
			pathStatus.textContent = gdlText('game_achievement_path_failed', 'The achievement source could not be saved.');
			pathStatus.style.color = '#d94126';
		}
	});

	let syncGeneration = 0;

	const syncForAppId = (targetAppId: string): void => {
		syncGeneration += 1;
		const thisGeneration = syncGeneration;
		if (!targetAppId || !/^\d+$/.test(targetAppId)) {
			achievementSection.style.display = 'none';
			return;
		}
		achievementSection.style.display = 'block';

		const cachedGame = getCachedGameData(targetAppId, steamLanguageSync() || 'english')?.data;
		if (cachedGame?.achievements?.total && cachedGame.achievements.total > 0) {
			totalAchievements = cachedGame.achievements.total;
			offlineAchievementsCount = totalAchievements;
			capabilitiesLoaded = true;
			capabilitiesConfirmed = true;
		}
		const cachedCaps = getStoredCaps(targetAppId);
		if (cachedCaps) {
			capabilitiesLoaded = true;
			capabilitiesConfirmed = cachedCaps.ok === true;
			hasOnlineAchievements = cachedCaps.ok === true && cachedCaps.has_online === true && Number(cachedCaps.online_count || 0) > 0;
			if (typeof cachedCaps.total === 'number') {
				totalAchievements = cachedCaps.total;
				onlineAchievementsCount = Number(cachedCaps.online_count || 0);
				offlineAchievementsCount = Math.max(0, totalAchievements - onlineAchievementsCount);
			}
		}
		const cachedOpt = getStoredOptions(targetAppId);
		if (cachedOpt) {
			loading = false;
			lastLoadedOptions = cachedOpt;
			applyOptions(cachedOpt);
		} else if (totalAchievements > 0) {
			loading = false;
		}
		const cachedPath = getStoredPath(targetAppId);
		if (cachedPath) {
			customPathConfigured = cachedPath.configured === true;
			pathInput.value = cachedPath.path || '';
			if (pathDisclosure && cachedPath.configured) pathDisclosure.open = true;
		}

		render();

		// Capability detection and settings load asynchronously in background
		void Promise.all([
			getGameAchievementPathBackend({ request_json: request({ steam_app_id: targetAppId }) }),
			getGameAchievementOptionsBackend({ request_json: request({ steam_app_id: targetAppId }) }),
		]).then(([pathRaw, optionsRaw]) => {
			if (thisGeneration !== syncGeneration || !section.isConnected) return;
			const pathResult = parseIpcObject<{ ok?: boolean; configured?: boolean; path?: string; usable?: boolean }>(pathRaw) || {};
			const optionsResult = parseIpcObject<GameAchievementOptions>(optionsRaw) || {};
			if (pathResult.ok) storePath(targetAppId, pathResult);
			if (optionsResult.ok) storeOptions(targetAppId, optionsResult);
			if (pathResult.ok) {
				customPathConfigured = pathResult.configured === true;
				pathInput.value = pathResult.path || '';
				if (pathDisclosure && pathResult.configured) pathDisclosure.open = true;
				pathStatus.textContent = pathResult.configured
					? (pathResult.usable ? gdlText('game_achievement_path_ready', 'This game will use the selected achievement file.') : gdlText('game_achievement_path_saved_missing', 'The path is saved, but no readable achievements JSON was found there.'))
					: gdlText('game_achievement_path_automatic', 'Using automatic AppID folders from the global plugin setting.');
			}
			loading = false;
			if (optionsResult.ok) applyOptions(optionsResult);
			else render();
			updateSectionVisibility();
		}).catch(() => {
			if (thisGeneration !== syncGeneration || !section.isConnected) return;
			loading = false;
			if (pathDisclosure) pathDisclosure.open = true;
			render();
			updateSectionVisibility();
		});

		void getGameAchievementCapabilitiesBackend({ request_json: request({ steam_app_id: targetAppId }) }).then(raw => {
			if (thisGeneration !== syncGeneration || !section.isConnected) return;
			const result = parseIpcObject<GameAchievementCapabilities & { total?: number }>(raw) || {};
			if (result.ok) storeCaps(targetAppId, result);
			capabilitiesLoaded = true;
			capabilitiesConfirmed = result.ok === true;
			hasOnlineAchievements = result.ok === true && result.has_online === true && Number(result.online_count || 0) > 0;
			if (result.ok === true && typeof result.total === 'number') {
				totalAchievements = result.total;
				onlineAchievementsCount = Number(result.online_count || 0);
				offlineAchievementsCount = Math.max(0, totalAchievements - onlineAchievementsCount);
			}
			if (!hasOnlineAchievements) options.unlock_online = false;
			if (lastLoadedOptions) applyOptions(lastLoadedOptions);
			else render();
			updateSectionVisibility();
		}).catch(() => {
			if (thisGeneration !== syncGeneration || !section.isConnected) return;
			capabilitiesLoaded = true;
			capabilitiesConfirmed = false;
			hasOnlineAchievements = false;
			options.unlock_online = false;
			render();
			updateSectionVisibility();
		});
	};

	const sync = (appId?: string): void => {
		const target = appId ?? context.steamAppId();
		syncForAppId(target);
	};

	sync();
	return { sync };
}
