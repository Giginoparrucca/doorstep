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
function create(adapter) {
 const root=adapter.root;
 let state={property:null,rows:[],checkins:[],selected:'',scope:'upcoming',loading:false,error:false};
 let generation=0;
 const drafts=new Map();
 const context=()=>adapter.context();
 const lang=()=>context().lang==='it'?'it':'en';
 const t=()=>labels[lang()];
 const current=()=>state.rows.find(r=>r.id===state.selected);
 const valid=()=>state.property && context().propertyId===state.property;
 function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:context().property?.timezone||'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
 function filtered() { const day=today();return state.rows.filter(r=>state.scope==='all'||!r.checkout_date||r.checkout_date>=day); }
 function key(row) { return state.property+'|'+row.booking_code+'|'+lang(); }
 function message(row) {
  const c=context();const date=row.checkin_date?new Date(row.checkin_date+'T12:00:00').toLocaleDateString(lang()==='it'?'it-IT':'en-GB',{day:'numeric',month:'long',year:'numeric'}):t().unknown;
  return t().basic.replace(/\{(guest_name|property_name|arrival_date|guest_link)\}/g,(_,k)=>({guest_name:row.guest_name||t().guest,property_name:c.property?.name||'WelcomeBnB',arrival_date:date,guest_link:guestUrl(c.origin,state.property,row.booking_code)})[k]);
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
   ${row&&url?`<div class="share-actions"><button class="btn btn-secondary btn-sm" data-share-link>${escape(L.link)}</button><a class="btn btn-secondary btn-sm" href="${escape(url)}" target="_blank" rel="noopener">${escape(L.open)}</a></div><label class="form-label" for="shareMessage">${escape(L.message)}</label><textarea id="shareMessage" class="form-textarea" style="min-height:200px" data-guide="qr-message"></textarea><div class="share-actions"><button class="btn btn-primary" data-share-copy data-guide="qr-copy-template">${escape(L.copy)}</button></div>`:row?`<p role="alert">${escape(L.missing)}</p>`:''}
   <p role="status" aria-live="polite" data-share-feedback style="font-size:.78rem;margin:8px 0 0"></p></div>`;
  root.querySelector('[data-share-scope]').value=state.scope;
  root.querySelector('[data-share-scope]').onchange=e=>{state.scope=e.target.value;render();};
  root.querySelector('[data-share-refresh]').onclick=()=>load(row?.booking_code);
  const select=root.querySelector('#shareBooking');if(select){select.value=state.selected;select.onchange=()=>{state.selected=select.value;render();};}
  const textarea=root.querySelector('#shareMessage');
  if(textarea){textarea.value=drafts.get(key(row))??message(row);textarea.oninput=()=>drafts.set(key(row),textarea.value);}
  const copy=root.querySelector('[data-share-copy]');if(copy)copy.onclick=()=>copyText(textarea.value);
  const link=root.querySelector('[data-share-link]');if(link)link.onclick=()=>copyText(url);
 }
 async function copyText(text) { if(!valid())return;try{await W.navigator.clipboard.writeText(text);if(valid())notify(t().copied);}catch(_){if(valid())notify(t().failed);} }
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
   const [reservations,checkins]=await Promise.all([page('ota_reservations','id,property_id,booking_code,guest_name,guest_count,checkin_date,checkout_date,entry_type,status,covered_by_reservation_id,deleted_at,is_test,checkin_reopened_at',prop),page('checkins','id,property_id,booking_code,name,surname,guest_type,arrival_date,departure_date,submitted_at,deleted_at,is_test,checkin_reopened_at',prop)]);
   if(version!==generation||context().propertyId!==prop)return;
   const candidates=bookings(reservations,checkins,prop,c.mode);
   // Assign only through the existing persisted-reservation path, never an unbound code.
   const missing=candidates.filter(r=>!r.booking_code&&!r.from_checkin);
   if(missing.length)await adapter.ensureCodes(missing);
   if(version!==generation||context().propertyId!==prop)return;
   state.rows=candidates;state.checkins=checkins;state.loading=false;state.requestedMissing=false;
   if(code){const match=candidates.find(r=>r.booking_code===code);if(match){state.selected=match.id;if(match.checkout_date<today())state.scope='all';}else{state.selected='';state.requestedMissing=true;}}
   render();
  }catch(_){if(version!==generation||context().propertyId!==prop)return;state.loading=false;state.error=true;render();}
 }
 return {load,repaint:render,getState:()=>state};
}
W.HostShare={create,bookings,guestUrl,escape};
})(window);
