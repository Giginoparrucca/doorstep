// Round 55 — host-owned booking sharing. No guest message is sent by this module.
(function (W) {
'use strict';
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {
 en: {title:'Share with a guest',intro:'Choose a booking and share its existing guest app link.',booking:'Booking',upcoming:'Upcoming and current stays',all:'All stays',empty:'No bookings to share.',emptyHint:'Add a direct booking or sync your calendars in Guests.',loading:'Loading bookings…',error:'Could not load bookings.',retry:'Try again',copy:'Copy message',link:'Copy link',open:'Open guest app',message:'Message to guest',copied:'Copied!',failed:'Could not copy. Select and copy the text manually.',missing:'This booking has no usable link yet. Retry after checking the reservation.',guest:'Guest',unknown:'Dates unavailable',share:'Share',refresh:'Refresh',basic:'Hello {guest_name},\n\nWe look forward to welcoming you to {property_name} on {arrival_date}. Please use this link to complete your guest registration and explore the guest app:\n{guest_link}\n\nSee you soon!'},
 it: {title:'Condividi con un ospite',intro:'Scegli una prenotazione e condividi il suo link esistente all’app ospiti.',booking:'Prenotazione',upcoming:'Soggiorni in corso e futuri',all:'Tutti i soggiorni',empty:'Nessuna prenotazione da condividere.',emptyHint:'Aggiungi una prenotazione diretta o sincronizza i calendari in Ospiti.',loading:'Caricamento prenotazioni…',error:'Impossibile caricare le prenotazioni.',retry:'Riprova',copy:'Copia messaggio',link:'Copia link',open:'Apri app ospiti',message:'Messaggio all’ospite',copied:'Copiato!',failed:'Copia non riuscita. Seleziona e copia il testo manualmente.',missing:'Questa prenotazione non ha ancora un link utilizzabile. Riprova dopo averla verificata.',guest:'Ospite',unknown:'Date non disponibili',share:'Condividi',refresh:'Aggiorna',basic:'Ciao {guest_name},\n\nTi aspettiamo a {property_name} il {arrival_date}. Usa questo link per completare la registrazione degli ospiti e consultare l’app:\n{guest_link}\n\nA presto!'}
};
function visibleTest(row, mode) { return row.is_test !== true || (mode === 'demo' && /^DEMO-/.test(row.booking_code || '')); }
function bookings(reservations, checkins, property, mode) {
 const known = new Set(reservations.filter(r => r.property_id === property).map(r => r.booking_code).filter(Boolean));
 const result = reservations.filter(r => r.property_id === property && r.status === 'active' && !r.deleted_at && r.entry_type === 'reservation' && !r.covered_by_reservation_id && visibleTest(r,mode)).map(r => ({...r}));
 const groups = new Map();
 for(const c of checkins) {
  if(c.property_id!==property || !c.booking_code || !c.submitted_at || c.deleted_at || !visibleTest(c,mode) || known.has(c.booking_code)) continue;
  const old=groups.get(c.booking_code);
  if(!old || ['single','head','group'].includes(c.guest_type)) groups.set(c.booking_code,c);
 }
 for(const [code,c] of groups) result.push({id:'checkin:'+code,property_id:property,booking_code:code,guest_name:[c.name,c.surname].filter(Boolean).join(' '),checkin_date:c.arrival_date,checkout_date:c.departure_date,entry_type:'reservation',status:'active',from_checkin:true});
 return result.sort((a,b)=>(a.checkin_date||'9999').localeCompare(b.checkin_date||'9999') || String(a.id).localeCompare(String(b.id)));
}
function guestUrl(origin, property, code) { return code ? origin+'/?b='+encodeURIComponent(code)+'&p='+encodeURIComponent(property) : ''; }
const messages = {
 en: {
  start:'Hello {guest_name},\n\nWe look forward to welcoming you to {property_name} on {arrival_date}. Before arrival, please complete the registration details for everyone in your booking:\n{guest_link}\n\nYou can also use the app for house information and our local recommendations. See you soon!',
  partial:'Hello {guest_name},\n\nWe have received some guest registrations for your stay at {property_name} from {arrival_date}. Please complete the remaining guests using the same link:\n{guest_link}\n\nThank you, and see you soon!',
  received:'Hello {guest_name},\n\nThank you — we have received guest registration details for your stay at {property_name} from {arrival_date}. If anyone in your group still needs to register, please use this same link. You can also find house information and local recommendations here:\n{guest_link}',
  complete:'Hello {guest_name},\n\nThank you — registration details have been received for everyone in your booking at {property_name} from {arrival_date}. Keep this link for house information and local recommendations during your stay:\n{guest_link}\n\nWe look forward to welcoming you!'
 },
 it: {
  start:'Ciao {guest_name},\n\nTi aspettiamo a {property_name} il {arrival_date}. Prima dell’arrivo, completa i dati di registrazione di tutte le persone della prenotazione:\n{guest_link}\n\nNell’app trovi anche le informazioni della casa e i nostri consigli sulla zona. A presto!',
  partial:'Ciao {guest_name},\n\nAbbiamo ricevuto una parte delle registrazioni per il soggiorno a {property_name} dal {arrival_date}. Completa i dati degli ospiti mancanti usando lo stesso link:\n{guest_link}\n\nGrazie e a presto!',
  received:'Ciao {guest_name},\n\nGrazie, abbiamo ricevuto dei dati di registrazione per il soggiorno a {property_name} dal {arrival_date}. Se qualcuno del gruppo deve ancora registrarsi, può usare questo stesso link. Qui trovi anche le informazioni della casa e i nostri consigli:\n{guest_link}',
  complete:'Ciao {guest_name},\n\nGrazie, abbiamo ricevuto i dati di registrazione di tutte le persone della prenotazione a {property_name} dal {arrival_date}. Conserva questo link per le informazioni della casa e i nostri consigli durante il soggiorno:\n{guest_link}\n\nA presto!'
 }
};
const extraLabels={
 en:{language:'Message language',reset:'Reset message',whatsapp:'Open WhatsApp',status:'Registration',start:'Not started',partial:'Partially received',received:'Registration received · group size unconfirmed',complete:'All expected guests registered',defaults:'Property message defaults',defaultHint:'Edit this reusable template, not the guest message above. Supported placeholders: {guest_name}, {property_name}, {arrival_date}, {guest_link}.',save:'Save property default',saved:'Property default saved.',saveError:'Could not save property preferences. Your draft is still available.',invalid:'Include {guest_link}, use only the supported placeholders and remove any fixed booking links. Maximum 4,000 characters.',prefError:'Property defaults could not be loaded. Built-in messages are available; refresh to retry.',blocked:'Could not open WhatsApp. Copy the message instead.'},
 it:{language:'Lingua del messaggio',reset:'Ripristina messaggio',whatsapp:'Apri WhatsApp',status:'Registrazione',start:'Non iniziata',partial:'Ricevuta in parte',received:'Registrazione ricevuta · numero del gruppo non confermato',complete:'Tutti gli ospiti previsti registrati',defaults:'Messaggi predefiniti della proprietà',defaultHint:'Modifica questo modello riutilizzabile, non il messaggio all’ospite qui sopra. Segnaposto: {guest_name}, {property_name}, {arrival_date}, {guest_link}.',save:'Salva modello della proprietà',saved:'Modello della proprietà salvato.',saveError:'Impossibile salvare le preferenze. La bozza è ancora disponibile.',invalid:'Inserisci {guest_link}, usa solo i segnaposto supportati e rimuovi i link fissi di prenotazione. Massimo 4.000 caratteri.',prefError:'Impossibile caricare i modelli della proprietà. Puoi usare i messaggi di base; aggiorna per riprovare.',blocked:'Impossibile aprire WhatsApp. Copia il messaggio.'}
};
for(const l of ['en','it'])Object.assign(labels[l],extraLabels[l]);
function registration(row, checkins, mode) {
 const guests=checkins.filter(c=>c.property_id===row.property_id&&c.booking_code===row.booking_code&&!c.deleted_at&&c.submitted_at&&visibleTest(c,mode));
 if(!guests.length)return 'start';
 const reopened=[row.checkin_reopened_at,...guests.map(c=>c.checkin_reopened_at)].filter(Boolean).sort().at(-1);
 if(reopened&&!guests.some(c=>c.submitted_at>reopened))return 'partial';
 const expected=Number(row.guest_count);
 if(!Number.isInteger(expected)||expected<1)return 'received';
 return new Set(guests.map(c=>c.id)).size<expected?'partial':'complete';
}
function validTemplate(value) {
 return typeof value==='string'&&value.trim().length>0&&value.length<=4000&&value.includes('{guest_link}')&&!/[?&]b=/i.test(value)&&!value.replace(/\{(guest_name|property_name|arrival_date|guest_link)\}/g,'').match(/[{}]/);
}
function create(adapter) {
 const root=adapter.root;
 let state={property:null,rows:[],checkins:[],selected:'',scope:'upcoming',loading:false,error:false};
 let generation=0;
 const drafts=new Map();
 const context=()=>adapter.context();
 const lang=()=>context().lang==='it'?'it':'en';
 const messageLang=()=>state.language||lang();
 const kind=row=>registration(row,state.checkins,context().mode);
 const t=()=>labels[lang()];
 const current=()=>state.rows.find(r=>r.id===state.selected);
 const valid=()=>state.property && context().propertyId===state.property;
 function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:context().property?.timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
 function filtered() { const day=today();return state.rows.filter(r=>state.scope==='all'||!r.checkout_date||r.checkout_date>=day); }
 function key(row) { return state.property+'|'+row.booking_code+'|'+messageLang(); }
 function message(row) {
  const c=context();const date=row.checkin_date?new Date(row.checkin_date+'T12:00:00').toLocaleDateString(messageLang()==='it'?'it-IT':'en-GB',{day:'numeric',month:'long',year:'numeric'}):t().unknown;
  return (state.preferences?.[messageLang()+'_'+kind(row)]||messages[messageLang()][kind(row)]).replace(/\{(guest_name|property_name|arrival_date|guest_link)\}/g,(_,k)=>({guest_name:row.guest_name||labels[messageLang()].guest,property_name:c.property?.name||'WelcomeBnB',arrival_date:date,guest_link:guestUrl(c.origin,state.property,row.booking_code)})[k]);
 }
 function notify(txt) { const el=root.querySelector('[data-share-feedback]');if(el)el.textContent=txt; }
 function render() {
  if(!valid()) {root.innerHTML='';return;}
  const L=t();
  if(state.loading){root.innerHTML='<div role="status" class="form-card">'+escape(L.loading)+'</div>';return;}
  if(state.error){root.innerHTML='<div class="form-card"><p role="alert">'+escape(L.error)+'</p><button class="btn btn-secondary" data-share-retry>'+escape(L.retry)+'</button></div>';root.querySelector('[data-share-retry]').onclick=()=>load();return;}
  const list=filtered();if(!state.requestedMissing&&!list.some(r=>r.id===state.selected))state.selected=list[0]?.id||'';
  const row=current(),url=row?guestUrl(context().origin,state.property,row.booking_code):'';
  root.innerHTML=`<div class="form-card"><h3 style="margin:0 0 8px">${escape(L.title)}</h3><p class="form-card-desc">${escape(L.intro)}</p>
   <div class="share-controls"><select class="form-select" aria-label="${escape(L.booking)}" data-share-scope><option value="upcoming">${escape(L.upcoming)}</option><option value="all">${escape(L.all)}</option></select><button class="btn btn-secondary btn-sm" data-share-refresh>${escape(L.refresh)}</button></div>
   ${state.requestedMissing?`<p role="alert">${escape(L.missing)}</p>`:''}
   ${list.length?`<label class="form-label" for="shareBooking">${escape(L.booking)}</label><select id="shareBooking" class="form-select" data-guide="qr-select-booking">${list.map(r=>`<option value="${escape(r.id)}">${escape(r.guest_name||L.guest)} · ${escape(r.checkin_date||'—')} → ${escape(r.checkout_date||'—')}</option>`).join('')}</select>`:`<p>${escape(L.empty)}</p><p class="form-card-desc">${escape(L.emptyHint)}</p>`}
   ${row&&url?`<div class="share-actions"><button class="btn btn-secondary btn-sm" data-share-link>${escape(L.link)}</button><a class="btn btn-secondary btn-sm" href="${escape(url)}" target="_blank" rel="noopener">${escape(L.open)}</a></div><p style="font-size:.8rem" data-share-status>${escape(L.status)}: ${escape(L[kind(row)])}</p><label class="form-label" for="shareLanguage">${escape(L.language)}</label><select class="form-select" id="shareLanguage"><option value="it">Italiano</option><option value="en">English</option></select><label class="form-label" for="shareMessage">${escape(L.message)}</label><textarea id="shareMessage" class="form-textarea" style="min-height:200px" data-guide="qr-message"></textarea><div class="share-actions"><button class="btn btn-primary" data-share-copy data-guide="qr-copy-template">${escape(L.copy)}</button><button class="btn btn-secondary" data-share-whatsapp>${escape(L.whatsapp)}</button><button class="btn btn-secondary" data-share-reset>${escape(L.reset)}</button></div>
    <details data-share-defaults><summary style="cursor:pointer;font-size:.85rem">${escape(L.defaults)}</summary><p class="form-card-desc">${escape(L.defaultHint)}</p><label class="form-label" for="shareDefaultKind">${escape(L.status)}</label><select class="form-select" id="shareDefaultKind">${['start','partial','received','complete'].map(k=>`<option value="${k}">${escape(L[k])}</option>`).join('')}</select><textarea id="shareDefaultTemplate" class="form-textarea" style="min-height:180px;margin-top:10px" maxlength="4000"></textarea><button class="btn btn-secondary btn-sm" data-share-save-default>${escape(L.save)}</button></details>`:row?`<p role="alert">${escape(L.missing)}</p>`:''}
   ${state.prefError?`<p role="alert" class="form-card-desc">${escape(L.prefError)}</p>`:''}
   <p role="status" aria-live="polite" data-share-feedback style="font-size:.78rem;margin:8px 0 0"></p></div>`;
  root.querySelector('[data-share-scope]').value=state.scope;
  root.querySelector('[data-share-scope]').onchange=e=>{state.scope=e.target.value;render();};
  root.querySelector('[data-share-refresh]').onclick=()=>load(row?.booking_code);
  const select=root.querySelector('#shareBooking');if(select){select.value=state.selected;select.onchange=()=>{state.selected=select.value;state.requestedMissing=false;render();};}
  const textarea=root.querySelector('#shareMessage');
  if(textarea){textarea.value=drafts.get(key(row))??message(row);textarea.oninput=()=>drafts.set(key(row),textarea.value);}
  const language=root.querySelector('#shareLanguage');
  if(language){language.value=messageLang();language.onchange=()=>{state.language=language.value;render();savePreference('message_language',state.language);};}
  const reset=root.querySelector('[data-share-reset]');if(reset)reset.onclick=()=>{drafts.delete(key(row));render();};
  const whatsapp=root.querySelector('[data-share-whatsapp]');if(whatsapp)whatsapp.onclick=()=>{if(!valid())return;try{const tab=W.open('https://wa.me/?text='+encodeURIComponent(textarea.value),'_blank');if(tab){tab.opener=null;}else notify(t().blocked);}catch(_){notify(t().blocked);}};
  const defaultKind=root.querySelector('#shareDefaultKind'),defaultText=root.querySelector('#shareDefaultTemplate');
  if(defaultKind){defaultKind.value=kind(row);const update=()=>{defaultText.value=state.preferences?.[messageLang()+'_'+defaultKind.value]||messages[messageLang()][defaultKind.value];};update();defaultKind.onchange=update;root.querySelector('[data-share-save-default]').onclick=async()=>{if(!validTemplate(defaultText.value)){notify(t().invalid);return;}const ok=await savePreference(messageLang()+'_'+defaultKind.value,defaultText.value);if(ok)notify(t().saved);};}
  const copy=root.querySelector('[data-share-copy]');if(copy)copy.onclick=()=>copyText(textarea.value);
  const link=root.querySelector('[data-share-link]');if(link)link.onclick=()=>copyText(url);
 }
 async function copyText(text) { if(!valid())return;try{await W.navigator.clipboard.writeText(text);if(valid())notify(t().copied);}catch(_){if(valid())notify(t().failed);} }
 async function savePreference(preference_key,value) {
  if(!valid())return false;const prop=state.property;
  try{const {data,error}=await context().sb.from('host_share_preferences').upsert({property_id:prop,preference_key,value},{onConflict:'property_id,preference_key'}).select('preference_key,value');if(error||!data?.length)throw error||Error('No saved row');if(context().propertyId!==prop)return false;state.preferences={...state.preferences,[preference_key]:value};return true;}catch(_){if(context().propertyId===prop)notify(t().saveError);return false;}
 }
 async function page(table,fields,property) {
  let rows=[];for(let from=0;;from+=500){const {data,error}=await context().sb.from(table).select(fields).eq('property_id',property).order('id',{ascending:true}).range(from,from+499);if(error)throw error;rows=rows.concat(data||[]);if(!data||data.length<500)return rows;}
 }
 async function load(code) {
  const c=context(),prop=c.propertyId,version=++generation;
  if(!prop){state.property=null;root.innerHTML='';return;}
  if(state.property!==prop)state={property:prop,rows:[],checkins:[],selected:'',scope:'upcoming',loading:true,error:false};
  else{state.loading=true;state.error=false;}
  render();
  try{
   const [reservations,checkins,prefs]=await Promise.all([page('ota_reservations','id,property_id,booking_code,guest_name,guest_count,checkin_date,checkout_date,entry_type,status,covered_by_reservation_id,deleted_at,is_test,checkin_reopened_at',prop),page('checkins','id,property_id,booking_code,name,surname,guest_type,arrival_date,departure_date,submitted_at,deleted_at,is_test,checkin_reopened_at',prop),context().sb.from('host_share_preferences').select('preference_key,value').eq('property_id',prop).then(r=>r).catch(()=>({error:true}))]);
   if(version!==generation||context().propertyId!==prop)return;
   const candidates=bookings(reservations,checkins,prop,c.mode);
   // Assign only through the existing persisted-reservation path, never an unbound code.
   const missing=candidates.filter(r=>!r.booking_code&&!r.from_checkin);
   if(missing.length)await adapter.ensureCodes(missing);
   if(version!==generation||context().propertyId!==prop)return;
   if(state.property===prop){state.preferences=Object.fromEntries((prefs.data||[]).filter(p=>p.preference_key==='message_language'?['en','it'].includes(p.value):validTemplate(p.value)).map(p=>[p.preference_key,p.value]));state.prefError=!!prefs.error;if(!state.language)state.language=state.preferences.message_language||lang();}
   state.rows=candidates;state.checkins=checkins;state.loading=false;state.requestedMissing=false;
   if(code){const match=candidates.find(r=>r.booking_code===code);if(match){state.selected=match.id;if(match.checkout_date<today())state.scope='all';}else{state.selected='';state.requestedMissing=true;}}
   render();
  }catch(_){if(version!==generation||context().propertyId!==prop)return;state.loading=false;state.error=true;render();}
 }
 return {load,repaint:render,getState:()=>state};
}
W.HostShare={create,bookings,guestUrl,escape,registration,messages,validTemplate};
})(window);
