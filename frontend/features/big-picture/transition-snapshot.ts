let snapshotSerial = 0;

/** Steam retains outgoing panels until its own CSS transition ends. Keep only
 * their last presentation: no React root, handlers, focus nodes or duplicate IDs. */
export function createBigPictureTransitionSnapshot(root: HTMLElement): HTMLElement {
	const snapshot = root.cloneNode(true) as HTMLElement, prefix = `gdl-bp-retiring-${++snapshotSerial}-`;
	const originals = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
	const copies = [snapshot, ...Array.from(snapshot.querySelectorAll<HTMLElement>('*'))];
	const ids = new Map<string, string>();
	for (const copy of copies) if (copy.id) { ids.set(copy.id, prefix + copy.id); copy.id = prefix + copy.id; }
	for (const copy of copies) {
		for (const attribute of Array.from(copy.attributes)) {
			if (/^on/i.test(attribute.name)) { copy.removeAttribute(attribute.name); continue; }
			if (/^data-gdl-/.test(attribute.name) || attribute.name === 'data-focus') {
				copy.removeAttribute(attribute.name); continue;
			}
			let value = attribute.value.replace(/url\((['"]?)#([^)'"\s]+)\1\)/g, (match, quote, id) => ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match);
			if (value.startsWith('#') && ids.has(value.slice(1))) value = '#' + ids.get(value.slice(1));
			if (/^(?:aria-(?:labelledby|describedby|controls)|for|list|headers|form)$/.test(attribute.name)) value = value.split(/\s+/).map(id => ids.get(id) || id).join(' ');
			if (value !== attribute.value) copy.setAttribute(attribute.name, value);
		}
		copy.classList.remove('gpfocus');
		if (copy.matches('button,input,textarea,select,a[href],[tabindex],[focusable],[data-focusable]')) copy.tabIndex = -1;
		if (copy.hasAttribute('focusable')) copy.setAttribute('focusable', 'false');
		if (copy.hasAttribute('data-focusable')) copy.setAttribute('data-focusable', 'false');
		if (copy.tagName === 'STYLE') copy.textContent = copy.textContent?.replace(/#([\w-]+)/g, (match, id) => ids.has(id) ? '#' + ids.get(id) : match) || '';
	}
	snapshot.dataset.gdlBpTransitionSnapshot = '1';
	snapshot.inert = true; snapshot.setAttribute('aria-hidden', 'true');
	snapshot.style.setProperty('pointer-events', 'none', 'important');
	// A clone must never start another browsing context, stream or player. Keep
	// a static poster/canvas image where possible and reserve its existing box.
	for (let index = 1; index < copies.length; index++) {
		const copy = copies[index], original = originals[index];
		if (copy.matches('script,link,source,track')) { copy.remove(); continue; }
		if (!copy.matches('iframe,object,embed,video,audio,canvas')) continue;
		let image = copy.tagName === 'VIDEO' ? (original as HTMLVideoElement).poster : '';
		if (copy.tagName === 'CANVAS') try { image = (original as HTMLCanvasElement).toDataURL(); } catch {}
		const still = root.ownerDocument.createElement(image ? 'img' : 'div');
		still.className = copy.className; still.style.cssText = copy.style.cssText;
		const rect = original.getBoundingClientRect();
		still.style.width = `${rect.width}px`; still.style.height = `${rect.height}px`;
		if (image) { (still as HTMLImageElement).src = image; (still as HTMLImageElement).alt = ''; }
		copy.replaceWith(still);
	}
	// Scroll offsets and live form values are properties, not cloneable attrs.
	const restorePresentation = () => {
		for (let index = 0; index < copies.length; index++) {
			copies[index].scrollTop = originals[index].scrollTop; copies[index].scrollLeft = originals[index].scrollLeft;
			if ('value' in originals[index]) (copies[index] as HTMLInputElement).value = (originals[index] as HTMLInputElement).value;
			if ('checked' in originals[index]) (copies[index] as HTMLInputElement).checked = (originals[index] as HTMLInputElement).checked;
		}
	};
	root.parentElement?.insertBefore(snapshot, root);
	restorePresentation();
	return snapshot;
}
