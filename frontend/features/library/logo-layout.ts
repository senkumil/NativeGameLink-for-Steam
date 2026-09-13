import { readLogoLayoutImagesBackend } from '../../api/backend';
import { normalizeCommunityLogoDataUrl } from './artwork-image';

export type SteamLogoPinPosition = 'BottomLeft' | 'UpperLeft' | 'CenterCenter' | 'UpperCenter' | 'BottomCenter';

export function layoutFingerprint(logo: string, hero: string): string {
	let hash = 2166136261;
	for (const value of [logo, '|', hero]) for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	return `${logo.length}-${hero.length}-${(hash >>> 0).toString(16)}`;
}

/**
 * Evaluates hero banner visual complexity to identify the cleanest empty space
 * for placing the game logo without obstructing subjects or characters.
 */
export async function detectHeroEmptySpace(heroDataUrl: string): Promise<SteamLogoPinPosition | null> {
	if (typeof document === 'undefined' || typeof Image === 'undefined' || !heroDataUrl || typeof heroDataUrl !== 'string' || !heroDataUrl.startsWith('data:image/')) {
		return null;
	}
	return new Promise(resolve => {
		const image = new Image();
		const finish = (): void => { clearTimeout(deadline); image.onload = null; image.onerror = null; };
		const deadline = setTimeout(() => { finish(); resolve(null); }, 3000);
		image.onload = () => {
			try {
				const sampleW = 192;
				const sampleH = 62;
				const canvas = document.createElement('canvas');
				canvas.width = sampleW;
				canvas.height = sampleH;
				const ctx = canvas.getContext('2d');
				if (!ctx) { finish(); resolve(null); return; }
				ctx.drawImage(image, 0, 0, sampleW, sampleH);
				const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
				const data = imgData.data;

				// Steam client supports: BottomLeft, UpperLeft, BottomCenter, UpperCenter, CenterCenter.
				// Candidate regions evaluate visual clutter/complexity:
				const zones: { pin: SteamLogoPinPosition; x1: number; x2: number; y1: number; y2: number; bias: number }[] = [
					{ pin: 'BottomLeft', x1: 0.04, x2: 0.44, y1: 0.35, y2: 0.92, bias: 0.85 },
					{ pin: 'UpperLeft', x1: 0.04, x2: 0.44, y1: 0.08, y2: 0.55, bias: 0.95 },
					{ pin: 'BottomCenter', x1: 0.28, x2: 0.72, y1: 0.35, y2: 0.92, bias: 1.0 },
					{ pin: 'UpperCenter', x1: 0.28, x2: 0.72, y1: 0.08, y2: 0.55, bias: 1.05 },
					{ pin: 'CenterCenter', x1: 0.25, x2: 0.75, y1: 0.22, y2: 0.78, bias: 1.05 },
				];

				const scoreZone = (z: typeof zones[0]): number => {
					const startX = Math.floor(z.x1 * sampleW);
					const endX = Math.min(sampleW - 1, Math.floor(z.x2 * sampleW));
					const startY = Math.floor(z.y1 * sampleH);
					const endY = Math.min(sampleH - 1, Math.floor(z.y2 * sampleH));
					let totalGrad = 0;
					let count = 0;
					let sumLum = 0;
					let sumLumSq = 0;

					for (let y = startY; y < endY; y += 1) {
						for (let x = startX; x < endX; x += 1) {
							const idx = (y * sampleW + x) * 4;
							const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
							sumLum += lum;
							sumLumSq += lum * lum;
							if (x + 1 < endX) {
								const idxR = (y * sampleW + x + 1) * 4;
								const lumR = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2];
								totalGrad += Math.abs(lumR - lum);
							}
							if (y + 1 < endY) {
								const idxD = ((y + 1) * sampleW + x) * 4;
								const lumD = 0.299 * data[idxD] + 0.587 * data[idxD + 1] + 0.114 * data[idxD + 2];
								totalGrad += Math.abs(lumD - lum);
							}
							count += 1;
						}
					}
					if (count === 0) return 999999;
					const meanLum = sumLum / count;
					const variance = Math.max(0, (sumLumSq / count) - (meanLum * meanLum));
					const edgeEnergy = totalGrad / count;
					return (edgeEnergy + Math.sqrt(variance) * 0.5) * z.bias;
				};

				let bestPin: SteamLogoPinPosition = 'BottomLeft';
				let bestScore = Infinity;
				for (const z of zones) {
					const s = scoreZone(z);
					if (s < bestScore) {
						bestScore = s;
						bestPin = z.pin;
					}
				}
				finish();
				resolve(bestPin);
			} catch {
				finish();
				resolve(null);
			}
		};
		image.onerror = () => { finish(); resolve(null); };
		image.src = heroDataUrl;
	});
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
 * Height sets the preferred size; the whole valid region is the safety width cap.
 * Fractional width caps shrink square logos when only the sidebar moves.
 */
export function automaticLogoBox(width: number, height: number): { nWidthPct: number; nHeightPct: number } {
	const ratio = width / Math.max(1, height);
	return { nWidthPct: 100, nHeightPct: ratio >= 2.5 ? 45 : 65 };
}

export function calibrateLogoBox(
	width: number,
	height: number,
	raw?: { nWidthPct?: number; nHeightPct?: number; width_pct?: number; height_pct?: number } | null
): { nWidthPct: number; nHeightPct: number } {
	if (raw) {
		const rawW = Number(raw.nWidthPct ?? raw.width_pct);
		const rawH = Number(raw.nHeightPct ?? raw.height_pct);
		if (Number.isFinite(rawW) && Number.isFinite(rawH) && rawW >= 5 && rawH >= 5 && rawW <= 100 && rawH <= 100) {
			return { nWidthPct: rawW, nHeightPct: rawH };
		}
	}
	return automaticLogoBox(width, height);
}

export async function prepareAutomaticLogo(dataUrl: string): Promise<{ logo: string; nWidthPct: number; nHeightPct: number; naturalWidth: number; naturalHeight: number }> {
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
		image.onload = () => {
			const size = automaticLogoBox(image.naturalWidth, image.naturalHeight);
			finish();
			resolve({ logo, ...size, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
		};
		image.onerror = () => { finish(); reject(new Error('logo_decode_failed')); };
		image.src = logo;
	});
}
