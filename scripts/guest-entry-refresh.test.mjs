import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({Date,Promise,Error});
vm.runInContext(fs.readFileSync(new URL('../lib/guest-entry-refresh.js',import.meta.url),'utf8'),ctx);
let scope='A',visible=true,now=100000,clears=0,applied=[],pending=[],timers=new Map(),next=0;
const controller=ctx.GuestEntryRefresh.create({scope:()=>scope,visible:()=>visible,clock:()=>now,
  clear:()=>{clears++;},apply:r=>applied.push(r),load:()=>new Promise(resolve=>pending.push(resolve)),
  setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
const reply=(state='available',at=null)=>({ok:true,data:{property:{id:scope},entry_release:{state,allow_entry:state==='available',release_at:at}}});
let first=controller.refresh();assert.equal(clears,1);let second=controller.refresh();
pending.shift()(reply());await first;assert.equal(applied.length,0,'older request cannot win');
pending.shift()(reply('scheduled',new Date(now+2000).toISOString()));await second;
assert.equal(applied.length,1);assert.equal([...timers.values()][0].delay,2250);
let timer=[...timers.values()][0];timers.clear();timer.fn();assert.equal(clears,3,'time refresh clears before reading');
scope='B';pending.shift()(reply());await Promise.resolve();await Promise.resolve();assert.equal(applied.length,1,'scope change fences response');
controller.invalidate();first=controller.refresh();visible=false;controller.invalidate();pending.shift()(reply());await first;
assert.equal(applied.length,1,'hidden view cannot receive response');
visible=true;first=controller.refresh();pending.shift()({ok:false});assert.equal(await first,false);
assert.equal([...timers.values()][0].delay,60000,'failed read retries modestly');
first=controller.refresh();const timeout=[...timers.values()].find(t=>t.delay===15000);timeout.fn();
assert.equal(await first,false);pending.shift()(reply());await Promise.resolve();assert.equal(applied.length,1,'late timed-out response ignored');
visible=false;const count=pending.length;assert.equal(await controller.refresh(),false);assert.equal(pending.length,count);
console.log('PASS actual refresh controller: stale/scope/hidden fences, clear-before-read, scheduled server refresh, timeout and error retry; timers never grant entry.');
