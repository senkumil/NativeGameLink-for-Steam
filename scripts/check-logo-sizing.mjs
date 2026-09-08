import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const storage = new Map();
let actual = null;
const writes=[];
const mocks={backendLog(){},waitForSteamBridge:async()=>true,readLogoLayout:async()=>({logo:'fixture',hero:'hero',key:'pairA'}),prepareAutomaticLogo:async()=>({logo:'fixture',nWidthPct:100,nHeightPct:65}),layoutFingerprint:()=> 'pairA',
 readCustomLogoPositionBackend:async()=>({ok:true,exists:!!actual,logo_position:actual})};
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
storage.clear();actual=null;const before=writes.length;await apply('100',null,()=>false);assert.equal(writes.length,before);
console.log('Logo sizing passed: content-based migration, official dimensions, native custom adjustment, curated profiles, stale work and repeat suppression.');
