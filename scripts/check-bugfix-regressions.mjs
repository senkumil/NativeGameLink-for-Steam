import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const remoteDetection = read('backend/lib/shortcut_detection.lua');
const localDetection = read('backend/lib/shortcut_detection_local.lua');
const aliases = read('backend/lib/shortcut_detection_aliases.lua');
const detectionTs = read('frontend/features/shortcuts/detection.ts');
const properties = read('frontend/features/shortcuts/properties.ts');
const propertiesStyle = read('frontend/features/shortcuts/properties-style.ts');
const manualLink = read('frontend/features/shortcuts/manual-link.ts');
const factoryReset = read('frontend/features/shortcuts/factory-reset.ts');
const factoryUi = read('frontend/settings/FactoryResetSection.tsx');
const unlinking = read('frontend/features/shortcuts/unlinking.ts');
const linkQueue = read('frontend/features/shortcuts/link-job-queue.ts');
const artwork = read('frontend/features/library/artwork.ts');
const artworkRelinkCleanup = read('frontend/features/library/artwork-relink-cleanup.ts');
const logoPosition = read('frontend/features/library/artwork-logo-position.ts');
const customizationArtwork = read('frontend/features/shortcuts/customization-artwork.ts');
const artworkProperties = read('frontend/features/shortcuts/artwork-properties.ts');
const achievementProperties = read('frontend/features/shortcuts/achievement-properties.ts');
const achievementSettings = read('backend/lib/achievement_settings.lua');
const achievementsLua = read('backend/lib/achievements.lua');
const runtimeApp = read('frontend/runtime/app.tsx');
const artworkBatchRefresh = read('frontend/runtime/artwork-batch-refresh.ts');
const libraryRuntime = read('frontend/features/library/runtime.ts');
const prefetch = read('frontend/features/library/prefetch.ts');
const gameData = read('frontend/core/game-data.ts');
const nativeAddDetector = read('frontend/features/shortcuts/native-add-autodetect.ts');
const newsLua = read('backend/lib/news.lua');
const newsTs = read('frontend/features/library/news.ts');
const heroResolver = read('frontend/features/library/artwork-hero.ts');
const linking = read('frontend/features/shortcuts/linking.ts');
const linkOrchestrator = read('frontend/features/shortcuts/link-orchestrator.ts');
const bulkLink = read('frontend/features/shortcuts/bulk-link.ts');
const bulkPolicy = read('frontend/features/shortcuts/bulk-policy.ts');
const linkManagement = read('frontend/settings/LinkManagementSection.tsx');
const backendMain = read('backend/main.lua');
const playtimeLua = read('backend/lib/playtime.lua');
const detectionRules = read('backend/lib/shortcut_detection_rules.lua');
const uiModeService = read('frontend/steam/ui/SteamUIModeService.ts');
const gamepadNav = read('frontend/features/big-picture/gamepad-nav.ts');
const playbarVisibility = read('frontend/steam/playbar-visibility.ts');
const bigPictureDetails = read('frontend/features/big-picture/NativeBigPictureDetails.tsx');
const bigPictureNativeResolver = read('frontend/steam/gamepad/components/AppDetailsNativeClasses.ts');
const webpackRuntime = read('frontend/steam/modules/SteamWebpackRuntime.ts');
const bpTabs = read('frontend/features/big-picture/tabs.ts');
const bpDetails = read('frontend/features/big-picture/details.ts');
const gamepadContext = read('frontend/steam/gamepad/GamepadContext.ts');

let passed = 0;
function assert(condition, message) {
	if (!condition) throw new Error(`BUGFIX regression failed: ${message}`);
	console.log(`  [PASS] ${message}`);
	passed += 1;
}

console.log('Running user-reported bug regression checks...');

// Wukong / tiny-token collision: maintained alias must remain visible while a
// coincidentally exact 1-3 char Store title cannot promote itself to certainty.
assert(aliases.includes('["b1"]') && aliases.includes('"2358720"'), 'b1 maintained alias still resolves Black Myth: Wukong');
assert(detectionTs.includes("DETECTION_MODEL_VERSION = 'v10'"), 'detection model cache bumped to v10 after tracking-context repair');
assert(remoteDetection.includes('DETECTION_MODEL_VERSION = "v10"'), 'backend candidate cache is versioned with v10');
assert(remoteDetection.includes('maintained_alias_exact') && localDetection.includes('maintained_alias_exact'), 'local and remote engines preserve exact maintained-alias evidence');
assert(remoteDetection.includes('short_title_unverified') && remoteDetection.includes('short_executable_unverified'), 'tiny exact titles/executables remain provisional without independent corroboration');
assert(remoteDetection.includes('candidate.alias_primary == true'), 'primary maintained alias is tracked independently from Store title coincidence');

// Manual/property link controls must report actual transactional state, not an
// optimistic mapping written before linkShortcutToSteam has completed.
assert(properties.includes("propertyActionBusy: 'link' | 'unlink' | null"), 'Properties Link/Unlink share an explicit in-flight state');
assert(properties.includes('await linkShortcutToSteam({') && properties.includes('await unlinkShortcutFromSteam({'), 'Properties waits for Link and Unlink operations');
assert(!properties.includes('void updateMappingsChecked({ set:'), 'Properties no longer writes an optimistic mapping before linking');
assert(properties.includes('detectShortcutCandidatesLocal') && properties.includes('enrichShortcutCandidatesRemote'), 'Properties renders local suggestions before remote enrichment');
assert(propertiesStyle.includes('color-scheme: dark') && propertiesStyle.includes('.gdl-native-select option'), 'Properties suggestion dropdown keeps Steam-dark option colors');
assert(properties.includes('candidateForPreview') && properties.includes('linkedPreviewCandidate'), 'Properties preview resolves the exact selected AppID, including the currently linked entry');
assert(properties.includes('previousSelectionStillAvailable') && properties.includes('suggestionUserInteracted && previousSelectionStillAvailable'), 'async candidate enrichment preserves an explicit user dropdown selection');
assert(manualLink.includes('detectShortcutCandidatesLocal') && manualLink.includes('enrichShortcutCandidatesRemote'), 'Manual review modal also uses progressive local + remote suggestions');
assert(manualLink.includes('Title-only AppID discovery failed') && manualLink.includes('titleOnlyCandidates'), 'manual detection renders title-only local candidates before waiting for full shortcut context');
assert(manualLink.includes('function displayConfidence') && manualLink.includes("candidate.score >= 90"), 'manual confidence badge reports 90-100 scores as HIGH unless identity collision exists');
assert(remoteDetection.includes('strong_local_candidate') && remoteDetection.includes('strong_local_candidate and 0'), 'remote enrichment skips Store Search when a strong local candidate already exists');
assert(remoteDetection.includes('initial_validation_count = strong_local_candidate and 1'), 'strong local candidates validate only the top AppID first');
assert(localDetection.includes('candidate.alias_unique and 99 or 90'), 'exact unique maintained aliases surface immediately at 99% without waiting for Steam network enrichment');
assert(detectionTs.includes('backendDetailsPromise') && detectionTs.includes('1200'), 'full shortcut/VDF tracking context is always resolved behind a bounded background budget');
assert(manualLink.includes('_updateContext') && manualLink.includes('syncTrackingRecommendationUi'), 'an already-visible manual modal receives late launcher/main-executable recommendations without reopening');
assert(detectionRules.includes('["red_dead_redemption_2"]') && detectionRules.includes('auto_override_target = "Launcher.exe"') && detectionRules.includes('preserve_launchers = { ["launcher.exe"] = true }'), 'RDR2 keeps its narrow launcher-tracking exception while other games use the generic main-executable resolver');
assert(!logoPosition.includes("steamAppId === '1888930'"), 'TLOU has no special artwork/logo-position policy and follows the standard Steam asset path');

// Factory reset and bulk unlink must be bounded. A stale bridge/network promise
// is invalidated by the reset epoch and may unwind later without pinning the UI.
assert(linkQueue.includes('pausePendingLinkJobs(waitBudgetMs = 1800)'), 'pending job pause has a bounded wait budget');
assert(factoryReset.includes('withFactoryResetBudget') && factoryReset.includes("'unlink all shortcuts'"), 'Factory Reset has bounded subsystem budgets');
assert(factoryReset.includes('unlinkAllShortcutsFromSteam(options.doc, true)'), 'Factory Reset avoids a nested queue-pause ownership leak');
assert(unlinking.includes('queuesAlreadyPaused = false'), 'bulk unlink can reuse an existing reset pause barrier');
assert(factoryUi.includes("error: 'reset_timeout'") && factoryUi.includes('22_000'), 'Factory Reset UI has a final watchdog');

// Artwork: official Steam metadata must not be replaced by SteamGridDB merely
// because CEF could not read the official URL; backend grid download gets first chance.
assert(artwork.includes("const ART_STORAGE_PREFIX = 'gdl_artwork18_';") && artwork.includes("'gdl_artwork17_'"), 'artwork policy marker bumped and prior marker retained for invalidation');
assert(artwork.includes('isAuthoritativeSteamMetadataUrl'), 'automatic artwork distinguishes authoritative Steam metadata from synthesized probes');
assert(artwork.includes('if (!item.dataUrl && isAuthoritativeSteamMetadataUrl(item.url, item.imageType)) return false;'), 'CEF failure alone cannot replace official Steam metadata artwork with community art');
assert(artwork.includes('const backendCandidates = Array.from(new Set([url, ...fallbackUrls].filter(Boolean)))'), 'backend grid fallback preserves provider priority and tries subsequent candidates');
assert(artwork.includes('heroPolicyVersion: 2'), 'new Hero provenance policy invalidates stale fallback decisions');


// Logo placement is applied once and then left to the user. MKK has a curated
// centered first position, while later Steam-native manual adjustments persist.
assert(logoPosition.includes("const STORAGE_PREFIX = 'gdl_logo_position4_';"), 'logo position marker bumped to v4');
assert(logoPosition.includes("MKK_POSITION: SteamLogoPosition = { pinnedPosition: 'CenterCenter', nWidthPct: 58, nHeightPct: 58 }"), 'Mortal Kombat Komplete Edition starts centered with the larger clean-install logo profile');
assert(logoPosition.includes("if (steamAppId === '237110') return 3;"), 'MKK logo-position profile revision forces the corrected clean-install size to reapply once');
assert(logoPosition.includes('markSaved(shortcutAppId, steamAppId, position, source);'), 'accepted logo position is settled even when readback is unavailable');

// Linked shortcuts use the visible native Change button, but the actual picker
// is a synchronous CEF file input because Steam's dialog bridge can just flash.
assert(artwork.includes("NATIVE_ARTWORK_OVERRIDE_PREFIX = 'gdl_native_artwork_override1_'"), 'native Steam artwork ownership is persisted per shortcut');
assert(artwork.includes('nativeArtworkCustomizationActive(shortcutAppId, steamAppId)'), 'automatic artwork respects Steam-native user ownership');
assert(customizationArtwork.includes('bindNativeArtworkChangeButtons') && customizationArtwork.includes("input.type = 'file'"), 'linked native Change controls open a document-owned image picker');
assert(customizationArtwork.includes('input.click()') && customizationArtwork.includes("addEventListener('click', handler, true)"), 'the picker opens synchronously inside the trusted native button click');
assert(customizationArtwork.includes('saveShortcutArtworkBackend') && customizationArtwork.includes('SetCustomArtworkForApp'), 'selected native artwork persists through Steam and the grid-file fallback');
assert(!customizationArtwork.includes('OpenFileDialog') && !customizationArtwork.includes('readLocalArtworkImageBackend'), 'native artwork selection never uses the unreliable Steam system file-dialog IPC');
assert(!artworkProperties.includes('OpenFileDialog') && artworkProperties.includes('fileInput.click()'), 'NativeGameLink custom artwork picker uses CEF file input and cannot invoke SteamClient native file-dialog IPC');
assert(artwork.includes('prioritySources') && artwork.includes('secondarySources') && artwork.includes('batch_complete'), 'Hero/Logo/Portrait are applied before secondary artwork and publish one completed batch');
assert(!artwork.includes('priority_ready') && artwork.includes('await Promise.all(items.map(applyResolvedDownload))'), 'automatic artwork writes are concurrent and cannot repaint the page per slot');
assert(artwork.includes('reserveShortcutArtworkTarget') && artwork.includes("missing: ['superseded']"), 'a relink reservation blocks the previous AppID from racing the replacement artwork');
assert(artworkRelinkCleanup.includes('clearUnreplacedShortcutArtwork') && artworkRelinkCleanup.includes('clearArtworkSlotsBackend'), 'relinking preserves successful Hero/Logo slots and clears only unreplaced artwork');
assert(linkOrchestrator.indexOf('this.applyArtworkAndIcons(') < linkOrchestrator.indexOf('this.commitMapping('), 'the linked page is published only after its bounded artwork batch is staged');
assert(artworkBatchRefresh.includes('batch_complete') && artworkBatchRefresh.includes('setTimeout') && runtimeApp.includes('installArtworkBatchRefresh'), 'one debounced completion event owns the Library artwork repaint');
assert(linkOrchestrator.includes('const [artworkResult, iconResult] = await Promise.all([artworkRequest, iconRequest])'), 'foreground artwork and icon work share one bounded wait instead of adding their timeouts');
assert(bulkLink.includes('Critical artwork gets the worker/network budget first'), 'bulk linking gives artwork priority over shortcut icon work');

// Factory Reset and clean installs must show 0 simulated achievements without
// stale in-memory settings resurrecting a previous slider value.
assert(achievementProperties.includes('clearShortcutAchievementSettingsCaches'), 'achievement Properties exposes an in-memory cache reset');
assert(factoryReset.includes('clearShortcutAchievementSettingsCaches()') && factoryReset.includes('clearLocalAchievementCache(true)'), 'Factory Reset clears both settings and rendered achievement caches');
assert(!achievementSettings.includes('simulate_percent = 25') && !achievementSettings.includes('or 25'), 'backend achievement settings default simulation to zero');
assert(!achievementsLua.includes('simulate_percent = 25') && !achievementsLua.includes('or 25'), 'achievement renderer defaults simulation to zero');
assert(achievementProperties.includes('simulate_percent: 0') && !achievementProperties.includes('offlineAchievementsCount * 0.25'), 'Properties slider initializes simulated progress at zero');

// Manual link UX has one status surface, never shows a final no-match warning
// while enrichment is still running, and updates queued completion by event.
assert(manualLink.includes('let enrichmentComplete = !loading'), 'manual link distinguishes searching from a final no-match result');
assert(manualLink.includes("enrichmentComplete ? 'warning' : 'active'"), 'searching state cannot render as a warning');
assert(!manualLink.includes('gdl-manual-link-result'), 'link result duplication removed; one status box remains');
assert(manualLink.includes('PENDING_LINK_JOBS_CHANGED_EVENT') && !manualLink.includes('setInterval(refreshQueuedState'), 'background link status updates from queue events instead of one-second polling');
assert(manualLink.includes("'2 · Prepare'") && manualLink.includes("'3 · Finish'"), 'link progress labels are simplified without duplicating Ready');
assert(manualLink.includes("gdlText('link_status_preparing', 'Preparing game…')") && manualLink.includes("gdlText('link_status_applying_resources', 'Applying resources…')"), 'active link status uses action text instead of repeating progress labels');

// Startup failures in optional subsystems cannot abort the plugin descriptor,
// and idle/background work is capped to reduce CEF CPU/memory growth.
assert(runtimeApp.includes('function safeStartup(') && runtimeApp.includes("deferStartup('native add detector'") && runtimeApp.includes("deferStartup('mapping hydration'"), 'non-critical startup services are guarded and deferred until after the plugin descriptor can render');
assert(runtimeApp.includes('Plugin descriptor ready in') && runtimeApp.includes('background services deferred'), 'frontend startup reports the synchronous descriptor budget for clean-install diagnostics');
assert(backendMain.indexOf('millennium.ready()') > backendMain.indexOf('local function on_load()') && !backendMain.includes('Diagnostic check failed'), 'backend on_load publishes Millennium readiness without synchronous diagnostics/state parsing');
assert(backendMain.includes('local LAZY_MODULES = {') && backendMain.includes('setmetatable(deps, {') && backendMain.includes('local function module(name)'), 'backend services are instantiated lazily after Millennium readiness instead of blocking startup');
assert(playtimeLua.includes('Session state is loaded lazily by the first playtime API call') && !/\nload_sessions\(\)\nreturn M\nend\s*$/.test(playtimeLua), 'playtime history is not parsed during backend module construction');
assert(!runtimeApp.includes('steamComponents.prewarmComponents()'), 'Steam component prewarm no longer retains modules eagerly');
assert(!runtimeApp.includes('sweepCopiedFeedbackTooltips(popupDoc);\n\t\t}, 500)'), '500ms full-document tooltip sweep removed');
assert(nativeAddDetector.includes('}, 4000);'), 'native-add safety polling reduced to a four-second fallback');
assert(uiModeService.includes('this.nativeModeListenerRegistered ? 5000 : 2500'), 'Steam UI mode polling is low-frequency when native mode callbacks exist');
assert(gamepadNav.includes('setTimeout(pollGamepads, 50)') && !gamepadNav.includes('requestAnimationFrame(pollGamepads)'), 'Big Picture controller navigation uses a bounded 20 Hz poll instead of a permanent display-rate loop');
assert(prefetch.includes('MAX_PREFETCH_APP_IDS = 6'), 'background linked-game prefetch is bounded');
assert(gameData.includes('MAX_GAME_DATA_CACHE_KEYS = 64'), 'in-memory game-data cache is bounded more tightly');

// Steam's 884 logical-pixel NarrowRightPanel breakpoint can trigger early at
// desktop scaling levels and hide linked cloud/achievement copy despite room.
assert(playbarVisibility.includes('classes.HideWhenNarrow') && playbarVisibility.includes('classes.MiniAchievements'), 'linked play-bar preserves cloud and achievement copy across the middle splitter breakpoint');
assert(playbarVisibility.includes("setProperty('display', 'flex', 'important')") && playbarVisibility.includes('restoreLinkedPlaybarVisibility'), 'linked-only visibility override outranks NarrowRightPanel and restores native display state on route exit');
assert(bigPictureDetails.includes('docWindow?.SP_REACTDOM') && bigPictureDetails.includes('(window as any)?.SP_REACTDOM'), 'Big Picture mounts native sections through Millennium\'s canonical ReactDOM host');
assert(webpackRuntime.includes('modules as millenniumWebpackModules') && webpackRuntime.includes('for (const [id, exports] of millenniumWebpackModules)'), 'Big Picture reuses the captured Millennium Webpack registry when its popup hides the chunk global');
assert(!bigPictureDetails.includes('PanelSection') && !bigPictureDetails.includes('PanelSectionRow') && !bigPictureDetails.includes('Field as NativeComponent'), 'Big Picture no longer renders settings-form rows inside game details');
assert(bigPictureNativeResolver.includes("ActivityEvent: ['Event'") && bigPictureNativeResolver.includes("Achievement: ['AchievementCarouselItem'") && bigPictureNativeResolver.includes("Community: ['CommunityContentContainer'"), 'Big Picture resolves Steam-owned AppDetails presentation families by semantic class signatures');
assert(bigPictureDetails.includes('event?.PartnerEventMediumImage_Container') && bigPictureDetails.includes('native?.CommunityItem') && !bigPictureDetails.includes('components.ActivityFeed'), 'activity and community use provider-independent native Steam composition');
assert(bigPictureNativeResolver.includes('prototype.ScrollToElement') && bigPictureNativeResolver.includes('prototype.UpdateScrollArrows') && bigPictureDetails.includes('resolveNativeSummaryCarousel()') && !bigPictureDetails.includes('import { Carousel,'), 'Big Picture uses Steam AppDetails BoxCarousel instead of the unrelated Millennium carousel');
assert(bigPictureDetails.includes('event?.AppActivityDay') && bigPictureDetails.includes('event?.AppActivityDate') && bigPictureDetails.includes('event?.PartnerEventTextOnly_Icon'), 'Big Picture activity uses native dated groups and patch-event chrome');
assert(bigPictureDetails.includes('width="100%"') && bigPictureDetails.includes('<NativeFeature') && bigPictureNativeResolver.includes("Feature: ['Container', 'Icon'"), 'Big Picture game information constrains box art and renders Steam-native feature rows');


// Removed/delisted artwork must not pay for a long chain of speculative Steam
// CDN 404s before using a SteamGridDB recommendation that is already available.
assert(artwork.includes('legacy ? 2500 : 12000'), 'known legacy titles use a short Steam metadata wait budget');
assert(artwork.includes('legacyCommunityFirst') && artwork.includes('communityAroundProbes'), 'legacy artwork places resolved community assets before speculative CDN probes');
assert(heroResolver.includes('preferCommunityBeforeDirectProbes'), 'Hero resolver has a retired-title fast path without weakening active-game Base-first policy');

// Historical news returns the first real Steam item immediately. In particular,
// PES Product Release entries live in the unfiltered Web API feed, so every
// title uses that one complete request without an announcements-first timeout.
assert(newsLua.includes('local news, transient_error = fetch_news_json(appid, lang)') && !newsLua.includes('announcements_only'), 'all games use one complete official Steam news request');
assert(!newsLua.includes('fetch_store_oldnews_archive') && !newsLua.includes('fetch_relevant_community_history'), 'removed-game feeds no longer crawl oldnews, related DLC, guides or discussions');
assert(newsTs.includes('events18_removed') && newsTs.includes('events18_standard'), 'news cache invalidates stale empty historical snapshots');
assert(newsTs.includes('historical ? emptyResult') && newsTs.includes('Removed games commonly have no News Hub'), 'removed games skip slow duplicate Partner Events HTML requests');
assert(newsTs.includes('officialReleaseFallback') && newsTs.includes('steam_store_release_metadata') && newsTs.includes('feed_metadata_title'), 'a stable Steam metadata card keeps every otherwise empty feed useful');
assert(newsTs.includes('combined.length > 0') && libraryRuntime.includes('getCachedNews(steamAppId, language, data)'), 'the first linked-page paint gets a guaranteed feed card while real news revalidates');
assert(newsTs.includes('steamReleaseTimestamp') && newsTs.includes("normalize('NFD')"), 'localized Steam release dates remain renderable in legacy feeds');
assert(newsTs.includes('historicalNewsMode') && newsTs.includes('is_delisted === true') && newsTs.includes('historical ? emptyResult'), 'removed/delisted metadata selects the short official-news path');
assert(!newsLua.includes('fetch_news_historical') && !newsTs.includes('fetchHistoricalNewsBackend'), 'obsolete historical enrichment RPC has been removed');
assert(newsLua.includes('historical_enrichment = false') && newsLua.includes('local is_available = #news > 0'), 'official-news resolution remains explicit and bounded to one request');
assert(newsLua.includes('local items, unavailable, transient_error = scrape_partner_events(appid, lang, 50)'), 'normal Partner Events path remains the native Steam News Hub scraper');
assert(!newsLua.includes('appid == "221430"') && !newsLua.includes("appid == '221430'"), 'news resolver is not hardcoded to PES 2013');

// Foreground link intent is persisted before Steam identity/resources mutate. Closing
// only the modal leaves the Promise running; terminating Steam promotes a staged
// intent into the normal retry queue on the next CEF session.
assert(linkQueue.includes("status: 'staged' | 'queued' | 'running' | 'failed'") && linkQueue.includes('SESSION_ID'), 'durable link queue distinguishes same-session staged intents from resumable queued jobs');
assert(linkQueue.includes('stageLinkJobForRecovery') && linkQueue.includes("sameSessionStage ? 'staged' : 'queued'"), 'interrupted staged links are promoted to queued on the next Steam session');
assert(manualLink.includes('stageLinkJobForRecovery({'), 'manual linking stages recovery before starting the foreground transaction');
assert(properties.includes('stageLinkJobForRecovery({'), 'Properties linking stages recovery before starting the foreground transaction');
assert(bulkLink.includes('stageLinkJobForRecovery({'), 'bulk linking stages each selected target before its identity mutation');


// Bulk linking must not produce weaker decisions than the manual modal merely
// because several remote validations ran at once. First-pass skips get one
// fresh low-concurrency review and the UI preserves the actual policy reason.
assert(bulkLink.includes('const BULK_ANALYSIS_CONCURRENCY = 2') && bulkLink.includes('const BULK_REVIEW_CONCURRENCY = 1'), 'bulk detector limits remote concurrency before identity validation');
assert(bulkLink.includes('Stage 1.5: Fresh low-concurrency review') && bulkLink.includes('detectShortcutCandidatesLocal(item.context)') && bulkLink.includes('enrichShortcutCandidatesRemote(item.context'), 'bulk first-pass skips receive a fresh manual-equivalent validation pass');
assert(bulkLink.includes('decisionReason = decision.reason') && linkManagement.includes("case 'ambiguous_close_runner_up':") && linkManagement.includes("case 'insufficient_confidence':"), 'bulk report preserves the real skip reason instead of labeling every skip ambiguous');
assert(remoteDetection.includes('maintained_alias_unique') && localDetection.includes('maintained_alias_unique'), 'single-AppID maintained aliases carry explicit uniqueness evidence');
assert(bulkPolicy.includes('BULK_TOP_SCORE_THRESHOLD = 58'), 'bulk max-recall threshold is explicitly 58 percent');
assert(bulkPolicy.includes("reason: 'top_score_threshold'"), 'bulk chooses the highest eligible candidate once it reaches the threshold');
assert(!bulkPolicy.includes('unresolved_identity_collision') && !bulkPolicy.includes('alias_requires_confirmation'), 'bulk no longer requires extra identity/collision corroboration above the requested score floor');
assert(remoteDetection.includes('maintained_alias_auto') && localDetection.includes('maintained_alias_auto'), 'curated auto_appid aliases carry explicit bulk recovery provenance');
assert(bulkLink.includes('Stage 1.75: final SERIAL rescue') && bulkLink.includes('attempt < 3') && detectionTs.includes('recoveryMode = false') && detectionTs.includes('recovery_mode: recoveryMode'), 'bulk unresolved titles receive an isolated aggressive serial recovery pass');

// Bulk progress must expose resource application as a distinct phase instead of
// resetting to 0/N while still saying "Linking". The settings UI also keeps one
// status surface and an overall progress bar that never jumps backwards between phases.
assert(bulkLink.includes("export type BulkLinkProgressPhase = 'analyzing' | 'linking' | 'resources'"), 'bulk progress models resources as a separate phase');
assert(bulkLink.includes("target.title, 'resources'"), 'artwork/icon pass reports the resources phase instead of a second linking pass');
assert(linkManagement.includes("bulk_link_resources_progress") && linkManagement.includes("bulk_link_resources_game"), 'settings labels resource application explicitly');
assert(linkManagement.includes("shortcutActionBusy !== 'bulk-link'"), 'bulk progress does not duplicate the same live status above the progress bar');
assert(linkManagement.includes("return 66.666 + phaseProgress * 33.334"), 'overall bulk progress remains monotonic across analyze/link/resources phases');

// Big Picture Library tabs and details surface isolation: Library collection views
// (Todos los juegos, Instalados, etc.) must NEVER mount Game Details tabs or sections.
assert(!bpTabs.includes('order[idx]') && bpTabs.includes('LIBRARY_COLLECTION_KEYWORDS'), 'findBigPictureTabStrip has no blind structural fallback and guards against library collection tabs');
assert(gamepadContext.includes('NON_DETAILS_ROUTE_PATTERN') && gamepadContext.includes('export function collectActiveRouteValues'), 'GamepadContext exports collectActiveRouteValues and guards against non-details library routes');
assert(gamepadContext.includes('[role="tablist"]'), 'appIdsFromReactOwners strictly excludes role=tablist to prevent library overview fiber leakage');
assert(bpDetails.includes('isLibraryOrNonDetailsView(doc)') && bpDetails.includes('removeBigPictureDetailsNodes(doc)'), 'refreshBigPictureShortcutDetails immediately tears down detail nodes and exits on library views');

console.log(`All ${passed} user-reported bug regression checks passed.`);
