import { backendLog, neutralizeSteamAppIdFileBackend, restoreSteamAppIdFileBackend } from '../../api/backend';
import { cleanShortcutPath, getShortcutAppById, readShortcutOverviewField, shortcutExecutableIdentity, shortcutPathDirectory } from '../../steam/shortcuts';
import { readShortcutLaunchDetails } from '../../steam/shortcut-details';
import { getAllShortcutRecords } from './registry';
interface AppIdFileTarget { exe_path: string; start_dir: string; notApplicable?: boolean }

/** Use the same concrete Steam shortcut and renderer for protection and restore.
 * An AppOverview alone does not contain Steam's current launch definition. */
export function shortcutAppIdFileTarget(shortcutAppId: number, doc?: Document | null, fallbackExecutable = ''): AppIdFileTarget {
	const empty = { exe_path: '', start_dir: '' };
	if (!Number.isInteger(shortcutAppId) || shortcutAppId < 2147483648 || shortcutAppId >= 4294967296) return empty;
	const sources = [readShortcutLaunchDetails(shortcutAppId, doc),
		getAllShortcutRecords(doc).find(record => record.id === shortcutAppId)?.app,
		getShortcutAppById(shortcutAppId, doc || undefined)];
	const field = (...keys: string[]): string => sources.map(source => readShortcutOverviewField(source, ...keys)).find(Boolean) || '';
	const exe_path = cleanShortcutPath(field('strShortcutExe', 'm_strShortcutExe', 'shortcut_exe', 'strExePath') || fallbackExecutable);
	if (fallbackExecutable && exe_path && shortcutExecutableIdentity(exe_path) !== shortcutExecutableIdentity(fallbackExecutable)) return empty;
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(exe_path)) return { ...empty, notApplicable: true };
	if (exe_path && !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(exe_path)) return empty;
	const startDir = cleanShortcutPath(field('strShortcutStartDir', 'm_strShortcutStartDir', 'shortcut_start_dir', 'strStartDir'));
	return { exe_path, start_dir: /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(startDir) ? startDir : shortcutPathDirectory(exe_path) };
}

export async function updateShortcutAppIdFile(
	operation: 'neutralize' | 'restore', target: AppIdFileTarget,
): Promise<boolean> {
	if (target.notApplicable) return true;
	if (!target.exe_path && !target.start_dir) {
		backendLog(`[NGL][steam_appid.txt] ${operation} failed: missing_target`);
		return false;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const request = { request_json: JSON.stringify({ ...target, expires_at_ms: Date.now() + 3500 }) };
		const reply = await Promise.race([
			operation === 'neutralize' ? neutralizeSteamAppIdFileBackend(request) : restoreSteamAppIdFileBackend(request),
			new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('steam_appid_file_timeout')), 4000); }),
		]);
		let result: any = reply;
		for (let attempt = 0; attempt < 2 && typeof result === 'string'; attempt++) result = JSON.parse(result);
		if (result?.ok !== true || result.skipped) throw new Error(result?.error || result?.skipped || 'steam_appid_file_unconfirmed');
		backendLog(`[NGL][steam_appid.txt] ${operation} confirmed: ${target.exe_path || target.start_dir}`);
		return true;
	} catch (error) {
		backendLog(`[NGL][steam_appid.txt] ${operation} failed for ${target.exe_path || target.start_dir}: ${error}`);
		return false;
	} finally { if (timer !== undefined) clearTimeout(timer); }
}
