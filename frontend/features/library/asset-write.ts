export interface ResourceWriteGuard {
	resource_generation: number;
	expires_at_ms: number;
}

let lastResourceGeneration = 0;

/** The backend compares this intent before committing a grid file. The ordered
 * generation also covers a request delivered after a newer request's reply. */
export function createResourceWriteGuard(deadlineMs = Number.POSITIVE_INFINITY): ResourceWriteGuard {
	lastResourceGeneration = Math.max(lastResourceGeneration + 1, Date.now() * 1024);
	return { resource_generation: lastResourceGeneration, expires_at_ms: Math.min(Date.now() + 10_000, deadlineMs) };
}

/** Only for backend methods that enforce ResourceWriteGuard before committing.
 * Keep a second of headroom over Lua's second-resolution expiry clock. Unlike
 * racing arbitrary mutations, an expired request cannot write after recovery. */
export function writeAssetWithDeadline<T>(write: (guard: ResourceWriteGuard) => PromiseLike<T>,
	isCurrent: () => boolean, deadlineMs = Number.POSITIVE_INFINITY): Promise<T | null> {
	if (!isCurrent() || Date.now() >= deadlineMs) return Promise.resolve(null);
	const guard = createResourceWriteGuard(deadlineMs);
	return new Promise(resolve => {
		let settled = false;
		const finish = (value: T | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(isCurrent() ? value : null);
		};
		const timer = setTimeout(() => finish(null), Math.max(1, guard.expires_at_ms - Date.now() + 1_000));
		try { Promise.resolve(write(guard)).then(value => finish(value), () => finish(null)); }
		catch { finish(null); }
	});
}
