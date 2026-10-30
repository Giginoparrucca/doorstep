// Round 68 — actual complete guest page: residence is required for every
// guest, members start from the main guest's residence (visible, editable),
// Alto Adige also needs the postcode, and the main guest can add optional
// invoice details with a checked codice fiscale. All network is intercepted
// and all data is fictional (synthetic codice fiscale only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://residence.example.invalid';
const pid = '22222222-2222-4222-8222-222222222222';
const VALID_CF = 'TSTFNC90C41Z404Q';
const T = {
  it: { country: /stato di residenza/i, place: /comune di residenza/i, postcode: /CAP di residenza/i, cf: /codice fiscale non sembra corretto/i },
  en: { country: /country of residence/i, place: /comune of residence/i, postcode: /postcode of residence/i, cf: /codice fiscale doesn't look right/i },
};

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });

async function openGuestPage({ language, width, region, guests = [] }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const state = { inserts: [], updates: [], alerts: [], errors: [] };
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.WELCOME_BNB_CONFIG=${JSON.stringify({ mode: 'production', projectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publicKey: 'fictional-public', allowedOrigins: [origin], appOrigin: origin })}` });
    if (u.pathname === '/api/guest-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fictional-token', expires_at: '2099-01-01T00:00:00Z' }) });
    if (u.pathname === '/api/guest') {
      const b = route.request().postDataJSON();
      let data = {};
      if (b.action === 'property') data = { property: { id: pid, name: 'Fictional House', host_names: 'Fictional Host', region }, entry_release: { state: 'locked', allow_entry: false } };
      if (b.action === 'history' || b.action === 'poll') data = { messages: [] };
      if (b.action === 'checkin_list') data = { guests };
      if (b.action === 'checkin_insert') { state.inserts.push(b.record); data = { id: 'row-' + state.inserts.length, booking_code: 'BOOK-R68' }; }
      if (b.action === 'checkin_update') { state.updates.push(b); data = { updated: { id: b.id, ...b.fields, editable: true } }; }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    }
    if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
    }
    return route.fulfill({ body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => state.errors.push(e.message));
  page.on('dialog', d => { state.alerts.push(d.message()); d.accept(); });
  await page.goto(origin + '/?p=' + pid + '&b=BOOK-R68');
  await page.waitForFunction(() => typeof propertyData !== 'undefined' && propertyData && propertyData.id);
  await page.evaluate(l => { setLang(l); goTo('checkin'); }, language);
  return { context, page, state };
}

async function startCheckin(page, type, count) {
  await page.fill('#arrivalDate', '2026-11-02');
  await page.fill('#departureDate', '2026-11-05');
  await page.evaluate(([t, n]) => {
    const opt = [...document.querySelectorAll('.guest-type-opt')].find(e => e.getAttribute('onclick').includes(`'${t}'`));
    selectGuestType(opt, t);
    document.getElementById('numGuests').value = String(n);
  }, [type, count]);
  await page.click('#btnNext');
}

async function fillIdentity(page, main, surname) {
  await page.fill('#surname', surname);
  await page.fill('#gname', 'Fittizio');
  await page.selectOption('#sex', 'F');
  await page.fill('#dob', '1990-03-01');
  await page.fill('#birthplace', 'Berlin');
  await page.fill('#birthCountry', 'Germany');
  await page.fill('#citizenship', 'Germany');
  if (main) { await page.fill('#docnum', 'FICT0001'); await page.fill('#docissue', 'Berlin'); }
}

async function pickResidenceComune(page, name) {
  await page.fill('#residencePlace', name.toLowerCase());
  const row = page.locator(`#residencePlace ~ .comune-autocomplete-panel .comune-row[data-name="${name}"]`).first();
  await row.dispatchEvent('mousedown');
}

async function next(page, state) {
  const before = state.alerts.length;
  await page.click('#btnNext');
  await page.waitForTimeout(150);
  return state.alerts.slice(before).join('\n');
}

const visible = (page, sel) => page.locator(sel).isVisible();

try {
  for (const language of ['it', 'en']) for (const width of [390, 1440]) {
    const L = T[language];

    // ── Family on a Puglia property ──────────────────────────────────────
    let { context, page, state } = await openGuestPage({ language, width, region: 'Puglia' });
    await startCheckin(page, 'head', 2);
    await fillIdentity(page, true, 'Capofamiglia');
    assert.equal(await visible(page, '#invoiceSection'), true, 'main guest sees the invoice section');
    assert.equal(await visible(page, '#invoiceFields'), false, 'invoice section starts collapsed');

    let msg = await next(page, state);
    assert.match(msg, L.country, 'missing residence blocks the main guest');
    assert.equal(state.inserts.length, 0);

    await page.fill('#residenceCountry', 'Italia');
    msg = await next(page, state);
    assert.match(msg, L.place, 'Italian resident needs a comune');
    assert.equal(state.inserts.length, 0);

    await pickResidenceComune(page, 'BARI');
    await page.click('#invoiceToggle');
    assert.equal(await page.getAttribute('#invoiceToggle', 'aria-expanded'), 'true');
    assert.equal(await visible(page, '#residenceProvinceGroup'), true, 'provincia shown for residents of Italy');
    assert.equal(await page.inputValue('#residenceProvince'), 'BA', 'provincia filled from the picked comune');
    await page.fill('#fiscalCode', 'TSTFNC90C41Z404A');
    msg = await next(page, state);
    assert.match(msg, L.cf, 'invalid codice fiscale blocks the save');
    assert.equal(await visible(page, '#fiscalCodeError'), true, 'inline codice fiscale error');
    assert.equal(state.inserts.length, 0);

    await page.fill('#fiscalCode', VALID_CF.toLowerCase());
    assert.equal(await visible(page, '#fiscalCodeError'), false, 'error clears while typing');
    await page.fill('#residenceAddress', 'Via Prova 1');
    await page.fill('#residencePostcode', '70121');
    if (process.env.ENTRY_QA_DIR) { await page.locator('#invoiceSection').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.ENTRY_QA_DIR}/r68-invoice-${language}-${width}.png` }); }
    msg = await next(page, state);
    assert.equal(msg, '', 'valid main guest saves without alerts');
    assert.equal(state.inserts.length, 1);
    const lead = state.inserts[0];
    assert.equal(lead.residence_country, 'Italia');
    assert.equal(lead.residence_place, 'BARI', 'comune picked from the official list');
    assert.equal(lead.fiscal_code, VALID_CF, 'codice fiscale normalised');
    assert.equal(lead.residence_address, 'Via Prova 1');
    assert.equal(lead.residence_postcode, '70121');
    assert.equal(lead.residence_province, 'BA');

    // Member: residence pre-filled and visible, invoice section hidden.
    await page.waitForFunction(() => currentGuestIdx === 1);
    assert.equal(await page.inputValue('#residenceCountry'), 'Italia', 'member country pre-filled');
    assert.equal(await page.inputValue('#residencePlace'), 'BARI', 'member comune pre-filled');
    assert.equal(await visible(page, '#residencePrefillHint'), true, 'pre-fill is announced');
    assert.equal(await visible(page, '#invoiceSection'), false, 'members have no invoice section');
    assert.equal(await page.inputValue('#fiscalCode'), '', 'invoice details do not carry over');
    await fillIdentity(page, false, 'Familiare');
    await page.fill('#residenceCountry', 'Germany');
    await page.fill('#residencePlace', '');
    assert.equal(await visible(page, '#residencePrefillHint'), false, 'hint disappears once the member changes it');
    msg = await next(page, state);
    assert.equal(msg, '', 'foreign member without city saves');
    assert.equal(state.inserts.length, 2);
    const member = state.inserts[1];
    assert.equal(member.residence_country, 'Germany');
    assert.equal(member.residence_place, '');
    assert.equal(member.fiscal_code, '');
    assert.equal(member.residence_postcode, '');
    assert.equal(member.residence_province, '');
    await page.waitForSelector('#checkinSuccess.show');
    assert.deepEqual(state.errors, []);
    await context.close();

    // ── Single foreign guest, empty invoice section: submission as before.
    ({ context, page, state } = await openGuestPage({ language, width, region: null }));
    await startCheckin(page, 'single', 1);
    await fillIdentity(page, true, 'Solo');
    msg = await next(page, state);
    assert.match(msg, L.country, 'property with no region still requires residence');
    await page.fill('#residenceCountry', 'France');
    msg = await next(page, state);
    assert.equal(msg, '');
    const solo = state.inserts[0];
    assert.equal(solo.residence_country, 'France');
    for (const k of ['fiscal_code', 'residence_address', 'residence_postcode', 'residence_province']) assert.equal(solo[k], '', `${k} empty`);
    assert.deepEqual(state.errors, []);
    await context.close();

    // ── Alto Adige: postcode required for every guest; foreigner with
    //    address only sees no provincia field.
    ({ context, page, state } = await openGuestPage({ language, width, region: 'Alto Adige' }));
    await startCheckin(page, 'head', 2);
    await fillIdentity(page, true, 'Bergfuehrer');
    await page.fill('#residenceCountry', 'Austria');
    assert.equal(await page.evaluate(() => document.getElementById('residencePostcodeGroup').parentNode.id), 'residencePostcodeRequiredSlot', 'postcode sits with residence in Alto Adige');
    assert.match(await page.textContent('#residencePostcodeLabel'), /\*/, 'postcode marked required');
    await page.click('#invoiceToggle');
    assert.equal(await visible(page, '#residenceProvinceGroup'), false, 'no provincia for foreign residents');
    await page.fill('#residenceAddress', 'Hauptstrasse 1');
    msg = await next(page, state);
    assert.match(msg, L.postcode, 'Alto Adige needs the postcode');
    assert.equal(state.inserts.length, 0);
    await page.fill('#residencePostcode', '6020');
    msg = await next(page, state);
    assert.equal(msg, '');
    assert.equal(state.inserts[0].residence_postcode, '6020');
    assert.equal(state.inserts[0].residence_address, 'Hauptstrasse 1');
    assert.equal(state.inserts[0].residence_province, '');
    await page.waitForFunction(() => currentGuestIdx === 1);
    assert.equal(await visible(page, '#residencePostcodeGroup'), true, 'member sees the postcode too');
    assert.equal(await page.inputValue('#residencePostcode'), '6020', 'member postcode pre-filled');
    await fillIdentity(page, false, 'Bergkind');
    await page.fill('#residencePostcode', '');
    msg = await next(page, state);
    assert.match(msg, L.postcode, 'member postcode required in Alto Adige');
    await page.fill('#residencePostcode', '6020');
    msg = await next(page, state);
    assert.equal(msg, '');
    assert.equal(state.inserts[1].residence_postcode, '6020');
    assert.deepEqual(state.errors, []);
    await context.close();

    // ── Welcome back: values pre-filled on edit; an older row without
    //    residence is asked for it before saving.
    const guests = [
      { id: 'old-main', guest_type: 'head', surname: 'Ritorno', name: 'Main', sex: 'F', date_of_birth: '1990-03-01', place_of_birth: 'Berlin', birth_country: 'Germany', citizenship: 'Germany', document_number: 'FICT0002', doc_issue_place: 'Berlin', arrival_date: '2026-11-02', departure_date: '2026-11-05', residence_country: 'Italia', residence_place: 'Bari', fiscal_code: VALID_CF, residence_address: 'Via Prova 1', residence_postcode: '70121', residence_province: 'BA', editable: true },
      { id: 'old-member', guest_type: 'member', surname: 'Ritorno', name: 'Member', sex: 'M', date_of_birth: '2015-01-01', place_of_birth: 'Berlin', birth_country: 'Germany', citizenship: 'Germany', arrival_date: '2026-11-02', departure_date: '2026-11-05', residence_country: null, residence_place: null, editable: true },
    ];
    ({ context, page, state } = await openGuestPage({ language, width, region: 'Puglia', guests }));
    // Startup loads the saved guests and opens the welcome page; act after it settles.
    await page.waitForFunction(() => existingCheckins.length === 2 && document.getElementById('page-welcome').classList.contains('active'));
    await page.evaluate(g => { existingCheckins = g; goTo('checkin'); showWelcomeBackState(g); editGuest(0); }, guests);
    assert.equal(await page.inputValue('#ed_fiscal0'), VALID_CF, 'codice fiscale pre-filled on edit');
    assert.equal(await page.inputValue('#ed_raddress0'), 'Via Prova 1');
    assert.equal(await page.inputValue('#ed_rpostcode0'), '70121');
    assert.equal(await page.inputValue('#ed_rprov0'), 'BA');
    assert.equal(await page.inputValue('#ed_rcountry0'), 'Italia');
    await page.evaluate(() => editGuest(1));
    assert.equal(await page.locator('#ed_fiscal1').count(), 0, 'members have no invoice fields');
    let before = state.alerts.length;
    await page.evaluate(() => saveGuestEdit(1));
    assert.match(state.alerts.slice(before).join('\n'), L.country, 'older row asks for residence before saving');
    assert.equal(state.updates.length, 0);
    // Startup may switch pages again; set the value through the DOM.
    await page.evaluate(() => { const el = document.getElementById('ed_rcountry1'); el.value = 'France'; el.dispatchEvent(new Event('input')); });
    await page.evaluate(() => saveGuestEdit(1));
    assert.equal(state.updates.length, 1);
    assert.equal(state.updates[0].id, 'old-member');
    assert.equal(state.updates[0].fields.residence_country, 'France');
    assert.deepEqual(state.errors, []);
    await context.close();

    console.log(`PASS ${language} ${width}px: residence required (incl. no-region property), Italian comune via list with provincia, invalid codice fiscale blocked inline then fixed, member pre-fill visible/editable, empty invoice section unchanged, Alto Adige postcode for every guest, edit pre-fill and older-row residence prompt`);
  }
} finally {
  await browser.close();
}
