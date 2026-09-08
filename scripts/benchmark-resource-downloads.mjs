import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';
const files=process.argv.length > 2 ? process.argv.slice(2) : ['frontend/features/library/artwork-image.ts'];
const cases=[['modern','1091500'],['older','12210'],['delisted','221430']];
const results=[];
for(const file of files){
 for(const [group,id] of cases){
  let requests=0,bytes=0,active=0,peak=0;const statuses={};
  const mocks={fetchArtworkImageBackend:async({request_json})=>{
   const {url}=JSON.parse(request_json);requests++;active++;peak=Math.max(peak,active);
   try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});statuses[r.status]=(statuses[r.status]||0)+1;
    const body=Buffer.from(await r.arrayBuffer());bytes+=body.length;
    return JSON.stringify({ok:r.ok,status:r.status,mime:r.headers.get('content-type')?.split(';')[0],data_base64:r.ok?body.toString('base64'):''});
   }catch{return JSON.stringify({ok:false,status:0});}finally{active--;}
  }};
  const ctx=vm.createContext({exports:{},require:()=>mocks,Date,URL,AbortController,setTimeout,clearTimeout});
  vm.runInContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,ctx);
  const urls=['header.jpg','logo.png'].map(n=>`https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/${n}`);
  const run=()=>Promise.all(urls.flatMap(url=>[ctx.exports.imageUrlToBase64(url),ctx.exports.imageUrlToBase64(url)]));
  let start=performance.now();const cold=await run();const coldMs=Math.round(performance.now()-start),coldRequests=requests,coldBytes=bytes;
  start=performance.now();await run();
  const row={file:path.basename(file),group,id,coldMs,coldRequests,coldBytes,warmMs:Math.round(performance.now()-start),warmRequests:requests-coldRequests,warmBytes:bytes-coldBytes,peak,statuses,successfulResults:cold.filter(Boolean).length};
  results.push(row);console.log(JSON.stringify(row));
 }
}
fs.writeFileSync('RESOURCE_BENCHMARK_FIX10.json',JSON.stringify({scope:'Real Steam CDN transfers through the actual frontend loader; Node HTTP adapter replaces Millennium IPC. Two concurrent consumers per URL; not end-to-end linking.',measuredAt:new Date().toISOString(),results},null,2));
