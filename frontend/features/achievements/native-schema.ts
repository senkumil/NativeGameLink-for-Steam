/** Read public schema fields through Steam's API without publishing local
 * progress into any native store. Completed schemas live in the backend cache. */
export interface NativeAchievementSchema { appid: string; rows: Record<string, unknown>[] }
const pending = new Map<string, Promise<NativeAchievementSchema | null>>();
const failedUntil = new Map<string, number>();

export function readNativeAchievementSchema(appid: string): Promise<NativeAchievementSchema | null> {
	if (!/^\d+$/.test(appid) || Number(appid) <= 0 || Number(appid) >= 2147483648) return Promise.resolve(null);
	const existing = pending.get(appid);
	if (existing) return existing;
	if ((failedUntil.get(appid) || 0) > Date.now()) return Promise.resolve(null);
	const work = (async (): Promise<NativeAchievementSchema | null> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const apps = typeof window !== 'undefined' ? (window as any).SteamClient?.Apps : null;
			if (typeof apps?.GetMyAchievementsForApp !== 'function') return null;
			const result: any = await Promise.race([
				Promise.resolve(apps.GetMyAchievementsForApp(appid)),
				new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); }),
			]);
			const values = result?.data?.rgAchievements;
			if (Number(result?.result) !== 1 || !Array.isArray(values) || !values.length || values.length > 2000) return null;
			const responseAppId = result.data.unAppID ?? result.data.appid ?? result.data.nAppID;
			if (responseAppId != null && String(responseAppId) !== appid) return null;
			const seen = new Set<string>();
			const rows = values.flatMap((item: any) => {
				if (typeof item?.strID !== 'string' || !item.strID || item.strID.length > 256 || seen.has(item.strID)) return [];
				seen.add(item.strID);
				return [{ strID: item.strID, strName: String(item.strName || item.strID),
					strDescription: String(item.strDescription || ''), strImage: String(item.strImage || ''),
					strImageGray: String(item.strImageGray || item.strImage || ''), bHidden: item.bHidden === true,
					...(typeof item.flAchieved === 'number' && Number.isFinite(item.flAchieved) ? { flAchieved: item.flAchieved } : {}),
				}];
			});
			return rows.length ? { appid, rows } : null;
		} catch { return null; }
		finally { clearTimeout(timer); }
	})();
	pending.set(appid, work);
	void work.then(value => {
		if (pending.get(appid) === work) pending.delete(appid);
		if (!value) failedUntil.set(appid, Date.now() + 15_000);
		else failedUntil.delete(appid);
		while (failedUntil.size > 24) failedUntil.delete(failedUntil.keys().next().value as string);
	});
	return work;
}
