import React, { type ReactNode } from 'react';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';
import { getDocumentReact } from '../../steam/gamepad/document-ui-runtime';
import { NativeFocusable } from './document-primitives';

interface CarouselParts {
	Carousel?: React.ComponentType<any>;
	FocusRing?: React.ComponentType<any>;
	Spacing?: React.ComponentType<any>;
	useSpacing?: () => React.CSSProperties | undefined;
}
const caches = new DocumentRuntimeCache(() => ({ count: -1, parts: {} as CarouselParts }));
const isCarousel = (value: any): boolean => typeof value?.prototype?.ScrollToElement === 'function'
	&& typeof value?.prototype?.UpdateScrollArrows === 'function';

/** These are presentation providers from the owner's exact runtime. Module
 * numbers are deliberately absent: Steam rebuilds them independently. */
export function resolveBigPictureCarouselParts(doc: Document): CarouselParts {
	const view = doc.defaultView, identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	if (!view || view.closed || view.document !== doc || !identity) return {};
	const state = caches.get(doc), count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (state.count === count) return state.parts;
	state.count = count;
	const accept = (exports: any): void => {
		for (const value of [exports, ...Object.values(exports || {})]) {
			if (!state.parts.Carousel && isCarousel(value)) state.parts.Carousel = value;
		}
		// The pair is the native horizontal inset consumer and its reset wrapper.
		if (typeof exports?.S1 === 'function' && typeof exports?.VJ === 'function'
			&& String(exports.S1).includes('scrollPadding') && String(exports.VJ).includes('.Provider')) {
			state.parts.useSpacing = exports.S1; state.parts.Spacing = exports.VJ;
		}
		if (typeof exports?.q === 'function' && String(exports.q).includes('OnForceMeasureFocusRing')
			&& String(exports.q).includes('disableFocusRing')) state.parts.FocusRing = exports.q;
	};
	for (const module of steamWebpackRuntime.getAllModules(doc)) accept(module.exports);
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return state.parts;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		const source = String(factory);
		const needed = (!state.parts.Carousel && source.includes('ScrollToElement(') && source.includes('UpdateScrollArrows(')
			&& source.includes('fnRenderScrollingDiv'))
			|| (!state.parts.Spacing && source.includes('scrollPadding:') && source.includes('marginLeft=')
				&& source.includes('S1:') && source.includes('VJ:'))
			|| (!state.parts.FocusRing && source.includes('OnForceMeasureFocusRing:')
				&& source.includes('disableFocusRing:') && source.includes('MeasureElementAndUpdate'));
		if (!needed || req.m?.[id] !== factory) continue;
		try { accept(req(id)); } catch {}
		if (state.parts.Carousel && state.parts.Spacing && state.parts.FocusRing) break;
	}
	return state.parts;
}

/** Keep the focused tile visible while its detail panel changes width. Steam's
 * native ring already measures the expansion; the scroll viewport must follow
 * that same tile rather than the previous fixed-width icon's geometry. */
export function keepBigPictureCarouselFocusVisible(doc: Document, row: HTMLElement): () => void {
	const view = doc.defaultView;
	if (!view || row.ownerDocument !== doc) return () => {};
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	let target: HTMLElement | null = null, frame = 0, until = 0, disposed = false;
	let resize: ResizeObserver | null = null;
	const measure = (): void => {
		frame = 0;
		if (view.closed || view.document !== doc || steamWebpackRuntime.getRuntimeIdentity(doc) !== identity) { cleanup(); return; }
		if (disposed || !row.isConnected || !target?.isConnected || !row.contains(target)) return;
		const viewport = row.querySelector<HTMLElement>('[data-gdl-carousel-viewport="1"]');
		if (!viewport || !viewport.contains(target)) return;
		const bounds = viewport.getBoundingClientRect(), rect = target.getBoundingClientRect();
		if (bounds.width > 0 && rect.width > 0) {
			const left = rect.left - bounds.left, right = rect.right - bounds.right;
			const shift = rect.width > bounds.width ? left : left < 0 ? left : right > 0 ? right : 0;
			// CEF's UI scale can be a CSS zoom/transform: client rects are scaled,
			// while scrollLeft stays in the viewport's logical layout pixels.
			const scale = viewport.offsetWidth > 0 ? bounds.width / viewport.offsetWidth : 1;
			if (Math.abs(shift) > .5) viewport.scrollLeft += shift / (scale || 1);
		}
		if (view.performance.now() < until) frame = view.requestAnimationFrame(measure);
	};
	const schedule = (): void => {
		if (!disposed && !frame) frame = view.requestAnimationFrame(measure);
	};
	const onFocus = (event: Event): void => {
		const source = event.target as HTMLElement | null;
		const next = source?.closest<HTMLElement>('[data-gdl-focus-key], [class*="AchievementCarouselItem"], [class*="TradingCardCarouselItem"]');
		if (!next || !row.contains(next)) return;
		target = next; until = view.performance.now() + 550;
		resize?.disconnect();
		if (view.ResizeObserver) {
			resize = new view.ResizeObserver(schedule); resize.observe(next); resize.observe(row);
		}
		schedule();
	};
	row.addEventListener('focusin', onFocus, true);
	row.addEventListener('vgp_onfocus', onFocus, true);
	const cleanup = (): void => {
		disposed = true; target = null; resize?.disconnect();
		if (frame) view.cancelAnimationFrame(frame);
		row.removeEventListener('focusin', onFocus, true); row.removeEventListener('vgp_onfocus', onFocus, true);
	};
	return cleanup;
}

export function NativeBigPictureCarousel({ document: doc, name, children, className }: {
	document: Document; name: string; children: ReactNode; className?: string;
}): React.ReactElement | null {
	const owner = getDocumentReact(doc);
	if (!owner) return null;
	const parts = resolveBigPictureCarouselParts(doc);
	return owner.createElement(CarouselLayout, { document: doc, name, className, parts }, children);
}

function CarouselLayout({ document: doc, name, children, className, parts }: {
	document: Document; name: string; children?: ReactNode; className?: string; parts: CarouselParts;
}): React.ReactElement | null {
	const owner = getDocumentReact(doc);
	if (!owner) return null;
	const holder = owner.useRef<HTMLDivElement>(null);
	owner.useEffect(() => holder.current ? keepBigPictureCarouselFocusVisible(doc, holder.current) : undefined, [doc]);
	// A stable keyed child isolates the optional native hook from this component's
	// own hooks when a late Steam presentation chunk becomes available.
	const Content = parts.Spacing && parts.useSpacing ? SpacedCarousel : CarouselContent;
	return owner.createElement('div', { ref: holder, 'data-gdl-bp-carousel': name },
		owner.createElement(Content, { doc, name, className, parts }, children));
}

function SpacedCarousel(props: any): React.ReactElement {
	const style = props.parts.useSpacing();
	return <props.parts.Spacing><CarouselContent {...props} paddingStyle={style} /></props.parts.Spacing>;
}

function CarouselContent({ doc, name, children, className, parts, paddingStyle }: any): React.ReactElement {
	const scrolling = ({ htmlElementRef, ...props }: any): React.ReactElement => <div {...props}
		ref={htmlElementRef} data-gdl-carousel-viewport="1" style={paddingStyle} />;
	const content = parts.Carousel ? <parts.Carousel aria-label={name} className={className}
		leftMargin={32} edgeMask="none" fnUpdateArrows={() => {}} fnRenderScrollingDiv={scrolling}>
		{children}<div style={{ width: 16 }} data-carousel="ignore" />
	</parts.Carousel> : <div role="list" aria-label={name} data-gdl-carousel-viewport="1" className={className}
		style={{ display: 'flex', overflowX: 'auto', overflowY: 'hidden', minWidth: 0 }}>{children}</div>;
	return <NativeFocusable document={doc} focusable={false} flow-children="row">
		{parts.FocusRing ? <parts.FocusRing>{content}</parts.FocusRing> : content}
	</NativeFocusable>;
}
