import { readLogoLayoutImagesBackend } from '../../api/backend';

export type SteamLogoPinPosition = 'BottomLeft' | 'UpperLeft' | 'CenterCenter' | 'UpperCenter' | 'BottomCenter';

// Steam's native TopCapsule fallback when appinfo has no logo_position.
export const STEAM_DEFAULT_LOGO_POSITION = {
	pinnedPosition: 'BottomLeft' as SteamLogoPinPosition, nWidthPct: 50, nHeightPct: 50,
};

export function layoutFingerprint(logo: string, hero: string): string {
	let hash = 2166136261;
	for (const value of [logo, '|', hero]) for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return `${logo.length}-${hero.length}-${(hash >>> 0).toString(16)}`;
}

/** Image pairs identify explicit manual adjustments, never automatic sizing. */
export async function readLogoLayout(shortcutAppId: number): Promise<{ logo: string; hero: string; key: string }> {
	let result: any = await readLogoLayoutImagesBackend({ shortcut_app_id: String(shortcutAppId) });
	for (let i = 0; i < 3 && typeof result === 'string'; i++) result = JSON.parse(result);
	const logo = String(result?.logo || '');
	const hero = String(result?.hero || '');
	if (!logo) throw new Error('logo_not_available');
	return { logo, hero, key: layoutFingerprint(logo, hero) };
}
