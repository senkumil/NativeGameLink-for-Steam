import { loc, steamIntlLocale } from '../../steam/localization';
import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { DocumentRuntimeCache } from '../../steam/gamepad/runtime-cache';

type NativeFormatter = (minutes: number, prefix: string) => string;
const cache = new DocumentRuntimeCache(() => ({ count: -1, nextCheckAt: 0, formatter: null as NativeFormatter | null, localizer: null as any }));
const isFormatter = (value: any): value is NativeFormatter => typeof value === 'function'
	&& String(value).includes('#Played_') && String(value).includes('GetPreferredLocales')
	&& String(value).includes('maximumFractionDigits:1');

/** This pure localization helper is shared by Steam's actual Home carousel. */
function nativePresentation(doc: Document): ReturnType<typeof cache.get> | null {
	if (!steamWebpackRuntime.getRuntimeIdentity(doc)) return null;
	const state = cache.get(doc), now = Date.now();
	if (state.count >= 0 && now < state.nextCheckAt) return state;
	const count = steamWebpackRuntime.getModuleFactoryCount(doc);
	state.nextCheckAt = now + 1000;
	if (state.count === count && state.formatter && state.localizer) return state;
	state.count = count;
	const accept = (exports: any) => {
		for (const value of [exports, ...Object.values(exports || {})]) {
			if (isFormatter(value)) state.formatter = value;
			if (typeof (value as any)?.LocalizeString === 'function' && typeof (value as any)?.GetPreferredLocales === 'function'
				&& typeof (value as any)?.m_mapTokens?.get === 'function') state.localizer = value;
		}
	};
	for (const module of steamWebpackRuntime.getAllModules(doc)) {
		accept(module.exports);
	}
	if (state.formatter) return state;
	const req = steamWebpackRuntime.getRequire(doc);
	if (!req) return state;
	for (const { id, factory } of steamWebpackRuntime.getModuleFactories(doc)) {
		const source = String(factory);
		if (!source.includes('#Played_') || !source.includes('GetPreferredLocales')
			|| !source.includes('maximumFractionDigits:1') || !source.includes('minimumFractionDigits:0')
			|| req.m?.[id] !== factory) continue;
		try { accept(req(id)); } catch {}
		if (state.formatter) break;
	}
	return state;
}

/** Shared-context Steam windows may expose localization only as a loaded
 * module export. Read that owner's manager without installing another global. */
export function bigPictureHomeText(doc: Document, token: string, fallback: string): string {
	try {
		const manager = nativePresentation(doc)?.localizer;
		const text = manager?.m_mapTokens.get(token) ?? manager?.m_mapFallbackTokens?.get(token) ?? manager?.LocalizeString(`#${token}`, true);
		if (typeof text === 'string' && text.trim() && text !== token && text !== `#${token}`) return text;
	} catch {}
	return loc(token, fallback);
}

/** Match Home's recent/total selection, 120-minute threshold and decimal hours.
 * If Steam moves its pure helper, retain its localization tokens and formatting
 * contract without executing another app's store or changing its playtime. */
export function formatBigPictureHomePlaytime(doc: Document, forever: number, recent: number): string {
	const useRecent = Number.isFinite(recent) && recent > 0;
	const minutes = Math.max(0, Math.floor(useRecent ? recent : forever));
	const prefix = useRecent ? 'AppBox_RecentPlayTime_' : 'BasicGameCarousel_TotalPlayTime_';
	try {
		const native = nativePresentation(doc)?.formatter, formatted = native?.(minutes, `#${prefix}`);
		if (typeof formatted === 'string' && formatted.trim()) return formatted;
	} catch {}
	const hours = minutes >= 120;
	const locales = nativePresentation(doc)?.localizer?.GetPreferredLocales?.() || steamIntlLocale();
	const value = hours ? (Math.round(minutes / 60 * 10) / 10).toLocaleString(locales, { maximumFractionDigits: 1 }) : String(minutes);
	const fallback = `${useRecent ? 'Last two weeks' : 'Playtime'}: %1$s ${hours ? 'hrs' : 'min'}`;
	return bigPictureHomeText(doc, `${prefix}${hours ? 'Hours' : 'Minutes'}`, fallback).replace(/%1\$[sd]/g, value);
}
