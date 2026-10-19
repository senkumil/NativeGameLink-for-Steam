import { steamWebpackRuntime } from '../../steam/modules/SteamWebpackRuntime';
import { writeNativeAsset } from './native-asset-write';

interface NativeLogoPosition {
	pinnedPosition: string;
	nWidthPct: number;
	nHeightPct: number;
}

/** Save through Steam's own shortcut store so its rendered position and grid
 * cache change together. Public Steam apps never reach either save path. */
export async function saveNativeShortcutLogoPosition(
	shortcutId: number,
	position: NativeLogoPosition,
	isCurrent: () => boolean,
	timeoutMs = 5_000,
): Promise<boolean> {
	if (!Number.isInteger(shortcutId) || shortcutId < 2147483648 || shortcutId > 4294967295 || !isCurrent()) return false;
	const view = typeof window === 'undefined' ? null : window as any;
	if (!view || view.closed) return false;
	const doc = view.document as Document | undefined;
	let details = view.appDetailsStore;
	let apps = view.appStore;
	if (typeof details?.SaveCustomLogoPosition !== 'function' || typeof apps?.GetAppOverviewByAppID !== 'function') {
		try {
			steamWebpackRuntime.captureRuntime(doc);
			const require = steamWebpackRuntime.getRequire(doc);
			if (typeof details?.SaveCustomLogoPosition !== 'function') details = require?.(78057)?.H;
			if (typeof apps?.GetAppOverviewByAppID !== 'function') apps = require?.(1776)?.tw;
		} catch {}
	}
	try {
		let overview: any;
		if (typeof apps?.GetAppOverviewByAppID === 'function') {
			overview = apps.GetAppOverviewByAppID(shortcutId);
			if (!overview || Number(overview.appid) !== shortcutId) return false;
		}
		if (!isCurrent() || view.closed) return false;
		if (overview && typeof details?.SaveCustomLogoPosition === 'function') {
			const accepted = await writeNativeAsset(shortcutId, 'logo-position',
				() => details.SaveCustomLogoPosition(overview, position), isCurrent, timeoutMs);
			return accepted && isCurrent() && !view.closed;
		}
		const bridge = view.SteamClient?.Apps;
		if (typeof bridge?.SetCustomLogoPositionForApp !== 'function') return false;
		const accepted = await writeNativeAsset(shortcutId, 'logo-position', () => bridge.SetCustomLogoPositionForApp(shortcutId, JSON.stringify({
			nVersion: 1, logoPosition: position,
		})), isCurrent, timeoutMs);
		return accepted && isCurrent() && !view.closed;
	} catch { return false; }
}
