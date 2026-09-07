import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { ACH_CLASSES, PLAYBAR_CLASSES } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import {
	applyNativePlaybarTypography,
	buildNativeAchievementPlaybarBlueprint,
	elementsWithCssModuleClass,
	hasCssModuleClass,
	isRenderedElement,
	NATIVE_UI_BLUEPRINT_KEYS,
} from '../../steam/native-dom';
import { preserveLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import {
	ensureLocalPlaybarStat,
	findVisibleTextElement,
	focusAchievementsSection,
	getAchievementProgress,
	revealPendingAchievementSidebar,
	renderLocalAchievementSidebar,
} from '../achievements/runtime';
import { getCachedLocalAchievementsForGame } from '../achievements/cache';
import { fetchLocalAchievementData } from '../achievements/service';
import { ensureCloudStatus } from './cloud-status';

export interface LinkedAchievementChromeContext {
	steamAppId: string;
	fallbackTotal: number;
	stateAppId?: string;
	isCurrent: () => boolean;
}

async function injectPlayBarAchievements(doc: Document, context: LinkedAchievementChromeContext): Promise<void> {
	const progress = await getAchievementProgress(Number(context.steamAppId), context.fallbackTotal);
	if (!progress || progress.total <= 0 || !context.isCurrent()) return;
	const playbar = PLAYBAR_CLASSES();
	const achievements = ACH_CLASSES();
	const pct = Math.round((100 * progress.unlocked) / progress.total);
	const open = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		focusAchievementsSection(doc);
	};

	let existing = doc.getElementById('gdl-playbar-achievements');
	if (existing) {
		if (existing.dataset.gdlNativeBlueprint !== '1') {
			const upgraded = buildNativeAchievementPlaybarBlueprint(doc, progress.unlocked, progress.total, open);
			if (upgraded) {
				existing.replaceWith(upgraded);
				existing = upgraded;
			}
		}
		const count = elementsWithCssModuleClass(existing, playbar.AchievementCountLabel)[0]
			|| Array.from(existing.querySelectorAll<HTMLElement>('div,span')).find(element => /^\s*\d+\s*\/\s*\d+\s*$/.test(element.textContent || ''))
			|| null;
		if (count) count.textContent = `${progress.unlocked}/${progress.total}`;
		const fill = elementsWithCssModuleClass(existing, playbar.DetailsProgressBar)[0]
			|| elementsWithCssModuleClass(existing, achievements.AchievementProgress)[0]
			|| null;
		if (fill) fill.style.width = `${pct}%`;
		applyNativePlaybarTypography(existing, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
		preserveLinkedPlaybarVisibility(doc);
		return;
	}

	const findLabel = (text: string): HTMLElement | null => {
		const target = text.trim().toLocaleLowerCase();
		const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, null);
		let node: Text | null;
		while ((node = walker.nextNode() as Text | null)) {
			if (node.textContent?.trim().toLocaleLowerCase() === target) return node.parentElement;
		}
		return null;
	};

	const nativePlayStat = elementsWithCssModuleClass(doc, playbar.GameStatsSection)
		.flatMap(section => elementsWithCssModuleClass(section, playbar.GameStat))
		.find(candidate => hasCssModuleClass(candidate, playbar.Playtime) && isRenderedElement(doc, candidate)) || null;
	const label = nativePlayStat
		? elementsWithCssModuleClass(nativePlayStat, playbar.PlayBarLabel)[0]
			|| findVisibleTextElement(doc, loc('AppDetails_SectionTitle_PlayTime', 'Playtime'), nativePlayStat)
		: findLabel(loc('AppDetails_SectionTitle_PlayTime', 'Playtime'));
	if (!label) {
		backendLog('Play bar: PLAY TIME label not found');
		return;
	}
	const value = label.nextElementSibling as HTMLElement | null;
	if (!value) return;

	const lastPlayed = findLabel(loc('AppDetails_SectionTitle_LastPlayed', 'Last played'));
	let statRoot: HTMLElement = nativePlayStat || label;
	if (!nativePlayStat && lastPlayed && !label.contains(lastPlayed)) {
		while (statRoot.parentElement && !statRoot.parentElement.contains(lastPlayed)) statRoot = statRoot.parentElement;
	} else if (!nativePlayStat && label.parentElement?.parentElement) {
		statRoot = label.parentElement.parentElement;
	}
	const statsRow = statRoot.parentElement;
	if (!statsRow) return;

	const controller = statsRow.querySelector<HTMLElement>('#gdl-bp-playbar-controller, [data-gdl-playbar-controller="1"]');
	const insertTarget = controller && controller.parentElement === statsRow ? controller.nextSibling : statRoot.nextSibling;

	const nativeBlueprint = buildNativeAchievementPlaybarBlueprint(doc, progress.unlocked, progress.total, open);
	if (nativeBlueprint) {
		const achievementGraphic = nativeBlueprint.querySelector<HTMLElement>('svg, img');
		if (achievementGraphic?.parentElement) achievementGraphic.parentElement.dataset.gdlUiIconHost = 'playbar-achievements';
		applyNativePlaybarTypography(nativeBlueprint, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
		statsRow.insertBefore(nativeBlueprint, insertTarget);
		if (controller && controller.parentElement === statsRow && (nativeBlueprint.compareDocumentPosition(controller) & Node.DOCUMENT_POSITION_FOLLOWING)) {
			statsRow.insertBefore(controller, nativeBlueprint);
		}
		preserveLinkedPlaybarVisibility(doc);
		return;
	}

	const stat = doc.createElement('div');
	stat.id = 'gdl-playbar-achievements';
	stat.dataset.gdlPlaybarAchievements = '1';
	stat.dataset.gdlNativeBlueprint = '0';
	stat.className = statRoot.className;
	const inner = `<div class="${label.className}">${escapeHtml(loc('AppDetails_SectionTitle_Achievements', 'Achievements'))}</div>
		<div class="${value.className}" style="display:flex;align-items:center;gap:8px;">
			<span>${progress.unlocked}/${progress.total}</span>
			<div class="${achievements.SingleAchievementProgressBar}" style="width:96px;"><div class="${achievements.AchievementProgress}" style="width:${pct}%;"></div></div>
		</div>`;
	const labelWrap = label.parentElement;
	stat.innerHTML = labelWrap && labelWrap !== statRoot ? `<div class="${labelWrap.className}">${inner}</div>` : inner;
	stat.style.cursor = 'pointer';
	stat.title = gdlText('view_linked_achievements', 'View achievements for this linked game');
	stat.addEventListener('click', open);
	applyNativePlaybarTypography(stat, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
	statsRow.insertBefore(stat, insertTarget);
	if (controller && controller.parentElement === statsRow && (stat.compareDocumentPosition(controller) & Node.DOCUMENT_POSITION_FOLLOWING)) {
		statsRow.insertBefore(controller, stat);
	}
	preserveLinkedPlaybarVisibility(doc);
}

/** Resolves local read-only progress first, then the Steam client cache. */
export async function finalizeLinkedAchievements(doc: Document, context: LinkedAchievementChromeContext): Promise<void> {
	// Instant synchronous fast path:
	// If local achievement snapshot or Steam fallback total exists in cache,
	// mount the playbar stat and sidebar immediately (0ms) without waiting for async IPC.
	const cachedLocal = getCachedLocalAchievementsForGame(context.steamAppId, context.stateAppId);
	if (cachedLocal?.found && Array.isArray(cachedLocal.achievements) && cachedLocal.total > 0) {
		renderLocalAchievementSidebar(doc, cachedLocal);
		ensureLocalPlaybarStat(doc, cachedLocal);
		ensureCloudStatus(doc);
	} else if (context.fallbackTotal > 0) {
		void injectPlayBarAchievements(doc, context);
	}

	try {
		const local = await fetchLocalAchievementData(context.steamAppId, { stateAppId: context.stateAppId });
		if (!context.isCurrent()) return;
		if (local?.found && Array.isArray(local.achievements) && local.total > 0) {
			renderLocalAchievementSidebar(doc, local);
			ensureLocalPlaybarStat(doc, local);
			ensureCloudStatus(doc);
			return;
		}
	} catch (error) {
		backendLog('Local achievements check in finalizeLinkedAchievements error: ' + error);
	}

	await injectPlayBarAchievements(doc, context);
	if (context.isCurrent()) {
		revealPendingAchievementSidebar(doc);
		ensureCloudStatus(doc);
	}
}
