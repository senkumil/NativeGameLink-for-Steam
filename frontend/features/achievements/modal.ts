import type { LocalAchievementData, LocalAchievementItem } from '../../domain/types';
import { escapeHtml } from '../../core/text';
import { gdlText } from '../../steam/localization';
import { formatLocalUnlockDate, localAchievementPercent } from './format';
import { getLocalAchievementGameInfo } from './game-info';
import { compareAchievementsForGlobalRarity, compareEarnedAchievementsForDisplay, compareLockedAchievementsForDisplay, highlightedAchievementNames, isRareAchievement } from './rarity';
import { getSteamRareAchievementClasses, renderSteamRareGlowHtml } from './steam-rare';

const COMPLETION_RIBBON_IMAGE = `<img class="gdl-lam-completion-art" alt="" aria-hidden="true" src="data:image/png;base64,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" />`;


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
	doc.getElementById('gdl-local-achievement-modal')?.remove();
	const info = await getLocalAchievementGameInfo(data.appid);
	if (!doc.body) return;
	const pct = localAchievementPercent(data);
	const overlay = doc.createElement('div');
	overlay.id = 'gdl-local-achievement-modal';
	overlay.innerHTML = `
		<div class="gdl-lam-window" role="dialog" aria-modal="true">
			<button class="gdl-lam-close" aria-label="${escapeHtml(gdlText('close', 'Close'))}">×</button>
			<div class="gdl-lam-head">
				<div class="gdl-lam-title">
					${info.headerImage ? `<img class="gdl-lam-game-icon" src="${escapeHtml(info.headerImage)}">` : ''}
					<span>${escapeHtml(info.name)}</span>
				</div>
				<div class="gdl-lam-progressbox${data.unlocked >= data.total && data.total > 0 ? ' is-complete' : ''}">
					${data.unlocked >= data.total && data.total > 0 ? `<div class="gdl-lam-completion-badge">${COMPLETION_RIBBON_IMAGE}</div>` : ''}
					<div class="gdl-lam-progress-copy">
						<div class="gdl-lam-progressline">
							<span>${escapeHtml(gdlText('achievements_unlocked', '{unlocked} of {total} achievements unlocked', { unlocked: data.unlocked, total: data.total }))}</span>
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
	if (info.heroImage) {
		const cssHeroImage = `url(${JSON.stringify(info.heroImage)})`;
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
	const highlightedNames = highlightedAchievementNames(data.achievements);
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
		let rows = data.achievements.slice();
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
