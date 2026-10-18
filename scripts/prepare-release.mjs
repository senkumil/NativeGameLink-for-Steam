import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const releaseRoot = path.join(root, 'release');
const stagingRoot = path.join(releaseRoot, 'staging');
const cleanRoot = path.join(stagingRoot, 'clean', 'NativeGameLinkForSteam');
const sourceRoot = path.join(stagingRoot, 'source', 'NativeGameLinkForSteam');
const explicitTag = process.argv.find(arg => arg.startsWith('--tag='))?.slice('--tag='.length) || '';
const githubTag = process.env.GITHUB_REF_TYPE === 'tag' ? (process.env.GITHUB_REF_NAME || '') : '';
const requestedTag = explicitTag || githubTag;

const mutableRootFiles = new Set([
  'mappings.json', 'mappings.json.tmp', 'mappings.json.bak', 'mappings.backup.json',
  'achievement_base_path.txt', 'achievement_paths.json', 'achievement_options.json',
  'playtime_sessions.json', 'sessions.json', 'steam_appid.txt',
]);

const sourceRootFiles = [
  '.gitattributes', '.gitignore', '.prettierrc',
  'CHANGELOG.md', 'LICENSE', 'README.md', 'README_ES.md',
  'package.json', 'package-lock.json',
  'plugin.json', 'plugin.source.json',
  'tsconfig.json', 'tsconfig.check.json',
];
const sourceDirectories = ['.github', '.millennium', 'backend', 'docs', 'frontend', 'scripts', 'tests'];

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
}

async function copyFile(relative, destinationRoot) {
  const source = path.join(root, relative);
  if (!(await exists(source))) throw new Error(`Required release file is missing: ${relative}`);
  const destination = path.join(destinationRoot, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyDirectory(relative, destinationRoot, filter = () => true) {
  const source = path.join(root, relative);
  if (!(await exists(source))) throw new Error(`Required release directory is missing: ${relative}`);
  const destination = path.join(destinationRoot, relative);
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const rel = path.relative(root, entry).replaceAll('\\', '/');
      return filter(rel);
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
  const sourceManifest = await readJson('plugin.source.json');
  const builtManifest = await readJson('plugin.json');
  const versions = new Set([pkg.version, sourceManifest.version, builtManifest.version]);
  if (versions.size !== 1) {
    throw new Error(`Version mismatch: package=${pkg.version}, plugin.source=${sourceManifest.version}, plugin=${builtManifest.version}`);
  }
  if (requestedTag) {
    const tagVersion = requestedTag.replace(/^v/, '');
    if (tagVersion !== pkg.version) {
      throw new Error(`Release tag ${requestedTag} does not match project version ${pkg.version}.`);
    }
  }
  return pkg.version;
}

async function validateCleanPackage() {
  const forbiddenTopLevel = ['frontend', 'scripts', 'tests', 'node_modules', 'package.json', 'package-lock.json', 'plugin.source.json'];
  for (const name of forbiddenTopLevel) {
    if (await exists(path.join(cleanRoot, name))) throw new Error(`Clean package leaked development content: ${name}`);
  }
  for (const name of mutableRootFiles) {
    if (await exists(path.join(cleanRoot, name))) throw new Error(`Clean package leaked mutable user state: ${name}`);
  }
  for (const required of ['plugin.json', '.millennium/Dist/index.js', 'backend/main.lua', 'README.md', 'LICENSE', 'docs/BIG_PICTURE_BASES.md']) {
    if (!(await exists(path.join(cleanRoot, required)))) throw new Error(`Clean package is missing required runtime file: ${required}`);
  }
  const files = await walk(cleanRoot);
  for (const file of files) {
    const basename = path.basename(file);
    if (mutableRootFiles.has(basename)) throw new Error(`Clean package contains forbidden state file: ${path.relative(cleanRoot, file)}`);
    if (/\.(?:zip|rar|7z|tar\.gz)$/i.test(basename)) throw new Error(`Clean package contains nested archive: ${path.relative(cleanRoot, file)}`);
  }
}

async function validateSourcePackage() {
  for (const required of ['frontend/index.tsx', 'scripts/build-plugin.mjs', '.github/workflows/ci.yml', '.github/workflows/release.yml', '.millennium/Dist/index.js', 'plugin.json', 'docs/BIG_PICTURE_BASES.md']) {
    if (!(await exists(path.join(sourceRoot, required)))) throw new Error(`Source package is missing: ${required}`);
  }
  if (await exists(path.join(sourceRoot, 'node_modules'))) throw new Error('Source package must not contain node_modules.');
  for (const name of mutableRootFiles) {
    if (await exists(path.join(sourceRoot, name))) throw new Error(`Source package leaked mutable user state: ${name}`);
  }
}

const version = await validateVersions();
await fs.rm(releaseRoot, { recursive: true, force: true });
await fs.mkdir(cleanRoot, { recursive: true });
await fs.mkdir(sourceRoot, { recursive: true });

for (const file of ['plugin.json', 'LICENSE', 'README.md', 'README_ES.md']) await copyFile(file, cleanRoot);
await copyFile('.millennium/Dist/index.js', cleanRoot);
await copyDirectory('backend', cleanRoot, rel => !/(?:^|\/)obj(?:\/|$)|(?:^|\/)bin(?:\/|$)/i.test(rel));
await copyDirectory('docs', cleanRoot, rel => !/^docs\/screenshots(?:\/|$)/.test(rel));

for (const file of sourceRootFiles) {
  if (await exists(path.join(root, file))) await copyFile(file, sourceRoot);
}
for (const directory of sourceDirectories) {
  await copyDirectory(directory, sourceRoot, rel => {
    const normalized = rel.replaceAll('\\', '/');
    if (/^docs\/screenshots(?:\/|$)/.test(normalized)) return false;
    if (normalized.includes('/node_modules/')) return false;
    if (normalized.startsWith('release/')) return false;
    if (normalized.includes('/coverage/')) return false;
    if (normalized.includes('/.cache/')) return false;
    return true;
  });
}

await validateCleanPackage();
await validateSourcePackage();

const cleanFiles = await walk(cleanRoot);
const sourceFiles = await walk(sourceRoot);
console.log(`Release staging ready for v${version}.`);
console.log(` - Clean install: ${cleanFiles.length} files -> ${path.relative(root, cleanRoot)}`);
console.log(` - Source: ${sourceFiles.length} files -> ${path.relative(root, sourceRoot)}`);
