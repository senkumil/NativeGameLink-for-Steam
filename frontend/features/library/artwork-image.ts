import { fetchArtworkImageBackend } from '../../api/backend';

/** Fetch an image URL with a bounded direct request and a CORS fallback for
 * non-Steam providers. Explicit client errors are authoritative misses. */
export async function imageUrlToBase64(url: string): Promise<string | null> {
	if (!url || typeof url !== 'string') return null;
	if (/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(url)) return url;
	const fetchWithTimeout = async (value: string, timeoutMs = 4000): Promise<{ ok: boolean; status: number; blob: Blob | null }> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(value, { signal: controller.signal });
			clearTimeout(timer);
			if (!response.ok) return { ok: false, status: response.status, blob: null };
			return { ok: true, status: response.status, blob: await response.blob() };
		} catch {
			clearTimeout(timer);
			return { ok: false, status: 0, blob: null };
		}
	};
	const blobToDataUrl = (blob: Blob): Promise<string | null> => new Promise(resolve => {
		if (!blob || blob.size < 100) { resolve(null); return; }
		const reader = new FileReader();
		reader.onloadend = () => resolve((reader.result as string) || null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(blob);
	});
	const isSteamCdn = url.includes('steamstatic.com') || url.includes('steampowered.com');
	if (!isSteamCdn) {
		const direct = await fetchWithTimeout(url);
		if (direct.ok && direct.blob) {
			const dataUrl = await blobToDataUrl(direct.blob);
			if (dataUrl) return dataUrl;
		}
		if (direct.status >= 400 && direct.status < 500) return null;
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
		const raw = await fetchArtworkImageBackend({ request_json: JSON.stringify({ url }) });
		let value: any = raw;
		for (let attempt = 0; attempt < 3 && typeof value === 'string'; attempt += 1) value = JSON.parse(value);
		const base64 = typeof value?.data_base64 === 'string' ? value.data_base64 : '';
		const mime = typeof value?.mime === 'string' && /^image\/(?:png|jpeg|webp)$/.test(value.mime) ? value.mime : '';
		if (value?.ok === true && base64 && mime) return `data:${mime};base64,${base64}`;
	} catch {}
	return null;
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
	return await new Promise(resolve => {
		const image = new Image();
		image.onload = () => {
			try {
				const srcW = Math.max(1, image.naturalWidth || image.width);
				const srcH = Math.max(1, image.naturalHeight || image.height);
				const tempCanvas = document.createElement('canvas');
				tempCanvas.width = srcW;
				tempCanvas.height = srcH;
				const tempCtx = tempCanvas.getContext('2d');
				if (!tempCtx) { resolve(dataUrl); return; }
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

				const outCanvas = document.createElement('canvas');
				outCanvas.width = destW;
				outCanvas.height = destH;
				const outCtx = outCanvas.getContext('2d');
				if (!outCtx) { resolve(dataUrl); return; }
				outCtx.clearRect(0, 0, destW, destH);
				outCtx.imageSmoothingEnabled = true;
				outCtx.imageSmoothingQuality = 'high';
				outCtx.drawImage(tempCanvas, cropX, cropY, cropW, cropH, 0, 0, destW, destH);
				resolve(outCanvas.toDataURL('image/png'));
			} catch {
				resolve(dataUrl);
			}
		};
		image.onerror = () => resolve(dataUrl);
		image.src = dataUrl;
	});
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
	return await new Promise(resolve => {
		const image = new Image();
		image.onload = () => {
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
				if (!context) { resolve(dataUrl); return; }
				context.clearRect(0, 0, target.width, target.height);
				context.imageSmoothingEnabled = true;
				context.imageSmoothingQuality = 'high';
				context.drawImage(image, Math.round((target.width - drawWidth) / 2),
					Math.round((target.height - drawHeight) / 2), drawWidth, drawHeight);
				resolve(canvas.toDataURL('image/png'));
			} catch { resolve(dataUrl); }
		};
		image.onerror = () => resolve(dataUrl);
		image.src = dataUrl;
	});
}
