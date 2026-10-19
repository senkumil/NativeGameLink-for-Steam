import './helpers/installed-steam-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';

const edge = process.env.CLOUD_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const steamCss = process.env.STEAM_PLAYBAR_CSS || 'C:/Program Files (x86)/Steam/steamui/css/sp.css';
const chunks = { webpackChunksteamui:[] };
vm.runInNewContext(fs.readFileSync(path.join(path.dirname(path.dirname(steamCss)), 'sp.js'), 'utf8'), { self:chunks });
const factories = Object.assign({}, ...chunks.webpackChunksteamui.map(chunk => chunk[1]));
const nativeModules = { cardFactory:String(factories[63552]), responsiveFactory:String(factories[16252]) };
for (const [name,id] of Object.entries({ card:38731, breaks:60712, main:80100, columns:69359, section:19819 })) {
  const module = { exports:{} }; factories[id](module); nativeModules[name] = module.exports;
}
const sources = Object.fromEntries([
  ['trading-cards', 'frontend/features/library/trading-cards.ts'],
  ['card-style', 'frontend/features/library/styles/trading-cards.ts'],
  ['activity-style', 'frontend/features/library/styles/activity.ts'],
  ['disposables', 'frontend/core/disposables.ts'],
  ['linked-card-presentation', 'frontend/features/library/linked-card-presentation.ts'],
  ['css', 'frontend/steam/css.ts'],
  ['inject', 'frontend/features/library/styles/inject.ts'],
].map(([name, file]) => [name, ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText]));

async function browserChecks(sources, nativeModules) {
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw Error(message); checks++; };
  const settle = async () => { for (let n = 0; n < 4; n++) await new Promise(requestAnimationFrame); };
  const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="274" height="154"><rect width="274" height="154" fill="#568499"/></svg>');
  const modules = {}, dependencies = {
    '../../api/backend': { backendLog() {} },
    '../../core/text': { escapeHtml: value => String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;') },
    '../../steam/localization': { gdlText: (_key, fallback) => fallback, loc: (_key, fallback) => fallback },
    './class-module-cache': { resolveSteamClassModule: (predicate, fallback) => ({ classes:Object.values(nativeModules).find(value => value && typeof value === 'object' && predicate(value)) || fallback }) },
    './community-items': { getOfficialCommunityItems: async () => ({ cards:Array.from({ length:12 },(_,n) => ({ image, title:`Card ${n}`, full_image:image })) }), normalizeCommunityAssetUrl: value => value || '' },
    './constants': { GDL_INJECTED:'gdl-library-injected' },
    './layout': { buildNativeSidebarSection: (_doc, _layout, options) => {
      const section = document.createElement('section'); section.id = options.sectionId;
      section.innerHTML = `<h2><div></div></h2><div class="${nativeModules.section.AppDetailsSectionContainer} ${nativeModules.section.RightColumnSection}"><div id="${options.innerId}">${options.innerHtml}</div></div>`; return section;
    } },
    './sidebar-order': { getLinkedSidebarOrder: (_doc, layout) => ({ shortcutAppId:'3000000001', isCurrent:() => true,
      publish: section => { layout.sidebarColumn.append(section); return true; } }) },
    './trading-card-preload': { clearTradingCardPreloads() {}, getTradingCardPreload() {}, preloadTradingCardImage() {} },
    './native-card-preview': { disposeNativeCardPreview() {}, tryOpenNativeCardPreview:() => false },
  };
  let hookValues = [], hookIndex = 0, nativePaneWidth = 0;
  const jsx = (type, props = {}) => ({ type,props });
  class NativeComponent { constructor(props) { this.props=props; } setState(state) { this.state={...this.state,...state}; } }
  const nativeDependencies = {
    62540:{ jsx,jsxs:jsx,Fragment:Symbol('Fragment') },
    63696:{ Component:NativeComponent,useId:()=> 'native-card',useState: initial => { const index=hookIndex++; if (!(index in hookValues)) hookValues[index]=initial; return [hookValues[index], value => { hookValues[index]=value; }]; },useEffect() {},useCallback:callback=>callback },
    8658:{ A:(...values)=>values.filter(value=>typeof value==='string'&&value).join(' ') },
    71262:{ oI:(_target,_key,descriptor)=>descriptor },
    83780:{ wY:()=>()=>{} }, 38731:nativeModules.card,60712:nativeModules.breaks,
    39828:{ rV:{ GetClientSetting:()=>[false] } }, 7727:{ we:token=>token,Yp:token=>token },
    23365:{ Fu:(value,min,max,outMin,outMax)=>outMin+(value-min)/(max-min)*(outMax-outMin) },
    12492:{ H_:()=>({ rgCards:Array.from({length:12},(_,n)=>({ nOwned:0,strMarketHash:`card${n}`,strImgURL:image,strTitle:`Card ${n}` })) }) },
    843:{ o:{ get rightPanelWidth() { return nativePaneWidth; } } },
  };
  const nativeRequire = id=>nativeDependencies[id]||{};
  nativeRequire.d=(target,exports)=>{for(const[name,getter]of Object.entries(exports)) Object.defineProperty(target,name,{get:getter});};
  nativeRequire.n=value=>()=>value;
  const nativeCards={},nativeResponsive={};
  new Function(`return (${nativeModules.cardFactory})`)()({},nativeCards,nativeRequire);
  new Function(`return (${nativeModules.responsiveFactory})`)()({},nativeResponsive,nativeRequire);
  const nativeCard = (width,owned=false) => {
    hookValues=[true,0,0,0,width,false,false];hookIndex=0;
    return nativeCards.dI({ data:{ nOwned:owned?1:0,strImgURL:image,strMarketHash:'oracle',strTitle:'Oracle' },animateHover:true });
  };
  const load = name => {
    if (modules[name]) return modules[name];
    const exports = {}; modules[name] = exports;
    new Function('require','exports',sources[name] + (name === 'trading-cards' ? '\nexports.openPreviewForCheck = openTradingCardPreview;' : ''))(dependency => {
      if (dependencies[dependency]) return dependencies[dependency];
      const key = dependency.split('/').pop();
      if (sources[key]) return load(key);
      throw Error(`Unknown ${name} dependency ${dependency}`);
    }, exports); return exports;
  };
  try {
    const native = document.getElementById('native-oracle'), nativeBefore = native.outerHTML;
    const events = load('css').EVENT_CLASSES();
    const nativeNews = `<div class="${events.PartnerEventMediumImage_Contents}"><div class="${events.MediumImageContainer}"><img class="${events.PartnerEventMediumImage_Image}" src="${image}"></div><div class="${events.PartnerEventMediumImage_TextColumn}"><div class="${events.PartnerEventType}">News</div><div class="${events.PartnerEventMediumImage_Title}">Native news title</div></div></div>`;
    const linkedNews = `<div id="gdl-activity-feed"><div class="${events.PartnerEventMediumImage_Contents} gdl-news-layout"><div class="${events.MediumImageContainer} gdl-news-image"><img class="${events.PartnerEventMediumImage_Image} gdl-news-image-fg" src="${image}"></div><div class="${events.PartnerEventMediumImage_TextColumn} gdl-news-copy"><div class="${events.PartnerEventType} gdl-news-type">News</div><div class="${events.PartnerEventMediumImage_Title} gdl-news-title">Native news title</div></div></div></div>`;
    const oracleHost = document.createElement('div'), linkedHost = document.createElement('div');
    document.body.append(oracleHost, linkedHost); oracleHost.innerHTML = nativeNews; linkedHost.innerHTML = linkedNews;
    const oracleLayout = oracleHost.firstElementChild, linkedLayout = linkedHost.querySelector('.gdl-news-layout');
    const oracleImage = oracleHost.querySelector('img'), linkedImage = linkedHost.querySelector('img');
    await Promise.all([oracleImage.decode(), linkedImage.decode()]);
    load('activity-style').ensureActivityStyles(document);
    load('card-style').ensureTradingCardStyles(document);
    const stopMotion = document.createElement('style'); stopMotion.textContent = '.gdl-trading-card-surface{transition:none!important}'; document.head.append(stopMotion);
    for (const zoom of [.75,1,1.25,1.5,2]) for (const [width, classes, column] of [[950,'',false],[700,'',false],[540,'NarrowRightPanel',true],[340,'NarrowRightPanel UltraNarrowRightPanel',true]]) {
      oracleHost.className = linkedHost.className = classes;
      oracleHost.style.cssText = linkedHost.style.cssText = `width:${width}px;zoom:${zoom}`;
      await settle();
      const label = `news ${width}px ${zoom * 100}%`;
      check(getComputedStyle(oracleLayout).flexDirection === getComputedStyle(linkedLayout).flexDirection
        && getComputedStyle(linkedLayout).flexDirection === (column ? 'column':'row'), `${label}: native pane reflow`);
      const a = oracleImage.getBoundingClientRect(), b = linkedImage.getBoundingClientRect();
      check(Math.abs(a.width-b.width)<1.1 && Math.abs(a.height-b.height)<1.1, `${label}: native 274x154 thumbnail`);
      const aCopy = oracleHost.querySelector(`.${events.PartnerEventMediumImage_TextColumn}`).getBoundingClientRect();
      const bCopy = linkedHost.querySelector('.gdl-news-copy').getBoundingClientRect();
      const aLayout = oracleLayout.getBoundingClientRect(), bLayout = linkedLayout.getBoundingClientRect();
      check(Math.abs((aCopy.left-aLayout.left)-(bCopy.left-bLayout.left))<1.1
        && Math.abs((aCopy.top-aLayout.top)-(bCopy.top-bLayout.top))<1.1, `${label}: native image/text alignment`);
    }
    oracleHost.remove(); linkedHost.remove();
    const cards = load('trading-cards');
    const makePane = top => {
      const owner=document.createElement('div');owner.className=nativeModules.main.MainPanel;
      owner.style.cssText=`position:absolute;left:0;top:${top}px;width:1280px;height:600px`;
      owner.innerHTML=`<div class="${nativeModules.main.AppDetailsTransitionGroup}"><div class="${nativeModules.main.AppDetailsMain}"><div style="width:calc(100% - 13px)"><div class="${nativeModules.columns.Container}"><div class="${nativeModules.columns.ColumnContainer}"><div class="${nativeModules.columns.RightColumn}"></div><div class="${nativeModules.columns.LeftColumn}"></div></div></div></div></div></div>`;
      document.body.append(owner);
      const responsive=new nativeResponsive.b({ breakUltraNarrow:[600,'UltraNarrowRightPanel'],breakNarrow:[884,'NarrowRightPanel'],breakWide:[1500,'WideRightPanel'],strMedium:'MediumRightPanel',fnDimensionsChanged:width=>{nativePaneWidth=width;} });
      responsive.m_elOuterContainer=owner;
      const update=()=>{responsive.OnResize();owner.className=`${nativeModules.main.MainPanel} ${responsive.state.strResponsiveClasses}`;};
      return {owner,update,row:owner.querySelector(`.${nativeModules.columns.ColumnContainer}`),column:owner.querySelector(`.${nativeModules.columns.RightColumn}`)};
    };
    const linkedPane=makePane(100), oraclePane=makePane(1400),host=linkedPane.column;
    linkedPane.update();oraclePane.update();
    await cards.renderOfficialTradingCards(document, { anchorRegion:host, sidebarColumn:host,twoColumnRow:linkedPane.row },
      { steamAppId:123, shortcutAppId:3000000001, gameName:'Test', isCurrent:() => true });
    const card = host.querySelector('.gdl-trading-card'), surface = card.querySelector('.gdl-trading-card-surface');
    const originalImage = card.querySelector('img');
    await settle();
    const body = host.querySelector('.gdl-trading-cards-body'), grid = host.querySelector('.gdl-trading-card-grid');
    let gridWrites = 0;
    const gridObserver = new MutationObserver(records => { gridWrites += records.length; });
    gridObserver.observe(grid, { attributes:true, attributeFilter:['style'] });
    const bodyHeight = body.offsetHeight;
    for (let n = 0; n < 4; n++) {
      body.style.height = `${bodyHeight + 20 + n}px`; await settle();
    }
    gridWrites += gridObserver.takeRecords().length; gridObserver.disconnect();
    check(gridWrites === 0, 'Same-column ResizeObserver height changes perform zero grid style writes after CSSOM normalization');
    body.style.removeProperty('height'); await settle();
    for (const zoom of [.75,1,1.25,1.5,2]) {
      document.body.style.zoom = String(zoom);
      for(const width of [600,883,884,885,925,926,927,1125,1126,1127,1499,1500,1501,1900,2500,3200]) {
        linkedPane.owner.style.width=oraclePane.owner.style.width=`${width}px`;linkedPane.update();oraclePane.update();
        hookIndex=0;hookValues=[];
        const nativeSection=nativeCards.LB({details:{unAppID:123}});
        oraclePane.column.innerHTML=`<div class="${nativeSection.props.className}"><div class="${nativeModules.section.AppDetailsSectionContainer} ${nativeModules.section.RightColumnSection}"><div class="${nativeModules.section.Body}"><div class="${nativeModules.card.CardsSection}">${Array.from({length:12},()=>`<div class="${nativeModules.card.CardWrapper}"></div>`).join('')}</div></div></div></div>`;
        await settle();
        const expectedGrid=oraclePane.column.querySelector(`.${nativeModules.card.CardsSection}`), expectedCards=[...expectedGrid.children], actualCards=[...grid.children];
        for(const item of expectedCards) item.style.height=`${nativeCard(parseFloat(getComputedStyle(item).width)).props.style.height}px`;
        await settle();
        const aGrid=expectedGrid.getBoundingClientRect(),bGrid=grid.getBoundingClientRect();
        check(Math.abs(aGrid.width-bGrid.width)<1.1,`native cards ${width}px ${zoom*100}%: section body gutters match (${aGrid.width}/${bGrid.width})`);
        for(let n=0;n<actualCards.length;n++) {
          const a=expectedCards[n].getBoundingClientRect(),b=actualCards[n].getBoundingClientRect();
          check(Math.abs(a.width-b.width)<1.1&&Math.abs(a.height-b.height)<1.1&&Math.abs((a.left-aGrid.left)-(b.left-bGrid.left))<1.1&&Math.abs((a.top-aGrid.top)-(b.top-bGrid.top))<1.1,
            `native cards ${width}px ${zoom*100}%: card${n} preserves installed renderer/CSS dimensions and wrapping (${a.width}/${b.width},${a.height}/${b.height};${grid.style.cssText};owner${linkedPane.owner.clientWidth};${nativeSection.props.className})`);
        }
      }
      linkedPane.owner.style.width=oraclePane.owner.style.width=`${innerWidth/zoom/2}px`;linkedPane.update();oraclePane.update();
      window.dispatchEvent(new Event('resize')); await settle();
      const base = card.getBoundingClientRect();
      card.dispatchEvent(new PointerEvent('pointerenter', { clientX:base.left+base.width/2, clientY:base.top+base.height/2 }));
      await settle();
      const expanded = surface.getBoundingClientRect(), logical = parseFloat(getComputedStyle(card).width);
      const nativeHover=nativeCard(logical).props.children.props.style;
      check(Math.abs(parseFloat(surface.style.width)-nativeHover.width)<.02
        && Math.abs(expanded.width/base.width-nativeHover.width/logical)<.01, `cards ${zoom*100}%: expand once using installed unowned-card sizing`);
      check(Math.abs(parseFloat(surface.style.height)-nativeHover.height)<.02
        &&Math.abs(parseFloat(surface.style.left)-nativeHover.left)<.02&&Math.abs(parseFloat(surface.style.top)-nativeHover.top)<.02,
        `cards ${zoom*100}%: expanded height and centering match the installed card hook`);
      check(nativeCard(logical,true).props.children.props.style.width>nativeHover.width,
        `cards ${zoom*100}%: asset catalogue does not claim the native owned/maxed expansion`);
      check(Math.abs(expanded.left+expanded.width/2-base.left-base.width/2)<1.1, `cards ${zoom*100}%: expansion stays centered`);
      window.dispatchEvent(new Event('resize')); await settle();
      check(!card.classList.contains('gdl-card-tilt-active') && !surface.style.width, `cards ${zoom*100}%: resize clears obsolete hover geometry`);
      if(zoom===1) {
        card.style.left=`${innerWidth-card.getBoundingClientRect().right-10}px`;
        const edge=card.getBoundingClientRect();
        hookValues=[false,0,0,0,logical,false,false];hookIndex=0;
        const data={nOwned:0,strImgURL:image,strMarketHash:'edge',strTitle:'Edge'};
        const initial=nativeCards.dI({data,animateHover:true});
        initial.props.children.props.onMouseEnter({currentTarget:card});
        hookIndex=0;const active=nativeCards.dI({data,animateHover:true}).props.children.props.style;
        const shift=new DOMMatrix(active.transform).m41;
        initial.props.children.props.onMouseLeave({currentTarget:card});
        card.dispatchEvent(new PointerEvent('pointerenter',{clientX:edge.left+edge.width/2,clientY:edge.top+edge.height/2}));await settle();
        check(Math.abs(parseFloat(surface.style.left)-active.left-shift)<.02,
          'The native card enter handler and GDL apply the same 30px right-edge correction');
        window.dispatchEvent(new Event('resize'));card.style.removeProperty('left');await settle();
      }
      const help = host.querySelector('.gdl-trading-cards-help-btn');
      const helpStyle = help.getAttribute('style');
      help.style.cssText = 'position:fixed;right:4px;bottom:4px';
      help.dispatchEvent(new Event('mouseenter')); await settle();
      const popup = document.querySelector('.gdl-trading-cards-help-popup'), box = popup.getBoundingClientRect();
      check(box.left >= 0 && box.top >= 0 && box.right <= innerWidth+1.1 && box.bottom <= innerHeight+1.1,
        `cards ${zoom*100}%: near-bottom help tooltip fits both scaled viewport axes`);
      window.dispatchEvent(new Event('resize')); await settle();
      check(!popup.isConnected, `cards ${zoom*100}%: resize removes obsolete tooltip coordinates`);
      if (helpStyle === null) help.removeAttribute('style'); else help.setAttribute('style', helpStyle);
      card.dispatchEvent(new KeyboardEvent('keydown',{ key:'Enter', bubbles:true })); await settle();
      const preview = document.getElementById('gdl-trading-card-preview'), panel = preview.querySelector('.gdl-trading-card-preview-panel');
      const panelBox = panel.getBoundingClientRect();
      check(panelBox.left >= -1.1 && panelBox.top >= -1.1 && panelBox.right <= innerWidth+1.1 && panelBox.bottom <= innerHeight+1.1,
        `cards ${zoom*100}%: fallback image viewer and close button fit the actual scaled viewport`);
      cards.disposeTradingCardPreview(document);
      check(card.querySelector('img') === originalImage, `cards ${zoom*100}%: previews preserve the original card image`);
      for (const [w,h] of [[1920,1080],[600,900]]) {
        const fullImage = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#568499"/></svg>`);
        cards.openPreviewForCheck(document, fullImage, 'Full artwork');
        const viewer = document.getElementById('gdl-trading-card-preview'), artwork = viewer.querySelector('img');
        await artwork.decode(); await settle();
        const frame = viewer.querySelector('.gdl-trading-card-preview-panel').getBoundingClientRect();
        for (const [element,label] of [[artwork,'artwork'],[viewer.querySelector('.gdl-trading-card-preview-close'),'close button']]) {
          const rect = element.getBoundingClientRect();
          check(rect.left >= frame.left-1.1 && rect.top >= frame.top-1.1 && rect.right <= frame.right+1.1 && rect.bottom <= frame.bottom+1.1,
            `cards ${zoom*100}% ${w}x${h}: ${label} stays inside the fitted panel`);
          check(rect.left >= -1.1 && rect.top >= -1.1 && rect.right <= innerWidth+1.1 && rect.bottom <= innerHeight+1.1,
            `cards ${zoom*100}% ${w}x${h}: ${label} stays inside the actual viewport`);
        }
        cards.disposeTradingCardPreview(document);
      }
    }
    document.body.style.zoom = '1'; cards.disposeTradingCardUI(document);
    check(!card.querySelector('.gdl-trading-card-hitbox'), 'Card disposal removes its owned hover hitbox');
    linkedPane.owner.remove();oraclePane.owner.remove();
    check(native.outerHTML === nativeBefore, 'Native controls remain untouched');
    return {ok:true,checks};
  } catch(error) { return {ok:false,checks,error:String(error.stack||error)}; }
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'gdl-desktop-media-'));
const fixture = path.join(scratch,'fixture.html');
const serialize = value => JSON.stringify(value).replace(/</g,'\\u003c');
fs.writeFileSync(fixture,`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(steamCss).href}"><style>body{margin:0;background:#24282f;color:#ddd}h2{margin:0}.gdl-trading-cards-help-btn{float:right}</style></head><body class="DesktopUI"><div id="gdl-library-injected"></div><div id="native-oracle">Native controls</div><script>window.runChecks=()=>(${browserChecks.toString()})(${serialize(sources)},${serialize(nativeModules)})</script></body></html>`);
const profile = path.join(scratch,'profile');
const child = spawn(edge,['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--allow-file-access-from-files','--window-size=1600,1000','--remote-debugging-port=0',`--user-data-dir=${profile}`,pathToFileURL(fixture).href],{windowsHide:true,stdio:'ignore'});
let socket;
try {
  const deadline = Date.now()+10000, endpoint = path.join(profile,'DevToolsActivePort');
  while(!fs.existsSync(endpoint) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
  const port = fs.readFileSync(endpoint,'utf8').split(/\r?\n/)[0];
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response=>response.json());
  socket = new WebSocket(targets.find(target=>target.type==='page' && target.url===pathToFileURL(fixture).href).webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let next=0; const pending=new Map();
  socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(pending.has(result.id)){pending.get(result.id)(result);pending.delete(result.id);}});
  const call = (method,params={})=>new Promise((resolve,reject)=>{
    const id=++next, timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timed out: ${method}`));},30000);
    pending.set(id,result=>{clearTimeout(timer);result.error?reject(Error(JSON.stringify(result.error))):resolve(result.result);});
    socket.send(JSON.stringify({id,method,params}));
  });
  let checks = 0;
  for (const [width,height,deviceScaleFactor] of [[1600,1000,1],[900,700,2]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor,mobile:false});
    const result=await call('Runtime.evaluate',{expression:'(async()=>{const deadline=Date.now()+10000;while((typeof window.runChecks!=="function" || document.readyState!=="complete")&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));return window.runChecks()})()',awaitPromise:true,returnByValue:true});
    assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
    assert(result.result.value.ok,`${width}x${height} DPR${deviceScaleFactor}: ${JSON.stringify(result.result.value,null,2)}`);
    checks += result.result.value.checks;
  }
  console.log(`Desktop media responsive browser passed: ${checks} native news geometry, 75–200% zoom, DPR1/2, card expansion, tooltips, image viewer, stable media and disposal assertions.`);
} finally {socket?.close();child.kill();}
