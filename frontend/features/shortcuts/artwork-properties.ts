import { backendLog, fetchCommunityArtworkCandidatesBackend } from '../../api/backend';
import { getPreferences, steamGridDbApiKeyCandidates } from '../../core/preferences';
import { escapeHtml } from '../../core/text';
import {
	deleteCustomUploadedArtwork,
	getCustomUploadedArtwork,
	getSavedCommunityArtworkSelection,
	saveCustomUploadedArtwork,
	type CommunityArtworkChoice,
	type CommunityArtworkSelection,
	type CommunityArtworkSlot,
} from '../library/artwork-selection-storage';
import { applyCommunityArtworkSelection } from '../library/artwork-user-selection';
import { resetShortcutArtworkToDefault } from '../library/artwork-reset';
import { gdlText } from '../../steam/localization';

interface ArtworkCandidatesResponse {
	eligible?: boolean;
	title?: string;
	error?: string;
	defaults?: Partial<Record<CommunityArtworkSlot, string | number>>;
	slots?: Partial<Record<CommunityArtworkSlot, CommunityArtworkChoice[]>>;
}

export interface ShortcutArtworkSettingsContext {
	section: HTMLElement;
	doc: Document;
	shortcutAppId: () => number | null;
	steamAppId: () => string;
	gameTitle: () => string;
	includeAllSteamGames?: boolean;
	/** Keep the picker entry visible even when eligibility is not known yet. */
	alwaysShow?: boolean;
}

export interface ShortcutArtworkSettingsBinding {
	refresh: () => Promise<void>;
}

function parseResponse(raw: unknown): ArtworkCandidatesResponse | null {
	try {
		let value = raw;
		for (let attempt = 0; attempt < 3 && typeof value === 'string'; attempt++) value = JSON.parse(value);
		return value && typeof value === 'object' ? value as ArtworkCandidatesResponse : null;
	} catch { return null; }
}

function requestCandidates(steamAppId: string, eligibilityOnly = false, includeAllSteamGames = false): Promise<ArtworkCandidatesResponse | null> {
	const preferences = getPreferences();
	return fetchCommunityArtworkCandidatesBackend({ request_json: JSON.stringify({
		steam_app_id: steamAppId,
		api_key: eligibilityOnly ? '' : preferences.steamGridDbApiKey,
		api_keys: eligibilityOnly ? [] : steamGridDbApiKeyCandidates(preferences.steamGridDbApiKey),
		eligibility_only: eligibilityOnly,
		include_all: includeAllSteamGames,
	}) }).then(parseResponse).catch((): null => null);
}

export function shortcutArtworkSettingsHtml(includeAllSteamGames = false, standalone = false): string {
	const description = includeAllSteamGames
		? gdlText('game_artwork_picker_desc_native', 'Choose alternative SteamGridDB artwork for this Steam game. Your selection changes only your local library artwork.')
		: gdlText('game_artwork_picker_desc', 'Choose alternative SteamGridDB artwork for this retired game. Your selection replaces the defaults only for this shortcut.');
	const layoutStyle = standalone
		? 'display:block;margin:0;padding:0;border:0;'
		: 'display:block;margin-top:16px;padding-top:14px;border-top:1px dashed rgba(255,255,255,.08);';
	return `
		<div class="gdl-game-artwork-settings" style="${layoutStyle}">
			<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
				<div style="min-width:0;flex:1 1 240px;">
					<div style="font-size:14px;font-weight:500;color:#fff;margin-bottom:4px;">${escapeHtml(gdlText('game_artwork_picker_title', 'Library artwork'))}</div>
					<div style="font-size:12px;line-height:1.45;color:#8f98a0;">${escapeHtml(description)}</div>
				</div>
				<div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-top:4px;">
					<button class="gdl-game-artwork-open" type="button" style="padding:8px 14px;background:#1a9fff;border:0;border-radius:2px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">${escapeHtml(gdlText('game_artwork_picker_open', 'Choose artwork'))}</button>
					<button class="gdl-game-artwork-reset" type="button" style="padding:8px 14px;background:#3d4450;border:0;border-radius:2px;color:#dcdedf;font-size:12px;cursor:pointer;">${escapeHtml(gdlText('game_artwork_picker_reset', 'Reset artwork'))}</button>
				</div>
			</div>
			<div class="gdl-game-artwork-status" style="min-height:15px;margin-top:8px;font-size:11px;color:#8f98a0;"></div>
		</div>`;
}

function openArtworkModal(context: ShortcutArtworkSettingsContext, data: ArtworkCandidatesResponse, statusEl: HTMLElement): void {
	const { doc } = context;
	doc.getElementById('gdl-artwork-picker-overlay')?.remove();
	const shortcutAppId = context.shortcutAppId();
	const steamAppId = context.steamAppId();
	if (!shortcutAppId || !/^\d+$/.test(steamAppId) || !data.slots) return;

	const slots: CommunityArtworkSlot[] = ['portrait', 'hero', 'logo', 'wide', 'icon'];
	const labels: Record<CommunityArtworkSlot, string> = {
		portrait: gdlText('game_artwork_slot_portrait', 'Vertical cover'),
		hero: gdlText('game_artwork_slot_hero', 'Wide background'),
		logo: gdlText('game_artwork_slot_logo', 'Logo'),
		wide: gdlText('game_artwork_slot_wide', 'Horizontal capsule'),
		icon: gdlText('game_artwork_slot_icon', 'Icon'),
	};
	const customUploads = getCustomUploadedArtwork(steamAppId);
	const getSlotItems = (slot: CommunityArtworkSlot): CommunityArtworkChoice[] => [
		...(customUploads[slot] || []),
		...(Array.isArray(data.slots?.[slot]) ? data.slots![slot]! : []),
	];

	const saved = getSavedCommunityArtworkSelection(shortcutAppId, steamAppId);
	const defaults: CommunityArtworkSelection = {};
	const selected: CommunityArtworkSelection = {};
	for (const slot of slots) {
		const choices = getSlotItems(slot);
		const defaultId = String(data.defaults?.[slot] ?? '');
		const defaultChoice = choices.find(item => String(item.id) === defaultId) || choices[0];
		if (defaultChoice) defaults[slot] = defaultChoice;
		const savedId = String(saved?.[slot]?.id ?? '');
		const initialChoice = choices.find(item => String(item.id) === savedId) || defaultChoice;
		if (initialChoice) selected[slot] = initialChoice;
	}

	let activeSlot: CommunityArtworkSlot = 'hero';
	const overlay = doc.createElement('div');
	overlay.id = 'gdl-artwork-picker-overlay';
	overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.8);backdrop-filter:blur(5px);font-family:inherit;';
	overlay.innerHTML = `
		<style>
			.gdl-art-tab:hover,.gdl-art-card:hover{border-color:rgba(102,192,244,.75)!important;background:rgba(102,192,244,.08)!important}
			.gdl-art-card{transition:border-color .12s ease,background .12s ease,transform .08s ease}.gdl-art-card:active{transform:scale(.985)}
		</style>
		<div role="dialog" aria-modal="true" aria-label="${escapeHtml(gdlText('game_artwork_picker_title', 'Library artwork'))}" style="width:940px;max-width:96vw;height:80vh;max-height:760px;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:4px;background:#18202b;color:#dcdedf;box-shadow:0 22px 60px rgba(0,0,0,.85);">
			<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px 13px;background:#1e2837;border-bottom:1px solid rgba(255,255,255,.08);">
				<div style="min-width:0;"><div style="font-size:16px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(context.gameTitle())} — ${escapeHtml(gdlText('game_artwork_picker_title', 'Library artwork'))}</div><div style="margin-top:4px;font-size:12px;color:#8f98a0;">${escapeHtml(gdlText('game_artwork_picker_modal_desc', 'Select one image for each Steam library slot. The blue border marks the image that will be applied.'))}</div></div>
				<button class="gdl-art-close" type="button" aria-label="${escapeHtml(gdlText('close', 'Close'))}" style="width:30px;height:30px;border:0;border-radius:2px;background:transparent;color:#8f98a0;font-size:22px;cursor:pointer;">×</button>
			</div>
			<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 20px;background:#161d27;border-bottom:1px solid rgba(255,255,255,.06);">
				<div class="gdl-art-tabs" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
				<button class="gdl-art-upload-btn" type="button" style="padding:6px 13px;background:#2a475e;border:1px solid #1a9fff;border-radius:2px;color:#66c0f4;font-size:11.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
					<span>📁</span><span>${escapeHtml(gdlText('game_artwork_upload_btn', 'Upload image'))}</span>
				</button>
				<input type="file" class="gdl-art-file-input" accept="image/png,image/jpeg,image/webp,image/x-icon,image/bmp,image/svg+xml" style="display:none;" />
			</div>
			<div class="gdl-art-grid" style="flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));align-content:start;gap:12px;padding:18px 20px;background:#121820;"></div>
			<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 20px;background:#1e2837;border-top:1px solid rgba(255,255,255,.08);">
				<div class="gdl-art-summary" style="font-size:11.5px;color:#8f98a0;"></div>
				<div style="display:flex;gap:8px;">
					<button class="gdl-art-defaults" type="button" style="padding:8px 14px;background:#242c38;border:1px solid rgba(255,255,255,.12);border-radius:2px;color:#dcdedf;font-size:12px;cursor:pointer;">${escapeHtml(gdlText('game_artwork_picker_defaults', 'Use recommended defaults'))}</button>
					<button class="gdl-art-cancel" type="button" style="padding:8px 14px;background:#3d4450;border:0;border-radius:2px;color:#dcdedf;font-size:12px;cursor:pointer;">${escapeHtml(gdlText('cancel', 'Cancel'))}</button>
					<button class="gdl-art-apply" type="button" style="padding:8px 18px;background:#1a9fff;border:0;border-radius:2px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">${escapeHtml(gdlText('game_artwork_picker_apply', 'Apply artwork'))}</button>
				</div>
			</div>
		</div>`;
	doc.body.appendChild(overlay);

	const tabsEl = overlay.querySelector<HTMLElement>('.gdl-art-tabs')!;
	const gridEl = overlay.querySelector<HTMLElement>('.gdl-art-grid')!;
	const summaryEl = overlay.querySelector<HTMLElement>('.gdl-art-summary')!;
	const applyBtn = overlay.querySelector<HTMLButtonElement>('.gdl-art-apply')!;
	const uploadBtn = overlay.querySelector<HTMLButtonElement>('.gdl-art-upload-btn')!;
	const fileInput = overlay.querySelector<HTMLInputElement>('.gdl-art-file-input')!;
	const close = (): void => overlay.remove();

	const acceptUploadedImage = (dataUrl: string): void => {
		if (!/^data:image\//i.test(dataUrl)) return;
		const img = new Image();
		img.onload = () => {
			const choice: CommunityArtworkChoice = {
				id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
				url: dataUrl, thumb: dataUrl,
				width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0,
				isCustom: true,
			};
			saveCustomUploadedArtwork(steamAppId, activeSlot, choice);
			if (!customUploads[activeSlot]) customUploads[activeSlot] = [];
			customUploads[activeSlot]!.unshift(choice);
			selected[activeSlot] = choice;
			fileInput.value = '';
			render();
		};
		img.src = dataUrl;
	};

	uploadBtn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		// Use the CEF file input only. NativeGameLink must not invoke SteamClient
		// System file-dialog IPC itself: on some Big Picture/clean-client builds
		// that bridge can surface a stray Windows dialog (observed as a Save As
		// window with "home" prefilled). Steam's own Personalización controls
		// remain completely native; this applies only to our optional picker.
		fileInput.click();
	});
	fileInput.addEventListener('change', () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => acceptUploadedImage(String(reader.result || ''));
		reader.readAsDataURL(file);
	});

	const render = (): void => {
		tabsEl.replaceChildren();
		for (const slot of slots) {
			const items = getSlotItems(slot);
			const tab = doc.createElement('button');
			tab.type = 'button';
			tab.className = 'gdl-art-tab';
			tab.textContent = `${labels[slot]} (${items.length})`;
			tab.style.cssText = `padding:7px 11px;border-radius:2px;border:1px solid ${slot === activeSlot ? '#1a9fff' : 'rgba(255,255,255,.09)'};background:${slot === activeSlot ? 'rgba(26,159,255,.18)' : '#242c38'};color:${slot === activeSlot ? '#66c0f4' : '#acb2b8'};font-size:11.5px;font-weight:500;cursor:pointer;`;
			tab.addEventListener('click', () => { activeSlot = slot; render(); });
			tabsEl.appendChild(tab);
		}

		const currentItems = getSlotItems(activeSlot);
		gridEl.replaceChildren();
		for (const item of currentItems) {
			const chosen = String(selected[activeSlot]?.id ?? '') === String(item.id);
			const card = doc.createElement('button');
			card.type = 'button';
			card.className = 'gdl-art-card';
			card.style.cssText = `position:relative;min-width:0;padding:8px;border-radius:3px;border:2px solid ${chosen ? '#1a9fff' : 'rgba(255,255,255,.08)'};background:${chosen ? 'rgba(26,159,255,.13)' : 'rgba(0,0,0,.22)'};color:#dcdedf;text-align:left;cursor:pointer;`;
			const frameHeight = activeSlot === 'portrait' ? 230 : activeSlot === 'logo' ? 120 : activeSlot === 'icon' ? 110 : 104;
			const isTransparentBg = activeSlot === 'logo' || activeSlot === 'icon';
			const objectFit = activeSlot === 'logo' || activeSlot === 'icon' ? 'contain' : 'cover';

			const tagLabel = item.isCustom
				? `<span style="background:rgba(102,192,244,.15);border:1px solid #1a9fff;color:#66c0f4;padding:1px 5px;border-radius:2px;font-size:10px;">${escapeHtml(gdlText('game_artwork_upload_custom_tag', 'Uploaded'))}</span>`
				: `<span>#${escapeHtml(String(item.id))}</span>`;

			const deleteButtonHtml = item.isCustom
				? `<button class="gdl-art-del-btn" type="button" title="${escapeHtml(gdlText('game_artwork_delete_custom_tooltip', 'Delete custom image'))}" style="position:absolute;top:12px;left:12px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(217,65,38,.88);color:#fff;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3;box-shadow:0 2px 6px rgba(0,0,0,.6);">✕</button>`
				: '';

			card.innerHTML = `
				${deleteButtonHtml}
				<div style="height:${frameHeight}px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:2px;background:${isTransparentBg ? 'repeating-conic-gradient(#303946 0 25%,#222b36 0 50%) 50%/16px 16px' : '#0c1117'};">
					<img src="${escapeHtml(item.thumb || item.url)}" alt="" loading="lazy" style="display:block;width:100%;height:100%;object-fit:${objectFit};" />
				</div>
				<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:7px;font-size:10.5px;color:#8f98a0;">
					<span>${escapeHtml(`${item.width || '?'}×${item.height || '?'}`)}</span>
					${tagLabel}
				</div>
				${chosen ? '<div style="position:absolute;top:13px;right:13px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#1a9fff;color:#fff;font-size:14px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.6);z-index:2;">✓</div>' : ''}
			`;

			card.querySelector('img')?.addEventListener('error', event => { (event.currentTarget as HTMLElement).style.visibility = 'hidden'; }, { once: true });
			if (item.isCustom) {
				const delBtn = card.querySelector<HTMLButtonElement>('.gdl-art-del-btn');
				delBtn?.addEventListener('click', (e) => {
					e.stopPropagation();
					deleteCustomUploadedArtwork(steamAppId, activeSlot, item.id);
					customUploads[activeSlot] = (customUploads[activeSlot] || []).filter((c: CommunityArtworkChoice) => String(c.id) !== String(item.id));
					if (String(selected[activeSlot]?.id) === String(item.id)) {
						selected[activeSlot] = getSlotItems(activeSlot)[0] || defaults[activeSlot];
					}
					render();
				});
			}

			card.addEventListener('click', () => { selected[activeSlot] = item; render(); });
			gridEl.appendChild(card);
		}
		if (!currentItems.length) gridEl.innerHTML = `<div style="grid-column:1/-1;padding:50px 20px;text-align:center;color:#8f98a0;">${escapeHtml(gdlText('game_artwork_picker_empty', 'No compatible artwork was found for this slot.'))}</div>`;
		const selectableSlots = slots.filter(slot => getSlotItems(slot).length > 0);
		const selectedCount = selectableSlots.filter(slot => Boolean(selected[slot])).length;
		summaryEl.textContent = gdlText('game_artwork_picker_summary', '{selected} of {total} slots selected · Source: SteamGridDB', { selected: selectedCount, total: selectableSlots.length });
		applyBtn.disabled = selectableSlots.length === 0 || selectedCount !== selectableSlots.length;
		applyBtn.style.opacity = applyBtn.disabled ? '.55' : '1';
	};

	overlay.querySelector('.gdl-art-close')?.addEventListener('click', close);
	overlay.querySelector('.gdl-art-cancel')?.addEventListener('click', close);
	overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
	overlay.querySelector('.gdl-art-defaults')?.addEventListener('click', () => {
		for (const slot of slots) if (defaults[slot]) selected[slot] = defaults[slot];
		render();
	});
	applyBtn.addEventListener('click', async () => {
		if (applyBtn.disabled) return;
		applyBtn.disabled = true;
		applyBtn.textContent = gdlText('game_artwork_picker_applying', 'Applying...');
		const result = await applyCommunityArtworkSelection(shortcutAppId, steamAppId, selected);
		if (result.complete) {
			statusEl.textContent = gdlText('game_artwork_picker_success', 'The selected artwork was applied and saved for this shortcut.');
			statusEl.style.color = '#5ba32b';
			close();
		} else {
			statusEl.textContent = gdlText('game_artwork_picker_failed', 'Some artwork could not be applied. Check your connection and try again.');
			statusEl.style.color = '#d94126';
			applyBtn.disabled = false;
			applyBtn.textContent = gdlText('game_artwork_picker_apply', 'Apply artwork');
		}
	});
	render();
}

export function bindShortcutArtworkSettings(context: ShortcutArtworkSettingsContext): ShortcutArtworkSettingsBinding {
	const container = context.section.querySelector<HTMLElement>('.gdl-game-artwork-settings');
	const openBtn = context.section.querySelector<HTMLButtonElement>('.gdl-game-artwork-open');
	const resetBtn = context.section.querySelector<HTMLButtonElement>('.gdl-game-artwork-reset');
	const statusEl = context.section.querySelector<HTMLElement>('.gdl-game-artwork-status');
	let eligibilityAppId = '';
	if (!container || !openBtn || !resetBtn || !statusEl) return { refresh: async () => {} };
	// This section can be mounted inside Steam's native clickable artwork rows.
	// Never let plugin control events bubble into Steam's own Browse handler;
	// that was responsible for stray system file dialogs (often titled “Home”).
	for (const eventName of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
		container.addEventListener(eventName, event => event.stopPropagation());
	}

	const refresh = async (): Promise<void> => {
		const steamAppId = context.steamAppId();
		if (!/^\d+$/.test(steamAppId)) {
			eligibilityAppId = '';
			container.style.display = context.alwaysShow ? 'block' : 'none';
			openBtn.disabled = Boolean(context.alwaysShow);
			resetBtn.disabled = true;
			resetBtn.style.opacity = '.55';
			if (context.alwaysShow) {
				statusEl.textContent = gdlText('game_artwork_picker_no_appid', 'Link this game to a Steam AppID to choose artwork.');
				statusEl.style.color = '#d6b24c';
			}
			return;
		}
		if (steamAppId === eligibilityAppId && container.style.display !== 'none') return;
		eligibilityAppId = steamAppId;
		const response = await requestCandidates(steamAppId, true, Boolean(context.includeAllSteamGames));
		const visible = Boolean(response?.eligible) || Boolean(context.alwaysShow);
		container.style.display = visible ? 'block' : 'none';
		openBtn.disabled = !visible;
		resetBtn.disabled = !visible;
		resetBtn.style.opacity = visible ? '1' : '.55';
		if (response?.eligible || !context.alwaysShow) {
			statusEl.textContent = '';
			statusEl.style.color = '#8f98a0';
		} else {
			statusEl.textContent = gdlText('game_artwork_picker_unavailable', 'Artwork can be searched manually with your SteamGridDB key.');
			statusEl.style.color = '#d6b24c';
		}
	};

	openBtn.addEventListener('click', async () => {
		const steamAppId = context.steamAppId();
		const shortcutAppId = context.shortcutAppId();
		if (!shortcutAppId || !/^\d+$/.test(steamAppId)) {
			if (context.alwaysShow) {
				statusEl.textContent = gdlText('game_artwork_picker_no_appid', 'Link this game to a Steam AppID to choose artwork.');
				statusEl.style.color = '#d6b24c';
			}
			return;
		}
		const preferences = getPreferences();
		if (!preferences.steamGridDbApiKey) {
			statusEl.textContent = gdlText('game_artwork_picker_api_key', 'Add your SteamGridDB API key in NativeGameLink settings first.');
			statusEl.style.color = '#d6b24c';
			return;
		}
		openBtn.disabled = true;
		openBtn.textContent = gdlText('game_artwork_picker_loading', 'Loading artwork...');
		statusEl.textContent = '';
		try {
			const response = await requestCandidates(steamAppId, false, Boolean(context.includeAllSteamGames));
			if (!response?.eligible || response.error || !response.slots) throw new Error(response?.error || 'unavailable');
			openArtworkModal(context, response, statusEl);
		} catch {
			statusEl.textContent = gdlText('game_artwork_picker_load_failed', 'SteamGridDB artwork could not be loaded. Verify the API key and connection.');
			statusEl.style.color = '#d94126';
		} finally {
			openBtn.disabled = false;
			openBtn.textContent = gdlText('game_artwork_picker_open', 'Choose artwork');
		}
	});

	resetBtn.addEventListener('click', async () => {
		const steamAppId = context.steamAppId();
		const shortcutAppId = context.shortcutAppId();
		if (!shortcutAppId || !/^\d+$/.test(steamAppId)) return;
		resetBtn.disabled = true;
		openBtn.disabled = true;
		resetBtn.textContent = gdlText('game_artwork_picker_resetting', 'Restoring...');
		statusEl.textContent = '';
		try {
			const result = await resetShortcutArtworkToDefault(shortcutAppId, steamAppId, context.gameTitle());
			// Older/delisted AppIDs may legitimately have fewer than four official
			// slots. Treat a reset as successful when at least one default slot was
			// restored; only a total failure should be reported to the user.
			if (!result.complete && result.slots.length === 0) throw new Error(result.missing.join(','));
			statusEl.textContent = gdlText('game_artwork_picker_reset_success', 'Default plugin artwork restored.');
			statusEl.style.color = '#5ba32b';
		} catch (error) {
			backendLog(`Artwork reset failed for ${steamAppId}: ${String(error)}`);
			statusEl.textContent = gdlText('game_artwork_picker_reset_failed', 'Could not restore the default artwork. Try again.');
			statusEl.style.color = '#d94126';
		} finally {
			resetBtn.disabled = false;
			openBtn.disabled = false;
			resetBtn.textContent = gdlText('game_artwork_picker_reset', 'Reset artwork');
		}
	});

	void refresh();
	return { refresh };
}
