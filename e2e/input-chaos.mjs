// Offline fixture: actual site 31.10 chat scripts, no account and no external transport.
export function fixtureBootstrap() {
  const W = window;
  W.QA = { requests: [], events: [], menu: null, photo: false, classic: false, scene: 'city', violations: [], frames: 0, tabs: [], blocked: [], lastClick: null, lockCalls: 0, pointerHistory: [] };
  window.addEventListener('mousedown',e=>W.QA.lastClick=e.composedPath().slice(0,5).map(x=>x.tagName+'#'+(x.id||'')+'.'+(x.className||'')),true);
  document.addEventListener('pointerlockchange',()=>W.QA.pointerHistory.push({at:performance.now(),locked:!!document.pointerLockElement}));
  document.addEventListener('pointerlockerror',()=>W.QA.pointerHistory.push({at:performance.now(),error:true}));
  document.documentElement.classList.add('l3d-on');
  localStorage.setItem('l3d.debug', 'on'); localStorage.setItem('l3d.whatsnew.enabled', '0');
  localStorage.setItem('l3d.quality', '0'); localStorage.setItem('l3d.cam', 'fp');
  localStorage.setItem('lgChatOne', '1'); localStorage.setItem('lgCityChat', '1');
  W.LG_BASE = ''; W.LG_CH = { login: 'qa_channel', name: 'QA fixture' }; W.LG_AUTHED = true;
  W.LGHeroUi = { name: (x) => String(x || ''), chip: () => '', viewer: () => '' };
  W.LGSiteUi = { is: () => false, esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), when: () => '', body: () => document.body, fmt: () => '', skin: () => '', copy: () => {} };
  W.QA.api = async (p, b) => {
    W.QA.requests.push({ path: p, body: b });
    if (/say|buy|equip|wear|\/act/.test(p)) { W.QA.blocked.push(p); return { ok: false, error: 'QA forbids actions' }; }
    if (p.includes('/feed')) return { ok: true, c: 1, chat: [] };
    if (p.includes('/friends')) return { ok: true, list: [], in: [], out: [], block: [], max: 100, coin: {} };
    return { ok: true, chat: [], c: 1, rooms: {}, threads: [], items: [], peers: [], history: [], lines: [] };
  };
  for (const name of ['l3d:menu', 'l3d:chat', 'l3d:photo', 'l3d:mine-status']) window.addEventListener(name, (e) => {
    W.QA.events.push({ name, detail: e.detail, at: performance.now() });
    if (name === 'l3d:menu') W.QA.menu = e.detail.open;
    if (name === 'l3d:photo') W.QA.photo = !!e.detail.on;
  });
}

export function fixtureSite() {
  const W = window, Q = W.QA;
  const st = document.createElement('style'); st.textContent = `
    #qa-city{position:fixed;inset:0;pointer-events:none}#qa-classic{position:fixed;inset:0;display:none;background:#28202f;color:white;z-index:10;padding:32px;box-sizing:border-box}
    #qa-site-window{position:fixed;left:35%;top:25%;width:30%;min-height:160px;z-index:9999;background:#eee;color:#111;pointer-events:auto;padding:15px}
    .co-float{position:fixed;left:15px;bottom:15px;z-index:165}.cy-chat{position:fixed;left:15px;bottom:15px;width:400px;max-height:300px;background:#211c29;color:#fff;pointer-events:auto}.cy-chat [hidden]{display:none!important}.cy-chat:not(.open) .cy-chat-b{display:none}.cy-chat button{font:12px sans-serif}.cy-chat input{background:#fff;color:#111}.cy-chat-l{height:100px}.co-host{pointer-events:none}
  `; document.head.append(st);
  const city = document.createElement('div'); city.id = 'qa-city'; city.className = 'cy'; const tab=document.createElement('div');tab.id='tab-city';tab.className='on';tab.append(city);document.body.append(tab);
  const classic = document.createElement('section'); classic.id = 'qa-classic'; classic.textContent = 'OFFLINE CLASSIC SITE'; document.body.append(classic);
  const ctx = { api: Q.api, hero: () => ({ login: 'qa_player', c1: 1, cc: 1, mc: 1, ct: 1, cd: 0, cf: 0, lvl: 10 }), login: () => 'qa_player', awb: () => false, live: () => true, toast: () => {} };
  if (W.LGChatOne) { W.LGChatOne.init(ctx); W.LGChatOne.dock('city', city); }
  else if (W.LGChat) {
    city.innerHTML = W.LGChat.html({name: 'Чат', ph: 'Offline only'});
    const state = { el: city, chat: null };
    W.QA.legacy = W.LGChat.make({state:()=>state, X:()=>ctx, key:'lgCityChat',name:'Чат',ph:'Offline only',base:'/api/city/chat',trade:true, flags:()=>({on:true,g:true,tr:true,dm:false})});
    W.QA.legacy.init();
  }
  Q.openWindow = () => {
    if (document.getElementById('qa-site-window')) return;
    const from = document.activeElement, win = document.createElement('section'); win.id = 'qa-site-window'; win.setAttribute('role','dialog'); win.setAttribute('aria-modal','true');
    win.innerHTML = '<h2>Fake site window</h2><input aria-label="Site field"><button>Close (restore focus)</button>';
    const close = () => { win.remove(); document.removeEventListener('keydown', key, true); try { if (from?.isConnected) from.focus({preventScroll:true}); } catch {} };
    const key = e => { if(e.key==='Escape'){e.stopPropagation();close();} };
    win.querySelector('button').onclick = close;
    document.body.append(win); document.addEventListener('keydown',key,true); win.querySelector('input').focus();
  };
}

export async function fixtureAttach(kind) {
  const W = window, Q = W.QA, g = W.__l3dGame;
  Q.kind = kind;
  if (g) {
    const ctx = g.ctx;
    const original = ctx.site.overlay;
    ctx.site.overlay = () => document.getElementById('qa-site-window') ? 'dialog' : original();
    Q.input = ctx.input; Q.rig = ctx.rig; Q.engine = ctx.engine; Q.host = ctx.hostEl; Q.ui = ctx.uiRoot;
    Q.closeUi = () => ctx.uiApi.open(null);
    // dev/game.html intentionally omits main.ts. This bridge only forwards the real classic feature;
    // it is NOT evidence that production main.ts/connectSite mine startup works.
    const f8Gate = W.QAF8Gate.createF8Gate();
    window.addEventListener('keydown', e => { if(e.code==='F8'){e.preventDefault();e.stopPropagation();if(!f8Gate(e.repeat,performance.now(),ctx.rooms.busy))return;ctx.game.classic ? ctx.game.resume() : ctx.game.toClassic();document.getElementById('qa-classic').style.display=ctx.game.classic?'block':'none';Q.classic=ctx.game.classic;document.documentElement.classList.toggle('l3d-on',!Q.classic);} },true);
    Q.enter = async id => {
      if (id === 'mine') {
        ctx.registries.rooms.register('mine3d', { title: 'Offline QA mine', create: r => W.__l3dDebugDemo.mine(r) });
        const b = ctx.layout().buildings.find(b=>b.id==='mine'); if(b)b.soon=false;
        await ctx.rooms.enter('mine');
      } else if(id==='forge') { const b=ctx.layout().buildings.find(b=>b.id===id);if(b)b.soon=false;await ctx.rooms.enter(id); }
      else { const d=ctx.dev.debugMode;if(!d?.enterDimension())throw new Error('Offline debug dimension unavailable');const def=d.portals().find(x=>x.id===id);if(!def||def.off)throw new Error('Offline place unavailable: '+id);def.go();Q.scene=id; }
    };
  } else {
    const m = W.__mine;
    Q.input = m.input; Q.rig = m.rig; Q.engine = m.engine; Q.host = document.getElementById('app'); Q.ui = null;
    // Standalone mine dev fixture has no launcher, chat, or UI menu. Do not invent these handlers.
  }
  const originalLock=Q.input.lock.bind(Q.input);Q.input.lock=()=>{Q.lockCalls++;return originalLock();};
  Q.frameOff = Q.engine.onFrame(() => Q.frames++);
  const pause = Q.engine.pause.bind(Q.engine); Q.paused = false;
  Q.engine.pause = on => {Q.paused=on;return pause(on);};
  Q.read = () => {
    let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;
    const text=!!a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!['button','checkbox','radio','range','submit'].includes(a.type)||a.isContentEditable);
    const one=W.LGChatOne?.state?.();
    const box=document.querySelector('[data-co-bound="1"]');
    const chat=!!document.documentElement.classList.contains('l3d-chat-typing') || !!a?.closest?.('.chat.open,.cy-chat,.dm-float');
    const ctx=g?.ctx, classic=!!(g?.ctx.game.classic||Q.classic), photo=Q.photo;
    const modal=[...(Q.input.modals||[])], menu=ctx?.state?.menu||Q.menu;
    const scene=ctx?.rooms.current || (Q.kind==='mine'?'mine':Q.scene!=='city'?Q.scene:ctx?.layout()?.id||'city');
    const state={gameplay:Q.input.gameplay,locked:!!document.pointerLockElement,lockTarget:document.pointerLockElement?.tagName,text,activeTag:a?.tagName,activeClass:a?.className,chat,menu,modal,classic,photo,scene,paused:Q.paused,frames:Q.frames,yaw:Q.rig.yaw,pitch:Q.rig.pitch,threeShown:!!Q.host?.getClientRects().length,classicShown:!!document.getElementById('qa-classic')?.getClientRects().length,tab:one?.tab||null,dock:box?.parentElement?.className||null,window:!!document.getElementById('qa-site-window'),stage:!!ctx?.rooms.stage,lockCalls:Q.lockCalls,lastClick:Q.lastClick,pointerHistory:Q.pointerHistory.slice(-6)};
    let hit=document.elementFromPoint(768,416);for(let n=0;hit?.shadowRoot&&n<8;n++){const next=hit.shadowRoot.elementFromPoint(768,416);if(!next||next===hit)break;hit=next;}
    state.hit=[];for(let h=hit,i=0;h&&i<4;h=h.parentElement,i++){const st=getComputedStyle(h);state.hit.push({tag:h.tagName,cls:h.className,visible:st.visibility,opacity:st.opacity,pointer:st.pointerEvents});}
    const mn=document.querySelector('.mn');state.siteMineOn=!!W.LGMine?.on;state.siteMineVisible=!!mn?.getClientRects().length;state.mineHeld=!!ctx?.rooms.scene?.hold?.held;state.roomKind=ctx?.rooms.kind;state.mineState=ctx?.rooms.scene?.mine?.()||null;state.mineLog=W.__mineLog?[...W.__mineLog]:null;
    if(state.classic&&state.siteMineVisible)state.classicShown=true;
    state.active=state.gameplay&&!classic&&!menu&&!modal.length&&!photo&&!state.window&&!state.stage;
    return state;
  };
}
// Usage: CHROMIUM=/usr/bin/google-chrome node e2e/input-chaos.mjs --seed=1031 --steps=24
// --pages=game,mine --chat=both|one|fallback|legacy --headed --out=.local/qa-input/run
// All requests are limited to the local fixture server. Exit 1 means invariant violations, 2 harness failure.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve, join, extname, sep } from 'node:path';

const argv = process.argv.slice(2);
const option=(name,def)=>argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3)??def;
const seed=Number(option('seed','1031'))>>>0, steps=Number(option('steps','24'));
const pages=option('pages','game,mine').split(','), chat=option('chat','both'), query=option('query','');
const out=resolve(option('out','.local/qa-input/run'));
const root=resolve('dist-dev'), site=resolve('.local/site-1031-0807');
mkdirSync(out,{recursive:true});
if(resolve(fileURLToPath(import.meta.url))!==join(out,'input-chaos.mjs'))copyFileSync(fileURLToPath(import.meta.url),join(out,'input-chaos.mjs'));
const frozen=new Map(['game.js','game.html','mine.html'].map(n=>[n,readFileSync(join(root,n))]));
for(const [n,data] of frozen)writeFileSync(join(out,n),data);
let randomState=seed||0x19378125;
function rand(){randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)/4294967296;}
console.log('CONFIG '+JSON.stringify({seed,steps,pages,chat,query,headless:!argv.includes('--headed'),chromium:process.env.CHROMIUM||'/usr/bin/google-chrome',offline:true,site:'31.10 08:07',mineObservationOnly:true,launcherBridge:true}));
// Observation-only dev/mine export. No source file is edited and no input behaviour is replaced.
const mineSource=readFileSync('dev/mine.ts','utf8');
if(!mineSource.includes('engine, rig, player, client'))throw new Error('Mine observation export drifted');
const mineBuild=await build({stdin:{contents:mineSource.replace('engine, rig, player, client','input, engine, rig, player, client'),resolveDir:resolve('dev'),sourcefile:'dev/mine.ts',loader:'ts'},bundle:true,format:'iife',target:'chrome111',write:false,define:{__DEV__:'true',__L3D_CHANGELOG__:'[]'},loader:{'.css':'text','.svg':'text'},logLevel:'silent'});
writeFileSync(join(out,'mine-observed.js'),mineBuild.outputFiles[0].contents);
const controlBuild=await build({entryPoints:['src/content/f8.ts'],bundle:true,format:'iife',globalName:'QAF8Gate',write:false,logLevel:'silent'});
writeFileSync(join(out,'qa-controls.js'),controlBuild.outputFiles[0].contents);
const manifest={seed,files:Object.fromEntries([...frozen,...[['mine-observed.js',mineBuild.outputFiles[0].contents],['qa-controls.js',controlBuild.outputFiles[0].contents]]].map(([n,d])=>[n,createHash('sha256').update(d).digest('hex')]))};
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const bootstrap='('+fixtureBootstrap.toString()+')();';
const siteInit='('+fixtureSite.toString()+')();';
const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://fixture');
  if(u.pathname==='/qa-controls.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(controlBuild.outputFiles[0].contents);return;}
  let f;
  if(u.pathname.startsWith('/site/')) f=join(site,u.pathname.slice(6));else f=join(root,u.pathname);
  if(![root,site].some(base=>f.startsWith(base+sep))||!existsSync(f)){res.writeHead(404);res.end('not found');return;}
  let data=frozen.get(u.pathname.slice(1))||readFileSync(f);
  if(u.pathname==='/mine.js')data=mineBuild.outputFiles[0].contents;
  if(extname(f)==='.html'){
    let html=data.toString().replace(/<link[^>]+https:[^>]*>/g,'');
    const mode=u.searchParams.get('chat')||'fallback';
    const scripts=mode==='fallback'?'':['ui-kit.js','site-chat.js',...(mode==='one'?['site-chatone.js']:[])].map(n=>'<script src="/site/'+n+'"></script>').join('');
    html=html.replace(/<script src="(?:game|mine)\.js"><\/script>/, '<script>'+bootstrap+'</script>'+scripts+'<script>'+siteInit+'</script><script src="/qa-controls.js"></script>$&');
    data=Buffer.from(html);
  }
  res.writeHead(200,{'Content-Type':TYPES[extname(f)]||'application/octet-stream'});res.end(data);
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
let browser;const results=[];let fatal=null;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/google-chrome',headless:!argv.includes('--headed'),args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
 for(const name of pages){
  const modes=name==='game'?(chat==='both'?['fallback','one']:[chat]):['fallback'];
  for(const mode of modes){
   const id=name+'-'+mode, context=await browser.newContext({viewport:{width:1280,height:800}}), page=await context.newPage();
   const errors=[], consoleLog=[], runtimeErrors=[], violations=[], trace=[], skips=[], network=[];
   await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/'))return route.continue();network.push(url);return route.abort('blockedbyclient');});
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')consoleLog.push(m.text());if(m.type()==='error'&&!/^Failed to load resource:.*404/.test(m.text()))runtimeErrors.push(m.text());});
   let previous=null, current='boot', classicEntryScene=null, repeatModeBefore=null;
   const fail=(invariant,detail)=>{const v={test:id,step:trace.length,action:current,invariant,detail,sequence:trace.map(x=>x.action)};violations.push(v);console.log('VIOLATION '+JSON.stringify(v));};
   try{
    await page.goto(origin+'/'+name+'.html?chat='+mode+(query?'&'+query:''),{waitUntil:'load'});
    if(mode==='one'&&!await page.evaluate(()=>!!window.LGChatOne?.on()))throw new Error('Actual site chatone fixture missing/not enabled; do not mistake fallback for chatone coverage');
    await page.waitForFunction(name==='game'?()=>!!window.__l3dGame:()=>!!window.__mine,undefined,{timeout:120000});
    if(name==='game')await page.waitForFunction(()=>!!window.__demo,undefined,{timeout:20000});
    await page.evaluate(fixtureAttach,name);await page.waitForTimeout(1400);
    if(query.includes('sitemine=1')&&name==='game')await page.waitForFunction(()=>window.__l3dGame?.ctx.rooms.kind==='mine3d',undefined,{timeout:20000}).catch(()=>fail('site-mine-boot-enters-3D-mine',{query}));
    const read=()=>page.evaluate(()=>QA.read());
    async function press(key){await page.keyboard.press(key);}
    let mouseX=640,mouseDirection=1;
    async function clickCanvas(){const bb=await page.locator(name==='game'?'#l3d-host canvas':'#app canvas').boundingBox();if(bb){mouseX=bb.x+bb.width*.60;await page.mouse.click(mouseX,bb.y+bb.height*.52);}else skips.push(current+': canvas hidden');}
    async function moveCamera(){await page.waitForTimeout(100);const b=await read();let responded=false,a=b;for(let chunk=0;chunk<3&&!responded;chunk++){for(let i=0;i<5;i++){if(mouseX>1080)mouseDirection=-1;if(mouseX<180)mouseDirection=1;mouseX+=13*mouseDirection;await page.mouse.move(mouseX,420);}await page.waitForTimeout(170);a=await read();responded=Math.abs(a.yaw-b.yaw)+Math.abs(a.pitch-b.pitch)>1e-5;}if(b.active&&a.active&&a.locked&&!responded)fail('camera-responds',{before:b,after:a});}
    async function check(action){
      let s=await read();
      if(s.active&&s.text)fail('active-has-no-text-focus',s);
      if(s.chat&&s.text&&s.locked)fail('chat-cursor-visible',s);
      if(s.chat&&s.text&&s.gameplay)fail('chat-disables-gameplay',s);
      if(s.modal.length&&s.gameplay)fail('modal-disables-gameplay',s);
      if(s.modal.length&&s.locked&&!s.photo)fail('modal-releases-pointer',s);
      if(name==='game'){
        if(s.threeShown&&s.classicShown||!s.threeShown&&!s.classicShown&&!s.window)fail('exactly-one-mode-visible',s);
        if(s.classic&&!s.paused)fail('classic-pauses-engine',s);
        if(s.classic){const f=s.frames;await page.waitForTimeout(180);s=await read();if(s.frames>f+1)fail('classic-has-no-render-ticks',{before:f,after:s.frames,state:s});}
        if(previous&&s.tab!==previous.tab&&s.tab&&previous.tab&&s.scene===previous.scene&&!['clickTab','enterMine','enterForge','enterCamp','exitScene','recover'].includes(action))fail('chat-tab-only-on-scene-or-click',{before:previous,after:s});
        if(previous?.classic&&!s.classic&&classicEntryScene==='mine'&&s.scene!=='mine')fail('F8-preserves-mine',s);
        if(action==='repeatF8'&&s.classic===repeatModeBefore)fail('held-F8-toggles-once',s);
        if(query.includes('sitemine=1')){
          if(s.classic&&s.roomKind==='mine3d'&&s.siteMineOn){if(!s.mineHeld||!s.siteMineVisible||s.threeShown)fail('classic-mine-has-one-owner',s);const before=s.mineLog.filter(x=>x.startsWith('3d:')).length;await page.waitForTimeout(400);const after=await read();if(after.mineLog.filter(x=>x.startsWith('3d:')).length>before)fail('classic-mine-sends-no-3D-requests',{before,after:after.mineLog});}
          if(!s.classic&&s.roomKind==='mine3d'&&(s.mineHeld||s.siteMineVisible))fail('3D-mine-hides-site-and-resumes',s);
          if(action==='walkOutMine'&&(s.roomKind==='mine3d'||s.siteMineOn))fail('leaving-3D-mine-leaves-site-mine',s);
        }
      }
      if(s.active&&!s.locked&&!s.text){await page.waitForTimeout(360);await clickCanvas();await page.waitForFunction(()=>!QA.read().active||QA.read().locked,undefined,{timeout:1800}).catch(()=>{});s=await read();if(s.active&&!s.locked){const first=s;await clickCanvas();await page.waitForTimeout(450);const second=await read();fail('active-click-can-relock',{first,second,secondRecovered:second.locked});s=second;}}
      if(s.active&&s.locked&&!s.text)await moveCamera();
      if(['T','Enter','ruT'].includes(action)&&name==='game'&&previous?.active){if(!s.chat||!s.text||s.locked)fail('chat-hotkey-opens-focused-free-cursor',s);}
      if(action==='E'&&previous?.active&&s.chat&&s.text)fail('E-must-not-open-chat',s);
      if(action==='clickCanvas'&&previous?.chat&&previous?.text&&!previous?.menu&&!previous?.modal.length&&name==='game'&&(!s.active||s.text||!s.locked))fail('chat-to-canvas-handoff',s);
      if(action==='blur'&&(await page.evaluate(()=>QA.input.move.x!==0||QA.input.move.y!==0)))fail('blur-clears-held-movement',s);
      if(action==='recover'&&!s.classic&&(s.modal.length||s.menu||s.photo||s.text))fail('bounded-Esc-closes-modal',s);
      if(s.classic&&s.locked)fail('classic-has-free-cursor',s);
      if(s.menu&&s.locked)fail('menu-releases-pointer',s);
      if(action==='imeEscape'&&(!s.chat||!s.text))fail('IME-Escape-does-not-blur-chat',s);
      if(action==='repeatI'&&!s.menu)fail('held-inventory-toggle-opens-once',s);
      if(action==='repeatF10'&&!s.modal.includes('debug-panel'))fail('held-debug-toggle-opens-once',s);
      if(errors.length){for(const err of errors.splice(0))fail('no-page-errors',err);}
      if(runtimeErrors.length){for(const err of runtimeErrors.splice(0))fail('no-console-runtime-errors',err);}
      previous=s;
      trace.at(-1).state=s;
      if(trace.length%8===0)console.log('PROGRESS '+JSON.stringify({test:id,steps:trace.length,violations:violations.length,scene:s.scene,menu:s.menu,modal:s.modal}));
    }
    const run=async action=>{current=action;trace.push({action});
      if(['enterMine','enterForge','enterCamp','exitScene','walkOutMine'].includes(action))classicEntryScene=null;
      if(['F8','F8Back','repeatF8'].includes(action)&&name==='game'){const before=await read();if(!before.classic)classicEntryScene=before.scene;if(action==='repeatF8')repeatModeBefore=before.classic;}
      if(action==='clickCanvas')await clickCanvas();
      else if(action==='openSite')await page.evaluate(()=>QA.openWindow());
      else if(action==='closeSite'){const b=page.locator('#qa-site-window button');if(await b.count())await b.click();}
      else if(action==='blur'){await page.keyboard.down('KeyW');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('KeyW');}
      else if(action==='hide'){await page.evaluate(()=>{QA.hiddenFrames=QA.frames;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(350);const ticks=await page.evaluate(()=>QA.frames-QA.hiddenFrames);if(ticks>1)fail('hidden-pauses-render-loop',{ticks});await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});}
      else if(action==='ruT'||action==='ruE'){// CDP sends trusted keyboard events with physical code and Cyrillic key; insertText alone would NOT test routing.
        const client=await context.newCDPSession(page);const code=action==='ruT'?'KeyT':'KeyE',key=action==='ruT'?'е':'у',vk=action==='ruT'?84:69;
        await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:key,unmodifiedText:key});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});await client.detach();
      }else if(action==='siteCityRedock'){await page.evaluate(()=>{const o=window.LGChatOne;if(o?.on()){o.dock('city',document.getElementById('qa-city'));o.place?.();}});}
      else if(action==='oneFeedRefresh'){await page.evaluate(()=>{const o=window.LGChatOne;if(o?.on())o.enterFeed('mine',{ok:true,chat:[],c:2});});}
      else if(action==='onePlace'){await page.evaluate(()=>window.LGChatOne?.place?.());}
      else if(action==='raceModal'){await page.evaluate(()=>{QA.input.hold('qa:prepare',true);QA.input.unlock();});await page.waitForTimeout(1200);await page.evaluate(()=>{QA.input.hold('qa:prepare',false);const c=QA.engine.renderer.domElement;QA.raceListener=()=>{QA.raceFired=true;QA.input.lock();QA.input.pushModal('qa:late-grant',()=>QA.input.popModal('qa:late-grant'));};QA.raceFired=false;c.addEventListener('mousedown',QA.raceListener,{capture:true,once:true});});await clickCanvas();const fired=await page.evaluate(()=>{QA.engine.renderer.domElement.removeEventListener('mousedown',QA.raceListener,true);return QA.raceFired;});if(!fired)skips.push('raceModal: canvas click intercepted before fixture handler');}
      else if(action==='siteRestore'){await page.evaluate(()=>{let i=document.getElementById('qa-restored-field');if(!i){i=document.createElement('input');i.id='qa-restored-field';document.body.append(i);}i.focus();});}
      else if(action==='repeatI'||action==='repeatF10'){const k=action==='repeatI'?'KeyI':'F10';await page.keyboard.down(k);await page.keyboard.down(k);await page.keyboard.up(k);}
      else if(action==='imeEscape'){await page.evaluate(()=>{let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;a?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true,composed:true}));});skips.push('IME Escape is synthetic: real OS IME not proven');}
      else if(action==='repeatT'){await page.keyboard.down('KeyT');await page.keyboard.down('KeyT');await page.keyboard.up('KeyT');}
      else if(action==='repeatF8'){await page.keyboard.down('F8');await page.keyboard.down('F8');await page.keyboard.up('F8');}
      else if(action==='ime'){await page.evaluate(()=>{const a=document.activeElement;while(false){}a?.dispatchEvent(new KeyboardEvent('keydown',{key:'Process',code:'KeyT',isComposing:true,bubbles:true,composed:true}));});skips.push('IME synthetic only: OS composition not proven');}
      else if(action==='recover'){if(name==='game'&&(await read()).classic){await page.waitForTimeout(550);await press('F8');await page.waitForTimeout(450);classicEntryScene=null;}for(let n=0;n<6;n++){const s=await read();if(!s.menu&&!s.modal.length&&!s.photo&&!s.text&&!s.window)break;await press('Escape');await page.waitForTimeout(180);}}
      else if(action==='clickTab'){const box=page.locator('[data-co-bound="1"] [data-tab="g"]');if(await box.count()){if((await read()).locked)await press('KeyT');await page.waitForTimeout(250);const head=page.locator('[data-co-bound="1"] .cy-chat-t');if(!await box.first().isVisible()&&await head.first().isVisible())await head.first().click({timeout:2000});try{await box.first().click({timeout:2000});}catch(e){fail('chat-tab-user-click-reachable',String(e).split('\n').slice(0,5).join(' '));}}else skips.push('clickTab: no one-chat visible');}
      else if(action==='enterMine'||action==='enterForge'||action==='enterCamp'){if(name==='game'){await page.evaluate(id=>QA.enter(id),action==='enterMine'?'mine':action==='enterForge'?'forge':'camp');await page.waitForTimeout(1800);}else skips.push(action+': standalone mine');}
      else if(action==='walkOutMine'){if(name==='game'){await page.evaluate(()=>{const c=__l3dGame.ctx,sp=c.rooms.scene?.spawn;if(sp){c.controller().teleport(sp.x,sp.z);c.rig.yaw=sp.face||0;c.rig.pitch=-0.08;}});await page.waitForTimeout(500);await press('KeyE');await page.waitForTimeout(400);const b=page.locator('button[data-a="exit"]:visible');if(await b.count()){await b.first().click({timeout:2000});}else{skips.push('walkOutMine: lift card not aimed at spawn; real rooms.exit disposal used, no physical walk claimed');await page.evaluate(()=>__l3dGame.ctx.rooms.exit());}await page.waitForTimeout(800);}}
      else if(action==='exitScene'){if(name==='game')await page.evaluate(()=>{const c=__l3dGame.ctx;c.dev.debugMode?.exitAll();c.rooms.exit();QA.scene='city';});else skips.push('exitScene: standalone mine');}
      else if(action==='F8Back')await press('F8');
      else await press(action);
      await page.waitForTimeout(300);await check(action);
    };
    console.log('READY '+id+' '+JSON.stringify(await read()));
    const script=option('script','')?option('script','').split(','):name==='game'?[
      'clickCanvas','T','clickCanvas','recover','clickCanvas','Enter','Escape','clickCanvas','E','ruE','ruT','Escape','recover',
      'clickCanvas','T','openSite','closeSite','clickCanvas','recover','C','Escape','I','Escape','M','Escape','L','Escape',
      'Z','Escape','recover','F10','Escape','recover','F9','F9','recover','blur','hide','repeatT','Escape','recover','repeatI','recover','repeatF10','recover','T','imeEscape','recover','ime',
      'F8','F8Back','repeatF8','recover','enterForge','exitScene','clickCanvas','enterCamp','exitScene','enterMine','clickCanvas',
      'T','clickCanvas','recover','siteCityRedock','onePlace','oneFeedRefresh','siteCityRedock','clickTab','siteCityRedock','onePlace','L','Escape','F8','F8Back','recover','exitScene','clickCanvas','siteRestore','clickCanvas','recover','clickCanvas','raceModal','recover'
    ]:['clickCanvas','E','ruE','L','Escape','blur','hide','L','Escape','F9','F10','C','I','M','T','Enter','Escape'];
    for(const action of script)await run(action);
    const actions=name==='game'?['T','Enter','Escape','E','C','I','M','L','Z','F9','F10','F8','clickCanvas','blur','hide','ruT','ruE','openSite','closeSite','siteCityRedock','onePlace','oneFeedRefresh','recover']:['E','L','Escape','clickCanvas','blur','hide','ruE'];
    for(let i=0;i<steps;i++)await run(actions[Math.floor(rand()*actions.length)]);
    const state=await read();
    await page.screenshot({path:join(out,id+'.png')});
    const requests=await page.evaluate(()=>QA.requests), blocked=await page.evaluate(()=>QA.blocked);
    // Text may hit the deliberately fake chat sink during random sequences; never a network send.
    if(network.length)consoleLog.push('Blocked external fixture requests: '+network.length);
    results.push({id,steps:trace.length,violations,skips:[...new Set(skips)],final:state,requests,externalBlocked:network,console:consoleLog});
    writeFileSync(join(out,id+'-trace.json'),JSON.stringify(trace,null,2));
   }catch(e){fatal=e.stack||String(e);console.log('HARNESS_ERROR '+id+' '+fatal);results.push({id,violations,error:fatal});}
   await context.close();
  }
 }
}catch(e){fatal=e.stack||String(e);console.log('HARNESS_ERROR '+fatal);}
finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
const summary={seed,steps,pages,chat,violations:results.reduce((n,r)=>n+r.violations.length,0),fatal,tests:results};
writeFileSync(join(out,'results.json'),JSON.stringify(summary,null,2));
console.log('FINAL '+JSON.stringify({seed,tests:results.map(r=>({id:r.id,steps:r.steps,violations:r.violations.length,error:r.error||null})),violations:summary.violations,fatal,results:join(out,'results.json')}));
process.exitCode=fatal?2:summary.violations?1:0;
