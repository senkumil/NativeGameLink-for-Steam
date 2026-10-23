import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const version = String(process.argv[2] || '').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: npm run version:set -- 5.0.0');
  process.exit(1);
}

async function updateJson(relative, mutate) {
  const file = path.join(root, relative);
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  mutate(data);
  await fs.writeFile(file, JSON.stringify(data, null, '\t') + '\n');
}

await updateJson('package.json', data => { data.version = version; });
await updateJson('plugin.source.json', data => { data.version = version; });
await updateJson('plugin.json', data => { data.version = version; });
await updateJson('package-lock.json', data => {
  data.version = version;
  if (data.packages?.['']) data.packages[''].version = version;
});

console.log(`NativeGameLink for Steam version synchronized to ${version}.`);
