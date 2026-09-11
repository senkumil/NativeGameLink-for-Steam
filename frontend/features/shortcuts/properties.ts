import type { ShortcutDetectionCandidate, ShortcutDetectionContext } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { escapeHtml, templateToRegex } from '../../core/text';
import { gdlText, loc, setLocalizationDocumentProvider, steamLanguageSync } from '../../steam/localization';
import { getCachedGameData, getGameData } from '../../core/game-data';
import { findActiveShortcutAppId, findShortcutAppIdByName, shortcutPathBasename } from '../../steam/shortcuts';
import { shortcutRuntimeHost } from './host';
import { findMappingForShortcut } from './registry';
import { buildShortcutDetectionContext, detectShortcutCandidatesLocal, enrichShortcutCandidatesRemote, mergeCandidateLists } from './detection';
import { subscribeMappings } from '../../core/mappings';
import { linkShortcutToSteam, shouldAutoApplyNoLauncher } from './linking';
import { unlinkShortcutFromSteam } from './unlinking';
import { undismissShortcut } from './dismissed';
import { rememberedShortcutSteamAppId } from './link-history';
import { bindShortcutAchievementSettings, shortcutAchievementSettingsHtml } from './achievement-properties';
import { bindShortcutPlaytimeProperties, shortcutPlaytimePropertiesHtml } from './playtime-properties';
import { tryInjectNativePropertiesField } from './native-properties';
import { tryInjectCustomizationArtwork } from './customization-artwork';
import { cancelPendingLinkJobs, enqueueLinkJob, hasPendingLinkJob, stageLinkJobForRecovery } from './link-job-queue';
import { SHORTCUT_PROPERTIES_STYLE } from './properties-style';
const GDL_PROP = 'gdl-properties-injected';

export function mutationMayContainProperties(roots: Iterable<Node>): boolean {
	for (const root of roots) {
		if (root instanceof Element) {
			const className = String(root.className || '');
			if (/PagedSettingsDialog|pagedsettings|SettingsNav|DialogNav|Modal|DialogContent|DialogBody|properties|shortcut|customization/i.test(className)) {
				return true;
			}
			if (root.querySelector?.('[class*="PagedSettingsDialog"], [class*="pagedsettings"], [class*="SettingsNav"], [class*="DialogNav"], [class*="Modal"], [class*="DialogContent"], [class*="DialogBody"], input[type="text"]')) {
				return true;
			}
		}
	}
	return false;
}

export function tryInjectPropertiesField(doc: Document, popupTitle: string): void {
	if (!doc || !doc.body) return;
	setLocalizationDocumentProvider(() => doc);
	if (doc.querySelector(`.${GDL_PROP}`) || doc.querySelector('.gdl-native-properties-injected')) return;

	const vrPhrases = [
		loc('AppProperties_Shortcut_InVR', 'Include in VR Library').toLowerCase(),
		'include in vr library', 'incluir en la biblioteca de rv', 'incluir en la biblioteca vr',
		'in vr-bibliothek aufnehmen', 'inclure dans la bibliothèque vr', 'includi nella libreria vr',
		'включить в библиотеку vr', 'включить в библиотеку', '加入 vr 库', 'vr 라이브러리에 포함',
	];
	const targetPhrases = [
		loc('AppProperties_Shortcut_TargetExecutable', 'Target').toLowerCase(),
		loc('AppProperties_Shortcut_StartDir', 'Start In').toLowerCase(),
		'target', 'destino', 'cible', 'ziel', 'destinazione', 'объект',
		'start in', 'iniciar en', 'iniciar em', 'démarrer dans', 'ausführen in', 'inizia in', 'начать в', 'рабочая папка', 'iniciar em',
	];
	const generalPhrases = [
		loc('AppProperties_LaunchOptions', 'Launch Options').toLowerCase(),
		loc('AppProperties_LaunchOptions_Description', 'Advanced users may choose to enter modifications to their launch options.').toLowerCase(),
		loc('AppProperties_EnableOverlay', 'Enable the Steam Overlay while in-game').toLowerCase(),
		'launch options', 'configuraciones de lanzamiento', 'parámetros de lanzamiento', 'opciones de lanzamiento',
		'startoptionen', 'options de lancement', 'opzioni di avvio', 'параметры запуска',
		'steam cloud', 'habilitar la interfaz superpuesta', 'ativar a sobreposição steam', 'activer la superposition steam', 'enable the steam overlay',
	];

	const searchRoot = doc.querySelector<HTMLElement>('.DialogContent, [class*="PagedSettingsDialog"], [class*="ModalDialog"], [class*="pagedsettings"], [class*="DialogBody"], [role="dialog"], [aria-modal="true"]') || doc.body || doc.documentElement;
	const walker = doc.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, null);
	let tn: Text | null;
	let anchor: Element | null = null;
	let foundShortcutOnlyField = false;
	let foundGeneralField = false;
	while ((tn = walker.nextNode() as Text | null)) {
		const txt = (tn.textContent || '').trim().toLowerCase();
		if (!txt) continue;
		if (vrPhrases.some(p => txt === p || (p.length > 5 && txt.includes(p)))) {
			foundShortcutOnlyField = true;
			if (tn.parentElement) { anchor = tn.parentElement; break; }
		} else if (targetPhrases.some(p => txt === p)) {
			foundShortcutOnlyField = true;
			if (tn.parentElement && !anchor) anchor = tn.parentElement;
		} else if (generalPhrases.some(p => txt === p || (p.length > 6 && txt.includes(p)))) {
			foundGeneralField = true;
			if (tn.parentElement && !anchor) anchor = tn.parentElement;
		}
	}

	if ((!foundShortcutOnlyField && !foundGeneralField) || !anchor) return;

	// Walk up to the dialog's content container. Steam's current properties
	// dialog sometimes scrolls through a custom wrapper whose computed
	// overflowY is "visible", so requiring auto/scroll here makes the whole
	// panel disappear even though the Shortcut tab was detected correctly.
	// Keep the scrollable-container preference, but retain the nearest useful
	// ancestor as the backup behavior used by the original working build.
	let container: Element | null = null;
	let fallbackContainer: Element | null = anchor.parentElement;
	let cur: Element | null = anchor;
	for (let i = 0; i < 15 && cur && cur.parentElement && cur !== doc.body; i++) {
		const parent = cur.parentElement;
		if (parent === doc.body) break;
		cur = parent;
		fallbackContainer = cur;
		try {
			const style = (cur.ownerDocument?.defaultView || window).getComputedStyle(cur);
			const element = cur as HTMLElement;
			const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && element.clientHeight > 0;
			const isModalBody = cur.className && String(cur.className).includes('Modal');
			if (isScrollable || isModalBody) {
				container = cur;
				break;
			}
		} catch {}
	}
	if (!container) container = fallbackContainer;
	if (!container) return;

	// ── Extract game title ─────────────────────────────────────────────
	let gameTitle: string | null = null;

	// Window title template is localized, e.g. "Properties - %1$s" / "Eigenschaften: %1$s"
	const propsTitleRx = templateToRegex(loc('AppProperties_Title', 'Properties - %1$s'), true);
	const extractTitle = (raw: string | null | undefined): string | null => {
		const t = raw?.trim();
		if (!t || t === 'Steam') return null;
		const m = propsTitleRx ? t.match(propsTitleRx) : null;
		if (m && m[1]) return m[1].trim();
		if (/^properties$/i.test(t)) return null;
		return t.replace(/^(?:properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|свойства|属性|プロパティ|속성|właściwości|özellikler)\s*[-–—:]\s*/i, '').trim() || t;
	};

	// 1. Popup title - for Properties windows this is typically the game name
	gameTitle = extractTitle(popupTitle);

	// 2. Document title
	if (!gameTitle) gameTitle = extractTitle(doc.title);

	// 3. Look for the shortcut name text input (top input in the Shortcut tab next to game icon)
	if (!gameTitle) {
		const allInputs = Array.from(doc.querySelectorAll('input[type="text"], input:not([type])'));
		for (const inp of allInputs) {
			const val = (inp as HTMLInputElement).value?.trim();
			if (val && !val.includes(':\\') && !val.includes(':/') && !val.startsWith('-') && !val.startsWith('"') && !(inp as HTMLElement).classList.contains('gdl-appid-input')) {
				gameTitle = val;
				break;
			}
		}
	}

	// 4. Search the dialog for the game name header text
	if (!gameTitle) {
		const tabNames = [
			loc('AppProperties_General', 'General').toLowerCase(),
			loc('AppProperties_Compatibility', 'Compatibility').toLowerCase(),
			loc('AppProperties_Updates', 'Updates').toLowerCase(),
			loc('AppProperties_InstalledFiles', 'Installed Files').toLowerCase(),
			loc('AppProperties_Language', 'Language').toLowerCase(),
			loc('AppProperties_Betas', 'Betas').toLowerCase(),
			loc('AppProperties_Controller', 'Controller').toLowerCase(),
			loc('AppProperties_DLC', 'DLC').toLowerCase(),
			loc('AppProperties_Workshop', 'Workshop').toLowerCase(),
			loc('AppProperties_Shortcuts', 'Shortcut').toLowerCase(),
			loc('AppProperties_GameRecording', 'Game Recording').toLowerCase(),
			loc('AppProperties_Customization', 'Customization').toLowerCase(),
		];
		const ignoredLabels = new Set([
			'properties', 'propiedades', 'propriedades', 'propriétés', 'eigenschaften', 'proprietà', 'свойства', '属性', 'プロパティ', '속성',
			'target', 'start in', 'search', 'browse', 'destino', 'iniciar en', 'iniciar em', 'buscar', 'explorar', 'цель', 'поиск', 'обзор',
		]);
		const textWalker = doc.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, null);
		let tNode: Text | null;
		while ((tNode = textWalker.nextNode() as Text | null)) {
			const t = tNode.textContent?.trim();
			if (t && t.length > 1 && !tabNames.includes(t.toLowerCase()) && !ignoredLabels.has(t.toLowerCase())) {
				const parent = tNode.parentElement;
				if (parent && (parent.closest('[class*="Title"], [class*="Header"]') || parent.tagName === 'H1' || parent.tagName === 'H2' || parent.tagName === 'B')) {
					const cleaned = t.replace(/^(?:properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|свойства|属性|プロパティ|속성|właściwości|özellikler)\s*[-–—:]\s*/i, '').trim();
					if (cleaned) { gameTitle = cleaned; break; }
				}
			}
		}
	}

	if (!gameTitle) {
		const notice = shortcutRuntimeHost().findNonSteamNotice(doc);
		if (notice?.title) gameTitle = notice.title;
	}

	if (!gameTitle) return;

	if (!foundShortcutOnlyField) {
		tryInjectNativePropertiesField(doc, gameTitle, container);
		// Artwork belongs to Steam's Personalización tab, never to the native
		// General/Direct access sections injected above.
		tryInjectCustomizationArtwork(doc, popupTitle, gameTitle);
		return;
	}
	// The shortcut controls are mounted in Acceso directo. The artwork picker
	// is deliberately mounted separately by the Personalización observer.
	tryInjectCustomizationArtwork(doc, popupTitle, gameTitle);

	const initialShortcutId = findActiveShortcutAppId(doc, gameTitle) || (findShortcutAppIdByName(gameTitle) ? String(findShortcutAppIdByName(gameTitle)) : null);
	let managedShortcutId = initialShortcutId ? Number(initialShortcutId) : null;
	const currentRaw = findMappingForShortcut(initialShortcutId, gameTitle) || '';
	let currentLinked = /^\d+$/.test(currentRaw) ? currentRaw : '';
	const rememberedAppId = rememberedShortcutSteamAppId(managedShortcutId);
	const initialAppId = currentLinked || rememberedAppId;

	const cachedGame = initialAppId ? getCachedGameData(initialAppId, steamLanguageSync() || 'english')?.data : null;
	const initialGameName = cachedGame?.name || gameTitle;
	const initialHeaderUrl = cachedGame?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${initialAppId}/header.jpg`;

	const initialOptionHtml = initialAppId
		? `<option value="${escapeHtml(initialAppId)}">${escapeHtml(currentLinked ? `${initialGameName} — AppID ${initialAppId}` : (cachedGame?.name ? `${initialGameName} — AppID ${initialAppId}` : `Steam AppID ${initialAppId}`))}</option>`
		: `<option value="">${escapeHtml(gdlText('detecting_game', 'Detecting the game automatically...'))}</option>`;

	// Build UI section
	const section = doc.createElement('div');
	section.className = GDL_PROP;
	section.style.cssText = 'padding:0 24px 24px;margin-top:16px;font-family:inherit;';

	section.innerHTML = `
		${SHORTCUT_PROPERTIES_STYLE}
		<div class="gdl-native-section gdl-link-section">
			<div class="gdl-native-section-heading">${escapeHtml(gdlText('linked_title', 'Linked game'))}</div>
			<div class="gdl-native-section-description">${escapeHtml(gdlText('linked_description', 'Paste a Steam AppID or Steam store link to show game information on this library page.'))}</div>
			<div class="gdl-auto-detect gdl-native-disclosure">
				<div class="gdl-auto-detect-header">
					<span>${escapeHtml(gdlText('shortcut_suggestions_title', 'Steam AppID suggestions:'))}</span>
				</div>
				<div class="gdl-native-disclosure-body">
					<div class="gdl-auto-detect-title" style="display:none;"></div>
					<select class="gdl-auto-candidates gdl-native-select">
						${initialOptionHtml}
					</select>
					<div class="gdl-auto-candidate-preview" style="display:none;"></div>
				</div>
			</div>
			<div class="gdl-native-setting-row gdl-link-actions">
				<div class="gdl-native-setting-copy">
					<div class="gdl-native-setting-title">Steam AppID</div>
					<div class="gdl-native-setting-description">${escapeHtml(gdlText('appid_placeholder', 'Steam AppID or Steam store link'))}</div>
				</div>
				<div class="gdl-native-controls">
					<input class="gdl-appid-input gdl-native-input" type="text" placeholder="${escapeHtml(gdlText('appid_placeholder', 'Steam AppID or Steam store link'))}" value="${escapeHtml(initialAppId)}" />
					<button class="gdl-save-btn gdl-native-button gdl-native-button-primary" type="button">${escapeHtml(gdlText('link_button', 'Link'))}</button>
					<button class="gdl-unlink-btn gdl-native-button" type="button" ${currentLinked ? '' : 'disabled'} style="color:${currentLinked ? '#dcdedf' : '#68737f'};cursor:${currentLinked ? 'pointer' : 'default'};opacity:${currentLinked ? '1' : '.65'};">${escapeHtml(currentLinked ? gdlText('unlink', 'Unlink') : gdlText('game_unlinked_status', 'Unlinked'))}</button>
				</div>
			</div>
			<div class="gdl-status gdl-native-status" aria-live="polite"></div>
			${shortcutPlaytimePropertiesHtml()}
			<label class="gdl-skip-launcher gdl-native-option">
				<input class="gdl-skip-launcher-input" type="checkbox" />
				<span><strong>${escapeHtml(gdlText('skip_launcher', 'Try to skip the launcher'))}</strong><br />${escapeHtml(gdlText('skip_launcher_help', 'Adds -nolauncher while preserving your current launch options. Enable it only if this game supports that argument.'))}</span>
			</label>
			<label class="gdl-tracking-executable gdl-native-option">
				<input class="gdl-tracking-executable-input" type="checkbox" />
				<span class="gdl-tracking-executable-copy"></span>
			</label>
		</div>
		${shortcutAchievementSettingsHtml()}
	`;

	container.appendChild(section);

	const input = section.querySelector('.gdl-appid-input') as HTMLInputElement;
	const saveBtn = section.querySelector('.gdl-save-btn') as HTMLButtonElement;
	const unlinkBtn = section.querySelector('.gdl-unlink-btn') as HTMLButtonElement;
	const statusEl = section.querySelector('.gdl-status') as HTMLElement;
	const autoTitle = section.querySelector('.gdl-auto-detect-title') as HTMLElement;
	const autoSelect = section.querySelector('.gdl-auto-candidates') as HTMLSelectElement;
	const candidatePreview = section.querySelector('.gdl-auto-candidate-preview') as HTMLElement;
	const skipLauncherLabel = section.querySelector('.gdl-skip-launcher') as HTMLElement;
	const skipLauncherInput = section.querySelector('.gdl-skip-launcher-input') as HTMLInputElement;
	const trackingExecutableLabel = section.querySelector('.gdl-tracking-executable') as HTMLElement;
	const trackingExecutableInput = section.querySelector('.gdl-tracking-executable-input') as HTMLInputElement;
	const trackingExecutableCopy = section.querySelector('.gdl-tracking-executable-copy') as HTMLElement;
	let detectionContext: ShortcutDetectionContext | null = null;
	let achievementBinding: { sync: (appId?: string) => void } | null = null;
	let playtimeBinding: { sync: (shortcutAppId?: string | number) => void } | null = null;
	let currentCandidates: ShortcutDetectionCandidate[] = [];
	let linkedPreviewCandidate: ShortcutDetectionCandidate | null = initialAppId ? { name: initialGameName, appid: initialAppId, image: initialHeaderUrl, score: 100, confidence: 'exact' } : null;
	let suggestionUserInteracted = false;
	let targetInputUserEdited = false;
	let propertyActionBusy: 'link' | 'unlink' | null = null;
	let targetRevision = 0;
	const clearTargetStatus = (): void => { targetRevision += 1; statusEl.textContent = ''; statusEl.style.color = '#8f98a0'; };

	const candidateForPreview = (candidates: ShortcutDetectionCandidate[], selectedAppId: string): ShortcutDetectionCandidate | null => {
		const exact = candidates.find(candidate => candidate.appid === selectedAppId);
		if (exact) return exact;
		if (linkedPreviewCandidate?.appid === selectedAppId) return linkedPreviewCandidate;
		return null;
	};

	const renderCandidatePreview = (candidates: ShortcutDetectionCandidate[], selectedAppId: string): void => {
		if (!candidatePreview || !Array.isArray(candidates)) return;
		const selected = candidateForPreview(candidates, selectedAppId);
		if (!selected) {
			candidatePreview.style.display = 'none';
			candidatePreview.replaceChildren();
			return;
		}
		candidatePreview.style.display = 'block';
		const confLabel = selected.confidence === 'exact' || selected.confidence === 'high' ? 'HIGH' : (selected.confidence === 'medium' ? 'MEDIUM' : 'LOW');
		const reasonsList = (selected.reasons || []).slice(0, 2).map(r => {
			if (r === 'official_executable_match') return gdlText('reason_exe_match', 'Executable match');
			if (r === 'pe_product_exact') return gdlText('reason_pe_match', 'PE metadata');
			if (r === 'official_title_exact' || r === 'title_exact') return gdlText('reason_title_match', 'Exact title');
			if (r === 'year_match') return gdlText('reason_year_match', 'Matching year');
			return '';
		}).filter(Boolean);
		const warningList = (selected.negative_reasons || []).map(r => {
			if (r === 'year_mismatch') return gdlText('warn_year', 'Different year');
			if (r === 'sequel_mismatch') return gdlText('warn_sequel', 'Different sequel');
			if (r === 'remake_mismatch') return gdlText('warn_remake', 'Different version');
			return '';
		}).filter(Boolean);
		const metaSummary = [...reasonsList, ...warningList].join(' · ');
		candidatePreview.innerHTML = `
			<div class="gdl-candidate-primary">
				<img class="gdl-auto-candidate-primary-image" alt="" />
				<div style="min-width:0;">
					<div class="gdl-candidate-name">${escapeHtml(selected.name)}</div>
					<div class="gdl-candidate-meta">Steam AppID ${escapeHtml(selected.appid)}${selected.score ? ` · ${Math.round(selected.score)}%` : ''} · <strong>[${escapeHtml(confLabel)}]</strong></div>
					${metaSummary ? `<div style="font-size:11px;color:#8f98a0;margin-top:2px;">${escapeHtml(metaSummary)}</div>` : ''}
				</div>
			</div>
			<div class="gdl-auto-candidate-strip"></div>`;
		const bindImageFallback = (img: HTMLImageElement, appId: string) => {
			let attempt = 0;
			img.addEventListener('error', () => {
				attempt += 1;
				if (attempt === 1) img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
				else if (attempt === 2) img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
				else img.style.visibility = 'hidden';
			});
		};
		const primary = candidatePreview.querySelector<HTMLImageElement>('.gdl-auto-candidate-primary-image');
		if (primary) {
			bindImageFallback(primary, selected.appid);
			primary.src = selected.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${selected.appid}/header.jpg`;
		}
		const strip = candidatePreview.querySelector<HTMLElement>('.gdl-auto-candidate-strip');
		const previewCandidates = [selected, ...candidates]
			.filter((candidate, index, list) => list.findIndex(item => item.appid === candidate.appid) === index)
			.slice(0, 6);
		for (const candidate of previewCandidates) {
			const button = doc.createElement('button');
			button.type = 'button';
			button.title = `${candidate.name} — AppID ${candidate.appid}`;
			button.setAttribute('aria-label', button.title);
			button.style.cssText = `position:relative;width:84px;height:39px;flex:0 0 84px;padding:0;overflow:hidden;border-radius:2px;background:#10141a;border:${candidate.appid === selected.appid ? '2px solid #66c0f4' : '1px solid rgba(255,255,255,.14)'};cursor:pointer;`;
			const image = doc.createElement('img');
			image.className = '';
			image.alt = '';
			image.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;';
			bindImageFallback(image, candidate.appid);
			image.src = candidate.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${candidate.appid}/header.jpg`;
			button.appendChild(image);
			button.addEventListener('click', () => {
				suggestionUserInteracted = true;
				targetInputUserEdited = false;
				autoSelect.value = candidate.appid;
				input.value = candidate.appid;
				clearTargetStatus();
				autoTitle.textContent = gdlText('detected_game', 'Detected: {name}. Review the result and press Link to link it.', { name: candidate.name });
				renderCandidatePreview(candidates, candidate.appid);
				updateButtonStates();
				achievementBinding?.sync(candidate.appid);
			});
			strip?.appendChild(button);
		}
	};

	const updateButtonStates = (): void => {
		const val = input.value.trim();
		const isSameAppIdLinked = Boolean(currentLinked && val === currentLinked);
		if (propertyActionBusy) {
			const linking = propertyActionBusy === 'link';
			saveBtn.disabled = true;
			unlinkBtn.disabled = true;
			saveBtn.textContent = linking ? gdlText('bulk_linking_short', 'Linking...') : gdlText('link_button', 'Link');
			unlinkBtn.textContent = !linking ? gdlText('bulk_unlinking_short', 'Unlinking...') : (currentLinked ? gdlText('unlink', 'Unlink') : gdlText('game_unlinked_status', 'Unlinked'));
			for (const button of [saveBtn, unlinkBtn]) {
				button.style.background = '#3d4450';
				button.style.color = '#8f98a0';
				button.style.cursor = 'wait';
				button.style.opacity = '.72';
			}
			return;
		}
		if (isSameAppIdLinked) {
			saveBtn.disabled = true;
			saveBtn.textContent = gdlText('game_linked_status', 'Linked');
			saveBtn.style.background = '#3d4450';
			saveBtn.style.color = '#8f98a0';
			saveBtn.style.cursor = 'default';
			saveBtn.style.opacity = '.65';

			unlinkBtn.disabled = false;
			unlinkBtn.textContent = gdlText('unlink', 'Unlink');
			unlinkBtn.style.background = '#3d4450';
			unlinkBtn.style.color = '#dcdedf';
			unlinkBtn.style.cursor = 'pointer';
			unlinkBtn.style.opacity = '1';
		} else {
			saveBtn.disabled = false;
			saveBtn.textContent = gdlText('link_button', 'Link');
			saveBtn.style.background = '#1a9fff';
			saveBtn.style.color = '#fff';
			saveBtn.style.cursor = 'pointer';
			saveBtn.style.opacity = '1';

			if (currentLinked) {
				unlinkBtn.disabled = false;
				unlinkBtn.textContent = gdlText('unlink', 'Unlink');
				unlinkBtn.style.background = '#3d4450';
				unlinkBtn.style.color = '#dcdedf';
				unlinkBtn.style.cursor = 'pointer';
				unlinkBtn.style.opacity = '1';
			} else {
				unlinkBtn.disabled = true;
				unlinkBtn.textContent = gdlText('game_unlinked_status', 'Unlinked');
				unlinkBtn.style.background = '#3d4450';
				unlinkBtn.style.color = '#68737f';
				unlinkBtn.style.cursor = 'default';
				unlinkBtn.style.opacity = '.65';
			}
		}
	};

	updateButtonStates();
	if (initialAppId) {
		currentCandidates = linkedPreviewCandidate ? [linkedPreviewCandidate] : [];
		renderCandidatePreview(currentCandidates, initialAppId);
		if (shouldAutoApplyNoLauncher(initialAppId)) {
			skipLauncherLabel.style.display = 'flex';
			skipLauncherInput.checked = true;
		}
	}
	let manualLookupTimer: ReturnType<typeof setTimeout> | null = null;
	input.addEventListener('input', () => {
		targetInputUserEdited = true;
		clearTargetStatus();
		updateButtonStates();
		const rawVal = input.value.trim();
		const urlMatch = rawVal.match(/\/app\/(\d+)/i);
		const parsedAppId = urlMatch ? urlMatch[1] : rawVal;
		if (urlMatch && input.value !== parsedAppId) {
			input.value = parsedAppId;
			updateButtonStates();
		}
		achievementBinding?.sync(parsedAppId);

		if (!/^\d+$/.test(parsedAppId)) {
			if (manualLookupTimer) {
				clearTimeout(manualLookupTimer);
				manualLookupTimer = null;
			}
			return;
		}

		const lookupAppId = parsedAppId;
		const targetRev = ++targetRevision;
		if (manualLookupTimer) clearTimeout(manualLookupTimer);
		statusEl.textContent = gdlText('verifying_steam', 'Verifying on Steam...');
		statusEl.style.color = '#8f98a0';

		manualLookupTimer = setTimeout(() => {
			void getGameData(lookupAppId).then(official => {
				if (targetRev !== targetRevision || input.value.trim() !== lookupAppId) return;
				if (!official) {
					statusEl.textContent = gdlText('appid_not_found', 'AppID {id} was not found on Steam.', { id: lookupAppId });
					statusEl.style.color = '#ff6b6b';
					return;
				}
				const name = String(official.name || `Steam AppID ${lookupAppId}`);
				const image = String(official.header_image || official.capsule_image || official.capsule_imagev5 || `https://cdn.cloudflare.steamstatic.com/steam/apps/${lookupAppId}/header.jpg`).trim();
				const candidate: ShortcutDetectionCandidate = {
					name,
					appid: lookupAppId,
					image,
					score: 100,
					confidence: 'exact',
				};
				const existingIndex = currentCandidates.findIndex(c => c.appid === lookupAppId);
				if (existingIndex >= 0) {
					currentCandidates[existingIndex] = candidate;
				} else {
					currentCandidates.unshift(candidate);
				}
				renderCandidatePreview(currentCandidates, lookupAppId);

				let optionExists = false;
				for (let i = 0; i < autoSelect.options.length; i++) {
					if (autoSelect.options[i].value === lookupAppId) {
						optionExists = true;
						break;
					}
				}
				if (!optionExists) {
					const opt = doc.createElement('option');
					opt.value = lookupAppId;
					opt.textContent = `${name} — AppID ${lookupAppId}`;
					autoSelect.insertBefore(opt, autoSelect.firstChild);
				}
				autoSelect.value = lookupAppId;
				autoTitle.style.display = 'block';
				autoTitle.textContent = gdlText('detected_game', 'Detected: {name}. Review the result and press Link to link it.', { name });

				if (shouldAutoApplyNoLauncher(lookupAppId)) {
					skipLauncherLabel.style.display = 'flex';
					skipLauncherInput.checked = true;
				} else {
					skipLauncherLabel.style.display = 'none';
					skipLauncherInput.checked = false;
				}

				statusEl.textContent = gdlText('detected_game', 'Detected: {name}. Review the result and press Link to link it.', { name });
				statusEl.style.color = '#5ba32b';
				updateButtonStates();
				achievementBinding?.sync(lookupAppId);
			}).catch(() => {
				if (targetRev !== targetRevision || input.value.trim() !== lookupAppId) return;
				statusEl.textContent = gdlText('appid_not_found', 'AppID {id} was not found on Steam.', { id: lookupAppId });
				statusEl.style.color = '#ff6b6b';
			});
		}, 250);
	});
	const syncLinkStatusFromState = (): void => {
		if (!section.isConnected) return;
		const shortcutId = managedShortcutId || Number(findActiveShortcutAppId(doc, gameTitle) || 0) || findShortcutAppIdByName(gameTitle);
		const mapped = findMappingForShortcut(shortcutId, gameTitle);
		currentLinked = (mapped && /^\d+$/.test(mapped)) ? mapped : '';
		updateButtonStates();
		achievementBinding?.sync();
		playtimeBinding?.sync(shortcutId);
		if (currentLinked) {
			const isPending = hasPendingLinkJob(shortcutId, gameTitle);
			if (isPending) {
				statusEl.textContent = gdlText('link_queued_background', 'Link queued. You can close this window; setup continues in the background.');
				statusEl.style.color = '#e5ad37';
			} else {
				statusEl.textContent = gdlText('manual_link_success', 'Shortcut linked to Steam successfully.');
				statusEl.style.color = '#5ba32b';
			}
		}
	};

	syncLinkStatusFromState();

	const onJobsChanged = (): void => {
		if (!section.isConnected) {
			window.removeEventListener('gdl:pending-link-jobs-changed', onJobsChanged);
			return;
		}
		syncLinkStatusFromState();
	};
	window.addEventListener('gdl:pending-link-jobs-changed', onJobsChanged);

	const unsubscribeMappings = subscribeMappings(() => {
		if (!section.isConnected) {
			unsubscribeMappings();
			window.removeEventListener('gdl:pending-link-jobs-changed', onJobsChanged);
			return;
		}
		syncLinkStatusFromState();
	});

	achievementBinding = bindShortcutAchievementSettings({
		section,
		shortcutAppId: () => managedShortcutId ? String(managedShortcutId) : '',
		steamAppId: () => /^\d+$/.test(input.value.trim()) ? input.value.trim() : currentLinked,
		gameTitle: () => gameTitle || '',
	});
	playtimeBinding = bindShortcutPlaytimeProperties({
		section,
		getShortcutAppId: () => managedShortcutId || Number(findActiveShortcutAppId(doc, gameTitle) || 0) || findShortcutAppIdByName(gameTitle),
	});
	if (managedShortcutId && input && autoSelect && autoTitle) {
		if (!initialAppId) {
			autoTitle.style.display = 'none';
			autoTitle.textContent = '';
			if (candidatePreview) { candidatePreview.style.display = 'none'; candidatePreview.replaceChildren(); }
		}

		const applySuggestionCandidates = (viable: ShortcutDetectionCandidate[], final: boolean): void => {
			if (!section.isConnected) return;
			const next = (viable || []).slice(0, 10);
			const previousSelectedValue = autoSelect.value;
			currentCandidates = next;
			if (!next.length) {
				if (!initialAppId && !targetInputUserEdited) {
					if (candidatePreview) { candidatePreview.style.display = 'none'; candidatePreview.replaceChildren(); }
					autoSelect.replaceChildren();
					const option = doc.createElement('option');
					option.value = '';
					option.textContent = final
						? gdlText('no_suggestions_found', 'No automatic suggestions (enter the AppID below)')
						: gdlText('link_searching', 'Searching for Steam matches…');
					autoSelect.appendChild(option);
					autoSelect.disabled = true;
					autoTitle.style.display = 'block';
					autoTitle.textContent = final
						? gdlText('no_match_found', 'No reliable match was found. You can enter the AppID manually.')
						: gdlText('link_searching', 'Searching for Steam matches…');
				}
				return;
			}

			autoSelect.disabled = false;
			const options: HTMLOptionElement[] = [];
			const preferredAppId = currentLinked || rememberedAppId;
			if (preferredAppId && !next.some(c => c.appid === preferredAppId)) {
				const rememberedOpt = doc.createElement('option');
				rememberedOpt.value = preferredAppId;
				rememberedOpt.textContent = currentLinked
					? gdlText('current_linked_option', 'Currently linked game (AppID {appid})', { appid: preferredAppId })
					: `Steam AppID ${preferredAppId}`;
				options.push(rememberedOpt);
			}
			for (const candidate of next) {
				const option = doc.createElement('option');
				option.value = candidate.appid;
				const scoreText = candidate.score ? ` (${Math.round(candidate.score)}%)` : '';
				const confBadge = candidate.confidence === 'exact' || candidate.confidence === 'high' ? ' [HIGH]' : (candidate.confidence === 'medium' ? ' [MEDIUM]' : ' [LOW]');
				const isRemembered = candidate.appid === rememberedAppId ? ' • ' + gdlText('remembered_tag', 'Previously linked') : '';
				const isCollision = candidate.identity_collision ? ' ⚠️' : '';
				option.textContent = `${candidate.name} — AppID ${candidate.appid}${scoreText}${confBadge}${isRemembered}${isCollision}`;
				options.push(option);
			}
			autoSelect.replaceChildren(...options);
			autoTitle.style.display = 'none';
			autoTitle.textContent = '';

			let defaultSelected = next[0].appid;
			const previousSelectionStillAvailable = Boolean(previousSelectedValue && (
				next.some(c => c.appid === previousSelectedValue) || previousSelectedValue === currentLinked || previousSelectedValue === rememberedAppId
			));
			if (suggestionUserInteracted && previousSelectionStillAvailable) {
				defaultSelected = previousSelectedValue;
			} else if (currentLinked) {
				defaultSelected = currentLinked;
			} else if (rememberedAppId) {
				const remCand = next.find(c => c.appid === rememberedAppId);
				if (remCand) {
					const topHasProof = next[0].executable_match || (next[0].reasons || []).includes('official_executable_match');
					const remHasProof = remCand.executable_match || (remCand.reasons || []).includes('official_executable_match');
					if (topHasProof && !remHasProof) defaultSelected = next[0].appid;
					else if (next[0].score - remCand.score >= 15 || remCand.score < 70) defaultSelected = next[0].appid;
					else defaultSelected = remCand.appid;
				}
			}

			autoSelect.value = defaultSelected;
			if (!targetInputUserEdited || suggestionUserInteracted || currentLinked) {
				input.value = defaultSelected;
				targetInputUserEdited = false;
			}
			const selectedCandidate = candidateForPreview(next, autoSelect.value) || next[0];
			renderCandidatePreview(next, selectedCandidate.appid);
			updateButtonStates();
			achievementBinding?.sync(selectedCandidate.appid);
			if (shouldAutoApplyNoLauncher(selectedCandidate.appid)) {
				skipLauncherLabel.style.display = 'flex';
				skipLauncherInput.checked = true;
			} else {
				skipLauncherLabel.style.display = 'none';
				skipLauncherInput.checked = false;
			}
		};

		autoSelect.addEventListener('change', () => {
			if (!autoSelect.value) return;
			suggestionUserInteracted = true;
			targetInputUserEdited = false;
			input.value = autoSelect.value;
			clearTargetStatus();
			const selected = candidateForPreview(currentCandidates, autoSelect.value);
			if (selected) {
				renderCandidatePreview(currentCandidates, selected.appid);
				if (shouldAutoApplyNoLauncher(selected.appid)) {
					skipLauncherLabel.style.display = 'flex';
					skipLauncherInput.checked = true;
				} else {
					skipLauncherLabel.style.display = 'none';
					skipLauncherInput.checked = false;
				}
			}
			updateButtonStates();
			achievementBinding?.sync(autoSelect.value);
		});

		void (async () => {
			detectionContext = await buildShortcutDetectionContext(doc, gameTitle, managedShortcutId!);
			if (!detectionContext) {
				applySuggestionCandidates([], true);
				return;
			}

			if (detectionContext.bootstrapDetected && detectionContext.recommendedExePath) {
				const bootstrap = shortcutPathBasename(detectionContext.exePath);
				const gameExe = shortcutPathBasename(detectionContext.recommendedExePath);
				if (detectionContext.trackingExecutableAutoApply) {
					trackingExecutableCopy.innerHTML = `<strong style="font-weight:500;color:#dcdedf;">${escapeHtml(gdlText('selected_executable', 'Selected executable: {exe}', { exe: gameExe }))}</strong><br /><span style="color:#8f98a0;font-size:11px;line-height:1.35;display:block;margin-top:2px;">${escapeHtml(gdlText('persistent_tracking_exe_note', '{exe} is the main process for this game to ensure playtime tracking works correctly.', { exe: gameExe }))}</span>`;
					trackingExecutableLabel.style.display = 'flex';
					trackingExecutableLabel.style.pointerEvents = 'none';
					trackingExecutableInput.style.display = 'none';
					trackingExecutableInput.checked = true;
				} else {
					trackingExecutableCopy.innerHTML = `<strong style="font-weight:500;color:#dcdedf;">${escapeHtml(gdlText('use_tracking_executable', 'Use the real game executable'))}</strong><br />${escapeHtml(gdlText('tracking_executable_help', '{bootstrap} closes after launching {game}. Use {game} so Steam tracks your playtime.', { bootstrap, game: gameExe }))}`;
					trackingExecutableLabel.style.display = 'flex';
					trackingExecutableLabel.style.pointerEvents = '';
					trackingExecutableInput.style.display = '';
					trackingExecutableInput.checked = false;
				}
			}

			// Render zero-network evidence first. A slow Store/AppInfo request must
			// never leave the properties dropdown blank for several seconds.
			const localDetection = await detectShortcutCandidatesLocal(detectionContext);
			const localCandidates = localDetection?.candidates || [];
			applySuggestionCandidates(localCandidates, false);

			const remoteDetection = await enrichShortcutCandidatesRemote(detectionContext, localCandidates);
			if (!section.isConnected) return;
			const merged = mergeCandidateLists(localCandidates, remoteDetection?.candidates || []);
			applySuggestionCandidates(merged, true);
		})().catch(e => {
			backendLog('Properties automatic detection error: ' + e);
			applySuggestionCandidates(currentCandidates, true);
		});
	}

	if (unlinkBtn && input && statusEl) {
		unlinkBtn.addEventListener('click', async () => {
			if (propertyActionBusy) return;
			const shortcutId = managedShortcutId || Number(findActiveShortcutAppId(doc, gameTitle) || 0) || findShortcutAppIdByName(gameTitle);
			if (!shortcutId) {
				statusEl.textContent = gdlText('unlink_failed', 'Could not identify this shortcut to unlink it.');
				statusEl.style.color = '#ff6b6b';
				return;
			}
			const unlinkedAppId = currentLinked || findMappingForShortcut(shortcutId, gameTitle) || '';
			propertyActionBusy = 'unlink';
			updateButtonStates();
			statusEl.textContent = gdlText('bulk_unlinking_short', 'Unlinking...');
			statusEl.style.color = '#66c0f4';
			try {
				const result = await unlinkShortcutFromSteam({
					doc,
					shortcutAppId: shortcutId,
					title: gameTitle,
					steamAppId: unlinkedAppId || undefined,
					exePath: detectionContext?.exePath || '',
				});
				if (!section.isConnected) return;
				if (result.ok) {
					if (result.shortcutAppId) managedShortcutId = result.shortcutAppId;
					currentLinked = '';
					statusEl.textContent = gdlText('unlink_success', 'Link removed. You can link this same shortcut again without deleting it from Steam.');
					statusEl.style.color = '#5ba32b';
				} else {
					currentLinked = findMappingForShortcut(shortcutId, gameTitle) || unlinkedAppId;
					statusEl.textContent = gdlText('unlink_failed', 'Could not unlink this shortcut.');
					statusEl.style.color = '#ff6b6b';
				}
			} catch (error) {
				backendLog('Direct properties unlink error: ' + String(error));
				currentLinked = findMappingForShortcut(shortcutId, gameTitle) || unlinkedAppId;
				if (section.isConnected) {
					statusEl.textContent = gdlText('unlink_failed', 'Could not unlink this shortcut.');
					statusEl.style.color = '#ff6b6b';
				}
			} finally {
				propertyActionBusy = null;
				if (section.isConnected) updateButtonStates();
			}
		});
	}

	if (saveBtn && input && statusEl) {
		saveBtn.addEventListener('click', async () => {
			if (propertyActionBusy) return;
			let val = input.value.trim();
			if (!val) { statusEl.textContent = gdlText('enter_appid', 'Enter an AppID or store link.'); return; }
			const urlMatch = val.match(/(?:store\.steampowered\.com|steamcommunity\.com|steamdb\.info)\/app\/(\d+)/i)
				|| val.match(/s\.team\/a\/(\d+)/i);
			if (urlMatch) {
				val = urlMatch[1];
				input.value = val;
			}
			if (!/^\d+$/.test(val)) {
				statusEl.textContent = gdlText('enter_numeric_appid', 'Enter a numeric AppID or a store page link.');
				statusEl.style.color = '#ff6b6b';
				return;
			}
			const shortcutId = managedShortcutId || Number(findActiveShortcutAppId(doc, gameTitle) || 0) || findShortcutAppIdByName(gameTitle);
			if (!shortcutId) {
				statusEl.textContent = gdlText('save_failed', 'Could not identify this shortcut.');
				statusEl.style.color = '#d94126';
				return;
			}
			cancelPendingLinkJobs(shortcutId, gameTitle);
			undismissShortcut(shortcutId);
			const linkInput = { title: gameTitle, shortcutAppId: shortcutId, steamAppId: val, skipLauncher: !!skipLauncherInput?.checked,
				existingLaunchOptions: detectionContext?.launchOptions || '', trackingExecutable: trackingExecutableInput?.checked ? detectionContext?.recommendedExePath || '' : '',
				trackingStartDir: trackingExecutableInput?.checked ? detectionContext?.recommendedStartDir || '' : '', shortcutExecutable: detectionContext?.exePath || '' };
			stageLinkJobForRecovery({ ...linkInput, repairResources: false });
			const requestRevision = ++targetRevision;
			propertyActionBusy = 'link';
			updateButtonStates();
			statusEl.textContent = gdlText('bulk_linking_short', 'Linking...');
			statusEl.style.color = '#66c0f4';
			try {
				const result = await linkShortcutToSteam({
					doc, ...linkInput,
					onStatus: (message, color) => {
						if (requestRevision !== targetRevision || !section.isConnected) return;
						if (message) { statusEl.textContent = message; statusEl.style.color = color || '#66c0f4'; }
					},
				});
				if (requestRevision !== targetRevision || !section.isConnected) return;

				if (result.ok) {
					if (result.shortcutAppId) managedShortcutId = result.shortcutAppId;
					currentLinked = findMappingForShortcut(result.shortcutAppId || shortcutId, gameTitle) || val;
					linkedPreviewCandidate = currentCandidates.find(candidate => candidate.appid === currentLinked) || {
						name: currentCandidates.find(candidate => candidate.appid === val)?.name || `Steam AppID ${currentLinked}`,
						appid: currentLinked,
						image: currentCandidates.find(candidate => candidate.appid === val)?.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${currentLinked}/header.jpg`,
						score: 100,
						confidence: 'exact',
					};
					const resourcesComplete = Boolean(result.setup?.artworkComplete && result.setup?.iconApplied);
					if (!resourcesComplete) {
						enqueueLinkJob({
							title: gameTitle, shortcutAppId: result.shortcutAppId || shortcutId, steamAppId: val,
							skipLauncher: !!skipLauncherInput?.checked, existingLaunchOptions: detectionContext?.launchOptions || '',
							trackingExecutable: trackingExecutableInput?.checked ? detectionContext?.recommendedExePath || '' : '',
							trackingStartDir: trackingExecutableInput?.checked ? detectionContext?.recommendedStartDir || '' : '',
							shortcutExecutable: detectionContext?.exePath || '', repairResources: true,
						});
						statusEl.textContent = gdlText('link_queued_background', 'Linked. Resource setup continues in the background.');
						statusEl.style.color = '#e5ad37';
					} else {
						cancelPendingLinkJobs(result.shortcutAppId || shortcutId, gameTitle);
						statusEl.textContent = gdlText('manual_link_success', 'Shortcut linked to Steam successfully.');
						statusEl.style.color = '#5ba32b';
					}
				} else {
					const retryable = !['invalid_appid', 'refusing_to_modify_native_steam_app'].includes(String(result.error || ''));
					const committedId = result.shortcutAppId || shortcutId;
					const committedMapping = findMappingForShortcut(committedId, gameTitle) || '';
					currentLinked = committedMapping;
					if (retryable) {
						enqueueLinkJob({
							title: gameTitle, shortcutAppId: committedId, steamAppId: val,
							skipLauncher: !!skipLauncherInput?.checked, existingLaunchOptions: detectionContext?.launchOptions || '',
							trackingExecutable: trackingExecutableInput?.checked ? detectionContext?.recommendedExePath || '' : '',
							trackingStartDir: trackingExecutableInput?.checked ? detectionContext?.recommendedStartDir || '' : '',
							shortcutExecutable: detectionContext?.exePath || '',
						});
						statusEl.textContent = committedMapping === val
							? gdlText('link_queued_background', 'Linked. Remaining setup continues in the background.')
							: gdlText('link_queued_background', 'Link retry queued in the background.');
						statusEl.style.color = '#e5ad37';
					} else {
						cancelPendingLinkJobs(committedId, gameTitle);
						statusEl.textContent = gdlText('save_failed', 'Could not complete the link.');
						statusEl.style.color = '#d94126';
					}
				}
			} catch (error) {
				backendLog('Direct properties link error: ' + String(error));
				currentLinked = findMappingForShortcut(shortcutId, gameTitle) || '';
				// Activate the staged crash-recovery intent immediately after an
				// unexpected foreground failure instead of waiting for a full restart.
				enqueueLinkJob({
					title: gameTitle, shortcutAppId: shortcutId, steamAppId: val,
					skipLauncher: !!skipLauncherInput?.checked, existingLaunchOptions: detectionContext?.launchOptions || '',
					trackingExecutable: trackingExecutableInput?.checked ? detectionContext?.recommendedExePath || '' : '',
					trackingStartDir: trackingExecutableInput?.checked ? detectionContext?.recommendedStartDir || '' : '',
					shortcutExecutable: detectionContext?.exePath || '',
				});
				if (requestRevision === targetRevision && section.isConnected) {
					statusEl.textContent = gdlText('link_queued_background', 'Link retry queued in the background.');
					statusEl.style.color = '#e5ad37';
				}
			} finally {
				propertyActionBusy = null;
				if (section.isConnected) updateButtonStates();
			}
		});
	}
}
