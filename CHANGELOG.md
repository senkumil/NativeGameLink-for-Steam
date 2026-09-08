## v3.0.1 - Clean-install portability and recovery hardening (2026-09-02)

- Moves mutable mappings, achievement settings and playtime history to a per-user data directory instead of the plugin installation folder.
- Rejects developer-local or foreign state from historical archives and validates cached mappings against the active Steam account's real `shortcuts.vdf`.
- Prioritizes the currently active Steam account from `loginusers.vdf` and adds direct `shortcuts.vdf` lookup when Steam's internal app store is not hydrated yet.
- Makes shortcut renaming best-effort so a missing or delayed private Steam API can no longer abort an otherwise valid link.
- Hardens artwork selection with isolated click handling, explicit native image dialogs, backend local-image loading/download fallbacks and direct Steam grid-file fallback when private artwork APIs are unavailable.
- Removes fixed Steam-installation assumptions and resolves helper paths from Millennium's actual plugin location.
- Purges persisted playtime records that do not belong to shortcuts in the active Steam library, repairing installs previously contaminated by packaged session state.
- Adds a clean-install regression check so packaged user state, fixed paths and critical fallback logic cannot silently return.
- Adds GitHub Actions CI/CD: reproducible verification on pushes/PRs, automatic synchronization of the compiled Millennium frontend on `main`, and tag-driven clean/source GitHub Releases with SHA-256 checksums.

## v3.0.0 - Major Release: Delisted Games Support, Direct Artwork Management, Achievement Management Tools & Trading Card Farming (2026-08-31)

- **Comprehensive Support for Delisted & Removed Steam Games**:
  - Resilient metadata and official asset linking for retired or unlisted titles without an active Steam store page (e.g. *Mortal Kombat Komplete Edition*, *Transformers: Devastation*, etc.).
  - Resolves official titles, achievements, and artwork without stalling background queues for missing optional store endpoints.

- **Direct Artwork Management in Game Properties**:
  - Integrated, isolated artwork customizer inside the *Customization* tab in Properties.
  - Allows live preview, selection, and download of hero backgrounds, vertical/horizontal logos, portrait capsules, and icons in real time.
  - Strict isolation: the selector is safely hidden outside the customization tab, and resetting assets preserves native Steam artwork without touching official games.

- **Integrated Steam Achievement Management Tools**:
  - Native integration to inspect, unlock, lock, or modify achievement progress for official Steam games directly from your library interface.
  - Immediate synchronization with the Steam client UI without needing external standalone tools.

- **Steam Trading Card Farming & Interactive Showcase**:
  - Interactive trading card collection with centered 3D tilt, cursor illumination, and metadata-gated foil holographic reflection.
  - Badge progression tracking, remaining card drop calculation, and direct integration with the Steam Community Market.

- **Simplified Non-Steam Achievement Simulation**:
  - Ultra-accessible configuration per shortcut: instant 100% completion, progressive simulated unlocking, or manual tracking.
  - Direct compatibility with local JSON and external launcher achievement files.
  - Schema recognition with high-resolution icons and smooth in-game achievement unlock notifications.

- **Strict Native Isolation, Zero-Flicker & Performance**:
  - No intrusive automatic popups on Steam startup; linking detection triggers only when manually opening the official *"Add a Non-Steam Game"* dialog.
  - Smooth asynchronous portrait decoding in the Game Information drawer to eliminate visual flicker.
  - Resilient linking for repeated/duplicate shortcuts and instant 0ms browsing from local memory snapshots.
  - And many more under-the-hood improvements to enhance your experience.


## v2.1.0 - Achievement reliability, performance and native isolation (2026-08-28)

- Persists the last backend-confirmed playtime and full local-achievement snapshot for linked non-Steam shortcuts, paints both synchronously when Steam recreates its Library UI, and then revalidates them in the background; identical achievement results retain their existing DOM and icons to eliminate the startup flash/flicker.
- Keeps an immediate, uncached 0/N achievement box visible when no local snapshot has been warmed yet, using Store highlight icons as locked previews and counting the unseen achievements in the +N tile until the real schema and progress replace it.
- Replaces the activity feed's anonymous loading rectangles with a layout-stable Steam-like date, news-card and patch-card skeleton using a subtle shimmer animation and a reduced-motion fallback.
- Extends localized game-metadata persistence to 30 days and immediately renders an already-visible linked shortcut on startup, while retaining the strict no-intervention boundary for actual native Steam game-detail routes.
- Recovers a newly earned achievement when a local JSON file is created with that achievement already unlocked before the overlay readiness delay completes, while deduplicating the recovery per running session and retaining timestamp-independent polling for normal transitions.
- Displays non-Steam playtime in Big Picture's recently-played cards by merging Steam's often-empty shortcut response with NativeGameLink's canonical sessions, updating lifetime and two-week fields, and forcing the native card to rerender.
- Displays the same canonical non-Steam playtime in Desktop Library Home's recently-played shelf and game-detail stat by hydrating Steam's native lifetime, two-week and last-played AppOverview fields without reducing any value Steam already knows; it invalidates stale stats after session writes, recovers history after local AppID regeneration, and avoids the global React rerender that could trigger Steam's `removeChild` rendering error.
- Prevents controller-driven Steam play-bar rebuilds from replacing the linked-game information icon with an unrelated arrow by removing positional button capture and normalizing cloned native markup to the information SVG.
- Recognizes achievement progress left under historical local Shortcut AppIDs by requiring an exact match with the linked game's official achievement-name schema and selecting the most recently modified matching JSON, without moving or rewriting user files; explicit per-game paths retain absolute priority.
- Adds global and per-game controls for simulated achievements, full simulated completion and online-only unlocks while preserving Steam's real achievement names and icon URLs; per-game overrides are stored atomically under both shortcut and official AppID keys and refresh the Library immediately.
- Treats retired or delisted Steam AppIDs with no News Hub payload as expected no-content, caching that state instead of repeatedly emitting partner-event parse warnings.
- Restores official shortcut-name updates during linking and resolves Steam's regenerated local Shortcut AppID before committing artwork and mappings, while leaving the executable and launch configuration untouched.
- Adds a per-game zero-progress override that ignores custom and global AppID achievement files while retaining Steam's real achievement list and icons at 0%.
- Replays every already-earned achievement notification once when each linked game is first launched after installing this version; later sessions notify only genuine new unlocks, and Library browsing never consumes the replay.


## v2.0.0 - Reliable Linking, Native Library Isolation & Interactive Cards

- Makes first-time linking persistent without restarting Steam by completing identity, artwork and mapping work in a background-safe queue.
- Rebuilds automatic shortcut detection around verified executable evidence, ambiguity gaps and reviewable candidates instead of treating aliases as proof.
- Adds candidate artwork to both the automatic linking modal and shortcut Properties, with localized success and missing-asset reports.
- Adds official Steam artwork recovery plus optional SteamGridDB fallback for missing library assets, with stricter provider and asset selection validation.
- Centralizes retryable frontend requests so temporary startup, Store or IPC failures are not cached until Steam restarts.
- Introduces generation-based Library navigation and complete native-style restoration to prevent flicker, stale injections and changes leaking into native Steam games.
- Improves localized activity, achievements, cloud/playtime status, community content, notes, DLC and responsive primary-link rendering.
- Adds Steam-like interactive trading cards with centered expansion, bounded 3D tilt, cursor lighting and metadata-gated foil holographic reflection.
- Adds canonical playtime session persistence, atomic achievement-path writes, faster Base64 artwork decoding and bounded backend caches.
- Expands source, localization, detection-fixture, TypeScript, Lua and generated-bundle validation under `npm run verify`.

## v1.5.0 - Stable Release & Performance / Cache Parity

- **Instant Cache Rendering (0ms):** Synchronous localized metadata retrieval without IPC delays on library navigation.
- **Cross-Game Cache Bug Fix:** Stale URL shortcut AppIDs are validated against the active document's title to prevent wrong-game metadata flashing on cold start.
- **Immediate Achievement Rendering:** Local achievements and playbar stats render immediately from cache upon navigation.
- **Parallelized Dynamic Streams:** News, friend activity, community items, and achievements load asynchronously in parallel without blocking each other.
- **Native Steam UI Parity & Bug Fixes:** Cloned native `<h2>` heading for Activity section, fixed styling for status composer and major event cards, responsive quick-link bar, and cleaned community section header.

> **Versioning note:** `v2.6.0-alpha.1` and `v2.6.0-alpha.2` below were
> internal development milestones only. They were never published or distributed
> as plugin releases. `v1.5.0` was the previous public release and `v2.0.0` is
> the current public release line.


## v1.0.0

- Initial release: link non-Steam shortcuts to a Steam AppID to show real artwork, news, friend activity, achievements, and community content in the library.

## Adaptación ES - navegación dinámica de logros vinculados
- El panel lateral **LOGROS** ahora abre los logros reales del AppID de Steam vinculado al juego actual.
- El AppID se toma dinámicamente del mapeo del juego; no está fijado a DRAGON BALL: Sparking! ZERO.
- La barra superior de **LOGROS** usa la misma ruta dinámica.
- Se usa la página pública `steamcommunity.com/stats/<AppID>/achievements`, que funciona aunque el acceso directo no posea la licencia Steam.
- Se conserva el idioma detectado por Steam al abrir la página de logros.

## Adaptación ES - notas de parche externas
- NOTAS DEL PARCHE ya no clasifica los lanzamientos de contenido/DLC (event_type 30) como parches.
- Añade las actualizaciones oficiales de DRAGON BALL: Sparking! ZERO del 29/07/2026 y 07/08/2026, ausentes del feed de anuncios de Steam.
- Fusiona y ordena las notas por fecha sin duplicarlas; el DLC permanece en ACTIVIDAD.

## Local achievements Steam UI
- Lee dinámicamente `C:\Steam Auto\<AppID>\achievements.json` para el AppID vinculado.
- Añade progreso local real a la barra superior de LOGROS.
- Sustituye el panel lateral simple por una vista estilo Steam con logros desbloqueados/bloqueados.
- Añade modal estilo Steam con MIS LOGROS / LOGROS GLOBALES, búsqueda, fechas y progreso parcial.
- Obtiene metadatos localizados desde Steam y soporta definiciones locales para asociación exacta.
- No modifica archivos de progreso ni datos de la cuenta Steam.
