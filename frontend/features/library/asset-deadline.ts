/** Bound a read whose transport cannot be cancelled (for example Millennium
 * IPC). A late reply is consumed but never returned to the caller or cache.
 * Do not use this for writes: their underlying mutation would still run. */
export function readAssetWithDeadline<T>(request: PromiseLike<T> | T, timeoutMs: number): Promise<T | null> {
	return new Promise(resolve => {
		let settled = false;
		const finish = (value: T | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
		Promise.resolve(request).then(value => finish(value), () => finish(null));
	});
}
