import { mountModalDialog } from '../../core/modal';
import { readCustomLogoPositionBackend } from '../../api/backend';
import { gdlText } from '../../steam/localization';
import { readLogoLayout } from '../library/logo-layout';
import { applyLogoPosition, rememberLogoAdjustment, type SteamLogoPinPosition } from '../library/artwork-logo-position';

export async function openLogoEditor(doc: Document, id: number, appId: string): Promise<void> {
	if (!Number.isInteger(id) || id < 2147483648 || !/^\d+$/.test(appId)) return;
	doc.getElementById('gdl-logo-editor')?.remove();
	const dialog = doc.createElement('dialog');
	dialog.id = 'gdl-logo-editor';
	dialog.style.cssText = 'width:min(850px,90vw);max-height:90vh;overflow:auto;background:#18232e;color:#eee;border:1px solid #476378;border-radius:8px;padding:24px;box-sizing:border-box;font:14px Arial,sans-serif;';
	const heading = doc.createElement('h2'); heading.textContent = gdlText('logo_editor', 'Adjust logo'); dialog.append(heading);
	const status = doc.createElement('p'); status.textContent = gdlText('logo_loading', 'Loading current images…'); dialog.append(status);
	const close = doc.createElement('button'); close.textContent = gdlText('cancel', 'Cancel');
	close.style.cssText = 'background:#3d4450;color:#eee;border:0;padding:10px 20px;';
	close.onclick = () => dialog.remove(); dialog.append(close);
	dialog.addEventListener('keydown', event => { if (event.key === 'Escape' && !close.disabled) dialog.remove(); });
	mountModalDialog(dialog);
	try {
		const layout = await readLogoLayout(id);
		let response: any = await readCustomLogoPositionBackend({ shortcut_app_id: String(id) });
		for (let i = 0; i < 3 && typeof response === 'string'; i++) response = JSON.parse(response);
		if (!dialog.isConnected) return;
		const position = { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 60, ...response?.logo_position };
		status.textContent = gdlText('logo_preview_note', 'Approximate preview. Steam adapts the layout to the window size. Saved for this logo and background.');
		const preview = doc.createElement('div');
		preview.style.cssText = 'position:relative;aspect-ratio:1920/620;background:#10151b;background-size:cover;background-position:center;margin:16px 0;overflow:hidden;';
		if (layout.hero) preview.style.backgroundImage = `url("${layout.hero}")`;
		const image = doc.createElement('img'); image.src = layout.logo;
		const region = doc.createElement('div');
		region.style.cssText = 'position:absolute;inset:16px 26px;'; preview.append(region);
		image.style.cssText = 'position:absolute;object-fit:contain;pointer-events:none;'; region.append(image);
		dialog.insertBefore(preview, close);
		const select = doc.createElement('select');
		select.style.cssText = 'margin-left:12px;background:#253443;color:#eee;padding:8px;border:1px solid #476378;';
		const pins: Array<[SteamLogoPinPosition, string]> = [
			['BottomLeft', gdlText('logo_bottom_left', 'Bottom left')], ['UpperLeft', gdlText('logo_upper_left', 'Top left')],
			['CenterCenter', gdlText('logo_center', 'Center')], ['UpperCenter', gdlText('logo_upper_center', 'Top center')],
			['BottomCenter', gdlText('logo_bottom_center', 'Bottom center')],
		];
		for (const [value, text] of pins) { const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
		select.value = position.pinnedPosition;
		const positionLabel = doc.createElement('label'); positionLabel.textContent = gdlText('logo_position', 'Position'); positionLabel.append(select);
		dialog.insertBefore(positionLabel, close);
		const render = (): void => {
			image.style.width = position.nWidthPct + '%'; image.style.height = position.nHeightPct + '%';
			const center = position.pinnedPosition.includes('Center');
			image.style.left = center ? '50%' : '0';
			image.style.top = position.pinnedPosition === 'CenterCenter' ? '50%' : position.pinnedPosition.startsWith('Upper') ? '0' : 'auto';
			image.style.bottom = position.pinnedPosition.startsWith('Bottom') ? '0' : 'auto';
			image.style.transform = center ? (position.pinnedPosition === 'CenterCenter' ? 'translate(-50%,-50%)' : 'translateX(-50%)') : '';
			image.style.objectPosition = `${center ? 'center' : 'left'} ${position.pinnedPosition.startsWith('Bottom') ? 'bottom' : position.pinnedPosition.startsWith('Upper') ? 'top' : 'center'}`;
		};
		select.onchange = () => { position.pinnedPosition = select.value; render(); };
		const narrow = doc.createElement('button'); narrow.type = 'button';
		narrow.textContent = gdlText('logo_narrow_preview', 'Toggle narrow preview');
		narrow.style.cssText = close.style.cssText + 'margin-left:12px;';
		let isNarrow = false;
		narrow.onclick = () => { isNarrow = !isNarrow; preview.style.width = isNarrow ? '60%' : '100%'; };
		dialog.insertBefore(narrow, close);
		// Keep the height fixed while simulating the library divider, as Steam does.
		preview.style.aspectRatio = 'auto'; preview.style.height = '240px';
		for (const [field, text] of [['nWidthPct', gdlText('logo_width', 'Maximum width')], ['nHeightPct', gdlText('logo_height', 'Maximum height')]] as const) {
			const label = doc.createElement('label'); label.style.cssText = 'display:block;margin:16px 0;';
			const output = doc.createElement('span'); output.textContent = `${text}: ${position[field]}%`;
			const slider = doc.createElement('input'); slider.type = 'range'; slider.min = '5'; slider.max = '100'; slider.value = String(position[field]); slider.style.width = '100%';
			slider.oninput = () => { position[field] = Number(slider.value); output.textContent = `${text}: ${slider.value}%`; render(); };
			label.append(output, slider); dialog.insertBefore(label, close);
		}
		const save = doc.createElement('button'); save.textContent = gdlText('save', 'Save'); save.style.cssText = 'background:#1a9fff;color:white;padding:10px 20px;border:0;margin-left:12px;'; dialog.append(save);
		const automatic = doc.createElement('button'); automatic.type = 'button';
		automatic.textContent = gdlText('logo_reset_automatic', 'Restore automatic layout');
		automatic.style.cssText = close.style.cssText + 'margin:12px 0 0 12px;'; dialog.append(automatic);
		automatic.onclick = async () => {
			automatic.disabled = save.disabled = close.disabled = true;
			try {
				const current = await readLogoLayout(id);
				if (!dialog.isConnected || current.key !== layout.key) throw new Error('artwork_changed');
				if (!await applyLogoPosition(id, appId, null, true, 'BottomLeft', 'automatic_reset', () => dialog.isConnected)) throw new Error('save_failed');
				const updated = await readLogoLayout(id);
				let saved: any = await readCustomLogoPositionBackend({ shortcut_app_id: String(id) });
				for (let i = 0; i < 3 && typeof saved === 'string'; i++) saved = JSON.parse(saved);
				if (saved?.logo_position) rememberLogoAdjustment(id, appId, updated.key, saved.logo_position);
				dialog.remove();
			} catch { status.textContent = gdlText('logo_save_error', 'Could not save. If the images changed, reopen the editor.'); }
			finally { automatic.disabled = save.disabled = close.disabled = false; }
		};
		save.onclick = async () => {
			automatic.disabled = save.disabled = close.disabled = true;
			try {
				const current = await readLogoLayout(id);
				if (!dialog.isConnected || current.key !== layout.key) throw new Error('artwork_changed');
				const selected = { ...position };
				const ok = await applyLogoPosition(id, appId, selected, true, 'BottomLeft', 'manual', () => dialog.isConnected);
				if (!ok) throw new Error('save_failed');
				rememberLogoAdjustment(id, appId, layout.key, selected);
				dialog.remove();
			} catch { status.textContent = gdlText('logo_save_error', 'Could not save. If the images changed, reopen the editor.'); }
			finally { automatic.disabled = save.disabled = close.disabled = false; }
		};
		render();
	} catch { status.textContent = gdlText('logo_load_error', 'The installed logo could not be loaded. Complete the artwork download and try again.'); }
}
