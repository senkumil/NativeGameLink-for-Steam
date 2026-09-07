import { backendLog } from '../../api/backend';
import { findMappingForTitle } from '../../core/mappings';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { gdlText, steamLanguageSync } from '../../steam/localization';
import { achievementRuntimeHost } from './context';

function linkedSteamAchievementsUrl(steamAppId: string): string {
	const lang = steamLanguageSync() || 'english';
	return `https://steamcommunity.com/stats/${encodeURIComponent(steamAppId)}/achievements?l=${encodeURIComponent(lang)}`;
}

function openLinkedSteamAchievements(doc: Document, steamAppId: string): void {
	const url = linkedSteamAchievementsUrl(steamAppId);
	backendLog(`Opening linked achievements for AppID ${steamAppId}: ${url}`);
	openSteamNavigationUrl(doc, url);
}

/** Make a sidebar achievements region act like Steam's native linked achievement surface. */
export function makeLinkedAchievementsClickable(doc: Document, node: HTMLElement, steamAppId: string): void {
	node.style.cursor = 'pointer';
	node.title = gdlText('view_linked_achievements', 'View achievements for this linked game');
	node.setAttribute('tabindex', '0');
	node.setAttribute('role', 'button');
	const open = () => openLinkedSteamAchievements(doc, steamAppId);
	node.addEventListener('click', event => {
		const target = event.target as HTMLElement | null;
		if (target?.closest('a,button,input,textarea,select')) return;
		open();
	});
	node.addEventListener('keydown', event => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			open();
		}
	});
}

export function focusAchievementsSection(doc: Document): void {
	const section = doc.getElementById('gdl-achievements-section') as HTMLElement | null;
	if (!section) return;
	try { section.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
	catch { section.scrollIntoView(); }
	section.classList.remove('gdl-achievement-focus');
	void section.offsetWidth;
	section.classList.add('gdl-achievement-focus');
	window.setTimeout(() => section.classList.remove('gdl-achievement-focus'), 1450);
}

export function detectLinkedSteamAppId(doc: Document): string {
	const current = achievementRuntimeHost().getCurrentInjectedAppId();
	if (current && /^\d+$/.test(current)) return current;
	const bpRoot = doc.getElementById('gdl-bp-detail-root') as HTMLElement | null;
	if (bpRoot?.dataset?.gdlSteamAppId && /^\d+$/.test(bpRoot.dataset.gdlSteamAppId)) {
		return bpRoot.dataset.gdlSteamAppId;
	}
	const links = Array.from(doc.querySelectorAll('#gdl-link-bar a[href]')) as HTMLAnchorElement[];
	for (const link of links) {
		const match = String(link.href || link.getAttribute('href') || '').match(/\/app\/(\d+)/);
		if (match) return match[1];
	}
	const noticeInfo = achievementRuntimeHost().findNonSteamNotice(doc);
	if (noticeInfo?.title) {
		const shortcutAppId = achievementRuntimeHost().findActiveShortcutAppId(doc, noticeInfo.title);
		const mapped = findMappingForTitle(noticeInfo.title, shortcutAppId);
		if (mapped && /^\d+$/.test(mapped)) return mapped;
	}
	return '';
}
