import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chromium } from 'playwright';
import { browserLaunchOptions } from './helpers/browser-launch.mjs';
const sources = Object.fromEntries(Object.entries({
 properties:'frontend/features/shortcuts/properties.ts', styles:'frontend/features/shortcuts/properties-style.ts',
 ui:'frontend/features/shortcuts/community-item-properties.ts', service:'frontend/core/community-item-options.ts',
 summary:'frontend/features/shortcuts/properties-summary.ts',
 presentation:'frontend/features/library/linked-card-presentation.ts',
}).map(([name,file])=>[name,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText]));
const browser=await chromium.launch({...browserLaunchOptions(),headless:true});
try {
 const page=await browser.newPage();
 await page.route('https://community-items.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto('https://community-items.test/');
 const result=await page.evaluate(async sources=>{
  let checks=0;const check=(yes,label)=>{if(!yes)throw Error(label);checks++};
  const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve()};
  const waitFor=async predicate=>{const deadline=performance.now()+1000;while(!predicate()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5))};
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
  const empty=()=>({enabled:false,card_border:'normal',card_ids:[],badge_id:null});
  const automatic=()=>({enabled:true,card_border:'foil',card_ids:[],badge_id:null,auto_foil:true});
  const catalog=(tag)=>({cards_complete:true,badges_complete:true,cards:[0,1].map(i=>({title:tag+' normal '+i,image:'https://community.steamstatic.com/economy/image/'+tag+i})),
   foil_cards:[0,1].map(i=>({title:tag+' foil '+i,foil:true,image:'https://community.steamstatic.com/economy/image/'+tag+'foil'+i})),
   badges:[{title:'First badge',level:1,image:'https://community.steamstatic.com/badge/first.png'},
    {title:'Final badge',level:5,image:'https://community.steamstatic.com/badge/final.png'},
    {title:'Silver badge',level:1,foil:true,image:'https://community.steamstatic.com/badge/foil.png'}]});
  let currentCatalog=catalog('A'), shortcut='3000000001',steam='111',activeSubscriptions=0;
  const stored=new Map(),saves=[],catalogRefreshes=[],catalogListeners=new Map();let deferSaves=true,settingsFailure=false,settingsGate=null,remoteCatalog=null;
  const catalogApi={
   getImmediateOfficialCommunityItems:()=>currentCatalog&&typeof currentCatalog.then!=='function'?currentCatalog:null,
   getOfficialCommunityItems:async(_doc,appid,_lang,options)=>{if(options?.refresh)catalogRefreshes.push(appid);return remoteCatalog||currentCatalog},
   subscribeOfficialCommunityItems:(_doc,appid,listener)=>{const set=catalogListeners.get(appid)||new Set();catalogListeners.set(appid,set);set.add(listener);return()=>set.delete(listener)},
  };
  const publishCatalog=(appid,value)=>{if(appid===steam)currentCatalog=value;for(const listener of catalogListeners.get(appid)||[])listener(value)};
  const backend={
   getGameCommunityItemOptionsBackend:async({request_json})=>{const q=JSON.parse(request_json);if(settingsFailure)throw Error('settings read failure');if(settingsGate)return settingsGate.promise;return{ok:true,...(stored.get(q.shortcut_app_id+':'+q.steam_app_id)||automatic())}},
   setGameCommunityItemOptionsBackend:({request_json})=>{const request=JSON.parse(request_json),pending=deferred();saves.push({...pending,request});
    if(!deferSaves){stored.set(request.shortcut_app_id+':'+request.steam_app_id,request);pending.resolve({ok:true,...request})}return pending.promise},
  };const api={};new Function('exports','require',sources.service)(api,()=>backend);
  const presentation={};new Function('exports','require',sources.presentation)(presentation,()=>api);
  // Explicit previous records, including Use Steam data, keep their old state.
  for(const appid of ['111','333','666','778','880'])stored.set(shortcut+':'+appid,empty());
  stored.set('3000000002:880',empty());
  const service={...api,subscribeCommunityItemOptions:(...args)=>{activeSubscriptions++;const unsubscribe=api.subscribeCommunityItemOptions(...args);return()=>{activeSubscriptions--;unsubscribe()}}};
  const ui={};new Function('exports','require',sources.ui)(ui,name=>({
   '../../core/text':{escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';')},
   '../../steam/localization':{gdlText:(_key,text,values={})=>text.replace(/\{(\w+)\}/g,(match,key)=>String(values[key]??match))},
   '../library/community-items':catalogApi,'../library/linked-card-presentation':presentation,'../../core/community-item-options':service,'../../api/backend':{backendLog:()=>{}},
  }[name]));
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';
  let host=document.querySelector('section');const binding=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  const q=selector=>host.querySelector(selector),change=(selector,value)=>{const node=q(selector);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}))};
  const click=selector=>q(selector).click();
  const accept=async index=>{const item=saves[index];stored.set(item.request.shortcut_app_id+':'+item.request.steam_app_id,item.request);item.resolve({ok:true,...item.request});await flush()};
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-card-list').children.length===2,'Linked Properties loads one normal collection');
  check(q('.gdl-native-section-description').textContent.includes('does not add items or XP'),'Properties labels the local-only selection clearly');
  check(q('.gdl-community-options-status').textContent.includes('Steam data'),'Default uses actual Steam data');
  q('.gdl-community-item-options').open=true;
  let checkbox=q('input[data-card-id]');checkbox.focus();checkbox.click();await flush();
  check(saves.length===1&&saves[0].request.enabled&&saves[0].request.card_ids.length===1,'Individual card writes exact scoped local selection');
  check(document.activeElement.dataset.cardId===checkbox.dataset.cardId,'Card selection preserves keyboard focus');
  click('.gdl-community-all');click('.gdl-community-none');click('.gdl-community-all');await flush();
  await accept(0);
  check(saves.length===2&&saves[1].request.card_ids.length===2&&q('.gdl-community-card-summary').textContent.startsWith('2 of 2'),'Older save acknowledgement cannot flash or replace latest selection');
  await accept(1);
  change('.gdl-community-card-border','foil');await flush();await accept(2);
  check(q('.gdl-community-card-list').textContent.includes('A foil')&&saves[2].request.card_ids.length===2,'Switching border preserves normal card choices');
  const foilBadge=api.communityBadgeId(currentCatalog.badges[2]);
  change('.gdl-community-badge',foilBadge);await flush();
  check(saves[3].request.card_ids.length===4&&saves[3].request.card_border==='foil','Foil badge completes its foil set while retaining normal selections');
  await accept(3);
  q('input[data-card-id]').click();await flush();
  check(saves[4].request.badge_id===null&&saves[4].request.card_ids.length===3,'Locking a card removes the completed foil badge');await accept(4);
  click('.gdl-community-real');await flush();await accept(5);
  check(!saves[5].request.enabled&&saves[5].request.badge_id===null&&saves[5].request.card_ids.length===0,'Use Steam resets local cards, badge and override');
  q('input[data-card-id]').click();await flush();saves[6].reject(Error('disk failure'));await flush();
  check(q('.gdl-community-options-status').dataset.error==='true'&&q('input[data-card-id]').checked===false,'Save failure is shown and restores last confirmed selection');
  check(activeSubscriptions===1,'The active panel owns one cross-window subscription');
  const late=deferred();currentCatalog=late.promise;steam='222';binding.sync();await flush();
  currentCatalog=catalog('B');steam='333';binding.sync();await flush();
  late.resolve(catalog('STALE'));await flush();
  check(q('.gdl-community-card-list').textContent.includes('B normal')&&!q('.gdl-community-card-list').textContent.includes('STALE'),'Late catalogue for a retired linked game cannot repaint another game');
  check(activeSubscriptions===1,'Scope replacement releases the old subscription');
  steam='';binding.sync();await flush();check(q('.gdl-community-item-options').hidden&&activeSubscriptions===0,'Unlinked games hide controls and release listeners');
  currentCatalog=catalog('A');steam='111';binding.sync();await flush();
  deferSaves=false;const finalBadge=api.communityBadgeId(currentCatalog.badges[1]);change('.gdl-community-badge',finalBadge);await flush();
  check(q('.gdl-community-card-summary').textContent.startsWith('2 of 2'),'Maximum normal badge completes normal collection');
  binding.dispose();check(activeSubscriptions===0,'Explicit close releases its subscription');
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const reopened=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-badge').value===finalBadge&&q('.gdl-community-card-summary').textContent.startsWith('2 of 2'),'Reopening Properties restores persisted per-shortcut choices');
  host.remove();await flush();check(activeSubscriptions===0,'Detached Properties automatically removes its listener');reopened.dispose();
  const before=saves.length;const detachedInput=host.querySelector('input[data-card-id]');detachedInput?.click();await flush();
  check(saves.length===before,'Retired controls cannot write after window cleanup');

  // Failures in saved preferences must not discard an already available catalogue.
  currentCatalog=catalog('RECOVERY');steam='444';settingsFailure=true;
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const recovery=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(!q('.gdl-community-options-content').hidden&&q('.gdl-community-card-list').children.length===2,'Settings failure preserves the available native/cache catalogue');
  check(q('input[data-card-id]').disabled&&q('.gdl-community-options-status').textContent.includes('saved selection'),'Saved settings failure is distinguished and prevents overwriting unknown choices');
  check(!q('.gdl-community-retry').hidden,'Saved settings failure offers retry even with catalogue data ready');
  settingsFailure=false;const refreshCount=catalogRefreshes.length;click('.gdl-community-retry');await flush();
  check(!q('input[data-card-id]').disabled&&catalogRefreshes.length===refreshCount,'Settings-only retry re-enables controls without re-fetching the catalogue');
  recovery.dispose();
  // Native/cache cards appear before delayed preferences, then become editable.
  steam='555';settingsGate=deferred();
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const delayed=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-card-list').children.length===2&&q('input[data-card-id]').disabled,'Warm catalogue is visible while saved settings are still pending');
  settingsGate.resolve({ok:true,...empty()});settingsGate=null;await flush();
  check(!q('input[data-card-id]').disabled,'Confirmed saved settings enable already visible cards');delayed.dispose();
  // Background foil/badge enrichment cannot block first cards or reset a selection.
  steam='666';const remote=deferred();remoteCatalog=remote.promise;
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const progressive=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-card-list').children.length===2&&!q('input[data-card-id]').disabled,'Native/cache catalogue becomes editable without awaiting remote enrichment');
  q('input[data-card-id]').click();await flush();const selectedId=q('input[data-card-id]').dataset.cardId;
  const richer={...currentCatalog,foil_cards:[...currentCatalog.foil_cards,{title:'Extra foil',foil:true,image:'https://community.steamstatic.com/economy/image/extrafoil'}]};
  publishCatalog(steam,richer);await flush();
  check(q('input[data-card-id]').dataset.cardId===selectedId&&q('input[data-card-id]').checked,'Late enrichment preserves a user choice and its control identity');
  const partial={...richer,transient_error:true};remote.resolve(partial);remoteCatalog=null;publishCatalog(steam,partial);await flush();
  check(q('input[data-card-id]').checked&&!q('.gdl-community-retry').hidden&&q('.gdl-community-options-status').textContent.includes('complete card and badge catalogue'),'Failed remote enrichment retains selected cards and exposes a specific retry');
  currentCatalog=richer;click('.gdl-community-retry');await flush();
  check(catalogRefreshes.at(-1)==='666'&&q('input[data-card-id]').checked&&q('.gdl-community-retry').hidden,'Catalogue retry forces enrichment after partial success without clearing selections');
  progressive.dispose();
  check([...catalogListeners.values()].every(set=>set.size===0),'Closing or replacing Properties releases progressive catalogue subscriptions');

  // A missing foil snapshot is not a confirmed empty collection, nor permission
  // to overwrite the selection that another CEF document is already displaying.
  steam='777';currentCatalog={...catalog('PARTIAL'),foil_cards:[],cards_complete:false,loading:true};
  const savedFoil={enabled:true,card_border:'foil',card_ids:[api.communityCardId(catalog('PARTIAL').foil_cards[0])],badge_id:null};
  stored.set(shortcut+':'+steam,savedFoil);
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const missingFoil=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-card-border').value==='foil'&&!q('.gdl-community-card-border option[value="foil"]').disabled,'Saved foil collection stays selected and accessible while native normal cards arrive first');
  check(q('.gdl-community-card-summary').textContent.includes('still loading')&&!q('.gdl-community-card-summary').textContent.includes('No cards'),'An incomplete foil snapshot is labelled loading instead of falsely declaring no cards');
  const beforeMissing=saves.length;
  change('.gdl-community-card-border','normal');await flush();
  const persistedNormal=stored.get(shortcut+':'+steam);
  check(persistedNormal.card_border==='normal'&&persistedNormal.card_ids[0]===savedFoil.card_ids[0],'Switching to available normal cards preserves saved foil choices');
  change('.gdl-community-card-border','foil');await flush();
  check(saves.length===beforeMissing+1&&stored.get(shortcut+':'+steam).card_border==='normal','Browsing missing foil definitions never saves an empty override over the current native set');
  currentCatalog={...currentCatalog,loading:false,transient_error:true};publishCatalog(steam,currentCatalog);await flush();
  check(!q('.gdl-community-retry').hidden&&q('.gdl-community-card-summary').textContent.includes('has not loaded'),'Failed partial foil data keeps the selection and offers a real catalogue retry');
  const retryFoil=deferred();remoteCatalog=retryFoil.promise;click('.gdl-community-retry');await flush();
  check(catalogRefreshes.at(-1)==='777'&&stored.get(shortcut+':'+steam).card_border==='normal','Foil retry refreshes the exact catalogue without modifying backend-confirmed settings');
  currentCatalog=catalog('PARTIAL');publishCatalog(steam,currentCatalog);retryFoil.resolve(currentCatalog);remoteCatalog=null;await flush();
  check(q('.gdl-community-card-border').value==='foil'&&q('input[data-card-id]').checked,'Late foil definitions restore the saved foil choice in the browsed collection');
  q('input[data-card-id]').click();await flush();
  check(saves.at(-1).request.card_border==='foil'&&stored.get(shortcut+':'+steam).card_border==='foil','An explicit foil card edit saves the browsed border after its definitions arrive');
  missingFoil.dispose();

  // Disabled overrides are a native view, so a foil-only first snapshot must not
  // permanently change the default when the normal definitions arrive later.
  steam='778';currentCatalog={...catalog('ORDER'),cards:[],cards_complete:false,loading:true};
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const normalDefault=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-card-border').value==='foil','A foil-only preview remains browsable before normal definitions arrive');
  currentCatalog=catalog('ORDER');publishCatalog(steam,currentCatalog);await flush();
  check(q('.gdl-community-card-border').value==='normal'&&q('.gdl-community-options-status').textContent.includes('Steam data'),'Normal defaults recover automatically after foil-first enrichment without enabling a local override');normalDefault.dispose();

  steam='779';const completeBadgeCatalog=catalog('BADGE');
  const savedBadgeId=api.communityBadgeId(completeBadgeCatalog.badges[1]);
  currentCatalog={...completeBadgeCatalog,cards:completeBadgeCatalog.cards.slice(0,1),badges:[],cards_complete:false,badges_complete:false,loading:true};
  stored.set(shortcut+':'+steam,{enabled:true,card_border:'normal',card_ids:[api.communityCardId(currentCatalog.cards[0])],badge_id:savedBadgeId});
  document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
  const badgeProgress=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(q('.gdl-community-badge').value===savedBadgeId&&q('.gdl-community-badge').selectedOptions[0].textContent.includes('not loaded'),'A saved badge absent from partial definitions is retained visibly instead of displaying no local badge');
  const beforeEnrichment=saves.length;currentCatalog=completeBadgeCatalog;publishCatalog(steam,currentCatalog);await flush();
  check(q('.gdl-community-card-summary').textContent.startsWith('2 of 2')&&saves.length===beforeEnrichment,'Maximum badge completion covers newly enriched cards without an unsolicited settings write');
  q('input[data-card-id]').click();await flush();
  check(stored.get(shortcut+':779').badge_id===null&&stored.get(shortcut+':779').card_ids.length===1&&q('.gdl-community-card-summary').textContent.startsWith('1 of 2'),'Locking a card after enrichment clears the max badge and preserves the other completed card');
  change('.gdl-community-badge',savedBadgeId);await flush();change('.gdl-community-card-border','foil');await flush();
  check(stored.get(shortcut+':779').badge_id===null&&q('.gdl-community-card-summary').textContent.startsWith('0 of 2'),'Switching to foil clears a normal badge rather than incorrectly completing the foil set');badgeProgress.dispose();

  // Functional path: Properties -> production settings service -> confirmed
  // persistence -> browser storage event -> another independent CEF service.
  const frame=document.createElement('iframe');frame.srcdoc='<!doctype html><body></body>';await new Promise(resolve=>{frame.onload=resolve;document.body.append(frame)});
  const otherDoc=frame.contentDocument,otherApi={};new Function('exports','require',sources.service)(otherApi,()=>backend);
  steam='880';currentCatalog=catalog('CEF');
  let otherSelection=null,foreignSelection=null;
  const releaseOther=otherApi.subscribeCommunityItemOptions(otherDoc,shortcut,'880',value=>{otherSelection=value});
  const releaseForeign=otherApi.subscribeCommunityItemOptions(otherDoc,'3000000002','880',value=>{foreignSelection=value});
  otherSelection=await otherApi.getCommunityItemOptions(otherDoc,shortcut,'880');
  foreignSelection=await otherApi.getCommunityItemOptions(otherDoc,'3000000002','880');
  host.innerHTML=ui.shortcutCommunityItemSettingsHtml();
  const cef=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  check(!otherSelection.enabled&&otherSelection.card_ids.length===0&&otherSelection.badge_id===null,'Another document starts with confirmed Steam-data defaults before any local choice');
  q('input[data-card-id]').click();await flush();await waitFor(()=>otherSelection.enabled);
  const firstNormalId=api.communityCardId(currentCatalog.cards[0]);
  check(stored.get(shortcut+':880').enabled&&otherSelection.card_ids.length===1&&otherSelection.card_ids[0]===firstNormalId,'A backend-confirmed Properties card choice reaches the independent second-document service');
  check(q('input[data-card-id]').checked,'Cross-document settings events preserve the acknowledged Properties choice');
  check(foreignSelection.enabled===false,'A different shortcut with the same Steam AppID never receives the local unlock');
  const oldNormal=structuredClone(stored.get(shortcut+':880')),oldReadReply=deferred();settingsGate=oldReadReply;
  const oldRead=otherApi.getCommunityItemOptions(otherDoc,shortcut,'880');await flush();settingsGate=null;
  change('.gdl-community-card-border','foil');await flush();
  q('input[data-card-id]').click();await flush();
  oldReadReply.resolve({ok:true,...oldNormal});await oldRead;
  const firstFoilId=api.communityCardId(currentCatalog.foil_cards[0]);
  await waitFor(()=>otherSelection.card_border==='foil'&&otherSelection.card_ids.includes(firstFoilId));
  check(otherSelection.card_border==='foil'&&otherSelection.card_ids.length===2&&otherSelection.card_ids.includes(firstFoilId)
   &&otherSelection.card_ids.includes(firstNormalId),'The second document receives the saved foil border and exact selected foil ID while retaining the normal choice');
  check(stored.get(shortcut+':880').card_border==='foil'&&q('.gdl-community-card-border').value==='foil','A delayed settings reply in another document cannot restore an older normal selection over confirmed foil choices');
  change('.gdl-community-badge',api.communityBadgeId(currentCatalog.badges[2]));await flush();
  const selectedFoilBadgeId=api.communityBadgeId(currentCatalog.badges[2]);
  await waitFor(()=>otherSelection.badge_id===selectedFoilBadgeId);
  check(otherSelection.badge_id===selectedFoilBadgeId&&otherSelection.card_border==='foil'
   &&currentCatalog.foil_cards.every(card=>otherSelection.card_ids.includes(api.communityCardId(card)))
   &&otherSelection.card_ids.includes(firstNormalId),'A confirmed foil badge choice reaches the independent second-document service with its completed set and retained normal choice');
  const retained=JSON.stringify(stored.get(shortcut+':880'));
  deferSaves=true;q('input[data-card-id]').click();await flush();const oldIntent=saves.length-1;
  steam='881';const newSettings={enabled:true,card_border:'normal',card_ids:[api.communityCardId(currentCatalog.cards[1])],badge_id:null};
  stored.set(shortcut+':881',newSettings);cef.sync();await flush();
  check(q('.gdl-community-card-border').value==='normal'&&q('input[data-card-id]').checked===false&&q('input[data-card-id]:checked').dataset.cardId===newSettings.card_ids[0],'Relinking during an old save immediately displays the new scope confirmed choices');
  await accept(oldIntent);
  check(q('.gdl-community-card-border').value==='normal'&&q('input[data-card-id]:checked').dataset.cardId===newSettings.card_ids[0],'An old-scope save confirmation cannot replace the relinked Properties selection');
  check(JSON.stringify(stored.get(shortcut+':880'))!==retained&&JSON.stringify(stored.get(shortcut+':881'))===JSON.stringify(newSettings),'The queued old intent is persisted only to its original pair and leaves the relinked pair untouched');
  cef.dispose();releaseOther();releaseForeign();frame.remove();deferSaves=false;

  // Missing preferences are a live automatic foil preset. Catalogue enrichment
  // changes the effective preview, while only an explicit edit persists IDs.
  let automaticBinding=null;
  const mountAutomatic=async(appid,value)=>{
   automaticBinding?.dispose();steam=appid;currentCatalog=value;
   document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
   automaticBinding=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  };
  let beforeAutomatic=saves.length;
  await mountAutomatic('990',catalog('AUTO'));
  check(q('.gdl-community-card-border').value==='foil'&&q('.gdl-community-card-summary').textContent.startsWith('2 of 2')
   &&q('.gdl-community-badge').value===api.communityBadgeId(currentCatalog.badges[2]),'Missing preferences show all foil cards and the foil badge as the effective automatic selection');
  check(saves.length===beforeAutomatic&&!stored.has(shortcut+':990')&&api.getCachedCommunityItemOptions(document,shortcut,'990').auto_foil===true,'Displaying the automatic preset never writes catalogue-derived preferences');
  q('input[data-card-id]').click();await flush();
  check(saves.at(-1).request.auto_foil===undefined&&saves.at(-1).request.card_border==='foil'&&saves.at(-1).request.card_ids.length===1
   &&saves.at(-1).request.badge_id===null,'The first automatic card lock materializes its effective IDs, removes the maxed foil badge and disables automatic updates');
  const lateAutomatic={...currentCatalog,foil_cards:[...currentCatalog.foil_cards,{title:'Late foil',foil:true,image:'https://community.steamstatic.com/economy/image/AUTO-late'}]};
  publishCatalog(steam,lateAutomatic);await flush();
  check(q('.gdl-community-card-summary').textContent.startsWith('1 of 3')&&!Array.from(q('.gdl-community-card-list').querySelectorAll('input')).at(-1).checked,'A later catalogue cannot re-enable automatic ownership after an explicit card edit');
  click('.gdl-community-real');await flush();
  check(stored.get(shortcut+':990').enabled===false&&stored.get(shortcut+':990').auto_foil===undefined,'Use Steam data saves an explicit disabled record without the automatic flag');
  await mountAutomatic('990',catalog('AUTO'));
  check(q('.gdl-community-card-border').value==='normal'&&q('.gdl-community-options-status').textContent.includes('Steam data'),'Reopening an explicit Use Steam data record does not replace it with the new default');

  const partialAutomatic={...catalog('AUTO-PARTIAL'),foil_cards:[],badges:[],cards_complete:false,badges_complete:false,loading:true};
  beforeAutomatic=saves.length;await mountAutomatic('991',partialAutomatic);
  check(q('.gdl-community-card-border').value==='foil'&&!q('input[data-card-id]')&&q('.gdl-community-badge').value==='__gdl-auto-foil__',
   'Automatic foil stays pending on a normal-only partial catalogue and exposes a distinct automatic badge placeholder');
  check(saves.length===beforeAutomatic&&!stored.has(shortcut+':991'),'Incomplete automatic definitions never produce an empty settings write');
  change('.gdl-community-badge','');await flush();
  check(saves.at(-1).request.badge_id===null&&saves.at(-1).request.auto_foil===undefined,'Choosing None from the pending automatic badge placeholder explicitly disables auto foil');
  publishCatalog(steam,catalog('AUTO-PARTIAL'));await flush();
  check(q('.gdl-community-badge').value===''&&q('.gdl-community-card-summary').textContent.startsWith('0 of 2'),'A late foil badge cannot replace an explicit None chosen while definitions were pending');

  beforeAutomatic=saves.length;await mountAutomatic('992',partialAutomatic);
  currentCatalog=catalog('AUTO-PARTIAL');publishCatalog(steam,currentCatalog);await flush();
  check(q('.gdl-community-card-summary').textContent.startsWith('2 of 2')&&q('.gdl-community-badge').value===api.communityBadgeId(currentCatalog.badges[2])
   &&saves.length===beforeAutomatic&&api.getCachedCommunityItemOptions(document,shortcut,steam).auto_foil===true,'An untouched automatic preset acquires all arriving foil definitions and its badge without a settings write');
  change('.gdl-community-badge','');await flush();
  check(saves.at(-1).request.auto_foil===undefined&&saves.at(-1).request.card_ids.length===2&&saves.at(-1).request.badge_id===null,
   'Choosing None after foil arrives materializes the owned set and removes the automatic badge without locking those cards');

  const normalOnly={...catalog('NORMAL-ONLY'),foil_cards:[],badges:catalog('NORMAL-ONLY').badges.filter(badge=>!badge.foil)};
  beforeAutomatic=saves.length;await mountAutomatic('993',normalOnly);
  check(q('.gdl-community-card-border').value==='normal'&&q('.gdl-community-card-summary').textContent.startsWith('2 of 2')
   &&saves.length===beforeAutomatic,'The automatic preset falls back to a complete normal collection only after both catalogues confirm there is no foil');
  await mountAutomatic('994',catalog('AUTO-BORDER'));
  change('.gdl-community-card-border','normal');await flush();
  check(saves.at(-1).request.auto_foil===undefined&&saves.at(-1).request.card_border==='normal'&&saves.at(-1).request.card_ids.length===2
   &&saves.at(-1).request.card_ids.every(id=>id.startsWith('card:foil:'))&&saves.at(-1).request.badge_id===null,'A first border edit preserves materialized foil IDs while removing the incompatible automatic foil badge');
  const fiveFoil={...catalog('FIVE'),badges:[],cards_complete:true,badges_complete:false,loading:true,
   foil_cards:Array.from({length:5},(_,i)=>({title:'Foil '+i,foil:true,image:'https://community.steamstatic.com/economy/image/five-foil-'+i}))};
  beforeAutomatic=saves.length;await mountAutomatic('995',fiveFoil);
  check(q('.gdl-community-card-summary').textContent.startsWith('5 of 5')&&q('.gdl-community-badge').value==='__gdl-auto-foil__'
   &&Array.from(q('.gdl-community-card-list').querySelectorAll('input')).every(input=>input.checked),
   'The automatic foil badge placeholder and five-card partial catalogue show all five cards selected rather than an inconsistent zero');
  check(presentation.linkedCardPresentation(currentCatalog,api.getCachedCommunityItemOptions(document,shortcut,steam)).ownedIds.size===5
   &&saves.length===beforeAutomatic,'Properties and the desktop presentation derive identical automatic ownership without a generated save');
  const firstPage=deferred();remoteCatalog=firstPage.promise;
  await mountAutomatic('996',partialAutomatic);
  currentCatalog=catalog('LIVE-FULL');publishCatalog(steam,currentCatalog);await flush();
  firstPage.resolve({...partialAutomatic,loading:false,transient_error:true});remoteCatalog=null;await flush();
  check(q('.gdl-community-card-summary').textContent.startsWith('2 of 2')&&q('.gdl-community-options-status').dataset.error==='false'
   &&q('.gdl-community-badge').value===api.communityBadgeId(currentCatalog.badges[2]),
   'An old first-page promise cannot replace a richer live catalogue, clear foil choices or restore a stale partial-catalogue error');
  automaticBinding.dispose();

  // Unsupported games omit the category only after a complete, successful
  // catalogue confirms that neither collection nor badge definitions exist.
  const noCommunityItems=(overrides={})=>({cards:[],foil_cards:[],badges:[],foil_badge:null,
   cards_complete:true,badges_complete:true,...overrides});
  let availabilityBinding=null;
  const mountAvailability=async(appid,value)=>{
   availabilityBinding?.dispose();steam=appid;currentCatalog=value;
   document.body.innerHTML='<section>'+ui.shortcutCommunityItemSettingsHtml()+'</section>';host=document.querySelector('section');
   availabilityBinding=ui.bindShortcutCommunityItemSettings({section:host,shortcutAppId:()=>shortcut,steamAppId:()=>steam});await flush();
  };
  const beforeAvailability=saves.length;
  await mountAvailability('1001',noCommunityItems());
  check(q('.gdl-community-item-options').hidden,'A confirmed complete catalogue with no normal cards, foil cards or badges hides the entire Properties category');
  check(activeSubscriptions===1&&catalogListeners.get(steam).size===1,'An omitted category retains its live subscriptions so later official definitions can reveal it');
  publishCatalog(steam,catalog('NOW-SUPPORTED'));await flush();
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-card-list').children.length===2,'Official definitions arriving through the catalogue subscription reveal a previously omitted category');
  publishCatalog(steam,noCommunityItems());await flush();
  check(q('.gdl-community-item-options').hidden,'A later complete empty catalogue hides the category again');

  const onlyCatalog=catalog('ONLY');
  await mountAvailability('1002',noCommunityItems({cards:onlyCatalog.cards}));
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-card-list').children.length===2,'Normal cards alone keep the category available without any badge definitions');
  await mountAvailability('1003',noCommunityItems({foil_cards:onlyCatalog.foil_cards}));
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-card-list').children.length===2,'Foil cards alone keep the category available without normal cards or badges');
  await mountAvailability('1004',noCommunityItems({badges:[onlyCatalog.badges[0]]}));
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-badge').querySelector(`option[value="${api.communityBadgeId(onlyCatalog.badges[0])}"]`),'A normal badge alone keeps the category available without any card definitions');
  await mountAvailability('1005',noCommunityItems({foil_badge:onlyCatalog.badges[2]}));
  check(!q('.gdl-community-item-options').hidden&&q('.gdl-community-badge').value===api.communityBadgeId(onlyCatalog.badges[2]),'A standalone foil badge keeps the category available without cards or normal badges');

  await mountAvailability('1006',noCommunityItems({cards_complete:false}));
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'Missing card definitions remain visible and retryable while the card catalogue is incomplete');
  await mountAvailability('1007',noCommunityItems({badges_complete:false}));
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'Missing badge definitions remain visible and retryable while the badge catalogue is incomplete');
  await mountAvailability('1008',noCommunityItems({cards_complete:undefined,badges_complete:undefined}));
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'An empty legacy snapshot without completion markers is not mistaken for an unsupported game');
  await mountAvailability('1009',noCommunityItems({loading:true}));
  check(!q('.gdl-community-item-options').hidden,'An empty catalogue still loading is not treated as definitive absence even if completion flags are present');
  publishCatalog(steam,noCommunityItems());await flush();
  check(q('.gdl-community-item-options').hidden,'Finishing an empty catalogue hides the category once its absence is definitive');

  await mountAvailability('1010',noCommunityItems({transient_error:true}));
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'A transient catalogue failure keeps the category and its retry visible even when item arrays are empty');
  await mountAvailability('1011',noCommunityItems({error:'catalogue unavailable'}));
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'An explicit catalogue error is not interpreted as proof that the game has no community items');
  const catalogFailure=deferred();remoteCatalog=catalogFailure.promise;
  await mountAvailability('1012',null);catalogFailure.reject(Error('catalogue connection failure'));await flush();remoteCatalog=null;
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden,'A rejected catalogue request leaves a visible retry instead of hiding the category');
  currentCatalog=noCommunityItems();click('.gdl-community-retry');await flush();
  check(q('.gdl-community-item-options').hidden&&catalogRefreshes.at(-1)==='1012','Retry can confirm the game has no cards or badges and omit its category');

  await mountAvailability('1013',catalog('OLD-LINK'));
  const relinkCatalog=deferred();remoteCatalog=relinkCatalog.promise;currentCatalog=null;steam='1014';availabilityBinding.sync();await flush();
  check(q('.gdl-community-options-content').hidden,'Relinking hides the previous game collection while the new catalogue is pending');
  relinkCatalog.resolve(null);await flush();remoteCatalog=null;
  check(!q('.gdl-community-item-options').hidden&&!q('.gdl-community-retry').hidden&&q('.gdl-community-card-list').children.length===0
   &&!q('.gdl-community-badge').textContent.includes('First badge'),'An unavailable relinked catalogue offers retry without retaining the previous game card or badge definitions');
  publishCatalog(steam,noCommunityItems());await flush();
  check(q('.gdl-community-item-options').hidden,'A relinked game with a complete empty catalogue hides its category after retiring previous definitions');
  check(saves.length===beforeAvailability,'Category availability changes never write local card or badge preferences');
  availabilityBinding.dispose();
  check(activeSubscriptions===0&&[...catalogListeners.values()].every(set=>set.size===0),'Closing an omitted category releases both settings and catalogue subscriptions');

  // Production Properties entrypoint: only committed links may own the local controls.
  currentCatalog=catalog('ENTRYPOINT');
  let mapped='111', mappingChanged=()=>{}, nativeInjection=0;
  const noop=()=>{};const properties={},style={};new Function('exports',sources.styles)(style);
  const translation={loc:(_key,text)=>text,gdlText:(_key,text)=>text,setLocalizationDocumentProvider:noop,steamLanguageSync:()=> 'english'};
  const summary={};new Function('exports','require',sources.summary)(summary,()=>translation);
  const dependencies={
   '../../api/backend':{backendLog:noop},'../../core/text':{escapeHtml:value=>String(value),templateToRegex:()=>/^Properties - (.+)$/i},
   '../../steam/localization':translation,'../../core/game-data':{getCachedGameData:()=>({data:{name:'Game',header_image:''}}),getGameData:async()=>({name:'Game'})},
   '../../steam/shortcuts':{findActiveShortcutAppId:()=>shortcut,findShortcutAppIdByName:()=>Number(shortcut)},
   './host':{shortcutRuntimeHost:()=>({findNonSteamNotice:()=>null})},'./registry':{findMappingForShortcut:()=>mapped},
   './detection':{displayReviewConfidence:()=> 'exact',reliableReviewCandidate:()=>true,buildShortcutDetectionContext:async()=>null},
   '../../core/mappings':{subscribeMappings:callback=>{mappingChanged=callback;return noop}},
   './linking':{shouldAutoApplyNoLauncher:()=>false},'./link-history':{rememberedShortcutSteamAppId:()=>''},
   './achievement-properties':{shortcutAchievementSettingsHtml:()=>'',bindShortcutAchievementSettings:()=>({sync:noop})},
   './playtime-properties':{shortcutPlaytimePropertiesHtml:()=>'',bindShortcutPlaytimeProperties:()=>({sync:noop})},
   './community-item-properties':ui,'./properties-style':style,'./properties-summary':summary,
   './native-properties':{findNativePropertiesPage:()=>document.querySelector('main'),tryInjectNativePropertiesField:()=>{nativeInjection++}},
   './customization-artwork':{tryInjectCustomizationArtwork:noop},
   './link-job-queue':{hasPendingLinkJob:()=>false},
  };
  new Function('exports','require',sources.properties)(properties,key=>dependencies[key]||new Proxy({},{get:()=>noop}));
  document.body.innerHTML='<main><label>Target</label><input value="Game.exe" /></main>';
  properties.tryInjectPropertiesField(document,'Properties - Game');await flush();
  host=document.querySelector('.gdl-properties-injected');
  check(host&&!q('.gdl-community-item-options').hidden,'Production linked Properties entrypoint mounts the local section');
  const appidInput=q('.gdl-appid-input');appidInput.value='999';appidInput.dispatchEvent(new Event('input',{bubbles:true}));
  const beforeWrite=saves.length;q('input[data-card-id]').click();await flush();
  check(saves.length===beforeWrite+1&&saves.at(-1).request.steam_app_id==='111','Editing the AppID suggestion field never redirects item writes away from the committed link');
  mapped='';mappingChanged();await flush();
  check(q('.gdl-community-item-options').hidden,'Removing the committed mapping hides controls through the production mapping subscription');
  host.remove();await flush();mappingChanged();
  document.body.innerHTML='<main><label>Launch Options</label><input /></main>';
  properties.tryInjectPropertiesField(document,'Properties - Native Game');await flush();
  check(nativeInjection===1&&!document.querySelector('.gdl-community-item-options'),'Native Steam game Properties do not receive linked local controls');
  return{checks,saves:saves.length};
 },sources);
 assert(result.checks>=97);console.log(`Community item Properties browser passed: ${result.checks} checks; unsupported category visibility, progressive catalogues, automatic foil defaults, explicit manual edits, scoped cards/badges, queued saves, failures, stale hydration, restart and cleanup.`);
}finally{await browser.close()}
