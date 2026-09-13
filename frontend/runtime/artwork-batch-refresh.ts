interface ArtworkChangedDetail {
	steamAppId?: unknown;
	user_action?: boolean;
	user_choice?: boolean;
	batch_complete?: boolean;
	automatic?: boolean;
}

/** Repaint once after a complete artwork transaction. Steam may report several
 * native grid-file mutations for one batch, so the short debounce owns the
 * only plugin-side Library rebuild. */
export function installArtworkBatchRefresh(
	getCurrentAppId: () => string | null,
	resetLibrary: () => void,
): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const onArtworkChanged = (event: Event): void => {
		const detail = (event as CustomEvent<ArtworkChangedDetail>).detail;
		if (!detail || String(detail.steamAppId || '') !== getCurrentAppId()
			|| detail.automatic
			|| !(detail.user_action || detail.user_choice)) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			resetLibrary();
		}, 80);
	};
	window.addEventListener('gdl:artwork-changed', onArtworkChanged);
	return (): void => {
		window.removeEventListener('gdl:artwork-changed', onArtworkChanged);
		if (timer) clearTimeout(timer);
	};
}
