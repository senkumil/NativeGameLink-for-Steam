import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const cache = new Map();
let transient = false;
const announcement = {gid:'1',title:'Official update',date:1700000000,contents:'Patch details',
  feedname:'steam_community_announcements',is_external_url:true,url:'https://store.steampowered.com/news/app/1593500/view/1'};
const modules = {
  '../../api/backend': {backendLog(){},
    fetchPartnerEventsBackend:async()=>JSON.stringify({items:[],unavailable:true}),
    fetchNewsBackend:async()=>JSON.stringify(transient ? {items:[],transient_error:true} : {items:[announcement,
      {...announcement,gid:'2',title:'Not Steam',url:'https://steampowered.com.example.org/news'}]})},
  '../../core/cache': {CACHE_TTL:{news:1000},CACHE_RETENTION:{},cacheRead:()=>null,cacheSet:(k,v)=>cache.set(k,v)},
  '../../core/request-cache': {RetryingRequestCache:class {peek(){return null;} get(k,load){return load();}}},
  '../../core/game-data': {getSynchronousGameData:()=>null},
  '../../steam/localization': {gdlText:(k,f)=>f,steamLanguageSync:()=> 'english'},
};
const context = vm.createContext({exports:{},URL,setTimeout,clearTimeout,require:name=>{
  if(!modules[name]) throw Error(name); return modules[name];
}});
vm.runInContext(ts.transpileModule(fs.readFileSync('frontend/features/library/news.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,context);
const metadata={name:'God of War',release_date:{date:'Jan 14, 2022'}};
const items=await context.exports.getNews('1593500','english',metadata);
assert.equal(items.length,1);
assert.equal(items[0].gid,'1','official external-flag announcement must survive');
cache.clear(); transient=true;
await context.exports.getNews('1593500','english',metadata);
assert.equal(cache.size,0,'unavailable partner endpoint must not persist a transient news fallback');
console.log('News runtime: official announcements retained, spoofed hosts rejected, transient fallback not persisted');

