import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
const mutableRootFiles = [
  'mappings.json', 'mappings.backup.json',
  'achievement_base_path.txt', 'achievement_paths.json', 'achievement_options.json', 'community_item_options.json',
  'playtime_sessions.json', 'sessions.json',
];

for (const name of mutableRootFiles) {
  try {
    await fs.access(path.join(root, name));
    failures.push(`${name}: mutable per-user state must never ship in a clean plugin archive`);
  } catch {}
}

async function read(relative) {
  return fs.readFile(path.join(root, relative), 'utf8');
}

const config = await read('backend/lib/config.lua');
const mappings = await read('backend/lib/mappings.lua');
const achievementSettings = await read('backend/lib/achievement_settings.lua');
const backendMain = await read('backend/main.lua');
const registry = await read('backend/lib/shortcut_registry.lua');
const detection = await read('backend/lib/shortcut_detection.lua');
const steamworks = await read('backend/lib/steamworks_sync.lua');
const farmer = await read('backend/lib/steam_card_farmer.lua');
const artworkProperties = await read('frontend/features/shortcuts/artwork-properties.ts');
const frontendMappings = await read('frontend/core/mappings.ts');
const playtime = await read('backend/lib/playtime.lua');

const releasePreparation = await read('scripts/prepare-release.mjs');
if (releasePreparation.includes("|| process.env.GITHUB_REF_NAME || ''")
    || !releasePreparation.includes("process.env.GITHUB_REF_TYPE === 'tag'")) {
  failures.push('scripts/prepare-release.mjs: branch names such as main must never be interpreted as release tags');
}

if (!config.includes('function M.state_path(filename)') || !config.includes('APPDATA')) {
  failures.push('backend/lib/config.lua: runtime state must resolve to a per-user writable data directory');
}
if (/Migrated legacy runtime state|M\.path\(name\)/.test(config)) {
  failures.push('backend/lib/config.lua: plugin-directory state must not be auto-migrated because historical archives contained developer-local data');
}
if (/LEGACY_SESSIONS_FILE|config\.path\("(?:playtime_sessions|sessions)\.json"\)/.test(playtime)) {
  failures.push('backend/lib/playtime.lua: plugin-directory playtime history must never be imported into another user profile');
}
if (!playtime.includes('local function prune_foreign_sessions()')
    || !playtime.includes('deps.shortcut_registry')
    || !playtime.includes('Discarded ')
    || !playtime.includes('active Steam shortcut registry')) {
  failures.push('backend/lib/playtime.lua: persisted playtime must be pruned against the active Steam shortcut registry');
}
if (!mappings.includes('config.state_path("mappings.backup.json")')) {
  failures.push('backend/lib/mappings.lua: mapping backup is not persisted outside the plugin directory');
}
if (!achievementSettings.includes('config.state_path(filename)')) {
  failures.push('backend/lib/achievement_settings.lua: generic achievement state helpers must use state_path()');
}
if (/C:\\Users\\/.test(achievementSettings)) {
  failures.push('backend/lib/achievement_settings.lua: fixed Windows profile fallback detected');
}
for (const name of ['achievement_paths.json', 'achievement_options.json', 'achievement_base_path.txt']) {
  if (achievementSettings.includes(`config.path("${name}")`)) {
    failures.push(`backend/lib/achievement_settings.lua: ${name} still writes inside the plugin directory`);
  }
}
if (!backendMain.includes('function get_shortcut_details(shortcut_app_id, title)')) {
  failures.push('backend/main.lua: shortcut title must be forwarded to the VDF fallback detector');
}
if (!backendMain.includes('function list_shortcuts()') || !registry.includes('shortcuts.vdf')) {
  failures.push('backend shortcut registry fallback is missing');
}
if (!registry.includes('loginusers.vdf') || !detection.includes('preferred_account_id')) {
  failures.push('shortcut lookup must prioritize the active Steam account');
}
for (const [name, source] of [['backend/lib/steamworks_sync.lua', steamworks], ['backend/lib/steam_card_farmer.lua', farmer]]) {
  if (/Program Files \(x86\).*NativeGameLinkForSteam/i.test(source)) {
    failures.push(`${name}: hard-coded Steam/plugin installation path detected`);
  }
  if (!source.includes('config.backend_dir')) {
    failures.push(`${name}: helper path must be derived from Millennium's actual plugin directory`);
  }
}
if (!artworkProperties.includes('event.stopPropagation()') || !artworkProperties.includes('fileInput.click()') || artworkProperties.includes('OpenFileDialog')) {
  failures.push('artwork picker must isolate its own row events and use a CEF file input without SteamClient native file-dialog IPC');
}

if (!frontendMappings.includes('filterMappingsForLocalShortcuts')
    || !frontendMappings.includes('listShortcutsBackend')
    || !frontendMappings.includes('stale cached mapping(s)')) {
  failures.push('frontend/core/mappings.ts: stale/foreign packaged mapping snapshots must be filtered against the active shortcut registry');
}

const runtimeTree = ['backend', 'frontend'];
for (const directory of runtimeTree) {
  const stack = [path.join(root, directory)];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(?:lua|ts|tsx|js|json)$/i.test(entry.name)) {
        const source = await fs.readFile(full, 'utf8');
        if (/E:\\Logros/i.test(source)) failures.push(`${path.relative(root, full)}: developer-local path leaked into runtime source`);
      }
    }
  }
}

if (failures.length) {
  console.error('Clean-install regression check failed:\n' + failures.map(item => ` - ${item}`).join('\n'));
  process.exit(1);
}
console.log('Clean-install regression check passed (portable paths, empty distribution state, shortcut/artwork fallbacks present).');
