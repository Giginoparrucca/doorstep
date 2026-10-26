import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const sdk=read('vendor/supabase-2.118.0.js');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{
 for(const filename of ['index.html','host-console.html','admin.html','demo-launch.html'])for(const corrupt of [false,true]){
  const tag=read(filename).match(/<script[^>]+src="\/vendor\/supabase-[^>]+><\/script>/)?.[0];assert.ok(tag);
  const page=await browser.newPage(),errors=[],requests=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('https://integrity.example.invalid/**',route=>{
   const u=new URL(route.request().url());requests.push(u.pathname);
   return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':'text/html',body:u.pathname.endsWith('.js')?sdk+(corrupt?'\n/* changed after pinning */':''):'<!doctype html><html><body>'+tag+'</body></html>'});
  });
  await page.goto('https://integrity.example.invalid/');
  assert.equal(await page.evaluate(()=>typeof window.supabase?.createClient),corrupt?'undefined':'function',filename);
  assert.ok(requests.includes('/vendor/supabase-2.118.0.js'));
  const resource=await page.evaluate(()=>performance.getEntriesByType('resource').find(x=>x.name.includes('/vendor/supabase-'))?.initiatorType);assert.equal(resource,'script');
  if(corrupt)assert.ok(errors.some(s=>/integrity|digest/i.test(s)),'browser rejects modified bytes');else assert.deepEqual(errors,[]);
  await page.close();
 }
 // The real demo launcher stays scoped to fictional configuration and uses the
 // same vendored SDK. Cancelling its sign-in never sends a reset or API request.
 const page=await browser.newPage(),errors=[],apiCalls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='fixture.supabase.co'){apiCalls.push(u.pathname);return route.fulfill({status:500,body:'unexpected fixture API'});}
  if(u.pathname==='/app-config.js')return route.fulfill({contentType:'text/javascript',body:'window.WELCOME_BNB_CONFIG={mode:"demo",appOrigin:"https://demo.example.invalid",supabaseUrl:"https://fixture.supabase.co",publicKey:"fictional-key"};'});
  if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('qrcode-generator'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(require.resolve('qrcode-generator'))});
  if(u.origin==='https://demo.example.invalid'){
   const file=new URL('.'+u.pathname,root);assert.ok(file.href.startsWith(root.href));
   return route.fulfill({contentType:u.pathname.endsWith('.html')?'text/html':'text/javascript',body:fs.readFileSync(file)});
  }
  return route.fulfill({contentType:'text/css',body:''});
 });
 page.on('dialog',dialog=>dialog.dismiss());
 await page.goto('https://demo.example.invalid/demo-launch.html');
 await page.waitForFunction(()=>document.querySelectorAll('#scenarios tr').length>0);
 assert.equal(await page.locator('#env-ok').isVisible(),true);assert.equal(await page.locator('#env-wrong').isVisible(),false);
 assert.equal(await page.evaluate(()=>typeof supabase.createClient),'function');
 await page.locator('#reset-btn').click();await page.waitForFunction(()=>document.getElementById('reset-status').textContent==='Reset annullato.');
 assert.deepEqual(apiCalls,[]);assert.deepEqual(errors,[]);await page.close();
 console.log('PASS real four-entry SDK tags: same-origin requests, browser SHA-384 validation and tampered-byte rejection; actual demo launcher/config/SDK and cancelled presenter login perform no API/reset');
}finally{await browser.close();}
