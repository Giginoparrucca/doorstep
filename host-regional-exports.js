// Region-aware download review. No uploads, filing-status writes or stored drafts.
(function(){
'use strict';
window.HostRegionalExports={create};
function create({root,context,comuneCode,allog}){
 const R=RegionalExports,E=R.esc;
 let dialog=null,model=null,activeProperty=null,busy=false,epoch=0;
 const text=(it,en)=>context().lang==='it'?it:en;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const config=()=>R.config(context().property,comuneCode(context().property?.city));
 const reason=c=>({
 api:text('La Regione documenta l’invio da gestionale tramite API. Questo download è un riepilogo per compilare il portale, non un file di importazione.','The regional management-software interface is an API. This download is a reference for manual portal entry, not an import file.'),
 spec:text('Il portale prevede un proprio tracciato, ma non abbiamo potuto verificarne una specifica pubblica attuale. Il CSV è solo un riepilogo per l’inserimento manuale.','The portal has its own format, but a current public import specification could not be verified. The CSV is a reference for manual entry only.'),
 lts:text('ASTAT richiede l’interfaccia LTS PMS API. Non è previsto qui un file importabile: il CSV è solo un riepilogo di riferimento.','ASTAT requires the LTS PMS API. This CSV is a reference report, not an ASTAT import file.'),
 vit:text('VIT documenta l’inserimento manuale o il collegamento PMS. Per le locazioni usa il portale dedicato. Il CSV è solo un riepilogo di riferimento.','VIT documents manual entry or a PMS connection. Tourist rentals use the dedicated portal. This CSV is a reference report only.'),
 toscana:text('Fuori Firenze, Prato e Pistoia il sistema dipende dall’ambito e dal tipo di struttura. Verifica il portale assegnato: questo CSV non è un file di importazione.','Outside Firenze, Prato and Pistoia the system depends on the area and property category. Check your assigned portal: this CSV is not an import file.')
 }[c?.reason]||'');
 function close(){epoch++;dialog?.close();dialog?.remove();dialog=null;model=null;busy=false;}
 function render(){
  const ctx=context(),cfg=config();if(activeProperty&&activeProperty!==ctx.propertyId)close();
  activeProperty=ctx.propertyId;
  if(!cfg){root.innerHTML='';return;}
  const native=['ross','puglia','umbria','trentino'].includes(cfg.format);
  // Round 61 Phase 1b — dynamic Puglia label follows the saved regional_service.
  //   spot_easy    → "SPOT Easy TXT"       (unchanged from Round 58)
  //   spot_online  → "SPOT Online CSV"     (interim; XML lands in Phase 2)
  //   null/other   → "SPOT (scegli servizio)" so the host knows to pick first
  const svc=ctx.property&&ctx.property.regional_service;
  const pugliaLabel=svc==='spot_online'?'SPOT Online CSV':svc==='spot_easy'?'SPOT Easy TXT':text('SPOT (scegli servizio)','SPOT (choose service)');
  const label={ross:'ROSS1000 XML',puglia:pugliaLabel,umbria:'Turismatica TXT',trentino:'STU TXT'}[cfg.format];
  root.innerHTML=`<div class="export-tile-h"><div class="tile-body"><h3>${E(cfg.system)} · ${E(ctx.property.region)}</h3><p>${native?E(text('Prepara e controlla il file prima di caricarlo sul portale regionale.','Prepare and review your file before uploading it to the regional portal.')):E(reason(cfg))}</p></div><div class="tile-actions"><button type="button" class="btn btn-primary" data-regional-open>${E(native?text('📥 Scarica ','📥 Download ')+label:text('📥 Riepilogo per inserimento manuale (CSV)','📥 Manual-entry summary (CSV)'))}</button><a href="${E(cfg.portal)}" target="_blank" rel="noopener" class="export-portal-link">${E(text('Apri portale','Open portal'))} ↗</a></div></div>`;
  if(ctx.property.region==="Valle d'Aosta")root.insertAdjacentHTML('beforeend','<a href="https://locazionituristiche.regione.vda.it/" target="_blank" rel="noopener">'+E(text('Portale locazioni turistiche','Tourist rentals portal'))+' ↗</a>');
  root.querySelector('[data-regional-open]').addEventListener('click',open);
 }
 const input=(key,label,value,type='text',attrs='')=>`<label class="regional-field"><span>${E(label)}</span><input class="form-input" data-field="${key}" type="${type}" value="${E(value??'')}" ${attrs}></label>`;
 function open(){
  close();const cfg=config();if(!cfg)return;const ctx=context();activeProperty=ctx.propertyId;
  dialog=document.createElement('dialog');dialog.className='regional-dialog';dialog.setAttribute('aria-labelledby','regionalDialogTitle');
  const date=today();
  dialog.innerHTML=`<div class="regional-dialog-head"><h2 id="regionalDialogTitle">${E(cfg.system)} — ${E(text('Scarica file','Download file'))}</h2><button type="button" class="btn btn-secondary" data-close aria-label="${E(text('Chiudi','Close'))}">×</button></div><p>${E(ctx.property.name||'')}</p><div class="regional-grid">${input('start',text('Dal','From'),date.slice(0,8)+'01','date',`max="${date}"`)}${input('end',text('Al','To'),date,'date',`max="${date}"`)}</div><div data-variant></div><p data-mode-note></p><button type="button" class="btn btn-primary" data-load>${E(text('Prepara dati','Prepare data'))}</button><p data-status role="status" aria-live="polite"></p><div data-review></div>`;
  // Round 61 Phase 1b — Puglia dialog adapts to the saved regional_service.
  //   spot_easy    → no in-dialog chooser; format pre-selected to 'ps'
  //   spot_online  → no in-dialog chooser; format pre-selected to 'summary'
  //                  (XML serializer lands in Phase 2; interim CSV until then)
  //   null/other   → the Round 58 chooser; on change it persists back to the
  //                  property so the next session skips the question.
  if(cfg.format==='puglia'){
    const svc=ctx.property&&ctx.property.regional_service;
    if(svc==='spot_easy'||svc==='spot_online'){
      const preset=svc==='spot_easy'?'ps':'summary';
      const label=svc==='spot_easy'?'SPOT Easy':'SPOT Online';
      dialog.querySelector('[data-variant]').innerHTML=`<input type="hidden" data-format value="${preset}"><div class="regional-field" data-saved-service><span>${E(text('Servizio salvato','Saved service'))}: <strong>${E(label)}</strong></span> <a href="#" data-h-link="prop_regional_service_change" data-change-service>${E(text('Cambia nei Dettagli Proprietà','Change in Property Details'))}</a></div>`;
    }else{
      dialog.querySelector('[data-variant]').innerHTML=`<label class="regional-field"><span>${E(text('Servizio usato dalla struttura','Service used by this property'))}</span><select class="form-select" data-format data-persist-service><option value="">${E(text('Seleziona','Choose'))}</option><option value="ps">SPOT Easy — ${E(text('locazione turistica','tourist rental'))}</option><option value="summary">SPOT Online / Completo — ${E(text('riepilogo manuale','manual summary'))}</option></select></label>`;
    }
  }
  if(cfg.format==='trentino')dialog.querySelector('[data-variant]').innerHTML=`<label class="regional-field"><span>${E(text('Tipo di servizio','Service type'))}</span><select class="form-select" data-format><option value="">${E(text('Seleziona','Choose'))}</option><option value="trento">STU — ${E(text('struttura con licenza','licensed accommodation'))}</option><option value="summary">DTU Alloggi — ${E(text('riepilogo manuale','manual summary'))}</option></select></label>`;
  const note=cfg.format==='puglia'?text('Il TXT PS vale per SPOT Easy delle locazioni turistiche. Abilita «Carica file PS» nel portale e completa la residenza dopo l’importazione. Per SPOT Online/Completo il tracciato XML è diverso.','PS TXT is for tourist rentals using SPOT Easy. Enable “Carica file PS” in the portal and complete residence after import. SPOT Online/Completo uses a different XML format.'):cfg.format==='trentino'?text('Il TXT STU usa l’IDOBJ dell’esercizio e un file per giorno con movimenti. Verifica con l’APT l’abilitazione del gestionale all’importazione. Questo tracciato non è quello di DTU Alloggi.','STU TXT uses the property IDOBJ and one file per day with arrivals/departures. Confirm management-software import approval with the APT. This is not the DTU Alloggi format.'):reason(cfg);
  dialog.querySelector('[data-mode-note]').textContent=note;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('click',async e=>{if(e.target.closest('[data-close]'))close();else if(e.target.closest('[data-load]'))await load();else if(e.target.closest('[data-apply]'))applyDaily();else if(e.target.closest('[data-download]'))download();});
  dialog.addEventListener('input',edit);
  document.body.appendChild(dialog);dialog.showModal();
 }
 const status=message=>{if(dialog)dialog.querySelector('[data-status]').textContent=message;};
 const stale=token=>!dialog||token!==epoch||context().propertyId!==activeProperty;
 async function load(){
  if(busy)return;const token=++epoch,ctx=context(),start=dialog.querySelector('[data-field=start]').value,end=dialog.querySelector('[data-field=end]').value,cfg=config();
  let period;try{period=R.days(start,end);if(end>today())throw Error('future');}catch(_){status(text('Scegli un periodo valido, senza date future (massimo un anno).','Choose a valid period without future dates (up to one year).'));return;}
  const format=dialog.querySelector('[data-format]')?.value||cfg.format;
  if(['puglia','trentino'].includes(format)){status(text('Seleziona il servizio regionale.','Choose the regional service.'));return;}
  model=null;dialog.querySelector('[data-review]').innerHTML='';busy=true;dialog.querySelector('[data-load]').disabled=true;status(text('Caricamento…','Loading…'));
  try{
   const rows=[];let offset=0;
   // Round 60 Phase 5 — pull room_id into the fetch so the daily
   // occupied prefill below can count DISTINCT rooms with an active
   // stay (per the PLAN: "never from guest counts"). Adding a column
   // to the select is byte-neutral for a no-rooms property because
   // every row's room_id is null; the existing summary CSV / native
   // formats never read room_id (regional-exports.test.mjs stays
   // byte-identical for the no-rooms canary).
   while(true){const {data,error}=await ctx.sb.from('checkins').select('id,property_id,is_test,deleted_at,submitted_at,booking_code,guest_type,name,surname,sex,date_of_birth,citizenship,birth_country,birth_province,place_of_birth,residence_country,residence_place,arrival_date,departure_date,nights,document_type,document_number,doc_issue_place,room_id').eq('property_id',activeProperty).eq('is_test',false).is('deleted_at',null).order('id',{ascending:true}).range(offset,offset+499);
    if(stale(token))return;if(error)throw Error(error.message);if(!Array.isArray(data))throw Error('Invalid response');rows.push(...data);if(data.length<500)break;offset+=500;if(offset>=100000)throw Error(text('Troppi dati: esportazione interrotta.','Too many records: export stopped.'));
   }
   const relevant=R.scope(rows,ctx.propertyId).filter(r=>!R.validDate(String(r.arrival_date||'').split('T')[0])||!R.validDate(String(r.departure_date||'').split('T')[0])||R.overlap(r,start,end));
   // Round 60 Phase 5 — room-aware prefills.
   // When the property has rooms:
   //   * rooms_available defaults to the active room count (host can edit)
   //   * beds_available defaults to the sum of per-room beds (host can edit)
   //   * per-day `occupied` defaults to the count of DISTINCT rooms with
   //     an active stay on that date, derived from room assignments
   //     (not guest counts, per the PLAN).
   // When the property has NO rooms, every default falls back to the
   // host-entered property field (ctx.property.rooms_available /
   // beds_available) and the pre-Round-60 "guests present? host must
   // fill in : 0" logic.
   const roomList=Array.isArray(ctx.rooms)?ctx.rooms:[];
   const hasRooms=roomList.length>0;
   const roomsDefault=hasRooms?roomList.length:(ctx.property.rooms_available??'');
   const bedsDefault=hasRooms?roomList.reduce((s,r)=>s+Math.max(1,Number(r.beds)||1),0):(ctx.property.beds_available??'');
   const occupiedForDate=date=>{
    const present=relevant.filter(r=>!r.deleted_at&&r.submitted_at&&R.overlap(r,date,date));
    if(hasRooms){
     const roomIds=new Set();for(const r of present)if(r.room_id)roomIds.add(r.room_id);
     return roomIds.size;
    }
    return R.counts(relevant,date).present?'':0;
   };
   model={pending:rows.filter(r=>r.property_id===ctx.propertyId&&r.is_test===false&&!r.deleted_at&&!r.submitted_at&&R.overlap(r,start,end)).length,property:{...ctx.property,id:ctx.propertyId},contextRows:rows,rows:relevant.map(r=>({...r})),rooms:roomList,start,end,daily:Object.fromEntries(period.map(date=>[date,{open:'',rooms:roomsDefault,beds:bedsDefault,occupied:occupiedForDate(date)}])),format,allog,code:format==='ross'?(ctx.property.ross1000_codice||''):''};
   status('');paintReview();
  }catch(error){if(!stale(token))status(text('Caricamento fallito: ','Load failed: ')+error.message);}finally{if(!stale(token)){busy=false;dialog.querySelector('[data-load]').disabled=false;}}
 }
 function fieldLabel(key){return ({structure_code:text('Codice struttura','Structure code'),residence_country:text('Stato di residenza','Country of residence'),residence_place:text('Comune / città di residenza','Comune / city of residence'),date_of_birth:text('Data di nascita','Date of birth'),citizenship:text('Cittadinanza','Citizenship'),birth_country:text('Stato di nascita','Country of birth'),place_of_birth:text('Comune di nascita','Comune of birth'),birth_province:text('Provincia di nascita','Province of birth'),sex:text('Sesso (M/F)','Sex (M/F)'),guest_type:text('Tipo ospite','Guest type'),stay_dates:text('Date soggiorno','Stay dates'),provenance:text('Provenienza statistica','Statistical provenance'),name:text('Nome','First name'),surname:text('Cognome','Surname'),document_type:text('Tipo documento','Document type'),document_number:text('Numero documento','Document number'),doc_issue_place:text('Luogo rilascio documento','Document issue place')})[key]||key;}
 function paintReview(){
  const period=R.days(model.start,model.end),fields=['residence_country','residence_place'];
  if(['ross','ps'].includes(model.format))fields.push('date_of_birth','sex','citizenship','birth_country','place_of_birth');
  if(model.format==='ps'){fields.splice(0,2);fields.push('name','surname','birth_province','document_type','document_number','doc_issue_place');}
  const activeRows=()=>model.rows.filter(r=>!r._excluded);
  const html=`${model.pending?'<p role="status">'+E(text('Check-in non completati nel periodo: ','Incomplete check-ins in the period: ')+model.pending+text('. Questi ospiti non sono inclusi. Completa i dati prima di esportare.','. These guests are excluded. Complete their details before exporting.'))+'</p>':''}${model.format==='ross'?'<p>'+E(text('Se ci sono partenze di ospiti arrivati prima del periodo, verifica che gli arrivi siano già registrati nel portale; altrimenti amplia il periodo.','For guests arriving before this period, check their arrivals are already recorded in the portal; otherwise extend the period.'))+'</p>':''}<p class="regional-note">${E(text('Solo check-in inviati dagli ospiti, inclusi quelli già comunicati ad Alloggiati. Le correzioni qui valgono solo per questo download.','Only submitted guest check-ins, including those already filed with Alloggiati. Corrections here apply only to this download.'))}</p>${['ross','trento'].includes(model.format)?input('code',model.format==='trento'?'IDOBJ STU':fieldLabel('structure_code'),model.code):''}<details><summary>${E(text('Controlla ospiti e residenza','Review guests and residence'))} (${model.rows.length})</summary><div class="regional-guests">${model.rows.map((r,i)=>`<details data-guest="${i}"><summary>${E((r.surname||'')+' '+(r.name||''))} · ${E(r.arrival_date)} → ${E(r.departure_date)}</summary><label><input type="checkbox" data-include="${i}" checked> ${E(text('Includi nel download','Include in download'))}</label><div class="regional-grid">${fields.map(k=>`<label class="regional-field"><span>${E(fieldLabel(k))}</span><input class="form-input" data-row="${i}" data-key="${k}" value="${E(r[k]||'')}" type="${k==='date_of_birth'?'date':'text'}" list="${k.includes('country')||k==='citizenship'?'wbnbCountryList':''}"></label>`).join('')}${['umbria','trento'].includes(model.format)?`<label class="regional-field"><span>${E(fieldLabel('provenance'))}</span><select class="form-select" data-row="${i}" data-key="_provenance"><option value="">${E(text('Da residenza (se riconosciuta)','From residence (if recognised)'))}</option>${R.provenanceOptions(model.format,allog).map(x=>`<option value="${E(x.code)}">${E(x.label)} (${E(x.code)})</option>`).join('')}</select></label>`:''}</div></details>`).join('')}</div></details>${model.format!=='ps'?`<h3>${E(text('Apertura e disponibilità giornaliera','Daily opening and availability'))}</h3><div class="regional-grid"><label class="regional-field">${E(text('Imposta tutte le giornate','Set all days'))}<select class="form-select" data-bulk-open><option value="">${E(text('Scegli','Choose'))}</option><option value="SI">${E(text('Aperto','Open'))}</option><option value="NO">${E(text('Chiuso','Closed'))}</option></select></label><label class="regional-field">${E(text('Unità occupate nelle notti con ospiti','Occupied units on nights with guests'))}<input class="form-input" type="number" min="0" data-bulk-occupied></label><button type="button" class="btn btn-secondary" data-apply>${E(text('Applica','Apply'))}</button></div><div class="regional-table-wrap"><table class="regional-days"><thead><tr>${[text('Data','Date'),text('Ospiti / notte','Guests / night'),text('Apertura','Opening'),text('Unità occupate','Occupied units'),text('Unità disponibili','Available units'),text('Letti disponibili','Available beds')].map(t=>'<th>'+E(t)+'</th>').join('')}</tr></thead><tbody>${period.map(date=>dayRow(date)).join('')}</tbody></table></div>`:''}<label class="regional-confirm"><input type="checkbox" data-confirm> ${E(text('Ho verificato ospiti, periodo e disponibilità. Non mancano ospiti da comunicare.','I reviewed the guests, period and availability. No guests to report are missing.'))}</label><p data-errors role="alert"></p><button type="button" class="btn btn-primary" data-download>${E(text('📥 Scarica ','📥 Download ')+({ross:'ROSS1000 XML',ps:'SPOT Easy TXT',umbria:period.length>1?'Turismatica ZIP':'Turismatica TXT',trento:period.length>1?'STU ZIP':'STU TXT',summary:text('riepilogo CSV','summary CSV')}[model.format]))}</button><p>${E(model.format==='summary'?text('Riepilogo di riferimento: non importarlo come file regionale.','Reference summary: do not upload this as a regional import file.'):text('Carica il file sul portale e controlla l’esito. Scaricare non significa aver comunicato i dati. I file ZIP vanno estratti: carica un TXT per giornata.','Upload to the portal and check the result. Downloading does not file the data. Extract ZIP files, then upload one TXT per day.'))}</p>`;
  dialog.querySelector('[data-review]').innerHTML=html;
 }
 function dayRow(date){const d=model.daily[date],c=R.counts(model.rows.filter(r=>!r._excluded),date);
  // Round 60 Phase 5 — when the property has rooms, warn on any day
  // where at least one present stay has no room_id. The occupied
  // prefill counted DISTINCT rooms, so an unassigned stay doesn't
  // bump the count and the host would be reporting fewer occupied
  // rooms than there are actual stays. Flag it with a small chip so
  // the host assigns the room before downloading.
  const hasRooms=Array.isArray(model.rooms)&&model.rooms.length>0;
  const present=model.rows.filter(r=>!r._excluded&&!r.deleted_at&&r.submitted_at&&R.overlap(r,date,date));
  const unassigned=hasRooms?present.filter(r=>!r.room_id).length:0;
  const flag=unassigned?` <span class="regional-unassigned-flag" title="${E(text('Ospiti presenti senza camera assegnata','Guests present without a room assigned'))}" style="color:#9a6b00;font-weight:600;">⚠ ${unassigned}</span>`:'';
  return `<tr${unassigned?' data-unassigned="1"':''}><th scope="row">${date}${flag}</th><td data-present="${date}">${c.present}</td><td><select class="form-select" data-date="${date}" data-day-key="open" aria-label="${E(text('Apertura','Opening'))} ${date}"><option value="">—</option><option value="SI" ${d.open==='SI'?'selected':''}>${E(text('Aperto','Open'))}</option><option value="NO" ${d.open==='NO'?'selected':''}>${E(text('Chiuso','Closed'))}</option></select></td>${['occupied','rooms','beds'].map(k=>`<td><input class="form-input" type="number" min="0" step="1" data-date="${date}" data-day-key="${k}" value="${E(d[k])}" aria-label="${E(k)} ${date}"></td>`).join('')}</tr>`;}
 function edit(event){if(!model)return;const t=event.target;
  if(t.dataset.row!==undefined){model.rows[Number(t.dataset.row)][t.dataset.key]=t.value;}
  if(t.dataset.include!==undefined){model.rows[Number(t.dataset.include)]._excluded=!t.checked;refreshDays();}
  if(t.dataset.dayKey){model.daily[t.dataset.date][t.dataset.dayKey]=t.value;if(t.dataset.dayKey==='open'&&t.value==='NO'){Object.assign(model.daily[t.dataset.date],{occupied:0,rooms:0,beds:0});refreshDays();}}
  if(t.dataset.field==='code')model.code=t.value.trim();
  if(t.dataset.field==='start'||t.dataset.field==='end'||t.hasAttribute('data-format')){
   // Round 61 Phase 1b — the Round 58 Puglia chooser persists back to
   // properties.regional_service so the next visit skips the question.
   // Fire-and-forget: a failed update is logged but doesn't block the
   // current download (the host can still finish this session).
   if(t.hasAttribute('data-persist-service')&&t.value){
    const ctx2=context(),svc=t.value==='ps'?'spot_easy':t.value==='summary'?'spot_online':null;
    if(svc&&ctx2.property&&ctx2.property.id&&ctx2.sb){
     ctx2.sb.from('properties').update({regional_service:svc}).eq('id',ctx2.property.id).then(({error})=>{
      if(error){console.error('[round61] regional_service persist failed',error);return;}
      ctx2.property.regional_service=svc;
     });
    }
   }
   model=null;dialog.querySelector('[data-review]').innerHTML='';status(text('Premi Prepara dati per il nuovo periodo o servizio.','Press Prepare data for the new period or service.'));return;}
  const confirm=dialog.querySelector('[data-confirm]');if(confirm&&t!==confirm)confirm.checked=false;
 }
 function refreshDays(){const tbody=dialog.querySelector('.regional-days tbody');if(tbody)tbody.innerHTML=R.days(model.start,model.end).map(dayRow).join('');}
 function applyDaily(){if(!model)return;const open=dialog.querySelector('[data-bulk-open]').value,occupied=dialog.querySelector('[data-bulk-occupied]').value;
  // Round 60 Phase 5 — same room-aware defaults as the initial load so
  // "Apply" after an open-day re-fill matches what the host would have
  // seen on load. For a no-rooms property these fall back to the
  // pre-Round-60 property fields exactly.
  const hasRooms=Array.isArray(model.rooms)&&model.rooms.length>0;
  const roomsDefault=hasRooms?model.rooms.length:(model.property.rooms_available??'');
  const bedsDefault=hasRooms?model.rooms.reduce((s,r)=>s+Math.max(1,Number(r.beds)||1),0):(model.property.beds_available??'');
  for(const [date,d]of Object.entries(model.daily)){if(open)d.open=open;if(d.open==='NO')Object.assign(d,{rooms:0,beds:0,occupied:0});else {if(d.rooms===''||Number(d.rooms)===0)d.rooms=roomsDefault;if(d.beds===''||Number(d.beds)===0)d.beds=bedsDefault;if(R.counts(model.rows.filter(r=>!r._excluded),date).present&&occupied!=='')d.occupied=occupied;}}
  refreshDays();dialog.querySelector('[data-confirm]').checked=false;
 }
 function download(){
  if(!model||context().propertyId!==activeProperty){close();return;}
  const errors=dialog.querySelector('[data-errors]');if(!dialog.querySelector('[data-confirm]').checked){errors.textContent=text('Conferma il controllo dei dati prima di scaricare.','Confirm your review before downloading.');return;}
  let result;try{result=R.generate(model);}catch(error){errors.textContent=text('Impossibile generare il file: ','Cannot generate file: ')+error.message;return;}
  if(result.errors.length){const codes={required:text('mancante o non riconosciuto','missing or unrecognised'),dates:text('data non valida','invalid date'),comune:text('comune non riconosciuto o ambiguo: indica la provincia, es. Castro (LE)','unrecognised or ambiguous comune: include province, e.g. Castro (LE)'),group:text('capofamiglia/capogruppo mancante, ambiguo o con arrivo diverso','family/group leader missing, ambiguous or with a different arrival'),opening:text('scegli aperto o chiuso','choose open or closed'),capacity:text('verifica unità, letti e occupazione','check units, beds and occupancy'),closed:text('giornata chiusa con ospiti o disponibilità','closed day with guests or availability'),provenance:text('seleziona una provenienza della tabella regionale','choose provenance from the regional table'),collision:text('identificativi duplicati: contatta assistenza','duplicate identifiers: contact support'),nights:text('permanenza oltre 99 notti: usa inserimento manuale','stay exceeds 99 nights: use manual entry'),ps_warning:text('il file PS segnala dati da correggere','PS file contains validation warnings'),empty:text('nessun arrivo nel periodo','no arrivals in this period')};
   errors.textContent=result.errors.slice(0,40).map(e=>{const row=model.rows.find(r=>r.id===e.id);return (row?`${row.surname||''} ${row.name||''}: `:'')+fieldLabel(e.field)+' — '+(codes[e.code]||e.code);}).join('\n')+(result.errors.length>40?'\n… +'+(result.errors.length-40):'');return;
  }
  if(!result.files.length){errors.textContent=text('Nessun movimento nel periodo: nessun file generato.','No arrivals or departures in the period: no file generated.');return;}
  errors.textContent='';const multiple=result.files.length>1,content=multiple?R.zip(result.files):result.files[0].content,type=multiple?'application/zip':result.files[0].type,name=multiple?model.format+'_'+model.start+'_'+model.end+'.zip':result.files[0].name;
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status(text('File scaricato. Nessun dato inviato al portale.','File downloaded. Nothing was sent to the portal.'));
 }
 return {render,open,close};
}
})();
