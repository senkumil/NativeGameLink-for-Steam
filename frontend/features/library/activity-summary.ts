import { EVENT_CLASSES } from '../../steam/css';

const installedClamps = new WeakMap<HTMLElement, () => void>();

/** Match Steam's medium-event excerpt line budget without modifying live text.
 * Font measurements are reused during divider drags. Reinstall after replacing
 * the feed's children. */
export function installNativeActivitySummaryClamps(feed: HTMLElement): () => void {
	installedClamps.get(feed)?.();
	const doc = feed.ownerDocument;
	const view = doc.defaultView;
	const className = EVENT_CLASSES(doc).PartnerEventMediumImage_Summary;
	if (!view || !className) return () => {};
	const summaries = Array.from(feed.getElementsByClassName(className)) as HTMLElement[];
	if (!summaries.length) return () => {};
	let disposed = false;
	let frame = 0;
	const originals = new Map<HTMLElement, Record<string, string>>();
	const properties = ['display', 'overflow', '-webkit-line-clamp', '-webkit-box-orient', 'text-overflow'];
	const lineHeights = new Map<string, number[]>();
	const number = (value: string): number => Number.parseFloat(value) || 0;
	const metricKey = (summary: HTMLElement, css: CSSStyleDeclaration): string => [css.font, css.lineHeight, css.padding,
		(summary as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1, view.devicePixelRatio].join('|');
	const measureLines = (css: CSSStyleDeclaration): number[] => {
		const probe = doc.createElement('div');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;display:block;overflow:visible;white-space:pre;width:100px;height:auto;min-height:0;max-height:none;';
		probe.style.font = css.font;
		probe.style.lineHeight = css.lineHeight;
		probe.style.padding = css.padding;
		probe.textContent = 'Y';
		feed.appendChild(probe);
		const heights: number[] = [];
		try {
			for (let line = 0; line < 10; line++) {
				heights.push(probe.clientHeight);
				if (line < 9) probe.append(doc.createElement('br'), doc.createTextNode('Y'));
			}
		} finally { probe.remove(); }
		return heights;
	};
	const update = (): void => {
		frame = 0;
		if (disposed || !feed.isConnected) return;
		const visible = summaries.filter(summary => summary.isConnected && feed.contains(summary) && summary.clientWidth > 0);
		// Only a new font/zoom combination needs Steam's Y/BR probe. Warm the
		// cache before the read phase so resizing never interleaves probes with
		// measurements of individual cards.
		for (const summary of visible) {
			const css = view.getComputedStyle(summary);
			const key = metricKey(summary, css);
			if (!lineHeights.has(key)) lineHeights.set(key, measureLines(css));
		}
		const changes: Array<{ summary: HTMLElement; lines: number }> = [];
		for (const summary of visible) {
			const parent = summary.parentElement;
			if (!parent) continue;
			const css = view.getComputedStyle(summary);
			const parentCss = view.getComputedStyle(parent);
			const padding = number(css.paddingTop) + number(css.paddingBottom);
			let budget = Number.parseFloat(parentCss.maxHeight);
			if (Number.isFinite(budget)) {
				if (parentCss.boxSizing === 'border-box') budget -= number(parentCss.paddingTop) + number(parentCss.paddingBottom)
					+ number(parentCss.borderTopWidth) + number(parentCss.borderBottomWidth);
				const zoom = (summary as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || 1;
				for (const sibling of Array.from(parent.children)) {
					if (sibling === summary) continue;
					const siblingCss = view.getComputedStyle(sibling);
					budget -= sibling.getBoundingClientRect().height / zoom + number(siblingCss.marginTop) + number(siblingCss.marginBottom);
				}
			} else budget = summary.scrollHeight;
			// scrollHeight retains the full text layout behind -webkit-line-clamp.
			// The flex item cannot shrink below its own padding; clientHeight in
			// Steam's original component rounds the resulting budget to CSS pixels.
			const height = Math.round(Math.max(padding, Math.min(summary.scrollHeight, budget)));
			const heights = lineHeights.get(metricKey(summary, css))!;
			const lines = heights.filter(value => value <= height).length;
			if (summary.style.webkitLineClamp !== (lines > 0 ? String(lines) : '')) changes.push({ summary, lines });
		}
		// All geometry reads finish before any live card changes. Most width
		// steps keep the same line count and therefore perform no style writes.
		for (const { summary, lines } of changes) {
			if (!originals.has(summary)) {
				originals.set(summary, Object.fromEntries(properties.map(property => [property, summary.style.getPropertyValue(property)])));
				summary.style.overflow = 'hidden';
				summary.style.display = '-webkit-box';
				summary.style.webkitBoxOrient = 'vertical';
				summary.style.textOverflow = 'ellipsis';
			}
			if (lines > 0) summary.style.webkitLineClamp = String(lines);
			else summary.style.removeProperty('-webkit-line-clamp');
		}
	};
	const schedule = (): void => {
		if (!disposed && !frame) frame = view.requestAnimationFrame(update);
	};
	const Observer = view.ResizeObserver;
	const widths = new WeakMap<Element, number>();
	const observer = typeof Observer === 'function' ? new Observer(entries => {
		let changed = false;
		for (const entry of entries) {
			const width = entry.contentRect.width;
			if (widths.get(entry.target) !== width) { widths.set(entry.target, width); changed = true; }
		}
		if (changed) schedule();
	}) : null;
	observer?.observe(feed);
	for (const summary of summaries) if (summary.parentElement) observer?.observe(summary.parentElement);
	const fontsChanged = (): void => {
		if (disposed) return;
		lineHeights.clear();
		schedule();
	};
	view.addEventListener('resize', schedule);
	doc.fonts?.addEventListener('loadingdone', fontsChanged);
	void doc.fonts?.ready.then(fontsChanged);
	const cleanup = (): void => {
		if (disposed) return;
		disposed = true;
		if (frame) view.cancelAnimationFrame(frame);
		frame = 0;
		observer?.disconnect();
		view.removeEventListener('resize', schedule);
		doc.fonts?.removeEventListener('loadingdone', fontsChanged);
		for (const [summary, values] of originals) {
			for (const property of properties) {
				if (values[property]) summary.style.setProperty(property, values[property]);
				else summary.style.removeProperty(property);
			}
		}
		originals.clear();
		if (installedClamps.get(feed) === cleanup) installedClamps.delete(feed);
	};
	installedClamps.set(feed, cleanup);
	schedule();
	return cleanup;
}
