// Actual console shell, four page toolbars and mode setters; fictional text only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const {document}=parseHTML(html);
const styles=[...document.head.querySelectorAll('style')].map(e=>e.textContent).join('\n');
const panels=['property','settings','rules','recos'];
function fn(name){let a=html.indexOf('function '+name+'(');assert.ok(a>=0,name);return html.slice(a,html.indexOf('\n}\n',a)+2);}
const ht=html.slice(html.indexOf('const HT ='),html.indexOf('\nfunction h('));
const out=path.join(os.tmpdir(),'welcomebnb-toolbar-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {for(const width of [360,390,768,1280])for(const lang of ['it','en']){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>r.abort());
 await page.setContent('<html><head><style>'+styles+'</style></head><body><aside class="sidebar"><div class="sidebar-brand">WelcomeBnB</div></aside><main class="main">'+document.querySelector('.main-header').outerHTML+'<div class="content">'+panels.map(p=>document.getElementById('panel-'+p).outerHTML).join('')+'</div></main></body></html>');
 await page.addScriptTag({content:`var hostLang=${JSON.stringify(lang)};${ht}\n${fn('h')}\nconst _rulesSafe=s=>String(s);\n${['_setPropertyEditControls','_setSettingsEditControls','_setRulesEditControls','_setRecosEditControls','observePageToolbarHeader'].map(fn).join('\n')}
 document.querySelectorAll('[data-h]').forEach(e=>e.textContent=h(e.dataset.h));
 document.getElementById('sectionTabs').innerHTML=['Property details','Rules','Recommendations','Settings'].map(t=>'<button class="section-tab">'+t+'</button>').join('');
 document.getElementById('rulesList').style.minHeight='1600px';document.getElementById('recoList').style.minHeight='1600px';
 observePageToolbarHeader();
 `});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const mode=async(p,edit)=>{await page.evaluate(({p,edit})=>{const fn={property:_setPropertyEditControls,settings:_setSettingsEditControls,rules:_setRulesEditControls,recos:_setRecosEditControls}[p];fn(edit);},{p,edit});await settle();};
 const geometry=()=>page.evaluate(()=>{const header=document.querySelector('.main-header').getBoundingClientRect(),bar=document.querySelector('.panel.active .page-edit-toolbar'),rect=bar.getBoundingClientRect(),main=document.querySelector('.main').getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,headerBottom:header.bottom,left:rect.left,right:rect.right,mainLeft:main.left,mainRight:main.right,radius:getComputedStyle(bar).borderRadius,shadow:getComputedStyle(bar).boxShadow,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...bar.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,clipped:b.scrollWidth>b.clientWidth+1};})};});
 for(const panel of panels){
  await page.evaluate(p=>{document.querySelectorAll('.panel').forEach(e=>e.classList.toggle('active',e.id==='panel-'+p));document.querySelector('.main').scrollTop=0;document.getElementById('panelTitle').textContent=document.querySelector('#panel-'+p+' .page-edit-toolbar [data-h]').textContent;},panel);await mode(panel,false);
  for(const edit of [false,true]){
   await mode(panel,edit);
   const label=page.locator('#panel-'+panel+(edit?' .page-edit-label':' .page-view-label'));assert.equal(await label.isVisible(),true);
   assert.match(await label.textContent(),lang==='it'?/Tutta la pagina/:/Entire page/);
   let g=await geometry();assert.equal(g.radius,'0px');assert.equal(g.shadow,'none');
   assert.ok(Math.abs(g.left-g.mainLeft)<1&&Math.abs(g.right-g.mainRight)<1,'actions span the whole workspace '+JSON.stringify(g));
   assert.ok(Math.abs(g.top-g.headerBottom)<2,'toolbar joins navigation without card gap');assert.equal(g.overflow,false);
   for(const b of g.buttons){assert.ok(b.left>=g.left&&b.right<=g.right,'all buttons stay inside workspace');assert.ok(!b.clipped,'translated labels are readable');assert.ok(b.height>=40,'usable button targets');}
   for(let i=0;i<g.buttons.length;i++)for(let j=i+1;j<g.buttons.length;j++){const a=g.buttons[i],b=g.buttons[j];assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'buttons never overlap');}
   await page.evaluate(()=>{document.querySelector('.main').scrollTop=600;});await settle();g=await geometry();assert.ok(Math.abs(g.top-g.headerBottom)<2,'page controls remain below navigation while scrolling');
   await page.screenshot({path:path.join(out,`${panel}-${width}-${lang}-${edit?'edit':'view'}.png`)});
   await page.evaluate(()=>{document.querySelector('.main').scrollTop=0;});
  }
  await mode(panel,false);
 }
 // Header resizing (wrapping/zoom/language) updates sticky offset without constants.
 await page.evaluate(()=>{document.querySelector('.main-header').style.paddingBottom='75px';document.querySelector('.main').scrollTop=600;});await settle();
 const g=await geometry();assert.ok(Math.abs(g.top-g.headerBottom)<2,'sticky position tracks changed header height '+JSON.stringify(g));
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS toolbar ${width}px ${lang}: four panels, whole-page scope, View/Edit, full width, readable buttons, scroll and header resize`);
}}finally{await browser.close();}
