import type { LocalAchievementItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText } from '../../steam/localization';
import { steamSyncFailureMessage } from './achievement-sync-errors';

export interface AchievementPickerModalOptions {
	doc: Document;
	gameTitle: string;
	items: LocalAchievementItem[];
	initialSelectedNames: string[];
	hasOnlineAchievements: boolean;
	titleOverride?: string;
	descriptionOverride?: string;
	initialExportPath?: string;
	onSave?: (selectedNames: string[]) => Promise<void> | void;
	onExport?: (selectedNames: string[], targetPath?: string) => Promise<void> | void;
	onSyncSteam?: (selectedNames: string[]) => Promise<void> | void;
}

export function openAchievementPickerModal(options: AchievementPickerModalOptions): void {
	const { doc, gameTitle, items, initialSelectedNames, hasOnlineAchievements, titleOverride, descriptionOverride, initialExportPath, onSave, onExport, onSyncSteam } = options;
	doc.getElementById('gdl-achievement-picker-overlay')?.remove();
	if (!doc.body) return;

	const selectedSet = new Set<string>(initialSelectedNames);
	let sortMode: 'default' | 'online_first' | 'offline_first' = 'default';
	let actionInFlight = false;
	const steamOnly = Boolean(onSyncSteam && !onSave && !onExport);
	const isReadOnly = (item: LocalAchievementItem): boolean => steamOnly && item.client_writable === false;
	const selectEditable = (select: (item: LocalAchievementItem) => boolean): void => {
		for (const item of items) {
			if (isReadOnly(item)) continue;
			if (select(item)) selectedSet.add(item.name); else selectedSet.delete(item.name);
		}
	};

	const overlay = doc.createElement('div');
	overlay.id = 'gdl-achievement-picker-overlay';
	overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(5px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:inherit;animation:gdlFadeIn .15s ease-out;';

	overlay.innerHTML = `
		<style>
			@keyframes gdlFadeIn { from { opacity: 0; } to { opacity: 1; } }
			@keyframes gdlPopIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
			@keyframes gdlCheckPop { 0% { transform: scale(0.6); } 70% { transform: scale(1.2); } 100% { transform: scale(1); } }
			
			.gdl-picker-btn {
				transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
				cursor: pointer;
				user-select: none;
			}
			.gdl-picker-btn:hover {
				background: #3b4657 !important;
				color: #ffffff !important;
				box-shadow: 0 2px 8px rgba(0,0,0,0.35);
			}
			.gdl-picker-btn:active {
				transform: scale(0.92) !important;
				background: #1a9fff !important;
				color: #ffffff !important;
				box-shadow: 0 0 10px rgba(26,159,255,0.6) !important;
			}
			.gdl-picker-btn.active-filter {
				background: rgba(26, 159, 255, 0.25) !important;
				border: 1px solid #1a9fff !important;
				color: #66c0f4 !important;
			}
			.gdl-picker-save {
				transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease, box-shadow 0.15s ease;
				cursor: pointer;
				user-select: none;
			}
			.gdl-picker-save:hover {
				background: #47b2ff !important;
				box-shadow: 0 4px 14px rgba(26,159,255,0.45);
			}
			.gdl-picker-save:active {
				transform: scale(0.94) !important;
				background: #0d82d4 !important;
			}
			.gdl-picker-export {
				transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
				cursor: pointer;
				user-select: none;
			}
			.gdl-picker-export:hover {
				background: #3b4657 !important;
				border-color: rgba(26,159,255,0.4) !important;
				color: #ffffff !important;
				box-shadow: 0 2px 8px rgba(0,0,0,0.35);
			}
			.gdl-picker-export:active {
				transform: scale(0.94) !important;
				background: #1a9fff !important;
				color: #ffffff !important;
			}
			.gdl-picker-cancel {
				transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease, color 0.15s ease;
				cursor: pointer;
				user-select: none;
			}
			.gdl-picker-cancel:hover {
				background: #4e5765 !important;
				color: #ffffff !important;
			}
			.gdl-picker-cancel:active {
				transform: scale(0.94) !important;
				background: #2b313a !important;
			}
			.gdl-picker-close {
				transition: transform 0.08s ease, color 0.15s ease, background 0.15s ease;
			}
			.gdl-picker-close:hover {
				color: #ffffff !important;
				background: rgba(255,255,255,0.1) !important;
			}
			.gdl-picker-close:active {
				transform: scale(0.88) !important;
			}
			.gdl-picker-row {
				transition: transform 0.08s cubic-bezier(0.4, 0, 0.2, 1), background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
				user-select: none;
			}
			.gdl-picker-row:hover {
				border-color: rgba(255,255,255,0.18) !important;
				background: rgba(255,255,255,0.05) !important;
			}
			.gdl-picker-row.is-selected:hover {
				border-color: rgba(26,159,255,0.6) !important;
				background: rgba(26,159,255,0.18) !important;
			}
			.gdl-picker-row:active {
				transform: scale(0.985) !important;
			}
			.gdl-check-active {
				animation: gdlCheckPop 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
			}
		</style>
		<div class="gdl-picker-dialog" role="dialog" aria-modal="true" style="position:relative;width:740px;max-width:96vw;height:82vh;max-height:750px;background:#18202b;border:1px solid rgba(255,255,255,0.12);border-radius:4px;box-shadow:0 20px 50px rgba(0,0,0,0.85);display:flex;flex-direction:column;overflow:hidden;color:#dcdedf;animation:gdlPopIn .18s cubic-bezier(0.1, 0.9, 0.2, 1);">
			<div style="padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.08);background:#1e2837;display:flex;justify-content:space-between;align-items:flex-start;">
				<div style="min-width:0;flex:1;">
					<div style="font-size:16px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
						${escapeHtml(gameTitle)} — ${escapeHtml(titleOverride || gdlText('game_achievement_picker_title', 'Simulated achievement picker'))}
					</div>
					<div style="font-size:12px;color:#8f98a0;margin-top:4px;line-height:1.35;">
						${escapeHtml(descriptionOverride || gdlText('game_achievement_picker_desc', 'Click on each achievement to toggle its state. Colored achievements will be simulated as unlocked.'))}
					</div>
				</div>
				<button class="gdl-picker-close" type="button" aria-label="${escapeHtml(gdlText('close', 'Close'))}" style="margin-left:12px;width:28px;height:28px;border:0;border-radius:2px;background:transparent;color:#8f98a0;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">×</button>
			</div>
			<div style="padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.06);background:#161d27;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
				<input class="gdl-picker-search" type="text" placeholder="${escapeHtml(gdlText('game_achievement_picker_search', 'Search achievement...'))}" style="flex:1;min-width:180px;padding:6px 10px;background:#10141a;border:1px solid rgba(255,255,255,0.12);border-radius:2px;color:#dcdedf;font-size:12.5px;outline:none;" />
				<div style="display:flex;gap:6px;flex-wrap:wrap;">
					<button class="gdl-picker-btn gdl-picker-btn-all" type="button" style="padding:5px 10px;background:#2b3443;border:1px solid rgba(255,255,255,0.06);border-radius:2px;color:#dcdedf;font-size:11.5px;font-weight:500;">${escapeHtml(gdlText('game_achievement_picker_select_all', 'Select all'))}</button>
					<button class="gdl-picker-btn gdl-picker-btn-none" type="button" style="padding:5px 10px;background:#2b3443;border:1px solid rgba(255,255,255,0.06);border-radius:2px;color:#dcdedf;font-size:11.5px;font-weight:500;">${escapeHtml(gdlText('game_achievement_picker_deselect_all', 'Deselect all'))}</button>
					${hasOnlineAchievements ? `
					<button class="gdl-picker-btn gdl-picker-btn-offline" type="button" style="padding:5px 10px;background:#2b3443;border:1px solid rgba(255,255,255,0.06);border-radius:2px;color:#dcdedf;font-size:11.5px;font-weight:500;">${escapeHtml(gdlText('game_achievement_picker_select_offline', 'Offline only'))}</button>
					<button class="gdl-picker-btn gdl-picker-btn-online" type="button" style="padding:5px 10px;background:#2b3443;border:1px solid rgba(255,255,255,0.06);border-radius:2px;color:#dcdedf;font-size:11.5px;font-weight:500;">${escapeHtml(gdlText('game_achievement_picker_select_online', 'Online only'))}</button>
					` : ''}
				</div>
			</div>
			<div class="gdl-picker-list" style="flex:1;min-height:0;overflow-y:auto;padding:12px 20px;display:flex;flex-direction:column;gap:6px;background:#121820;scroll-behavior:smooth;"></div>
			${onExport ? `
			<div style="padding:10px 20px;border-top:1px solid rgba(255,255,255,0.06);background:#161d27;display:flex;align-items:center;gap:10px;">
				<span style="font-size:12px;color:#8f98a0;white-space:nowrap;font-weight:500;">📁 ${escapeHtml(gdlText('game_achievement_export_path_label', 'Export path:'))}</span>
				<input class="gdl-picker-export-path" type="text" value="${escapeHtml(initialExportPath || '')}" placeholder="${escapeHtml(gdlText('game_achievement_path_placeholder', 'Example: D:\\Game\\achievements.json'))}" style="flex:1;min-width:0;padding:6px 10px;background:#10141a;border:1px solid rgba(255,255,255,0.12);border-radius:2px;color:#dcdedf;font-size:12px;outline:none;" />
			</div>
			` : ''}
			<div class="gdl-picker-sync-error" role="status" hidden style="padding:8px 20px;color:#ff8b83;background:#161d27;"></div>
			<div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.08);background:#1e2837;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
				<div class="gdl-picker-summary" style="font-size:12.5px;font-weight:500;color:#66c0f4;"></div>
				<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
					${onSyncSteam ? `
					<button class="gdl-picker-sync-steam" type="button" style="padding:8px 14px;background:#1e354a;border:1px solid #1a9fff;border-radius:2px;color:#66c0f4;font-size:12px;font-weight:600;">☁️ ${escapeHtml(gdlText('game_achievement_picker_sync_steam', 'Sync with Steam Account'))}</button>
					` : ''}
					${onExport ? `
					<button class="gdl-picker-export" type="button" style="padding:8px 14px;background:#242c38;border:1px solid rgba(255,255,255,0.12);border-radius:2px;color:#dcdedf;font-size:12px;font-weight:500;">💾 ${escapeHtml(gdlText('game_achievement_picker_export', 'Export to achievements.json (Smart merge)'))}</button>
					` : ''}
					<button class="gdl-picker-cancel" type="button" style="padding:8px 16px;background:#3d4450;border:0;border-radius:2px;color:#dcdedf;font-size:12px;font-weight:500;">${escapeHtml(gdlText('game_achievement_picker_cancel', 'Cancel'))}</button>
					${onSave ? `
					<button class="gdl-picker-save" type="button" style="padding:8px 20px;background:#1a9fff;border:0;border-radius:2px;color:#fff;font-size:12px;font-weight:600;">${escapeHtml(gdlText('game_achievement_picker_save', 'Save and apply'))}</button>
					` : ''}
				</div>
			</div>
		</div>`;

	doc.body.appendChild(overlay);

	const listEl = overlay.querySelector('.gdl-picker-list') as HTMLElement;
	const searchEl = overlay.querySelector('.gdl-picker-search') as HTMLInputElement;
	const exportPathInput = overlay.querySelector('.gdl-picker-export-path') as HTMLInputElement | null;
	const summaryEl = overlay.querySelector('.gdl-picker-summary') as HTMLElement;
	const saveBtn = overlay.querySelector('.gdl-picker-save') as HTMLButtonElement | null;
	const exportBtn = overlay.querySelector('.gdl-picker-export') as HTMLButtonElement | null;
	const syncSteamBtn = overlay.querySelector('.gdl-picker-sync-steam') as HTMLButtonElement | null;
	const syncError = overlay.querySelector('.gdl-picker-sync-error') as HTMLElement;
	const cancelBtn = overlay.querySelector('.gdl-picker-cancel') as HTMLButtonElement;
	const closeBtn = overlay.querySelector('.gdl-picker-close') as HTMLButtonElement;
	const selectAllBtn = overlay.querySelector('.gdl-picker-btn-all') as HTMLButtonElement;
	const deselectAllBtn = overlay.querySelector('.gdl-picker-btn-none') as HTMLButtonElement;
	const selectOfflineBtn = overlay.querySelector('.gdl-picker-btn-offline') as HTMLButtonElement | null;
	const selectOnlineBtn = overlay.querySelector('.gdl-picker-btn-online') as HTMLButtonElement | null;
	const rowCache = new Map<string, { row: HTMLElement; update: () => void }>();
	const setBusy = (busy: boolean): void => {
		actionInFlight = busy;
		for (const control of [saveBtn, exportBtn, syncSteamBtn, selectAllBtn, deselectAllBtn,
			selectOfflineBtn, selectOnlineBtn, searchEl, exportPathInput]) {
			if (control) control.disabled = busy;
		}
		listEl.setAttribute('aria-busy', String(busy));
	};

	const updateFilterButtons = (): void => {
		selectAllBtn.classList.remove('active-filter');
		deselectAllBtn.classList.remove('active-filter');
		selectOfflineBtn?.classList.remove('active-filter');
		selectOnlineBtn?.classList.remove('active-filter');
		if (sortMode === 'online_first') selectOnlineBtn?.classList.add('active-filter');
		else if (sortMode === 'offline_first') selectOfflineBtn?.classList.add('active-filter');
	};

	const updateSummary = (): void => {
		const selectedCount = selectedSet.size;
		const totalCount = items.length;
		summaryEl.textContent = gdlText('game_achievement_picker_count', '{selected} of {total} achievements selected', {
			selected: selectedCount,
			total: totalCount,
		});
	};

	const renderList = (): void => {
		const query = (searchEl.value || '').trim().toLowerCase();
		let visible = items.filter(item => {
			if (!query) return true;
			const haystack = `${item.display_name} ${item.name} ${item.description}`.toLowerCase();
			return haystack.includes(query);
		});

		if (sortMode === 'online_first') {
			visible = visible.slice().sort((a, b) => {
				const onlineDiff = Number(b.is_online) - Number(a.is_online);
				if (onlineDiff !== 0) return onlineDiff;
				const selDiff = (selectedSet.has(b.name) ? 1 : 0) - (selectedSet.has(a.name) ? 1 : 0);
				if (selDiff !== 0) return selDiff;
				return 0;
			});
		} else if (sortMode === 'offline_first') {
			visible = visible.slice().sort((a, b) => {
				const offlineDiff = Number(a.is_online) - Number(b.is_online);
				if (offlineDiff !== 0) return offlineDiff;
				const selDiff = (selectedSet.has(b.name) ? 1 : 0) - (selectedSet.has(a.name) ? 1 : 0);
				if (selDiff !== 0) return selDiff;
				return 0;
			});
		}

		if (visible.length === 0) {
			listEl.innerHTML = `<div style="text-align:center;padding:40px 20px;color:#8f98a0;font-size:13px;">${escapeHtml(gdlText('game_achievement_picker_no_results', 'No matching achievements found.'))}</div>`;
			updateSummary();
			updateFilterButtons();
			return;
		}

		const visibleRows: HTMLElement[] = [];
		for (const item of visible) {
			const cached = rowCache.get(item.name);
			if (cached) { cached.update(); visibleRows.push(cached.row); continue; }
			const isSelected = selectedSet.has(item.name);
			const row = doc.createElement('div');
			row.className = `gdl-picker-row${isSelected ? ' is-selected' : ''}`;
			row.style.cssText = `display:flex;align-items:center;gap:14px;padding:8px 12px;border-radius:3px;cursor:pointer;border:1px solid ${isSelected ? 'rgba(26,159,255,0.45)' : 'rgba(255,255,255,0.04)'};background:${isSelected ? 'rgba(26,159,255,0.12)' : 'rgba(0,0,0,0.25)'};`;
			if (isReadOnly(item)) { row.setAttribute('aria-disabled', 'true'); row.style.cursor = 'default'; }

			const iconImg = doc.createElement('img');
			iconImg.style.cssText = `width:44px;height:44px;flex:0 0 44px;object-fit:contain;border-radius:2px;transition:filter .15s ease,opacity .15s ease;${isSelected ? 'opacity:1;filter:none;box-shadow:0 0 6px rgba(26,159,255,0.4);' : 'opacity:0.35;filter:grayscale(100%);'}`;
			iconImg.src = isSelected ? (item.icon || item.icon_gray || '') : (item.icon_gray || item.icon || '');
			iconImg.alt = '';
			iconImg.loading = 'lazy';

			const info = doc.createElement('div');
			info.style.cssText = 'flex:1;min-width:0;';

			const titleRow = doc.createElement('div');
			titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

			const titleText = doc.createElement('span');
			titleText.style.cssText = `font-size:13px;font-weight:600;color:${isSelected ? '#ffffff' : '#8f98a0'};`;
			titleText.textContent = item.display_name || item.name;
			titleRow.appendChild(titleText);

			if (item.is_online) {
				const badge = doc.createElement('span');
				badge.style.cssText = 'font-size:10px;font-weight:700;padding:1px 6px;border-radius:2px;background:rgba(26,159,255,0.25);color:#66c0f4;text-transform:uppercase;letter-spacing:.3px;';
				badge.textContent = 'Online';
				titleRow.appendChild(badge);
			}
			if (item.client_writable === false) {
				const badge = doc.createElement('span');
				badge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:2px;background:rgba(214,178,76,0.15);color:#d6b24c;';
				badge.textContent = gdlText('game_achievement_protected_badge', 'Protected by Steam');
				titleRow.appendChild(badge);
			}

			const descText = doc.createElement('div');
			descText.style.cssText = `font-size:11.5px;color:${isSelected ? '#acb2b8' : '#68737f'};margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
			descText.textContent = item.description || (item.hidden ? gdlText('hidden_achievement', 'Hidden achievement') : '');

			info.appendChild(titleRow);
			info.appendChild(descText);

			const checkIndicator = doc.createElement('div');
			checkIndicator.className = `gdl-check-indicator${isSelected ? ' gdl-check-active' : ''}`;
			checkIndicator.style.cssText = `width:20px;height:20px;flex:0 0 20px;border-radius:3px;border:1px solid ${isSelected ? '#1a9fff' : 'rgba(255,255,255,0.2)'};background:${isSelected ? '#1a9fff' : 'transparent'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;`;
			checkIndicator.textContent = isSelected ? '✓' : '';

			row.appendChild(iconImg);
			row.appendChild(info);
			row.appendChild(checkIndicator);

			const update = (): void => {
				const selected = selectedSet.has(item.name);
				row.classList.toggle('is-selected', selected);
				row.style.borderColor = selected ? 'rgba(26,159,255,0.45)' : 'rgba(255,255,255,0.04)';
				row.style.background = selected ? 'rgba(26,159,255,0.12)' : 'rgba(0,0,0,0.25)';
				const icon = selected ? (item.icon || item.icon_gray || '') : (item.icon_gray || item.icon || '');
				if (iconImg.getAttribute('src') !== icon) iconImg.setAttribute('src', icon);
				iconImg.style.opacity = selected ? '1' : '0.35';
				iconImg.style.filter = selected ? 'none' : 'grayscale(100%)';
				iconImg.style.boxShadow = selected ? '0 0 6px rgba(26,159,255,0.4)' : 'none';
				titleText.style.color = selected ? '#ffffff' : '#8f98a0';
				descText.style.color = selected ? '#acb2b8' : '#68737f';
				checkIndicator.classList.toggle('gdl-check-active', selected);
				checkIndicator.style.borderColor = selected ? '#1a9fff' : 'rgba(255,255,255,0.2)';
				checkIndicator.style.background = selected ? '#1a9fff' : 'transparent';
				const checkText = selected ? '✓' : '';
				if (checkIndicator.textContent !== checkText) checkIndicator.textContent = checkText;
			};
			row.addEventListener('click', () => {
				if (actionInFlight || isReadOnly(item)) return;
				if (selectedSet.has(item.name)) {
					selectedSet.delete(item.name);
				} else {
					selectedSet.add(item.name);
				}
				if (sortMode === 'default') { update(); updateSummary(); updateFilterButtons(); }
				else renderList();
			});
			rowCache.set(item.name, { row, update });
			visibleRows.push(row);
		}
		// Selection changes update the existing icons and rows. Filtering/sorting
		// only moves those same nodes, avoiding hundreds of new image elements.
		const mountedRows = Array.from(listEl.children);
		if (mountedRows.length !== visibleRows.length || visibleRows.some((row, index) => mountedRows[index] !== row)) {
			listEl.replaceChildren(...visibleRows);
		}
		updateSummary();
		updateFilterButtons();
	};

	const close = (): void => {
		overlay.remove();
		rowCache.clear();
	};

	closeBtn.addEventListener('click', close);
	cancelBtn.addEventListener('click', close);
	overlay.addEventListener('click', event => {
		if (event.target === overlay) close();
	});
	overlay.addEventListener('keydown', event => {
		if ((event as KeyboardEvent).key === 'Escape') close();
	});

	searchEl.addEventListener('input', () => { if (!actionInFlight) renderList(); });

	selectAllBtn.addEventListener('click', () => {
		if (actionInFlight) return;
		sortMode = 'default';
		selectEditable(() => true);
		renderList();
	});

	deselectAllBtn.addEventListener('click', () => {
		if (actionInFlight) return;
		sortMode = 'default';
		selectEditable(() => false);
		renderList();
	});

	selectOfflineBtn?.addEventListener('click', () => {
		if (actionInFlight) return;
		sortMode = 'offline_first';
		selectEditable(item => !item.is_online);
		renderList();
		listEl.scrollTop = 0;
	});

	selectOnlineBtn?.addEventListener('click', () => {
		if (actionInFlight) return;
		sortMode = 'online_first';
		selectEditable(item => Boolean(item.is_online));
		renderList();
		listEl.scrollTop = 0;
	});

	saveBtn?.addEventListener('click', async () => {
		if (!onSave || actionInFlight) return;
		setBusy(true);
		saveBtn.textContent = gdlText('game_achievement_options_saving', 'Saving...');
		try {
			await onSave(Array.from(selectedSet));
			close();
		} catch {
			saveBtn.textContent = gdlText('game_achievement_picker_save', 'Save and apply');
		} finally { setBusy(false); }
	});

	exportBtn?.addEventListener('click', async () => {
		if (!onExport || actionInFlight) return;
		const targetPath = (exportPathInput?.value || '').trim();
		setBusy(true);
		exportBtn.textContent = gdlText('game_achievement_picker_exporting', 'Exporting and merging achievements...');
		try {
			await onExport(Array.from(selectedSet), targetPath || undefined);
			close();
		} catch {
			exportBtn.textContent = gdlText('game_achievement_picker_export', 'Export to achievements.json (Smart merge)');
		} finally { setBusy(false); }
	});

	syncSteamBtn?.addEventListener('click', async () => {
		if (!onSyncSteam || actionInFlight) return;
		syncError.hidden = true;
		setBusy(true);
		syncSteamBtn.textContent = gdlText('game_achievement_picker_syncing', 'Syncing with Steam servers...');
		try {
			await onSyncSteam(Array.from(selectedSet));
			close();
		} catch (error) {
			syncError.hidden = false;
			syncError.textContent = steamSyncFailureMessage(error);
			syncSteamBtn.textContent = `☁️ ${gdlText('game_achievement_picker_sync_steam', 'Sync with Steam Account')}`;
		} finally { setBusy(false); }
	});

	renderList();
	searchEl.focus();
}
