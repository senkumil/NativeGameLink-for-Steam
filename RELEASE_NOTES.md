# NativeGameLink for Steam v5.0.0

Official release · October 23, 2026

Version 5.0 brings a more consistent Steam Library interface, more reliable game linking, reorganized Properties, local trading-card and badge preferences, and improvements across Desktop and Big Picture.

## Library and Properties

- Reorganize linked-game Properties into four compact, expandable groups: linked game, launch and playtime, achievements, and trading cards/badges.
- Show the confirmed linked identity while reviewing another candidate, remove the duplicate candidate thumbnail, and improve keyboard and narrow-window navigation.
- Hide trading-card/badge settings when a complete catalog confirms the game has neither. Loading failures and partial catalogs remain recoverable through retry.
- Preserve Steam's community grid, card dimensions and aligned rows. Prioritize videos, guides and images with ordinary proportions at the beginning when available; defer portrait and panoramic images. Videos occupy one grid cell, allowing adjacent content.
- Correct spacing between Activity and Community, the native activity footer and composer layout, and avoid an extra background layer on achievements and controller sections.
- Improve the Information drawer, native feature icons, responsive primary links and overflow menu, back-to-top timing/icon, achievement geometry and playbar width handling.
- Recover native styles on a cold start and restore sidebar sections when Steam replaces their DOM.

## Trading cards and badges

- Add per-shortcut preferences for regular/foil collections, individual cards and badge levels, shared between Desktop and Big Picture.
- Load native Steam item definitions first, with progressive public-catalog fallbacks; fetch cards and badges independently and retain known content during partial responses or temporary failures.
- Fix regular/foil detection, pagination, duplicate entries and false empty catalogs from login or challenge pages.
- Keep preferences isolated by shortcut and linked AppID, serialize saves, reject stale responses and synchronize confirmed changes across windows.
- Improve card hover, lighting, foil presentation, badge labels, image-failure fallbacks and viewport-aware tooltips.

These preferences affect local presentation. They do not add Steam inventory items, account XP or ownership.

## Linking, detection and recovery

- Display the full executable path and use the actual selected shortcut's executable, working directory and launch arguments. Preserve explicitly empty launch arguments.
- Improve title normalization, concatenated executable names, Unicode, years, editions and sequel disambiguation. Reject invalid candidates before ranking and avoid treating unconfirmed results as authoritative.
- Start local detection promptly, share bounded remote-request budgets, recover valid late local results and keep candidates available while retrying the same game.
- Confirm shortcut name/executable and regenerated IDs before completion; recover interrupted jobs and distinguish cancellation from success.
- Allow a confirmed link to finish when optional artwork is unavailable, then retry those resources in the background.
- Fence artwork, icon, logo and rename writes against expired jobs and unlink/relink races so old work cannot overwrite a newer link.
- Protect and restore existing `steam_appid.txt` content, report restoration conflicts, and offer recovery rather than silently discarding failures.
- Discover native artwork stores by capabilities instead of fixed internal module IDs, including signed/unsigned shortcut IDs and the correct owning Steam window.

## Achievements, Big Picture and resource lifecycle

- Prevent the achievement slider from reverting to old polling or save results; synchronize the latest preview between Properties and the Library with explicit rollback after save failure.
- Improve achievement sidebar/modal sizing across pane widths and zoom while retaining schema order and hidden-achievement behavior.
- Improve Big Picture tab transitions, controller focus, virtual-keyboard recovery, shortcut-specific notes/media identity and playtime presentation.
- Preserve known card catalogs during Big Picture hydration and expose loading/error/retry states for local preferences.
- Release observers, listeners, retries and per-document resources on teardown; bound retired backend caches and cancel delayed helper startup correctly.

This major release also includes the Big Picture integration prepared before the October 19–23 fix window; the weekly inventory identifies that earlier work separately.

## Download and install

1. Install Millennium for Steam.
2. Download **`NativeGameLinkForSteam-v5.0.0-CLEAN-INSTALL.zip`**.
3. Copy the enclosed **`NativeGameLinkForSteam`** folder into your active Steam installation's `millennium/plugins/` directory.
4. Restart Steam and enable the plugin in Millennium.

**`NativeGameLinkForSteam-v5.0.0-SOURCE.zip`** includes the source, tests and release tooling. Use **`SHA256SUMS.txt`** to verify the ZIP downloads.

See [the changelog](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/CHANGELOG.md), [Spanish release notes](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/RELEASE_NOTES_ES.md), and [the complete weekly fix inventory](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/WEEKLY_FIXES.md). The weekly inventory separates commits dated October 19–23 from the additional local changes included in this release.
