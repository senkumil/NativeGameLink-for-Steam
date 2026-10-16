import type { ComponentType } from 'react';
import { steamWebpackRuntime } from '../../modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../runtime-cache';

type Parts = Record<'Media' | 'Notes' | 'Review' | 'Cards' | 'DLC' | 'Workshop', ComponentType<any> | null>;
const states = new DocumentRuntimeCache(() => ({ parts: null as Parts | null, count: -1 }));

/** Resolve the owner's native sections by contracts, never by a stale module ID. */
export function resolveNativeStuffComponents(doc: Document): Parts {
	const empty: Parts = { Media: null, Notes: null, Review: null, Cards: null, DLC: null, Workshop: null };
	const view = doc.defaultView;
	if (!view || view.closed || view.document !== doc || !doc.body?.isConnected) return empty;
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return empty;
	const state = states.get(doc);
	const count = steamWebpackRuntime.getModuleFactoryCount(doc);
	if (state.parts && state.count === count) return state.parts;
	const contracts: Array<[keyof Parts, string, string[]]> = [
		['Media', 'E', ['AppDetails_SectionTitle_Screenshots', 'AppDetails_HowToScreenshotGamepad', 'rightColumnSection']],
		['Notes', 'E', ['AppDetails_SectionTitle_GameNotes', 'AppDetails_NewNote', 'ShowGameNotesPopup']],
		['Review', 'h', ['AppDetails_Review_YourReview', 'GetStoredReview', 'FetchRoamingStorageState']],
		['Cards', 'on', ['AppDetails_SectionTitle_TradingCards', 'nOwned', 'strMarketHash', 'data-carousel']],
		['DLC', 'Kf', ['AppDetails_SectionTitle_DLC', 'showRemainder', 'vecDLC', 'AppDetails_ManageDLC']],
		['Workshop', 'y', ['AppDetails_SectionTitle_Workshop', 'BIsWorkshopVisible', 'AppDetails_ViewSubscribedItems', 'SubscribedItemsMessage']],
	];
	const parts = { ...empty };
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		const source = String(factory);
		for (const [key, exported, tokens] of contracts) {
			if (parts[key] || req.m?.[id] !== factory || !tokens.every(token => source.includes(token))) continue;
			try {
				const component = req(Number(id))?.[exported];
				if (typeof component === 'function' || component?.$$typeof) parts[key] = component;
			} catch { /* An unavailable native section keeps its owned fallback. */ }
		}
	}
	state.parts = parts;
	state.count = count;
	return parts;
}
