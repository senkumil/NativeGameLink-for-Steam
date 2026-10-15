import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText, loc } from '../../steam/localization';
import { pickCachedLocalAchievementSnapshot } from './cache';
import { formatLocalUnlockDate, localAchievementPercent } from './format';
import { getLocalAchievementGameInfo } from './game-info';
import { highlightedAchievementNames, isRareAchievement } from './rarity';
import { getSteamRareAchievementClasses, renderSteamRareGlowHtml } from './steam-rare';
import { ensureAchievementModalStyles } from './styles/modal';
import { getAchievementComparisonFriends, getFriendAchievementState, type FriendAchievementState } from './comparison';
import { isCurrentAchievementTarget, linkedAchievementTarget } from './navigation';
import { getCurrentSteamUser } from '../library/social/feed';

const activeModalClosers = new WeakMap<Document, () => void>();
const modalOpenGenerations = new WeakMap<Document, object>();
const modalDocuments = new Set<Document>();

/** Retire both an open sheet and its pending metadata request. Tokens cannot
 * regain ownership if the same shortcut is visited again before IPC finishes. */
export function disposeLocalAchievementsModal(doc: Document): void {
	modalOpenGenerations.delete(doc);
	modalDocuments.delete(doc);
	const close = activeModalClosers.get(doc);
	activeModalClosers.delete(doc);
	close?.();
}

export function disposeAllLocalAchievementsModals(): void {
	for (const doc of Array.from(modalDocuments)) disposeLocalAchievementsModal(doc);
}

function achievementText(token: string, fallback: string, ...values: Array<string | number>): string {
	return loc(token, fallback).replace(/%([1-9]\d*)\$[sd]/g, (placeholder, index) => String(values[Number(index) - 1] ?? placeholder));
}

const COMPLETION_RIBBON_IMAGE = `<svg class="gdl-lam-completion-art" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;width:100%;height:100%;">
	<path stroke="url(#gdl-lam-ribbon-grad)" fill="url(#gdl-lam-ribbon-grad)" d="M10.1777 10.0258L10.3929 9.80693V9.49999V5.52777H14.2857H14.6001L14.8205 5.30358L18 2.06976L21.1795 5.30358L21.3999 5.52777H21.7143H21.7143H25.6071V9.50001V9.80696L25.8223 10.0258L28.5553 12.8055L25.8223 15.5853L25.6071 15.8041V16.1111V20.0833H21.7143H21.3999L21.1795 20.3075L18 23.5413L14.8205 20.3075L14.6001 20.0833H14.2857H10.3929V16.1111V15.8042L10.1777 15.5853L7.44464 12.8055L10.1777 10.0258ZM14.7399 28.0317L11.56 33.4221L9.85164 29.9469L9.6456 29.5278H9.17857H6.29474L8.68445 25.3611H12.1142L14.7399 28.0317ZM26.8214 29.5278H26.3544L26.1484 29.9469L24.44 33.4221L21.2601 28.0317L23.8858 25.3611H27.3155L29.7053 29.5278H26.8214Z" stroke-width="1.5"/>
	<circle stroke="#FFAB2C" fill="#FFC82C" cx="18" cy="13" r="5.5"/>
	<defs>
		<linearGradient id="gdl-lam-ribbon-grad" x1="7.08" y1="3.72" x2="33.6694" y2="25.0697" gradientUnits="userSpaceOnUse">
			<stop stop-color="#0056D6"/>
			<stop offset="1" stop-color="#1A9FFF"/>
		</linearGradient>
	</defs>
</svg>`;


function resolveModalViewport(doc: Document): { left: number; top: number; width: number; height: number } {
	const view = doc.defaultView;
	const viewportWidth = Math.max(0, view?.innerWidth || doc.documentElement.clientWidth || 1280);
	const viewportHeight = Math.max(0, view?.innerHeight || doc.documentElement.clientHeight || 720);
	const injected = doc.getElementById('gdl-library-injected');
	const candidates: DOMRect[] = [];
	let current: HTMLElement | null = injected as HTMLElement | null;
	while (current && current !== doc.body) {
		const rect = current.getBoundingClientRect();
		if (rect.width >= 640 && rect.height >= 420 && rect.left >= 180 && rect.right <= viewportWidth + 1) {
			candidates.push(rect);
		}
		current = current.parentElement;
	}
	const picked = candidates.sort((a, b) => a.left - b.left || b.width - a.width)[0];
	if (picked) {
		const left = Math.max(0, Math.round(picked.left));
		const top = Math.max(0, Math.round(picked.top));
		const width = Math.max(480, Math.round(Math.min(viewportWidth - left, picked.width)));
		const height = Math.max(360, Math.round(Math.min(viewportHeight - top, picked.height)));
		return { left, top, width, height };
	}
	const fallbackLeft = Math.round(Math.min(Math.max(320, viewportWidth * 0.24), Math.max(320, viewportWidth - 720)));
	const fallbackTop = 86;
	return {
		left: fallbackLeft,
		top: fallbackTop,
		width: Math.max(560, viewportWidth - fallbackLeft),
		height: Math.max(420, viewportHeight - fallbackTop),
	};
}

export async function openLocalAchievementsModal(doc: Document, data: LocalAchievementData): Promise<void> {
	disposeLocalAchievementsModal(doc);
	const target = linkedAchievementTarget(doc);
	if (!target || String(data.metadata_appid || data.appid) !== target.steamAppId) return;
	const opening = {};
	modalOpenGenerations.set(doc, opening);
	modalDocuments.add(doc);
	const current = (): boolean => modalOpenGenerations.get(doc) === opening
		&& Boolean(doc.body && !doc.defaultView?.closed) && isCurrentAchievementTarget(doc, target);
	ensureAchievementModalStyles(doc);
	doc.getElementById('gdl-local-achievement-modal')?.remove();
	const activeData = pickCachedLocalAchievementSnapshot(data);
	let info: Awaited<ReturnType<typeof getLocalAchievementGameInfo>>;
	try { info = await getLocalAchievementGameInfo(activeData.appid); }
	catch (error) {
		if (modalOpenGenerations.get(doc) === opening) disposeLocalAchievementsModal(doc);
		throw error;
	}
	if (!current()) {
		if (modalOpenGenerations.get(doc) === opening) disposeLocalAchievementsModal(doc);
		return;
	}
	ensureAchievementModalStyles(doc);
	doc.getElementById('gdl-local-achievement-modal')?.remove();
	const pct = localAchievementPercent(activeData);
	const complete = activeData.total > 0 && activeData.unlocked >= activeData.total;
	const user = getCurrentSteamUser(doc);
	const overlay = doc.createElement('div');
	overlay.id = 'gdl-local-achievement-modal';
	overlay.style.position = 'fixed';
	overlay.innerHTML = `
		<div class="gdl-lam-window" role="dialog" aria-modal="true" aria-labelledby="gdl-lam-title">
			<button class="gdl-lam-close" type="button" aria-label="${escapeHtml(gdlText('close', 'Close'))}"><svg class="gdl-lam-close-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M32 32L224 224M224 32L32 224" fill="none" stroke="currentColor" stroke-width="16"/></svg></button>
			<div class="gdl-lam-head">
				<div class="gdl-lam-title" id="gdl-lam-title">
					${(info.iconImage || info.headerImage) ? `<img class="gdl-lam-game-icon" src="${escapeHtml(info.iconImage || info.headerImage)}" alt="">` : ''}
					<span>${escapeHtml(info.name)}</span>
				</div>
				<div class="gdl-lam-progressbox${activeData.unlocked >= activeData.total && activeData.total > 0 ? ' is-complete' : ''}">
					${activeData.unlocked >= activeData.total && activeData.total > 0 ? `<div class="gdl-lam-completion-badge">${COMPLETION_RIBBON_IMAGE}</div>` : ''}
					<div class="gdl-lam-progress-copy">
						<div class="gdl-lam-progressline">
							<span>${escapeHtml(complete
								? achievementText('AppDetails_PlayerUnlockedPercentAll', "You've unlocked all achievements! %1$s/%2$s", activeData.unlocked, activeData.total)
								: achievementText('Achievements_HeaderStats_Earned_Label', '%1$s of %2$s achievements earned', activeData.unlocked, activeData.total))}</span>
							<span>(${pct}%)</span>
						</div>
						<div class="gdl-lam-track"><div class="gdl-lam-fill" style="width:${pct}%"></div></div>
					</div>
				</div>
				<div class="gdl-lam-tabs" role="tablist">
					<button class="gdl-lam-tab active" type="button" data-tab="mine" role="tab" aria-selected="true">${escapeHtml(loc('Achievements_Tab_MyAchievements', 'My achievements'))}</button>
					<button class="gdl-lam-tab" type="button" data-tab="global" role="tab" aria-selected="false">${escapeHtml(loc('Achievements_Tab_GlobalAchievements', 'Global achievements'))}</button>
				</div>
			</div>
			<div class="gdl-lam-scroll">
				<div class="gdl-lam-toolbar">
					<div class="gdl-lam-global-user" hidden title="${escapeHtml(user.name)}"><img class="gdl-lam-user-avatar" src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.name)}"></div>
					<input class="gdl-lam-search" type="search" aria-label="${escapeHtml(loc('Achievements_Filter_Default', 'Search'))}" placeholder="${escapeHtml(loc('Achievements_Filter_Default', 'Search'))}">
					<div class="gdl-lam-compare-control"><select class="gdl-lam-compare" aria-label="${escapeHtml(loc('Achievements_ComparisonLabel_NotComparing', 'Compare with...'))}"><option value="">${escapeHtml(loc('Achievements_ComparisonLabel_NotComparing', 'Compare with...'))}</option></select><svg class="gdl-lam-compare-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div>
					<div class="gdl-lam-global-label" hidden>${escapeHtml(loc('Achievements_GlobalAchievement_PercentUnlockedLabel', '% of all players'))}</div>
				</div>
				<div class="gdl-lam-comparison-status" role="status" hidden></div>
				<div class="gdl-lam-list"></div>
			</div>
		</div>`;
	doc.body.appendChild(overlay);

	const windowEl = overlay.querySelector('.gdl-lam-window') as HTMLElement | null;
	const headEl = overlay.querySelector('.gdl-lam-head') as HTMLElement | null;
	const heroArt = info.heroImage || info.headerImage;
	if (heroArt) {
		const cssHeroImage = `url(${JSON.stringify(heroArt)})`;
		windowEl?.style.setProperty('--gdl-lam-hero-image', cssHeroImage);
		headEl?.style.setProperty('--gdl-lam-hero-image', cssHeroImage);
	}

	const syncViewport = () => {
		const bounds = resolveModalViewport(doc);
		overlay.style.inset = 'auto';
		overlay.style.left = `${bounds.left}px`;
		overlay.style.top = `${bounds.top}px`;
		overlay.style.width = `${bounds.width}px`;
		overlay.style.height = `${bounds.height}px`;
	};

	const view = doc.defaultView;
	let syncFrame = 0;
	const requestViewportSync = (): void => {
		if (syncFrame || !view) {
			if (!view) syncViewport();
			return;
		}
		syncFrame = view.requestAnimationFrame(() => {
			syncFrame = 0;
			syncViewport();
		});
	};

	const geometryTargets: HTMLElement[] = [];
	let geometryNode = doc.getElementById('gdl-library-injected') as HTMLElement | null;
	while (geometryNode && geometryNode !== doc.body) {
		geometryTargets.push(geometryNode);
		geometryNode = geometryNode.parentElement;
	}
	const resizeObserver = typeof ResizeObserver !== 'undefined'
		? new ResizeObserver(() => requestViewportSync())
		: null;
	geometryTargets.forEach(target => resizeObserver?.observe(target));

	const onWindowResize = () => requestViewportSync();
	const onDividerMove = () => requestViewportSync();
	const onGeometryTransition = () => requestViewportSync();
	view?.addEventListener('resize', onWindowResize);
	doc.addEventListener('pointermove', onDividerMove, true);
	doc.addEventListener('transitionrun', onGeometryTransition, true);
	doc.addEventListener('transitionend', onGeometryTransition, true);

	syncViewport();

	const list = overlay.querySelector('.gdl-lam-list') as HTMLElement;
	const search = overlay.querySelector('.gdl-lam-search') as HTMLInputElement;
	const comparison = overlay.querySelector('.gdl-lam-compare') as HTMLSelectElement;
	const comparisonControl = overlay.querySelector('.gdl-lam-compare-control') as HTMLElement;
	const comparisonStatus = overlay.querySelector('.gdl-lam-comparison-status') as HTMLElement;
	const toolbar = overlay.querySelector('.gdl-lam-toolbar') as HTMLElement;
	const globalUser = overlay.querySelector('.gdl-lam-global-user') as HTMLElement;
	const globalLabel = overlay.querySelector('.gdl-lam-global-label') as HTMLElement;
	let comparisonStates: Map<string, FriendAchievementState> | null = null;
	let comparisonName = '';
	let comparisonGeneration = 0;
	let tab: 'mine' | 'global' = 'mine';
	const revealedGlobalAchievements = new Set<string>();
	const highlightedNames = highlightedAchievementNames(activeData.achievements);
	const rowHtml = (item: LocalAchievementItem, globalMode: boolean): string => {
		const globalKnown = item.global_percent_known !== false && Number.isFinite(item.global_percent);
		const globalPercent = globalKnown ? Math.max(0, Math.min(100, item.global_percent)) : 0;
		if (globalMode) {
			const icon = item.icon || item.icon_gray;
			const hidden = item.hidden && !item.earned && !revealedGlobalAchievements.has(item.name);
			const title = hidden ? loc('Achievements_HiddenAchievementItem_Individual_Title', 'Hidden achievement') : item.display_name || item.name;
			const description = hidden ? loc('Achievements_HiddenAchievementItem_Description', 'Details for this achievement will be revealed once unlocked') : item.description || '';
			return `<div class="gdl-lam-row is-global${hidden ? ' is-hidden-global' : ''}" data-earned="${item.earned ? 'true' : 'false'}" data-achievement="${escapeHtml(item.name)}"${hidden ? ` role="button" tabindex="0" aria-label="${escapeHtml(loc('Achievements_HiddenAchievementItem_Individual_Reveal', 'Show spoiler'))}"` : ''}>
				<div class="gdl-lam-global-check">${item.earned ? '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M31.09 4.38L13 22.46L5.41 14.88L1.88 18.41L13 29.54L34.62 7.91L31.09 4.38Z" fill="currentColor"/></svg>' : ''}</div>
				<div class="gdl-lam-global-content">
					<div class="gdl-lam-global-bar" style="width:${globalPercent}%" aria-hidden="true"></div>
					<div class="gdl-lam-row-icon-frame">${hidden ? '<div class="gdl-lam-hidden-icon" aria-hidden="true">?</div>' : icon ? `<img class="gdl-lam-row-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">` : ''}</div>
					<div class="gdl-lam-global-details">
						<div class="gdl-lam-row-main"><div class="gdl-lam-row-title">${escapeHtml(title)}</div><div class="gdl-lam-row-desc">${escapeHtml(description)}</div></div>
						<div class="gdl-lam-row-right"><span class="gdl-lam-global-percent">${globalKnown ? `${globalPercent.toFixed(1)}%` : '—'}</span></div>
						${hidden ? `<div class="gdl-lam-hidden-reveal" aria-hidden="true">${escapeHtml(loc('Achievements_HiddenAchievementItem_Individual_Reveal_Desktop', 'Click to reveal spoiler'))}</div>` : ''}
					</div>
				</div>
			</div>`;
		}
		const locked = !item.earned;
		const isRare = !locked && (isRareAchievement(item) || highlightedNames.has(String(item.name)));
		const rareClasses = getSteamRareAchievementClasses(doc);
		const frameClass = `gdl-lam-row-icon-frame ${rareClasses.wrapper}${isRare ? ' is-rare' : ''}`;
		const icon = item.icon || item.icon_gray;
		const hasProgress = item.max_progress > 0;
		const progress = hasProgress ? (item.earned ? 100 : Math.max(0, Math.min(100, (item.progress / item.max_progress) * 100))) : 0;
		const date = item.earned && item.earned_time > 0
			? `<div class="gdl-lam-unlock-date">${escapeHtml(achievementText('Achievements_ListItem_UnlockDateTime', 'Unlocked on %1$s', formatLocalUnlockDate(item.earned_time)))}</div>` : '';
		const bar = hasProgress ? `<div class="gdl-lam-row-track" role="progressbar" aria-valuemin="0" aria-valuemax="${item.max_progress}" aria-valuenow="${item.earned ? item.max_progress : Math.max(0, item.progress)}"><div class="gdl-lam-row-fill" style="width:${progress}%"></div></div>` : '';
		const progressCount = !item.earned && hasProgress ? `<div class="gdl-lam-row-progress-count">${item.progress}/${item.max_progress}</div>` : '';
		const friend = comparisonStates?.get(item.name);
		const friendState = comparisonStates ? `<div class="gdl-lam-comparison-friend" title="${escapeHtml(comparisonName)}">${escapeHtml(comparisonName)} <span class="${friend?.earned ? 'is-earned' : ''}">${friend ? (friend.earned ? '✓' : '○') : '—'}</span></div>` : '';
		const right = `${friendState}${date}${progressCount}${bar}`;
		const glowHtml = isRare ? renderSteamRareGlowHtml(rareClasses) : '';
		const globalCopy = globalKnown ? `${globalPercent.toFixed(1)}% ${escapeHtml(gdlText('players_have_achievement', 'of players have this achievement'))}` : '';
		return `<div class="gdl-lam-row" data-search="${escapeHtml((item.display_name + ' ' + item.description).toLocaleLowerCase())}">
			<div class="${frameClass}">${glowHtml}${icon ? `<img class="gdl-lam-row-icon ${rareClasses.icon}${locked ? ' locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}" src="${escapeHtml(locked ? (item.icon_gray || item.icon) : item.icon)}" loading="lazy">` : `<div class="gdl-lam-row-icon ${rareClasses.icon} ${locked ? 'locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}" style="display:flex;align-items:center;justify-content:center;font-size:25px">★</div>`}</div>
			<div class="gdl-lam-row-main"><div class="gdl-lam-row-title">${escapeHtml(item.display_name || item.name)}</div><div class="gdl-lam-row-desc">${escapeHtml(item.description || (item.hidden && locked ? gdlText('hidden_achievement', 'Hidden achievement') : ''))}</div><div class="gdl-lam-row-global">${globalCopy}</div></div>
			<div class="gdl-lam-row-right">${right}</div>
		</div>`;
	};
	const render = () => {
		const query = (search.value || '').trim().toLocaleLowerCase();
		let rows = activeData.achievements.slice();
		if (tab === 'mine') rows.sort((a, b) => Number(b.earned) - Number(a.earned) || (a.earned ? Number(b.earned_time || 0) - Number(a.earned_time || 0) : Number(b.global_percent || 0) - Number(a.global_percent || 0)));
		else rows.sort((a, b) => {
			const rarity = (item: LocalAchievementItem): number => item.global_percent_known !== false && Number.isFinite(item.global_percent) ? item.global_percent : -1;
			return rarity(b) - rarity(a);
		});
		if (query) rows = rows.filter(item => `${item.display_name} ${item.description} ${item.name}`.toLocaleLowerCase().includes(query));
		list.innerHTML = rows.length ? rows.map(item => rowHtml(item, tab === 'global')).join('') : `<div class="gdl-lam-empty">${escapeHtml(gdlText('no_achievements', 'No achievements found.'))}</div>`;
	};
	const eventCleanups: Array<() => void> = [];
	const listen = (element: EventTarget | null, type: string, listener: (event: Event) => void): void => {
		if (!element) return;
		element.addEventListener(type, listener);
		eventCleanups.push(() => element.removeEventListener(type, listener));
	};
	const close = () => {
		resizeObserver?.disconnect();
		view?.removeEventListener('resize', onWindowResize);
		doc.removeEventListener('pointermove', onDividerMove, true);
		doc.removeEventListener('transitionrun', onGeometryTransition, true);
		doc.removeEventListener('transitionend', onGeometryTransition, true);
		if (syncFrame && view) view.cancelAnimationFrame(syncFrame);
		for (const cleanup of eventCleanups.splice(0)) cleanup();
		comparisonGeneration++;
		if (activeModalClosers.get(doc) === close) activeModalClosers.delete(doc);
		if (modalOpenGenerations.get(doc) === opening) {
			modalOpenGenerations.delete(doc);
			modalDocuments.delete(doc);
		}
		overlay.remove();
	};
	activeModalClosers.set(doc, close);
	listen(overlay.querySelector('.gdl-lam-close'), 'click', close);
	listen(overlay, 'click', event => { if (event.target === overlay) close(); });
	listen(overlay, 'keydown', event => { if ((event as KeyboardEvent).key === 'Escape') close(); });
	overlay.querySelectorAll('.gdl-lam-tab').forEach(button => listen(button, 'click', () => {
		overlay.querySelectorAll('.gdl-lam-tab').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
		button.classList.add('active');
		button.setAttribute('aria-selected', 'true');
		tab = button.getAttribute('data-tab') === 'global' ? 'global' : 'mine';
		toolbar.classList.toggle('gdl-lam-global-toolbar', tab === 'global');
		globalUser.hidden = tab !== 'global';
		globalLabel.hidden = tab !== 'global';
		comparisonControl.hidden = tab === 'global';
		comparisonStatus.hidden = tab === 'global' || !comparison.value || Boolean(comparisonStates);
		(overlay.querySelector('.gdl-lam-scroll') as HTMLElement).scrollTop = 0;
		render();
	}));
	listen(comparison, 'change', () => {
		const selected = comparison.value;
		const request = ++comparisonGeneration;
		comparisonStates = null;
		comparisonName = comparison.selectedOptions[0]?.textContent || '';
		comparison.options[0].textContent = selected
			? loc('Achievements_ComparisonLabel_Clear', 'Clear comparison')
			: loc('Achievements_ComparisonLabel_NotComparing', 'Compare with...');
		comparisonStatus.hidden = !selected;
		comparisonStatus.textContent = selected ? gdlText('native_steam_achievements_loading', 'Loading Steam achievements...') : '';
		render();
		if (!selected) return;
		void getFriendAchievementState(doc, activeData.appid, selected).then(states => {
			if (!overlay.isConnected || comparisonGeneration !== request) return;
			comparisonStates = states;
			comparisonStatus.hidden = true;
			render();
		}).catch(() => {
			if (!overlay.isConnected || comparisonGeneration !== request) return;
			comparisonStatus.textContent = gdlText('achievement_comparison_unavailable', 'This friend’s achievements are private or unavailable.');
		});
	});
	void getAchievementComparisonFriends(doc, activeData.appid).then(friends => {
		if (!overlay.isConnected) return;
		for (const friend of friends) {
			const option = doc.createElement('option');
			option.value = friend.steamid;
			option.textContent = friend.name;
			comparison.appendChild(option);
		}
	}).catch(() => {});
	listen(search, 'input', render);
	const revealGlobalAchievement = (event: Event): void => {
		if (tab !== 'global') return;
		const row = (event.target as Element | null)?.closest<HTMLElement>('.is-hidden-global');
		if (!row || !list.contains(row)) return;
		if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return;
		event.preventDefault();
		const name = row.dataset.achievement;
		if (!name) return;
		const focused = doc.activeElement === row;
		revealedGlobalAchievements.add(name);
		render();
		if (focused) {
			const revealed = Array.from(list.querySelectorAll<HTMLElement>('.gdl-lam-row')).find(item => item.dataset.achievement === name);
			if (revealed) { revealed.tabIndex = -1; revealed.focus({ preventScroll: true }); }
		}
	};
	listen(list, 'click', revealGlobalAchievement);
	listen(list, 'keydown', revealGlobalAchievement);
	overlay.setAttribute('tabindex', '-1');
	overlay.focus();
	render();
}
