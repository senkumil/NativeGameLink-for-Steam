import { readAssetWithDeadline } from './asset-deadline';

// Steam IPC mutations have no cancellation API. Retain their real promise even
// after the UI deadline so retry, unlink or relink cannot race an unknown write.
const pendingWrites = new Map<string, Promise<boolean>>();

export function getPendingNativeAssetWrites(shortcutAppId: number): Promise<boolean>[] {
	const prefix = `${shortcutAppId}:`;
	return Array.from(pendingWrites.entries()).filter(([key]) => key.startsWith(prefix)).map(([, request]) => request);
}

export function hasPendingNativeAssetWrites(shortcutAppId: number): boolean {
	const prefix = `${shortcutAppId}:`;
	return Array.from(pendingWrites.keys()).some(key => key.startsWith(prefix));
}

export async function writeNativeAsset(shortcutAppId: number, slot: string,
	write: () => unknown, isCurrent: () => boolean, timeoutMs = 5_000): Promise<boolean> {
	if (!isCurrent() || hasPendingNativeAssetWrites(shortcutAppId)) return false;
	const key = `${shortcutAppId}:${slot}`;
	let finish!: (value: boolean) => void;
	const request = new Promise<boolean>(resolve => { finish = resolve; });
	pendingWrites.set(key, request);
	const settle = (accepted: boolean): void => {
		if (pendingWrites.get(key) === request) pendingWrites.delete(key);
		finish(accepted);
	};
	try {
		const result = write();
		if (!result || typeof (result as any).then !== 'function') settle(result !== false);
		else Promise.resolve(result).then(accepted => settle(accepted !== false), () => settle(false));
	} catch { settle(false); }
	return (await readAssetWithDeadline(request, timeoutMs)) === true && isCurrent();
}
