import type { LocalAchievementData } from '../../domain/types';
import { backendLog } from '../../api/backend';
import { escapeHtml } from '../../core/text';
import { PLAYBAR_CLASSES } from '../../steam/css';
import { gdlText, loc } from '../../steam/localization';
import {
	applyNativePlaybarTypography,
	buildNativeAchievementPlaybarBlueprint,
	elementsWithCssModuleClass,
	isRenderedElement,
	NATIVE_UI_BLUEPRINT_KEYS,
} from '../../steam/native-dom';
import { preserveLinkedPlaybarVisibility } from '../../steam/playbar-visibility';
import { localAchievementPercent } from './format';
import { openLocalAchievementsModal } from './modal';

export function findVisibleTextElement(doc: Document, wanted: string, root?: Node): HTMLElement | null {
	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
	const target = normalize(wanted);
	const walker = doc.createTreeWalker(root || doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, null);
	let node: Text | null;
	while ((node = walker.nextNode() as Text | null)) {
		if (normalize(node.textContent || '') !== target || !node.parentElement) continue;
		if (isRenderedElement(doc, node.parentElement)) return node.parentElement;
	}
	return null;
}

function achievementMedalSvg(extraClass = '', isComplete = false): string {
	if (isComplete) {
		return `<svg class="${extraClass}" width="33" height="33" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;">
			<path stroke="url(#gdl-playbar-ribbon-grad)" fill="url(#gdl-playbar-ribbon-grad)" d="M10.1777 10.0258L10.3929 9.80693V9.49999V5.52777H14.2857H14.6001L14.8205 5.30358L18 2.06976L21.1795 5.30358L21.3999 5.52777H21.7143H21.7143H25.6071V9.50001V9.80696L25.8223 10.0258L28.5553 12.8055L25.8223 15.5853L25.6071 15.8041V16.1111V20.0833H21.7143H21.3999L21.1795 20.3075L18 23.5413L14.8205 20.3075L14.6001 20.0833H14.2857H10.3929V16.1111V15.8042L10.1777 15.5853L7.44464 12.8055L10.1777 10.0258ZM14.7399 28.0317L11.56 33.4221L9.85164 29.9469L9.6456 29.5278H9.17857H6.29474L8.68445 25.3611H12.1142L14.7399 28.0317ZM26.8214 29.5278H26.3544L26.1484 29.9469L24.44 33.4221L21.2601 28.0317L23.8858 25.3611H27.3155L29.7053 29.5278H26.8214Z" stroke-width="1.5"/>
			<circle stroke="#FFAB2C" fill="#FFC82C" cx="18" cy="13" r="5.5"/>
			<defs>
				<linearGradient id="gdl-playbar-ribbon-grad" x1="7.08" y1="3.72" x2="33.6694" y2="25.0697" gradientUnits="userSpaceOnUse">
					<stop stop-color="#0056D6"/>
					<stop offset="1" stop-color="#1A9FFF"/>
				</linearGradient>
			</defs>
		</svg>`;
	}
	return `<svg class="${extraClass}" width="33" height="33" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="color:currentColor;display:block;"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M9.64304 9.49988L6.39294 12.8055L9.64304 16.1112V20.8333H14.2858L18.0001 24.6111L21.7143 20.8333H26.3573V16.111L29.6072 12.8055L26.3573 9.50012V4.77777H21.7143L18.0001 1L14.2858 4.77777H9.64304V9.49988ZM22.6432 12.8056C22.6432 15.4136 20.5645 17.5278 18.0004 17.5278C15.4362 17.5278 13.3575 15.4136 13.3575 12.8056C13.3575 10.1976 15.4362 8.08334 18.0004 8.08334C20.5645 8.08334 22.6432 10.1976 22.6432 12.8056Z"/><path fill="currentColor" d="M5 30.2778L8.25 24.6111H12.4286L15.6786 27.9167L11.5 35L9.17857 30.2778H5Z"/><path fill="currentColor" d="M30.9999 30.2778L27.7499 24.6111H23.5713L20.3213 27.9167L24.4999 35L26.8213 30.2778H30.9999Z"/></svg>`;
}

function updateAchievementMedal(
	stat: HTMLElement,
	classes: ReturnType<typeof PLAYBAR_CLASSES>,
	isComplete: boolean,
): void {
	const iconHost = elementsWithCssModuleClass(stat, classes.GameStatIcon)[0]
		|| elementsWithCssModuleClass(stat, classes.GameStatIconForced)[0]
		|| stat.querySelector<HTMLElement>('.gdl-lp-icon')
		|| stat.querySelector<HTMLElement>('svg, img')?.parentElement
		|| null;
	if (iconHost) {
		const targetStatus = isComplete ? 'complete' : 'in-progress';
		if (iconHost.dataset.gdlMedalStatus === targetStatus && iconHost.firstElementChild) return;
		iconHost.dataset.gdlMedalStatus = targetStatus;
		iconHost.innerHTML = achievementMedalSvg(classes.AchievementSVG || '', isComplete);
	}
}

export function ensureLocalPlaybarStat(doc: Document, data: LocalAchievementData): HTMLElement | null {
	if (!data || data.total <= 0) return null;
	const classes = PLAYBAR_CLASSES();
	const pct = localAchievementPercent(data);
	const isComplete = data.unlocked >= data.total && data.total > 0;
	const progressText = `${data.unlocked}/${data.total}`;
	let sections = elementsWithCssModuleClass(doc, classes.GameStatsSection).filter(section => section.isConnected);
	if (sections.length === 0) {
		const cloud = doc.querySelector('[data-gdl-cloud-status="1"]') as HTMLElement | null;
		if (cloud?.parentElement) sections = [cloud.parentElement];
		else {
			const playtime = doc.querySelector('[data-gdl-playtime="1"], .SVGIcon_PlayTime') as HTMLElement | null;
			if (playtime?.parentElement?.parentElement) {
				const candidate = playtime.closest('[class*="GameStatsSection"], [class*="gameStatsSection"], [class*="PlayBarStats"], [class*="playBarStats"]') as HTMLElement | null
					|| playtime.parentElement.parentElement;
				if (candidate) sections = [candidate];
			} else {
				const fallback = doc.querySelector('[class*="GameStatsSection"], [class*="gameStatsSection"], [class*="PlayBarStats"], [class*="playBarStats"]') as HTMLElement | null;
				if (fallback) sections = [fallback];
			}
		}
	}
	if (sections.length === 0) return null;
	let lastStat: HTMLElement | null = null;
	for (const stats of sections) {
		const open = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			void openLocalAchievementsModal(doc, data).catch(error => backendLog('Achievements modal error: ' + error));
		};
		let stat = stats.querySelector<HTMLElement>('[data-gdl-playbar-achievements="1"], #gdl-playbar-achievements');
		if (stat) {
			if (stat.dataset.gdlNativeBlueprint !== '1') {
				const upgraded = buildNativeAchievementPlaybarBlueprint(doc, data.unlocked, data.total, open);
				if (upgraded) {
					stat.replaceWith(upgraded);
					stat = upgraded;
				}
			}
			const count = stat.querySelector<HTMLElement>('.gdl-lp-count')
				|| elementsWithCssModuleClass(stat, classes.AchievementCountLabel)[0]
				|| Array.from(stat.querySelectorAll<HTMLElement>('div,span')).find(element => /^\s*\d+\s*\/\s*\d+\s*$/.test(element.textContent || ''))
				|| null;
			if (count && count.textContent !== progressText) count.textContent = progressText;
			const fill = stat.querySelector<HTMLElement>('.gdl-lp-fill')
				|| elementsWithCssModuleClass(stat, classes.DetailsProgressBar)[0]
				|| null;
			const targetWidth = `${pct}%`;
			if (fill && fill.style.width !== targetWidth) fill.style.width = targetWidth;
			if (stat.classList.contains('is-complete') !== isComplete) {
				stat.classList.toggle('is-complete', isComplete);
			}
			updateAchievementMedal(stat, classes, isComplete);
			applyNativePlaybarTypography(stat, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
			const controller = stats.querySelector<HTMLElement>('#gdl-bp-playbar-controller, [data-gdl-playbar-controller="1"]');
			if (controller && controller.parentElement === stats && (stat.compareDocumentPosition(controller) & Node.DOCUMENT_POSITION_FOLLOWING)) {
				stats.insertBefore(controller, stat);
			}
			lastStat = stat;
			continue;
		}
		let wrapper = buildNativeAchievementPlaybarBlueprint(doc, data.unlocked, data.total, open);
		if (wrapper) {
			wrapper.classList.toggle('is-complete', isComplete);
			updateAchievementMedal(wrapper, classes, isComplete);
			applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
			stats.appendChild(wrapper);
			const controller = stats.querySelector<HTMLElement>('#gdl-bp-playbar-controller, [data-gdl-playbar-controller="1"]');
			if (controller && controller.parentElement === stats && (wrapper.compareDocumentPosition(controller) & Node.DOCUMENT_POSITION_FOLLOWING)) {
				stats.insertBefore(controller, wrapper);
			}
			lastStat = wrapper;
			continue;
		}
		wrapper = doc.createElement('div');
		wrapper.dataset.gdlPlaybarAchievements = '1';
		wrapper.dataset.gdlNativeBlueprint = '0';
		wrapper.id = 'gdl-playbar-achievements';
		wrapper.className = `${classes.GameStat || ''} ${classes.MiniAchievements || classes.Playtime || ''} gdl-local-playbar`;
		wrapper.title = gdlText('view_linked_achievements', 'View achievements for this linked game');
		wrapper.innerHTML = `<div class="${classes.GameStatIcon || classes.GameStatIconForced || ''} ${classes.AchievementSVG || ''} gdl-lp-icon">${achievementMedalSvg(classes.AchievementSVG || '', isComplete)}</div><div class="${classes.HideWhenNarrow || ''} ${classes.GameStatRight || ''} ${classes.AchievementRight || ''}"><div class="${classes.PlayBarLabel || ''} ${classes.AchievementLabel || ''}">${escapeHtml(loc('AppDetails_SectionTitle_Achievements', gdlText('achievements_label', 'Achievements')))}</div><div class="${classes.AchievementProgressRow || ''}"><div class="gdl-lp-count ${classes.PlayBarDetailLabel || ''} ${classes.AchievementCountLabel || ''}">${progressText}</div><div class="gdl-lp-bar ${classes.DetailsProgressContainer || ''}"><div class="gdl-lp-fill ${classes.DetailsProgressBar || ''}" style="width:${pct}%;"></div></div></div></div>`;
		wrapper.addEventListener('click', open);
		applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements);
		stats.appendChild(wrapper);
		const controller = stats.querySelector<HTMLElement>('#gdl-bp-playbar-controller, [data-gdl-playbar-controller="1"]');
		if (controller && controller.parentElement === stats && (wrapper.compareDocumentPosition(controller) & Node.DOCUMENT_POSITION_FOLLOWING)) {
			stats.insertBefore(controller, wrapper);
		}
		lastStat = wrapper;
	}
	preserveLinkedPlaybarVisibility(doc);
	return lastStat;
}
