// Round 63: owner-only connection/mapping dialogs and comparison-only reports.
(function(global){
'use strict';
function create({root,context,request}) {
 let connection=null,catalog=null,error=null,busy=false,generation=0,modal=null,dirty=false;
 const t=(it,en)=>context().lang==='it'?it:en;
 const node=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==null)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
 function button(text,run,disabled=false){const b=node('button',text,{type:'button',class:'btn btn-secondary btn-sm'});b.style.marginRight='8px';b.style.marginBottom='8px';b.disabled=disabled;b.addEventListener('click',run);return b;}
 const message=code=>{
  if(code==='integration_disabled'||code==='environment_not_enabled')return t('Connessione nativa non ancora abilitata. Il calendario continua con iCal.','Native connection is not enabled yet. The calendar continues using iCal.');
  if(code==='property_forbidden')return t('Solo il proprietario può configurare questa connessione.','Only the property owner can configure this connection.');
  if(code==='mapping_confirmation_required')return t('Conferma una singola unità per ogni camera selezionata.','Confirm one physical unit for each selected room.');
  if(code==='mapping_invalid'||code==='mapping_duplicate_room')return t('Controlla le associazioni: ogni camera può essere usata una sola volta.','Check room matches: each room can be used only once.');
  if(code==='comparison_range_invalid')return t('Scegli date valide e ordinate, entro 31 giorni.','Choose valid dates in order, within 31 days.');
  if(code==='connection_changed')return t('La configurazione è cambiata. Ricarica prima di riprovare.','Configuration changed. Reload before trying again.');
  if(code==='quota_paused'||code==='rate_paused')return t('Limite del servizio raggiunto. Riprova più tardi.','Service request limit reached. Try again later.');
  return t('Operazione non completata. Controlla la connessione e riprova.','Could not complete the operation. Check the connection and retry.');
 };
 async function call(action,data={},owner=context().propertyId){
  const version=connection?.version;
  return request(action,{...data,...(action==='status'?{}:{version})},owner);
 }
 function close(force=false){if(modal&&!force&&dirty&&!global.confirm(t('Scartare le modifiche non salvate?','Discard unsaved changes?')))return false;
  if(modal){modal.close();modal.remove();modal=null;}dirty=false;return true;}
 function dialog(title){if(!close())return null;const d=node('dialog',null,{class:'ires-dialog','aria-label':title});
  d.style.cssText='position:fixed;inset:0;margin:auto;width:min(620px,92vw);max-height:85vh;box-sizing:border-box;overflow:auto;border:1px solid #d7e7ff;border-radius:14px;padding:22px;color:#061a3d;';
  d.append(node('h2',title));const feedback=node('div','',{'aria-live':'polite',role:'status'});feedback.style.cssText='margin:12px 0;overflow-wrap:anywhere';
  d.append(feedback);d.addEventListener('input',()=>dirty=true);d.addEventListener('change',()=>dirty=true);
  d.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(d);modal=d;d.showModal();
  return {d,feedback,owner:context().propertyId,version:connection?.version,generation};
 }
 function current(view){return modal===view.d&&view.owner===context().propertyId&&view.generation===generation;}
 function field(view,label,type,value='',attrs={}){const wrap=node('label',label);wrap.style.cssText='display:block;margin:12px 0;overflow-wrap:anywhere';
  const input=node('input',null,{type,...attrs});input.value=value;input.style.cssText='display:block;width:100%;min-width:0;box-sizing:border-box;padding:9px;margin-top:5px;border:1px solid #b8cbe3;border-radius:6px;';wrap.append(input);view.d.append(wrap);return input;}
 async function operation(view,action,data,onSuccess){
  if(!current(view)||busy)return;busy=true;view.feedback.textContent=t('Operazione in corso…','Working…');
  view.d.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const result=await call(action,data,view.owner);if(!current(view))return;dirty=false;await onSuccess(result);}
  catch(e){if(current(view))view.feedback.textContent=message(e.code);}
  finally{if(view.generation===generation){busy=false;if(current(view))view.d.querySelectorAll('button').forEach(b=>b.disabled=false);paint();}}
 }
 function connectionDialog(){const v=dialog(t('Connessione iReservation','iReservation connection'));if(!v)return;
  v.d.append(node('p',t('Usa le credenziali del channel manager, diverse dall’accesso all’area riservata. Il confronto non modifica il calendario.','Use channel-manager credentials, distinct from the reserved-area login. Comparison does not change the calendar.')));
  const cal=field(v,'Calendar ID','number',connection?.calendar_id||'',{min:1,required:true,'data-ir-field':'calendar'});
  const user=field(v,t('Nome utente struttura','Property username'),'text','',{required:true,autocomplete:'off',maxlength:1024,'data-ir-field':'username'});
  const password=field(v,t('Password struttura (vuota = mantieni quella salvata)','Property password (blank = keep saved password)'),'password','',{autocomplete:'new-password',maxlength:4096,'data-ir-field':'password'});
  v.d.append(button(t('Salva connessione','Save connection'),()=>{
   if(!cal.checkValidity()||!user.checkValidity()||(!connection?.configured&&!password.value)){v.feedback.textContent=t('Completa Calendar ID, utente e password.','Complete calendar ID, username and password.');return;}
   return operation(v,'save',{calendar_id:Number(cal.value),propertyUsername:user.value,propertyPassword:password.value},async result=>{password.value='';connection=result;catalog=null;close(true);});
  }),button(t('Annulla','Cancel'),()=>close()));
 }
 async function verify(){if(busy)return;busy=true;const stamp=generation,owner=context().propertyId;paint();
  try{const result=await call('verify',{},owner);if(stamp!==generation||owner!==context().propertyId)return;connection=result;error=result.last_error;if(result.verified){const loaded=await call('catalog',{},owner);if(stamp===generation&&owner===context().propertyId)catalog=loaded;}}
  catch(e){if(stamp===generation)error=e.code;}finally{if(stamp===generation){busy=false;paint();}}}
 async function loadCatalog(){if(busy)return false;busy=true;const stamp=generation,owner=context().propertyId;
  try{const result=await call('catalog',{},owner);if(stamp!==generation||owner!==context().propertyId)return false;catalog=result;return true;}
  catch(e){if(stamp===generation)error=e.code;return false;}finally{if(stamp===generation){busy=false;paint();}}}
 async function mappingDialog(){if(!await loadCatalog())return;const v=dialog(t('Associa le camere','Match rooms'));if(!v)return;
  v.d.append(node('p',t('Scegli ogni associazione. Il nome non prova l’identità: conferma una singola unità fisica. Le categorie con più unità richiedono revisione.','Choose each match explicitly. A name does not prove identity: confirm one physical unit. Multi-unit categories require review.')));
  const rows=[];
  for(const provider of catalog.provider_rooms){const box=node('section');box.style.cssText='padding:12px 0;border-bottom:1px solid #d7e7ff;overflow-wrap:anywhere';box.append(node('strong',provider.name+' · '+provider.id));
   const label=node('label',t('Camera WelcomeBnB','WelcomeBnB room'));label.style.cssText='display:block;margin-top:7px';const select=node('select',null,{'aria-label':provider.name,'data-ir-provider':provider.id});select.style.cssText='display:block;max-width:100%;width:100%;padding:8px;margin:7px 0';
   select.append(node('option',t('Da associare','Unmapped'),{value:''}));for(const room of provider.type==='room'?catalog.local_rooms:[])select.append(node('option',room.name,{value:room.id}));
   if(!catalog.local_rooms.length&&provider.type==='property')select.append(node('option',t('Intera proprietà','Whole property'),{value:'__property__'}));
   const old=catalog.mappings.find(m=>m.provider_id===provider.id);select.value=old?.strategy==='whole_property'?'__property__':old?.room_id||'';
   const confirmLabel=node('label',t('Confermo una singola camera fisica / intera proprietà','I confirm one physical room / whole property'));const confirm=node('input',null,{type:'checkbox','data-ir-confirm':provider.id});confirmLabel.style.cssText='display:flex;align-items:flex-start;gap:6px';confirm.style.marginTop='4px';confirm.checked=old?.confirmed===true;confirmLabel.prepend(confirm);label.append(select);box.append(label,confirmLabel);v.d.append(box);rows.push({provider,select,confirm});
  }
  v.d.append(button(t('Salva associazioni','Save room mapping'),()=>operation(v,'save_mapping',{mapping_version:catalog.version,mappings:rows.map(({provider,select,confirm})=>({provider_id:provider.id,strategy:select.value==='__property__'?'whole_property':select.value?'single_unit':'unmapped',room_id:select.value&&select.value!=='__property__'?select.value:null,confirmed:!!select.value&&confirm.checked}))},async result=>{catalog={...catalog,...result};close(true);})),button(t('Annulla','Cancel'),()=>close()));
 }
 function renderReport(parent,report){const counts=report.counts;if(report.generated_at)parent.append(node('p',t('Ultimo confronto: ','Last comparison: ')+new Date(report.generated_at).toLocaleString(context().lang==='it'?'it-IT':'en-GB')));parent.append(node('p',t('Solo confronto: nessuna prenotazione importata o annullata. Copertura del provider non verificata; passaggio al nuovo sistema disabilitato.','Comparison only: no bookings imported or cancelled. Provider coverage is unverified; switching sources is disabled.')));
  const list=node('dl');list.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px 14px;margin:12px 0';for(const[key,it,en]of [['fetched','Ricevute (tutte le date della richiesta)','Fetched (all requested dates)'],['review','Da verificare','Needs review'],['ambiguous','Corrispondenze ambigue','Ambiguous candidates'],['quarantined','Dati da chiarire','Needs clarification'],['api_only','Solo API','API only'],['local_only','Solo calendario locale','Local only'],['changed','Differenze','Differences'],['duplicate','ID ripetuti','Repeated IDs'],['deleted','Annullate nella risposta API','Cancelled records in API response']]){const value=node('dd',String(counts[key]||0));value.style.margin='0';list.append(node('dt',t(it,en)),value);}parent.append(list);
  if(report.local_truncated)parent.append(node('p',t('Il confronto locale è limitato a 1000 righe; nessuna assenza può essere interpretata come cancellazione.','Local comparison is limited to 1000 rows; absence cannot be treated as cancellation.')));
  const details=node('details'),summary=node('summary',t('Mostra riferimenti (massimo 100)','Show references (up to 100)'));details.append(summary);
  for(const item of report.items.slice(0,100)){const labels={matched:t('Corrisponde','Matches'),changed:t('Differenze','Differences'),api_only:t('Solo API','API only'),review:t('Da verificare','Needs review'),ambiguous:t('Ambigua','Ambiguous'),quarantined:t('Da chiarire','Needs clarification')};const p=node('p',item.distributor+' / '+item.id+' · '+(item.status==='D'?t('Annullata','Cancelled'):t('Prenotazione','Booking'))+' · '+(item.checkin||'—')+' → '+(item.checkout||'—')+' · '+(labels[item.outcome]||labels.quarantined));p.style.overflowWrap='anywhere';details.append(p);}parent.append(details);
 }
 async function compareDialog(){if(!await loadCatalog())return;const v=dialog(t('Confronta le prenotazioni','Compare bookings'));if(!v)return;
  const now=new Date();const start=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));const end=new Date(+start+30*86400000);
  const from=field(v,t('Dal','From'),'date',start.toISOString().slice(0,10),{required:true,'data-ir-field':'from'}),to=field(v,t('Al (massimo 31 giorni)','To (maximum 31 days)'),'date',end.toISOString().slice(0,10),{required:true,'data-ir-field':'to'});
  const reportRoot=node('div');v.d.append(button(t('Esegui confronto','Run comparison'),()=>operation(v,'compare',{mapping_version:catalog.version,fromDate:from.value,toDate:to.value},async result=>{reportRoot.replaceChildren();renderReport(reportRoot,result.report);catalog.report=result.report;v.feedback.textContent=t('Confronto completato. Calendario invariato.','Comparison complete. Calendar unchanged.');})),button(t('Chiudi','Close'),()=>close()),reportRoot);
  if(catalog.report)renderReport(reportRoot,catalog.report);
 }
 async function disconnect(){if(busy||!global.confirm(t('Disconnettere iReservation? Il calendario iCal resta attivo.','Disconnect iReservation? The iCal calendar stays active.')))return;
  const stamp=generation,owner=context().propertyId;busy=true;paint();try{const r=await call('disconnect',{},owner);if(stamp===generation){connection=r;catalog=null;error=null;}}catch(e){if(stamp===generation)error=e.code;}finally{if(stamp===generation){busy=false;paint();}}}
 function paint(){if(!root)return;root.replaceChildren();root.style.overflowWrap='anywhere';
  root.append(node('h3','iReservation'),node('p',t('Connessione nativa · solo confronto. iCal continua a gestire il calendario. Chiusure di disponibilità non disponibili dal provider.','Native connection · comparison only. iCal still manages the calendar. Provider availability closures are not available.')));
  if(context().readOnly){root.append(node('p',message('property_forbidden')));return;}
  if(error)root.append(node('p',message(error),{role:'status'}));
  else root.append(node('p',busy?t('Caricamento…','Loading…'):connection?.verified_at?t('Connessione verificata.','Connection verified.'):connection?.configured?t('Credenziali salvate; verifica la connessione.','Credentials saved; check the connection.'):t('Non connesso.','Not connected.')));
  const off=busy||!!error&&['integration_disabled','environment_not_enabled','property_forbidden'].includes(error)||!connection;
  const actions=node('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';actions.append(button(t('Ricarica stato','Reload status'),load,busy),button(connection?.configured?t('Modifica connessione','Edit connection'):t('Connetti','Connect'),connectionDialog,off));
  if(connection?.configured)actions.append(button(t('Verifica connessione','Check connection'),verify,off),button(t('Associa camere','Match rooms'),mappingDialog,off||!connection.verified_at),button(t('Confronta prenotazioni','Compare bookings'),compareDialog,off||!connection.verified_at),button(t('Disconnetti','Disconnect'),disconnect,off));root.append(actions);
 }
 async function load(){const stamp=++generation,owner=context().propertyId;close(true);connection=null;catalog=null;error=null;busy=false;paint();
  if(!owner||context().readOnly)return;
  try{const r=await request('status',{},owner);if(stamp!==generation||owner!==context().propertyId)return;connection=r;}
  catch(e){if(stamp===generation)error=e.code;}finally{if(stamp===generation)paint();}}
 return {load,repaint:paint,destroy(){generation++;close(true);root.replaceChildren();}};
}
global.IreservationPanel={create};
})(window);
