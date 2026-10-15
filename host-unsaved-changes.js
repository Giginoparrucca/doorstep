// Round 59: one memory-only registry for saveable drafts across the host console.
(function(W){
'use strict';
function prompt(lang){return new Promise(resolve=>{
 const it=lang()==='it',d=document.createElement('dialog');d.className='property-leave-dialog';
 d.setAttribute('aria-labelledby','propertyLeaveTitle');d.setAttribute('aria-describedby','propertyLeaveText');
 d.innerHTML=`<h2 id="propertyLeaveTitle">${it?'Salvare le modifiche?':'Save your changes?'}</h2><p id="propertyLeaveText">${it?'Hai modifiche non salvate. Vuoi salvarle prima di continuare?':'You have unsaved changes. Save them before continuing?'}</p><div class="property-leave-actions"><button type="button" class="btn btn-primary" data-choice="save">${it?'Salva e continua':'Save and continue'}</button><button type="button" class="btn btn-secondary" data-choice="discard">${it?'Scarta modifiche':'Discard changes'}</button><button type="button" class="btn btn-secondary" data-choice="stay" autofocus>${it?'Continua a modificare':'Keep editing'}</button></div>`;
 const done=choice=>{d.close();d.remove();resolve(choice);};
 d.addEventListener('cancel',e=>{e.preventDefault();done('stay');});
 d.addEventListener('click',e=>{const b=e.target.closest('[data-choice]');if(b)done(b.dataset.choice);});
 document.body.appendChild(d);d.showModal();
});}
function values(root,selector='input,select,textarea'){return JSON.stringify([...root.querySelectorAll(selector)].filter(e=>!e.readOnly&&e.type!=='file'&&!e.hasAttribute('data-draft-ignore')).map(e=>{
 if(e.hasAttribute('data-i18n-field')){const lg=e.getAttribute('data-lang');return [e.id,...['it','en'].map(l=>l===lg?e.value:e.getAttribute('data-lang-'+l)||'')];}
 return [e.id||e.name||e.className,e.type==='checkbox'||e.type==='radio'?e.checked:e.value];
}));}
function create({lang,canEdit=()=>true,onError=()=>{}}){
 const entries=new Map(),pending=new Map();let navigating=false,expired=false;
 const live=e=>e&&e.root?.isConnected&&(e.enabled?e.enabled():e.active);
 const dirty=e=>Boolean(live(e)&&(e.dirty?e.dirty():e.baseline!==e.snapshot()));
 function register(id,e){entries.set(id,{snapshot:()=>values(e.root),active:false,...e});return id;}
 function begin(id){const e=entries.get(id);if(!e)return;e.baseline=e.snapshot();e.active=true;}
 function end(id){const e=entries.get(id);if(e)e.active=false;}
 function unregister(id){entries.delete(id);}
 function busy(){return pending.size>0||[...entries.values()].some(e=>e.pending?.());}
 async function run(id,operation){
  if(pending.has(id))return pending.get(id);if(!canEdit()||busy())return false;
  const e=entries.get(id),controls=[...(e?.root?.querySelectorAll('input,select,textarea,button')||[])].map(n=>[n,n.disabled]);
  controls.forEach(([n])=>n.disabled=true);
  const task=Promise.resolve().then(operation).then(ok=>{if(ok===true){if(e?.keepActive&&e.root.isConnected)begin(id);else end(id);}return ok===true;}).catch(error=>{onError(error);return false;}).finally(()=>{controls.forEach(([n,v])=>{if(n.isConnected)n.disabled=v;});pending.delete(id);});
  pending.set(id,task);return task;
 }
 async function leave(ids){
  if(navigating||busy())return false;navigating=true;
  try{
   const selected=[...entries].filter(([id,e])=>(!ids||ids.includes(id))&&live(e)),changed=selected.filter(([,e])=>dirty(e));
   if(changed.length){const choice=await prompt(lang);if(choice==='stay')return false;
    for(const [id,e]of changed){if(choice==='save'){if(!canEdit()||await e.save()!==true)return false;}else await e.discard();end(id);}
   }
   for(const [id,e]of selected){if(!changed.some(([key])=>key===id)){await e.discard();end(id);}}
   return true;
  }catch(error){onError(error);return false;}finally{navigating=false;}
 }
 function expire(){expired=true;for(const e of entries.values())e.active=false;}
 W.addEventListener('beforeunload',e=>{if(!expired&&(busy()||[...entries.values()].some(dirty))){e.preventDefault();e.returnValue='';}});
 return {register,begin,end,unregister,run,leave,busy,expire,dirty:id=>dirty(entries.get(id))};
}
W.HostUnsavedChanges={create,prompt,values};
})(window);
