import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readEnvironment, publicConfiguration, PRODUCTION_REF, PRODUCTION_ORIGIN } from '../lib/environment.mjs';
const jwt = (ref, role) => `e30.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.fixture`;
const ref = 'abcdefghijklmnopqrst';
const demo = { APP_ENV: 'demo', DEMO_SUPABASE_PROJECT_REF: ref,
  SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_ANON_KEY: jwt(ref, 'anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, 'service_role'), GUEST_TOKEN_SECRET: 'demo-only-fixture-secret-32-chars-minimum',
  APP_BASE_URL: 'https://demo.welcomebnb.it', VERCEL_URL: 'welcomebnb-demo-fixture.vercel.app' };
assert.equal(readEnvironment({}).projectRef, PRODUCTION_REF);
assert.equal(readEnvironment({}).appOrigin, PRODUCTION_ORIGIN);
assert.equal(readEnvironment(demo).demo, true);
for (const key of ['DEMO_SUPABASE_PROJECT_REF', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'APP_BASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GUEST_TOKEN_SECRET']) {
  const env = { ...demo }; delete env[key]; assert.throws(() => readEnvironment(env), key);
}
for (const override of [
  { APP_ENV: 'invalid' }, { DEMO_SUPABASE_PROJECT_REF: PRODUCTION_REF },
  { SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` },
  { SUPABASE_ANON_KEY: jwt(PRODUCTION_REF, 'anon') },
  { SUPABASE_ANON_KEY: jwt(ref, 'service_role') },
  { SUPABASE_SERVICE_ROLE_KEY: jwt(PRODUCTION_REF, 'service_role') },
  { SUPABASE_SERVICE_ROLE_KEY: jwt(ref, 'anon') },
  { APP_BASE_URL: PRODUCTION_ORIGIN }, { APP_BASE_URL: 'https://welcomebnb.vercel.app' },
  { APP_BASE_URL: 'https://demo.welcomebnb.it/extra' },
  { HOST_CONSOLE_URL: `${PRODUCTION_ORIGIN}/host-console.html` },
  { VERCEL_PROJECT_PRODUCTION_URL: 'app.welcomebnb.it' },
  { GUEST_TOKEN_SECRET: 'short' },
]) assert.throws(() => readEnvironment({ ...demo, ...override }), JSON.stringify(Object.keys(override)));
assert.throws(() => readEnvironment({ VERCEL_PROJECT_PRODUCTION_URL: 'demo.welcomebnb.it' }));
assert.throws(() => readEnvironment({ APP_ENV: 'production', SUPABASE_URL: demo.SUPABASE_URL }));
const pub = publicConfiguration(readEnvironment(demo));
assert.deepEqual(Object.keys(pub).sort(), ['mode','projectRef','supabaseUrl','publicKey','appOrigin','allowedOrigins'].sort());
assert.equal(JSON.stringify(pub).includes(demo.SUPABASE_SERVICE_ROLE_KEY), false);
assert.equal(JSON.stringify(pub).includes(demo.GUEST_TOKEN_SECRET), false);

// Actual browser bootstrap: origin checks and cache migration without a browser/network.
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { get length(){return data.size}, key(i){return [...data.keys()][i]},
    getItem(k){return data.get(k)??null}, setItem(k,v){data.set(k,v)}, removeItem(k){data.delete(k)} };
}
function browser(config, current = 'https://demo.welcomebnb.it') {
  const context = vm.createContext({window:{WELCOME_BNB_CONFIG:config},location:{origin:current},
    localStorage:storage({wbnb_lookup:'old',unrelated:'keep'}),sessionStorage:storage({wbnb_guest_token:'old'})});
  vm.runInContext(fs.readFileSync(new URL('../app-bootstrap.js',import.meta.url),'utf8'),context);
  return context;
}
const b=browser(pub);b.window.getWelcomeBnbConfig();
assert.equal(b.localStorage.getItem('wbnb_lookup'),null);
assert.equal(b.sessionStorage.getItem('wbnb_guest_token'),null);
assert.equal(b.localStorage.getItem('unrelated'),'keep');
b.localStorage.setItem('wbnb_lookup','new');b.window.getWelcomeBnbConfig();
assert.equal(b.localStorage.getItem('wbnb_lookup'),'new');
assert.throws(()=>browser(pub,PRODUCTION_ORIGIN).window.getWelcomeBnbConfig());
assert.throws(()=>browser(undefined).window.getWelcomeBnbConfig());
assert.throws(()=>browser({...pub,projectRef:PRODUCTION_REF}).window.getWelcomeBnbConfig());
const prod=browser(publicConfiguration(readEnvironment({})),PRODUCTION_ORIGIN);prod.window.getWelcomeBnbConfig();
assert.equal(prod.localStorage.getItem('wbnb_lookup'),'old');
for(const name of ['index.html','host-console.html','admin.html']) {
 const html=fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
 assert.ok(html.indexOf('/app-config.js')<html.indexOf('const APP_CONFIG ='));
 assert.ok(html.includes('window.getWelcomeBnbConfig()'));
 assert.ok(!html.includes(`const SUPABASE_URL = 'https://${PRODUCTION_REF}`));
}

// Child processes give each environment a fresh module graph, including helpers.
const worker = `
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
let calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network call');};
const mode=process.env.FIXTURE_MODE;
const res=()=>({statusCode:200,status(s){this.statusCode=s;return this},json(v){this.body=v;return this},setHeader(){},end(){return this}});
const {resolveOrigin}=await import('./api/_cors.js');
if(mode==='demo'){
 assert.equal(resolveOrigin('https://demo.welcomebnb.it'),'https://demo.welcomebnb.it');
 assert.equal(resolveOrigin('https://app.welcomebnb.it'),null);
 assert.equal(resolveOrigin('https://attacker.vercel.app'),null);
 const blocked=['alloggiati','ical-sync','admin-invite-host','telegram-link','telegram-webhook','send-arrival-reminders','push-config','scan-document'];
 for(const name of blocked){
  const {default:handler}=await import('./api/'+name+'.js');
  for(const action of ['autofile_tick','send','save','test','verify','invite','resend']){
   const r=res();await handler({method:'POST',headers:{origin:'https://demo.welcomebnb.it','x-cron-secret':'fixture'},query:{action,t:'11111111-1111-4111-8111-111111111111'},body:{mode:'live',consent:true}},r);
   assert.equal(r.statusCode,403,name+':'+action);assert.equal(r.body.code,'demo_integration_disabled');
  }
 }
 const notify=await import('./api/_notify-host.js');
 await notify.notifyHostForChatInsert({propertyId:'p',sender:'system',message:'escalation'});
 await notify.sendTestNotification('h');
 await notify.notifyHostAutofileAlert({propertyId:'p',hostId:'h',kind:'overdue',text:'fixture'});
 const soap=await import('./api/_alloggiati-soap.js');
 await assert.rejects(()=>soap.generateToken({utente:'fixture',password:'fixture',wskey:'fixture'}),{code:'demo_integration_disabled'});
 assert.equal(calls,0);
 const {signGuestToken,verifyGuestToken}=await import('./api/_guest-token.js');
 const signed=signGuestToken({p:'p',s:'s'});assert.equal(verifyGuestToken(signed.token).ok,true);
 const foreignPayload=Buffer.from(JSON.stringify({p:'p',s:'s',b:null,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 const foreignSig=createHmac('sha256','production-fixture-secret-not-demo').update(foreignPayload).digest('base64url');
 assert.equal(verifyGuestToken(foreignPayload+'.'+foreignSig).ok,false);
 console.log('PASS demo: all external handlers/helpers blocked; zero network calls; CORS scoped; tokens work');
}else if(mode==='invalid'){
 for(const name of ['guest','guest-token','chat','scan-document','alloggiati','ical-sync','parse-tax-delibera','admin-invite-host','telegram-link','telegram-webhook','send-arrival-reminders','push-config']){
  const {default:handler}=await import('./api/'+name+'.js');const r=res();
  await handler({method:'POST',headers:{},query:{},body:{}},r);
  assert.equal(r.statusCode,503,name);assert.equal(r.body.code,'environment_invalid');
 }
 assert.equal(calls,0);console.log('PASS invalid: every handler rejects config before network');
}else{
 assert.equal(resolveOrigin('https://app.welcomebnb.it'),'https://app.welcomebnb.it');
 assert.equal(resolveOrigin('https://welcomebnb.vercel.app'),'https://welcomebnb.vercel.app');
 assert.equal(resolveOrigin('https://attacker.vercel.app'),null);
 const {assertLiveIntegration}=await import('./api/_environment.js');assert.doesNotThrow(()=>assertLiveIntegration('alloggiati'));
 const {default:alloggiati}=await import('./api/alloggiati.js');const r=res();
 await alloggiati({method:'POST',headers:{'x-cron-secret':'wrong'},query:{action:'autofile_tick'},body:{}},r);
 assert.equal(r.statusCode,401);assert.equal(r.body.error,'Invalid cron secret');
 const {default:guest}=await import('./api/guest.js');const g=res();
 await guest({method:'POST',headers:{origin:'https://app.welcomebnb.it'},query:{},body:{}},g);assert.equal(g.statusCode,401);
 assert.equal(calls,0);console.log('PASS production: existing CORS and unauthenticated/cron-secret rejection preserved');
}`;
const inherited={...process.env};
for(const key of Object.keys(inherited)) if(/^(APP_ENV|DEMO_|SUPABASE_|GUEST_TOKEN_SECRET|APP_BASE_URL|HOST_CONSOLE_URL|VERCEL_)/.test(key))delete inherited[key];
for(const [mode, env] of [['demo',demo],['invalid',{...demo,SUPABASE_URL:`https://${PRODUCTION_REF}.supabase.co`}],['production',{SUPABASE_SERVICE_ROLE_KEY:'fixture',GUEST_TOKEN_SECRET:'production-fixture-secret-not-demo'}]]){
 const run=spawnSync(process.execPath,['--input-type=module','-e',worker],{cwd:new URL('..',import.meta.url),env:{...inherited,...env,FIXTURE_MODE:mode},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);process.stdout.write(run.stdout);
}
// Actual build: only public configuration emitted; invalid build exits nonzero.
const build=spawnSync(process.execPath,['scripts/build-config.mjs'],{cwd:new URL('..',import.meta.url),env:{...inherited,...demo},encoding:'utf8'});
assert.equal(build.status,0,build.stderr);
const generated=fs.readFileSync(new URL('../app-config.js',import.meta.url),'utf8');
assert.ok(generated.includes('https://demo.welcomebnb.it'));
assert.ok(!generated.includes(demo.SUPABASE_SERVICE_ROLE_KEY));assert.ok(!generated.includes(demo.GUEST_TOKEN_SECRET));
const bad=spawnSync(process.execPath,['scripts/build-config.mjs'],{cwd:new URL('..',import.meta.url),env:{...inherited,APP_ENV:'demo'},encoding:'utf8'});assert.notEqual(bad.status,0);
assert.equal(fs.readFileSync(new URL('../app-config.js',import.meta.url),'utf8'),generated);
const restore=spawnSync(process.execPath,['scripts/build-config.mjs'],{cwd:new URL('..',import.meta.url),env:inherited,encoding:'utf8'});assert.equal(restore.status,0,restore.stderr);
console.log('PASS environment config, browser bootstrap, secret exclusion and failed demo build gates.');
