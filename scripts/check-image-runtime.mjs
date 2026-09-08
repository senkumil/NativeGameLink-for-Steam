import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let requests = 0;
let status = 404;
let now = Date.now();
const context = vm.createContext({
  exports: {}, URL, AbortController,
  Date: { now: () => now },
  setTimeout: callback => setTimeout(callback, 10), clearTimeout,
  // Headers arrive, then the body stalls until the deadline aborts it.
  fetch: async (_url, { signal }) => ({ ok: true, status: 200,
    blob: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  }),
  require: () => ({ fetchArtworkImageBackend: async () => {
    requests++;
    return JSON.stringify({ ok: false, status });
  } }),
});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/artwork-image.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { imageUrlToBase64, imageUrlKnownMissing } = context.exports;
const url = 'https://shared.steamstatic.com/store_item_assets/steam/apps/2957520/logo.png';
await imageUrlToBase64(url);
await imageUrlToBase64(url);
assert.equal(requests, 1, 'confirmed missing images must not be immediately re-requested');
assert.equal(imageUrlKnownMissing(url), true);
now += 61_000;
status = 503;
await imageUrlToBase64(url);
await imageUrlToBase64(url);
assert.equal(requests, 3, 'expired misses and transient errors remain retryable');
assert.equal(imageUrlKnownMissing(url), false);
await Promise.race([
  imageUrlToBase64('https://cdn.steamgriddb.com/test.png'),
  new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('body deadline was cleared at headers')), 1000); timer.unref(); }),
]);
console.log('Image runtime checks passed: 404 deduplication, expiry, transient retry and stalled body deadline.');
