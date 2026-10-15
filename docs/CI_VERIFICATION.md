# Verification environments

Run `npm ci` and `npm run verify` locally on Windows with Steam installed to run
both portable checks and contracts against the installed Steam UI.

GitHub's Ubuntu runners install the locked Playwright dependency and its Chromium
browser. Portable DOM tests use that browser rather than a Windows Edge path.

The workflows explicitly set `NGL_INSTALLED_STEAM_CHECKS=unavailable`. Tests that
read Steam's proprietary UI bundles, React runtime or CSS report `SKIP` with the
script name. These contracts still run locally without that variable. A green
hosted build verifies the portable suite and production build, not compatibility
with a particular installed Steam client. Keep local contract verification before
publishing changes to native Steam integration.
