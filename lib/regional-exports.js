// Round 58. Pure regional routing/serializers. Sources: docs/REGIONAL_EXPORT_FORMATS.md.
(function(root){
'use strict';
const ROSS_SPEC='https://www.ross1000.it/source/tracciato-xml.pdf';
const regions={
 Abruzzo:{system:'ROSS1000',portal:'https://app.regione.abruzzo.it/Turismo5/'},
 Basilicata:{system:'ROSS1000 / SIST',portal:'https://sist-aptbasilicata.turitweb.it/'},
 Calabria:{system:'ROSS1000 / SIRDAT',portal:'https://sirdat.regione.calabria.it/'},
 'Emilia-Romagna':{system:'ROSS1000',portal:'https://datiturismo.regione.emilia-romagna.it/'},
 Lazio:{system:'ROSS1000',portal:'https://lazioturismo.ross1000.it/'},
 Liguria:{system:'ROSS1000',portal:'https://ross1000-spid.regione.liguria.it/'},
 Lombardia:{system:'ROSS1000',portal:'https://www.flussituristici.servizirl.it/Turismo5/app/'},
 Marche:{system:'Istrice / ROSS1000',portal:'https://istrice-ross1000.turismo.marche.it/'},
 Molise:{system:'ROSS1000',portal:'https://moliseturismo.ross1000.it/'},
 Piemonte:{system:'Piemonte Dati Turismo / ROSS1000',portal:'https://piemontedatiturismo.regione.piemonte.it/'},
 Sardegna:{system:'SIRED / ROSS1000',portal:'https://sardegnaturismo.ross1000.it/'},
 Veneto:{system:'ROSS1000',portal:'https://flussituristici.regione.veneto.it/'}
};
Object.values(regions).forEach(c=>Object.assign(c,{export:'ross1000',format:'ross',source:ROSS_SPEC,verified:true}));
Object.assign(regions,{
 Campania:{system:'Sinfonia Turismo SMART',portal:'https://turismo.regione.campania.it/turismoweb/fe-portale-turismo/home',format:'summary',reason:'api',source:'https://www.regione.campania.it/aree-tematiche/cultura-turismo/strutture-ricettive-locazioni-brevi/sinfonia-turismo-smart-sistema-monitoraggio-accoglienza-ricettivita-turistica'},
 'Friuli-Venezia Giulia':{system:'WebTur',portal:'https://servizistatistici.regione.fvg.it/webtur/jsp/wt/login_video.jsp',format:'summary',reason:'spec',source:'https://servizistatistici.regione.fvg.it/webtur/jsp/wt/login_video.jsp'},
 Puglia:{system:'SPOT / DMS Puglia',portal:'https://www.dms.puglia.it/',format:'puglia',source:'https://info.ect.regione.puglia.it/wp-content/uploads/2025/10/Manuale-di-utilizzo-di-SPOT-Easy_2025-vers.1_09_25.pdf'},
 Sicilia:{system:'Osservatorio Turistico / Turist@t',portal:'https://osservatorioturistico.regione.sicilia.it/',format:'summary',reason:'spec',source:'https://osservatorioturistico.regione.sicilia.it/public/info'},
 Toscana:{byProvince:Object.fromEntries(['048','100','047'].map(p=>[p,{system:'ROSS1000',portal:'https://toscanaturismo.ross1000.it/turismo5-web/',export:'ross1000',format:'ross',source:ROSS_SPEC,verified:true}])),fallback:{system:'MOTouristOffice / sistema di ambito',portal:'https://toscana.motouristoffice.it/',format:'summary',reason:'toscana',source:'https://toscana.motouristoffice.it/'}},
 Trentino:{system:'STU / DTU Alloggi',portal:'https://www.provincia.tn.it/Servizi/Comunicare-online-le-presenze-degli-ospiti-a-ISTAT-e-Pubblica-Sicurezza',format:'trentino',source:'https://www.provincia.tn.it/Amministrazione/Documenti/Manuale-e-documentazione'},
 'Alto Adige':{system:'ASTAT / LTS',portal:'https://astat.provincia.bz.it/it/turismo',format:'summary',reason:'lts',source:'https://astat.provincia.bz.it/it/turismo'},
 Umbria:{system:'Turismatica',portal:'https://turismatica.regione.umbria.it/',format:'umbria',source:'https://www.regione.umbria.it/turismo-attivita-sportive/turismatica-online'},
 "Valle d'Aosta":{system:'VIT / Locazioni turistiche',portal:'https://www.regione.vda.it/gestione/vit_albergatori',format:'summary',reason:'vit',source:'https://www.regione.vda.it/gestione/vit_albergatori/Docs/VIT%20Albergatori%20Manuale%20utente.pdf'}
});
function config(property,comuneCode){const c=regions[property?.region];if(!c)return null;if(!c.byProvince)return {...c};const p=String(comuneCode||'').slice(3,6);return {...(c.byProvince[p]||c.fallback),province:p||null};}
const esc=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const iso=v=>String(v||'').split('T')[0];
function validDate(v){try{return /^\d{4}-\d{2}-\d{2}$/.test(v)&&Number(v.slice(0,4))>=1900&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}catch(_){return false;}}
function days(start,end){if(!validDate(start)||!validDate(end)||end<start||(+new Date(end)-+new Date(start))/86400000>365)throw Error('period');const out=[];for(let d=start;d<=end;d=new Date(+new Date(d+'T00:00:00Z')+86400000).toISOString().slice(0,10))out.push(d);return out;}
const dmy=v=>v.slice(8,10)+v.slice(5,7)+v.slice(0,4);
const ymd=v=>v.replace(/-/g,'');
function idFor(row){let h=5381;for(const c of String(row.id))h=((h<<5)+h+c.charCodeAt(0))>>>0;return ('W'+h.toString(36)).slice(0,20).toUpperCase();} // Preserve previous Veneto IDs.
function scope(rows,propertyId){const seen=new Set();return rows.filter(r=>{if(r.property_id!==propertyId||r.is_test!==false||r.deleted_at||!r.submitted_at||seen.has(r.id))return false;seen.add(r.id);return true;});}
function overlap(row,start,end){return iso(row.arrival_date)<=end&&iso(row.departure_date)>=start;}
function counts(rows,date){return {previous:rows.filter(r=>iso(r.arrival_date)<date&&iso(r.departure_date)>=date).length,arrivals:rows.filter(r=>iso(r.arrival_date)===date).length,departures:rows.filter(r=>iso(r.departure_date)===date).length,present:rows.filter(r=>iso(r.arrival_date)<=date&&iso(r.departure_date)>date).length};}
const primary=new Set(['single','head','group']);
function groups(rows,allog){const out=new Map();for(const r of rows){if(!r.booking_code)continue;const key=r.booking_code;const group=out.get(key)||[];group.push(r);out.set(key,group);}return out;}
function country(raw,allog){if(!raw)return '';const code=String(raw).trim();if(/^\d{9}$/.test(code)&&Object.values(allog.STATI).includes(code))return code;return allog.lookupStateCode(raw).trim();}
const comuneCache=new WeakMap();
function comuni(allog){if(!comuneCache.has(allog))comuneCache.set(allog,allog.COMUNI_COMPACT.split('|').map(x=>x.split(';')));return comuneCache.get(allog);}
function comune(raw,allog,provinceHint){
 const v=String(raw||'').trim(),entries=comuni(allog);
 if(/^\d{9}$/.test(v))return entries.some(x=>x[1]===v)?v:'';
 const suffix=v.match(/(?:\(\s*([A-Za-z]{2})\s*\)|,\s*([A-Za-z]{2}))$/),p=String(suffix?.[1]||suffix?.[2]||provinceHint||'').toUpperCase().trim();
 const key=allog._normKey(suffix?v.slice(0,suffix.index):v),matches=entries.filter(x=>allog._normKey(x[0])===key&&(!p||x[2]===p));
 const codes=[...new Set(matches.map(x=>x[1]))];return codes.length===1?codes[0]:'';
}
function province(row,allog){const code=comune(row.residence_place,allog);return comuni(allog).find(x=>x[1]===code)?.[2]||'';}
// Official Umbria and Trento provenance codes; unknown values require an explicit host choice.
const provenanceNames={"AG": "AGRIGENTO", "AL": "ALESSANDRIA", "230": "ALTRI PAESI AFRICA MEDITERRANEA", "621": "ALTRI PAESI ASIA OCCIDENTALE", "521": "ALTRI PAESI CENTRO-SUD AMERICA", "300": "ALTRI PAESI DELL'AFRICA", "760": "ALTRI PAESI DELL'ASIA", "427": "ALTRI PAESI EUROPEI", "410": "ALTRI PAESI O TERRITORI NORD-AMERICANI", "810": "ALTRI PAESI O TERRITORI OCEANIA", "AN": "ANCONA", "AO": "AOSTA", "AR": "AREZZO", "518": "ARGENTINA", "AP": "ASCOLI PICENO", "AT": "ASTI", "615": "AUSTRALIA", "A": "AUSTRIA", "AV": "AVELLINO", "BA": "BARI", "BT": "BARLETTA-ANDRIA-TRANI", "B": "BELGIO", "BL": "BELLUNO", "BN": "BENEVENTO", "BG": "BERGAMO", "BI": "BIELLA", "BO": "BOLOGNA", "BZ": "BOLZANO", "515": "BRASILE", "BS": "BRESCIA", "BR": "BRINDISI", "068": "BULGARIA", "CA": "CAGLIARI", "CL": "CALTANISSETTA", "CB": "CAMPOBASSO", "503": "CANADA", "CI": "CARBONIA-IGLESIAS", "CE": "CASERTA", "CT": "CATANIA", "CZ": "CATANZARO", "CH": "SVIZZERA", "720": "CINA", "600": "CIPRO", "CO": "COMO", "728": "COREA DEL SUD", "CS": "COSENZA", "CR": "CREMONA", "992": "CROAZIA", "KR": "CROTONE", "CN": "CUNEO", "DK": "DANIMARCA", "603": "EGITTO", "EN": "ENNA", "053": "ESTONIA", "FM": "FERMO", "FE": "FERRARA", "209": "FINLANDIA", "FI": "FIRENZE", "FG": "FOGGIA", "FC": "FORLI'-CESENA", "F": "FRANCIA", "FR": "FROSINONE", "GE": "GENOVA", "D": "GERMANIA", "JAP": "GIAPPONE", "GO": "GORIZIA", "GB": "GRAN BRETAGNA", "312": "GRECIA", "GR": "GROSSETO", "IM": "IMPERIA", "664": "INDIA", "121": "IRLANDA", "IS": "ISERNIA", "924": "ISLANDA", "612": "ISRAELE", "SP": "LA SPEZIA", "AQ": "L'AQUILA", "LT": "LATINA", "LE": "LECCE", "LC": "LECCO", "054": "LETTONIA", "055": "LITUANIA", "LI": "LIVORNO", "LO": "LODI", "LU": "LUCCA", "L": "LUSSEMBURGO", "MC": "MACERATA", "046": "MALTA", "MN": "MANTOVA", "MS": "MASSA CARRARA", "MT": "MATERA", "VS": "MEDIO CAMPIDANO", "509": "MESSICO", "ME": "MESSINA", "MI": "MILANO", "MO": "MODENA", "MB": "MONZA E DELLA BRIANZA", "NA": "NAPOLI", "777": "NON SPECIFICATO", "N": "NORVEGIA", "NO": "NOVARA", "NU": "NUORO", "804": "NUOVA ZELANDA", "OG": "OGLIASTRA", "OT": "OLBIA-TEMPIO", "OR": "ORISTANO", "PD": "PADOVA", "NL": "PAESI BASSI", "PA": "PALERMO", "PR": "PARMA", "PV": "PAVIA", "PG": "PERUGIA", "PU": "PESARO E URBINO", "PE": "PESCARA", "PC": "PIACENZA", "PI": "PISA", "PT": "PISTOIA", "960": "POLONIA", "PN": "PORDENONE", "303": "PORTOGALLO", "PZ": "POTENZA", "PO": "PRATO", "RG": "RAGUSA", "RA": "RAVENNA", "RC": "REGGIO CALABRIA", "RE": "REGGIO EMILIA", "961": "REPUBBLICA CECA", "RI": "RIETI", "RN": "RIMINI", "RM": "ROMA", "066": "ROMANIA", "RO": "ROVIGO", "975": "RUSSIA", "SA": "SALERNO", "SS": "SASSARI", "SV": "SAVONA", "SI": "SIENA", "SR": "SIRACUSA", "963": "SLOVACCHIA", "991": "SLOVENIA", "SO": "SONDRIO", "E": "SPAGNA", "606": "SUD AFRICA", "S": "SVEZIA", "TA": "TARANTO", "TE": "TERAMO", "TR": "TERNI", "TO": "TORINO", "TP": "TRAPANI", "TN": "TRENTO", "TV": "TREVISO", "TS": "TRIESTE", "315": "TURCHIA", "072": "UCRAINA", "UD": "UDINE", "964": "UNGHERIA", "USA": "US AMERICA", "VA": "VARESE", "VE": "VENEZIA", "512": "VENEZUELA", "VB": "VERBANIA", "VC": "VERCELLI", "VR": "VERONA", "VV": "VIBO VALENTIA", "VI": "VICENZA", "VT": "VITERBO"};
const major=[
 ['ARGENTINA','518','*RA'],['AUSTRALIA','615','AUS'],['AUSTRIA','A','A'],['BELGIO','B','B'],['BRASILE','515','*BR'],['BULGARIA','068','*BG'],['CANADA','503','CDN'],['CINA','720','CIN'],['CIPRO','600','CY'],['COREA DEL SUD','728','ROK'],['CROAZIA','992','HR'],['DANIMARCA','DK','DK'],['EGITTO','603','ET'],['ESTONIA','053','*ES'],['FINLANDIA','209','SF'],['FRANCIA','F','F'],['GERMANIA','D','D'],['GIAPPONE','JAP','J'],['REGNO UNITO','GB','GB'],['GRECIA','312','*GR'],['INDIA','664','IND'],['IRLANDA','121','EIR'],['ISLANDA','924','*IS'],['ISRAELE','612',null],['LETTONIA','054','*LT'],['LITUANIA','055','*LI'],['LUSSEMBURGO','L','L'],['MALTA','046','M'],['MESSICO','509','MEX'],['NORVEGIA','N','N'],['NUOVA ZELANDA','804','NZ'],['PAESI BASSI','NL','NL'],['POLONIA','960','PL'],['PORTOGALLO','303','P'],['REPUBBLICA CECA','961','*CZ'],['ROMANIA','066','R'],['RUSSIA','975','RS'],['SLOVACCHIA','963','SK'],['SLOVENIA','991','*SL'],['SPAGNA','E','E'],['STATI UNITI D\'AMERICA','USA','USA'],['SUD AFRICA','606','ZA'],['SVEZIA','S','S'],['SVIZZERA','CH','*CH'],['TURCHIA','315','*TR'],['UCRAINA','072','UA'],['UNGHERIA','964','H'],['VENEZUELA','512','YV'],['ALBANIA',null,'*AL'],['SAN MARINO',null,'RSM']
];
const aggregates=[['230','AAM','Altri Paesi Africa mediterranea'],['621','K','Altri Paesi Asia occidentale'],['521','W','Altri Paesi Centro-Sud America'],['300','AA','Altri Paesi dell’Africa'],['760','Q','Altri Paesi dell’Asia'],['427','Y','Altri Paesi europei'],['410','ANA','Altri Paesi o territori Nord America'],['810','ATO','Altri Paesi o territori Oceania']];
function provenanceOptions(format,allog){const index=format==='trento'?2:1;return major.filter(x=>x[index]).map(x=>({code:x[index],label:x[0]})).concat(aggregates.map(x=>({code:x[format==='trento'?1:0],label:x[2]}))).concat(format==='umbria'?[{code:'777',label:'Non specificato'}]:[]);}
function provenance(row,format,allog){const c=country(row.residence_country,allog);if(c==='100000100'){const p=province(row,allog);return format==='umbria'&&!provenanceNames[p]?'':p;}if(row._provenance&&provenanceOptions(format,allog).some(x=>x.code===row._provenance))return row._provenance;const match=major.find(x=>country(x[0],allog)===c&&c);return match?.[format==='trento'?2:1]||'';}
function issue(id,field,code='required'){return {id,field,code};}
function validate({property,rows,contextRows,start,end,daily,format,allog,code}){
 const errors=[],period=days(start,end),selected=scope(rows,property.id),relevant=selected.filter(r=>!r._excluded&&((format==='ps' ? iso(r.arrival_date)>=start&&iso(r.arrival_date)<=end : overlap(r,start,end))||!validDate(iso(r.arrival_date))||!validDate(iso(r.departure_date))));
 if(format==='ross'&&!String(code||property.ross1000_codice||'').trim())errors.push(issue(null,'structure_code'));
 if(format==='trento'&&!/^[A-Za-z0-9]{1,10}$/.test(code||''))errors.push(issue(null,'structure_code','code'));
 const excluded=new Set(selected.filter(r=>r._excluded).map(r=>r.id)),context=scope(contextRows||rows,property.id).filter(r=>!excluded.has(r.id));
 const grouped=groups(context,allog),ids=new Map();
 for(const r of relevant){
  const arr=iso(r.arrival_date),dep=iso(r.departure_date);
  if(!r.id)errors.push(issue(null,'id'));
  if(!validDate(arr)||!validDate(dep)||dep<=arr)errors.push(issue(r.id,'stay_dates','dates'));
  if(format!=='ps'){
   const res=country(r.residence_country,allog);if(!res)errors.push(issue(r.id,'residence_country'));
   if(res==='100000100'&&!comune(r.residence_place,allog))errors.push(issue(r.id,'residence_place','comune'));
   if(['umbria','trento'].includes(format)&&!provenance(r,format,allog))errors.push(issue(r.id,'provenance','provenance'));
  }
  if(format==='ross'||format==='ps'){
   if(!allog.GUEST_TYPE_CODES[r.guest_type])errors.push(issue(r.id,'guest_type'));
   if(!['M','F'].includes(r.sex))errors.push(issue(r.id,'sex'));
   if(!validDate(iso(r.date_of_birth))||iso(r.date_of_birth)>arr)errors.push(issue(r.id,'date_of_birth','dates'));
   if(!country(r.citizenship,allog))errors.push(issue(r.id,'citizenship'));
   if(format==='ps'||r.birth_country){const bc=country(r.birth_country,allog);if(!bc)errors.push(issue(r.id,'birth_country'));if(bc==='100000100'&&!comune(r.place_of_birth,allog,r.birth_province))errors.push(issue(r.id,'place_of_birth','comune'));}
   const id=idFor(r);if(ids.has(id)&&ids.get(id)!==r.id)errors.push(issue(r.id,'id','collision'));ids.set(id,r.id);
   const g=grouped.get(r.booking_code)||[],heads=g.filter(x=>x.guest_type===(r.guest_type==='member'?'head':'group'));
   if(!primary.has(r.guest_type)&&(heads.length!==1||iso(heads[0].arrival_date)!==arr))errors.push(issue(r.id,'guest_type','group'));
   if(format==='ps'){
    if(!r.name?.trim())errors.push(issue(r.id,'name'));if(!r.surname?.trim())errors.push(issue(r.id,'surname'));
    if((+new Date(dep)-+new Date(arr))/86400000>99)errors.push(issue(r.id,'stay_dates','nights'));
    if(primary.has(r.guest_type)){
     if(!r.document_number?.trim())errors.push(issue(r.id,'document_number'));
     if(!allog.lookupDocCode(r.document_type).trim())errors.push(issue(r.id,'document_type'));
     if(!comune(r.doc_issue_place,allog)&&!country(r.doc_issue_place,allog))errors.push(issue(r.id,'doc_issue_place'));
    }
   }
  }
 }
 if(format!=='ps')for(const date of period){const day=daily?.[date],c=counts(relevant,date);if(!day||!['SI','NO'].includes(day.open)){errors.push(issue(null,date,'opening'));continue;}
  if(!['rooms','beds','occupied'].every(k=>day[k]!==''&&Number.isInteger(Number(day[k]))&&Number(day[k])>=0))errors.push(issue(null,date,'capacity'));
  else if(day.open==='NO'&&(c.present||Number(day.rooms)||Number(day.beds)||Number(day.occupied)))errors.push(issue(null,date,'closed'));
  else if(day.open==='SI'&&(!Number(day.rooms)||!Number(day.beds)||Number(day.occupied)>Number(day.rooms)||c.present>Number(day.beds)||(c.present>0&&Number(day.occupied)===0)||(c.present===0&&Number(day.occupied)!==0)))errors.push(issue(null,date,'capacity'));
 }
 return {errors,rows:relevant,allRows:context,period};
}
function arrival(r,allRows,allog){const type=allog.GUEST_TYPE_CODES[r.guest_type],head=allRows.find(h=>h.booking_code===r.booking_code&&h.guest_type===(r.guest_type==='member'?'head':'group'));
 const bc=country(r.birth_country,allog),res=country(r.residence_country,allog);
 const fields={idswh:idFor(r),tipoalloggiato:type,idcapo:['19','20'].includes(type)?idFor(head):'',sesso:r.sex,cittadinanza:country(r.citizenship,allog),statoresidenza:res,luogoresidenza:res==='100000100'?comune(r.residence_place,allog):String(r.residence_place||'').slice(0,30),datanascita:ymd(iso(r.date_of_birth)),statonascita:bc,comunenascita:bc==='100000100'?comune(r.place_of_birth,allog,r.birth_province):'',tipoturismo:'Non specificato',mezzotrasporto:'Non Specificato',canaleprenotazione:'Non specificato',titolostudio:'',professione:'',esenzioneimposta:''};
 return '<arrivo>'+Object.entries(fields).map(([k,v])=>`<${k}>${esc(v)}</${k}>`).join('')+'</arrivo>';
}
function xml({property,rows,allRows,period,daily,allog,code}){return '<?xml version="1.0" encoding="UTF-8"?>\n<movimenti><codice>'+esc(code||property.ross1000_codice)+'</codice><prodotto>WelcomeBnB</prodotto>'+period.map(date=>{
 const d=daily[date],arr=rows.filter(r=>iso(r.arrival_date)===date).sort((a,b)=>Number(!primary.has(a.guest_type))-Number(!primary.has(b.guest_type))||String(a.id).localeCompare(String(b.id))),dep=rows.filter(r=>iso(r.departure_date)===date);
 return '<movimento><data>'+ymd(date)+'</data><struttura><apertura>'+d.open+'</apertura><camereoccupate>'+Number(d.occupied)+'</camereoccupate><cameredisponibili>'+Number(d.rooms)+'</cameredisponibili><lettidisponibili>'+Number(d.beds)+'</lettidisponibili></struttura>'+(arr.length?'<arrivi>'+arr.map(r=>arrival(r,allRows,allog)).join('')+'</arrivi>':'')+(dep.length?'<partenze>'+dep.map(r=>`<partenza><idswh>${idFor(r)}</idswh><tipoalloggiato>${allog.GUEST_TYPE_CODES[r.guest_type]}</tipoalloggiato><arrivo>${ymd(iso(r.arrival_date))}</arrivo></partenza>`).join('')+'</partenze>':'')+'</movimento>';
}).join('\n')+'</movimenti>\n';}
function aggregatesFor(rows,date,format,allog){const out=new Map();for(const r of rows){const a=iso(r.arrival_date)===date,d=iso(r.departure_date)===date;if(!a&&!d)continue;const p=provenance(r,format,allog),italian=country(r.residence_country,allog)==='100000100',label=italian?(p==='CH'?'CHIETI':provenanceNames[p]||p):(provenanceOptions(format,allog).find(x=>x.code===p)?.label||p),key=p+'|'+label;const v=out.get(key)||{code:p,label,arrivals:0,departures:0};v.arrivals+=Number(a);v.departures+=Number(d);out.set(key,v);}return [...out.values()].sort((a,b)=>a.code.localeCompare(b.code));}
const ascii=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ');
function umbriaFile({property,rows,date,daily,allog}){const n=counts(rows,date),labels=provenanceOptions('umbria',allog),pad=(s,width)=>ascii(s).slice(0,width).padEnd(width),num=(s,n)=>String(s).padStart(n);
 const lines=[ascii(property.name||'').slice(0,255),'',pad('Presenti notte precedente',27)+num(n.previous,5),pad('Arrivati',27)+num(n.arrivals,5),pad('Totale',27)+num(n.previous+n.arrivals,5),pad('Partiti',27)+num(n.departures,5),pad('Presenti nella notte',27)+num(n.present,5),pad('CAMERE OCCUPATE=',16)+num(Number(daily[date].occupied),3),pad('ARRIVATI E PARTITI DEL GIORNO',30)+date.slice(8)+'-'+date.slice(5,7)+'-'+date.slice(0,4),'','Provenienza |ARR. |PAR. |'];
 for(const a of aggregatesFor(rows,date,'umbria',allog)){const label=a.label;lines.push(pad(a.code,5)+'|'+pad(label,35)+'|'+num(a.arrivals,5)+'|'+num(a.departures,5)+'|');}
 return lines.join('\r\n')+'\r\n';}
function trentoFile({rows,date,daily,allog,code}){return ',u_abitative,'+Number(daily[date].occupied)+'\r\n'+aggregatesFor(rows,date,'trento',allog).map(a=>','+code+','+dmy(date)+','+a.code+','+a.arrivals+','+a.departures).join('\r\n')+'\r\n';}
const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
function summary({rows,period,daily,allog}){const lines=[['reference_only_not_a_portal_import','date','residence_country_code','italian_residence_province','arrivals','departures','guest_nights','open','occupied_units','available_units','available_beds']];
 for(const date of period){const groups=new Map();for(const r of rows){if(!overlap(r,date,date))continue;const c=country(r.residence_country,allog),p=c==='100000100'?province(r,allog):'';const key=c+'|'+p;const a=groups.get(key)||{c,p,arr:0,dep:0,nights:0};a.arr+=Number(iso(r.arrival_date)===date);a.dep+=Number(iso(r.departure_date)===date);a.nights+=Number(iso(r.arrival_date)<=date&&iso(r.departure_date)>date);groups.set(key,a);}
 if(!groups.size)groups.set('',{c:'',p:'',arr:0,dep:0,nights:0});for(const g of groups.values()){const d=daily[date];lines.push(['REFERENCE ONLY',date,g.c,g.p,g.arr,g.dep,g.nights,d.open,d.occupied,d.rooms,d.beds]);}}
 return '\ufeff'+lines.map(r=>r.map(csv).join(',')).join('\r\n')+'\r\n';}
// SPOT Easy explicitly accepts the PS fixed-width layout. Resolve every location
// strictly here; the national serializer's legacy fallbacks are not appropriate.
function psLines(rows,allog){
 const grouped=new Map();for(const r of rows){const key=r.booking_code||r.id;const g=grouped.get(key)||[];g.push(r);grouped.set(key,g);}
 return [...grouped.values()].flatMap(g=>g.sort((a,b)=>Number(!primary.has(a.guest_type))-Number(!primary.has(b.guest_type))).map(r=>{
  const bc=country(r.birth_country,allog),birth=bc==='100000100'?comune(r.place_of_birth,allog,r.birth_province):'',prov=birth?comuni(allog).find(x=>x[1]===birth)[2]:'',doc=primary.has(r.guest_type),nights=(+new Date(iso(r.departure_date))-+new Date(iso(r.arrival_date)))/86400000;
  return allog.GUEST_TYPE_CODES[r.guest_type]+allog.fmtDateIT(r.arrival_date)+allog.padNum(nights,2)+allog.pad(allog.sanitizeAllogName(r.surname),50)+allog.pad(allog.sanitizeAllogName(r.name),30)+(r.sex==='F'?'2':'1')+allog.fmtDateIT(r.date_of_birth)+allog.pad(birth,9)+allog.pad(prov,2)+bc+country(r.citizenship,allog)+(doc?allog.lookupDocCode(r.document_type):'     ')+allog.pad(doc?r.document_number.toUpperCase():'',20)+allog.pad(doc?(comune(r.doc_issue_place,allog)||country(r.doc_issue_place,allog)):'',9);
 }));
}
// Round 61. Official SPOT Online v1.0 + XSD 0.6; sources in docs/spot/README.md.
// XSD SiNoType requires lowercase "si", including the separate-head attribute.
function spotAge(row){const dob=iso(row.date_of_birth),date=iso(row.arrival_date);return Number(date.slice(0,4))-Number(dob.slice(0,4))-Number(date.slice(5)<dob.slice(5));}
function spotHead(row,rows){return rows.filter(h=>h.booking_code&&h.booking_code===row.booking_code&&iso(h.arrival_date)===iso(row.arrival_date)&&h.guest_type===(row.guest_type==='member'?'head':'group'));}
function spotMembers(head,rows){return rows.filter(r=>r.booking_code&&r.booking_code===head.booking_code&&iso(r.arrival_date)===iso(head.arrival_date)&&r.guest_type===(head.guest_type==='head'?'member':'group_member'));}
function spotValidate(input){
 const {property,start,end,daily,allog}=input,errors=[];
 let period;try{period=days(start,end);}catch(_){return {errors:[issue(null,'period','dates')],rows:[],period:[]};}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(end>today)errors.push(issue(null,'period','future'));
 if(property.region!=='Puglia'||property.regional_service!=='spot_online')errors.push(issue(null,'regional_service','service'));
 if(input.startup!==undefined&&typeof input.startup!=='boolean')errors.push(issue(null,'startup'));
 const selected=scope(input.rows,property.id),excluded=new Set(selected.filter(r=>r._excluded).map(r=>r.id));
 const context=scope(input.contextRows||input.rows,property.id).filter(r=>!excluded.has(r.id)&&!r._excluded);
 const rows=selected.filter(r=>!r._excluded&&(overlap(r,start,end)||!validDate(iso(r.arrival_date))||!validDate(iso(r.departure_date))));
 const ids=new Map();
 for(const r of rows){
  const arr=iso(r.arrival_date),dep=iso(r.departure_date),dob=iso(r.date_of_birth);
  if(!r.id)errors.push(issue(r.id,'id'));
  if(!validDate(arr)||!validDate(dep)||dep<=arr)errors.push(issue(r.id,'stay_dates','dates'));
  if(!validDate(dob)||dob>arr)errors.push(issue(r.id,'date_of_birth','dates'));
  if(!['M','F'].includes(r.sex))errors.push(issue(r.id,'sex'));
  if(!country(r.citizenship,allog))errors.push(issue(r.id,'citizenship'));
  const res=country(r.residence_country,allog);if(!res)errors.push(issue(r.id,'residence_country'));
  if(res==='100000100'&&!comune(r.residence_place,allog))errors.push(issue(r.id,'residence_place','comune'));
  if(!['si','no'].includes(r._bedOccupancy))errors.push(issue(r.id,'_bedOccupancy'));
  if(!['single','head','group','member','group_member'].includes(r.guest_type))errors.push(issue(r.id,'guest_type'));
  if(['member','group_member'].includes(r.guest_type)){
   const heads=spotHead(r,context);if(heads.length!==1||(arr>=start&&!rows.some(h=>h.id===heads[0]?.id)))errors.push(issue(r.id,'guest_type','group'));
   // A startup snapshot cannot invent a head who has already left.
   else if(input.startup&&arr<start&&dep>=start&&iso(heads[0].departure_date)<start)errors.push(issue(r.id,'startup','group'));
  }
  if(['head','group'].includes(r.guest_type)){
   if(!r.booking_code||!spotMembers(r,context).length||context.filter(h=>h.booking_code===r.booking_code&&h.guest_type===r.guest_type&&iso(h.arrival_date)===arr).length!==1)errors.push(issue(r.id,'guest_type','group'));
   if(input.startup&&arr<start&&dep>=start&&!spotMembers(r,rows).some(m=>iso(m.departure_date)>=start))errors.push(issue(r.id,'startup','group'));
  }
  const id=idFor(r);if(ids.has(id)&&ids.get(id)!==r.id)errors.push(issue(r.id,'id','collision'));ids.set(id,r.id);
 }
 // Context may include an excluded/missing group head; never use it to emit an unreviewed guest.
 for(const date of period){
  const d=daily?.[date],present=rows.filter(r=>iso(r.arrival_date)<=date&&iso(r.departure_date)>date),previous=rows.filter(r=>iso(r.arrival_date)<date&&iso(r.departure_date)>=date),c=counts(rows,date);
  if(!d||!['SI','NO'].includes(d.open)){errors.push(issue(null,date,'opening'));continue;}
  if(!['rooms','beds','occupied'].every(k=>d[k]!==''&&d[k]!==null&&typeof d[k]!=='boolean'&&Number.isInteger(Number(d[k]))&&Number(d[k])>=0)){errors.push(issue(null,date,'capacity'));continue;}
  if(d.open==='NO'){
   if(c.arrivals||c.departures||previous.length||present.length||Number(d.rooms)||Number(d.beds)||Number(d.occupied))errors.push(issue(null,date,'closed'));
  }else if(!Number(d.rooms)||Number(d.rooms)>Number(d.beds)||Number(d.occupied)>Number(d.rooms)||present.filter(r=>r._bedOccupancy==='si').length>Number(d.beds)||(present.length>0&&Number(d.occupied)===0)||(present.length===0&&Number(d.occupied)!==0))errors.push(issue(null,date,'capacity'));
 }
 return {errors,rows,allRows:context,period};
}
function spotXml({rows,period,daily,allog,start,startup}){
 const tag=(key,value)=>`<${key}>${esc(value)}</${key}>`,sort=(a,b)=>iso(a.arrival_date).localeCompare(iso(b.arrival_date))||idFor(a).localeCompare(idFor(b));
 const detail=(r,member)=>{
  const residence=country(r.residence_country,allog);
  return tag('codiceclientesr',idFor(r))+tag('sesso',r.sex)+tag('cittadinanza',country(r.citizenship,allog))+(residence==='100000100'?tag('comuneresidenza',comune(r.residence_place,allog)):tag('paeseresidenza',residence))+tag('occupazionepostoletto',r._bedOccupancy)+(member?'':tag('dayuse',iso(r.arrival_date)===iso(r.departure_date)?'si':'no')+tag('tipologiaalloggiato',allog.GUEST_TYPE_CODES[r.guest_type]))+tag('eta',spotAge(r));
 };
 const arrivals=(guests)=>guests.filter(r=>primary.has(r.guest_type)).sort(sort).map(r=>'<arrivo>'+detail(r,false)+(r.guest_type==='single'?'':'<componenti>'+spotMembers(r,guests).sort(sort).map(m=>'<componente>'+detail(m,true)+'</componente>').join('')+'</componenti>')+'</arrivo>').join('');
 const output=[];
 if(startup){const previous=new Date(+new Date(start+'T00:00:00Z')-86400000).toISOString().slice(0,10),guests=rows.filter(r=>iso(r.arrival_date)<start&&iso(r.departure_date)>=start);
  output.push(guests.length?`<movimento data="${previous}" type="MP"><arrivi>${arrivals(guests)}</arrivi></movimento>`:`<movimento data="${previous}" type="NM"/>`);
 }
 for(const date of period){
  const a=rows.filter(r=>iso(r.arrival_date)===date),departing=rows.filter(r=>iso(r.departure_date)===date).sort(sort),d=daily[date];
  const dep=departing.filter(r=>{
   if(!['member','group_member'].includes(r.guest_type))return true;
   const head=spotHead(r,rows)[0];return !head||iso(head.departure_date)!==date||spotMembers(head,rows).some(m=>iso(m.departure_date)>date);
  }).map(r=>'<codiceclientesr'+(['head','group'].includes(r.guest_type)&&spotMembers(r,rows).some(m=>iso(m.departure_date)>date)?' partenzacapogrupposeparata="si"':'')+'>'+idFor(r)+'</codiceclientesr>').join('');
  const type=d.open==='NO'?'EC':a.length||dep?'MP':'NM';
  output.push(`<movimento data="${date}" type="${type}">`+(a.length?'<arrivi>'+arrivals(a)+'</arrivi>':'')+(dep?'<partenze>'+dep+'</partenze>':'')+'<datistruttura>'+tag('cameredisponibili',Number(d.rooms))+tag('postilettodisponibili',Number(d.beds))+tag('camereoccupate',Number(d.occupied))+'</datistruttura></movimento>');
 }
 return '<?xml version="1.0" encoding="UTF-8"?>\n<movimenti vendor="WelcomeBnB">\n'+output.join('\n')+'\n</movimenti>\n';
}

function generate(input){const checked=input.format==='spot_online'?spotValidate(input):validate(input);if(checked.errors.length)return {errors:checked.errors,files:[]};const p={...input,...checked},suffix=input.start+'_'+input.end;
 if(input.format==='spot_online')return {errors:[],files:[{name:'spot_online_'+suffix+'.xml',content:spotXml(p),type:'application/xml;charset=utf-8'}]};
 if(input.format==='ross')return {errors:[],files:[{name:'ross1000_'+suffix+'.xml',content:xml(p),type:'application/xml;charset=utf-8'}]};
 if(input.format==='ps'){if(!checked.rows.length)return {errors:[issue(null,'guests','empty')],files:[]};const lines=psLines(checked.rows,input.allog);if(lines.some(line=>line.length!==168))return {errors:[issue(null,'guests','ps_warning')],files:[]};return {errors:[],files:[{name:'spot_easy_ps_'+suffix+'.txt',content:lines.join('\r\n'),type:'text/plain;charset=utf-8'}]};}
 if(input.format==='umbria')return {errors:[],files:checked.period.map(date=>({name:dmy(date)+'.txt',content:umbriaFile({...p,date}),type:'text/plain;charset=us-ascii'}))};
 if(input.format==='trento')return {errors:[],files:checked.period.filter(date=>{const c=counts(checked.rows,date);return c.arrivals||c.departures;}).map(date=>({name:input.code+dmy(date)+'.txt',content:trentoFile({...p,date}),type:'text/plain;charset=us-ascii'}))};
 return {errors:[],files:[{name:'manual_entry_summary_'+suffix+'.csv',content:summary(p),type:'text/csv;charset=utf-8'}]};}
function zip(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0,centralSize=0;
 const crc=data=>{let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const block=(n)=>new Uint8Array(n),view=a=>new DataView(a.buffer),put=(v,n,x)=>v.setUint32(n,x,true),short=(v,n,x)=>v.setUint16(n,x,true);
 for(const f of files){const name=enc.encode(f.name),data=enc.encode(f.content),sum=crc(data),h=block(30+name.length),v=view(h);put(v,0,0x04034b50);short(v,4,20);short(v,6,0x800);short(v,12,33);put(v,14,sum);put(v,18,data.length);put(v,22,data.length);short(v,26,name.length);h.set(name,30);parts.push(h,data);
 const c=block(46+name.length),w=view(c);put(w,0,0x02014b50);short(w,4,20);short(w,6,20);short(w,8,0x800);short(w,14,33);put(w,16,sum);put(w,20,data.length);put(w,24,data.length);short(w,28,name.length);put(w,42,offset);c.set(name,46);central.push(c);centralSize+=c.length;offset+=h.length+data.length;
 }
 const e=block(22),v=view(e);put(v,0,0x06054b50);short(v,8,files.length);short(v,10,files.length);put(v,12,centralSize);put(v,16,offset);const result=block(offset+centralSize+22);let cursor=0;for(const p of [...parts,...central,e]){result.set(p,cursor);cursor+=p.length;}return result;
}
const api={zip,regions,config,days,counts,scope,overlap,validDate,idFor,country,comune,province,provenance,provenanceOptions,validate,generate,esc};root.RegionalExports=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
