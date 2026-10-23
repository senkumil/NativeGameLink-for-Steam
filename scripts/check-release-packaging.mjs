import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url));
const temporaryParent = await fs.realpath(os.tmpdir());
const fixture = await fs.mkdtemp(path.join(temporaryParent, 'ngl-release-packaging-'));
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks += 1; };
const runtime = [
  'plugin.json', '.millennium/Dist/index.js', 'backend/main.lua', 'backend/lib/config.lua',
  'backend/src/steam_card_farmer.cs', 'backend/src/steam_card_farmer.ps1',
  'backend/src/steam_achievement_sync.cs', 'backend/src/steam_achievement_sync.ps1',
];
const forbidden = [
  'backend/bin/helper.exe', 'backend/obj/build.json', 'backend/logs/session.txt',
  'backend/.env', 'backend/.env.production', 'backend/nested/mappings.json',
  'backend/nested/COMMUNITY_ITEM_OPTIONS.JSON', 'backend/nested/error.log',
  'backend/nested/session.tmp', 'backend/nested/state.bak', 'backend/nested/archive.zip',
  'backend/nested/helper.dll', 'backend/.cache/entry.json',
  'frontend/node_modules/module/index.js', 'frontend/coverage/report.json',
  'frontend/cache/data.json', '.millennium/Dist/private.env',
  '.millennium/.env.local', 'scripts/.npmrc', 'tests/__pycache__/fixture.pyc',
];

async function write(relative, content = 'fixture') {
  const full = path.join(fixture, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

async function exists(relative) {
  return fs.access(path.join(fixture, relative)).then(() => true, () => false);
}

function prepare(tag = 'v5.0.0', extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...(tag ? [`--tag=${tag}`] : [])], {
    cwd: fixture, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '', ...extraEnv },
  });
}

try {
  const manifest = JSON.stringify({ name: 'NativeGameLinkForSteam', version: '5.0.0' });
  await write('package.json', JSON.stringify({ version: '5.0.0' }));
  await write('package-lock.json', JSON.stringify({ version: '5.0.0', packages: { '': { version: '5.0.0' } } }));
  await write('plugin.source.json', manifest);
  for (const relative of runtime) await write(relative, relative === 'plugin.json' ? manifest : 'fixture');
  for (const relative of ['README.md', 'README_ES.md', 'LICENSE', 'CHANGELOG.md', 'WEEKLY_FIXES.md',
    'frontend/index.tsx', 'scripts/build-plugin.mjs', '.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    await write(relative);
  }
  await write('RELEASE_NOTES.md', '# NativeGameLink for Steam v5.0.0\n');
  await write('RELEASE_NOTES_ES.md', '# NativeGameLink for Steam v5.0.0\n');
  await write('release/previous-release.zip', 'preserve previous archive');
  await write('release/SHA256SUMS.txt', 'preserve previous checksums');
  await write('release/staging/old-output.txt', 'stale generated output');
  for (const relative of forbidden) await write(relative);
  await write('protected-directory/sentinel.txt', 'protected');
  await fs.symlink(path.join(fixture, 'protected-directory'), path.join(fixture, 'backend/linked-state'),
    process.platform === 'win32' ? 'junction' : 'dir');

  let result = prepare();
  check(result.status === 0, result.stderr || result.stdout);
  check(await exists('release/previous-release.zip'), 'preparation must preserve existing release archives');
  check(await exists('release/SHA256SUMS.txt'), 'preparation must preserve previous checksums');
  check(!(await exists('release/staging/old-output.txt')), 'preparation must remove stale staging');
  for (const kind of ['clean', 'source']) {
    const packageRoot = `release/staging/${kind}/NativeGameLinkForSteam`;
    for (const relative of runtime) check(await exists(`${packageRoot}/${relative}`), `${kind} includes ${relative}`);
    for (const relative of ['CHANGELOG.md', 'RELEASE_NOTES.md', 'RELEASE_NOTES_ES.md', 'WEEKLY_FIXES.md']) {
      check(await exists(`${packageRoot}/${relative}`), `${kind} includes ${relative}`);
    }
    for (const relative of forbidden) {
      check(!(await exists(`${packageRoot}/${relative}`)), `${kind} must exclude ${relative}`);
    }
    check(!(await exists(`${packageRoot}/backend/linked-state`)), `${kind} must exclude redirected source directories`);
  }
  check(!(await exists('release/staging/clean/NativeGameLinkForSteam/frontend')), 'clean installation excludes frontend source');

  // Version/document failures must happen before discarding an existing stage.
  await write('release/staging/sentinel.txt', 'preserve on rejected input');
  result = prepare('v4.0.3');
  check(result.status !== 0 && result.stderr.includes('does not match'), 'mismatched release tags are rejected');
  check(await exists('release/staging/sentinel.txt'), 'tag mismatch preserves existing staging');
  await write('package-lock.json', JSON.stringify({ version: '4.0.3', packages: { '': { version: '4.0.3' } } }));
  result = prepare();
  check(result.status !== 0 && result.stderr.includes('Version mismatch'), 'stale lockfile metadata is rejected');
  check(await exists('release/staging/sentinel.txt'), 'lockfile mismatch preserves existing staging');
  await write('package-lock.json', JSON.stringify({ version: '5.0.0', packages: { '': { version: '5.0.0' } } }));
  await write('RELEASE_NOTES.md', '# NativeGameLink for Steam v4.0.3\n');
  result = prepare();
  check(result.status !== 0 && result.stderr.includes('must identify v5.0.0'), 'stale release notes are rejected');
  check(await exists('release/staging/sentinel.txt'), 'stale notes preserve existing staging');
  await write('RELEASE_NOTES.md', '# NativeGameLink for Steam v5.0.0\n');
  await fs.rm(path.join(fixture, 'backend/src/steam_card_farmer.ps1'));
  result = prepare();
  check(result.status !== 0 && result.stderr.includes('Required release file is missing'), 'missing runtime helpers are rejected');
  check(await exists('release/staging/sentinel.txt'), 'missing runtime files preserve existing staging');
  await write('backend/src/steam_card_farmer.ps1');
  result = prepare('', { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' });
  check(result.status === 0, 'branch names must never become release tags');

  // A redirected staging directory must never cause deletion of its target.
  const external = path.join(fixture, 'protected-directory');
  await write('protected-directory/sentinel.txt', 'protected');
  const staging = path.resolve(fixture, 'release/staging');
  check(path.relative(fixture, staging) === path.join('release', 'staging'), 'test deletion resolves to fixture staging');
  await fs.rm(staging, { recursive: true, force: true });
  await fs.symlink(external, staging, process.platform === 'win32' ? 'junction' : 'dir');
  result = prepare();
  check(result.status !== 0 && /real directory|redirected/.test(result.stderr), 'linked staging is rejected before deletion');
  check(await exists('protected-directory/sentinel.txt'), 'rejected staging link preserves its target');
  await fs.unlink(staging);

  const release = path.resolve(fixture, 'release');
  check(path.relative(fixture, release) === 'release', 'test deletion resolves to fixture release');
  await fs.rm(release, { recursive: true, force: true });
  await fs.symlink(external, release, process.platform === 'win32' ? 'junction' : 'dir');
  result = prepare();
  check(result.status !== 0 && /real directory|redirected/.test(result.stderr), 'linked release root is rejected before deletion');
  check(await exists('protected-directory/sentinel.txt'), 'rejected release link preserves its target');
  await fs.unlink(release);

  console.log(`Release packaging passed: ${checks} checks; runtime helpers, release notes, local-state exclusion, version checks and bounded staging cleanup.`);
} finally {
  const resolved = await fs.realpath(fixture);
  const relative = path.relative(temporaryParent, resolved);
  assert(relative.startsWith('ngl-release-packaging-') && !relative.includes(path.sep), 'cleanup stays within the dedicated temporary fixture');
  await fs.rm(resolved, { recursive: true, force: true });
}
