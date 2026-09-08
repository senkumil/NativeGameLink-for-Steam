import { backendLog } from '../../api/backend';
import { getPreferences } from '../../core/preferences';
import { readShortcutOverviewField, shortcutExecutableIdentity, shortcutStableIdentity } from '../../steam/shortcuts';
import { candidateSteamDocuments, nativeAddNonSteamDialogOpen, nativeAddSelectedExecutableIdentities } from './native-add-guard';
import { findMappingForShortcut, getAllShortcutRecords, refreshShortcutRecordsFromBackend, shortcutAlreadyLinked, type ShortcutRecord } from './registry';
import { requestNativeAddShortcutReview } from './manual-link';
import { hasNoLauncherOption, mergeNoLauncherOption, removeIncompatibleLauncherBypass, shouldAutoApplyNoLauncher } from './linking';

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let closeEvaluationTimers: ReturnType<typeof setTimeout>[] = [];
let dialogOpen = false;
let dialogObserved = false;
let sessionArmedAt = 0;
let sessionGeneration = 0;
const STARTUP_WARMUP_MS = 6000;
let pluginStartedAt = 0;
let startupSettled = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

const knownShortcutIds = new Set<number>();
const knownShortcutIdentities = new Set<string>();
const handledIds = new Set<number>();
const handledIdentities = new Set<string>();
const handledExecutables = new Set<string>();
const reconciledLauncherBypassMap = new Map<number, string>();

let baselineIds = new Set<number>();
let baselineIdentities = new Set<string>();
let selectedExecutables = new Set<string>();

const interactionListeners = new Map<Document, EventListener>();
const documentObservers = new Map<Document, MutationObserver>();
let scheduledTick: ReturnType<typeof setTimeout> | null = null;
let registryRefreshAt = 0;
let registryRefreshInFlight: Promise<void> | null = null;

function refreshBackendRegistry(force = false): void {
	const now = Date.now();
	const interval = dialogOpen ? 900 : 4000;
	if (!force && (registryRefreshInFlight || now - registryRefreshAt < interval)) return;
	registryRefreshAt = now;
	registryRefreshInFlight = refreshShortcutRecordsFromBackend()
		.then(() => { scanForNewlyAddedShortcuts(); })
		.catch(() => {})
		.finally(() => { registryRefreshInFlight = null; });
}

function nodeMayContainNativeAddUi(node: Node): boolean {
	if (node.nodeType !== Node.ELEMENT_NODE) return false;
	const element = node as Element;
	const signature = '[role="dialog"], [aria-modal="true"], [class*="Modal"], [class*="Dialog"], input[type="search"], input[type="checkbox"], [role="checkbox"]';
	try { return element.matches(signature) || Boolean(element.querySelector(signature)); }
	catch { return false; }
}

function scheduleTick(delayMs = 60): void {
	if (scheduledTick) return;
	scheduledTick = setTimeout(() => {
		scheduledTick = null;
		tick();
	}, delayMs);
}

function clearCloseEvaluationTimers(): void {
	for (const timer of closeEvaluationTimers) clearTimeout(timer);
	closeEvaluationTimers = [];
}

function looksLikeNativeAddAction(target: EventTarget | null): boolean {
	if (!target || (target as Node).nodeType !== 1) return false;
	const clickable = (target as Element).closest('button, [role="button"], [role="menuitem"], [class*="MenuItem"], [class*="menuitem"], [class*="Button"]') as Element | null;
	if (!clickable || clickable.closest('[id^="gdl-"]')) return false;
	if (clickable.getAttribute('role') === 'switch') return false;
	const text = `${clickable.textContent || ''} ${clickable.getAttribute('aria-label') || ''} ${clickable.getAttribute('title') || ''}`
		.toLocaleLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
	if (text.length > 180) return false;
	return /non[\s-]*steam|no\s+es\s+de\s+steam|n[aã]o(?:\s+é|\s+e)?(?:\s+da|\s+de)?\s+steam|nao?\s+steam|add\s+(?:a\s+)?non[\s-]*steam|a(?:n|ñ)adir\s+(?:un\s+)?juego.*steam|agregar\s+(?:un\s+)?juego.*steam|adicionar\s+(?:um\s+)?jogo.*steam|a(?:n|ñ)adir\s+un\s+producto|agregar\s+un\s+producto|a(?:n|ñ)adir\s+seleccionados|add\s+selected|agregar\s+seleccionados|adicionar\s+selecionados/.test(text);
}

function looksLikeAddSelectedAction(target: EventTarget | null): boolean {
	if (!target || (target as Node).nodeType !== 1) return false;
	const clickable = (target as Element).closest('button, [role="button"], [class*="Button"]') as Element | null;
	if (!clickable || clickable.closest('[id^="gdl-"]')) return false;
	const text = `${clickable.textContent || ''} ${clickable.getAttribute('aria-label') || ''} ${clickable.getAttribute('title') || ''}`
		.toLocaleLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
	if (text.length > 120) return false;
	return /a(?:n|ñ)adir\s+seleccionados|add\s+selected|agregar\s+seleccionados|adicionar\s+selecionados|ajouter\s+les\s+programmes|programme\s+hinzufügen|aggiungi\s+programmi/.test(text);
}

function recordIdentity(record: ShortcutRecord): string {
	return shortcutStableIdentity(record.app);
}

function recordExecutable(record: ShortcutRecord): string {
	return shortcutExecutableIdentity(readShortcutOverviewField(
		record.app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath',
	));
}

function snapshotBaseline(): void {
	const records = getAllShortcutRecords();
	baselineIds = new Set(records.map(record => record.id));
	baselineIdentities = new Set(records.map(recordIdentity).filter(Boolean));
	selectedExecutables.clear();
}

function captureCurrentSelections(): void {
	for (const executable of nativeAddSelectedExecutableIdentities()) {
		if (executable) selectedExecutables.add(executable);
	}
}

function isSessionNewRecord(record: ShortcutRecord): boolean {
	const identity = recordIdentity(record);
	return !baselineIds.has(record.id) && !(identity && baselineIdentities.has(identity));
}

function recordWasExplicitlySelected(record: ShortcutRecord): boolean {
	const executable = recordExecutable(record);
	return Boolean(executable && selectedExecutables.has(executable));
}

function triggerShortcutAutoReview(record: ShortcutRecord): boolean {
	if (handledIds.has(record.id)) return false;
	const identity = recordIdentity(record);
	const executable = recordExecutable(record);
	if (identity && handledIdentities.has(identity)) return false;
	if (executable && handledExecutables.has(executable)) return false;
	if (shortcutAlreadyLinked(record.id)) return false;

	handledIds.add(record.id);
	if (identity) handledIdentities.add(identity);
	if (executable) handledExecutables.add(executable);
	knownShortcutIds.add(record.id);
	if (identity) knownShortcutIdentities.add(identity);

	backendLog(`Auto review opening for newly added shortcut "${record.title}" (${record.id}).`);
	return requestNativeAddShortcutReview(record.id, record.title);
}

function scanForNewlyAddedShortcuts(): void {
	if (!getPreferences().autoDetectShortcuts) return;
	const records = getAllShortcutRecords();
	if (!records.length) return;

	const apps = (window as any).SteamClient?.Apps;
	for (const record of records) {
		const rawExe = readShortcutOverviewField(record.app, 'strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath');
		const steamAppId = findMappingForShortcut(record.id, record.title, rawExe);
		if (steamAppId) {
			if (typeof apps?.SetShortcutLaunchOptions === 'function') {
				const currentOptions = readShortcutOverviewField(record.app, 'strShortcutLaunchOptions', 'm_strShortcutLaunchOptions', 'shortcut_launch_options', 'strArguments') || '';
				if (shouldAutoApplyNoLauncher(steamAppId)) {
					if (!hasNoLauncherOption(currentOptions)) {
						const updated = mergeNoLauncherOption(currentOptions, steamAppId);
						if (reconciledLauncherBypassMap.get(record.id) !== updated) {
							reconciledLauncherBypassMap.set(record.id, updated);
							void apps.SetShortcutLaunchOptions(record.id, updated);
							backendLog(`Auto-reconciled launcher bypass for "${record.title}" (${record.id}): "${updated}"`);
						}
					}
				} else if (hasNoLauncherOption(currentOptions)) {
					const cleaned = removeIncompatibleLauncherBypass(currentOptions, steamAppId);
					if (reconciledLauncherBypassMap.get(record.id) !== cleaned) {
						reconciledLauncherBypassMap.set(record.id, cleaned);
						void apps.SetShortcutLaunchOptions(record.id, cleaned);
						backendLog(`Cleaned incompatible launcher bypass for "${record.title}" (${record.id}): "${cleaned}"`);
					}
				}
			}
		}
	}

	const inStartupWarmup = !startupSettled || (Date.now() - pluginStartedAt < STARTUP_WARMUP_MS);
	const bulkCatalogHydration = knownShortcutIds.size === 0 && records.length > 0;

	if (inStartupWarmup || bulkCatalogHydration) {
		for (const record of records) {
			knownShortcutIds.add(record.id);
			const identity = recordIdentity(record);
			if (identity) knownShortcutIdentities.add(identity);
			handledIds.add(record.id);
			if (identity) handledIdentities.add(identity);
			const executable = recordExecutable(record);
			if (executable) handledExecutables.add(executable);
		}
		return;
	}

	const currentIds = new Set<number>();
	for (const record of records) {
		currentIds.add(record.id);
		const identity = recordIdentity(record);
		const isNew = !knownShortcutIds.has(record.id) && !(identity && knownShortcutIdentities.has(identity));
		const isSelected = recordWasExplicitlySelected(record);
		const isDialogNew = isSessionNewRecord(record);

		if (isNew || isSelected || isDialogNew) {
			triggerShortcutAutoReview(record);
		}
	}

	for (const id of Array.from(knownShortcutIds)) {
		if (!currentIds.has(id)) {
			knownShortcutIds.delete(id);
			handledIds.delete(id);
		}
	}
}

function evaluateCommittedNativeAdds(generation: number): void {
	if (generation !== sessionGeneration || dialogOpen || !getPreferences().autoDetectShortcuts) return;
	scanForNewlyAddedShortcuts();
}

function ensureInteractionListeners(): void {
	for (const doc of candidateSteamDocuments()) {
		if (interactionListeners.has(doc)) continue;
		const handler: EventListener = (event) => {
			if (!dialogOpen && looksLikeNativeAddAction(event.target)) {
				armNativeAddSession();
			}
			if (dialogOpen) {
				captureCurrentSelections();
				if (looksLikeAddSelectedAction(event.target)) {
					onDialogClosed();
				}
			}
		};
		try {
			doc.addEventListener('click', handler, true);
			doc.addEventListener('pointerdown', handler, true);
			interactionListeners.set(doc, handler);
			const Observer = doc.defaultView?.MutationObserver;
			if (Observer && doc.body && !documentObservers.has(doc)) {
				const observer = new Observer(records => {
					if (dialogOpen || records.some(record =>
						Array.from(record.addedNodes).some(nodeMayContainNativeAddUi)
						|| Array.from(record.removedNodes).some(nodeMayContainNativeAddUi))) {
						scheduleTick();
					}
				});
				observer.observe(doc.body, { childList: true, subtree: true });
				documentObservers.set(doc, observer);
			}
		} catch {}
	}
	for (const [doc, observer] of Array.from(documentObservers)) {
		let alive = false;
		try { alive = Boolean(doc.body && doc.defaultView && !doc.defaultView.closed); } catch {}
		if (alive) continue;
		observer.disconnect();
		documentObservers.delete(doc);
	}
}

function clearInteractionListeners(): void {
	for (const [doc, handler] of interactionListeners) {
		try { doc.removeEventListener('click', handler, true); } catch {}
		try { doc.removeEventListener('pointerdown', handler, true); } catch {}
	}
	interactionListeners.clear();
	for (const observer of documentObservers.values()) observer.disconnect();
	documentObservers.clear();
}

function onDialogOpened(): void {
	refreshBackendRegistry(true);
	sessionGeneration += 1;
	clearCloseEvaluationTimers();
	snapshotBaseline();
	dialogOpen = true;
	dialogObserved = true;
	sessionArmedAt = Date.now();
	captureCurrentSelections();
	backendLog(`Native Add Non-Steam session opened with ${baselineIds.size} existing shortcut(s).`);
}

function armNativeAddSession(): void {
	refreshBackendRegistry(true);
	if (dialogOpen) return;
	sessionGeneration += 1;
	clearCloseEvaluationTimers();
	snapshotBaseline();
	dialogOpen = true;
	dialogObserved = false;
	sessionArmedAt = Date.now();
	backendLog(`Native Add Non-Steam session armed from Steam menu with ${baselineIds.size} existing shortcut(s).`);
}

function onDialogClosed(): void {
	refreshBackendRegistry(true);
	captureCurrentSelections();
	dialogOpen = false;
	dialogObserved = false;
	sessionArmedAt = 0;
	const generation = sessionGeneration;
	for (const delay of [50, 150, 300, 500, 800, 1200, 1800, 2500, 4000, 6500, 9000]) {
		closeEvaluationTimers.push(setTimeout(() => evaluateCommittedNativeAdds(generation), delay));
	}
	backendLog(`Native Add Non-Steam session closed; selected executable(s): ${selectedExecutables.size}.`);
	try { window.dispatchEvent(new Event('gdl:shortcuts-changed')); } catch {}
}

function tick(): void {
	ensureInteractionListeners();
	refreshBackendRegistry();
	let open = false;
	try { open = nativeAddNonSteamDialogOpen(); } catch {}
	if (open) {
		if (!dialogOpen) onDialogOpened();
		else {
			dialogObserved = true;
			captureCurrentSelections();
		}
	} else if (dialogOpen && (dialogObserved || Date.now() - sessionArmedAt > 12000)) {
		onDialogClosed();
	}
	scanForNewlyAddedShortcuts();
}

export function startNativeAddAutoDetector(): void {
	if (watcherTimer) return;
	pluginStartedAt = Date.now();
	refreshBackendRegistry(true);
	dialogOpen = false;
	startupSettled = false;
	scanForNewlyAddedShortcuts();
	if (startupTimer) clearTimeout(startupTimer);
	startupTimer = setTimeout(() => {
		startupSettled = true;
		scanForNewlyAddedShortcuts();
	}, STARTUP_WARMUP_MS);

	watcherTimer = setInterval(() => {
		ensureInteractionListeners();
		tick();
	}, 4000);
	ensureInteractionListeners();
	tick();
}

export function stopNativeAddAutoDetector(): void {
	if (watcherTimer) clearInterval(watcherTimer);
	watcherTimer = null;
	if (startupTimer) clearTimeout(startupTimer);
	startupTimer = null;
	if (scheduledTick) clearTimeout(scheduledTick);
	scheduledTick = null;
	clearCloseEvaluationTimers();
	dialogOpen = false;
	dialogObserved = false;
	sessionArmedAt = 0;
	pluginStartedAt = 0;
	startupSettled = false;
	registryRefreshAt = 0;
	registryRefreshInFlight = null;
	baselineIds.clear();
	baselineIdentities.clear();
	selectedExecutables.clear();
	knownShortcutIds.clear();
	knownShortcutIdentities.clear();
	handledIds.clear();
	handledIdentities.clear();
	handledExecutables.clear();
	reconciledLauncherBypassMap.clear();
	clearInteractionListeners();
}
