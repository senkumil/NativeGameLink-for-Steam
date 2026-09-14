import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText } from '../../steam/localization';
import { getCachedLocalAchievementsForGame } from './cache';
import { formatLocalUnlockDate, localAchievementPercent } from './format';
import { getLocalAchievementGameInfo } from './game-info';
import { compareAchievementsForGlobalRarity, compareEarnedAchievementsForDisplay, compareLockedAchievementsForDisplay, highlightedAchievementNames, isRareAchievement } from './rarity';
import { getSteamRareAchievementClasses, renderSteamRareGlowHtml } from './steam-rare';
import { ensureAchievementModalStyles } from './styles/modal';

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
	ensureAchievementModalStyles(doc);
	doc.getElementById('gdl-local-achievement-modal')?.remove();
	const cached = getCachedLocalAchievementsForGame(data.appid, data.state_appid);
	const activeData = (cached && cached.found && cached.total > 0) ? cached : data;
	const info = await getLocalAchievementGameInfo(activeData.appid);
	if (!doc.body) return;
	ensureAchievementModalStyles(doc);
	doc.getElementById('gdl-local-achievement-modal')?.remove();
	const pct = localAchievementPercent(activeData);
	const overlay = doc.createElement('div');
	overlay.id = 'gdl-local-achievement-modal';
	overlay.style.position = 'fixed';
	overlay.innerHTML = `
		<div class="gdl-lam-window" role="dialog" aria-modal="true">
			<button class="gdl-lam-close" aria-label="${escapeHtml(gdlText('close', 'Close'))}">×</button>
			<div class="gdl-lam-head">
				<div class="gdl-lam-title">
					${info.headerImage ? `<img class="gdl-lam-game-icon" src="${escapeHtml(info.headerImage)}">` : ''}
					<span>${escapeHtml(info.name)}</span>
				</div>
				<div class="gdl-lam-progressbox${activeData.unlocked >= activeData.total && activeData.total > 0 ? ' is-complete' : ''}">
					${activeData.unlocked >= activeData.total && activeData.total > 0 ? `<div class="gdl-lam-completion-badge">${COMPLETION_RIBBON_IMAGE}</div>` : ''}
					<div class="gdl-lam-progress-copy">
						<div class="gdl-lam-progressline">
							<span>${escapeHtml(gdlText('achievements_unlocked', '{unlocked} of {total} achievements unlocked', { unlocked: activeData.unlocked, total: activeData.total }))}</span>
							<span>(${pct}%)</span>
						</div>
						<div class="gdl-lam-track"><div class="gdl-lam-fill" style="width:${pct}%"></div></div>
					</div>
				</div>
				<div class="gdl-lam-tabs">
					<button class="gdl-lam-tab active" data-tab="mine">${escapeHtml(gdlText('achievements_mine', 'MY ACHIEVEMENTS'))}</button>
					<button class="gdl-lam-tab" data-tab="global">${escapeHtml(gdlText('achievements_global', 'GLOBAL ACHIEVEMENTS'))}</button>
				</div>
			</div>
			<div class="gdl-lam-toolbar"><input class="gdl-lam-search" placeholder="${escapeHtml(gdlText('search', 'Search'))}"></div>
			<div class="gdl-lam-list"></div>
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
	let tab: 'mine' | 'global' = 'mine';
	const highlightedNames = highlightedAchievementNames(activeData.achievements);
	const rowHtml = (item: LocalAchievementItem, globalMode: boolean): string => {
		const locked = !item.earned;
		const isRare = !locked && (isRareAchievement(item) || highlightedNames.has(String(item.name)));
		const rareClasses = getSteamRareAchievementClasses();
		const frameClass = `gdl-lam-row-icon-frame ${rareClasses.wrapper}${isRare ? ' is-rare' : ''}`;
		const icon = item.icon || item.icon_gray;
		const progress = !item.earned && item.max_progress > 0 ? Math.max(0, Math.min(100, Math.round((item.progress / item.max_progress) * 100))) : 0;
		const right = item.earned
			? `<div>${escapeHtml(gdlText('unlocked_on', 'Unlocked on {date}', { date: formatLocalUnlockDate(item.earned_time) }))}</div>`
			: (progress > 0
				? `<div style="margin-bottom:4px;font-size:12px;color:#8f98a0;">${item.progress}/${item.max_progress}</div><div style="width:140px;height:5px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden;"><div style="width:${progress}%;height:100%;background:#1a9fff;"></div></div>`
				: '');
		const glowHtml = isRare ? renderSteamRareGlowHtml(rareClasses) : '';
		return `<div class="gdl-lam-row" data-search="${escapeHtml((item.display_name + ' ' + item.description).toLocaleLowerCase())}">
			<div class="${frameClass}">${glowHtml}${icon ? `<img class="gdl-lam-row-icon ${rareClasses.icon}${locked ? ' locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}" src="${escapeHtml(locked ? (item.icon_gray || item.icon) : item.icon)}" loading="lazy">` : `<div class="gdl-lam-row-icon ${rareClasses.icon} ${locked ? 'locked' : ''}${isRare ? ` is-rare-glow ${rareClasses.iconGlow}` : ''}" style="display:flex;align-items:center;justify-content:center;font-size:25px">★</div>`}</div>
			<div class="gdl-lam-row-main"><div class="gdl-lam-row-title">${escapeHtml(item.display_name || item.name)}</div><div class="gdl-lam-row-desc">${escapeHtml(item.description || (item.hidden && locked ? gdlText('hidden_achievement', 'Hidden achievement') : ''))}</div><div class="gdl-lam-row-global">${(item.global_percent || 0).toFixed(1)}% ${escapeHtml(gdlText('players_have_achievement', 'of players have this achievement'))}</div></div>
			<div class="gdl-lam-row-right">${globalMode ? `<span style="font-size:14px;font-weight:700;color:${item.earned ? '#ffffff' : '#8f98a0'};">${(item.global_percent || 0).toFixed(1)} %</span>` : right}</div>
		</div>`;
	};
	const render = () => {
		const query = (search.value || '').trim().toLocaleLowerCase();
		let rows = activeData.achievements.slice();
		if (tab === 'mine') rows.sort((a, b) => Number(b.earned) - Number(a.earned) || (a.earned ? compareEarnedAchievementsForDisplay(a, b) : compareLockedAchievementsForDisplay(a, b)));
		else rows.sort(compareAchievementsForGlobalRarity);
		if (query) rows = rows.filter(item => `${item.display_name} ${item.description} ${item.name}`.toLocaleLowerCase().includes(query));
		list.innerHTML = rows.length ? rows.map(item => rowHtml(item, tab === 'global')).join('') : `<div class="gdl-lam-empty">${escapeHtml(gdlText('no_achievements', 'No achievements found.'))}</div>`;
	};
	const close = () => {
		resizeObserver?.disconnect();
		view?.removeEventListener('resize', onWindowResize);
		doc.removeEventListener('pointermove', onDividerMove, true);
		doc.removeEventListener('transitionrun', onGeometryTransition, true);
		doc.removeEventListener('transitionend', onGeometryTransition, true);
		if (syncFrame && view) view.cancelAnimationFrame(syncFrame);
		overlay.remove();
	};
	overlay.querySelector('.gdl-lam-close')?.addEventListener('click', close);
	overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
	overlay.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Escape') close(); });
	overlay.querySelectorAll('.gdl-lam-tab').forEach(button => button.addEventListener('click', () => {
		overlay.querySelectorAll('.gdl-lam-tab').forEach(item => item.classList.remove('active'));
		button.classList.add('active');
		tab = button.getAttribute('data-tab') === 'global' ? 'global' : 'mine';
		render();
	}));
	search.addEventListener('input', render);
	overlay.setAttribute('tabindex', '-1');
	overlay.focus();
	render();
}
