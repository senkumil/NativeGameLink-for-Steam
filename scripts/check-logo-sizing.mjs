import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const storage = new Map();
let actual = null;
const writes=[];
const logoLayoutCtx={exports:{},require:()=>({})};
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/logo-layout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,vm.createContext(logoLayoutCtx));
const mocks={backendLog(){},waitForSteamBridge:async()=>true,readLogoLayout:async()=>({logo:'fixture',hero:'hero',key:'pairA'}),
 prepareAutomaticLogo:async()=>({logo:'fixture',nWidthPct:100,nHeightPct:65,naturalWidth:400,naturalHeight:100}),layoutFingerprint:()=> 'pairA',
 readCustomLogoPositionBackend:async()=>({ok:true,exists:!!actual,logo_position:actual}),
 calibrateLogoBox:logoLayoutCtx.exports.calibrateLogoBox,automaticLogoBox:logoLayoutCtx.exports.automaticLogoBox};
const ctx=vm.createContext({exports:{},require:()=>mocks,setTimeout:fn=>{fn();return 1;},
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 window:{SteamClient:{Apps:{SetCustomLogoPositionForApp(id,json){actual=JSON.parse(json).logoPosition;writes.push(actual);return true;}}}}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/artwork-logo-position.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
const apply=(id,raw=null,current=()=>true)=>ctx.exports.applyLogoPosition(3000000001,id,raw,false,'BottomLeft','none',current);
actual={pinnedPosition:'BottomLeft',nWidthPct:50,nHeightPct:50};
storage.set('gdl_logo_position4_3000000001',JSON.stringify({steamAppId:'12210',version:4,profileRevision:1,verified:true}));
assert.equal(ctx.exports.isLogoPositionVerified(3000000001,'12210'),false);
assert.equal(await apply('12210'),true);
assert.equal(writes.at(-1).nWidthPct,100);
assert.equal(writes.at(-1).nHeightPct,65);
assert.equal(ctx.exports.isLogoPositionVerified(3000000001,'12210'),true);
const count=writes.length; await apply('12210');assert.equal(writes.length,count);
storage.clear();actual={pinnedPosition:'UpperLeft',nWidthPct:82,nHeightPct:64};
await apply('12210');assert.equal(writes.at(-1).nWidthPct,82,'Native custom dimensions must survive migration');
storage.clear();actual=null;
await apply('100',{pinned_position:'BottomLeft',width_pct:42,height_pct:35});
assert.equal(writes.at(-1).nWidthPct,42,'Official width retained');assert.equal(writes.at(-1).nHeightPct,35);
storage.clear();actual=null; await apply('221430');assert.equal(writes.at(-1).nWidthPct,50);
storage.clear();actual=null; await apply('237110');assert.equal(writes.at(-1).nWidthPct,58);
storage.clear();actual=null; await apply('1091500',{pinned_position:'BottomCenter',width_pct:31.63,height_pct:99.68});
assert.equal(writes.at(-1).pinnedPosition,'BottomCenter');assert.equal(writes.at(-1).nWidthPct,31.63);assert.equal(writes.at(-1).nHeightPct,99.68);
storage.clear();actual=null; await apply('2358720',{pinned_position:'BottomLeft',width_pct:56.31,height_pct:69.79});
assert.equal(writes.at(-1).pinnedPosition,'BottomLeft');assert.equal(writes.at(-1).nWidthPct,56.31);assert.equal(writes.at(-1).nHeightPct,69.79);
storage.clear();actual=null; await apply('3357650',{pinned_position:'BottomCenter',width_pct:68.47,height_pct:53.57});
assert.equal(writes.at(-1).pinnedPosition,'BottomCenter');assert.equal(writes.at(-1).nWidthPct,68.47);assert.equal(writes.at(-1).nHeightPct,53.57);
storage.clear();actual={pinnedPosition:'BottomCenter',nWidthPct:40,nHeightPct:32};
await apply('3357650',{pinned_position:'BottomCenter',width_pct:68.47,height_pct:53.57});
assert.equal(writes.at(-1).nWidthPct,68.47,'Stale buggy clamped box is replaced by official dimensions');
storage.clear();actual=null; await apply('999999',{pinned_position:'BottomCenter',width_pct:48,height_pct:40});
assert.equal(writes.at(-1).pinnedPosition,'BottomCenter');assert.equal(writes.at(-1).nWidthPct,48);assert.equal(writes.at(-1).nHeightPct,40);
storage.clear();actual=null;const before=writes.length;await apply('100',null,()=>false);assert.equal(writes.length,before);
console.log('Logo sizing passed: content-based migration, official dimensions, native custom adjustment, curated profiles, stale work and repeat suppression.');
