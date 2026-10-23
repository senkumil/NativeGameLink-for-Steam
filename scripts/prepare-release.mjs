import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = await fs.realpath(process.cwd());
const releaseRoot = path.resolve(root, 'release');
const stagingRoot = path.resolve(releaseRoot, 'staging');
const cleanRoot = path.join(stagingRoot, 'clean', 'NativeGameLinkForSteam');
const sourceRoot = path.join(stagingRoot, 'source', 'NativeGameLinkForSteam');
const explicitTag = process.argv.find(arg => arg.startsWith('--tag='))?.slice('--tag='.length) || '';
const githubTag = process.env.GITHUB_REF_TYPE === 'tag' ? (process.env.GITHUB_REF_NAME || '') : '';
const requestedTag = explicitTag || githubTag;

const mutableRootFiles = new Set([
  'mappings.json', 'mappings.json.tmp', 'mappings.json.bak', 'mappings.backup.json',
  'achievement_base_path.txt', 'achievement_paths.json', 'achievement_options.json', 'community_item_options.json',
  'playtime_sessions.json', 'sessions.json', 'steam_appid.txt',
]);

const sourceRootFiles = [
  '.gitattributes', '.gitignore', '.prettierrc',
  'CHANGELOG.md', 'LICENSE', 'README.md', 'README_ES.md',
  'RELEASE_NOTES.md', 'RELEASE_NOTES_ES.md', 'WEEKLY_FIXES.md',
  'package.json', 'package-lock.json',
  'plugin.json', 'plugin.source.json',
  'tsconfig.json', 'tsconfig.check.json',
];
const sourceDirectories = ['.github', '.millennium', 'backend', 'frontend', 'scripts', 'tests'];
const releaseDocuments = ['CHANGELOG.md', 'RELEASE_NOTES.md', 'RELEASE_NOTES_ES.md', 'WEEKLY_FIXES.md'];
const runtimeFiles = [
  'plugin.json', '.millennium/Dist/index.js', 'backend/main.lua',
  'backend/src/steam_card_farmer.cs', 'backend/src/steam_card_farmer.ps1',
  'backend/src/steam_achievement_sync.cs', 'backend/src/steam_achievement_sync.ps1',
];
const excludedDirectories = new Set([
  '.git', 'node_modules', 'bin', 'obj', 'logs', 'cache', 'caches', '.cache',
  'coverage', '.nyc_output', '__pycache__', '.npm', '.pnpm-store', 'release',
]);

function allowedPackagePath(relative) {
  const segments = relative.replaceAll('\\', '/').toLowerCase().split('/');
  const basename = segments.at(-1);
  if (segments.some(segment => excludedDirectories.has(segment))) return false;
  if (mutableRootFiles.has(basename)) return false;
  if (basename === '.env' || basename.startsWith('.env.')) return false;
  if (['.npmrc', '.pypirc', 'log.txt', 'desktop.ini', 'thumbs.db', '.ds_store'].includes(basename)) return false;
  return !/\.(?:env|log|tmp|bak|swp|swo|exe|dll|pdb|ilk|tsbuildinfo|zip|rar|7z|tgz|tar(?:\.gz)?)$/i.test(basename);
}

function assertWithinWorkspace(target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Release output must stay inside the project workspace: ${target}`);
  }
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function resetStaging() {
  // Only generated staging is disposable. Existing release archives and their
  // checksums stay available while a new version is being prepared.
  for (const target of [releaseRoot, stagingRoot]) {
    assertWithinWorkspace(target);
    const stat = await fs.lstat(target).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Release output must be a real directory, not a link or file: ${target}`);
    }
    const resolved = await fs.realpath(target);
    assertWithinWorkspace(resolved);
    if (!samePath(resolved, target)) throw new Error(`Refusing redirected release output: ${target}`);
  }
  await fs.rm(stagingRoot, { recursive: true, force: true });
}

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
}

async function validateReleaseFile(relative) {
  const source = path.join(root, relative);
  if (!(await exists(source))) throw new Error(`Required release file is missing: ${relative}`);
  const stat = await fs.lstat(source);
  const resolved = await fs.realpath(source);
  if (!allowedPackagePath(relative) || !stat.isFile() || stat.isSymbolicLink() || !samePath(resolved, source)) {
    throw new Error(`Refusing forbidden or redirected release file: ${relative}`);
  }
}

async function copyFile(relative, destinationRoot) {
  const source = path.join(root, relative);
  await validateReleaseFile(relative);
  const destination = path.join(destinationRoot, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyDirectory(relative, destinationRoot) {
  const source = path.join(root, relative);
  if (!(await exists(source))) throw new Error(`Required release directory is missing: ${relative}`);
  const destination = path.join(destinationRoot, relative);
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    filter: async (entry) => {
      const rel = path.relative(root, entry).replaceAll('\\', '/');
      return allowedPackagePath(rel) && !(await fs.lstat(entry)).isSymbolicLink();
    },
  });
}

async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function validateVersions() {
  const pkg = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const sourceManifest = await readJson('plugin.source.json');
  const builtManifest = await readJson('plugin.json');
  const versions = new Set([pkg.version, lock.version, lock.packages?.['']?.version, sourceManifest.version, builtManifest.version]);
  if (versions.size !== 1) {
    throw new Error(`Version mismatch: package=${pkg.version}, lock=${lock.version}/${lock.packages?.['']?.version}, plugin.source=${sourceManifest.version}, plugin=${builtManifest.version}`);
  }
  if (sourceManifest.name !== 'NativeGameLinkForSteam' || builtManifest.name !== sourceManifest.name) {
    throw new Error('Release preparation must run from the NativeGameLinkForSteam project root.');
  }
  if (requestedTag) {
    const tagVersion = requestedTag.replace(/^v/, '');
    if (tagVersion !== pkg.version) {
      throw new Error(`Release tag ${requestedTag} does not match project version ${pkg.version}.`);
    }
  }
  return pkg.version;
}

async function validatePackageTree(packageRoot, label) {
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(packageRoot, full).replaceAll('\\', '/');
      if (entry.isSymbolicLink() || !allowedPackagePath(relative)) {
        throw new Error(`${label} package contains forbidden local/generated content: ${relative}`);
      }
      if (entry.isDirectory()) await visit(full);
    }
  }
  await visit(packageRoot);
}

async function validateCleanPackage() {
  const forbiddenTopLevel = ['frontend', 'scripts', 'tests', 'node_modules', 'package.json', 'package-lock.json', 'plugin.source.json'];
  for (const name of forbiddenTopLevel) {
    if (await exists(path.join(cleanRoot, name))) throw new Error(`Clean package leaked development content: ${name}`);
  }
  for (const name of mutableRootFiles) {
    if (await exists(path.join(cleanRoot, name))) throw new Error(`Clean package leaked mutable user state: ${name}`);
  }
  for (const required of [...runtimeFiles, ...releaseDocuments, 'README.md', 'README_ES.md', 'LICENSE']) {
    if (!(await exists(path.join(cleanRoot, required)))) throw new Error(`Clean package is missing required runtime file: ${required}`);
  }
  await validatePackageTree(cleanRoot, 'Clean');
}

async function validateSourcePackage() {
  for (const required of [...runtimeFiles, ...releaseDocuments, 'frontend/index.tsx', 'scripts/build-plugin.mjs', '.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    if (!(await exists(path.join(sourceRoot, required)))) throw new Error(`Source package is missing: ${required}`);
  }
  if (await exists(path.join(sourceRoot, 'node_modules'))) throw new Error('Source package must not contain node_modules.');
  for (const name of mutableRootFiles) {
    if (await exists(path.join(sourceRoot, name))) throw new Error(`Source package leaked mutable user state: ${name}`);
  }
  await validatePackageTree(sourceRoot, 'Source');
}

const version = await validateVersions();
for (const required of [...runtimeFiles, ...releaseDocuments, 'README.md', 'README_ES.md', 'LICENSE']) {
  await validateReleaseFile(required);
}
for (const relative of ['RELEASE_NOTES.md', 'RELEASE_NOTES_ES.md']) {
  const notes = await fs.readFile(path.join(root, relative), 'utf8');
  const heading = notes.match(/^# .+$/m)?.[0] || '';
  if (!heading.includes(`v${version}`)) throw new Error(`${relative} must identify v${version} in its title.`);
}
await resetStaging();
await fs.mkdir(cleanRoot, { recursive: true });
await fs.mkdir(sourceRoot, { recursive: true });

for (const file of ['plugin.json', 'LICENSE', 'README.md', 'README_ES.md', ...releaseDocuments]) await copyFile(file, cleanRoot);
await copyFile('.millennium/Dist/index.js', cleanRoot);
await copyDirectory('backend', cleanRoot);

for (const file of sourceRootFiles) {
  if (await exists(path.join(root, file))) await copyFile(file, sourceRoot);
}
for (const directory of sourceDirectories) await copyDirectory(directory, sourceRoot);

await validateCleanPackage();
await validateSourcePackage();

const cleanFiles = await walk(cleanRoot);
const sourceFiles = await walk(sourceRoot);
console.log(`Release staging ready for v${version}.`);
console.log(` - Clean install: ${cleanFiles.length} files -> ${path.relative(root, cleanRoot)}`);
console.log(` - Source: ${sourceFiles.length} files -> ${path.relative(root, sourceRoot)}`);
