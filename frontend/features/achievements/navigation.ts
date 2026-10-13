import { backendLog } from '../../api/backend';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from '../library/native-route';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { gdlText, steamLanguageSync } from '../../steam/localization';

export interface LinkedAchievementTarget { steamAppId: string; shortcutAppId: string }

/** The displayed document owns the target; another window's runtime does not. */
export function linkedAchievementTarget(doc: Document): LinkedAchievementTarget | null {
	const routeId = routedSteamAppId(doc);
	if (routeId !== null && routeId < 2147483648) return null;
	const bpRoot = doc.getElementById('gdl-bp-detail-root') as HTMLElement | null;
	const shortcutId = routeId || Number(bpRoot?.dataset.gdlShortcutAppId || 0);
	if (!Number.isInteger(shortcutId) || shortcutId < 2147483648 || shortcutId > 4294967295 || isShortcutDismissed(shortcutId)) return null;
	const steamAppId = getCommittedShortcutSteamAppId(shortcutId);
	return steamAppId ? { steamAppId, shortcutAppId: String(shortcutId) } : null;
}

export function isCurrentAchievementTarget(doc: Document, target: LinkedAchievementTarget): boolean {
	const current = linkedAchievementTarget(doc);
	return current?.steamAppId === target.steamAppId && current.shortcutAppId === target.shortcutAppId;
}

export function ownsAchievementSidebar(doc: Document, target: LinkedAchievementTarget): boolean {
	const root = doc.getElementById('gdl-library-injected') as HTMLElement | null;
	return Boolean(root && root.dataset.gdlSteamAppId === target.steamAppId
		&& root.dataset.gdlShortcutAppId === target.shortcutAppId);
}

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
	const target = linkedAchievementTarget(doc);
	if (target?.steamAppId !== steamAppId || (!node.id.startsWith('gdl-') && !node.closest('[id^="gdl-"]'))) return;
	node.style.cursor = 'pointer';
	node.title = gdlText('view_linked_achievements', 'View achievements for this linked game');
	node.setAttribute('tabindex', '0');
	node.setAttribute('role', 'button');
	const open = () => { if (isCurrentAchievementTarget(doc, target)) openLinkedSteamAchievements(doc, steamAppId); };
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
	return linkedAchievementTarget(doc)?.steamAppId || '';
}
