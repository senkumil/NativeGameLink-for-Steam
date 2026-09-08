interface ArtworkQualitySpec {
	minWidth: number;
	minHeight: number;
	minRatio: number;
	maxRatio: number;
}

const AUTOMATIC_SLOT_QUALITY: Record<number, ArtworkQualitySpec> = {
	0: { minWidth: 300, minHeight: 400, minRatio: 0.52, maxRatio: 0.82 },
	1: { minWidth: 1280, minHeight: 400, minRatio: 2.35, maxRatio: 3.65 },
	2: { minWidth: 64, minHeight: 20, minRatio: 0.2, maxRatio: 25 },
	3: { minWidth: 400, minHeight: 180, minRatio: 1.5, maxRatio: 2.75 },
};

/** Reject automatic sources that would need severe cropping or upscaling.
 * Explicit user selections intentionally bypass this policy. */
export async function automaticArtworkMeetsSlotQuality(dataUrl: string, imageType: number): Promise<boolean> {
	const spec = AUTOMATIC_SLOT_QUALITY[imageType];
	if (!spec || !dataUrl) return false;
	return await new Promise(resolve => {
		const image = new Image();
		const finish = (accepted: boolean): void => {
			clearTimeout(timer);
			image.onload = null;
			image.onerror = null;
			resolve(accepted);
		};
		const timer = setTimeout(() => finish(false), 10_000);
		image.onload = () => {
			const width = Number(image.naturalWidth || image.width || 0);
			const height = Number(image.naturalHeight || image.height || 0);
			const ratio = height > 0 ? width / height : 0;
			finish(width >= spec.minWidth && height >= spec.minHeight
				&& ratio >= spec.minRatio && ratio <= spec.maxRatio);
		};
		image.onerror = () => finish(false);
		image.src = dataUrl;
	});
}
