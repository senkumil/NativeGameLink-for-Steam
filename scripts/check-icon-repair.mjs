import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const icons=[];
const mocks={backendLog(){},getMappedShortcuts:()=>[{id:3000000001,steamAppId:'221430'}],
 artworkAlreadySaved:()=>true,isLogoPositionVerified:()=>true,spoofArtwork:()=>{throw Error('Already complete artwork must not be repainted');},
 applyOfficialShortcutIcon:async id=>{icons.push(id);}};
const ctx=vm.createContext({exports:{},require:()=>mocks});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/artwork-sync.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,ctx);
await ctx.exports.syncMissingArtworkForMappedShortcuts();
assert.deepEqual(icons,[3000000001]);
ctx.exports.prioritizeShortcutArtwork(3000000002,'237110');
await new Promise(resolve=>setImmediate(resolve));
assert.deepEqual(icons,[3000000001,3000000002]);
console.log('Icon repair runs even when artwork is complete, on startup and priority selection');
