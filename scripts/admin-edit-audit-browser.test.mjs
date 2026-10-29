// Actual edit-elevation function and read-only DOM guard; fictional Auth/audit only.
import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
function fn(name){let a=source.indexOf('function '+name+'(');if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,source.indexOf('\n}\n',a)+2);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{for(const lang of ['it','en'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main class="main"><input id="field"><button>Save</button></main><label><input id="adminEditToggle" type="checkbox">Edit</label><p id="adminViewLabel"></p>');
 await page.addScriptTag({content:`let hostLang=${JSON.stringify(lang)},propertyId='fictional-property',IS_ADMIN_VIEW=true,_adminEditEnabled=false;
 let uid='fictional-admin',fail=false,hold=false,finish=null,audits=[];
 const sb={auth:{getUser:async()=>({data:{user:uid?{id:uid,email:'admin@example.invalid'}:null}})},from:()=>({insert:async row=>{audits.push(row);if(hold)await new Promise(r=>finish=r);return {error:fail?{message:'fixture failure'}:null};}})};
 ${fn('setConsoleReadOnly')}\n${fn('toggleAdminEdit')}
 setConsoleReadOnly(true);`});
 await page.evaluate(()=>{fail=true;return toggleAdminEdit(true);});assert.equal(await page.locator('#field').isDisabled(),true);assert.match(await page.locator('#adminViewLabel').textContent(),lang==='it'?/Audit non disponibile/:/Audit unavailable/);
 await page.evaluate(()=>{fail=false;hold=true;window.pending=toggleAdminEdit(true);});await page.waitForFunction(()=>finish!==null);assert.equal(await page.locator('#field').isDisabled(),true,'audit pending remains read-only');
 await page.evaluate(()=>{finish();});await page.evaluate(()=>window.pending);assert.equal(await page.locator('#field').isDisabled(),false);
 assert.deepEqual(await page.evaluate(()=>audits.at(-1)),{admin_id:'fictional-admin',admin_email:'admin@example.invalid',property_id:'fictional-property',action:'enable_edit'});
 await page.evaluate(()=>toggleAdminEdit(false));assert.equal(await page.locator('#field').isDisabled(),true);
 await page.evaluate(()=>{finish=null;window.pending=toggleAdminEdit(true);});await page.waitForFunction(()=>finish!==null);await page.evaluate(()=>{propertyId='other-property';finish();});await page.evaluate(()=>window.pending);assert.equal(await page.locator('#field').isDisabled(),true,'scope changed during audit');
 await page.evaluate(()=>{propertyId='fictional-property';finish=null;window.pending=toggleAdminEdit(true);});await page.waitForFunction(()=>finish!==null);await page.evaluate(()=>{uid='different-admin';finish();});await page.evaluate(()=>window.pending);assert.equal(await page.locator('#field').isDisabled(),true,'actor changed during audit');
 const n=await page.evaluate(()=>audits.length);await page.evaluate(()=>{uid=null;hold=false;return toggleAdminEdit(true);});assert.equal(await page.evaluate(()=>audits.length),n,'missing Auth user never inserts an audit');
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS actual admin edit audit guard IT/EN 390/1440: failed/pending audit, scoped actor evidence, successful elevation, restore read-only, property/actor races and absent session.');}finally{await browser.close();}
