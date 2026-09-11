import { readLogoLayoutImagesBackend } from '../../api/backend';
import { normalizeCommunityLogoDataUrl } from './artwork-image';

export function layoutFingerprint(logo: string, hero: string): string {
	let hash = 2166136261;
	for (const value of [logo, '|', hero]) for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return `${logo.length}-${hero.length}-${(hash >>> 0).toString(16)}`;
}

export async function readLogoLayout(shortcutAppId: number): Promise<{ logo: string; hero: string; key: string }> {
	let result: any = await readLogoLayoutImagesBackend({ shortcut_app_id: String(shortcutAppId) });
	for (let i = 0; i < 3 && typeof result === 'string'; i++) result = JSON.parse(result);
	const logo = String(result?.logo || '');
	const hero = String(result?.hero || '');
	if (!logo) throw new Error('logo_not_available');
	return { logo, hero, key: layoutFingerprint(logo, hero) };
}

/**
 * Height and width caps prevent the logo from encroaching onto character
 * artwork on the right side of the Steam library header while scaling fluidly.
 */
export function automaticLogoBox(width: number, height: number): { nWidthPct: number; nHeightPct: number } {
	const ratio = width / Math.max(1, height);
	if (ratio >= 2.5) return { nWidthPct: 52, nHeightPct: 45 };
	if (ratio >= 1.4) return { nWidthPct: 48, nHeightPct: 52 };
	return { nWidthPct: 40, nHeightPct: 58 };
}

export async function prepareAutomaticLogo(dataUrl: string): Promise<{ logo: string; nWidthPct: number; nHeightPct: number }> {
	let timer: ReturnType<typeof setTimeout>;
	const logo = await Promise.race([
		normalizeCommunityLogoDataUrl(dataUrl),
		new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 8000); }),
	]).finally(() => clearTimeout(timer));
	if (!logo) throw new Error('logo_decode_timeout');
	return new Promise((resolve, reject) => {
		const image = new Image();
		const finish = (): void => { clearTimeout(deadline); image.onload = null; image.onerror = null; };
		const deadline = setTimeout(() => { finish(); reject(new Error('logo_decode_timeout')); }, 8000);
		image.onload = () => { const size = automaticLogoBox(image.naturalWidth, image.naturalHeight); finish(); resolve({ logo, ...size }); };
		image.onerror = () => { finish(); reject(new Error('logo_decode_failed')); };
		image.src = logo;
	});
}
