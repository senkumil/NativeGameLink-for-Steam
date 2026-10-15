// Exercise the production Library entry before pending Steam artwork decodes.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-linked-first-content-browser.mjs');
const result = spawnSync(process.execPath, [script], { env: { ...process.env, LINKED_PREPAINT_ONLY: '1' },
  stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
