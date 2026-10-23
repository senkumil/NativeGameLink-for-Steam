import { gdlText } from '../../steam/localization';

/** The summary always describes the committed link, even while another AppID
 * is being reviewed in the editor below it. */
export function bindLinkedGameSummary(section: HTMLElement): (
	steamAppId: string, title: string, candidate?: { name: string; image?: string } | null,
) => void {
	const details = section.querySelector<HTMLDetailsElement>('.gdl-link-section')!;
	const name = section.querySelector<HTMLElement>('.gdl-linked-game-name')!;
	const id = section.querySelector<HTMLElement>('.gdl-linked-game-id')!;
	const state = section.querySelector<HTMLElement>('.gdl-linked-game-state')!;
	const image = section.querySelector<HTMLImageElement>('.gdl-linked-game-image')!;
	image.addEventListener('error', () => { image.hidden = true; });
	return (steamAppId, title, candidate) => {
		name.textContent = steamAppId ? candidate?.name || title || `Steam AppID ${steamAppId}`
			: gdlText('properties_link_hint', 'Choose the Steam game for this shortcut.');
		id.textContent = steamAppId ? ` · AppID ${steamAppId}` : '';
		state.textContent = steamAppId ? gdlText('game_linked_status', 'Linked') : gdlText('game_unlinked_status', 'Unlinked');
		details.dataset.linked = String(Boolean(steamAppId));
		const url = steamAppId ? candidate?.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg` : '';
		if (image.getAttribute('src') !== url) {
			if (url) image.src = url;
			else image.removeAttribute('src');
			image.hidden = !url;
		}
	};
}
