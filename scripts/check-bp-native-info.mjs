import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class AppOverview {
  constructor(appid, iconData) { this.appid=appid;this.app_type=1073741824;this.canonicalAppType=1;this.icon_data=iconData;this.icon_data_format='png'; }
  BIsShortcut(){return this.app_type===1073741824;}
  BIsModOrShortcut(){return this.app_type===1073741824;}
  // Steam preserves local shortcut icons through these methods when its store
  // replaces an AppOverview. Classification must stay native for this to work.
  GetPreservedState(){return this.BIsModOrShortcut()&&this.icon_data?.length>0?{icon_data:this.icon_data,icon_data_format:this.icon_data_format}:undefined;}
  RestorePreservedState(state){if(state?.icon_data&&this.icon_data===undefined){this.icon_data=state.icon_data;this.icon_data_format=state.icon_data_format;}}
}
let app=new AppOverview(3000000001,'c3RhYmxlLWljb24=');
const originalShortcut=app.BIsShortcut,originalMod=app.BIsModOrShortcut;
const base={details:{unAppID:3000000001},customImageInfo:{hero:'local-hero',logo:'local-logo'},associationData:{rgDevelopers:[]},descriptionsData:{strSnippet:''}};
const official={details:{unAppID:1593500},customImageInfo:{hero:'wrong-for-shortcut'}};
const store={GetAppData(id){return id===1593500?official:base;},GetDescriptions(id){return this.GetAppData(id).descriptionsData;},GetAssociations(id){return this.GetAppData(id).associationData;}};
const originalGetter=store.GetAppData;
let renders=0;const timers=new Map();let nextTimer=0;
const win={MILLENNIUM_STEAM_FORCE_RERENDER(){renders++;}};
const doc={defaultView:win,body:{isConnected:true},routeId:app.appid,querySelector:()=>({textContent:'Información'}),getElementById:()=>null};
win.document=doc;
const infoOwnership={isCurrentLinkedGamepadTarget:(target,id,steam)=>target.routeId===(Number(id)>>>0)&&String(steam)==='1593500'};
const context=vm.createContext({exports:{},window:win,encodeURIComponent,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),require:()=>({backendLog(){},getShortcutAppById:()=>app,toSignedShortcutAppId:id=>id|0,resolveNativeAppDetailsStore:target=>target.store||store,steamUIModeService:{isGamepadUI:target=>target.gamepad!==false},isCurrentLinkedGamepadTarget:(...args)=>infoOwnership.isCurrentLinkedGamepadTarget(...args),getCommittedShortcutSteamAppId:id=>id===app.appid?'1593500':null})});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/big-picture/native-info-bridge.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
const {activateNativeGameInfoBridge:activate,deactivateNativeGameInfoBridge:deactivate}=context.exports;
const shortcut={id:app.appid,title:'God of War',steamAppId:'1593500'};
const game={name:'God of War',short_description:'A journey',developers:['Santa Monica Studio'],publishers:['PlayStation'],categories:[],controller_support:'full'};
const flush=()=>{for(const fn of timers.values())fn();timers.clear();};
activate(doc,shortcut,game);flush();
for(let i=0;i<20;i++){activate(doc,shortcut,{...game});flush();}
assert.equal(renders,0,'Initial mounting and tab changes must not force redraws');
assert.equal(app.app_type,1073741824);assert.equal(app.BIsShortcut,originalShortcut);assert.equal(app.BIsModOrShortcut,originalMod);assert.equal(app.BIsModOrShortcut(),true);
assert.equal(Object.hasOwn(app,'BIsModOrShortcut'),false,'The shared native overview must never receive a classification override');
assert.equal(store.GetDescriptions(app.appid).strSnippet,'A journey');
assert.equal(store.GetAssociations(app.appid).rgDevelopers[0].strName,'Santa Monica Studio');
assert.equal(store.GetAppData(app.appid).customImageInfo,base.customImageInfo);
assert.equal(store.GetAppData(app.appid).details.unAppID,app.appid);
assert.equal(store.GetAppData(1593500),official,'Native games remain untouched');
const stable=store.GetAppData(app.appid);
assert.equal(store.GetAppData(app.appid|0).descriptionsData.strSnippet,'A journey');
assert.equal(store.GetAppData(app.appid),stable,'Signed/unsigned requests must retain stable view identity');
base.customImageInfo={hero:'updated-local'};assert.equal(store.GetAppData(app.appid).customImageInfo,base.customImageInfo,'Live local artwork must not be frozen in a copied snapshot');
store.GetAppData(app.appid).customImageInfo={hero:'native-write'};assert.equal(base.customImageInfo.hero,'native-write','Native writes must reach the real store');
assert.equal(store.GetAppData(app.appid).details.nSteamDeckCompatibility,undefined,'Controller support is not Deck certification');
let iconRequests=0;
const iconUrl=overview=>overview.icon_data?`data:image/${overview.icon_data_format};base64,${overview.icon_data}`:overview.BIsModOrShortcut()&&overview.icon_data===undefined?(iconRequests++,null):null;
const originalIconUrl=iconUrl(app);
for(let i=0;i<100;i++){
  const preserved=app.GetPreservedState();
  app=new AppOverview(app.appid);
  app.RestorePreservedState(preserved);
  activate(doc,shortcut,{...game});flush();
  assert.equal(app.BIsModOrShortcut,originalMod,'Store replacement retains native classification');
  assert.equal(iconUrl(app),originalIconUrl,'Store replacement preserves the loaded sidebar icon');
}
assert.equal(iconRequests,0,'Loaded icons must not be requested again after store replacements');
deactivate(doc);assert.equal(store.GetAppData,originalGetter);assert.equal(app.BIsModOrShortcut,originalMod);assert.equal(app.BIsShortcut,originalShortcut);
activate(doc,shortcut,game);deactivate(doc);flush();assert.equal(renders,0,'Leaving cancels pending redraw');
activate(doc,shortcut,game);
const live=store.GetAppData(app.appid),initialDetails=live.details;
base.details={...base.details,nNativeMarker:123,achievements:{nTotal:50}};
assert.equal(store.GetAppData(app.appid),live,'Native field replacement retains the stable metadata view');
assert.notEqual(live.details,initialDetails,'The metadata details view follows a replacement native details object');
assert.equal(live.details.nNativeMarker,123);assert.equal(live.details.achievements,base.details.achievements);
base.details.nNativeMarker=456;assert.equal(live.details.nNativeMarker,456,'In-place native updates remain live');
base.descriptionsData={strSnippet:'New native description'};
assert.equal(live.descriptionsData.strSnippet,'New native description');
base.descriptionsData.strSnippet='Updated in place';assert.equal(live.descriptionsData.strSnippet,'Updated in place');
base.associationData={rgDevelopers:[{strName:'Native developer'}]};
assert.equal(live.associationData.rgDevelopers[0].strName,'Native developer');
base.associationData.rgDevelopers=[{strName:'Newer native developer'}];
assert.equal(live.associationData.rgDevelopers[0].strName,'Newer native developer');
const secondBase={details:{unAppID:app.appid},descriptionsData:{strSnippet:''},associationData:{rgDevelopers:[]}};
const secondStore={GetAppData(){return secondBase;}};const secondGetter=secondStore.GetAppData;
const secondWin={};const secondDoc={...doc,defaultView:secondWin,store:secondStore};secondWin.document=secondDoc;
activate(secondDoc,shortcut,{...game,short_description:'Second realm'});
assert.equal(secondStore.GetAppData(app.appid).descriptionsData.strSnippet,'Second realm');
deactivate(secondDoc);
assert.equal(secondStore.GetAppData,secondGetter);assert.equal(store.GetAppData(app.appid),live,'Cleaning another realm preserves the first metadata bridge');
const thirdStore={GetAppData(){return {details:{unAppID:app.appid},descriptionsData:{strSnippet:''}};}};const thirdGetter=thirdStore.GetAppData;
const replacementDoc={...doc,defaultView:win,store:thirdStore};win.document=replacementDoc;
activate(replacementDoc,shortcut,{...game,short_description:'Replacement realm'});
assert.equal(store.GetAppData,originalGetter,'Same-Window replacement restores the retired store method');
assert.equal(thirdStore.GetAppData(app.appid).descriptionsData.strSnippet,'Replacement realm');
deactivate(doc);
assert.notEqual(thirdStore.GetAppData,thirdGetter,'A stale document cleanup cannot remove its successor bridge');
deactivate(replacementDoc);assert.equal(thirdStore.GetAppData,thirdGetter);

// Execute the real route owner guard with Steam's WindowInstance-only BP shell.
// There is no g_Router, routeId, active DOM marker or fallback heading identity.
const windowContext=vm.createContext({exports:{},require:()=>({steamWebpackRuntime:{getRuntimeIdentity:()=>null,getAllModules:()=>[],getRequire:()=>null,getModuleFactoryCount:()=>0,getModuleFactories:()=>[]}})});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/native-window-store.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,windowContext);
const verifiedMappings={['shortcut:'+app.appid]:'1593500'};
const contextImports={
  '../../core/text':{normalizeTitle:value=>String(value).toLowerCase()},
  '../shortcuts':{getMappedShortcuts:()=>[],getShortcutAppById:()=>app,toSignedShortcutAppId:id=>id|0,looseMatchTitle:()=>false},
  '../../core/mappings':{mappings:verifiedMappings,isMappingSnapshotVerified:()=>true,findMappingForTitle:()=>null,shortcutMappingKey:id=>'shortcut:'+(id>>>0)},
  '../native-window-store':windowContext.exports,
};
const gamepadContext=vm.createContext({exports:{},require:name=>{assert(name in contextImports,name);return contextImports[name];}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/steam/gamepad/GamepadContext.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,gamepadContext);
infoOwnership.isCurrentLinkedGamepadTarget=gamepadContext.exports.isCurrentLinkedGamepadTarget;
let nativeRenders=0;
const bpWin={closed:false,location:{href:'https://steamloopback.host/library',pathname:'/library',hash:''},MILLENNIUM_STEAM_FORCE_RERENDER(){nativeRenders++;}};
bpWin.SteamUIStore={WindowStore:{GetWindowInstanceFromWindow:view=>view===bpWin?view.document.nativeWindowInstance:null}};
const bpBase={details:{unAppID:app.appid},descriptionsData:{strSnippet:''},associationData:{rgDevelopers:[]},customImageInfo:{hero:'bp-local'}};
const bpPublic=Object.freeze({details:Object.freeze({unAppID:1593500}),descriptionsData:Object.freeze({strSnippet:'Native public'})});
const bpStore={GetAppData(id){return id===1593500?bpPublic:bpBase;}};const bpGetter=bpStore.GetAppData;
const bpDoc={URL:'https://steamloopback.host/library',defaultView:bpWin,body:{isConnected:true},gamepad:true,store:bpStore,querySelector:()=>({textContent:'Información'}),getElementById:()=>null};bpWin.document=bpDoc;
bpDoc.nativeWindowInstance={BrowserWindow:bpWin,LocationPathName:'/library/app/'+app.appid+'/Info',IsMainGamepadUIWindow:()=>true};
activate(bpDoc,shortcut,game);
assert.notEqual(bpStore.GetAppData,bpGetter,'WindowStore-only BP can install the native information bridge');
assert.equal(bpStore.GetAppData(app.appid).descriptionsData.strSnippet,'A journey','The real WindowInstance route authorizes metadata for its exact shortcut');
assert.equal(bpStore.GetAppData(app.appid|0).descriptionsData.strSnippet,'A journey','Signed shortcut reads retain the same exact WindowInstance ownership');
assert.equal(bpStore.GetAppData(1593500),bpPublic,'The native public game keeps its exact frozen object');
activate(bpDoc,shortcut,{...game,short_description:'Late metadata'});
assert.equal(timers.size,1,'A live WindowStore-only metadata update can schedule its scoped refresh');
bpDoc.nativeWindowInstance.LocationPathName='/library/app/1593500/Info';flush();
assert.equal(nativeRenders,0,'A pending refresh loses ownership immediately on a native WindowInstance destination');
assert.equal(bpStore.GetAppData(app.appid),bpBase,'A native route receives the original shortcut object without metadata overlay');
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'A stale linked target cannot retain its bridge on a native destination');
bpDoc.nativeWindowInstance.LocationPathName='/library/app/'+(app.appid+1)+'/Info';
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'Another shortcut cannot inherit metadata through a shared public AppID');
bpDoc.nativeWindowInstance.LocationPathName='/library/app/'+app.appid+'/Info';
bpDoc.nativeWindowInstance.BrowserWindow=win;
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'An instance owned by another CEF cannot authorize the local BP shell');
bpDoc.nativeWindowInstance.BrowserWindow=bpWin;verifiedMappings['shortcut:'+app.appid]='550';
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'Relinking revokes the previous metadata pair');
verifiedMappings['shortcut:'+app.appid]='1593500';bpDoc.gamepad=false;
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'Desktop mode cannot adopt a BP information bridge');
bpDoc.gamepad=true;bpWin.closed=true;
activate(bpDoc,shortcut,game);assert.equal(bpStore.GetAppData,bpGetter,'A closed CEF cannot retain metadata ownership');
bpWin.closed=false;activate(bpDoc,shortcut,game);deactivate(bpDoc);
assert.equal(bpStore.GetAppData,bpGetter,'WindowStore-only teardown restores the exact native getter');
console.log('Big Picture native info passed: 20 tab refreshes without forced redraws, 100 overview replacements preserving loaded icons, native description and association getters, local artwork identity, signed IDs and cleanup.');
console.log('WindowStore-only native info ownership passed: 14 checks; production GamepadContext, exact pair/CEF, native/relinked destinations and scoped cleanup.');
