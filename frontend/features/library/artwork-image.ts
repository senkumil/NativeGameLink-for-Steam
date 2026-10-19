import { fetchArtworkImageBackend } from '../../api/backend';
import { readAssetWithDeadline } from './asset-deadline';

/** CEF occasionally never emits load/error after a display/window transition.
 * Detach both handlers on every outcome so an obsolete decode cannot resume
 * canvas work after the caller has retried or changed the linked game. */
export function decodeArtworkImage(dataUrl: string): Promise<HTMLImageElement | null> {
	return new Promise(resolve => {
		const image = new Image();
		let settled = false;
		const finish = (decoded: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			image.onload = null;
			image.onerror = null;
			if (!decoded) { try { image.src = ''; } catch {} }
			resolve(decoded ? image : null);
		};
		const timer = setTimeout(() => finish(false), 4_000);
		image.onload = () => finish(true);
		image.onerror = () => finish(false);
		try { image.src = dataUrl; } catch { finish(false); }
	});
}

const missingImages = new Map<string, number>();
export function imageUrlKnownMissing(url: string): boolean {
	const expiry = missingImages.get(url);
	if (!expiry) return false;
	if (expiry > Date.now()) return true;
	missingImages.delete(url);
	return false;
}
function rememberMissingImage(url: string, status: number): void {
	if (status !== 404 && status !== 410) return;
	if (missingImages.size >= 256) missingImages.delete(missingImages.keys().next().value);
	missingImages.set(url, Date.now() + 60_000);
}

/** Fetch an image URL with a bounded direct request and a CORS fallback for
 * non-Steam providers. Explicit client errors are authoritative misses. */
async function downloadImage(url: string): Promise<string | null> {
	if (!url || typeof url !== 'string') return null;
	if (imageUrlKnownMissing(url)) return null;
	if (/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(url)) return url;
	const fetchWithTimeout = async (value: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number; blob: Blob | null }> => {
		const controller = new AbortController();
		const deadline = Date.now() + timeoutMs;
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			// Abort is advisory in some CEF/provider implementations. Bound the
			// complete headers/body read even when that signal is ignored.
			const response = await readAssetWithDeadline(fetch(value, { signal: controller.signal }), timeoutMs);
			if (!response) return { ok: false, status: 0, blob: null };
			if (!response.ok) return { ok: false, status: response.status, blob: null };
			const remaining = deadline - Date.now();
			if (remaining <= 0) return { ok: false, status: 0, blob: null };
			const blob = await readAssetWithDeadline(response.blob(), remaining);
			return { ok: Boolean(blob), status: response.status, blob };
		} catch {
			return { ok: false, status: 0, blob: null };
		} finally {
			// Keep the deadline alive while reading the body, not just the headers.
			clearTimeout(timer);
		}
	};
	const blobToDataUrl = (blob: Blob): Promise<string | null> => new Promise(resolve => {
		if (!blob || blob.size < 100) { resolve(null); return; }
		const reader = new FileReader();
		let settled = false;
		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reader.onloadend = null;
			reader.onerror = null;
			resolve(value);
		};
		const timer = setTimeout(() => {
			finish(null);
			try { reader.abort(); } catch {}
		}, 4_000);
		reader.onloadend = () => finish(typeof reader.result === 'string' ? reader.result : null);
		reader.onerror = () => finish(null);
		try { reader.readAsDataURL(blob); } catch { finish(null); }
	});
	const isSteamCdn = url.includes('steamstatic.com') || url.includes('steampowered.com');
	if (!isSteamCdn) {
		const direct = await fetchWithTimeout(url);
		if (direct.ok && direct.blob) {
			const dataUrl = await blobToDataUrl(direct.blob);
			if (dataUrl) return dataUrl;
		}
		if (direct.status >= 400 && direct.status < 500) {
			rememberMissingImage(url, direct.status);
			return null;
		}
		try {
			const proxied = 'https://wsrv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) + '&output=png';
			const fallback = await fetchWithTimeout(proxied, 8000);
			if (fallback.ok && fallback.blob) {
				const dataUrl = await blobToDataUrl(fallback.blob);
				if (dataUrl) return dataUrl;
			}
		} catch {}
	}
	// Steam CEF may reject external hosts due to CORS. Use backend as authoritative loader.
	try {
		const raw = await readAssetWithDeadline(fetchArtworkImageBackend({ request_json: JSON.stringify({ url }) }), 8_000);
		if (raw === null) return null;
		let value: any = raw;
		for (let attempt = 0; attempt < 3 && typeof value === 'string'; attempt += 1) value = JSON.parse(value);
		rememberMissingImage(url, Number(value?.status));
		const base64 = typeof value?.data_base64 === 'string' ? value.data_base64 : '';
		const mime = typeof value?.mime === 'string' && /^image\/(?:png|jpeg|webp)$/.test(value.mime) ? value.mime : '';
		if (value?.ok === true && base64 && mime) return `data:${mime};base64,${base64}`;
	} catch {}
	return null;
}

// Share transfers across concurrent links and retain a small, short-lived LRU
// for repeated slots/repairs. Size accounts for UTF-16 base64 strings.
const imageTransfers = new Map<string, Promise<string | null>>();
const imageResults = new Map<string, { value: string; expires: number }>();
const IMAGE_CACHE_BUDGET = 16 * 1024 * 1024;
let imageCacheBytes = 0;

export function imageUrlToBase64(url: string): Promise<string | null> {
	if (!url || typeof url !== 'string') return Promise.resolve(null);
	if (url.startsWith('data:')) return downloadImage(url);
	const now = Date.now();
	for (const [key, entry] of imageResults) {
		if (entry.expires <= now) { imageCacheBytes -= entry.value.length * 2; imageResults.delete(key); }
	}
	const cached = imageResults.get(url);
	if (cached) {
		imageResults.delete(url); imageResults.set(url, cached);
		return Promise.resolve(cached.value);
	}
	const active = imageTransfers.get(url);
	if (active) return active;
	const request = downloadImage(url).then(value => {
		if (value && value.length * 2 <= IMAGE_CACHE_BUDGET) {
			while (imageCacheBytes + value.length * 2 > IMAGE_CACHE_BUDGET && imageResults.size) {
				const key = imageResults.keys().next().value;
				imageCacheBytes -= imageResults.get(key)!.value.length * 2;
				imageResults.delete(key);
			}
			imageResults.set(url, { value, expires: Date.now() + 60_000 });
			imageCacheBytes += value.length * 2;
		}
		return value;
	}).finally(() => {
		if (imageTransfers.get(url) === request) imageTransfers.delete(url);
	});
	imageTransfers.set(url, request);
	return request;
}

/**
 * Normalize community/SteamGridDB logos:
 * 1. Preserve alpha.
 * 2. Detect actual visible alpha bounding box.
 * 3. Remove EXCESSIVE transparent padding only.
 * 4. Keep small safety padding.
 * 5. Preserve original aspect ratio.
 * 6. Scale proportionally: maxWidth = 1280, maxHeight = 720.
 * 7. NEVER stretch.
 * 8. NEVER letterbox into fixed 1280x720 canvas.
 * 9. Output PNG with intact alpha.
 */
export async function normalizeCommunityLogoDataUrl(dataUrl: string): Promise<string | null> {
	if (!dataUrl) return null;
	const image = await decodeArtworkImage(dataUrl);
	if (!image) return dataUrl;
	try {
		const srcW = Math.max(1, image.naturalWidth || image.width);
		const srcH = Math.max(1, image.naturalHeight || image.height);
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = srcW;
		tempCanvas.height = srcH;
		const tempCtx = tempCanvas.getContext('2d');
		if (!tempCtx) { return dataUrl; }
		tempCtx.drawImage(image, 0, 0, srcW, srcH);
		const imgData = tempCtx.getImageData(0, 0, srcW, srcH);
		const data = imgData.data;

		let minX = srcW, minY = srcH, maxX = 0, maxY = 0;
		let hasVisibleAlpha = false;

		for (let y = 0; y < srcH; y += 1) {
			for (let x = 0; x < srcW; x += 1) {
				const alpha = data[(y * srcW + x) * 4 + 3];
				if (alpha > 10) {
					hasVisibleAlpha = true;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}

		if (!hasVisibleAlpha || minX > maxX || minY > maxY) {
			minX = 0; minY = 0; maxX = srcW - 1; maxY = srcH - 1;
		}

		const visibleW = maxX - minX + 1;
		const visibleH = maxY - minY + 1;
		const excessivePadding = (visibleW < srcW * 0.85) || (visibleH < srcH * 0.85);

		let cropX = 0, cropY = 0, cropW = srcW, cropH = srcH;
		if (excessivePadding) {
			const padX = Math.max(4, Math.round(visibleW * 0.04));
			const padY = Math.max(4, Math.round(visibleH * 0.04));
			cropX = Math.max(0, minX - padX);
			cropY = Math.max(0, minY - padY);
			cropW = Math.min(srcW - cropX, (maxX - minX + 1) + padX * 2);
			cropH = Math.min(srcH - cropY, (maxY - minY + 1) + padY * 2);
		}

		const maxWidth = 1280;
		const maxHeight = 720;
		let destW = cropW;
		let destH = cropH;

		if (destW > maxWidth || destH > maxHeight) {
			const scale = Math.min(maxWidth / destW, maxHeight / destH);
			destW = Math.max(1, Math.round(destW * scale));
			destH = Math.max(1, Math.round(destH * scale));
		}

		if (!excessivePadding && destW === srcW && destH === srcH) {
			return dataUrl;
		}

		const outCanvas = document.createElement('canvas');
		outCanvas.width = destW;
		outCanvas.height = destH;
		const outCtx = outCanvas.getContext('2d');
		if (!outCtx) { return dataUrl; }
		outCtx.clearRect(0, 0, destW, destH);
		outCtx.imageSmoothingEnabled = true;
		outCtx.imageSmoothingQuality = 'high';
		outCtx.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, destW, destH);
		return outCanvas.toDataURL('image/png');
	} catch {
		return dataUrl;
	}
}

/** Normalize community artwork to Steam's native canvas for each slot. */
export async function normalizeCommunityArtworkDataUrl(dataUrl: string, imageType: number): Promise<string | null> {
	if (imageType === 2) {
		return await normalizeCommunityLogoDataUrl(dataUrl);
	}
	const targetByType: Record<number, { width: number; height: number; fit: 'cover' | 'contain' }> = {
		0: { width: 600, height: 900, fit: 'cover' },
		1: { width: 1920, height: 620, fit: 'cover' },
		3: { width: 920, height: 430, fit: 'cover' },
	};
	const baseTarget = targetByType[imageType];
	if (!baseTarget) return dataUrl;
	const image = await decodeArtworkImage(dataUrl);
	if (!image) return dataUrl;
	try {
		const sourceWidth = Math.max(1, image.naturalWidth || image.width || baseTarget.width);
		const sourceHeight = Math.max(1, image.naturalHeight || image.height || baseTarget.height);
		const is2x = sourceWidth >= baseTarget.width * 1.4 || sourceHeight >= baseTarget.height * 1.4;
		const target = is2x
			? { width: baseTarget.width * 2, height: baseTarget.height * 2, fit: baseTarget.fit }
			: baseTarget;
		const scale = target.fit === 'cover'
			? Math.max(target.width / sourceWidth, target.height / sourceHeight)
			: Math.min(target.width / sourceWidth, target.height / sourceHeight);
		const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
		const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const context = canvas.getContext('2d');
		if (!context) { return dataUrl; }
		context.clearRect(0, 0, target.width, target.height);
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, Math.round((target.width - drawWidth) / 2),
			Math.round((target.height - drawHeight) / 2), drawWidth, drawHeight);
		return canvas.toDataURL('image/png');
	} catch { return dataUrl; }
}
