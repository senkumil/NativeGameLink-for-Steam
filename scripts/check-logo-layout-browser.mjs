import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const sources=Object.fromEntries(['library/artwork-image','library/logo-layout','library/artwork-logo-position','shortcuts/logo-editor'].map(name=>[name.split('/').pop(),ts.transpileModule(fs.readFileSync(`frontend/features/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText]));
const grid='C:/Program Files (x86)/Steam/userdata/860367772/config/grid/3926426387';
// Optional real local GTA IV fixture; no network or live Steam mutation.
const logo=fs.existsSync(grid+'_logo.png')?'data:image/png;base64,'+fs.readFileSync(grid+'_logo.png').toString('base64'):null;
const hero=fs.existsSync(grid+'_hero.jpg')?'data:image/jpeg;base64,'+fs.readFileSync(grid+'_hero.jpg').toString('base64'):'';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 await page.route('http://ngl.test/',route=>route.fulfill({body:'<body style="background:#10151b"></body>',contentType:'text/html'}));
 await page.goto('http://ngl.test/');
 const metrics=await page.evaluate(async({sources,logo,hero})=>{
  if(!logo){const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(167,28,307,304);logo=c.toDataURL();}
  const state=window.fixture={logo,hero,key:'',writes:0,position:{pinnedPosition:'BottomLeft',nWidthPct:70,nHeightPct:70}};
  const modules={};
  const mocks={readLogoLayoutImagesBackend:async()=>JSON.stringify({ok:true,logo:state.logo,hero:state.hero}),
   readCustomLogoPositionBackend:async()=>JSON.stringify({ok:true,exists:true,logo_position:state.position}),
   backendLog(){},waitForSteamBridge:async p=>{await p;return true;},gdlText:(_key,fallback)=>fallback,
   mountModalDialog:d=>{document.body.append(d);d.addEventListener('cancel',e=>e.preventDefault());d.showModal();}};
  window.SteamClient={Apps:{SetCustomLogoPositionForApp:(_id,json)=>{state.position=JSON.parse(json).logoPosition;state.writes++;return true;},SetCustomArtworkForApp:(_id,base64)=>{state.logo='data:image/png;base64,'+base64;return true;}}};
  for(const name of ['artwork-image','logo-layout','artwork-logo-position','logo-editor']){
   const exports={};new Function('require','exports',sources[name])(path=>modules[path.split('/').pop()]||mocks,exports);modules[name]=exports;
  }
  window.modules=modules;
  const p=await modules['logo-layout'].prepareAutomaticLogo(logo);
  const image=new Image();image.src=p.logo;await image.decode();
  await modules['artwork-logo-position'].applyLogoPosition(3000000001,'12210',null,false,'BottomLeft','none',()=>true);
  await modules['logo-editor'].openLogoEditor(document,3000000001,'12210');
  return {width:image.naturalWidth,height:image.naturalHeight,box:[p.nWidthPct,p.nHeightPct],position:state.position};
 },{sources,logo,hero});
 assert.ok(metrics.width<1280 && metrics.height<=720);assert.deepEqual(metrics.box,[100,65]);
 const preview=page.locator('#gdl-logo-editor > div').first();
 const wideBox=await preview.boundingBox();
 await page.getByRole('button',{name:'Toggle narrow preview',exact:true}).click();
 const narrowBox=await preview.boundingBox();
 assert.ok(narrowBox.width<wideBox.width);assert.equal(narrowBox.height,wideBox.height);
 await page.getByRole('button',{name:'Toggle narrow preview',exact:true}).click();
 await page.locator('select').selectOption('CenterCenter');
 await page.locator('input[type=range]').first().fill('55');
 await page.locator('input[type=range]').first().dispatchEvent('input');
 await page.screenshot({path:process.env.TEMP+'/ngl-logo-editor-preview.png'});
 const before=await page.evaluate(()=>fixture.writes);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.evaluate(()=>fixture.writes),before);
 await page.evaluate(()=>modules['logo-editor'].openLogoEditor(document,3000000001,'12210'));
 await page.locator('select').selectOption('UpperCenter');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.locator('#gdl-logo-editor').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>fixture.position.pinnedPosition),'UpperCenter');
 const pairSaved=await page.evaluate(async()=>{const l=await modules['logo-layout'].readLogoLayout(3000000001);return modules['artwork-logo-position'].getLogoAdjustment(3000000001,'12210',l.key);});
 assert.equal(pairSaved.pinnedPosition,'UpperCenter');
 await page.evaluate(()=>modules['logo-editor'].openLogoEditor(document,3000000001,'12210'));
 await page.getByRole('button',{name:'Restore automatic layout',exact:true}).click();
 await page.locator('#gdl-logo-editor').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>fixture.position.nWidthPct),100,'Explicit reset replaces a saved manual width');
 assert.equal(await page.evaluate(()=>fixture.position.pinnedPosition),'BottomLeft');
 const other=await page.evaluate(async()=>{fixture.hero+='changed';const l=await modules['logo-layout'].readLogoLayout(3000000001);return modules['artwork-logo-position'].getLogoAdjustment(3000000001,'12210',l.key);});
 assert.equal(other,null,'A different background must not inherit the saved layout');
 const resize=await page.evaluate(async()=>{
  const host=document.createElement('div');host.style.cssText='position:relative;height:409px';document.body.append(host);
  const region=document.createElement('div');region.style.cssText='position:absolute;inset:16px 26px';host.append(region);
  const box=document.createElement('div');box.style.cssText='position:absolute;left:0;bottom:0';region.append(box);
  const img=new Image();img.style.cssText='position:absolute;left:0;bottom:0;height:100%;max-height:100%;max-width:100%;object-fit:contain;object-position:bottom';box.append(img);
  img.src=fixture.logo;await img.decode();
  const result=[];
  for(const ratio of [0.5,1,2,4]){
   // Use opaque fixtures to measure the painted logo, independently of alpha padding.
   const c=document.createElement('canvas');c.width=400*ratio;c.height=400;c.getContext('2d').fillRect(0,0,c.width,c.height);img.src=c.toDataURL();await img.decode();
   const size=modules['logo-layout'].automaticLogoBox(c.width,c.height);box.style.width=size.nWidthPct+'%';box.style.height=size.nHeightPct+'%';
   const measured=[];
   for(const width of [1582,942,400]){
    host.style.width=width+'px';const rect=img.getBoundingClientRect();
    const scale=Math.min(rect.width/c.width,rect.height/c.height);
    measured.push({w:c.width*scale,h:c.height*scale,available:region.clientWidth});
   }
   result.push(measured);
  }
  host.remove();return result;
 });
 for(const row of resize){
  assert.ok(Math.abs(row[0].h-row[1].h)<1,'Sidebar resize should retain preferred height while the logo fits');
  for(const size of row) assert.ok(size.w<=size.available+1,'Very narrow panels must still contain the logo');
 }
 console.log('Logo layout browser passed: real alpha crop, proportional box, preview, cancel without writes, save/readback and per-pair isolation.',metrics);
}finally{await browser.close();}

