import { readAssetWithDeadline } from './asset-deadline';

// Steam IPC mutations have no cancellation API. Retain their real promise even
// after the UI deadline so retry, unlink or relink cannot race an unknown write.
interface PendingNativeWrite {
	request: Promise<boolean>;
	isCurrent: () => boolean;
	timedOut: boolean;
}
const pendingWrites = new Map<string, PendingNativeWrite>();

export function getPendingNativeAssetWrites(shortcutAppId: number): Promise<boolean>[] {
	const prefix = `${shortcutAppId}:`;
	return Array.from(pendingWrites.entries()).filter(([key]) => key.startsWith(prefix)).map(([, write]) => write.request);
}

export function hasPendingNativeAssetWrites(shortcutAppId: number): boolean {
	const prefix = `${shortcutAppId}:`;
	return Array.from(pendingWrites.keys()).some(key => key.startsWith(prefix));
}

/** Independent slots may be written in one batch. A clear, obsolete owner or
 * unresolved mutation past its deadline is a barrier for the whole shortcut. */
export function nativeAssetWriteBlocked(shortcutAppId: number, slot?: string): boolean {
	const prefix = `${shortcutAppId}:`;
	for (const [key, pending] of pendingWrites) {
		if (!key.startsWith(prefix)) continue;
		if (slot === 'clear' || slot === 'unlink-clear' || key === `${prefix}clear` || key === `${prefix}unlink-clear` || key === `${prefix}${slot}`
			|| pending.timedOut || !pending.isCurrent()) return true;
	}
	return false;
}

export async function writeNativeAsset(shortcutAppId: number, slot: string,
	write: () => unknown, isCurrent: () => boolean, timeoutMs = 5_000): Promise<boolean> {
	if (!isCurrent() || nativeAssetWriteBlocked(shortcutAppId, slot)) return false;
	const key = `${shortcutAppId}:${slot}`;
	let finish!: (value: boolean) => void;
	const request = new Promise<boolean>(resolve => { finish = resolve; });
	const pending: PendingNativeWrite = { request, isCurrent, timedOut: false };
	pendingWrites.set(key, pending);
	const settle = (accepted: boolean): void => {
		if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
		finish(accepted);
	};
	try {
		const result = write();
		if (!result || typeof (result as any).then !== 'function') settle(result !== false);
		else Promise.resolve(result).then(accepted => settle(accepted !== false), () => settle(false));
	} catch { settle(false); }
	const accepted = await readAssetWithDeadline(request, timeoutMs);
	if (accepted === null && pendingWrites.get(key) === pending) pending.timedOut = true;
	return accepted === true && isCurrent();
}
