import { findClassModule } from '@steambrew/client';
import { findMappingForTitle } from '../../core/mappings';
import { isShortcutDismissed } from '../shortcuts/dismissed';
import { routedSteamAppId } from './native-route';

const STYLE_ID = 'gdl-early-linked-notice-style';
const ROUTE_ATTRIBUTE = 'data-gdl-linked-route';
const FALLBACK = {
	Container: '_2jPMy2QZr8bWi6yrk5ZzHA',
	Shortcut: '_2K2bYzcKrhqLqDp0Jy6Ksz',
	Body: '_1TGl52GwsFQg3CXUYvThP-',
};

function classSelector(value: unknown): string {
	const tokens = String(value || '').split(/\s+/).filter(Boolean);
	return tokens.length > 0 && tokens.every(token => /^[-_a-zA-Z0-9]+$/.test(token))
		? tokens.map(token => `.${token}`).join('') : '';
}

/** Install inactive CSS before Steam inserts either shortcut explanation. */
export function installEarlyShortcutNoticeStyle(doc: Document): void {
	if (!doc.documentElement || doc.getElementById(STYLE_ID)) return;
	const scope = `html[${ROUTE_ATTRIBUTE}="1"]`;
	const selectors = new Set([
		`${scope} ${classSelector(FALLBACK.Container)} > ${classSelector(FALLBACK.Shortcut)}`,
		`${scope} ${classSelector(FALLBACK.Body)}`,
	]);
	try {
		const native = findClassModule(module => Boolean(module.Shortcut && module.Container
			&& module.GameDescription && module.FeaturesList && module.AssociationList));
		const container = classSelector(native && native.Container), shortcut = classSelector(native && native.Shortcut);
		if (container && shortcut) selectors.add(`${scope} ${container} > ${shortcut}`);
	} catch {}
	try {
		const native = findClassModule(module => Boolean(module.Body && module.OfflineButton
			&& module.InnerContainer && !module.Container && !module.OfflineSectionBody));
		const body = classSelector(native && native.Body);
		if (body) selectors.add(`${scope} ${body}`);
	} catch {}
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	// Steam uses separate explanation leaves in Game Info and the main nonsteam
	// section. Keep both DOM/text nodes available to layout discovery and never
	// hide a hero, logo, playbar, section parent or an unverified destination.
	style.textContent = `${Array.from(selectors).join(',')}{display:none!important}`;
	(doc.head || doc.documentElement).appendChild(style);
}

/** Synchronously suppress the explanation only for an already verified link. */
export function syncEarlyLinkedNotice(doc: Document): boolean {
	if (!doc.documentElement) return false;
	installEarlyShortcutNoticeStyle(doc);
	const appid = routedSteamAppId(doc);
	const linked = Boolean(appid && appid >= 2147483648 && !isShortcutDismissed(appid)
		&& findMappingForTitle('', appid));
	if (!linked) {
		if (doc.documentElement.hasAttribute(ROUTE_ATTRIBUTE)) doc.documentElement.removeAttribute(ROUTE_ATTRIBUTE);
		return false;
	}
	if (doc.documentElement.getAttribute(ROUTE_ATTRIBUTE) !== '1') doc.documentElement.setAttribute(ROUTE_ATTRIBUTE, '1');
	return true;
}

export function disposeEarlyLinkedNotice(doc: Document): void {
	if (doc.documentElement?.hasAttribute(ROUTE_ATTRIBUTE)) doc.documentElement.removeAttribute(ROUTE_ATTRIBUTE);
	doc.getElementById(STYLE_ID)?.remove();
}
