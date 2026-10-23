import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const start=html.indexOf('async function syncIcalNow()');
const source=html.slice(start,html.indexOf('\n}\n',start)+2);
async function run(calendar, drafts, saved, denied=false) {
  let collected=0, writes=0, posts=0, refreshed=0;
  const result={};const btn={style:{}};
  const ctx=vm.createContext({console:{log(){}},propertyId:'fixture',propertyData:{ical_feeds:saved},
    document:{querySelector:()=>({id:calendar?'panel-calendar':'panel-settings'}),getElementById:id=>id.endsWith('Btn')?btn:result},
    h:k=>k,_icalEscape:x=>x,hostLang:'it',toast(){},
    collectIcalFeeds:()=>{collected++;return drafts;},
    sb:{auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},from:()=>({
      update:()=>{writes++;return {eq:()=>({select:async()=>({data:denied?[]:[{}]})})};},
      select:()=>({eq:()=>({maybeSingle:async()=>({data:{ical_feeds:saved}})})}),
    })},
    fetch:async()=>{posts++;return {ok:true,status:200,json:async()=>({synced:4,per_feed:[{}]})};},
    renderIcalFeeds(){},renderCalendarPanel:async()=>{refreshed++;},renderDashboard(){},
  });
  vm.runInContext(source,ctx);await ctx.syncIcalNow();
  return {collected,writes,posts,refreshed,disabled:btn.disabled};
}
const old=[{url:'https://example.test/feed',label:'Blue'}];
const current=[{...old[0],room_id:'fixture-room'}];
assert.deepEqual(await run(true,old,current),{collected:0,writes:0,posts:1,refreshed:1,disabled:false},'Calendar never saves hidden stale Settings');
assert.equal((await run(true,[],[])).posts,1,'server remains authoritative even when local feeds are empty');
assert.equal((await run(false,current,old)).writes,1,'Settings still saves explicit edits');
assert.equal((await run(false,current,old,true)).posts,0,'denied Settings save cannot sync');
assert.equal((await run(false,[],[])).posts,0,'empty Settings retains validation');
assert.match(html,/ical_sync_ok: '[^\n]*\(all dates\)/);
assert.match(html,/ical_sync_ok: '[^\n]*\(tutte le date\)/);
console.log('PASS calendar sync uses server feeds without stale Settings writes; Settings save/denial/empty gates and bilingual all-dates feedback');
