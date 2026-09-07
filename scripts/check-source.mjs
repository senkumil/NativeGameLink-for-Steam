import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const frontendRoot = path.join(root, 'frontend');
const backendRoot = path.join(root, 'backend');
const failures = [];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function fail(file, message) {
  failures.push(`${rel(file)}: ${message}`);
}

function parseRelativeImports(source) {
  const result = [];
  const pattern = /(?:from\s+|import\s*)['"]([^'"]+)['"]/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match[1].startsWith('.')) result.push(match[1]);
  }
  return result;
}

async function resolveImport(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of [
    `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return path.normalize(candidate);
    } catch {}
  }
  return null;
}

function frontendLayer(file) {
  const relative = rel(file);
  if (relative.startsWith('frontend/runtime/')) return 'runtime';
  if (relative.startsWith('frontend/settings/')) return 'settings';
  if (relative.startsWith('frontend/features/')) return 'features';
  if (relative.startsWith('frontend/steam/')) return 'steam';
  if (relative.startsWith('frontend/core/')) return 'core';
  if (relative.startsWith('frontend/api/')) return 'api';
  if (relative.startsWith('frontend/domain/')) return 'domain';
  if (relative === 'frontend/index.tsx' || relative === 'frontend/index.ts') return 'entry';
  return 'other';
}

const sourceFiles = (await walk(frontendRoot)).filter(file => /\.tsx?$/.test(file)).map(path.normalize);
const sourceSet = new Set(sourceFiles);
const importGraph = new Map(sourceFiles.map(file => [file, []]));

for (const file of sourceFiles) {
  const source = await fs.readFile(file, 'utf8');
  const relative = rel(file);

  if (/<[^>\n]*\bon(?:click|error|load|mouseenter|mouseleave|mouseover|mouseout)\s*=/i.test(source)) {
    fail(file, 'inline DOM event handler detected; use delegated listeners or addEventListener');
  }
  if (/\.millennium\/Dist|\.millennium\\Dist/i.test(source)) {
    fail(file, 'source must not import or depend on generated .millennium/Dist output');
  }
  if (/\bcallable\s*(?:<|\()/m.test(source) && relative !== 'frontend/api/backend.ts') {
    fail(file, 'Millennium callable(...) handles belong only in frontend/api/backend.ts');
  }
  if (/\bsenkumil\b/i.test(source)) {
    fail(file, 'developer/test username leaked into production source');
  }
  if (relative === 'frontend/features/library/runtime.ts'
      && /\b(?:spoofArtwork|applyOfficialShortcutIcon|SetCustomArtworkForApp|SetShortcutIcon)\b/.test(source)) {
    fail(file, 'library navigation runtime must be read-only for artwork/icon state; visual writes belong only to explicit link/unlink workflows');
  }

  const lineCount = source.split(/\r?\n/).length;
  if (/frontend\/features\/[^/]+\/runtime\.tsx?$/.test(relative) && lineCount > 500) {
    fail(file, `feature runtime is ${lineCount} lines; keep orchestration runtimes at or below 500 lines`);
  }
  if (relative === 'frontend/runtime/app.tsx' && lineCount > 500) {
    fail(file, `application composition root is ${lineCount} lines; keep it at or below 500 lines`);
  }
  if (lineCount > 900) {
    fail(file, `module is ${lineCount} lines; split modules larger than 900 lines`);
  }

  for (const specifier of parseRelativeImports(source)) {
    const target = await resolveImport(file, specifier);
    if (!target || !sourceSet.has(target)) continue;
    importGraph.get(file).push(target);

    const sourceLayer = frontendLayer(file);
    const targetLayer = frontendLayer(target);
    if (sourceLayer !== 'runtime' && sourceLayer !== 'entry' && targetLayer === 'runtime') {
      fail(file, `dependency inversion: ${sourceLayer} code must not import runtime composition (${rel(target)})`);
    }
    if (sourceLayer === 'domain' && targetLayer !== 'domain') {
      fail(file, `domain contracts must not depend on ${targetLayer} (${rel(target)})`);
    }
    if (sourceLayer === 'steam' && targetLayer === 'features') {
      fail(file, `Steam anti-corruption layer must not depend on feature UI (${rel(target)})`);
    }
    if ((sourceLayer === 'core' || sourceLayer === 'api') && targetLayer === 'features') {
      fail(file, `${sourceLayer} infrastructure must not depend on feature UI (${rel(target)})`);
    }
  }
}

// Cycles make Steam-private adapters and feature surfaces difficult to replace
// independently. Keep the frontend graph acyclic so refactors stay local.
const visitState = new Map();
const stack = [];
const reportedCycles = new Set();
function visit(file) {
  visitState.set(file, 1);
  stack.push(file);
  for (const target of importGraph.get(file) || []) {
    if (visitState.get(target) === 1) {
      const start = stack.indexOf(target);
      const cycle = [...stack.slice(start), target].map(rel);
      const key = cycle.join(' -> ');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        failures.push(`frontend import cycle: ${key}`);
      }
      continue;
    }
    if (!visitState.has(target)) visit(target);
  }
  stack.pop();
  visitState.set(file, 2);
}
for (const file of sourceFiles) if (!visitState.has(file)) visit(file);

const backendMain = path.join(root, 'backend', 'main.lua');
try {
  const lineCount = (await fs.readFile(backendMain, 'utf8')).split(/\r?\n/).length;
  if (lineCount > 250) fail(backendMain, `IPC facade is ${lineCount} lines; backend/main.lua should remain a thin facade`);
} catch (error) {
  failures.push(`backend/main.lua: unable to read (${String(error)})`);
}

// Every backend module follows the same maintenance ceiling as frontend code.
// This prevents a new monolith from bypassing the architecture check merely
// because it is unrelated to achievements.
const backendLuaFiles = (await walk(backendRoot)).filter(file => /\.lua$/.test(file));
for (const file of backendLuaFiles) {
  const source = await fs.readFile(file, 'utf8');
  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > 900) fail(file, `module is ${lineCount} lines; split modules larger than 900 lines`);
}

const achievementService = path.join(frontendRoot, 'features', 'achievements', 'service.ts');
const achievementBackend = path.join(backendRoot, 'lib', 'achievements.lua');
const achievementSettings = path.join(backendRoot, 'lib', 'achievement_settings.lua');
const achievementSources = path.join(backendRoot, 'lib', 'achievement_sources.lua');
const achievementProperties = path.join(frontendRoot, 'features', 'shortcuts', 'achievement-properties.ts');
const shortcutPropertiesFile = path.join(frontendRoot, 'features', 'shortcuts', 'properties.ts');
const shortcutArtworkPropertiesFile = path.join(frontendRoot, 'features', 'shortcuts', 'artwork-properties.ts');
const customizationArtworkFile = path.join(frontendRoot, 'features', 'shortcuts', 'customization-artwork.ts');
const nativeAddGuardFile = path.join(frontendRoot, 'features', 'shortcuts', 'native-add-guard.ts');
const achievementNotifications = path.join(frontendRoot, 'features', 'achievements', 'notifications.ts');
const achievementLaunchWatcher = path.join(frontendRoot, 'features', 'achievements', 'launch-watcher.ts');
const achievementLifecycle = path.join(frontendRoot, 'features', 'achievements', 'lifecycle.ts');
const achievementSidebar = path.join(frontendRoot, 'features', 'achievements', 'sidebar.ts');
const achievementCache = path.join(frontendRoot, 'features', 'achievements', 'cache.ts');
const globalSettingsContent = path.join(frontendRoot, 'settings', 'SettingsContent.tsx');
const autoPromptPolicy = path.join(frontendRoot, 'features', 'shortcuts', 'auto-prompt-policy.ts');
const newsBackend = path.join(backendRoot, 'lib', 'news.lua');
const newsFrontend = path.join(frontendRoot, 'features', 'library', 'news.ts');
const steamGameDataNormalizer = path.join(frontendRoot, 'core', 'steam-game-data.ts');
const gameDataCore = path.join(frontendRoot, 'core', 'game-data.ts');
const shortcutLinking = path.join(frontendRoot, 'features', 'shortcuts', 'linking.ts');
const nativeDom = path.join(frontendRoot, 'steam', 'native-dom.ts');
const infoPanel = path.join(frontendRoot, 'features', 'library', 'info-panel.ts');
const libraryArtwork = path.join(frontendRoot, 'features', 'library', 'artwork.ts');
const bigPictureRuntime = path.join(frontendRoot, 'features', 'big-picture', 'runtime.ts');
const bigPictureDetails = path.join(frontendRoot, 'features', 'big-picture', 'details.ts');
const bigPictureNativeDetails = path.join(frontendRoot, 'features', 'big-picture', 'NativeBigPictureDetails.tsx');
const bigPicturePanelMount = path.join(frontendRoot, 'features', 'big-picture', 'panel-mount.ts');
const playtimeService = path.join(frontendRoot, 'features', 'playtime', 'service.ts');
const desktopLibraryPlaytime = path.join(frontendRoot, 'features', 'playtime', 'library-home.ts');
const desktopLibraryPlaytimeDom = path.join(frontendRoot, 'features', 'playtime', 'library-home-dom.ts');
const frontendRuntimeApp = path.join(frontendRoot, 'runtime', 'app.tsx');
const playtimeBackend = path.join(backendRoot, 'lib', 'playtime.lua');
const playtimeTracker = path.join(frontendRoot, 'features', 'playtime', 'tracker.ts');
const linkedLoadingStage = path.join(frontendRoot, 'features', 'library', 'loading-stage.ts');
const shortcutNotice = path.join(frontendRoot, 'features', 'library', 'notice.ts');
const communityStylesFile = path.join(frontendRoot, 'features', 'library', 'styles', 'community.ts');
const communityStylesSource = await fs.readFile(communityStylesFile, 'utf8');
const communityViewFile = path.join(frontendRoot, 'features', 'library', 'community-view.ts');
const communityViewSource = await fs.readFile(communityViewFile, 'utf8');
const rendererFile = path.join(frontendRoot, 'features', 'library', 'renderer.ts');
const rendererSource = await fs.readFile(rendererFile, 'utf8');
const activityStylesFile = path.join(frontendRoot, 'features', 'library', 'styles', 'activity.ts');
const activityStylesSource = await fs.readFile(activityStylesFile, 'utf8');
const historicalSidebarFile = path.join(frontendRoot, 'features', 'library', 'historical-sidebar.ts');
const historicalSidebarSource = await fs.readFile(historicalSidebarFile, 'utf8');
const legacyGamesFile = path.join(frontendRoot, 'features', 'library', 'legacy-games.ts');
const legacyGamesSource = await fs.readFile(legacyGamesFile, 'utf8');
const nativeGameModelFile = path.join(frontendRoot, 'features', 'library', 'native-game-model.ts');
const nativeGameModelSource = await fs.readFile(nativeGameModelFile, 'utf8');
const cloudStatusFile = path.join(frontendRoot, 'features', 'library', 'cloud-status.ts');
const cloudStatusSource = await fs.readFile(cloudStatusFile, 'utf8');
const achievementPlaybarFile = path.join(frontendRoot, 'features', 'achievements', 'playbar.ts');
const achievementPlaybarSource = await fs.readFile(achievementPlaybarFile, 'utf8');
const achievementChromeFile = path.join(frontendRoot, 'features', 'library', 'achievement-chrome.ts');
const achievementChromeSource = await fs.readFile(achievementChromeFile, 'utf8');
const artworkBackendFile = path.join(backendRoot, 'lib', 'artwork.lua');
const artworkBackendSource = await fs.readFile(artworkBackendFile, 'utf8');
const libraryArtworkRegressionSource = await fs.readFile(libraryArtwork, 'utf8');
const legacyInfoPortraitFile = path.join(frontendRoot, 'features', 'library', 'legacy-info-portrait.ts');
const legacyInfoPortraitSource = await fs.readFile(legacyInfoPortraitFile, 'utf8');
const steamGameDataNormalizerSource = await fs.readFile(steamGameDataNormalizer, 'utf8');
const gameDataCoreSource = await fs.readFile(gameDataCore, 'utf8');
if (!steamGameDataNormalizerSource.includes('export function normalizeSteamGameData(value: unknown)')
	|| !steamGameDataNormalizerSource.includes('export function steamStringList(value: unknown)')
	|| !steamGameDataNormalizerSource.includes('developers: steamStringList(value.developers)')
	|| !steamGameDataNormalizerSource.includes('categories: normalizeCategories(value.categories)')
	|| !steamGameDataNormalizerSource.includes('screenshots: normalizeScreenshots(value.screenshots)')
	|| !gameDataCoreSource.includes('normalizeSteamGameData(stored.data)')
	|| !gameDataCoreSource.includes('normalizeSteamGameData(parsed)')
	|| !gameDataCoreSource.includes('getSourceGameData(steamAppId, language)')
	|| !gameDataCoreSource.includes('transientLocalizedGameData.add(data)')
	|| !gameDataCoreSource.includes('!transientLocalizedGameData.has(value)')) {
	fail(steamGameDataNormalizer,
		'historical metadata must be normalized and partial localization fallbacks must stay retryable');
}

// Hot resource updates are a cross-layer contract: invalidation must suppress
// late completions, target one AppID, bypass the backend snapshot when forced,
// and coalesce mapping bursts before repainting Steam.
try {
	const [requestCacheSource, cacheSource, mappingsSource, libraryAssetsSource,
		mappingRefreshSource, playtimeServiceSource, artworkCandidatesSource,
		achievementCacheSource, achievementServiceSource, artworkIconSource,
		resourceCacheSource, communityItemsSource, communityBackendSource,
		artworkCommunitySource, activityFeedSource, shortcutDetectionSource,
		shortcutDetectionBackendSource, achievementBackendCacheSource,
		achievementGameInfoSource] = await Promise.all([
		fs.readFile(path.join(frontendRoot, 'core', 'request-cache.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'core', 'cache.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'core', 'mappings.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'library-assets.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'runtime', 'mapping-refresh.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'playtime', 'service.ts'), 'utf8'),
		fs.readFile(path.join(backendRoot, 'lib', 'artwork_candidates.lua'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'achievements', 'cache.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'achievements', 'service.ts'), 'utf8'),
		fs.readFile(path.join(backendRoot, 'lib', 'artwork_icon.lua'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'resource-cache.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'community-items.ts'), 'utf8'),
		fs.readFile(path.join(backendRoot, 'lib', 'community.lua'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'artwork-community.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'social', 'feed.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'shortcuts', 'detection.ts'), 'utf8'),
		fs.readFile(path.join(backendRoot, 'lib', 'shortcut_detection.lua'), 'utf8'),
		fs.readFile(path.join(backendRoot, 'lib', 'achievements.lua'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'achievements', 'game-info.ts'), 'utf8'),
	]);
	if (!requestCacheSource.includes('private readonly keyEpochs')
		|| !requestCacheSource.includes('invalidateMatching(predicate:')
		|| !requestCacheSource.includes('if (!isCurrent()) return null;')) {
		fail(path.join(frontendRoot, 'core', 'request-cache.ts'),
			'invalidation must be per key and make obsolete promise results invisible to their original callers');
	}
	if (!cacheSource.includes("key.startsWith('gamedata_v')")
		|| !cacheSource.includes('/^events\\d+_/.test(key)')
		|| !cacheSource.includes('scheduleCachePrune()')
		|| !cacheSource.includes('export function cacheDeleteMatching(')) {
		fail(path.join(frontendRoot, 'core', 'cache.ts'),
			'current metadata/news cache versions must retain priority and prune outside synchronous rendering');
	}
	if (!mappingsSource.includes('enqueueMappingOperation(')
		|| !mappingsSource.includes('updateMappingsCheckedUnlocked(')
		|| !mappingRefreshSource.includes('setTimeout(() =>')
		|| !mappingRefreshSource.includes('invalidateLinkedGameResourceCaches(stale, shortcuts)')) {
		fail(path.join(frontendRoot, 'core', 'mappings.ts'),
			'mapping writes must serialize full snapshots and bulk changes must coalesce targeted hot refreshes');
	}
	if (!libraryAssetsSource.includes('force_refresh: forceBackendRefresh')
		|| !libraryAssetsSource.includes('usableLibraryAssetSnapshot(')
		|| !libraryAssetsSource.includes('if (!result) return null;')
		|| !libraryAssetsSource.includes('then(value => value ?? persisted?.data ?? null)')
		|| !artworkBackendSource.includes('LIBRARY_ASSETS_CACHE_SECONDS')
		|| !artworkBackendSource.includes('not force_refresh')
		|| !artworkBackendSource.includes('return nil, "transient"')
		|| !artworkBackendSource.includes('transient_error = transient_error')
		|| !artworkCommunitySource.includes('value.transient_error !== true')
		|| !artworkCandidatesSource.includes('retired_checked_at')
		|| artworkCandidatesSource.includes('retired_checked[appid] = true')) {
		fail(path.join(frontendRoot, 'features', 'library', 'library-assets.ts'),
			'forced artwork refresh must bypass bounded caches and provider failures must remain retryable');
	}
	if (!communityBackendSource.includes('result.transient_error =')
		|| !communityBackendSource.includes('COMMUNITY_ITEMS_FAILURE_CACHE_SECONDS = 10')
		|| !communityItemsSource.includes('value.transient_error !== true')
		|| !communityItemsSource.includes('if (!backendTransient) cacheSet(')) {
		fail(path.join(frontendRoot, 'features', 'library', 'community-items.ts'),
			'partial community-item responses must remain visible but retryable instead of becoming fresh empty snapshots');
	}
	if (!resourceCacheSource.includes('invalidateActivityFeedCaches(ids)')
		|| !resourceCacheSource.includes('invalidateLocalAchievementGameInfoCache(ids)')
		|| !activityFeedSource.includes('export function invalidateActivityFeedCaches(')) {
		fail(path.join(frontendRoot, 'features', 'library', 'resource-cache.ts'),
			'AppID changes must invalidate route-local news and achievement-header snapshots too');
	}
	if (!shortcutDetectionSource.includes('value.transient_error !== true')
		|| !shortcutDetectionSource.includes('result.transient_error && result.candidates.length === 0 ? null')
		|| !shortcutDetectionBackendSource.includes('cached.confirmed == true')
		|| !shortcutDetectionBackendSource.includes('transient_error = not store_search_confirmed')) {
		fail(path.join(frontendRoot, 'features', 'shortcuts', 'detection.ts'),
			'transient Store-search failures must remain retryable instead of caching an empty match list');
	}
	if (!achievementBackendCacheSource.includes('next(cached.by_name or {})')
		|| !achievementBackendCacheSource.includes('if next(result) then')
		|| !achievementGameInfoSource.includes('if (!data) return info;')) {
		fail(path.join(frontendRoot, 'features', 'achievements', 'game-info.ts'),
			'achievement metadata transport failures must not become long-lived empty snapshots');
	}
	if (!playtimeServiceSource.includes('playtimeRequestGeneration += 1')
		|| !playtimeServiceSource.includes('generation === playtimeRequestGeneration')
		|| !playtimeServiceSource.includes('playtimeStatsRequests.get(key) === entry')
		|| !playtimeServiceSource.includes('export function invalidatePlaytimeStatsCache(')) {
		fail(path.join(frontendRoot, 'features', 'playtime', 'service.ts'),
			'playtime invalidation must be targeted and suppress results from obsolete AppID generations');
	}
	if (!achievementCacheSource.includes('export function getCachedLocalAchievementsForGame(')
		|| !achievementCacheSource.includes("String(data.metadata_appid || data.appid || '') === expectedAppId")
		|| !achievementServiceSource.includes('export function invalidateLocalAchievementRequests(')
		|| !achievementServiceSource.includes('requestCache.get(requestJson) !== entry')) {
		fail(path.join(frontendRoot, 'features', 'achievements', 'cache.ts'),
			'achievement snapshots and requests must remain owned by the exact linked Steam AppID');
	}
	if (!artworkIconSource.includes('function M.begin(shortcut_app_id)')
		|| !artworkIconSource.includes('function M.is_current(shortcut_app_id, epoch)')
		|| !artworkIconSource.includes('function M.invalidate(shortcut_app_id)')
		|| !artworkBackendSource.includes('icon_files.is_current(shortcut_app_id, icon_epoch)')) {
		fail(path.join(backendRoot, 'lib', 'artwork_icon.lua'),
			'late icon downloads must not recreate artwork after a clear, relink or AppID change');
	}
} catch (error) {
	fail(path.join(frontendRoot, 'core', 'request-cache.ts'), `hot-resource regression checks could not read their sources (${String(error)})`);
}
if (historicalSidebarSource.includes('developers?.join(')
	|| nativeGameModelSource.includes('(data.developers || []).join(')) {
	fail(historicalSidebarFile,
		'legacy metadata renderers must tolerate text and numeric-keyed object fields instead of assuming JSON arrays');
}
if (!communityStylesSource.includes('repeat(auto-fit,minmax(min(230px,100%),1fr))')
	|| !communityStylesSource.includes('#gdl-community-inner { width:100%;min-width:0;max-width:100%;overflow:hidden')) {
	fail(communityStylesFile, 'community cards must adapt to their actual column width and remain clipped inside the main-content container');
}
if (communityStylesSource.includes('#gdl-community-content { margin-top:34px;overflow:visible;contain:inline-size;')
	|| communityStylesSource.includes('#gdl-community-content,#gdl-community-content>*')) {
	fail(communityStylesFile, 'the outer community section must retain Steam\'s native column geometry instead of forcing a full-row width');
}
if (communityViewSource.includes('buildNativeSidebarSection')
	|| !communityViewSource.includes('activityWrapper.parentElement.insertBefore(node, activityWrapper.nextSibling)')) {
	fail(communityViewFile, 'Community Content must use its own main-column section immediately after Activity, never a cloned sidebar shell');
}
if (!communityViewSource.includes('setupCommunityAdaptiveWidth(doc, node, activityWrapper, _layout)')
	|| !communityViewSource.includes('activityRect.bottom + 34 >= sidebarRect.bottom - 1')
	|| !communityViewSource.includes("root.classList.toggle('gdl-community-wide', canUseFreedSidebarArea)")
	|| !communityStylesSource.includes('#gdl-community-content.gdl-community-wide')) {
	fail(communityViewFile, 'Community must expand into the freed sidebar area only after Activity has passed the live sidebar bottom edge');
}
if (!rendererSource.includes("mainContentStack.id = 'gdl-main-content-stack'")
	|| !rendererSource.includes('mainContentStack.appendChild(activity)')
	|| !rendererSource.includes('insertMainContent(mainContentStack, layout')
	|| rendererSource.includes('width:100% !important;min-width:0 !important;max-width:100%')) {
	fail(rendererFile, 'Activity and Community must share one atomic main-column stack so Steam cannot place Community after the sidebar row');
}
if (!activityStylesSource.includes('#gdl-main-content-stack { width:calc(67% - 32px) !important; }')
	|| !activityStylesSource.includes('div.NarrowWindow #gdl-main-content-stack { width:calc(67% - 22px) !important; }')
	|| !activityStylesSource.includes('div.UltraNarrowRightPanel #gdl-main-content-stack { width:100% !important; }')) {
	fail(activityStylesFile, 'the injected main stack must mirror Steam desktop\'s floated 67/33 responsive column geometry');
}
if (historicalSidebarSource.includes('gdl-historical-status')
	|| historicalSidebarSource.includes('gdl-historical-steam-achievements')
	|| historicalSidebarSource.includes('gdl-historical-community-section')
	|| historicalSidebarSource.includes("gdlText('retired_from_store'")
	|| historicalSidebarSource.includes("gdlText('no_steam_achievements'")
	|| historicalSidebarSource.includes("gdlText('historical_information'")
	|| historicalSidebarSource.includes("gdlText('external_achievements_reference'")) {
	fail(historicalSidebarFile, 'legacy sidebars must stay neutral and concise: no retired/no-achievements notices or duplicate Featured Community section');
}
if (!legacyGamesSource.includes("'221430'")
	|| !legacyGamesSource.includes("kind: 'single-player'")
	|| !nativeGameModelSource.includes('legacyGameRecord(steamAppId, data)')
	|| !nativeGameModelSource.includes('modern?.category_ids')
	|| !nativeGameModelSource.includes("gdlText('legacy_description_developer'")) {
	fail(nativeGameModelFile, 'legacy game information must merge AppID-curated facts with generic appinfo metadata and a factual description fallback');
}
if (!artworkBackendSource.includes('library_metadata_algorithm = 1')
	|| !artworkBackendSource.includes('developers = developers')
	|| !artworkBackendSource.includes('publishers = publishers')
	|| !artworkBackendSource.includes('category_ids = category_ids')
	|| !artworkBackendSource.includes('release_date = release_date')) {
	fail(artworkBackendFile, 'Steam appinfo artwork lookup must also expose historical developer, publisher, release and feature metadata');
}
if (!rendererSource.includes('legacyInfoPortraitSync(context.shortcutAppId, steamAppId)')
	|| !rendererSource.includes('resolveLegacyInfoPortrait(context.shortcutAppId, steamAppId')
	|| !rendererSource.includes('const isLegacy = isLegacyGame(steamAppId, data)')
	|| !rendererSource.includes('const linkedPortrait = context.shortcutAppId')
	|| !rendererSource.includes('linkedShortcutPortrait(context.shortcutAppId, steamAppId, initialAssets?.portrait || \'\')')
	|| !rendererSource.includes('const initialModelAssets = {')
	|| !rendererSource.includes('const resolvedAssets = isLegacy ?')
	|| !legacyInfoPortraitSource.includes('LEGACY_INFO_PORTRAIT_CACHE_PREFIX')
	|| !legacyInfoPortraitSource.includes("linkedShortcutPortrait(shortcutAppId, steamAppId, '')")
	|| !legacyInfoPortraitSource.includes('cachePortrait(shortcutAppId, steamAppId, community.portrait)')
	|| !libraryArtworkRegressionSource.includes('preferredCommunity?.provenance?.[sourceName]')) {
	fail(rendererFile, 'legacy information panels must paint only validated cached/selected portraits and never flash an obsolete official capsule');
}
try {
	const [service, backend, settings, sources, properties, notifications, launchWatcher, lifecycle, sidebar, achievementCacheSource, globalSettings, promptPolicy, backendNews, frontendNews, linking, nativeDomSource, infoPanelSource, libraryArtworkSource, bigPictureSource, playtimeServiceSource, desktopLibraryPlaytimeSource, desktopLibraryPlaytimeDomSource, runtimeAppSource, playtimeBackendSource, playtimeTrackerSource, loadingStageSource, shortcutNoticeSource, shortcutPropertiesSource] = await Promise.all([
    fs.readFile(achievementService, 'utf8'),
    fs.readFile(achievementBackend, 'utf8'),
    fs.readFile(achievementSettings, 'utf8'),
    fs.readFile(achievementSources, 'utf8'),
    fs.readFile(achievementProperties, 'utf8'),
    fs.readFile(achievementNotifications, 'utf8'),
    fs.readFile(achievementLaunchWatcher, 'utf8'),
    fs.readFile(achievementLifecycle, 'utf8'),
    fs.readFile(achievementSidebar, 'utf8'),
    fs.readFile(achievementCache, 'utf8'),
    fs.readFile(globalSettingsContent, 'utf8'),
    fs.readFile(autoPromptPolicy, 'utf8'),
    fs.readFile(newsBackend, 'utf8'),
    fs.readFile(newsFrontend, 'utf8'),
		fs.readFile(shortcutLinking, 'utf8'),
		fs.readFile(nativeDom, 'utf8'),
		fs.readFile(infoPanel, 'utf8'),
		fs.readFile(libraryArtwork, 'utf8'),
		fs.readFile(bigPictureRuntime, 'utf8'),
		fs.readFile(playtimeService, 'utf8'),
		fs.readFile(desktopLibraryPlaytime, 'utf8'),
		fs.readFile(desktopLibraryPlaytimeDom, 'utf8'),
		fs.readFile(frontendRuntimeApp, 'utf8'),
		fs.readFile(playtimeBackend, 'utf8'),
		fs.readFile(playtimeTracker, 'utf8'),
		fs.readFile(linkedLoadingStage, 'utf8'),
		fs.readFile(shortcutNotice, 'utf8'),
		fs.readFile(shortcutPropertiesFile, 'utf8'),
	]);
  if (/syntheticAchievementItems|steam-schema/i.test(service)) {
    fail(achievementService, 'achievement requests must keep the stable backend metadata/icon route; frontend synthetic schema fallbacks are forbidden');
  }
  if (!backend.includes('icon = item.icon') || !backend.includes('icon_gray = item.icon_gray')) {
    fail(achievementBackend, 'simulated progress must preserve the real metadata icon fields');
  }
  if (!backend.includes('policy.is_online')) {
    fail(achievementBackend, 'online-only achievement policy is not applied');
  }
  if ((backend.match(/if not allow_simulated then/g) || []).length < 2) {
    fail(achievementBackend, 'simulated progress must ignore both explicit and automatic JSON state sources without deleting them');
  }
  if (!settings.includes('add("shortcut:"') || !settings.includes('add("appid:"')) {
    fail(achievementSettings, 'per-game achievement settings must be keyed by both shortcut ID and official Steam AppID');
  }
  if (/record\s+and\s+record\.(?:simulate|unlock_all)\s+or/.test(settings)) {
    fail(achievementSettings, 'explicit false per-game settings must not fall through to true global defaults');
  }
	if (!settings.includes('resolved.unlock_online = record.unlock_online == true')
		|| settings.includes('defaults.unlock_online == true or record.unlock_online == true')) {
		fail(achievementSettings, 'the global online-achievement switch must be an inheritable default that an explicit per-game false can override');
  }
  if (!settings.includes('write_json_atomic') || !settings.includes('write_text_atomic')) {
    fail(achievementSettings, 'achievement settings must use atomic persistence helpers');
  }
  if (!backend.includes('sources.find_matching_root_candidates')
      || !sources.includes('exact_progress_schema')
      || !sources.includes('fs.last_write_time(path)')
      || !sources.includes('historical_schema_match:')) {
    fail(achievementSources, 'historical Shortcut AppID progress must require an exact schema match and select by JSON modification time');
  }
  if (/io\.open\([^\n]+,[^\n]+["'](?:w|a)|fs\.(?:rename|remove)|os\.remove/.test(sources)) {
    fail(achievementSources, 'historical achievement source discovery must remain read-only');
  }
  if (!/type="range"/.test(properties) || !/min="0"/.test(properties)) {
    fail(achievementProperties, 'per-game achievement simulation must expose accessible range sliders');
  }
  if (!service.includes('requestGeneration += 1')
	  || !service.includes('generation !== requestGeneration')
      || !lifecycle.includes('Targeted achievement refresh error')
		|| !lifecycle.includes('ACHIEVEMENT_REFRESH_STORAGE_KEY')
		|| !lifecycle.includes("window.addEventListener('storage'")
      || !properties.includes('refreshCurrentGame()')) {
    fail(achievementService, 'achievement policy changes must suppress stale responses and hot-refresh the edited game across Steam CEF windows');
  }
  if (!/role="switch"/.test(globalSettings) || !globalSettings.includes('current.current.onChange(next)')
      || !globalSettings.includes("addEventListener('pointerdown'")
      || !globalSettings.includes("addEventListener('keydown'")) {
    fail(globalSettingsContent, 'global settings toggles must use a controlled accessible switch independent of Steam Toggle internals');
  }
  if (!globalSettings.includes("paddingBottom: '64px'")) {
    fail(globalSettingsContent, 'the final global settings controls must remain above Steam window resize hit-testing');
  }
  if (globalSettings.includes('preferences.simulateUnlockAll')) {
    fail(globalSettingsContent, 'full simulated completion must remain a per-game option and must not be exposed globally');
  }
	if (!backend.includes('get_game_achievement_capabilities') || !backend.includes('has_online = online_count > 0')
		|| !properties.includes("onlineRow.style.display = hasOnlineAchievements ? 'flex' : 'none'")
		|| !properties.includes('if (hasOnlineAchievements)')) {
		fail(achievementProperties, 'the per-game online-only toggle must remain interactive for capable games even while the global default is enabled');
  }
  if (!notifications.includes('FIRST_LAUNCH_REPLAY_PREFIX') || !notifications.includes('enqueueFirstLaunchAchievementToasts')) {
    fail(achievementNotifications, 'first-launch achievement replay must have its own persistent marker, independent from navigation baselines');
  }
  if (!notifications.includes('STEAM_ACHIEVEMENT_TOAST_DURATION_MS = 5000')
			|| !notifications.includes('STEAM_ACHIEVEMENT_TOAST_GAP_MS = 5000')) {
		fail(achievementNotifications, 'achievement notifications must use the requested five-second duration and cadence');
	}
	if (!notifications.includes('applyNativeAchievementToastPresentation(')
			|| !notifications.includes('NATIVE_ACHIEVEMENT_TOAST_CARD_CLASS')
			|| !notifications.includes('comparableImageUrl(source, doc) === expectedImage')) {
		fail(achievementNotifications, 'native achievement notifications must be enlarged by matching their real icon, without affecting other Steam toast types');
	}
  if (!notifications.includes('localAchievementToastProcessing')
      || !notifications.includes('await showAchievementToast(next.appid, next.achievement')) {
    fail(achievementNotifications, 'achievement notifications must drain serially and wait for asynchronous toast preparation to prevent bursts');
  }
  if (!notifications.includes('cancelQueuedAchievementToastsForShortcut')
      || !notifications.includes("cancelAllQueuedAchievementToasts('game overlay closed')")
      || !launchWatcher.includes('cancelQueuedAchievementToastsForShortcut(shortcutAppId)')) {
    fail(achievementNotifications, 'closing a game must cancel its queued, pending and visible replay notifications');
  }
  if (!notifications.includes('data.unlock_online === true && achievement.is_online === true')
      || !backend.includes('missing_online_names')) {
    fail(achievementNotifications, 'launch replay must include enabled online achievements even when an older progress file omitted their state entries');
  }
  if (!notifications.includes('ACHIEVEMENT_REPLAY_PREFERENCES_EVENT')
      || !notifications.includes('setNextLaunchAchievementReplayEnabled(')) {
    fail(achievementNotifications, 'first-launch achievement replay must manage replay enabled state');
  }
  if (!properties.includes('gdl-game-achievement-count-slider')) {
    fail(achievementProperties, 'per-game achievement properties must provide simulation count slider');
  }
  if (!launchWatcher.includes('SteamUIStore?.RunningApps') || !launchWatcher.includes('SHORTCUT_THRESHOLD')
      || !launchWatcher.includes('enqueueFirstLaunchAchievementToasts')) {
    fail(achievementLaunchWatcher, 'first-launch replay must be gated by a genuinely running non-Steam shortcut');
  }
  if (!launchWatcher.includes('latestNativeAchievementToastWindowRegistration(')
      || !launchWatcher.includes('FALLBACK_GAME_READY_DELAY_MS')
      || !launchWatcher.includes('OVERLAY_SETTLE_DELAY_MS')) {
    fail(achievementLaunchWatcher, 'RunningApps alone is too early; first-launch replay must wait for a settled overlay or a stable-running fallback');
  }
  if (!launchWatcher.includes('const sessionKey = settledOverlay ? `overlay:${overlayRegistration}`')
      || !launchWatcher.includes('completedSessions.get(shortcutAppId) !== sessionKey')) {
    fail(achievementLaunchWatcher, 'first-launch replay must identify a new overlay session even when a rapid restart hides the stopped RunningApps state');
  }
  if (!launchWatcher.includes('enqueueFirstLaunchAchievementToasts(data, shortcutAppId)')
      || !notifications.includes('replayStateAppId?: string | number')) {
    fail(achievementLaunchWatcher, 'replay preferences must use the launched shortcut identity rather than the progress-file source AppID');
  }
	if (!launchWatcher.includes('enqueueLocalAchievementToasts(data, shortcutAppId, Math.floor(firstSeenAt / 1000))')
		|| !launchWatcher.includes('POLL_INTERVAL_MS = 2000')
      || !launchWatcher.includes('data.simulation_enabled !== true')
      || lifecycle.includes('enqueueLocalAchievementToasts')) {
    fail(achievementLaunchWatcher, 'live JSON achievement notifications must be polled by the running-game watcher every two seconds, independent of Library visibility');
  }
	if (!notifications.includes('!baseline!.earned.has(String(achievement.name))')) {
		fail(achievementNotifications, 'live JSON transitions must not be suppressed by unreliable emulator timestamps');
	}
	if (!notifications.includes('localAchievementSessionToastedNames')
		|| !notifications.includes('earnedAt >= sessionStart - 5')
		|| !notifications.includes('earnedAt <= now + 300')) {
		fail(achievementNotifications, 'an achievement present in the first emulator JSON snapshot must be recovered once when its unlock time belongs to the current running session');
	}
  if (!notifications.includes('localAchievementToastQueue.unshift(...unlocked.map')) {
    fail(achievementNotifications, 'genuine in-game unlocks must take priority over remaining replay notifications');
  }
  if (!sidebar.includes('earned.length <= 2') || !sidebar.includes('renderFeaturedAchievementHtml')) {
    fail(achievementSidebar, 'one remaining earned achievement must render as a described feature instead of a detached icon row');
  }
	if (!achievementCacheSource.includes('LOCAL_ACHIEVEMENT_SNAPSHOT_STORAGE_KEY')
		|| !achievementCacheSource.includes('localAchievementDataSignature')
		|| !sidebar.includes('data-gdl-achievement-signature')
		|| !lifecycle.includes("clearLocalAchievementCache(false)")) {
		fail(achievementCache, 'achievement progress must paint from a persistent snapshot and retain identical DOM while the backend revalidates it');
	}
  if (!backendNews.includes('partner_events_unavailable') || backendNews.includes('Partner events parse failed')) {
    fail(newsBackend, 'retired AppIDs must be treated as cached no-content, without repeated partner-event parse warnings');
  }
  if (!frontendNews.includes('partnerEventsUnavailable') || !frontendNews.includes('cacheSet(cacheKey, merged)')) {
    fail(newsFrontend, 'retired-AppID news results must be cached as an expected empty state');
  }
	if (!linking.includes('SetShortcutName') || !linking.includes('resolveShortcutIdAfterRename')) {
		fail(shortcutLinking, 'linking must apply the official shortcut name and resolve Steam\'s post-rename AppID before committing mappings');
	}
	if (!linking.includes('data?.is_delisted === true') || !linking.includes('maxAssetAttempts')) {
		fail(shortcutLinking, 'delisted games must complete identity linking without retrying unavailable optional assets forever');
	}
  if (/const\s+nameApplied\s*=\s*false[\s\S]{0,500}const\s+nameReady\s*=\s*true/.test(linking)) {
    fail(shortcutLinking, 'linking must not report the official name ready when no rename was applied');
  }
	if (/if \(initialId\) \{[\s\S]{0,220}\bcontinue;/.test(linking)) {
		fail(shortcutLinking, 'a stale pre-rename Shortcut AppID must fall through to title/executable identity recovery');
	}
	if (!libraryArtworkSource.includes("throw new Error('shortcut_rename_pending')")
		|| !libraryArtworkSource.includes('stableSamples >= 2')
		|| !libraryArtworkSource.includes('!idsBeforeMutation.has(id)')
		|| !libraryArtworkSource.includes('!requiresFreshIdentity && matches.includes(previousId)')) {
		fail(libraryArtwork, 'a renamed shortcut must resolve a fresh AppID stable across two snapshots before artwork can be committed');
	}
	if ((!linking.includes("if (String(error).includes('shortcut_rename_pending')) throw error")
		&& !linking.includes('Continuing link for'))
		|| !linking.includes('if (complete && options.refreshLibrary !== false)')
		|| !linking.includes('record.id !== Number(initialId || 0)')) {
		fail(shortcutLinking, 'pending shortcut renames must stay visually quiet and queued retries must prefer a safe shortcut identity');
	}
	if (!shortcutPropertiesSource.includes('enqueueLinkJob({') || !shortcutPropertiesSource.includes("gdlText('link_queued_background'")) {
		fail(shortcutPropertiesFile, 'retryable direct links from shortcut Properties must continue in the background queue');
	}
	if (nativeDomSource.includes('menus[menus.length - 1]')
		|| !nativeDomSource.includes(".SVGIcon_Information, svg[class*=\"Information\"]")) {
		fail(nativeDom, 'the game-information button blueprint must be identified semantically, never by play-bar position');
	}
	if (!nativeDomSource.includes('nativePlaybarPairLanguages')
		|| !nativeDomSource.includes("!item.closest('[data-gdl-playtime], [data-gdl-cloud-status], [data-gdl-playbar-achievements]')")
		|| !nativeDomSource.includes('!closestWithCssModuleClass(item, ps.PlayBarCloudStatusContainer)')
		|| !nativeDomSource.includes('elementsWithCssModuleClass(stat, ps.GameStatIconForced).length > 0')
		|| !cloudStatusSource.includes("const nativeCloud = cloudWrappers.find(element => element.dataset.gdlCloudStatus !== '1')")) {
		fail(nativeDom, 'Last Played and Playtime must come from one native pair, reject cloud-contaminated stats and keep exactly one cloud control');
	}
	if (!nativeDomSource.includes('nativeUiBlueprintTypography')
		|| !nativeDomSource.includes('view.getComputedStyle(element)')
		|| !nativeDomSource.includes('export function applyNativePlaybarTypography(')
		|| !nativeDomSource.includes("'font-family', 'font-size', 'font-style', 'font-weight', 'line-height'")
		|| playtimeTrackerSource.includes('normalizeLastPlayedTextColor')
		|| playtimeTrackerSource.includes('font-size:11px')
		|| playtimeTrackerSource.includes('font-size:13px')
		|| playtimeTrackerSource.includes('#8f98a0')) {
		fail(playtimeTracker, 'linked play-bar typography must be captured from the current native Steam client; hard-coded fallback fonts, sizes and colors are forbidden');
	}
	if (!playtimeTrackerSource.includes('applyNativePlaybarTypography(stat, key)')
		|| !playtimeTrackerSource.includes('stats.insertBefore(container, achievement)')
		|| !cloudStatusSource.includes("wrapper.dataset.gdlNativeBlueprint = '0'")
		|| !cloudStatusSource.includes("if (wrapper.dataset.gdlNativeBlueprint !== '1')")
		|| !cloudStatusSource.includes('applyNativePlaybarTypography(wrapper, NATIVE_UI_BLUEPRINT_KEYS.cloudStatus)')
		|| !achievementPlaybarSource.includes("wrapper.dataset.gdlNativeBlueprint = '0'")
		|| !achievementPlaybarSource.includes("if (stat.dataset.gdlNativeBlueprint !== '1')")
		|| !achievementPlaybarSource.includes('applyNativePlaybarTypography(stat, NATIVE_UI_BLUEPRINT_KEYS.playbarAchievements)')
		|| !achievementChromeSource.includes("stat.dataset.gdlNativeBlueprint = '0'")
		|| !achievementChromeSource.includes("if (existing.dataset.gdlNativeBlueprint !== '1')")) {
		fail(nativeDom, 'all owned play-bar controls must keep Steam order/typography and progressively upgrade manual fallbacks to captured native DOM');
	}
	if (!infoPanelSource.includes('normalizeInformationButtonIcon(button')
		|| !infoPanelSource.includes('button.dataset.gdlNativeInformationSvg = capturedNativeIcon.outerHTML')
		|| !infoPanelSource.includes('informationSvgForButton(button)')
		|| !infoPanelSource.includes('86.883,110.957 152.894,110.957')) {
		fail(infoPanel, 'the linked-game information button must preserve Steam\'s native SVG and use its exact geometry as fallback');
	}
	if (!infoPanelSource.includes('getPersistentInfoExpanded')
		|| !infoPanelSource.includes('setPersistentInfoExpanded')) {
		fail(infoPanel, 'the game-information button state must be persistently preserved across route changes and sessions');
	}
	const portraitSourceBlock = libraryArtworkSource.match(/urls:\s*\[\s*(?:userCommunity\?\.portrait\?\.url\s*\|\|\s*['"]['"]\s*,\s*)?(?:preferredCommunity\?\.portrait\s*\|\|\s*['"]['"]\s*,\s*)?modern\?\.portrait[\s\S]*?\]\s*,\s*imageType:\s*0/)?.[0] || '';
	if (!portraitSourceBlock) {
		fail(libraryArtwork, 'the portrait grid source policy could not be located');
	}
	if (portraitSourceBlock.includes('modern?.wide') || /\/header\.jpg/.test(portraitSourceBlock)) {
		fail(libraryArtwork, 'a horizontal header/wide capsule must never be accepted as a portrait grid source');
	}
	if (portraitSourceBlock.includes('capsule_616x353.jpg')
		|| !libraryArtworkSource.includes('automaticArtworkMeetsSlotQuality(dataUrl, imageType)')) {
		fail(libraryArtwork, 'automatic portrait/hero artwork must reject horizontal capsules, low resolution and unsuitable slot ratios');
	}
	if (!libraryArtworkSource.includes('retiredCommunityArtworkPreferred(steamAppId)')
		|| portraitSourceBlock.indexOf('modern?.portrait') < 0
		|| portraitSourceBlock.indexOf('preferredCommunity?.portrait') < 0
		|| portraitSourceBlock.indexOf('modern?.portrait') > portraitSourceBlock.indexOf('preferredCommunity?.portrait')) {
		fail(libraryArtwork, 'official Steam portrait metadata must win before SteamGridDB, with community artwork retained as fallback');
	}
	const heroSourceBlock = libraryArtworkSource.match(/urls:\s*buildHeroCandidateUrls\(\{[\s\S]*?\}\),\s*imageType:\s*1,\s*label:\s*['"]Hero['"]/i)?.[0] || '';
	if (!heroSourceBlock || heroSourceBlock.includes('/header.jpg') || !heroSourceBlock.includes('communityHero: preferredCommunity?.hero')) {
		fail(libraryArtwork, 'a legacy Store header must not prevent the SteamGridDB hero fallback from running');
	}
	if (!bigPictureSource.includes('fetchPlaytimeStatsBatch(shortcuts.map')
		|| !bigPictureSource.includes("setBigPicturePlaytimeField(app, 'minutes_playtime_last_two_weeks', recent)")
		|| !bigPictureSource.includes('playtimeOwnDescriptors')
		|| !bigPictureSource.includes('MILLENNIUM_STEAM_FORCE_RERENDER')) {
		fail(bigPictureRuntime, 'recently-played shortcut cards must merge canonical fallback playtime, update both periods reversibly and request a native rerender');
	}
	if (!playtimeServiceSource.includes('getPlaytimeDataBackend')
		|| !playtimeServiceSource.includes('getAllPlaytimeDataBackend')
		|| !playtimeServiceSource.includes('PLAYTIME_STATS_CACHE_MS = 5000')) {
		fail(playtimeService, 'shared playtime lookup must read canonical backend sessions with a bounded refresh cache');
	}
	if (!desktopLibraryPlaytimeSource.includes('fetchPlaytimeStatsBatch(shortcuts.map')
		|| !desktopLibraryPlaytimeSource.includes('DESKTOP_PLAYTIME_SNAPSHOT_STORAGE_KEY')
		|| !desktopLibraryPlaytimeSource.includes('readDesktopPlaytimeSnapshots()')
		|| !desktopLibraryPlaytimeSource.includes('persistDesktopPlaytimeSnapshots()')
		|| !desktopLibraryPlaytimeSource.includes("setDesktopPlaytimeField(app, 'minutes_playtime_forever', forever)")
		|| !desktopLibraryPlaytimeSource.includes("setDesktopPlaytimeField(app, 'minutes_playtime_last_two_weeks', recent)")
		|| !desktopLibraryPlaytimeSource.includes("setDesktopPlaytimeField(app, 'rt_last_time_played', lastPlayedAt)")
		|| desktopLibraryPlaytimeSource.includes('MILLENNIUM_STEAM_FORCE_RERENDER')
		|| !desktopLibraryPlaytimeSource.includes('data-gdl-playtime-shortcut-id')
		|| !desktopLibraryPlaytimeDomSource.includes('APP_PORTRAIT_CLASS_MODULE')
		|| !desktopLibraryPlaytimeDomSource.includes("formatNativePlaytimeLine('Recent'")
		|| !desktopLibraryPlaytimeDomSource.includes("formatNativePlaytimeLine('Total'")
		|| !desktopLibraryPlaytimeDomSource.includes('elementsWithCssModuleClass(card, classes.PlayedTotal)')
		|| !desktopLibraryPlaytimeDomSource.includes('mutationMayContainDesktopPlaytime')
		|| !runtimeAppSource.includes('patchDesktopLibraryHomePlaytime(popupDoc)')
		|| !runtimeAppSource.includes('syncDesktopLibraryHomePlaytimeDom(popupDoc)')
		|| !runtimeAppSource.includes('linkedShortcutAlreadyVisible ? 0 : 350')) {
		fail(desktopLibraryPlaytime, 'desktop Library Home must hydrate native shortcut playtime and synchronize only the matched card/detail text leaves without forcing a global React rerender');
	}
	if (!playtimeTrackerSource.includes('clearPlaytimeCacheAfter(')
		|| !playtimeTrackerSource.includes('data-gdl-playtime-value="1"')
		|| !playtimeTrackerSource.includes('container.dataset.gdlPlaytimeShortcutId = String(shortcutAppId)')
		|| !playtimeTrackerSource.includes('isDesktopLibraryPlaytimeHydrated(app)')
		|| !playtimeTrackerSource.includes('findNativePlaytimeElements(doc)')
		|| !playtimeTrackerSource.includes('detail.textContent = playtimeFormatted')
		|| !desktopLibraryPlaytimeSource.includes('desktopPlaytimeHydratedApps.add(app)')) {
		fail(playtimeTracker, 'session writes must invalidate cached stats and synchronize exactly one native or NativeGameLink-owned detail value');
	}
	if (!playtimeBackendSource.includes('if direct and STORE.sessions[direct] then return direct end')
		|| !playtimeBackendSource.includes('return direct')
		|| !playtimeBackendSource.includes('function M.get_all_playtime')
		|| !playtimeBackendSource.includes('function M.flush()')) {
		fail(playtimeBackend, 'a regenerated shortcut ID without sessions must recover canonical playtime through its existing aliases');
	}
	if (!loadingStageSource.includes('loadingGenerations.get(doc) !== generation')
		|| !loadingStageSource.includes('restoreNativeLibraryStyles(doc)')
		|| loadingStageSource.includes('hideNoticeQuick(')
		|| !loadingStageSource.includes('LINKED_LOADING_SIDEBAR_ID')
		|| !shortcutNoticeSource.includes('mutationMayContainNonSteamNotice')
		|| !runtimeAppSource.includes('mutationMayContainNonSteamNotice(addedRoots)')
		|| !runtimeAppSource.includes("runInjection('mutation')")) {
		fail(linkedLoadingStage,
			'linked shortcuts must retain native Steam content while metadata is loading and isolate cleanup by navigation generation');
	}
} catch (error) {
  failures.push(`achievement regression checks: unable to read sources (${String(error)})`);
}

try {
	const linkedSidebarSource = await fs.readFile(path.join(frontendRoot, 'features', 'library', 'sidebar-sections.ts'), 'utf8');
	const achievementSidebarSource = await fs.readFile(path.join(frontendRoot, 'features', 'achievements', 'sidebar.ts'), 'utf8');
	const achievementSidebarStyleSource = await fs.readFile(path.join(frontendRoot, 'features', 'achievements', 'styles', 'sidebar.ts'), 'utf8');
	const achievementChromeSource = await fs.readFile(path.join(frontendRoot, 'features', 'library', 'achievement-chrome.ts'), 'utf8');
	const activityViewSource = await fs.readFile(path.join(frontendRoot, 'features', 'library', 'activity-view.ts'), 'utf8');
	if (!linkedSidebarSource.includes("node.dataset.gdlAchievementsPending = '1'")
		|| linkedSidebarSource.includes('cacheLocalAchievements(cachedAchievements')
		|| !linkedSidebarSource.includes("metadata_source: 'store_highlights_pending'")
		|| !linkedSidebarSource.includes('Array.from({ length: missingCount }')
		|| achievementSidebarStyleSource.includes('[data-gdl-achievements-pending="1"] { visibility:hidden')
		|| !achievementSidebarSource.includes("removeAttribute('data-gdl-achievements-pending')")
		|| !achievementChromeSource.includes('revealPendingAchievementSidebar(doc)')) {
		fail(path.join(frontendRoot, 'features', 'library', 'sidebar-sections.ts'),
			'metadata-only achievement highlights must remain visible as an uncached, correctly counted provisional 0/N box until local progress resolves');
	}
	if (activityViewSource.includes('renderActivityFeedSkeletonHtml')
		|| !activityViewSource.includes('renderUnifiedActivityFeedSnapshot(')
		|| !activityViewSource.includes('data-gdl-feed-signature=')) {
		fail(path.join(frontendRoot, 'features', 'library', 'activity-view.ts'),
			'an activity stream must reuse its stable cached snapshot on first paint without introducing a skeleton or shimmer');
	}
} catch (error) {
	fail(path.join(frontendRoot, 'features', 'library', 'sidebar-sections.ts'),
		`achievement pending-state checks could not read their sources (${String(error)})`);
}

// Artwork selection belongs in the Personalización tab for every game. Keep
// the injection route independent from the shortcut-only Properties section so
// native and unlinked games cannot silently lose the picker.
try {
	const [customizationSource, artworkPropertiesSource, propertiesSource, nativeAddGuardSource, runtimeAppSource] = await Promise.all([
		fs.readFile(customizationArtworkFile, 'utf8'),
		fs.readFile(shortcutArtworkPropertiesFile, 'utf8'),
		fs.readFile(shortcutPropertiesFile, 'utf8'),
		fs.readFile(nativeAddGuardFile, 'utf8'),
		fs.readFile(frontendRuntimeApp, 'utf8'),
	]);
	if (!customizationSource.includes('export function tryInjectCustomizationArtwork')
		|| !customizationSource.includes('gdl-customization-artwork-injected')
		|| !customizationSource.includes('shortcutArtworkSettingsHtml(true, true)')
		|| !customizationSource.includes('resolveNativeGameAppId')
		|| !customizationSource.includes('alwaysShow: true')
		|| !customizationSource.includes("attributeFilter: ['class', 'style', 'aria-selected', 'hidden']")
		|| !customizationSource.includes('function isActuallyVisible(element: HTMLElement)')
		|| !customizationSource.includes("!slotParents.has('logo')")
		|| !customizationSource.includes('function isRightPageContainer(')
		|| !customizationSource.includes("parent.closest('.gdl-customization-artwork-injected, #gdl-artwork-picker-overlay, [id^=\"gdl-\"]')")
		|| !customizationSource.includes('function findCustomizationMount(doc: Document)')
		|| !customizationSource.includes("const wideLabel = slotParents.get('wide')")
		|| !customizationSource.includes('container.insertBefore(section, insertBefore)')
		|| !customizationSource.includes('removeCustomizationArtwork(doc)')
		|| !customizationSource.includes('scheduleHydrationRetry(doc, state)')
		|| !customizationSource.includes('disposeCustomizationArtwork(doc: Document)')
		|| customizationSource.indexOf('installCustomizationObserver(doc, popupTitle, gameTitleHint)') > customizationSource.indexOf('const mount = findCustomizationMount(doc)')
		|| customizationSource.includes('const pageText = (doc.body?.textContent')
		|| customizationSource.includes("return doc.querySelector<HTMLElement>(\n\t\t'[class*=\"DialogContent_InnerWidth\"]")) {
		fail(customizationArtworkFile, 'Personalización must inject a persistent artwork picker for native, linked and unlinked games');
	}
	if (!artworkPropertiesSource.includes('alwaysShow?: boolean')
		|| !artworkPropertiesSource.includes('context.alwaysShow')
		|| !artworkPropertiesSource.includes("game_artwork_picker_no_appid")) {
		fail(shortcutArtworkPropertiesFile, 'the artwork binding must keep the Personalización picker visible while AppID resolution is pending');
	}
	if (!propertiesSource.includes('tryInjectCustomizationArtwork(doc, popupTitle, gameTitle)')) {
		fail(shortcutPropertiesFile, 'Properties dialogs must invoke the Personalización artwork injector before shortcut-only guards');
	}
	if (!nativeAddGuardSource.includes('modalCandidates.length > 0 ? modalCandidates : [doc.body]')
		|| !nativeAddGuardSource.includes('isPropertiesDialog(candidate)')
		|| !nativeAddGuardSource.includes('isSearchLikeField')
		|| !nativeAddGuardSource.includes('candidate !== doc.body && searchFields.length >= 1')
		|| nativeAddGuardSource.includes("text.includes('agregar producto')")
		|| nativeAddGuardSource.includes("text.includes('add a game')")) {
		fail(nativeAddGuardFile, 'the native add-game guard must scope modal content and must never classify Properties from generic text fields or the Library footer');
	}
	if (!runtimeAppSource.includes('disposeCustomizationArtwork(popupDoc)')) {
		fail(frontendRuntimeApp, 'document disposal must release the Personalización artwork observer');
	}
} catch (error) {
	fail(customizationArtworkFile, `Personalización artwork checks could not read their sources (${String(error)})`);
}

// Native Library metadata/layout belong entirely to Steam. The one permitted
// adapter remembers the user's global information-toggle intent and invokes the
// semantic native button after a settled route; it must never mutate React DOM.
try {
	const [libraryRuntimeSource, nativeRouteSource, routeExitSource, runtimeAppSource, nativeInfoPreferenceSource] = await Promise.all([
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'runtime.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'native-route.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'route-exit.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'runtime', 'app.tsx'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'native-info-preference.ts'), 'utf8'),
	]);
	if (/if \(!noticeInfo\)\s*\{\s*handleLibraryNavigation\(doc\)/.test(libraryRuntimeSource)) {
		fail(path.join(frontendRoot, 'features', 'library', 'runtime.ts'),
			'transient native DOM hydration must not be promoted to a new navigation generation');
	}
	if (!nativeRouteSource.includes('export function isPublicSteamLibraryRoute')
		|| !libraryRuntimeSource.includes('if (isPublicSteamLibraryRoute(doc))')
		|| !runtimeAppSource.includes('if (isPublicSteamLibraryRoute(popupDoc))')) {
		fail(path.join(frontendRoot, 'features', 'library', 'native-route.ts'),
			'native routes must cross a shared read-only ownership boundary before any NativeGameLink Library work');
	}
	const publicRouteBlock = nativeRouteSource.match(/export function isPublicSteamLibraryRoute\(doc: Document\): boolean \{[\s\S]*?\n\}/)?.[0] || '';
	if (publicRouteBlock.indexOf('appId < 2147483648') < 0
		|| publicRouteBlock.indexOf('appId < 2147483648') > publicRouteBlock.indexOf('findNonSteamNotice(doc)')) {
		fail(path.join(frontendRoot, 'features', 'library', 'native-route.ts'),
			'a concrete public AppID must outrank a stale shortcut notice during split Steam route commits');
	}
	if (!routeExitSource.includes('pendingExitGenerations')
		|| !routeExitSource.includes("visibility', 'hidden', 'important")
		|| !routeExitSource.includes('export function removeOwnedLibraryChrome')
		|| !libraryRuntimeSource.includes('cleanupOwnedLibraryChromeAfterRouteExit(doc)')) {
		fail(path.join(frontendRoot, 'features', 'library', 'route-exit.ts'),
			'route exit must conceal and remove only NativeGameLink-owned chrome after the Steam commit');
	}
	const nativeBoundaryBlock = runtimeAppSource.match(/if \(isPublicSteamLibraryRoute\(popupDoc\)\) \{[\s\S]*?\n\s*\}/)?.[0] || '';
	if (!nativeBoundaryBlock.includes('hasOwnedLibraryChrome(popupDoc)')
		|| !nativeBoundaryBlock.includes('tryInjectLibraryData(popupDoc)')
		|| !nativeBoundaryBlock.includes('reconcileNativeInfoPreference(popupDoc)')
		|| nativeBoundaryBlock.includes('syncDesktopLibraryHomePlaytimeDom')
		|| nativeBoundaryBlock.includes('captureNativeUiBlueprints')
		|| runtimeAppSource.includes('native-info-guard')
		|| runtimeAppSource.includes('stabilizeNativeInfoPanel')
		|| libraryRuntimeSource.includes('findReactClassOwner')) {
		fail(path.join(frontendRoot, 'runtime', 'app.tsx'),
			'native Library pages may only reconcile the bounded information preference before bypassing all other NativeGameLink work');
	}
	const nativeInfoContract = [
		'export function reconcileNativeInfoPreference(doc: Document)',
		'export function disposeNativeInfoPreference(doc: Document)',
		'findNativeInfoButton(doc)',
		'isPublicSteamLibraryRoute(doc)',
		"NATIVE_INFO_PREFERENCE_KEY = 'gdl_native_info_panel_expanded'",
		'readNativeInfoPreference()',
		'MAX_NATIVE_TOGGLES_PER_ROUTE = 3',
		'panels.length === 1',
		'state.stableSamples < 2',
		'Date.now() - state.routeChangedAt < 240',
		'button.click()',
		"doc.addEventListener('click', state.onClick, true)",
	].every(token => nativeInfoPreferenceSource.includes(token));
	if (!nativeInfoContract
		|| !runtimeAppSource.includes('disposeNativeInfoPreference(popupDoc)')
		|| /(?:innerHTML|outerHTML|classList\.(?:add|remove|toggle)|style\.|setAttribute\(|appendChild\(|insertBefore\(|replaceChildren\(|MutationObserver|findReactClassOwner)/.test(nativeInfoPreferenceSource)) {
		fail(path.join(frontendRoot, 'features', 'library', 'native-info-preference.ts'),
			'native information persistence must be route-stable, bounded, semantic and free of React-owned DOM mutations');
	}
	const ownedRouteCleanupBlock = libraryRuntimeSource.match(
		/function cleanupOwnedLibraryChromeAfterRouteExit\(doc: Document\): void \{[\s\S]*?\n\}/,
	)?.[0] || '';
	if (!libraryRuntimeSource.includes('cleanupOwnedLibraryChromeAfterRouteExit(doc);')
		|| ownedRouteCleanupBlock.includes('cleanupInjection(doc)')
		|| !ownedRouteCleanupBlock.includes('removeOwnedLibraryChrome(doc)')) {
		fail(path.join(frontendRoot, 'features', 'library', 'runtime.ts'),
			'deferred native-route retirement must never run the full Steam-DOM restoration cleanup');
	}
} catch (error) {
	fail(path.join(frontendRoot, 'features', 'library', 'route-exit.ts'),
		`native route-isolation checks could not read their sources (${String(error)})`);
}

// Linked Library data must commit atomically from exact-language core data.
// Optional resources hydrate only through a route-owned token, and background
// warming remains a read-only cache concern.
try {
	const [runtimeSource, hydrationSource, friendsSource, cacheSource, newsSource, prefetchSource,
		routeExitSource, activitySource, activityViewSource, activityFeedSource] = await Promise.all([
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'runtime.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'hydration.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'social', 'friends.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'core', 'cache.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'news.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'prefetch.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'route-exit.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'social', 'activity.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'activity-view.ts'), 'utf8'),
		fs.readFile(path.join(frontendRoot, 'features', 'library', 'social', 'feed.ts'), 'utf8'),
	]);
	if (runtimeSource.includes('hideNoticeQuick(notice)')
		|| runtimeSource.includes('await Promise.all([friendPromise, newsPromise])')
		|| !runtimeSource.includes('getCachedGameData(steamAppId, language)')
		|| !runtimeSource.includes('routedShortcutAppId !== titleMatchedShortcutAppId')) {
		fail(path.join(frontendRoot, 'features', 'library', 'runtime.ts'),
			'core rendering must retain Steam native content, use exact-language snapshots and reject split URL/title route identities');
	}
	if (!hydrationSource.includes('ownedActivityFeed(session)')
		|| !hydrationSource.includes('shortcutAppId: session.shortcutAppId')
		|| !friendsSource.includes('section.dataset.gdlSteamAppId !== steamAppId')
		|| !friendsSource.includes('guard.isCurrent()')) {
		fail(path.join(frontendRoot, 'features', 'library', 'hydration.ts'),
			'news, activity and friends hydration must validate the exact route-owned DOM after every asynchronous boundary');
	}
	if (!cacheSource.includes('setProtectedCacheAppIds') || !cacheSource.includes('cacheRead<T>')
		|| !cacheSource.includes('b.priority - a.priority') || !newsSource.includes('cached !== null')
		|| !cacheSource.includes("/^events\\d+_/.test(key)) return protectedCoreAppIds.has(cacheAppId(key)) ? 3 : 0")
		|| !newsSource.includes('const TRANSIENT_NEWS_RETRY_MS = 2 * 60 * 1000')
		|| !newsSource.includes('const memory = newsRequests.peek(key)')
		|| !newsSource.includes('hadTransportFailure ? [...deduped, ...stale] : deduped')
		|| newsSource.includes('transientNewsResults')) {
		fail(path.join(frontendRoot, 'core', 'cache.ts'),
			'persistent cache must retain compact linked feeds while partial legacy responses use stale-while-revalidate backoff');
	}
	if (!activityFeedSource.includes('export function applyUnifiedActivityFeed(')
		|| !activityFeedSource.includes('container.dataset.gdlFeedSignature === signature')
		|| !activityFeedSource.includes('export function hasFreshFriendActivitySnapshot(')
		|| !activitySource.includes('if (hasFreshFriendActivitySnapshot(steamAppId)) return;')
		|| !hydrationSource.includes('applyUnifiedActivityFeed(')
		|| !activityViewSource.includes('renderUnifiedActivityFeedSnapshot(')) {
		fail(path.join(frontendRoot, 'features', 'library', 'social', 'feed.ts'),
			'cached linked feeds must mount on the first paint and skip identical news/friend DOM replacements on revisit');
	}
	if (/(?:spoofArtwork|applyOfficialShortcutIcon|SetCustomArtworkForApp|SteamGridDB|document\.|querySelector)/.test(prefetchSource)
		|| !prefetchSource.includes("type PrefetchPhase = 'core' | 'news'")
		|| !prefetchSource.includes('restartLinkedGamePrefetch(appIds?: Iterable<string | number>)')
		|| !prefetchSource.includes('if (cooldown && cooldown.retryAt > Date.now())')
		|| prefetchSource.includes('if (failure.attempts >= MAX_FAILURE_ATTEMPTS) continue;')
		|| !routeExitSource.includes("'#gdl-main-content-stack'")) {
		fail(path.join(frontendRoot, 'features', 'library', 'prefetch.ts'),
			'background prefetch must remain read-only, targeted on relink and eventually retry bounded failures');
	}
} catch (error) {
	fail(path.join(frontendRoot, 'features', 'library', 'prefetch.ts'),
		`linked data-pipeline checks could not read their sources (${String(error)})`);
}

// Big Picture details use the same durable resource caches as desktop Library,
// but mount a real React tree made from Steam Webpack primitives. There must be
// no plugin stylesheet, inline layout or HTML-string renderer on this surface.
try {
	const [detailsSource, nativeDetailsSource, runtimeSource, panelMountSource, contextSource] = await Promise.all([
		fs.readFile(bigPictureDetails, 'utf8'),
		fs.readFile(bigPictureNativeDetails, 'utf8'),
		fs.readFile(bigPictureRuntime, 'utf8'),
		fs.readFile(bigPicturePanelMount, 'utf8'),
		fs.readFile(path.join(frontendRoot, 'steam', 'gamepad', 'GamepadContext.ts'), 'utf8'),
	]);
	const exactStateGuards = [
		'const detailStates = new WeakMap<Document, BigPictureDetailState>()',
		'const detailGenerations = new WeakMap<Document, number>()',
		'live === state',
		'live.generation === state.generation',
		'live.shortcut.id === state.shortcut.id',
		'live.shortcut.steamAppId === state.shortcut.steamAppId',
		'live.language === state.language',
		'live.root.dataset.gdlSteamAppId === state.shortcut.steamAppId',
		'live.root.dataset.gdlShortcutAppId === String(state.shortcut.id)',
	].every(token => detailsSource.includes(token));
	if (!exactStateGuards || !detailsSource.includes('nextDetailGeneration(doc)')) {
		fail(bigPictureDetails,
			'Big Picture detail commits must validate the exact document, generation, shortcut, Steam AppID, language and owned root datasets');
	}

	const sharedSnapshotReads = [
		'getCachedGameData(shortcut.steamAppId, language)',
		'getCachedLocalAchievementsForGame(shortcut.steamAppId, String(shortcut.id))',
		'getCachedNews(shortcut.steamAppId, language)',
		'getCachedCommunityContent(shortcut.steamAppId, language)',
		'getCachedOfficialCommunityItems(shortcut.steamAppId, language)',
	].every(token => detailsSource.includes(token));
	if (!detailsSource.includes('cachedBigPictureDetailData(') || !sharedSnapshotReads) {
		fail(bigPictureDetails,
			'Big Picture details must seed revisits from the shared persistent, exact-language resource snapshots');
	}
	if (!detailsSource.includes('data: cachedBigPictureDetailData(shortcut, language)')
		|| !detailsSource.includes('scheduleDetailRetry(doc)')
		|| !detailsSource.includes('renderNativeRoot(doc, state)')) {
		fail(bigPictureDetails,
			'a cold Big Picture visit must mount a cached/loading panel immediately and retry transient native-panel gaps');
	}

	const independentResources = [
		"applyResource('game'",
		"applyResource('achievements'",
		"applyResource('news'",
		"applyResource('community'",
		"applyResource('cards'",
		'void request.then(value =>',
	].every(token => detailsSource.includes(token));
	if (detailsSource.includes('Promise.all(')
		|| detailsSource.includes('await getGameData(state.shortcut.steamAppId, state.language)')
		|| !independentResources) {
		fail(bigPictureDetails,
			'Big Picture game, achievements, news, community and cards must hydrate independently without a slow aggregate gate');
	}

	if (!detailsSource.includes('mountNativeBigPictureDetails(state.root, {')
		|| !detailsSource.includes('unmountNativeBigPictureDetails(state.root)')
		|| detailsSource.includes('innerHTML')
		|| detailsSource.includes('renderJsxToHtml')) {
		fail(bigPictureDetails,
			'Big Picture must mount and update one native React root instead of replacing HTML strings');
	}

	const nativePanelMount = [
		'function findNativeTabPanel(',
		'function ensureNativePanelRoot(',
		'function ensureFallbackPanel(',
		"panel.dataset.gdlBpFallbackPanel = '1'",
		"doc.getElementById('gdl-bp-detail-fallback-panel')?.remove()",
		"panel.dataset.gdlBpNativePanel = '1'",
		'if (root.parentElement !== panel) panel.appendChild(root)',
	].every(token => panelMountSource.includes(token))
		&& detailsSource.includes("observer.observe(strip")
		&& detailsSource.includes('ensureNativePanelRoot(doc, tabs, nativeTab)')
		&& detailsSource.includes('removeBigPictureFallbackPanel(doc)');
	if (!nativePanelMount || `${detailsSource}\n${panelMountSource}`.includes('tabsHost.appendChild(strip)')) {
		fail(bigPictureDetails,
			'Big Picture must augment the active native tabpanel and observe the tablist without moving React-owned controls');
	}

	const completeNativeSections = [
		'resolveNativeAppDetailsClasses', 'NativeCarousel', 'classes.ActivityEvent',
		'classes.Achievement', 'classes.Community', 'classes.GameInfo',
		'PartnerEventMediumImage_Container', 'AchievementCarouselItem', 'CommunityItem', 'AppGameInfoContainer',
		'function ActivityTab(', 'function StuffTab(', 'function CommunityTab(', 'function InfoTab(',
		'function AchievementsSection(', 'function TradingCardsSection(',
		"AppDetails_SectionTitle_TradingCards",
	].every(token => nativeDetailsSource.includes(token));
	const settingsPrimitives = ['PanelSection', 'PanelSectionRow', 'Field'].some(token => nativeDetailsSource.includes(token));
	if (!completeNativeSections || settingsPrimitives) {
		fail(bigPictureNativeDetails,
			'linked Big Picture details must use Steam AppDetails components, never settings-form rows');
	}

	const forbiddenCustomPresentation = /(?:createElement\(['"]style['"]|\bstyle\s*=\s*[{"']|cssText|className\s*=\s*["']|\.innerHTML\s*=)/;
	if (forbiddenCustomPresentation.test(nativeDetailsSource)
		|| forbiddenCustomPresentation.test(panelMountSource)
		|| detailsSource.includes("from './styles'")
		|| detailsSource.includes("from './gamepad-nav'")
		|| detailsSource.includes("from './playbar'")) {
		fail(bigPictureNativeDetails,
			'Big Picture native content must not inject CSS, inline presentation, serialized HTML or a parallel controller-navigation system');
	}

	const activeIdentitySignals = [
		"'g_Router.history.location.pathname'",
		"'SteamUIStore.m_currentPath'",
		'activeAppIdsFromStores(doc)',
		'appIdsFromReactOwners(doc)',
		'/routes\\/library\\/app\\/',
	].every(token => contextSource.includes(token));
	if (!activeIdentitySignals || contextSource.includes("a[href*='/app/']")) {
		fail(path.join(frontendRoot, 'steam', 'gamepad', 'GamepadContext.ts'),
			'Big Picture identity must come from its active route/store/React owner, never an unrelated store link');
	}

	const refreshBlock = runtimeSource.match(
		/export async function refreshBigPicture\(doc:[\s\S]*?\n\}/,
	)?.[0] || '';
	const detailStartIndex = refreshBlock.indexOf('const detailRefresh = refreshBigPictureShortcutDetails(doc)');
	const playtimeIndex = refreshBlock.indexOf('void patchBigPictureHomePlaytime(doc)');
	const detailAwaitIndex = refreshBlock.indexOf('await detailRefresh');
	if (!refreshBlock.includes('if (!isBigPictureGameDetailSurface(doc))')
		|| refreshBlock.includes('await patchBigPictureHomePlaytime(doc)')
		|| detailStartIndex < 0 || playtimeIndex <= detailStartIndex || detailAwaitIndex <= detailStartIndex) {
		fail(bigPictureRuntime,
			'Big Picture detail refresh must start before and remain independent from the non-detail playtime batch');
	}
} catch (error) {
	fail(bigPictureDetails,
		`Big Picture cache/navigation checks could not read their sources (${String(error)})`);
}

if (failures.length) {
  console.error(`Source architecture check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Source architecture check passed (${sourceFiles.length} frontend source files, acyclic dependency graph).`);
