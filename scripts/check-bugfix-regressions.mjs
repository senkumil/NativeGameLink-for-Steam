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
const backendUtil = read('backend/lib/util.lua');
const playtimeLua = read('backend/lib/playtime.lua');
const detectionRules = read('backend/lib/shortcut_detection_rules.lua');
const uiModeService = read('frontend/steam/ui/SteamUIModeService.ts');
const gamepadNav = read('frontend/features/big-picture/gamepad-nav.ts');
const spatialNav = read('frontend/features/big-picture/spatial-navigation.ts');
const editableTarget = read('frontend/features/big-picture/editable-target.ts');
const playbarVisibility = read('frontend/steam/playbar-visibility.ts');
const bigPictureDetails = read('frontend/features/big-picture/NativeBigPictureDetails.tsx');
const bigPictureNativeResolver = read('frontend/steam/gamepad/components/AppDetailsNativeClasses.ts');
const webpackRuntime = read('frontend/steam/modules/SteamWebpackRuntime.ts');
const bpTabs = read('frontend/features/big-picture/tabs.ts');
const bpDetails = read('frontend/features/big-picture/details.ts');
const bpDetailsStyles = read('frontend/features/big-picture/details-styles.ts');
const gamepadContext = read('frontend/steam/gamepad/GamepadContext.ts');
const achievementsPlaybar = read('frontend/features/achievements/playbar.ts');
const bpPanelMount = read('frontend/features/big-picture/panel-mount.ts');
const activitySection = read('frontend/features/big-picture/activity-section.tsx');
const friendsTs = read('frontend/features/library/social/friends.ts');
const virtualKeyboard = read('frontend/steam/gamepad/virtual-keyboard.ts');
const bpNativeComponents = read('frontend/steam/gamepad/components/AppDetailsNativeComponents.ts');
const bpControllerIcons = read('frontend/features/big-picture/PlaybarControllerIcons.tsx');
const controllerTs = read('frontend/features/library/controller.ts');
const bpAchievements = read('frontend/features/big-picture/NativeBigPictureAchievements.tsx');
const communityLua = read('backend/lib/community.lua');
const navigationTs = read('frontend/steam/navigation.ts');
const communityViewTs = read('frontend/features/library/community-view.ts');
const bpRuntime = read('frontend/features/big-picture/runtime.ts');
const mappingsTs = read('frontend/core/mappings.ts');
const existingWindows = read('frontend/runtime/existing-windows.ts');
const frontendEntry = read('frontend/index.tsx');
const browserProtectionBootstrap = read('frontend/steam/browser-protection-bootstrap.ts');
const bpNativeInfoBridge = read('frontend/features/big-picture/native-info-bridge.ts');

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
assert(bigPictureDetails.includes('docWindow?.SP_REACTDOM') && bigPictureDetails.includes('globalWindow === docWindow') && bigPictureDetails.includes('getAllModules(doc)'), 'Big Picture mounts native sections through the owning CEF realm ReactDOM host');
assert(webpackRuntime.includes('modules as millenniumWebpackModules') && webpackRuntime.includes('for (const [id, exports] of millenniumWebpackModules)'), 'Big Picture reuses the captured Millennium Webpack registry when its popup hides the chunk global');
assert(!bigPictureDetails.includes('PanelSection') && !bigPictureDetails.includes('PanelSectionRow') && !bigPictureDetails.includes('Field as NativeComponent'), 'Big Picture no longer renders settings-form rows inside game details');
assert(bigPictureNativeResolver.includes("ActivityEvent: ['Event'") && bigPictureNativeResolver.includes("Achievement: ['AchievementCarouselItem'") && bigPictureNativeResolver.includes("Community: ['CommunityContentContainer'"), 'Big Picture resolves Steam-owned AppDetails presentation families by semantic class signatures');
assert(bigPictureDetails.includes('event?.PartnerEventMediumImage_Container') && bigPictureDetails.includes('native?.CommunityItem') && !bigPictureDetails.includes('components.ActivityFeed'), 'activity and community use provider-independent native Steam composition');
assert(bigPictureNativeResolver.includes('prototype.ScrollToElement') && bigPictureNativeResolver.includes('prototype.UpdateScrollArrows') && bigPictureDetails.includes('resolveNativeSummaryCarousel()') && !bigPictureDetails.includes('import { Carousel,'), 'Big Picture uses Steam AppDetails BoxCarousel instead of the unrelated Millennium carousel');
assert(bigPictureDetails.includes('event?.AppActivityDay') && bigPictureDetails.includes('event?.AppActivityDate') && bigPictureDetails.includes('event?.PartnerEventTextOnly_Icon'), 'Big Picture activity uses native dated groups and patch-event chrome');
assert(bpDetails.includes("state.activeTab === 'info'") && bpDetails.includes('restoreNativePanelChildren(state.panel)') && bpDetails.includes("state.root.style.setProperty('display', 'none', 'important')"), 'Big Picture Game Information yields the panel to Steam instead of painting a look-alike');
assert(!bigPictureDetails.includes('function InfoTab(') && !bigPictureDetails.includes('gdl-bp-info-root') && !bpDetailsStyles.includes('gdl-bp-info-root'), 'custom Game Information markup/styles are removed so Steam owns exact DLC, collections, layout and focus behavior');


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
assert(!bpTabs.includes('CollectionsHeader') && !gamepadContext.includes('CollectionsHeader') && !bpDetails.includes('CollectionsHeader'), 'CollectionsHeader is not treated as a library overview selector, preserving InfoTab mounting');
assert(!bpPanelMount.includes('CollectionsHeader') && bpPanelMount.includes('se encuentra en estas colecciones'), 'hideBigPictureNonSteamNotices suppresses non-steam game and collection notices on Info tab without false positive exclusions');
assert(gamepadContext.indexOf('const identity = activeContextFromIdentity') < gamepadContext.indexOf('const byHeading = headingContext'), 'resolveActiveGameContext prioritizes authoritative identity over heading context, protecting legitimate Steam games');
assert(bpPanelMount.includes("context.type !== 'shortcut-linked'") && bpPanelMount.includes('removePlaybarControllerStat'), 'ensurePlaybarControllerStat guards against non-shortcut context to prevent duplicate controller icons on legitimate games');
assert(bpPanelMount.includes('hasNativeCloud') && bpPanelMount.includes('removeCloudDivider'), 'ensureCloudDivider guards against legitimate games and detects document-wide native cloud status');

// Browser shortcut protection & Restart Deadlock Prevention:
// Prevent Chromium native accelerators (Ctrl+S, Ctrl+P, Ctrl+O) from opening Win32 modal
// file dialogs ("Guardar como") with route names like "home" or app IDs, which freeze
// CEF's message pump and deadlock Steam restart.
const browserProtection = read('frontend/steam/browser-protection.ts');
const navTs = read('frontend/steam/navigation.ts');
assert(browserProtection.includes("code === 83") && browserProtection.includes("key === 's'"), 'browser protection intercepts Ctrl+S / Cmd+S save page shortcut');
assert(browserProtection.includes("code === 80") && browserProtection.includes("key === 'p'"), 'browser protection intercepts Ctrl+P print shortcut');
assert(browserProtection.includes("code === 79") && browserProtection.includes("key === 'o'"), 'browser protection intercepts Ctrl+O open file shortcut');
assert(browserProtection.includes("event.stopImmediatePropagation()"), 'browser protection cancels event propagation immediately');
assert(browserProtection.includes("a[download]"), 'browser protection neutralizes unexpected download triggers on loopback routes');
assert(frontendEntry.indexOf("import './steam/browser-protection-bootstrap'") !== -1 && frontendEntry.indexOf("import './steam/browser-protection-bootstrap'") < frontendEntry.indexOf("import plugin from './runtime/app'"), 'entry evaluates the Save-As bootstrap before the main plugin runtime');
assert(browserProtectionBootstrap.includes('protectKnownSteamWindows();') && browserProtectionBootstrap.includes('EARLY_SWEEP_DELAYS_MS') && browserProtectionBootstrap.includes('g_PopupManager'), 'hot-enable bootstrap protects the current CEF realm and existing Steam popups before AddWindowCreateHook');
assert(browserProtectionBootstrap.includes('2000') && browserProtectionBootstrap.includes('GetExistingPopup') && browserProtectionBootstrap.includes('m_mapPopups'), 'hot-enable bootstrap sweeps late popup adoption during the first two seconds');
assert(browserProtection.includes("Symbol.for('NativeGameLink.browserProtection.windowAcceleratorGuard.v1')") && browserProtection.includes("Symbol.for('NativeGameLink.browserProtection.documentAcceleratorGuard.v1')"), 'sticky accelerator guards survive module re-evaluation without accumulating duplicate Ctrl+S listeners');
assert(!runtimeApp.includes('neutralizeSteamAppIdFileBackend') && !runtimeApp.includes("request_json: '{}'"), 'plugin hot-enable never runs global steam_appid.txt neutralization during mapping hydration');
assert(backendUtil.includes('skipped = "missing_target"') && !backendUtil.includes('local userdata = deps.fs.join(steam_path, "userdata")'), 'steam_appid.txt neutralization is target-scoped and empty requests cannot scan every Steam shortcut directory');
assert(runtimeApp.includes("installBrowserProtection(window, window.document)") && runtimeApp.includes("disposeAllBrowserProtection()"), 'app runtime initializes browser protection on startup and dismounts cleanly');
assert(runtimeApp.includes("lifecycle.add(installBrowserProtection(popupWin, popupDoc))"), 'app runtime protects all adopted Steam popup windows');
assert(navTs.includes("installBrowserProtection(doc.defaultView, doc)"), 'navigation layer attaches browser protection to document lifecycle');
assert(libraryRuntime.includes("disposeSteamNavigation(doc)"), 'library runtime cleans up navigation and browser protection on dismount');
 
// Big Picture playbar: native Steam Big Picture NEVER shows achievement count/progress
// in the top playbar (only Desktop mode does). Big Picture places achievements in the
// section/carousel below the playbar.
assert(achievementsPlaybar.includes('steamUIModeService.isGamepadUI(doc)') && achievementsPlaybar.includes("doc.querySelectorAll<HTMLElement>('[data-gdl-playbar-achievements=\"1\"], #gdl-playbar-achievements').forEach(el => el.remove());"), 'ensureLocalPlaybarStat rejects GamepadUI/Big Picture and purges playbar achievements');
assert(bpPanelMount.includes("statsSection.querySelectorAll<HTMLElement>('[data-gdl-playbar-achievements=\"1\"], #gdl-playbar-achievements').forEach(el => el.remove());"), 'ensurePlaybarControllerStat purges residual playbar achievement elements in Big Picture mode');
assert(bpDetails.includes('#gdl-playbar-achievements, [data-gdl-playbar-achievements="1"]'), 'removeBigPictureDetailsNodes purges residual playbar achievement elements');

// Big Picture Tab navigation and Details parity:
// Ensure activeTabFromNative includes multi-layer detection (aria, classes, focus, background brightness, content fallback),
// notice suppression enforces display: none !important, and details styles are installed.
assert(bpTabs.includes('isNodeSelectedOrActive') && bpTabs.includes('brightestTab') && bpTabs.includes('hasNativeGameInfo'), 'activeTabFromNative has multi-layer tab selection resilience including native content fallback');
assert(bpPanelMount.includes("style.setProperty('display', 'none', 'important')") && bpPanelMount.includes('NonSteamGameNotice'), 'hideBigPictureNonSteamNotices suppresses non-steam notices and duplicate collections with important display');
assert(bpDetails.includes('ensureBigPictureDetailStyles(doc)') && bpDetailsStyles.includes('gdl-bp-community-grid') && !bpDetailsStyles.includes('gdl-bp-info-root'), 'Big Picture keeps custom community layout isolated and never restyles Steam native Game Information');

// Big Picture Modal / Focus Ring Dismissal:
// Modals (trading card preview, screenshot modal, community image modal, news dialog, Steam dialogs)
// must dismiss and suppress the focus ring, and gamepad nav must recognize native Steam dialogs.
assert(gamepadNav.includes('export function dismissBigPictureFocusRing'), 'gamepadNav exports dismissBigPictureFocusRing');
assert(gamepadNav.includes('[role="dialog"]') && gamepadNav.includes('ModalPosition'), 'gamepadNav getActiveModal detects native Steam modal dialogs');
assert(bigPictureDetails.includes('dismissBigPictureFocusRing(doc)'), 'NativeBigPictureDetails dismisses focus ring when opening and closing image modals');

// Big Picture Controller Icon Parity:
// Controller icons in the playbar use Steam's native Webpack components (IconsModule, ControllerType, XboxOutline, Ps4Outline, Ps5Outline)
// and native ControllerSupportInfo / ControllerSupportRow classes with native 36px sizing (no manual downscaling).
// ControllerStatus is strictly excluded because it calls useQuery() requiring QueryClientProvider which crashes isolated roots.
assert(bpPanelMount.includes('mountPlaybarControllerIcons(row, doc, support)'), 'ensurePlaybarControllerStat delegates to mountPlaybarControllerIcons');
assert(bpPanelMount.includes('playbar.ControllerSupportInfo') && bpPanelMount.includes('playbar.ControllerSupportRow'), 'ensurePlaybarControllerStat applies native Steam ControllerSupportInfo and ControllerSupportRow classes');
assert(bpControllerIcons.includes('resolveNativeControllerIcons') && bpControllerIcons.includes('IconsModule'), 'PlaybarControllerIcons resolves native Webpack icons from Steam chunk runtime');
assert(!bpControllerIcons.includes('ControllerStatus') && bpControllerIcons.includes('ControllerType'), 'PlaybarControllerIcons avoids ControllerStatus to prevent QueryClientProvider crash');
assert(bpControllerIcons.indexOf('if (ControllerType)') < bpControllerIcons.indexOf('else if (XboxOutline)'), 'playbar prefers Steam ControllerType glyphs before outline fallbacks');
assert(bpControllerIcons.includes('PlaybarErrorBoundary'), 'PlaybarControllerIcons wraps rendering in PlaybarErrorBoundary');
assert(bpNativeComponents.includes('resolveNativeControllerIcons') && bpNativeComponents.includes('resolveNativeControllerFeatureComponent'), 'native components resolver provides Webpack controller icon and feature resolvers');
assert(!bpPanelMount.includes("svg.setAttribute('width', '24')"), 'eliminated manual hardcoded 24x20px SVG downsizing in favor of native Steam Webpack sizing');

// Big Picture and CEF Browser Protection:
// Prevents Chromium from triggering "Save Page As" / "Guardar como" modal dialogs and closing Steam:
// keydown/keyup capture phase blocks Ctrl+S, Ctrl+P, Ctrl+O, contextmenu blocks native Save As,
// and activateBigPicture installs browser protection on Big Picture document and window.
assert(browserProtection.includes("key === 's' || code === 83"), 'browser-protection blocks Ctrl+S / Cmd+S');
assert(browserProtection.includes('blockContextMenu') && browserProtection.includes('blockAcceleratorHandler'), 'browser-protection suppresses unhandled contextmenu and keyboard accelerators');
assert(browserProtection.includes('acceleratorWindows') && browserProtection.includes('acceleratorDocuments') && browserProtection.includes('Accelerator guards remain until realm destruction'), 'Save-As accelerator protection survives plugin hot-disable until the CEF window unloads');
assert(bpRuntime.includes('installBrowserProtection(doc.defaultView, doc)'), 'activateBigPicture installs browser protection in Big Picture mode');

// Big Picture Anti-Flicker & Launch Stabilization:
// Launching/closing a game must never trigger rapid re-render or tear-down loops:
// 1. requestBigPictureRerender throttles MILLENNIUM_STEAM_FORCE_RERENDER to at most once per 1.5s
// 2. refreshBigPicture coalesces rapid back-to-back refresh passes
// 3. handleBigPictureExit is guarded against active/connected Big Picture sessions
// 4. steamUIModeService.isGamepadUI strictly evaluates document surface when doc is supplied
// 5. refreshBigPictureShortcutDetails preserves existing details when tabs momentarily transition
assert(bpRuntime.includes('requestBigPictureRerender()') && bpRuntime.includes('now - lastRerenderTime < 1500'), 'runtime throttles forced re-renders to prevent render loops');
assert(bpRuntime.includes('activeRefreshPromises = new WeakMap<Document, Promise<void>>()') && bpRuntime.includes('lastRefreshCompletedAt = new WeakMap<Document, number>()') && bpRuntime.includes('Date.now() - lastCompletedAt < 250'), 'runtime coalesces rapid Big Picture refreshes per document');
assert(webpackRuntime.includes('states = new WeakMap<Window, SteamWebpackRuntimeState>()') && webpackRuntime.includes('if (doc?.defaultView) return [doc.defaultView]') && webpackRuntime.includes('invalidateWindow(win)'), 'Steam Webpack runtime is isolated per CEF window and invalidated per realm');
assert(!bpRuntime.includes('loadMappings().catch') && bpRuntime.includes('sameDocument'), 'Big Picture activation is idempotent and does not reload mappings on every mutation refresh');
assert(bpRuntime.includes('getBigPictureMappedShortcuts') && bpRuntime.includes('collectMappedShortcutApps'), 'Big Picture reuses a short-lived mapped-shortcut projection and avoids duplicate full-library scans');
assert(runtimeApp.includes('handleBigPictureExit(): void') && runtimeApp.includes('bpDoc && bpDoc.body?.isConnected'), 'handleBigPictureExit is guarded against destroying active Big Picture documents');
assert(uiModeService.includes('if (doc) return this.isDocumentGamepadSurface(doc);'), 'steamUIModeService strictly scopes isGamepadUI to document when doc is provided');
assert(bpDetails.includes('if (isLibraryOrNonDetailsView(doc))') && bpDetails.includes('scheduleDetailRetry(doc);'), 'details preserves mounted details during transient tab transitions');
assert(bpDetails.includes('preferredDetailTabs') && bpDetails.includes('preferredTab || detectedTab || state?.activeTab'), 'tab clicks remain authoritative while Steam aria/class state catches up during transitions');
assert(bpDetails.includes('commitNativePanelRoot(state.panel, state.root)') && bpDetails.includes('restoreNativePanelChildren(state.panel)') && bpDetails.includes('preserving Steam panel and retrying'), 'Big Picture panel replacement is transactional and restores native content if React mount is not ready');
assert(bpPanelMount.includes("!target || target === root || (root && target.contains(root))"), 'non-Steam notice cleanup can never hide an ancestor containing the injected React root');
assert(bpDetails.includes('detailContextGapSince') && bpDetails.includes('Date.now() - startedAt < 700'), 'mounted linked details survive bounded transient GamepadUI identity gaps instead of flashing native/black content');
assert(bpPanelMount.includes('cloudScope = parent.parentElement || parent') && bpPanelMount.includes('isRenderedElement(doc, element)') && !bpPanelMount.includes("/steam\s*cloud/i.test(el.textContent"), 'Steam Cloud fallback only yields to a visible nearby native cloud row');
assert(bpPanelMount.includes('MIN_CLOUD_SCROLL_BEFORE_COLLAPSE = 96') && bpPanelMount.includes('isPlaybarStillVisible(doc)') && bpPanelMount.includes('upwardTravel >= MIN_CLOUD_SCROLL_BEFORE_COLLAPSE') && bpPanelMount.includes("doc.addEventListener('scroll', state.onScroll, { capture: true, passive: true })") && !bpPanelMount.includes('eventOffset) > 16'), 'Steam Cloud fallback waits for real header collapse instead of disappearing on tiny or nested scroll events');
assert(bpPanelMount.includes("const linkedDetailRoot = doc.getElementById('gdl-bp-detail-root')?.dataset.gdlSteamAppId") && bpPanelMount.includes("context.type !== 'shortcut-linked' && !linkedDetailRoot"), 'Steam Cloud fallback survives transient linked-detail route gaps');
assert(bpPanelMount.includes('nativeControllerClass') && bpPanelMount.includes('element.classList.contains(nativeControllerClass)') && !bpPanelMount.includes('/control|controller/i.test'), 'controller stat identifies only the exact native ControllerSupportInfo class');
assert(bpPanelMount.includes('gdlBpNativeControllerHidden') && bpPanelMount.includes('data-gdl-bp-native-controller-hidden'), 'linked shortcuts suppress and later restore stale native controller rows instead of deleting the AppID-backed stat');
assert(bpPanelMount.includes('playbarControllerStates') && bpPanelMount.includes('bindPlaybarControllerRepair') && bpPanelMount.includes('observer.observe(target, { childList: true, subtree: true })'), 'controller stat is repaired when Steam React replaces the playbar children');
assert(bpPanelMount.includes('playbarControllerContextGapSince') && bpPanelMount.includes('Date.now() - gapStarted > 1200'), 'controller stat survives bounded GamepadUI identity gaps instead of disappearing between tab/header rebuilds');
assert(bpNativeComponents.includes('cachedControllerIconsMissAt') && bpNativeComponents.includes("req(35488)") && bpNativeComponents.includes('Date.now() - cachedControllerIconsMissAt < 1200'), 'controller icon resolver retries transient Webpack misses instead of caching null forever');
assert(controllerTs.includes('setInterval(check, 1000)') && controllerTs.includes('list.find(isSteamControllerConnected)'), 'controller detection uses events plus a low-frequency watchdog and ignores disconnected stale store entries');

// Library Sidebar: Legitimate Steam games must never disappear or leave empty gaps
// when a non-Steam shortcut maps to the same AppID. cleanupGhostSidebarEntries must
// NOT set display: none on virtual list rows, and tryRedirectUnownedMappedGame must
// use AppStoreAdapter to verify ownership before redirecting.
const sidebarCleanup = read('frontend/features/library/sidebar-cleanup.ts');
assert(sidebarCleanup.includes('AppStoreAdapter.getAppOverview(appId)'), 'sidebar cleanup uses AppStoreAdapter for ownership checks');
assert(!sidebarCleanup.includes("row.style.display = 'none'") && !sidebarCleanup.includes("row.style.setProperty('display', 'none'"), 'cleanupGhostSidebarEntries never hides virtual gamelist rows with display: none');
assert(sidebarCleanup.includes("row.style.removeProperty('display')"), 'cleanupGhostSidebarEntries restores any previously suppressed virtual rows');

// Big Picture Activity Input & Virtual Keyboard:
// The collapsed composer must remain lightweight, must not inject a profile avatar,
// and now intentionally keeps the hovered Steam-like text box appearance even before
// activation so the surface no longer visually pops on hover/focus.
assert(activitySection.includes('gdl-bp-native-status-entry-idle') && !activitySection.includes("nativeClasses(postClasses?.PostTextEntry, 'gdl-bp-post-entry-bar')"), "activity composer keeps the custom collapsed entry and does not reintroduce Steam's heavier PostTextEntry wrapper");
assert(activitySection.includes('<textarea') && activitySection.includes("nativeClasses(postClasses?.PostTextEntryArea, 'gdl-bp-native-status-textarea')") && !activitySection.includes('resolveNativeFocusableTextarea(document)'), 'activity editor remains a lightweight textarea with native Steam input class only while active');
assert(!activitySection.includes("minHeight: '44px'") && !activitySection.includes("padding: '6px 14px'"), 'activity composer does not override Steam PostTextEntry geometry with custom box styling');
assert(activitySection.includes('requestKeyboard();') && !activitySection.includes('onFocus={(e: any) => requestKeyboard') && !activitySection.includes('onClick={(e: any) => requestKeyboard'), 'activity composer requests the native keyboard once after activation instead of on every focus/click');
assert(activitySection.includes('hideSteamVirtualKeyboard(document)') && activitySection.includes('EXIT_TEXT_EDITOR_EVENT'), 'PostTextEntry dismisses the virtual keyboard on publish/cancel/controller exit');
assert(virtualKeyboard.includes('SHOW_DEBOUNCE_MS = 350') && virtualKeyboard.includes('VirtualKeyboardMessage'), 'virtual keyboard requests are debounced and retain the GamepadUI parent-message fallback');
assert(!virtualKeyboard.includes('dispatchEvent(new Event(\'focus\'') && !virtualKeyboard.includes('dispatchEvent(new MouseEvent(\'click\'') && !virtualKeyboard.includes('targetInput.focus()'), 'virtual keyboard service never synthesizes focus/click events that recurse through textarea handlers');
assert(!virtualKeyboard.includes('m_KeyboardOwners') && !virtualKeyboard.includes('m_bIsInlineVirtualKeyboardOpen') && !virtualKeyboard.includes('UpdateIsShowingVirtualKeyboard'), 'virtual keyboard integration no longer mutates Steam private manager state');
assert(virtualKeyboard.includes('getRequire(doc)') && virtualKeyboard.includes('getAllModules(doc)') && virtualKeyboard.includes('cachedHandles = new WeakMap<Window'), 'virtual keyboard handle is resolved and cached per owning CEF realm');
assert(bpNativeComponents.includes('resolveNativePostTextEntryComponent') && bpNativeComponents.includes('resolveNativeFocusableTextarea'), 'native component resolvers remain available for other Steam surfaces without forcing them into the activity composer');
assert(!activitySection.includes('onBlur={() =>') && activitySection.includes('gdl-bp-post-entry-active'), 'activity composer remains mounted when the native keyboard temporarily moves focus away');
assert(!activitySection.includes('<div className={postClasses?.PostTextEntryArea}>') && !activitySection.includes("resize: 'vertical'"), 'activity section eliminates nested PostTextEntryArea boxes and vertical resize grip');
assert(bpDetailsStyles.includes('resize: none !important') && bpDetailsStyles.includes('.gdl-bp-post-entry-active') && bpDetailsStyles.includes('background: rgba(255,255,255,0.09) !important'), 'active activity editor cannot fall back to Chromium white textarea styling when Steam input classes are unavailable');
assert(!bpDetailsStyles.includes('.gdl-controller-stat svg path') && !bpDetailsStyles.includes('.gdl-controller-support-row svg path') && !/gdl-controller-stat svg[\s\S]{0,160}fill:\s*#ffffff\s*!important/.test(bpDetailsStyles), 'controller SVG internals keep Steam native multi-path fills instead of collapsing into white silhouettes');
assert(bpDetailsStyles.includes('min-height: 30px !important') && bpDetailsStyles.includes('line-height: 0 !important') && bpDetailsStyles.includes('height: 28px !important') && bpDetailsStyles.includes('overflow: visible !important'), 'native controller glyph boxes stay vertically visible so lower grips are not clipped by the playbar row');
assert(editableTarget.includes("tag === 'textarea'") && gamepadNav.includes('doc.dispatchEvent(new CustomEvent(EXIT_TEXT_EDITOR_EVENT))') && gamepadNav.includes('setTimeout(pollGamepads, 100)'), 'text editing yields directional ownership to GamepadUI while controller B can always escape the editor');

// Big Picture Gamepad Navigation Parity & Non-Skipping:
// Navigation uses one geometry snapshot per move and arbitrates Steam key events
// against navigator.getGamepads() so one physical press cannot double-step.
assert(spatialNav.includes('collectFocusableLayout') && spatialNav.includes('chooseSpatialTarget') && spatialNav.includes('primaryGap * 12'), 'spatial navigation ranks adjacent targets from one cached geometry snapshot');
assert(spatialNav.includes('aligned ? crossDelta * 0.55') && spatialNav.includes('candidate.centerX') && spatialNav.includes('candidate.centerY'), 'spatial navigation preserves row/column alignment without hard dead-end windows');
assert(spatialNav.includes('sameAxisThreshold') && spatialNav.includes('const pool = aligned.length ? aligned : directional'), 'spatial navigation cannot interpret tiny same-row offsets as vertical moves and prefers aligned neighbors before diagonals');
assert(gamepadNav.includes('pollNavigationSuppressedUntil = Date.now() + 500') && gamepadNav.includes('keyboardOwnsNavigation'), 'gamepad polling is suppressed after Steam emits navigation keys, preventing double-stepping');
assert(gamepadNav.includes('active !== doc.body && currentScope.contains(active)') && gamepadNav.includes('ownedMarker || nativeMarker'), 'spatial navigation trusts live DOM focus before stale gpfocus markers');
assert(!gamepadNav.includes("dispatchEvent(new CustomEvent('activate'") && gamepadNav.includes('current.click();'), 'selection invokes each control once instead of click plus synthetic activate');
assert(!gamepadNav.includes('performance.now() - start < 500') && gamepadNav.includes('isEditableTextTarget(target)'), 'custom focus ring does not run a 500ms layout loop and is disabled for text editors');
assert(spatialNav.includes('.gdl-bp-trading-card') && spatialNav.includes('.gdl-bp-badge-action'), 'spatial navigation selector includes trading cards and badge actions');
assert(!spatialNav.includes('.gdl-bp-info-feature') && !spatialNav.includes('.gdl-bp-info-description'), 'custom spatial navigation never claims Steam native Game Information controls');
assert(bigPictureDetails.includes('gdl-bp-trading-card') && bigPictureDetails.includes('gdl-bp-badge-action'), 'NativeBigPictureDetails ensures trading cards and badges are focusable and navigable');
assert(!bigPictureDetails.includes('gdl-bp-info-description') && !bigPictureDetails.includes('gdl-bp-info-feature'), 'NativeBigPictureDetails does not duplicate Steam Game Information focus targets');
assert(bpDetails.includes('activateNativeGameInfoBridge(doc, state.shortcut, state.data.game)') && bpDetails.includes('deactivateNativeGameInfoBridge(doc)'), 'native Game Information bridge is scoped strictly to the Steam info tab and restored elsewhere');
assert(bpNativeInfoBridge.includes('originalGetAppData.call(this, linkedId)') && bpNativeInfoBridge.includes('if (linked?.details) return linked;'), 'native Game Information reuses Steam AppDetailsStore data for the linked AppID when available');
assert(bpNativeInfoBridge.includes('buildSyntheticDetails') && bpNativeInfoBridge.includes('strDeveloper') && bpNativeInfoBridge.includes('vecStoreCategories'), 'native Game Information can hydrate Steam detail metadata from linked Store data without drawing a custom panel');
assert(bpNativeInfoBridge.includes("setTemporaryValue(app, 'app_type', 1)") && bpNativeInfoBridge.includes("setTemporaryValue(app, 'BIsShortcut'") && bpNativeInfoBridge.includes('restoreActiveShortcutClassification'), 'native Game Information temporarily classifies only the active shortcut as a Steam app and restores its exact shortcut identity afterward');
assert(!bpNativeInfoBridge.includes('steam://run/') && !bpNativeInfoBridge.includes('OpenSteamURL'), 'native Game Information bridge cannot redirect the Play action to the linked Store AppID');
assert(bigPictureDetails.includes('gdl-bp-community-empty') && bigPictureDetails.includes('AppDetails_Community_Hub'), 'NativeBigPictureDetails provides focusable community hub button when empty');
assert(bpAchievements.includes('gdl-bp-view-all-achievements') && bpAchievements.includes('AppDetails_Achievements_ViewAll'), 'NativeBigPictureAchievements provides focusable view-all achievements trigger');
assert(activitySection.includes('profiles/${friend.steamid}') && activitySection.includes('native?.GamepadFriendSectionItem'), 'activity section friend cards retain Steam focus classes and activate friend profiles');
assert(activitySection.includes('native?.FriendsContainer') && activitySection.includes('native?.FriendsPlayingHalfSection') && activitySection.includes('native?.AvatarAndLabel'), 'Big Picture friends retain Steam native visual class families');
assert(activitySection.includes('gdl-bp-friends-grid-parity') && bpDetailsStyles.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important') && bpDetailsStyles.includes('column-gap: 42px !important') && bpDetailsStyles.includes('margin-inline: 27px !important'), 'friends preserve the two-column GamepadUI composition with the tightened card width/inset requested for Big Picture parity');
assert(bpDetailsStyles.includes('height: 68px !important') && bpDetailsStyles.includes('background: rgba(255, 255, 255, 0.07) !important') && bpDetailsStyles.includes('width: 52px !important') && bpDetailsStyles.includes('gap: 24px !important'), 'friend cards preserve the tightened Steam-parity geometry, background, avatar size, and label spacing');
assert(bigPictureDetails.includes('gdl-bp-activity-tab-content') && bpDetailsStyles.includes('padding-top: 18px !important'), 'activity content keeps native breathing room below the sticky tab header so Friends never collides with it');
assert(friendsTs.includes("encode('wishlist'") && friendsTs.includes("retained?.wishlisted?.length") && friendsTs.includes('transiently empty during client hydration'), 'friend hydration preserves a previously confirmed wishlist column across transient empty Steam responses');
assert(activitySection.includes('gdl-bp-native-status-entry-idle') && activitySection.includes('data-gdl-suppress-focus-ring="1"') && !activitySection.includes('gdl-bp-status-avatar'), 'collapsed Activity composer is text-only, has no current-user avatar, and suppresses the plugin-owned rectangular focus ring');
assert(gamepadNav.includes("target.dataset.gdlSuppressFocusRing === '1'"), 'custom Gamepad focus ring honors per-target suppression for native-like composer surfaces');
assert(bpDetailsStyles.includes('.gdl-bp-native-status-placeholder') && bpDetailsStyles.includes('.gdl-bp-native-status-entry-idle') && bpDetailsStyles.includes('background: rgba(255,255,255,0.09) !important') && !bpDetailsStyles.includes('.gdl-bp-status-avatar'), 'Activity composer keeps the always-visible hovered text box styling without an injected profile image');

// Community Videos Direct Playback:
// 1. community.lua fetches videos with subsection 3 and artwork with subsection 4
assert(communityLua.includes('fetch_sub(lang, lang, 3, "video", "Videos")') && communityLua.includes('fetch_sub(lang, lang, 4, "artwork", "Artwork")'), 'community.lua accurately targets Steam Community subsection 3 for videos');
// 2. community.lua and navigation.ts extract YouTube IDs robustly (including IDs with hyphens)
assert(communityLua.includes('img%.youtube%.com/vi/([^/"%s]+)') && communityLua.includes("item.image:match('img%.youtube%.com/vi/"), 'community.lua extracts YouTube ID from video cards and preview images');
assert(navigationTs.includes('extractCommunityYoutubeId') && navigationTs.includes('youtube-nocookie.com/embed/'), 'navigation.ts exports YouTube ID extractor and handles iframe embed');
// 3. Desktop community-view renders video cards with data-gdl-youtube-id and direct play button
assert(communityViewTs.includes('extractCommunityYoutubeId(item)') && communityViewTs.includes('data-gdl-youtube-id="${escapeHtml(resolvedYtId)}"'), 'community view ensures video cards receive direct YouTube player attributes');
// 4. NativeBigPictureDetails provides showNativeVideoModal and plays videos on activate
assert(bigPictureDetails.includes('showNativeVideoModal') && bigPictureDetails.includes('gdl-bp-video-modal-wrap'), 'NativeBigPictureDetails plays community videos directly via modal dialog');
assert(bpDetailsStyles.includes('.gdl-bp-video-play-btn') && bpDetailsStyles.includes('.gdl-bp-video-modal-frame'), 'details styles provide Big Picture play button and video modal frame rules');

// Startup Reliability & Window Adoption:
// 1. filterMappingsForLocalShortcuts must never discard mappings when shortcuts registry has 0 items (e.g. cold start lock)
assert(mappingsTs.includes('if (!snapshot || !snapshot.ids || snapshot.ids.size === 0) return { mappings: source, removed: [] }'), 'mappings filter guards against wiping mappings when shortcut snapshot is empty on startup');
assert(mappingsTs.includes('const hasValidShortcutRegistry = Boolean(localShortcuts && localShortcuts.ids && localShortcuts.ids.size > 0)'), 'hydrateMappings checks valid non-empty shortcut registry before purging');
// 2. existing-windows provides isRealSteamUiWindow and getCanonicalDesktopPopup
assert(existingWindows.includes('isRealSteamUiWindow') && existingWindows.includes('getCanonicalDesktopPopup'), 'existing windows module exports real Steam UI validator and canonical desktop locator');
// 3. resolveMainWindowDocument checks getCanonicalDesktopPopup to prioritize real SP Desktop document
assert(runtimeApp.includes('getCanonicalDesktopPopup()') && runtimeApp.includes('if (!observedDocs.has(doc)) windowCreated(popup)'), 'resolveMainWindowDocument prioritizes canonical desktop popup and adopts it if unobserved');
// 4. windowCreated includes retry timers for CEF about:blank cross-document navigation
assert(runtimeApp.includes('setTimeout(() => { try { if (!popupWin.closed && popupWin.document?.body) windowCreated(context);') && runtimeApp.includes('isRealSteamUiWindow(popupWin)'), 'windowCreated uses timeout retries and validates real Steam UI window');
// 5. app.tsx maintains a recurring adoption interval to guarantee late-mounting Steam popups are adopted
assert(runtimeApp.includes('const adoptionInterval = setInterval(() => { try { adoptExistingSteamWindows(windowCreated); } catch {} }, 3000)') && runtimeApp.includes('clearInterval(adoptionInterval)'), 'app.tsx maintains recurring adoption interval and cleans up on dismount');

console.log(`All ${passed} user-reported bug regression checks passed.`);



