import { backendLog, neutralizeSteamAppIdFileBackend } from '../../api/backend';
import { getShortcutAppById } from '../../steam/shortcuts';
import { hasNoLauncherOption, mergeNoLauncherOption, removeIncompatibleLauncherBypass, shouldAutoApplyNoLauncher } from '../shortcuts/runtime';

const reconciledLaunchOptions = new Set<number>();

export function reconcileShortcutLaunchOptions(shortcutAppId: string, steamAppId: string, title: string): void {
	const app = getShortcutAppById(Number(shortcutAppId));
	const shortcutExe = String(app?.strShortcutExe || app?.m_strShortcutExe || app?.shortcut_exe || app?.strExePath || '').trim();
	const shortcutStartDir = String(app?.strShortcutStartDir || app?.m_strShortcutStartDir || app?.shortcut_start_dir || app?.strStartDir || '').trim();
	if (shortcutExe || shortcutStartDir) {
		void neutralizeSteamAppIdFileBackend({ request_json: JSON.stringify({ exe_path: shortcutExe, start_dir: shortcutStartDir }) }).catch(() => {});
	}
	const id = Number(shortcutAppId), apps = (window as any).SteamClient?.Apps;
	if (typeof apps?.SetShortcutLaunchOptions !== 'function' || reconciledLaunchOptions.has(id)) return;
	reconciledLaunchOptions.add(id);
	const currentOptions = String(app?.strShortcutLaunchOptions || app?.m_strShortcutLaunchOptions || app?.shortcut_launch_options || app?.strArguments || '').trim();
	if (shouldAutoApplyNoLauncher(steamAppId) && !hasNoLauncherOption(currentOptions)) {
		const updated = mergeNoLauncherOption(currentOptions, steamAppId);
		void apps.SetShortcutLaunchOptions(id, updated);
		backendLog(`Auto-reconciled launcher bypass on view for "${title}" (${shortcutAppId}): "${updated}"`);
	} else if (!shouldAutoApplyNoLauncher(steamAppId) && hasNoLauncherOption(currentOptions)) {
		const cleaned = removeIncompatibleLauncherBypass(currentOptions, steamAppId);
		void apps.SetShortcutLaunchOptions(id, cleaned);
		backendLog(`Cleaned incompatible launcher bypass on view for "${title}" (${shortcutAppId}): "${cleaned}"`);
	}
}
