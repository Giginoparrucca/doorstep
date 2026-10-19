import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),R=require('../lib/regional-exports.js'),A=require('../lib/alloggiati-records.js');
const fixture=JSON.parse(fs.readFileSync(new URL('./golden/synthetic/spot-online-fixtures.json',import.meta.url)));
const make=(overrides={})=>({...structuredClone(fixture),allog:A,...overrides});
const original=JSON.stringify(fixture),dir=fs.mkdtempSync(path.join(os.tmpdir(),'spot-online-'));
for(const startup of [false,true]){
 const result=R.generate(make({startup}));assert.deepEqual(result.errors,[]);assert.equal(result.files.length,1);
 const file=result.files[0],golden=new URL('./golden/synthetic/spot-online'+(startup?'-startup':'')+'-expected.xml',import.meta.url);
 assert.equal(file.name,'spot_online_2026-05-01_2026-05-08.xml');assert.equal(file.type,'application/xml;charset=utf-8');
 assert.equal(file.content,fs.readFileSync(golden,'utf8'));
 fs.writeFileSync(path.join(dir,startup?'startup.xml':'normal.xml'),file.content);
 assert.ok(!/booking_code|residence_place|date_of_birth|room_id|<nome>|<surname>|caratteristicheviaggio|motivazioniviaggio/.test(file.content));
}
assert.equal(JSON.stringify(fixture),original,'no input mutation');
// Independently parse XML and verify guest-level departures against a separate fixture ledger.
fs.writeFileSync(path.join(dir,'fixture.json'),JSON.stringify(fixture));
execFileSync('python',['-c',String.raw`
import xml.etree.ElementTree as E, json, sys, datetime
from pathlib import Path
p=Path(sys.argv[1]); f=json.loads((p/'fixture.json').read_text()); guests=f['rows']
def code(row):
 h=5381
 for c in row['id']: h=((h*33)+ord(c)) & 0xffffffff
 digits='0123456789abcdefghijklmnopqrstuvwxyz'; s=''
 while h: s=digits[h%36]+s; h//=36
 return ('W'+(s or '0')).upper()[:20]
bycode={code(g):g for g in guests}
for startup in (False,True):
 root=E.parse(p/('startup.xml' if startup else 'normal.xml')).getroot()
 assert root.tag=='movimenti' and root.attrib=={'vendor':'WelcomeBnB'}
 moves=root.findall('movimento'); dates=[m.attrib['data'] for m in moves]
 first=datetime.date.fromisoformat(f['start'])-datetime.timedelta(days=int(startup))
 assert dates==[(first+datetime.timedelta(days=i)).isoformat() for i in range(8+int(startup))]
 known={code(g) for g in guests if g['arrival_date']<f['start']}; sent=set()
 for i,m in enumerate(moves):
  date=m.attrib['data']; is_start=startup and i==0
  arrived=m.findall('./arrivi/arrivo'); records=arrived+m.findall('./arrivi/arrivo/componenti/componente')
  expected=[g for g in guests if (g['arrival_date']<f['start']<=g['departure_date'] if is_start else g['arrival_date']==date)]
  assert {r.findtext('codiceclientesr') for r in records}=={code(g) for g in expected},date
  for r in records:
   c=r.findtext('codiceclientesr'); g=bycode[c]; assert c not in sent; sent.add(c); known.add(c)
   assert r.findtext('occupazionepostoletto')==g['_bedOccupancy']
   assert r.findtext('sesso')==g['sex']; assert len(r.findtext('cittadinanza'))==9
   assert (r.find('comuneresidenza') is not None) != (r.find('paeseresidenza') is not None)
   dob=datetime.date.fromisoformat(g['date_of_birth']); arr=datetime.date.fromisoformat(g['arrival_date'])
   assert int(r.findtext('eta'))==arr.year-dob.year-((arr.month,arr.day)<(dob.month,dob.day))
   if r.tag=='arrivo':
    assert r.findtext('dayuse')=='no'
    assert (r.find('componenti') is not None)==(g['guest_type'] in ('head','group'))
   else: assert r.find('dayuse') is None and r.find('tipologiaalloggiato') is None
  departures=m.findall('./partenze/codiceclientesr'); expanded=set()
  for dep in departures:
   assert dep.text in known; g=bycode[dep.text]; expanded.add(dep.text)
   members=[x for x in guests if x['booking_code']==g['booking_code'] and x['guest_type'] in ('member','group_member')]
   separate=g['guest_type'] in ('head','group') and any(x['departure_date']>date for x in members)
   assert dep.attrib==({'partenzacapogrupposeparata':'SI'} if separate else {})
   if g['guest_type'] in ('head','group') and not separate:
    expanded.update(code(x) for x in members if x['departure_date']==date)
  assert expanded=={code(g) for g in guests if g['departure_date']==date},date
  if not is_start:
   d=f['daily'][date]; s=m.find('datistruttura'); assert s is not None
   rooms=int(s.findtext('cameredisponibili')); beds=int(s.findtext('postilettodisponibili')); occ=int(s.findtext('camereoccupate'))
   assert (rooms,beds,occ)==(d['rooms'],d['beds'],d['occupied']); assert occ<=rooms<=beds
   assert m.attrib['type']==('EC' if d['open']=='NO' else 'MP' if records or departures else 'NM')
 assert moves[-1].attrib['type']=='EC'
 assert any(m.attrib['type']=='NM' for m in moves)
`,dir]);
const bad=(change,field,code)=>{const input=make();change(input);const result=R.generate(input);assert.equal(result.files.length,0);assert.ok(result.errors.some(e=>e.field===field&&(!code||e.code===code)),JSON.stringify(result.errors));};
for(const [key,value] of [['residence_country',''],['residence_place','Castro'],['sex','X'],['citizenship','Atlantis'],['date_of_birth','2026-05-02'],['_bedOccupancy',undefined],['_bedOccupancy',true],['guest_type','unknown']])bad(i=>i.rows[1][key]=value,key);
bad(i=>i.rows[1].departure_date=i.rows[1].arrival_date,'stay_dates'); // explicit dayuse=no path; same-day stays are currently invalid
bad(i=>i.daily['2026-05-02'].beds=1,'2026-05-02','capacity');
bad(i=>i.daily['2026-05-02'].rooms=5,'2026-05-02','capacity');
bad(i=>delete i.daily['2026-05-02'],'2026-05-02','opening');
bad(i=>i.daily['2026-05-02'].occupied=0,'2026-05-02','capacity');
bad(i=>i.daily['2026-05-02']={open:'NO',rooms:0,beds:0,occupied:0},'2026-05-02','closed');
bad(i=>i.daily['2026-05-07']={open:'NO',rooms:0,beds:0,occupied:0},'2026-05-07','closed'); // departures / previous-night occupancy
bad(i=>i.end='2099-05-01','period');
bad(i=>{i.start='2099-05-01';i.end='2099-05-02';},'period','future');
bad(i=>{i.contextRows=structuredClone(i.rows);i.rows=i.rows.filter(r=>r.id!=='family');},'guest_type','group');
bad(i=>i.property.region='Veneto','regional_service');
bad(i=>i.property.regional_service='spot_easy','regional_service');
bad(i=>i.rows[3].booking_code='missing','guest_type','group');
bad(i=>i.rows[3].arrival_date='2026-04-30','guest_type','group');
bad(i=>i.rows[2]._excluded=true,'guest_type','group');
bad(i=>i.rows.push({...i.rows[2],id:'duplicate-head'}),'guest_type','group');
bad(i=>i.rows=i.rows.filter(r=>r.id!=='child'),'guest_type','group');
bad(i=>i.startup='yes','startup');
const mixed=make();mixed.rows.push(...fixture.rows.map((r,k)=>({...r,id:'other-'+k,property_id:'other'})),...fixture.rows.map((r,k)=>({...r,id:'test-'+k,is_test:true})),...fixture.rows.map((r,k)=>({...r,id:'deleted-'+k,deleted_at:'x'})),...fixture.rows.map((r,k)=>({...r,id:'draft-'+k,submitted_at:null})));assert.deepEqual(R.generate(mixed),R.generate(make()));
const reverse=make();reverse.rows.reverse();assert.deepEqual(R.generate(reverse),R.generate(make()),'stable ordering');
const empty=make({rows:[],startup:true});for(const d of Object.values(empty.daily))d.occupied=0;assert.ok(R.generate(empty).files[0].content.includes('<movimento data="2026-04-30" type="NM"/>'));
const carryMember=make({start:'2026-05-07',end:'2026-05-08'});carryMember.rows=fixture.rows.filter(r=>r.id==='late-member');carryMember.contextRows=fixture.rows;assert.deepEqual(R.generate(carryMember).errors,[]);assert.ok(!R.generate(carryMember).files[0].content.includes('<arrivi>'));carryMember.startup=true;assert.ok(R.generate(carryMember).errors.some(e=>e.field==='startup'));
const sharedBed=make();sharedBed.daily['2026-05-01'].beds=2;sharedBed.daily['2026-05-02'].beds=2;assert.deepEqual(R.generate(sharedBed).errors,[],'child sharing a bed does not consume a third bed');
const separate=make();separate.rows.push({...separate.rows.find(r=>r.id==='late-member'),id:'same-as-early-head',departure_date:'2026-05-06'});
const separateResult=R.generate(separate);assert.deepEqual(separateResult.errors,[]);const departureDay=separateResult.files[0].content.split('data="2026-05-06"')[1].split('</movimento>')[0];assert.ok(departureDay.includes(R.idFor({id:'same-as-early-head'})),'member leaving with an early head must have an individual departure');assert.ok(departureDay.includes('partenzacapogrupposeparata="SI"'));
bad(i=>{i.rows[0].id='Aa';i.rows[1].id='B@';},'id','collision');
// Compare every existing serializer byte-for-byte with the exact pre-phase source.
const legacyHashes=JSON.parse(fs.readFileSync(new URL('./golden/synthetic/spot-online-legacy-hashes.json',import.meta.url))); 
for(const format of ['ross','ps','umbria','trento','summary']){
 const i=make({format,code:'12345'});i.property.ross1000_codice='12345';for(const r of i.rows)Object.assign(r,{name:'Synthetic',surname:'Example',birth_country:'Italy',place_of_birth:'Milano',document_type:'passport',document_number:'FAKE',doc_issue_place:'Italy'});
 const result=R.generate(i);assert.deepEqual(result.errors,[]);assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'),legacyHashes[format],format+' unchanged');
}

console.log('PASS SPOT Online draft: independent XML ledger + startup goldens, group departures, residence/capacity/bed review gates, privacy, scope and unchanged legacy bytes');
