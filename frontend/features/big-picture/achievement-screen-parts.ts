import type { ComponentType } from 'react';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { readPureClassFactory } from '../../steam/gamepad/components/pure-class-factory';

type Classes = Readonly<Record<string, string>>;
export interface NativeAchievementScreenParts {
	PersonalRow: ComponentType<any> | null;
	ComparisonRow: ComponentType<any> | null;
	HiddenRow: ComponentType<any> | null;
	Image: ComponentType<any> | null;
	Search: ComponentType<any> | null;
	row: Classes;
	header: Classes;
	tabs: Classes;
	page: Classes;
}
const states = new WeakMap<Document, { identity: object | null; count: number; parts: NativeAchievementScreenParts }>();
function component(value: any, tokens: string[]): value is ComponentType<any> {
	return Boolean(value && (typeof value === 'function' || value.$$typeof)
		&& tokens.every(token => String(value.render || value.type || value).includes(token)));
}

/** Resolve only pure styles and explicit-data presentation exports. Steam's
 * AppID-backed header/screen also fetch account state and must not be mounted
 * for a linked shortcut. Factory signatures survive numeric module-ID changes. */
export function resolveBigPictureAchievementScreenParts(doc: Document): NativeAchievementScreenParts {
	const empty: NativeAchievementScreenParts = { PersonalRow: null, ComparisonRow: null, HiddenRow: null,
		Image: null, Search: null, row: {}, header: {}, tabs: {}, page: {} };
	if (!doc.defaultView || doc.defaultView.document !== doc || doc.defaultView.closed) return empty;
	steamWebpackRuntime.captureRuntime(doc);
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return empty;
	const identity = steamWebpackRuntime.getRuntimeIdentity(doc);
	const factories = steamWebpackRuntime.getModuleFactories?.(doc) || [];
	const cached = states.get(doc);
	if (cached?.identity === identity && cached.count === factories.length) return cached.parts;
	const read = (id: number): any => { try { return req(id); } catch { return null; } };
	const pure = (legacyId: number, tokens: string[], exclude?: string): Classes => {
		for (const { factory } of factories) {
			const source = String(factory);
			if (!tokens.every(token => source.includes(token)) || (exclude && source.includes(exclude))) continue;
			const value = readPureClassFactory(factory);
			if (value && tokens.every(token => typeof value[token] === 'string')) return value;
		}
		if (!req.m?.[legacyId] || !factories.length) {
			const value = read(legacyId);
			if (value && tokens.every(token => typeof value[token] === 'string')) return value;
		}
		return {};
	};
	const presentation = (legacyId: number, tokens: string[]): any => {
		for (const { id, factory } of factories) {
			if (!tokens.every(token => String(factory).includes(token)) || req.m?.[id] !== factory) continue;
			return read(Number(id));
		}
		return !req.m?.[legacyId] || !factories.length ? read(legacyId) : null;
	};
	const parts = { ...empty };
	parts.row = pure(18980, ['AchievementListItemBase', 'GlobalAchievementListItem', 'UnlockContainer', 'ProgressFill'], 'HeaderContainer');
	parts.header = pure(83097, ['StatsBlock', 'BigStat', 'ProgressLabel', 'AchievementSearchHeader', 'Portrait']);
	parts.tabs = pure(62645, ['Tab', 'Selected', 'TabRow', 'TabTitle']);
	parts.page = pure(19579, ['HeaderContainer', 'AchievementTabs', 'MyAchievementsHeader', 'CompareButtonContainer']);
	const rows = presentation(36000, ['percentGlobalUnlocked', 'primaryAchiever', 'unlockDate', 'imgUrl', 'fm:']);
	if (component(rows?.fm, ['unlockDate', 'percentGlobalUnlocked', 'imgUrl'])) parts.PersonalRow = rows.fm;
	if (component(rows?.ui, ['primaryAchiever', 'secondaryAchiever', 'percentGlobalUnlocked'])) parts.ComparisonRow = rows.ui;
	if (component(rows?.Eu, ['count', 'HiddenAchievementContent'])) parts.HiddenRow = rows.Eu;
	const image = presentation(3270, ['imgURL', 'hidden', 'glow'])?._;
	if (component(image, ['imgURL', 'hidden', 'glow'])) parts.Image = image;
	const search = presentation(24124, ['strFilter', 'onChangeFilter', 'leftContent', 'zp:'])?.zp;
	if (component(search, ['strFilter', 'onChangeFilter', 'leftContent'])) parts.Search = search;
	states.set(doc, { identity, count: factories.length, parts });
	return parts;
}
