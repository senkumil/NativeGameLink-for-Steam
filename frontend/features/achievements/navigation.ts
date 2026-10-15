import { backendLog } from '../../api/backend';
import { getCommittedShortcutSteamAppId } from '../shortcuts/registry';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from '../library/native-route';
import { openSteamNavigationUrl } from '../../steam/navigation';
import { gdlText, steamLanguageSync } from '../../steam/localization';

export interface LinkedAchievementTarget { steamAppId: string; shortcutAppId: string }

type EarlySidebarOwner = { doc: Document; target: LinkedAchievementTarget; header: HTMLElement; isCurrent: () => boolean };
// The node is the weak key: retiring an early sidebar retains no detached DOM
// snapshot or extra document cache while the next metadata page is prepared.
const earlySidebarOwners = new WeakMap<HTMLElement, EarlySidebarOwner>();

export function registerEarlyAchievementSidebarOwner(
	doc: Document, section: HTMLElement, target: LinkedAchievementTarget, header: HTMLElement, isCurrent: () => boolean,
): void {
	earlySidebarOwners.set(section, { doc, target, header, isCurrent });
}

export function adoptEarlyAchievementSidebarOwner(section: HTMLElement): void {
	earlySidebarOwners.delete(section);
}

function ownsEarlySidebar(doc: Document, section: HTMLElement, target: LinkedAchievementTarget, owner: EarlySidebarOwner): boolean {
	return owner.doc === doc && owner.target.steamAppId === target.steamAppId
		&& owner.target.shortcutAppId === target.shortcutAppId && owner.isCurrent()
		&& section.isConnected && section.ownerDocument === doc
		&& section.dataset.gdlSteamAppId === target.steamAppId && section.dataset.gdlShortcutAppId === target.shortcutAppId
		&& owner.header.isConnected
		&& isCurrentAchievementTarget(doc, target);
}

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
	const section = doc.getElementById('gdl-achievements-section') as HTMLElement | null;
	const early = section && earlySidebarOwners.get(section);
	if (section && early) return ownsEarlySidebar(doc, section, target, early);
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
