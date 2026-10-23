import { escapeHtml } from '../../core/text';
import { gdlText, loc } from '../../steam/localization';

const helpCleanups = new WeakMap<Document, Map<HTMLElement, () => void>>();

export function disposeTradingCardHelp(doc: Document, section?: HTMLElement): void {
	for (const [button, cleanup] of Array.from(helpCleanups.get(doc) || [])) {
		if (!section || section.contains(button)) cleanup();
	}
}

export function setupTradingCardsHelpTooltip(doc: Document, button: HTMLElement): void {
	let popup: HTMLElement | null = null;
	let showTimer = 0;

	const show = (): void => {
		if (popup || !button.isConnected) return;
		popup = doc.createElement('div');
		popup.className = 'gdl-trading-cards-help-popup';
		popup.innerHTML = `
			<div style="margin-bottom:10px;">${escapeHtml(loc('AppDetails_TradingCards_Tooltip1', gdlText('trading_cards_help_p1', "Find cards while playing. You can trade them with friends (or on the Steam Community Market) for cards you haven't been able to find.")))}</div>
			<div>${escapeHtml(loc('AppDetails_TradingCards_Tooltip2', gdlText('trading_cards_help_p2', 'Complete the full set and turn it into a badge. Badges increase your Steam level and unlock benefits for your account and profile.')))}</div>
		`;
		doc.body.appendChild(popup);

		const rect = button.getBoundingClientRect();
		popup.style.position = 'fixed';
		popup.style.width = '310px';
		const scale = popup.getBoundingClientRect().width / 310 || 1;
		const popupWidth = Math.max(1, Math.min(310, (doc.defaultView?.innerWidth || doc.documentElement.clientWidth || 400) / scale - 24));

		const viewportWidth = (doc.defaultView?.innerWidth || doc.documentElement.clientWidth || 400) / scale;
		let left = rect.right / scale + 6;
		if (left + popupWidth > viewportWidth - 12) left = rect.left / scale - popupWidth - 6;
		left = Math.max(12, Math.min(left, viewportWidth - popupWidth - 12));
		let top = rect.top / scale - 12;
		popup.style.width = `${popupWidth}px`;
		const viewportHeight = (doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 720) / scale;
		top = Math.max(12, Math.min(top, viewportHeight - popup.offsetHeight - 12));

		popup.style.position = 'fixed';
		popup.style.left = `${Math.round(left)}px`;
		popup.style.top = `${Math.round(top)}px`;
		popup.style.zIndex = '2147483600';
	};

	const hide = (): void => {
		if (showTimer) doc.defaultView?.clearTimeout(showTimer);
		showTimer = 0;
		if (popup) {
			popup.remove();
			popup = null;
		}
	};
	const scheduleShow = (): void => {
		if (popup || showTimer) return;
		showTimer = doc.defaultView?.setTimeout(() => { showTimer = 0; show(); }, 240) || 0;
	};

	button.addEventListener('mouseenter', scheduleShow);
	button.addEventListener('mouseleave', hide);
	button.addEventListener('focus', scheduleShow);
	button.addEventListener('blur', hide);
	doc.defaultView?.addEventListener('resize', hide, { passive: true });
	doc.defaultView?.addEventListener('scroll', hide, { passive: true, capture: true });
	let cleanups = helpCleanups.get(doc);
	if (!cleanups) { cleanups = new Map(); helpCleanups.set(doc, cleanups); }
	const ownedCleanups = cleanups;
	ownedCleanups.set(button, () => {
		hide();
		button.removeEventListener('mouseenter', scheduleShow);
		button.removeEventListener('mouseleave', hide);
		button.removeEventListener('focus', scheduleShow);
		button.removeEventListener('blur', hide);
		doc.defaultView?.removeEventListener('resize', hide);
		doc.defaultView?.removeEventListener('scroll', hide, true);
		ownedCleanups.delete(button);
	});
}

