// Host console guest view (actual viewGuest) shows residence for every guest
// and the optional invoice details for the main guest. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const source = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const a = source.indexOf('function viewGuest(id) {');
const viewGuest = source.slice(a, source.indexOf('\n}\n', a) + 3);
assert.ok(a > 0 && viewGuest.includes('residenceSection'));
const head = { id: 'g1', guest_type: 'head', surname: 'FICTIONAL', name: 'HEAD', sex: 'F', booking_code: 'BOOK-1',
  residence_country: 'Italia', residence_place: 'Bari', residence_postcode: '70121',
  fiscal_code: 'TSTFNC90C41Z404Q', residence_address: 'Via Prova 1', residence_province: 'BA', invoice_email: 'guest@example.invalid' };
const member = { id: 'g2', guest_type: 'member', surname: 'FICTIONAL', name: 'MEMBER', sex: 'M', booking_code: 'BOOK-1',
  residence_country: 'Germany', residence_place: 'Berlin' };
const bare = { id: 'g3', guest_type: 'single', surname: 'FICTIONAL', name: 'BARE', sex: 'M', residence_country: 'France' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: `var hostLang=${JSON.stringify(lang)}, propertyData={}, allCheckins=${JSON.stringify([head, member, bare])};
      function toast(){} function closeGuestDetailModal(){} const sb={storage:{from(){return {createSignedUrl:async()=>({data:null})};}}};
      ${viewGuest}` });
    const text = async id => { await page.evaluate(i => viewGuest(i), id); return page.locator('#guestDetailModal').textContent(); };
    let t = await text('g1');
    assert.match(t, lang === 'it' ? /Residenza e fatturazione/ : /Residence and invoice details/);
    for (const v of ['Italia', 'Bari', '70121', 'TSTFNC90C41Z404Q', 'Via Prova 1', 'BA', 'guest@example.invalid']) assert.ok(t.includes(v), `${lang}: main guest shows ${v}`);
    t = await text('g2');
    assert.ok(t.includes('Germany') && t.includes('Berlin'), 'member residence shown');
    assert.ok(!/Codice fiscale/.test(t), 'members have no invoice fields');
    t = await text('g3');
    assert.match(t, lang === 'it' ? /Nessun dato per la fattura inserito dall'ospite/ : /The guest entered no invoice details/);
    // Guest-entered values are escaped, never markup.
    await page.evaluate(() => { allCheckins.push({ id: 'x', guest_type: 'single', surname: 'X', name: 'Y', residence_address: '<img src=x onerror=alert(1)>' }); viewGuest('x'); });
    assert.equal(await page.locator('#guestDetailModal img').count(), 0, 'address is escaped');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS guest detail invoice: actual viewGuest shows residence (country, comune, CAP) for every guest and codice fiscale/street/provincia for the main guest, a note when no invoice data was given, nothing invoice-related for members, escaped values (IT/EN)');
} finally { await browser.close(); }
