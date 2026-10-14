import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const cache = new Map();
let transient = false;
const orderContext = vm.createContext({ exports: {}, URL });
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/community-order.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, orderContext);
const communityPayload = Array.from({ length: 100 }, (_, index) => ({
  type: index < 20 ? 'guide' : index < 40 ? 'screenshot' : 'video',
  image: `https://cdn.example.com/community/${index}.jpg`,
  title: `Community post ${index}`, link: `https://steamcommunity.com/sharedfiles/filedetails/?id=${1000 + index}`,
}));
communityPayload.push(...communityPayload.slice(0, 20));
const announcement = {gid:'1',title:'Official update',date:1700000000,contents:'Patch details',
  feedname:'steam_community_announcements',is_external_url:true,url:'https://store.steampowered.com/news/app/1593500/view/1'};
const modules = {
  '../../api/backend': {backendLog(){},
    fetchCommunityContentBackend:async()=>JSON.stringify({items:communityPayload}),
    fetchPartnerEventsBackend:async()=>JSON.stringify({items:[],unavailable:true}),
    fetchNewsBackend:async()=>JSON.stringify(transient ? {items:[],transient_error:true} : {items:[announcement,
      {...announcement,gid:'2',title:'Not Steam',url:'https://steampowered.com.example.org/news'}]})},
  '../../core/cache': {CACHE_TTL:{news:1000,communityContent:1000},CACHE_RETENTION:{},cacheRead:()=>null,cacheGet:k=>cache.get(k)??null,cacheSet:(k,v)=>cache.set(k,v)},
  '../../core/request-cache': {RetryingRequestCache:class {peek(){return null;} get(k,load){return load();}}},
  '../../core/game-data': {getSynchronousGameData:()=>null},
  '../../steam/localization': {gdlText:(k,f)=>f,loc:(k,f)=>f,steamIntlLocale:()=> 'en-US',steamLanguageSync:()=> 'english'},
  './community-order': orderContext.exports,
};
const context = vm.createContext({exports:{},URL,setTimeout,clearTimeout,require:name=>{
  if(!modules[name]) throw Error(name); return modules[name];
}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/news.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,context);
const metadata={name:'God of War',release_date:{date:'Jan 14, 2022'}};
const {newsExcerpt}=context.exports;
// Exact official body of the user-reported Sparking! ZERO announcement.
const trailerOnly='[previewyoutube=cfoprhQ69Fo;full][/previewyoutube]\n\nhttps://store.steampowered.com/app/1790600/DRAGON_BALL_Sparking_ZERO/?l=french';
assert.equal(newsExcerpt(trailerOnly),'','media-only news has no invented prose or raw URL excerpt');
assert.equal(newsExcerpt('[url=https://store.steampowered.com/app/10][img]https://cdn.example.com/banner.jpg[/img][/url]\nhttps://store.steampowered.com/app/10'),'');
assert.equal(newsExcerpt('[img]https://cdn.example.com/banner.jpg[/img]\nPatch notes: Combat improvements are now available.'),'Patch notes: Combat improvements are now available.');
assert.equal(newsExcerpt('[url=https://example.com/notes]Full patch notes[/url] — stability improvements.'),'Full patch notes — stability improvements.');
assert.equal(newsExcerpt('<p>Combat fixes.</p><p><a href="https://example.com/notes">Read the notes</a></p>'),'Combat fixes. Read the notes');
assert.equal(newsExcerpt('https://store.steampowered.com/app/10\nNew fighters arrive today.'),'New fighters arrive today.');
assert.equal(newsExcerpt('New fighters arrive today.\nhttps://store.steampowered.com/app/10'),'New fighters arrive today.');
assert.equal(newsExcerpt('[img]https://cdn.example.com/'+'x'.repeat(400)+'.jpg[/img] The actual announcement remains readable.',50),'The actual announcement remains readable.');
assert.equal(newsExcerpt('[h2]Update[/h2][list][*]Combat fixes[*]Stability[/list]'),'Update Combat fixes Stability');
assert.equal(newsExcerpt('&lt;p&gt;New fighters &amp; stages&lt;/p&gt;'),'New fighters & stages');
assert.equal(newsExcerpt('<iframe src="https://www.youtube.com/embed/video">Unsupported video</iframe> https://store.steampowered.com/app/10'),'');
assert.equal(newsExcerpt('A useful sentence. Another sentence describes a longer list of changes.',32),'A useful sentence.');
const localization=modules['../../steam/localization'];
const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const feedModules={
  '../../../api/backend':{backendLog(){}}, '../../../core/text':{escapeHtml},
  '../../../steam/css':{EVENT_CLASSES:()=>({}),FEED_CLASSES:()=>({})},
  '../../../steam/localization':localization,'../news':context.exports,
  '../../../steam/social':{},'./personas':{},'./host':{},
};
const feedContext=vm.createContext({exports:{},window:{},localStorage:{getItem:()=>null},require:name=>{
  if(!(name in feedModules)) throw Error(name);return feedModules[name];
}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/social/feed.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,feedContext);
const trailerNews={...announcement,contents:trailerOnly,event_type:28,image:'https://cdn.example.com/trailer.jpg'};
const trailerCard=feedContext.exports.renderUnifiedActivityFeed('1790600','3000000000',[trailerNews],'');
assert(trailerCard.includes('gdl-news-summary">Read more</div>'),'media-only desktop cards show the localized action instead of a raw URL');
assert(!trailerCard.includes('?l=french'));
assert(trailerCard.includes(`data-gdl-open-url="${announcement.url}"`),'the card still opens the original announcement');
const proseCard=feedContext.exports.renderUnifiedActivityFeed('1790600','3000000000',[{...trailerNews,contents:'Combat improvements are available.'}],'');
assert(proseCard.includes('gdl-news-summary">Combat improvements are available.</div>'),'real descriptions remain visible');
const react={createElement:(type,props,...children)=>({type,props,children})};
const bigPictureModules={
  react,'@steambrew/client':{IconsModule:{},Focusable(){},DialogButton(){}},
  '../../steam/localization':localization,'../../steam/navigation':{},'../library/news':context.exports,
  '../library/social/feed':{},'../library/social/personas':{},'./gamepad-nav':{},'./editable-target':{},
  '../../steam/gamepad/virtual-keyboard':{},'../../steam/gamepad/components/AppDetailsNativeComponents':{},
};
const bigPictureContext=vm.createContext({exports:{},require:name=>{
  if(!(name in bigPictureModules)) throw Error(name);return bigPictureModules[name];
}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/big-picture/activity-section.tsx','utf8')+'\nexport { ActivityEventCard };',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true},
}).outputText,bigPictureContext);
const bigPictureCard=bigPictureContext.exports.ActivityEventCard({item:trailerNews,shortcut:{steamAppId:'1790600'},data:{},classes:{ActivityEvent:{}},document:{}});
assert(JSON.stringify(bigPictureCard).includes('Read more'),'Big Picture uses the same media-only fallback');
assert(!JSON.stringify(bigPictureCard).includes('?l=french'));
const items=await context.exports.getNews('1593500','english',metadata);
assert.equal(items.length,1);
assert.equal(items[0].gid,'1','official external-flag announcement must survive');
cache.clear(); transient=true;
await context.exports.getNews('1593500','english',metadata);
assert.equal(cache.size,0,'unavailable partner endpoint must not persist a transient news fallback');
const community = await context.exports.getCommunityContent('12110', 'english');
assert.equal(community.length,80,'the render cap applies after global deduplication and proportional mixing');
assert.equal(new Set(community.map(item=>item.link)).size,80,'cross-subsection duplicates cannot consume the community item budget');
assert(community.slice(0,8).some(item=>item.type==='video') && community.slice(-8).some(item=>item.type!=='video'),
  'supplemental videos appear throughout the first cached page instead of collecting in an artificial tail');
assert.equal(await context.exports.getCommunityContent('12110','english'),community,'the normalized mixed snapshot is reused from cache');
console.log('News runtime: official announcements retained, spoofed hosts rejected, transient fallback not persisted; trailer/image-only excerpts, labeled links, prose, paragraph breaks and truncation verified');

