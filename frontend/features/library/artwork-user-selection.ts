import { applyLogoPosition } from './artwork-logo-position';
import { backendLog, saveShortcutArtworkBackend, saveShortcutIconBackend } from '../../api/backend';
import {
	imageUrlToBase64,
	normalizeCommunityArtworkDataUrl,
	recordUserArtworkApplication,
	type ArtworkApplyResult,
} from './artwork';
import {
	isTrustedArtworkChoiceUrl,
	saveCommunityArtworkSelection,
	type CommunityArtworkSelection,
	type CommunityArtworkSlot,
} from './artwork-selection-storage';

const SLOT_TYPES: Record<'portrait' | 'hero' | 'logo' | 'wide', number> = { portrait: 0, hero: 1, logo: 2, wide: 3 };

/** Apply a complete, user-reviewed set chosen explicitly in Properties. */
export async function applyCommunityArtworkSelection(
	targetAppId: number,
	steamAppId: string,
	selection: CommunityArtworkSelection,
): Promise<ArtworkApplyResult> {
	if (!Number.isInteger(targetAppId) || targetAppId <= 0 || !/^\d+$/.test(steamAppId)) {
		return { complete: false, slots: [], missing: ['invalid_shortcut'], communitySlots: [] };
	}
	const apps = (window as any).SteamClient?.Apps;
	const slots: CommunityArtworkSlot[] = ['portrait', 'hero', 'logo', 'wide', 'icon'];
	const chosenSlots = slots.filter(slot => Boolean(selection?.[slot]));
	if (!chosenSlots.length || !chosenSlots.every(slot => isTrustedArtworkChoiceUrl(selection[slot]?.url))) {
		return { complete: false, slots: [], missing: ['invalid_selection'], communitySlots: [] };
	}

	const successfulSlots: number[] = [];
	const missingSlots: string[] = [];

	// 1. Apply standard library slots (portrait, hero, logo, wide)
	const standardSlots = (Object.keys(SLOT_TYPES) as Array<'portrait' | 'hero' | 'logo' | 'wide'>).filter(slot => Boolean(selection?.[slot]));
	if (standardSlots.length > 0) {
		const prepared = await Promise.all(standardSlots.map(async slot => {
			const imageType = SLOT_TYPES[slot];
			const url = selection[slot]!.url;
			const dataUrl = await imageUrlToBase64(url);
			return { slot, imageType, url, dataUrl: dataUrl ? await normalizeCommunityArtworkDataUrl(dataUrl, imageType) || dataUrl : null };
		}));
		for (const item of prepared) {
			let saved = false;
			if (item.dataUrl) {
				const base64 = item.dataUrl.slice(item.dataUrl.indexOf(',') + 1);
				if (typeof apps?.SetCustomArtworkForApp === 'function') {
					try {
						await Promise.resolve(apps.SetCustomArtworkForApp(targetAppId, base64, 'png', item.imageType));
						saved = true;
					} catch (error) {
						backendLog(`Steam artwork API failed (${item.slot}) for ${steamAppId}; trying grid-file fallback: ${String(error)}`);
					}
				}
				if (!saved) {
					try {
						const raw = await saveShortcutArtworkBackend({ request_json: JSON.stringify({
							shortcut_app_id: targetAppId, steam_app_id: steamAppId, image_type: item.imageType,
							data_base64: base64, extension: 'png',
						}) });
						let response: any = raw;
						for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt += 1) response = JSON.parse(response);
						saved = response?.saved === true || response?.ok === true;
					} catch (error) {
						backendLog(`Grid-file artwork fallback failed (${item.slot}) for ${steamAppId}: ${String(error)}`);
					}
				}
			}
			// Fallback: If dataUrl was null (e.g. CORS blocked CEF fetch) or base64 failed,
			// download directly on backend using the verified URL.
			if (!saved && item.url) {
				try {
					const raw = await saveShortcutArtworkBackend({ request_json: JSON.stringify({
						shortcut_app_id: targetAppId, steam_app_id: steamAppId, image_type: item.imageType,
						url: item.url,
					}) });
					let response: any = raw;
					for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt += 1) response = JSON.parse(response);
					saved = response?.saved === true || response?.ok === true;
				} catch (error) {
					backendLog(`Direct URL artwork fallback failed (${item.slot}) for ${steamAppId}: ${String(error)}`);
				}
			}
			if (saved) successfulSlots.push(item.imageType);
			else missingSlots.push(item.slot);
		}
	}

	// 2. Apply icon slot if chosen
	if (selection.icon) {
		try {
			const dataUrl = await imageUrlToBase64(selection.icon.url);
			let saved = false;
			if (dataUrl) {
				const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
				const raw = await saveShortcutIconBackend({
					request_json: JSON.stringify({
						shortcut_app_id: targetAppId,
						steam_app_id: steamAppId,
						icon_base64: base64,
						extension: 'png',
						source: selection.icon.isCustom ? 'custom_upload' : 'steamgriddb',
					}),
				});
				let response: any = raw;
				for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt += 1) response = JSON.parse(response);
				saved = response?.saved === true;
			}
			if (!saved && selection.icon.url) {
				const raw = await saveShortcutIconBackend({
					request_json: JSON.stringify({
						shortcut_app_id: targetAppId,
						steam_app_id: steamAppId,
						url: selection.icon.url,
						source: selection.icon.isCustom ? 'custom_upload' : 'steamgriddb',
					}),
				});
				let response: any = raw;
				for (let attempt = 0; attempt < 3 && typeof response === 'string'; attempt += 1) response = JSON.parse(response);
				saved = response?.saved === true;
			}
			if (saved) successfulSlots.push(4);
			else missingSlots.push('icon');
		} catch (error) {
			backendLog(`User icon error for ${steamAppId}: ${String(error)}`);
			missingSlots.push('icon');
		}
	}

	const complete = missingSlots.length === 0;
	if (complete) {
		saveCommunityArtworkSelection(targetAppId, steamAppId, selection);
		recordUserArtworkApplication(targetAppId, steamAppId, successfulSlots, selection);
		if (targetAppId >= 2147483648 && (selection.logo || selection.hero)) await applyLogoPosition(targetAppId, steamAppId, null, false, 'BottomLeft', 'community', () => true);
		try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId: targetAppId, steamAppId, user_action: true } })); } catch {}
	}
	return { complete, slots: successfulSlots, missing: missingSlots, communitySlots: complete ? [...chosenSlots] : [] };
}
