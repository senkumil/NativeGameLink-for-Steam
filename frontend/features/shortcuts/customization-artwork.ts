import { loc } from '../../steam/localization';
import { findActiveShortcutAppId, findNativeSteamAppIdByName, findShortcutAppIdByName, SHORTCUT_THRESHOLD } from '../../steam/shortcuts';
import { findMappingForShortcut } from './registry';
import { resolveNativeGameAppId } from './native-properties';
import { bindShortcutArtworkSettings, shortcutArtworkSettingsHtml } from './artwork-properties';
import { rememberedShortcutSteamAppId } from './link-history';
import { documentHasNativeAddNonSteamDialog } from './native-add-guard';
import { shortcutRuntimeHost } from './host';
import { captureArtworkApplicationCurrent, markNativeArtworkCustomization } from '../library/artwork';
import { backendLog, saveShortcutArtworkBackend } from '../../api/backend';
import { writeAssetWithDeadline } from '../library/asset-write';
import { hasPendingNativeAssetWrites, writeNativeAsset } from '../library/native-asset-write';

type CustomizationSlotKind = 'portrait' | 'hero' | 'logo' | 'wide';

const STATIC_CUSTOMIZATION_SLOT_MARKERS: Record<CustomizationSlotKind, string[]> = {
	portrait: ['portada', 'cover', 'vertical cover', 'vertical capsule', 'capsule portrait'],
	hero: ['fondo', 'background', 'hero', 'wide background'],
	logo: ['logo', 'logotipo', 'library logo'],
	wide: ['portada amplia', 'wide cover', 'horizontal capsule', 'wide capsule', 'large capsule'],
};
interface CustomizationObserverState {
	observer: MutationObserver;
	timer: ReturnType<typeof setTimeout> | null;
	retryTimer: ReturnType<typeof setTimeout> | null;
	retryCount: number;
	popupTitle: string;
	gameTitleHint: string;
	nativeArtworkHandler: EventListener | null;
	nativeArtworkContainer: HTMLElement | null;
	nativeArtworkBinding: string;
}
interface CustomizationMount {
	container: HTMLElement;
	/** Native sibling that follows Wide cover (normally Steam's “Various” block). */
	insertBefore: ChildNode | null;
}
const customizationObservers = new WeakMap<Document, CustomizationObserverState>();
const CUSTOMIZATION_HYDRATION_RETRIES = [80, 160, 320, 640, 1000, 1500] as const;

function normalizedUiText(value: string): string {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function customizationSlotMarkers(): Record<CustomizationSlotKind, string[]> {
	const localized: Partial<Record<CustomizationSlotKind, string>> = {
		portrait: loc('AppProperties_Cover', 'Cover'),
		hero: loc('AppProperties_Background', 'Background'),
		logo: loc('AppProperties_Logo', 'Logo'),
	};
	return Object.fromEntries((Object.keys(STATIC_CUSTOMIZATION_SLOT_MARKERS) as CustomizationSlotKind[]).map(kind => [
		kind,
		Array.from(new Set([
			...STATIC_CUSTOMIZATION_SLOT_MARKERS[kind],
			localized[kind] || '',
		].map(normalizedUiText).filter(Boolean))),
	])) as Record<CustomizationSlotKind, string[]>;
}

function isActuallyVisible(element: HTMLElement): boolean {
	if (!element.isConnected) return false;
	const view = element.ownerDocument.defaultView;
	if (!view) return false;
	let current: HTMLElement | null = element;
	while (current) {
		if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
		const style = view.getComputedStyle(current);
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
		const opacity = Number.parseFloat(style.opacity || '1');
		if (Number.isFinite(opacity) && opacity <= 0.001) return false;
		current = current.parentElement;
	}
	const rect = element.getBoundingClientRect();
	return rect.width > 1 && rect.height > 1;
}

function isNativeCustomizationText(parent: HTMLElement): boolean {
	return !parent.closest('.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^="gdl-"]');
}

function matchingSlotKind(text: string, markers: Record<CustomizationSlotKind, string[]>): CustomizationSlotKind | null {
	if (!text || text.length > 96) return null;
	for (const kind of Object.keys(markers) as CustomizationSlotKind[]) {
		if (markers[kind].some(marker => text === marker
			|| text.startsWith(`${marker} `)
			|| text.endsWith(` ${marker}`))) return kind;
	}
	return null;
}

function commonAncestor(elements: HTMLElement[]): HTMLElement | null {
	let current: HTMLElement | null = elements[0] || null;
	while (current && !elements.every(element => current?.contains(element))) current = current.parentElement;
	return current;
}

function isRightPageContainer(doc: Document, element: HTMLElement): boolean {
	if (!isActuallyVisible(element)) return false;
	if (element.closest('[class*="PageList"], [class*="SettingsNav"], [class*="DialogNav"]')) return false;
	if (element.querySelector('[class*="PageList"], [class*="SettingsNav"], [class*="DialogNav"]')) return false;
	const bodyRect = doc.body?.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	if (!bodyRect || bodyRect.width <= 1) return rect.width >= 260;
	if (rect.right <= bodyRect.left || rect.left >= bodyRect.right
		|| rect.bottom <= bodyRect.top || rect.top >= bodyRect.bottom) return false;
	const sidebarBoundary = bodyRect.left + Math.min(160, bodyRect.width * 0.15);
	return rect.width >= 260 && rect.right > sidebarBoundary && rect.left >= bodyRect.left + 80;
}

/** Resolve only the visible native Personalización content. Hidden React pages,
 * navigation labels and NativeGameLink's own artwork UI are intentionally
 * excluded so the picker can never mount in Steam's left sidebar. */
function directChildInside(container: HTMLElement, descendant: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = descendant;
	while (current?.parentElement && current.parentElement !== container) current = current.parentElement;
	return current?.parentElement === container ? current : null;
}

function findCustomizationMount(doc: Document): CustomizationMount | null {
	if (!doc.body) return null;
	const markers = customizationSlotMarkers();
	const dialogRoots = Array.from(doc.querySelectorAll<HTMLElement>(
		'[role="dialog"], [aria-modal="true"], [class*="PagedSettingsDialog"], [class*="pagedsettings"], [class*="Modal"]',
	)).filter(root => isActuallyVisible(root) && !root.closest('#gdl-artwork-picker-overlay, [id^="gdl-"]'));
	// querySelectorAll returns ancestors before descendants. Inspect the deepest
	// visible modal roots first so labels from the Library page behind Properties
	// can never be combined with labels from the active customization page.
	const roots: HTMLElement[] = [...dialogRoots.reverse(), doc.body];
	for (const root of roots) {
		const slotParents = new Map<CustomizationSlotKind, HTMLElement>();
		const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		let node: Text | null;
		while ((node = walker.nextNode() as Text | null)) {
			const parent = node.parentElement;
			if (!parent || !isNativeCustomizationText(parent) || !isActuallyVisible(parent)) continue;
			const kind = matchingSlotKind(normalizedUiText(node.textContent || ''), markers);
			if (kind && !slotParents.has(kind)) slotParents.set(kind, parent);
		}
		// Steam's native page exposes Cover, Background, Logo and Wide cover. Two
		// distinct slots (one of them Logo) are enough during incremental hydration.
		if (slotParents.size < 2 || !slotParents.has('logo')) continue;

		const shared = commonAncestor(Array.from(slotParents.values()));
		if (!shared || !root.contains(shared)) continue;
		let current: HTMLElement | null = shared;
		let fallback: HTMLElement | null = null;
		let container: HTMLElement | null = null;
		for (let depth = 0; current && current !== doc.body && root.contains(current) && depth < 10; depth++, current = current.parentElement) {
			if (!isRightPageContainer(doc, current)) continue;
			if (!fallback) fallback = current;
			const className = String(current.className || '');
			if (/PageContent|DialogContent_InnerWidth|DialogBody/i.test(className)) {
				container = current;
				break;
			}
		}
		container ||= fallback;
		if (!container) continue;

		// Keep the plugin card with Steam's artwork controls. Appending to the
		// absolute end puts it below the large “Various” form and makes it appear
		// missing at the bottom of Personalización. The direct child following the
		// Wide cover card is a stable insertion anchor across Steam class hashes.
		const wideLabel = slotParents.get('wide');
		const wideCard = wideLabel ? directChildInside(container, wideLabel) : null;
		return { container, insertBefore: wideCard?.nextSibling || null };
	}
	return null;
}

function extractGameTitle(doc: Document, popupTitle: string): string | null {
	const template = loc('AppProperties_Title', 'Properties - %1$s');
	const clean = (raw: string | null | undefined): string | null => {
		let value = raw?.trim();
		if (!value || /^steam$/i.test(value)) return null;
		const prefix = template.split('%1$s')[0]?.trim();
		if (prefix && value.toLowerCase().startsWith(prefix.toLowerCase())) {
			value = value.slice(prefix.length).replace(/^\s*[-–—:]\s*/, '').trim();
		}
		value = value.replace(/^(?:properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|свойства|属性|プロパティ|속성|właściwości|özellikler)\s*[-–—:]\s*/i, '').trim();
		value = value.replace(/\s*[-–—:]\s*(?:properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|свойства|属性|プロパティ|속성|właściwości|özellikler)$/i, '').trim();
		return value || null;
	};
	let title = clean(popupTitle) || clean(doc.title);
	if (title) return title;
	const sidebarTitle = doc.querySelector<HTMLElement>('[class*="PagedSettingsDialog_Title"], [class*="pagedsettings_Title"], [class*="DialogHeader"] [class*="Title"], [class*="PageList"] > div:first-child');
	if (sidebarTitle?.textContent?.trim()) {
		const cleaned = clean(sidebarTitle.textContent);
		if (cleaned) return cleaned;
	}
	for (const input of Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])'))) {
		const value = input.value?.trim();
		if (value && !value.includes(':\\') && !value.includes(':/') && !value.startsWith('-') && !input.classList.contains('gdl-appid-input')) return value;
	}
	const navElements = Array.from(doc.querySelectorAll<HTMLElement>('[class*="PageList"] *, [class*="DialogNav"] *, [class*="SettingsNav"] *'));
	for (const el of navElements) {
		const cleaned = clean(el.textContent);
		if (cleaned && cleaned.length > 1 && !['acceso directo', 'shortcut', 'control', 'controller', 'grabación de partidas', 'game recording', 'personalización', 'customization', 'general', 'compatibilidad', 'compatibility'].includes(cleaned.toLowerCase())) {
			return cleaned;
		}
	}
	try {
		const notice = shortcutRuntimeHost().findNonSteamNotice(doc);
		if (notice?.title) return notice.title;
	} catch {}
	return null;
}

function installCustomizationObserver(doc: Document, popupTitle: string, gameTitleHint = ''): CustomizationObserverState | null {
	const current = customizationObservers.get(doc);
	if (current) {
		if (popupTitle) current.popupTitle = popupTitle;
		if (gameTitleHint) current.gameTitleHint = gameTitleHint;
		return current;
	}
	if (!doc.body) return null;
	const Observer = doc.defaultView?.MutationObserver;
	if (!Observer) return null;
	const state: CustomizationObserverState = {
		observer: null as unknown as MutationObserver,
		timer: null,
		retryTimer: null,
		retryCount: 0,
		popupTitle,
		gameTitleHint,
		nativeArtworkHandler: null,
		nativeArtworkContainer: null,
		nativeArtworkBinding: '',
	};
	const ownedSelector = '.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^="gdl-"]';
	const ElementCtor = doc.defaultView?.Element;
	const ownedNode = (node: Node): boolean => Boolean(ElementCtor && node instanceof ElementCtor
		&& (node.matches(ownedSelector) || node.closest(ownedSelector)));
	const observer = new Observer(records => {
		if (!doc.body?.isConnected) {
			stopCustomizationObserver(doc);
			return;
		}
		const ownedOnly = records.length > 0 && records.every(record => record.type === 'childList'
			? [...record.addedNodes, ...record.removedNodes].every(ownedNode)
			: ownedNode(record.target));
		if (ownedOnly) return;
		state.retryCount = 0;
		if (state.retryTimer) {
			clearTimeout(state.retryTimer);
			state.retryTimer = null;
		}
		if (state.timer) return;
		state.timer = setTimeout(() => {
			state.timer = null;
			tryInjectCustomizationArtwork(doc, state.popupTitle, state.gameTitleHint);
		}, 0);
	});
	state.observer = observer;
	observer.observe(doc.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['class', 'style', 'aria-selected', 'hidden'],
	});
	customizationObservers.set(doc, state);
	return state;
}

function subtreeSlotKind(root: HTMLElement, markers: Record<CustomizationSlotKind, string[]>): CustomizationSlotKind | null {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		const parent = node.parentElement;
		if (!parent || !isNativeCustomizationText(parent)) continue;
		const kind = matchingSlotKind(normalizedUiText(node.textContent || ''), markers);
		if (kind) return kind;
	}
	return null;
}

const NATIVE_ARTWORK_IMAGE_TYPES: Record<CustomizationSlotKind, number> = {
	portrait: 0,
	hero: 1,
	logo: 2,
	wide: 3,
};

function nativeArtworkRowForButton(
	button: HTMLElement,
	container: HTMLElement,
	markers: Record<CustomizationSlotKind, string[]>,
): { slot: CustomizationSlotKind; row: HTMLElement } | null {
	let current: HTMLElement | null = button.parentElement;
	for (let depth = 0; current && current !== container && depth < 7; depth += 1, current = current.parentElement) {
		const slot = subtreeSlotKind(current, markers);
		if (slot) return { slot, row: current };
	}
	return null;
}

function isNativeChangeButton(button: HTMLElement, row: HTMLElement): boolean {
	const buttons = Array.from(row.querySelectorAll<HTMLElement>('button,[role="button"]'))
		.filter(candidate => !candidate.closest('.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^="gdl-"]'));
	if (buttons.indexOf(button) === 0) return true;
	const label = normalizedUiText(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`);
	return ['change', 'browse', 'choose', 'cambiar', 'seleccionar', 'elegir', 'parcourir', 'ändern', 'cambia', 'изменить', '更改', '変更', '바꾸기']
		.some(token => label.includes(token));
}

function fileAsDataUrl(file: File, view: Window): Promise<string | null> {
	return new Promise(resolve => {
		try {
			const ReaderCtor = (view as any).FileReader || FileReader;
			const reader = new ReaderCtor();
			reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(file);
		} catch { resolve(null); }
	});
}

function updateNativeArtworkPreview(row: HTMLElement, dataUrl: string): void {
	try {
		const image = Array.from(row.querySelectorAll<HTMLImageElement>('img'))
			.find(candidate => !candidate.closest('.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^="gdl-"]'));
		if (image) {
			image.src = dataUrl;
			return;
		}
		const preview = Array.from(row.querySelectorAll<HTMLElement>('[style*="background" i], [class*="image" i], [class*="artwork" i]'))
			.find(element => {
				const rect = element.getBoundingClientRect();
				return rect.width >= 70 && rect.height >= 40 && rect.width <= 700 && rect.height <= 500;
			});
		if (preview) preview.style.backgroundImage = `url("${dataUrl}")`;
	} catch {}
}

function parseBackendResponse(raw: unknown): any {
	let value: any = raw;
	for (let attempt = 0; attempt < 3 && typeof value === 'string'; attempt += 1) value = JSON.parse(value);
	return value;
}

/** Steam's native Change button is unreliable for linked non-Steam shortcuts
 * on some CEF builds: it flashes but never opens a usable picker. Keep the
 * native button as the entry point, then use a document-owned file input and
 * persist the bytes through both the Steam bridge and the grid-file fallback. */
function chooseNativeArtworkFile(
	doc: Document,
	row: HTMLElement,
	shortcutId: number,
	steamAppId: string,
	slot: CustomizationSlotKind,
): void {
	const view = doc.defaultView;
	if (!view || !doc.body) return;
	const input = doc.createElement('input');
	input.type = 'file';
	input.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
	input.tabIndex = -1;
	input.setAttribute('aria-hidden', 'true');
	input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
	doc.body.appendChild(input);
	let cleaned = false;
	const cleanup = (): void => {
		if (cleaned) return;
		cleaned = true;
		input.remove();
	};
	view.setTimeout(cleanup, 120_000);
	input.addEventListener('change', () => {
		const file = input.files?.[0];
		if (!file) { cleanup(); return; }
		void (async () => {
			const currentApplication = captureArtworkApplicationCurrent(shortcutId, steamAppId);
			const isCurrent = (): boolean => !view.closed && currentApplication();
			try {
				const dataUrl = await fileAsDataUrl(file, view);
				if (!dataUrl || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) throw new Error('invalid_image');
				const comma = dataUrl.indexOf(',');
				const base64 = dataUrl.slice(comma + 1);
				const mime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
				const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
				const imageType = NATIVE_ARTWORK_IMAGE_TYPES[slot];

				let backendConfirmedFailure = false;
				const backendWrite = writeAssetWithDeadline(guard => saveShortcutArtworkBackend({ request_json: JSON.stringify({
					shortcut_app_id: shortcutId,
					steam_app_id: steamAppId,
					image_type: imageType,
					data_base64: base64,
					extension,
					...guard,
				}) }), isCurrent).then(raw => {
					const response = parseBackendResponse(raw);
					backendConfirmedFailure = response !== null && response?.error !== 'resource_deadline_exceeded'
						&& response?.error !== 'superseded';
					return response?.ok === true || response?.saved === true;
				}).catch(() => false);

				// The local grid write is fast and deterministic. Only fall back to the
				// Steam bridge if that write fails; running both against the same target
				// file concurrently can make Steam immediately restore the old preview.
				let saved = await backendWrite;
				const apps = (window as any).SteamClient?.Apps;
				if (!saved && backendConfirmedFailure && isCurrent() && !hasPendingNativeAssetWrites(shortcutId) && typeof apps?.SetCustomArtworkForApp === 'function') {
					saved = await writeNativeAsset(shortcutId, `artwork-${imageType}`,
						() => apps.SetCustomArtworkForApp(shortcutId, base64, extension, imageType), isCurrent);
				}
				if (!saved || !isCurrent()) throw new Error('save_failed');

				markNativeArtworkCustomization(shortcutId, steamAppId);
				updateNativeArtworkPreview(row, dataUrl);
				shortcutRuntimeHost().refreshLibraryArtwork?.(shortcutId);
				try {
					window.dispatchEvent(new CustomEvent('gdl:artwork-changed', {
						detail: { shortcutAppId: shortcutId, steamAppId, user_action: true, native_customization: true, slot },
					}));
				} catch {}
				backendLog(`Native artwork changed (${slot}) for ${shortcutId} -> ${steamAppId}`);
			} catch (error) {
				backendLog(`Could not change native artwork (${slot}) for ${shortcutId}: ${String(error)}`);
			} finally { cleanup(); }
		})();
	}, { once: true });
	// This remains in the original trusted click event, which is required by CEF
	// to open a file picker. No asynchronous IPC runs before the dialog opens.
	input.click();
}

function bindNativeArtworkChangeButtons(
	state: CustomizationObserverState,
	container: HTMLElement,
	shortcutId: number | null,
	steamAppId: string,
): void {
	const binding = `${shortcutId || ''}:${steamAppId}`;
	if (state.nativeArtworkContainer === container && state.nativeArtworkBinding === binding && state.nativeArtworkHandler) return;
	if (state.nativeArtworkContainer && state.nativeArtworkHandler) {
		try { state.nativeArtworkContainer.removeEventListener('click', state.nativeArtworkHandler, true); } catch {}
	}
	state.nativeArtworkContainer = null;
	state.nativeArtworkHandler = null;
	state.nativeArtworkBinding = '';
	if (!shortcutId || shortcutId < SHORTCUT_THRESHOLD || !/^\d+$/.test(steamAppId)) return;
	const markers = customizationSlotMarkers();
	const handler: EventListener = event => {
		const ElementCtor = container.ownerDocument.defaultView?.Element;
		if (!ElementCtor || !(event.target instanceof ElementCtor)) return;
		const button = (event.target as Element).closest<HTMLElement>('button,[role="button"]');
		if (!button || !container.contains(button)
			|| button.closest('.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^="gdl-"]')) return;
		const resolved = nativeArtworkRowForButton(button, container, markers);
		if (!resolved || !isNativeChangeButton(button, resolved.row)) return;
		event.preventDefault();
		event.stopPropagation();
		(event as any).stopImmediatePropagation?.();
		markNativeArtworkCustomization(shortcutId, steamAppId);
		chooseNativeArtworkFile(container.ownerDocument, resolved.row, shortcutId, steamAppId, resolved.slot);
	};
	container.addEventListener('click', handler, true);
	state.nativeArtworkContainer = container;
	state.nativeArtworkHandler = handler;
	state.nativeArtworkBinding = binding;
}

function scheduleHydrationRetry(doc: Document, state: CustomizationObserverState): void {
	if (state.retryTimer || state.retryCount >= CUSTOMIZATION_HYDRATION_RETRIES.length) return;
	const delay = CUSTOMIZATION_HYDRATION_RETRIES[state.retryCount++];
	state.retryTimer = setTimeout(() => {
		state.retryTimer = null;
		if (customizationObservers.get(doc) !== state) return;
		tryInjectCustomizationArtwork(doc, state.popupTitle, state.gameTitleHint);
	}, delay);
}

function stopCustomizationObserver(doc: Document): void {
	const state = customizationObservers.get(doc);
	if (!state) return;
	state.observer.disconnect();
	if (state.timer) clearTimeout(state.timer);
	if (state.retryTimer) clearTimeout(state.retryTimer);
	if (state.nativeArtworkContainer && state.nativeArtworkHandler) {
		try { state.nativeArtworkContainer.removeEventListener('click', state.nativeArtworkHandler, true); } catch {}
	}
	customizationObservers.delete(doc);
}

function documentMightContainProperties(doc: Document, popupTitle: string): boolean {
	if (doc.querySelector('.gdl-customization-artwork-injected, .gdl-properties-injected, .gdl-native-properties-injected')) return true;
	const propertiesNavSelector = '[class*="PagedSettingsDialog"], [class*="pagedsettings"], [class*="PageList"], [class*="SettingsNav"], [class*="DialogNav"]';
	const visibleDialogs = Array.from(doc.querySelectorAll<HTMLElement>(
		'[role="dialog"], [aria-modal="true"], [class*="Modal"], [class*="Dialog"]',
	)).filter(isActuallyVisible);
	if (visibleDialogs.some(dialog => dialog.matches(propertiesNavSelector) || dialog.querySelector(propertiesNavSelector))) return true;
	return /properties|propiedades|propriedades|propriétés|eigenschaften|proprietà|свойства|属性|プロパティ|속성|właściwości|özellikler/i
		.test(`${popupTitle} ${doc.title}`);
}

function removeCustomizationArtwork(doc: Document): void {
	doc.querySelectorAll('.gdl-customization-artwork-injected').forEach(element => element.remove());
	doc.getElementById('gdl-artwork-picker-overlay')?.remove();
}

/** Release the document-local controller when Steam closes/replaces the window
 * or Millennium unloads the plugin. */
export function disposeCustomizationArtwork(doc: Document): void {
	stopCustomizationObserver(doc);
	removeCustomizationArtwork(doc);
}

/** Inject the artwork picker into Steam's Personalización tab for every game. */
export function tryInjectCustomizationArtwork(doc: Document, popupTitle: string, gameTitleHint = ''): void {
	if (!doc?.body) return;
	// This observer can see every Steam popup document. Never inject into the
	// native “Add a Non-Steam Game” picker (or similarly named dialogs), even
	// when the underlying page still contains artwork labels.
	if (documentHasNativeAddNonSteamDialog(doc)) {
		stopCustomizationObserver(doc);
		removeCustomizationArtwork(doc);
		return;
	}
	if (!documentMightContainProperties(doc, popupTitle)) {
		stopCustomizationObserver(doc);
		removeCustomizationArtwork(doc);
		return;
	}
	// Install the controller as soon as this is known to be a Properties dialog.
	// Steam replaces the active React page after the tab click; waiting until all
	// four artwork cards already exist loses that transition and the picker never
	// receives another mount attempt.
	const state = installCustomizationObserver(doc, popupTitle, gameTitleHint);
	if (!state) return;
	const mount = findCustomizationMount(doc);
	if (!mount) {
		removeCustomizationArtwork(doc);
		scheduleHydrationRetry(doc, state);
		return;
	}
	const { container, insertBefore } = mount;
	if (state.retryTimer) {
		clearTimeout(state.retryTimer);
		state.retryTimer = null;
	}
	state.retryCount = 0;

	const gameTitle = extractGameTitle(doc, popupTitle) || state.gameTitleHint;
	if (!gameTitle) {
		scheduleHydrationRetry(doc, state);
		return;
	}
	state.gameTitleHint = gameTitle;
	const initialShortcutId = findActiveShortcutAppId(doc, gameTitle)
		|| (findShortcutAppIdByName(gameTitle) ? String(findShortcutAppIdByName(gameTitle)) : null);
	const mappedAppId = findMappingForShortcut(initialShortcutId, gameTitle) || '';
	const isNonSteamShortcut = Boolean(initialShortcutId && Number(initialShortcutId) >= SHORTCUT_THRESHOLD);
	let artworkAppId = /^\d+$/.test(mappedAppId)
		? mappedAppId
		: (!isNonSteamShortcut ? (findNativeSteamAppIdByName(gameTitle) || '') : '');
	const shortcutId = initialShortcutId && /^\d+$/.test(initialShortcutId) ? Number(initialShortcutId) : null;
	if (!artworkAppId && shortcutId) {
		const remembered = rememberedShortcutSteamAppId(shortcutId);
		if (/^\d+$/.test(remembered)) artworkAppId = remembered;
	}
	if (!artworkAppId) {
		const appInput = doc.querySelector<HTMLInputElement>('.gdl-appid-input');
		if (appInput && /^\d+$/.test(appInput.value.trim())) artworkAppId = appInput.value.trim();
	}
	const bindingKey = [gameTitle, shortcutId || '', artworkAppId].join('\u001f');
	bindNativeArtworkChangeButtons(state, container, shortcutId, artworkAppId);
	const existing = doc.querySelector<HTMLElement>('.gdl-customization-artwork-injected');
	const placementIsCurrent = existing?.parentElement === container
		&& (insertBefore ? existing.nextSibling === insertBefore : existing === container.lastElementChild);
	if (existing && placementIsCurrent && existing.dataset.gdlArtworkBinding === bindingKey) return;
	if (existing) existing.remove();

	const section = doc.createElement('section');
	section.id = 'gdl-customization-artwork';
	section.className = 'gdl-customization-artwork-injected';
	section.dataset.gdlArtworkBinding = bindingKey;
	section.setAttribute('aria-label', loc('game_artwork_picker_title', 'Library artwork'));
	section.style.cssText = 'display:block;position:relative;grid-column:1/-1;flex:0 0 auto;width:100%;max-width:100%;box-sizing:border-box;margin:24px 0 8px;padding:16px;background:rgba(35,40,49,.92);border:1px solid rgba(255,255,255,.07);border-radius:2px;font-family:inherit;';
	section.innerHTML = shortcutArtworkSettingsHtml(true, true);
	container.insertBefore(section, insertBefore);
	console.info(`[GDL] Personalización artwork mounted for "${gameTitle}" (${artworkAppId || 'AppID pending'}).`);

	const artworkSettings = bindShortcutArtworkSettings({
		section,
		doc,
		shortcutAppId: () => {
			const value = Number(artworkAppId);
			return Number.isInteger(value) && value > 0 ? (shortcutId || value) : null;
		},
		steamAppId: () => artworkAppId,
		gameTitle: () => gameTitle,
		includeAllSteamGames: true,
		alwaysShow: true,
	});

	// A non-Steam shortcut without a mapping must never be guessed as a native
	// AppID: applying artwork to that ID would modify a different game.
	if (/^\d+$/.test(mappedAppId) || isNonSteamShortcut || /^\d+$/.test(artworkAppId)) return;
	void resolveNativeGameAppId(doc, gameTitle).then(appId => {
		if (!section.isConnected) return Promise.resolve();
		artworkAppId = appId || '';
		section.dataset.gdlArtworkBinding = [gameTitle, shortcutId || '', artworkAppId].join('\u001f');
		return artworkSettings.refresh();
	});
}
