// Actual guest history renderer, served only fictional projected responses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('async function checkExistingChat(');
const renderer=source.slice(start,source.indexOf('\n}\n',start)+2);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const lang of ['it','en'])for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const placeholder=lang==='it'?'Messaggio precedente non disponibile. Completa il check-in o contatta il tuo host per assistenza.':'Earlier message unavailable. Complete check-in or contact your host for help.';
  const html=`<div id="chatMessages"></div><div id="chatSuggestions"></div><script>
    const propertyId='fictional-property',propertyData={host_names:'Fictional host'},lang=${JSON.stringify(lang)};
    let chatEscalated=false,projected=[],_entryConversationGeneration=0;function _guestScopeKey(){return 'fixture';}
    function startHostChatListener(){}function showEscalatedBanner(){}
    function addBubble(message,kind){const p=document.createElement('p');p.textContent=message;p.className=kind;document.getElementById('chatMessages').appendChild(p);}
    async function _guestCall(action,args){if(args.lang!==lang)throw Error('Missing language');return {data:{messages:projected}};}
    ${renderer}
    window.loadFixture=async rows=>{projected=rows;await checkExistingChat();};
  </script>`;
  await page.route('https://app.welcomebnb.it/fixture-history',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://app.welcomebnb.it/fixture-history');
  const row={id:'fictional-row',sender:'host',created_at:'2099-01-01T00:00:00Z'};
  await page.evaluate(rows=>loadFixture(rows),[{...row,message:placeholder,entry_withheld:true}]);
  assert.ok(!(await page.content()).includes('FICTIONAL-ENTRY-SECRET'));
  assert.match(await page.locator('#chatMessages').innerText(),new RegExp(lang==='it'?'Messaggio precedente':'Earlier message'));
  await page.evaluate(rows=>loadFixture(rows),[{...row,message:'FICTIONAL-ENTRY-SECRET'}]);
  assert.match(await page.locator('#chatMessages').innerText(),/FICTIONAL-ENTRY-SECRET/);
  await page.evaluate(rows=>loadFixture(rows),[{...row,message:placeholder,entry_withheld:true}]);
  assert.ok(!(await page.locator('#chatMessages').innerText()).includes('FICTIONAL-ENTRY-SECRET'));
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);
  await page.close();
 }
 console.log('PASS actual guest saved-chat renderer IT/EN, 390/1440: withheld/released/restored display, no duplicate retained secret. Synthetic transport only.');
}finally{await browser.close();}
