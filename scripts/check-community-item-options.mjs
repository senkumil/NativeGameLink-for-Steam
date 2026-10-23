import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('frontend/core/community-item-options.ts','utf8'), {
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText + '\nexports.testEntryCount = doc => documents.get(doc)?.size || 0;';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const defaults=()=>({enabled:false,card_border:'normal',card_ids:[],badge_id:null});
const response=value=>JSON.stringify({ok:true,...value});
const selected=(id,border='normal')=>({enabled:true,card_border:border,card_ids:[id],badge_id:null});
const store=new Map(),views=new Set(),queuedStorageEvents=[];let deferStorageEvents=false;
class View extends EventTarget {
 document;closed=false;CustomEvent=CustomEvent;listeners=new Map();
 localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>{
  store.set(key,value);
  for(const view of views)if(view!==this){const event=new Event('storage');Object.defineProperties(event,{key:{value:key},newValue:{value}});
   if(deferStorageEvents)queuedStorageEvents.push(()=>view.dispatchEvent(event));else view.dispatchEvent(event);}
 }};
 addEventListener(type,fn,...args){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);super.addEventListener(type,fn,...args);}
 removeEventListener(type,fn,...args){this.listeners.get(type)?.delete(fn);super.removeEventListener(type,fn,...args);}
 get count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0)}
}
const document=()=>{const doc={};doc.defaultView=new View();doc.defaultView.document=doc;views.add(doc.defaultView);return doc;};
const reads=[],writes=[];
const timers=new Map();let timerSequence=0;
const setTimer=callback=>{const handle=++timerSequence;timers.set(handle,callback);return handle};
const clearTimer=handle=>timers.delete(handle);
const expireReads=()=>{for(const [handle,callback] of [...timers]){timers.delete(handle);callback()}};
let automaticReads=false;
function harness(){const exports={};vm.runInNewContext(source,{exports,URL,console,setTimeout:setTimer,clearTimeout:clearTimer,require:name=>{
 assert.equal(name,'../api/backend');return {
  getGameCommunityItemOptionsBackend:request=>{const item={...deferred(),request:JSON.parse(request.request_json)};reads.push(item);return automaticReads?Promise.resolve(response(defaults())):item.promise;},
  setGameCommunityItemOptionsBackend:request=>{const item={...deferred(),request:JSON.parse(request.request_json)};writes.push(item);return item.promise;},
 };
}});return exports;}
const api=harness(),a=document(),b=document(),c=document();
const local='3000000001',steam='550';
const sharedImage='https://community.cloudflare.steamstatic.com/economy/image/hashABC';
assert.equal(api.communityCardId({image:sharedImage}),api.communityCardId({image:sharedImage.replace('community.cloudflare.steamstatic.com','steamcommunity-a.akamaihd.net')+'/100x100'}));
assert.notEqual(api.communityCardId({image:sharedImage}),api.communityCardId({image:sharedImage,foil:true}));
assert.notEqual(api.communityBadgeId({image:sharedImage,level:1}),api.communityBadgeId({image:sharedImage,level:2}));
const sdkBadge='https://cdn.steamstatic.com/community_assets/images/items/1593500/samebadge.png';
const legacyBadge='https://cdn.steamstatic.com/steamcommunity/public/images/items/1593500/samebadge.png';
assert.equal(api.communityBadgeId({image:sdkBadge,level:5}),api.communityBadgeId({image:legacyBadge,level:5}),'official SDK and legacy badge routes for the same item hash have one stable identity');
assert.notEqual(api.communityBadgeId({image:sdkBadge,level:5}),api.communityBadgeId({image:sdkBadge.replace('/1593500/','/1593501/'),level:5}),'route aliases never merge badges from different games');
assert.notEqual(api.communityBadgeId({image:sdkBadge,level:5}),api.communityBadgeId({image:sdkBadge,level:5,foil:true}),'route aliases never merge normal and foil badges');
assert.equal(api.communityBadgeId({image:sdkBadge,level:0,foil:true}),api.communityBadgeId({image:legacyBadge,level:1,foil:true}),
 'the single foil badge retains one identity across native level zero, public level one and CDN routes');
await assert.rejects(api.getCommunityItemOptions(a,'0',steam),/scope/);
await assert.rejects(api.setCommunityItemOptions(a,local,steam,selected('bad\u0000id')),/Invalid community/);
await assert.rejects(api.setCommunityItemOptions(a,local,steam,{...selected('good'),card_border:['normal']}),/Invalid community/);
const luaDoc=document();
const luaDefaults=api.getCommunityItemOptions(luaDoc,'3000000042',steam);await tick();
reads.at(-1).resolve('{"ok":true,"enabled":false,"card_border":"normal","card_ids":{}}');
const luaResult=await luaDefaults;
assert(Array.isArray(luaResult.card_ids)&&luaResult.card_ids.length===0&&luaResult.badge_id===null,'Lua empty tables and omitted nil badge normalize to the typed defaults');
const migratedBadge=api.getCommunityItemOptions(luaDoc,'3000000044',steam);await tick();
reads.at(-1).resolve(response({...defaults(),enabled:true,badge_id:'badge:normal:5:/community_assets/images/items/1593500/samebadge.png'}));
assert.equal((await migratedBadge).badge_id,api.communityBadgeId({image:legacyBadge,level:5}),'previously saved SDK-route badge IDs normalize on authoritative reads without discarding the selection');
const migratedFoil=api.getCommunityItemOptions(luaDoc,'3000000049',steam);await tick();
reads.at(-1).resolve(response({...defaults(),enabled:true,card_border:'foil',badge_id:'badge:foil:1:/community_assets/images/items/1593500/samebadge.png'}));
assert.equal((await migratedFoil).badge_id,api.communityBadgeId({image:legacyBadge,level:0,foil:true}),
 'an existing public-source foil badge selection survives native definition hydration without a settings rewrite');
const malformedLua=api.getCommunityItemOptions(luaDoc,'3000000042',steam);await tick();
reads.at(-1).resolve('{"ok":true,"enabled":false,"card_border":"normal","card_ids":{"invalid":"not-an-array"}}');
await assert.rejects(malformedLua,/Invalid community/);
const lostDoc=document(),lostScope='3000000047';
const lost=api.getCommunityItemOptions(lostDoc,lostScope,steam).catch(error=>error);await tick();
const abandonedRead=reads.at(-1);expireReads();
assert.match(String(await lost),/timed out/,'a lost IPC reply retires the shared read instead of leaving every card consumer pending forever');
assert.equal(api.getCachedCommunityItemOptions(lostDoc,lostScope,steam),null,'timeout does not invent automatic preferences or claim cards are unlocked');
const recovered=api.getCommunityItemOptions(lostDoc,lostScope,steam);await tick();
reads.at(-1).resolve(response(selected('recovered-after-timeout')));await recovered;
abandonedRead.resolve(response(defaults()));await tick();
assert.equal(api.getCachedCommunityItemOptions(lostDoc,lostScope,steam).card_ids[0],'recovered-after-timeout','a read arriving after its deadline cannot overwrite the successful retry');
const closedDoc=document(),closedRead=api.getCommunityItemOptions(closedDoc,lostScope,steam).catch(error=>error);await tick();
closedDoc.defaultView.dispatchEvent(new Event('pagehide'));
assert.match(String(await closedRead),/replaced/,'closing a CEF retires its unresolved read immediately');
assert.equal(closedDoc.defaultView.count,0,'retired reads release page lifecycle listeners');
const autoDoc=document(),autoObserver=document(),autoScope='3000000046',autoChanges=[];
const stopAuto=api.subscribeCommunityItemOptions(autoObserver,autoScope,steam,value=>autoChanges.push(value));
const automatic=api.getCommunityItemOptions(autoDoc,autoScope,steam);await tick();
reads.at(-1).resolve('{"ok":true,"enabled":true,"card_border":"foil","card_ids":{},"auto_foil":true}');
const autoValue=await automatic;
assert.equal(autoValue.auto_foil,true,'The backend default retains its automatic foil preset through Lua wire normalization');
assert.equal(autoValue.card_border,'foil');
assert.equal(autoValue.badge_id,null);
assert.equal(autoChanges.at(-1).auto_foil,true,'Another CEF receives the confirmed automatic preset');
assert.equal(harness().getCachedCommunityItemOptions(document(),autoScope,steam).auto_foil,true,'The preset survives renderer restart without materializing an incomplete item catalogue');
assert.equal(writes.length,0,'Reading the default preset never writes a fabricated partial selection');
assert.equal(luaResult.auto_foil,undefined,'An explicit legacy Steam-data preference stays disabled without acquiring the new preset');
await assert.rejects(api.setCommunityItemOptions(autoDoc,autoScope,steam,{...defaults(),auto_foil:true}),/Invalid automatic foil/);
await assert.rejects(api.setCommunityItemOptions(autoDoc,autoScope,steam,{...selected('x','foil'),auto_foil:'true'}),/Invalid automatic foil/);
stopAuto();
reads.length=0;
const changesA=[],changesB=[],changesOther=[];
const stopA=api.subscribeCommunityItemOptions(a,local,steam,v=>changesA.push(v));
const stopB=api.subscribeCommunityItemOptions(b,local,steam,v=>changesB.push(v));
const stopOther=api.subscribeCommunityItemOptions(c,'3000000002',steam,v=>changesOther.push(v));
const initial=api.getCommunityItemOptions(a,local,steam);await tick();
const save=api.setCommunityItemOptions(a,local,steam,selected('card-a','foil'));await tick();
assert.equal(writes.length,1);writes[0].resolve(response(selected('card-a','foil')));await save;
reads[0].resolve(response(defaults()));
assert.equal((await initial).card_ids[0],'card-a','late initial read cannot restore locked cards');
assert.equal(api.getCachedCommunityItemOptions(a,local,steam).card_border,'foil');
assert.equal(changesA.length,1,'same view receives one confirmed change');
assert.equal(changesB.length,1,'other CEF receives confirmed preference through storage');
assert.equal(changesOther.length,0,'another linked installation cannot receive this override');
const outdated=new Event('storage');Object.defineProperties(outdated,{key:{value:'gdl:community_item_options_v1:'+local+':'+steam},
 newValue:{value:JSON.stringify({version:1,shortcut_app_id:local,steam_app_id:steam,options:defaults()})}});
b.defaultView.dispatchEvent(outdated);
const outdatedClear=new Event('storage');Object.defineProperties(outdatedClear,{key:{value:null},newValue:{value:null}});b.defaultView.dispatchEvent(outdatedClear);
assert.equal(api.getCachedCommunityItemOptions(b,local,steam).card_ids[0],'card-a','queued old storage and clear events cannot overwrite the current confirmed selection');
const currentReplay=new Event('storage');Object.defineProperties(currentReplay,{key:{value:'gdl:community_item_options_v1:'+local+':'+steam},
 newValue:{value:store.get('gdl:community_item_options_v1:'+local+':'+steam)}});b.defaultView.dispatchEvent(currentReplay);
assert.equal(changesB.length,1,'a valid replay of the current stored value is harmless');
const before=changesA.length;
const save1=api.setCommunityItemOptions(a,local,steam,selected('card-b'));
const save2=api.setCommunityItemOptions(a,local,steam,selected('card-c'));
await tick();assert.equal(writes.length,2,'concurrent saves are serialized');
assert.equal(api.getCachedCommunityItemOptions(a,local,steam).card_ids[0],'card-a','pending intent is not reported as saved');
writes[1].resolve(response(selected('card-b')));await save1;await tick();
assert.equal(writes.length,3);assert.equal(changesA.length,before,'outdated save ack never repaints newer intent');
writes[2].resolve(response(selected('card-c')));await save2;
assert.equal(changesA.at(-1).card_ids[0],'card-c');
const failure=api.setCommunityItemOptions(a,local,steam,selected('not-saved'));await tick();
writes.at(-1).resolve(JSON.stringify({ok:false,error:'disk_write_failed'}));
await assert.rejects(failure,/disk_write_failed/);
assert.equal(api.getCachedCommunityItemOptions(a,local,steam).card_ids[0],'card-c','a failed write never claims an unlock');
// A confirmed intermediate write remains the truth if its queued successor fails.
const good=api.setCommunityItemOptions(a,local,steam,selected('persisted-intermediate'));
const bad=api.setCommunityItemOptions(a,local,steam,selected('failed-successor'));
const badResult=bad.catch(error=>error);await tick();
writes.at(-1).resolve(response(selected('persisted-intermediate')));await good;await tick();
writes.at(-1).reject(new Error('IPC disconnected'));assert.match(String(await badResult),/IPC disconnected/);
assert.equal(changesA.at(-1).card_ids[0],'persisted-intermediate');
const restarted=harness(),restartDoc=document();
assert.equal(restarted.getCachedCommunityItemOptions(restartDoc,local,steam).card_ids[0],'persisted-intermediate','only confirmed preferences survive renderer restart');
const reload=restarted.getCommunityItemOptions(restartDoc,local,steam);await tick();reads.at(-1).resolve(response(selected('backend-current')));await reload;
assert.equal(restarted.getCachedCommunityItemOptions(restartDoc,local,steam).card_ids[0],'backend-current','restart revalidates the backend source');
const blockedDoc=document(),blockedChanges=[];
blockedDoc.defaultView.localStorage={getItem(){throw Error('Storage blocked')},setItem(){throw Error('Storage blocked')}};
const stopBlocked=api.subscribeCommunityItemOptions(blockedDoc,'3000000043',steam,value=>blockedChanges.push(value));
const blockedSave=api.setCommunityItemOptions(blockedDoc,'3000000043',steam,selected('without-storage'));await tick();
writes.at(-1).resolve(response(selected('without-storage')));await blockedSave;
assert.equal(blockedChanges.at(-1).card_ids[0],'without-storage','same-document confirmed events still work when localStorage is blocked');stopBlocked();
const pendingDoc=document(),savingDoc=document(),delayedScope='3000000045';deferStorageEvents=true;
const crossRead=api.getCommunityItemOptions(pendingDoc,delayedScope,steam);await tick();const delayedRead=reads.at(-1);
const crossSave=api.setCommunityItemOptions(savingDoc,delayedScope,steam,selected('new-other-cef'));await tick();
writes.at(-1).resolve(response(selected('new-other-cef')));await crossSave;
delayedRead.resolve(response(defaults()));
assert.equal((await crossRead).card_ids[0],'new-other-cef','an IPC read started before another CEF save cannot overwrite it before the storage event is delivered');
assert.equal(JSON.parse(store.get('gdl:community_item_options_v1:'+delayedScope+':'+steam)).options.card_ids[0],'new-other-cef','an old IPC read cannot replace the shared confirmed storage value');
deferStorageEvents=false;for(const dispatch of queuedStorageEvents.splice(0))dispatch();
const last=changesA.length;
a.defaultView.dispatchEvent(new CustomEvent('gdl:community-item-options-changed',{detail:{version:1,shortcut_app_id:'3000000002',steam_app_id:steam,options:selected('foreign')}}));
a.defaultView.dispatchEvent(new CustomEvent('gdl:community-item-options-changed',{detail:{version:1,shortcut_app_id:local,steam_app_id:steam,options:{...selected('bad'),card_ids:[42]}}}));
assert.equal(changesA.length,last,'malformed and mismatched events are ignored');
const d=document(),pendingRead=api.getCommunityItemOptions(d,'3000000004',steam);await tick();d.defaultView.closed=true;reads.at(-1).resolve(response(selected('retired')));await pendingRead;
assert.equal(api.getCachedCommunityItemOptions(d,'3000000004',steam),null,'retired documents retain no usable preference snapshot');
const retired=api.setCommunityItemOptions(a,local,steam,selected('old-generation'));
const queued=api.setCommunityItemOptions(a,local,steam,selected('queued-old-generation'));
const queuedResult=queued.catch(error=>error);await tick();const writeCount=writes.length;
api.clearCommunityItemOptions();writes.at(-1).resolve(response(selected('old-generation')));await retired;
assert.match(String(await queuedResult),/retired/);assert.equal(writes.length,writeCount,'reset fences queued writes before IPC');
assert.notEqual(api.getCachedCommunityItemOptions(a,local,steam)?.card_ids[0],'old-generation','retired completion cannot republish old preferences');
stopA();stopB();stopOther();
for(let i=0;i<100;i++){const stop=api.subscribeCommunityItemOptions(a,local,steam,()=>{});stop();stop();}
assert.equal(a.defaultView.count+b.defaultView.count+c.defaultView.count,0,'100 mount/unmount cycles release all scoped event listeners');
automaticReads=true;
for(let i=0;i<100;i++)await api.getCommunityItemOptions(a,String(4000000000+i),steam);
assert.equal(api.testEntryCount(a),64,'inactive per-document snapshots remain bounded');
const pendingWriteDoc=document();
const hangingWrite=api.setCommunityItemOptions(pendingWriteDoc,'3000000048',steam,selected('pending-write'));await tick();
const readBehindWrite=api.getCommunityItemOptions(pendingWriteDoc,'3000000048',steam).catch(error=>error);await tick();expireReads();
assert.match(String(await readBehindWrite),/timed out/,'a lost write acknowledgement cannot pin a later preference read or card UI forever');
writes.at(-1).resolve(response(selected('pending-write')));await hangingWrite;
assert.equal(api.getCachedCommunityItemOptions(pendingWriteDoc,'3000000048',steam).card_ids[0],'pending-write','a bounded read never cancels the real serialized write or invents an acknowledgement');
assert.equal(timers.size,0,'settled and retired reads release all watchdog timers');
console.log('Community item options passed: automatic foil defaults, legacy choices, stable identities, latest-save/read fencing, failure recovery, confirmed cross-CEF changes, restart persistence, exact link scope, reset and 100 subscription cleanups.');
