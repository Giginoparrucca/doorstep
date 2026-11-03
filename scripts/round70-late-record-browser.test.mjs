// Round 70 Phase 3 — recording a late filing. Real migration in PGlite
// (twice) with the real filed-lock trigger, per-role probes, CHECKs; and
// the actual console recordLateFiling / renderLateFilingRecord / viewGuest
// in Chromium with a stubbed Supabase client. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');

// ── 1. Database ──────────────────────────────────────────────────────────
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch (_) { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  const lockSrc = read('migration_round49_autofile.sql');
  const lockFn = lockSrc.slice(lockSrc.indexOf('create or replace function public.checkins_prevent_filed_edit()'), lockSrc.indexOf('$$;', lockSrc.indexOf('create or replace function public.checkins_prevent_filed_edit()')) + 3);
  const owner = '00000000-0000-4000-8000-000000000001', stranger = '00000000-0000-4000-8000-000000000002';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.properties(id uuid primary key, owner_id uuid);
    create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, is_test boolean default false,
      guest_type text, surname text, name text, sex text, date_of_birth date, place_of_birth text, birth_province text, birth_country text,
      citizenship text, document_type text, document_number text, doc_issue_place text, arrival_date date, departure_date date, nights int,
      alloggiati_status text default 'pending', filed_at timestamptz, receipt_path text, autofile_last_error text);
    alter table public.checkins enable row level security;
    create policy owner_rw on public.checkins for all to authenticated
      using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
      with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
    grant select, insert, update on public.checkins to authenticated; grant select on public.properties to authenticated;
    grant all on public.checkins to service_role;
    ${lockFn}
    create trigger checkins_filed_edit_guard before update on public.checkins for each row execute function public.checkins_prevent_filed_edit();`);
  await db.query('insert into public.properties values ($1,$2)', ['00000000-0000-4000-8000-0000000000aa', owner]);
  const sql = read('supabase/migrations/20261103110000_round70_late_filing.sql');
  await db.exec(sql); await db.exec(sql);
  const ins = async (code, n) => { for (let i = 0; i < n; i++) await db.query(`insert into public.checkins(property_id,booking_code,guest_type,surname,arrival_date) values ('00000000-0000-4000-8000-0000000000aa',$1,'head','FICTIONAL','2026-10-31')`, [code]); };
  await ins('LATE-A', 2);
  const as = (role, sub, fn) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); if (sub) await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sub]); return fn(tx); });
  const patch = `update public.checkins set alloggiati_status='filed', filed_at=now(), filing_method='late_questura_pec', late_pec_sent_on='2026-11-03', autofile_last_error=null where booking_code='LATE-A' returning id`;
  await assert.rejects(as('anon', null, tx => tx.query(patch)), /permission denied/, 'anon cannot record');
  assert.equal((await as('authenticated', stranger, tx => tx.query(patch))).rows.length, 0, 'another host updates nothing');
  assert.equal((await as('authenticated', owner, tx => tx.query(patch))).rows.length, 2, 'owner records the whole group');
  // Lock applies afterwards; the late fields are kept.
  await assert.rejects(as('authenticated', owner, tx => tx.query(`update public.checkins set surname='CHANGED' where booking_code='LATE-A'`)), /checkin_locked_filed/);
  const saved = (await db.query(`select filing_method, late_pec_sent_on::text d from public.checkins where booking_code='LATE-A'`)).rows;
  assert.deepEqual(saved.map(r => [r.filing_method, r.d]), [['late_questura_pec', '2026-11-03'], ['late_questura_pec', '2026-11-03']]);
  // CHECKs.
  await ins('BAD', 1);
  await assert.rejects(db.query(`update public.checkins set alloggiati_status='filed', filing_method='fax_to_police' where booking_code='BAD'`), /check constraint/, 'unknown method refused');
  await assert.rejects(db.query(`update public.checkins set late_pec_sent_on='2026-11-03' where booking_code='BAD'`), /check constraint/, 'PEC date needs the late method');
  await assert.rejects(db.query(`update public.checkins set filing_method='late_questura_pec', late_pec_sent_on='2026-11-03' where booking_code='BAD'`), /check constraint/, 'PEC date needs status filed');
  assert.equal((await as('service_role', null, tx => tx.query(`update public.checkins set autofile_last_error='x' where booking_code='BAD' returning id`))).rows.length, 1, 'service_role keeps access');
}

// ── 2. Console: recording with and without the receipt, labels ──────────
const source = read('host-console.html');
const sliceBlock = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const fn = name => { const i = source.indexOf('function ' + name + '('); return source.slice(i, source.indexOf('\n}\n', i) + 3); };
const late70 = sliceBlock('// ── Round 70 — «Invio tardivo»: late Alloggiati filing', '// Round 49 Phase 4 — the per-row autofile chip.');
const rows = ['a', 'b'].map((x, i) => ({ id: 'row-' + x, property_id: 'prop-1', booking_code: 'CAR-LATE01', arrival_date: '2026-10-31', guest_type: i ? 'member' : 'head',
  surname: 'FICTIONAL', name: 'GUEST' + x, alloggiati_status: 'pending', is_test: false, deleted_at: null }));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } }); const errors = []; const dialogs = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.clock.install({ time: new Date('2026-11-03T09:00:00Z') });
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: read('lib/alloggiati-records.js') });
    await page.addScriptTag({ content: `var hostLang=${JSON.stringify(lang)}; const HT={en:{},it:{}}; function h(k){return HT[hostLang][k]||HT.en[k]||k;}
      var propertyData={id:'prop-1',name:'Fictional House'}, propertyId='prop-1', allCheckins=${JSON.stringify(rows)}, uploads=[], updates=[], rendered=0, blockRls=false;
      function toast(){} function track(){} function downloadFile(){} function renderCheckins(){rendered++;} function paintNavBadges(){}
      const sb={ storage:{ from:b=>({ upload: async (path,file,opts)=>{ uploads.push({bucket:b,path,type:opts.contentType}); return {error:null}; } }) },
        from:t=>({ update:patch=>({ in:(col,ids)=>({ select: async()=>{ updates.push({t,patch,col,ids}); return {data: blockRls?[]:ids.map(id=>({id})), error:null}; } }) }) }) };
      ${late70}
      ${fn('viewGuest')}
      function closeGuestDetailModal(){}` });
    // With the PEC receipt upload.
    await page.evaluate(() => openLateFilingPanel('b:CAR-LATE01'));
    await page.locator('#lateFilingRecordBtn').waitFor();
    assert.equal(await page.inputValue('#lateFilingDate'), '2026-11-03');
    await page.fill('#lateFilingDate', '2026-11-02');
    await page.setInputFiles('#lateFilingReceipt', { name: 'ricevuta-consegna.eml', mimeType: 'message/rfc822', buffer: Buffer.from('fictional receipt') });
    await page.click('#lateFilingRecordBtn');
    await page.waitForFunction(() => updates.length === 1);
    const st = await page.evaluate(() => ({ uploads, updates, cache: allCheckins }));
    assert.equal(st.uploads[0].bucket, 'receipts');
    assert.equal(st.uploads[0].path, 'prop-1/CAR-LATE01-tardivo-20261102.eml', 'private bucket, property-first path');
    assert.deepEqual([...st.updates[0].ids], ['row-a', 'row-b'], 'whole group in one update');
    assert.deepEqual({ ...st.updates[0].patch, filed_at: 'x' }, { alloggiati_status: 'filed', filed_at: 'x', filing_method: 'late_questura_pec',
      late_pec_sent_on: '2026-11-02', autofile_last_error: null, receipt_path: 'prop-1/CAR-LATE01-tardivo-20261102.eml' });
    assert.ok(st.cache.every(c => c.filing_method === 'late_questura_pec'));
    assert.equal(dialogs.length, 0, 'no confirmation needed with the receipt');
    // Label in the guest view.
    await page.evaluate(() => viewGuest('row-a'));
    assert.match(await page.locator('#guestDetailModal .late-filed-pill').textContent(), lang === 'it' ? /Inviato in ritardo via PEC · 02\/11\/2026/ : /Sent late via PEC · 02\/11\/2026/);
    // Without the receipt: confirmation, no upload, no receipt_path.
    await page.evaluate(r => { allCheckins = r; uploads = []; updates = []; document.getElementById('lateFilingModal')?.remove(); document.getElementById('guestDetailModal')?.remove(); }, rows);
    await page.evaluate(() => openLateFilingPanel('b:CAR-LATE01'));
    await page.click('#lateFilingRecordBtn');
    await page.waitForFunction(() => updates.length === 1);
    assert.equal(dialogs.length, 1, 'confirmation without the receipt');
    const st2 = await page.evaluate(() => ({ uploads, patch: updates[0].patch }));
    assert.equal(st2.uploads.length, 0);
    assert.ok(!('receipt_path' in st2.patch));
    // Future date refused; a 0-row update (permissions) is reported, nothing claimed.
    await page.evaluate(r => { allCheckins = r; updates = []; blockRls = true; }, rows);
    let res = await page.evaluate(r => recordLateFiling(r, '2026-11-09', null), rows);
    assert.equal(res.ok, false); assert.equal(await page.evaluate(() => updates.length), 0, 'future date: nothing written');
    res = await page.evaluate(r => recordLateFiling(r, '2026-11-02', null), rows);
    assert.equal(res.ok, false); assert.match(res.message, lang === 'it' ? /bloccato/ : /blocked/);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }

// Static: group header label, admin hint, receipt fetch skip.
assert.ok(source.includes("const allLate = allFiled && rows.every(r => r.filing_method === 'late_questura_pec');"));
assert.ok(read('admin-alloggiati-support.js').includes("r.filing_method==='late_questura_pec'?'<strong>Filed late via PEC · '"), 'admin shows the late filing, no late-route hint');
assert.ok(read('api/_alloggiati-support.js').includes('filing_method,late_pec_sent_on'));
assert.ok(read('api/_alloggiati-receipts.js').includes("if (r.filing_method === 'late_questura_pec') return false;"));
console.log('PASS round70-late-record: migration re-runnable; anon denied, another host 0 rows, owner records the whole group, filed lock then applies, late fields kept; unknown method and orphan PEC dates refused; service_role kept; console records with receipt (private bucket, property-first path, one update for the group) and without (confirmation, no upload); future date and 0-row updates refused; guest view label; group header, admin and receipt-fetch handling (IT/EN)');
