import type { ComponentType } from 'react';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../runtime-cache';

interface NativeInformationComponents {
	Link: ComponentType<any> | null;
	CollectionCard: ComponentType<any> | null;
	CollectionWrapper: ComponentType<any> | null;
	CollectionGrid: ComponentType<any> | null;
	grid: { childWidth: number; childHeight: number; gridColumnGap: number; gridRowGap: number } | null;
	collectionStore: { GetCollectionListForAppID(id: number): any[] } | null;
}
const states = new DocumentRuntimeCache(() => ({ parts: null as NativeInformationComponents | null }));

function sourceOf(value: any, seen = new Set<any>(), depth = 0): string {
	if (!value || seen.has(value) || depth > 4) return '';
	seen.add(value);
	return [typeof value === 'function' ? String(value) : '', ...['render', 'type', 'WrappedComponent']
		.map(key => sourceOf(value[key], seen, depth + 1))].join(' ');
}
function presentational(value: any, keys: string[]): value is ComponentType<any> {
	return Boolean(value && (typeof value === 'function' || value.$$typeof)
		&& keys.every(key => sourceOf(value).includes(key)));
}
function component(value: any): boolean { return typeof value === 'function' || Boolean(value?.$$typeof); }

/** Resolve only the current document's presentation exports. Qd is deliberately
 * excluded: it unconditionally invokes the account-backed badge-store hook.
 * Its individual aX link export renders the same native links from explicit URLs. */
export function resolveNativeInformationComponents(doc: Document): NativeInformationComponents {
	const empty: NativeInformationComponents = { Link: null, CollectionCard: null, CollectionWrapper: null,
		CollectionGrid: null, grid: null, collectionStore: null };
	const view = doc.defaultView;
	if (!view || view.closed || view.document !== doc || !doc.body?.isConnected) return empty;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return empty;
	const state = states.get(doc);
	if (state.parts) return state.parts;
	const read = (id: number): any => { try { return req(id); } catch { return null; } };
	const presentation = (legacyId: number, tokens: string[]): any => {
		// Some caches retain exports after dropping their factory entry. A
		// mismatched factory at an old ID must never be instantiated as a guess.
		if (!req.m?.[legacyId]) { const cached = read(legacyId); if (cached) return cached; }
		const factories = steamWebpackRuntime.getModuleFactories?.(doc) || [];
		for (const { id, factory } of factories) {
			const source = String(factory);
			if (!tokens.every(token => source.includes(token)) || req.m?.[id] !== factory) continue;
			const result = read(Number(id));
			if (result) return result;
		}
		return factories.length ? null : read(legacyId);
	};
	const parts = { ...empty };
	const link = presentation(52470, ['aX:', 'Qd:', 'isVisible', 'onActivate', 'GetParentalFeatureForFullUrl'])?.aX;
	if (presentational(link, ['url', 'label', 'link', 'isVisible', 'onActivate'])) parts.Link = link;
	const collections = presentation(14663, ['F9:', 'R0:', 'T4:', 'V$:', 'bStartFocused', 'bNoFooterFilter']), card = collections?.F9;
	const dimensions = collections?.V$;
	const validDimensions = dimensions && ['childWidth', 'childHeight', 'gridColumnGap', 'gridRowGap']
		.every(key => Number.isFinite(dimensions[key]) && dimensions[key] >= 0)
		&& dimensions.childWidth > 0 && dimensions.childHeight > 0;
	// Steam wraps this export in MobX/memo. The original render function can be
	// opaque; verify the whole collection module's companion exports in that case.
	const collectionModule = validDimensions && component(collections?.R0) && typeof collections?.T4 === 'function'
		&& component(collections?.lc) && typeof collections?.lp === 'function';
	if (presentational(card, ['collection', 'eCoverSize', 'bStartFocused', 'bNoFooterFilter'])
		|| (component(card) && collectionModule)) parts.CollectionCard = card;
	const wrapper = presentation(18489, ['Ei:', 'gridcell', 'display:"contents"'])?.Ei;
	if (presentational(wrapper, ['gridcell', 'contents'])) parts.CollectionWrapper = wrapper;
	const grid = presentation(59298, ['childElements', 'childWidth', 'scaleGridItems', 'paddingLeft', 'gridColumnGap', 'refItemsPerRow'])?.i;
	if (presentational(grid, ['childElements', 'childWidth', 'scaleGridItems', 'paddingLeft'])) parts.CollectionGrid = grid;
	if (validDimensions) parts.grid = dimensions;
	let store: NativeInformationComponents['collectionStore'] = !req.m?.[96000] ? read(96000)?.md : null;
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		const candidate = module.exports?.md;
		if (typeof candidate?.GetCollectionListForAppID === 'function') { store = candidate; break; }
	}
	if (typeof store?.GetCollectionListForAppID === 'function') parts.collectionStore = store;
	state.parts = parts;
	return parts;
}
