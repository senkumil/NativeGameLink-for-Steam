import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const context = vm.createContext({ exports: {}, URL });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/community-order.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { orderCommunityItems: order } = context.exports;
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const card = (type, index, extra = {}) => ({ type, title: `${type}-${index}`, image: `https://images.steamusercontent.com/${type}/${index}.jpg`, ...extra });
const titles = items => Array.from(items, item => item.title);
const file = id => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
const pool = (type, count) => Array.from({ length: count }, (_, index) => card(type, index));

const majority = [...pool('video', 60), ...pool('screenshot', 8), ...pool('artwork', 7), ...pool('guide', 5)];
const majorityBefore = JSON.stringify(majority);
for (const item of majority) Object.freeze(item);
Object.freeze(majority);
const mixed = order(majority);
check(mixed.length === 80, 'A video-majority feed retains every unique source item');
check(JSON.stringify(majority) === majorityBefore, 'Ordering never changes the source array or item objects');
check(mixed.every(item => majority.includes(item)), 'Ordered items retain the original object identities');
const lastOther = Array.from(mixed).findLastIndex(item => item.type !== 'video');
check(mixed.length - lastOther - 1 <= 6, 'Sixty videos are spread throughout the feed instead of forming a long artificial tail');
for (const type of ['video', 'screenshot', 'artwork', 'guide']) {
  check(JSON.stringify(titles(mixed.filter(item => item.type === type))) === JSON.stringify(titles(majority.filter(item => item.type === type))),
    `The original ${type} ranking is preserved`);
}
check(JSON.stringify(titles(order(majority))) === JSON.stringify(titles(mixed)), 'Proportional ordering is deterministic across repeated renders');
check(JSON.stringify(titles(order(mixed))) === JSON.stringify(titles(mixed)), 'Ordering in both the fetch and render pipelines is idempotent');

const videoId = 'dQw4w9WgXcQ';
const aliases = [
  card('artwork', 'first', { link: file('12345678901234567890'), title: 'Keep Steam original' }),
  card('screenshot', 'dup', { link: 'http://www.steamcommunity.com/sharedfiles/filedetails?id=12345678901234567890&l=spanish#comment' }),
  card('artwork', 'steam-uri', { link: 'steam://url/CommunityFilePage/12345678901234567890' }),
  card('video', 'first', { link: file('445566'), youtube_id: videoId, title: 'Keep video original' }),
  card('video', 'short', { link: `https://youtu.be/${videoId}?si=tracking` }),
  card('video', 'embed', { link: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0` }),
  card('video', 'thumbnail', { image: `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp` }),
  card('video', 'watch', { link: `https://www.youtube.com/watch?v=${videoId}&t=12` }),
  card('video', 'shorts', { link: `https://www.youtube.com/shorts/${videoId}` }),
];
const deduplicated = order(aliases);
check(deduplicated.length === 2, 'Steam file IDs and YouTube aliases deduplicate across subsections and URL variants');
check(deduplicated.includes(aliases[0]) && deduplicated.includes(aliases[3]), 'The first ranked instance and its original payload win deduplication');
const bridgedAliases = [
  card('artwork', 'steam', { link: file('9001') }),
  card('video', 'bridge', { link: file('9001'), youtube_id: videoId }),
  card('video', 'youtube', { link: `https://youtu.be/${videoId}` }),
];
check(order(bridgedAliases).length === 1, 'A discarded duplicate still teaches the later YouTube alias of its Steam item');

const weakIdentities = [
  card('screenshot', 'a', { link: 'not a valid link' }),
  card('screenshot', 'b', { link: 'not a valid link' }),
  card('screenshot', 'c', { link: '' }),
  card('screenshot', 'd', { link: undefined }),
  card('screenshot', 'a', { link: undefined, title: 'Same exact image from another subsection' }),
  card('screenshot', 'none-a', { image: '', link: 'javascript:void(0)' }),
  card('screenshot', 'none-b', { image: '', link: undefined }),
];
check(order(weakIdentities).length === 6, 'Invalid or missing links never collapse unrelated images or items with no identity');
const sharedThumbnail = [card('guide', 'a', { link: file('10') }), card('guide', 'b', { link: file('11'), image: 'https://images.steamusercontent.com/guide/a.jpg' })];
check(order(sharedThumbnail).length === 2, 'Different published files remain distinct even when their preview image is identical');
const weakLinks = [
  card('artwork', 'a', { link: 'http://example.com/content?b=2&a=1#first' }),
  card('artwork', 'b', { link: 'https://example.com/content?a=1&b=2#second' }),
];
check(order(weakLinks).length === 1, 'A valid generic link fallback normalizes query order, protocol and fragments');
const foreignFile = [card('guide', 'steam', { link: file('22') }), card('guide', 'foreign', { link: 'https://evilsteamcommunity.com/sharedfiles/filedetails/?id=22' })];
check(order(foreignFile).length === 2, 'A foreign host cannot impersonate a Steam published-file identity');

const spanishPreordered = [
  card('guide', 'es-first'), card('video', 'es-first'), card('artwork', 'es-first'),
  card('guide', 'en-second'), card('video', 'en-second'), card('artwork', 'en-second'),
];
const localized = order(spanishPreordered);
for (const type of ['guide', 'video', 'artwork']) {
  check(JSON.stringify(titles(localized.filter(item => item.type === type))) === JSON.stringify(titles(spanishPreordered.filter(item => item.type === type))),
    `A preceding Spanish-language preference remains intact within ${type} items`);
}
const oneKind = pool('screenshot', 35);
check(JSON.stringify(titles(order(oneKind))) === JSON.stringify(titles(oneKind)), 'A feed containing one type preserves its source order exactly');
const unknownKind = [card('unknown', 0), card('screenshot', 1), card('unknown', 2)];
check(JSON.stringify(titles(order(unknownKind))) === JSON.stringify(titles(unknownKind)), 'Unknown media types share screenshot ordering without losing their payload');
check(order(pool('video', 180)).length === 120, 'The helper bounds source processing and output to 120 cards');
check(order([]).length === 0, 'An empty feed stays empty');
console.log(`Community order passed: ${checks} assertions; global identity deduplication, proportional mixing, deterministic source ranking and bounded input.`);
