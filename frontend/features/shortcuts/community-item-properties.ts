import type { SteamCommunityBadgeAsset, SteamCommunityCardAsset, SteamCommunityItemsCatalog } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { gdlText } from '../../steam/localization';
import { getImmediateOfficialCommunityItems, getOfficialCommunityItems, subscribeOfficialCommunityItems } from '../library/community-items';
import { linkedCardPresentation } from '../library/linked-card-presentation';
import {
	communityBadgeId, communityCardId, getCachedCommunityItemOptions, getCommunityItemOptions, setCommunityItemOptions,
	subscribeCommunityItemOptions, type CommunityItemOptions,
} from '../../core/community-item-options';

export interface ShortcutCommunityItemSettingsContext {
	section: HTMLElement;
	shortcutAppId(): string;
	steamAppId(): string;
}
const steamDataOptions = (): CommunityItemOptions => ({ enabled: false, card_ids: [], badge_id: null, card_border: 'normal' });
const initialOptions = (): CommunityItemOptions => ({ enabled: true, card_ids: [], badge_id: null, card_border: 'foil', auto_foil: true });
const AUTO_BADGE_VALUE = '__gdl-auto-foil__';

export function shortcutCommunityItemSettingsHtml(): string {
	return `<details class="gdl-community-item-options gdl-native-section gdl-properties-category" hidden>
		<summary class="gdl-properties-category-summary">
			<span class="gdl-properties-category-copy">
				<span class="gdl-native-section-heading gdl-properties-category-title">${escapeHtml(gdlText('community_options_title', 'Trading cards and badges'))}</span>
				<span class="gdl-properties-category-description">${escapeHtml(gdlText('properties_community_description', 'Trading card collection and game badge.'))}</span>
			</span>
			<span class="gdl-properties-category-chevron" aria-hidden="true">›</span>
		</summary>
		<div class="gdl-properties-category-body">
			<div class="gdl-native-section-description">${escapeHtml(gdlText('community_options_desc', 'Choose which cards and badge this linked game displays locally. This does not add items or XP to your Steam account.'))}</div>
			<div class="gdl-community-options-content" hidden>
				<div class="gdl-native-setting-row">
					<label class="gdl-native-setting-title" for="gdl-community-card-border">${escapeHtml(gdlText('community_card_set', 'Card set'))}</label>
					<select id="gdl-community-card-border" class="gdl-community-card-border gdl-native-select">
						<option value="normal">${escapeHtml(gdlText('community_cards_normal', 'Normal cards'))}</option>
						<option value="foil">${escapeHtml(gdlText('community_cards_foil', 'Foil cards (silver border)'))}</option>
					</select>
				</div>
				<div class="gdl-community-card-summary gdl-native-section-description" aria-live="polite"></div>
				<div class="gdl-community-card-list" role="group" aria-label="${escapeHtml(gdlText('community_select_cards', 'Select cards to unlock locally'))}"></div>
				<div class="gdl-community-actions">
					<button class="gdl-community-all gdl-native-button" type="button">${escapeHtml(gdlText('community_cards_all', 'Unlock this set'))}</button>
					<button class="gdl-community-none gdl-native-button" type="button">${escapeHtml(gdlText('community_cards_none', 'Lock this set'))}</button>
				</div>
				<div class="gdl-native-setting-row gdl-community-badge-row">
					<label class="gdl-native-setting-title" for="gdl-community-badge">${escapeHtml(gdlText('community_badge', 'Badge'))}</label>
					<div class="gdl-community-badge-controls"><img class="gdl-community-badge-preview" alt="" hidden />
						<select id="gdl-community-badge" class="gdl-community-badge gdl-native-select"></select>
					</div>
				</div>
				<div class="gdl-native-section-description">${escapeHtml(gdlText('community_max_badge_hint', 'Choosing a maximum-level or foil badge completes its card set. Locking a card removes that badge.'))}</div>
				<div class="gdl-community-actions">
					<button class="gdl-community-real gdl-native-button" type="button">${escapeHtml(gdlText('community_use_steam', 'Use Steam data'))}</button>
				</div>
			</div>
			<div class="gdl-community-options-status gdl-native-status" role="status" aria-live="polite"></div>
			<button class="gdl-community-retry gdl-native-button" type="button" hidden>${escapeHtml(gdlText('community_retry', 'Retry'))}</button>
		</div>
	</details>`;
}

/** One settings lease per committed shortcut/link pair. No pending lookup or
 * manual AppID field can redirect these writes to a suggested game. */
export function bindShortcutCommunityItemSettings(context: ShortcutCommunityItemSettingsContext): { sync(): void; dispose(): void } {
	const { section } = context, doc = section.ownerDocument, view = doc.defaultView;
	const panel = section.querySelector<HTMLElement>('.gdl-community-item-options');
	if (!panel || !view) return { sync() {}, dispose() {} };
	const content = panel.querySelector<HTMLElement>('.gdl-community-options-content')!;
	const border = panel.querySelector<HTMLSelectElement>('.gdl-community-card-border')!;
	const list = panel.querySelector<HTMLElement>('.gdl-community-card-list')!;
	const summary = panel.querySelector<HTMLElement>('.gdl-community-card-summary')!;
	const badgeSelect = panel.querySelector<HTMLSelectElement>('.gdl-community-badge')!;
	const badgePreview = panel.querySelector<HTMLImageElement>('.gdl-community-badge-preview')!;
	const status = panel.querySelector<HTMLElement>('.gdl-community-options-status')!;
	const retry = panel.querySelector<HTMLButtonElement>('.gdl-community-retry')!;
	let disposed = false, identity = '', generation = 0, revision = 0, ready = false;
	let settingsReady = false, catalogReady = false, settingsPending = false, catalogPending = false;
	let settingsFailed = false, catalogFailed = false;
	let viewedBorder: CommunityItemOptions['card_border'] | null = null;
	let actionStatus: { text: string; error: boolean } | null = null;
	let shortcut = '', steam = '', catalog: SteamCommunityItemsCatalog | null = null;
	let options = initialOptions(), confirmed = initialOptions(), unsubscribe: (() => void) | null = null;
	let unsubscribeCatalog: (() => void) | null = null;
	let cardRows: Array<{ id: string; card: SteamCommunityCardAsset }> = [];
	let badgeRows: Array<{ id: string; badge: SteamCommunityBadgeAsset }> = [];
	type Save = { shortcut: string; steam: string; generation: number; revision: number; options: CommunityItemOptions };
	let queued: Save | null = null, saving = false, inFlight: Save | null = null;
	const live = (lease = generation): boolean => !disposed && section.isConnected && lease === generation
		&& context.shortcutAppId() === shortcut && context.steamAppId() === steam;
	const message = (text: string, error = false): void => { status.textContent = text; status.dataset.error = String(error); };
	const effectiveOptions = (): CommunityItemOptions => {
		if (options.auto_foil !== true) return options;
		const presentation = linkedCardPresentation(catalog, options);
		return { enabled: true, card_border: presentation.foil ? 'foil' : 'normal', card_ids: [...presentation.ownedIds],
			badge_id: presentation.badge ? communityBadgeId(presentation.badge) : null };
	};
	const missingSelectedBadge = (): boolean => {
		const selection = effectiveOptions();
		return selection.enabled && (Boolean(selection.badge_id) && !badgeRows.some(row => row.id === selection.badge_id)
			|| options.auto_foil === true && !selection.badge_id && catalog?.badges_complete !== true);
	};
	const showStatus = (): void => {
		if (!live()) return;
		// Empty partial responses and failed requests do not establish that a
		// game has no items. Check both complete sets, including foil definitions.
		panel.hidden = !identity || Boolean(catalogReady && !catalogFailed && !catalog?.error && !catalog?.transient_error && catalog?.loading !== true
			&& catalog?.cards_complete === true && catalog?.badges_complete === true
			&& !cardRows.length && !badgeRows.length);
		const missingCards = catalogReady && !visibleCards().length && catalog?.cards_complete !== true;
		const missingBadge = missingSelectedBadge();
		retry.hidden = !settingsFailed && !catalogFailed && (!(missingCards || missingBadge) || catalogLoading());
		retry.disabled = settingsFailed && settingsPending || (catalogFailed || missingCards || missingBadge) && catalogLoading();
		if (settingsFailed) message(gdlText('community_settings_load_failed', 'Could not load the saved selection. Retry before changing cards or badges.'), true);
		else if (!settingsReady) message(gdlText('community_settings_loading', 'Loading saved card and badge settings...'));
		else if (actionStatus && (actionStatus.error || saving || queued)) message(actionStatus.text, actionStatus.error);
		else if (catalogFailed) message(cardRows.length || badgeRows.length
			? gdlText('community_catalog_partial', 'Available items are shown. Could not update the complete card and badge catalogue. Retry to complete it.')
			: gdlText('community_catalog_load_failed', 'Could not load the card and badge catalogue. Try again.'), true);
		else if (!catalogReady || catalogPending && !cardRows.length && !badgeRows.length) message(gdlText('community_options_loading', 'Loading cards and badges...'));
		else if (missingCards) message(catalogLoading()
			? gdlText('community_cards_set_loading', 'The selected card set is still loading. Your saved selection is kept.')
			: gdlText('community_cards_set_unavailable', 'The selected card set has not loaded. Retry to complete it. Your saved selection is kept.'), !catalogLoading());
		else if (missingBadge) message(gdlText('community_badge_pending', 'Saved badge details are not available yet. Your saved selection is kept.'), !catalogLoading());
		else if (actionStatus) message(actionStatus.text, actionStatus.error);
		else if (!cardRows.length && !badgeRows.length) message(gdlText('community_options_empty', 'This game has no cards or badges available.'));
		else message(options.enabled ? gdlText('community_options_active', 'Local selection is active.') : gdlText('community_options_real', 'Currently using Steam data.'));
	};
	const maxedBadge = (badge: SteamCommunityBadgeAsset | undefined): boolean => !!badge && (badge.foil === true
		|| Number(badge.level || 0) >= Math.max(5, ...badgeRows.filter(row => !row.badge.foil).map(row => Number(row.badge.level || 0))));
	const selectedCardIds = (): Set<string> => {
		const selection = effectiveOptions();
		const ids = new Set(selection.card_ids), badge = selection.enabled ? badgeRows.find(row => row.id === selection.badge_id)?.badge : undefined;
		if (maxedBadge(badge)) for (const row of cardRows) if (Boolean(row.card.foil) === Boolean(badge!.foil)) ids.add(row.id);
		return ids;
	};
	const activeBorder = (): CommunityItemOptions['card_border'] => {
		const selection = effectiveOptions();
		return viewedBorder || (selection.enabled ? selection.card_border
			: cardRows.some(row => !row.card.foil) ? 'normal' : cardRows.some(row => row.card.foil) ? 'foil' : selection.card_border);
	};
	const visibleCards = () => cardRows.filter(row => (row.card.foil === true ? 'foil' : 'normal') === activeBorder());
	const catalogLoading = (): boolean => catalogPending || catalog?.loading === true;
	const buildRows = (): void => {
		const cards = [...(catalog?.cards || []), ...(catalog?.foil_cards || []).map(card => ({ ...card, foil: true }))];
		const seen = new Set<string>();
		cardRows = cards.flatMap(card => {
			const id = communityCardId(card);
			if (!id || seen.has(id)) return [];
			seen.add(id); return [{ id, card }];
		});
		const badgeSeen = new Set<string>();
		badgeRows = [...(catalog?.badges || []), ...(catalog?.foil_badge ? [catalog.foil_badge] : [])].flatMap(badge => {
			const id = communityBadgeId(badge);
			if (!id || badgeSeen.has(id)) return [];
			badgeSeen.add(id); return [{ id, badge }];
		});
	};
	const render = (): void => {
		if (!live() || !catalogReady) return;
		ready = settingsReady;
		content.hidden = false;
		border.disabled = !ready;
		badgeSelect.disabled = !ready;
		border.value = activeBorder();
		for (const option of border.options) option.disabled = catalog?.cards_complete === true && option.value !== activeBorder()
			&& !cardRows.some(row => (row.card.foil ? 'foil' : 'normal') === option.value);
		const focused = doc.activeElement instanceof view.HTMLInputElement ? (doc.activeElement as HTMLInputElement).dataset.cardId : undefined;
		const visible = visibleCards(), unlocked = selectedCardIds(), selection = effectiveOptions();
		const fragment = doc.createDocumentFragment();
		for (const row of visible) {
			const label = doc.createElement('label'); label.className = 'gdl-community-card-choice';
			const input = doc.createElement('input'); input.type = 'checkbox'; input.dataset.cardId = row.id;
			input.disabled = !ready;
			input.checked = selection.enabled && unlocked.has(row.id);
			const image = doc.createElement('img'); image.src = row.card.image; image.alt = ''; image.loading = 'lazy';
			const title = doc.createElement('span'); title.textContent = row.card.title;
			label.append(input, image, title); fragment.append(label);
		}
		list.replaceChildren(fragment);
		if (focused) Array.from(list.querySelectorAll<HTMLInputElement>('input[data-card-id]')).find(input => input.dataset.cardId === focused)?.focus({ preventScroll: true });
		summary.textContent = visible.length ? gdlText('community_cards_selected', '{count} of {total} cards selected', {
			count: selection.enabled ? visible.filter(row => unlocked.has(row.id)).length : 0, total: visible.length,
		}) : catalog?.cards_complete === true ? gdlText('community_cards_empty', 'No cards are available for this set.')
			: catalogLoading() ? gdlText('community_cards_set_loading', 'The selected card set is still loading. Your saved selection is kept.')
				: gdlText('community_cards_set_unavailable', 'The selected card set has not loaded. Retry to complete it. Your saved selection is kept.');
		for (const button of panel.querySelectorAll<HTMLButtonElement>('.gdl-community-all,.gdl-community-none')) button.disabled = !ready || !visible.length;
		panel.querySelector<HTMLButtonElement>('.gdl-community-real')!.disabled = !ready;
		badgeSelect.replaceChildren();
		const none = doc.createElement('option'); none.value = ''; none.textContent = gdlText('community_badge_none', 'No local badge'); badgeSelect.append(none);
		for (const row of badgeRows) {
			const option = doc.createElement('option'); option.value = row.id;
			const detail = row.badge.foil ? gdlText('community_badge_foil', 'Foil')
				: gdlText('community_badge_level', 'Level {level}', { level: row.badge.level || 1 });
			option.textContent = `${row.badge.title} — ${detail}`; badgeSelect.append(option);
		}
		if (selection.enabled && selection.badge_id && !badgeRows.some(row => row.id === selection.badge_id)) {
			const pending = doc.createElement('option'); pending.value = selection.badge_id;
			pending.textContent = gdlText('community_badge_saved_pending', 'Saved badge (details not loaded)'); pending.disabled = true; badgeSelect.append(pending);
		}
		const automaticBadge = options.auto_foil === true && !selection.badge_id;
		if (automaticBadge) {
			const pending = doc.createElement('option'); pending.value = AUTO_BADGE_VALUE;
			pending.textContent = gdlText('community_badge_auto', 'Automatic foil badge'); pending.disabled = true; badgeSelect.append(pending);
		}
		badgeSelect.value = automaticBadge ? AUTO_BADGE_VALUE : selection.enabled ? selection.badge_id || '' : '';
		const selectedBadge = selection.enabled ? badgeRows.find(row => row.id === selection.badge_id)?.badge : null;
		badgePreview.hidden = !selectedBadge;
		if (selectedBadge) badgePreview.src = selectedBadge.image;
		else badgePreview.removeAttribute('src');
		showStatus();
	};
	const flush = async (): Promise<void> => {
		if (saving) return;
		saving = true;
		try {
			while (queued) {
				const intent = queued; queued = null; inFlight = intent;
				try {
					const saved = await setCommunityItemOptions(doc, intent.shortcut, intent.steam, intent.options);
					if (live(intent.generation)) {
						confirmed = saved;
						if (revision === intent.revision) {
							options = saved; actionStatus = { text: gdlText('community_options_saved', 'Local selection saved.'), error: false }; render();
						}
					}
				} catch {
					if (live(intent.generation) && revision === intent.revision) {
						options = confirmed;
						actionStatus = { text: gdlText('community_options_save_failed', 'Could not save the local selection. Try again.'), error: true }; render();
					}
				}
			}
		} finally { saving = false; inFlight = null; }
	};
	const save = (next: CommunityItemOptions): void => {
		if (!ready || !live()) return;
		viewedBorder = null;
		const { auto_foil: _automatic, ...manual } = next;
		options = { ...manual, card_ids: [...manual.card_ids] }; revision++;
		queued = { shortcut, steam, generation, revision, options };
		actionStatus = { text: gdlText('community_options_saving', 'Saving local selection...'), error: false }; render(); void flush();
	};
	const applyCatalog = (value: SteamCommunityItemsCatalog, lease: number): void => {
		if (!live(lease)) return;
		catalog = value; catalogReady = true; catalogFailed = Boolean(value.error || value.transient_error);
		buildRows();
		render();
	};
	const loadCatalog = (lease: number, refresh = false): void => {
		catalogPending = true; catalogFailed = false; showStatus();
		void getOfficialCommunityItems(doc, steam, undefined, { refresh }).then(value => {
			if (!live(lease)) return;
			catalogPending = false;
			// The first-available promise may have resolved before a newer native
			// definition event. Do not roll that live catalogue back to its first page.
			if (value) applyCatalog(getImmediateOfficialCommunityItems(doc, steam) || value, lease);
			else { catalogReady = true; catalogFailed = true; render(); }
			showStatus();
		}).catch(error => {
			if (!live(lease)) return;
			catalogPending = false; catalogFailed = true;
			backendLog('Community catalogue load failed for ' + shortcut + ':' + steam + ': ' + String(error));
			showStatus();
		});
	};
	const applySettings = (value: CommunityItemOptions, lease: number): void => {
		if (!live(lease)) return;
		confirmed = value; settingsReady = true; settingsFailed = false;
		if (!queued && inFlight?.generation !== lease) options = value;
		render(); showStatus();
	};
	const loadSettings = (lease: number): void => {
		settingsPending = true; settingsFailed = false; showStatus();
		void getCommunityItemOptions(doc, shortcut, steam).then(value => {
			if (!live(lease)) return;
			settingsPending = false; applySettings(value, lease);
		}).catch(error => {
			if (!live(lease)) return;
			settingsPending = false; settingsFailed = true; settingsReady = false; ready = false;
			backendLog('Community saved selection load failed for ' + shortcut + ':' + steam + ': ' + String(error));
			render(); showStatus();
		});
	};
	const sync = (): void => {
		if (disposed) return;
		const nextShortcut = context.shortcutAppId(), nextSteam = context.steamAppId();
		const key = /^[1-9]\d*$/.test(nextShortcut) && /^[1-9]\d*$/.test(nextSteam) ? nextShortcut + ':' + nextSteam : '';
		if (identity === key && generation > 0) return;
		identity = key; shortcut = nextShortcut; steam = nextSteam; generation++; revision = 0; queued = null; ready = false;
		settingsReady = false; catalogReady = false; settingsPending = false; catalogPending = false;
		settingsFailed = false; catalogFailed = false; actionStatus = null; catalog = null; viewedBorder = null;
		cardRows = []; badgeRows = [];
		options = getCachedCommunityItemOptions(doc, shortcut, steam) || initialOptions(); confirmed = initialOptions();
		unsubscribe?.(); unsubscribeCatalog?.(); unsubscribe = null; unsubscribeCatalog = null;
		panel.hidden = !key; content.hidden = true; retry.hidden = true;
		if (!key) return;
		const lease = generation;
		unsubscribe = subscribeCommunityItemOptions(doc, shortcut, steam, value => applySettings(value, lease));
		unsubscribeCatalog = subscribeOfficialCommunityItems(doc, steam, value => applyCatalog(value, lease));
		const immediate = getImmediateOfficialCommunityItems(doc, steam);
		if (immediate) applyCatalog(immediate, lease);
		loadSettings(lease); loadCatalog(lease);
	};
	const change = (event: Event): void => {
		const target = event.target as HTMLInputElement | HTMLSelectElement;
		if (!ready || !live()) return;
		const selection = effectiveOptions();
		if (target === border) {
			const requested = border.value === 'foil' ? 'foil' : 'normal';
			// Browsing an incomplete collection must not persist an empty override
			// that replaces usable Steam cards while definitions are still arriving.
			if (!cardRows.some(row => (row.card.foil ? 'foil' : 'normal') === requested)) { viewedBorder = requested; render(); }
			else save({ ...selection, enabled: true, card_border: requested, badge_id: selection.badge_id
				&& selection.badge_id.startsWith('badge:' + (requested === 'foil' ? 'normal' : 'foil') + ':') ? null : selection.badge_id });
		}
		else if (target === badgeSelect) {
			const badge = badgeRows.find(row => row.id === badgeSelect.value)?.badge;
			const nextBorder = badge ? badge.foil ? 'foil' : 'normal' : activeBorder();
			const ids = selectedCardIds();
			if (maxedBadge(badge)) for (const row of cardRows.filter(row => (row.card.foil ? 'foil' : 'normal') === nextBorder)) ids.add(row.id);
			save({ ...selection, enabled: true, badge_id: badgeSelect.value || null, card_ids: [...ids], card_border: nextBorder });
		} else if (target.matches('input[data-card-id]')) {
			const ids = selectedCardIds(), id = target.dataset.cardId!;
			const checked = (target as HTMLInputElement).checked;
			if (checked) ids.add(id); else ids.delete(id);
			const resetBadge = !checked && maxedBadge(badgeRows.find(row => row.id === selection.badge_id)?.badge);
			save({ ...selection, enabled: true, card_border: activeBorder(), card_ids: [...ids], badge_id: resetBadge ? null : selection.badge_id });
		}
	};
	const click = (event: MouseEvent): void => {
		const target = (event.target as Element).closest('button');
		if (!target || !panel.contains(target)) return;
		if (target === retry) {
			if (!live()) return;
			if (settingsFailed && !settingsPending) loadSettings(generation);
			if ((catalogFailed || catalog?.cards_complete !== true && !visibleCards().length || missingSelectedBadge()) && !catalogLoading()) loadCatalog(generation, true);
			return;
		}
		if (!ready || !live()) return;
		if (target.matches('.gdl-community-real')) save(steamDataOptions());
		else if (target.matches('.gdl-community-all,.gdl-community-none')) {
			const selection = effectiveOptions();
			const ids = selectedCardIds(), unlock = target.matches('.gdl-community-all');
			for (const row of visibleCards()) { if (unlock) ids.add(row.id); else ids.delete(row.id); }
			const resetBadge = !unlock && maxedBadge(badgeRows.find(row => row.id === selection.badge_id)?.badge);
			save({ ...selection, enabled: true, card_border: activeBorder(), card_ids: [...ids], badge_id: resetBadge ? null : selection.badge_id });
		}
	};
	panel.addEventListener('change', change); panel.addEventListener('click', click);
	const observer = new view.MutationObserver(() => { if (!section.isConnected) dispose(); });
	observer.observe(doc.body, { childList: true, subtree: true });
	const dispose = (): void => {
		if (disposed) return;
		disposed = true; generation++; unsubscribe?.(); unsubscribeCatalog?.(); unsubscribe = null; unsubscribeCatalog = null; observer.disconnect();
		panel.removeEventListener('change', change); panel.removeEventListener('click', click); view.removeEventListener('pagehide', dispose);
	};
	view.addEventListener('pagehide', dispose); sync();
	return { sync, dispose };
}

