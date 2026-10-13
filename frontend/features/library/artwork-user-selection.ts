import { invalidateLogoPosition } from './artwork-logo-position';
import { layoutFingerprint } from './logo-layout';
import { backendLog, saveShortcutArtworkBackend, saveShortcutIconBackend } from '../../api/backend';
import {
	imageUrlToBase64,
	applyOfficialLogoPosition,
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
	if (!Number.isInteger(targetAppId) || targetAppId < 2147483648 || targetAppId > 4294967295 || !/^\d+$/.test(steamAppId)) {
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
	let positionReady = true;

	// 1. Apply standard library slots (portrait, hero, logo, wide)
	const standardSlots = (Object.keys(SLOT_TYPES) as Array<'portrait' | 'hero' | 'logo' | 'wide'>).filter(slot => Boolean(selection?.[slot]));
	if (standardSlots.length > 0) {
		const prepared = await Promise.all(standardSlots.map(async slot => {
			const imageType = SLOT_TYPES[slot];
			const url = selection[slot]!.url;
			const dataUrl = await imageUrlToBase64(url);
			return { slot, imageType, url, dataUrl: dataUrl ? await normalizeCommunityArtworkDataUrl(dataUrl, imageType) || dataUrl : null };
		}));
		if (selection.logo || selection.hero) {
			invalidateLogoPosition(targetAppId);
			const logo = prepared.find(item => item.slot === 'logo')?.dataUrl;
			const hero = prepared.find(item => item.slot === 'hero')?.dataUrl;
			const layout = logo || hero ? { logo: logo || '', hero: hero || '', key: logo && hero ? layoutFingerprint(logo, hero) : '' } : undefined;
			positionReady = await applyOfficialLogoPosition(targetAppId, steamAppId, null, true, 'BottomLeft', selection.logo ? 'community' : 'user_selection', layout);
			if (!positionReady && !selection.logo) missingSlots.push('logo_position');
		}
		for (const item of prepared) {
			if (item.slot === 'logo' && !positionReady) { missingSlots.push('logo'); continue; }
			let saved = false;
			if (item.dataUrl) {
				const base64 = item.dataUrl.slice(item.dataUrl.indexOf(',') + 1);
				if (typeof apps?.SetCustomArtworkForApp === 'function') {
					try {
						const accepted = await Promise.resolve(apps.SetCustomArtworkForApp(targetAppId, base64, 'png', item.imageType));
						saved = accepted !== false;
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
		if ((selection.logo && !successfulSlots.includes(2)) || (selection.hero && !successfulSlots.includes(1))) invalidateLogoPosition(targetAppId);
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
		recordUserArtworkApplication(targetAppId, steamAppId, successfulSlots, selection, true);
		try { window.dispatchEvent(new CustomEvent('gdl:artwork-changed', { detail: { shortcutAppId: targetAppId, steamAppId, user_action: true } })); } catch {}
	}
	return { complete, slots: successfulSlots, missing: missingSlots, communitySlots: complete ? [...chosenSlots] : [] };
}
