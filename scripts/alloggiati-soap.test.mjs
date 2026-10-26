import assert from 'node:assert/strict';import fs from 'node:fs';
import {generateToken,authenticationTest,test,send,ricevuta,_internal} from '../api/_alloggiati-soap.js';
const {pickTag,interpretResult,extractDettaglio}=_internal;
const fixture=fs.readFileSync(new URL('./golden/synthetic/alloggiati-test-empty-fields.xml',import.meta.url),'utf8');
for(const empty of ['<ErroreDes />','<ErroreDes/>','<ErroreDes xsi:nil="true" />','<ErroreDes></ErroreDes>','<ns_1:ErroreDes />']){
 assert.equal(pickTag(empty+'<x><ErroreDes>Do not capture me</ErroreDes></x>','ErroreDes'),'');
}
assert.equal(pickTag('<ns_1:ErroreDes key="x">Message</ns_1:ErroreDes>','ErroreDes'),'Message');
assert.equal(pickTag('<ErroreDescrizione>Wrong</ErroreDescrizione>','ErroreDes'),'');
const overall=interpretResult(fixture,'TestResult');assert.equal(overall.ok,true);assert.equal(overall.erroreDes,'');assert.equal(overall.erroreDet,'');
for(const tag of ['TestResult','SendResult','Authentication_TestResult','RicevutaResult']){
 const missing=interpretResult(`<${tag}/><result><Dettaglio><EsitoOperazioneServizio><esito>true</esito><ErroreCod>0</ErroreCod></EsitoOperazioneServizio></Dettaglio></result>`,tag);assert.equal(missing.ok,false);assert.equal(missing.shapeUnknown,true);
}
assert.equal(interpretResult('<TestResult><esito>false</esito><ErroreCod>0</ErroreCod></TestResult>','TestResult').code,'portal_error');
assert.equal(extractDettaglio('<EsitoOperazioneServizio xsi:nil="true"/><EsitoOperazioneServizio><esito>true</esito><ErroreCod>0</ErroreCod><ErroreDes/><ErroreDettaglio/></EsitoOperazioneServizio>').length,2);
assert.equal(extractDettaglio('<EsitoOperazioneServizio xsi:nil="true"/>')[0].code,'unrecognized_response');
const originalFetch=globalThis.fetch;let response=fixture,actions=[];
globalThis.fetch=async(_,options)=>{actions.push(options.headers.SOAPAction);return {ok:true,text:async()=>response};};
try{
 const parsed=await test({utente:'FICTIONAL',token:'FICTIONAL',rows:['X'.repeat(168),'Y'.repeat(168)]});
 assert.equal(JSON.stringify(parsed,null,2)+'\n',fs.readFileSync(new URL('./golden/synthetic/alloggiati-test-empty-fields.json',import.meta.url),'utf8'),'exact parser golden');
 response=fixture.replaceAll('TestResponse','SendResponse').replaceAll('TestResult','SendResult');const sent=await send({utente:'FICTIONAL',token:'FICTIONAL',rows:['X'.repeat(168)]});assert.equal(sent.overall.erroreDes,'');assert.equal(sent.perRow[0].erroreDet,'Data di Arrivo Errata');
 response='<GenerateTokenResponse><GenerateTokenResult><issued>2026-10-26</issued><expires>2026-10-27</expires><token>FICTIONAL_TOKEN</token></GenerateTokenResult><result><esito>true</esito><ErroreCod>0</ErroreCod><ErroreDes/><ErroreDettaglio/></result></GenerateTokenResponse>';
 assert.equal((await generateToken({utente:'FICTIONAL',password:'FICTIONAL',wskey:'FICTIONAL'})).token,'FICTIONAL_TOKEN');
 response='<Authentication_TestResponse><Authentication_TestResult><esito>true</esito><ErroreCod>0</ErroreCod><ErroreDes/><ErroreDettaglio/></Authentication_TestResult></Authentication_TestResponse>';
 assert.equal(await authenticationTest({utente:'FICTIONAL',token:'FICTIONAL'}),true);
 const pdf=Buffer.from('%PDF-'+ 'X'.repeat(200));response=`<RicevutaResponse><RicevutaResult><esito>true</esito><ErroreCod>0</ErroreCod><ErroreDes/><ErroreDettaglio/></RicevutaResult><PDF>${pdf.toString('base64')}</PDF></RicevutaResponse>`;
 assert.equal((await ricevuta({utente:'FICTIONAL',token:'FICTIONAL',date:'2026-10-25'})).pdf.toString(),pdf.toString());
 response='<TestResult/><result><Dettaglio><EsitoOperazioneServizio><esito>true</esito></EsitoOperazioneServizio></Dettaglio></result>';await assert.rejects(()=>test({utente:'FICTIONAL',token:'FICTIONAL',rows:['X']}),error=>error.code==='unrecognized_response');
}finally{globalThis.fetch=originalFetch;}
assert.ok(actions.every(action=>/AlloggiatiService\//.test(action)));
console.log('PASS self-closing/empty/nil/prefixed SOAP tags, bounded operation status, exact fictional response golden, per-row detail and real mocked Test/Send/auth/token/receipt clients; no external requests');
