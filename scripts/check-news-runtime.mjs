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
  '../../../steam/css':{EVENT_CLASSES:()=>({}),FEED_CLASSES:()=>({}),HEADING_RESET_CLASSES:()=>({Reset:'_3A_c3YHYd4YIjA8Y-olnPl'})},
  '../../../steam/localization':localization,'../news':context.exports,
  '../../../steam/social':{},'./personas':{},'./host':{},
  '../activity-summary':{installNativeActivitySummaryClamps:()=>()=>{}},
};
const footerContext=vm.createContext({exports:{},require:name=>name.endsWith('/css')?feedModules['../../../steam/css']:name.endsWith('/text')?{escapeHtml}:localization});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/activity-footer.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,footerContext);
feedModules['../activity-footer']=footerContext.exports;
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
const retained = feedContext.exports.getRetainedActivityNews('1790600');
assert.equal(retained[0].gid, trailerNews.gid, 'The retained getter reuses the existing feed snapshot');
assert.equal(feedContext.exports.getRetainedActivityNews('9999999'), null, 'The retained getter does not manufacture another cache entry');
const genericMetadata = {gid:'gdl-steam-release-1790600',title:'Synthetic release preview',date:1600000000,
  contents:'Generic Store summary',feedname:'steam_store_release_metadata',url:'https://store.steampowered.com/app/1790600'};
const retainedCard = feedContext.exports.renderUnifiedActivityFeed('1790600','3000000000',[genericMetadata],'');
assert(retainedCard.includes('Combat improvements are available.'), 'A generic metadata preview cannot replace retained real posts');
assert(!retainedCard.includes('Synthetic release preview'));
const activityEnriched = feedContext.exports.renderUnifiedActivityFeed('1790600','3000000000',[],'',[
  {id:'friend-1',date:1700000010,html:'<div>Friend activity arrived</div>'},
]);
assert(activityEnriched.includes('Combat improvements are available.') && activityEnriched.includes('Friend activity arrived'),
  'Independent friend hydration keeps the newest retained news even when its captured news input is empty');
const react={createElement:(type,props,...children)=>({type,props,children})};
const bigPictureModules={
  react,'@steambrew/client':{IconsModule:{},Focusable(){},DialogButton(){}},
  '../../steam/localization':localization,'../../steam/navigation':{},'../library/news':context.exports,
  '../library/social/feed':{},'../library/social/personas':{},'./gamepad-nav':{},'./editable-target':{},
  '../../steam/gamepad/virtual-keyboard':{},
  '../../steam/gamepad/document-ui-runtime':{getDocumentReact:()=>react},
  './document-primitives':{NativeIcons:{},NativeFocusable(){},NativeButton(){}},
  './owned-modals':{showBigPictureModal:()=>true},
  './detail-target':{isBigPictureActionCurrent:()=>true},
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
// Actual request-cache coalescing and deterministic source completion order.
// No network or elapsed-time assumption is involved in these checks.
let fixtureNow = Date.now();
const FixtureDate = class extends Date { static now() { return fixtureNow; } };
const requestContext = vm.createContext({exports:{},Date:FixtureDate,setTimeout,clearTimeout});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/core/request-cache.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,requestContext);
const progressiveStorage = new Map(), sourceRequests = [];
const deferSource = (kind,args) => new Promise(resolve => sourceRequests.push({kind,args,resolve}));
const progressModules = {
  ...modules,
  '../../api/backend':{backendLog(){},fetchNewsBackend:args=>deferSource('announcements',args),
    fetchPartnerEventsBackend:args=>deferSource('partner',args)},
  '../../core/cache':{CACHE_TTL:{news:1800000},CACHE_RETENTION:{news:86400000},
    cacheRead:key=>progressiveStorage.get(key)||null,
    cacheSet:(key,data)=>progressiveStorage.set(key,{data,fresh:true}),cacheDeleteMatching(){}},
  '../../core/request-cache':requestContext.exports,
};
const progressContext = vm.createContext({exports:{},Date:FixtureDate,URL,setTimeout,clearTimeout,
  require:name=>{assert(name in progressModules,name);return progressModules[name];}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/news.ts','utf8')
  +'\nexport const testPendingNewsProgress = pendingNewsProgress;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,progressContext);
const progressive = progressContext.exports;
const settleMicrotasks = async () => {for(let index=0;index<16;index++)await Promise.resolve();};
const partials = [], joinedPartials = [];
let terminalReady = false;
const flight = progressive.getNews('123','spanish',metadata,items=>partials.push(items))
  .then(items=>{terminalReady=true;return items;});
await settleMicrotasks();
const firstSources = sourceRequests.slice();
assert.equal(firstSources.length,4,'A localized cold feed starts its four existing sources once');
const source = (kind,language) => firstSources.find(item=>item.kind===kind&&item.args.language===language);
source('partner','english').resolve(JSON.stringify({items:[{gid:'42',title:'English fallback',date:1700000000,contents:'English body'}]}));
await settleMicrotasks();
assert.equal(terminalReady,false,'Publishing a useful source does not prematurely finish the terminal promise');
assert.equal(partials.at(-1)[0].title,'English fallback','A useful fallback source paints while sibling sources are pending');
assert.equal(progressiveStorage.size,0,'A partial feed is never persisted as fresh');
const joined = progressive.getNews('123','spanish',metadata,items=>joinedPartials.push(items));
const throwingListener = progressive.getNews('123','spanish',metadata,()=>{throw Error('Consumer callback failure');});
await settleMicrotasks();
assert.equal(sourceRequests.length,4,'Revisiting during a request joins the existing source work');
assert.equal(joinedPartials.at(-1)[0].title,'English fallback','A late subscriber immediately receives the useful in-flight snapshot');
source('announcements','spanish').resolve(JSON.stringify({items:[{...announcement,gid:'99',title:'Noticia rápida',date:1700000010}]}));
await settleMicrotasks();
assert.equal(partials.at(-1)[0].gid,'99','Partial snapshots keep newest-first chronology');
assert.equal(partials.at(-1).length,2,'Useful independent sources enrich the first partial snapshot');
source('partner','spanish').resolve(JSON.stringify({items:[{gid:'42',title:'Título localizado',date:1700000000,contents:'Texto español'}]}));
await settleMicrotasks();
assert.equal(partials.at(-1).filter(item=>item.gid==='42').length,1,'Localized sources deduplicate the English fallback by event identity');
assert.equal(partials.at(-1).find(item=>item.gid==='42').title,'Título localizado','Preferred-language precedence is independent of arrival order');
source('announcements','english').resolve(JSON.stringify({items:[
  {...announcement,gid:'777',title:'Заголовок другой новости',contents:'Текст другой новости'},
  {...announcement,gid:'778',title:'Spoofed publisher',url:'https://steampowered.com.attacker.example/news'},
]}));
const [complete,joinedComplete] = await Promise.all([flight,joined,throwingListener]);
assert.equal(complete.length,2,'Language and official-host filters also apply to progressive results');
assert.equal(JSON.stringify(complete),JSON.stringify(joinedComplete),'Joined callers receive the same complete chronology');
assert.equal(progressive.testPendingNewsProgress.size,0,'Terminal completion releases every subscriber and partial snapshot');
const beforeWarm = sourceRequests.length;
const warm = await progressive.getNews('123','spanish',metadata,items=>assert.equal(items.length,2));
assert.equal(warm.length,2);assert.equal(sourceRequests.length,beforeWarm,'A fresh cached revisit starts no additional sources');

const boundedCounts = Array.from({length:40},()=>0);
const boundedFlights = boundedCounts.map((_,index)=>progressive.getNews('321','spanish',metadata,()=>boundedCounts[index]++));
await settleMicrotasks();
assert.equal(progressive.testPendingNewsProgress.values().next().value.listeners.size,32,'An in-flight request retains at most 32 progress callbacks');
const boundedSources = sourceRequests.filter(item=>item.args.steam_app_id==='321');
boundedSources.find(item=>item.kind==='announcements'&&item.args.language==='spanish')
  .resolve(JSON.stringify({items:[announcement]}));
await settleMicrotasks();
assert(boundedCounts.slice(0,8).every(count=>count===0),'Superseded subscribers are evicted from the bounded progress set');
assert(boundedCounts.slice(8).every(count=>count===1),'The newest subscribers still receive the fast useful source');
for(const item of boundedSources) item.resolve(JSON.stringify({items:[],unavailable:true}));
await Promise.all(boundedFlights);
assert.equal(progressive.testPendingNewsProgress.size,0);

let invalidatedProgress = 0;
const invalidated = progressive.getNews('777','spanish',metadata,()=>invalidatedProgress++);
await settleMicrotasks();
progressive.invalidateLibraryContentCaches(['777']);
for(const item of sourceRequests.filter(item=>item.args.steam_app_id==='777')) item.resolve(JSON.stringify({items:[announcement]}));
await invalidated;
assert.equal(invalidatedProgress,0,'Explicit invalidation makes obsolete source progress inert');
assert.equal(progressive.testPendingNewsProgress.size,0,'Invalidation clears the subscriber registry');
const beforeRetired = sourceRequests.length;
const retiredFlight = progressive.getNews('888','spanish',{...metadata,is_delisted:true});
await settleMicrotasks();
const retiredSources = sourceRequests.slice(beforeRetired);
assert.equal(retiredSources.length,2,'A retired localized title starts only the two official announcement requests');
assert(retiredSources.every(item=>item.kind==='announcements'),'Retired titles never await Partner Events HTML');
for(const item of retiredSources) item.resolve(JSON.stringify({items:[],unavailable:true}));
await retiredFlight;
assert(progressiveStorage.has('events19_removed_spanish-en_888'),'An expected empty retired feed is persisted with its synthesized metadata card');
const afterRetired = sourceRequests.length;
await progressive.getNews('888','spanish',{...metadata,is_delisted:true});
assert.equal(sourceRequests.length,afterRetired,'A fresh empty retired feed does not repeat requests');
console.log('News runtime passed: progressive/coalesced four-source delivery, arrival-independent language precedence, ordering/deduplication, bounded callback cleanup, retained real feeds, official hosts and media excerpts.');

